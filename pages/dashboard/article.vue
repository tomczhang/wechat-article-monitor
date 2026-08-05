<script setup lang="ts">
import type {
  ColDef,
  FilterChangedEvent,
  GetRowIdParams,
  GridApi,
  GridOptions,
  GridReadyEvent,
  ICellRendererParams,
  SelectionChangedEvent,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import { defu } from 'defu';
import type { PreviewArticle } from '#components';
import { durationToSeconds, formatItemShowType, formatTimeStamp, sleep } from '#shared/utils/helpers';
import { validateHTMLContent } from '#shared/utils/html';
import GridAlbum from '~/components/grid/Album.vue';
import GridArticleActions from '~/components/grid/ArticleActions.vue';
import GridCoverTooltip from '~/components/grid/CoverTooltip.vue';
import GridStatusBar from '~/components/grid/StatusBar.vue';
import ConfirmModal from '~/components/modal/Confirm.vue';
import AccountSelectorForArticle from '~/components/selector/AccountSelectorForArticle.vue';
import toastFactory from '~/composables/toast';
import useCredentialGate from '~/composables/useCredentialGate';
import { watchArticleTableReloads } from '~/composables/watchArticleTableReloads';
import { isDev, websiteName } from '~/config';
import { sharedGridOptions } from '~/config/shared-grid-options';
import { deleteAccountData } from '~/store/v2';
import { articleDeleted, getArticleCache, updateArticleStatus } from '~/store/v2/article';
import { getCommentCache } from '~/store/v2/comment';
import { getDebugCache } from '~/store/v2/debug';
import { getHtmlCache } from '~/store/v2/html';
import { getMetadataCache, type Metadata } from '~/store/v2/metadata';
import type { CredentialAccount } from '~/types/credential';
import type { Preferences } from '~/types/preferences';
import type { AppMsgExWithFakeID } from '~/types/types';
import { isAccountActionLocked, runManualSyncAttempt } from '~/utils/account-sync';
import type { ArticleMetadata } from '~/utils/download/types';
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';
import { collapseReposts } from '~/utils/repost';

useHead({
  title: `文章下载 | ${websiteName}`,
});

// 当前页面的数据模型
interface Article extends AppMsgExWithFakeID, Partial<ArticleMetadata> {
  /**
   * 文章内容是否已下载
   */
  contentDownload: boolean;

  /**
   * 留言内容是否已下载
   */
  commentDownload: boolean;
}

let globalRowData: Article[] = [];

const columnDefs = ref<ColDef[]>([
  {
    headerName: 'ID',
    field: 'aid',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '链接',
    field: 'link',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    minWidth: 150,
    initialHide: true,
    cellClass: 'font-mono',
  },
  {
    headerName: '标题',
    field: 'title',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'title',
    minWidth: 200,
  },
  {
    headerName: '封面',
    field: 'cover',
    sortable: false,
    filter: false,
    cellRenderer: (params: ICellRendererParams) => {
      return `<img alt="" src="${params.value}" style="height: 40px; width: 40px; object-fit: cover;" />`;
    },
    tooltipField: 'cover',
    tooltipComponent: GridCoverTooltip,
    minWidth: 80,
    hide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '摘要',
    field: 'digest',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'digest',
    minWidth: 200,
    initialHide: true,
  },
  {
    headerName: '创建时间',
    field: 'create_time',
    valueFormatter: p => formatTimeStamp(p.value),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('create_time') * 1000);
    },
    minWidth: 180,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '发布时间',
    field: 'update_time',
    valueFormatter: p => formatTimeStamp(p.value),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('update_time') * 1000);
    },
    minWidth: 180,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '是否已删除',
    field: 'is_deleted',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已删除', '未删除'),
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '文章状态',
    field: '_status',
    valueFormatter: p => p.value,
    filter: 'agSetColumnFilter',
    filterParams: {
      valueFormatter: (p: ValueFormatterParams) => p.value,
    },
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '内容已下载',
    field: 'contentDownload',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已下载', '未下载'),
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    field: 'commentDownload',
    headerName: '留言已下载',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已下载', '未下载'),
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '阅读',
    field: 'readNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '点赞',
    field: 'oldLikeNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '分享',
    field: 'shareNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '喜欢',
    field: 'likeNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '留言',
    field: 'commentNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    field: 'author_name',
    headerName: '作者',
    cellDataType: 'text',
    filter: 'agSetColumnFilter',
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '是否原创',
    valueGetter: p => p.data && p.data.copyright_stat === 1 && p.data.copyright_type === 1,
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('原创', '非原创'),
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '是否付费',
    field: 'is_pay_subscribe',
    valueGetter: p => p.data && p.data.is_pay_subscribe === 1,
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('付费', '免费'),
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '付费金额',
    field: 'wecoin_count',
    valueFormatter: p => (p.value ? `${p.value} 微币` : ''),
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 120,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '文章类型',
    field: 'item_show_type',
    valueFormatter: p => formatItemShowType(p.value),
    filter: 'agSetColumnFilter',
    filterParams: {
      valueFormatter: (p: ValueFormatterParams) => formatItemShowType(p.value),
    },
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '媒体时长',
    field: 'media_duration',
    valueGetter: params => durationToSeconds(params.data.media_duration), // 用于排序和过滤
    valueFormatter: params => params.data.media_duration,
    filter: 'agNumberColumnFilter',
    comparator: (a, b) => a - b,
    minWidth: 150,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '所属合集',
    field: 'appmsg_album_infos',
    cellRenderer: GridAlbum,
    sortable: false,
    filter: false,
    valueFormatter: p => p.value.map((album: any) => album.title).join(','),
    minWidth: 150,
    initialHide: true,
  },
  {
    headerName: '操作',
    field: 'link',
    sortable: false,
    filter: false,
    cellRenderer: GridArticleActions,
    cellRendererParams: {
      onPreview: (params: ICellRendererParams) => {
        preview(params.data);
      },
      onGotoLink: (params: ICellRendererParams) => {
        window.open(params.value, '_blank');
      },
    },
    maxWidth: 100,
    pinned: 'right',
    cellClass: 'flex justify-center items-center',
  },
]);

