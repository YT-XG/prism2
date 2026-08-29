/**
 * 模拟输入服务
 * @description 在目标窗口恢复焦点后模拟一次"粘贴"（Ctrl+V / Cmd+V）。
 *
 * v2 简化：不再依赖 @nut-tree/nut-js（重依赖，原生模块），改用系统级按键模拟：
 * - Windows：PowerShell + System.Windows.Forms.SendKeys
 * - macOS：AppleScript keystroke
 * 两者的 Accessibility 权限要求需在生产环境验证。
 */
import { exec } from 'node:child_process'
import log from 'electron-log'

class InputService {
  /**
   * 把当前剪贴板内容粘贴到上一个获得焦点的窗口。
   * 调用前应已把内容写入系统剪贴板并让目标窗口重新获得焦点。
   */
  async pasteToPreviousWindow(): Promise<void> {
    try {
      if (process.platform === 'win32') {
        await this.#pasteWindows()
      } else if (process.platform === 'darwin') {
        await this.#pasteMac()
      }
    } catch (err) {
      log.warn('[InputService] 粘贴失败（可能因权限或窗口状态）:', err)
    }
  }

  #pasteWindows(): Promise<void> {
    return this.#runScript(
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
    )
  }

  #pasteMac(): Promise<void> {
    return this.#runScript('tell application "System Events" to keystroke "v" using command down', true)
  }

  #runScript(script: string, osascript = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = osascript ? `osascript -e '${script}'` : `powershell -NoProfile -Command "${script}"`
      // windowsHide 必须为 true：否则 spawn powershell 会闪出控制台窗口，
      // 该窗口会抢占前台焦点，导致 SendKeys 的 ^v 发进控制台而非目标应用
      exec(command, { windowsHide: true }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
}

export const inputService = new InputService()
