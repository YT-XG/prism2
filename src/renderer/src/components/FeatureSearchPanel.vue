<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="isOpen"
        class="palette-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="功能搜索"
        @keydown="onKeydown"
        @click.self="close"
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
            <button
              v-for="(item, index) in items"
              :key="item.id"
              type="button"
              class="palette-item"
              :class="{ 'is-active': index === activeIndex }"
              @click="run(item)"
              @mouseenter="activeIndex = index"
            >
              <component :is="item.icon" :size="15" :stroke-width="1.6" class="palette-item__icon" />
              <span class="palette-item__title">{{ item.title }}</span>
              <span v-if="item.subtitle" class="palette-item__sub">{{ item.subtitle }}</span>
              <kbd v-if="item.kind !== 'feature'" class="palette-kbd">↵</kbd>
            </button>

            <div v-if="!items.length" class="palette-empty">无匹配结果</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Search, House, ClipboardList, StickyNote, Settings2, History, Star, Folder } from '@lucide/vue'
import type { Component } from 'vue'
import { useFeatureSearch } from '@renderer/composables/useFeatureSearch'
import { useToast } from '@renderer/composables/useToast'
import { itemText } from '@renderer/composables/useClipboardText'
import { openPlaceholderDialog } from '@renderer/composables/useSnippetPlaceholder'
import type { QuickFolder } from '@preload/ipc'

const { isOpen, close } = useFeatureSearch()
const toast = useToast()
const router = useRouter()

/** 静态功能源：名称/别名命中即跳转对应页面 */
interface FeatureDef {
  id: string
  name: string
  aliases: string[]
  icon: Component
  to: string
}

const FEATURES: FeatureDef[] = [
  { id: 'home', name: '主页', aliases: ['首页', 'home'], icon: House, to: '/mainPage/home' },
  {
    id: 'clipboard',
    name: '剪贴板',
    aliases: ['历史', '复制', 'clipboard'],
    icon: ClipboardList,
    to: '/mainPage/clipboard'
  },
  {
    id: 'notes',
    name: '便利贴',
    aliases: ['便签', '备忘', 'notes'],
    icon: StickyNote,
    to: '/mainPage/notes'
  },
  { id: 'settings', name: '设置', aliases: ['选项', 'settings'], icon: Settings2, to: '/mainPage/settings' }
]

interface PaletteItem {
  id: string
  kind: 'feature' | 'history' | 'snippet' | 'folder'
  icon: Component
  title: string
  subtitle?: string
  run: () => void
}

const query = ref('')
const items = ref<PaletteItem[]>([])
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** 组装搜索源：功能命中 ∪ 剪贴板历史前 10 ∪ 片段前 10 */
async function rebuild(): Promise<void> {
  const q = query.value.trim()
  const lower = q.toLowerCase()

  let featureItems: PaletteItem[] = []
  if (!q) {
    featureItems = FEATURES.map((f) => ({
      id: `feature-${f.id}`,
      kind: 'feature' as const,
      icon: f.icon,
      title: f.name,
      run: () => {
        void router.push(f.to)
      }
    }))
  } else {
    featureItems = FEATURES.filter(
      (f) => f.name.toLowerCase().includes(lower) || f.aliases.some((a) => a.toLowerCase().includes(lower))
    ).map((f) => ({
      id: `feature-${f.id}`,
      kind: 'feature' as const,
      icon: f.icon,
      title: f.name,
      run: () => {
        void router.push(f.to)
      }
    }))
  }

  if (!q) {
    items.value = featureItems
    activeIndex.value = 0
    return
  }

  const [history, snippets, folders] = await Promise.all([
    window.electronAPI.clipboard.searchHistory(q),
    window.electronAPI.clipboard.searchSnippets(q),
    window.electronAPI.quickFolders.getFolders()
  ])
  // 快捷文件夹：按名称/路径匹配，失效路径不参与
  const folderItems: PaletteItem[] = folders
    .filter((f) => !f.missing)
    .filter(
      (f) => f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower)
    )
    .slice(0, 8)
    .map((f) => ({
      id: `folder-${f.id}`,
      kind: 'folder' as const,
      icon: Folder,
      title: f.name,
      subtitle: f.path,
      run: () => {
        void openQuickFolder(f)
      }
    }))
  const historyItems: PaletteItem[] = history.slice(0, 10).map((h) => ({
    id: `history-${h.id}`,
    kind: 'history',
    icon: History,
    title: itemText(h),
    subtitle: '剪贴板',
    run: () => {
      void window.electronAPI.clipboard.clickItem({ content: h.content, type: h.type })
    }
  }))
  const snippetItems: PaletteItem[] = snippets.slice(0, 10).map((s) => ({
    id: `snippet-${s.id}`,
    kind: 'snippet',
    icon: Star,
    title: itemText(s),
    subtitle: s.category || '片段',
    run: async () => {
      // 片段：先解析占位符（有占位符则弹输入框，用户取消则放弃）
      const resolved = await openPlaceholderDialog({ content: s.content, type: s.type })
      if (!resolved) return
      void window.electronAPI.clipboard.clickItem(resolved)
    }
  }))

  items.value = [...featureItems, ...folderItems, ...historyItems, ...snippetItems]
  activeIndex.value = 0
}

/** 在系统资源管理器中打开快捷文件夹（失败给出 Toast 反馈） */
async function openQuickFolder(folder: QuickFolder): Promise<void> {
  const r = await window.electronAPI.quickFolders.openFolder(folder.path)
  if (!r.ok) toast.error(`打开文件夹失败：${r.error ?? '未知错误'}`)
}

function run(item: PaletteItem): void {
  item.run()
  close()
}

function scrollActive(): void {
  const el = listRef.value?.children[activeIndex.value]
  el?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
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

watch(query, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void rebuild(), 200)
})

/** 打开时聚焦输入框并重置为功能列表（launcher 态） */
watch(isOpen, (open) => {
  if (!open) return
  nextTick(() => {
    inputRef.value?.focus()
    query.value = ''
    void rebuild()
  })
})
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
  box-shadow: var(--shadow-lg);
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

.palette-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 36px;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.palette-item:hover,
.palette-item.is-active {
  background: var(--bg-hover);
}

.palette-item.is-active .palette-item__icon {
  color: var(--brand);
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
