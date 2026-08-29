/**
 * 窗口基类 —— 所有窗口的唯一 BrowserWindow 入口。
 *
 * 提供四种 IPC 通信（recvOne/recvTwo/sendOne/sendTwo）与销毁时自动清理，
 * v2 保持下：窗口类一律经本类通信，禁止在 Frame 里直接调用 ipcMain.on/handle。
 */
import { BrowserWindow, BrowserWindowConstructorOptions, ipcMain } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { WINDOW_CHANNELS } from '@preload/ipc'

type IPCOnHandler = {
  channel: string
  type: 'on'
  handler: (event: Electron.IpcMainEvent, ...args: unknown[]) => void
}

type IPCHandleHandler = {
  channel: string
  type: 'handle'
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
}

type IPCHandler = IPCOnHandler | IPCHandleHandler

const isQuitting = false

export default abstract class BaseFrame {
  protected window: BrowserWindow | null = null

  /** 子类必须提供的窗口配置 */
  protected abstract readonly options: BrowserWindowConstructorOptions

  /** 子类必须提供的路由路径（用于加载 hash 路由） */
  protected abstract readonly routePath: string

  private ipcHandlers: IPCHandler[] = []

  onDestroyCallback: (() => void) | null = null

  /** 创建窗口并加载页面 */
  create(autoShow = false): BrowserWindow {
    const defaultOptions: BrowserWindowConstructorOptions = {
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    }

    this.window = new BrowserWindow({ ...defaultOptions, ...this.options })

    if (autoShow) {
      this.window.on('ready-to-show', () => this.window?.show())
    }

    this.window.webContents.setWindowOpenHandler((_details) => {
      // 外部链接交给系统默认浏览器
      // 不做内联 openExternal 防止渲染端注入，此处简化处理
      return { action: 'deny' }
    })

    this.loadPage()

    this.window.on('closed', () => {
      this.clearIPCHandlers()
      this.onDestroyCallback?.()
      this.onDestroyCallback = null
    })

    this.registerIPC()

    return this.window
  }

  show(): void {
    if (!this.isAlive()) this.create()
    this.window?.show()
  }

  showAt(x: number, y: number): void {
    if (!this.isAlive()) this.create()
    this.window?.setPosition(x, y)
    this.window?.show()
  }

  /** 加载页面（开发环境用 URL，否则用本地文件），hash 模式挂载路由 */
  protected loadPage(): void {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const url = new URL(process.env['ELECTRON_RENDERER_URL'])
      url.hash = this.routePath
      this.window?.loadURL(url.href)
    } else {
      this.window?.loadFile(join(__dirname, '../renderer/index.html'), { hash: this.routePath })
    }
  }

  /** 子类可重写注册 IPC；默认注册基础关闭通道 */
  protected registerIPC(): void {
    this.recvOne(WINDOW_CHANNELS.baseFrame.toMain.closeWindow, (event) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (senderWindow && !senderWindow.isDestroyed()) {
        if (isQuitting) senderWindow.close()
        else senderWindow.hide()
      }
    })
  }

  // ---------- 四种通信 ----------

  protected recvOne(
    channel: string,
    handler: (event: Electron.IpcMainEvent, ...args: unknown[]) => void
  ): void {
    ipcMain.on(channel, handler)
    this.ipcHandlers.push({ channel, type: 'on', handler })
  }

  protected recvTwo(
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    ipcMain.handle(channel, handler)
    this.ipcHandlers.push({ channel, type: 'handle', handler })
  }

  protected sendOne(channel: string, ...data: unknown[]): void {
    if (this.isAlive()) this.window!.webContents.send(channel, ...data)
  }

  /** 关闭窗口（非退出时隐藏到托盘，退出时真正关闭） */
  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (isQuitting) this.window.close()
      else this.window.hide()
    }
  }

  /** 销毁窗口并自动清理已注册的 IPC 处理器 */
  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
    this.clearIPCHandlers()
    this.onDestroyCallback?.()
    this.onDestroyCallback = null
  }

  private clearIPCHandlers(): void {
    for (const item of this.ipcHandlers) {
      if (item.type === 'on') ipcMain.removeListener(item.channel, item.handler)
      else ipcMain.removeHandler(item.channel)
    }
    this.ipcHandlers = []
  }

  getWindow(): BrowserWindow | null {
    return this.window
  }

  isAlive(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }
}
