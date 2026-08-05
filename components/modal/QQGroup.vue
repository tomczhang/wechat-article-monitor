<script setup lang="ts">
import qqGroupImg from '~/assets/qq-group.png';

const modal = useModal();

function onClose() {
  modal.close();
}
</script>

<template>
  <UModal prevent-close>
    <UCard>
      <template #header>
        <BaseModalHeader title="加入 QQ 群" description="扫码加入交流群，获取使用帮助和版本动态。" @close="onClose" />
      </template>

      <!-- 二维码图片展示区 -->
      <div class="mx-auto flex flex-col items-center justify-center gap-4 py-2">
        <img :src="qqGroupImg" alt="QQ 群二维码" class="size-72 rounded-lg" />
        <p class="text-sm text-slate-500">群号 <span class="ml-1 font-mono font-medium text-slate-900 dark:text-slate-100">991482155</span></p>
      </div>
    </UCard>
  </UModal>
</template>
