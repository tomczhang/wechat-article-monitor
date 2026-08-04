/**
 * Credential 抓包能力 facade。
 *
 * 将 Credential 抓取与账号落地逻辑集中为模块级单例：
 * - 通过 WebSocket (`/api/credential/ws`) 接收 mitmproxy 抓取的凭证并解析、落地到 localStorage
 * - 轮询抓包服务状态 (`/api/credential/status`)
 * - 将 Credential 与公众号缓存合并，并为首次出现的公众号自动同步最新一页
 *
 * 自登录机制移除后，本 composable 是获取「可用公众号」的唯一来源。
 */
import dayjs from 'dayjs';
import { getArticleList } from '~/apis';
import { CREDENTIAL_LIVE_MINUTES } from '~/config';
import { getAllInfo, type MpAccount } from '~/store/v2/info';
import type { ParsedCredential } from '~/types/credential';
import { createAsyncMutex, createCoalescedSerialRunner, runCredentialInitialSyncAttempt } from '~/utils/account-sync';
import {
  buildCredentialAccounts,
  createCredentialAccountSeed,
  mergeCredentialHistory,
  shouldAutoSyncCredential,
} from '~/utils/credential-accounts';

export interface CredentialServiceStatus {
  running: boolean;
  proxyAddress: string | null;
  port: number;
  upstreamProxy?: string | null;
  credentialCount?: number;
  systemProxy?: {
    supported: boolean;
    managed: boolean;
    consent: boolean;
    networkService: string | null;
    upstreamProxy: string | null;
    mitmProxy: string;
    confirmationToken: string | null;
    error: string | null;
  };
}

interface CredentialRaw {
  biz?: string;
  name?: string;
  avatar?: string;
  url: string;
  set_cookie: string;
  timestamp: number;
}

const STORAGE_KEY = 'auto-detect-credentials:credentials';

// —— 模块级单例状态 ——
const credentials = useLocalStorage<ParsedCredential[]>(STORAGE_KEY, []);
const wsConnected = ref(false);
const serviceStatus = ref<CredentialServiceStatus>({
  running: false,
  proxyAddress: null,
  port: 65000,
});
const statusReady = ref(false);
const statusError = ref<string | null>(null);
const accountInfos = ref<MpAccount[]>([]);
const autoSyncingBiz = ref<string | null>(null);
const autoSyncErrors = ref<Record<string, string>>({});
const activeAccountOperation = ref<{ type: 'auto-sync' | 'manual-sync' | 'delete'; biz: string } | null>(null);

let _ws: WebSocket | null = null;
let retryTimer: number | null = null;
let statusTimer: number | null = null;
let started = false;
const attemptedAutoSync = new Set<string>();
const accountOperationMutex = createAsyncMutex();

// 初始化时按当前时间重算一次有效性
for (const item of credentials.value) {
  item.valid = Date.now() < item.timestamp + 1000 * 60 * CREDENTIAL_LIVE_MINUTES;
}

function parseSetCookie(setCookie: string): { appmsg_token: string; cookie: string } {
  let appmsg_token = '';
  const tokenMatch = setCookie.match(/appmsg_token=(?<token>[^;]+)/);
  if (tokenMatch?.groups?.token) {
    appmsg_token = decodeURIComponent(tokenMatch.groups.token.trim());
  }

  const cookieParts: string[] = [];
  const entries = setCookie.split(',');
  for (const entry of entries) {
    const nameValue = entry.trim().split(';')[0].trim();
    if (!nameValue || !nameValue.includes('=')) continue;
    if (nameValue.includes('EXPIRED')) continue;
    const name = nameValue.split('=')[0].trim();
    if (['Path', 'Expires', 'HttpOnly', 'Secure', 'Domain', 'SameSite'].includes(name)) continue;
    const value = nameValue.split('=').slice(1).join('=');
    if (!value) continue;
    cookieParts.push(nameValue);
  }

  return { appmsg_token, cookie: cookieParts.join('; ') };
}

async function processCredentialData(result: CredentialRaw[]) {
  const _credentials: ParsedCredential[] = [];
  const infoByBiz = new Map(accountInfos.value.map(info => [info.fakeid, info]));
  for (const item of result) {
    let __biz: string | null = null;
    let uin: string | null = null;
    let key: string | null = null;
    let pass_ticket: string | null = null;

    try {
      const searchParams = new URL(item.url).searchParams;
      __biz = searchParams.get('__biz');
      uin = searchParams.get('uin');
      key = searchParams.get('key');
      pass_ticket = searchParams.get('pass_ticket');
    } catch {
      continue;
    }

    let wap_sid2: string | null = null;
    const matchResult = item.set_cookie.match(/wap_sid2=(?<wap_sid2>.+?);/);
    if (matchResult?.groups?.wap_sid2) {
      wap_sid2 = matchResult.groups.wap_sid2;
    }

    const { appmsg_token, cookie } = parseSetCookie(item.set_cookie);

    if (!__biz || !uin || !key || !pass_ticket || !wap_sid2) continue;

    const info = infoByBiz.get(__biz);
    _credentials.push({
      nickname: item.name || info?.nickname,
      avatar: item.avatar || info?.round_head_img,
      biz: __biz,
      uin,
      key,
      pass_ticket,
      wap_sid2,
      appmsg_token,
      cookie,
      timestamp: item.timestamp,
      time: dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss'),
      valid: Date.now() < item.timestamp + 1000 * 60 * CREDENTIAL_LIVE_MINUTES,
    });
  }
  credentials.value = mergeCredentialHistory(credentials.value, _credentials);
  refreshValidity();
  await nextTick();
  await reconcileCredentialAccounts();
}

