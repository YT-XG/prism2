<template>
  <div class="cm">
    <!-- 头部：标题 + 标签页 -->
    <header class="cm-header">
      <div class="cm-titlebar">
        <h1 class="cm-title">剪贴板</h1>
        <div
          v-if="retentionLoaded"
          class="cm-auto-clean"
          :class="{ 'is-off': !retention.autoClean }"
          title="开启后自动删除超出保留期的历史记录"
        >
          <UiSwitch
            :model-value="retention.autoClean"
            @update:model-value="onAutoCleanToggle"
          />
          <span class="cm-retention-text">保留最近</span>
          <select
            class="cm-retention-select"
            :value="retention.value"
            @change="onValueChange"
          >
            <option v-for="n in RETENTION_VALUES" :key="n" :value="n">{{ n }}</option>
          </select>
          <select
            class="cm-retention-select"
            :value="retention.unit"
            @change="onUnitChange"
          >
            <option value="day">日</option>
            <option value="week">周</option>
            <option value="month">月</option>
            <option value="year">年</option>
          </select>
        </div>
        <div class="cm-tabs">
          <UiPillTab :active="activeTab === 'history'" @click="switchTab('history')">
            <History :size="14" :stroke-width="1.6" /> 历史记录
          </UiPillTab>
          <UiPillTab :active="activeTab === 'favorites'" @click="switchTab('favorites')">
            <Star :size="14" :stroke-width="1.6" /> 片段
          </UiPillTab>
        </div>
      </div>
    </header>

    <!-- 工具栏 -->
    <div v-if="activeTab === 'history'" class="cm-toolbar">
      <UiInput v-model="keyword" label="搜索历史记录" placeholder="搜索历史记录...">
        <template #leading><Search :size="15" :stroke-width="1.6" /></template>
      </UiInput>
      <template v-if="!selectMode">
        <UiButton
          v-if="historyList.length"
          variant="secondary"
          class="cm-select-btn"
          @click="enterSelectMode"
        >
          <SquareCheckBig :size="14" :stroke-width="1.6" /> 选择
        </UiButton>
        <UiButton v-if="historyList.length" variant="danger" @click="clearConfirm = true">
          <Trash2 :size="14" :stroke-width="1.6" /> 清空全部
        </UiButton>
      </template>
      <template v-else>
        <span class="cm-select-count num">已选 {{ selectedIds.size }} 项</span>
        <UiButton
          variant="danger"
          :disabled="!selectedIds.size"
          @click="batchDeleteConfirm = true"
        >
          <Trash2 :size="14" :stroke-width="1.6" /> 删除所选
        </UiButton>
        <UiButton variant="ghost" @click="exitSelectMode">
          <X :size="14" :stroke-width="1.6" /> 取消
        </UiButton>
      </template>
    </div>

    <div v-else class="cm-toolbar cm-toolbar--col">
      <div class="cm-toolbar-row">
        <UiInput v-model="favKeyword" label="搜索片段" placeholder="搜索片段内容或描述...">
          <template #leading><Search :size="15" :stroke-width="1.6" /></template>
        </UiInput>
        <UiButton variant="primary" @click="openAdd">
          <Plus :size="14" :stroke-width="1.6" /> 添加
        </UiButton>
      </div>
      <div class="cm-cats">
        <UiPillTab :active="selectedCategory === ''" @click="selectedCategory = ''">全部</UiPillTab>
        <UiPillTab
          v-for="cat in categories"
          :key="cat.name"
          :active="selectedCategory === cat.name"
          @click="selectedCategory = cat.name"
        >
          {{ cat.name || '未分类' }}<span class="cat-count num">{{ cat.count }}</span>
        </UiPillTab>
      </div>
    </div>

    <!-- 列表 -->
    <div ref="cmBodyRef" class="cm-body">
      <Transition name="view" mode="out-in">
        <div :key="activeTab" class="cm-view">
          <div v-if="!displayList.length" class="cm-empty">
            <UiEmptyState
              :title="activeTab === 'history' ? '暂无历史记录' : '暂无片段'"
              :hint="activeTab === 'history' ? '复制文字后会自动出现在这里' : '点击右上方按钮手动添加片段'"
            >
              <template #icon>
                <History v-if="activeTab === 'history'" :size="30" :stroke-width="1.6" />
                <Star v-else :size="30" :stroke-width="1.6" />
              </template>
            </UiEmptyState>
          </div>

          <div v-else class="cm-list">
            <!-- 历史：按天分组 -->
            <template v-if="activeTab === 'history'">
              <div v-for="section in daySections" :key="section.key" class="cm-day">
                <div class="cm-day__label">{{ section.label }}</div>
                <TransitionGroup tag="div" name="cm-card" class="cm-day__cards">
                  <div
                    v-for="(item, index) in section.items"
                    :key="item.id"
                    class="cm-card"
                    :class="{ 'is-selected': selectMode && selectedIds.has(item.id), 'is-copied': justCopiedId === item.id }"
                    :style="cardDelay(section.startIndex + index)"
                    @click="onCardClick(item)"
                  >
                    <span v-if="selectMode" class="cm-card__check">
                      <Check v-if="selectedIds.has(item.id)" :size="12" :stroke-width="3" />
                    </span>
                    <div
                      v-if="item.type === 'image'"
                      class="cm-card__content"
                    >
                      <img
                        :src="imageUrl(item.content)"
                        class="cm-card__image"
                        alt="剪贴板图片"
                        loading="lazy"
                      />
                    </div>
                    <div
                      v-else-if="item.type === 'richtext'"
                      class="cm-card__content"
                      v-html="item.content"
                    ></div>
                    <div v-else class="cm-card__content">{{ item.content }}</div>
                    <div class="cm-card__footer">
                      <span v-if="justCopiedId === item.id" class="cm-card__copied">
                        <Check :size="12" :stroke-width="3" /> 已复制
                      </span>
                      <span v-else class="cm-card__time">{{ formatClock(item.created_at) }}</span>
                      <div v-if="!selectMode" class="cm-card__actions" @click.stop>
                        <button
                          v-if="item.type !== 'image'"
                          class="action-btn"
                          title="收藏"
                          @click="quickFavorite(item)"
                        >
                          <Star :size="14" :stroke-width="1.6" />
                        </button>
                        <button
                          v-if="item.type !== 'image'"
                          class="action-btn"
                          title="编辑"
                          @click="editHistoryItem(item)"
                        >
                          <Pencil :size="14" :stroke-width="1.6" />
                        </button>
                        <button class="action-btn action-btn--danger" title="删除" @click="requestDeleteItem(item)">
                          <Trash2 :size="14" :stroke-width="1.6" />
                        </button>
                      </div>
                    </div>
                  </div>
                </TransitionGroup>
              </div>
            </template>

            <!-- 片段：平铺 -->
            <template v-else>
              <TransitionGroup tag="div" name="cm-card" class="cm-fav-list">
                <div
                  v-for="(item, index) in displayList"
                  :key="item.id"
                  class="cm-card"
                  :class="[`cm-card--${tint(index)}`, { 'is-copied': justCopiedId === item.id }]"
                  :style="cardDelay(index)"
                  @click="handleFavoriteClick(item as FavoriteItem)"
                >
                  <div
                    v-if="(item as FavoriteItem).type === 'richtext'"
                    class="cm-card__content"
                    v-html="(item as FavoriteItem).content"
                  ></div>
                  <div v-else class="cm-card__content">{{ item.content }}</div>

                  <div
                    v-if="(item as FavoriteItem).category || (item as FavoriteItem).description"
                    class="cm-card__meta"
                  >
                    <span v-if="(item as FavoriteItem).category" class="cm-card__cat">
                      {{ (item as FavoriteItem).category }}
                    </span>
                    <span v-if="(item as FavoriteItem).description" class="cm-card__desc">
                      {{ (item as FavoriteItem).description }}
                    </span>
                  </div>

                  <div class="cm-card__footer">
                    <span v-if="justCopiedId === item.id" class="cm-card__copied">
                      <Check :size="12" :stroke-width="3" /> 已复制
                    </span>
                    <span v-else class="cm-card__time">{{ formatTime(item.created_at) }}</span>
                    <div class="cm-card__actions" @click.stop>
                      <button class="action-btn" title="编辑" @click="editFavorite(item as FavoriteItem)">
                        <Pencil :size="14" :stroke-width="1.6" />
                      </button>
                      <button class="action-btn action-btn--danger" title="删除" @click="requestDeleteItem(item)">
                        <Trash2 :size="14" :stroke-width="1.6" />
                      </button>
                    </div>
                  </div>
                </div>
              </TransitionGroup>
              <!-- 滚动到底自动加载下一页（IntersectionObserver 触发）；哨兵在收藏页渲染完成后被 observe -->
              <div ref="favSentinelRef" class="cm-fav-sentinel" aria-hidden="true">
                <span v-if="favLoading" class="cm-fav-end">加载中…</span>
                <span v-else-if="!favFilterTerm && !favHasMore && favoritesList.length" class="cm-fav-end">已到底</span>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 添加/编辑片段 -->
    <SnippetEditorDialog
      v-model="showDialog"
      :favorite="editing"
      :categories="categories"
      @save="saveFavorite"
    />

    <!-- 历史记录富文本编辑 -->
    <ClipboardHistoryEditorDialog
      v-model="historyDialog"
      :item="editingHistory"
      @save="saveHistory"
    />

    <!-- 清空确认 -->
    <UiDialog :model-value="clearConfirm" title="清空全部历史记录" @update:model-value="clearConfirm = false">
      <p class="confirm-text">确定清空所有历史记录吗？此操作不可恢复。</p>
      <template #footer>
        <UiButton variant="ghost" @click="clearConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="clearAllHistory">确定清空</UiButton>
      </template>
    </UiDialog>

    <!-- 单条删除确认 -->
    <UiDialog
      :model-value="deleteConfirm"
      :title="deleteTarget && activeTab === 'favorites' ? '删除片段' : '删除记录'"
      @update:model-value="deleteConfirm = false"
    >
      <p class="confirm-text">确定删除这条{{ activeTab === 'favorites' ? '片段' : '记录' }}吗？此操作不可恢复。</p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="confirmDeleteItem">删除</UiButton>
      </template>
    </UiDialog>

    <!-- 批量删除确认 -->
    <UiDialog :model-value="batchDeleteConfirm" title="删除所选记录" @update:model-value="batchDeleteConfirm = false">
      <p class="confirm-text">确定删除选中的 <strong>{{ selectedIds.size }}</strong> 条记录吗？此操作不可恢复。</p>
      <template #footer>
        <UiButton variant="ghost" @click="batchDeleteConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="confirmBatchDelete">删除所选</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { History, Star, Search, Plus, Trash2, Pencil, Check, SquareCheckBig, X } from '@lucide/vue'
