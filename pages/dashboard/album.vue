<template>
  <div class="h-full">
    <BasePageTitle title="合集下载" eyebrow="内容归档" />

    <div class="flex h-full flex-col divide-y divide-gray-200 dark:divide-slate-700">
      <header class="flex flex-col gap-3 px-3 py-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div class="flex w-full flex-wrap items-center gap-2 2xl:w-auto">
          <AccountSelectorForAlbum v-model="selectedAccount" class="w-full sm:w-80" />
          <USelectMenu
            v-model="selectedAlbum"
            :options="selectedAccount?.albums || []"
            option-attribute="title"
            size="md"
            color="gray"
            class="w-full sm:w-60"
            placeholder="选择合集"
            :disabled="!selectedAccount || actionLocked"
          />
          <div class="flex h-9 items-center">
            <Loader v-if="switchSortLoading" :size="20" class="animate-spin text-slate-500" />
            <UButton
              v-else
              color="gray"
              variant="ghost"
              size="sm"
              :disabled="!selectedAccount || !selectedAlbum || actionLocked"
              class="active:scale-[0.98]"
              @click="toggleReverse"
            >
              <ArrowUpNarrowWide v-if="isReverse" :size="18" />
              <ArrowDownNarrowWide v-else :size="18" />
              <span>{{ isReverse ? '正序' : '倒序' }}</span>
            </UButton>
          </div>
        </div>

        <div class="flex w-full flex-wrap items-center gap-2 2xl:w-auto 2xl:justify-end">
          <UButton
            color="gray"
            variant="ghost"
            size="md"
            icon="i-lucide:external-link"
            :disabled="!selectedAccount || !selectedAlbum"
            class="active:scale-[0.98]"
            @click="gotoLink(originalAlbumURL)"
          >
            原始链接
          </UButton>

          <UButton v-if="downloadBtnLoading" color="black" icon="i-lucide:square" @click="stopDownload">
            停止
          </UButton>

          <ButtonGroup
            :items="[
              { label: '文章内容', event: 'download-article-html' },
              { label: '阅读量 (需要Credential)', event: 'download-article-metadata' },
              { label: '留言内容 (需要Credential)', event: 'download-article-comment' },
            ]"
            @download-article-html="downloadAlbumArticles('html')"
            @download-article-metadata="downloadAlbumArticles('metadata')"
            @download-article-comment="downloadAlbumArticles('comment')"
          >
            <UButton
              :loading="downloadBtnLoading || preparingAlbum"
              :disabled="!selectedAccount || !selectedAlbum || actionLocked"
              color="white"
              class="font-mono active:scale-[0.98]"
              :label="
                preparingAlbum
                  ? `加载全集 ${albumArticles.length}篇`
                  : downloadBtnLoading
                    ? `抓取中 ${downloadCompletedCount}/${downloadTotalCount}`
                    : '抓取'
              "
              trailing-icon="i-heroicons-chevron-down-20-solid"
            />
          </ButtonGroup>

          <ButtonGroup
            :items="[
              { label: 'Excel', event: 'export-article-excel' },
              { label: 'JSON', event: 'export-article-json' },
              { label: 'HTML', event: 'export-article-html' },
              { label: 'Txt', event: 'export-article-text' },
              { label: 'Markdown', event: 'export-article-markdown' },
              { label: 'Word (内测中)', event: 'export-article-word' },
              { label: 'PDF (内测中)', event: 'export-article-pdf' },
            ]"
            @export-article-excel="exportAlbumArticles('excel')"
            @export-article-json="exportAlbumArticles('json')"
            @export-article-html="exportAlbumArticles('html', true)"
            @export-article-text="exportAlbumArticles('text', true)"
            @export-article-markdown="exportAlbumArticles('markdown', true)"
            @export-article-word="exportAlbumArticles('word', true)"
            @export-article-pdf="exportAlbumArticles('pdf', true)"
          >
            <UButton
              :loading="exportBtnLoading || preparingAlbum"
              :disabled="!selectedAccount || !selectedAlbum || actionLocked"
              color="white"
              class="font-mono active:scale-[0.98]"
              :label="exportBtnLoading ? `${exportPhase} ${exportCompletedCount}/${exportTotalCount}` : '导出'"
              trailing-icon="i-heroicons-chevron-down-20-solid"
            />
          </ButtonGroup>
        </div>
      </header>

      <main
        v-if="selectedAccount && selectedAlbum"
        class="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-950"
      >
        <div v-if="albumLoading" class="flex items-center justify-center py-12">
          <Loader :size="28" class="animate-spin text-slate-500" />
        </div>

        <div v-else-if="albumBaseInfo" class="relative mx-auto max-w-2xl bg-white dark:bg-slate-900">
          <div class="banner px-5 py-7">
            <h2 class="text-2xl font-bold text-white"># {{ albumBaseInfo.title }}</h2>
          </div>
          <div class="sticky top-0 border-b bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
            <p class="mb-2 flex items-center space-x-2">
              <img class="size-5 rounded-full" :src="albumBaseInfo.brand_icon" :alt="albumBaseInfo.nickname" />
              <span>{{ albumBaseInfo.nickname }}</span>
            </p>
            <p class="text-sm text-slate-500">
              <span>{{ albumBaseInfo.article_count }}篇内容</span>
              <span v-if="albumBaseInfo.description"> · {{ albumBaseInfo.description }}</span>
            </p>
          </div>

          <div class="px-4 pb-6">
            <ul class="divide-y divide-slate-200 dark:divide-slate-700">
              <li
                v-for="article in albumArticles"
                :key="article.url || article.key"
                class="flex items-center justify-between px-1 py-5"
              >
                <div class="min-w-0 flex-1">
                  <h3 class="mb-2 truncate text-lg">
                    <span v-if="article.pos_num">{{ article.pos_num }}. </span>
                    <span>{{ article.title }}</span>
                  </h3>
                  <time class="text-sm text-slate-500">{{ formatAlbumTime(+article.create_time) }}</time>
                </div>
                <img
                  class="ml-4 size-16 flex-shrink-0 rounded-md object-cover"
                  :src="article.cover_img_1_1"
                  :alt="article.title"
                />
              </li>
            </ul>

            <div v-element-visibility="onElementVisibility"></div>
            <p v-if="articleLoading || preparingAlbum" class="flex items-center justify-center gap-2 py-4 text-slate-500">
              <Loader :size="22" class="animate-spin" />
              <span class="text-sm">{{ preparingAlbum ? '正在加载完整合集' : '正在加载更多文章' }}</span>
            </p>
            <p v-else-if="noMoreData" class="py-4 text-center text-sm text-slate-400">
              已加载全部 {{ albumArticles.length }} 篇文章
            </p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vElementVisibility } from '@vueuse/components';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Loader } from 'lucide-vue-next';
