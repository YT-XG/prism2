/**
 * 主窗口窗口状态持久化 —— 记住上次关闭时的尺寸与最大化状态。
 *
 * 独立于 settingsService（settingsService 引 windowFactory → MainPageFrame，
 * 反向 import 会成环），数据落在 userData/window-state.json。
 */
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'

/** 主窗口窗口状态 */
export interface WindowState {
  width: number
  height: number
  isMaximized: boolean
}

/** 窗口状态文件路径（延迟求值，确保 userData 已就绪） */
function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

export const windowState = {
  /** 读取上次窗口状态；不存在 / 损坏 / 字段非法时返回 null（视为首次启动） */
  load(): WindowState | null {
    try {
      const file = stateFile()
      if (!existsSync(file)) return null
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<WindowState>
      if (typeof raw.width !== 'number' || typeof raw.height !== 'number') return null
      return {
        width: raw.width,
        height: raw.height,
        isMaximized: raw.isMaximized === true
      }
    } catch (err) {
      log.warn('[WindowState] 读取失败，视为首次启动:', err)
      return null
    }
  },

  /** 写入窗口状态；失败仅记日志不抛出 */
  save(state: WindowState): void {
    try {
      writeFileSync(stateFile(), JSON.stringify(state), 'utf-8')
    } catch (err) {
      log.error('[WindowState] 保存失败:', err)
    }
  }
}
