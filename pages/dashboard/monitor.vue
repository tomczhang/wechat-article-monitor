<script setup lang="ts">
import dayjs from 'dayjs';
import CommentPreviewPopover from '~/components/dashboard/CommentPreviewPopover.vue';
import ShieldedCommentsPopover from '~/components/dashboard/ShieldedCommentsPopover.vue';
import CredentialExpiryBar from '~/components/global/CredentialExpiryBar.vue';
import useAccountDiscovery from '~/composables/useAccountDiscovery';
import useCommentMonitor from '~/composables/useCommentMonitor';
import useCredentials from '~/composables/useCredentials';
import useMonitor from '~/composables/useMonitor';
import { websiteName } from '~/config';
import type { CommentMonitorTask } from '~/store/v2/commentMonitorTask';
import type { ParsedCredential } from '~/types/credential';

useHead({
  title: `文章监控 | ${websiteName}`,
});

const { monitoring } = useMonitor();
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
const { validCredentials, serviceStatus, wsConnected, start: startCredentials } = useCredentials();

// 已在监控列表中的公众号
const watchedFakeids = computed(() => new Set(watches.value.map(w => w.fakeid)));
// 有效但尚未加入监控的凭证 —— 添加公众号的来源
const addableCredentials = computed(() => validCredentials.value.filter(c => !watchedFakeids.value.has(c.biz)));
// 空数据：既没有监控公众号，也没有可用凭证
const isEmpty = computed(() => watches.value.length === 0 && validCredentials.value.length === 0);

const proxyEndpoint = computed(() => `127.0.0.1:${serviceStatus.value.port}`);

// —— 从凭证添加公众号 ——
const showCredentialPicker = ref(false);
const addingWatchBiz = ref<string | null>(null);

async function addFromCredential(cred: ParsedCredential) {
  if (watchedFakeids.value.has(cred.biz)) return;
  addingWatchBiz.value = cred.biz;
  try {
    await addWatch({
      fakeid: cred.biz,
      nickname: cred.nickname || cred.biz,
      round_head_img: cred.avatar || '',
    });
  } finally {
    addingWatchBiz.value = null;
  }
}

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

type BadgeColor = 'sky' | 'orange' | 'violet' | 'green' | 'rose' | 'gray';

function getStatusLabel(status: CommentMonitorTask['status']): { label: string; color: BadgeColor } {
  const map: Record<CommentMonitorTask['status'], { label: string; color: BadgeColor }> = {
    tracking: { label: '追踪中', color: 'sky' },
    final_collecting: { label: '最终采集中', color: 'orange' },
    exporting: { label: '导出中', color: 'violet' },
    done: { label: '已完成', color: 'green' },
    error: { label: '异常', color: 'rose' },
  };
  return map[status] ?? { label: status, color: 'gray' };
}

function getTrackingProgress(task: CommentMonitorTask) {
  const elapsed = Math.min(Date.now() - task.created_at, task.tracking_end_at - task.created_at);
  const total = task.tracking_end_at - task.created_at;
  return Math.round((elapsed / total) * 100);
}

