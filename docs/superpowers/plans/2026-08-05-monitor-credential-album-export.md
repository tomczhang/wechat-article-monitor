# Monitor Credential Picker and Album Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace obsolete navigation and monitor actions, then make the album page use the complete article grab/export pipeline for every article in the selected album.

**Architecture:** Keep `Downloader` and `Exporter` as the single article-processing implementation. Add a focused album adapter that collects every paginated album entry, converts missing entries into non-destructive article stubs, and returns URLs that the existing `useDownloader` and `useExporter` composables can process.

**Tech Stack:** Nuxt 3 SPA, Vue 3 Composition API, Nuxt UI v2, TypeScript, Dexie/IndexedDB, Node test runner, Biome.

---

## File Map

- Create `utils/album-articles.ts`: pure album pagination/deduplication and album-entry-to-article conversion, plus non-destructive cache insertion.
- Create `test/album-articles.test.ts`: unit coverage for stable conversion, deduplication, pagination completion, and stalled pagination.
- Create `test/dashboard-navigation.test.ts`: source-level regressions for the monitor selector and global header actions.
- Create `test/album-page-regressions.test.ts`: source-level regressions proving the album page uses the shared downloader/exporter and no longer uses the HTML-only workflow.
- Modify `pages/dashboard/monitor.vue`: replace the modal launcher with an inline Credential selector and remove modal-only state/markup.
- Modify `components/dashboard/Actions.vue`: keep only the repository GitHub action.
- Modify `pages/dashboard/album.vue`: prepare the full album, cache missing article stubs, and expose the shared grab/export actions.
- Delete `composables/useBatchDownload.ts`: remove the obsolete HTML-only album implementation after its only consumer is migrated.
- Modify `CLAUDE.md`: remove the stale architecture reference to `useBatchDownload.ts`.

### Task 1: Album Article Adapter

**Files:**
- Create: `test/album-articles.test.ts`
- Create: `utils/album-articles.ts`

- [ ] **Step 1: Write failing conversion and deduplication tests**

Create tests that construct an `ArticleItem`, account fakeid, and album, then assert stable article fields and preservation of existing URLs:

```ts
test('buildAlbumArticleStub creates a stable downloader-compatible article', () => {
  const result = buildAlbumArticleStub('biz-a', album, article('100', '2', 'https://mp.weixin.qq.com/s/a'));

  assert.equal(result.fakeid, 'biz-a');
  assert.equal(result.aid, '100_2');
  assert.equal(result.appmsgid, 100);
  assert.equal(result.itemidx, 2);
  assert.equal(result.link, 'https://mp.weixin.qq.com/s/a');
  assert.deepEqual(result.appmsg_album_infos, [album]);
});

test('selectMissingAlbumArticleStubs does not replace an existing article URL', () => {
  const result = selectMissingAlbumArticleStubs(
    new Set(['https://mp.weixin.qq.com/s/existing']),
    'biz-a',
    album,
    [
      article('100', '1', 'https://mp.weixin.qq.com/s/existing'),
      article('101', '1', 'https://mp.weixin.qq.com/s/new'),
    ]
  );

  assert.deepEqual(result.map(item => item.link), ['https://mp.weixin.qq.com/s/new']);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `yarn test test/album-articles.test.ts`

Expected: FAIL because `utils/album-articles.ts` does not exist.

- [ ] **Step 3: Implement stable conversion and non-destructive cache insertion**

Implement these public contracts:

```ts
export function buildAlbumArticleStub(
  fakeid: string,
  album: AppMsgAlbumInfo,
  item: ArticleItem
): AppMsgExWithFakeID;

export function selectMissingAlbumArticleStubs(
  existingUrls: ReadonlySet<string>,
  fakeid: string,
  album: AppMsgAlbumInfo,
  items: ArticleItem[]
): AppMsgExWithFakeID[];