import UiPillTab from '@renderer/components/ui/UiPillTab.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import SnippetEditorDialog from '@renderer/components/SnippetEditorDialog.vue'
import ClipboardHistoryEditorDialog from '@renderer/components/ClipboardHistoryEditorDialog.vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import { useToast } from '@renderer/composables/useToast'
import { openPlaceholderDialog } from '@renderer/composables/useSnippetPlaceholder'
import type { HistoryItem, FavoriteItem, CategoryItem, ClipboardRetention, FavoritesCursor } from '@preload/ipc'

const toast = useToast()

const activeTab = ref<'history' | 'favorites'>('history')
const historyList = ref<HistoryItem[]>([])
const searchResults = ref<HistoryItem[]>([])
const favoritesList = ref<FavoriteItem[]>([])
const categories = ref<CategoryItem[]>([])
const selectedCategory = ref('')
const keyword = ref('')
const favKeyword = ref('')
/** 片段搜索防抖后的过滤词（避免 computed 内每键全量过滤） */
const favFilterTerm = ref('')
const retention = ref<ClipboardRetention>({ autoClean: true, value: 1, unit: 'month' })
/** 保留策略是否已从主进程加载完成：加载前不渲染开关，避免默认值「开」先闪现再跳到真实值 */
const retentionLoaded = ref(false)
/** 清理数量下拉可选值：1-30 */
const RETENTION_VALUES = Array.from({ length: 30 }, (_, i) => i + 1)
const showDialog = ref(false)
const editing = ref<FavoriteItem | null>(null)
/** 历史记录富文本编辑弹窗：打开状态 + 编辑目标 */
const historyDialog = ref(false)
const editingHistory = ref<HistoryItem | null>(null)
const clearConfirm = ref(false)
/** 批量选择模式 */
const selectMode = ref(false)
/** 批量选择模式下已勾选的记录 id 集合 */
const selectedIds = ref<Set<number>>(new Set())
/** 单条删除确认：待删除目标 + 弹窗开关 */
const deleteTarget = ref<DisplayItem | null>(null)
const deleteConfirm = ref(false)
/** 批量删除确认弹窗开关 */
const batchDeleteConfirm = ref(false)
/** 最近一次点击复制的记录 id（用于展示「已复制」反馈） */
const justCopiedId = ref<number | null>(null)
/** 「已复制」反馈复位定时器 */
let copiedTimer: ReturnType<typeof setTimeout> | null = null
/** 搜索防抖定时器 */
let searchTimer: ReturnType<typeof setTimeout> | null = null
/** 搜索请求序号（竞态守卫：只采纳最后一次） */
let searchSeq = 0
/** 片段搜索防抖定时器 + 竞态序号 */
let favSearchTimer: ReturnType<typeof setTimeout> | null = null
let favSearchSeq = 0
/** 历史记录实时增长上限：持续复制时裁剪尾部，避免无界 DOM 增长（getHistory 基线 100，此处放宽） */
const HISTORY_MAX = 300

