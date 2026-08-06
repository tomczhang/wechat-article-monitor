<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  eyebrow?: string;
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="flex items-start justify-between gap-6">
    <div class="min-w-0">
      <p v-if="eyebrow" class="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
        {{ eyebrow }}
      </p>
      <h2 class="text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-50" :class="eyebrow ? 'mt-1' : ''">
        {{ title }}
      </h2>
      <p v-if="description" class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {{ description }}
      </p>
    </div>
    <UButton
      icon="i-lucide:x"
      color="gray"
      variant="ghost"
      square
      aria-label="关闭"
      class="-mr-1 -mt-1 shrink-0"
      @click="$emit('close')"
    />
  </div>
</template>
