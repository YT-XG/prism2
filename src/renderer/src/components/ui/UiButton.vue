<template>
  <button class="ui-btn" :class="`ui-btn--${variant}`" type="button">
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}>()
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

.ui-btn--primary {
  background: var(--bg-selected);
  color: var(--text-on-primary);
  box-shadow: var(--shadow-sm);
}

.ui-btn--primary:hover {
  background: #000;
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
  background: var(--danger);
  color: #fff;
}

.ui-btn--danger:hover {
  background: #d33f44;
}
</style>
