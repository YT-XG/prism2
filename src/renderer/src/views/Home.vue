<template>
  <div class="home">
    <!-- 头部 -->
    <header class="home-header">
      <h1 class="home-title">主页</h1>
    </header>

    <!-- 旧版数据引导导入横幅（检测到 v1 剪贴板数据库且未处理时显示） -->
    <div
      v-if="legacyImport?.legacyDbExists && !legacyImport.done"
      class="legacy-banner"
    >
      <div class="legacy-banner__info">
        <div class="legacy-banner__title">检测到旧版 Prism 数据</div>
        <div class="legacy-banner__desc">
          发现 {{ legacyImport.historyCount ?? 0 }} 条历史、{{ legacyImport.favoriteCount ?? 0 }}
          个片段，可一键合并导入（按 id 去重，不覆盖现有数据）。
        </div>
      </div>
      <div class="legacy-banner__actions">
        <button class="legacy-banner__btn" type="button" @click="doLegacyImport">一键导入</button>
        <button class="legacy-banner__link" type="button" @click="dismissLegacyImport">暂不</button>
      </div>
    </div>

    <!-- 数据概览 -->
    <section class="home-stats">
      <div class="stat stat--lavender">
        <div class="stat__num num">{{ historyCount }}</div>
        <div class="stat__label">历史记录</div>
      </div>
      <div class="stat stat--mint">
        <div class="stat__num num">{{ snippetCount }}</div>
        <div class="stat__label">片段</div>
      </div>
      <div class="stat stat--yellow">
        <div class="stat__num num">{{ categoryCount }}</div>
        <div class="stat__label">分类</div>
      </div>
    </section>

    <!-- 快捷入口 -->
    <section class="home-entries">
      <button
        v-for="entry in entries"
        :key="entry.label"
        type="button"
        class="entry"
        @click="entry.action"
      >
        <component :is="entry.icon" :size="18" :stroke-width="1.6" class="entry__icon" />
        <span class="entry__label">{{ entry.label }}</span>
      </button>
    </section>

    <!-- 画布：可拖拽 widget（合并记录框 + 贴到主页的便利贴） -->
    <section ref="canvasRef" class="home-canvas">
      <!-- 合并记录框：左=剪贴板，右=片段，框顶跨两类全搜（模块显隐开关控制显示） -->
      <div
        v-if="modules.compactClipboard"
        ref="boxEl"
        class="recent-box"
        :class="{ 'is-dragging': boxDragging }"
        :style="{ left: `${boxX}px`, top: `${boxY}px`, width: boxW, height: boxH }"
      >
        <div class="recent-box__head" :title="'拖动以调整位置'" @pointerdown="startBoxDrag">
          <GripVertical :size="14" :stroke-width="1.6" class="recent-box__grip" />
          <span class="recent-box__title"><History :size="14" :stroke-width="1.6" /> 最近记录</span>
          <RouterLink
            to="/mainPage/clipboard"
            class="recent-box__more"
            @pointerdown.stop
            >全部 ›</RouterLink
          >
        </div>
        <div class="recent-box__search" @pointerdown.stop>
          <UiInput v-model="keyword" placeholder="跨两类搜索剪贴板与片段…">
            <template #leading><Search :size="14" :stroke-width="1.6" /></template>
          </UiInput>
        </div>
        <div class="recent-box__body">
          <div class="recent-box__col">
            <div class="recent-box__col-title">剪贴板</div>
            <div v-if="!historyRows.length" class="recent-box__empty">暂无记录</div>
            <div v-else class="recent-box__list">
              <button
                v-for="(item, index) in historyRows"
                :key="item.id"
                type="button"
                class="row"
                :class="{ 'is-copied': copiedKey === 'history-' + item.id }"
                :style="rowDelay(index)"
                @click="handleCopy(item, 'history')"
              >
                <img
                  v-if="item.type === 'image'"
                  :src="imageCache[item.content]"
                  class="row__thumb"
                  alt="剪贴板图片"
                />
                <span v-else class="row__text">{{ itemText(item) }}</span>
                <span class="row__time">{{ formatTime(item.created_at) }}</span>
                <span v-if="copiedKey === 'history-' + item.id" class="row__copied">
                  <Check :size="12" :stroke-width="3" /> 已复制
                </span>
                <span class="row__actions" @click.stop>
                  <button class="row-btn" title="收藏" @click="quickFavorite(item)">
                    <Star :size="13" :stroke-width="1.6" />
                  </button>
                  <button
                    v-if="item.type !== 'image'"
                    class="row-btn"
                    title="编辑"
                    @click="editHistory(item)"
                  >
                    <Pencil :size="13" :stroke-width="1.6" />
                  </button>
                  <button
                    class="row-btn row-btn--danger"
                    title="删除"
                    @click="requestDelete(item, 'history')"
                  >
                    <Trash2 :size="13" :stroke-width="1.6" />
                  </button>
                </span>
              </button>
            </div>
          </div>
          <div class="recent-box__col">
            <div class="recent-box__col-title">片段</div>
            <div v-if="!snippetRows.length" class="recent-box__empty">暂无片段</div>
            <div v-else class="recent-box__list">
              <button
                v-for="(item, index) in snippetRows"
                :key="item.id"
                type="button"
                class="row"
                :class="{ 'is-copied': copiedKey === 'snippet-' + item.id }"
                :style="rowDelay(index)"
                @click="handleCopy(item, 'snippet')"
              >
                <Star :size="14" :stroke-width="1.6" class="row__cat-icon" />
                <span class="row__text">{{ itemText(item) }}</span>
                <span v-if="item.category" class="row__cat">{{ item.category }}</span>
                <span v-if="copiedKey === 'snippet-' + item.id" class="row__copied">
                  <Check :size="12" :stroke-width="3" /> 已复制
                </span>
                <span class="row__actions" @click.stop>
                  <button class="row-btn" title="编辑" @click="editSnippet(item)">
                    <Pencil :size="13" :stroke-width="1.6" />
                  </button>
                  <button
                    class="row-btn row-btn--danger"
                    title="删除"
                    @click="requestDelete(item, 'snippet')"
                  >
                    <Trash2 :size="13" :stroke-width="1.6" />
                  </button>
                </span>
              </button>
            </div>
          </div>
        </div>
        <!-- 右下角缩放手柄（自定义大小） -->
        <div
          class="recent-box__resize"
          title="拖动以调整大小"
          @pointerdown.stop.prevent="startBoxResize"
        ></div>
      </div>

      <!-- 贴到主页的便利贴（可拖拽定位、可缩放尺寸） -->
      <HomeNoteCard
        v-for="(note, index) in pinnedNotes"
        :key="note.id"
        :note="note"
        :canvas="getCanvas"
        :fallback-pos="noteFallbackPos(index)"
        @edit="editNote"
        @unpin="unpinNote"
        @delete="requestDeleteNote"
        @drag-end="persistNotePos"
        @resize-end="persistNoteSize"
      />

      <!-- 快捷文件夹（可拖拽定位、可缩放尺寸；「显示」面板开关控制显隐） -->
      <template v-if="modules.quickFolders">
        <QuickFolderCard
          v-for="(folder, index) in quickFolders"
          :key="folder.id"
          :folder="folder"
          :canvas="getCanvas"
          :fallback-pos="folderFallbackPos(index)"
          @open="openFolder"
          @remove="requestRemoveFolder"
          @drag-end="persistFolderPos"
          @resize-end="persistFolderSize"
        />
      </template>
    </section>

    <!-- 单条删除确认 -->
    <UiDialog
      :model-value="deleteConfirm"
      :title="deleteDialogTitle"
      @update:model-value="deleteConfirm = false"
    >
      <p class="confirm-text">
        <template v-if="deleteTarget?.kind === 'folder'">
          确定移除「{{ deleteTargetName }}」快捷方式吗？仅移除主页快捷方式，不会删除磁盘上的文件夹。
        </template>
        <template v-else>
          确定删除这条{{ deleteTarget?.kind === 'snippet' ? '片段' : deleteTarget?.kind === 'note' ? '便利贴' : '记录' }}吗？此操作不可恢复。
        </template>
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="confirmDelete">
          {{ deleteTarget?.kind === 'folder' ? '移除' : '删除' }}
        </UiButton>
      </template>
    </UiDialog>

    <!-- 便利贴大编辑框（主页创建 / 点击编辑共用，富文本） -->
    <StickyNoteEditorDialog v-model="noteDialog" :note="editingNote" @save="saveNote" />

    <!-- 片段编辑弹窗（新增 / 编辑共用） -->
    <SnippetEditorDialog
      v-model="snippetDialog"
      :favorite="editingSnippet"
      :categories="snippetCategories"
      @save="saveSnippet"
    />

    <!-- 历史记录富文本编辑 -->
    <ClipboardHistoryEditorDialog
      v-model="historyDialog"
      :item="editingHistory"
      @save="saveHistory"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  Search,
  StickyNote as StickyNoteIcon,
  Trash2,
  Star,
  History,
  Check,
  GripVertical,
  Pencil,
  FolderPlus
} from '@lucide/vue'
import type { Component } from 'vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import HomeNoteCard from '@renderer/components/HomeNoteCard.vue'
import QuickFolderCard from '@renderer/components/QuickFolderCard.vue'
import StickyNoteEditorDialog from '@renderer/components/StickyNoteEditorDialog.vue'
import SnippetEditorDialog from '@renderer/components/SnippetEditorDialog.vue'
import ClipboardHistoryEditorDialog from '@renderer/components/ClipboardHistoryEditorDialog.vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import { useToast } from '@renderer/composables/useToast'
import { useHomeModules } from '@renderer/composables/useHomeModules'
import { useDrag } from '@renderer/composables/useDrag'
import { itemText } from '@renderer/composables/useClipboardText'
import { openPlaceholderDialog } from '@renderer/composables/useSnippetPlaceholder'
import type {
  HistoryItem,
  FavoriteItem,
  StickyNote,
  StickyNoteColor,
  CategoryItem,
  LegacyImportState,
  QuickFolder
} from '@preload/ipc'

