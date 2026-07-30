import Dexie, { type EntityTable, type Table } from 'dexie';
import type { ArticleAsset } from './article';
import type { Asset } from './assets';
import type { CommentAsset } from './comment';
import type { CommentReplyAsset } from './comment_reply';
import type { CommentMonitorTask } from './commentMonitorTask';
import type { DebugAsset } from './debug';
import type { HtmlAsset } from './html';
import type { MpAccount } from './info';
import type { Metadata } from './metadata';
import type { MonitorTask, MonitorWatch } from './monitor';
import type { ResourceAsset } from './resource';
import type { ResourceMapAsset } from './resource-map';
import type { WatchedAccount } from './watchedAccount';

const db = new Dexie('exporter.wxdown.online') as Dexie & {
  article: Table<ArticleAsset, string>;
  asset: EntityTable<Asset, 'url'>;
  comment: EntityTable<CommentAsset, 'url'>;
  comment_reply: Table<CommentReplyAsset, string>;
  debug: EntityTable<DebugAsset, 'url'>;
  html: EntityTable<HtmlAsset, 'url'>;
  info: EntityTable<MpAccount, 'fakeid'>;
  metadata: EntityTable<Metadata, 'url'>;
  /** @deprecated v5 起请使用 watched_account；此表仅保留以备回退查询 */
  monitor_watch: EntityTable<MonitorWatch, 'fakeid'>;
  /** @deprecated v5 起请使用 comment_monitor_task；此表仅保留以备回退查询 */
  monitor_task: EntityTable<MonitorTask, 'id'>;
  watched_account: EntityTable<WatchedAccount, 'fakeid'>;
  comment_monitor_task: EntityTable<CommentMonitorTask, 'id'>;
  resource: EntityTable<ResourceAsset, 'url'>;
  'resource-map': EntityTable<ResourceMapAsset, 'url'>;
};

db.version(1).stores({
  api: '++, name, account, call_time',
  article: ', fakeid, create_time, link', // 主键 fakeid:aid
  asset: 'url',
  comment: 'url',
  comment_reply: ', url, contentID', // 主键 url:contentID
  debug: 'url',
  html: 'url',
  info: 'fakeid',
  metadata: 'url',
  resource: 'url',
  'resource-map': 'url',
});

db.version(2).stores({
  asset: 'url, fakeid',
  comment: 'url, fakeid',
  comment_reply: ', url, contentID, fakeid',
  html: 'url, fakeid',
  metadata: 'url, fakeid',
  resource: 'url, fakeid',
  'resource-map': 'url, fakeid',
});

db.version(3).stores({
  debug: 'url, fakeid',
});

db.version(4).stores({
  monitor_watch: 'fakeid',
  monitor_task: '++id, fakeid, status, created_at',
});

db.version(5)
  .stores({
    watched_account: 'fakeid',
    comment_monitor_task: '++id, fakeid, status, source, created_at',
  })
  .upgrade(async tx => {
    try {
      const oldWatches = await tx.table('monitor_watch').toArray();
      if (oldWatches.length > 0) {
        const migrated = oldWatches.map((w: any) => ({
          fakeid: w.fakeid,
          nickname: w.nickname,
          round_head_img: w.round_head_img,
          enabled: w.enabled ?? true,
          last_check_time: w.last_check_time ?? 0,
          last_known_aid: w.last_known_aid ?? '',
          check_count: w.check_count ?? 0,
          last_discovery_at: 0,
          discovered_count: 0,
        }));
        await tx.table('watched_account').bulkPut(migrated);
        console.info(`[Monitor v5 migration] migrated ${migrated.length} watched accounts`);
      }
    } catch (err) {
      console.error('[Monitor v5 migration] watched_account migration failed:', err);
    }

    try {
      const oldTasks = await tx.table('monitor_task').toArray();
      if (oldTasks.length > 0) {
        const migrated = oldTasks.map((t: any) => ({
          id: t.id,
          fakeid: t.fakeid,
          nickname: t.nickname,
          article_url: t.article_url,
          article_title: t.article_title,
          article_aid: t.article_aid,
          comment_id: t.comment_id ?? '',
          status: t.status,
          created_at: t.created_at,
          tracking_end_at: t.tracking_end_at,
          accumulated_comments: t.accumulated_comments ?? [],
          final_comments: t.final_comments ?? [],
          shielded_comments: t.shielded_comments ?? [],
          stats: t.stats ?? {},
          error_msg: t.error_msg ?? '',
          auto_track_enabled: t.auto_track_enabled ?? true,
          source: 'auto' as const,
          source_fakeid: t.fakeid,
          last_sync_at: t.created_at,
        }));
        await tx.table('comment_monitor_task').bulkPut(migrated);
        console.info(`[Monitor v5 migration] migrated ${migrated.length} comment monitor tasks`);
      }
    } catch (err) {
      console.error('[Monitor v5 migration] comment_monitor_task migration failed:', err);
    }
  });

