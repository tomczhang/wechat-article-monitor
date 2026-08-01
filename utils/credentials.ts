import { CREDENTIAL_LIVE_MINUTES } from '~/config';
import type { ParsedCredential } from '~/types/credential';

const STORAGE_KEY = 'auto-detect-credentials:credentials';

/**
 * 实时读取 credentials，并按 CREDENTIAL_LIVE_MINUTES 重新计算 valid 字段。
 *
 * 用于下载/校验场景：避免依赖跨模块的 useLocalStorage 响应式同步
 * （多个模块各自创建 ref，WebSocket 写入后无法保证其它模块即时拿到新值），
 * 也避免使用持久化时落盘的 valid 已过期但未刷新。
 */
export function getCurrentCredentials(): ParsedCredential[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  let parsed: ParsedCredential[];
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const now = Date.now();
  const ttl = 1000 * 60 * CREDENTIAL_LIVE_MINUTES;
  return parsed.map(item => ({
    ...item,
    valid: now < item.timestamp + ttl,
  }));
}

/**
 * 查找指定公众号当前有效的 credential。
 */
export function findValidCredential(fakeid: string): ParsedCredential | undefined {
  return getCurrentCredentials().find(item => item.biz === fakeid && item.valid);
}

export class CredentialRequiredError extends Error {
  readonly fakeid: string;

  constructor(fakeid: string, reason?: string) {
    const detail = reason ? `（${reason}）` : '';
    super(
      `公众号 ${fakeid} 当前没有有效 Credential${detail}。请在初始化窗口确认抓包链路，然后在微信中打开该公众号任意一篇文章。`
    );
    this.name = 'CredentialRequiredError';
    this.fakeid = fakeid;
  }
}

export function notifyCredentialRequired(fakeid: string, reason?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('credential-required', {
      detail: { fakeid, reason },
    })
  );
}

export function throwCredentialRequired(fakeid: string, reason?: string): never {
  notifyCredentialRequired(fakeid, reason);
  throw new CredentialRequiredError(fakeid, reason);
}

export function requireValidCredential(fakeid: string): ParsedCredential {
  const credential = findValidCredential(fakeid);
  if (!credential) throwCredentialRequired(fakeid);
  return credential;
}