type DisplayItem = HistoryItem | FavoriteItem

/** 片段游标分页：每次拉取一页，页面滑到底再取下一页（keyset 按 created_at DESC, id DESC，插入置顶项不漂移） */
const FAV_PAGE_SIZE = 100
/** 片段搜索结果（搜索态；分类在客户端再过滤） */
const favSearchResults = ref<FavoriteItem[]>([])
/** 下一页游标（上一页末项的 created_at+id）；null 表示无历史页 */
const favCursor = ref<FavoritesCursor | null>(null)
/** 是否还有下一页（上一页取满即保守认为可能还有） */
const favHasMore = ref(false)
/** 是否正在加载下一页 / 首页 */
const favLoading = ref(false)
/** 滚动容器（.cm-body，作为 IntersectionObserver 的 root） */
const cmBodyRef = ref<HTMLElement | null>(null)
/** 片段列表底部哨兵：滚动到它即加载下一页 */
const favSentinelRef = ref<HTMLElement | null>(null)
/** IntersectionObserver 实例（卸载时断开） */
let favObserver: IntersectionObserver | null = null

/** 片段展示列表：搜索态用服务器结果（分类客户端过滤），否则用 keyset 累积列表（分类已在服务端过滤） */
const favDisplayList = computed<FavoriteItem[]>(() => {
  if (favFilterTerm.value) {
    let list = favSearchResults.value
    if (selectedCategory.value) list = list.filter((i) => i.category === selectedCategory.value)
    return list
  }
  return favoritesList.value
})