export async function cacheMissingAlbumArticles(
  fakeid: string,
  album: AppMsgAlbumInfo,
  items: ArticleItem[]
): Promise<void>;
```

`buildAlbumArticleStub` must derive `aid` as `${item.msgid}_${item.itemidx}`, convert numeric string fields with `Number`, copy title/link/date/cover/paid state, set the selected album, and use empty or zero values for unavailable required fields. `cacheMissingAlbumArticles` must query existing rows by URL, call `selectMissingAlbumArticleStubs`, and insert only missing rows with out-of-line keys `${fakeid}:${aid}`.

- [ ] **Step 4: Write failing full-pagination tests**

Add tests for ordered URL deduplication, complete pagination, and stalled pagination:

```ts
test('collectCompleteAlbum loads every page and keeps unique URL order', async () => {
  const cursors: string[] = [];
  const result = await collectCompleteAlbum([article('1', '1', '/a')], true, async cursor => {
    cursors.push(`${cursor.msgid}:${cursor.itemidx}`);
    return {
      items: [article('1', '1', '/a'), article('2', '1', '/b')],
      hasMore: false,
    };
  });

  assert.deepEqual(cursors, ['1:1']);
  assert.deepEqual(result.map(item => item.url), ['/a', '/b']);
});

test('collectCompleteAlbum rejects a page that cannot advance', async () => {
  await assert.rejects(
    collectCompleteAlbum([article('1', '1', '/a')], true, async () => ({
      items: [article('1', '1', '/a')],
      hasMore: true,
    })),
    /分页未取得新文章/
  );
});
```

- [ ] **Step 5: Run the tests and verify the new cases fail**

Run: `yarn test test/album-articles.test.ts`

Expected: FAIL because `collectCompleteAlbum` is not exported.

- [ ] **Step 6: Implement pagination collection**

Implement:

```ts
export interface AlbumCursor {
  msgid: string;
  itemidx: string;
}

export interface AlbumPage {
  items: ArticleItem[];
  hasMore: boolean;
}

export async function collectCompleteAlbum(
  initialItems: ArticleItem[],
  initialHasMore: boolean,
  loadNext: (cursor: AlbumCursor) => Promise<AlbumPage>
): Promise<ArticleItem[]>;
```

Deduplicate by non-empty URL while preserving first-seen order. Use the last collected item as the next cursor. When `hasMore` is true but a returned page contributes no new URL, throw `new Error('合集分页未取得新文章，已停止加载')`.

- [ ] **Step 7: Run the focused tests**

Run: `yarn test test/album-articles.test.ts`

Expected: all album adapter tests PASS.

- [ ] **Step 8: Commit the adapter**

```bash
git add test/album-articles.test.ts utils/album-articles.ts
git commit -m "feat: prepare complete album article sets"
```

### Task 2: Monitor Credential Selector and Header Cleanup

**Files:**
- Create: `test/dashboard-navigation.test.ts`
- Modify: `pages/dashboard/monitor.vue`
- Modify: `components/dashboard/Actions.vue`

- [ ] **Step 1: Write failing source-level regression tests**

Test the required markup and removed actions:

```ts
test('monitor header selects an addable Credential inline', async () => {
  const source = await readFile(new URL('../pages/dashboard/monitor.vue', import.meta.url), 'utf8');

  assert.match(source, /v-model="selectedCredentialToAdd"/);
  assert.match(source, /:options="addableCredentials"/);
  assert.match(source, /@update:model-value="onCredentialSelected"/);
  assert.doesNotMatch(source, /showCredentialPicker/);
  assert.doesNotMatch(source, /添加监控公众号/);
});