// 注意，`defu`函数最左边的参数优先级最高
const gridOptions: GridOptions = defu(
  {
    getRowId: (params: GetRowIdParams) => `${params.data.fakeid}:${params.data.aid}`,
    statusBar: {
      statusPanels: [
        {
          statusPanel: GridStatusBar,
          align: 'left',
        },
      ],
    },
  },
  sharedGridOptions
);

const gridApi = shallowRef<GridApi | null>(null);
function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;

  restoreColumnState();
  gridApi.value.setGridOption('rowData', globalRowData);
}

function onColumnStateChange() {
  if (gridApi.value) {
    saveColumnState();
  }
}
function saveColumnState() {
  const state = gridApi.value?.getColumnState();
  localStorage.setItem('agGridColumnState', JSON.stringify(state));
}

function restoreColumnState() {
  const stateStr = localStorage.getItem('agGridColumnState');
  if (stateStr) {
    const state = JSON.parse(stateStr);
    gridApi.value?.applyColumnState({
      state,
      applyOrder: true,
    });
  }
}

function onFilterChanged(event: FilterChangedEvent) {
  event.api.deselectAll();
}

const preferences = usePreferences();
const toast = toastFactory();
const modal = useModal();
const {
  credentialAccounts,
  autoSyncingBiz,
  clearAutoSyncError,
  markCredentialInitialized,
  refreshAccountInfos,
  runAccountOperation,
} = useCredentials();
const { openGate } = useCredentialGate();
const { getSyncRangeLabel, isSyncAll } = useSyncDeadline();
const hideDeleted = computed(() => (preferences.value as unknown as Preferences).hideDeleted);
const shouldCollapseReposts = computed(() => (preferences.value as unknown as Preferences).collapseReposts);

const previewArticleRef = ref<typeof PreviewArticle | null>(null);

function preview(article: Article) {
  previewArticleRef.value!.open(article);
}

const loading = ref(false);
let tableLoadVersion = 0;

// 文章表格一次只展示一个 Credential 对应的公众号
const selectedAccount = ref<CredentialAccount | undefined>();
const selectedCredentialValid = computed(() => selectedAccount.value?.credentialValid === true);
const { isSyncing: accountSyncing, lastSyncedPage, syncAccount, stop: stopAccountSync } = useAccountArticleSync();

watch(
  credentialAccounts,
  accounts => {
    const currentBiz = selectedAccount.value?.fakeid;
    const current = currentBiz ? accounts.find(account => account.fakeid === currentBiz) : undefined;
    selectedAccount.value = current || accounts.find(account => account.credentialValid) || accounts[0];
  },
  { immediate: true }
);

watchArticleTableReloads({
  selectedAccount,
  autoSyncingBiz,
  lastSyncedPage,
  onAccountUnavailable() {
    tableLoadVersion++;
    loading.value = false;
    globalRowData = [];
    gridApi.value?.setGridOption('rowData', []);
  },
  onReload(fakeid) {
    switchTableData(fakeid).catch(error => {
      toast.error('读取文章失败', error?.message || '未知错误');
    });
  },
  onPageSynced(fakeid) {
    switchTableData(fakeid, { showLoading: false }).catch(error => {
      toast.error('读取文章失败', error?.message || '未知错误');
    });
  },
});

