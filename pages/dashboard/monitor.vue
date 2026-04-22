<script setup lang="ts">
import dayjs from 'dayjs';
import { getAccountList } from '~/apis';
import CommentPreviewPopover from '~/components/dashboard/CommentPreviewPopover.vue';
import useAccountDiscovery from '~/composables/useAccountDiscovery';
import useCommentMonitor from '~/composables/useCommentMonitor';
import useMonitor from '~/composables/useMonitor';
import { websiteName } from '~/config';
import type { CommentMonitorTask } from '~/store/v2/commentMonitorTask';
import type { AccountInfo } from '~/types/types';

useHead({
  title: `文章监控 | ${websiteName}`,
});

const { monitoring, credentials } = useMonitor();
const {
  watches,
  discovering,
  enabledCount,
  addWatch,
  removeWatch,
  toggleWatch,
  startDiscovery,
  stopDiscovery,
  refreshWatches,
  MAX_WATCH_COUNT,
} = useAccountDiscovery();
const {
  tasks,
  monitoring: commentMonitoring,
  awaitingCredentialCount,
  awaitingByAccount,
  addManualArticle,
  removeTask,
  retryTask,
  toggleAutoTrack,
  fetchTaskComments,
  exportMarkdown,
  exportPdf,
  startMonitor,
  stopMonitor,
  refreshTasks,
} = useCommentMonitor();

const validCredentials = computed(() => credentials.value.filter(c => c.valid));

const fetchingCommentTaskId = ref<number | null>(null);
const exportingTaskKey = ref('');

async function onFetchComments(taskId: number) {
  fetchingCommentTaskId.value = taskId;
  try {
    await fetchTaskComments(taskId);
  } finally {
    fetchingCommentTaskId.value = null;
  }
}

async function onExportTask(task: CommentMonitorTask, type: 'markdown' | 'pdf') {
  const key = `${type}:${task.id}`;
  exportingTaskKey.value = key;
  try {
    if (type === 'markdown') {
      await exportMarkdown(task);
    } else {
      await exportPdf(task);
    }
  } catch (e) {
    console.error(e);
  } finally {
    exportingTaskKey.value = '';
  }
}

const manualArticleUrl = ref('');
const addingManual = ref(false);

async function onAddManualArticle() {
  if (!manualArticleUrl.value.trim()) return;
  addingManual.value = true;
  try {
    await addManualArticle(manualArticleUrl.value.trim());
    manualArticleUrl.value = '';
  } finally {
    addingManual.value = false;
  }
}

const searchKeyword = ref('');
const searchResults = ref<AccountInfo[]>([]);
const searching = ref(false);
const showSearch = ref(false);

async function searchAccount() {
  if (!searchKeyword.value.trim()) return;
  searching.value = true;
  try {
    const [list] = await getAccountList(0, searchKeyword.value);
    searchResults.value = list;
  } catch (e) {
    console.error(e);
  } finally {
    searching.value = false;
  }
}

async function onAddAccount(account: AccountInfo) {
  await addWatch({
    fakeid: account.fakeid,
    nickname: account.nickname,
    round_head_img: account.round_head_img,
  });
  showSearch.value = false;
  searchKeyword.value = '';
  searchResults.value = [];
}

type BadgeColor = 'sky' | 'orange' | 'violet' | 'green' | 'rose' | 'gray' | 'amber';

function getStatusLabel(status: CommentMonitorTask['status']): { label: string; color: BadgeColor } {
  const map: Record<CommentMonitorTask['status'], { label: string; color: BadgeColor }> = {
    tracking: { label: '追踪中', color: 'sky' },
    awaiting_credential: { label: '等待凭证', color: 'amber' },
    final_collecting: { label: '最终采集中', color: 'orange' },
    exporting: { label: '导出中', color: 'violet' },
    done: { label: '已完成', color: 'green' },
    error: { label: '异常', color: 'rose' },
  };
  return map[status] ?? { label: status, color: 'gray' };
}