test('global actions only link to this project on GitHub', async () => {
  const source = await readFile(new URL('../components/dashboard/Actions.vue', import.meta.url), 'utf8');

  assert.match(source, /https:\/\/github\.com\/tomczhang\/wechat-article-monitor/);
  assert.doesNotMatch(source, /QQGroupModal|加入QQ群|docsWebSite|打开文档/);
  assert.doesNotMatch(source, /github\.com\/wechat-article\/wechat-article-exporter/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `yarn test test/dashboard-navigation.test.ts`

Expected: FAIL against the current modal button and legacy header actions.

- [ ] **Step 3: Replace the monitor modal with the inline selector**

In `pages/dashboard/monitor.vue`:

- Replace `showCredentialPicker` with `selectedCredentialToAdd`.
- Implement `onCredentialSelected(credential)` to call `addFromCredential` and clear the model in `finally`.
- Render `USelectMenu` in the top-right header with `addableCredentials`, `option-attribute="nickname"`, a disabled/loading state, and custom label/option slots showing nickname, `biz`, avatar, and expiry.
- Keep filtering based on `validCredentials` and `watchedFakeids`.
- Delete the entire Credential picker `UModal` block.

- [ ] **Step 4: Keep only the correct GitHub action**

Reduce `components/dashboard/Actions.vue` to the `gotoLink` import and one GitHub button:

```vue
<script setup lang="ts">
import { gotoLink } from '~/utils';
</script>

<template>
  <ul class="hidden items-center gap-1 md:flex">
    <li>
      <UTooltip text="GitHub">
        <UButton
          icon="i-lucide:github"
          color="gray"
          variant="ghost"
          square
          aria-label="打开 GitHub"
          @click="gotoLink('https://github.com/tomczhang/wechat-article-monitor')"
        />
      </UTooltip>
    </li>
  </ul>
</template>
```

- [ ] **Step 5: Run the focused tests**

Run: `yarn test test/dashboard-navigation.test.ts`

Expected: both navigation tests PASS.

- [ ] **Step 6: Commit the UI cleanup**

```bash
git add test/dashboard-navigation.test.ts pages/dashboard/monitor.vue components/dashboard/Actions.vue
git commit -m "feat: select monitor credentials from the header"
```

### Task 3: Album Page Shared Grab and Export Actions

**Files:**
- Create: `test/album-page-regressions.test.ts`
- Modify: `pages/dashboard/album.vue`
- Delete: `composables/useBatchDownload.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write failing album-page regression tests**

Assert the shared composables and menus are present and the old workflow is absent:

```ts
test('album page uses the shared article grab and export pipeline', async () => {
  const source = await readFile(new URL('../pages/dashboard/album.vue', import.meta.url), 'utf8');

  assert.match(source, /useDownloader\(/);
  assert.match(source, /useExporter\(/);
  assert.match(source, /collectCompleteAlbum\(/);
  assert.match(source, /cacheMissingAlbumArticles\(/);
  assert.match(source, /downloadAlbumArticles\('html'\)/);
  assert.match(source, /downloadAlbumArticles\('metadata'\)/);
  assert.match(source, /downloadAlbumArticles\('comment'\)/);
  assert.match(source, /exportAlbumArticles\('excel'\)/);
  assert.match(source, /exportAlbumArticles\('pdf', true\)/);
  assert.doesNotMatch(source, /useDownloadAlbum|doBatchDownload|抓取全部文章链接|批量下载/);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `yarn test test/album-page-regressions.test.ts`

Expected: FAIL because the page still imports and invokes `useDownloadAlbum`.

- [ ] **Step 3: Add complete-album preparation to the page**

In `pages/dashboard/album.vue`:

- Import `collectCompleteAlbum` and `cacheMissingAlbumArticles`.
- Replace the mutating `loadMoreData` loop used by actions with `prepareAlbumArticles`.
- Pass the current last item’s `msgid` and `itemidx` to `/api/web/misc/appmsgalbum`.
- Convert `continue_flag` to `hasMore` and normalize a singleton `article_list` to an array.
- Replace `albumArticles` with the complete deduplicated result and set `noMoreData` to true.
- Cache missing stubs and return `albumArticles.map(item => item.url)`.
- Report preparation errors with the existing toast composable.

- [ ] **Step 4: Wire the existing downloader with Credential gating**

Instantiate `useDownloader()` and implement:

```ts
async function downloadAlbumArticles(type: 'html' | 'metadata' | 'comment') {
  const account = selectedAccount.value;
  if (!account || actionLocked.value) return;
  if (type !== 'html' && !findValidCredential(account.fakeid)) {
    openGate({ fakeid: account.fakeid, refresh: true });
    return;
  }

  const urls = await prepareAlbumArticles();
  if (urls) await download(type, urls);
}
```

Expose stop/progress state and show the same three grab items as the article page.

- [ ] **Step 5: Wire the existing exporter and missing-content guard**

Instantiate `useExporter()`, define `type AlbumExportType = Parameters<typeof exportFile>[0]`, and count URLs without `getHtmlCache(url)` for content-dependent formats before calling the shared exporter:

```ts
async function exportAlbumArticles(type: AlbumExportType, requiresContent = false) {
  if (!selectedAccount.value || actionLocked.value) return;
  const urls = await prepareAlbumArticles();
  if (!urls) return;

  const missingContentCount = requiresContent
    ? (await Promise.all(urls.map(url => getHtmlCache(url)))).filter(cache => !cache).length
    : undefined;
  await exportFile(type, urls, missingContentCount);
}
```

Show Excel, JSON, HTML, Txt, Markdown, Word, and PDF items with the same labels and `requiresContent` flags as the article page.

- [ ] **Step 6: Remove obsolete controls and workflow**

- Remove the “抓取全部文章链接” and “批量下载” buttons and their progress state.
- Delete `composables/useBatchDownload.ts` because no consumers remain.
- Remove the `useBatchDownload.ts` entry from `CLAUDE.md`.
- Keep the original-album link, selectors, sort toggle, list preview, and viewport-driven lazy loading.

- [ ] **Step 7: Run focused tests**

Run: `yarn test test/album-articles.test.ts test/album-page-regressions.test.ts test/dashboard-navigation.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 8: Commit the album migration**

```bash
git add test/album-page-regressions.test.ts pages/dashboard/album.vue composables/useBatchDownload.ts CLAUDE.md
git commit -m "feat: reuse article exports for complete albums"
```

### Task 4: Full Verification and Formatting

**Files:**
- Modify only files reported by Biome within the task scope.

- [ ] **Step 1: Run the complete test suite**

Run: `yarn test`

Expected: all Node tests PASS.

- [ ] **Step 2: Format and inspect scoped changes**

Run:

```bash
yarn biome check --write utils/album-articles.ts test/album-articles.test.ts test/dashboard-navigation.test.ts test/album-page-regressions.test.ts pages/dashboard/monitor.vue components/dashboard/Actions.vue pages/dashboard/album.vue
git diff --check
```

Expected: Biome completes without errors and `git diff --check` prints no output.

- [ ] **Step 3: Re-run the complete test suite after formatting**

Run: `yarn test`

Expected: all Node tests PASS.

- [ ] **Step 4: Run the production build**

Run: `yarn build`

Expected: Nuxt production build exits with code 0.

- [ ] **Step 5: Inspect final scope**

Run:

```bash
git status --short
git diff --stat HEAD~3
```

Expected: only the pre-existing `credential-service/__pycache__/credential.cpython-312.pyc` change remains unstaged; all task changes are committed.

- [ ] **Step 6: Commit any formatting-only changes**

If Biome changed tracked task files after Task 3:

```bash
git add utils/album-articles.ts test/album-articles.test.ts test/dashboard-navigation.test.ts test/album-page-regressions.test.ts pages/dashboard/monitor.vue components/dashboard/Actions.vue pages/dashboard/album.vue
git commit -m "style: format credential and album changes"
```

If `git diff --name-only` shows no task files, skip this commit.
