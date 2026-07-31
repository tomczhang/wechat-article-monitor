import { v4 as uuidv4 } from 'uuid';
import { isDev, USER_AGENT } from '~/config';
import { RequestOptions } from '~/server/types';
import { logRequest, logResponse } from '~/server/utils/logger';

/**
 * 代理微信公众号请求
 * @description 凭证（cookie / token 等）由调用方通过 `options.cookie` 或 query/body 参数显式传入。
 * @param options 请求参数
 */
export async function proxyMpRequest(options: RequestOptions) {
  const headers = new Headers({
    Referer: 'https://mp.weixin.qq.com/',
    Origin: 'https://mp.weixin.qq.com',
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'identity', // 禁用压缩，避免出现response.clone() bug
  });

  if (options.cookie) {
    headers.set('Cookie', options.cookie);
  }

  const requestInit: RequestInit = {
    method: options.method,
    headers: headers,
    redirect: options.redirect || 'follow',
  };

  // 处理参数
  if (options.query) {
    options.endpoint += '?' + new URLSearchParams(options.query as Record<string, string>).toString();
  }
  if (options.method === 'POST' && options.body) {
    requestInit.body = new URLSearchParams(options.body as Record<string, string>).toString();
  }

  // 构造请求
  const request = new Request(options.endpoint, requestInit);

  // 记录请求报文
  const requestId = uuidv4().replace(/-/g, '');
  if (process.env.NUXT_DEBUG_MP_REQUEST && isDev) {
    await logRequest(requestId, request.clone());
  }

  // 转发请求
  const mpResponse = await fetch(request);

  // 记录响应报文
  if (process.env.NUXT_DEBUG_MP_REQUEST && isDev) {
    await logResponse(requestId, mpResponse.clone());
  }

  // 构造返回给客户端的响应（不透传微信的 set-cookie）
  const responseHeaders = new Headers(mpResponse.headers);
  responseHeaders.delete('set-cookie');

  const finalResponse = new Response(mpResponse.body, {
    status: mpResponse.status,
    statusText: mpResponse.statusText,
    headers: responseHeaders,
  });

  if (!options.parseJson) {
    return finalResponse;
  } else {
    return finalResponse.json();
  }
}