async function switchTableData(fakeid: string, options: { showLoading?: boolean } = {}) {
  const showLoading = options.showLoading ?? true;
  const loadVersion = ++tableLoadVersion;
  if (showLoading) loading.value = true;
  try {
    const articles: Article[] = [];
    const data = await getArticleCache(fakeid, Math.floor(Date.now() / 1000));
    for (const article of data) {
      const contentDownload = (await getHtmlCache(article.link)) !== undefined;
      const commentDownload = (await getCommentCache(article.link)) !== undefined;
      const metadata = await getMetadataCache(article.link);
      if (metadata) {
        articles.push({
          ...metadata,
          ...article,
          contentDownload: contentDownload,
          commentDownload: commentDownload,
        });
      } else {
        articles.push({
          ...article,
          contentDownload: contentDownload,
          commentDownload: commentDownload,
        });
      }
    }
    if (showLoading) await sleep(200);
    if (loadVersion !== tableLoadVersion) return;
    const visible = articles.filter(article => (hideDeleted.value ? !article.is_deleted : true));
    globalRowData = shouldCollapseReposts.value ? collapseReposts(visible) : visible;
    gridApi.value?.setGridOption('rowData', globalRowData);
  } finally {
    if (loadVersion === tableLoadVersion) loading.value = false;
  }
}

function updateRow(article: Article) {
  const rowNode = gridApi.value?.getRowNode(`${article.fakeid}:${article.aid}`);
  if (rowNode) {
    rowNode.updateData(article);
  }
}

const selectedArticles = shallowRef<Article[]>([]);
function onSelectionChanged(event: SelectionChangedEvent) {
  selectedArticles.value = (event.selectedNodes || []).map(node => node.data);
}
const selectedArticleUrls = computed(() => {
  return selectedArticles.value.map(article => article.link);
});
const contentNotDownloadedCount = computed(() => {
  return selectedArticles.value.filter(article => !article.contentDownload).length;
});

const {
  loading: downloadBtnLoading,
  completed_count: downloadCompletedCount,
  total_count: downloadTotalCount,
  download,
  stop: stopDownload,
} = useDownloader({
  onContent(url: string) {
    const article = globalRowData.find(article => article.link === url);
    if (article) {
      article.contentDownload = true;
      article._status = '正常';
      updateRow(article);

      updateArticleStatus(url, '正常');

      // 修复之前代码逻辑错误导致的数据库状态被误设置为【已删除】
      article.is_deleted = false;
      articleDeleted(url, false);
    } else {
      console.warn(`${url} not found in table data when update contentDownload`);
    }
  },
  onStatusChange(url: string, status: string) {
    const article = globalRowData.find(article => article.link === url);
    if (article) {
      article._status = status;
      updateRow(article);

      updateArticleStatus(url, status);
    }
  },
  onDelete(url: string) {
    const article = globalRowData.find(article => article.link === url);
    if (article) {
      article.is_deleted = true;
      article._status = '已删除';
      updateRow(article);

      updateArticleStatus(url, '已删除');
      articleDeleted(url);
    }
  },
  onMetadata(url: string, metadata: Metadata) {
    const article = globalRowData.find(article => article.link === url);
    if (article) {
      article.readNum = metadata.readNum;
      article.oldLikeNum = metadata.oldLikeNum;
      article.shareNum = metadata.shareNum;
      article.likeNum = metadata.likeNum;
      article.commentNum = metadata.commentNum;

      if ((preferences.value as unknown as Preferences).downloadConfig.metadataOverrideContent) {
        // 如果同步下载文章内容，则更新相关字段
        article.contentDownload = true;
        article._status = '正常';
        updateArticleStatus(url, '正常');

        // 修复之前代码逻辑错误导致的数据库状态被误设置为【已删除】
        article.is_deleted = false;
        articleDeleted(url, false);
      }

      updateRow(article);
    } else {
      console.warn(`${url} not found in table data when update metadata`);
    }
  },
  onComment(url: string) {
    const article = globalRowData.find(article => article.link === url);
    if (article) {
      article.commentDownload = true;
      updateRow(article);
    } else {
      console.warn(`${url} not found in table data when update commentDownload`);
    }
  },
});

const {
  loading: exportBtnLoading,
  phase: exportPhase,
  completed_count: exportCompletedCount,
  total_count: exportTotalCount,
  exportFile,
} = useExporter();

