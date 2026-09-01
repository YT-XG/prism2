/**
 * 跨平台工具函数
 */
import { app, BrowserWindow } from 'electron'

interface BroadcastOptions {
  /** 只推送给可见窗口 */
  onlyVisible?: boolean
}

/**
 * 向所有窗口广播一条消息
 * @param channel - 通道名
 * @param data - 推送数据
 * @param options - 选项（onlyVisible 时只投递给可见窗口）
 */
export function broadcast(channel: string, data: unknown, options: BroadcastOptions = {}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (options.onlyVisible && !win.isVisible()) continue
    win.webContents.send(channel, data)
  }
}

/**
 * 最小化窗口让系统恢复焦点（用于自动粘贴场景）。
 * 用 minimize 而非 hide：hide 在 Windows 上焦点交还不可靠，
 * 后续 SendKeys 的 ^v 会发到搜索窗/主窗口而非上一个前台应用。
 * macOS 无最小化恢复焦点语义，改为 hide + app.hide 后短暂 unhide 交还焦点。
 */
export function minimizeWindowForPaste(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  if (process.platform === 'darwin') {
    win.hide()
    app.hide()
    setTimeout(() => (app as unknown as { unhide: () => void }).unhide?.(), 200)
  } else {
    win.minimize()
  }
}
