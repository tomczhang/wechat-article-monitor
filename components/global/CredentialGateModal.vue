<script setup lang="ts">
import useCredentialGate from '~/composables/useCredentialGate';

const {
  open,
  targetBiz,
  reason,
  state,
  canClose,
  configuring,
  actionError,
  serviceStatus,
  statusError,
  wsConnected,
  enableProxy,
  closeGate,
  refreshServiceStatus,
} = useCredentialGate();

const modalOpen = computed({
  get: () => open.value,
  set: value => {
    if (value) open.value = true;
    else closeGate();
  },
});

const stateText = computed(() => {
  const labels = {
    checking: '正在检查运行环境',
    needsConsent: '需要配置抓包链路',
    configuring: '正在配置系统代理',
    waitingCredential: '等待微信文章流量',
    ready: 'Credential 已就绪',
    error: '初始化遇到问题',
  };
  return labels[state.value];
});

const upstreamLabel = computed(
  () => serviceStatus.value.systemProxy?.upstreamProxy || serviceStatus.value.upstreamProxy || '未检测到'
);
</script>

<template>
  <UModal v-model="modalOpen" prevent-close :ui="{ width: 'sm:max-w-2xl' }">
    <UCard :ui="{ ring: '', divide: 'divide-y divide-slate-100 dark:divide-slate-800' }">
      <template #header>
        <div class="flex items-start justify-between gap-6">
          <div>
            <p class="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Credential 初始化</p>
            <h2 class="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">{{ stateText }}</h2>
            <p class="mt-1 text-sm text-slate-500">
              <template v-if="targetBiz">当前操作需要公众号 {{ targetBiz }} 的有效 Credential。</template>
              <template v-else>只需在微信中打开目标公众号文章，系统会自动完成捕获。</template>
            </p>
          </div>
          <UButton
            v-if="canClose"
            icon="i-lucide:x"
            color="gray"
            variant="ghost"
            square
            aria-label="关闭"
            @click="closeGate"
          />
        </div>
      </template>

      <div class="space-y-6">
        <div class="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-sm">
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3">
            <p class="text-xs text-slate-400">系统流量</p>
            <p class="mt-1 font-mono font-medium">macOS</p>
          </div>
          <UIcon name="i-lucide:arrow-right" class="text-slate-300" />
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3">
            <p class="text-xs text-slate-400">仅解密微信文章</p>
            <p class="mt-1 truncate font-mono font-medium">
              {{ serviceStatus.systemProxy?.mitmProxy || serviceStatus.proxyAddress || `127.0.0.1:${serviceStatus.port}` }}
            </p>
          </div>
          <UIcon name="i-lucide:arrow-right" class="text-slate-300" />
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3">
            <p class="text-xs text-slate-400">原系统代理</p>
            <p class="mt-1 truncate font-mono font-medium">{{ upstreamLabel }}</p>
          </div>
        </div>

        <div class="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-slate-600 dark:text-slate-300">mitmproxy 抓包服务</span>
            <span class="flex items-center gap-2 text-xs font-medium">
              <span
                class="size-2 rounded-full"
                :class="serviceStatus.running ? 'bg-emerald-500' : 'bg-rose-400'"
              ></span>
              {{ serviceStatus.running ? '已启动' : '未启动' }}
            </span>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-slate-600 dark:text-slate-300">系统代理托管</span>
            <span class="flex items-center gap-2 text-xs font-medium">
              <span
                class="size-2 rounded-full"
                :class="serviceStatus.systemProxy?.managed ? 'bg-emerald-500' : 'bg-slate-300'"
              ></span>
              {{ serviceStatus.systemProxy?.managed ? '已接管' : '等待确认' }}
            </span>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-slate-600 dark:text-slate-300">Credential 实时通道</span>
            <span class="flex items-center gap-2 text-xs font-medium">
              <span class="size-2 rounded-full" :class="wsConnected ? 'bg-emerald-500' : 'bg-slate-300'"></span>
              {{ wsConnected ? '已连接' : '连接中' }}
            </span>
          </div>
        </div>

        <div
          v-if="actionError || statusError || serviceStatus.systemProxy?.error || reason"
          class="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
        >
          <UIcon name="i-lucide:circle-alert" class="mt-0.5 size-4 shrink-0" />
          <span>{{ actionError || statusError || serviceStatus.systemProxy?.error || reason }}</span>
        </div>

        <ol class="grid gap-4 sm:grid-cols-3">
          <li class="flex gap-3">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-mono text-white dark:bg-slate-100 dark:text-slate-900"
              >1</span
            >
            <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">确认一次，由项目安全托管系统代理</p>
          </li>
          <li class="flex gap-3">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-mono text-white dark:bg-slate-100 dark:text-slate-900"
              >2</span
            >
            <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">在手机或电脑微信中打开目标文章</p>
          </li>
          <li class="flex gap-3">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-mono text-white dark:bg-slate-100 dark:text-slate-900"
              >3</span
            >
            <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">捕获成功后自动进入，无需手动刷新</p>
          </li>
        </ol>
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-4">
          <p class="text-xs text-slate-400">退出项目时会恢复原系统代理设置。</p>
          <div class="flex items-center gap-2">
            <UButton
              v-if="state === 'error'"
              color="gray"
              variant="soft"
              icon="i-lucide:refresh-cw"
              @click="refreshServiceStatus"
            >
              重新检测
            </UButton>
            <UButton
              v-if="state === 'needsConsent' || (state === 'error' && serviceStatus.running)"
              color="black"
              icon="i-lucide:shield-check"
              :loading="configuring"
              class="active:scale-[0.98]"
              @click="enableProxy"
            >
              确认并开始抓取
            </UButton>
            <div
              v-if="state === 'waitingCredential' || state === 'configuring' || state === 'checking'"
              class="flex items-center gap-2 text-sm text-slate-500"
            >
              <UIcon name="i-lucide:loader-circle" class="size-4 animate-spin" />
              {{ stateText }}
            </div>
          </div>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
