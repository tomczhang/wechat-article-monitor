<script setup lang="ts">
import CredentialStatusPanel from '~/components/dashboard/CredentialStatusPanel.vue';
import StorageUsage from '~/components/StorageUsage.vue';
</script>

<template>
  <footer class="flex flex-col space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
    <CredentialStatusPanel />
    <StorageUsage />
  </footer>
</template>
