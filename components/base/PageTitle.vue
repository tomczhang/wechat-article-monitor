<script setup lang="ts">
defineProps<{
  title: string;
  eyebrow?: string;
}>();
</script>

<template>
  <Teleport defer to="#title">
    <div class="min-w-0">
      <p v-if="eyebrow" class="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
        {{ eyebrow }}
      </p>
      <h1 class="truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
        {{ title }}
      </h1>
    </div>
  </Teleport>
</template>