import { request } from '#shared/utils/request';
import AccountSelectorForAlbum from '~/components/selector/AccountSelectorForAlbum.vue';
import toastFactory from '~/composables/toast';
import useCredentialGate from '~/composables/useCredentialGate';
import useDownloader from '~/composables/useDownloader';
import useExporter from '~/composables/useExporter';
import { websiteName } from '~/config';
import { db } from '~/store/v2/db';
import { getHtmlCache } from '~/store/v2/html';
import type { MpAccount } from '~/store/v2/info';
import type { AppMsgAlbumResult, ArticleItem, BaseInfo } from '~/types/album';
import type { AppMsgAlbumInfo } from '~/types/types';
import { gotoLink } from '~/utils';
import { formatAlbumTime } from '~/utils/album';
import { collectCompleteAlbum, selectMissingAlbumArticleStubs } from '~/utils/album-articles';
import { findValidCredential } from '~/utils/credentials';

useHead({
  title: `合集下载 | ${websiteName}`,
});

interface AccountInfo extends MpAccount {
  albums?: AppMsgAlbumInfo[];
}

interface LoadedAlbumPage {
  items: ArticleItem[];
  baseInfo: BaseInfo;
  hasMore: boolean;
}

const toast = toastFactory();
const { openGate } = useCredentialGate();

const selectedAccount = ref<AccountInfo | undefined>();
const selectedAlbum = ref<AppMsgAlbumInfo | undefined>();
const albumArticles: ArticleItem[] = reactive([]);
const albumBaseInfo = ref<BaseInfo | null>(null);

const isReverse = ref(true);
const albumLoading = ref(false);
const articleLoading = ref(false);
const switchSortLoading = ref(false);
const preparingAlbum = ref(false);
const noMoreData = ref(false);
const paginationError = ref<string | null>(null);
const controller = ref<AbortController | null>(null);

const originalAlbumURL = computed(() => {
  if (!selectedAccount.value || !selectedAlbum.value) return '';
  return `https://mp.weixin.qq.com/mp/appmsgalbum?__biz=${selectedAccount.value.fakeid}&action=getalbum&album_id=${selectedAlbum.value.id}`;
});

watch(selectedAccount, () => {
  selectedAlbum.value = undefined;
});