const displayList = computed<DisplayItem[]>(() => {
  if (activeTab.value === 'history') {
    return keyword.value ? searchResults.value : historyList.value
  }
  return favDisplayList.value
})

const tint = (index: number): string =>
  (['lavender', 'mint', 'yellow', 'blue', 'violet'] as const)[index % 5]

interface DaySection {
  key: string
  label: string
  startIndex: number
  items: HistoryItem[]
}

/** 历史记录按天分组（今天 / 昨天 / M月D日，跨年带年份） */
const daySections = computed<DaySection[]>(() => {
  const sections = new Map<string, DaySection>()
  let offset = 0
  for (const item of displayList.value as HistoryItem[]) {
    const key = toDayKey(item.created_at)
    let section = sections.get(key)
    if (!section) {
      section = { key, label: toDayLabel(item.created_at), startIndex: offset, items: [] }
      sections.set(key, section)
    }
    section.items.push(item)
    offset++
  }
  return [...sections.values()]
})

function toDayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function toDayLabel(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const today = toDayKey(now)
  const yesterday = toDayKey(now - 86_400_000)
  const key = toDayKey(ts)
  if (key === today) return '今天'
  if (key === yesterday) return '昨天'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 卡片时钟（分组后仅显示时分） */
function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 剪贴板图片协议 URL（渲染端 <img> 直接引用，免 base64 过 IPC） */
function imageUrl(filename: string): string {
  return `prism-image://clipboard-images/${filename}`
}

async function fetchHistory(): Promise<void> {
  historyList.value = await window.electronAPI.clipboard.getHistory(100, 0)
}
async function fetchCategories(): Promise<void> {
  categories.value = await window.electronAPI.clipboard.getCategories()
}

/** 片段 keyset 分页：reset=true 取第一页，false 用上一页末项游标取下一页 */
async function loadFavorites(reset: boolean): Promise<void> {
  if (favLoading.value) return
  if (!reset && !favHasMore.value) return
  favLoading.value = true
  try {
    const page = await window.electronAPI.clipboard.getFavorites(
      FAV_PAGE_SIZE,
      reset ? undefined : (favCursor.value ?? undefined),
      selectedCategory.value || undefined
    )
    favoritesList.value = reset ? page : [...favoritesList.value, ...page]
    const last = page[page.length - 1]
    favCursor.value = last ? { createdAt: last.created_at, id: last.id } : null
    // 取满一页即保守认为可能还有更多（最后一次不足一页时置 false，终止加载）
    favHasMore.value = page.length === FAV_PAGE_SIZE
  } finally {
    favLoading.value = false
  }
}

/** 片段搜索（服务器侧按关键字），分类在客户端过滤 */
async function searchFavoritesServer(keyword: string): Promise<void> {
  const kw = keyword.trim()
  if (!kw) {
    favSearchResults.value = []
    await loadFavorites(true)
    return
  }
  favSearchResults.value = await window.electronAPI.clipboard.searchSnippets(kw)
}

/** 当前收藏态刷新入口：搜索态走服务器检索，否则重置回第一页 */
function refreshFavorites(): void {
  favCursor.value = null
  favHasMore.value = false
  if (favFilterTerm.value) void searchFavoritesServer(favFilterTerm.value)
  else void loadFavorites(true)
}

async function fetchFavorites(): Promise<void> {
  await refreshFavorites()
}

/** 片段列表滚动到底自动加载下一页（以 .cm-body 为 root；哨兵在切到收藏页、渲染完成后再 observe） */
function setupFavObserver(): void {
  if (!favObserver) {
    favObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        // 搜索态结果为一组有界集，不走滚动分页
        if (favFilterTerm.value) return
        if (favHasMore.value && !favLoading.value) void loadFavorites(false)
      },
      { root: cmBodyRef.value, rootMargin: '120px 0px' }
    )
  }
  if (favSentinelRef.value) favObserver.observe(favSentinelRef.value)
}

