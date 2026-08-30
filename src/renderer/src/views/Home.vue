<template>
  <div class="home">
    <!-- 头部：标题 + 功能搜索按钮 -->
    <header class="home-header">
      <div>
        <h1 class="home-title">主页</h1>
        <p class="home-subtitle">快捷操作与最近记录，常用功能一键直达</p>
      </div>
      <UiButton variant="secondary" @click="openFeatureSearch">
        <Command :size="14" :stroke-width="1.6" /> 功能搜索
        <kbd class="home-kbd">Ctrl&nbsp;K</kbd>
      </UiButton>
    </header>

    <!-- 快捷搜索：同时搜历史 + 片段 -->
    <section class="home-search">
      <UiInput v-model="keyword" label="快捷搜索" placeholder="搜索剪贴板历史或片段…">
        <template #leading><Search :size="15" :stroke-width="1.6" /></template>
      </UiInput>
    </section>

    <!-- 搜索态：分组结果 -->
    <section v-if="searching" class="home-scroll">
      <div
        v-if="!searchResults.history.length && !searchResults.snippets.length"
        class="home-empty"
      >
        <UiEmptyState title="无匹配结果" hint="换个关键词试试" />
      </div>
      <div v-else class="search-groups">
        <div v-if="searchResults.history.length" class="search-group">
          <div class="search-group__label">剪贴板历史</div>
          <button
            v-for="(item, index) in searchResults.history"
            :key="'h' + item.id"
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
            <span v-else class="row__text">{{ item.content }}</span>
            <span v-if="copiedKey === 'history-' + item.id" class="row__copied">
              <Check :size="12" :stroke-width="3" /> 已复制
            </span>
          </button>
        </div>
        <div v-if="searchResults.snippets.length" class="search-group">
          <div class="search-group__label">片段</div>
          <button
            v-for="(item, index) in searchResults.snippets"
            :key="'s' + item.id"
            type="button"
            class="row"
            :class="{ 'is-copied': copiedKey === 'snippet-' + item.id }"
            :style="rowDelay(index)"
            @click="handleCopy(item, 'snippet')"
          >
            <Star :size="14" :stroke-width="1.6" class="row__cat-icon" />
            <span class="row__text">{{ item.content }}</span>
            <span v-if="item.category" class="row__cat">{{ item.category }}</span>
            <span v-if="copiedKey === 'snippet-' + item.id" class="row__copied">
              <Check :size="12" :stroke-width="3" /> 已复制
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- 默认态 -->
    <template v-else>
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

      <!-- 最近记录两栏 -->
      <section class="home-recent">
        <div class="recent-card">
          <div class="recent-head">
            <span class="recent-title"><History :size="14" :stroke-width="1.6" /> 最近剪贴板</span>
            <RouterLink to="/mainPage/clipboard" class="recent-more">全部 ›</RouterLink>
          </div>
          <div v-if="!recentHistory.length" class="recent-empty">暂无历史记录</div>
          <div v-else class="recent-list">
            <button
              v-for="(item, index) in recentHistory"
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
              <span v-else class="row__text">{{ item.content }}</span>
              <span class="row__time">{{ formatTime(item.created_at) }}</span>
              <span v-if="copiedKey === 'history-' + item.id" class="row__copied">
                <Check :size="12" :stroke-width="3" /> 已复制
              </span>
              <span class="row__actions" @click.stop>
                <button class="row-btn" title="收藏" @click="quickFavorite(item)">
                  <Star :size="13" :stroke-width="1.6" />
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

        <div class="recent-card">
          <div class="recent-head">
            <span class="recent-title"><Star :size="14" :stroke-width="1.6" /> 最近片段</span>
            <RouterLink to="/mainPage/clipboard" class="recent-more">全部 ›</RouterLink>
          </div>
          <div v-if="!recentSnippets.length" class="recent-empty">暂无片段</div>
          <div v-else class="recent-list">
            <button
              v-for="(item, index) in recentSnippets"
              :key="item.id"
              type="button"
              class="row"
              :class="{ 'is-copied': copiedKey === 'snippet-' + item.id }"
              :style="rowDelay(index)"
              @click="handleCopy(item, 'snippet')"
            >
              <Star :size="14" :stroke-width="1.6" class="row__cat-icon" />
              <span class="row__text">{{ item.content }}</span>
              <span v-if="item.category" class="row__cat">{{ item.category }}</span>
              <span v-if="copiedKey === 'snippet-' + item.id" class="row__copied">
                <Check :size="12" :stroke-width="3" /> 已复制
              </span>
              <span class="row__actions" @click.stop>
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
      </section>
    </template>

    <!-- 清空历史确认 -->
    <UiDialog
      :model-value="clearConfirm"
      title="清空全部历史记录"
      @update:model-value="clearConfirm = false"
    >
      <p class="confirm-text">确定清空所有历史记录吗？此操作不可恢复。</p>
      <template #footer>
        <UiButton variant="ghost" @click="clearConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="confirmClearAll">确定清空</UiButton>
      </template>
    </UiDialog>

    <!-- 单条删除确认 -->
    <UiDialog
      :model-value="deleteConfirm"
      :title="deleteTarget?.kind === 'snippet' ? '删除片段' : '删除记录'"
      @update:model-value="deleteConfirm = false"
    >
      <p class="confirm-text">
        确定删除这条{{ deleteTarget?.kind === 'snippet' ? '片段' : '记录' }}吗？此操作不可恢复。
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="confirmDelete">删除</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search,
  Command,
  ClipboardList,
  StickyNote,
  Settings2,
  Trash2,
  Download,
  Star,
  History,
  Check
} from '@lucide/vue'
import type { Component } from 'vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import { useToast } from '@renderer/composables/useToast'
import { useFeatureSearch } from '@renderer/composables/useFeatureSearch'
import type { HistoryItem, FavoriteItem } from '@preload/ipc'

