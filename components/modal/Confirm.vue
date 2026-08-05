<script setup lang="ts">
defineProps({
  icon: {
    type: String,
    default: 'i-heroicons-solid:exclamation-triangle',
  },
  title: {
    type: String,
  },
  description: {
    type: String,
  },
});

const modal = useModal();
const emit = defineEmits(['confirm', 'cancel']);

function onConfirm() {
  emit('confirm');
  modal.close();
}
function onCancel() {
  emit('cancel');
  modal.close();
}
</script>

<template>
  <UModal prevent-close>
    <UCard>
      <template #header>
        <BaseModalHeader :title="title || '确认操作'" eyebrow="需要确认" @close="onCancel" />
      </template>

      <div class="flex items-start gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
          <UIcon :name="icon" class="size-5" />
        </span>
        <p v-if="description" class="text-sm leading-6 text-slate-600 dark:text-slate-300">{{ description }}</p>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="gray" variant="soft" @click="onCancel">取消</UButton>
          <UButton color="rose" @click="onConfirm">确认</UButton>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
