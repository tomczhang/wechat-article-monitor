<script setup lang="ts">
interface NavItem {
  name: string;
  icon: string;
  href: string;
  insider?: boolean;
  tags?: string[];
}

const items = ref<NavItem[]>([
  { name: '文章下载', icon: 'i-lucide:file-down', href: '/dashboard/article' },
  { name: '单篇文章下载', icon: 'i-lucide:file-text', href: '/dashboard/single' },
  { name: '合集下载', icon: 'i-lucide:library-big', href: '/dashboard/album' },
  { name: '文章监控', icon: 'i-lucide:radar', href: '/dashboard/monitor' },
  { name: '公共代理', icon: 'i-lucide:globe', href: '/dashboard/proxy' },
  { name: '设置', icon: 'i-lucide:settings', href: '/dashboard/settings' },
  // { name: '技术支持 & 赞助', icon: 'i-lucide:heart-handshake', href: '/dashboard/support' },
]);
</script>

<template>
  <nav class="mt-4 flex-1">
    <ul class="flex flex-col gap-1">
      <li v-for="item in items" :key="item.name">
        <NuxtLink :to="item.href" class="nav-link flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm">
          <UIcon :name="item.icon" class="size-[18px] opacity-80" />
          <p>{{ item.name }}</p>
          <UBadge v-if="item.tags" v-for="tag in item.tags" color="fuchsia" variant="subtle">{{ tag }}</UBadge>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.nav-link.router-link-active {
  @apply bg-slate-100 font-semibold text-slate-950 dark:bg-slate-800 dark:text-slate-50;
}
.nav-link:not(.router-link-active) {
  @apply text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-50;
}
</style>
