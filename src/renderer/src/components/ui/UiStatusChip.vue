<template>
  <span class="ui-chip" :class="`ui-chip--${variant}`">
    <slot />
  </span>
</template>

<script setup lang="ts">
/**
 * 语义状态徽标（P1）：用 --*-soft 浅底 + --on-* 深字，浅色/深色主题各有一套 token。
 * 语义色表达状态（成功/警告/错误/进行中），粉彩只留给数据装饰卡，二者不混用。
 */
defineProps<{
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}>()
</script>

<style scoped>
.ui-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  white-space: nowrap;
}

.ui-chip--neutral {
  background: var(--bg-selected-subtle);
  color: var(--text-secondary);
}

.ui-chip--success {
  background: var(--success-soft);
  color: var(--on-success);
}

.ui-chip--warning {
  background: var(--warning-soft);
  color: var(--on-warning);
}

.ui-chip--danger {
  background: var(--danger-soft);
  color: var(--on-danger);
}

.ui-chip--info {
  background: var(--info-soft);
  color: var(--on-info);
}
</style>
