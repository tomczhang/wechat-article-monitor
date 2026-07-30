/**
 * 使用微信客户端文章页 Credentials 获取公众号历史文章列表。
 */

import { proxyMpRequest } from '~/server/utils/proxy-request';

interface ProfileGetMsgBody {
  begin?: number;
  size?: number;
  id: string;
  uin: string;
  key: string;
  pass_ticket: string;
  appmsg_token?: string;
  wap_sid2?: string;
  cookie?: string;
}

function sanitizeCookie(cookie: string): string {
  return cookie.replace(/[\r\n]/g, '').trim();
}

export default defineEventHandler(async event => {
  const body = await readBody<ProfileGetMsgBody>(event);
  if (!body?.id || !body.uin || !body.key || !body.pass_ticket) {
    return { ret: -1, errmsg: '缺少公众号 Credentials' };
  }

  const begin = Number(body.begin) || 0;
  const size = Number(body.size) || 10;
  const params: Record<string, string | number> = {
    action: 'getmsg',
    __biz: body.id,
    offset: begin,
    count: size,
    uin: body.uin,
    key: body.key,
    pass_ticket: body.pass_ticket,
    appmsg_token: body.appmsg_token || '',
    wxtoken: '',
    f: 'json',
    is_ok: '1',
    scene: '124',
    x5: '0',
  };

  const cookie = sanitizeCookie(body.cookie || (body.wap_sid2 ? `wap_sid2=${body.wap_sid2}` : ''));

  return proxyMpRequest({
    event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/mp/profile_ext',
    query: params,
    cookie: cookie || undefined,
    parseJson: true,
  }).catch(error => {
    console.error('[profile_ext_getmsg] request failed:', error);
    return { ret: -1, errmsg: '获取公众号历史文章失败，请重新抓取 Credentials 后重试' };
  });
});
