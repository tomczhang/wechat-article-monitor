import { type Ref, type WatchStopHandle, watch } from 'vue';

interface ArticleTableReloadOptions<T extends { fakeid: string }> {
  selectedAccount: Ref<T | undefined>;
  autoSyncingBiz: Ref<string | null>;
  lastSyncedPage?: Ref<{ fakeid: string } | null>;
  onAccountUnavailable: () => void;
  onReload: (fakeid: string) => void;
  onPageSynced?: (fakeid: string) => void;
}

export function watchArticleTableReloads<T extends { fakeid: string }>(
  options: ArticleTableReloadOptions<T>
): WatchStopHandle {
  const stopSelectionWatch = watch(
    () => options.selectedAccount.value?.fakeid,
    fakeid => {
      if (!fakeid) {
        options.onAccountUnavailable();
        return;
      }
      options.onReload(fakeid);
    },
    { immediate: true }
  );

  const stopAutoSyncWatch = watch(options.autoSyncingBiz, (currentBiz, previousBiz) => {
    if (currentBiz !== null || !previousBiz || options.selectedAccount.value?.fakeid !== previousBiz) return;
    options.onReload(previousBiz);
  });

  const stopPageSyncWatch = options.lastSyncedPage
    ? watch(options.lastSyncedPage, page => {
        if (!page || options.selectedAccount.value?.fakeid !== page.fakeid) return;
        options.onPageSynced?.(page.fakeid);
      })
    : () => {};

  return () => {
    stopSelectionWatch();
    stopAutoSyncWatch();
    stopPageSyncWatch();
  };
}
