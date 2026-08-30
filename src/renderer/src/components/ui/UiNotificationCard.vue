<template>
  <div class="ui-notif" :class="`ui-notif--${type}`" role="status">
    <component :is="iconFor(type)" :size="18" :stroke-width="1.75" class="ui-notif__icon" />
    <div class="ui-notif__body">
      <div class="ui-notif__title">{{ title }}</div>
      <div v-if="message" class="ui-notif__msg">{{ message }}</div>
    </div>
    <span v-if="time" class="ui-notif__time">{{ time }}</span>
    <button v-if="closable" class="ui-notif__close" type="button" title="关闭" @click="$emit('close')">
      <X :size="13" :stroke-width="2" />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { CheckCircle2, AlertCircle, Info, X } from '@lucide/vue'
import type { ToastType } from '@renderer/composables/useToast'

/**
 * 通知卡片（P6 预留）：通知中心 / 托盘事件的统一卡片样式。
 * 使用语义状态色区分 info / success / error，深色主题自动生效。
 */
withDefaults(
  defineProps<{
    type?: ToastType
    title: string
    message?: string
    time?: string
    closable?: boolean
  }>(),
  { type: 'info', closable: true }
)

defineEmits<{ (e: 'close'): void }>()

function iconFor(type: ToastType): Component {
  if (type === 'success') return CheckCircle2
  if (type === 'error') return AlertCircle
  return Info
}
</script>

<style scoped>
.ui-notif {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-md);
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

.ui-notif--success .ui-notif__icon {
  color: var(--success);
}

.ui-notif--error .ui-notif__icon {
  color: var(--danger);
}

.ui-notif--info .ui-notif__icon {
  color: var(--info);
}
</style>
