/**
 * 主页面窗口 —— 无边框、置顶的快捷助手主窗口。
 */
import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron'
import { join } from 'node:path'
import log from 'electron-log'
import BaseFrame from './BaseFrame'
import { WINDOW_CHANNELS } from '@preload/ipc'
import { windowState } from '../utils/windowState'
import appIcon from '../../../resources/icon.png?asset'

const { mainPage } = WINDOW_CHANNELS

export default class MainPageFrame extends BaseFrame {
  static readonly WIDTH = 1200
  static readonly HEIGHT = 800
  static readonly MIN_WIDTH = 760
  static readonly MIN_HEIGHT = 540

  /** showCentered 防抖锁 */
  #showLock = false

  /** 尺寸变化持久化防抖定时器 */
  #saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 隐藏的兜底强制隐藏定时器（渲染端 animationend 缺失时窗口卡在可见态，用它兜底） */
  #hideTimer: ReturnType<typeof setTimeout> | null = null

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

    // 恢复上次窗口尺寸；首次启动（无历史状态）默认最大化
    const saved = windowState.load()
    if (saved) {
      const [width, height] = this.#clampSize(saved.width, saved.height)
      window.setSize(width, height)
      if (saved.isMaximized) window.maximize()
    } else {
      window.maximize()
    }

    // 尺寸 / 最大化状态变化时防抖持久化，下次启动恢复（拖拽 / 最大化 / 还原均触发 resize）
    window.on('resize', () => {
      if (this.#saveTimer) clearTimeout(this.#saveTimer)
      this.#saveTimer = setTimeout(() => {
        if (!window.isDestroyed()) {
          const [width, height] = window.getSize()
          windowState.save({ width, height, isMaximized: window.isMaximized() })
        }
      }, 300)
    })

    window.hide()
    return window
  }

  override destroy(): void {
    // 兜底保存当前尺寸（覆盖「最大化后立刻退出、防抖未触发」的边界）
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer)
      this.#saveTimer = null
    }
    this.#cancelHide()
    if (this.window && !this.window.isDestroyed()) {
      const [width, height] = this.window.getSize()
      windowState.save({ width, height, isMaximized: this.window.isMaximized() })
    }
    super.destroy()
  }

  /** 将历史尺寸钳制到主屏工作区与最小尺寸之间，防止小屏越界 */
  #clampSize(width: number, height: number): [number, number] {
    const { workArea } = screen.getPrimaryDisplay()
    return [
      Math.max(MainPageFrame.MIN_WIDTH, Math.min(width, workArea.width)),
      Math.max(MainPageFrame.MIN_HEIGHT, Math.min(height, workArea.height))
    ]
  }

  /** 居中显示/隐藏（toggle）：动画归渲染端，主进程只负责 show/hide 时序 */
  showCentered(): void {
    if (this.#showLock) return
    this.#showLock = true
    setTimeout(() => (this.#showLock = false), 100)

    if (!this.isAlive()) {
      this.#cancelHide()
      this.create()
      this.#centerOnScreen()
      this.window!.show()
    } else if (this.window!.isVisible()) {
      this.sendOne(mainPage.toRenderer.startHide)
      // 兜底：渲染端 animationend 缺失（透明窗口合成异常等）时窗口停在"可见但已淡出"态，
      // isVisible() 恒为 true 会让本方法永远命中 startHide 分支、无法再显示。定时强制隐藏，
      // 使窗口进入隐藏态，下次托盘点击可正常显示。重新显示时会取消该定时器（见 #cancelHide）。
      if (!this.#hideTimer) {
        this.#hideTimer = setTimeout(() => {
          this.#hideTimer = null
          if (this.isAlive() && this.window!.isVisible()) this.window!.hide()
        }, 400)
      }
    } else {
      this.#cancelHide()
      this.#centerOnScreen()
      this.window!.show()
      this.sendOne(mainPage.toRenderer.reShow)
    }
  }

  /** 取消兜底隐藏定时器（重新显示/销毁时调用，避免定时器误隐藏刚显示的窗口） */
  #cancelHide(): void {
    if (this.#hideTimer) {
      clearTimeout(this.#hideTimer)
      this.#hideTimer = null
    }
  }

  /** 显示主窗口并跳转到指定子页面（page 不带前导斜杠，如 'notifications'）。通知浮窗等外部入口用 */
  showPage(page: string): void {
    if (!this.isAlive()) {
      this.#cancelHide()
      this.create()
      this.#centerOnScreen()
      this.window!.show()
    } else if (!this.window!.isVisible()) {
      this.#cancelHide()
      this.#centerOnScreen()
      this.window!.show()
      this.sendOne(mainPage.toRenderer.reShow)
    }
    this.sendOne(mainPage.toRenderer.setPage, { page })
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
    // 最大化/全屏时无需居中（本方法在 create() 后立即调用，首启即最大化，居中无意义），
    // 且最大化窗口的 getSize() 在部分环境（高 DPI / 多屏 / 透明无边框窗口布局未完成）
    // 会返回非有限值，直接 setPosition 会抛 "conversion failure from ..." 导致主页面打不开。
    if (this.window.isMaximized() || this.window.isFullScreen()) return
    const { workArea } = screen.getPrimaryDisplay()
    const [width, height] = this.window.getSize()
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y = Math.round(workArea.y + (workArea.height - height) / 2)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.window.setPosition(x, y)
    } else {
      // 兜底：workArea / getSize() 任一出非有限值时交给系统自行居中，避免崩溃
      log.warn('[MainPageFrame] #centerOnScreen 计算出非有限坐标，回退系统居中:', { workArea, width, height, x, y })
      this.window.center()
    }
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
      // 启动即最大化时 maximize 事件早于渲染进程挂载，此处补推一次，标题栏图标才正确
      if (this.isAlive()) this.sendOne(mainPage.toRenderer.maximizeState, this.window!.isMaximized())
    })

    this.recvOne(mainPage.toMain.openTranslate, (_event, text: unknown) => {
      log.info('[MainPageFrame] openTranslate (待翻译功能接入):', String(text ?? '').substring(0, 40))
    })

    this.recvOne(mainPage.toMain.showPage, (_event, page: unknown) => {
      if (typeof page === 'string') this.showPage(page)
    })
  }
}
