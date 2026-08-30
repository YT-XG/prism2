<template>
  <div class="qp">
    <div class="qp-card">
      <!-- 搜索输入（自绘输入框：需要完整的键盘导航控制） -->
      <div class="qp-input" :class="{ 'qp-input--focused': inputFocused }">
        <Search :size="15" :stroke-width="1.6" class="qp-input__icon" />
        <input
          ref="inputRef"
          v-model="keyword"
          class="qp-input__field"
          placeholder="搜索剪贴板历史，↑↓ 选择，回车粘贴..."
          @keydown="onKeydown"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
        />
        <span class="qp-input__count num">{{ results.length }}</span>
      </div>

      <!-- 结果列表 -->
      <div class="qp-list">
        <div v-if="!results.length" class="qp-empty">
          <Search :size="22" :stroke-width="1.6" />
          <span>{{ keyword ? '无匹配记录' : '暂无剪贴板历史' }}</span>
        </div>
        <TransitionGroup v-else tag="div" name="qp" class="qp-items">
          <div
            v-for="(item, index) in results"
            :key="item.id"
            class="qp-item"
            :class="{ 'qp-item--active': index === activeIndex }"
            @click="paste(item)"
            @mouseenter="activeIndex = index"
          >
            <img
              v-if="item.type === 'image' && imageCache[item.content]"
              :src="imageCache[item.content]"
              class="qp-item__thumb"
              alt=""
            />
            <ImageIcon v-else-if="item.type === 'image'" :size="16" :stroke-width="1.6" class="qp-item__img-icon" />
            <div class="qp-item__text" :class="{ 'qp-item__text--muted': item.type === 'image' }">
              <template v-if="item.type === 'image'">图片 · {{ formatTime(item.created_at) }}</template>
              <template v-else>{{ item.content }}</template>
            </div>
            <span class="qp-item__time">{{ formatTime(item.created_at) }}</span>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Search, Image as ImageIcon } from '@lucide/vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type { HistoryItem } from '@preload/ipc'

/** 展示条数上限 */
const MAX_ITEMS = 20
/** 搜索防抖（ms） */
const SEARCH_DEBOUNCE_MS = 120

const keyword = ref('')
const historyList = ref<HistoryItem[]>([])
const searchResults = ref<HistoryItem[]>([])
const activeIndex = ref(0)
const inputFocused = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
/** 图片 data URL 缓存（content 文件名 → data URL） */
const imageCache = ref<Record<string, string>>({})

let debounceTimer: ReturnType<typeof setTimeout> | null = null

const results = ref<HistoryItem[]>([])

watch(
  () => [keyword.value, historyList.value, searchResults.value] as const,
  () => {
    const list = keyword.value.trim() ? searchResults.value : historyList.value
    results.value = list.slice(0, MAX_ITEMS)
    activeIndex.value = 0
  },
  { immediate: true }
)

watch(keyword, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    searchResults.value = val.trim() ? await window.electronAPI.clipboard.searchHistory(val) : []
  }, SEARCH_DEBOUNCE_MS)
})

/** 懒加载图片预览 */
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

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!results.value.length) return
    const delta = e.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + delta + results.value.length) % results.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = results.value[activeIndex.value]
    if (item) void paste(item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    window.electronAPI.window.hide()
  }
}

async function paste(item: HistoryItem): Promise<void> {
  await window.electronAPI.clipboard.clickItem({ content: item.content, type: item.type })
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}时前`
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 重新拉取最近历史（窗口每次显示时补齐隐藏期间复制的内容） */
async function refreshHistory(): Promise<void> {
  historyList.value = await window.electronAPI.clipboard.getHistory(MAX_ITEMS, 0)
  void loadImages(historyList.value)
}

/** 窗口每次显示（重新聚焦）时聚焦输入框并全选，同时刷新历史 */
function onFocusWindow(): void {
  keyword.value = ''
  searchResults.value = []
  void refreshHistory()
  inputRef.value?.focus()
  inputRef.value?.select()
}

onMounted(async () => {
  window.addEventListener('focus', onFocusWindow)
  onFocusWindow()

  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onNewItem((item) => {
      // 新记录/置顶记录插到最前
      historyList.value = historyList.value.filter((h) => h.id !== item.id)
      historyList.value.unshift(item)
      if (item.type === 'image') void loadImages([item])
    })
  )
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocusWindow)
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<style scoped>
.qp {
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
  background: transparent;
}

.qp-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

/* ── 输入区 ── */
.qp-input {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 42px;
  margin: var(--sp-3);
  padding: 0 var(--sp-3);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
}

.qp-input--focused {
  border-color: var(--brand);
  box-shadow: var(--ring);
}

.qp-input__icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.qp-input__field {
  flex: 1;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-primary);
}

.qp-input__field::placeholder {
  color: var(--text-muted);
}

.qp-input__count {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ── 列表 ── */
.qp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--sp-3) var(--sp-3);
}

.qp-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 结果列表过渡（TransitionGroup） */
.qp-enter-active {
  animation: card-in var(--duration-enter) var(--ease-out-soft);
}

.qp-leave-active {
  transition: opacity 160ms var(--ease-out-soft), transform 160ms var(--ease-out-soft);
}

.qp-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.qp-move {
  transition: transform var(--duration-base) var(--ease-out-soft);
}

.qp-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--text-muted);
  font-size: 12px;
}

.qp-empty svg {
  animation: float 3s ease-in-out infinite;
}

.qp-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

/* 当前选中项：左侧品牌色竖条 + 背景 */
.qp-item--active {
  background: var(--bg-hover);
}

.qp-item--active::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 14px;
  border-radius: 1px;
  background: var(--brand);
  animation: pop var(--duration-base) var(--ease-spring);
}

.qp-item__thumb {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.qp-item__img-icon {
  color: var(--text-muted);
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qp-item__text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qp-item__text--muted {
  color: var(--text-secondary);
}

.qp-item__time {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>
