<template>
  <div
    ref="el"
    class="qf-card"
    :class="{ 'is-dragging': dragging, 'is-missing': folder.missing, 'is-flash': flash }"
    :style="{
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      zIndex: dragging ? 30 : 20
    }"
    role="button"
    :title="
      folder.missing
        ? `${folder.name}（路径不存在，可移除）`
        : `${folder.name}（${folder.path}）`
    "
    @pointerdown="startDrag"
    @dblclick="onDblClick"
  >
    <!-- 头部：拖拽手柄 + 图标 + 名称 -->
    <div class="qf-card__head">
      <GripVertical :size="13" :stroke-width="1.6" class="qf-card__grip" />
      <Folder :size="14" :stroke-width="1.6" class="qf-card__folder-icon" />
      <span class="qf-card__name">{{ folder.name }}</span>
    </div>

    <!-- 失效提示：文件夹已被移动/删除 -->
    <div v-if="folder.missing" class="qf-card__missing">
      <AlertTriangle :size="12" :stroke-width="1.6" /> 路径不存在
    </div>

    <!-- 完整路径（关键文本不截断：可换行 + title 兜底） -->
    <div class="qf-card__path" :title="folder.path">{{ folder.path }}</div>

    <!-- 悬浮操作：打开 / 移除 -->
    <div class="qf-card__footer" @pointerdown.stop @click.stop>
      <button
        v-if="!folder.missing"
        class="qf-btn"
        title="在资源管理器中打开"
        @click="emit('open', folder)"
      >
        <FolderOpen :size="13" :stroke-width="1.6" /> 打开
      </button>
      <button class="qf-btn qf-btn--danger" title="移除快捷文件夹" @click="emit('remove', folder)">
        <Trash2 :size="13" :stroke-width="1.6" /> 移除
      </button>
    </div>

    <!-- 右下角缩放手柄 -->
    <div
      class="qf-card__resize"
      title="拖动以调整大小"
      @pointerdown.stop.prevent="startResize"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { GripVertical, Folder, FolderOpen, Trash2, AlertTriangle } from '@lucide/vue'
import { useDrag } from '@renderer/composables/useDrag'
import type { QuickFolder } from '@preload/ipc'

/** 快捷文件夹卡片默认尺寸与缩放钳制范围（px） */
const DEFAULT_W = 220
const DEFAULT_H = 120
const MIN_W = 180
const MIN_H = 100
const MAX_W = 520
const MAX_H = 400

const props = defineProps<{
  folder: QuickFolder
  /** 画布容器（拖拽边界钳制用） */
  canvas: () => HTMLElement | null
  /** 默认位置（folder.home_x/home_y 为 null 时的兜底） */
  fallbackPos: { x: number; y: number }
  /** 打开成功后短暂高亮（由父组件按 id 触发） */
  flash?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', folder: QuickFolder): void
  (e: 'remove', folder: QuickFolder): void
  (e: 'drag-end', payload: { id: number; x: number; y: number }): void
  (e: 'resize-end', payload: { id: number; w: number; h: number }): void
}>()

const el = ref<HTMLElement | null>(null)
/** 卡片尺寸（随缩放实时变化，松手持久化） */
const w = ref(props.folder.home_w ?? DEFAULT_W)
const h = ref(props.folder.home_h ?? DEFAULT_H)

const { x, y, dragging, startDrag } = useDrag({
  container: props.canvas,
  element: () => el.value,
  initial: () => ({
    x: props.folder.home_x ?? props.fallbackPos.x,
    y: props.folder.home_y ?? props.fallbackPos.y
  }),
  onEnd: (pos, moved) => {
    if (moved) emit('drag-end', { id: props.folder.id, x: pos.x, y: pos.y })
    else if (!props.folder.missing) emit('open', props.folder)
  }
})

/** 双击打开（缺失路径不响应）；单击已由 useDrag onEnd 触发，父组件做去重 */
function onDblClick(): void {
  if (!props.folder.missing) emit('open', props.folder)
}

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
    id: props.folder.id,
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
.qf-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: grab;
  user-select: none;
  touch-action: none;
  overflow: hidden;
  transition: box-shadow var(--duration-fast) var(--ease-out-soft);
}

.qf-card.is-dragging {
  cursor: grabbing;
  box-shadow: var(--shadow-lg);
  outline: 1px solid var(--brand);
}

.qf-card:hover {
  box-shadow: var(--shadow-md);
}

/* 失效路径：整卡置灰 + 虚线边框，仅保留移除操作 */
.qf-card.is-missing {
  border-style: dashed;
  opacity: 0.72;
  cursor: default;
}

.qf-card.is-missing .qf-card__name,
.qf-card.is-missing .qf-card__path {
  color: var(--text-muted);
}

.qf-card__missing {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: var(--sp-2) var(--sp-3) 0;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
  flex-shrink: 0;
}

/* 打开成功：短暂品牌描边高亮（父组件按 id 触发 flash） */
.qf-card.is-flash {
  outline: 2px solid var(--brand);
  outline-offset: -1px;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 30%, transparent);
  animation: qf-flash var(--duration-base) var(--ease-out-soft);
}

@keyframes qf-flash {
  0% {
    outline-color: color-mix(in srgb, var(--brand) 30%, transparent);
  }
  100% {
    outline-color: var(--brand);
  }
}

.qf-card__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border);
}

.qf-card__grip {
  color: var(--text-muted);
  flex-shrink: 0;
}

.qf-card__folder-icon {
  color: var(--brand);
  flex-shrink: 0;
}

.qf-card__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qf-card__path {
  flex: 1;
  min-height: 0;
  padding: var(--sp-2) var(--sp-3);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
  word-break: break-all;
  overflow-y: auto;
}

.qf-card__footer {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-2) var(--sp-2);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.qf-card:hover .qf-card__footer,
.qf-card.is-dragging .qf-card__footer {
  opacity: 1;
}

.qf-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 var(--sp-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.qf-btn:hover {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
}

.qf-btn--danger:hover {
  background: rgba(229, 72, 77, 0.12);
  color: var(--danger);
}

/* 右下角缩放手柄（hover 时浮现） */
.qf-card__resize {
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

.qf-card:hover .qf-card__resize,
.qf-card.is-dragging .qf-card__resize {
  opacity: 1;
}
</style>
