/**
 * Preload —— 通过 contextBridge 暴露类型化 API 给渲染进程。
 *
 * v2 改进：渲染进程不再直接使用原始通道字符串，而是调用此处暴露的
 * 方法（如 electronAPI.clipboard.getHistory()），通道名与数据模型全部来自 ./ipc。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { BROADCAST, SERVICE_CHANNELS, WINDOW_CHANNELS } from './ipc'
import type {
  AppSettings,
  BackupExportResult,
  BackupImportMode,
  BackupImportResult,
  BackupInspectResult,
  BackupSection,
  ClipboardRetention,
  DownloadTaskSnapshot,
  ElectronAPI,
  FavoritesCursor,
  FavoriteItem,
  HistoryItem,
  LegacyCleanupResult,
  LegacyCleanupState,
  LegacyImportResult,
  LegacyImportState,
  LogOpenResult,
  MailAccount,
  MailAccountInput,
  MailAuthTestResult,
  MailboxInfo,
  MailDownloadResult,
  MailMessageDetail,
  MailMessageSummary,
  MailOpResult,
  MailSyncResult,
  MailSyncingInfo,
  MainWindowEvent,
  NotificationItem,
  NotificationNewPayload,
  QuickFolder,
  SetPagePayload,
  StartDownloadPayload,
  StartDownloadResult,
  StickyNote,
  StickyNoteColor,
  UpdateStatusInfo
} from './ipc'

const { mainPage, baseFrame, notificationPopup, searchFrame } = WINDOW_CHANNELS
const C = SERVICE_CHANNELS.clipboard
const S = SERVICE_CHANNELS.settings
const N = SERVICE_CHANNELS.stickyNotes
const QF = SERVICE_CHANNELS.quickFolders
const U = SERVICE_CHANNELS.update
const D = SERVICE_CHANNELS.download
const L = SERVICE_CHANNELS.legacyImport
const LC = SERVICE_CHANNELS.legacyCleanup
const NT = SERVICE_CHANNELS.notification
const LG = SERVICE_CHANNELS.log
const M = SERVICE_CHANNELS.mail

/** 供 vm 上下文判定的渲染进程受控 flag（可选） */
function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const handler = (_event: unknown, ...args: unknown[]): void => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const electronAPI: ElectronAPI = {
  platform: process.platform,

  /** 拖放文件取真实磁盘路径（webUtils 需在 preload 内调用） */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  window: {
    minimize: () => ipcRenderer.send(mainPage.toMain.minimize),
    hideAfterAnimation: () => ipcRenderer.send(mainPage.toMain.hideAfterAnimation),
    toggleMaximize: () => ipcRenderer.send(mainPage.toMain.toggleMaximize),
    notifyReady: () => ipcRenderer.send(mainPage.toMain.ready),
    hide: () => ipcRenderer.send(baseFrame.toMain.closeWindow),

    onWindowEvent: (event: MainWindowEvent, cb: () => void) => {
      const channel =
        event === 'startHide' ? mainPage.toRenderer.startHide : mainPage.toRenderer.reShow
      return subscribe(channel, () => cb())
    },

    onSetPage: (cb: (payload: SetPagePayload) => void) => subscribe(mainPage.toRenderer.setPage, (p) =>
      cb(p as SetPagePayload)
    ),

    onVersion: (cb: (version: string) => void) => subscribe(mainPage.toRenderer.version, (v) =>
      cb(v as string)
    ),

    onMaximizeState: (cb: (maximized: boolean) => void) =>
      subscribe(mainPage.toRenderer.maximizeState, (m) => cb(Boolean(m))),

    showPage: (page: string) => ipcRenderer.send(mainPage.toMain.showPage, page),

    notificationPopupResize: (height: number) =>
      ipcRenderer.send(notificationPopup.toMain.resize, height),

    notificationPopupHide: () => ipcRenderer.send(notificationPopup.toMain.hide),

    searchClose: () => ipcRenderer.send(searchFrame.toMain.close),

    searchOpenFeature: (page: string) => ipcRenderer.send(searchFrame.toMain.openFeature, page),

    onSearchShow: (cb: () => void) => subscribe(searchFrame.toRenderer.show, cb)
  },

  settings: {
    get: () => ipcRenderer.invoke(S.get) as Promise<AppSettings>,
    update: (partial: Partial<AppSettings>) => ipcRenderer.invoke(S.update, partial) as Promise<void>,
    suspendShortcuts: () => ipcRenderer.invoke(S.suspendShortcuts) as Promise<void>,
    resumeShortcuts: () => ipcRenderer.invoke(S.resumeShortcuts) as Promise<void>,
    openAccessibilitySettings: () =>
      ipcRenderer.invoke(S.openAccessibilitySettings) as Promise<{ ok: boolean; error?: string }>
  },

  clipboard: {
    getHistory: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(C.getHistory, limit, offset) as Promise<HistoryItem[]>,
    searchHistory: (keyword: string) => ipcRenderer.invoke(C.searchHistory, keyword) as Promise<HistoryItem[]>,
    deleteHistory: (id: number) => ipcRenderer.invoke(C.deleteHistory, id) as Promise<void>,
    deleteHistoryBatch: (ids: number[]) =>
      ipcRenderer.invoke(C.deleteHistoryBatch, ids) as Promise<void>,
    clearHistory: () => ipcRenderer.invoke(C.clearHistory) as Promise<void>,
    updateHistoryContent: (id: number, content: string) =>
      ipcRenderer.invoke(C.updateHistory, id, content) as Promise<boolean>,
    getHistoryCount: () => ipcRenderer.invoke(C.getHistoryCount) as Promise<number>,
    getRetentionState: () => ipcRenderer.invoke(C.getRetentionState) as Promise<ClipboardRetention>,
    setRetentionState: (partial: Partial<ClipboardRetention>) =>
      ipcRenderer.invoke(C.setRetentionState, partial) as Promise<void>,
    clickItem: (payload: { content: string; type: 'text' | 'image' | 'richtext' }) =>
      ipcRenderer.invoke(C.clickItem, payload) as Promise<void>,
    getFavorites: (limit?: number, before?: FavoritesCursor, category?: string) =>
      ipcRenderer.invoke(C.getFavorites, limit, before, category) as Promise<FavoriteItem[]>,
    getFavoritesCount: () => ipcRenderer.invoke(C.getFavoritesCount) as Promise<number>,
    getFavoritesByCategory: (category: string) =>
      ipcRenderer.invoke(C.getFavoritesByCategory, category),
    getCategories: () => ipcRenderer.invoke(C.getCategories),
    searchSnippets: (keyword: string) => ipcRenderer.invoke(C.searchSnippets, keyword),
    addFavorite: (
      content: string,
      category?: string,
      description?: string,
      type?: 'text' | 'richtext'
    ) => ipcRenderer.invoke(C.addFavorite, content, category, description, type) as Promise<number>,
    updateFavorite: (
      id: number,
      content: string,
      category: string,
      description: string,
      type?: 'text' | 'richtext'
    ) =>
      ipcRenderer.invoke(C.updateFavorite, id, content, category, description, type) as Promise<void>,
    deleteFavorite: (id: number) => ipcRenderer.invoke(C.deleteFavorite, id) as Promise<void>,
    clearFavorites: () => ipcRenderer.invoke(C.clearFavorites) as Promise<void>,
    writeText: (text: string) => ipcRenderer.invoke(C.writeText, text) as Promise<void>,
    exportBackup: (sections: BackupSection[]) =>
      ipcRenderer.invoke(C.exportBackup, sections) as Promise<BackupExportResult>,
    inspectBackup: () => ipcRenderer.invoke(C.inspectBackup) as Promise<BackupInspectResult>,
    importBackup: (path: string, sections: BackupSection[], mode: BackupImportMode) =>
      ipcRenderer.invoke(C.importBackup, path, sections, mode) as Promise<BackupImportResult>,
    onNewItem: (cb: (item: HistoryItem) => void) => subscribe(BROADCAST.clipboardNew, (item) => cb(item as HistoryItem)),
    onHistoryChanged: (cb: () => void) => subscribe(BROADCAST.clipboardHistoryChanged, cb),
  },

  stickyNotes: {
    getNotes: () => ipcRenderer.invoke(N.getNotes) as Promise<StickyNote[]>,
    addNote: (content: string, color: StickyNoteColor, pinned?: boolean) =>
      ipcRenderer.invoke(N.addNote, content, color, pinned) as Promise<number>,
    updateNote: (id: number, content: string, color: StickyNoteColor) =>
      ipcRenderer.invoke(N.updateNote, id, content, color) as Promise<void>,
    deleteNote: (id: number) => ipcRenderer.invoke(N.deleteNote, id) as Promise<void>,
    togglePin: (id: number) => ipcRenderer.invoke(N.togglePin, id) as Promise<void>,
    setNotePosition: (id: number, x: number, y: number) =>
      ipcRenderer.invoke(N.setNotePosition, id, x, y) as Promise<void>,
    setNoteSize: (id: number, w: number, h: number) =>
      ipcRenderer.invoke(N.setNoteSize, id, w, h) as Promise<void>,
  },

  quickFolders: {
    getFolders: () => ipcRenderer.invoke(QF.getFolders) as Promise<QuickFolder[]>,
    addFolders: () => ipcRenderer.invoke(QF.addFolders) as Promise<QuickFolder[]>,
    addFoldersByPaths: (paths: string[]) =>
      ipcRenderer.invoke(QF.addFoldersByPaths, paths) as Promise<QuickFolder[]>,
    deleteFolder: (id: number) => ipcRenderer.invoke(QF.deleteFolder, id) as Promise<void>,
    reorder: (orderedIds: number[]) =>
      ipcRenderer.invoke(QF.reorder, orderedIds) as Promise<void>,
    setAlias: (id: number, alias: string | null) =>
      ipcRenderer.invoke(QF.setAlias, id, alias) as Promise<void>,
    setPosition: (id: number, x: number, y: number) =>
      ipcRenderer.invoke(QF.setPosition, id, x, y) as Promise<void>,
    setSize: (id: number, w: number, h: number) =>
      ipcRenderer.invoke(QF.setSize, id, w, h) as Promise<void>,
    openFolder: (path: string) =>
      ipcRenderer.invoke(QF.openFolder, path) as Promise<{ ok: boolean; error?: string }>,
  },

  update: {
    getStatus: () => ipcRenderer.invoke(U.getStatus) as Promise<UpdateStatusInfo>,
    check: () => ipcRenderer.invoke(U.check) as Promise<UpdateStatusInfo>,
    quitAndInstall: () => ipcRenderer.invoke(U.quitAndInstall) as Promise<void>,
    onStatus: (cb: (info: UpdateStatusInfo) => void) =>
      subscribe(BROADCAST.updateStatus, (info) => cb(info as UpdateStatusInfo))
  },

  download: {
    start: (payload: StartDownloadPayload) =>
      ipcRenderer.invoke(D.start, payload) as Promise<StartDownloadResult>,
    pause: (taskId: string) => ipcRenderer.invoke(D.pause, taskId) as Promise<boolean>,
    resume: (taskId: string) =>
      ipcRenderer.invoke(D.resume, taskId) as Promise<StartDownloadResult>,
    cancel: (taskId: string) => ipcRenderer.invoke(D.cancel, taskId) as Promise<boolean>,
    remove: (taskId: string) => ipcRenderer.invoke(D.remove, taskId) as Promise<boolean>,
    list: () => ipcRenderer.invoke(D.list) as Promise<DownloadTaskSnapshot[]>,
    pickSavePath: (suggestedName?: string) =>
      ipcRenderer.invoke(D.pickSavePath, suggestedName) as Promise<string | null>,
    getDefaultDir: () => ipcRenderer.invoke(D.getDefaultDir) as Promise<string>,
    openFolder: (path: string) => ipcRenderer.invoke(D.openFolder, path) as Promise<void>,
    onTaskUpdated: (cb: (task: DownloadTaskSnapshot) => void) =>
      subscribe(BROADCAST.downloadTaskUpdated, (task) => cb(task as DownloadTaskSnapshot))
  },

  legacyImport: {
    getState: () => ipcRenderer.invoke(L.getState) as Promise<LegacyImportState>,
    import: () => ipcRenderer.invoke(L.import) as Promise<LegacyImportResult>,
    dismiss: () => ipcRenderer.invoke(L.dismiss) as Promise<void>
  },

  legacyCleanup: {
    getState: () => ipcRenderer.invoke(LC.getState) as Promise<LegacyCleanupState>,
    uninstall: () => ipcRenderer.invoke(LC.uninstall) as Promise<LegacyCleanupResult>,
    deleteData: (paths: string[]) =>
      ipcRenderer.invoke(LC.deleteData, paths) as Promise<LegacyCleanupResult>
  },

  notification: {
    getList: () => ipcRenderer.invoke(NT.getList) as Promise<NotificationItem[]>,
    getUnread: () => ipcRenderer.invoke(NT.getUnread) as Promise<number>,
    markRead: (id: number) => ipcRenderer.invoke(NT.markRead, id) as Promise<void>,
    markAllRead: () => ipcRenderer.invoke(NT.markAllRead) as Promise<void>,
    clear: () => ipcRenderer.invoke(NT.clear) as Promise<void>,
    onNew: (cb: (payload: NotificationNewPayload) => void) =>
      subscribe(BROADCAST.notificationNew, (p) => cb(p as NotificationNewPayload))
  },

  log: {
    getPath: () => ipcRenderer.invoke(LG.getPath) as Promise<string>,
    openFile: () => ipcRenderer.invoke(LG.openFile) as Promise<LogOpenResult>,
    openDirectory: () => ipcRenderer.invoke(LG.openDirectory) as Promise<LogOpenResult>
  },

  mail: {
    getAccounts: () => ipcRenderer.invoke(M.getAccounts) as Promise<MailAccount[]>,
    addAccount: (input: MailAccountInput) =>
      ipcRenderer.invoke(M.addAccount, input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    testConnection: (input: MailAccountInput) =>
      ipcRenderer.invoke(M.testConnection, input) as Promise<MailAuthTestResult>,
    updateAccount: (input: MailAccountInput) =>
      ipcRenderer.invoke(M.updateAccount, input) as Promise<MailOpResult>,
    removeAccount: (accountId: number) =>
      ipcRenderer.invoke(M.removeAccount, accountId) as Promise<MailOpResult>,
    getMailboxes: (accountId: number) =>
      ipcRenderer.invoke(M.getMailboxes, accountId) as Promise<MailboxInfo[]>,
    getMessages: (mailboxId: number, offset?: number, limit?: number) =>
      ipcRenderer.invoke(M.getMessages, mailboxId, offset, limit) as Promise<MailMessageSummary[]>,
    getMessageDetail: (messageId: number) =>
      ipcRenderer.invoke(M.getMessageDetail, messageId) as Promise<MailMessageDetail | null>,
    markSeen: (messageId: number, seen: boolean) =>
      ipcRenderer.invoke(M.markSeen, messageId, seen) as Promise<void>,
    syncNow: (accountId?: number) =>
      ipcRenderer.invoke(M.syncNow, accountId) as Promise<MailSyncResult | MailSyncResult[]>,
    getSyncing: () => ipcRenderer.invoke(M.getSyncing) as Promise<MailSyncingInfo[]>,
    getUnreadTotal: () => ipcRenderer.invoke(M.getUnreadTotal) as Promise<number>,
    downloadAttachment: (attachmentId: number) =>
      ipcRenderer.invoke(M.downloadAttachment, attachmentId) as Promise<MailDownloadResult>,
    openAttachment: (attachmentId: number) =>
      ipcRenderer.invoke(M.openAttachment, attachmentId) as Promise<MailOpResult>,
    onMailSync: (cb: (result: MailSyncResult) => void) =>
      subscribe(BROADCAST.mailSync, (result) => cb(result as MailSyncResult)),
    onMailUnreadChanged: (cb: (total: number) => void) =>
      subscribe(BROADCAST.mailUnreadChanged, (total) => cb(Number(total))),
    onMailSyncingChanged: (cb: (list: MailSyncingInfo[]) => void) =>
      subscribe(BROADCAST.mailSyncingChanged, (list) => cb(list as MailSyncingInfo[]))
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
