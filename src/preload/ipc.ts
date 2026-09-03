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

/** 剪贴板记录类型：文本 / 图片 / 富文本（richtext 的 content 为 HTML；图片的 content 为文件名） */
export type HistoryItemType = 'text' | 'image' | 'richtext'

/** 剪贴板历史记录项 */
export interface HistoryItem {
  id: number
  content: string
  created_at: number
  type: HistoryItemType
}

/** 片段内容类型：文本 / 富文本（richtext 的 content 为 HTML） */
export type FavoriteItemType = 'text' | 'richtext'

/** 收藏片段项 */
export interface FavoriteItem {
  id: number
  content: string
  category: string
  description: string
  created_at: number
  /** 内容类型：text 纯文本 / richtext 富文本 HTML */
  type: FavoriteItemType
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

/** 快捷文件夹（主页快捷打开的可拖拽卡片） */
export interface QuickFolder {
  id: number
  /** 文件夹绝对路径 */
  path: string
  /** 显示名（路径 basename，作为默认展示名） */
  name: string
  /** 自定义别名（可选）：设置了则列表/搜索展示别名，未设置回退到 name */
  alias: string | null
  /** 路径当前是否失效（读取时实时校验：文件夹被移动/删除后为 true） */
  missing: boolean
  /** 主页画布内位置（px，相对画布内容区左上角）；未定位过为 null */
  home_x: number | null
  home_y: number | null
  /** 主页画布内尺寸（px）；未调整过为 null */
  home_w: number | null
  home_h: number | null
  created_at: number
}

/** 在系统资源管理器中打开文件夹的结果 */
export interface QuickFolderOpenResult {
  ok: boolean
  /** 失败原因（ok=false 时） */
  error?: string
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

/** 备份可选数据分区（导出/导入时用户勾选的数据类别） */
export type BackupSection = 'clipboard' | 'stickyNotes' | 'quickFolders'

/** 全部备份分区（导出勾选默认值；导入按备份内实际包含的分区子集） */
export const BACKUP_SECTIONS: readonly BackupSection[] = [
  'clipboard',
  'stickyNotes',
  'quickFolders'
]

/** 导出备份结果 */
export interface BackupExportResult {
  ok: boolean
  /** 用户取消（未选择保存位置） */
  canceled: boolean
  /** 保存路径（canceled 时为 undefined） */
  path?: string
  /** 失败原因（ok=false 时） */
  error?: string
  /** 实际写入备份的分区（用户勾选） */
  sections?: BackupSection[]
  historyCount?: number
  favoriteCount?: number
  imageCount?: number
  stickyNoteCount?: number
  quickFolderCount?: number
}

/** 导入前检查备份文件的结果（弹打开对话框后返回可用分区与文件路径） */
export interface BackupInspectResult {
  ok: boolean
  /** 用户取消（未选择文件） */
  canceled: boolean
  /** 失败原因（ok=false 时） */
  error?: string
  /** 备份文件路径（用户确认勾选后回传 importBackup 使用） */
  path?: string
  /** 备份内实际可用的数据分区（仅含文件里存在的类别，兼容旧版备份只含 clipboard） */
  sections?: BackupSection[]
}

/** 导入备份结果 */
export interface BackupImportResult {
  ok: boolean
  /** 用户取消（导入阶段无对话框，恒为 false，保留字段供类型统一） */
  canceled: boolean
  /** 失败原因（ok=false 时） */
  error?: string
  importedHistory?: number
  importedFavorites?: number
  importedImages?: number
  importedStickyNotes?: number
  importedQuickFolders?: number
  skippedHistory?: number
  skippedFavorites?: number
  skippedImages?: number
  skippedStickyNotes?: number
  skippedQuickFolders?: number
}

/** 应用设置 */
export interface AppSettings {
  /** 主页面显隐快捷键，如 'CommandOrControl+Alt+V' */
  shortcut: string
  /** 片段选择器快捷键 */
  snippetShortcut: string
  /** 全局搜索快捷键，如 'CommandOrControl+K'（设置页可自定义） */
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
  /** 通知中心总开关（false = 不记录、不提醒任何通知） */
  notificationsEnabled: boolean
  /** 剪贴板新内容通知 */
  notifyClipboard: boolean
  /** 更新通知（新版本/更新完成/检查失败） */
  notifyUpdate: boolean
}

/** 通知类型：对应语义状态色 token */
export type NotificationType = 'info' | 'success' | 'warning' | 'error'

/** 通知来源：用于通知中心分组过滤 + 分来源开关 */
export type NotificationSource = 'clipboard' | 'update'

/** 通知记录（持久化到 userData/notifications.db） */
export interface NotificationItem {
  id: number
  type: NotificationType
  source: NotificationSource
  title: string
  message: string
  created_at: number
  /** 0 未读 / 1 已读 */
  read: 0 | 1
}

/** onNew 广播载荷：新通知 + 最新未读数（渲染端据此刷新角标/列表） */
export interface NotificationNewPayload {
  item: NotificationItem
  unread: number
}

/** 应用更新状态（mac 走自定义源 + 下载引擎；win 走 NSIS 静默） */
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

/** 自定义更新清单（latest.json）的一个平台二进制项 */
export interface UpdateManifestBinary {
  platform: 'mac' | 'win'
  arch: string
  /** 安装包下载地址（绝对 URL） */
  url: string
  /** SHA-256 校验值（下载后校验，防篡改/防断包） */
  sha256: string
  /** 字节数（可选，供 UI 展示大小） */
  size?: number
}

/**
 * 应用更新清单（自定义源，Gitee 锚点 / GitHub 双回退）。
 * 客户端解析顺序：redirect(跟随新清单) → binaries 取当前平台+架构 → 下载按 url → mirrors 后缀拼接。
 */
export interface UpdateManifest {
  version: string
  /** 发布说明（可选） */
  notes?: string
  /** 未来整站迁移：指向新 manifest 完整 URL；非空且非自指则跟随（深度≤2） */
  redirect?: string | null
  /** 二进制备用下载源 base URL 列表（与 url 的 asset 路径后缀拼接） */
  mirrors?: string[]
  binaries: UpdateManifestBinary[]
}

/** 下载任务状态 */
export type DownloadTaskStatus = 'downloading' | 'paused' | 'completed' | 'failed' | 'canceled'

/** 下载任务快照（渲染端 + 引擎共享，主进程单一来源） */
export interface DownloadTaskSnapshot {
  id: string
  url: string
  savePath: string
  fileName: string
  /** 文件总大小（字节） */
  totalBytes: number
  /** 已下载字节数 */
  downloadedBytes: number
  /** 下载进度 0-1 */
  progress: number
  /** 下载速度（字节/秒） */
  speedBytesPerSecond: number
  /** 预计完成时间戳 */
  estimatedFinishAt: number | null
  /** 下载线程数 */
  threads: number
  status: DownloadTaskStatus
  /** 错误信息（failed 时有值） */
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

/** 开始下载 IPC 载荷（渲染端新建下载） */
export interface StartDownloadPayload {
  url: string
  /** 保存路径（可选，默认 下载目录/文件名） */
  savePath?: string
  /** 下载线程数（可选，默认 8） */
  threads?: number
}

/** 开始/恢复下载结果 */
export type StartDownloadResult =
  | { ok: true; task: DownloadTaskSnapshot }
  | { ok: false; message: string }

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

/** 打开日志文件结果 */
export interface LogOpenResult {
  ok: boolean
  /** 日志文件完整路径（electron-log 文件传输目标的落盘位置） */
  path: string
  /** 失败原因（ok=false 时） */
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
      /** 显示主窗口并跳转到指定页面（通知浮窗等外部入口用） */
      showPage: 'to-main-MainPage:showPage',
      openTranslate: 'to-main-MainPage:openTranslate'
    },
    toRenderer: {
      startHide: 'to-renderer-MainPage:startHide',
      reShow: 'to-renderer-MainPage:reShow',
      setPage: 'to-renderer-MainPage:setPage',
      version: 'to-renderer-MainPage:version',
      maximizeState: 'to-renderer-MainPage:maximizeState'
    }
  },
  /** 通知浮窗（自绘通知浮窗：置顶、无边框、不抢焦点） */
  notificationPopup: {
    toMain: {
      /** 渲染端上报内容高度，主进程据此缩放浮窗（保持右下角锚定） */
      resize: 'to-main-NotificationPopup:resize',
      /** 通知全部消失后请求隐藏浮窗 */
      hide: 'to-main-NotificationPopup:hide'
    }
  },
  /** 全局搜索独立窗口（Ctrl+K 呼出；无边框、置顶、聚焦输入） */
  searchFrame: {
    toMain: {
      /** 渲染端请求隐藏搜索窗口（Esc / 选中 / 失焦） */
      close: 'to-main-SearchFrame:close',
      /** 渲染端选中功能项：隐藏搜索窗口并让主窗口跳转对应页面 */
      openFeature: 'to-main-SearchFrame:openFeature'
    },
    toRenderer: {
      /** 主进程每次显示搜索窗口后通知渲染端打开面板（Esc/选中隐藏后再唤起） */
      show: 'to-renderer-SearchFrame:show'
    }
  }
} as const

/** 渲染 ⇄ 服务 */
export const SERVICE_CHANNELS = {
  settings: {
    get: 'to-service-SettingsService:get',
    update: 'to-service-SettingsService:update',
    /** 暂停全局快捷键（快捷键录制期间避免误触发） */
    suspendShortcuts: 'to-service-SettingsService:suspendShortcuts',
    /** 恢复全局快捷键（按最新设置重新注册） */
    resumeShortcuts: 'to-service-SettingsService:resumeShortcuts',
    /** 打开 macOS「辅助功能」系统设置面板（模拟粘贴需要该权限；非 mac 平台为 no-op） */
    openAccessibilitySettings: 'to-service-SettingsService:openAccessibilitySettings'
  },
  clipboard: {
    getHistory: 'to-service-ClipboardService:getHistory',
    searchHistory: 'to-service-ClipboardService:searchHistory',
    deleteHistory: 'to-service-ClipboardService:deleteHistory',
    deleteHistoryBatch: 'to-service-ClipboardService:deleteHistoryBatch',
    clearHistory: 'to-service-ClipboardService:clearHistory',
    updateHistory: 'to-service-ClipboardService:updateHistoryContent',
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
    inspectBackup: 'to-service-ClipboardService:inspectBackup',
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
  quickFolders: {
    getFolders: 'to-service-QuickFoldersService:getFolders',
    /** 弹出系统文件夹多选对话框并入库；返回更新后的完整列表 */
    addFolders: 'to-service-QuickFoldersService:addFolders',
    /** 按给定路径批量入库（拖放添加来源，主进程校验存在性/目录类型）；返回更新后的完整列表 */
    addFoldersByPaths: 'to-service-QuickFoldersService:addFoldersByPaths',
    deleteFolder: 'to-service-QuickFoldersService:deleteFolder',
    /** 按给定 id 顺序重排（面板内拖拽排序） */
    reorder: 'to-service-QuickFoldersService:reorder',
    /** 设置自定义别名（null/空串 = 清除别名，回退到文件夹名） */
    setAlias: 'to-service-QuickFoldersService:setAlias',
    setPosition: 'to-service-QuickFoldersService:setPosition',
    setSize: 'to-service-QuickFoldersService:setSize',
    /** 在系统资源管理器中打开文件夹 */
    openFolder: 'to-service-QuickFoldersService:openFolder'
  },
  update: {
    getStatus: 'to-service-UpdateService:getStatus',
    check: 'to-service-UpdateService:check',
    quitAndInstall: 'to-service-UpdateService:quitAndInstall'
  },
  download: {
    start: 'to-service-DownloadService:start',
    pause: 'to-service-DownloadService:pause',
    resume: 'to-service-DownloadService:resume',
    cancel: 'to-service-DownloadService:cancel',
    remove: 'to-service-DownloadService:remove',
    list: 'to-service-DownloadService:list',
    pickSavePath: 'to-service-DownloadService:pickSavePath',
    getDefaultDir: 'to-service-DownloadService:getDefaultDir',
    openFolder: 'to-service-DownloadService:openFolder'
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
  },
  notification: {
    getList: 'to-service-NotificationService:getList',
    getUnread: 'to-service-NotificationService:getUnread',
    markRead: 'to-service-NotificationService:markRead',
    markAllRead: 'to-service-NotificationService:markAllRead',
    clear: 'to-service-NotificationService:clear'
  },
  log: {
    /** 日志文件完整路径 */
    getPath: 'to-service-LogService:getPath',
    /** 用系统默认程序打开日志文件 */
    openFile: 'to-service-LogService:openFile'
  }
} as const

/** 备份文件扩展名（zip 格式 + 自定义扩展名，导入时按此过滤） */
export const BACKUP_EXTENSION = '.prismbackup'

/** 服务广播（服务 → 所有窗口） */
export const BROADCAST = {
  clipboardNew: 'broadcast:clipboard-new',
  clipboardHistoryChanged: 'broadcast:clipboard-history-changed',
  updateStatus: 'broadcast:update-status',
  notificationNew: 'broadcast:notification-new',
  downloadTaskUpdated: 'broadcast:download-task-updated'
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
  /** 拖放/文件场景取真实路径（renderer 内 webUtils，需 preload 暴露） */
  getPathForFile: (file: File) => string
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
    /** 显示主窗口并跳转到指定页面（页面不带前导斜杠，如 'notifications'） */
    showPage: (page: string) => void
    /** 通知浮窗：上报内容高度（主进程据此缩放，保持右下角锚定） */
    notificationPopupResize: (height: number) => void
    /** 通知浮窗：通知全部消失后请求隐藏 */
    notificationPopupHide: () => void
    /** 全局搜索独立窗口：请求隐藏（Esc / 选中 / 失焦） */
    searchClose: () => void
    /** 全局搜索独立窗口：选中功能项，让主窗口跳转对应页面（页面不带前导斜杠，如 'home'） */
    searchOpenFeature: (page: string) => void
    /** 全局搜索独立窗口：主进程每次显示窗口后通知渲染端打开面板（Esc/选中隐藏后再唤起） */
    onSearchShow: (cb: () => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (partial: Partial<AppSettings>) => Promise<void>
    /** 暂停全局快捷键（录制期间调用） */
    suspendShortcuts: () => Promise<void>
    /** 恢复全局快捷键（按最新设置重新注册） */
    resumeShortcuts: () => Promise<void>
    /** 打开 macOS「辅助功能」系统设置面板（模拟粘贴需要该权限；非 mac 平台直接返回 ok） */
    openAccessibilitySettings: () => Promise<{ ok: boolean; error?: string }>
  }
  clipboard: {
    getHistory: (limit?: number, offset?: number) => Promise<HistoryItem[]>
    searchHistory: (keyword: string) => Promise<HistoryItem[]>
    deleteHistory: (id: number) => Promise<void>
    /** 批量删除历史记录（ids 为非法集合时静默忽略非法项） */
    deleteHistoryBatch: (ids: number[]) => Promise<void>
    clearHistory: () => Promise<void>
    /** 修改历史记录内容（改为富文本；图片记录不可编辑返回 false） */
    updateHistoryContent: (id: number, content: string) => Promise<boolean>
    getHistoryCount: () => Promise<number>
    getRetentionState: () => Promise<ClipboardRetention>
    setRetentionState: (partial: Partial<ClipboardRetention>) => Promise<void>
    /** 点击历史项：写剪贴板 → 隐藏窗口 → 恢复焦点 → 模拟粘贴（richtext 写 HTML+纯文本，保留格式） */
    clickItem: (payload: { content: string; type: HistoryItemType }) => Promise<void>
    /** 读取图片记录为 data URL（仅 type='image'，返回空串表示不可用） */
    getImageData: (filename: string) => Promise<string>
    getFavorites: () => Promise<FavoriteItem[]>
    getFavoritesByCategory: (category: string) => Promise<FavoriteItem[]>
    getCategories: () => Promise<CategoryItem[]>
    searchSnippets: (keyword: string) => Promise<FavoriteItem[]>
    addFavorite: (
      content: string,
      category?: string,
      description?: string,
      type?: FavoriteItemType
    ) => Promise<number>
    updateFavorite: (
      id: number,
      content: string,
      category: string,
      description: string,
      type?: FavoriteItemType
    ) => Promise<void>
    deleteFavorite: (id: number) => Promise<void>
    clearFavorites: () => Promise<void>
    writeText: (text: string) => Promise<void>
    /** 导出备份（弹保存对话框；sections 为用户勾选的数据分区；zip 打包，扩展名 .prismbackup） */
    exportBackup: (sections: BackupSection[]) => Promise<BackupExportResult>
    /** 导入备份第一步：弹打开对话框并检查备份内容，返回可用分区与文件路径（供用户勾选后再导入） */
    inspectBackup: () => Promise<BackupInspectResult>
    /** 导入备份第二步：按所选分区导入指定备份文件（mode 指定合并/替换） */
    importBackup: (
      path: string,
      sections: BackupSection[],
      mode: BackupImportMode
    ) => Promise<BackupImportResult>
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
  quickFolders: {
    getFolders: () => Promise<QuickFolder[]>
    /** 弹出系统文件夹多选框并添加；返回更新后的完整列表（取消则原样返回） */
    addFolders: () => Promise<QuickFolder[]>
    /** 按给定路径批量添加（拖放来源，主进程校验存在性与目录类型）；返回更新后的完整列表 */
    addFoldersByPaths: (paths: string[]) => Promise<QuickFolder[]>
    /** 移除快捷文件夹（仅删快捷记录，不影响磁盘上的文件夹） */
    deleteFolder: (id: number) => Promise<void>
    /** 按给定 id 顺序重排（面板内拖拽排序）；id 集合需与当前列表一致 */
    reorder: (orderedIds: number[]) => Promise<void>
    /** 设置自定义别名（null/空串 = 清除别名，回退到文件夹名） */
    setAlias: (id: number, alias: string | null) => Promise<void>
    /** 记录快捷文件夹在主页画布上的位置（px） */
    setPosition: (id: number, x: number, y: number) => Promise<void>
    /** 记录快捷文件夹在主页画布上的尺寸（px） */
    setSize: (id: number, w: number, h: number) => Promise<void>
    /** 在系统资源管理器中打开文件夹 */
    openFolder: (path: string) => Promise<QuickFolderOpenResult>
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
  download: {
    /** 新建下载任务（url 必填，savePath/threads 可选） */
    start: (payload: StartDownloadPayload) => Promise<StartDownloadResult>
    /** 暂停下载任务 */
    pause: (taskId: string) => Promise<boolean>
    /** 恢复已暂停的任务 */
    resume: (taskId: string) => Promise<StartDownloadResult>
    /** 取消下载任务 */
    cancel: (taskId: string) => Promise<boolean>
    /** 移除任务（仅 completed/failed/canceled 可移除） */
    remove: (taskId: string) => Promise<boolean>
    /** 获取全部任务列表（按创建时间倒序） */
    list: () => Promise<DownloadTaskSnapshot[]>
    /** 弹出系统保存对话框，返回用户选择的保存路径（取消返回 null） */
    pickSavePath: (suggestedName?: string) => Promise<string | null>
    /** 获取默认下载目录 */
    getDefaultDir: () => Promise<string>
    /** 在系统默认文件管理器中定位到某文件所在目录 */
    openFolder: (path: string) => Promise<void>
    /** 订阅任务更新（进度/速度/状态变化，返回取消函数） */
    onTaskUpdated: (cb: (task: DownloadTaskSnapshot) => void) => () => void
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
  notification: {
    /** 获取全部通知记录（按时间倒序） */
    getList: () => Promise<NotificationItem[]>
    /** 获取未读数 */
    getUnread: () => Promise<number>
    /** 标记单条已读 */
    markRead: (id: number) => Promise<void>
    /** 全部标记已读 */
    markAllRead: () => Promise<void>
    /** 清空通知记录 */
    clear: () => Promise<void>
    /** 订阅新通知到达（返回取消函数） */
    onNew: (cb: (payload: NotificationNewPayload) => void) => () => void
  }
  log: {
    /** 日志文件完整路径（electron-log 文件传输目标的落盘位置） */
    getPath: () => Promise<string>
    /** 用系统默认程序打开日志文件 */
    openFile: () => Promise<LogOpenResult>
  }
}
