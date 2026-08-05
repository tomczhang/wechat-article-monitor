import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArticleItem } from '../types/album.d.ts';
import type { AppMsgAlbumInfo } from '../types/types.d.ts';
import {
  buildAlbumArticleStub,
  collectCompleteAlbum,
  selectMissingAlbumArticleStubs,
} from '../utils/album-articles.ts';

const album: AppMsgAlbumInfo = {
  album_id: 23,
  id: 'album-23',
  tagSource: 1,
  title: '测试合集',
};

function article(msgid: string, itemidx: string, url: string, overrides: Partial<ArticleItem> = {}): ArticleItem {
  return {
    cover_img_1_1: 'https://example.com/cover.jpg',
    create_time: '1754352000',
    is_pay_subscribe: '0',
    is_read: '1',
    item_show_type: '0',
    itemidx,
    key: `${msgid}_${itemidx}`,
    msgid,
    title: `文章 ${msgid}-${itemidx}`,
    tts_is_ban: '0',
    url,
    user_read_status: '0',
    ...overrides,
  };
}

test('buildAlbumArticleStub creates a stable downloader-compatible article', () => {
  const result = buildAlbumArticleStub(
    'biz-a',
    album,
    article('100', '2', 'https://mp.weixin.qq.com/s/a', { is_pay_subscribe: '1' })
  );

  assert.equal(result.fakeid, 'biz-a');
  assert.equal(result.aid, '100_2');
  assert.equal(result.appmsgid, 100);
  assert.equal(result.itemidx, 2);
  assert.equal(result.link, 'https://mp.weixin.qq.com/s/a');
  assert.equal(result.create_time, 1754352000);
  assert.equal(result.is_pay_subscribe, 1);
  assert.equal(result.cover, 'https://example.com/cover.jpg');
  assert.deepEqual(result.appmsg_album_infos, [album]);
});

test('selectMissingAlbumArticleStubs does not replace an existing article URL', () => {
  const result = selectMissingAlbumArticleStubs(new Set(['https://mp.weixin.qq.com/s/existing']), 'biz-a', album, [
    article('100', '1', 'https://mp.weixin.qq.com/s/existing'),
    article('101', '1', 'https://mp.weixin.qq.com/s/new'),
    article('102', '1', 'https://mp.weixin.qq.com/s/new'),
  ]);

  assert.deepEqual(
    result.map(item => item.link),
    ['https://mp.weixin.qq.com/s/new']
  );
});

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
  assert.deepEqual(
    result.map(item => item.url),
    ['/a', '/b']
  );
});

test('collectCompleteAlbum follows the last unique article cursor across pages', async () => {
  const cursors: string[] = [];
  const pages = [
    { items: [article('2', '1', '/b')], hasMore: true },
    { items: [article('3', '2', '/c')], hasMore: false },
  ];

  const result = await collectCompleteAlbum([article('1', '1', '/a')], true, async cursor => {
    cursors.push(`${cursor.msgid}:${cursor.itemidx}`);
    return pages.shift()!;
  });

  assert.deepEqual(cursors, ['1:1', '2:1']);
  assert.deepEqual(
    result.map(item => item.url),
    ['/a', '/b', '/c']
  );
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
