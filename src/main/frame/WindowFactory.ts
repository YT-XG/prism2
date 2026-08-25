/**
 * 常驻窗口工厂 —— 统一管理各独立窗口的创建与生命周期。
 */
import MainPageFrame from './MainPageFrame'

export class WindowFactory {
  #mainPageFrame: MainPageFrame | null = null

  getMainPageFrame(): MainPageFrame {
    if (!this.#mainPageFrame) {
      this.#mainPageFrame = new MainPageFrame()
      this.#mainPageFrame.onDestroyCallback = () => {
        this.#mainPageFrame = null
      }
    }
    return this.#mainPageFrame
  }

  /** 应用退出时统一销毁所有窗口 */
  closeAll(): void {
    this.#mainPageFrame?.destroy()
    this.#mainPageFrame = null
  }
}

export const windowFactory = new WindowFactory()
