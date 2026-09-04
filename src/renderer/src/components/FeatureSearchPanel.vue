<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="isOpen"
        class="palette-overlay"
        :class="{ 'is-standalone': standalone }"
        role="dialog"
        aria-modal="true"
        aria-label="功能搜索"
        @keydown="onKeydown"
        @click.self="closePanel"
      >
        <div class="palette">
          <div class="palette-search">
            <Search :size="16" :stroke-width="1.6" />
            <input
              ref="inputRef"
              v-model="query"
              class="palette-input"
              type="text"
              placeholder="搜索功能、剪贴板、片段、快捷文件夹…"
              spellcheck="false"
            />
            <span class="palette-kbd">Esc</span>
          </div>

          <div ref="listRef" class="palette-body">
            <div
              v-for="(item, index) in items"
              :key="item.id"
              class="palette-cell"
              :class="{ 'is-active': index === activeIndex }"
              @mouseenter="activeIndex = index"
            >
              <button type="button" class="palette-item" @click="run(item)">
                <component :is="item.icon" :size="15" :stroke-width="1.6" class="palette-item__icon" />
                <span class="palette-item__title">{{ item.title }}</span>
                <span v-if="item.subtitle" class="palette-item__sub">{{ item.subtitle }}</span>
                <kbd v-if="item.kind !== 'feature'" class="palette-kbd">↵</kbd>
              </button>
              <div v-if="item.chips?.length" class="palette-chips">
                <button
                  v-for="w in item.chips"
                  :key="w"
                  type="button"
                  class="palette-chip"
                  :title="`粘贴「${w}」`"
                  @click="pasteWord(w, item)"
                >
                  {{ w }}
                </button>
                <span v-if="(item.chipMore ?? 0) > 0" class="palette-chip palette-chip--more">
                  +{{ item.chipMore }}
                </span>
              </div>
            </div>

            <div v-if="!items.length" class="palette-empty">无匹配结果</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Search, History, Star, Folder } from '@lucide/vue'
import type { Component } from 'vue'
import { useFeatureSearch } from '@renderer/composables/useFeatureSearch'
import { useGlobalSearch, type GlobalSearchResult } from '@renderer/composables/useGlobalSearch'
import { useToast } from '@renderer/composables/useToast'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import { itemText } from '@renderer/composables/useClipboardText'
import { splitWords } from '@renderer/composables/useWordSplit'
import { openPlaceholderDialog } from '@renderer/composables/useSnippetPlaceholder'
import type { QuickFolder } from '@preload/ipc'

/** standalone=true：独立搜索窗口（Ctrl+K SearchFrame）内使用——无主页遮罩、铺满窗口、选中即关窗 */
const props = withDefaults(defineProps<{ standalone?: boolean }>(), { standalone: false })

const { isOpen, open, close } = useFeatureSearch()
/** 全局搜索共享状态：查询词 + 聚合结果（功能/文件夹/历史/片段，防抖在内部处理） */
const { query, result, search, reset } = useGlobalSearch()
const toast = useToast()
const router = useRouter()

interface PaletteItem {
  id: string
  kind: 'feature' | 'history' | 'snippet' | 'folder'
  icon: Component
  title: string
  subtitle?: string
  /** 历史条目可拆出的分词（前几个）；点某词即只粘贴该词 */
  chips?: string[]
  /** 超出展示上限的剩余词数，用于「+N」折叠示意 */
  chipMore?: number
  /** 分词快捷粘贴的源内容（仅 history 条目有） */
  target?: { content: string; type: string }
  run: () => void
}

/** 全局搜索历史条目单个结果上最多展示的分词胶囊数（紧凑面板空间有限，比卡片略少） */
const MAX_SEARCH_CHIPS = 3

const items = ref<PaletteItem[]>([])
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)

/** 由共享搜索结果组装面板列表：功能 ∪ 快捷文件夹 ∪ 片段 ∪ 剪贴板历史（片段优先于历史）。
 *  每个条目的 run 自行管理关窗时机：
 *  - 剪贴板/片段粘贴：独立窗仅关本地面板，窗口最小化与焦点交还由主进程 clickItem 统一处理
 *    （渲染端不再先 searchClose，否则 hide 后焦点交还不可靠，SendKeys 的 ^v 会发到搜索窗）；
 *  - 片段占位符弹窗需窗口保持可见，故确认后再执行粘贴。 */
