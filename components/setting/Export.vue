<template>
  <BaseSectionCard
    title="导出选项"
    description="统一目录命名规则，并选择各格式需要包含的数据。"
    content-class="space-y-6"
  >
    <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <UFormGroup
        label="导出目录名"
        description="影响 HTML、TXT、Markdown、Word 和 PDF 的目录名称。"
      >
        <div class="flex gap-2">
          <UInput
            v-model="preferences.exportConfig.dirname"
            placeholder="目录名格式"
            class="min-w-0 flex-1 font-mono"
            name="dirname"
          />
          <UPopover mode="hover" :popper="{ placement: 'right' }">
            <UButton
              color="gray"
              variant="soft"
              icon="i-lucide:braces"
              square
              aria-label="查看可用变量"
            />

            <template #panel>
              <div class="max-w-[520px] p-4">
                <p class="text-sm leading-6 text-slate-500">
                  使用 <code class="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-800">${变量名}</code>
                  插入变量，例如
                  <code class="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-800">${YYYY}-${MM}-${DD}_${title}</code>。
                </p>
                <p class="mb-2 mt-4 text-sm font-medium">支持的变量</p>
                <table class="w-full border-collapse text-sm">
                  <tbody>
                    <tr>
                      <th class="w-20">变量</th>
                      <th class="w-32">含义</th>
                      <th class="w-20">变量</th>
                      <th class="w-32">含义</th>
                    </tr>
                    <tr v-for="(item, idx) in variables" :key="idx">
                      <td class="text-center font-mono">{{ item[0].name }}</td>
                      <td class="text-center">{{ item[0].description }}</td>
                      <td class="text-center font-mono">{{ item[1].name }}</td>
                      <td class="text-center">{{ item[1].description }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </UPopover>
        </div>
        <template #help>
          <span>预览：</span>
          <span class="font-mono text-slate-700 dark:text-slate-300">{{ dirnamePreview }}</span>
        </template>
      </UFormGroup>

      <UFormGroup label="最大长度" description="填写 0 表示不限制。">
        <UInput
          v-model="preferences.exportConfig.maxlength"
          placeholder="0"
          type="number"
          min="0"
          class="font-mono"
        />
      </UFormGroup>
    </div>

    <div class="border-t border-slate-100 pt-5 dark:border-slate-800">
      <p class="text-sm font-medium text-slate-900 dark:text-slate-100">导出内容</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <UCheckbox
          v-model="preferences.exportConfig.exportExcelIncludeContent"
          name="exportExcelIncludeContent"
          label="Excel 包含文章内容"
        />
        <UCheckbox
          v-model="preferences.exportConfig.exportJsonIncludeContent"
          name="exportJsonIncludeContent"
          label="JSON 包含文章内容"
        />
        <UCheckbox
          v-model="preferences.exportConfig.exportJsonIncludeComments"
          name="exportJsonIncludeComments"
          label="JSON 包含留言数据"
        />
        <UCheckbox
          v-model="preferences.exportConfig.exportHtmlIncludeComments"
          name="exportHtmlIncludeComments"
          label="HTML 包含留言数据"
        />
      </div>
    </div>
  </BaseSectionCard>
</template>

<script setup lang="ts">
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const sampleData: Record<string, string> = {
  account: '人民日报',
  title: '这是一篇示例文章标题',
  aid: '100000001',
  author: '张三',
  YYYY: '2025',
  MM: '03',
  DD: '15',
  HH: '10',
  mm: '30',
};

const dirnamePreview = computed(() => {
  let result = preferences.value.exportConfig.dirname || '';
  for (const [key, value] of Object.entries(sampleData)) {
    result = result.replace(new RegExp(`\\$\\{${key}}`, 'g'), value);
  }
  const maxlength = preferences.value.exportConfig.maxlength;
  if (maxlength) {
    result = result.slice(0, maxlength);
  }
  return result || '（空）';
});

const _variables = [
  { name: 'account', description: '公众号名称' },
  { name: 'title', description: '文章标题' },
  { name: 'aid', description: '文章id' },
  { name: 'author', description: '作者' },
  { name: 'YYYY', description: '年' },
  { name: 'MM', description: '月' },
  { name: 'DD', description: '日' },
  { name: 'HH', description: '时' },
  { name: 'mm', description: '分' },
];
const variables = Array.from({ length: Math.ceil(_variables.length / 2) }, (_, i) => [
  _variables[i * 2] ?? {},
  _variables[i * 2 + 1] ?? {},
]);
</script>

<style scoped>
table th {
  padding: 0.5rem 0.25rem;
}
table td {
  border: 1px solid rgb(226 232 240);
  padding: 0.25rem 0.5rem;
}

td:first-child,
th:first-child {
  border-left: none;
}

td:last-child,
th:last-child {
  border-right: none;
}

th {
  border: 1px solid rgb(226 232 240);
  border-top: none;
}

tr:nth-child(even) {
  background-color: rgb(248 250 252);
}

tr:hover {
  background-color: rgb(241 245 249);
}
</style>