const toast = useToast()
const { modules } = useHomeModules()

/** 合并记录框位置的 localStorage 键（纯渲染端布局偏好） */
const BOX_POS_KEY = 'prism.home.recentBox'

/** 新建便利贴默认尺寸（与 HomeNoteCard 默认一致，供避让计算用） */
const NOTE_DEFAULT_W = 200
const NOTE_DEFAULT_H = 104

// ---------------------------------------------------------------------------
// 画布 + 合并记录框（可拖拽）
// ---------------------------------------------------------------------------
const canvasRef = ref<HTMLElement | null>(null)
const boxEl = ref<HTMLElement | null>(null)

function getCanvas(): HTMLElement | null {
  return canvasRef.value
}

function loadBoxPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(BOX_POS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
      if (typeof p?.x === 'number' && typeof p?.y === 'number') return { x: p.x, y: p.y }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return { x: 8, y: 8 }
}

const boxPos = ref(loadBoxPos())
const boxDrag = useDrag({
  container: getCanvas,
  element: () => boxEl.value,
  initial: () => boxPos.value,
  onEnd: (pos) => {
    boxPos.value = pos
    try {
      localStorage.setItem(BOX_POS_KEY, JSON.stringify(pos))
    } catch {
      // 忽略持久化失败
    }
  }
})
const boxX = boxDrag.x
const boxY = boxDrag.y
const boxDragging = boxDrag.dragging
const startBoxDrag = boxDrag.startDrag

