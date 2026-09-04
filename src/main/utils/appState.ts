/**
 * 应用级共享状态
 * @description 主进程各处共享的轻量运行态。当前含退出标志：
 * `before-quit` 时置真，窗口关闭逻辑（BaseFrame closeWindow/close）据此区分
 * 「隐藏到托盘」与「真正关闭」，避免退出阶段窗口只被隐藏导致应用无法退出。
 */

/** 应用是否已进入退出流程 */
let quitting = false

/** 是否处于退出流程 */
export function isAppQuitting(): boolean {
  return quitting
}

/** 标记应用进入退出流程（app.on('before-quit') 时调用） */
export function markQuitting(): void {
  quitting = true
}