watch(selectedAlbum, album => {
  controller.value?.abort('切换合集，取消旧请求');
  albumArticles.length = 0;
  albumBaseInfo.value = null;
  noMoreData.value = false;
  paginationError.value = null;
  isReverse.value = true;
  articleLoading.value = false;
  switchSortLoading.value = false;

  if (!album || !selectedAccount.value) return;
  getFirstPageAlbumData().catch(error => {
    if (!isAbortError(error)) toast.error('合集加载失败', getErrorMessage(error));
  });
});

function normalizeArticleList(list: ArticleItem[] | ArticleItem): ArticleItem[] {
  return Array.isArray(list) ? list : list ? [list] : [];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') || getErrorMessage(error).includes('取消');
}

async function requestAlbumPage(
  account: AccountInfo,
  album: AppMsgAlbumInfo,
  reverse: boolean,
  cursor?: { msgid: string; itemidx: string }
): Promise<LoadedAlbumPage> {
  controller.value?.abort('开始新的合集请求，取消旧请求');
  const requestController = new AbortController();
  controller.value = requestController;

  try {
    const data = await request<AppMsgAlbumResult>('/api/web/misc/appmsgalbum', {
      query: {
        fakeid: account.fakeid,
        album_id: album.id,
        is_reverse: reverse ? '1' : '0',
        begin_msgid: cursor?.msgid,
        begin_itemidx: cursor?.itemidx,
      },
      signal: requestController.signal,
    });

    if (data.base_resp.ret !== 0) {
      throw new Error(`合集接口返回异常：${data.base_resp.ret}`);
    }

    return {
      items: normalizeArticleList(data.getalbum_resp.article_list),
      baseInfo: data.getalbum_resp.base_info,
      hasMore: data.getalbum_resp.continue_flag !== '0',
    };
  } finally {
    if (controller.value === requestController) controller.value = null;
  }
}

async function getFirstPageAlbumData(refreshPage = true) {
  const account = selectedAccount.value;
  const album = selectedAlbum.value;
  if (!account || !album) return;

  if (refreshPage) albumLoading.value = true;
  else switchSortLoading.value = true;

  try {
    const reverse = isReverse.value;
    const page = await requestAlbumPage(account, album, reverse);
    if (selectedAccount.value?.fakeid !== account.fakeid || selectedAlbum.value?.id !== album.id) return;

    albumBaseInfo.value = page.baseInfo;
    albumArticles.splice(0, albumArticles.length, ...page.items);
    noMoreData.value = !page.hasMore;
    paginationError.value = null;
  } finally {
    albumLoading.value = false;
    switchSortLoading.value = false;
  }
}

function toggleReverse() {
  if (!selectedAccount.value || !selectedAlbum.value || actionLocked.value) return;
  isReverse.value = !isReverse.value;
  getFirstPageAlbumData(false).catch(error => {
    if (!isAbortError(error)) toast.error('合集排序失败', getErrorMessage(error));
  });
}

async function loadMoreData() {
  const account = selectedAccount.value;
  const album = selectedAlbum.value;
  const lastArticle = albumArticles.at(-1);
  if (!account || !album || !lastArticle || noMoreData.value || articleLoading.value || preparingAlbum.value) return;

  articleLoading.value = true;
  const reverse = isReverse.value;
  try {
    const page = await requestAlbumPage(account, album, reverse, {
      msgid: lastArticle.msgid,
      itemidx: lastArticle.itemidx,
    });
    if (
      selectedAccount.value?.fakeid !== account.fakeid ||
      selectedAlbum.value?.id !== album.id ||
      isReverse.value !== reverse
    ) {
      return;
    }

    const seenUrls = new Set(albumArticles.map(item => item.url));
    const newItems = page.items.filter(item => item.url && !seenUrls.has(item.url));
    if (page.hasMore && newItems.length === 0) {
      paginationError.value = '合集分页未取得新文章，请稍后重试';
      toast.error('合集加载已停止', paginationError.value);
      return;
    }

    albumArticles.push(...newItems);
    noMoreData.value = !page.hasMore;
    paginationError.value = null;
  } catch (error) {
    if (!isAbortError(error)) toast.error('合集加载失败', getErrorMessage(error));
  } finally {
    articleLoading.value = false;
  }
}

function onElementVisibility(visible: boolean) {
  if (visible && !noMoreData.value && !paginationError.value && !articleLoading.value && !preparingAlbum.value) {
    loadMoreData().catch(error => {
      console.warn(error);
    });
  }
}

