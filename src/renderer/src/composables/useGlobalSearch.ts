/**
 * 全局搜索（共享逻辑）
 * @description 命令面板（Ctrl+K / 工具栏「功能搜索」）与主页「最近记录框」搜索共用的聚合逻辑：
 * 功能（名称/别名命中）+ 快捷文件夹（名称/路径命中，失效路径排除）+ 剪贴板历史 + 片段。
 * 两类入口各自保留界面，仅复用本模块的聚合与匹配规则。
 */
import { ref } from 'vue'
import type { Component } from 'vue'
import { House, ClipboardList, StickyNote, Settings2, Mail, HardDrive } from '@lucide/vue'
import type { QuickFolder, HistoryItem, FavoriteItem } from '@preload/ipc'
import { itemText } from '@renderer/composables/useClipboardText'
import { isPinyinQuery, matchesPinyin } from '@renderer/composables/usePinyin'

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
  {
    id: 'mail',
    name: '邮箱大师',
    aliases: ['邮箱', '邮件', '收信', 'mail'],
    icon: Mail,
    to: '/mainPage/mail'
  },
  {
    id: 'storage',
    name: '存储优化',
    aliases: ['清理', '磁盘', '空间', '大文件', 'storage', 'disk'],
    icon: HardDrive,
    to: '/mainPage/storage'
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

/** 按名称/别名做不区分大小写的包含匹配，并叠加拼音命中 */
function matchFeatures(q: string): FeatureDef[] {
  const lower = q.toLowerCase()
  return GLOBAL_FEATURES.filter(
    (f) =>
      f.name.toLowerCase().includes(lower) ||
      f.aliases.some((a) => a.toLowerCase().includes(lower)) ||
      matchesPinyin(f.name, q) ||
      f.aliases.some((a) => matchesPinyin(a, q))
  )
}

/** 拼音查询时历史 / 片段的候选池大小（本地 SQLite IPC，受 200ms 防抖限制，量级可控） */
const PINYIN_POOL = 300

/** 单个文本是否命中：普通子串 或 拼音 */
function matchText(text: string, lower: string, q: string): boolean {
  return text.toLowerCase().includes(lower) || matchesPinyin(text, q)
}

/** 历史条目：仅文本/富文本，按纯文本 + 拼音命中 */
function filterHistory(
  items: HistoryItem[],
  lower: string,
  q: string,
  limit: number
): HistoryItem[] {
  const pool = items.filter((h) => h.type === 'text' || h.type === 'richtext')
  const hits: HistoryItem[] = []
  for (const h of pool) {
    if (matchText(itemText(h), lower, q)) {
      hits.push(h)
      if (hits.length >= limit) break
    }
  }
  return hits
}

/** 片段：内容或描述命中（拼音按纯文本） */
function filterSnippets(
  items: FavoriteItem[],
  lower: string,
  q: string,
  limit: number
): FavoriteItem[] {
  const hits: FavoriteItem[] = []
  for (const s of items) {
    if (
      matchText(itemText(s), lower, q) ||
      matchText(s.description ?? '', lower, q)
    ) {
      hits.push(s)
      if (hits.length >= limit) break
    }
  }
  return hits
}

/**
 * 全局搜索聚合：功能 + 快捷文件夹 + 剪贴板历史 + 片段。
 * 空查询（launcher 态）返回功能全量 + 最近 20 条剪贴板历史，其余来源为空。
 */
export async function searchGlobal(q: string): Promise<GlobalSearchResult> {
  const trimmed = q.trim()
  if (!trimmed) {
    const recent = await window.electronAPI.clipboard.getHistory(20, 0)
    return {
      ...EMPTY_RESULT,
      // 图片记录 content 为文件名，在单行列表中无法预览，仅取文本/富文本
      history: recent.filter((h) => h.type === 'text' || h.type === 'richtext')
    }
  }

  const lower = trimmed.toLowerCase()
  const pinyinOnly = isPinyinQuery(trimmed)
  const folders = await window.electronAPI.quickFolders.getFolders()

  let history: HistoryItem[] = []
  let snippets: FavoriteItem[] = []
  if (pinyinOnly) {
    // 拼音查询：LIKE 子串无法命中，改拉取受控候选池后由渲染端做拼音过滤
    const [hPool, fPool] = await Promise.all([
      window.electronAPI.clipboard.getHistory(PINYIN_POOL, 0),
      window.electronAPI.clipboard.getFavorites(PINYIN_POOL)
    ])
    history = filterHistory(hPool, lower, trimmed, 10)
    snippets = filterSnippets(fPool, lower, trimmed, 10)
  } else {
    const [hs, ss] = await Promise.all([
      window.electronAPI.clipboard.searchHistory(trimmed),
      window.electronAPI.clipboard.searchSnippets(trimmed)
    ])
    history = hs.slice(0, 10)
    snippets = ss.slice(0, 10)
  }

  return {
    features: matchFeatures(trimmed),
    // 快捷文件夹：按别名/名称/路径匹配（含拼音），失效路径不参与
    folders: folders
      .filter((f) => !f.missing)
      .filter(
        (f) =>
          (f.alias?.toLowerCase().includes(lower) ?? false) ||
          f.name.toLowerCase().includes(lower) ||
          f.path.toLowerCase().includes(lower) ||
          matchesPinyin(f.alias ?? '', trimmed) ||
          matchesPinyin(f.name, trimmed) ||
          matchesPinyin(f.path, trimmed)
      )
      .slice(0, 8),
    history,
    snippets
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
