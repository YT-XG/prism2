/**
 * 剪贴板历史服务
 * @description 用 sql.js 存剪贴板历史，支持收藏、拼音/关键词搜索、保留天数清理。
 *
 * v2 改进：
 * - 继承 SqliteStore，消除旧版重复的 DB 初始化 / save / parseResult。
 * - 不再触发通知弹窗（属后续迭代），只广播新记录给所有可见窗口。
 * - 所有 IPC handler 入参做类型收窄的防御性处理。
 */
import { ipcMain, clipboard } from 'electron'
import log from 'electron-log'
import { SqliteStore } from './db/sqliteDatabase'
import { inputService } from './inputService'
import { settingsService } from './settingsService'
import { windowFactory } from '../frame/WindowFactory'
import { broadcast } from '../utils/platform'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type { HistoryItem, FavoriteItem, CategoryItem, ClipboardRetention } from '@preload/ipc'

class ClipboardService extends SqliteStore {
  /** 剪贴板监控定时器 */
  private timer: ReturnType<typeof setInterval> | null = null

  /** 上次剪贴板文本（用于去重） */
  private lastText = ''

  /** 当前自动清除策略 */
  private retention: ClipboardRetention = {
    autoClean: true,
    value: 1,
    unit: 'month'
  }

  constructor() {
    super('clipboard.db', 'ClipboardService')
  }

  /**
   * 初始化：建表、注册 IPC、启动剪贴板监控、读取保留天数并清理一次。
   */
  async init(): Promise<void> {
    await this.open()

    this.run(
      `CREATE TABLE IF NOT EXISTS clipboard_history (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         content TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`
    )
    this.run('CREATE INDEX IF NOT EXISTS idx_created_at ON clipboard_history(created_at DESC)')

    this.run(
      `CREATE TABLE IF NOT EXISTS favorites (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         content TEXT NOT NULL,
         category TEXT DEFAULT '',
         description TEXT DEFAULT '',
         created_at INTEGER NOT NULL
       )`
    )
    this.run('CREATE INDEX IF NOT EXISTS idx_fav_category ON favorites(category)')
    this.run('CREATE INDEX IF NOT EXISTS idx_fav_created_at ON favorites(created_at DESC)')

    this.save()
    this.registerIPC()

    this.retention = this.#loadRetention(settingsService.getAll())

    await this.start()
    this.autoCleanup()
  }

  /** 停止服务：清理定时器并落盘 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.close()
  }

  /** 启动剪贴板监控（每秒轮询） */
  private async start(): Promise<void> {
    this.lastText = await clipboard.readText()
    this.timer = setInterval(async () => {
      const currentText = await clipboard.readText()
      if (currentText && currentText !== this.lastText) {
        this.lastText = currentText
        this.insert(currentText)
      }
    }, 1000)
  }

  /** 新增一条剪贴板记录（去重 + 清理 + 广播） */
  private insert(content: string): void {
    if (!this.db) return
    try {
      const last = this.one<{ content: string }>(
        'SELECT content FROM clipboard_history ORDER BY created_at DESC LIMIT 1'
      )
      if (last && last.content === content) return

      const now = Date.now()
      this.run('INSERT INTO clipboard_history (content, created_at) VALUES (?, ?)', [content, now])
      this.autoCleanup()

      const newItem: HistoryItem = {
        id: this.lastInsertId(),
        content,
        created_at: now
      }
      broadcast(BROADCAST.clipboardNew, newItem, { onlyVisible: true })
      log.info('[ClipboardService] 新增记录:', content.substring(0, 50))
    } catch (err) {
      log.error('[ClipboardService] 插入失败:', err)
    }
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  getAll(limit = 50, offset = 0): HistoryItem[] {
    return this.all<HistoryItem>(
      'SELECT * FROM clipboard_history ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    )
  }

  search(keyword: string): HistoryItem[] {
    return this.all<HistoryItem>(
      'SELECT * FROM clipboard_history WHERE content LIKE ? ORDER BY created_at DESC LIMIT 50',
      [`%${keyword}%`]
    )
  }

  getHistoryCount(): number {
    return this.one<{ count: number }>('SELECT COUNT(*) AS count FROM clipboard_history')?.count ?? 0
  }

  getFavorites(): FavoriteItem[] {
    return this.all<FavoriteItem>('SELECT * FROM favorites ORDER BY created_at DESC')
  }

  getFavoritesByCategory(category: string): FavoriteItem[] {
    return this.all<FavoriteItem>(
      'SELECT * FROM favorites WHERE category = ? ORDER BY created_at DESC',
      [category]
    )
  }

  getCategories(): CategoryItem[] {
    return this.all<CategoryItem>(
      'SELECT category AS name, COUNT(*) AS count FROM favorites GROUP BY category ORDER BY category'
    )
  }

  searchFavorites(keyword: string): FavoriteItem[] {
    return this.all<FavoriteItem>(
      'SELECT * FROM favorites WHERE content LIKE ? OR description LIKE ? ORDER BY created_at DESC',
      [`%${keyword}%`, `%${keyword}%`]
    )
  }

  // -------------------------------------------------------------------------
  // 收藏 CRUD
  // -------------------------------------------------------------------------

  addFavorite(content: string, category = '', description = ''): number {
    const now = Date.now()
    this.run('INSERT INTO favorites (content, category, description, created_at) VALUES (?, ?, ?, ?)', [
      content,
      category,
      description,
      now
    ])
    this.save()
    return this.lastInsertId()
  }

  updateFavorite(id: number, content: string, category: string, description: string): void {
    this.run('UPDATE favorites SET content = ?, category = ?, description = ? WHERE id = ?', [
      content,
      category,
      description,
      id
    ])
    this.save()
  }

  deleteFavorite(id: number): void {
    this.run('DELETE FROM favorites WHERE id = ?', [id])
    this.save()
  }

  clearAllFavorites(): void {
    this.run('DELETE FROM favorites')
    this.save()
  }

  // -------------------------------------------------------------------------
  // 历史删除
  // -------------------------------------------------------------------------

  delete(id: number): void {
    this.run('DELETE FROM clipboard_history WHERE id = ?', [id])
    this.save()
  }

  clearAll(): void {
    this.run('DELETE FROM clipboard_history')
    this.save()
  }

  getRetentionState(): ClipboardRetention {
    return { ...this.retention }
  }

  setRetentionState(partial: Partial<ClipboardRetention>): void {
    const next = { ...this.retention, ...partial }

    // 防御性类型收窄与范围钳制
    if (typeof next.autoClean !== 'boolean') next.autoClean = this.retention.autoClean
    const units = ['day', 'week', 'month', 'year'] as const
    if (!units.includes(next.unit)) next.unit = this.retention.unit
    if (typeof next.value !== 'number' || !Number.isFinite(next.value)) {
      next.value = this.retention.value
    } else {
      next.value = Math.min(30, Math.max(1, Math.floor(next.value)))
    }

    this.retention = next
    settingsService.update({
      clipboardAutoClean: next.autoClean,
      clipboardRetentionValue: next.value,
      clipboardRetentionUnit: next.unit
    })
    this.autoCleanup()
  }

  /** 主动写入剪贴板后同步监控缓存，避免被当作"新复制"触发广播 */
  async syncMonitorCache(): Promise<void> {
    this.lastText = await clipboard.readText()
  }

  /** 渲染端请求写系统剪贴板（fallback 用） */
  async writeText(text: string): Promise<void> {
    if (!text) return
    await clipboard.writeText(text)
    await this.syncMonitorCache()
  }

  /** 依据当前保留策略计算删除截止时间（毫秒） */
  #computeCutoff(retention: ClipboardRetention): number {
    const DAY_MS = 24 * 60 * 60 * 1000
    // 单位换算：月按 30 天、年按 365 天近似（与旧版"月=30 天"一致）
    const unitMs = {
      day: DAY_MS,
      week: 7 * DAY_MS,
      month: 30 * DAY_MS,
      year: 365 * DAY_MS
    }[retention.unit]
    return Date.now() - retention.value * unitMs
  }

  /** 从设置加载保留策略 */
  #loadRetention(settings: ReturnType<typeof settingsService.getAll>): ClipboardRetention {
    return {
      autoClean: settings.clipboardAutoClean !== false,
      value: settings.clipboardRetentionValue || 1,
      unit: settings.clipboardRetentionUnit
    }
  }

