/**
 * 应用设置服务
 * @description 管理 settings.json 的用户配置与全局快捷键生命周期。
 *
 * v2 结构调整：
 * - 直接读取 @preload/ipc 的 AppSettings 类型（单一来源）。
 * - 移除旧版对 PopupManager / NoticeNew 的依赖（通知弹窗属后续迭代）。
 */
import { app, globalShortcut, ipcMain } from 'electron'
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
  githubRepo: 'YT-XG/electron-vite-learn',
  clipboardRetentionValue: 1,
  clipboardAutoClean: true,
  clipboardRetentionUnit: 'month',
  theme: 'light'
}

class SettingsService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS }
  private filePath = ''

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
  }

  #registerAllShortcuts(): void {
    globalShortcut.unregisterAll()
    this.#tryRegister(this.settings.shortcut, () => {
      windowFactory.getMainPageFrame().showCentered()
    }, '主页面')
    this.#tryRegister(this.settings.searchBoxShortcut, () => {
      windowFactory.getQuickPasteFrame().toggle()
    }, '快捷粘贴')
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
