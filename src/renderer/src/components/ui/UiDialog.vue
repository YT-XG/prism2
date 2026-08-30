<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="modelValue"
        ref="overlayRef"
        class="ui-dialog__overlay"
        @click.self="$emit('update:modelValue', false)"
      >
        <div class="ui-dialog" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
          <header v-if="title" class="ui-dialog__header">
            <h3>{{ title }}</h3>
          </header>
          <div class="ui-dialog__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="ui-dialog__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const overlayRef = ref<HTMLElement | null>(null)
/** 打开前拥有焦点的元素，关闭后归还 */
let lastFocused: HTMLElement | null = null

/** 焦点陷阱：Tab / Shift+Tab 在对话框内循环，Esc 关闭 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('update:modelValue', false)
    return
  }
  if (e.key !== 'Tab') return
  const dialog = overlayRef.value?.querySelector<HTMLElement>('.ui-dialog')
  if (!dialog) return
  const focusables = dialog.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      nextTick(() => {
        overlayRef.value?.querySelector<HTMLElement>('.ui-dialog')?.focus()
      })
    } else {
      document.removeEventListener('keydown', onKeydown)
      lastFocused?.focus()
      lastFocused = null
    }
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.ui-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 17, 17, 0.32);
  backdrop-filter: blur(4px);
}

.ui-dialog {
  width: 92%;
  max-width: 420px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  outline: none;
}

.ui-dialog__header {
  padding: var(--sp-4) var(--sp-5) 0;
}

.ui-dialog__header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.ui-dialog__body {
  padding: var(--sp-4) var(--sp-5);
}

.ui-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: 0 var(--sp-5) var(--sp-4);
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--duration-base) var(--ease-out-soft);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

/* 面板弹入：遮罩淡入的同时面板用弹性曲线缩放上移 */
.dialog-enter-active .ui-dialog {
  animation: dialog-in var(--duration-base) var(--ease-spring);
}
</style>
