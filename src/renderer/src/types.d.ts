import type { ElectronAPI } from '@preload/ipc'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
