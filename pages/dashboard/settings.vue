<template>
  <div class="h-full bg-slate-50/70 dark:bg-slate-950">
    <BasePageTitle title="设置" eyebrow="工作区偏好" />

    <div class="h-full overflow-y-auto">
      <div class="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <SettingProxy />
        <div class="grid gap-6 xl:grid-cols-2">
          <SettingExport />
          <SettingMisc />
        </div>
        <!--      <div>-->
        <!--        <SettingDisplay />-->
        <!--      </div>-->
        <div class="h-8"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { websiteName } from '~/config';

useHead({
  title: `设置 | ${websiteName}`,
});
</script>
