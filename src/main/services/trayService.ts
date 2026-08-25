/**
 * 系统托盘服务
 */
import { app, Menu, Tray, nativeImage } from 'electron'
import log from 'electron-log'
import icon from '../../../resources/icon.png?asset'
import { windowFactory } from '../frame/WindowFactory'

export class TrayService {
  private tray: Tray | null = null

  init(): void {
    try {
      const image = nativeImage.createFromPath(icon)
      if (process.platform === 'darwin') image.setTemplateImage(true)
      this.tray = new Tray(image)
      this.tray.setToolTip('Prism v2')

      const menu = Menu.buildFromTemplate([
        { label: '显示主界面', click: () => windowFactory.getMainPageFrame().showCentered() },
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

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
