<template>
  <div class="ui-empty">
    <div class="ui-empty__icon" :class="{ 'is-loading': variant === 'loading' }">
      <Loader2 v-if="variant === 'loading'" :size="24" :stroke-width="1.75" />
      <AlertCircle v-else-if="variant === 'error'" :size="28" :stroke-width="1.5" />
      <slot v-else name="icon" />
    </div>
    <div class="ui-empty__title">{{ title }}</div>
    <div v-if="hint" class="ui-empty__hint">{{ hint }}</div>
    <div v-if="$slots.action" class="ui-empty__action">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader2, AlertCircle } from '@lucide/vue'

/**
 * 三态占位（P6）：empty（空内容）/ loading（加载中）/ error（失败）。
 * loading 显示旋转图标；error 显示警示图标；两者均可配合 action 插槽提供重试等操作。
 */
withDefaults(
  defineProps<{
    title: string
    hint?: string
    variant?: 'empty' | 'loading' | 'error'
  }>(),
  { variant: 'empty' }
)
</script>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-8) var(--sp-4);
  color: var(--text-muted);
}

.ui-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.45;
}

.ui-empty__icon.is-loading {
  opacity: 0.6;
  animation: spin 1s linear infinite;
}

.ui-empty__icon:not(.is-loading) {
  animation: float 3s ease-in-out infinite;
}

.ui-empty__title {
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.ui-empty__hint {
  font-size: var(--text-sm);
  text-align: center;
}

.ui-empty__action {
  margin-top: var(--sp-2);
}
</style>
