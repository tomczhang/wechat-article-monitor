<script setup lang="ts">
import useCredentialGate from '~/composables/useCredentialGate';

const { validCredentials, serviceStatus, wsConnected, openGate } = useCredentialGate();

const healthy = computed(() => serviceStatus.value.running && wsConnected.value);
const countText = computed(() => `${validCredentials.value.length} 个有效凭证`);
</script>

<template>
  <button
    type="button"
    class="w-full rounded-lg border border-slate-200 px-3 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/50"
    @click="openGate({ refresh: true })"
  >
    <span class="flex items-center justify-between gap-3">
      <span class="flex min-w-0 items-center gap-2">
        <span class="relative flex size-2.5 shrink-0">
          <span v-if="healthy" class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50"></span>
          <span class="relative inline-flex size-2.5 rounded-full" :class="healthy ? 'bg-emerald-500' : 'bg-slate-300'"></span>
        </span>
        <span class="truncate text-sm font-medium text-slate-700 dark:text-slate-200">Credential</span>
      </span>
      <UIcon name="i-lucide:chevron-right" class="size-4 shrink-0 text-slate-400" />
    </span>
    <span class="mt-1.5 block text-xs text-slate-500">{{ countText }}</span>
    <span class="mt-0.5 block text-[11px] text-slate-400">
      {{ serviceStatus.systemProxy?.managed ? '系统代理已托管' : '点击配置或更新' }}
    </span>
  </button>
</template>
