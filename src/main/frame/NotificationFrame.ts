/**
 * 通知浮窗 —— 自绘通知的常驻小窗（替代 v1 PopupManager 弹窗与 v2 初版的系统通知）。
 *
 * 特性：无边框、始终置顶、不进任务栏、不抢焦点（focusable: false）。
 * 位置由设置决定：默认贴主屏右下角，可选顶部居中（灵动岛式）。
 * 内容由渲染端 NotificationPopup 绘制，卡片完全可定制（未来可加链接/翻译等按钮）。
 * 高度由渲染端上报后动态缩放（沿显示方向反向延伸保持锚定），全部通知消失后自动隐藏。
 */
import { BrowserWindowConstructorOptions, screen } from 'electron'
import { join } from 'node:path'
import log from 'electron-log'
import BaseFrame from './BaseFrame'
import { WINDOW_CHANNELS } from '@preload/ipc'
import type { NotificationPopupPosition } from '@preload/ipc'
import appIcon from '../../../resources/icon.png?asset'

const { resize, hide } = WINDOW_CHANNELS.notificationPopup.toMain

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

  /** 呼出浮窗：懒创建 → 按指定位置放置 → 不抢焦点地显示 */
  showPopups(position: NotificationPopupPosition = 'bottom-right'): void {
    this.position = position
    if (!this.isAlive()) this.create()
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
  }
}
