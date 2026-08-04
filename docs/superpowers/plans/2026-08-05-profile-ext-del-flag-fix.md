# Profile Ext Article Deletion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct `profile_ext_getmsg` deletion-state conversion and safely repair affected IndexedDB article records.

**Architecture:** Keep WeChat-specific flag semantics in the profile response converter and persist both provenance and the raw flag on newly converted articles. Put record recognition and correction in a pure migration helper, but only migrate records that already contain the source-specific raw flag; pre-provenance caches remain unchanged until a normal sync overwrites them. Call the helper from a Dexie v8 upgrade so unrelated article sources remain untouched.

**Tech Stack:** Nuxt 3, TypeScript, Node 22 built-in test runner, Dexie 4, Puppeteer for final browser verification.

---

## File map

- Create `test/profile-getmsg.test.ts`: regression tests for `del_flag` conversion, provenance, and multi-article messages.
- Modify `utils/profile-getmsg.ts`: normalize the raw flag and map only `del_flag = 4` to deleted.
- Modify `types/types.d.ts`: add optional profile source metadata to `AppMsgEx`.
- Create `test/profile-getmsg-migration.test.ts`: regression tests for conservative legacy-record detection and correction.
- Create `utils/profile-getmsg-migration.ts`: pure, database-independent legacy migration functions.
- Modify `store/v2/db.ts`: run the pure correction through a Dexie v8 upgrade.
- Modify `package.json`: expose the new regression suite through `yarn test`.

### Task 1: Correct new profile response conversion

**Files:**

- Create: `test/profile-getmsg.test.ts`
- Modify: `utils/profile-getmsg.ts`
- Modify: `types/types.d.ts`

- [ ] **Step 1: Write the failing conversion test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProfileGetMsgResponse } from '../types/profile_getmsg.d.ts';
import { convertProfileGetMsgResponse } from '../utils/profile-getmsg.ts';

function makeResponse(): ProfileGetMsgResponse {
  return {
    ret: 0,
    errmsg: 'ok',
    can_msg_continue: 1,
    msg_count: 3,
    next_offset: 3,
    real_type: 0,
    use_video_tab: 1,
    video_count: 0,
    general_msg_list: JSON.stringify({
      list: [
        {
          comm_msg_info: { id: 1001, datetime: 1785806269 },
          app_msg_ext_info: {
            title: 'normal',
            content_url: 'https://mp.weixin.qq.com/s?mid=2247485222&idx=1',
            cover: 'https://example.com/normal.jpg',
            del_flag: 1,
            multi_app_msg_item_list: [
              {
                title: 'deleted child',
                content_url: 'https://mp.weixin.qq.com/s?mid=2247485222&idx=2',
                cover: 'https://example.com/deleted.jpg',
                del_flag: 4,
              },
            ],
          },
        },
        {
          comm_msg_info: { id: 1002, datetime: 1785806200 },
          app_msg_ext_info: {
            title: 'unknown flag',
            content_url: 'https://mp.weixin.qq.com/s?mid=2247485221&idx=1',
            cover: 'https://example.com/unknown.jpg',
            del_flag: 99,
          },
        },
        {
          comm_msg_info: { id: 1003, datetime: 1785806100 },
          app_msg_ext_info: {
            title: 'missing flag',
            content_url: 'https://mp.weixin.qq.com/s?mid=2247485220&idx=1',
            cover: 'https://example.com/missing.jpg',
          },
        },
      ],
    }),
  };
}

test('maps profile deletion flags and preserves their source', () => {
  const { articles } = convertProfileGetMsgResponse(makeResponse(), 0);

  assert.deepEqual(
    articles.map(article => ({
      title: article.title,
      deleted: article.is_deleted,
      source: article._source,
      rawFlag: article._profile_del_flag,
    })),
    [
      { title: 'normal', deleted: false, source: 'profile_ext', rawFlag: 1 },
      { title: 'deleted child', deleted: true, source: 'profile_ext', rawFlag: 4 },
      { title: 'unknown flag', deleted: false, source: 'profile_ext', rawFlag: 99 },
      { title: 'missing flag', deleted: false, source: 'profile_ext', rawFlag: undefined },
    ]
  );
});
```

- [ ] **Step 2: Run the conversion test and verify RED**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/profile-getmsg.test.ts
```

Expected: FAIL because `del_flag = 1` currently produces `is_deleted = true`, while `_source` and `_profile_del_flag` are absent.

- [ ] **Step 3: Add source metadata to the shared article type**

Add these optional fields to `AppMsgEx` in `types/types.d.ts`:

```ts
  // 微信历史消息接口来源信息
  _source?: 'profile_ext';
  _profile_del_flag?: number;
```

- [ ] **Step 4: Implement the minimal flag conversion**

Add to `utils/profile-getmsg.ts`:

```ts
function normalizeProfileDelFlag(delFlag?: number): number | undefined {
  const value = Number(delFlag);
  return Number.isFinite(value) ? value : undefined;
}

export function isProfileArticleDeleted(delFlag?: number): boolean {
  return normalizeProfileDelFlag(delFlag) === 4;
}
```

In the object returned by `toAppMsgEx`, replace the current deletion assignment and add provenance:

```ts
    _source: 'profile_ext',
    _profile_del_flag: normalizeProfileDelFlag(item.del_flag),
    is_deleted: isProfileArticleDeleted(item.del_flag),
```

- [ ] **Step 5: Run the conversion test and verify GREEN**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/profile-getmsg.test.ts
```

Expected: one passing test and no failures.

- [ ] **Step 6: Commit the conversion fix**

```bash
git add test/profile-getmsg.test.ts utils/profile-getmsg.ts types/types.d.ts
git commit -m "fix: correct profile article deletion flags"
```

### Task 2: Repair affected legacy IndexedDB records

**Files:**

- Create: `test/profile-getmsg-migration.test.ts`
- Create: `utils/profile-getmsg-migration.ts`
- Modify: `store/v2/db.ts`

- [ ] **Step 1: Write the failing migration tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLegacyProfileArticle,
  migrateLegacyProfileArticleDeletion,
} from '../utils/profile-getmsg-migration.ts';

function legacyProfileArticle(isDeleted: boolean, copyrightStat: number): Record<string, any> {
  const cover = 'https://example.com/cover.jpg';
  return {
    aid: '2247485222_1',
    album_id: '',
    appmsg_album_infos: [],
    ban_flag: 0,
    checking: 0,
    copyright_stat: copyrightStat,
    copyright_type: copyrightStat,
    cover,
    cover_img: cover,
    create_time: 1785806269,
    update_time: 1785806269,
    is_deleted: isDeleted,
    mediaapi_publish_status: 0,
    pic_cdn_url_1_1: cover,
    pic_cdn_url_3_4: cover,
    pic_cdn_url_16_9: cover,
    pic_cdn_url_235_1: cover,
  };
}

test('repairs inverted profile deletion states only when the raw flags were persisted', () => {
  const normal = { ...legacyProfileArticle(true, 11), _profile_del_flag: 1, _status: '' };
  const deleted = { ...legacyProfileArticle(false, 100), _profile_del_flag: 4 };

  assert.equal(migrateLegacyProfileArticleDeletion(normal), true);
  assert.equal(normal.is_deleted, false);
  assert.equal(normal._source, 'profile_ext');
  assert.equal(normal._profile_del_flag, 1);

  assert.equal(migrateLegacyProfileArticleDeletion(deleted), true);
  assert.equal(deleted.is_deleted, true);
  assert.equal(deleted._source, 'profile_ext');
  assert.equal(deleted._profile_del_flag, 4);
});

test('leaves ambiguous, corrected, and other-source records unchanged', () => {
  const single = { ...legacyProfileArticle(false, 100), _profile_del_flag: 4, _single: true };
  const publisher = legacyProfileArticle(true, 11);
  const missingFlag = legacyProfileArticle(false, 100);
  const unknownFlag = { ...legacyProfileArticle(false, 100), _profile_del_flag: 99 };
  const correctedNormal = { ...legacyProfileArticle(false, 11), _profile_del_flag: 1 };
  const correctedDeleted = { ...legacyProfileArticle(true, 100), _profile_del_flag: 4 };
  const downloaded = { ...legacyProfileArticle(true, 11), _profile_del_flag: 1, _status: '正常' };
  const alreadyMigrated = {
    ...legacyProfileArticle(false, 100),
    _profile_del_flag: 4,
    _source: 'profile_ext' as const,
  };

  for (const article of [
    single,
    publisher,
    missingFlag,
    unknownFlag,
    correctedNormal,
    correctedDeleted,
    downloaded,
    alreadyMigrated,
  ]) {
    const before = structuredClone(article);
    assert.equal(isLegacyProfileArticle(article), false);
    assert.equal(migrateLegacyProfileArticleDeletion(article), false);
    assert.deepEqual(article, before);
  }
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/profile-getmsg-migration.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because `utils/profile-getmsg-migration.ts` does not exist.

- [ ] **Step 3: Implement conservative legacy detection and correction**

Create `utils/profile-getmsg-migration.ts`:

```ts
type MutableArticle = Record<string, unknown> & {
  is_deleted?: boolean;
  _source?: string;
  _profile_del_flag?: number;
};

