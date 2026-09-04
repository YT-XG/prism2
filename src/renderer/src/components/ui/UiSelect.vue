<template>
  <div
    class="ui-select"
    :class="[`ui-select--${size}`, { 'is-disabled': disabled, 'is-open': open }]"
  >
    <button
      ref="triggerRef"
      type="button"
      class="ui-select__trigger"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="label"
      :disabled="disabled"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="ui-select__value" :class="{ 'is-placeholder': !selectedLabel }">
        {{ selectedLabel || placeholder }}
      </span>
      <ChevronDown :size="14" :stroke-width="1.75" class="ui-select__chevron" />
    </button>
    <Teleport to="body">
      <Transition name="ui-select-pop">
        <div
          v-if="open"
          ref="panelRef"
          class="ui-select__panel"
          role="listbox"
          tabindex="-1"
          :style="panelStyle"
          @keydown="onPanelKeydown"
        >
          <div
            v-for="(opt, i) in normalizedOptions"
            :key="String(opt.value)"
            class="ui-select__option"
            :class="{
              'is-active': i === activeIndex,
              'is-selected': opt.value === modelValue
            }"
            role="option"
            :aria-selected="opt.value === modelValue"
            @click="select(opt.value)"
            @mouseenter="activeIndex = i"
          >
            {{ opt.label }}
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { ChevronDown } from '@lucide/vue'

type SelectOption = { label: string; value: string | number }

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    /** 选项：支持 `{ label, value }` 对象数组或原始值数组（label 取 String(value)） */
    options: Array<SelectOption | string | number>
    /** 无障碍标签（无可见 label 时必填，与 UiInput 同约定） */
    label?: string
    placeholder?: string
    disabled?: boolean
    /** 尺寸：sm 30px（默认，紧凑控件如标题栏内联）/ md 36px（与 UiInput 等高） */
    size?: 'sm' | 'md'
  }>(),
  { disabled: false, size: 'sm' }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void
}>()

const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const panelStyle = ref<Record<string, string>>({})
/** 打开前拥有焦点的元素，关闭后归还（与 UiDialog 同款焦点管理） */
let lastFocused: HTMLElement | null = null

const normalizedOptions = computed<SelectOption[]>(() =>
  props.options.map((o) =>
    typeof o === 'string' || typeof o === 'number'
      ? { label: String(o), value: o }
      : { label: o.label, value: o.value }
  )
)

const selectedLabel = computed(
  () => normalizedOptions.value.find((o) => o.value === props.modelValue)?.label ?? ''
)

function openPanel(): void {
  if (props.disabled || open.value) return
  open.value = true
  const i = normalizedOptions.value.findIndex((o) => o.value === props.modelValue)
  activeIndex.value = i >= 0 ? i : 0
  lastFocused = document.activeElement as HTMLElement | null
  nextTick(() => {
    updatePosition()
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeydown)
    window.addEventListener('resize', updatePosition)
    panelRef.value?.focus()
  })
}

function closePanel(): void {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('resize', updatePosition)
  lastFocused?.focus()
  lastFocused = null
}

function toggle(): void {
  if (open.value) closePanel()
  else openPanel()
}

function select(value: string | number): void {
  emit('update:modelValue', value)
  closePanel()
}

/** 浮层定位：紧贴触发器下方，底部空间不足时翻转到上方 */
function updatePosition(): void {
  const rect = triggerRef.value?.getBoundingClientRect()
  if (!rect) return
  const PANEL_MAX = 244 // 240 最大高度 + 4 间距
  const spaceBelow = window.innerHeight - rect.bottom
  const showBelow = spaceBelow >= PANEL_MAX || spaceBelow >= rect.top
  const top = showBelow ? rect.bottom + 4 : Math.max(8, rect.top - PANEL_MAX)
  panelStyle.value = {
    top: `${top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    transformOrigin: showBelow ? 'top center' : 'bottom center'
  }
}

function onDocPointerDown(e: PointerEvent): void {
  const target = e.target as Node
  if (triggerRef.value?.contains(target) || panelRef.value?.contains(target)) return
  closePanel()
}

function onDocKeydown(e: KeyboardEvent): void {
  if (!open.value) return
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      activeIndex.value = (activeIndex.value + 1) % normalizedOptions.value.length
      scrollActiveIntoView()
      break
    case 'ArrowUp':
      e.preventDefault()
      activeIndex.value =
        (activeIndex.value - 1 + normalizedOptions.value.length) % normalizedOptions.value.length
      scrollActiveIntoView()
      break
    case 'Enter':
      e.preventDefault()
      select(normalizedOptions.value[activeIndex.value].value)
      break
    case 'Escape':
    case 'Tab':
      e.preventDefault()
      closePanel()
      break
  }
}

/** 触发器在关闭态下：Enter/Space/↑/↓ 直接打开 */
function onTriggerKeydown(e: KeyboardEvent): void {
  if (open.value) return
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    openPanel()
  }
}

function onPanelKeydown(e: KeyboardEvent): void {
  // 浮层获焦后也响应键盘导航（与 document 级监听等价，多一层兜底）
  onDocKeydown(e)
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    const panel = panelRef.value
    if (!panel) return
    const el = panel.children[activeIndex.value] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  })
}

onBeforeUnmount(() => {
  if (open.value) closePanel()
})
</script>

<style scoped>
.ui-select {
  display: inline-flex;
  position: relative;
}

.ui-select__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  width: 100%;
  height: 30px;
  padding: 0 var(--sp-2);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    background-color var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft),
    transform var(--duration-fast) var(--ease-spring);
}

.ui-select--md .ui-select__trigger {
  height: 36px;
  padding: 0 var(--sp-3);
  font-size: var(--text-md);
}

.ui-select__trigger:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--text-muted);
}

.ui-select__trigger:active:not(:disabled) {
  transform: scale(0.97);
}

.ui-select.is-open .ui-select__trigger {
  background: var(--bg-hover);
  border-color: var(--brand);
}

.ui-select__trigger:focus-visible {
  outline: none;
  border-color: var(--brand);
  box-shadow: var(--ring);
}

.ui-select.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.ui-select__value {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-select__value.is-placeholder {
  color: var(--text-muted);
}

.ui-select__chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform var(--duration-fast) var(--ease-out-soft);
}

.ui-select.is-open .ui-select__chevron {
  transform: rotate(180deg);
}

/* 浮层：Teleport 到 body，fixed 定位贴合触发器 */
.ui-select__panel {
  position: fixed;
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
  padding: var(--sp-1) 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  outline: none;
}

.ui-select__option {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 var(--sp-3);
  font-size: var(--text-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.ui-select__option.is-active {
  background: var(--bg-hover);
}

.ui-select__option.is-selected {
  background: var(--bg-selected-subtle);
  color: var(--brand);
  font-weight: var(--font-semibold);
  animation: pop var(--duration-base) var(--ease-spring);
}

.ui-select__option:hover:not(.is-active) {
  background: var(--bg-hover);
}

/* 浮层弹入：fade + 轻微缩放，origin 随翻转方向切换（spring 增加弹感，leave 平滑收起） */
.ui-select-pop-enter-active {
  transition: opacity var(--duration-base) var(--ease-out-soft),
    transform var(--duration-base) var(--ease-spring);
}

.ui-select-pop-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out-soft),
    transform var(--duration-fast) var(--ease-out-soft);
}

.ui-select-pop-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.ui-select-pop-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
