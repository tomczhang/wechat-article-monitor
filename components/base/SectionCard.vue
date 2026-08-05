<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    contentClass?: string;
  }>(),
  {
    description: '',
    contentClass: '',
  }
);
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
    <header class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-slate-950 dark:text-slate-50">{{ title }}</h2>
        <p v-if="description" class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {{ description }}
        </p>
      </div>
      <slot name="actions" />
    </header>
    <div :class="['p-5 sm:p-6', contentClass]">
      <slot />
    </div>
  </section>
</template>
