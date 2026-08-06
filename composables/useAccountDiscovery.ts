import toastFactory from '~/composables/toast';
import useCommentMonitor from '~/composables/useCommentMonitor';
import {
  addWatchedAccount,
  getAllWatchedAccounts,
  removeWatchedAccount,
  updateWatchedAccount,
  type WatchedAccount,
} from '~/store/v2/watchedAccount';
import type { ParsedCredential } from '~/types/credential';
import { AccountDiscoveryPoller } from '~/utils/monitor/AccountDiscoveryPoller';

const MAX_WATCH_COUNT = 5;

const watches = ref<WatchedAccount[]>([]);
const discovering = ref(false);

let poller: AccountDiscoveryPoller | null = null;
let pollerListenersBound = false;

const credentials = useLocalStorage<ParsedCredential[]>('auto-detect-credentials:credentials', []);

export default function useAccountDiscovery() {
  const toast = toastFactory();
  const commentMonitor = useCommentMonitor();

  function getWatchName(fakeid: string) {
    return watches.value.find(w => w.fakeid === fakeid)?.nickname || fakeid;
  }

  function isCredentialExpiredError(error: Error) {
    return /Credential|未检测到|已失效|未登录或登录已过期|session expired/i.test(error.message);
  }

  async function refreshWatches() {
    watches.value = await getAllWatchedAccounts();
  }

  async function addWatch(account: { fakeid: string; nickname: string; round_head_img: string }) {
    if (watches.value.length >= MAX_WATCH_COUNT) {
      toast.warning('监控上限', `最多监控 ${MAX_WATCH_COUNT} 个公众号`);
      return;
    }
    if (watches.value.some(w => w.fakeid === account.fakeid)) {
      toast.warning('重复添加', '该公众号已在监控列表中');
      return;
    }

    const newWatch: WatchedAccount = {
      fakeid: account.fakeid,
      nickname: account.nickname,
      round_head_img: account.round_head_img,
      enabled: true,
      last_check_time: 0,
      last_known_aid: '',
      check_count: 0,
      last_discovery_at: 0,
      discovered_count: 0,
    };
    await addWatchedAccount(newWatch);
    await refreshWatches();
    toast.success('添加成功', `已添加监控：${account.nickname}`);

    if (!discovering.value) {
      startDiscovery();
    } else if (poller) {
      poller.checkOnce(newWatch).catch(err => {
        console.warn('[AccountDiscovery] 添加后立即检查失败:', err);
      });
    }
  }

  async function removeWatch(fakeid: string) {
    await removeWatchedAccount(fakeid);
    await refreshWatches();
    if (watches.value.length === 0 && discovering.value) {
      stopDiscovery();
    }
  }

  async function toggleWatch(fakeid: string, enabled: boolean) {
    await updateWatchedAccount(fakeid, { enabled });
    await refreshWatches();
  }

  function bindPollerListeners(p: AccountDiscoveryPoller) {
    if (pollerListenersBound) return;
    pollerListenersBound = true;

    p.on('discovered', (watch, articles) => {
      for (const article of articles) {
        commentMonitor.enqueueAuto(article, watch).catch(err => {
          console.warn('[AccountDiscovery] enqueueAuto failed:', err);
        });
      }
    });

    p.on('watch-checked', async (_fakeid, _foundCount) => {
      await refreshWatches();
    });

    p.on('error', (fakeid, error) => {
      console.error(`[AccountDiscovery] poll error for ${fakeid}:`, error);
      toast.error('监控失败', `【${getWatchName(fakeid)}】${error.message}`);
      if (isCredentialExpiredError(error)) {
        stopDiscovery();
        toast.warning('新文章发现已暂停', '该公众号的 Credential 已失效，请在微信中重新打开其任意一篇文章以刷新凭证');
      }
    });
  }

  function startDiscovery() {
    if (discovering.value) {
      if (import.meta.dev) console.warn('[AccountDiscovery] already running');
      return;
    }
    poller = new AccountDiscoveryPoller();
    bindPollerListeners(poller);
    poller.start();
    discovering.value = true;
  }

  function stopDiscovery() {
    if (poller) {
      poller.stop();
      poller.removeAllListeners();
      poller = null;
    }
    pollerListenersBound = false;
    discovering.value = false;
  }

  return {
    watches,
    discovering,
    enabledCount: computed(() => watches.value.filter(w => w.enabled).length),
    credentials,
    addWatch,
    removeWatch,
    toggleWatch,
    startDiscovery,
    stopDiscovery,
    refreshWatches,
    MAX_WATCH_COUNT,
  };
}

/** 自动启动：当模块首次被使用且已有监控公众号时，启动发现轮询 */
export function autoStartAccountDiscoveryIfNeeded() {
  if (discovering.value || poller) return;
  getAllWatchedAccounts().then(list => {
    watches.value = list;
    if (list.length > 0) {
      const inst = useAccountDiscovery();
      inst.startDiscovery();
    }
  });
}
