import type { ArticleItem } from '../types/album.d.ts';
import type { AppMsgAlbumInfo, AppMsgExWithFakeID } from '../types/types.d.ts';

export interface AlbumCursor {
  msgid: string;
  itemidx: string;
}

export interface AlbumPage {
  items: ArticleItem[];
  hasMore: boolean;
}

function toNumber(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function appendUniqueArticles(target: ArticleItem[], seenUrls: Set<string>, items: ArticleItem[]): void {
  for (const item of items) {
    if (!item.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    target.push(item);
  }
}

export function buildAlbumArticleStub(fakeid: string, album: AppMsgAlbumInfo, item: ArticleItem): AppMsgExWithFakeID {
  const cover = item.cover_img_1_1 || '';
  const createTime = toNumber(item.create_time);
  const appmsgid = toNumber(item.msgid);
  const itemidx = toNumber(item.itemidx);

  return {
    fakeid,
    _status: '',
    aid: `${item.msgid}_${item.itemidx}`,
    album_id: album.id,
    appmsg_album_infos: [album],
    appmsgid,
    author_name: '',
    ban_flag: 0,
    checking: 0,
    copyright_stat: 0,
    copyright_type: 0,
    cover,
    cover_img: cover,
    cover_img_theme_color: item.cover_theme_color,
    create_time: createTime,
    digest: '',
    has_red_packet_cover: 0,
    is_deleted: false,
    is_pay_subscribe: toNumber(item.is_pay_subscribe),
    wecoin_count: 0,
    item_show_type: toNumber(item.item_show_type),
    itemidx,
    link: item.url,
    media_duration: '0:00',
    mediaapi_publish_status: 0,
    pic_cdn_url_1_1: cover,
    pic_cdn_url_3_4: cover,
    pic_cdn_url_16_9: cover,
    pic_cdn_url_235_1: cover,
    title: item.title,
    update_time: createTime,
  };
}

export function selectMissingAlbumArticleStubs(
  existingUrls: ReadonlySet<string>,
  fakeid: string,
  album: AppMsgAlbumInfo,
  items: ArticleItem[],
  existingKeys: ReadonlySet<string> = new Set()
): AppMsgExWithFakeID[] {
  const seenUrls = new Set(existingUrls);
  const seenKeys = new Set(existingKeys);
  const missing: AppMsgExWithFakeID[] = [];

  for (const item of items) {
    if (!item.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    const stub = buildAlbumArticleStub(fakeid, album, item);
    const key = `${stub.fakeid}:${stub.aid}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    missing.push(stub);
  }

  return missing;
}

export async function collectCompleteAlbum(
  initialItems: ArticleItem[],
  initialHasMore: boolean,
  loadNext: (cursor: AlbumCursor) => Promise<AlbumPage>
): Promise<ArticleItem[]> {
  const articles: ArticleItem[] = [];
  const seenUrls = new Set<string>();
  appendUniqueArticles(articles, seenUrls, initialItems);

  let hasMore = initialHasMore;
  while (hasMore) {
    const lastArticle = articles.at(-1);
    if (!lastArticle) throw new Error('合集缺少可用的分页游标');

    const page = await loadNext({ msgid: lastArticle.msgid, itemidx: lastArticle.itemidx });
    const previousCount = articles.length;
    appendUniqueArticles(articles, seenUrls, page.items);

    if (page.hasMore && articles.length === previousCount) {
      throw new Error('合集分页未取得新文章，已停止加载');
    }
    hasMore = page.hasMore;
  }

  return articles;
}
