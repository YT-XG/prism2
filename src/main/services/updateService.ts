/**
 * 应用更新服务
 * @description 基于 electron-updater + GitHub provider 的自动更新。
 *
 * v2 说明：
 * - 仅在打包后生效（dev 模式返回提示，避免 electron-updater 在未打包环境抛错）。
 * - autoDownload = true：检查到新版本后自动开始下载，UI 只负责展示状态与"安装并重启"。
 * - 所有状态变化经 BROADCAST.updateStatus 广播 + getStatus 主动查询，渲染端无需轮询。
 */
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { broadcast } from '../utils/platform'
import { notificationService } from './notificationService'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type { UpdateStatusInfo } from '@preload/ipc'

class UpdateService {
  /** 当前更新状态（默认 idle） */
  private status: UpdateStatusInfo = {
    status: 'idle',
    currentVersion: app.getVersion()
  }

  /** 是否已接线 electron-updater 事件（幂等，防止重复注册） */
  private wired = false

  /** 初始化：注册 IPC + 接线事件 */
  init(): void {
    if (this.wired) return
    this.wired = true
    this.#wireEvents()
    this.#registerIPC()
    log.info('[UpdateService] 初始化完成')
  }

  /** 查询当前更新状态 */
  getStatus(): UpdateStatusInfo {
    return { ...this.status }
  }

  /**
   * 启动静默检查更新（仅打包后执行，dev 跳过避免无意义网络请求）。
   * 延迟 3s 待窗口与渲染端就绪，发现新版本后由 autoDownload 自动下载，
   * 渲染端经 BROADCAST.updateStatus 收到状态并在标题栏提示。
   */
  checkOnStartup(): void {
    if (!app.isPackaged) return
    setTimeout(() => void this.check(), 3000)
  }

  /** 检查更新：发现新版本后由 electron-updater 自动开始下载 */
  async check(): Promise<UpdateStatusInfo> {
    if (!app.isPackaged) {
      this.#setStatus({
        status: 'idle',
        message: '开发模式不支持自动更新，请打包后测试'
      })
      return this.getStatus()
    }

    this.#setStatus({ status: 'checking' })
    try {
      // autoDownload=true，available 事件后会自动进入下载
      await autoUpdater.checkForUpdates()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[UpdateService] 检查更新失败:', message)
      this.#setStatus({ status: 'error', error: message })
    }
    return this.getStatus()
  }

  /** 安装已下载的更新并重启 */
  quitAndInstall(): void {
    if (this.status.status === 'downloaded') {
      autoUpdater.quitAndInstall()
    }
  }

  /** 接线 electron-updater 事件 → 状态机 + 广播 */
  #wireEvents(): void {
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.#setStatus({ status: 'checking' })
    })
    autoUpdater.on('update-available', (info) => {
      log.info('[UpdateService] 发现新版本:', info.version)
      this.#setStatus({
        status: 'available',
        version: info.version,
        releaseDate: info.releaseDate
      })
      // 通知：发现新版本（受「通知中心 / 更新通知」开关控制）
      notificationService.notify({
        type: 'info',
        source: 'update',
        title: '发现新版本',
        message: `v${info.version} 已发布，正在后台下载…`
      })
    })
    autoUpdater.on('update-not-available', () => {
      this.#setStatus({ status: 'up-to-date' })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.#setStatus({
        status: 'downloading',
        version: this.status.version,
        progress: Math.round(progress.percent)
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      log.info('[UpdateService] 更新已下载:', info.version)
      this.#setStatus({
        status: 'downloaded',
        version: info.version,
        // electron-updater 的 releaseNotes 可能是数组（分平台 ReleaseNoteInfo[]），只取字符串形式
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
      })
      // 通知：更新已就绪
      notificationService.notify({
        type: 'success',
        source: 'update',
        title: '更新已就绪',
        message: `v${info.version} 已下载，重启后生效`
      })
    })
    autoUpdater.on('error', (err) => {
      log.error('[UpdateService] 更新错误:', err)
      this.#setStatus({ status: 'error', error: err.message })
      // 通知：检查失败
      notificationService.notify({
        type: 'error',
        source: 'update',
        title: '更新检查失败',
        message: err.message
      })
    })
  }

  /** 更新状态并广播给所有可见窗口 */
  #setStatus(patch: Partial<UpdateStatusInfo>): void {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: app.getVersion()
    }
    broadcast(BROADCAST.updateStatus, this.getStatus())
  }

  #registerIPC(): void {
    const U = SERVICE_CHANNELS.update
    ipcMain.handle(U.getStatus, () => this.getStatus())
    ipcMain.handle(U.check, () => this.check())
    ipcMain.handle(U.quitAndInstall, () => this.quitAndInstall())
  }
}

export const updateService = new UpdateService()