// ---------------------------------------------------------------------------
// 合并记录框（精简剪贴板）自定义尺寸
// ---------------------------------------------------------------------------
const BOX_SIZE_KEY = 'prism.home.recentBoxSize'
const BOX_MIN_W = 360
const BOX_MIN_H = 260
const BOX_MAX_W = 960
const BOX_MAX_H = 640

function loadBoxSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(BOX_SIZE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { w?: unknown; h?: unknown }
      if (typeof p?.w === 'number' && typeof p?.h === 'number') return { w: p.w, h: p.h }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return { w: 560, h: 380 }
}

const boxSize = ref(loadBoxSize())
const boxW = computed(() => `${boxSize.value.w}px`)
const boxH = computed(() => `${boxSize.value.h}px`)

let resizeStartX = 0
let resizeStartY = 0
let startW = 0
let startH = 0

function onBoxResizeMove(e: PointerEvent): void {
  boxSize.value.w = Math.min(BOX_MAX_W, Math.max(BOX_MIN_W, startW + (e.clientX - resizeStartX)))
  boxSize.value.h = Math.min(BOX_MAX_H, Math.max(BOX_MIN_H, startH + (e.clientY - resizeStartY)))
}

function onBoxResizeUp(e: PointerEvent): void {
  ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
  window.removeEventListener('pointermove', onBoxResizeMove)
  window.removeEventListener('pointerup', onBoxResizeUp)
  boxSize.value = { w: Math.round(boxSize.value.w), h: Math.round(boxSize.value.h) }
  try {
    localStorage.setItem(BOX_SIZE_KEY, JSON.stringify(boxSize.value))
  } catch {
    // 忽略持久化失败
  }
}

function startBoxResize(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  startW = boxSize.value.w
  startH = boxSize.value.h
  window.addEventListener('pointermove', onBoxResizeMove)
  window.addEventListener('pointerup', onBoxResizeUp)
}

