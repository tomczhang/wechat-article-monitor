<script setup lang="ts">
import QQGroupModal from '~/components/modal/QQGroup.vue';
import { docsWebSite } from '~/config';
import { gotoLink } from '~/utils';

const modal = useModal();
</script>

<template>
  <ul class="hidden items-center gap-1 md:flex">
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
        <UButton
          icon="i-tdesign:logo-qq-filled"
          color="gray"
          variant="ghost"
          square
          aria-label="加入 QQ 群"
          @click="modal.open(QQGroupModal)"
        />
      </UTooltip>
    </li>

    <!-- 文档 -->
    <li>
      <UTooltip text="文档">
        <UButton
          icon="i-lucide:book-open"
          color="gray"
          variant="ghost"
          square
          aria-label="打开文档"
          @click="gotoLink(docsWebSite)"
        />
      </UTooltip>
    </li>

    <!-- GitHub -->
    <li>
      <UTooltip text="GitHub">
        <UButton
          icon="i-lucide:github"
          color="gray"
          variant="ghost"
          square
          aria-label="打开 GitHub"
          @click="gotoLink('https://github.com/wechat-article/wechat-article-exporter')"
        />
      </UTooltip>
    </li>
  </ul>
</template>
