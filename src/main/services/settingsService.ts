/**
 * 应用设置服务
 * @description 管理 settings.json 的用户配置与全局快捷键生命周期。
 *
 * v2 结构调整：
 * - 直接读取 @preload/ipc 的 AppSettings 类型（单一来源）。
 * - 移除旧版对 PopupManager / NoticeNew 的依赖（通知弹窗属后续迭代）。
 */
import { app, globalShortcut, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { AppSettings } from '@preload/ipc'
import { windowFactory } from '../frame/WindowFactory'

const DEFAULT_SETTINGS: AppSettings = {
  shortcut: 'CommandOrControl+Alt+V',
  snippetShortcut: 'CommandOrControl+Shift+V',
  searchBoxShortcut: 'CommandOrControl+K',
  serverUrl: process.platform === 'darwin' ? '/Volumes/dist' : '\\\\10.15.8.28\\dist',
  // 默认开启开机自启动（登录系统时自动运行）
  autoStart: true,
  updateSource: 'github',
  // 更新锚点仓库（owner/repo）默认值，与 electron-builder.yml / release.yml 的 publish.owner/repo 一致；
  // 建好真实仓库后需整体替换为实际 owner/repo。
  githubRepo: 'YT-XG/prism2',
  clipboardRetentionValue: 1,
  clipboardAutoClean: true,
  clipboardRetentionUnit: 'month',
  theme: 'light',
  // 通知相关（默认全部开启）
  notificationsEnabled: true,
  notifyClipboard: true,
  notifyUpdate: true
}

class SettingsService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS }
  private filePath = ''
  /** 快捷键是否处于暂停状态（设置页录制新快捷键期间为 true，避免误触发现行快捷键） */
  private shortcutsSuspended = false

  /** 初始化：加载配置 + 应用开机自启动 + 注册全局快捷键 */
  init(): void {
    this.filePath = join(app.getPath('userData'), 'settings.json')
    this.settings = this.#load()
    this.#applyAutoStart()
    this.#registerIPC()
    this.#registerAllShortcuts()
    log.info('[SettingsService] 初始化完成')
  }

  getAll(): AppSettings {
    return { ...this.settings }
  }

  update(partial: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...partial }
    this.#save()
    if (partial.shortcut !== undefined || partial.snippetShortcut !== undefined || partial.searchBoxShortcut !== undefined) {
      this.#registerAllShortcuts()
    }
    // 仅 autoStart 变化时重写系统登录启动项
    if (partial.autoStart !== undefined) {
      this.#applyAutoStart()
    }
    log.info('[SettingsService] 设置已更新')
  }

  destroy(): void {
    globalShortcut.unregisterAll()
  }

  #save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (err) {
      log.error('[SettingsService] 保存失败:', err)
    }
  }

  #load(): AppSettings {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch (err) {
      log.warn('[SettingsService] 配置损坏，使用默认值:', err)
      return { ...DEFAULT_SETTINGS }
    }
  }

  /**
   * 应用开机自启动设置
   * @description 调用 Electron 的 app.setLoginItemSettings 写入系统登录启动项。
   * name 为 Windows 注册表启动项值名（默认 AppUserModelId），设为 'Prism 2' 与 v1（'Prism'）区分，
   * 避免两代应用共用一个自启项值名导致互相覆盖。
   */
  #applyAutoStart(): void {
    app.setLoginItemSettings({
      openAtLogin: this.settings.autoStart,
      name: 'Prism 2'
    })
    log.info('[SettingsService] 开机自启:', this.settings.autoStart ? '已开启' : '已关闭')
  }

  #registerIPC(): void {
    ipcMain.handle(SERVICE_CHANNELS.settings.get, () => this.getAll())

    ipcMain.handle(SERVICE_CHANNELS.settings.update, (_event, partial: Partial<AppSettings>) => {
      this.update(partial)
    })

    // 快捷键录制期间暂停 / 恢复全局快捷键
    ipcMain.handle(SERVICE_CHANNELS.settings.suspendShortcuts, () => this.suspendShortcuts())
    ipcMain.handle(SERVICE_CHANNELS.settings.resumeShortcuts, () => this.resumeShortcuts())

    ipcMain.handle(SERVICE_CHANNELS.settings.openAccessibilitySettings, () =>
      this.openAccessibilitySettings()
    )
  }

  /**
   * 打开 macOS「辅助功能」系统设置面板。
   * @description 点击剪贴板历史项后的自动粘贴通过 AppleScript（System Events keystroke）
   * 模拟按键实现，macOS 要求应用获得「辅助功能」授权，否则静默失败。此方法引导用户直达设置面板。
   * 非 mac 平台为 no-op（返回 ok）。
   */
  async openAccessibilitySettings(): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== 'darwin') {
      return { ok: true }
    }
    try {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      )
      return { ok: true }
    } catch (err) {
      log.error('[SettingsService] 打开辅助功能设置失败:', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 暂停全局快捷键（录制期间调用），录制完成后用 resumeShortcuts 恢复 */
  suspendShortcuts(): void {
    this.shortcutsSuspended = true
    globalShortcut.unregisterAll()
    log.info('[SettingsService] 全局快捷键已暂停（录制中）')
  }

  /** 恢复全局快捷键：按最新设置重新注册 */
  resumeShortcuts(): void {
    this.shortcutsSuspended = false
    this.#registerAllShortcuts()
    log.info('[SettingsService] 全局快捷键已恢复')
  }

  #registerAllShortcuts(): void {
    globalShortcut.unregisterAll()
    if (this.shortcutsSuspended) return
    this.#tryRegister(this.settings.shortcut, () => {
      windowFactory.getMainPageFrame().showCentered()
    }, '主页面')
    this.#tryRegister(this.settings.searchBoxShortcut, () => {
      windowFactory.getSearchFrame().toggle()
    }, '全局搜索')
    // 片段选择器随对应功能迁移时再接入（暂不注册，避免空引用）
  }

  #tryRegister(accelerator: string, callback: () => void, label: string): void {
    if (!accelerator) return
    if (globalShortcut.register(accelerator, callback)) {
      log.info(`[SettingsService] ${label}快捷键已注册:`, accelerator)
    } else {
      log.warn(`[SettingsService] ${label}快捷键注册失败（可能被占用）:`, accelerator)
    }
  }
}

export const settingsService = new SettingsService()
