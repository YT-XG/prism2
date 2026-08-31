/**
 * 常驻窗口工厂 —— 统一管理各独立窗口的创建与生命周期。
 */
import MainPageFrame from './MainPageFrame'
import QuickPasteFrame from './QuickPasteFrame'
import NotificationFrame from './NotificationFrame'

export class WindowFactory {
  #mainPageFrame: MainPageFrame | null = null
  #quickPasteFrame: QuickPasteFrame | null = null
  #notificationFrame: NotificationFrame | null = null

  getMainPageFrame(): MainPageFrame {
    if (!this.#mainPageFrame) {
      this.#mainPageFrame = new MainPageFrame()
      this.#mainPageFrame.onDestroyCallback = () => {
        this.#mainPageFrame = null
      }
    }
    return this.#mainPageFrame
  }

  getQuickPasteFrame(): QuickPasteFrame {
    if (!this.#quickPasteFrame) {
      this.#quickPasteFrame = new QuickPasteFrame()
      this.#quickPasteFrame.onDestroyCallback = () => {
        this.#quickPasteFrame = null
      }
    }
    return this.#quickPasteFrame
  }

  getNotificationFrame(): NotificationFrame {
    if (!this.#notificationFrame) {
      this.#notificationFrame = new NotificationFrame()
      this.#notificationFrame.onDestroyCallback = () => {
        this.#notificationFrame = null
      }
    }
    return this.#notificationFrame
  }

  /** 隐藏快捷粘贴窗口（不存在时什么都不做，不触发创建） */
  hideQuickPaste(): void {
    this.#quickPasteFrame?.hideIfVisible()
  }

  /** 应用退出时统一销毁所有窗口 */
  closeAll(): void {
    this.#mainPageFrame?.destroy()
    this.#mainPageFrame = null
    this.#quickPasteFrame?.destroy()
    this.#quickPasteFrame = null
    this.#notificationFrame?.destroy()
    this.#notificationFrame = null
  }
}

export const windowFactory = new WindowFactory()
