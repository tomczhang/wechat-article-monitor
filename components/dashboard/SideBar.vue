<script setup lang="ts">
import BottomPanel from '~/components/dashboard/BottomPanel.vue';
import NavMenus from '~/components/dashboard/NavMenus.vue';
import { websiteName } from '~/config';
</script>

<template>
  <aside
    class="hidden h-screen w-60 flex-shrink-0 flex-col justify-between border-r border-slate-200 bg-white px-3 pb-5 dark:border-slate-800 dark:bg-slate-950 md:flex"
  >
    <!-- 网站标题 & Logo -->
    <div class="flex h-16 items-center px-2">
      <NuxtLink to="/" class="flex min-w-0 items-center gap-2.5 text-slate-950 dark:text-slate-50">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
          <UIcon name="i-lucide:radio-tower" class="size-4" />
        </span>
        <span class="truncate text-base font-semibold tracking-tight">{{ websiteName }}</span>
      </NuxtLink>
    </div>

    <!-- 导航菜单 -->
    <NavMenus />

    <!-- 底部视图 -->
    <BottomPanel />
  </aside>
</template>
