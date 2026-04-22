<template>
  <USlideover v-model="open" :ui="{ width: 'max-w-[500px]' }">
    <UCard
      class="flex flex-col flex-1"
      :ui="{ body: { base: 'flex-1' }, ring: '', divide: 'divide-y divide-gray-100 dark:divide-gray-800' }"
    >
      <template #header>
        <div class="flex justify-between items-center">
          <h2 class="font-bold text-2xl">抓取 Credentials</h2>
        </div>
      </template>

      <div>
        <div class="space-y-4 mb-4">
          <div class="flex items-center justify-between p-3 border rounded-lg">
            <div class="flex items-center gap-2">
              <span class="inline-block size-3 rounded-full" :class="serviceStatusColor"></span>
              <span class="text-sm font-medium">Credential 抓包服务</span>
              <UBadge v-if="isRemoteMode" color="amber" variant="subtle" size="xs">远程</UBadge>
            </div>
            <div class="text-sm text-gray-500">
              <template v-if="serviceStatus.running">
                代理地址: {{ serviceStatus.proxyAddress }}
              </template>
              <template v-else>
                未启动 (需要安装 mitmproxy)
              </template>
            </div>
          </div>

          <div class="flex items-center justify-between p-3 border rounded-lg">
            <div class="flex items-center gap-2">
              <span class="inline-block size-3 rounded-full" :class="wsConnected ? 'bg-green-500' : 'bg-gray-400'"></span>
              <span class="text-sm font-medium">WebSocket 连接</span>
            </div>
            <span class="text-sm text-gray-500">{{ wsConnected ? '已连接' : '未连接' }}</span>
          </div>

          <!-- 远程模式：手机配置指引 + 二维码下载证书 -->
          <template v-if="isRemoteMode">
            <div class="p-3 border rounded-lg space-y-3 bg-amber-50/50 dark:bg-amber-500/5">
              <div class="flex items-start gap-3">
                <UIcon name="i-lucide:smartphone" class="text-amber-500 text-lg flex-shrink-0 mt-0.5" />
                <div class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed space-y-1">
                  <p class="font-medium text-gray-700 dark:text-gray-200">手机端配置（推荐 Surfboard / NekoBox）</p>
                  <p>
                    将手机代理服务器设为
                    <code class="bg-white dark:bg-gray-800 px-1 rounded font-mono">{{ serviceStatus.proxyAddress }}</code>
                  </p>
                  <p v-if="serviceStatus.proxyAuthEnabled">
                    需要账号密码：见 VPS 上 <code class="bg-white dark:bg-gray-800 px-1 rounded">.env</code> 中
                    <code class="bg-white dark:bg-gray-800 px-1 rounded">MITM_PROXY_AUTH</code> 字段
                  </p>
                </div>
              </div>

              <div class="flex items-start gap-3">
                <div class="flex-shrink-0">
                  <canvas ref="qrCanvas" class="rounded bg-white p-1" />
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed space-y-1">
                  <p class="font-medium text-gray-700 dark:text-gray-200">扫码下载并安装 mitm CA 证书</p>
                  <p>iOS: 装完描述文件后到 <strong>设置 → 通用 → 关于本机 → 证书信任设置</strong> 打开开关</p>
                  <p>Android: 装完到 <strong>设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书</strong></p>
                </div>
              </div>
            </div>
          </template>

          <p v-else class="text-xs text-gray-400">
            将系统代理设为 <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">127.0.0.1:{{ serviceStatus.port }}</code>，
            在微信内打开公众号文章即可自动抓取 Credentials。
          </p>
        </div>

        <ul class="flex flex-col p-1 gap-4 overflow-y-scroll h-[calc(100vh-22rem)] no-scrollbar">
          <li
            v-for="credential in credentials"
            :key="credential.biz"
            class="relative flex items-center border rounded-md hover:ring ring-blue-500 hover:shadow-md transition-all duration-300 p-3 space-x-5"
          >
            <div class="size-20 border rounded-full">
              <img :src="credential.avatar" alt="" />
            </div>
            <div class="flex-1">
              <p>公众号名称：{{ credential.nickname || '--' }}</p>
              <p>fakeid: {{ credential.biz }}</p>
              <p>获取时间: {{ credential.time }}</p>
              <div class="flex items-center justify-between mt-4">
                <span v-if="credential.valid" class="font-sans font-bold text-green-500">有效</span>
                <span v-else class="font-sans font-bold text-rose-500">已过期</span>
                <UButton
                  size="xs"
                  :color="credential.added ? 'green' : 'blue'"
                  :variant="credential.added ? 'soft' : 'solid'"
                  :disabled="credential.added || addingBiz === credential.biz"
                  :loading="addingBiz === credential.biz"
                  @click="addAccount(credential)"
                >
                  {{ credential.added ? '已添加' : '添加公众号' }}
                </UButton>
              </div>
              <CredentialExpiryBar :timestamp="credential.timestamp" class="mt-3" />
            </div>
            <UButton
              v-if="isDev"
              :loading="pullArticleLoading"
              class="absolute top-3 right-3"
              @click="pullData(credential.biz)"
            >
              拉取数据
            </UButton>
          </li>
        </ul>
      </div>
    </UCard>
  </USlideover>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import { getArticleList, getArticleListWithCredential } from '~/apis';
import CredentialExpiryBar from '~/components/global/CredentialExpiryBar.vue';
import LoginModal from '~/components/modal/Login.vue';
import toastFactory from '~/composables/toast';
import useLoginCheck from '~/composables/useLoginCheck';
import { CREDENTIAL_LIVE_MINUTES, isDev } from '~/config';
import { getInfoCache, type MpAccount } from '~/store/v2/info';
import type { ParsedCredential } from '~/types/credential';

