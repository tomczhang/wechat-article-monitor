import { rekeyArticleByLink, updateArticleFakeid } from '~/store/v2/article';
import { getCommentCache } from '~/store/v2/comment';
import { type CommentMonitorTask, updateCommentMonitorTask } from '~/store/v2/commentMonitorTask';
import { db } from '~/store/v2/db';
import { getHtmlCache } from '~/store/v2/html';
import type { Comment } from '~/types/comment';
import type { AppMsgExWithFakeID } from '~/types/types';
import { extractArticleMeta } from '~/utils/comment';
import { Downloader } from '~/utils/download/Downloader';

const SINGLE_ARTICLE_FAKEID = 'SINGLE_ARTICLE_FAKEID';

/**
 * 短链（https://mp.weixin.qq.com/s/XXXX）不带 mid/idx，这里从 URL 派生一个稳定 id。
 * 用 Date.now() 的话每轮同步都会算出不同的主键，同一篇文章会被反复插入。
 */
function fallbackAppmsgid(parsed: URL): number {
  const seed = `${parsed.pathname}${parsed.search}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

export function parseArticleUrlMeta(articleUrl: string) {
  const parsed = new URL(articleUrl);
  const params = parsed.searchParams;
  const fakeid = params.get('__biz') || SINGLE_ARTICLE_FAKEID;
  const mid = params.get('mid') || params.get('appmsgid') || `${fallbackAppmsgid(parsed)}`;
  const idx = params.get('idx') || params.get('itemidx') || '1';
  const itemidx = Number(idx) || 1;
  return {
    fakeid,
    appmsgid: Number(mid),
    itemidx,
    aid: `${mid}_${itemidx}`,
  };
}

function buildMonitorArticleStub(task: CommentMonitorTask): AppMsgExWithFakeID {
  const { fakeid, appmsgid, itemidx, aid } = parseArticleUrlMeta(task.article_url);
  const resolvedFakeid = task.fakeid || fakeid;
  return {
    fakeid: resolvedFakeid,
    _status: '',
    aid,
    album_id: '',
    appmsg_album_infos: [],
    appmsgid,
    author_name: '',
    ban_flag: 0,
    checking: 0,
    copyright_stat: 0,
    copyright_type: 0,
    cover: '',
    cover_img: '',
    cover_img_theme_color: undefined,
    create_time: Math.floor(task.created_at / 1000),
    digest: '',
    has_red_packet_cover: 0,
    is_deleted: false,
    is_pay_subscribe: 0,
    item_show_type: 0,
    itemidx,
    link: task.article_url,
    media_duration: '0:00',
    mediaapi_publish_status: 0,
    pic_cdn_url_1_1: '',
    pic_cdn_url_3_4: '',
    pic_cdn_url_16_9: '',
    pic_cdn_url_235_1: '',
    title: task.article_title || '未命名文章',
    update_time: Math.floor(task.created_at / 1000),
    wecoin_count: 0,
    _single: true,
  };
}

export async function ensureMonitorTaskArticleStub(task: CommentMonitorTask) {
  // 已存在就只补标题：此时记录的主键可能已被回填成真实 mid/idx，
  // 再按 URL 重算主键 put 一次会插出一条新的重复文章。
  const existing = await db.article.where('link').equals(task.article_url).first();
  if (existing) {
    const title = task.article_title || existing.title;
    if (title !== existing.title) {
      await db.article.where('link').equals(task.article_url).modify({ title });
    }
    return;
  }

  const article = buildMonitorArticleStub(task);
  await db.article.put(article, `${article.fakeid}:${article.aid}`);
}

export interface SyncTaskCommentsResult {
  task: CommentMonitorTask;
  latestComments: Comment[];
  mergedComments: Comment[];
}

export async function syncMonitorTaskComments(task: CommentMonitorTask): Promise<SyncTaskCommentsResult> {
  await ensureMonitorTaskArticleStub(task);

  const updatedTask: CommentMonitorTask = {
    ...task,
    accumulated_comments: [...(task.accumulated_comments ?? [])],
  };

  if (updatedTask.fakeid === SINGLE_ARTICLE_FAKEID) {
    let fixedFakeid = '';
    const fakeidDownloader = new Downloader([updatedTask.article_url], { maxRetries: 1 });
    fakeidDownloader.on('fix:fakeid', (_url: string, fakeid: string) => {
      fixedFakeid = fakeid;
    });

    try {
      await fakeidDownloader.startDownload('fakeid');
    } finally {
      fakeidDownloader.removeAllListeners();
    }

    if (!fixedFakeid) {
      throw new Error('未能修复文章 fakeid');
    }

    await updateArticleFakeid(updatedTask.article_url, fixedFakeid);
    updatedTask.fakeid = fixedFakeid;
    if (updatedTask.id) {
      await updateCommentMonitorTask(updatedTask.id, { fakeid: fixedFakeid });
    }
  }

  const htmlDownloader = new Downloader([updatedTask.article_url], { maxRetries: 1 });
  try {
    await htmlDownloader.startDownload('html');
  } finally {
    htmlDownloader.removeAllListeners();
  }

  const htmlCache = await getHtmlCache(updatedTask.article_url);
  const commentId = htmlCache?.commentID || '';
  if (!commentId) {
    throw new Error('文章内容已抓到，但没有提取到 comment_id');
  }

  if (updatedTask.comment_id !== commentId) {
    updatedTask.comment_id = commentId;
    if (updatedTask.id) {
      await updateCommentMonitorTask(updatedTask.id, { comment_id: commentId });
    }
  }

  // 关键修复：从 HTML 中提取真实的 biz/mid/idx，回填 db.article stub。
  // 用户粘贴 https://mp.weixin.qq.com/s/XXXXX 这种短链时，URL 不含
  // __biz/mid/idx，parseArticleUrlMeta 会把 appmsgid 退化为 Date.now()，
  // 直接走 appmsg_comment 接口必然返回 ret=-1。
  if (htmlCache?.file) {
    try {
      const htmlText = await htmlCache.file.text();
      const meta = extractArticleMeta(htmlText);
      const realAppmsgid = meta.mid ? Number(meta.mid) : null;
      const realItemidx = meta.idx ? Number(meta.idx) : null;

      const stub = await db.article.where('link').equals(updatedTask.article_url).first();
      if (stub) {
        const patch: Partial<AppMsgExWithFakeID> = {};
        if (realAppmsgid && realAppmsgid !== stub.appmsgid) {
          patch.appmsgid = realAppmsgid;
        }
        if (realItemidx && realItemidx !== stub.itemidx) {
          patch.itemidx = realItemidx;
        }
        if (realAppmsgid && realItemidx) {
          const realAid = `${realAppmsgid}_${realItemidx}`;
          if (realAid !== stub.aid) {
            patch.aid = realAid;
          }
        }
        if (Object.keys(patch).length > 0) {
          await rekeyArticleByLink(updatedTask.article_url, article => {
            Object.assign(article, patch);
          });
        }

        if (patch.aid && patch.aid !== updatedTask.article_aid) {
          updatedTask.article_aid = patch.aid;
          if (updatedTask.id) {
            await updateCommentMonitorTask(updatedTask.id, { article_aid: patch.aid });
          }
        }
      }
    } catch (err) {
      console.warn('[task-sync] extractArticleMeta failed:', err);
    }
  }

  const commentDownloader = new Downloader([updatedTask.article_url], { maxRetries: 1 });
  let lastError: string = '';
  commentDownloader.on('download:error', (_url: string, _attempt: number, error: any) => {
    lastError = error?.message || String(error);
  });
  try {
    await commentDownloader.startDownload('comments');
  } catch (e) {
    throw new Error(`留言抓取失败：${(e as Error).message}`);
  } finally {
    commentDownloader.removeAllListeners();
  }

  const commentStatus = commentDownloader.getStatus();
  if (commentStatus.failed.includes(updatedTask.article_url)) {
    throw new Error(`留言抓取失败：${lastError || '请检查 Credential 是否有效或稍后重试'}`);
  }

  const commentCache = await getCommentCache(updatedTask.article_url);
  if (!commentCache) {
    throw new Error('留言抓取异常：接口未返回错误但数据未写入缓存');
  }

  const responseList = Array.isArray(commentCache.data) ? commentCache.data : [commentCache.data];
  const latestComments = responseList.flatMap((response: any) => response?.elected_comment ?? []);
  const existing = updatedTask.accumulated_comments ?? [];
  const existingIds = new Set(existing.map(comment => comment.content_id));
  const mergedComments = [...existing];

  for (const comment of latestComments) {
    if (!existingIds.has(comment.content_id)) {
      mergedComments.push(comment);
      existingIds.add(comment.content_id);
    }
  }

  const syncedAt = Date.now();

  // 维护 first_seen_at / shielded_at：每 30s 同步窗口为一个节点。
  // - 本轮出现的评论：若未记录 first_seen_at 则补上；若曾被标记 shielded（说明又活回来）则清除。
  // - 历史累积但本轮缺席的评论：若未记录 shielded_at 则记为本次同步时刻。
  const firstSeenAt: Record<string, number> = { ...(updatedTask.comment_first_seen_at ?? {}) };
  const shieldedAt: Record<string, number> = { ...(updatedTask.comment_shielded_at ?? {}) };
  const latestIds = new Set(latestComments.map(c => c.content_id));

  for (const comment of latestComments) {
    if (firstSeenAt[comment.content_id] === undefined) {
      firstSeenAt[comment.content_id] = syncedAt;
    }
    if (shieldedAt[comment.content_id] !== undefined) {
      delete shieldedAt[comment.content_id];
    }
  }

  for (const comment of mergedComments) {
    if (!latestIds.has(comment.content_id) && shieldedAt[comment.content_id] === undefined) {
      shieldedAt[comment.content_id] = syncedAt;
    }
  }

  updatedTask.accumulated_comments = mergedComments;
  updatedTask.last_sync_at = syncedAt;
  updatedTask.comment_first_seen_at = firstSeenAt;
  updatedTask.comment_shielded_at = shieldedAt;
  if (updatedTask.id) {
    await updateCommentMonitorTask(updatedTask.id, {
      accumulated_comments: mergedComments,
      last_sync_at: syncedAt,
      comment_first_seen_at: firstSeenAt,
      comment_shielded_at: shieldedAt,
    });
  }

  return {
    task: updatedTask,
    latestComments,
    mergedComments,
  };
}
