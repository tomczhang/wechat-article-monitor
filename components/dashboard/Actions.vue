<script setup lang="ts">
import QQGroupModal from '~/components/modal/QQGroup.vue';
import { docsWebSite } from '~/config';
import { gotoLink } from '~/utils';

const modal = useModal();
</script>

<template>
  <ul class="hidden md:flex items-center gap-5">
    <!-- 通知 -->
    <!--    <li>-->
    <!--      <UTooltip text="通知">-->
    <!--        <UChip text="3" size="2xl" color="amber">-->
    <!--          <UIcon name="i-lucide:bell" class="action-icon" />-->
    <!--        </UChip>-->
    <!--      </UTooltip>-->
    <!--    </li>-->

    <li>
      <UTooltip text="加入QQ群">
        <UIcon
          @click="modal.open(QQGroupModal)"
          name="i-tdesign:logo-qq-filled"
          class="size-7 text-zinc-400 hover:text-blue-500 cursor-pointer transition-colors"
        />
      </UTooltip>
    </li>

    <!-- 文档 -->
    <li>
      <UTooltip text="文档">
        <UIcon
          name="i-lucide:book-open"
          @click="gotoLink(docsWebSite)"
          class="size-7 text-zinc-400 hover:text-blue-500 cursor-pointer transition-colors"
        />
      </UTooltip>
    </li>

    <!-- GitHub -->
    <li>
      <UTooltip text="GitHub">
        <UIcon
          @click="gotoLink('https://github.com/wechat-article/wechat-article-exporter')"
          name="i-lucide:github"
          class="size-7 text-zinc-400 hover:text-blue-500 cursor-pointer transition-colors"
        />
      </UTooltip>
    </li>
  </ul>
</template>
