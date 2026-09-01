<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="modelValue"
        ref="overlayRef"
        class="ui-dialog__overlay"
        @click.self="onOverlayClick"
      >
        <div
          ref="dialogRef"
          class="ui-dialog"
          :class="[`ui-dialog--${size}`, { 'ui-dialog--fullscreen': isFullscreen }]"
          :style="dialogStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <header v-if="title" class="ui-dialog__header">
            <h3>{{ title }}</h3>
            <div v-if="fullscreen" class="ui-dialog__header-actions">
              <button
                type="button"
                class="ui-dialog__fs-btn"
                :title="isFullscreen ? '退出全屏' : '全屏'"
                :aria-label="isFullscreen ? '退出全屏' : '全屏'"
                @click="toggleFullscreen"
              >
                <component :is="isFullscreen ? Minimize2 : Maximize2" :size="16" :stroke-width="1.75" />
              </button>
            </div>
          </header>
          <div class="ui-dialog__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="ui-dialog__footer">
            <slot name="footer" />
          </footer>
          <template v-if="resizable">
            <span class="ui-dialog__handle ui-dialog__handle--e" @pointerdown="startResize($event, 'e')" />
            <span class="ui-dialog__handle ui-dialog__handle--s" @pointerdown="startResize($event, 's')" />
            <span class="ui-dialog__handle ui-dialog__handle--se" @pointerdown="startResize($event, 'se')">
              <MoveDiagonal2 :size="12" :stroke-width="2" />
            </span>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { Maximize2, Minimize2, MoveDiagonal2 } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    /** 弹窗尺寸：md 默认 420px；lg 大编辑框 720px */
    size?: 'md' | 'lg'
    /** 点击遮罩（外界）是否关闭；编辑类弹窗设为 false 防误触 */
    overlayClose?: boolean
    /** 标题栏是否显示全屏切换按钮 */
    fullscreen?: boolean
    /** 是否支持拖拽缩放（右下角 + 右/下边缘手柄） */
    resizable?: boolean
  }>(),
  { size: 'md', overlayClose: true, fullscreen: false, resizable: false }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const overlayRef = ref<HTMLElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)
/** 打开前拥有焦点的元素，关闭后归还 */
let lastFocused: HTMLElement | null = null

// ---------------------------------------------------------------------------
// 全屏 / 拖拽缩放（居中布局下宽高按 2× 位移对称增长）
// ---------------------------------------------------------------------------
const isFullscreen = ref(false)
/** 用户拖拽后的自定义尺寸（px）；null = 使用类名默认尺寸 */
const customSize = ref<{ w: number; h: number } | null>(null)
/** 进入全屏前的尺寸，退出全屏时还原（跨全屏往返保持） */
let lastSize: { w: number; h: number } | null = null

const MIN_W = 320
const MIN_H = 260
/** 缩放上限：视口各留 16px 边距 */
const maxW = () => window.innerWidth - 32
const maxH = () => window.innerHeight - 32

type ResizeDir = 'e' | 's' | 'se'
let resizeStart: { x: number; y: number; w: number; h: number } | null = null
let resizeDir: ResizeDir | null = null

/** 弹窗当前渲染尺寸 */
function dialogSize(): { w: number; h: number } {
  return { w: dialogRef.value?.offsetWidth ?? 0, h: dialogRef.value?.offsetHeight ?? 0 }
}

const dialogStyle = computed(() => {
  if (isFullscreen.value || !customSize.value) return {}
  return {
    width: `${customSize.value.w}px`,
    height: `${customSize.value.h}px`,
    maxWidth: `calc(100vw - 32px)`
  }
})

function toggleFullscreen(): void {
  if (isFullscreen.value) {
    isFullscreen.value = false
    // 还原进入全屏前的尺寸
    if (lastSize) {
      customSize.value = lastSize
      lastSize = null
    }
  } else {
    lastSize = dialogSize()
    customSize.value = null
    isFullscreen.value = true
  }
}