// ---------------------------------------------------------------------------
// 快捷搜索与最近数据
// ---------------------------------------------------------------------------
/** 跨两类搜索关键词（合并记录框顶部输入） */
const keyword = ref('')
const searchResults = ref<{ history: HistoryItem[]; snippets: FavoriteItem[] }>({
  history: [],
  snippets: []
})
/** 最近数据（各取前 10） */
const recentHistory = ref<HistoryItem[]>([])
const recentSnippets = ref<FavoriteItem[]>([])
/** 概览统计 */
const historyCount = ref(0)
const snippetCount = ref(0)
const categoryCount = ref(0)
/** 分类建议（新增片段弹窗的 datalist 联想） */
const snippetCategories = ref<CategoryItem[]>([])
/** 图片记录 data URL 缓存 */
const imageCache = ref<Record<string, string>>({})
/** 最近复制反馈（kind-id 复合键，区分历史/片段 id 同值） */
const copiedKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
/** 搜索防抖定时器 */
let searchTimer: ReturnType<typeof setTimeout> | null = null
/** 单条删除确认 */
const deleteTarget = ref<{
  kind: 'history' | 'snippet' | 'note' | 'folder'
  item: HistoryItem | FavoriteItem | StickyNote | QuickFolder
} | null>(null)
const deleteConfirm = ref(false)

const searching = computed(() => keyword.value.trim().length > 0)
/** 左列 / 右列行数据：搜索态用结果，否则用最近前 10 */
const historyRows = computed(() =>
  searching.value ? searchResults.value.history : recentHistory.value
)
const snippetRows = computed(() =>
  searching.value ? searchResults.value.snippets : recentSnippets.value
)

/** 贴到主页的便利贴 */
const pinnedNotes = ref<StickyNote[]>([])
/** 便利贴大编辑框：打开状态 + 编辑目标（null = 新建） */
const noteDialog = ref(false)
const editingNote = ref<StickyNote | null>(null)
/** 片段编辑弹窗（新增 / 编辑共用；null = 新建） */
const snippetDialog = ref(false)
const editingSnippet = ref<FavoriteItem | null>(null)
/** 历史记录富文本编辑弹窗：打开状态 + 编辑目标 */
const historyDialog = ref(false)
const editingHistory = ref<HistoryItem | null>(null)

const deleteDialogTitle = computed(() =>
  deleteTarget.value?.kind === 'snippet'
    ? '删除片段'
    : deleteTarget.value?.kind === 'note'
      ? '删除便利贴'
      : deleteTarget.value?.kind === 'folder'
        ? '移除快捷文件夹'
        : '删除记录'
)

/** 删除/移除确认弹窗中需要展示的名称（快捷文件夹等） */
const deleteTargetName = computed(() => {
  const t = deleteTarget.value
  return t?.kind === 'folder' ? (t.item as QuickFolder).name : ''
})

/** 快捷入口卡（图标 + 名称 + 动作） */
const entries: Array<{ label: string; icon: Component; action: () => void }> = [
  {
    label: '新增便利贴',
    icon: StickyNoteIcon,
    action: openCreateNote
  },
  {
    label: '新增片段',
    icon: Star,
    action: openCreateSnippet
  },
  {
    label: '快捷文件夹',
    icon: FolderPlus,
    action: addQuickFolders
  }
]

/** 点击复制：写剪贴板 → 最小化归还焦点 → 模拟粘贴，并展示短暂「已复制」反馈 */
async function handleCopy(
  item: { content: string; id: number; type?: HistoryItem['type'] },
  kind: 'history' | 'snippet'
): Promise<void> {
  // 片段：先解析占位符（有占位符则弹输入框，用户取消则放弃粘贴）
  const content = item.content
  const type: HistoryItem['type'] = item.type ?? 'text'
  if (kind === 'snippet') {
    const resolved = await openPlaceholderDialog({ content, type: type as FavoriteItem['type'] })
    if (!resolved) return
    await window.electronAPI.clipboard.clickItem(resolved)
  } else {
    await window.electronAPI.clipboard.clickItem({ content, type })
  }
  copiedKey.value = `${kind}-${item.id}`
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedKey.value = null
    copiedTimer = null
  }, 1200)
}

/** 行阶梯入场的延迟（最多 8 项封顶） */
function rowDelay(index: number): Record<string, string> {
  return { '--row-delay': `${Math.min(index, 8) * 40}ms` }
}

/** 懒加载图片记录的预览 data URL */
async function loadImages(items: HistoryItem[]): Promise<void> {
  const targets = items.filter((i) => i.type === 'image' && !imageCache.value[i.content])
  if (!targets.length) return
  const urls = await Promise.all(
    targets.map((i) => window.electronAPI.clipboard.getImageData(i.content))
  )
  targets.forEach((item, i) => {
    if (urls[i]) imageCache.value[item.content] = urls[i]
  })
}