export function isLegacyProfileArticle(article: MutableArticle): boolean {
  const cover = article.cover;
  const hasInvertedDeletionState =
    (article._profile_del_flag === 1 && article.is_deleted === true) ||
    (article._profile_del_flag === 4 && article.is_deleted === false);

  return (
    article._source === undefined &&
    article._single !== true &&
    (article._status === undefined || article._status === '') &&
    hasInvertedDeletionState &&
    article.album_id === '' &&
    Array.isArray(article.appmsg_album_infos) &&
    article.appmsg_album_infos.length === 0 &&
    article.ban_flag === 0 &&
    article.checking === 0 &&
    article.mediaapi_publish_status === 0 &&
    article.create_time === article.update_time &&
    article.cover_img === cover &&
    article.pic_cdn_url_1_1 === cover &&
    article.pic_cdn_url_3_4 === cover &&
    article.pic_cdn_url_16_9 === cover &&
    article.pic_cdn_url_235_1 === cover &&
    article.copyright_type === article.copyright_stat
  );
}

export function migrateLegacyProfileArticleDeletion(article: MutableArticle): boolean {
  if (!isLegacyProfileArticle(article)) return false;

  article.is_deleted = article._profile_del_flag === 4;
  article._source = 'profile_ext';
  return true;
}
```

- [ ] **Step 4: Run the migration test and verify GREEN**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/profile-getmsg-migration.test.ts
```

Expected: two passing tests and no failures.

- [ ] **Step 5: Wire the helper into Dexie v8**

Import the helper in `store/v2/db.ts`:

```ts
import { migrateLegacyProfileArticleDeletion } from '~/utils/profile-getmsg-migration';
```

Append the v8 migration after v7:

```ts
db.version(8).upgrade(async tx => {
  try {
    const table = tx.table('article');
    const updates: { key: string; article: any }[] = [];

    await table.toCollection().each((article: any, cursor) => {
      if (migrateLegacyProfileArticleDeletion(article)) {
        updates.push({ key: cursor.primaryKey as string, article });
      }
    });

    for (const { key, article } of updates) {
      await table.put(article, key);
    }

    if (updates.length > 0) {
      console.info(`[Article v8 migration] corrected ${updates.length} profile article deletion states`);
    }
  } catch (err) {
    console.error('[Article v8 migration] deletion-state correction failed:', err);
  }
});
```

- [ ] **Step 6: Run both regression files**

Run:

```bash
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/profile-getmsg.test.ts test/profile-getmsg-migration.test.ts
```

Expected: three passing tests and no failures.

- [ ] **Step 7: Commit the cache migration**

```bash
git add test/profile-getmsg-migration.test.ts utils/profile-getmsg-migration.ts store/v2/db.ts
git commit -m "fix: migrate cached profile deletion states"
```

### Task 3: Add the repeatable test command and verify the application

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add the regression test script**

Add this entry to `scripts` in `package.json`:

```json
"test": "node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/*.test.ts"
```

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
yarn test
```

Expected: three passing tests and no failures.

- [ ] **Step 3: Run a production build**

Run:

```bash
yarn build
```

Expected: Nuxt build exits with status 0 and produces `.output/`.

- [ ] **Step 4: Verify the real browser flow against the current local credential**

With `yarn dev` serving `http://localhost:3001`, run the sanitized headless-browser diagnostic used during root-cause investigation. It must perform this exact flow without logging credential values:

1. Load the current credential from ignored `credential-service/data/credentials.json` into a temporary browser profile.
2. Open `/dashboard/account`, add the credential's account, and wait for `profile_ext_getmsg` to return `ret = 0`.
3. Assert IndexedDB contains ten matching articles, one with `is_deleted = true` and nine with `is_deleted = false`.
4. Open `/dashboard/article`, select the account, and assert AG Grid displays nine rows with the default `hideDeleted = true` preference.
5. Set `preferences.hideDeleted = false`, reload, select the account, and assert AG Grid displays ten rows.

Expected diagnostic summary:

```json
{
  "apiRet": 0,
  "cachedArticles": 10,
  "cachedDeleted": 1,
  "defaultVisibleRows": 9,
  "showDeletedVisibleRows": 10,
  "pageErrors": []
}
```

- [ ] **Step 5: Commit the test command**

```bash
git add package.json
git commit -m "test: add profile regression suite"
```

- [ ] **Step 6: Inspect the final diff and status**

Run:

```bash
git diff HEAD~3..HEAD --check
git status --short
```

Expected: `git diff --check` has no output and the worktree is clean.
