<template>
  <button class="ui-btn" :class="[`ui-btn--${variant}`, `ui-btn--${size}`]" type="button">
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    /** 尺寸：xs=24px（列表行内）/ sm=30px（面板工具条）/ md=34px（默认，表单与弹窗） */
    size?: 'xs' | 'sm' | 'md'
  }>(),
  { size: 'md' }
)
</script>

<style scoped>
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 var(--sp-4);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft),
    transform 80ms var(--ease-out-soft);
}

.ui-btn:active {
  transform: scale(0.97);
}

.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.ui-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}

.ui-btn--primary {
  background: var(--brand);
  color: var(--text-on-primary);
  box-shadow: var(--shadow-sm);
}

.ui-btn--primary:hover {
  background: color-mix(in srgb, var(--brand) 86%, #000);
  transform: translateY(-1px);
}

.ui-btn--secondary {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.ui-btn--secondary:hover {
  background: var(--bg-hover);
}

.ui-btn--ghost {
  background: transparent;
  color: var(--text-secondary);
}

.ui-btn--ghost:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ui-btn--danger {
  background: var(--danger-bg);
  color: var(--text-on-primary);
}

.ui-btn--danger:hover {
  background: color-mix(in srgb, var(--danger-bg) 88%, #000);
}

.ui-btn--xs {
  height: 24px;
  padding: 0 var(--sp-2);
  font-size: var(--text-xs);
}

.ui-btn--sm {
  height: 30px;
  padding: 0 var(--sp-3);
  font-size: var(--text-sm);
}
</style>
