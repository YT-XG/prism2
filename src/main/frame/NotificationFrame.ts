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
    // 防御：多屏 / 高 DPI 下 getSize / getPosition 可能返回非有限值，setBounds 同样会抛
    // "conversion failure from ..." 崩溃。
    if (![w, curH, x, y, h].every(Number.isFinite)) return
    // 右下角：向上生长（顶边下移）；顶部居中：向下生长（顶边固定）
    const top = this.position === 'top-center' ? y : y + curH - h
    this.window.setBounds({ x, y: top, width: w, height: h })
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
    let x: number
    let y: number
    if (this.position === 'top-center') {
      x = workArea.x + (workArea.width - w) / 2
      y = workArea.y + NotificationFrame.MARGIN
    } else {
      x = workArea.x + workArea.width - w - NotificationFrame.MARGIN
      y = workArea.y + workArea.height - h - NotificationFrame.MARGIN
    }
    // 防御：高 DPI / 多屏 / 透明无边框窗口布局未完成时，workArea 或 getSize() 可能返回
    // 非有限值，直接 setPosition 会抛 "conversion failure from ..." 崩溃。
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.window.setPosition(x, y)
    } else {
      this.window.center()
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