async function switchTab(tab: 'history' | 'favorites'): Promise<void> {
  activeTab.value = tab
  exitSelectMode()
  if (tab === 'history') {
    await fetchHistory()
  } else {
    await fetchFavorites()
    await fetchCategories()
    // 等哨兵渲染进 DOM 后再建立滚动分页观察
    await nextTick()
    setupFavObserver()
  }
}

watch(keyword, (val) => {
  const seq = ++searchSeq
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    searchTimer = null
    const kw = val.trim()
    if (!kw) {
      searchResults.value = []
      return
    }
    const results = await window.electronAPI.clipboard.searchHistory(kw)
    // 竞态守卫：仅采纳最后一次输入对应的结果
    if (seq === searchSeq) searchResults.value = results
  }, 200)
})

// 片段搜索防抖：与历史 keyword 一致 200ms；为空走 keyset 分页，非空走服务器检索
watch(favKeyword, (val) => {
  const seq = ++favSearchSeq
  if (favSearchTimer) clearTimeout(favSearchTimer)
  favSearchTimer = setTimeout(() => {
    favSearchTimer = null
    if (seq !== favSearchSeq) return
    favFilterTerm.value = val.trim()
    if (favFilterTerm.value) void searchFavoritesServer(favFilterTerm.value)
    else void loadFavorites(true)
  }, 200)
})