  /** 清理超过保留策略的历史记录（离线开关关闭时不删除） */
  private autoCleanup(): void {
    if (!this.db || !this.retention.autoClean) return
    try {
      const cutoff = this.#computeCutoff(this.retention)
      this.run('DELETE FROM clipboard_history WHERE created_at < ?', [cutoff])
      this.save()
    } catch (err) {
      log.error('[ClipboardService] 自动清理失败:', err)
    }
  }

  // -------------------------------------------------------------------------
  // IPC
  // -------------------------------------------------------------------------

  private registerIPC(): void {
    const C = SERVICE_CHANNELS.clipboard

    ipcMain.handle(C.getHistory, (_e, limit?: number, offset?: number) =>
      this.getAll(limit ?? 50, offset ?? 0)
    )
    ipcMain.handle(C.searchHistory, (_e, keyword: string) => this.search(String(keyword ?? '')))
    ipcMain.handle(C.deleteHistory, (_e, id: number) => this.delete(Number(id)))
    ipcMain.handle(C.clearHistory, () => this.clearAll())
    ipcMain.handle(C.getHistoryCount, () => this.getHistoryCount())
    ipcMain.handle(C.getRetentionState, () => this.getRetentionState())
    ipcMain.handle(C.setRetentionState, (_e, partial: Partial<ClipboardRetention>) =>
      this.setRetentionState(partial ?? {})
    )

    ipcMain.handle(C.clickItem, async (_e, content: string) => {
      await clipboard.writeText(content)
      await this.syncMonitorCache()
      const mainPageFrame = windowFactory.getMainPageFrame()
      mainPageFrame.minimizeForPaste()
      await new Promise((resolve) => setTimeout(resolve, 150))
      await inputService.pasteToPreviousWindow()
    })

    ipcMain.handle(C.getFavorites, () => this.getFavorites())
    ipcMain.handle(C.getFavoritesByCategory, (_e, category: string) =>
      this.getFavoritesByCategory(String(category ?? ''))
    )
    ipcMain.handle(C.getCategories, () => this.getCategories())
    ipcMain.handle(C.searchSnippets, (_e, keyword: string) =>
      this.searchFavorites(String(keyword ?? ''))
    )
    ipcMain.handle(C.addFavorite, (_e, content: string, category?: string, description?: string) =>
      this.addFavorite(String(content ?? ''), category ?? '', description ?? '')
    )
    ipcMain.handle(C.updateFavorite, (_e, id: number, content: string, category: string, description: string) =>
      this.updateFavorite(Number(id), String(content ?? ''), String(category ?? ''), String(description ?? ''))
    )
    ipcMain.handle(C.deleteFavorite, (_e, id: number) => this.deleteFavorite(Number(id)))
    ipcMain.handle(C.clearFavorites, () => this.clearAllFavorites())

    ipcMain.handle(C.writeText, (_e, text: string) => this.writeText(String(text ?? '')))
  }
}

export const clipboardService = new ClipboardService()
