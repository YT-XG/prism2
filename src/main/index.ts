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
import { quickFoldersService } from './services/quickFoldersService'
import { updateService } from './services/updateService'
import { downloadService } from './services/downloadService'
import { legacyImportService } from './services/legacyImportService'
import { legacyCleanupService } from './services/legacyCleanupService'
import { notificationService } from './services/notificationService'
import { mailService } from './services/mailService'
import { errorLog, logService, notifyAppError } from './services/logService'
import { registerImageScheme, registerImageProtocolHandler } from './utils/imageProtocol'
import { registerMailImageScheme, registerMailImageProtocolHandler } from './utils/mailImageProtocol'
import { isAppQuitting, markQuitting } from './utils/appState'

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
// 报错独立文件：main.log 保持全量（info+）；warn/error 级消息同步写入 error.log（errorLog 实例），便于排查问题
log.hooks.push((message, transport) => {
  if (transport === log.transports.file && (message.level === 'error' || message.level === 'warn')) {
    if (message.level === 'error') {
      errorLog.error(...message.data)
      // error 级报错：广播标题栏红色闪烁提示（仅 error，避免 warn 瞬态重试频繁打扰）
      notifyAppError(message.data)
    } else {
      errorLog.warn(...message.data)
    }
  }
  return message
})
log.info('[App] 启动，系统:', JSON.stringify({ os: `${platform()} ${release()}`, arch, electron: process.versions.electron, node: process.versions.node }))

// ── 剪贴板图片自定义协议：须在 app ready 前注册特权 ──
registerImageScheme()
// ── 邮件内嵌图片自定义协议：同样须在 ready 前注册特权 ──
registerMailImageScheme()

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

  // 注册剪贴板图片自定义协议（渲染端 <img> 直接引用，免 base64 过 IPC）
  registerImageProtocolHandler()
  // 注册邮件内嵌图片自定义协议（cid → 本地附件，解析正文内嵌图）
  registerMailImageProtocolHandler()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 服务初始化
  trayService.init()
  settingsService.init()
  await clipboardService.init()
  await stickyNotesService.init()
  await quickFoldersService.init()
  await notificationService.init()
  updateService.init()
  updateService.checkOnStartup()
  downloadService.init()
  legacyImportService.init()
  legacyCleanupService.init()
  mailService.init()
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
    if (isAppQuitting()) {
      windowFactory.closeAll()
      trayService.destroy()
      app.quit()
    }
  }
})

app.on('before-quit', () => {
  markQuitting()
  log.info('[App] 退出，清理资源...')
  clipboardService.stop()
  stickyNotesService.stop()
  quickFoldersService.stop()
  notificationService.stop()
  mailService.stop()
  settingsService.destroy()
  trayService.destroy()
  globalShortcut.unregisterAll()
})
