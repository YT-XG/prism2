/**
 * 主进程入口 —— 生命周期、单实例锁、服务初始化、托盘。
 */
import { app, globalShortcut } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { platform, arch, release } from 'node:os'
import log from 'electron-log'
import { windowFactory } from './frame/WindowFactory'
import { trayService } from './services/trayService'
import { settingsService } from './services/settingsService'
import { clipboardService } from './services/clipboardService'
import { stickyNotesService } from './services/stickyNotesService'
import { updateService } from './services/updateService'
import { legacyImportService } from './services/legacyImportService'
import { legacyCleanupService } from './services/legacyCleanupService'
import { notificationService } from './services/notificationService'
import { logService } from './services/logService'

let isQuitting = false

// ── 全局错误捕获 ──
process.on('uncaughtException', (error) => {
  log.error('[App] 未捕获异常:', error.message, error.stack)
})
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : ''
  log.error('[App] 未处理 Promise 拒绝:', message, stack)
})

// ── 日志与系统信息 ──
log.transports.file.level = 'info'
log.transports.console.level = 'info'
log.info('[App] 启动，系统:', JSON.stringify({ os: `${platform()} ${release()}`, arch, electron: process.versions.electron, node: process.versions.node }))

// ── 单实例锁 ──
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windowFactory.getMainPageFrame().showCentered()
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.prism.next')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 服务初始化
  trayService.init()
  settingsService.init()
  await clipboardService.init()
  await stickyNotesService.init()
  await notificationService.init()
  updateService.init()
  updateService.checkOnStartup()
  legacyImportService.init()
  legacyCleanupService.init()
  logService.init()

  // 启动后显示主界面（首次可见）
  windowFactory.getMainPageFrame().showCentered()

  // 预创建自绘通知浮窗（隐藏态），避免首次通知到来时窗口还在加载、广播丢失
  windowFactory.getNotificationFrame()

  // macOS：点击 Dock 图标恢复主窗口
  app.on('activate', () => windowFactory.getMainPageFrame().showCentered())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (isQuitting) {
      windowFactory.closeAll()
      trayService.destroy()
      app.quit()
    }
  }
})

app.on('before-quit', () => {
  isQuitting = true
  log.info('[App] 退出，清理资源...')
  clipboardService.stop()
  stickyNotesService.stop()
  notificationService.stop()
  settingsService.destroy()
  trayService.destroy()
  globalShortcut.unregisterAll()
})
