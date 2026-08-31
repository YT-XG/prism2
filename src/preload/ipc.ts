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
  /** 便利贴内容：富文本 HTML（卡片经 v-html 渲染） */
  content: string
  color: StickyNoteColor
  /** true = 贴到主页（与旧「置顶」合并）；贴主页的便签以可拖拽卡片浮在主页画布 */
  pinned: boolean
  /** 主页画布内位置（px，相对画布内容区左上角）；未定位过为 null */
  home_x: number | null
  home_y: number | null
  /** 主页画布内尺寸（px）；未调整过为 null（默认 200×104） */
  home_w: number | null
  home_h: number | null
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
  /** 是否已完成旧版（v1）数据导入（true=已导入或用户选择暂不导入，不再提示） */
  legacyImportDone?: boolean
  /** 是否已处理旧版安装卸载提示（true=用户选择「不再提醒」，启动不再弹窗） */
  legacyUninstallPromptDone?: boolean
}

/** 应用更新状态（electron-updater 事件驱动） */
export type UpdateStatus =
  | 'idle' // 尚未检查
  | 'checking' // 正在检查更新
  | 'up-to-date' // 已是最新
  | 'available' // 发现新版本（自动开始下载）
  | 'downloading' // 正在下载
  | 'downloaded' // 已下载，可安装
  | 'error' // 检查/下载出错

/** 更新状态载荷（广播 + getStatus 返回） */
export interface UpdateStatusInfo {
  status: UpdateStatus
  /** 当前应用版本 */
  currentVersion: string
  /** 目标版本（available/downloading/downloaded 时有值） */
  version?: string
  /** 发布说明（downloaded 时有值） */
  releaseNotes?: string
  /** 发布日期 */
  releaseDate?: string
  /** 下载进度 0-100（downloading 时有值） */
  progress?: number
  /** 错误信息（error 时有值） */
  error?: string
  /** 补充说明（如开发模式提示） */
  message?: string
}

/** 旧版（v1）数据导入状态 */
export interface LegacyImportState {
  /** v1 剪贴板数据库是否存在 */
  legacyDbExists: boolean
  /** 是否已完成（导入过或用户选择暂不） */
  done: boolean
  /** v1 数据库路径（不存在时为 undefined） */
  legacyDbPath?: string
  /** 历史/收藏数量预览（只读 v1 库得到） */
  historyCount?: number
  favoriteCount?: number
}

/** 旧版数据导入结果 */
export interface LegacyImportResult {
  ok: boolean
  importedHistory: number
  importedFavorites: number
  skippedHistory: number
  skippedFavorites: number
  error?: string
}

/** 旧版（v1）安装检测结果 */
export interface LegacyInstallInfo {
  /** 是否检测到旧版安装 */
  detected: boolean
  /** v1 版本号（如 '1.5.0'） */
  version?: string
  /** 显示名（如 'Prism'） */
  displayName?: string
  /** 安装位置（win=UninstallString 所在目录 / mac=.app 路径） */
  installPath?: string
  /** 平台：win | mac */
  platform: 'win' | 'mac'
  /** 旧版是否正在运行（仅 win 检测） */
  running?: boolean
}

/** 旧版数据目录内的一个条目（文件或子目录） */
export interface LegacyDataEntry {
  name: string
  path: string
  /** 字节数（目录为递归合计） */
  size: number
  /** 已知数据文件标记，用于 UI 打标签 */
  kind: 'db' | 'config' | 'cache' | 'other'
}

/** 一个旧版数据目录 */
export interface LegacyDataDir {
  dirName: string
  path: string
  totalSize: number
  entries: LegacyDataEntry[]
}

/** 旧版本整体状态（安装 + 数据目录） */
export interface LegacyCleanupState {
  install: LegacyInstallInfo
  dataDirs: LegacyDataDir[]
}

/** 卸载 / 删除数据 的操作结果 */
export interface LegacyCleanupResult {
  ok: boolean
  /** win：卸载器已启动 */
  launched?: boolean
  /** mac 卸载或删数据：已移入回收站的路径 */
  trashed?: string[]
  /** 卸载时额外清理的 v1 运行期系统残留（开机自启项/右键菜单等），供 UI 提示 */
  residue?: string[]
  error?: string
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
    togglePin: 'to-service-StickyNotesService:togglePin',
    setNotePosition: 'to-service-StickyNotesService:setNotePosition',
    setNoteSize: 'to-service-StickyNotesService:setNoteSize'
  },
  update: {
    getStatus: 'to-service-UpdateService:getStatus',
    check: 'to-service-UpdateService:check',
    quitAndInstall: 'to-service-UpdateService:quitAndInstall'
  },
  legacyImport: {
    getState: 'to-service-LegacyImportService:getState',
    import: 'to-service-LegacyImportService:import',
    dismiss: 'to-service-LegacyImportService:dismiss'
  },
  legacyCleanup: {
    getState: 'to-service-LegacyCleanupService:getState',
    uninstall: 'to-service-LegacyCleanupService:uninstall',
    deleteData: 'to-service-LegacyCleanupService:deleteData'
  }
} as const

/** 备份文件扩展名（zip 格式 + 自定义扩展名，导入时按此过滤） */
export const BACKUP_EXTENSION = '.prismbackup'

/** 服务广播（服务 → 所有窗口） */
export const BROADCAST = {
  clipboardNew: 'broadcast:clipboard-new',
  clipboardHistoryChanged: 'broadcast:clipboard-history-changed',
  updateStatus: 'broadcast:update-status'
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
    /** 新增便利贴；pinned=true 表示创建后即贴主页（默认 false） */
    addNote: (content: string, color: StickyNoteColor, pinned?: boolean) => Promise<number>
    updateNote: (id: number, content: string, color: StickyNoteColor) => Promise<void>
    deleteNote: (id: number) => Promise<void>
    togglePin: (id: number) => Promise<void>
    /** 记录便利贴在主页画布上的位置（px） */
    setNotePosition: (id: number, x: number, y: number) => Promise<void>
    /** 记录便利贴在主页画布上的尺寸（px） */
    setNoteSize: (id: number, w: number, h: number) => Promise<void>
  }
  update: {
    /** 获取当前更新状态 */
    getStatus: () => Promise<UpdateStatusInfo>
    /** 检查更新（发现新版本后自动开始下载） */
    check: () => Promise<UpdateStatusInfo>
    /** 安装已下载的更新并重启 */
    quitAndInstall: () => Promise<void>
    /** 订阅更新状态变化（返回取消函数） */
    onStatus: (cb: (info: UpdateStatusInfo) => void) => () => void
  }
  legacyImport: {
    /** 获取旧版数据导入状态（是否检测到 v1 数据库、是否已完成） */
    getState: () => Promise<LegacyImportState>
    /** 执行旧版数据导入（合并到当前剪贴板库） */
    import: () => Promise<LegacyImportResult>
    /** 用户选择暂不导入（标记 done，不再提示） */
    dismiss: () => Promise<void>
  }
  legacyCleanup: {
    /** 获取旧版本整体状态（是否安装 + 旧版数据目录清单） */
    getState: () => Promise<LegacyCleanupState>
    /** 卸载旧版本（win 静默卸载器 / mac 移入废纸篓） */
    uninstall: () => Promise<LegacyCleanupResult>
    /** 将选中的旧版数据条目移入回收站（仅限旧版数据目录内的路径） */
    deleteData: (paths: string[]) => Promise<LegacyCleanupResult>
  }
}