async function cacheMissingAlbumArticles(
  account: AccountInfo,
  album: AppMsgAlbumInfo,
  items: ArticleItem[]
): Promise<Map<string, string>> {
  const itemsWithUrls = items.filter(item => item.url);
  const urls = [...new Set(itemsWithUrls.map(item => item.url))];
  if (urls.length === 0) return new Map();

  return db.transaction('rw', db.article, async () => {
    const existingByUrl = await db.article.where('link').anyOf(urls).toArray();
    const exactUrlRecords = new Map(existingByUrl.map(article => [article.link, article]));
    const candidateKeys = itemsWithUrls.map(item => `${account.fakeid}:${item.msgid}_${item.itemidx}`);
    const existingByKey = await db.article.bulkGet(candidateKeys);
    const occupiedKeys = new Set(candidateKeys.filter((_key, index) => existingByKey[index] !== undefined));
    const missing = selectMissingAlbumArticleStubs(
      new Set(existingByUrl.map(article => article.link)),
      account.fakeid,
      album,
      itemsWithUrls,
      occupiedKeys
    );

    if (missing.length > 0) {
      await db.article.bulkAdd(
        missing,
        missing.map(article => `${article.fakeid}:${article.aid}`)
      );
    }

    const insertedUrlsByKey = new Map(missing.map(article => [`${article.fakeid}:${article.aid}`, article.link]));
    const resolvedUrls = new Map<string, string>();
    itemsWithUrls.forEach((item, index) => {
      const key = candidateKeys[index];
      resolvedUrls.set(
        item.url,
        exactUrlRecords.get(item.url)?.link || existingByKey[index]?.link || insertedUrlsByKey.get(key) || item.url
      );
    });
    return resolvedUrls;
  });
}

async function prepareAlbumArticles(): Promise<string[] | null> {
  const account = selectedAccount.value;
  const album = selectedAlbum.value;
  if (!account || !album || albumArticles.length === 0) return null;

  preparingAlbum.value = true;
  paginationError.value = null;
  const reverse = isReverse.value;
  try {
    const completeArticles = await collectCompleteAlbum([...albumArticles], !noMoreData.value, async cursor => {
      const page = await requestAlbumPage(account, album, reverse, cursor);
      return { items: page.items, hasMore: page.hasMore };
    });

    if (
      selectedAccount.value?.fakeid !== account.fakeid ||
      selectedAlbum.value?.id !== album.id ||
      isReverse.value !== reverse
    ) {
      throw new Error('合集已切换，请重新操作');
    }

    albumArticles.splice(0, albumArticles.length, ...completeArticles);
    noMoreData.value = true;
    paginationError.value = null;
    const resolvedUrls = await cacheMissingAlbumArticles(account, album, completeArticles);
    return [...new Set(completeArticles.map(item => resolvedUrls.get(item.url) || item.url))];
  } catch (error) {
    if (!isAbortError(error)) {
      paginationError.value = getErrorMessage(error);
      toast.error('完整合集准备失败', paginationError.value);
    }
    return null;
  } finally {
    preparingAlbum.value = false;
  }
}

const {
  loading: downloadBtnLoading,
  completed_count: downloadCompletedCount,
  total_count: downloadTotalCount,
  download,
  stop: stopDownload,
} = useDownloader();

const {
  loading: exportBtnLoading,
  phase: exportPhase,
  completed_count: exportCompletedCount,
  total_count: exportTotalCount,
  exportFile,
} = useExporter();

const actionLocked = computed(
  () =>
    albumLoading.value ||
    articleLoading.value ||
    switchSortLoading.value ||
    preparingAlbum.value ||
    downloadBtnLoading.value ||
    exportBtnLoading.value
);

async function downloadAlbumArticles(type: 'html' | 'metadata' | 'comment') {
  const account = selectedAccount.value;
  if (!account || actionLocked.value) return;
  if (type !== 'html' && !findValidCredential(account.fakeid)) {
    openGate({ fakeid: account.fakeid, refresh: true });
    return;
  }

  const urls = await prepareAlbumArticles();
  if (urls?.length) await download(type, urls);
}

type AlbumExportType = Parameters<typeof exportFile>[0];

async function exportAlbumArticles(type: AlbumExportType, requiresContent = false) {
  if (!selectedAccount.value || actionLocked.value) return;
  const urls = await prepareAlbumArticles();
  if (!urls?.length) return;

  const missingContentCount = requiresContent
    ? (await Promise.all(urls.map(url => getHtmlCache(url)))).filter(cache => !cache).length
    : undefined;
  await exportFile(type, urls, missingContentCount);
}
</script>

<style scoped>
.banner {
  background: linear-gradient(rgb(9, 9, 9), rgb(35, 35, 35));
}
</style>
