<template>
  <div id="notif-popup" class="notif-popup" :class="{ 'is-top-center': position === 'top-center' }" aria-live="polite">
    <TransitionGroup :name="position === 'top-center' ? 'popup-top' : 'popup'">
      <UiNotificationCard
        v-for="p in popups"
        :key="p.id"
        :type="p.type"
        :title="p.title"
        :message="p.message"
        :class="{ 'is-mail': isMail(p) }"
        :action-text="isMail(p) ? '已读' : undefined"
        role="button"
        tabindex="0"
        @click="open(p.id)"
        @keydown.enter="open(p.id)"
        @close="dismiss(p.id)"
        @action="markReadAndDismiss(p.id)"
      />
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import UiNotificationCard from '@renderer/components/ui/UiNotificationCard.vue'
import type { NotificationItem } from '@preload/ipc'
import { useNotificationPopups } from '@renderer/composables/useNotificationPopups'

/**
 * 通知浮窗内容：自绘通知的统一呈现通道（主窗口隐藏与否都由此浮窗展示）。
 * 点击卡片 → 剪贴板类跳剪贴板历史 / 邮件类跳邮箱大师 / 其余标记已读并跳通知中心；关闭按钮 → 仅消失。
 * 邮件通知长时悬停不自动消失，卡片右下角带「已读」按钮（点击标记已读并仅收起）且整体放大展示。
 * 卡片完全可定制；窗口大小由 useNotificationPopups 上报主进程缩放。
 * position 决定入口动画方向（右下角自右滑入 / 顶部居中自下滑入），主进程每次投递通报。
 */
const { popups, position, init, dismiss, open, markReadAndDismiss } = useNotificationPopups()

function isMail(p: NotificationItem): boolean {
  return p.source === 'mail'
}

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

/* 顶部居中（灵动岛）：卡片去阴影，仅保留描边 */
.notif-popup.is-top-center :deep(.ui-notif) {
  box-shadow: none;
}

.notif-popup.is-top-center :deep(.ui-notif:hover) {
  box-shadow: none;
}

/* 邮件通知：长时悬停卡片整体放大，标题更醒目 */
.notif-popup :deep(.ui-notif.is-mail) {
  padding: var(--sp-4);
}

.notif-popup :deep(.ui-notif.is-mail.has-action) {
  padding-bottom: 48px;
}

.notif-popup :deep(.ui-notif.is-mail .ui-notif__icon) {
  margin-top: 2px;
}

.notif-popup :deep(.ui-notif.is-mail .ui-notif__title) {
  font-size: var(--text-lg);
  line-height: 1.4;
}

.notif-popup :deep(.ui-notif.is-mail .ui-notif__msg) {
  margin-top: 4px;
  font-size: var(--text-md);
  line-height: 1.6;
}

/* 入场复用 toast-in，出场淡出 + 轻微下移（右下角：自右滑入，整体右对齐锚定） */
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

/* 顶部居中（灵动岛式）：自上覆盖滑入，出场向上淡出 */
.popup-top-enter-active {
  animation: notif-drop-in var(--duration-base) var(--ease-out-soft);
}

.popup-top-leave-active {
  transition: opacity 160ms var(--ease-out-soft), transform 160ms var(--ease-out-soft);
}

.popup-top-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>

<style>
/* 顶部居中：卡片从上往下滑入回弹 */
@keyframes notif-drop-in {
  from {
    opacity: 0;
    transform: translateY(-14px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