const isDeletingAccountData = ref(false);
const accountActionLocked = computed(() =>
  isAccountActionLocked({
    autoSyncingBiz: autoSyncingBiz.value,
    manuallySyncing: accountSyncing.value,
    deleting: isDeletingAccountData.value,
  })
);

async function syncSelectedAccount() {
  const account = selectedAccount.value;
  if (!account || accountActionLocked.value) return;
  if (!account.credentialValid) {
    openGate({ fakeid: account.fakeid, refresh: true });
    return;
  }

  try {
    await runAccountOperation('manual-sync', account.fakeid, () =>
      runManualSyncAttempt({
        sync: () => syncAccount(account),
        markInitialized() {
          markCredentialInitialized(account.fakeid);
          clearAutoSyncError(account.fakeid);
        },
      })
    );
    await refreshAccountInfos();
    const rangeHint = isSyncAll() ? '' : `（同步范围：${getSyncRangeLabel()}）`;
    toast.success('同步完成', `已同步【${account.nickname}】${rangeHint}`);
  } catch (error: any) {
    if (error?.message === '已取消同步') {
      toast.warning('同步已停止', `已停止同步【${account.nickname}】`);
      return;
    }
    toast.error('同步失败', error?.message || '未知错误');
  }
}

function captureSelectedCredential() {
  if (accountActionLocked.value) return;
  openGate({ fakeid: selectedAccount.value?.fakeid, refresh: true });
}

function downloadSelectedArticles(type: 'html' | 'metadata' | 'comment') {
  const account = selectedAccount.value;
  if (!account || isDeletingAccountData.value) return;
  if (type !== 'html' && !account.credentialValid) {
    openGate({ fakeid: account.fakeid, refresh: true });
    return;
  }
  download(type, selectedArticleUrls.value);
}

type ArticleExportType = Parameters<typeof exportFile>[0];
function exportSelectedArticles(type: ArticleExportType, requiresContent = false) {
  if (!selectedAccount.value || isDeletingAccountData.value) return;
  exportFile(type, selectedArticleUrls.value, requiresContent ? contentNotDownloadedCount.value : undefined);
}

function deleteCurrentAccountData() {
  const account = selectedAccount.value;
  if (!account || accountActionLocked.value || downloadBtnLoading.value || exportBtnLoading.value) return;

  modal.open(ConfirmModal, {
    title: `删除【${account.nickname}】的本地数据？`,
    description: '已缓存的文章、留言、HTML 和资源将被清空；Credential 记录仍会保留在公众号列表中。',
    async onConfirm() {
      if (downloadBtnLoading.value || exportBtnLoading.value) {
        toast.warning('暂时无法删除', '请等待当前抓取或导出任务结束后重试');
        return;
      }

      try {
        isDeletingAccountData.value = true;
        await runAccountOperation('delete', account.fakeid, async () => {
          markCredentialInitialized(account.fakeid);
          await nextTick();
          await deleteAccountData([account.fakeid]);
          selectedArticles.value = [];
          await refreshAccountInfos();
          await switchTableData(account.fakeid);
        });
        toast.success('本地数据已删除', `已清空【${account.nickname}】的缓存`);
      } catch (error: any) {
        toast.error('删除失败', error?.message || '未知错误');
      } finally {
        isDeletingAccountData.value = false;
      }
    },
  });
}

async function debug() {
  const cache = await getDebugCache('https://mp.weixin.qq.com/s/0IEaqpJIBGykHFKqj-7xqw');
  console.log(cache);
  if (cache) {
    const html = await cache.file.text();
    console.log(html);
    const result = validateHTMLContent(html);
    console.log(result);
  }
}

