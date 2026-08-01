<script setup lang="ts">
import type { GetRowIdParams, GridApi, GridOptions, GridReadyEvent, SelectionChangedEvent } from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import { defu } from 'defu';
import { getArticleList } from '~/apis';
import ConfirmModal from '~/components/modal/Confirm.vue';
import CredentialAccountPicker from '~/components/modal/CredentialAccountPicker.vue';
import toastFactory from '~/composables/toast';
import useAccountGridColumns from '~/composables/useAccountGridColumns';
import useCredentialGate from '~/composables/useCredentialGate';
import { websiteName } from '~/config';
import { sharedGridOptions } from '~/config/shared-grid-options';
import { deleteAccountData } from '~/store/v2';
import { getArticleCache, hitCache } from '~/store/v2/article';
import { getAllInfo, getInfoCache, importMpAccounts, type MpAccount } from '~/store/v2/info';
import type { AccountManifest } from '~/types/account';
import type { Preferences } from '~/types/preferences';
import { exportAccountJsonFile } from '~/utils/exporter';

useHead({
  title: `公众号管理 | ${websiteName}`,
});

interface PromiseInstance {
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}

const toast = toastFactory();
const modal = useModal();

const { getSyncTimestamp, getSyncRangeLabel, isSyncAll } = useSyncDeadline();
const syncToTimestamp = getSyncTimestamp();

const preferences = usePreferences();

// 账号事件总线，用于和 Credentials 面板保持列表同步
const { accountEventBus } = useAccountEventBus();
accountEventBus.on(event => {
  if (event === 'account-added' || event === 'account-removed') {
    refresh();
  }
});

const { requireCredential } = useCredentialGate();
async function addAccount() {
  if (await requireCredential()) {
    modal.open(CredentialAccountPicker);
  }
}

// 表示同步过程中是否执行了取消操作
const isCanceled = ref(false);
const isDeleting = ref(false);
const isSyncing = ref(false);

// 当前正在同步的公众号id
const syncingRowId = ref<string | null>(null);

const syncTimer = ref<number | null>(null);

async function _load(account: MpAccount, begin: number, loadMore: boolean, promise: PromiseInstance) {
  if (isCanceled.value) {
    isCanceled.value = false; // 这里需要将状态复位
    promise.reject(new Error('已取消同步'));
    return;
  }

  syncingRowId.value = account.fakeid;
  isSyncing.value = true;

  const [articles, completed, , nextBegin] = await getArticleList(account, begin);
  if (isCanceled.value) {
    isCanceled.value = false;
    promise.reject(new Error('已取消同步'));
    return;
  }
  if (completed) {
    await updateRow(account.fakeid);
    syncingRowId.value = null;
    isSyncing.value = false;
    promise.resolve(account);
    return;
  }

  begin = nextBegin;

  // 检查是否可以「快进」，也就是存在比 lastArticle 更早的缓存数据
  // todo: 这里还可以继续优化，防止出现多段不连续的范围
  const lastArticle = articles.at(-1);
  if (lastArticle && lastArticle.create_time < account.last_update_time!) {
    if (await hitCache(account.fakeid, lastArticle.create_time)) {
      const cachedArticles = await getArticleCache(account.fakeid, lastArticle.create_time);

      // 更新 begin 参数
      const count = cachedArticles.filter(article => article.itemidx === 1).length;
      begin += count;
      articles.push(...cachedArticles);
    }
  }

  const oldestArticle = articles.at(-1);
  if (oldestArticle && oldestArticle.create_time < syncToTimestamp) {
    // 已同步到配置的时间范围
    loadMore = false;
  }

  await updateRow(account.fakeid);
  if (loadMore) {
    syncTimer.value = window.setTimeout(
      () => {
        if (isCanceled.value) {
          console.warn('已取消同步');
          isCanceled.value = false;
          promise.reject(new Error('已取消同步'));
          return;
        }
        _load(account, begin, true, promise);
      },
      ((preferences.value as unknown as Preferences).accountSyncSeconds || 5) * 1000
    );
  } else {
    syncingRowId.value = null;
    isSyncing.value = false;
    promise.resolve(account);
  }
}

