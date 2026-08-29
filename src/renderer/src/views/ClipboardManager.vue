<template>
  <div class="cm">
    <!-- 头部：标题 + 标签页 -->
    <header class="cm-header">
      <div class="cm-titlebar">
        <h1 class="cm-title">剪贴板</h1>
        <div
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
            :disabled="!retention.autoClean"
            @change="onValueChange"
          >
            <option v-for="n in RETENTION_VALUES" :key="n" :value="n">{{ n }}</option>
          </select>
          <select
            class="cm-retention-select"
            :value="retention.unit"
            :disabled="!retention.autoClean"
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
      <UiInput v-model="keyword" placeholder="搜索历史记录...">
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
        <span class="cm-select-count">已选 {{ selectedIds.size }} 项</span>
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
        <UiInput v-model="favKeyword" placeholder="搜索片段内容或描述...">
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
          {{ cat.name || '未分类' }}<span class="cat-count">{{ cat.count }}</span>
        </UiPillTab>
      </div>
    </div>

    <!-- 列表 -->
    <div class="cm-body">
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
            <div class="cm-day__cards">
              <div
                v-for="item in section.items"
                :key="item.id"
                class="cm-card"
                :class="{ 'is-selected': selectMode && selectedIds.has(item.id) }"
                @click="onCardClick(item)"
              >
                <span v-if="selectMode" class="cm-card__check">
                  <Check v-if="selectedIds.has(item.id)" :size="12" :stroke-width="3" />
                </span>
                <div class="cm-card__content">
                  <img
                    v-if="item.type === 'image'"
                    :src="imageCache[item.content]"
                    class="cm-card__image"
                    alt="剪贴板图片"
                  />
                  <template v-else>{{ item.content }}</template>
                </div>
                <div class="cm-card__footer">
                  <span class="cm-card__time">{{ formatClock(item.created_at) }}</span>
                  <div v-if="!selectMode" class="cm-card__actions" @click.stop>
                    <button
                      v-if="item.type !== 'image'"
                      class="action-btn"
                      title="收藏"
                      @click="quickFavorite(item)"
                    >
                      <Star :size="14" :stroke-width="1.6" />
                    </button>
                    <button class="action-btn action-btn--danger" title="删除" @click="requestDeleteItem(item)">
                      <Trash2 :size="14" :stroke-width="1.6" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 片段：平铺 -->
        <template v-else>
          <div
            v-for="(item, index) in displayList"
            :key="item.id"
            class="cm-card"
            :class="`cm-card--${tint(index)}`"
            @click="copyItem({ content: item.content, type: 'text' })"
          >
            <div class="cm-card__content">{{ item.content }}</div>

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
              <span class="cm-card__time">{{ formatTime(item.created_at) }}</span>
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
        </template>
      </div>
    </div>

    <!-- 添加/编辑片段 -->
    <UiDialog
      :model-value="showDialog"
      :title="editing ? '编辑片段' : '添加片段'"
      @update:model-value="closeDialog"
    >
      <div class="form-group">
        <label>内容 <span class="required">*</span></label>
        <textarea v-model="form.content" class="form-textarea" rows="4" placeholder="输入片段内容..."></textarea>
      </div>
      <div class="form-group">
        <label>分类</label>
        <input v-model="form.category" class="form-input" placeholder="如：Linux 命令" list="categoryList" />
        <datalist id="categoryList">
          <option v-for="cat in categories" :key="cat.name" :value="cat.name" />
        </datalist>
      </div>
      <div class="form-group">
        <label>描述（可选）</label>
        <input v-model="form.description" class="form-input" placeholder="添加备注..." />
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="closeDialog()">取消</UiButton>
        <UiButton variant="primary" :disabled="!form.content" @click="saveFavorite">
          {{ editing ? '保存' : '添加' }}
        </UiButton>
      </template>
    </UiDialog>

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
import { ref, computed, watch, onMounted } from 'vue'
import { History, Star, Search, Plus, Trash2, Pencil, Check, SquareCheckBig, X } from '@lucide/vue'
import UiPillTab from '@renderer/components/ui/UiPillTab.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type { HistoryItem, FavoriteItem, CategoryItem, ClipboardRetention } from '@preload/ipc'

const activeTab = ref<'history' | 'favorites'>('history')
const historyList = ref<HistoryItem[]>([])
const searchResults = ref<HistoryItem[]>([])
const favoritesList = ref<FavoriteItem[]>([])
const categories = ref<CategoryItem[]>([])
const selectedCategory = ref('')
const keyword = ref('')
const favKeyword = ref('')
const retention = ref<ClipboardRetention>({ autoClean: true, value: 1, unit: 'month' })
/** 清理数量下拉可选值：1-30 */
const RETENTION_VALUES = Array.from({ length: 30 }, (_, i) => i + 1)
const showDialog = ref(false)
const editing = ref<FavoriteItem | null>(null)
const form = ref({ content: '', category: '', description: '' })
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
/** 图片记录的 data URL 缓存（content 文件名 → data URL） */
const imageCache = ref<Record<string, string>>({})

type DisplayItem = HistoryItem | FavoriteItem

