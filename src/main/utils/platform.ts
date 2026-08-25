/**
 * 跨平台工具函数
 */
import { BrowserWindow } from 'electron'

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
