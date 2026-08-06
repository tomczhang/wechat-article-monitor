<template>
  <div class="h-full bg-slate-50/70 dark:bg-slate-950">
    <BasePageTitle title="公共代理" eyebrow="节点运行状态" />

    <div class="h-full overflow-y-auto">
      <div class="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <div class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <UIcon name="i-lucide:triangle-alert" class="mt-0.5 size-4 shrink-0" />
          <div class="min-w-0 flex-1 text-sm leading-6">
            <p>公共代理资源有限，批量抓取请使用私有代理。异常高频请求可能触发 IP 限制。</p>
            <p class="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">代理额度每天 08:00 刷新。</p>
          </div>
          <UPopover :popper="{ placement: 'bottom-end', arrow: true }">
            <UButton
              :icon="hasBlocked ? 'i-lucide:shield-alert' : 'i-lucide:shield-check'"
              color="gray"
              variant="ghost"
              square
              aria-label="查看当前 IP 状态"
            />

            <template #panel>
              <div class="max-h-80 min-w-72 space-y-4 overflow-y-auto p-4 text-sm">
                <div>
                  <p class="text-xs font-medium uppercase tracking-wide text-slate-400">当前 IP</p>
                  <code class="mt-1 block font-medium" :class="hasBlocked ? 'text-rose-500' : 'text-emerald-600'">
                    {{ currentIP || '检测中' }}
                  </code>
                </div>
                <div>
                  <div class="flex items-center justify-between gap-4">
                    <p class="font-medium text-slate-900 dark:text-slate-100">受限 IP</p>
                    <span class="text-xs text-slate-400">误伤请联系开发者</span>
                  </div>
                  <ul v-if="blockedIPS.length" class="mt-2 space-y-1">
                    <li v-for="ip in blockedIPS" :key="ip">
                      <code class="font-mono text-xs text-rose-500">{{ ip }}</code>
                    </li>
                  </ul>
                  <p v-else class="mt-2 text-xs text-slate-400">暂无受限记录</p>
                </div>
              </div>
            </template>
          </UPopover>
        </div>

        <BaseSectionCard title="代理节点" description="查看节点额度、可用状态和主要请求来源。" content-class="min-h-40">
          <template #actions>
            <div class="flex items-center gap-2 text-xs">
              <span class="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                {{ totalSuccess }} 个可用
              </span>
              <span class="rounded-md bg-rose-50 px-2 py-1 font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                {{ totalFailure }} 个受限
              </span>
            </div>
          </template>

          <div v-if="loading" class="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader :size="20" class="animate-spin" />
            正在获取节点状态
          </div>
          <ProxyMetrics v-else :data="metricsData" />
        </BaseSectionCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader } from 'lucide-vue-next';
import { request } from '#shared/utils/request';
import ProxyMetrics from '~/components/ProxyMetrics.vue';
import { websiteName } from '~/config';
import type { AccountMetric } from '~/types/proxy';

useHead({
  title: `公共代理 | ${websiteName}`,
});

const loading = ref(false);
const metricsData = ref<AccountMetric[]>([]);

const totalSuccess = computed(
  () => metricsData.value.filter(item => item.metric && item.metric.dailyRequests < 100_000).length
);
const totalFailure = computed(
  () => metricsData.value.filter(item => item.metric && item.metric.dailyRequests >= 100_000).length
);

async function getMetricsData() {
  loading.value = true;
  try {
    metricsData.value = await fetch('/api/web/worker/overview-metrics')
      .then(res => res.json())
      .catch(e => {
        throw e;
      });
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
}

const currentIP = ref('');
const blockedIPS = ref<string[]>([]);

onMounted(async () => {
  await Promise.all([
    getMetricsData(),
    request('/api/web/misc/current-ip').then(data => {
      currentIP.value = data.ip;
    }),
    request<{ ips: string[] } | string[]>('/api/web/worker/blocked-ip-list').then(data => {
      blockedIPS.value = Array.isArray(data) ? data : data.ips || [];
    }),
  ]);
});
const hasBlocked = computed(() => {
  return blockedIPS.value.includes(currentIP.value);
});
</script>
