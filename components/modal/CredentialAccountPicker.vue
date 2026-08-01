<script setup lang="ts">
import CredentialExpiryBar from '~/components/global/CredentialExpiryBar.vue';
import useCredentialGate from '~/composables/useCredentialGate';
import useCredentials from '~/composables/useCredentials';

const modal = useModal();
const { validCredentials, addingBiz, addAccount } = useCredentials();
const { openGate } = useCredentialGate();

function close() {
  modal.close();
}

function captureCredential() {
  close();
  openGate({ refresh: true });
}
</script>

<template>
  <UModal :ui="{ width: 'sm:max-w-xl' }">
    <UCard :ui="{ ring: '', divide: 'divide-y divide-slate-100 dark:divide-slate-800' }">
      <template #header>
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold">添加公众号</h2>
            <p class="mt-1 text-sm text-slate-500">选择已捕获 Credential 对应的公众号。</p>
          </div>
          <UButton icon="i-lucide:x" color="gray" variant="ghost" square aria-label="关闭" @click="close" />
        </div>
      </template>

      <div
        v-if="validCredentials.length === 0"
        class="flex flex-col items-start gap-3 border-l-2 border-amber-400 py-2 pl-4"
      >
        <p class="text-sm text-slate-600 dark:text-slate-300">当前没有有效 Credential，请先完成抓取。</p>
        <UButton size="sm" color="black" icon="i-lucide:shield-check" @click="captureCredential">开始抓取</UButton>
      </div>

      <ul v-else class="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        <li v-for="credential in validCredentials" :key="credential.biz" class="flex items-center gap-3 py-4">
          <img
            v-if="credential.avatar"
            :src="credential.avatar"
            alt=""
            class="size-11 shrink-0 rounded-full border border-slate-200 object-cover"
          />
          <div v-else class="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UIcon name="i-lucide:radio-tower" class="size-5 text-slate-400" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ credential.nickname || credential.biz }}</p>
            <p class="truncate font-mono text-[11px] text-slate-400">{{ credential.biz }}</p>
            <CredentialExpiryBar :timestamp="credential.timestamp" class="mt-2" />
          </div>
          <UButton
            size="sm"
            :color="credential.added ? 'green' : 'black'"
            :variant="credential.added ? 'soft' : 'solid'"
            :disabled="credential.added || addingBiz === credential.biz"
            :loading="addingBiz === credential.biz"
            class="active:scale-[0.98]"
            @click="addAccount(credential)"
          >
            {{ credential.added ? '已添加' : '添加' }}
          </UButton>
        </li>
      </ul>

      <template #footer>
        <div class="flex items-center justify-between">
          <p class="text-xs text-slate-400">{{ validCredentials.length }} 个有效凭证</p>
          <UButton color="gray" variant="soft" size="sm" icon="i-lucide:refresh-cw" @click="captureCredential">
            更新 Credential
          </UButton>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
