/**
 * 快捷粘贴窗口 —— 全局热键唤起的轻量搜索框。
 *
 * 特性：无边框、置顶、不进任务栏、失焦自动隐藏、显示在鼠标所在屏幕附近。
 */
import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron'
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

  /** 是否正在执行"粘贴前退场"（粘贴期间抑制 blur 自动隐藏，避免打断焦点移交） */
  #isPasting = false

  create(): BrowserWindow {
    const window = super.create()
    // 失焦即隐藏（点击别处 / Esc 之外的兜底）
    window.on('blur', () => {
      // 粘贴退场期间由 dismissForPaste 统一接管；若此处先 hide()，
      // 会在系统把焦点交还给上一个应用的过程中抢先隐藏，导致焦点回不去
      if (!window.isDestroyed() && window.isVisible() && !this.#isPasting) window.hide()
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

  /**
   * 粘贴前的退场：把焦点可靠地归还给上一个前台应用，再让窗口退场。
   * @description 与 MainPageFrame.minimizeForPaste() 对齐：
   *  - 先移除 alwaysOnTop，再 minimize → Windows 把焦点交还给上一个前台窗口；
   *  - 等待焦点回落并抑制 blur 自动隐藏，然后才真正隐藏本窗口，
   *    避免"最小化→blur→hide"的竞态把焦点移交打断。
   * @returns 解析时机 = 本窗口已退场、焦点已交还
   */
  async dismissForPaste(): Promise<void> {
    if (!this.isAlive() || !this.window || this.window.isDestroyed()) return

    this.#isPasting = true
    // 移除 alwaysOnTop，让 minimize 能正确传递焦点
    this.window.setAlwaysOnTop(false)

    if (process.platform === 'darwin') {
      // macOS: 隐藏窗口 + 隐藏整个应用，让系统焦点回到上一个应用
      this.window.hide()
      app.hide()
      await new Promise((resolve) => setTimeout(resolve, 200))
      ;(app as unknown as { unhide: () => void }).unhide?.()
    } else {
      // Windows: minimize → 系统把焦点还给上一个前台窗口
      this.window.minimize()
      // 等焦点稳定回落后再真正隐藏，避免粘贴键发到还没拿到输入焦点的窗口
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (this.isAlive() && this.window && !this.window.isDestroyed()) {
        this.window.hide()
      }
    }

    this.#isPasting = false
  }

  /** 把窗口定位到鼠标附近并钳制在工作区内 */
  #placeNearCursor(): void {
    if (!this.window || this.window.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const { workArea } = screen.getDisplayNearestPoint(cursor)
    const [w, h] = this.window.getSize()
    const x = Math.min(Math.max(cursor.x - Math.round(w / 2), workArea.x), workArea.x + workArea.width - w)
    const y = Math.min(Math.max(cursor.y - Math.round(h / 2), workArea.y), workArea.y + workArea.height - h)
    // 防御：高 DPI / 多屏 / 透明无边框窗口布局未完成时，workArea 或 getSize() 可能返回
    // 非有限值，直接 setPosition 会抛 "conversion failure from ..." 崩溃。
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.window.setPosition(x, y)
    } else {
      this.window.center()
    }
  }
}