function buildItems(r: GlobalSearchResult): PaletteItem[] {
  const featureItems: PaletteItem[] = r.features.map((f) => ({
    id: `feature-${f.id}`,
    kind: 'feature' as const,
    icon: f.icon,
    title: f.name,
    run: () => {
      if (props.standalone) {
        // 独立窗口：主进程隐藏搜索窗并让主窗口跳转对应页面（页面取 /mainPage/ 之后段）
        const page = f.to.replace(/^\/mainPage\//, '') || 'home'
        window.electronAPI.window.searchOpenFeature(page)
      } else {
        void router.push(f.to)
        closePanel()
      }
    }
  }))
  const folderItems: PaletteItem[] = r.folders.map((f) => ({
    id: `folder-${f.id}`,
    kind: 'folder' as const,
    icon: Folder,
    title: f.alias || f.name,
    subtitle: f.path,
    run: () => {
      if (props.standalone) closePanel()
      void openQuickFolder(f)
      if (!props.standalone) closePanel()
    }
  }))
  const historyItems: PaletteItem[] = r.history.map((h) => {
    const words = splitWords(itemText(h))
    const hasChips = words.length >= 2
    return {
      id: `history-${h.id}`,
      kind: 'history',
      icon: History,
      title: itemText(h),
      subtitle: '剪贴板',
      chips: hasChips ? words.slice(0, MAX_SEARCH_CHIPS) : undefined,
      chipMore: hasChips ? words.length - MAX_SEARCH_CHIPS : undefined,
      target: { content: h.content, type: h.type },
      run: () => {
        // 独立窗口：仅关本地面板（窗口最小化与焦点交还由主进程 clickItem 统一处理），再执行粘贴
        if (props.standalone) close()
        void window.electronAPI.clipboard.clickItem({ content: h.content, type: h.type })
        if (!props.standalone) closePanel()
      }
    }
  })
  const snippetItems: PaletteItem[] = r.snippets.map((s) => ({
    id: `snippet-${s.id}`,
    kind: 'snippet',
    icon: Star,
    title: itemText(s),
    subtitle: s.category || '片段',
    run: async () => {
      // 片段：先解析占位符（窗口需保持可见以显示输入框），确认后粘贴（独立窗最小化由主进程统一处理）
      const resolved = await openPlaceholderDialog({ content: s.content, type: s.type })
      if (resolved) {
        if (props.standalone) close()
        void window.electronAPI.clipboard.clickItem(resolved)
        if (!props.standalone) closePanel()
      } else {
        closePanel()
      }
    }
  }))
  return [...featureItems, ...folderItems, ...snippetItems, ...historyItems]
}

/** 在系统资源管理器中打开快捷文件夹（失败给出 Toast 反馈） */
async function openQuickFolder(folder: QuickFolder): Promise<void> {
  const r = await window.electronAPI.quickFolders.openFolder(folder.path)
  if (!r.ok) toast.error(`打开文件夹失败：${r.error ?? '未知错误'}`)
}

/** 关闭面板：standalone 下额外隐藏独立搜索窗口（Esc / 选中 / 点击遮罩均经此） */
function closePanel(): void {
  close()
  if (props.standalone) window.electronAPI.window.searchClose()
}

/** 执行条目：关窗时机由各条目 run 自行管理（standalone 需先关窗再粘贴等） */
function run(item: PaletteItem): void {
  item.run()
}

/** 点某个分词胶囊：只粘贴该词（复用 clickItem 粘贴链路；独立窗先关面板由主进程统一最小化/交还焦点） */
function pasteWord(word: string, item: PaletteItem): void {
  if (!item.target) return
  if (props.standalone) close()
  void window.electronAPI.clipboard.clickItem({ content: word, type: 'text' })
  if (!props.standalone) closePanel()
}

function scrollActive(): void {
  const el = listRef.value?.children[activeIndex.value]
  el?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePanel()
    return
  }
  // 焦点落在分词胶囊上：方向键/回车交给原生处理（回车触发该胶囊粘贴本身），不与主列表导航冲突
  if ((e.target as HTMLElement | null)?.closest?.('.palette-chip')) return
  if (!items.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % items.value.length
    scrollActive()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + items.value.length) % items.value.length
    scrollActive()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = items.value[activeIndex.value]
    if (item) run(item)
  }
}