async function fetchRecent(): Promise<void> {
  recentHistory.value = await window.electronAPI.clipboard.getHistory(10, 0)
  void loadImages(recentHistory.value)
  const favorites = await window.electronAPI.clipboard.getFavorites()
  recentSnippets.value = favorites.slice(0, 10)
}

async function fetchStats(): Promise<void> {
  historyCount.value = await window.electronAPI.clipboard.getHistoryCount()
  const favorites = await window.electronAPI.clipboard.getFavorites()
  snippetCount.value = favorites.length
  const cats = await window.electronAPI.clipboard.getCategories()
  snippetCategories.value = cats
  categoryCount.value = cats.length
}

/** 权威刷新：最近列表 + 概览统计 */
async function refreshAll(): Promise<void> {
  await Promise.all([fetchRecent(), fetchStats()])
}

/** 快捷搜索：200ms 防抖后并行搜历史 + 片段（结果分别过滤左/右列） */
async function runSearch(q: string): Promise<void> {
  const trimmed = q.trim()
  if (!trimmed) {
    searchResults.value = { history: [], snippets: [] }
    return
  }
  const [history, snippets] = await Promise.all([
    window.electronAPI.clipboard.searchHistory(trimmed),
    window.electronAPI.clipboard.searchSnippets(trimmed)
  ])
  searchResults.value = { history, snippets }
  void loadImages(history)
}

watch(keyword, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void runSearch(val), 200)
})

/** 快速收藏历史记录 */
async function quickFavorite(item: HistoryItem): Promise<void> {
  await window.electronAPI.clipboard.addFavorite(
    item.content,
    '',
    '',
    item.type === 'richtext' ? 'richtext' : 'text'
  )
  await fetchStats()
  toast.success('已收藏')
}

// ---------------------------------------------------------------------------
// 贴到主页的便利贴
// ---------------------------------------------------------------------------

/** 未定位过（home_x/home_y 为 null）时的默认位置：画布右上角起始，按索引错位下落 */
function noteFallbackPos(index: number): { x: number; y: number } {
  const w = canvasRef.value?.clientWidth ?? 400
  return { x: Math.max(0, w - 240 - index * 8), y: 8 + index * 28 }
}

async function fetchPinnedNotes(): Promise<void> {
  const all = await window.electronAPI.stickyNotes.getNotes()
  pinnedNotes.value = all.filter((n) => n.pinned)
}

/** 点击贴到主页的便利贴 → 打开大编辑框（不再"点击即粘贴"） */
function editNote(note: StickyNote): void {
  editingNote.value = note
  noteDialog.value = true
}

async function unpinNote(note: StickyNote): Promise<void> {
  await window.electronAPI.stickyNotes.togglePin(note.id)
  await fetchPinnedNotes()
  toast.success('已取消贴主页')
}

function requestDeleteNote(note: StickyNote): void {
  deleteTarget.value = { kind: 'note', item: note }
  deleteConfirm.value = true
}

async function persistNotePos(payload: { id: number; x: number; y: number }): Promise<void> {
  await window.electronAPI.stickyNotes.setNotePosition(payload.id, payload.x, payload.y)
}

async function persistNoteSize(payload: { id: number; w: number; h: number }): Promise<void> {
  await window.electronAPI.stickyNotes.setNoteSize(payload.id, payload.w, payload.h)
}

// ---------------------------------------------------------------------------
// 快捷文件夹
// ---------------------------------------------------------------------------

/** 主页快捷文件夹列表（可拖拽卡片） */
const quickFolders = ref<QuickFolder[]>([])

/** 未定位过（home_x/home_y 为 null）时的默认位置：画布右上角起始，按索引错位下落 */
function folderFallbackPos(index: number): { x: number; y: number } {
  const w = canvasRef.value?.clientWidth ?? 400
  return { x: Math.max(0, w - 244 - index * 12), y: 76 + index * 32 }
}

async function fetchQuickFolders(): Promise<void> {
  quickFolders.value = await window.electronAPI.quickFolders.getFolders()
}

/** 点击「快捷文件夹」入口：弹出系统文件夹多选框（多选）并添加 */
async function addQuickFolders(): Promise<void> {
  const before = quickFolders.value.length
  quickFolders.value = await window.electronAPI.quickFolders.addFolders()
  const added = quickFolders.value.length - before
  if (added > 0) toast.success(`已添加 ${added} 个快捷文件夹`)
}

/** 点击卡片 / 悬浮「打开」：在系统资源管理器中打开文件夹 */
async function openFolder(folder: QuickFolder): Promise<void> {
  const r = await window.electronAPI.quickFolders.openFolder(folder.path)
  if (!r.ok) toast.error(`打开文件夹失败：${r.error ?? '未知错误'}`)
}