// 同步指定公众号
async function loadAccountArticle(account: MpAccount, loadMore = true) {
  return new Promise((resolve, reject) => {
    const promise: PromiseInstance = { resolve, reject };

    _load(account, 0, loadMore, promise).catch(e => {
      syncingRowId.value = null;
      isSyncing.value = false;

      reject(e);
    });
  });
}

// 同步所有公众号
async function loadSelectedAccountArticle() {
  isCanceled.value = false;

  try {
    const rows = getSelectedRows();
    for (const account of rows) {
      await loadAccountArticle(account);
    }
    const rangeHint = isSyncAll() ? '' : `（同步范围：${getSyncRangeLabel()}）`;
    toast.success('同步完成', `已成功同步 ${rows.length} 个公众号${rangeHint}`);
  } catch (e: any) {
    toast.error('同步失败', e.message);
  }
}

let globalRowData: MpAccount[] = [];

const columnDefs = useAccountGridColumns({
  isDeleting,
  isSyncing,
  syncingRowId,
  onSync: params => {
    isCanceled.value = false;
    loadAccountArticle(params.data)
      .then(() => {
        const rangeHint = isSyncAll() ? '' : `（同步范围：${getSyncRangeLabel()}）`;
        toast.success('同步完成', `公众号【${params.data.nickname}】的文章已同步完毕${rangeHint}`);
      })
      .catch(e => {
        toast.error('同步失败', e.message);
      });
  },
  onStop: () => {
    isCanceled.value = true;
    if (syncTimer.value) {
      window.clearTimeout(syncTimer.value);
      syncTimer.value = null;
    }

    syncingRowId.value = null;
    isSyncing.value = false;
  },
});

// 注意，`defu`函数最左边的参数优先级最高
const gridOptions: GridOptions = defu(
  {
    getRowId: (params: GetRowIdParams) => String(params.data.fakeid),
  },
  sharedGridOptions
);

const gridApi = shallowRef<GridApi | null>(null);
function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;

  restoreColumnState();
  refresh();
}

function onColumnStateChange() {
  if (gridApi.value) {
    saveColumnState();
  }
}
function saveColumnState() {
  const state = gridApi.value?.getColumnState();
  localStorage.setItem('agGridColumnState-account', JSON.stringify(state));
}

function restoreColumnState() {
  const stateStr = localStorage.getItem('agGridColumnState-account');
  if (stateStr) {
    const state = JSON.parse(stateStr);
    gridApi.value?.applyColumnState({
      state,
      applyOrder: true,
    });
  }
}

async function refresh() {
  globalRowData = await getAllInfo();
  gridApi.value?.setGridOption('rowData', globalRowData);
}

async function updateRow(fakeid: string) {
  const rowNode = gridApi.value?.getRowNode(fakeid);
  if (rowNode) {
    const info = await getInfoCache(fakeid);
    rowNode.updateData(info);
  }
}

// 当前是否有选中的行
const hasSelectedRows = ref(false);
function onSelectionChanged(evt: SelectionChangedEvent) {
  hasSelectedRows.value = (evt.selectedNodes?.map(node => node.data) || []).length > 0;
}
function getSelectedRows() {
  const rows: MpAccount[] = [];
  gridApi.value?.forEachNodeAfterFilterAndSort(node => {
    if (node.isSelected()) {
      rows.push(node.data);
    }
  });
  return rows;
}

// 删除所选的公众号数据
function deleteSelectedAccounts() {
  const rows = getSelectedRows();
  const ids = rows.map(info => info.fakeid);
  modal.open(ConfirmModal, {
    title: '确定要删除所选公众号的数据吗？',
    description: '删除之后，该公众号的所有数据(包括已下载的文章和留言等)都将被清空。',
    async onConfirm() {
      try {
        isDeleting.value = true;
        await deleteAccountData(ids);
        // 通知 Credentials 面板这些公众号已被移除
        ids.forEach(fakeid => accountEventBus.emit('account-removed', { fakeid: fakeid }));
      } finally {
        isDeleting.value = false;
        await refresh();
      }
    },
  });
}