/** 查询词变化：防抖触发共享全局搜索 */
watch(query, (val) => {
  search(val)
})

/** 搜索结果更新：重排列表并回到首项 */
watch(result, (r) => {
  items.value = buildItems(r)
  activeIndex.value = 0
})

/** 打开时聚焦输入框并重置为功能列表（launcher 态） */
watch(isOpen, (open) => {
  if (!open) return
  nextTick(() => {
    inputRef.value?.focus()
    query.value = ''
    reset()
  })
})

/** 独立搜索窗口：挂载即打开面板（无主页工具栏入口，靠 isOpen 驱动 v-if） */
onMounted(() => {
  if (!props.standalone) return
  open()
  // 主进程每次显示窗口都发 show 事件，显式重开面板（不依赖 visibilitychange：hide/show 下不可靠）
  subscribeOnUnmounted(() => window.electronAPI.window.onSearchShow(() => open()))
  window.addEventListener('blur', onBlur)
})

onBeforeUnmount(() => {
  window.removeEventListener('blur', onBlur)
})

/** 失焦即隐藏（避免置顶搜索窗残留）；仅在面板已打开时生效，避免隐藏/焦点抖动误关 */
function onBlur(): void {
  if (isOpen.value) closePanel()
}
</script>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  background: rgba(20, 20, 26, 0.32);
  backdrop-filter: blur(6px);
}

.palette {
  width: 520px;
  max-width: 80vw;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  overflow: hidden;
}

.palette-search {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
}

.palette-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-primary);
}

.palette-input::placeholder {
  color: var(--text-muted);
}

.palette-kbd {
  flex-shrink: 0;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-hover);
}

.palette-body {
  overflow-y: auto;
  padding: var(--sp-2);
}

/* 结果条目单元：主按钮 + 可选分词胶囊行 */
.palette-cell {
  border-radius: var(--radius-sm);
}

.palette-cell:hover,
.palette-cell.is-active {
  background: var(--bg-hover);
}

.palette-cell.is-active .palette-item__icon {
  color: var(--brand);
}

.palette-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 36px;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

/* 自动拆词胶囊：点某词只粘贴该词；与剪贴板卡片 .chip 视觉一致 */
.palette-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-2);
  padding: 0 var(--sp-3) var(--sp-2);
}

.palette-chip {
  padding: 2px var(--sp-2);
  border: none;
  border-radius: var(--radius-pill);
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
  background: var(--bg-selected-subtle);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.palette-chip:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.palette-chip:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}

/* 超展示上限的折叠示意：纯展示，不可点击 */
.palette-chip--more {
  cursor: default;
  background: transparent;
  color: var(--text-muted);
}

.palette-chip--more:hover {
  background: transparent;
  color: var(--text-muted);
}

.palette-item__icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.palette-item__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item__sub {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.palette-empty {
  padding: var(--sp-6);
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

/* 独立搜索窗口（Ctrl+K SearchFrame）：无遮罩、面板铺满窗口；留 8px 内边距让卡片边框在透明窗口内完整可见 */
.palette-overlay.is-standalone {
  align-items: stretch;
  padding: 8px;
  background: transparent;
  backdrop-filter: none;
}

.palette-overlay.is-standalone .palette {
  width: 100%;
  max-width: 100%;
  max-height: 100vh;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

/* standalone 下开关过渡置为无：避免 hide/show 打断 250ms 离场动画后残留低透明度残影（表现为边框可见而文字不可见） */
.palette-overlay.is-standalone.palette-enter-active,
.palette-overlay.is-standalone.palette-leave-active {
  transition: none;
}

.palette-overlay.is-standalone.palette-enter-from,
.palette-overlay.is-standalone.palette-leave-to {
  opacity: 1;
  transform: none;
}

/* 面板出入场：淡入 + 轻微上移 */
.palette-enter-active,
.palette-leave-active {
  transition: opacity var(--duration-base) var(--ease-out-soft),
    transform var(--duration-base) var(--ease-out-soft);
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