function startResize(e: PointerEvent, dir: ResizeDir): void {
  if (e.button !== 0) return
  e.preventDefault()
  // 全屏态下拖拽：先退出全屏再缩放，避免尺寸叠加
  if (isFullscreen.value) {
    isFullscreen.value = false
    if (lastSize) {
      customSize.value = lastSize
      lastSize = null
    }
  }
  resizeStart = { x: e.clientX, y: e.clientY, ...dialogSize() }
  resizeDir = dir
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(e: PointerEvent): void {
  if (!resizeStart || !resizeDir) return
  const dx = e.clientX - resizeStart.x
  const dy = e.clientY - resizeStart.y
  let w = resizeStart.w
  let h = resizeStart.h
  if (resizeDir === 'e' || resizeDir === 'se') {
    w = Math.min(maxW(), Math.max(MIN_W, resizeStart.w + dx * 2))
  }
  if (resizeDir === 's' || resizeDir === 'se') {
    h = Math.min(maxH(), Math.max(MIN_H, resizeStart.h + dy * 2))
  }
  customSize.value = { w, h }
}

function onResizeEnd(): void {
  resizeStart = null
  resizeDir = null
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
}

function onOverlayClick(): void {
  if (props.overlayClose) emit('update:modelValue', false)
}

/** 焦点陷阱：Tab / Shift+Tab 在对话框内循环，Esc 关闭 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('update:modelValue', false)
    return
  }
  if (e.key !== 'Tab') return
  const dialog = overlayRef.value?.querySelector<HTMLElement>('.ui-dialog')
  if (!dialog) return
  const focusables = dialog.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      // 每次打开都从默认尺寸开始（缩放/全屏仅当次会话有效）
      isFullscreen.value = false
      customSize.value = null
      lastSize = null
      lastFocused = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      nextTick(() => {
        overlayRef.value?.querySelector<HTMLElement>('.ui-dialog')?.focus()
      })
    } else {
      document.removeEventListener('keydown', onKeydown)
      lastFocused?.focus()
      lastFocused = null
    }
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
})
</script>

<style scoped>
.ui-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 17, 17, 0.32);
  backdrop-filter: blur(4px);
}

.ui-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 92%;
  max-width: 420px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  outline: none;
}

/* 大编辑框（富文本便利贴等） */
.ui-dialog--lg {
  width: 96%;
  max-width: 720px;
}

/* 全屏态：铺满遮罩并留 24px 边距 */
.ui-dialog--fullscreen {
  position: fixed;
  inset: 24px;
  width: auto;
  height: auto;
  max-width: none;
}

.ui-dialog--fullscreen .ui-dialog__body {
  display: flex;
  flex-direction: column;
}

/* 全屏时让富文本编辑器填满剩余高度 */
.ui-dialog--fullscreen :deep(.rte) {
  flex: 1;
  min-height: 200px;
}

.ui-dialog--fullscreen :deep(.rte__editor) {
  max-height: none;
  flex: 1;
}

.ui-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) 0;
}

.ui-dialog__header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.ui-dialog__header-actions {
  flex-shrink: 0;
}

.ui-dialog__fs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.ui-dialog__fs-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ui-dialog__fs-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}

.ui-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp-4) var(--sp-5);
}

.ui-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: 0 var(--sp-5) var(--sp-4);
}

/* 缩放手柄（均在弹窗边界内侧，避免被 overflow:hidden 裁剪） */
.ui-dialog__handle {
  position: absolute;
  z-index: 1;
  touch-action: none;
}

.ui-dialog__handle--e {
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
}

.ui-dialog__handle--s {
  left: 0;
  bottom: 0;
  width: 100%;
  height: 6px;
  cursor: ns-resize;
}

.ui-dialog__handle--se {
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  cursor: nwse-resize;
}

.ui-dialog__handle--se:hover {
  color: var(--text-primary);
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--duration-base) var(--ease-out-soft);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

/* 面板弹入：遮罩淡入的同时面板用弹性曲线缩放上移 */
.dialog-enter-active .ui-dialog {
  animation: dialog-in var(--duration-base) var(--ease-spring);
}
</style>
