import { request } from '#shared/utils/request';
import { updateArticleCache } from '~/store/v2/article';
import { type MpAccount, updateLastUpdateTime } from '~/store/v2/info';
import type { CommentResponse } from '~/types/comment';
import type { ProfileGetMsgResponse } from '~/types/profile_getmsg';
import type { AppMsgEx } from '~/types/types';
import { findValidCredential } from '~/utils/credentials';
import { convertProfileGetMsgResponse, parseProfileGetMsgList } from '~/utils/profile-getmsg';

export class CredentialRequiredError extends Error {
  constructor(reason?: string) {
    const detail = reason ? `（${reason}）` : '';
    super(
      `历史文章同步必须使用有效的 Credentials，当前未检测到或已失效${detail}。请按右侧面板提示设置代理，然后在微信客户端内打开该公众号任意一篇文章，获取成功后再重试。`
    );
    this.name = 'CredentialRequiredError';
  }
}

/**
 * 获取文章列表
 * @param account
 * @param begin
 * @param keyword
 * @return [文章列表, 是否加载完毕, 文章总数, 下一页偏移]
 */
export async function getArticleList(
  account: MpAccount,
  begin = 0,
  keyword = ''
): Promise<[AppMsgEx[], boolean, number, number]> {
  const credential = findValidCredential(account.fakeid);
  if (!credential) {
    throw new CredentialRequiredError();
  }

  if (keyword) {
    throw new Error('Credentials 历史文章接口暂不支持关键词搜索');
  }

  const resp = await request<ProfileGetMsgResponse>('/api/web/mp/profile_ext_getmsg', {
    method: 'POST',
    body: {
      id: account.fakeid,
      begin,
      size: 10,
      uin: credential.uin,
      key: credential.key,
      pass_ticket: credential.pass_ticket,
      appmsg_token: credential.appmsg_token,
      wap_sid2: credential.wap_sid2,
      cookie: credential.cookie,
    },
  });

  if (resp.ret !== 0) {
    throw new CredentialRequiredError(`${resp.ret}:${resp.errmsg || 'Credentials 已失效'}`);
  }

  const { articles, completed, nextBegin, publishPage } = convertProfileGetMsgResponse(
    resp,
    begin,
    account.total_count
  );
  await updateArticleCache(account, publishPage, completed);

  if (begin === 0) {
    await updateLastUpdateTime(account.fakeid);
  }

  return [articles, completed, publishPage.total_count, nextBegin];
}

/**
 * 获取评论
 * @param commentId
 */
export async function getComment(commentId: string) {
  try {
    // 本地设置的 credentials
    const credentials = JSON.parse(window.localStorage.getItem('credentials')!);
    if (!credentials || !credentials.__biz || !credentials.pass_ticket || !credentials.key || !credentials.uin) {
      console.warn('credentials not set');
      return null;
    }
    const response = await request<CommentResponse>('/api/web/misc/comment', {
      query: {
        comment_id: commentId,
        ...credentials,
      },
    });
    if (response.base_resp.ret === 0) {
      return response;
    } else {
      return null;
    }
  } catch (e) {
    console.warn('credentials parse error', e);
    return null;
  }
}

/**
 * 获取公众号文章列表
 * @description 该接口采用微信接口，而非公众号平台接口，因此需要先获取 Credentials
 * @param fakeid
 * @param begin
 */
export async function getArticleListWithCredential(fakeid: string, begin = 0) {
  const targetCredential = findValidCredential(fakeid);
  if (!targetCredential) {
    throw new CredentialRequiredError();
  }

  const resp = await request<ProfileGetMsgResponse>('/api/web/mp/profile_ext_getmsg', {
    method: 'POST',
    body: {
      id: fakeid,
      begin,
      size: 10,
      uin: targetCredential.uin,
      key: targetCredential.key,
      pass_ticket: targetCredential.pass_ticket,
      appmsg_token: targetCredential.appmsg_token,
      wap_sid2: targetCredential.wap_sid2,
      cookie: targetCredential.cookie,
    },
  });
  if (resp.ret === 0) {
    return parseProfileGetMsgList(resp.general_msg_list);
  } else {
    throw new CredentialRequiredError(`${resp.ret}:${resp.errmsg || 'Credentials 已失效'}`);
  }
}
