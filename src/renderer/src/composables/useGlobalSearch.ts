/**
 * 全局搜索（共享逻辑）
 * @description 命令面板（Ctrl+K / 工具栏「功能搜索」）与主页「最近记录框」搜索共用的聚合逻辑：
 * 功能（名称/别名命中）+ 快捷文件夹（名称/路径命中，失效路径排除）+ 剪贴板历史 + 片段。
 * 两类入口各自保留界面，仅复用本模块的聚合与匹配规则。
 */
import { ref } from 'vue'
import type { Component } from 'vue'
import { House, ClipboardList, StickyNote, Settings2 } from '@lucide/vue'
import type { QuickFolder, HistoryItem, FavoriteItem } from '@preload/ipc'

/** 全局功能源：名称/别名命中即跳转对应页面（命令面板 launcher 态亦展示全部） */
export interface FeatureDef {
  id: string
  name: string
  aliases: string[]
  icon: Component
  to: string
}

export const GLOBAL_FEATURES: FeatureDef[] = [
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

/** 一次全局搜索的聚合结果（各来源已过滤/限量） */
export interface GlobalSearchResult {
  features: FeatureDef[]
  folders: QuickFolder[]
  history: HistoryItem[]
  snippets: FavoriteItem[]
}

/** 空查询时的聚合结果：仅功能全量（命令面板 launcher 态） */
const EMPTY_RESULT: GlobalSearchResult = {
  features: GLOBAL_FEATURES,
  folders: [],
  history: [],
  snippets: []
}

/** 按名称/别名做不区分大小写的包含匹配 */
function matchFeatures(q: string): FeatureDef[] {
  const lower = q.toLowerCase()
  return GLOBAL_FEATURES.filter(
    (f) => f.name.toLowerCase().includes(lower) || f.aliases.some((a) => a.toLowerCase().includes(lower))
  )
}

/**
 * 全局搜索聚合：功能 + 快捷文件夹 + 剪贴板历史 + 片段。
 * 空查询返回功能全量（launcher 态），其余来源为空。
 */
export async function searchGlobal(q: string): Promise<GlobalSearchResult> {
  const trimmed = q.trim()
  if (!trimmed) return EMPTY_RESULT

  const lower = trimmed.toLowerCase()
  const [history, snippets, folders] = await Promise.all([
    window.electronAPI.clipboard.searchHistory(trimmed),
    window.electronAPI.clipboard.searchSnippets(trimmed),
    window.electronAPI.quickFolders.getFolders()
  ])
  return {
    features: matchFeatures(trimmed),
    // 快捷文件夹：按名称/路径匹配，失效路径不参与
    folders: folders
      .filter((f) => !f.missing)
      .filter(
        (f) => f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower)
      )
      .slice(0, 8),
    history: history.slice(0, 10),
    snippets: snippets.slice(0, 10)
  }
}

/** 组合式封装：持有查询词与结果，内部 200ms 防抖调用 searchGlobal（供命令面板使用） */
export function useGlobalSearch() {
  const query = ref('')
  const result = ref<GlobalSearchResult>({ ...EMPTY_RESULT })
  let timer: ReturnType<typeof setTimeout> | null = null

  async function run(q: string): Promise<void> {
    result.value = await searchGlobal(q)
  }

  /** 防抖搜索（默认 200ms） */
  function search(q: string, debounceMs = 200): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(q), debounceMs)
  }

  /** 立即重置到 launcher 态 */
  function reset(): void {
    if (timer) clearTimeout(timer)
    void run('')
  }

  return { query, result, search, reset }
}
