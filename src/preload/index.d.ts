/**
 * 渲染进程全局类型声明 —— 声明 window.electronAPI。
 */
import type { ElectronAPI } from './ipc'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
