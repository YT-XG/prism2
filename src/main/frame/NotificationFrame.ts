/**
 * 通知浮窗 —— 自绘通知的常驻小窗（替代 v1 PopupManager 弹窗与 v2 初版的系统通知）。
 *
 * 特性：无边框、始终置顶、不进任务栏、不抢焦点（focusable: false），贴主屏右下角。
 * 内容由渲染端 NotificationPopup 绘制，卡片完全可定制（未来可加链接/翻译等按钮）。
 * 高度由渲染端上报后动态缩放（保持右下角锚定），全部通知消失后自动隐藏。
 */
import { BrowserWindowConstructorOptions, screen } from 'electron'
import { join } from 'node:path'
import BaseFrame from './BaseFrame'
import { WINDOW_CHANNELS } from '@preload/ipc'
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
      sandbox: false,
      backgroundThrottling: false
    }
  }

  protected readonly routePath = '/notificationPopup'

  /** 呼出浮窗：懒创建 → 贴右下角 → 不抢焦点地显示 */
  showPopups(): void {
    if (!this.isAlive()) this.create()
    this.#placeBottomRight()
    this.window!.showInactive()
  }

  /** 渲染端上报内容高度后缩放（保持右下角锚定，避免缩放时窗口跳动） */
  resizePopup(height: number): void {
    if (!this.window || this.window.isDestroyed()) return
    const h = Math.min(
      Math.max(Math.round(height), NotificationFrame.MIN_HEIGHT),
      NotificationFrame.MAX_HEIGHT
    )
    const [w, curH] = this.window.getSize()
    const [x, y] = this.window.getPosition()
    if (h === curH) return
    this.window.setBounds({ x, y: y + curH - h, width: w, height: h })
  }

  /** 通知全部消失后隐藏浮窗 */
  hidePopup(): void {
    if (this.isAlive() && this.window!.isVisible()) this.window!.hide()
  }

  /** 贴主屏工作区右下角 */
  #placeBottomRight(): void {
    if (!this.window || this.window.isDestroyed()) return
    const { workArea } = screen.getPrimaryDisplay()
    const [w, h] = this.window.getSize()
    const x = workArea.x + workArea.width - w - NotificationFrame.MARGIN
    const y = workArea.y + workArea.height - h - NotificationFrame.MARGIN
    this.window.setPosition(x, y)
  }

  protected registerIPC(): void {
    super.registerIPC()
    this.recvOne(resize, (_event, height: unknown) => {
      if (typeof height === 'number' && Number.isFinite(height)) this.resizePopup(height)
    })
    this.recvOne(hide, () => this.hidePopup())
  }
}