/** 悬浮「移除」：进入确认弹窗 */
function requestRemoveFolder(folder: QuickFolder): void {
  deleteTarget.value = { kind: 'folder', item: folder }
  deleteConfirm.value = true
}

async function persistFolderPos(payload: { id: number; x: number; y: number }): Promise<void> {
  await window.electronAPI.quickFolders.setPosition(payload.id, payload.x, payload.y)
}

async function persistFolderSize(payload: { id: number; w: number; h: number }): Promise<void> {
  await window.electronAPI.quickFolders.setSize(payload.id, payload.w, payload.h)
}

/** 打开主页便利贴大编辑框（新建，创建后默认贴主页） */
function openCreateNote(): void {
  editingNote.value = null
  noteDialog.value = true
}

/** 打开主页片段编辑弹窗（新建） */
function openCreateSnippet(): void {
  editingSnippet.value = null
  snippetDialog.value = true
}

/** 打开片段编辑弹窗（编辑既有片段） */
function editSnippet(item: FavoriteItem): void {
  editingSnippet.value = item
  snippetDialog.value = true
}

/** 新增 / 编辑片段：写库 → 刷新最近列表与概览 */
async function saveSnippet(payload: {
  content: string
  category: string
  description: string
}): Promise<void> {
  const target = editingSnippet.value
  if (target) {
    await window.electronAPI.clipboard.updateFavorite(
      target.id,
      payload.content,
      payload.category,
      payload.description,
      'richtext'
    )
  } else {
    await window.electronAPI.clipboard.addFavorite(
      payload.content,
      payload.category,
      payload.description,
      'richtext'
    )
  }
  snippetDialog.value = false
  editingSnippet.value = null
  await refreshAll()
  toast.success(target ? '片段已更新' : '片段已添加')
}

// ---------------------------------------------------------------------------
// 历史记录富文本编辑
// ---------------------------------------------------------------------------

/** 打开历史记录富文本编辑弹窗（图片不可编辑） */
function editHistory(item: HistoryItem): void {
  editingHistory.value = item
  historyDialog.value = true
}

/** 保存历史记录编辑（改为富文本；原地替换当前列表项） */
async function saveHistory(payload: { content: string }): Promise<void> {
  const target = editingHistory.value
  if (!target) return
  await window.electronAPI.clipboard.updateHistoryContent(target.id, payload.content)
  historyDialog.value = false
  editingHistory.value = null
  const updated: HistoryItem = { ...target, content: payload.content, type: 'richtext' }
  recentHistory.value = recentHistory.value.map((h) => (h.id === target.id ? updated : h))
  searchResults.value.history = searchResults.value.history.map((h) =>
    h.id === target.id ? updated : h
  )
  toast.success('记录已更新')
}

/**
 * 计算新建便利贴的落点：从画布右上角向右下扫描，
 * 返回第一个既不与「最近记录框」相交、也不与现有已贴便利贴 / 快捷文件夹相交的位置。
 */
