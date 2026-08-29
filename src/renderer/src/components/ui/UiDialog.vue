<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="modelValue" class="ui-dialog__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="ui-dialog">
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
defineProps<{
  modelValue: boolean
  title?: string
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()
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
