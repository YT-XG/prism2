<template>
  <div
    class="ui-input"
    :class="{ 'ui-input--picker': isPicker }"
    @click="openPicker"
  >
    <span v-if="$slots.leading" class="ui-input__leading">
      <slot name="leading" />
    </span>
    <input
      ref="inputRef"
      :value="modelValue"
      :placeholder="placeholder"
      :type="type"
      :autofocus="autofocus"
      :aria-label="label"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    type?: string
    autofocus?: boolean
    /** 无障碍标签：placeholder 不应作为唯一标签，搜索框等必须提供 */
    label?: string
  }>(),
  { type: 'text' }
)

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)

/** 自带原生选择面板的输入类型：整行可点（含前置图标），统一经 showPicker() 唤出 */
const PICKER_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week'])
const isPicker = computed(() => PICKER_TYPES.has(props.type))

/**
 * 打开浏览器原生选择面板（日期/时间等）。
 * 背景：选择器面板的原生命中区是右侧 indicator，业务中常将其隐藏并换成自定义
 * 前置图标，导致点输入框/图标都唤不出面板；showPicker() 在用户手势内显式唤出。
 */
function openPicker(): void {
  if (!isPicker.value) return
  const el = inputRef.value
  if (!el || typeof el.showPicker !== 'function') return
  try {
    el.showPicker()
  } catch {
    // 面板已打开（InvalidStateError）或非用户激活态（NotAllowedError）：忽略
  }
}
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

/* 日期/时间类输入：整行（含前置图标）都是选择器热区 */
.ui-input--picker {
  cursor: pointer;
}

.ui-input--picker .ui-input__leading {
  cursor: pointer;
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

.ui-input--picker input {
  cursor: pointer;
}

.ui-input input::placeholder {
  color: var(--text-muted);
}
</style>
