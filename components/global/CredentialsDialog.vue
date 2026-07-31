<template>
  <USlideover v-model="open" :ui="{ width: 'max-w-[500px]' }">
    <UCard
      class="flex flex-col flex-1"
      :ui="{ body: { base: 'flex-1' }, ring: '', divide: 'divide-y divide-gray-100 dark:divide-gray-800' }"
    >
      <template #header>
        <div class="flex justify-between items-center">
          <h2 class="font-bold text-2xl">抓取 Credentials</h2>
        </div>
      </template>

      <div>
        <div class="space-y-4 mb-4">
          <div class="flex items-center justify-between p-3 border rounded-lg">
            <div class="flex items-center gap-2">
              <span class="inline-block size-3 rounded-full" :class="serviceStatusColor"></span>
              <span class="text-sm font-medium">Credential 抓包服务</span>
            </div>
            <div class="text-sm text-gray-500">
              <template v-if="serviceStatus.running">
                代理地址: {{ serviceStatus.proxyAddress }}
              </template>
              <template v-else>
                未启动 (需要安装 mitmproxy)
              </template>
            </div>
          </div>

          <div class="flex items-center justify-between p-3 border rounded-lg">
            <div class="flex items-center gap-2">
              <span class="inline-block size-3 rounded-full" :class="wsConnected ? 'bg-green-500' : 'bg-gray-400'"></span>
              <span class="text-sm font-medium">WebSocket 连接</span>
            </div>
            <span class="text-sm text-gray-500">{{ wsConnected ? '已连接' : '未连接' }}</span>
          </div>

          <p class="text-xs text-gray-400">
            将系统代理设为 <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">127.0.0.1:{{ serviceStatus.port }}</code>，
            在微信内打开公众号文章即可自动抓取 Credentials。
          </p>
        </div>

        <ul class="flex flex-col p-1 gap-4 overflow-y-scroll h-[calc(100vh-22rem)] no-scrollbar">
          <li
            v-for="credential in credentials"
            :key="credential.biz"
            class="relative flex items-center border rounded-md hover:ring ring-blue-500 hover:shadow-md transition-all duration-300 p-3 space-x-5"
          >
            <div class="size-20 border rounded-full">
              <img :src="credential.avatar" alt="" />
            </div>
            <div class="flex-1">
              <p>公众号名称：{{ credential.nickname || '--' }}</p>
              <p>fakeid: {{ credential.biz }}</p>
              <p>获取时间: {{ credential.time }}</p>
              <div class="flex items-center justify-between mt-4">
                <span v-if="credential.valid" class="font-sans font-bold text-green-500">有效</span>
                <span v-else class="font-sans font-bold text-rose-500">已过期</span>
                <UButton
                  size="xs"
                  :color="credential.added ? 'green' : 'blue'"
                  :variant="credential.added ? 'soft' : 'solid'"
                  :disabled="credential.added || addingBiz === credential.biz"
                  :loading="addingBiz === credential.biz"
                  @click="addAccount(credential)"
                >
                  {{ credential.added ? '已添加' : '添加公众号' }}
                </UButton>
              </div>
              <CredentialExpiryBar :timestamp="credential.timestamp" class="mt-3" />
            </div>
            <UButton
              v-if="isDev"
              :loading="pullArticleLoading"
              class="absolute top-3 right-3"
              @click="pullData(credential.biz)"
            >
              拉取数据
            </UButton>
          </li>
        </ul>
      </div>
    </UCard>
  </USlideover>
</template>

<script setup lang="ts">
import { getArticleListWithCredential } from '~/apis';
import CredentialExpiryBar from '~/components/global/CredentialExpiryBar.vue';
import useCredentials from '~/composables/useCredentials';
import { isDev } from '~/config';

export type CredentialState = 'active' | 'inactive' | 'warning';

const emit = defineEmits<{
  (e: 'update:pendingCount', value: number): void;
}>();

const open = defineModel<boolean>('open', { default: false });
const state = defineModel<CredentialState>('state', { default: 'inactive' });

const { credentials, pendingCount, serviceStatus, wsConnected, addingBiz, start, addAccount } = useCredentials();

const pullArticleLoading = ref(false);
async function pullData(fakeid: string) {
  pullArticleLoading.value = true;
  const articles = await getArticleListWithCredential(fakeid);
  console.log(articles);
  pullArticleLoading.value = false;
}

const serviceStatusColor = computed(() => {
  if (serviceStatus.value.running) return 'bg-green-500';
  return 'bg-red-400';
});

onMounted(() => {
  start();
});

watchEffect(() => {
  state.value = wsConnected.value ? 'active' : 'inactive';
});

watchEffect(() => {
  emit('update:pendingCount', pendingCount.value);
});
</script>
