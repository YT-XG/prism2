/**
 * 全局搜索独立窗口 —— Ctrl+K 呼出的无边框搜索窗（替代在主页内叠加命令面板）。
 *
 * 特性：无边框、置顶、不进任务栏、始终可聚焦（输入需要抢焦点），屏幕居中。
 * 内容由渲染端 /search 路由的 SearchView 绘制（复用 FeatureSearchPanel 的全局搜索逻辑）。
 * Esc / 选中 / 关闭时经 searchFrame IPC 隐藏自身；选中功能项时另唤起主窗口跳转对应页面。
 */
import { BrowserWindowConstructorOptions, screen } from 'electron'
import { join } from 'node:path'
import BaseFrame from './BaseFrame'
import { WINDOW_CHANNELS } from '@preload/ipc'
import { windowFactory } from './WindowFactory'
import { minimizeWindowForPaste } from '../utils/platform'
import appIcon from '../../../resources/icon.png?asset'

const { toMain, toRenderer } = WINDOW_CHANNELS.searchFrame
const { close, openFeature } = toMain

export default class SearchFrame extends BaseFrame {
  static readonly WIDTH = 560
  static readonly HEIGHT = 520
  static readonly MIN_WIDTH = 420
  static readonly MIN_HEIGHT = 360

  protected readonly options: BrowserWindowConstructorOptions = {
    width: SearchFrame.WIDTH,
    height: SearchFrame.HEIGHT,
    minWidth: SearchFrame.MIN_WIDTH,
    minHeight: SearchFrame.MIN_HEIGHT,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }

  protected readonly routePath = '/search'

  /** 呼出搜索窗口（toggle）：懒创建 → 居中 → 显示并聚焦；再次呼出则隐藏 */
  toggle(): void {
    if (!this.isAlive()) {
      const win = this.create()
      // 等页面就绪再显示，避免无边框透明窗口出现白屏闪烁
      win.once('ready-to-show', () => {
        if (win.isDestroyed()) return
        this.#centerOnScreen()
        win.show()
        win.focus()
        // 显式通知渲染端打开面板（不依赖 visibilitychange：hide/show 下不可靠）
        this.sendOne(toRenderer.show)
      })
      return
    }
    // 粘贴交还焦点后窗口处于最小化态（isVisible 仍为 true），需先还原再显示
    if (this.window!.isVisible() && !this.window!.isMinimized()) {
      this.window!.hide()
    } else {
      this.#centerOnScreen()
      if (this.window!.isMinimized()) this.window!.restore()
      this.window!.show()
      this.window!.focus()
      // 重新唤起：再次显式通知渲染端打开面板
      this.sendOne(toRenderer.show)
    }
  }

  /** 隐藏搜索窗口（Esc / 选中 / 关闭后由渲染端触发） */
  hideSearch(): void {
    if (this.isAlive() && this.window!.isVisible()) this.window!.hide()
  }

  /** 最小化搜索窗让系统恢复焦点（用于自动粘贴场景：hide 在 Windows 上焦点交还不可靠） */
  minimizeForPaste(): void {
    minimizeWindowForPaste(this.window)
  }

  /** 居中到主屏工作区（含多屏 / 高 DPI 防御） */
  #centerOnScreen(): void {
    if (!this.window || this.window.isDestroyed()) return
    const { workArea } = screen.getPrimaryDisplay()
    const [width, height] = this.window.getSize()
    const usable = (v: number): boolean => Number.isFinite(v) && v > 0 && v <= 1_000_000
    if (!usable(width) || !usable(height)) {
      this.window.center()
      return
    }
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y = Math.round(workArea.y + (workArea.height - height) / 2)
    const inInt32 = (v: number): boolean => Number.isFinite(v) && v >= -2147483647 && v <= 2147483647
    try {
      if (inInt32(x) && inInt32(y)) this.window.setPosition(x, y)
      else this.window.center()
    } catch {
      this.window.center()
    }
  }

  protected registerIPC(): void {
    super.registerIPC()
    this.recvOne(close, () => this.hideSearch())
    this.recvOne(openFeature, (_event, page: unknown) => {
      if (typeof page !== 'string' || !page) return
      this.hideSearch()
      windowFactory.getMainPageFrame().showPage(page)
    })
  }
}