const router = useRouter()
const toast = useToast()
const { open: openFeatureSearch } = useFeatureSearch()

/** 快捷搜索关键词与分组结果 */
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
/** 图片记录 data URL 缓存 */
const imageCache = ref<Record<string, string>>({})
/** 最近复制反馈（kind-id 复合键，区分历史/片段 id 同值） */
const copiedKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
/** 搜索防抖定时器 */
let searchTimer: ReturnType<typeof setTimeout> | null = null
/** 清空 / 单条删除确认 */
const clearConfirm = ref(false)
const deleteTarget = ref<{ kind: 'history' | 'snippet'; item: HistoryItem | FavoriteItem } | null>(
  null
)
const deleteConfirm = ref(false)

const searching = computed(() => keyword.value.trim().length > 0)

/** 快捷入口卡（图标 + 名称 + 动作） */
const entries: Array<{ label: string; icon: Component; action: () => void }> = [
  {
    label: '便利贴',
    icon: StickyNote,
    action: () => void router.push('/mainPage/notes')
  },
  {
    label: '功能搜索',
    icon: Command,
    action: openFeatureSearch
  },
  {
    label: '剪贴板',
    icon: ClipboardList,
    action: () => void router.push('/mainPage/clipboard')
  },
  {
    label: '设置',
    icon: Settings2,
    action: () => void router.push('/mainPage/settings')
  },
  {
    label: '清空历史',
    icon: Trash2,
    action: () => {
      clearConfirm.value = true
    }
  },
  {
    label: '导出备份',
    icon: Download,
    action: () => void exportBackup()
  }
]

/** 点击复制：写剪贴板 → 最小化归还焦点 → 模拟粘贴，并展示短暂「已复制」反馈 */
async function handleCopy(
  item: { content: string; id: number; type?: HistoryItem['type'] },
  kind: 'history' | 'snippet'
): Promise<void> {
  await window.electronAPI.clipboard.clickItem({ content: item.content, type: item.type ?? 'text' })
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
  categoryCount.value = (await window.electronAPI.clipboard.getCategories()).length
}

/** 权威刷新：最近列表 + 概览统计 */
async function refreshAll(): Promise<void> {
  await Promise.all([fetchRecent(), fetchStats()])
}

/** 快捷搜索：200ms 防抖后并行搜历史 + 片段 */
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
  await window.electronAPI.clipboard.addFavorite(item.content, '', '')
  await fetchStats()
  toast.success('已收藏')
}

function requestDelete(
  item: HistoryItem | FavoriteItem,
  kind: 'history' | 'snippet'
): void {
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
  } else {
    await window.electronAPI.clipboard.deleteFavorite(target.item.id)
    recentSnippets.value = recentSnippets.value.filter((f) => f.id !== target.item!.id)
    toast.success('已删除片段')
  }
  await fetchStats()
}

async function confirmClearAll(): Promise<void> {
  clearConfirm.value = false
  await window.electronAPI.clipboard.clearHistory()
  recentHistory.value = []
  await fetchStats()
  toast.success('已清空全部历史记录')
}

async function exportBackup(): Promise<void> {
  const result = await window.electronAPI.clipboard.exportBackup()
  if (result.canceled) return
  if (result.ok) toast.success('备份已导出')
  else toast.error(result.error || '导出失败')
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
  await refreshAll()

  // 新记录/置顶：插到最近列表最前（去重）
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
})
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
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

.home-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.home-kbd {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-hover);
}

.home-search {
  padding: var(--sp-2) var(--sp-5) var(--sp-3);
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 40ms;
}

/* 滚动容器 */
.home-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-2) var(--sp-5) var(--sp-5);
}

.home-empty {
  display: flex;
  justify-content: center;
  padding-top: var(--sp-8);
}

/* 搜索分组 */
.search-groups {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.search-group__label {
  padding: 0 var(--sp-1) var(--sp-2);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* 数据概览 */
.home-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-5);
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 80ms;
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
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-5);
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 120ms;
}

.entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
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

/* 最近记录两栏 */
.home-recent {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  flex: 1;
  min-height: 0;
  padding: var(--sp-2) var(--sp-5) var(--sp-5);
  animation: fade-up var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: 160ms;
}

.recent-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  overflow: hidden;
}

.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border);
}

.recent-title {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.recent-more {
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
}

.recent-more:hover {
  color: var(--brand);
}

.recent-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
  font-size: 13px;
  color: var(--text-muted);
}

.recent-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-2);
}

/* 通用行（搜索/最近共用） */
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
