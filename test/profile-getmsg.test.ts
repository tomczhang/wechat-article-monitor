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
