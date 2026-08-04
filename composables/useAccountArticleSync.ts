import { getArticleList } from '~/apis';
import { getArticleCache, hitCache } from '~/store/v2/article';
import type { MpAccount } from '~/store/v2/info';
import type { Preferences } from '~/types/preferences';
import { shouldContinueAccountSync } from '~/utils/account-sync';

export default function useAccountArticleSync() {
  const preferences = usePreferences();
  const { getSyncTimestamp } = useSyncDeadline();

  const syncingBiz = ref<string | null>(null);
  const isSyncing = computed(() => syncingBiz.value !== null);

  let canceled = false;
  let syncTimer: number | null = null;
  let releaseWait: (() => void) | null = null;

  function throwIfCanceled() {
    if (canceled) throw new Error('已取消同步');
  }

  async function waitForNextPage() {
    const seconds = (preferences.value as unknown as Preferences).accountSyncSeconds || 5;
    await new Promise<void>(resolve => {
      releaseWait = resolve;
      syncTimer = window.setTimeout(resolve, seconds * 1000);
    });
    syncTimer = null;
    releaseWait = null;
  }

  async function syncAccount(account: MpAccount, loadMore = true): Promise<void> {
    if (isSyncing.value) throw new Error('已有公众号正在同步');

    canceled = false;
    syncingBiz.value = account.fakeid;
    let begin = 0;
    const syncToTimestamp = getSyncTimestamp();

    try {
      while (true) {
        throwIfCanceled();
        const [articles, completed, , nextBegin] = await getArticleList(account, begin);
        throwIfCanceled();
        begin = nextBegin;

        const lastArticle = articles.at(-1);
        if (lastArticle && account.last_update_time && lastArticle.create_time < account.last_update_time) {
          if (await hitCache(account.fakeid, lastArticle.create_time)) {
            const cachedArticles = await getArticleCache(account.fakeid, lastArticle.create_time);
            begin += cachedArticles.filter(article => article.itemidx === 1).length;
            articles.push(...cachedArticles);
          }
        }

        const oldestArticleTimestamp = articles.at(-1)?.create_time;
        if (
          !shouldContinueAccountSync({
            completed,
            loadMore,
            oldestArticleTimestamp,
            syncToTimestamp,
          })
        ) {
          return;
        }

        await waitForNextPage();
      }
    } finally {
      syncingBiz.value = null;
      syncTimer = null;
      releaseWait = null;
      canceled = false;
    }
  }

  function stop() {
    canceled = true;
    if (syncTimer !== null) {
      window.clearTimeout(syncTimer);
      syncTimer = null;
    }
    releaseWait?.();
  }

  onUnmounted(stop);

  return {
    syncingBiz,
    isSyncing,
    syncAccount,
    stop,
  };
}
