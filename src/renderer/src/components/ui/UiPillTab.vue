<template>
  <button class="ui-pill" :class="{ 'is-active': active }" type="button" @click="$emit('click')">
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{ active?: boolean }>()
defineEmits<{ (e: 'click'): void }>()
</script>

<style scoped>
.ui-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 var(--sp-3);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft);
}

.ui-pill:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ui-pill.is-active {
  background: var(--brand);
  color: #fff;
  animation: pop var(--duration-base) var(--ease-spring);
}
</style>