// 分类变化：重置分页回到第一页（搜索态在客户端按分类过滤）
watch(selectedCategory, () => {
  favCursor.value = null
  favHasMore.value = false
  if (favFilterTerm.value) void searchFavoritesServer(favFilterTerm.value)
  else void loadFavorites(true)
})

async function copyItem(item: Pick<HistoryItem, 'content' | 'type'>): Promise<void> {
  await window.electronAPI.clipboard.clickItem({ content: item.content, type: item.type })
}

/** 片段卡片点击：先解析占位符（有占位符则弹输入框，用户取消则放弃），再走常规复制 */
async function handleFavoriteClick(item: FavoriteItem): Promise<void> {
  const resolved = await openPlaceholderDialog({ content: item.content, type: item.type })
  if (!resolved) return
  await handleCopy({ ...resolved, id: item.id })
}

/** 点击复制：执行复制并展示短暂的「已复制」反馈 */
async function handleCopy(item: Pick<HistoryItem, 'content' | 'type'> & { id?: number }): Promise<void> {
  await copyItem(item)
  if (typeof item.id !== 'number') return
  justCopiedId.value = item.id
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    justCopiedId.value = null
    copiedTimer = null
  }, 1200)
}

/** 卡片阶梯入场的延迟（最多 8 项封顶，避免长列表拖沓） */
function cardDelay(index: number): Record<string, string> {
  return { '--cm-delay': `${Math.min(index, 8) * 40}ms` }
}

async function quickFavorite(item: HistoryItem): Promise<void> {
  await window.electronAPI.clipboard.addFavorite(
    item.content,
    '',
    '',
    item.type === 'richtext' ? 'richtext' : 'text'
  )
  await fetchFavorites()
  await fetchCategories()
  toast.success('已收藏')
}

/** 打开历史记录富文本编辑弹窗 */
function editHistoryItem(item: HistoryItem): void {
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
  historyList.value = historyList.value.map((h) => (h.id === target.id ? updated : h))
  if (searchResults.value.some((h) => h.id === target.id)) {
    searchResults.value = searchResults.value.map((h) => (h.id === target.id ? updated : h))
  }
  toast.success('记录已更新')
}

function openAdd(): void {
  editing.value = null
  showDialog.value = true
}

function editFavorite(item: FavoriteItem): void {
  editing.value = item
  showDialog.value = true
}

async function saveFavorite(payload: {
  content: string
  category: string
  description: string
}): Promise<void> {
  if (!payload.content) return
  const target = editing.value
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
  showDialog.value = false
  editing.value = null
  await fetchFavorites()
  await fetchCategories()
  toast.success(target ? '片段已更新' : '片段已添加')
}

/** 单条删除：先弹确认，确认后执行 */
function requestDeleteItem(item: DisplayItem): void {
  deleteTarget.value = item
  deleteConfirm.value = true
}

async function confirmDeleteItem(): Promise<void> {
  const target = deleteTarget.value
  deleteConfirm.value = false
  deleteTarget.value = null
  if (!target) return
  if (activeTab.value === 'history') {
    await window.electronAPI.clipboard.deleteHistory(target.id)
    historyList.value = historyList.value.filter((h) => h.id !== target.id)
    toast.success('已删除记录')
  } else {
    await window.electronAPI.clipboard.deleteFavorite(target.id)
    favoritesList.value = favoritesList.value.filter((f) => f.id !== target.id)
    await fetchCategories()
    toast.success('已删除片段')
  }
}

/** 进入批量选择模式 */
function enterSelectMode(): void {
  selectMode.value = true
  selectedIds.value = new Set()
}

/** 退出批量选择模式并清空勾选 */
function exitSelectMode(): void {
  selectMode.value = false
  if (selectedIds.value.size) selectedIds.value = new Set()
}

/** 卡片点击：选择模式下切换勾选，否则复制 */
function onCardClick(item: HistoryItem): void {
  if (selectMode.value) toggleSelect(item)
  else void handleCopy(item)
}