const NOTIFY_DISMISS_KEY = 'notification-prompt-dismissed';
const notificationPermission = ref<NotificationPermission | 'unsupported'>('unsupported');
const notifyPromptDismissed = useLocalStorage(NOTIFY_DISMISS_KEY, '');
const showNotifyPrompt = computed(
  () => notificationPermission.value === 'default' && !notifyPromptDismissed.value
);

async function onRequestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  try {
    const result = await Notification.requestPermission();
    notificationPermission.value = result;
  } catch (err) {
    console.warn('[monitor] requestPermission failed:', err);
  } finally {
    notifyPromptDismissed.value = '1';
  }
}

function getTrackingProgress(task: CommentMonitorTask) {
  const elapsed = Math.min(Date.now() - task.created_at, task.tracking_end_at - task.created_at);
  const total = task.tracking_end_at - task.created_at;
  return Math.round((elapsed / total) * 100);
}

function getRemainingTimeText(task: CommentMonitorTask) {
  const remainMs = Math.max(0, task.tracking_end_at - Date.now());
  const remainMin = Math.ceil(remainMs / 60000);
  if (remainMin <= 0) return '即将完成';
  const h = Math.floor(remainMin / 60);
  const m = remainMin % 60;
  return h > 0 ? `剩余 ${h}h${m}min` : `剩余 ${m}min`;
}

const DISCOVERY_WINDOW_MS = 1.5 * 60 * 60 * 1000;

function getRecentDiscoveredCount(fakeid: string) {
  const since = Date.now() - DISCOVERY_WINDOW_MS;
  return tasks.value.filter(t => t.source === 'auto' && t.source_fakeid === fakeid && t.created_at >= since).length;
}

function getDiscoveryHint(w: (typeof watches.value)[number]) {
  if (!w.last_check_time) return '等待首次检查';
  const checkedAt = dayjs(w.last_check_time).format('MM-DD HH:mm:ss');
  const recent = getRecentDiscoveredCount(w.fakeid);
  return `${checkedAt} · 近1.5h 发现 ${recent} 篇`;
}

let refreshInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  refreshInterval = setInterval(() => {
    if (discovering.value) refreshWatches();
    if (commentMonitoring.value) refreshTasks();
  }, 10000);
  if (typeof Notification !== 'undefined') {
    notificationPermission.value = Notification.permission;
  }
});
onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
});
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">文章监控</h1>
    </Teleport>

    <div class="flex flex-col h-full divide-y divide-gray-200 dark:divide-slate-700">
      <!-- 顶部状态条 -->
      <header class="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
        <div class="flex items-center gap-4 text-sm">
          <!-- 公众号发现状态 -->
          <div class="flex items-center gap-1.5">
            <template v-if="discovering">
              <span class="relative flex items-center justify-center w-2.5 h-2.5">
                <span class="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span class="text-emerald-600 dark:text-emerald-400 font-medium">发现中</span>
              <span class="text-slate-400 font-mono">· {{ enabledCount }} 个公众号</span>
            </template>
            <template v-else-if="watches.length > 0">
              <span class="w-2 h-2 rounded-full bg-amber-500" />
              <span class="text-amber-600 dark:text-amber-400 font-medium">发现已停</span>
            </template>
            <template v-else>
              <span class="w-2 h-2 rounded-full bg-slate-300" />
              <span class="text-slate-500">尚未添加公众号</span>
            </template>
          </div>

          <span class="text-slate-300">|</span>

          <!-- 评论监控状态 -->
          <div class="flex items-center gap-1.5">
            <template v-if="commentMonitoring">
              <span class="relative flex items-center justify-center w-2.5 h-2.5">
                <span class="absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-60 animate-ping" />
                <span class="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
              </span>
              <span class="text-sky-600 dark:text-sky-400 font-medium">评论监控中</span>
              <span class="text-slate-400 font-mono">· {{ tasks.length }} 个任务</span>
            </template>
            <template v-else-if="tasks.length > 0">
              <span class="w-2 h-2 rounded-full bg-amber-500" />
              <span class="text-amber-600 dark:text-amber-400 font-medium">评论监控已停</span>
            </template>
            <template v-else>
              <span class="w-2 h-2 rounded-full bg-slate-300" />
              <span class="text-slate-500">尚无评论任务</span>
            </template>
          </div>

          <template v-if="awaitingCredentialCount > 0">
            <span class="text-slate-300">|</span>
            <UPopover mode="hover" :open-delay="100" :close-delay="200" :popper="{ placement: 'bottom-start' }">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 cursor-help"
              >
                <UIcon name="i-lucide:alert-triangle" class="text-sm" />
                <span class="font-mono">{{ awaitingCredentialCount }}</span>
                <span>篇等 cred</span>
              </span>
              <template #panel>
                <div class="p-3 min-w-[220px] space-y-1">
                  <p class="text-xs text-slate-500 mb-1">等待凭证的公众号</p>
                  <div
                    v-for="entry in awaitingByAccount"
                    :key="entry.fakeid"
                    class="flex items-center justify-between gap-3 text-sm"
                  >
                    <span class="truncate">【{{ entry.nickname }}】</span>
                    <span class="font-mono text-amber-600 dark:text-amber-400">{{ entry.count }} 篇</span>
                  </div>
                  <p class="text-[11px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-700 mt-1">
                    在手机微信打开任一篇该公众号文章即可自动恢复
                  </p>
                </div>
              </template>
            </UPopover>
          </template>

          <span v-if="monitoring" class="text-xs text-slate-400">系统运行中</span>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            v-if="showNotifyPrompt"
            size="xs"
            variant="soft"
            color="amber"
            icon="i-lucide:bell"
            @click="onRequestNotificationPermission"
          >
            开启系统通知
          </UButton>
          <UButton icon="i-lucide:plus" color="black" @click="showSearch = true">
            添加公众号
          </UButton>
        </div>
      </header>

      <!-- 主内容区 -->
      <div class="flex-1 overflow-y-auto">
        <div class="max-w-8xl mx-auto px-6 py-6 space-y-10">
          <!-- 公众号监控 -->
          <section>
            <div class="flex items-baseline justify-between mb-3">
              <div class="flex items-center gap-3">
                <h2 class="text-base font-semibold text-slate-900 dark:text-slate-100">公众号监控</h2>
                <span class="text-xs text-slate-400 font-mono">{{ watches.length }} / {{ MAX_WATCH_COUNT }}</span>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  v-if="discovering"
                  size="xs"
                  icon="i-lucide:square"
                  color="rose"
                  variant="soft"
                  @click="stopDiscovery()"
                >
                  暂停发现
                </UButton>
                <UButton
                  v-else-if="watches.length > 0"
                  size="xs"
                  icon="i-lucide:play"
                  color="blue"
                  @click="startDiscovery()"
                >
                  恢复发现
                </UButton>
              </div>
            </div>
            <p class="text-xs text-slate-400 mb-3">每 5 分钟检查一次，仅识别近 1.5 小时内发布的文章为"新文章"，自动接入评论监控。</p>

            <div
              v-if="watches.length === 0"
              class="flex flex-col items-center justify-center py-12 px-4 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-center"
            >
              <UIcon name="i-lucide:radar" class="text-3xl text-slate-300 mb-2" />
              <p class="text-sm text-slate-500 mb-3">暂无监控公众号</p>
              <UButton size="sm" color="black" variant="soft" @click="showSearch = true">立即添加</UButton>
            </div>

            <div
              v-else
              class="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-900"
            >
              <div v-for="w in watches" :key="w.fakeid" class="flex items-center gap-4 px-4 py-3">
                <img :src="w.round_head_img" class="w-10 h-10 rounded-full object-cover" />
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-sm truncate">{{ w.nickname }}</p>
                  <p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                    <UIcon name="i-lucide:activity" class="text-slate-400" />
                    <span class="font-mono">{{ w.check_count ?? 0 }}</span>
                    <span>次检查</span>
                    <span class="text-slate-300">·</span>
                    <span class="font-mono">{{ getDiscoveryHint(w) }}</span>
                  </p>
                </div>
                <UToggle
                  :model-value="w.enabled"
                  @update:model-value="toggleWatch(w.fakeid, $event)"
                />
                <UButton
                  size="xs"
                  icon="i-lucide:trash-2"
                  color="rose"
                  variant="ghost"
                  @click="removeWatch(w.fakeid)"
                />
              </div>
            </div>
          </section>

          <!-- 文章评论监控 -->
          <section>
            <div class="flex items-baseline justify-between mb-3">
              <div class="flex items-center gap-3">
                <h2 class="text-base font-semibold text-slate-900 dark:text-slate-100">文章评论监控</h2>
                <span class="text-xs text-slate-400 font-mono">{{ tasks.length }} 个任务</span>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  v-if="commentMonitoring"
                  size="xs"
                  icon="i-lucide:square"
                  color="rose"
                  variant="soft"
                  @click="stopMonitor()"
                >
                  暂停监控
                </UButton>
                <UButton
                  v-else-if="tasks.length > 0"
                  size="xs"
                  icon="i-lucide:play"
                  color="blue"
                  @click="startMonitor()"
                >
                  恢复监控
                </UButton>
              </div>
            </div>
            <p class="text-xs text-slate-400 mb-3">每 1 分钟刷新一次评论，每条任务持续 1.5 小时；到期自动最终采集并导出 Markdown / PDF。</p>

            <!-- 手动添加文章 -->
            <div class="flex gap-2 mb-4">
              <UInput
                v-model="manualArticleUrl"
                placeholder="粘贴公众号文章链接，手动加入评论监控"
                icon="i-lucide:link"
                class="flex-1"
                @keyup.enter="onAddManualArticle"
              />
              <UButton color="black" :loading="addingManual" @click="onAddManualArticle">添加文章</UButton>
            </div>

            <div
              v-if="tasks.length === 0"
              class="flex flex-col items-center justify-center py-16 px-4 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-center"
            >
              <UIcon name="i-lucide:inbox" class="text-3xl text-slate-300 mb-2" />
              <p class="text-sm text-slate-500">暂无评论监控任务</p>
              <p class="text-xs text-slate-400 mt-1">手动添加或等待公众号检测到新文章自动入队</p>
            </div>

            <div
              v-else
              class="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-900"
            >
              <div v-for="task in tasks" :key="task.id" class="px-4 py-4">
                <!-- 标题行 -->
                <div class="flex items-start justify-between gap-4">
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm truncate">{{ task.article_title }}</p>
                    <p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                      <UBadge
                        :color="task.source === 'auto' ? 'sky' : 'gray'"
                        variant="subtle"
                        size="xs"
                      >
                        {{ task.source === 'auto' ? '自动' : '手动' }}
                      </UBadge>
                      <span>{{ task.nickname }}</span>
                      <span class="text-slate-300">·</span>
                      <span class="font-mono">{{ dayjs(task.created_at).format('MM-DD HH:mm') }}</span>
                      <template v-if="task.last_sync_at">
                        <span class="text-slate-300">·</span>
                        <span class="font-mono">上次刷新 {{ dayjs(task.last_sync_at).format('HH:mm:ss') }}</span>
                      </template>
                    </p>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <UBadge :color="getStatusLabel(task.status).color" variant="subtle" size="xs">
                      {{ getStatusLabel(task.status).label }}
                    </UBadge>
                    <UButton
                      size="xs"
                      icon="i-lucide:trash-2"
                      color="rose"
                      variant="ghost"
                      @click="removeTask(task.id!)"
                    />
                  </div>
                </div>

                <!-- 追踪进度条（tracking / awaiting_credential 共用） -->
                <div
                  v-if="task.status === 'tracking' || task.status === 'awaiting_credential'"
                  class="mt-3 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
                >
                  <div
                    class="h-full transition-all duration-500"
                    :class="task.status === 'awaiting_credential' ? 'bg-amber-500' : 'bg-sky-500'"
                    :style="{ width: `${getTrackingProgress(task)}%` }"
                  />
                </div>

                <!-- 等待凭证 -->
                <div
                  v-if="task.status === 'awaiting_credential'"
                  class="mt-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <p class="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 max-w-xl">
                    <UIcon name="i-lucide:alert-triangle" class="flex-shrink-0" />
                    <span>该公众号暂无可用凭证，请到手机微信打开一篇该公众号文章；凭证到达后自动恢复</span>
                    <span class="text-slate-300">·</span>
                    <span class="text-slate-500 font-mono">{{ getRemainingTimeText(task) }}</span>
                  </p>
                  <UButton
                    size="xs"
                    variant="outline"
                    color="amber"
                    icon="i-lucide:rotate-ccw"
                    :loading="fetchingCommentTaskId === task.id"
                    @click="onFetchComments(task.id!)"
                  >
                    立即重试
                  </UButton>
                </div>

                <!-- 追踪中：状态 + 操作 -->
                <div
                  v-if="task.status === 'tracking'"
                  class="mt-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div class="flex items-center gap-2 text-xs">
                    <UToggle
                      :model-value="task.auto_track_enabled !== false"
                      size="2xs"
                      @update:model-value="toggleAutoTrack(task.id!, $event)"
                    />
                    <span :class="task.auto_track_enabled === false ? 'text-amber-500' : 'text-slate-500'">
                      <template v-if="task.auto_track_enabled === false">自动抓取已暂停</template>
                      <template v-else-if="(task.accumulated_comments ?? []).length === 0">
                        累积 0 条
                      </template>
                      <UPopover
                        v-else
                        mode="hover"
                        :open-delay="100"
                        :close-delay="200"
                        :popper="{ placement: 'top' }"
                      >
                        <span class="cursor-help underline decoration-dotted decoration-slate-400 underline-offset-2">
                          累积 {{ task.accumulated_comments.length }} 条
                        </span>
                        <template #panel>
                          <CommentPreviewPopover :comments="task.accumulated_comments" />
                        </template>
                      </UPopover>
                    </span>
                    <span class="text-slate-300">·</span>
                    <span class="text-slate-500 font-mono">{{ getRemainingTimeText(task) }}</span>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <UButton
                      size="xs"
                      variant="outline"
                      color="gray"
                      icon="i-lucide:message-square"
                      :loading="fetchingCommentTaskId === task.id"
                      @click="onFetchComments(task.id!)"
                    >
                      获取评论
                    </UButton>
                    <UButton
                      size="xs"
                      variant="outline"
                      color="gray"
                      icon="i-lucide:file-text"
                      :loading="exportingTaskKey === `markdown:${task.id}`"
                      @click="onExportTask(task, 'markdown')"
                    >
                      Markdown
                    </UButton>
                    <UButton
                      size="xs"
                      variant="outline"
                      color="gray"
                      icon="i-lucide:file-type-2"
                      :loading="exportingTaskKey === `pdf:${task.id}`"
                      @click="onExportTask(task, 'pdf')"
                    >
                      PDF
                    </UButton>
                  </div>
                </div>

                <!-- 已完成：结果 -->
                <div
                  v-if="task.status === 'done'"
                  class="mt-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div class="text-sm flex items-center gap-2">
                    <template v-if="(task.shielded_comments ?? []).length > 0">
                      <UIcon name="i-lucide:shield-alert" class="text-rose-500" />
                      <span class="text-rose-500 font-medium">
                        被盾 <span class="font-mono">{{ task.shielded_comments.length }}</span> 条
                      </span>
                    </template>
                    <template v-else>
                      <UIcon name="i-lucide:check-circle-2" class="text-emerald-500" />
                      <span class="text-emerald-600 dark:text-emerald-400">未检测到被盾评论</span>
                    </template>
                    <span class="text-slate-300">·</span>
                    <span class="text-slate-500 font-mono">总计 {{ (task.final_comments ?? []).length }} 条</span>
                  </div>
                  <div class="flex gap-2">
                    <UButton
                      size="xs"
                      variant="outline"
                      color="gray"
                      icon="i-lucide:file-text"
                      :loading="exportingTaskKey === `markdown:${task.id}`"
                      @click="onExportTask(task, 'markdown')"
                    >
                      Markdown
                    </UButton>
                    <UButton
                      size="xs"
                      variant="outline"
                      color="gray"
                      icon="i-lucide:file-type-2"
                      :loading="exportingTaskKey === `pdf:${task.id}`"
                      @click="onExportTask(task, 'pdf')"
                    >
                      PDF
                    </UButton>
                  </div>
                </div>

                <!-- 异常 -->
                <div
                  v-if="task.status === 'error'"
                  class="mt-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <p class="text-sm text-rose-500 flex items-center gap-1.5">
                    <UIcon name="i-lucide:alert-circle" />
                    <span>{{ task.error_msg }}</span>
                  </p>
                  <UButton
                    size="xs"
                    variant="outline"
                    color="gray"
                    icon="i-lucide:rotate-ccw"
                    @click="retryTask(task.id!)"
                  >
                    重试
                  </UButton>
                </div>
              </div>
            </div>
          </section>

          <!-- 可用 Credential -->
          <section>
            <div class="flex items-baseline justify-between mb-3">
              <h2 class="text-base font-semibold text-slate-900 dark:text-slate-100">可用 Credential</h2>
              <span class="text-xs text-slate-400 font-mono">{{ validCredentials.length }}</span>
            </div>

            <div
              v-if="validCredentials.length === 0"
              class="flex items-start gap-3 px-4 py-4 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg"
            >
              <UIcon name="i-lucide:info" class="text-amber-500 text-lg flex-shrink-0 mt-0.5" />
              <p class="text-xs text-slate-500 leading-relaxed">
                暂无可用凭证，请在手机微信中打开目标公众号的文章，系统会自动捕获 Credential。
              </p>
            </div>

            <ul v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
              <li
                v-for="cred in validCredentials"
                :key="cred.biz"
                class="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-md text-sm bg-white dark:bg-slate-900"
              >
                <img v-if="cred.avatar" :src="cred.avatar" class="w-6 h-6 rounded-full" />
                <span class="font-medium truncate flex-1">{{ cred.nickname || cred.biz }}</span>
                <span class="text-[11px] text-slate-400 font-mono">
                  {{ cred.time || dayjs(cred.timestamp).format('MM-DD HH:mm') }}
                </span>
              </li>
            </ul>
          </section>

          <div class="h-12" />
        </div>
      </div>
    </div>

    <!-- 搜索添加弹窗 -->
    <UModal v-model="showSearch">
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold">添加监控公众号</h3>
        <div class="flex gap-2">
          <UInput
            v-model="searchKeyword"
            placeholder="搜索公众号名称"
            icon="i-lucide:search"
            class="flex-1"
            @keyup.enter="searchAccount"
          />
          <UButton color="black" :loading="searching" @click="searchAccount">搜索</UButton>
        </div>
        <div v-if="searchResults.length" class="space-y-1 max-h-80 overflow-y-auto">
          <div
            v-for="account in searchResults"
            :key="account.fakeid"
            class="flex items-center gap-3 p-3 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition active:scale-[0.99]"
            @click="onAddAccount(account)"
          >
            <img :src="account.round_head_img" class="w-9 h-9 rounded-full object-cover" />
            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm truncate">{{ account.nickname }}</p>
              <p class="text-xs text-slate-500 truncate">{{ account.signature }}</p>
            </div>
          </div>
        </div>
      </div>
    </UModal>
  </div>
</template>
