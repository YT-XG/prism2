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

/** 剪贴板记录类型：文本 / 图片（图片的 content 为文件名） */
export type HistoryItemType = 'text' | 'image'

/** 剪贴板历史记录项 */
export interface HistoryItem {
  id: number
  content: string
  created_at: number
  type: HistoryItemType
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

/** 便利贴颜色（对应粉彩强调 token） */
export type StickyNoteColor = 'lavender' | 'mint' | 'yellow' | 'blue' | 'violet'

/** 便利贴 */
export interface StickyNote {
  id: number
  content: string
  color: StickyNoteColor
  pinned: boolean
  created_at: number
  updated_at: number
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

/**
 * 备份导入合并方式：
 * - merge：按主键 INSERT OR IGNORE，保留双方记录（已存在的 id 跳过，不覆盖对方数据）；
 * - replace：清空本地历史/收藏/图片后，完全替换为备份内容。
 */
export type BackupImportMode = 'merge' | 'replace'

/** 导出备份结果 */
export interface BackupExportResult {
  ok: boolean
  /** 用户取消（未选择保存位置） */
  canceled: boolean
  /** 保存路径（canceled 时为 undefined） */
  path?: string
  /** 失败原因（ok=false 时） */
  error?: string
  historyCount?: number
  favoriteCount?: number
  imageCount?: number
}

/** 导入备份结果 */
export interface BackupImportResult {
  ok: boolean
  /** 用户取消（未选择文件） */
  canceled: boolean
  /** 失败原因（ok=false 时） */
  error?: string
  importedHistory?: number
  importedFavorites?: number
  importedImages?: number
  skippedHistory?: number
  skippedFavorites?: number
  skippedImages?: number
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
  /** BaseFrame 基础通道（所有窗口共用） */
  baseFrame: {
    toMain: {
      closeWindow: 'to-main-BaseFrame:closeWindow'
    }
  },
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
    deleteHistoryBatch: 'to-service-ClipboardService:deleteHistoryBatch',
    clearHistory: 'to-service-ClipboardService:clearHistory',
    getHistoryCount: 'to-service-ClipboardService:getHistoryCount',
    getRetentionState: 'to-service-ClipboardService:getRetentionState',
    setRetentionState: 'to-service-ClipboardService:setRetentionState',
    clickItem: 'to-service-ClipboardService:clickItem',
    getImageData: 'to-service-ClipboardService:getImageData',
    getFavorites: 'to-service-ClipboardService:getFavorites',
    getFavoritesByCategory: 'to-service-ClipboardService:getFavoritesByCategory',
    getCategories: 'to-service-ClipboardService:getCategories',
    searchSnippets: 'to-service-ClipboardService:searchSnippets',
    addFavorite: 'to-service-ClipboardService:addFavorite',
    updateFavorite: 'to-service-ClipboardService:updateFavorite',
    deleteFavorite: 'to-service-ClipboardService:deleteFavorite',
    clearFavorites: 'to-service-ClipboardService:clearFavorites',
    writeText: 'to-service-ClipboardService:writeText',
    exportBackup: 'to-service-ClipboardService:exportBackup',
    importBackup: 'to-service-ClipboardService:importBackup'
  },
  stickyNotes: {
    getNotes: 'to-service-StickyNotesService:getNotes',
    addNote: 'to-service-StickyNotesService:addNote',
    updateNote: 'to-service-StickyNotesService:updateNote',
    deleteNote: 'to-service-StickyNotesService:deleteNote',
    togglePin: 'to-service-StickyNotesService:togglePin'
  }
} as const

/** 备份文件扩展名（zip 格式 + 自定义扩展名，导入时按此过滤） */
export const BACKUP_EXTENSION = '.prismbackup'

/** 服务广播（服务 → 所有窗口） */
export const BROADCAST = {
  clipboardNew: 'broadcast:clipboard-new',
  clipboardHistoryChanged: 'broadcast:clipboard-history-changed'
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
    /** 隐藏当前窗口（经 BaseFrame 基础通道，任意窗口可用） */
    hide: () => void
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
    /** 批量删除历史记录（ids 为非法集合时静默忽略非法项） */
    deleteHistoryBatch: (ids: number[]) => Promise<void>
    clearHistory: () => Promise<void>
    getHistoryCount: () => Promise<number>
    getRetentionState: () => Promise<ClipboardRetention>
    setRetentionState: (partial: Partial<ClipboardRetention>) => Promise<void>
    /** 点击历史项：写剪贴板 → 隐藏窗口 → 恢复焦点 → 模拟粘贴 */
    clickItem: (payload: { content: string; type: HistoryItemType }) => Promise<void>
    /** 读取图片记录为 data URL（仅 type='image'，返回空串表示不可用） */
    getImageData: (filename: string) => Promise<string>
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
    /** 导出剪贴板记录备份（弹保存对话框；zip 格式，扩展名 .prismbackup） */
    exportBackup: () => Promise<BackupExportResult>
    /** 导入剪贴板记录备份（弹打开对话框；mode 指定合并/替换） */
    importBackup: (mode: BackupImportMode) => Promise<BackupImportResult>
    onNewItem: (cb: (item: HistoryItem) => void) => () => void
    /** 历史变更（新增/删除/清空/导入）通知，用于侧栏计数等 UI 刷新 */
    onHistoryChanged: (cb: () => void) => () => void
  }
  stickyNotes: {
    getNotes: () => Promise<StickyNote[]>
    addNote: (content: string, color: StickyNoteColor) => Promise<number>
    updateNote: (id: number, content: string, color: StickyNoteColor) => Promise<void>
    deleteNote: (id: number) => Promise<void>
    togglePin: (id: number) => Promise<void>
  }
}
