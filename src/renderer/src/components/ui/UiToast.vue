<template>
  <Teleport to="body">
    <div class="ui-toast__host" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="ui-toast" :class="`ui-toast--${t.type}`">
          <component :is="iconFor(t.type)" :size="16" :stroke-width="2" class="ui-toast__icon" />
          <span class="ui-toast__msg">{{ t.message }}</span>
          <button class="ui-toast__close" type="button" title="关闭" @click="dismiss(t.id)">
            <X :size="13" :stroke-width="2" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { X, CheckCircle2, AlertCircle, Info } from '@lucide/vue'
import { useToast, type ToastType } from '@renderer/composables/useToast'

const { toasts, dismiss } = useToast()

function iconFor(type: ToastType): Component {
  if (type === 'success') return CheckCircle2
  if (type === 'error') return AlertCircle
  return Info
}
</script>

<style scoped>
.ui-toast__host {
  position: fixed;
  top: var(--sp-4);
  right: var(--sp-4);
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  pointer-events: none;
}

.ui-toast {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 240px;
  max-width: 360px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.ui-toast__icon {
  flex-shrink: 0;
}

.ui-toast__msg {
  flex: 1;
  font-size: var(--text-md);
  line-height: 1.45;
  color: var(--text-primary);
  word-break: break-all;
}

.ui-toast__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.ui-toast__close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ui-toast--success .ui-toast__icon {
  color: var(--success);
}

.ui-toast--error .ui-toast__icon {
  color: var(--danger);
}

.ui-toast--info .ui-toast__icon {
  color: var(--info);
}

.toast-enter-active {
  animation: toast-in var(--duration-base) var(--ease-out-soft);
}

.toast-leave-active {
  transition: opacity 160ms var(--ease-out-soft), transform 160ms var(--ease-out-soft);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
