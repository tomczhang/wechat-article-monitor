<template>
  <div class="grid gap-4 xl:grid-cols-2">
    <article
      v-for="account in accountMetrics"
      :key="account.name"
      class="relative rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
    >
      <h3 class="mb-4 pr-10 font-mono text-sm font-medium text-slate-700 dark:text-slate-200" :title="account.name">
        {{ account.domain }}
      </h3>

      <UMeter v-if="account.metric" :value="account.metric.dailyRequests" :max="100_000" color="blue">
        <template #indicator>
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>今日额度</span>
            <p>
              <span class="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">
                {{ Math.round((Math.min(account.metric.dailyRequests, 100_000) / 100_000) * 100) }}%
              </span>
              <span class="ml-1 font-mono text-[11px]">
                ({{ account.metric.dailyRequests.toLocaleString('en-US') }}/{{ (100_000).toLocaleString('en-US') }})
              </span>
            </p>
          </div>
        </template>
      </UMeter>
      <span v-else class="text-sm text-slate-400">状态未知</span>

      <div class="absolute right-4 top-4">
        <UButton
          v-if="account.copied"
          icon="i-lucide:check"
          color="gray"
          variant="ghost"
          size="xs"
          square
          aria-label="节点地址已复制"
        />
        <UTooltip v-else text="复制节点地址">
          <UButton
            icon="i-lucide:copy"
            color="gray"
            variant="ghost"
            size="xs"
            square
            aria-label="复制节点地址"
            @click="copyAddress(account)"
          />
        </UTooltip>
      </div>

      <div class="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
        <header class="mb-3 flex items-center justify-between">
          <h4 class="text-sm font-medium text-slate-700 dark:text-slate-200">主要请求来源</h4>
          <UButton
            v-if="account.fetchAnalyticsLoading"
            icon="i-lucide:loader-circle"
            color="gray"
            variant="ghost"
            size="xs"
            square
            loading
            aria-label="正在加载来源数据"
          />
          <UTooltip v-else text="加载节点使用信息">
            <UButton
              icon="i-lucide:activity"
              color="gray"
              variant="ghost"
              size="xs"
              square
              aria-label="加载节点使用信息"
              @click="nodeAnalytics(account)"
            />
          </UTooltip>
        </header>

        <div
          v-for="item in account.topClientIPs"
          :key="item.clientIP"
          class="relative my-1.5 flex items-center justify-between overflow-hidden rounded-md bg-slate-100 px-2.5 py-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          <div
            :style="{ width: account.total ? (item.count / account.total) * 100 + '%' : '0%' }"
            class="absolute inset-y-0 left-0 rounded-l bg-blue-200/70 dark:bg-blue-900/50"
          ></div>
          <p class="relative z-10 font-mono text-xs">{{ item.clientIP }}</p>
          <p class="relative z-10 font-mono text-xs">
            {{ item.count > 1000 ? (item.count / 1000).toFixed(2) + 'k' : item.count }}
          </p>
        </div>

        <p v-if="!account.fetchAnalyticsLoading && account.topClientIPs.length === 0" class="text-xs text-slate-400">
          点击右侧图标加载来源数据
        </p>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { request } from '#shared/utils/request';
import type { AccountMetric } from '~/types/proxy';

interface Props {
  data: AccountMetric[];
}
interface AccountMetricWithExtra extends AccountMetric {
  copied: boolean;
  fetchAnalyticsLoading: boolean;
  topClientIPs: Security[];
  total: number;
}
interface Security {
  clientIP: string;
  count: number;
}

const props = defineProps<Props>();

const accountMetrics: AccountMetricWithExtra[] = reactive(
  props.data.map((account: AccountMetric) => ({
    ...account,
    copied: false,
    fetchAnalyticsLoading: false,
    topClientIPs: [],
    total: 0,
  }))
);

watch(
  () => props.data,
  () => {
    Object.assign(
      accountMetrics,
      props.data.map((account: AccountMetric) => ({
        ...account,
        copied: false,
        fetchAnalyticsLoading: false,
        topClientIPs: [],
        total: 0,
      }))
    );
  }
);

function copyAddress(account: AccountMetricWithExtra) {
  let result: string[] = [];
  for (let i = 0; i < 16; i++) {
    result.push(`https://${('0' + i).slice(-2)}${account.domain.replace(/^\*/, '')}`);
  }
  navigator.clipboard.writeText(result.join('\n'));

  account.copied = true;
  setTimeout(() => {
    account.copied = false;
  }, 1000);
}

async function nodeAnalytics(account: AccountMetricWithExtra) {
  account.fetchAnalyticsLoading = true;
  const resp = await request('/api/web/worker/security-top-n', {
    method: 'GET',
    query: {
      name: account.name,
    },
  }).finally(() => {
    account.fetchAnalyticsLoading = false;
  });
  account.topClientIPs = resp.topClientIPs;
  account.total = resp.total;
}
</script>