function nextNotePos(): { x: number; y: number } {
  const canvas = canvasRef.value
  const cw = canvas?.clientWidth ?? 400
  const ch = canvas?.clientHeight ?? 400
  const boxRect = boxEl.value
    ? {
        left: boxX.value,
        top: boxY.value,
        right: boxX.value + (boxEl.value.offsetWidth || 560),
        bottom: boxY.value + (boxEl.value.offsetHeight || 360)
      }
    : null
  const noteRects = pinnedNotes.value.map((n, i) => {
    const nx = n.home_x ?? noteFallbackPos(i).x
    const ny = n.home_y ?? noteFallbackPos(i).y
    const nw = n.home_w ?? NOTE_DEFAULT_W
    const nh = n.home_h ?? NOTE_DEFAULT_H
    return { left: nx, top: ny, right: nx + nw, bottom: ny + nh }
  })
  // 快捷文件夹卡一并纳入避让（默认宽 220×120，未定位用兜底位置）
  const FOLDER_DEFAULT_W = 220
  const FOLDER_DEFAULT_H = 120
  quickFolders.value.forEach((f, i) => {
    const fx = f.home_x ?? folderFallbackPos(i).x
    const fy = f.home_y ?? folderFallbackPos(i).y
    const fw = f.home_w ?? FOLDER_DEFAULT_W
    const fh = f.home_h ?? FOLDER_DEFAULT_H
    noteRects.push({ left: fx, top: fy, right: fx + fw, bottom: fy + fh })
  })
  const overlaps = (r: { left: number; top: number; right: number; bottom: number }): boolean =>
    (boxRect !== null &&
      r.left < boxRect.right &&
      r.right > boxRect.left &&
      r.top < boxRect.bottom &&
      r.bottom > boxRect.top) ||
    noteRects.some(
      (o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top
    )
  const COL_W = 216
  const ROW_H = 40
  for (let col = 0; col < 6; col++) {
    const x = Math.max(0, cw - NOTE_DEFAULT_W - 8 - col * COL_W)
    if (x < 0) break
    for (let row = 0; row < 14; row++) {
      const y = 8 + row * ROW_H
      if (y + NOTE_DEFAULT_H > ch + 200) break
      const rect = {
        left: x,
        top: y,
        right: x + NOTE_DEFAULT_W,
        bottom: y + NOTE_DEFAULT_H
      }
      if (!overlaps(rect)) return { x, y }
    }
  }
  return { x: Math.max(0, cw - NOTE_DEFAULT_W - 8), y: 8 }
}

/** 保存便利贴：编辑则更新；新建则创建即贴主页，并持久化避让后的位置 */
async function saveNote(payload: { content: string; color: StickyNoteColor }): Promise<void> {
  const target = editingNote.value
  if (target) {
    await window.electronAPI.stickyNotes.updateNote(target.id, payload.content, payload.color)
    noteDialog.value = false
    await fetchPinnedNotes()
    toast.success('便利贴已更新')
    return
  }
  const pos = nextNotePos()
  const id = await window.electronAPI.stickyNotes.addNote(payload.content, payload.color, true)
  await window.electronAPI.stickyNotes.setNotePosition(id, pos.x, pos.y)
  noteDialog.value = false
  await fetchPinnedNotes()
  toast.success('便利贴已添加')
}

// ---------------------------------------------------------------------------
// 删除 / 清空
// ---------------------------------------------------------------------------

function requestDelete(item: HistoryItem | FavoriteItem, kind: 'history' | 'snippet'): void {
  deleteTarget.value = { kind, item }
  deleteConfirm.value = true
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  deleteConfirm.value = false
  deleteTarget.value = null
  if (!target) return
  if (target.kind === 'history') {
    await window.electronAPI.clipboard.deleteHistory(target.item.id)
    recentHistory.value = recentHistory.value.filter((h) => h.id !== target.item!.id)
    toast.success('已删除记录')
  } else if (target.kind === 'snippet') {
    await window.electronAPI.clipboard.deleteFavorite(target.item.id)
    recentSnippets.value = recentSnippets.value.filter((f) => f.id !== target.item!.id)
    toast.success('已删除片段')
  } else if (target.kind === 'folder') {
    await window.electronAPI.quickFolders.deleteFolder(target.item.id)
    quickFolders.value = quickFolders.value.filter((f) => f.id !== target.item!.id)
    toast.success('已移除快捷文件夹')
  } else {
    await window.electronAPI.stickyNotes.deleteNote(target.item.id)
    pinnedNotes.value = pinnedNotes.value.filter((n) => n.id !== target.item!.id)
    toast.success('已删除便利贴')
  }
  await fetchStats()
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------------------------------------------------------------------------
// 旧版数据引导导入
// ---------------------------------------------------------------------------
const legacyImport = ref<LegacyImportState | null>(null)

/** 刷新旧版数据导入状态（检测到 v1 数据库且未处理时主页顶部显示横幅） */
async function refreshLegacyImport(): Promise<void> {
  legacyImport.value = await window.electronAPI.legacyImport.getState()
}

/** 一键合并导入旧版数据（按 id 去重，不覆盖现有数据） */
async function doLegacyImport(): Promise<void> {
  const r = await window.electronAPI.legacyImport.import()
  if (r.ok) {
    toast.success(`已导入旧版数据：历史 +${r.importedHistory}、片段 +${r.importedFavorites}`)
  } else {
    toast.error(`导入失败：${r.error ?? '未知错误'}`)
  }
  await refreshLegacyImport()
  await refreshAll()
}

/** 暂不导入：标记完成，不再提示 */
async function dismissLegacyImport(): Promise<void> {
  await window.electronAPI.legacyImport.dismiss()
  await refreshLegacyImport()
}

onMounted(async () => {
  await refreshAll()
  await fetchPinnedNotes()
  await fetchQuickFolders()
  await refreshLegacyImport()

  // 新记录/置顶：插到左列最近列表最前（去重）
  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onNewItem((item) => {
      recentHistory.value = recentHistory.value.filter((h) => h.id !== item.id)
      recentHistory.value.unshift(item)
      if (recentHistory.value.length > 10) recentHistory.value.pop()
      if (item.type === 'image') void loadImages([item])
    })
  )

  // 历史变更（删除/清空/导入等）：刷新统计与列表
  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onHistoryChanged(() => {
      void refreshAll()
    })
  )

  // 窗口重新显示时兜底刷新（隐藏期间的广播被 onlyVisible 跳过）
  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', () => {
      void refreshAll()
      void fetchPinnedNotes()
      void fetchQuickFolders()
    })
  )
})

