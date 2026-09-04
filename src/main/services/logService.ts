/**
 * 日志服务
 * @description 定位 electron-log 落盘文件，提供「打开日志文件」能力。
 * 入口：托盘右键菜单「查看日志」 + 设置页「查看日志」。
 */
import { ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import log from 'electron-log'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { LogOpenResult } from '@preload/ipc'

class LogService {
  /** 日志文件完整路径（electron-log 文件传输目标的落盘位置） */
  getLogFilePath(): string {
    return log.transports.file.getFile().path
  }

  /** 用系统默认程序打开日志文件 */
  async openLogFile(): Promise<LogOpenResult> {
    const path = this.getLogFilePath()
    try {
      if (!existsSync(path)) {
        log.warn('[LogService] 日志文件不存在:', path)
        return { ok: false, path, error: '日志文件不存在' }
      }
      const err = await shell.openPath(path)
      if (err) {
        log.error('[LogService] 打开日志失败:', err)
        return { ok: false, path, error: err }
      }
      log.info('[LogService] 已打开日志文件:', path)
      return { ok: true, path }
    } catch (err) {
      log.error('[LogService] 打开日志失败:', err)
      return { ok: false, path, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 用系统默认程序打开日志文件所在目录 */
  async openLogDirectory(): Promise<LogOpenResult> {
    const path = this.getLogFilePath()
    const dir = dirname(path)
    try {
      if (!existsSync(path)) {
        log.warn('[LogService] 日志文件不存在:', path)
        return { ok: false, path: dir, error: '日志文件不存在' }
      }
      const err = await shell.openPath(dir)
      if (err) {
        log.error('[LogService] 打开日志目录失败:', err)
        return { ok: false, path: dir, error: err }
      }
      log.info('[LogService] 已打开日志目录:', dir)
      return { ok: true, path: dir }
    } catch (err) {
      log.error('[LogService] 打开日志目录失败:', err)
      return { ok: false, path: dir, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 注册 IPC */
  init(): void {
    ipcMain.handle(SERVICE_CHANNELS.log.getPath, () => this.getLogFilePath())
    ipcMain.handle(SERVICE_CHANNELS.log.openFile, () => this.openLogFile())
    ipcMain.handle(SERVICE_CHANNELS.log.openDirectory, () => this.openLogDirectory())
    log.info('[LogService] 初始化完成')
  }
}

export const logService = new LogService()
