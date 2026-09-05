/**
 * 日志服务
 * @description 定位 electron-log 落盘文件，提供「打开日志文件」能力。
 * 入口：托盘右键菜单「查看日志」 + 设置页「查看日志」。
 *
 * 日志文件分工：
 * - main.log（默认 logger，info+ 全量）：运行/调试日志，设置页「打开日志」。
 * - error.log（errorLog 实例，仅 warn/error）：报错相关独立文件，便于排查问题；
 *   默认 logger 的 warn/error 消息经 hooks 同步转发（默认 logger 仍全量写 main.log）。
 */
import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import log from 'electron-log'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type { LogOpenResult } from '@preload/ipc'
import { broadcast } from '../utils/platform'

/** 错误日志实例：仅记录 warn/error，独立落盘 userData/logs/error.log */
export const errorLog = log.create({ logId: 'error' })
// 只接收 warn/error（file transport 默认全级别，这里收紧）；console 不再重复打印（默认 logger 已打印）
errorLog.transports.file.level = 'warn'
errorLog.transports.console.level = false
// 与 main.log 同目录（app.getPath('logs')），懒求值保证 app ready 后可用
errorLog.transports.file.resolvePathFn = () => join(app.getPath('logs'), 'error.log')

/** error 日志消息前缀标签 → 标题栏提示用的友好功能名；无映射（class 名为空/未收录）视为无法归类 */
const ERROR_TAG_FEATURE: Record<string, string> = {
  MailService: '邮件',
  ClipboardService: '剪贴板',
  StickyNotesService: '便利贴',
  QuickFoldersService: '快捷文件夹',
  UpdateService: '更新',
  DownloadService: '下载',
  NotificationService: '通知',
  SettingsService: '设置',
  LogService: '日志',
  LegacyImportService: '旧版导入',
  LegacyCleanupService: '旧版卸载',
  MainPageFrame: '主界面',
  SearchFrame: '搜索',
  NotificationPopupFrame: '通知浮窗'
}

/** 从日志消息推导可归类的功能名；无法识别返回空串 */
function deriveErrorFeature(data: unknown[]): string {
  const first = String(data[0] ?? '')
  const m = first.match(/^\[([^\]]+)\]/)
  if (!m) return ''
  return ERROR_TAG_FEATURE[m[1]] ?? ''
}

/** 主进程发生 error 级报错：广播给所有窗口，驱动标题栏红点闪烁 + 版本号后错误提示 */
export function notifyAppError(data: unknown[]): void {
  broadcast(BROADCAST.appError, { feature: deriveErrorFeature(data) })
}

class LogService {
  /** 日志文件完整路径（electron-log 文件传输目标的落盘位置） */
  getLogFilePath(): string {
    return log.transports.file.getFile().path
  }

  /** 错误日志文件完整路径 */
  getErrorLogFilePath(): string {
    return errorLog.transports.file.getFile().path
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

  /** 用系统默认程序打开错误日志文件 */
  async openErrorLogFile(): Promise<LogOpenResult> {
    const path = this.getErrorLogFilePath()
    try {
      if (!existsSync(path)) {
        log.warn('[LogService] 错误日志文件不存在:', path)
        return { ok: false, path, error: '错误日志文件不存在' }
      }
      const err = await shell.openPath(path)
      if (err) {
        log.error('[LogService] 打开错误日志失败:', err)
        return { ok: false, path, error: err }
      }
      log.info('[LogService] 已打开错误日志文件:', path)
      return { ok: true, path }
    } catch (err) {
      log.error('[LogService] 打开错误日志失败:', err)
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
    ipcMain.handle(SERVICE_CHANNELS.log.openErrorFile, () => this.openErrorLogFile())
    ipcMain.handle(SERVICE_CHANNELS.log.openDirectory, () => this.openLogDirectory())
    log.info('[LogService] 初始化完成')
  }
}

export const logService = new LogService()
