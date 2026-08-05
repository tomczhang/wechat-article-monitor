<template>
  <div class="flex bg-slate-50 dark:bg-slate-950">
    <!-- 左侧边栏 -->
    <SideBar />
    <CredentialGateModal />

    <div class="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
      <!-- 顶部操作栏 -->
      <header
        class="flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-950"
      >
        <div id="title"></div>
        <GlobalActions />
      </header>

      <!-- 页面容器 -->
      <main class="min-h-0 flex-1 overflow-hidden">
        <NuxtPage />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import GlobalActions from '~/components/dashboard/Actions.vue';
import SideBar from '~/components/dashboard/SideBar.vue';
import CredentialGateModal from '~/components/global/CredentialGateModal.vue';
import useCredentialGate from '~/composables/useCredentialGate';

const { initialize } = useCredentialGate();

onMounted(() => {
  initialize();
});
</script>