function toggleSelect(item: HistoryItem): void {
  const next = new Set(selectedIds.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  selectedIds.value = next
}

/** 批量删除所选记录 */
async function confirmBatchDelete(): Promise<void> {
  const ids = [...selectedIds.value]
  batchDeleteConfirm.value = false
  if (!ids.length) return
  await window.electronAPI.clipboard.deleteHistoryBatch(ids)
  historyList.value = historyList.value.filter((h) => !ids.includes(h.id))
  exitSelectMode()
  toast.success(`已删除 ${ids.length} 条记录`)
}

async function clearAllHistory(): Promise<void> {
  await window.electronAPI.clipboard.clearHistory()
  historyList.value = []
  clearConfirm.value = false
  toast.success('已清空全部历史记录')
}

async function onAutoCleanToggle(value: boolean): Promise<void> {
  retention.value.autoClean = value
  await window.electronAPI.clipboard.setRetentionState({ autoClean: value })
  await fetchHistory()
}

async function onValueChange(event: Event): Promise<void> {
  const value = Number((event.target as HTMLSelectElement).value)
  retention.value.value = value
  await window.electronAPI.clipboard.setRetentionState({ value })
  await fetchHistory()
}

async function onUnitChange(event: Event): Promise<void> {
  const unit = (event.target as HTMLSelectElement).value as ClipboardRetention['unit']
  retention.value.unit = unit
  await window.electronAPI.clipboard.setRetentionState({ unit })
  await fetchHistory()
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

onMounted(async () => {
  await fetchHistory()
  retention.value = await window.electronAPI.clipboard.getRetentionState()
  retentionLoaded.value = true

  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onNewItem((item) => {
      // 新增或"置顶"（重复复制）：移除旧位置后插到最前
      historyList.value = historyList.value.filter((h) => h.id !== item.id)
      historyList.value.unshift(item)
      // 封顶：持续复制时裁剪尾部，避免列表无界增长导致 DOM 与重渲染膨胀
      if (historyList.value.length > HISTORY_MAX) {
        historyList.value.length = HISTORY_MAX
      }
    })
  )

  // 历史变更（编辑/删除/清空/导入等）：刷新列表（反映主页等处的编辑）
  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onHistoryChanged(() => {
      void fetchHistory()
    })
  )

  // 窗口重新显示时刷新当前页：隐藏期间 onlyVisible 广播被跳过，避免历史/片段停留旧数据
  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', () => {
      if (activeTab.value === 'history') void fetchHistory()
      else refreshFavorites()
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
  if (favSearchTimer) {
    clearTimeout(favSearchTimer)
    favSearchTimer = null
  }
  favObserver?.disconnect()
  favObserver = null
})
</script>

<style scoped>
.cm {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.cm-header {
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

.cm-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3) var(--sp-4);
  flex-wrap: wrap;
}

.cm-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.cm-auto-clean {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.cm-auto-clean.is-off {
  opacity: 0.55;
}

.cm-retention-text {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.cm-retention-select {
  height: 30px;
  padding: 0 var(--sp-2);
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
}

.cm-retention-select:focus {
  border-color: var(--brand);
}

.cm-retention-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cm-tabs {
  display: flex;
  gap: var(--sp-2);
}

.cm-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-5);
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 60ms;
}

.cm-toolbar--col {
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-3);
}

.cm-toolbar .ui-input {
  flex: 1;
}

.cm-select-btn {
  flex-shrink: 0;
}

.cm-select-count {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.cm-toolbar-row {
  display: flex;
  gap: var(--sp-3);
}

.cm-cats {
  display: flex;
  gap: var(--sp-2);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.cat-count {
  opacity: 0.7;
}

.cm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-3) var(--sp-5) var(--sp-5);
}

/* Tab 切换过渡（P5）：只作用于列表区；出场更快（exit faster than enter） */
.cm-view {
  height: 100%;
}

.view-enter-active {
  transition: opacity var(--duration-base) var(--ease-out-soft);
}

.view-leave-active {
  transition: opacity 130ms var(--ease-out-soft);
}

.view-enter-from,
.view-leave-to {
  opacity: 0;
}

