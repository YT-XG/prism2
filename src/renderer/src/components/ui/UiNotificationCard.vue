<template>
  <div
    class="ui-notif"
    :class="[
      `ui-notif--${type}`,
      { 'is-unread': unread, 'has-action': !!actionText }
    ]"
    role="status"
  >
    <span v-if="unread" class="ui-notif__dot" aria-hidden="true" />
    <component :is="iconFor(type)" :size="18" :stroke-width="1.75" class="ui-notif__icon" />
    <div class="ui-notif__body">
      <div class="ui-notif__title">{{ title }}</div>
      <div v-if="message" class="ui-notif__msg">{{ message }}</div>
    </div>
    <span v-if="time" class="ui-notif__time">{{ time }}</span>
    <button v-if="closable" class="ui-notif__close" type="button" title="关闭" @click.stop="$emit('close')">
      <X :size="13" :stroke-width="2" />
    </button>
    <button
      v-if="actionText"
      class="ui-notif__action"
      type="button"
      @click.stop="$emit('action')"
    >
      {{ actionText }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from '@lucide/vue'
import type { ToastType } from '@renderer/composables/useToast'

/**
 * 通知卡片：通知中心 / 托盘事件 / 瞬时提示的统一卡片样式。
 * 使用语义状态色区分 info / success / warning / error，深色主题自动生效。
 * unread 用于通知中心列表标记未读（左侧品牌色圆点 + 浅色底）。
 */
withDefaults(
  defineProps<{
    type?: ToastType
    title: string
    message?: string
    time?: string
    closable?: boolean
    unread?: boolean
    /** 右下角操作按钮文案（如邮件通知的「已读」）；设置后点击触发 action，不触发卡片整体点击 */
    actionText?: string
  }>(),
  { type: 'info', closable: true, unread: false }
)

defineEmits<{ (e: 'close'): void; (e: 'action'): void }>()

function iconFor(type: ToastType): Component {
  if (type === 'success') return CheckCircle2
  if (type === 'error') return AlertCircle
  if (type === 'warning') return AlertTriangle
  return Info
}
</script>

<style scoped>
.ui-notif {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-md);
}

/* 有右下角操作按钮时，底部留出按钮位置 */
.ui-notif.has-action {
  padding-bottom: 40px;
}

/* 未读：浅品牌底色 + 左侧品牌色圆点（通知中心列表用） */
.ui-notif.is-unread {
  background: var(--bg-selected-subtle);
}

.ui-notif__dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--brand);
}

.ui-notif__icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.ui-notif__body {
  flex: 1;
  min-width: 0;
}

.ui-notif__title {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.ui-notif__msg {
  margin-top: 2px;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--text-secondary);
  word-break: break-all;
}

.ui-notif__time {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.ui-notif__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  margin-left: var(--sp-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.ui-notif__close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 右下角操作按钮（如邮件通知「已读」）：绝对定位底右，命中区域 ≥ 视觉 */
.ui-notif__action {
  position: absolute;
  right: var(--sp-2);
  bottom: var(--sp-2);
  min-width: 64px;
  padding: var(--sp-1) var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
  color: var(--brand);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft);
}

.ui-notif__action:hover {
  background: var(--brand-subtle);
  border-color: var(--brand);
  color: var(--brand);
}

.ui-notif--success .ui-notif__icon {
  color: var(--success);
}

.ui-notif--error .ui-notif__icon {
  color: var(--danger);
}

.ui-notif--warning .ui-notif__icon {
  color: var(--warning);
}

.ui-notif--info .ui-notif__icon {
  color: var(--info);
}
</style>
