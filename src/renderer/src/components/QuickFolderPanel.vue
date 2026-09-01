<template>
  <div
    ref="el"
    class="qfp"
    :class="{ 'is-dragging': dragging }"
    :style="{
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      zIndex: dragging ? 30 : 10
    }"
  >
    <!-- 头部：拖拽手柄 + 标题 + 数量 + 添加 -->
    <div class="qfp__head" title="拖动以调整位置" @pointerdown="startDrag">
      <GripVertical :size="14" :stroke-width="1.6" class="qfp__grip" />
      <Folder :size="14" :stroke-width="1.6" class="qfp__folder-icon" />
      <span class="qfp__title">快捷文件夹</span>
      <span v-if="list.length" class="qfp__count">{{ list.length }}</span>
      <button
        type="button"
        class="qfp__add"
        title="添加快捷文件夹"
        aria-label="添加快捷文件夹"
        @pointerdown.stop
        @click="emit('add')"
      >
        <Plus :size="14" :stroke-width="1.6" />
      </button>
    </div>

    <!-- 空态：引导拖放 / 点标题栏 + 添加 -->
    <div v-if="!list.length" class="qfp__empty">
      <Folder :size="16" :stroke-width="1.6" class="qfp__empty-icon" />
      <span class="qfp__empty-title">暂无快捷文件夹</span>
      <span class="qfp__empty-hint">拖入文件夹或点击标题栏 + 添加</span>
    </div>

    <!-- 列表：每个快捷文件夹一行（左端手柄可拖拽排序） -->
    <div v-else class="qfp__list">
      <button
        v-for="(folder, index) in list"
        :key="folder.id"
        :data-index="index"
        type="button"
        class="qfp__row"
        :class="{
          'is-missing': folder.missing,
          'is-flash': folder.id === flashFolderId,
          'is-dragging': dragId === folder.id
        }"
        :title="
          folder.missing
            ? `${folder.alias || folder.name}（路径不存在，可移除）`
            : `${folder.alias || folder.name}（${folder.path}）`
        "
        @click="onRowClick(folder)"
      >
        <span
          class="qfp__row-grip"
          title="拖动排序"
          aria-label="拖动排序"
          @pointerdown.stop.prevent="startReorder($event, index)"
          @click.stop.prevent
        >
          <GripVertical :size="13" :stroke-width="1.6" />
        </span>
        <Folder
          :size="14"
          :stroke-width="1.6"
          class="qfp__row-icon"
          :class="{ 'is-missing': folder.missing }"
        />
        <span class="qfp__row-body">
          <span class="qfp__row-line">
            <span class="qfp__row-name">
              <template v-if="editingId === folder.id">
                <input
                  ref="aliasInput"
                  v-model="editValue"
                  class="qfp__row-edit"
                  type="text"
                  spellcheck="false"
                  maxlength="120"
                  placeholder="文件夹名（留空还原）"
                  @pointerdown.stop
                  @click.stop
                  @keydown.enter.prevent="commitEdit(folder)"
                  @keydown.esc.prevent="cancelEdit()"
                  @blur="commitEdit(folder)"
                />
              </template>
              <template v-else>{{ folder.alias || folder.name }}</template>
            </span>
            <span v-if="folder.missing" class="qfp__missing">
              <AlertTriangle :size="11" :stroke-width="1.6" /> 路径不存在
            </span>
          </span>
          <span class="qfp__row-path">{{ folder.path }}</span>
        </span>
        <span
          v-if="editingId !== folder.id"
          class="qfp__row-actions"
          @pointerdown.stop
          @click.stop
        >
          <button
            type="button"
            class="qfp__row-btn"
            title="重命名"
            aria-label="重命名"
            @click="startRename(folder)"
          >
            <Pencil :size="13" :stroke-width="1.6" />
          </button>
          <button
            v-if="!folder.missing"
            type="button"
            class="qfp__row-btn"
            title="在资源管理器中打开"
            aria-label="在资源管理器中打开"
            @click="emit('open', folder)"
          >
            <FolderOpen :size="13" :stroke-width="1.6" />
          </button>
          <button
            type="button"
            class="qfp__row-btn qfp__row-btn--danger"
            title="移除快捷文件夹"
            aria-label="移除快捷文件夹"
            @click="emit('remove', folder)"
          >
            <Trash2 :size="13" :stroke-width="1.6" />
          </button>
        </span>
      </button>
    </div>

    <!-- 右下角缩放手柄 -->
    <div
      class="qfp__resize"
      title="拖动以调整大小"
      @pointerdown.stop.prevent="startResize"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { GripVertical, Folder, FolderOpen, Plus, Trash2, AlertTriangle, Pencil } from '@lucide/vue'
import { useDrag } from '@renderer/composables/useDrag'
import type { QuickFolder } from '@preload/ipc'

/** 快捷文件夹面板默认尺寸与缩放钳制范围（px） */
const MIN_W = 260
const MIN_H = 200
const MAX_W = 720
const MAX_H = 640

