/**
 * 主页面窗口 —— 无边框、置顶的快捷助手主窗口。
 */
import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron'
import { join } from 'node:path'
import log from 'electron-log'
import BaseFrame from './BaseFrame'
import { WINDOW_CHANNELS } from '@preload/ipc'
import appIcon from '../../../resources/icon.png?asset'

const { mainPage } = WINDOW_CHANNELS

export default class MainPageFrame extends BaseFrame {
  static readonly WIDTH = 800
  static readonly HEIGHT = 600
  static readonly MIN_WIDTH = 760
  static readonly MIN_HEIGHT = 540

  /** showCentered 防抖锁 */
  #showLock = false

  protected readonly options: BrowserWindowConstructorOptions = {
    width: MainPageFrame.WIDTH,
    height: MainPageFrame.HEIGHT,
    minWidth: MainPageFrame.MIN_WIDTH,
    minHeight: MainPageFrame.MIN_HEIGHT,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: true,
    skipTaskbar: false,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  }

  protected readonly routePath = '/mainPage'

  create(): BrowserWindow {
    const window = super.create()
    // 把最大化状态推给渲染端（标题栏据此切换图标）
    const pushMaxState = (): void => {
      if (!window.isDestroyed()) this.sendOne(mainPage.toRenderer.maximizeState, window.isMaximized())
    }
    window.on('maximize', pushMaxState)
    window.on('unmaximize', pushMaxState)
    window.hide()
    return window
  }

  /** 居中显示/隐藏（toggle）：动画归渲染端，主进程只负责 show/hide 时序 */
  showCentered(): void {
    if (this.#showLock) return
    this.#showLock = true
    setTimeout(() => (this.#showLock = false), 100)

    if (!this.isAlive()) {
      this.create()
      this.#centerOnScreen()
      this.window!.show()
    } else if (this.window!.isVisible()) {
      this.sendOne(mainPage.toRenderer.startHide)
    } else {
      this.#centerOnScreen()
      this.window!.show()
      this.sendOne(mainPage.toRenderer.reShow)
    }
  }

  /** 最小化窗口让系统恢复焦点（用于自动粘贴场景） */
  minimizeForPaste(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      if (process.platform === 'darwin') {
        this.window.hide()
        app.hide()
        setTimeout(() => (app as unknown as { unhide: () => void }).unhide?.(), 200)
      } else {
        this.window.minimize()
      }
    }
  }

  #centerOnScreen(): void {
    if (!this.window || this.window.isDestroyed()) return
    const { workArea } = screen.getPrimaryDisplay()
    const [width, height] = this.window.getSize()
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y = Math.round(workArea.y + (workArea.height - height) / 2)
    this.window.setPosition(x, y)
  }

  protected registerIPC(): void {
    super.registerIPC()

    this.recvOne(mainPage.toMain.minimize, () => {
      if (this.isAlive()) this.window!.minimize()
    })

    this.recvOne(mainPage.toMain.toggleMaximize, () => {
      if (!this.isAlive()) return
      if (this.window!.isMaximized()) this.window!.unmaximize()
      else this.window!.maximize()
    })

    this.recvOne(mainPage.toMain.hideAfterAnimation, () => {
      if (this.isAlive()) this.window!.hide()
    })

    this.recvOne(mainPage.toMain.ready, () => {
      this.sendOne(mainPage.toRenderer.version, app.getVersion())
    })

    this.recvOne(mainPage.toMain.openTranslate, (_event, text: unknown) => {
      log.info('[MainPageFrame] openTranslate (待翻译功能接入):', String(text ?? '').substring(0, 40))
    })
  }
}
