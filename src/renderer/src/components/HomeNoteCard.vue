<template>
  <div
    ref="el"
    class="home-note"
    :class="[`home-note--${note.color}`, { 'is-dragging': dragging }]"
    :style="{
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      zIndex: dragging ? 30 : 20
    }"
    role="button"
    :title="stripHtml(note.content)"
    @pointerdown="startDrag"
  >
    <div class="home-note__content" v-html="note.content"></div>
    <div class="home-note__footer">
      <span class="home-note__pinned"><Pin :size="11" :stroke-width="1.75" /> 已贴主页</span>
      <div class="home-note__actions" @pointerdown.stop @click.stop>
        <button class="home-note-btn" title="取消贴主页" @click="emit('unpin', note)">
          <Pin :size="13" :stroke-width="1.75" />
        </button>
        <button class="home-note-btn home-note-btn--danger" title="删除" @click="emit('delete', note)">
          <Trash2 :size="13" :stroke-width="1.6" />
        </button>
      </div>
    </div>
    <!-- 右下角缩放手柄 -->
    <div
      class="home-note__resize"
      title="拖动以调整大小"
      @pointerdown.stop.prevent="startResize"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { Pin, Trash2 } from '@lucide/vue'
import { useDrag } from '@renderer/composables/useDrag'
import type { StickyNote } from '@preload/ipc'

/** 便利贴默认尺寸与缩放钳制范围（px） */
const DEFAULT_W = 200
const DEFAULT_H = 104
const MIN_W = 160
const MIN_H = 96
const MAX_W = 480
const MAX_H = 360

const props = defineProps<{
  note: StickyNote
  /** 画布容器（拖拽边界钳制用） */
  canvas: () => HTMLElement | null
  /** 默认位置（note.home_x/home_y 为 null 时的兜底） */
  fallbackPos: { x: number; y: number }
}>()

const emit = defineEmits<{
  (e: 'edit', note: StickyNote): void
  (e: 'unpin', note: StickyNote): void
  (e: 'delete', note: StickyNote): void
  (e: 'drag-end', payload: { id: number; x: number; y: number }): void
  (e: 'resize-end', payload: { id: number; w: number; h: number }): void
}>()

/** 去除 HTML 标签得到纯文本（提示条展示用） */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

const el = ref<HTMLElement | null>(null)
/** 卡片尺寸（随缩放实时变化，松手持久化） */
const w = ref(props.note.home_w ?? DEFAULT_W)
const h = ref(props.note.home_h ?? DEFAULT_H)

const { x, y, dragging, startDrag } = useDrag({
  container: props.canvas,
  element: () => el.value,
  initial: () => ({
    x: props.note.home_x ?? props.fallbackPos.x,
    y: props.note.home_y ?? props.fallbackPos.y
  }),
  onEnd: (pos, moved) => {
    if (moved) emit('drag-end', { id: props.note.id, x: pos.x, y: pos.y })
    else emit('edit', props.note)
  }
})

// ---------------------------------------------------------------------------
// 缩放：右下角手柄指针事件（独立于整卡拖拽，仿 useDrag 模式）
// ---------------------------------------------------------------------------
let resizeStartX = 0
let resizeStartY = 0
let startW = 0
let startH = 0

function onResizeMove(e: PointerEvent): void {
  w.value = Math.min(MAX_W, Math.max(MIN_W, startW + (e.clientX - resizeStartX)))
  h.value = Math.min(MAX_H, Math.max(MIN_H, startH + (e.clientY - resizeStartY)))
}

function onResizeUp(e: PointerEvent): void {
  ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
  emit('resize-end', {
    id: props.note.id,
    w: Math.round(w.value),
    h: Math.round(h.value)
  })
}

function startResize(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  startW = w.value
  startH = h.value
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeUp)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
})
</script>

<style scoped>
.home-note {
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: grab;
  user-select: none;
  touch-action: none;
  overflow: hidden;
  transition: box-shadow var(--duration-fast) var(--ease-out-soft);
}

.home-note.is-dragging {
  cursor: grabbing;
  box-shadow: var(--shadow-lg);
  outline: 1px solid var(--brand);
}

.home-note:hover {
  box-shadow: var(--shadow-md);
}

.home-note--lavender {
  background: var(--accent-lavender);
  color: var(--text-on-accent-lavender);
}
.home-note--mint {
  background: var(--accent-mint);
  color: var(--text-on-accent-mint);
}
.home-note--yellow {
  background: var(--accent-yellow);
  color: var(--text-on-accent-yellow);
}
.home-note--blue {
  background: var(--accent-blue);
  color: var(--text-on-accent-blue);
}
.home-note--violet {
  background: var(--accent-violet);
  color: var(--text-on-accent-violet);
}

.home-note__content {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
}

.home-note__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
}

.home-note__pinned {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.85;
}

.home-note__actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.home-note:hover .home-note__actions {
  opacity: 1;
}

.home-note-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  opacity: 0.75;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out-soft),
    background-color var(--duration-fast) var(--ease-out-soft);
}

.home-note-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  opacity: 1;
}

.home-note-btn--danger:hover {
  color: var(--danger);
}

/* 右下角缩放手柄（hover 时浮现） */
.home-note__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  touch-action: none;
  opacity: 0;
  background: linear-gradient(135deg, transparent 50%, rgba(0, 0, 0, 0.35) 50%);
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.home-note:hover .home-note__resize,
.home-note.is-dragging .home-note__resize {
  opacity: 1;
}
</style>
