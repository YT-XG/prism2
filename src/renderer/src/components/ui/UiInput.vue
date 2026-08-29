<template>
  <div class="ui-input">
    <span v-if="$slots.leading" class="ui-input__leading">
      <slot name="leading" />
    </span>
    <input
      :value="modelValue"
      :placeholder="placeholder"
      :type="type"
      :autofocus="autofocus"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string
  placeholder?: string
  type?: string
  autofocus?: boolean
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<style scoped>
.ui-input {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 36px;
  padding: 0 var(--sp-3);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
}

.ui-input:focus-within {
  border-color: var(--brand);
  box-shadow: var(--ring);
}

.ui-input__leading {
  display: flex;
  align-items: center;
  color: var(--text-muted);
}

.ui-input input {
  flex: 1;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-primary);
}

.ui-input input::placeholder {
  color: var(--text-muted);
}
</style>
