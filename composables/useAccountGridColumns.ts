import type { ColDef, ICellRendererParams, ValueGetterParams } from 'ag-grid-community';
import { formatTimeStamp } from '#shared/utils/helpers';
import GridAccountActions from '~/components/grid/AccountActions.vue';
import GridLoadProgress from '~/components/grid/LoadProgress.vue';
import { IMAGE_PROXY } from '~/config';
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';

interface AccountGridColumnOptions {
  isDeleting: Ref<boolean>;
  isSyncing: Ref<boolean>;
  syncingRowId: Ref<string | null>;
  onSync: (params: ICellRendererParams) => void;
  onStop: (params: ICellRendererParams) => void;
}

export default function useAccountGridColumns(options: AccountGridColumnOptions) {
  return ref<ColDef[]>([
    {
      colId: 'fakeid',
      headerName: 'fakeid',
      field: 'fakeid',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      minWidth: 200,
      cellClass: 'font-mono',
      initialHide: true,
    },
    {
      colId: 'round_head_img',
      headerName: '头像',
      field: 'round_head_img',
      sortable: false,
      filter: false,
      cellRenderer: (params: ICellRendererParams) =>
        `<img alt="" src="${IMAGE_PROXY + params.value}" style="height: 30px; width: 30px; object-fit: cover; border: 1px solid #e5e7eb; border-radius: 100%;" />`,
      cellClass: 'flex justify-center items-center',
      minWidth: 80,
    },
    {
      colId: 'nickname',
      headerName: '名称',
      field: 'nickname',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      tooltipField: 'nickname',
      minWidth: 200,
    },
    {
      colId: 'create_time',
      headerName: '添加时间',
      field: 'create_time',
      valueFormatter: params => (params.value ? formatTimeStamp(params.value) : ''),
      filter: 'agDateColumnFilter',
      filterParams: createDateColumnFilterParams(),
      filterValueGetter: (params: ValueGetterParams) => new Date(params.getValue('create_time') * 1000),
      sort: 'desc',
      minWidth: 180,
      initialHide: true,
      cellClass: 'flex justify-center items-center font-mono',
    },
    {
      colId: 'update_time',
      headerName: '最后同步时间',
      field: 'update_time',
      valueFormatter: params => (params.value ? formatTimeStamp(params.value) : ''),
      filter: 'agDateColumnFilter',
      filterParams: createDateColumnFilterParams(),
      filterValueGetter: (params: ValueGetterParams) => new Date(params.getValue('update_time') * 1000),
      minWidth: 180,
      cellClass: 'flex justify-center items-center font-mono',
    },
    {
      colId: 'total_count',
      headerName: '消息总数',
      field: 'total_count',
      cellDataType: 'number',
      cellRenderer: 'agAnimateShowChangeCellRenderer',
      filter: 'agNumberColumnFilter',
      cellClass: 'flex justify-center items-center font-mono',
      minWidth: 150,
    },
    {
      colId: 'count',
      headerName: '已同步消息数',
      field: 'count',
      cellDataType: 'number',
      cellRenderer: 'agAnimateShowChangeCellRenderer',
      filter: 'agNumberColumnFilter',
      cellClass: 'flex justify-center items-center font-mono',
      minWidth: 180,
    },
    {
      colId: 'articles',
      headerName: '已同步文章数',
      field: 'articles',
      cellDataType: 'number',
      cellRenderer: 'agAnimateShowChangeCellRenderer',
      filter: 'agNumberColumnFilter',
      cellClass: 'flex justify-center items-center font-mono',
      minWidth: 180,
      initialHide: true,
    },
    {
      colId: 'load_percent',
      headerName: '同步进度',
      valueGetter: params => (params.data.total_count === 0 ? 0 : params.data.count / params.data.total_count),
      cellDataType: 'number',
      cellRenderer: GridLoadProgress,
      filter: 'agNumberColumnFilter',
      minWidth: 200,
    },
    {
      colId: 'completed',
      headerName: '是否同步完成',
      field: 'completed',
      cellDataType: 'boolean',
      filter: 'agSetColumnFilter',
      filterParams: createBooleanColumnFilterParams('已同步完成', '未同步完成'),
      cellClass: 'flex justify-center items-center',
      headerClass: 'justify-center',
      minWidth: 200,
    },
    {
      colId: 'action',
      headerName: '操作',
      field: 'fakeid',
      sortable: false,
      filter: false,
      cellRenderer: GridAccountActions,
      cellRendererParams: {
        onSync: options.onSync,
        onStop: options.onStop,
        isDeleting: options.isDeleting,
        isSyncing: options.isSyncing,
        syncingRowId: options.syncingRowId,
      },
      cellClass: 'flex justify-center items-center',
      maxWidth: 100,
      pinned: 'right',
    },
  ]);
}
