<template>
  <div id="notif-popup" class="notif-popup" aria-live="polite">
    <TransitionGroup name="popup">
      <UiNotificationCard
        v-for="p in popups"
        :key="p.id"
        :type="p.type"
        :title="p.title"
        :message="p.message"
        role="button"
        tabindex="0"
        @click="open(p.id)"
        @keydown.enter="open(p.id)"
        @close="dismiss(p.id)"
      />
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import UiNotificationCard from '@renderer/components/ui/UiNotificationCard.vue'
import { useNotificationPopups } from '@renderer/composables/useNotificationPopups'

/**
 * 通知浮窗内容：自绘通知的统一呈现通道（主窗口隐藏与否都由此浮窗展示）。
 * 点击卡片 → 剪贴板类跳剪贴板历史 / 其余标记已读并跳通知中心；关闭按钮 → 仅消失。
 * 卡片完全可定制（未来可加链接/翻译等按钮）；窗口大小由 useNotificationPopups 上报主进程缩放。
 */
const { popups, init, dismiss, open } = useNotificationPopups()

init()
</script>

<style scoped>
.notif-popup {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-2);
  padding: 0;
  box-sizing: border-box;
}

/* 卡片可点击，hover 轻微上浮 */
.notif-popup :deep(.ui-notif) {
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
}

.notif-popup :deep(.ui-notif:hover) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* 入场复用 toast-in，出场淡出 + 轻微下移 */
.popup-enter-active {
  animation: toast-in var(--duration-base) var(--ease-out-soft);
}

.popup-leave-active {
  transition: opacity 160ms var(--ease-out-soft), transform 160ms var(--ease-out-soft);
}

.popup-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