function refreshValidity() {
  const expiresIn = 1000 * 60 * CREDENTIAL_LIVE_MINUTES;
  for (const credential of credentials.value) {
    credential.valid = Date.now() < credential.timestamp + expiresIn;
  }
}

async function fetchServiceStatus() {
  try {
    const data = await $fetch<CredentialServiceStatus>('/api/credential/status');
    serviceStatus.value = data;
    statusError.value = null;
  } catch (error: any) {
    serviceStatus.value = { running: false, proxyAddress: null, port: 65000 };
    statusError.value = error?.data?.statusMessage || error?.message || 'Credential 服务状态获取失败';
  } finally {
    refreshValidity();
    statusReady.value = true;
  }
}

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/credential/ws`;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    connectWs();
  }, 5000);
}

function connectWs() {
  if (_ws) return;

  const ws = new WebSocket(getWsUrl());
  ws.addEventListener('open', () => {
    wsConnected.value = true;
    _ws = ws;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  });
  ws.addEventListener('message', async evt => {
    try {
      const result: CredentialRaw[] = JSON.parse(evt.data);
      await processCredentialData(result);
    } catch (e) {
      console.warn('[credential-ws] parse error:', e);
    }
  });
  ws.addEventListener('close', () => {
    wsConnected.value = false;
    _ws = null;
    scheduleRetry();
  });
  ws.addEventListener('error', () => {
    scheduleRetry();
  });
}

async function refreshAccountInfos() {
  accountInfos.value = await getAllInfo();
}

function markCredentialInitialized(biz: string) {
  credentials.value = credentials.value.map(credential =>
    credential.biz === biz ? { ...credential, initialized: true } : credential
  );
}

function clearAutoSyncError(biz: string) {
  const nextErrors = { ...autoSyncErrors.value };
  delete nextErrors[biz];
  autoSyncErrors.value = nextErrors;
}

async function runAccountOperation<T>(
  type: 'auto-sync' | 'manual-sync' | 'delete',
  biz: string,
  task: () => Promise<T>
): Promise<T> {
  return accountOperationMutex.runExclusive(async () => {
    activeAccountOperation.value = { type, biz };
    try {
      return await task();
    } finally {
      activeAccountOperation.value = null;
    }
  });
}

async function autoSyncCredential(snapshot: ParsedCredential) {
  const current = credentials.value.find(item => item.biz === snapshot.biz);
  if (!current || !shouldAutoSyncCredential(current) || attemptedAutoSync.has(snapshot.biz)) return;

  await runAccountOperation('auto-sync', snapshot.biz, async () => {
    const credential = credentials.value.find(item => item.biz === snapshot.biz);
    if (!credential || !shouldAutoSyncCredential(credential) || attemptedAutoSync.has(snapshot.biz)) return;

    attemptedAutoSync.add(credential.biz);
    autoSyncingBiz.value = credential.biz;
    try {
      const info = accountInfos.value.find(item => item.fakeid === credential.biz);
      await runCredentialInitialSyncAttempt({
        markAttempt: () => markCredentialInitialized(credential.biz),
        waitForPersistence: async () => {
          await nextTick();
        },
        sync: async () => {
          await getArticleList(createCredentialAccountSeed(credential, info), 0);
        },
      });
      clearAutoSyncError(credential.biz);
      await refreshAccountInfos();
    } catch (error: any) {
      autoSyncErrors.value = {
        ...autoSyncErrors.value,
        [credential.biz]: error?.message || '首次同步失败',
      };
      console.error(`[credential] failed to auto-sync ${credential.biz}:`, error);
    } finally {
      autoSyncingBiz.value = null;
    }
  });
}

async function performCredentialReconciliation() {
  await refreshAccountInfos();
  for (const credential of credentials.value) {
    await autoSyncCredential(credential);
  }
}

const reconcileCredentialAccounts = createCoalescedSerialRunner(performCredentialReconciliation);

export default function useCredentials() {
  const validCredentials = computed(() => credentials.value.filter(c => c.valid));
  const credentialAccounts = computed(() => buildCredentialAccounts(credentials.value, accountInfos.value));

  /** 启动抓包状态订阅（幂等，多个组件共享同一连接） */
  function start() {
    if (started) return;
    started = true;
    fetchServiceStatus();
    refreshValidity();
    reconcileCredentialAccounts().catch(error => {
      console.error('[credential] failed to initialize accounts:', error);
    });
    connectWs();
    statusTimer = window.setInterval(fetchServiceStatus, 10000);
  }

  return {
    credentials,
    validCredentials,
    credentialAccounts,
    accountInfos,
    serviceStatus,
    statusReady,
    statusError,
    wsConnected,
    autoSyncingBiz,
    autoSyncErrors,
    activeAccountOperation,
    start,
    clearAutoSyncError,
    markCredentialInitialized,
    runAccountOperation,
    refreshAccountInfos,
    refreshServiceStatus: fetchServiceStatus,
  };
}
