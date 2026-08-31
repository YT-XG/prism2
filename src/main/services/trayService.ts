/**
 * 系统托盘服务
 */
import { app, Menu, Tray, nativeImage } from 'electron'
import log from 'electron-log'
import icon from '../../../resources/icon.png?asset'
import { windowFactory } from '../frame/WindowFactory'
import { logService } from './logService'

class TrayService {
  private tray: Tray | null = null

  init(): void {
    try {
      const base = nativeImage.createFromPath(icon)
      // 设计图标源是 512px，Windows 托盘 16px、mac 菜单栏 18px，视密度缩放到合适尺寸
      const image =
        process.platform === 'darwin'
          ? base.resize({ width: 18, height: 18 })
          : process.platform === 'win32'
            ? base.resize({ width: 16, height: 16 })
            : base
      if (process.platform === 'darwin') image.setTemplateImage(true)
      this.tray = new Tray(image)
      this.setUnread(0)

      const menu = Menu.buildFromTemplate([
        { label: '显示主界面', click: () => windowFactory.getMainPageFrame().showCentered() },
        { type: 'separator' },
        { label: '查看日志', click: () => void logService.openLogFile() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      ])
      this.tray.setContextMenu(menu)
      this.tray.on('click', () => windowFactory.getMainPageFrame().showCentered())
      log.info('[TrayService] 托盘已创建')
    } catch (err) {
      log.error('[TrayService] 初始化失败:', err)
    }
  }

  /** 更新托盘 tooltip 中的未读数（由通知服务在未读变化时调用） */
  setUnread(n: number): void {
    if (!this.tray) return
    this.tray.setToolTip(n > 0 ? `Prism v2（${n} 条未读通知）` : 'Prism v2')
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}

export const trayService = new TrayService()