const displayList = computed<DisplayItem[]>(() => {
  if (activeTab.value === 'history') {
    return keyword.value ? searchResults.value : historyList.value
  }
  let filtered = favoritesList.value
  if (selectedCategory.value) filtered = filtered.filter((i) => i.category === selectedCategory.value)
  if (favKeyword.value) {
    const kw = favKeyword.value.toLowerCase()
    filtered = filtered.filter(
      (i) => i.content.toLowerCase().includes(kw) || (i.description && i.description.toLowerCase().includes(kw))
    )
  }
  return filtered
})

const tint = (index: number): string =>
  (['lavender', 'mint', 'yellow', 'blue', 'violet'] as const)[index % 5]

interface DaySection {
  key: string
  label: string
  items: HistoryItem[]
}

/** 历史记录按天分组（今天 / 昨天 / M月D日，跨年带年份） */
const daySections = computed<DaySection[]>(() => {
  const sections = new Map<string, DaySection>()
  for (const item of displayList.value as HistoryItem[]) {
    const key = toDayKey(item.created_at)
    let section = sections.get(key)
    if (!section) {
      section = { key, label: toDayLabel(item.created_at), items: [] }
      sections.set(key, section)
    }
    section.items.push(item)
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

async function fetchHistory(): Promise<void> {
  historyList.value = await window.electronAPI.clipboard.getHistory(100, 0)
  void loadImages(historyList.value)
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
async function fetchFavorites(): Promise<void> {
  favoritesList.value = await window.electronAPI.clipboard.getFavorites()
}
async function fetchCategories(): Promise<void> {
  categories.value = await window.electronAPI.clipboard.getCategories()
}

async function switchTab(tab: 'history' | 'favorites'): Promise<void> {
  activeTab.value = tab
  exitSelectMode()
  if (tab === 'history') await fetchHistory()
  else {
    await fetchFavorites()
    await fetchCategories()
  }
}

watch(keyword, async (val) => {
  searchResults.value = val.trim() ? await window.electronAPI.clipboard.searchHistory(val) : []
})

async function copyItem(item: Pick<HistoryItem, 'content' | 'type'>): Promise<void> {
  await window.electronAPI.clipboard.clickItem({ content: item.content, type: item.type })
}

async function quickFavorite(item: HistoryItem): Promise<void> {
  await window.electronAPI.clipboard.addFavorite(item.content, '', '')
  await fetchFavorites()
  await fetchCategories()
}

function openAdd(): void {
  editing.value = null
  form.value = { content: '', category: '', description: '' }
  showDialog.value = true
}

function editFavorite(item: FavoriteItem): void {
  editing.value = item
  form.value = { content: item.content, category: item.category, description: item.description }
  showDialog.value = true
}

function closeDialog(): void {
  showDialog.value = false
  editing.value = null
  form.value = { content: '', category: '', description: '' }
}

async function saveFavorite(): Promise<void> {
  if (!form.value.content) return
  if (editing.value) {
    await window.electronAPI.clipboard.updateFavorite(
      editing.value.id,
      form.value.content,
      form.value.category,
      form.value.description
    )
  } else {
    await window.electronAPI.clipboard.addFavorite(form.value.content, form.value.category, form.value.description)
  }
  closeDialog()
  await fetchFavorites()
  await fetchCategories()
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
  } else {
    await window.electronAPI.clipboard.deleteFavorite(target.id)
    favoritesList.value = favoritesList.value.filter((f) => f.id !== target.id)
    await fetchCategories()
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
  else void copyItem(item)
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
}

async function clearAllHistory(): Promise<void> {
  await window.electronAPI.clipboard.clearHistory()
  historyList.value = []
  clearConfirm.value = false
}

async function onAutoCleanToggle(value: boolean): Promise<void> {
  retention.value.autoClean = value
  await window.electronAPI.clipboard.setRetentionState({ autoClean: value })
  await fetchHistory()
}

async function onValueChange(event: Event): Promise<void> {
  if (!retention.value.autoClean) return
  const value = Number((event.target as HTMLSelectElement).value)
  retention.value.value = value
  await window.electronAPI.clipboard.setRetentionState({ value })
  await fetchHistory()
}

async function onUnitChange(event: Event): Promise<void> {
  if (!retention.value.autoClean) return
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

  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onNewItem((item) => {
      // 新增或"置顶"（重复复制）：移除旧位置后插到最前
      historyList.value = historyList.value.filter((h) => h.id !== item.id)
      historyList.value.unshift(item)
      if (item.type === 'image') void loadImages([item])
    })
  )
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

.cm-empty {
  display: flex;
  justify-content: center;
  padding-top: var(--sp-8);
}

.cm-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.cm-day__label {
  padding: 0 var(--sp-1) var(--sp-2);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.cm-day__cards {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.cm-card {
  position: relative;
  padding: var(--sp-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  cursor: pointer;
  transition: transform 120ms var(--ease-out-soft), box-shadow var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft);
}

.cm-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.cm-card.is-selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand), var(--shadow-sm);
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
  background: rgba(17, 17, 17, 0.06);
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
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.cm-card:hover .cm-card__actions {
  opacity: 1;
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

.form-group {
  margin-bottom: var(--sp-4);
}
.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.required {
  color: var(--danger);
}
.form-input,
.form-textarea {
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-surface);
  outline: none;
}
.form-input:focus,
.form-textarea:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.12);
}
.form-textarea {
  resize: vertical;
  min-height: 80px;
}
.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