export type CredentialState = 'active' | 'inactive' | 'warning';

const emit = defineEmits<{
  (e: 'update:pendingCount', value: number): void;
}>();

const open = defineModel<boolean>('open', { default: false });
const state = defineModel<CredentialState>('state', { default: 'inactive' });

const pullArticleLoading = ref(false);
async function pullData(fakeid: string) {
  pullArticleLoading.value = true;
  const articles = await getArticleListWithCredential(fakeid);
  console.log(articles);
  pullArticleLoading.value = false;
}

const { checkLogin } = useLoginCheck();

const credentials = useLocalStorage<ParsedCredential[]>('auto-detect-credentials:credentials', []);
for (const item of credentials.value) {
  item.valid = Date.now() < item.timestamp + 1000 * 60 * CREDENTIAL_LIVE_MINUTES;
}
const pendingCredentialCount = computed(() => credentials.value.filter(c => c.valid && !c.added).length);
const toast = toastFactory();
const modal = useModal();
const addingBiz = ref<string | null>(null);

interface ServiceStatus {
  running: boolean;
  mode: 'local' | 'remote';
  proxyAddress: string | null;
  port: number;
  publicHost: string | null;
  proxyAuthEnabled: boolean;
  certUrl: string | null;
  credentialCount: number;
}

const serviceStatus = ref<ServiceStatus>({
  running: false,
  mode: 'local',
  proxyAddress: null,
  port: 65000,
  publicHost: null,
  proxyAuthEnabled: false,
  certUrl: null,
  credentialCount: 0,
});

const isRemoteMode = computed(() => serviceStatus.value.mode === 'remote');

const serviceStatusColor = computed(() => {
  if (serviceStatus.value.running) return 'bg-green-500';
  return 'bg-red-400';
});

async function fetchServiceStatus() {
  try {
    const data = await $fetch<ServiceStatus>('/api/credential/status');
    serviceStatus.value = data;
  } catch {
    serviceStatus.value = {
      running: false,
      mode: 'local',
      proxyAddress: null,
      port: 65000,
      publicHost: null,
      proxyAuthEnabled: false,
      certUrl: null,
      credentialCount: 0,
    };
  }
}

const qrCanvas = ref<HTMLCanvasElement | null>(null);

async function renderCertQrCode() {
  if (!isRemoteMode.value || !qrCanvas.value || !serviceStatus.value.certUrl) return;
  const certFullUrl = `${location.origin}${serviceStatus.value.certUrl}`;
  try {
    await QRCode.toCanvas(qrCanvas.value, certFullUrl, {
      width: 110,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    console.warn('[CredentialsDialog] QR render failed:', err);
  }
}

watch([isRemoteMode, () => serviceStatus.value.certUrl, qrCanvas], renderCertQrCode);

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

async function refreshCredentialAddedState() {
  const pending = credentials.value.map(async credential => {
    const info = await getInfoCache(credential.biz);
    credential.added = Boolean(info);
  });
  await Promise.allSettled(pending);
}

const { accountEventBus } = useAccountEventBus();
accountEventBus.on((event, payload) => {
  if (event === 'account-added') {
    const target = credentials.value.find(item => item.biz === payload?.fakeid);
    if (target) target.added = true;
  } else if (event === 'account-removed') {
    const target = credentials.value.find(item => item.biz === payload?.fakeid);
    if (target) target.added = false;
  }
});

interface CredentialRaw {
  biz?: string;
  name?: string;
  avatar?: string;
  url: string;
  set_cookie: string;
  timestamp: number;
}

async function processCredentialData(result: CredentialRaw[]) {
  const _credentials: ParsedCredential[] = [];
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

    const info = await getInfoCache(__biz);
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
      added: Boolean(info),
    });
  }
  credentials.value = _credentials.sort((a, b) => b.timestamp - a.timestamp);
}

const wsConnected = ref(false);
let _ws: WebSocket | null = null;
let retryTimer: number | null = null;

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/credential/ws`;
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

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    connectWs();
  }, 5000);
}

onMounted(() => {
  fetchServiceStatus();
  refreshCredentialAddedState();
  connectWs();
  setInterval(fetchServiceStatus, 10000);
});

onUnmounted(() => {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
});

async function addAccount(credential: ParsedCredential) {
  if (credential.added || addingBiz.value === credential.biz) return;
  if (!checkLogin()) return;

  addingBiz.value = credential.biz;
  const nickname = credential.nickname || credential.biz;
  const account: MpAccount = {
    fakeid: credential.biz,
    completed: false,
    count: 0,
    articles: 0,
    total_count: 0,
    nickname: credential.nickname,
    round_head_img: credential.avatar,
  };

  try {
    await getArticleList(account, 0);
    credential.added = true;
    toast.success('公众号添加成功', `已成功添加公众号【${nickname}】`);
    accountEventBus.emit('account-added', { fakeid: credential.biz });
  } catch (error: any) {
    if (error?.message === 'session expired') {
      modal.open(LoginModal);
    } else {
      toast.error('添加公众号失败', error?.message || '未知错误');
    }
  } finally {
    addingBiz.value = null;
  }
}

watchEffect(() => {
  state.value = wsConnected.value ? 'active' : 'inactive';
});

watchEffect(() => {
  emit('update:pendingCount', pendingCredentialCount.value);
});
</script>
