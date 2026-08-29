/**
 * 快捷粘贴窗口 —— 全局热键唤起的轻量搜索框。
 *
 * 特性：无边框、置顶、不进任务栏、失焦自动隐藏、显示在鼠标所在屏幕附近。
 */
import { BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron'
import { join } from 'node:path'
import BaseFrame from './BaseFrame'
import appIcon from '../../../resources/icon.png?asset'

export default class QuickPasteFrame extends BaseFrame {
  static readonly WIDTH = 620
  static readonly HEIGHT = 420

  protected readonly options: BrowserWindowConstructorOptions = {
    width: QuickPasteFrame.WIDTH,
    height: QuickPasteFrame.HEIGHT,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  }

  protected readonly routePath = '/quickPaste'

  create(): BrowserWindow {
    const window = super.create()
    // 失焦即隐藏（点击别处 / Esc 之外的兜底）
    window.on('blur', () => {
      if (!window.isDestroyed() && window.isVisible()) window.hide()
    })
    return window
  }

  /** 显示/隐藏切换（热键触发） */
  toggle(): void {
    if (!this.isAlive()) {
      this.create()
      this.#placeNearCursor()
      this.window!.show()
      this.window!.focus()
    } else if (this.window!.isVisible()) {
      this.window!.hide()
    } else {
      this.#placeNearCursor()
      this.window!.show()
      this.window!.focus()
    }
  }

  /** 若可见则隐藏（粘贴流程用；不创建窗口） */
  hideIfVisible(): void {
    if (this.isAlive() && this.window!.isVisible()) {
      // 置顶窗口持焦时直接 hide()，Windows 不会可靠地把焦点归还上一个窗口，
      // 导致后续 SendKeys 的 ^v 发到错误窗口。先 blur() 让系统走正常激活转移。
      this.window!.blur()
      this.window!.hide()
    }
  }

  /** 把窗口定位到鼠标附近并钳制在工作区内 */
  #placeNearCursor(): void {
    if (!this.window || this.window.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const { workArea } = screen.getDisplayNearestPoint(cursor)
    const [w, h] = this.window.getSize()
    const x = Math.min(Math.max(cursor.x - Math.round(w / 2), workArea.x), workArea.x + workArea.width - w)
    const y = Math.min(Math.max(cursor.y - Math.round(h / 2), workArea.y), workArea.y + workArea.height - h)
    this.window.setPosition(x, y)
  }
}
