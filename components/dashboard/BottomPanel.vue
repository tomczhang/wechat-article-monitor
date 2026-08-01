<script setup lang="ts">
import CredentialStatusPanel from '~/components/dashboard/CredentialStatusPanel.vue';
import StorageUsage from '~/components/StorageUsage.vue';
</script>

<template>
  <footer class="flex flex-col space-y-2 pt-3 border-t dark:border-slate-600">
    <CredentialStatusPanel />
    <StorageUsage />
  </footer>
</template>
