/**
 * 通知浮窗 —— 自绘通知的常驻小窗（替代 v1 PopupManager 弹窗与 v2 初版的系统通知）。
 *
 * 特性：无边框、始终置顶、不进任务栏、不抢焦点（focusable: false）。
 * 位置由设置决定：默认贴主屏右下角，可选顶部居中（灵动岛式）。
 * 内容由渲染端 NotificationPopup 绘制，卡片完全可定制（未来可加链接/翻译等按钮）。
 * 高度由渲染端上报后动态缩放（沿显示方向反向延伸保持锚定），全部通知消失后自动隐藏。
 *
 * 首条通知防丢：窗口在启动时预创建，但渲染端 Vue 应用异步加载；若首条通知早于
 * 渲染端订阅 onNew 到达，广播会被丢弃。渲染端订阅完成后经 `ready` IPC 上报就绪，
 * 就绪前到达的通知由 deliver() 暂存，就绪后按到达顺序补发。
 */
import { BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron'
import { join } from 'node:path'
import log from 'electron-log'
import BaseFrame from './BaseFrame'
import { BROADCAST, WINDOW_CHANNELS } from '@preload/ipc'
import type { NotificationNewPayload, NotificationPopupPosition } from '@preload/ipc'
import { broadcast } from '../utils/platform'
import appIcon from '../../../resources/icon.png?asset'

const { resize, hide, ready } = WINDOW_CHANNELS.notificationPopup.toMain

/** 渲染端就绪前暂存通知上限：超出丢弃最旧（渲染端加载异常时防止无限积压） */
const MAX_PENDING = 8

export default class NotificationFrame extends BaseFrame {
  static readonly WIDTH = 360
  static readonly MIN_HEIGHT = 40
  static readonly MAX_HEIGHT = 460
  /** 距屏幕右下角留白 */
  static readonly MARGIN = 16

  protected readonly options: BrowserWindowConstructorOptions = {
    width: NotificationFrame.WIDTH,
    height: 100,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }

  protected readonly routePath = '/notificationPopup'

  /** 当前浮窗显示位置（影响放置与缩放锚定方向） */
  private position: NotificationPopupPosition = 'bottom-right'

  /** 渲染端是否已订阅 onNew（ready IPC 上报；就绪前到达的通知先暂存） */
  private rendererReady = false

  /** 渲染端就绪前到达的通知（就绪后按到达顺序补发） */
  private pending: NotificationNewPayload[] = []

  override create(): BrowserWindow {
    this.rendererReady = false
    this.pending = []
    const win = super.create()
    this.#attachLifecycle(win)
    return win
  }

  /**
   * 监听渲染进程生命周期异常，恢复投递可靠：
   * - render-process-gone：渲染进程崩溃/被杀（睡眠唤醒后 GPU 重置、系统回收后台进程等常见诱因——
   *   此时 window 仍 "alive"、rendererReady 仍为 true，但 webContents 已死，后续广播静默丢失；
   * - unresponsive：渲染进程长期无响应（长时间隐藏窗口被系统冻结等）。
   * 两者都重置就绪标记：新到达的通知自然转回暂存队列，待重载后的渲染端 ready 上报按序补发。
   */
  #attachLifecycle(win: BrowserWindow): void {
    const wc = win.webContents
    wc.on('render-process-gone', (_event, details) => {
      log.warn('[NotificationFrame] 渲染进程退出:', details.reason)
      this.rendererReady = false
    })
    wc.on('unresponsive', () => {
      log.warn('[NotificationFrame] 渲染进程无响应，重载自愈')
      this.rendererReady = false
      if (!win.isDestroyed() && !wc.isDestroyed()) win.reload()
    })
  }

  /** 渲染端是否可直接投递：已就绪 + 渲染进程存活 + 不在加载中（加载中广播会丢） */
  #rendererHealthy(): boolean {
    const wc = this.window?.webContents
    if (!wc || wc.isDestroyed() || wc.isCrashed() || wc.isLoadingMainFrame()) return false
    return this.rendererReady
  }

  /** 渲染端不健康时自愈：窗口已销毁则重建（保留暂存），渲染进程崩溃则重载（重载后 ready 再补发） */
  #ensureRendererRecovered(): void {
    if (!this.isAlive()) {
      const keep = this.pending
      this.create()
      this.pending = keep
      return
    }
    const wc = this.window!.webContents
    if (!wc.isDestroyed() && wc.isCrashed()) {
      log.warn('[NotificationFrame] 渲染进程已崩溃，重载自愈（暂存通知待就绪后补发）')
      this.window!.reload()
    }
  }

  /**
   * 投递通知广播（统一入口）：渲染端健康则立即广播到可见窗口，
   * 否则先自愈（重建/重载）再暂存，待渲染端 `ready` 上报后按到达顺序补发。
   * 兜住两类丢失：启动时渲染端未就绪（首条通知防丢）+ 运行期渲染进程异常（睡眠唤醒后常见）。
   */
  deliver(payload: NotificationNewPayload): void {
    if (this.#rendererHealthy()) {
      broadcast(BROADCAST.notificationNew, payload, { onlyVisible: true })
    } else {
      this.#ensureRendererRecovered()
      this.pending = [...this.pending, payload].slice(-MAX_PENDING)
    }
  }

  /**
   * 系统睡眠/待机恢复后调用（powerMonitor 'resume'）：校验浮窗渲染进程健康，异常则重载自愈；
   * 重载后的渲染端重新 ready 上报，暂存队列随之补发，避免唤醒后复制/新邮件通知静默丢失。
   */
  recoverAfterResume(): void {
    if (!this.isAlive()) return
    this.#ensureRendererRecovered()
  }

  /** 呼出浮窗：懒创建 → 按指定位置放置 → 不抢焦点地显示 */
  showPopups(position: NotificationPopupPosition = 'bottom-right'): void {
    this.position = position
    if (!this.isAlive()) {
      const keep = this.pending
      this.create()
      this.pending = keep
    } else {
      this.#ensureRendererRecovered()
    }
    this.#place()
    this.window!.showInactive()
  }

  /** 渲染端上报内容高度后缩放（沿显示方向反向延伸，避免窗口跳动） */
  resizePopup(height: number): void {
    if (!this.window || this.window.isDestroyed()) return
    const h = Math.min(
      Math.max(Math.round(height), NotificationFrame.MIN_HEIGHT),
      NotificationFrame.MAX_HEIGHT
    )
    const [w, curH] = this.window.getSize()
    const [x, y] = this.window.getPosition()
    if (h === curH) return
    // 防御：多屏 / 高 DPI / 隐藏态下 getSize / getPosition 可能返回非有限或超 int32 的
    // 有限值，setBounds 会抛 "conversion failure from ..."。超出常规可视范围一律放弃缩放。
    const inRange = (n: number): boolean => Number.isFinite(n) && n >= -10_000_000 && n <= 10_000_000
    if (![w, curH, x, y, h].every(inRange)) return
    // 右下角：向上生长（顶边下移）；顶部居中：向下生长（顶边固定）
    const top = this.position === 'top-center' ? y : y + curH - h
    try {
      this.window.setBounds({ x, y: top, width: w, height: h })
    } catch (err) {
      log.warn('[NotificationFrame] resizePopup setBounds 异常:', err)
    }
  }

  /** 通知全部消失后隐藏浮窗 */
  hidePopup(): void {
    if (this.isAlive() && this.window!.isVisible()) this.window!.hide()
  }

  /** 按当前显示位置贴屏：底部右下角 / 顶部居中 */
  #place(): void {
    if (!this.window || this.window.isDestroyed()) return
    const { workArea } = screen.getPrimaryDisplay()
    const [w, h] = this.window.getSize()
    // 防御：透明无边框窗口在隐藏态 / 高 DPI / 多屏布局未完成时，getSize() 可能返回 NaN /
    // 负数 / 超大有限值，使坐标超出 setPosition 的 int32 可转换范围，抛
    // "conversion failure from ..."。做多重防御：
    // ① 尺寸可疑（非有限 / 非正 / 超 1e6）时放弃计算，交给系统居中；
    const usable = (v: number): boolean => Number.isFinite(v) && v > 0 && v <= 1_000_000
    if (!usable(w) || !usable(h)) {
      log.warn('[NotificationFrame] #place 窗口尺寸异常，回退系统居中:', { workArea, w, h })
      this.#safeCenter()
      return
    }
    const x = Math.round(
      this.position === 'top-center'
        ? workArea.x + (workArea.width - w) / 2
        : workArea.x + workArea.width - w - NotificationFrame.MARGIN
    )
    const y = Math.round(
      this.position === 'top-center'
        ? workArea.y + NotificationFrame.MARGIN
        : workArea.y + workArea.height - h - NotificationFrame.MARGIN
    )
    // ② 坐标必须落在 int32 可表示范围（Number.isFinite 拦不住超 int32 的有限值）；
    const inInt32 = (v: number): boolean => Number.isFinite(v) && v >= -2147483647 && v <= 2147483647
    if (!inInt32(x) || !inInt32(y)) {
      log.warn('[NotificationFrame] #place 坐标越界，回退系统居中:', { workArea, w, h, x, y })
      this.#safeCenter()
      return
    }
    // ③ 仍有意外异常时兜底系统居中，绝不把异常抛回主进程调用链
    try {
      this.window.setPosition(x, y)
    } catch (err) {
      log.warn('[NotificationFrame] #place setPosition 异常，回退系统居中:', err)
      this.#safeCenter()
    }
  }

  /** 系统居中兜底：center() 内部也按窗口尺寸计算坐标，异常时吞掉 */
  #safeCenter(): void {
    try {
      this.window?.center()
    } catch (err) {
      log.warn('[NotificationFrame] #safeCenter 系统居中失败:', err)
    }
  }

  protected registerIPC(): void {
    super.registerIPC()
    this.recvOne(resize, (_event, height: unknown) => {
      if (typeof height === 'number' && Number.isFinite(height)) this.resizePopup(height)
    })
    this.recvOne(hide, () => this.hidePopup())
    this.recvOne(ready, () => {
      // 渲染端订阅完成：补发就绪前暂存的通知（按到达顺序；浮窗已在 showPopups 中显示）
      this.rendererReady = true
      const pending = this.pending
      this.pending = []
      for (const p of pending) broadcast(BROADCAST.notificationNew, p, { onlyVisible: true })
    })
  }
}