function getLiveShieldedComments(task: CommentMonitorTask): Comment[] {
  const map = task.comment_shielded_at ?? {};
  return (task.accumulated_comments ?? []).filter(c => map[c.content_id] !== undefined);
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
  startCredentials();
  refreshInterval = setInterval(() => {
    if (discovering.value) refreshWatches();
    if (commentMonitoring.value) refreshTasks();
  }, 10000);
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
      <header class="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
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

          <span class="text-slate-300">|</span>

          <!-- 抓包服务状态 -->
          <div class="flex items-center gap-1.5">
            <span
              class="w-2 h-2 rounded-full"
              :class="serviceStatus.running && wsConnected ? 'bg-emerald-500' : 'bg-rose-400'"
            />
            <span class="text-slate-500">
              {{ serviceStatus.running && wsConnected ? '抓包服务就绪' : '抓包服务未就绪' }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <UButton icon="i-lucide:plus" color="black" @click="showCredentialPicker = true">
            添加公众号
          </UButton>
        </div>
      </header>

      <!-- 主内容区 -->
      <div class="flex-1 overflow-y-auto">
        <div class="max-w-8xl mx-auto px-6 py-6 space-y-8">
          <!-- 首次引导：无凭证也无监控 -->
          <section
            v-if="isEmpty"
            class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"
          >
            <div class="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">开始监控前，先获取 Credential</h2>
              <p class="text-sm text-slate-500 mt-1">
                本工具完全依赖微信客户端文章页的 Credential 工作，无需登录公众号后台。按以下步骤即可自动捕获。
              </p>
            </div>

            <div class="px-6 py-5 grid gap-4 md:grid-cols-2">
              <!-- 状态卡片 -->
              <div class="space-y-3">
                <div class="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full" :class="serviceStatus.running ? 'bg-emerald-500' : 'bg-rose-400'" />
                    <span class="text-sm font-medium">抓包服务</span>
                  </div>
                  <span class="text-xs text-slate-500 font-mono">
                    {{ serviceStatus.running ? proxyEndpoint : '未启动 (需安装 mitmproxy)' }}
                  </span>
                </div>
                <div class="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full" :class="wsConnected ? 'bg-emerald-500' : 'bg-slate-300'" />
                    <span class="text-sm font-medium">实时通道</span>
                  </div>
                  <span class="text-xs text-slate-500">{{ wsConnected ? '已连接' : '未连接' }}</span>
                </div>
              </div>

              <!-- 步骤 -->
              <ol class="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <li class="flex gap-3">
                  <span class="flex-shrink-0 w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs flex items-center justify-center font-mono">1</span>
                  <span>
                    将系统代理设为
                    <code class="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">{{ proxyEndpoint }}</code>
                  </span>
                </li>
                <li class="flex gap-3">
                  <span class="flex-shrink-0 w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs flex items-center justify-center font-mono">2</span>
                  <span>在手机 / PC 微信中打开目标公众号的任意一篇文章</span>
                </li>
                <li class="flex gap-3">
                  <span class="flex-shrink-0 w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs flex items-center justify-center font-mono">3</span>
                  <span>凭证会自动出现在下方「可用 Credential」，点击「加入监控」即可</span>
                </li>
              </ol>
            </div>
          </section>

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
              <UButton size="sm" color="black" variant="soft" @click="showCredentialPicker = true">从 Credential 添加</UButton>
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
            <p class="text-xs text-slate-400 mb-3">每 30 秒刷新一次评论，每条任务持续 1.5 小时；到期自动最终采集并导出 Markdown / PDF。</p>

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

                <!-- 追踪进度条 -->
                <div
                  v-if="task.status === 'tracking'"
                  class="mt-3 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
                >
                  <div
                    class="h-full bg-sky-500 transition-all duration-500"
                    :style="{ width: `${getTrackingProgress(task)}%` }"
                  />
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
                    <template v-if="getLiveShieldedComments(task).length > 0">
                      <span class="text-slate-300">·</span>
                      <UPopover
                        mode="hover"
                        :open-delay="100"
                        :close-delay="200"
                        :popper="{ placement: 'top' }"
                      >
                        <span class="text-rose-500 font-medium cursor-help underline decoration-dotted decoration-rose-300 underline-offset-2 inline-flex items-center gap-1">
                          <UIcon name="i-lucide:shield-alert" class="text-rose-500" />
                          被盾 <span class="font-mono">{{ getLiveShieldedComments(task).length }}</span> 条
                        </span>
                        <template #panel>
                          <ShieldedCommentsPopover
                            :comments="getLiveShieldedComments(task)"
                            :first-seen-at="task.comment_first_seen_at"
                            :shielded-at="task.comment_shielded_at"
                          />
                        </template>
                      </UPopover>
                    </template>
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
                      <UPopover
                        mode="hover"
                        :open-delay="100"
                        :close-delay="200"
                        :popper="{ placement: 'top' }"
                      >
                        <span class="text-rose-500 font-medium cursor-help underline decoration-dotted decoration-rose-300 underline-offset-2">
                          被盾 <span class="font-mono">{{ task.shielded_comments.length }}</span> 条
                        </span>
                        <template #panel>
                          <ShieldedCommentsPopover
                            :comments="task.shielded_comments"
                            :first-seen-at="task.comment_first_seen_at"
                            :shielded-at="task.comment_shielded_at"
                          />
                        </template>
                      </UPopover>
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
                暂无可用凭证。请将系统代理设为
                <code class="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">{{ proxyEndpoint }}</code>，
                在微信中打开目标公众号的文章，系统会自动捕获 Credential。
              </p>
            </div>

            <ul v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              <li
                v-for="cred in validCredentials"
                :key="cred.biz"
                class="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-md text-sm bg-white dark:bg-slate-900"
              >
                <img v-if="cred.avatar" :src="cred.avatar" class="w-7 h-7 rounded-full flex-shrink-0" />
                <div class="flex-1 min-w-0">
                  <p class="font-medium truncate">{{ cred.nickname || cred.biz }}</p>
                  <p class="text-[11px] text-slate-400 font-mono truncate">
                    {{ cred.time || dayjs(cred.timestamp).format('MM-DD HH:mm') }}
                  </p>
                </div>
                <UBadge v-if="watchedFakeids.has(cred.biz)" color="green" variant="subtle" size="xs">监控中</UBadge>
                <UButton
                  v-else
                  size="xs"
                  color="black"
                  variant="soft"
                  :loading="addingWatchBiz === cred.biz"
                  @click="addFromCredential(cred)"
                >
                  加入监控
                </UButton>
              </li>
            </ul>
          </section>

          <div class="h-12" />
        </div>
      </div>
    </div>

    <!-- 添加公众号：从已抓取 Credential 选择 -->
    <UModal v-model="showCredentialPicker">
      <div class="p-6 space-y-4">
        <div>
          <h3 class="text-lg font-semibold">添加监控公众号</h3>
          <p class="text-sm text-slate-500 mt-1">从已抓取的有效 Credential 中选择要监控的公众号。</p>
        </div>

        <!-- 无可添加凭证：给出抓取引导 -->
        <div
          v-if="addableCredentials.length === 0"
          class="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-4 py-5 text-sm text-slate-500 space-y-3"
        >
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full" :class="serviceStatus.running ? 'bg-emerald-500' : 'bg-rose-400'" />
            <span>抓包服务{{ serviceStatus.running ? '已就绪' : '未启动 (需安装 mitmproxy)' }}</span>
          </div>
          <p class="leading-relaxed">
            将系统代理设为
            <code class="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">{{ proxyEndpoint }}</code>，
            在微信中打开目标公众号的任意文章，凭证会自动出现在此处。
            <template v-if="validCredentials.length > 0">当前所有有效凭证均已在监控中。</template>
          </p>
        </div>

        <ul v-else class="space-y-1 max-h-96 overflow-y-auto">
          <li
            v-for="cred in addableCredentials"
            :key="cred.biz"
            class="flex items-center gap-3 p-3 rounded-md border border-slate-200 dark:border-slate-700"
          >
            <img v-if="cred.avatar" :src="cred.avatar" class="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm truncate">{{ cred.nickname || cred.biz }}</p>
              <p class="text-xs text-slate-400 font-mono truncate">{{ cred.biz }}</p>
            </div>
            <CredentialExpiryBar :timestamp="cred.timestamp" class="w-32 flex-shrink-0" />
            <UButton
              size="xs"
              color="black"
              :loading="addingWatchBiz === cred.biz"
              @click="addFromCredential(cred)"
            >
              加入监控
            </UButton>
          </li>
        </ul>
      </div>
    </UModal>
  </div>
</template>
