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
    <!-- 头部：拖拽手柄 + 标题 + 数量 + 新建分组 + 添加 -->
    <div class="qfp__head" title="拖动以调整位置" @pointerdown="startDrag">
      <GripVertical :size="14" :stroke-width="1.6" class="qfp__grip" />
      <Folder :size="14" :stroke-width="1.6" class="qfp__folder-icon" />
      <span class="qfp__title">快捷打开</span>
      <span v-if="list.length" class="qfp__count">{{ list.length }}</span>
      <button
        type="button"
        class="qfp__add"
        title="新建分组"
        aria-label="新建分组"
        @pointerdown.stop
        @click="emit('add-group')"
      >
        <FolderPlus :size="14" :stroke-width="1.6" />
      </button>
      <button
        type="button"
        class="qfp__add"
        title="添加文件或文件夹"
        aria-label="添加文件或文件夹"
        @pointerdown.stop
        @click="emit('add')"
      >
        <Plus :size="14" :stroke-width="1.6" />
      </button>
    </div>

    <!-- 空态：引导拖放 / 点标题栏添加 -->
    <div v-if="!list.length" class="qfp__empty">
      <Folder :size="16" :stroke-width="1.6" class="qfp__empty-icon" />
      <span class="qfp__empty-title">暂无快捷打开</span>
      <span class="qfp__empty-hint">拖入文件或文件夹，或点击标题栏新建分组 / 添加</span>
    </div>

    <!-- 列表：按分组分区展示（自定义分组按创建顺序，未分组恒在末尾） -->
    <div v-else class="qfp__list">
      <section
        v-for="sec in sections"
        :key="sec.key"
        :data-gkey="sec.key"
        class="qfp__group"
        :class="{ 'is-collapsed': collapsed.has(sec.key) }"
      >
        <!-- 分组头：折叠切换 + 名称 + 数量 + 管理（自定义组） -->
        <div
          class="qfp__group-head"
          :title="sec.isCustom ? '点击折叠 / 展开分组' : '未分组'"
          @click="toggleCollapse(sec.key)"
        >
          <ChevronRight
            :size="13"
            :stroke-width="1.6"
            class="qfp__group-chev"
            :class="{ 'is-open': !collapsed.has(sec.key) }"
          />
          <FolderOpen
            v-if="!collapsed.has(sec.key)"
            :size="13"
            :stroke-width="1.6"
            class="qfp__group-icon"
          />
          <Folder v-else :size="13" :stroke-width="1.6" class="qfp__group-icon" />
          <template v-if="sec.isCustom && editingGroupId === sec.groupId">
            <input
              ref="groupInput"
              v-model="groupEditValue"
              class="qfp__group-edit"
              type="text"
              spellcheck="false"
              maxlength="60"
              placeholder="分组名"
              @pointerdown.stop
              @click.stop
              @keydown.enter.prevent="commitGroupEdit(sec)"
              @keydown.esc.prevent="cancelGroupEdit()"
              @blur="commitGroupEdit(sec)"
            />
          </template>
          <span v-else class="qfp__group-name">{{ sec.label }}</span>
          <span v-if="sec.items.length" class="qfp__count">{{ sec.items.length }}</span>
          <span
            v-if="sec.isCustom"
            class="qfp__group-actions"
            @pointerdown.stop
            @click.stop
          >
            <button
              type="button"
              class="qfp__row-btn"
              title="重命名分组"
              aria-label="重命名分组"
              @click="startGroupRename(sec)"
            >
              <Pencil :size="12" :stroke-width="1.6" />
            </button>
            <button
              type="button"
              class="qfp__row-btn qfp__row-btn--danger"
              title="删除分组"
              aria-label="删除分组"
              @click="emit('delete-group', sec.groupId!)"
            >
              <Trash2 :size="12" :stroke-width="1.6" />
            </button>
          </span>
        </div>

        <!-- 分组内容：条目行（组内拖拽排序） / 空分组提示 -->
        <div v-if="!collapsed.has(sec.key)" class="qfp__group-body">
          <template v-if="sec.items.length">
            <button
              v-for="(folder, index) in sec.items"
              :key="folder.id"
              :data-index="index"
              :data-gkey="sec.key"
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
                @pointerdown.stop.prevent="startReorder($event, sec, index)"
                @click.stop.prevent
              >
                <GripVertical :size="13" :stroke-width="1.6" />
              </span>
              <Folder
                v-if="!folder.isFile"
                :size="14"
                :stroke-width="1.6"
                class="qfp__row-icon"
                :class="{ 'is-missing': folder.missing }"
              />
              <File
                v-else
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
                        placeholder="名称（留空还原）"
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
                  title="移动到分组"
                  aria-label="移动到分组"
                  @click="toggleMoveMenu($event, folder)"
                >
                  <FolderInput :size="13" :stroke-width="1.6" />
                </button>
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
                  title="打开"
                  aria-label="打开"
                  @click="emit('open', folder)"
                >
                  <FolderOpen :size="13" :stroke-width="1.6" />
                </button>
                <button
                  type="button"
                  class="qfp__row-btn qfp__row-btn--danger"
                  title="移除"
                  aria-label="移除"
                  @click="emit('remove', folder)"
                >
                  <Trash2 :size="13" :stroke-width="1.6" />
                </button>
              </span>
            </button>
          </template>
          <div v-else class="qfp__group-empty">空分组，拖入或点条目「移动到」</div>
        </div>
      </section>
    </div>

    <!-- 移动到分组菜单（Teleport 到 body，避免被面板 overflow 裁剪） -->
    <Teleport to="body">
      <div
        v-if="moveMenu"
        class="qfp__move-menu"
        :style="{ left: `${moveMenu.left}px`, top: `${moveMenu.top}px` }"
        @pointerdown.stop
      >
        <div class="qfp__move-title">移动到分组</div>
        <button
          v-for="g in moveOptions"
          :key="g.key"
          type="button"
          class="qfp__move-item"
          :class="{ 'is-current': g.groupId === currentGroupOfMoveMenu }"
          @click="chooseMoveTarget(g.groupId)"
        >
          <Folder v-if="g.groupId !== null" :size="13" :stroke-width="1.6" />
          <FolderMinus v-else :size="13" :stroke-width="1.6" />
          <span>{{ g.label }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 右下角缩放手柄 -->
    <div
      class="qfp__resize"
      title="拖动以调整大小"
      @pointerdown.stop.prevent="startResize"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import {
  GripVertical,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  FolderMinus,
  File,
  Plus,
  Trash2,
  AlertTriangle,
  Pencil,
  ChevronRight
} from '@lucide/vue'
import { useDrag } from '@renderer/composables/useDrag'
import type { QuickFolder, QuickFolderGroup } from '@preload/ipc'

/** 快捷打开面板默认尺寸与缩放钳制范围（px） */
const MIN_W = 260
const MIN_H = 200
const MAX_W = 720
const MAX_H = 640

const props = defineProps<{
  /** 快捷打开列表 */
  folders: QuickFolder[]
  /** 分组列表（用户自定义分类；「未分组」为虚拟桶不在此列） */
  groups: QuickFolderGroup[]
  /** 画布容器（拖拽边界钳制用） */
  canvas: () => HTMLElement | null
  /** 面板位置（未定位过时由父级给出默认值） */
  pos: { x: number; y: number }
  /** 面板尺寸 */
  size: { w: number; h: number }
  /** 打开成功高亮的项 id（父组件按 id 触发） */
  flashFolderId: number | null
}>()

const emit = defineEmits<{
  (e: 'open', folder: QuickFolder): void
  (e: 'remove', folder: QuickFolder): void
  (e: 'drag-end', payload: { x: number; y: number }): void
  (e: 'resize-end', payload: { w: number; h: number }): void
  (e: 'add'): void
  /** 新建分组（父组件持久化后回传 groups prop） */
  (e: 'add-group'): void
  /** 重命名分组：设置分组名（父组件持久化） */
  (e: 'rename-group', payload: { id: number; name: string }): void
  /** 删除分组（组内条目移回未分组，父组件持久化） */
  (e: 'delete-group', id: number): void
  /** 把条目移入分组（groupId=null 表示移回未分组；父组件持久化） */
  (e: 'move-to-group', payload: { id: number; groupId: number | null }): void
  /** 组内行拖拽排序完成：给出该分组当前条目顺序（父组件持久化） */
  (e: 'reorder', payload: { groupId: number | null; orderedIds: number[] }): void
  /** 跨组拖拽完成：条目已归入目标组，给出目标组当前条目顺序（父组件归组 + 组内重排） */
  (e: 'move-across', payload: { id: number; groupId: number | null; orderedIds: number[] }): void
  /** 行内重命名完成：设置别名（alias=null 表示清除，回退到文件/文件夹名；父组件持久化） */
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
// 分组视图：自定义分组（创建顺序）+ 未分组虚拟桶恒在末尾；组内行拖拽排序
// ---------------------------------------------------------------------------
/** 分组区块 key（自定义组 `g-<id>`；未分组 `ungrouped`） */
type SectionKey = string

interface QfpSection {
  key: SectionKey
  groupId: number | null
  label: string
  isCustom: boolean
  items: QuickFolder[]
}

/** 本地列表副本：拖拽时实时重排，外部列表变化经 watch 同步（拖拽中不覆盖） */
const list = ref<QuickFolder[]>([...props.folders])

watch(
  () => props.folders,
  (f) => {
    if (!reordering.value) list.value = f
  }
)

/** 分组视图：自定义分组按创建顺序在前，未分组（有条目时）恒在末尾 */
const sections = computed<QfpSection[]>(() => {
  const byGroup = (gid: number | null) =>
    list.value.filter((f) => (f.group_id ?? null) === gid)
  const custom: QfpSection[] = props.groups.map((g) => ({
    key: `g-${g.id}`,
    groupId: g.id,
    label: g.name,
    isCustom: true,
    items: byGroup(g.id)
  }))
  const out = [...custom]
  const ungrouped = byGroup(null)
  if (ungrouped.length) {
    out.push({ key: 'ungrouped', groupId: null, label: '未分组', isCustom: false, items: ungrouped })
  }
  return out
})

/** 折叠状态（本地不持久化）：Set<SectionKey>，展开为默认 */
const collapsed = ref<Set<SectionKey>>(new Set())

function toggleCollapse(key: SectionKey): void {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

// ---------------------------------------------------------------------------
// 组内行拖拽排序 / 跨组拖拽移动：指针事件（与整卡拖拽/缩放同模式），松手 emit('reorder'/'move-across') 由父级持久化
// ---------------------------------------------------------------------------
/** 是否正在行内拖拽排序 */
const reordering = ref(false)
/** 正在拖拽的行 id */
const dragId = ref<number | null>(null)
/** 正在拖拽的分组 key（跨组移动后随落点更新） */
let dragGkey: SectionKey | null = null
/** 拖拽起点分组 key（松手时区分「组内排序」与「跨组移动」） */
let dragStartGkey: SectionKey | null = null
/** 本次拖拽起点 Y（位移超过阈值才判定为拖拽，否则视为点击） */
let reorderStartY = 0
/** 是否发生了实际拖拽（用于抑制松手后的行 click，避免误打开） */
let reorderMoved = false
/** 拖拽松手后抑制下一次行 click */
let suppressOpen = false

function startReorder(e: PointerEvent, sec: QfpSection, index: number): void {
  if (e.button !== 0) return
  dragId.value = sec.items[index].id
  dragGkey = sec.key
  dragStartGkey = sec.key
  reorderStartY = e.clientY
  reorderMoved = false
  reordering.value = true
  window.addEventListener('pointermove', onReorderMove)
  window.addEventListener('pointerup', onReorderEnd)
}

/** 按给定分组的新顺序重建扁平列表（保持分组区块顺序不变） */
function rebuildList(secKey: SectionKey, newItems: QuickFolder[]): QuickFolder[] {
  const out: QuickFolder[] = []
  for (const s of sections.value) {
    out.push(...(s.key === secKey ? newItems : s.items))
  }
  return out
}

/** 把拖拽条目移入目标分组（本地乐观更新；insertIndex 为目标组内插入位，Infinity=末尾） */
function moveAcross(toKey: SectionKey, insertIndex: number): void {
  const fromKey = dragGkey
  if (!fromKey || fromKey === toKey) return
  const source = list.value.find((f) => f.id === dragId.value)
  const toSec = sections.value.find((s) => s.key === toKey)
  if (!source || !toSec) return

  // 克隆后改归属，避免污染 props.folders 里的对象
  const moved: QuickFolder = { ...source, group_id: toSec.groupId }
  const arr = toSec.items.filter((f) => f.id !== moved.id)
  const at = Math.max(0, Math.min(insertIndex, arr.length))

  const out: QuickFolder[] = []
  for (const s of sections.value) {
    if (s.key === toKey) {
      const a = [...arr]
      a.splice(at, 0, moved)
      out.push(...a)
    } else if (s.key === fromKey) {
      out.push(...s.items.filter((f) => f.id !== moved.id))
    } else {
      out.push(...s.items)
    }
  }
  list.value = out
  dragGkey = toKey
}

function onReorderMove(e: PointerEvent): void {
  if (dragId.value === null) return
  if (!reorderMoved && Math.abs(e.clientY - reorderStartY) < 4) return
  reorderMoved = true

  const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
  const rowEl = hit?.closest<HTMLElement>('.qfp__row') ?? null
  if (rowEl) {
    const gkey = rowEl.dataset.gkey
    const hover = Number(rowEl.dataset.index ?? -1)
    if (!gkey || hover === -1) return
    const rect = rowEl.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2

    if (gkey === dragGkey) {
      // 组内排序：行中点判定，上半插前 / 下半插后
      const sec = sections.value.find((s) => s.key === gkey)
      if (!sec) return
      const items = sec.items
      const from = items.findIndex((f) => f.id === dragId.value)
      if (from === -1) return
      let target = hover + (before ? 0 : 1)
      if (from < target) target -= 1
      if (target === from) return
      const next = [...items]
      const [moved] = next.splice(from, 1)
      next.splice(Math.max(0, Math.min(target, next.length)), 0, moved)
      list.value = rebuildList(sec.key, next)
      return
    }
    // 跨组：插入到目标行前/后
    moveAcross(gkey, hover + (before ? 0 : 1))
    return
  }

  // 未命中行：悬停到其他组头部 / 空分组区域 → 追加到该组末尾
  const groupEl = hit?.closest<HTMLElement>('.qfp__group')
  if (groupEl) {
    const gkey = groupEl.dataset.gkey
    if (gkey && gkey !== dragGkey) moveAcross(gkey, Number.POSITIVE_INFINITY)
  }
}

function onReorderEnd(): void {
  window.removeEventListener('pointermove', onReorderMove)
  window.removeEventListener('pointerup', onReorderEnd)
  const sec = sections.value.find((s) => s.key === dragGkey)
  const ids = sec ? sec.items.map((f) => f.id) : []
  if (reorderMoved) {
    // 抑制本次拖拽松手后紧随的行 click（点击在 pointerup 后同一任务内派发，此处标记即可）
    suppressOpen = true
    setTimeout(() => {
      suppressOpen = false
    }, 0)
  }
  const movedAcross = dragStartGkey !== null && dragStartGkey !== dragGkey
  const finalId = dragId.value
  const targetGroupId = sec?.groupId ?? null
  reordering.value = false
  dragId.value = null
  dragGkey = null
  dragStartGkey = null
  if (reorderMoved && finalId !== null && sec) {
    if (movedAcross) {
      // 跨组移动：归组 + 目标组内重排
      emit('move-across', { id: finalId, groupId: targetGroupId, orderedIds: ids })
    } else {
      const expected = props.folders
        .filter((f) => (f.group_id ?? null) === targetGroupId)
        .map((f) => f.id)
      const changed = ids.length !== expected.length || ids.some((id, i) => expected[i] !== id)
      if (changed) emit('reorder', { groupId: targetGroupId, orderedIds: ids })
    }
  }
}

/** 行点击：打开文件/文件夹；拖拽排序后的本次 click 仅吞掉，不触发打开 */
function onRowClick(folder: QuickFolder): void {
  if (suppressOpen) {
    suppressOpen = false
    return
  }
  emit('open', folder)
}

// ---------------------------------------------------------------------------
// 分组管理：新建由父级触发；组内重命名内联编辑；删除经父级确认弹窗
// ---------------------------------------------------------------------------
/** 正在编辑名称的分组 id（null = 未在编辑） */
const editingGroupId = ref<number | null>(null)
/** 分组编辑框当前值 */
const groupEditValue = ref('')
const groupInput = ref<HTMLInputElement | null>(null)
/** 是否已提交/取消（避免 Enter 与随后的 blur 双触发） */
let groupEditSettled = false

watch(editingGroupId, (id) => {
  if (id !== null) {
    void nextTick(() => {
      groupInput.value?.focus()
      groupInput.value?.select()
    })
  }
})

function startGroupRename(sec: QfpSection): void {
  editingGroupId.value = sec.groupId
  groupEditValue.value = sec.label
  groupEditSettled = false
}

function commitGroupEdit(sec: QfpSection): void {
  if (editingGroupId.value !== sec.groupId || groupEditSettled) return
  groupEditSettled = true
  editingGroupId.value = null
  const name = groupEditValue.value.trim()
  if (name && name !== sec.label) emit('rename-group', { id: sec.groupId as number, name })
}

function cancelGroupEdit(): void {
  groupEditSettled = true
  editingGroupId.value = null
}

// ---------------------------------------------------------------------------
// 移动到分组：行操作弹出小菜单（Teleport 到 body，fixed 定位），选择即归组
// ---------------------------------------------------------------------------
/** 移动菜单状态（目标条目 id + 视口坐标） */
const moveMenu = ref<{ folderId: number; left: number; top: number } | null>(null)
const MOVE_MENU_W = 168
const MOVE_MENU_MAX_H = 240

/** 菜单选项：所有自定义分组 + 未分组（恒在末尾） */
const moveOptions = computed<Array<{ key: string; groupId: number | null; label: string }>>(() => [
  ...props.groups.map((g) => ({ key: `g-${g.id}`, groupId: g.id, label: g.name })),
  { key: 'ungrouped', groupId: null, label: '未分组' }
])

/** 当前移动条目的所属分组（菜单中高亮当前项） */
const currentGroupOfMoveMenu = computed(() => {
  if (!moveMenu.value) return null
  return (
    props.folders.find((f) => f.id === moveMenu.value?.folderId)?.group_id ?? null
  )
})

function toggleMoveMenu(e: MouseEvent, folder: QuickFolder): void {
  if (moveMenu.value?.folderId === folder.id) {
    closeMoveMenu()
    return
  }
  const btn = e.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  const left = Math.max(8, rect.right - MOVE_MENU_W)
  let top = rect.bottom + 4
  if (top + MOVE_MENU_MAX_H > window.innerHeight - 8) {
    top = Math.max(8, rect.top - MOVE_MENU_MAX_H - 4)
  }
  moveMenu.value = { folderId: folder.id, left, top }
  window.addEventListener('pointerdown', onMoveMenuDocPointerDown)
}

function closeMoveMenu(): void {
  moveMenu.value = null
  window.removeEventListener('pointerdown', onMoveMenuDocPointerDown)
}

function onMoveMenuDocPointerDown(): void {
  // 菜单自身带 @pointerdown.stop，落到这里说明点到外部
  closeMoveMenu()
}

function chooseMoveTarget(groupId: number | null): void {
  const folderId = moveMenu.value?.folderId
  if (folderId === undefined) return
  closeMoveMenu()
  if ((props.folders.find((f) => f.id === folderId)?.group_id ?? null) === groupId) return
  emit('move-to-group', { id: folderId, groupId })
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
  window.removeEventListener('pointerdown', onMoveMenuDocPointerDown)
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
  padding: var(--sp-1);
}

/* 分组区块：组头分隔 + 组内容 */
.qfp__group + .qfp__group {
  margin-top: var(--sp-1);
}

.qfp__group-head {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.qfp__group-head:hover {
  background: var(--bg-hover);
}

.qfp__group-chev {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform var(--duration-fast) var(--ease-out-soft);
}

.qfp__group-chev.is-open {
  transform: rotate(90deg);
}

.qfp__group-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.qfp__group-name {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qfp__group-edit {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--brand);
  border-radius: var(--radius-sm);
  background: var(--bg-input, var(--bg-surface));
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  outline: none;
}

.qfp__group-actions {
  flex-shrink: 0;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.qfp__group-head:hover .qfp__group-actions,
.qfp__group-head:focus-within .qfp__group-actions {
  opacity: 1;
}

.qfp__group-body {
  padding: var(--sp-1) 0 var(--sp-1) var(--sp-2);
}

.qfp__group-empty {
  padding: var(--sp-2);
  font-size: 11px;
  color: var(--text-muted);
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

/* 移动到分组菜单（Teleport 到 body，fixed 定位，带品牌描边） */
.qfp__move-menu {
  position: fixed;
  z-index: 1000;
  min-width: 168px;
  max-height: 240px;
  overflow-y: auto;
  padding: var(--sp-1);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.qfp__move-title {
  padding: var(--sp-1) var(--sp-2);
  font-size: 11px;
  color: var(--text-muted);
}

.qfp__move-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.qfp__move-item:hover {
  background: var(--bg-hover);
}

.qfp__move-item.is-current {
  color: var(--brand);
  background: var(--bg-selected-subtle);
}
</style>
