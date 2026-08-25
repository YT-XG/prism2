/**
 * Preload —— 通过 contextBridge 暴露类型化 API 给渲染进程。
 *
 * v2 改进：渲染进程不再直接使用原始通道字符串，而是调用此处暴露的
 * 方法（如 electronAPI.clipboard.getHistory()），通道名与数据模型全部来自 ./ipc。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { BROADCAST, SERVICE_CHANNELS, WINDOW_CHANNELS } from './ipc'
import type { AppSettings, ElectronAPI, HistoryItem, MainWindowEvent, SetPagePayload } from './ipc'

const { mainPage } = WINDOW_CHANNELS
const C = SERVICE_CHANNELS.clipboard
const S = SERVICE_CHANNELS.settings

/** 供 vm 上下文判定的渲染进程受控 flag（可选） */
function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const handler = (_event: unknown, ...args: unknown[]): void => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const electronAPI: ElectronAPI = {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.send(mainPage.toMain.minimize),
    hideAfterAnimation: () => ipcRenderer.send(mainPage.toMain.hideAfterAnimation),
    notifyReady: () => ipcRenderer.send(mainPage.toMain.ready),

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
    )
  },

  settings: {
    get: () => ipcRenderer.invoke(S.get) as Promise<AppSettings>,
    update: (partial: Partial<AppSettings>) => ipcRenderer.invoke(S.update, partial) as Promise<void>
  },

  clipboard: {
    getHistory: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(C.getHistory, limit, offset) as Promise<HistoryItem[]>,
    searchHistory: (keyword: string) => ipcRenderer.invoke(C.searchHistory, keyword) as Promise<HistoryItem[]>,
    deleteHistory: (id: number) => ipcRenderer.invoke(C.deleteHistory, id) as Promise<void>,
    clearHistory: () => ipcRenderer.invoke(C.clearHistory) as Promise<void>,
    getHistoryCount: () => ipcRenderer.invoke(C.getHistoryCount) as Promise<number>,
    getRetentionDays: () => ipcRenderer.invoke(C.getRetentionDays) as Promise<number>,
    setRetentionDays: (days: number) => ipcRenderer.invoke(C.setRetentionDays, days) as Promise<void>,
    clickItem: (content: string) => ipcRenderer.invoke(C.clickItem, content) as Promise<void>,
    getFavorites: () => ipcRenderer.invoke(C.getFavorites),
    getFavoritesByCategory: (category: string) =>
      ipcRenderer.invoke(C.getFavoritesByCategory, category),
    getCategories: () => ipcRenderer.invoke(C.getCategories),
    searchSnippets: (keyword: string) => ipcRenderer.invoke(C.searchSnippets, keyword),
    addFavorite: (content: string, category?: string, description?: string) =>
      ipcRenderer.invoke(C.addFavorite, content, category, description) as Promise<number>,
    updateFavorite: (id: number, content: string, category: string, description: string) =>
      ipcRenderer.invoke(C.updateFavorite, id, content, category, description) as Promise<void>,
    deleteFavorite: (id: number) => ipcRenderer.invoke(C.deleteFavorite, id) as Promise<void>,
    clearFavorites: () => ipcRenderer.invoke(C.clearFavorites) as Promise<void>,
    writeText: (text: string) => ipcRenderer.invoke(C.writeText, text) as Promise<void>,
    onNewItem: (cb: (item: HistoryItem) => void) => subscribe(BROADCAST.clipboardNew, (item) => cb(item as HistoryItem))
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