const props = defineProps<{
  /** 快捷文件夹列表 */
  folders: QuickFolder[]
  /** 画布容器（拖拽边界钳制用） */
  canvas: () => HTMLElement | null
  /** 面板位置（未定位过时由父级给出默认值） */
  pos: { x: number; y: number }
  /** 面板尺寸 */
  size: { w: number; h: number }
  /** 打开成功高亮的文件夹 id（父组件按 id 触发） */
  flashFolderId: number | null
}>()

const emit = defineEmits<{
  (e: 'open', folder: QuickFolder): void
  (e: 'remove', folder: QuickFolder): void
  (e: 'drag-end', payload: { x: number; y: number }): void
  (e: 'resize-end', payload: { w: number; h: number }): void
  (e: 'add'): void
  /** 面板内行拖拽排序完成：按新顺序给出全部文件夹 id（父组件持久化） */
  (e: 'reorder', orderedIds: number[]): void
  /** 行内重命名完成：设置别名（alias=null 表示清除，回退到文件夹名；父组件持久化） */
  (e: 'rename', payload: { id: number; alias: string | null }): void
}>()

const el = ref<HTMLElement | null>(null)
/** 面板尺寸（随缩放实时变化，松手持久化） */
const w = ref(props.size.w)
const h = ref(props.size.h)

const { x, y, dragging, startDrag } = useDrag({
  container: props.canvas,
  element: () => el.value,
  initial: () => ({ x: props.pos.x, y: props.pos.y }),
  onEnd: (pos, moved) => {
    if (moved) emit('drag-end', { x: pos.x, y: pos.y })
  }
})

// 父级首次定位（右对齐默认落点）晚于本组件挂载：非拖拽态下同步位置
watch(
  () => props.pos,
  (p) => {
    if (!dragging.value && (x.value !== p.x || y.value !== p.y)) {
      x.value = p.x
      y.value = p.y
    }
  }
)

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

// ---------------------------------------------------------------------------
// 行内拖拽排序：指针事件（与整卡拖拽/缩放同模式），松手 emit('reorder', ids) 由父级持久化
// ---------------------------------------------------------------------------
/** 本地列表副本：拖拽时实时重排，外部列表变化经 watch 同步（拖拽中不覆盖） */
const list = ref<QuickFolder[]>([...props.folders])
/** 是否正在行内拖拽排序 */
const reordering = ref(false)
/** 正在拖拽的行 id */
const dragId = ref<number | null>(null)
/** 本次拖拽起点 Y（位移超过阈值才判定为拖拽，否则视为点击） */
let reorderStartY = 0
/** 是否发生了实际拖拽（用于抑制松手后的行 click，避免误打开） */
let reorderMoved = false
/** 拖拽松手后抑制下一次行 click */
let suppressOpen = false

watch(
  () => props.folders,
  (f) => {
    if (!reordering.value) list.value = f
  }
)

function startReorder(e: PointerEvent, index: number): void {
  if (e.button !== 0) return
  dragId.value = list.value[index].id
  reorderStartY = e.clientY
  reorderMoved = false
  reordering.value = true
  window.addEventListener('pointermove', onReorderMove)
  window.addEventListener('pointerup', onReorderEnd)
}

function onReorderMove(e: PointerEvent): void {
  if (dragId.value === null) return
  if (!reorderMoved && Math.abs(e.clientY - reorderStartY) < 4) return
  reorderMoved = true

  const from = list.value.findIndex((f) => f.id === dragId.value)
  if (from === -1) return
  const row = (
    document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
  )?.closest('.qfp__row')
  if (!row) return
  const hover = Number((row as HTMLElement).dataset.index ?? -1)
  if (hover === -1) return

  // 行中点判定：上半插到该行前，下半插到该行后；移除拖拽行后目标下标需前移一位
  const rect = row.getBoundingClientRect()
  let target = hover + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0)
  if (from < target) target -= 1
  if (target === from) return

  const next = [...list.value]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(target, next.length)), 0, moved)
  list.value = next
}

function onReorderEnd(): void {
  window.removeEventListener('pointermove', onReorderMove)
  window.removeEventListener('pointerup', onReorderEnd)
  const ids = list.value.map((f) => f.id)
  const changed = ids.some((id, i) => props.folders[i]?.id !== id)
  if (reorderMoved) {
    // 抑制本次拖拽松手后紧随的行 click（点击在 pointerup 后同一任务内派发，此处标记即可）
    suppressOpen = true
    setTimeout(() => {
      suppressOpen = false
    }, 0)
  }
  reordering.value = false
  dragId.value = null
  if (changed) emit('reorder', ids)
}

/** 行点击：打开文件夹；拖拽排序后的本次 click 仅吞掉，不触发打开 */
function onRowClick(folder: QuickFolder): void {
  if (suppressOpen) {
    suppressOpen = false
    return
  }
  emit('open', folder)
}

// ---------------------------------------------------------------------------
// 行内重命名（设置自定义别名）：点击行操作「重命名」进入内联编辑，Enter/失焦提交，Esc 取消
// ---------------------------------------------------------------------------
/** 正在编辑别名的行 id（null = 未在编辑） */
const editingId = ref<number | null>(null)
/** 编辑框当前值 */
const editValue = ref('')
const aliasInput = ref<HTMLInputElement | null>(null)
/** 是否已提交/取消（避免 Enter 与随后的 blur 双触发） */
let editSettled = false

