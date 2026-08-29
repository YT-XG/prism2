<template>
  <button
    type="button"
    class="ui-switch"
    role="switch"
    :class="{ 'is-on': modelValue, 'is-disabled': disabled }"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="ui-switch__thumb" />
  </button>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean }>()
defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()
</script>

<style scoped>
.ui-switch {
  position: relative;
  width: 34px;
  height: 20px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--border);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.ui-switch.is-on {
  background: var(--brand);
}

.ui-switch.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ui-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-fast) var(--ease-out-soft);
}

.ui-switch.is-on .ui-switch__thumb {
  transform: translateX(14px);
}
</style>