.cm-empty {
  display: flex;
  justify-content: center;
  padding-top: var(--sp-8);
}

.cm-empty :deep(.ui-empty__icon) {
  animation: float 3s ease-in-out infinite;
}

.cm-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.cm-fav-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* 片段列表底部哨兵（滚动到底自动加载下一页）：轻量占位，不参与交互 */
.cm-fav-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-3) 0 var(--sp-1);
  min-height: 20px;
}
.cm-fav-end {
  font-size: 12px;
  color: var(--text-muted);
}

.cm-day__label {
  padding: 0 var(--sp-1) var(--sp-2);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

.cm-day__cards {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* 卡片列表过渡（TransitionGroup）：
   enter 用 card-in + 内联 --cm-delay 做阶梯；leave 淡出缩放；move 平滑位移 */
.cm-card-enter-active {
  animation: card-in var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: var(--cm-delay, 0ms);
}

.cm-card-leave-active {
  transition: opacity 180ms var(--ease-out-soft), transform 180ms var(--ease-out-soft);
}

.cm-card-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(-4px);
}

.cm-card-move {
  transition: transform var(--duration-base) var(--ease-out-soft);
}

.cm-card {
  position: relative;
  padding: var(--sp-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  cursor: pointer;
  transition: transform 160ms var(--ease-out-soft), box-shadow var(--duration-base) var(--ease-out-soft),
    border-color var(--duration-base) var(--ease-out-soft);
  /* 长列表原生虚拟化：未进入视口的卡片跳过布局/绘制，显著降大列表渲染与内存 */
  content-visibility: auto;
  contain-intrinsic-size: auto 88px;
}

/* 顶部品牌色细高光条：hover 时浮现，营造"面板"层次 */
.cm-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: var(--sp-4);
  right: var(--sp-4);
  height: 1px;
  border-radius: 1px;
  background: var(--brand);
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out-soft);
  pointer-events: none;
}

.cm-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), 0 0 0 1px color-mix(in srgb, var(--brand) 14%, transparent);
}

.cm-card:hover::before {
  opacity: 0.55;
}

.cm-card.is-selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand), var(--shadow-sm);
}

/* 点击复制成功后的短暂高亮反馈 */
.cm-card.is-copied {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand), 0 4px 16px color-mix(in srgb, var(--brand) 18%, transparent);
}

.cm-card__copied {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand);
  animation: pop var(--duration-base) var(--ease-spring);
}

.cm-card__check {
  position: absolute;
  top: var(--sp-3);
  right: var(--sp-3);
  z-index: 1;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--bg-surface);
  color: transparent;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft);
}

.cm-card.is-selected .cm-card__check {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.cm-card__content {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.cm-card__image {
  max-width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.cm-card__meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  flex-wrap: wrap;
}

.cm-card__cat {
  font-size: 11px;
  font-weight: 500;
  padding: 2px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--bg-selected-subtle);
  color: var(--text-secondary);
}

.cm-card__desc {
  font-size: 12px;
  color: var(--text-muted);
}

.cm-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--sp-3);
}

.cm-card__time {
  font-size: 11px;
  color: var(--text-muted);
}

.cm-card__actions {
  display: flex;
  gap: var(--sp-1);
  opacity: 0;
  transform: translateX(6px);
  transition: opacity var(--duration-fast) var(--ease-out-soft),
    transform var(--duration-fast) var(--ease-out-soft);
}

.cm-card:hover .cm-card__actions {
  opacity: 1;
  transform: translateX(0);
}

.cm-card--lavender {
  background: var(--accent-lavender);
  border-color: transparent;
}
.cm-card--mint {
  background: var(--accent-mint);
  border-color: transparent;
}
.cm-card--yellow {
  background: var(--accent-yellow);
  border-color: transparent;
}
.cm-card--blue {
  background: var(--accent-blue);
  border-color: transparent;
}
.cm-card--violet {
  background: var(--accent-violet);
  border-color: transparent;
}

.action-btn {
  width: 28px;
  height: 28px;
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

.action-btn:hover {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
}

.action-btn--danger:hover {
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