// 导入公众号
const fileRef = ref<HTMLInputElement | null>(null);
const importBtnLoading = ref(false);
function importAccount() {
  fileRef.value!.click();
}
async function handleFileChange(evt: Event) {
  const files = (evt.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    const file = files[0];

    try {
      importBtnLoading.value = true;

      // 解析 JSON
      const jsonData = JSON.parse(await file.text());
      if (jsonData.usefor !== 'wechat-article-exporter') {
        // 文件格式不正确
        toast.error('导入公众号失败', '导入文件格式不正确，请选择该网站导出的文件进行导入。');
        return;
      }
      const infos = jsonData.accounts;
      if (!infos || infos.length <= 0) {
        // 文件格式不正确
        toast.error('导入公众号失败', '导入文件格式不正确，请选择该网站导出的文件进行导入。');
        return;
      }

      await importMpAccounts(infos);
      await refresh();
    } catch (error) {
      console.error('导入公众号时 JSON 解析失败:', error);
      toast.error('导入公众号', (error as Error).message);
    } finally {
      importBtnLoading.value = false;
    }
  }
}

// 导出公众号
const exportBtnLoading = ref(false);
function exportAccount() {
  exportBtnLoading.value = true;
  try {
    const rows = getSelectedRows();
    const data: AccountManifest = {
      version: '1.0',
      usefor: 'wechat-article-exporter',
      accounts: rows,
    };
    exportAccountJsonFile(data, '公众号');
    toast.success('导出公众号', `成功导出了 ${rows.length} 个公众号`);
  } finally {
    exportBtnLoading.value = false;
  }
}

const { getActualDateRange } = useSyncDeadline();
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">公众号管理</h1>
    </Teleport>

    <div class="flex flex-col h-full divide-y divide-gray-200">
      <!-- 顶部操作区 -->
      <header class="flex items-stretch gap-3 px-3 py-3">
        <UButton icon="i-lucide:user-plus" color="blue" :disabled="isDeleting" @click="addAccount">
          添加
        </UButton>
        <UButton icon="i-lucide:arrow-down-to-line" color="blue" :loading="importBtnLoading" @click="importAccount">
          批量导入
          <input ref="fileRef" type="file" accept=".json" class="hidden" @change="handleFileChange" />
        </UButton>
        <UButton
          icon="i-lucide:arrow-up-from-line"
          color="blue"
          :loading="exportBtnLoading"
          :disabled="!hasSelectedRows"
          @click="exportAccount"
        >
          批量导出
        </UButton>
        <UButton
          color="rose"
          icon="i-lucide:user-minus"
          class="disabled:opacity-35"
          :loading="isDeleting"
          :disabled="!hasSelectedRows"
          @click="deleteSelectedAccounts"
          >删除</UButton
        >
        <UButton
          color="black"
          icon="i-heroicons:arrow-path-rounded-square-20-solid"
          class="disabled:opacity-35"
          :loading="isSyncing"
          :disabled="isDeleting || !hasSelectedRows"
          @click="loadSelectedAccountArticle"
          >同步</UButton
        >
        <div class="hidden xl:flex flex-1 justify-end">
          <span class="self-end text-sm text-blue-500 font-medium">同步范围: {{ getActualDateRange() }}</span>
        </div>
      </header>

      <!-- 数据表格 -->
      <ag-grid-vue
        style="width: 100%; height: 100%"
        :rowData="globalRowData"
        :columnDefs="columnDefs"
        :gridOptions="gridOptions"
        @grid-ready="onGridReady"
        @selection-changed="onSelectionChanged"
        @column-moved="onColumnStateChange"
        @column-visible="onColumnStateChange"
        @column-pinned="onColumnStateChange"
        @column-resized="onColumnStateChange"
      ></ag-grid-vue>
    </div>
  </div>
</template>
