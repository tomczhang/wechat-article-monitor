import type { AppMsgExWithFakeID, PublishInfo, PublishPage } from '~/types/types';
import { db } from './db';
import { type MpAccount, updateInfoCache } from './info';

export type ArticleAsset = AppMsgExWithFakeID;

/**
 * 更新文章缓存
 * @param account
 * @param publish_page
 */
export async function updateArticleCache(account: MpAccount, publish_page: PublishPage, completed?: boolean) {
  await db.transaction('rw', ['article', 'info'], async () => {
    const keys = await db.article.toCollection().keys();

    const fakeid = account.fakeid;
    const total_count = publish_page.total_count;
    const publish_list = publish_page.publish_list.filter(item => !!item.publish_info);

    // 统计本次缓存成功新增的数量
    let msgCount = 0;
    let articleCount = 0;

    for (const item of publish_list) {
      const publish_info: PublishInfo = JSON.parse(item.publish_info);
      let newEntryCount = 0;

      for (const article of publish_info.appmsgex) {
        const key = await db.article.put({ ...article, fakeid, _status: '' }, `${fakeid}:${article.aid}`);
        if (!keys.includes(key)) {
          newEntryCount++;
          articleCount++;
        }
      }

      if (newEntryCount > 0) {
        // 新增成功
        msgCount++;
      }
    }

    await updateInfoCache({
      fakeid: fakeid,
      completed: completed ?? publish_list.length === 0,
      count: msgCount,
      articles: articleCount,
      nickname: account.nickname,
      round_head_img: account.round_head_img,
      total_count: total_count,
    });
  });
}

/**
 * 检查是否存在指定时间之前的缓存
 * @param fakeid 公众号id
 * @param create_time 创建时间
 */
export async function hitCache(fakeid: string, create_time: number): Promise<boolean> {
  const count = await db.article
    .where('fakeid')
    .equals(fakeid)
    .and(article => article.create_time < create_time)
    .count();
  return count > 0;
}

/**
 * 读取缓存中的指定时间之前的历史文章
 * @param fakeid 公众号id
 * @param create_time 创建时间
 */
export async function getArticleCache(fakeid: string, create_time: number): Promise<AppMsgExWithFakeID[]> {
  return db.article
    .where('fakeid')
    .equals(fakeid)
    .and(article => article.create_time < create_time)
    .reverse()
    .sortBy('create_time');
}

/**
 * 根据 url 获取文章对象
 * @param url
 */
export async function getArticleByLink(url: string): Promise<AppMsgExWithFakeID> {
  const article = await db.article.where('link').equals(url).first();
  if (!article) {
    throw new Error(`Article(${url}) does not exist`);
  }
  return article;
}

// 根据 url 获取 SINGLE_ARTICLE_FAKEID 文章对象
export async function getSingleArticleByLink(url: string): Promise<AppMsgExWithFakeID> {
  const article = await db.article
    .where('link')
    .equals(url)
    .and(article => article.fakeid === 'SINGLE_ARTICLE_FAKEID')
    .first();
  if (!article) {
    throw new Error(`Article(${url}) does not exist`);
  }

  return article;
}

/**
 * 文章被删除
 * @param url
 * @param is_deleted
 */
export async function articleDeleted(url: string, is_deleted = true): Promise<void> {
  await db.transaction('rw', 'article', async () => {
    await db.article
      .where('link')
      .equals(url)
      .modify(article => {
        article.is_deleted = is_deleted;
      });
  });
}

/**
 * 更新文章状态
 * @param url
 * @param status
 */
export async function updateArticleStatus(url: string, status: string): Promise<void> {
  await db.transaction('rw', 'article', async () => {
    await db.article
      .where('link')
      .equals(url)
      .modify(article => {
        article._status = status;
      });
  });
}

/**
 * 按 link 更新文章，并在 fakeid / aid 变化时重建主键。
 *
 * article 表的主键是 out-of-line 的 `${fakeid}:${aid}`，Dexie 的 modify 只能改字段、
 * 改不了主键。若直接用 modify 改这两个字段，主键会与数据脱节，下一次 put 就会被当成
 * 新记录写进去，从而产生重复行。
 * @param url
 * @param mutate 就地修改文章对象
 * @param filter 只处理满足条件的记录
 */
export async function rekeyArticleByLink(
  url: string,
  mutate: (article: AppMsgExWithFakeID) => void,
  filter?: (article: AppMsgExWithFakeID) => boolean
): Promise<void> {
  await db.transaction('rw', 'article', async () => {
    const keys = (await db.article.where('link').equals(url).primaryKeys()) as string[];
    for (const key of keys) {
      const article = await db.article.get(key);
      if (!article || (filter && !filter(article))) continue;

      mutate(article);
      const nextKey = `${article.fakeid}:${article.aid}`;
      if (nextKey === key) {
        await db.article.put(article, key);
        continue;
      }

      // 新主键已被占用，说明这篇文章已经通过正常同步入库了（当前这条只是占位记录）。
      // 保留信息更完整的那条，丢掉占位记录，不要反向覆盖。
      const occupied = await db.article.get(nextKey);
      await db.article.delete(key);
      if (!occupied) {
        await db.article.put(article, nextKey);
      }
    }
  });
}

/**
 * 更新文章的fakeid
 * @param url
 * @param fakeid
 */
export async function updateArticleFakeid(url: string, fakeid: string): Promise<void> {
  await rekeyArticleByLink(
    url,
    article => {
      article.fakeid = fakeid;

      // 标记改数据是【单篇文章下载】添加的
      article._single = true;
    },
    article => article.fakeid === 'SINGLE_ARTICLE_FAKEID'
  );
}