// 评论监控曾在每轮同步时用 Date.now() 生成 aid，主键 `${fakeid}:${aid}` 每次都不同，
// 同一篇文章被反复插入。这里按 fakeid + link 归组，一次性清掉多余的行。
db.version(6).upgrade(async tx => {
  try {
    const table = tx.table('article');
    const groups = new Map<string, { key: string; article: any }[]>();

    await table.toCollection().each((article: any, cursor) => {
      if (!article?.link) return;
      const groupKey = `${article.fakeid}\u0000${article.link}`;
      const list = groups.get(groupKey);
      const entry = { key: cursor.primaryKey as string, article };
      if (list) list.push(entry);
      else groups.set(groupKey, [entry]);
    });

    const staleKeys: string[] = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => {
        // 优先保留正常同步进来的文章，其次保留最早写入的那条
        const singleDiff = Number(!!a.article._single) - Number(!!b.article._single);
        if (singleDiff !== 0) return singleDiff;
        return (a.article.update_time ?? 0) - (b.article.update_time ?? 0);
      });
      for (const entry of list.slice(1)) {
        staleKeys.push(entry.key);
      }
    }

    if (staleKeys.length > 0) {
      await table.bulkDelete(staleKeys);
      console.info(`[Article v6 migration] removed ${staleKeys.length} duplicated article records`);
    }
  } catch (err) {
    console.error('[Article v6 migration] dedupe failed:', err);
  }
});

// 承接 v6：跨 link 清理评论监控留下的占位记录。
// 微信真实的 mid 是 10 位，早期代码在 URL 缺 mid 时拿 13 位的 Date.now() 顶替，
// 于是占位记录用短链、正常同步用长链，v6 的 fakeid+link 归组匹配不上。
// 只有当同标题下已经存在正常同步来的文章时才删，避免误伤「只下载过单篇、从未同步过公众号」的记录。
db.version(7).upgrade(async tx => {
  const FAKE_APPMSGID_MIN = 1e12;
  const SINGLE_ARTICLE_FAKEID = 'SINGLE_ARTICLE_FAKEID';

  // aid 与 appmsgid 都可能残留时间戳，任一命中即视为占位记录
  const isPlaceholder = (article: any) =>
    (article.appmsgid ?? 0) >= FAKE_APPMSGID_MIN ||
    Number(String(article.aid ?? '').split('_')[0]) >= FAKE_APPMSGID_MIN;

  try {
    const table = tx.table('article');
    const entries: { key: string; article: any }[] = [];
    await table.toCollection().each((article: any, cursor) => {
      if (article?.title) entries.push({ key: cursor.primaryKey as string, article });
    });

    const realFakeidsByTitle = new Map<string, Set<string>>();
    for (const { article } of entries) {
      if (isPlaceholder(article)) continue;
      const fakeids = realFakeidsByTitle.get(article.title);
      if (fakeids) fakeids.add(article.fakeid);
      else realFakeidsByTitle.set(article.title, new Set([article.fakeid]));
    }

    const staleKeys: string[] = [];
    for (const { key, article } of entries) {
      if (!isPlaceholder(article)) continue;
      const fakeids = realFakeidsByTitle.get(article.title);
      if (!fakeids) continue;
      if (article.fakeid === SINGLE_ARTICLE_FAKEID || fakeids.has(article.fakeid)) {
        staleKeys.push(key);
      }
    }

    if (staleKeys.length > 0) {
      await table.bulkDelete(staleKeys);
      console.info(`[Article v7 migration] removed ${staleKeys.length} placeholder article records`);
    }
  } catch (err) {
    console.error('[Article v7 migration] cleanup failed:', err);
  }
});

export { db };
