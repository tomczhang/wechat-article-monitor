<template>
  <BaseSectionCard
    title="同步与显示"
    description="控制文章列表行为、同步节奏和默认时间范围。"
    content-class="space-y-6"
  >
    <div class="grid gap-6 lg:grid-cols-2">
      <div class="flex flex-col space-y-3">
        <div class="flex gap-1">
          <UCheckbox v-model="preferences.hideDeleted" name="hideDeleted" label="隐藏已删除文章" />
          <UPopover mode="hover" :popper="{ placement: 'top' }">
            <template #panel>
              <p class="max-w-[300px] p-3 text-sm leading-6 text-slate-500">
                是否在文章下载表格中显示已删除的文章。<br />
                若勾选该选项，则文章下载表格将过滤掉已经被删除的文章(无论文章内容是否已被下载)。
              </p>
            </template>
            <UButton color="gray" variant="ghost" size="2xs" icon="i-lucide:circle-help" square aria-label="查看隐藏已删除文章说明" />
          </UPopover>
        </div>

        <div class="flex gap-1">
          <UCheckbox v-model="preferences.collapseReposts" name="collapseReposts" label="折叠重发文章" />
          <UPopover mode="hover" :popper="{ placement: 'top' }">
            <template #panel>
              <p class="max-w-[300px] p-3 text-sm leading-6 text-slate-500">
                公众号删掉重发时，微信的历史消息接口会把每一次群发都返回一遍，而且不一定给旧的打上删除标记。<br />
                若勾选该选项，则同一个公众号下标题相同、发布时间相差 30
                分钟以内的记录只显示最新一条。该选项只影响显示，不会删除本地缓存的数据。
              </p>
            </template>
            <UButton color="gray" variant="ghost" size="2xs" icon="i-lucide:circle-help" square aria-label="查看折叠重发文章说明" />
          </UPopover>
        </div>

        <div class="flex gap-1">
          <UCheckbox
            v-model="preferences.downloadConfig.forceDownloadContent"
            name="forceDownloadContent"
            label="强制下载文章内容"
          />
          <UPopover mode="hover" :popper="{ placement: 'top' }">
            <template #panel>
              <p class="max-w-[300px] p-3 text-sm leading-6 text-slate-500">
                在抓取文章内容时，若该文章内容已被下载，则会跳过抓取过程。<br />
                若勾选该选项，则会忽略已缓存内容，强制重新下载最新文章内容。<br />
              </p>
            </template>
            <UButton color="gray" variant="ghost" size="2xs" icon="i-lucide:circle-help" square aria-label="查看强制下载说明" />
          </UPopover>
        </div>

        <div class="flex gap-1">
          <UCheckbox
            v-model="preferences.downloadConfig.metadataOverrideContent"
            name="metadataOverrideContent"
            label="抓取阅读量时是否覆盖文章内容"
          />
          <UPopover mode="hover" :popper="{ placement: 'top' }">
            <template #panel>
              <p class="max-w-[300px] p-3 text-sm leading-6 text-slate-500">
                在抓取阅读量时，会同时下载文章内容。<br />
                若勾选该选项，则文章内容会同时保存到缓存中(会占用一定的存储空间)。
              </p>
            </template>
            <UButton color="gray" variant="ghost" size="2xs" icon="i-lucide:circle-help" square aria-label="查看文章内容覆盖说明" />
          </UPopover>
        </div>
      </div>
      <div>
        <UFormGroup label="公众号同步频率" description="建议不少于 3 秒，降低请求过快带来的风险。">
          <template #hint>
            <UPopover mode="hover" :popper="{ placement: 'top' }">
              <template #panel>
                <p class="max-w-[300px] p-3 text-sm leading-6 text-slate-500">
                  在同步公众号文章数据时，程序会自动抓取该公众号的所有文章，直到所有数据同步完成。<br />
                  该选项用于控制抓取频率，比如设置为 5
                  就表示每五秒抓取一次。该数据越小，同步的越快，但是容易被封号。推荐不小于3
                </p>
              </template>
              <UButton
                color="gray"
                variant="ghost"
                size="2xs"
                icon="i-lucide:circle-help"
                square
                aria-label="查看同步频率说明"
              />
            </UPopover>
          </template>
          <UInput
            type="number"
            v-model="preferences.accountSyncSeconds"
            placeholder="配置公众号同步频率"
            class="max-w-52 font-mono"
          >
            <template #trailing>
              <span class="text-xs text-slate-500 dark:text-slate-400">秒</span>
            </template>
          </UInput>
        </UFormGroup>
      </div>
    </div>
    <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-slate-900 dark:text-slate-100">同步时间范围</p>
          <p class="mt-1 text-xs text-slate-500">从当前时间开始向前同步。</p>
        </div>
        <span class="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
          {{ getActualDateRange() }}
        </span>
      </div>

      <div class="flex flex-wrap gap-3">
        <USelectMenu
          class="min-w-60 flex-1"
          v-model="preferences.syncDateRange"
          :options="DURATION_OPTIONS"
          value-attribute="value"
          option-attribute="label"
        />
        <UPopover v-if="preferences.syncDateRange === 'point'" :popper="{ placement: 'bottom-start' }">
          <UButton color="gray" icon="i-lucide:calendar-days" :label="formatDate()" />

          <template #panel="{ close }">
            <BaseDatePicker v-model="preferences.syncDatePoint" is-required @close="close" />
          </template>
        </UPopover>
      </div>
    </div>
  </BaseSectionCard>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import type { Preferences } from '~/types/preferences';

const { getActualDateRange, getSelectOptions } = useSyncDeadline();

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const DURATION_OPTIONS = getSelectOptions();

function formatDate() {
  return dayjs.unix(preferences.value.syncDatePoint).format('YYYY-MM-DD');
}
</script>