const copied = ref(false);
function copyWechatLink() {
  const link = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${selectedAccount.value?.fakeid}&scene=124#wechat_redirect`;
  navigator.clipboard.writeText(link);

  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1000);
}
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">文章下载</h1>
    </Teleport>

    <div class="flex flex-col h-full divide-y divide-gray-200">
      <!-- 顶部筛选与操作区 -->
      <header class="flex flex-col gap-3 px-3 py-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div class="flex w-full flex-wrap items-center gap-2 2xl:w-auto">
          <AccountSelectorForArticle
            v-model="selectedAccount"
            :disabled="accountActionLocked"
            class="w-full sm:w-[26rem]"
          />

          <UButton
            v-if="accountSyncing"
            color="black"
            icon="i-lucide:square"
            class="active:scale-[0.98]"
            @click="stopAccountSync"
          >
            停止同步
          </UButton>
          <UButton
            v-else
            color="black"
            icon="i-lucide:refresh-cw"
            :loading="autoSyncingBiz !== null"
            :disabled="accountActionLocked || !selectedAccount || !selectedCredentialValid"
            class="active:scale-[0.98]"
            @click="syncSelectedAccount"
          >
            {{ autoSyncingBiz ? '首次同步最新一页' : '同步当前公众号' }}
          </UButton>

          <UButton
            v-if="selectedAccount && !selectedCredentialValid"
            color="gray"
            variant="soft"
            icon="i-lucide:shield-alert"
            :disabled="accountActionLocked"
            class="active:scale-[0.98]"
            @click="captureSelectedCredential"
          >
            更新 Credential
          </UButton>

          <UButton
            v-if="selectedAccount"
            color="rose"
            variant="soft"
            icon="i-lucide:trash-2"
            :loading="isDeletingAccountData"
            :disabled="accountActionLocked || downloadBtnLoading || exportBtnLoading"
            class="active:scale-[0.98]"
            @click="deleteCurrentAccountData"
          >
            删除本地数据
          </UButton>
        </div>

        <div class="flex w-full flex-wrap items-center gap-2 2xl:w-auto 2xl:justify-end">
          <UButton v-if="downloadBtnLoading" color="black" @click="stopDownload">停止</UButton>
          <ButtonGroup
            :items="[
              { label: '文章内容', event: 'download-article-html' },
              { label: '阅读量 (需要Credential)', event: 'download-article-metadata' },
              { label: '留言内容 (需要Credential)', event: 'download-article-comment' },
            ]"
            @download-article-html="downloadSelectedArticles('html')"
            @download-article-metadata="downloadSelectedArticles('metadata')"
            @download-article-comment="downloadSelectedArticles('comment')"
          >
            <UButton
              :loading="downloadBtnLoading"
              :disabled="!selectedAccount || isDeletingAccountData"
              color="white"
              class="font-mono"
              :label="downloadBtnLoading ? `抓取中 ${downloadCompletedCount}/${downloadTotalCount}` : '抓取'"
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
            @export-article-excel="exportSelectedArticles('excel')"
            @export-article-json="exportSelectedArticles('json')"
            @export-article-html="exportSelectedArticles('html', true)"
            @export-article-text="exportSelectedArticles('text', true)"
            @export-article-markdown="exportSelectedArticles('markdown', true)"
            @export-article-word="exportSelectedArticles('word', true)"
            @export-article-pdf="exportSelectedArticles('pdf', true)"
          >
            <UButton
              :loading="exportBtnLoading"
              :disabled="!selectedAccount || isDeletingAccountData"
              color="white"
              class="font-mono"
              :label="exportBtnLoading ? `${exportPhase} ${exportCompletedCount}/${exportTotalCount}` : '导出'"
              trailing-icon="i-heroicons-chevron-down-20-solid"
            />
          </ButtonGroup>

          <UButton
            :disabled="!selectedAccount"
            :icon="copied ? 'i-lucide:check' : 'i-heroicons-link-16-solid'"
            label="复制公众号链接"
            :color="copied ? 'green' : 'blue'"
            @click="copyWechatLink"
          />
          <UButton v-if="isDev" @click="debug">调试</UButton>
        </div>
      </header>

      <div v-if="!selectedAccount" class="flex flex-1 items-center px-6 py-12 sm:px-12">
        <div class="max-w-xl border-l-2 border-slate-300 pl-6 dark:border-slate-700">
          <UIcon name="i-lucide:radio-tower" class="size-8 text-slate-400" />
          <h2 class="mt-4 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            打开一篇微信公众号文章
          </h2>
          <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            平台捕获 Credential 后，会自动识别公众号名称、同步最新一页文章，并直接显示在这里。
          </p>
          <UButton
            color="black"
            icon="i-lucide:shield-check"
            :disabled="accountActionLocked"
            class="mt-5 active:scale-[0.98]"
            @click="captureSelectedCredential"
          >
            开始获取 Credential
          </UButton>
        </div>
      </div>

      <ag-grid-vue
        v-else
        class="min-h-0 flex-1"
        style="width: 100%; height: 100%"
        :loading="loading"
        :rowData="globalRowData"
        :columnDefs="columnDefs"
        :gridOptions="gridOptions"
        @grid-ready="onGridReady"
        @filter-changed="onFilterChanged"
        @column-moved="onColumnStateChange"
        @column-visible="onColumnStateChange"
        @column-pinned="onColumnStateChange"
        @column-resized="onColumnStateChange"
        @selection-changed="onSelectionChanged"
      ></ag-grid-vue>
    </div>

    <PreviewArticle ref="previewArticleRef" />
  </div>
</template>
