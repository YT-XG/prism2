<template>
  <div class="ui-empty">
    <div class="ui-empty__icon">
      <slot name="icon" />
    </div>
    <div class="ui-empty__title">{{ title }}</div>
    <div v-if="hint" class="ui-empty__hint">{{ hint }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  hint?: string
}>()
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
  opacity: 0.4;
}

.ui-empty__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.ui-empty__hint {
  font-size: 12px;
}
</style>
