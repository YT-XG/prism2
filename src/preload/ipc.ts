/**
 * IPC 契约 —— 全部通道名常量与数据模型的唯一来源。
 *
 * 规则（v2 架构规范）：
 * - 主进程 services 与 preload 都从这里导入通道名常量，禁止散落字符串字面量。
 * - 数据模型在此定义一次，主进程 / preload / 渲染端（经 index.d.ts）共享。
 * - 本文件**不得 import electron 运行时**（保持纯常量 + 类型），
 *   以便被渲染端类型检查安全引用。
 */

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/** 剪贴板历史记录项 */
export interface HistoryItem {
  id: number
  content: string
  created_at: number
}

/** 收藏片段项 */
export interface FavoriteItem {
  id: number
  content: string
  category: string
  description: string
  created_at: number
}

/** 收藏分类及其数量 */
export interface CategoryItem {
  name: string
  count: number
}

/**
 * 剪贴板历史自动清除策略。
 * 滑动窗口：每次触发清理时以当下为基准，删除早于「value 个 unit」的历史记录。
 * 例如 value=5、unit=day → 保留最近 5 天。
 */
export interface ClipboardRetention {
  /** 定时自动清除总开关 */
  autoClean: boolean
  /** 清除数量：1-30 */
  value: number
  /** 清除单位：day / week / month / year */
  unit: 'day' | 'week' | 'month' | 'year'
}

/** 应用设置 */
export interface AppSettings {
  /** 主页面显隐快捷键，如 'CommandOrControl+Alt+V' */
  shortcut: string
  /** 片段选择器快捷键 */
  snippetShortcut: string
  /** 搜索框快捷键 */
  searchBoxShortcut: string
  /** 局域网更新服务器路径 */
  serverUrl: string
  /** 开机自启动 */
  autoStart: boolean
  /** 更新源：lan | github */
  updateSource: 'lan' | 'github'
  /** GitHub 仓库地址（owner/repo） */
  githubRepo: string
  /** 剪贴板历史自动清除数量：1-30 */
  clipboardRetentionValue: number
  /** 自动清除开关 */
  clipboardAutoClean: boolean
  /** 剪贴板历史自动清除单位：day | week | month | year */
  clipboardRetentionUnit: 'day' | 'week' | 'month' | 'year'
  /** 主题：light / lavender（参考图）/ mint（白绿参考图）/ dark（预留） */
  theme: 'light' | 'dark' | 'lavender' | 'mint'
}

// ---------------------------------------------------------------------------
// 通道名常量
// ---------------------------------------------------------------------------

/** 渲染 ↔ 主窗口（窗口类，经 recvOne/recvTwo/sendOne/sendTwo） */
export const WINDOW_CHANNELS = {
  mainPage: {
    toMain: {
      minimize: 'to-main-MainPage:minimize',
      hideAfterAnimation: 'to-main-MainPage:hideAfterAnimation',
      toggleMaximize: 'to-main-MainPage:toggleMaximize',
      ready: 'to-main-MainPage:ready',
      openTranslate: 'to-main-MainPage:openTranslate'
    },
    toRenderer: {
      startHide: 'to-renderer-MainPage:startHide',
      reShow: 'to-renderer-MainPage:reShow',
      setPage: 'to-renderer-MainPage:setPage',
      version: 'to-renderer-MainPage:version',
      maximizeState: 'to-renderer-MainPage:maximizeState'
    }
  }
} as const

/** 渲染 ⇄ 服务 */
export const SERVICE_CHANNELS = {
  settings: {
    get: 'to-service-SettingsService:get',
    update: 'to-service-SettingsService:update'
  },
  clipboard: {
    getHistory: 'to-service-ClipboardService:getHistory',
    searchHistory: 'to-service-ClipboardService:searchHistory',
    deleteHistory: 'to-service-ClipboardService:deleteHistory',
    clearHistory: 'to-service-ClipboardService:clearHistory',
    getHistoryCount: 'to-service-ClipboardService:getHistoryCount',
    getRetentionState: 'to-service-ClipboardService:getRetentionState',
    setRetentionState: 'to-service-ClipboardService:setRetentionState',
    clickItem: 'to-service-ClipboardService:clickItem',
    getFavorites: 'to-service-ClipboardService:getFavorites',
    getFavoritesByCategory: 'to-service-ClipboardService:getFavoritesByCategory',
    getCategories: 'to-service-ClipboardService:getCategories',
    searchSnippets: 'to-service-ClipboardService:searchSnippets',
    addFavorite: 'to-service-ClipboardService:addFavorite',
    updateFavorite: 'to-service-ClipboardService:updateFavorite',
    deleteFavorite: 'to-service-ClipboardService:deleteFavorite',
    clearFavorites: 'to-service-ClipboardService:clearFavorites',
    writeText: 'to-service-ClipboardService:writeText'
  }
} as const

/** 服务广播（服务 → 所有窗口） */
export const BROADCAST = {
  clipboardNew: 'broadcast:clipboard-new'
} as const

// ---------------------------------------------------------------------------
// preload 对外暴露的 electronAPI 类型（渲染端在 index.d.ts 中引用）
// ---------------------------------------------------------------------------

/** 主窗口会话事件 */
export type MainWindowEvent = 'startHide' | 'reShow'

/** 页面跳转指令负载 */
export interface SetPagePayload {
  page: string
  text?: string
}

/** preload 暴露的完整 API 面 */
export interface ElectronAPI {
  platform: string
  window: {
    minimize: () => void
    hideAfterAnimation: () => void
    toggleMaximize: () => void
    notifyReady: () => void
    onWindowEvent: (event: MainWindowEvent, cb: () => void) => () => void
    onSetPage: (cb: (payload: SetPagePayload) => void) => () => void
    onVersion: (cb: (version: string) => void) => () => void
    onMaximizeState: (cb: (maximized: boolean) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (partial: Partial<AppSettings>) => Promise<void>
  }
  clipboard: {
    getHistory: (limit?: number, offset?: number) => Promise<HistoryItem[]>
    searchHistory: (keyword: string) => Promise<HistoryItem[]>
    deleteHistory: (id: number) => Promise<void>
    clearHistory: () => Promise<void>
    getHistoryCount: () => Promise<number>
    getRetentionState: () => Promise<ClipboardRetention>
    setRetentionState: (partial: Partial<ClipboardRetention>) => Promise<void>
    clickItem: (content: string) => Promise<void>
    getFavorites: () => Promise<FavoriteItem[]>
    getFavoritesByCategory: (category: string) => Promise<FavoriteItem[]>
    getCategories: () => Promise<CategoryItem[]>
    searchSnippets: (keyword: string) => Promise<FavoriteItem[]>
    addFavorite: (content: string, category?: string, description?: string) => Promise<number>
    updateFavorite: (
      id: number,
      content: string,
      category: string,
      description: string
    ) => Promise<void>
    deleteFavorite: (id: number) => Promise<void>
    clearFavorites: () => Promise<void>
    writeText: (text: string) => Promise<void>
    onNewItem: (cb: (item: HistoryItem) => void) => () => void
  }
}