watch(editingId, (id) => {
  if (id !== null) {
    void nextTick(() => {
      aliasInput.value?.focus()
      aliasInput.value?.select()
    })
  }
})

function startRename(folder: QuickFolder): void {
  editingId.value = folder.id
  editValue.value = folder.alias ?? folder.name
  editSettled = false
}

function commitEdit(folder: QuickFolder): void {
  if (editingId.value !== folder.id || editSettled) return
  editSettled = true
  editingId.value = null
  const alias = editValue.value.trim()
  emit('rename', { id: folder.id, alias: alias || null })
}

function cancelEdit(): void {
  editSettled = true
  editingId.value = null
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
  window.removeEventListener('pointermove', onReorderMove)
  window.removeEventListener('pointerup', onReorderEnd)
})
</script>

<style scoped>
.qfp {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  transition: box-shadow var(--duration-fast) var(--ease-out-soft);
}

.qfp.is-dragging {
  box-shadow: var(--shadow-lg);
  outline: 1px solid var(--brand);
}

/* 头部：拖拽手柄 + 标题 + 添加 */
.qfp__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
}

.qfp.is-dragging .qfp__head {
  cursor: grabbing;
}

.qfp__grip {
  color: var(--text-muted);
  flex-shrink: 0;
}

.qfp__folder-icon {
  color: var(--brand);
  flex-shrink: 0;
}

.qfp__title {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.qfp__count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-selected-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}

.qfp__add {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.qfp__add:hover {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
}

/* 空态 */
.qfp__empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-6);
  color: var(--text-muted);
}

.qfp__empty-icon {
  color: var(--text-muted);
}

.qfp__empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.qfp__empty-hint {
  font-size: 12px;
  color: var(--text-muted);
}

/* 列表 */
.qfp__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-2);
}

/* 行：图标 + 名称/路径 + 悬浮/聚焦操作 */
.qfp__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 44px;
  padding: var(--sp-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.qfp__row:hover {
  background: var(--bg-hover);
}

.qfp__row:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -1px;
}

/* 左端拖拽手柄：悬浮时浮现，按住即可拖拽排序 */
.qfp__row-grip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 24px;
  margin-left: -4px;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: grab;
  touch-action: none;
  opacity: 0.35;
  transition: opacity var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft), background-color var(--duration-fast) var(--ease-out-soft);
}

.qfp__row:hover .qfp__row-grip,
.qfp__row:focus-within .qfp__row-grip {
  opacity: 1;
}

.qfp__row-grip:hover {
  color: var(--text-primary);
  background: var(--bg-selected-subtle);
}

/* 拖拽中的行：品牌描边 + 抬升阴影 */
.qfp__row.is-dragging {
  background: var(--bg-selected-subtle);
  box-shadow: var(--shadow-sm);
  outline: 1px solid var(--brand);
}

.qfp__row.is-dragging .qfp__row-grip {
  cursor: grabbing;
  opacity: 1;
  color: var(--text-primary);
}

.qfp__row-icon {
  flex-shrink: 0;
  color: var(--brand);
}

.qfp__row-icon.is-missing {
  color: var(--text-muted);
}

.qfp__row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.qfp__row-line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.qfp__row-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 行内重命名输入框：占满名称区域，品牌描边 */
.qfp__row-edit {
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--brand);
  border-radius: var(--radius-sm);
  background: var(--bg-input, var(--bg-surface));
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  outline: none;
}

.qfp__row-edit::placeholder {
  color: var(--text-muted);
}

.qfp__row-edit:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -1px;
}

.qfp__row-path {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 失效路径：名称/路径置灰 + 危险角标，仅保留移除 */
.qfp__row.is-missing .qfp__row-name,
.qfp__row.is-missing .qfp__row-path {
  color: var(--text-muted);
}

.qfp__missing {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
}

/* 打开成功：短暂品牌描边高亮（父组件按 id 触发 flash） */
.qfp__row.is-flash {
  background: color-mix(in srgb, var(--brand) 8%, transparent);
  box-shadow: inset 0 0 0 2px var(--brand);
  animation: qfp-flash var(--duration-base) var(--ease-out-soft);
}

@keyframes qfp-flash {
  0% {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--brand) 30%, transparent);
  }
  100% {
    box-shadow: inset 0 0 0 2px var(--brand);
  }
}

/* 行内操作：hover 与 focus-within 都显示（不依赖 hover-only） */
.qfp__row-actions {
  flex-shrink: 0;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.qfp__row:hover .qfp__row-actions,
.qfp__row:focus-within .qfp__row-actions {
  opacity: 1;
}

.qfp__row-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.qfp__row-btn:hover {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
}

.qfp__row-btn--danger:hover {
  background: rgba(229, 72, 77, 0.12);
  color: var(--danger);
}

/* 右下角缩放手柄（hover 时浮现） */
.qfp__resize {
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

.qfp:hover .qfp__resize,
.qfp.is-dragging .qfp__resize {
  opacity: 1;
}
</style>
