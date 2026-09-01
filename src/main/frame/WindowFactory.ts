/**
 * 常驻窗口工厂 —— 统一管理各独立窗口的创建与生命周期。
 */
import MainPageFrame from './MainPageFrame'
import NotificationFrame from './NotificationFrame'
import SearchFrame from './SearchFrame'

export class WindowFactory {
  #mainPageFrame: MainPageFrame | null = null
  #notificationFrame: NotificationFrame | null = null
  #searchFrame: SearchFrame | null = null

  getMainPageFrame(): MainPageFrame {
    if (!this.#mainPageFrame) {
      this.#mainPageFrame = new MainPageFrame()
      this.#mainPageFrame.onDestroyCallback = () => {
        this.#mainPageFrame = null
      }
    }
    return this.#mainPageFrame
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

  getSearchFrame(): SearchFrame {
    if (!this.#searchFrame) {
      this.#searchFrame = new SearchFrame()
      this.#searchFrame.onDestroyCallback = () => {
        this.#searchFrame = null
      }
    }
    return this.#searchFrame
  }

  /** 应用退出时统一销毁所有窗口 */
  closeAll(): void {
    this.#mainPageFrame?.destroy()
    this.#mainPageFrame = null
    this.#notificationFrame?.destroy()
    this.#notificationFrame = null
    this.#searchFrame?.destroy()
    this.#searchFrame = null
  }
}

export const windowFactory = new WindowFactory()
