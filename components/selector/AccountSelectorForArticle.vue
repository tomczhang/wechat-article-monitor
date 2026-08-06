<script setup lang="ts">
import useCredentialGate from '~/composables/useCredentialGate';
import useCredentials from '~/composables/useCredentials';
import type { CredentialAccount } from '~/types/credential';
import { sortCredentialAccounts } from '~/utils/credential-accounts';

const selected = defineModel<CredentialAccount | undefined>();

const { credentialAccounts, autoSyncingBiz, autoSyncErrors } = useCredentials();
const { openGate } = useCredentialGate();

const sortedAccounts = computed(() => sortCredentialAccounts(credentialAccounts.value));

function captureCredential() {
  openGate({ refresh: true });
}
</script>

<template>
  <USelectMenu
    v-model="selected"
    size="md"
    color="gray"
    searchable
    searchable-placeholder="筛选公众号名称..."
    clear-search-on-close
    :options="sortedAccounts"
    option-attribute="nickname"
    placeholder="选择有 Credential 的公众号"
  >
    <template #label>
      <div v-if="selected" class="flex min-w-0 flex-1 items-center gap-2">
        <UAvatar :src="selected.round_head_img" :alt="selected.nickname" size="2xs" />
        <span class="min-w-0 flex-1 truncate text-left font-medium">{{ selected.nickname }}</span>
        <UBadge v-if="!selected.credentialValid" color="red" variant="soft" size="xs" class="shrink-0">
          Credential 已过期
        </UBadge>
        <span class="shrink-0 font-mono text-xs text-slate-500">{{ selected.articles }} 篇</span>
      </div>
    </template>

    <template #option="{ option: account }">
      <div class="flex min-w-0 flex-1 items-center gap-3 py-1">
        <UAvatar :src="account.round_head_img" :alt="account.nickname" size="sm" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{{ account.nickname }}</p>
            <UBadge v-if="!account.credentialValid" color="red" variant="soft" size="xs" class="shrink-0">
              已过期
            </UBadge>
            <UBadge
              v-else-if="autoSyncingBiz === account.fakeid"
              color="blue"
              variant="soft"
              size="xs"
              class="shrink-0"
            >
              正在同步最新一页
            </UBadge>
          </div>
          <p class="mt-0.5 truncate font-mono text-[11px] text-slate-400">{{ account.fakeid }}</p>
          <p
            v-if="autoSyncErrors[account.fakeid]"
            class="mt-1 truncate text-xs text-rose-600 dark:text-rose-400"
          >
            首次同步失败，可手动重试
          </p>
          <p v-else class="mt-1 text-xs text-slate-500">已缓存 {{ account.articles }} 篇文章</p>
        </div>
      </div>
    </template>

    <template #option-empty="{ query }">
      <div class="px-2 py-3 text-sm text-slate-500">未找到匹配“{{ query }}”的公众号</div>
    </template>

    <template #empty>
      <div class="flex flex-col items-start gap-3 px-2 py-4">
        <div>
          <p class="text-sm font-medium text-slate-800 dark:text-slate-100">还没有捕获到公众号</p>
          <p class="mt-1 text-xs leading-5 text-slate-500">在微信中打开任意公众号文章，公众号会自动出现在这里。</p>
        </div>
        <UButton
          size="xs"
          color="black"
          icon="i-lucide:shield-check"
          class="active:scale-[0.98]"
          @click.stop="captureCredential"
        >
          获取 Credential
        </UButton>
      </div>
    </template>
  </USelectMenu>
</template>
