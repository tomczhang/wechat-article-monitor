<script setup lang="ts">
import { gotoLink } from '~/utils';
</script>

<template>
  <ul class="hidden items-center gap-1 md:flex">
    <li>
      <UTooltip text="GitHub">
        <UButton
          icon="i-lucide:github"
          color="gray"
          variant="ghost"
          square
          aria-label="打开 GitHub"
          @click="gotoLink('https://github.com/tomczhang/wechat-article-monitor')"
        />
      </UTooltip>
    </li>
  </ul>
</template>
