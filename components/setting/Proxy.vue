<template>
  <BaseSectionCard
    title="代理节点"
    description="配置用于文章资源下载的私有代理；留空时自动使用公共代理。"
  >
    <template #actions>
      <UButton
        color="gray"
        variant="ghost"
        icon="i-lucide:book-open"
        :to="docsWebSite + '/get-started/private-proxy.html'"
        target="_blank"
      >
        配置指南
      </UButton>
    </template>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
      <UFormGroup
        label="私有代理地址"
        description="每行填写一个以 http:// 或 https:// 开头的完整地址。"
      >
        <UTextarea
          v-model="textareaValue"
          :rows="12"
          :ui="{ base: 'resize-none font-mono leading-6' }"
          spellcheck="false"
          placeholder="https://proxy.example.com"
        />
      </UFormGroup>

      <div class="flex flex-col justify-between gap-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
        <div>
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">地址要求</p>
          <ol class="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <li>必须使用 <code class="rounded-md bg-white px-1.5 py-0.5 font-mono text-xs dark:bg-slate-900">http://</code> 或 <code class="rounded-md bg-white px-1.5 py-0.5 font-mono text-xs dark:bg-slate-900">https://</code>。</li>
            <li>请求时会自动追加 <code class="rounded-md bg-white px-1.5 py-0.5 font-mono text-xs dark:bg-slate-900">?url=</code> 等参数。</li>
          </ol>
          <div class="mt-4">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-400">示例</p>
            <code class="mt-2 block break-all font-mono text-xs text-slate-600 dark:text-slate-300">https://wproxy-01.deno.dev</code>
          </div>
          <p class="mt-4 text-xs leading-5 text-slate-500">
            未配置私有节点时，将使用
            <ExternalLink :href="docsWebSite + '/get-started/proxy.html'" text="公共代理" />。
          </p>
        </div>
        <UButton color="black" icon="i-lucide:save" class="self-start" @click="save">
          {{ saveBtnText }}
        </UButton>
      </div>
    </div>
  </BaseSectionCard>
</template>

<script setup lang="ts">
import ExternalLink from '~/components/base/ExternalLink.vue';
import { docsWebSite } from '~/config';
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const textareaValue = ref('');
const proxyList = computed(() => {
  return textareaValue.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.startsWith('http'));
});

onMounted(() => {
  try {
    const configuredProxyList = (preferences.value as Preferences).privateProxyList;
    if (configuredProxyList.length > 0) {
      textareaValue.value = configuredProxyList.join('\n');
    }
  } catch (e) {}
});

const saveBtnText = ref('保存');
async function save() {
  saveBtnText.value = '保存成功';
  setTimeout(() => {
    (preferences.value as Preferences).privateProxyList = proxyList.value;
    saveBtnText.value = '保存';
  }, 1000);
}
</script>