onBeforeUnmount(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer)
    copiedTimer = null
  }
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  window.removeEventListener('pointermove', onBoxResizeMove)
  window.removeEventListener('pointerup', onBoxResizeUp)
})
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
  overflow: hidden;
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-2);
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

.home-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

/* 旧版数据引导导入横幅 */
.legacy-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  margin: 0 var(--sp-5) var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--brand) 6%, var(--bg-surface));
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 40ms;
}

.legacy-banner__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.legacy-banner__desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
}

.legacy-banner__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-shrink: 0;
}

.legacy-banner__btn {
  border: 1px solid var(--brand);
  border-radius: var(--radius-md);
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  background: var(--brand);
  color: var(--text-on-brand, #fff);
  cursor: pointer;
  transition: filter var(--duration-fast) var(--ease-out-soft);
}

.legacy-banner__btn:hover {
  filter: brightness(1.06);
}

.legacy-banner__link {
  border: none;
  background: transparent;
  padding: 5px 4px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}

.legacy-banner__link:hover {
  color: var(--text-primary);
}

/* 数据概览 */
.home-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-5);
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 60ms;
}

.stat {
  padding: var(--sp-4);
  border-radius: var(--radius-md);
}

.stat__num {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.1;
}

.stat__label {
  margin-top: var(--sp-1);
  font-size: 12px;
  font-weight: 500;
}

.stat--lavender {
  background: var(--accent-lavender);
  color: var(--text-on-accent-lavender);
}
.stat--mint {
  background: var(--accent-mint);
  color: var(--text-on-accent-mint);
}
.stat--yellow {
  background: var(--accent-yellow);
  color: var(--text-on-accent-yellow);
}

/* 快捷入口 */
.home-entries {
  display: flex;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-5);
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 100ms;
}

.entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  width: 120px;
  min-height: 76px;
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  transition: transform 160ms var(--ease-out-soft), box-shadow var(--duration-base) var(--ease-out-soft),
    border-color var(--duration-base) var(--ease-out-soft);
}

.entry:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--brand) 35%, transparent);
  box-shadow: var(--shadow-md);
}

.entry__icon {
  color: var(--brand);
}

.entry__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

/* 画布：可拖拽 widget 区 */
.home-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp-2) var(--sp-5) var(--sp-5);
}

/* 合并记录框 */
.recent-box {
  position: absolute;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  z-index: 10;
}

.recent-box.is-dragging {
  box-shadow: var(--shadow-lg);
  outline: 1px solid var(--brand);
}

.recent-box__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.recent-box.is-dragging .recent-box__head {
  cursor: grabbing;
}

/* 右下角缩放手柄（hover 时浮现） */
.recent-box__resize {
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

.recent-box:hover .recent-box__resize,
.recent-box.is-dragging .recent-box__resize {
  opacity: 1;
}

.recent-box__grip {
  color: var(--text-muted);
  flex-shrink: 0;
}

.recent-box__title {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.recent-box__more {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
}

.recent-box__more:hover {
  color: var(--brand);
}

.recent-box__search {
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border);
}

.recent-box__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: 1;
  min-height: 0;
}

.recent-box__col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.recent-box__col:last-child {
  border-right: none;
}

.recent-box__col-title {
  padding: var(--sp-2) var(--sp-3);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.recent-box__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
  font-size: 13px;
  color: var(--text-muted);
}

.recent-box__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--sp-2) var(--sp-2);
}

/* 通用行（左右列共用） */
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 36px;
  padding: var(--sp-2) var(--sp-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  animation: card-in var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: var(--row-delay, 0ms);
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.row:hover {
  background: var(--bg-hover);
}

.row.is-copied {
  background: color-mix(in srgb, var(--brand) 8%, transparent);
}

.row__text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row__thumb {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.row__time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.row__cat-icon {
  flex-shrink: 0;
  color: var(--brand);
}

.row__cat {
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--bg-selected-subtle);
  color: var(--text-secondary);
}

.row__copied {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand);
  animation: pop var(--duration-base) var(--ease-spring);
}

.row__actions {
  flex-shrink: 0;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.row:hover .row__actions {
  opacity: 1;
}

.row-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.row-btn:hover {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
}

.row-btn--danger:hover {
  background: rgba(229, 72, 77, 0.12);
  color: var(--danger);
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
