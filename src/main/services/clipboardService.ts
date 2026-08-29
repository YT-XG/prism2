/**
 * 剪贴板历史服务
 * @description 用 sql.js 存剪贴板历史，支持文本/图片两类内容、收藏、关键词搜索、保留天数清理。
 *
 * v2 改进：
 * - 继承 SqliteStore，消除旧版重复的 DB 初始化 / save / parseResult。
 * - 监控采用自调度 setTimeout 轮询（避免 async 回调重叠与未捕获 rejection），
 *   以内容签名去重：重复复制相同内容时"置顶"（更新 created_at）而非新增。
 * - 图片内容以 PNG 文件存于 userData/clipboard-images/，DB 只存文件名；
 *   历史清理/删除时同步删除对应文件。
 * - 清理为低频定时任务（每小时），落盘做防抖，复制高峰不再每次全量写盘。
 * - 不再触发通知弹窗（属后续迭代），只广播新记录给所有可见窗口。
 * - 所有 IPC handler 入参做类型收窄的防御性处理。
 */
import {
  ipcMain,
  clipboard,
  nativeImage,
  ClipboardItem,
  app,
  BrowserWindow,
  dialog
} from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import log from 'electron-log'
import initSqlJs, { type Database } from 'sql.js'
import AdmZip from 'adm-zip'
import { SqliteStore } from './db/sqliteDatabase'
import { inputService } from './inputService'
import { settingsService } from './settingsService'
import { windowFactory } from '../frame/WindowFactory'
import { broadcast } from '../utils/platform'
import { BACKUP_EXTENSION, BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type {
  HistoryItem,
  FavoriteItem,
  CategoryItem,
  ClipboardRetention,
  BackupImportMode,
  BackupExportResult,
  BackupImportResult
} from '@preload/ipc'

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 1000
/** 自动清理执行间隔（ms，每小时一次） */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
/** 落盘防抖（ms）：高频复制时不至于每秒全量写盘 */
const SAVE_DEBOUNCE_MS = 2000
/** 保留期配置变更后的延迟清理（ms）：把 value/unit/autoClean 的连续改动合并为一次最终清理，避免中间态误删 */
const CLEANUP_DEBOUNCE_MS = 5000
/** 图片文件名合法格式（防御路径穿越） */
const IMAGE_NAME_RE = /^[\w.-]+$/

/** 备份文件内 manifest.json 的结构（app 标识 + 格式版本用于校验） */
interface BackupManifest {
  app: string
  formatVersion: number
  exportedAt: string
  historyCount: number
  favoriteCount: number
  imageCount: number
}

class ClipboardService extends SqliteStore {
  /** 剪贴板监控定时器（自调度 setTimeout，避免回调重叠） */
  private timer: ReturnType<typeof setTimeout> | null = null

  /** 自动清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  /** 落盘防抖定时器 */
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 保留期配置变更后的延迟清理定时器（连续改动会重置） */
  private cleanupDebounceTimer: ReturnType<typeof setTimeout> | null = null

  /** 监控是否已停止（防止停止后 finally 里重新调度） */
  private stopped = false

  /** 上次剪贴板内容签名（text:<内容> / image:<sha1>，用于去重） */
  private lastSignature = ''

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
   * 初始化：建表（含 type 列迁移）、注册 IPC、启动剪贴板监控、
   * 读取保留天数并清理一次 + 启动低频清理定时器。
   */
  async init(): Promise<void> {
    await this.open()

    this.run(
      `CREATE TABLE IF NOT EXISTS clipboard_history (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         content TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         type TEXT NOT NULL DEFAULT 'text'
       )`
    )
    this.run('CREATE INDEX IF NOT EXISTS idx_created_at ON clipboard_history(created_at DESC)')

    // 旧库迁移：补充 type 列
    const columns = this.all<{ name: string }>('PRAGMA table_info(clipboard_history)')
    if (!columns.some((c) => c.name === 'type')) {
      this.run("ALTER TABLE clipboard_history ADD COLUMN type TEXT NOT NULL DEFAULT 'text'")
    }

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

    this.stopped = false
    await this.start()
    this.autoCleanup()
    this.cleanupTimer = setInterval(() => this.autoCleanup(), CLEANUP_INTERVAL_MS)
  }

  /** 停止服务：清理定时器、落盘防抖冲刷、关闭数据库 */
  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    if (this.cleanupDebounceTimer) {
      clearTimeout(this.cleanupDebounceTimer)
      this.cleanupDebounceTimer = null
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.save()
    }
    this.close()
  }

  /** 启动剪贴板监控：记录基线签名后自调度轮询 */
  private async start(): Promise<void> {
    try {
      const { sig } = await this.#readClipboard()
      this.lastSignature = sig
    } catch (err) {
      log.error('[ClipboardService] 读取初始剪贴板失败:', err)
    }
    this.#schedulePoll()
  }

  /** 自调度下一次轮询 */
  #schedulePoll(): void {
    this.timer = setTimeout(() => void this.#poll(), POLL_INTERVAL_MS)
  }

  /** 单次轮询：读签名 → 与上次比较 → 新内容入库；异常只记日志不中断调度 */
  async #poll(): Promise<void> {
    try {
      const { sig, image } = await this.#readClipboard()
      if (sig && sig !== this.lastSignature) {
        this.lastSignature = sig
        if (image) {
          // 签名格式 image:<sha1>，取哈希作文件名一部分
          this.#insertImage(image.buf, image.mime, sig.slice('image:'.length))
        } else {
          this.#insert(sig.slice('text:'.length), 'text')
        }
      } else if (!sig) {
        // 剪贴板被清空：重置基线，之后再次复制相同内容可重新记录（置顶）
        this.lastSignature = ''
      }
    } catch (err) {
      log.error('[ClipboardService] 轮询失败:', err)
    } finally {
      if (!this.stopped) this.#schedulePoll()
    }
  }

  /** 读取当前剪贴板并生成签名（图片优先，其次文本） */
  async #readClipboard(): Promise<{
    sig: string
    image: { buf: Buffer; mime: string } | null
  }> {
    // Electron 44 剪贴板为异步 W3C 风格 API：read() 返回 ClipboardItem 数组
    const items = await clipboard.read()
    for (const item of items) {
      const mime = item.types.find((t) => t.startsWith('image/'))
      if (!mime) continue
      const blob = (await item.getType(mime)) as Blob
      const buf = Buffer.from(await blob.arrayBuffer())
      if (buf.length === 0) continue
      return { sig: 'image:' + createHash('sha1').update(buf).digest('hex'), image: { buf, mime } }
    }
    const text = await clipboard.readText()
    return { sig: text ? `text:${text}` : '', image: null }
  }

  /**
   * 图片存文件后入库（文件名 = 时间戳-哈希前缀.ext）。
   * 非 PNG 格式尽量经 nativeImage 归一化为 PNG，失败则按原始字节存储。
   */
  #insertImage(buf: Buffer, mime: string, hash: string): void {
    try {
      let data = buf
      let ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      if (mime !== 'image/png') {
        const converted = nativeImage.createFromBuffer(buf)
        if (!converted.isEmpty()) {
          data = converted.toPNG()
          ext = 'png'
        }
      }
      const filename = `${Date.now()}-${hash.slice(0, 10)}.${ext}`
      writeFileSync(join(this.#imageDir(), filename), data)
      this.#insert(filename, 'image')
    } catch (err) {
      log.error('[ClipboardService] 图片入库失败:', err)
    }
  }

  /** 广播历史变更（新增/删除/清空/导入），供侧栏计数等 UI 刷新权威数据 */
  #notifyHistoryChanged(): void {
    broadcast(BROADCAST.clipboardHistoryChanged, undefined, { onlyVisible: true })
  }

  /**
   * 新增一条剪贴板记录（重复内容置顶 + 防抖落盘 + 广播）。
   * @param content 文本内容或图片文件名
   */
  #insert(content: string, type: HistoryItem['type']): void {
    if (!this.db) return
    try {
      const now = Date.now()

      // 去重置顶：已存在相同内容则更新时间戳并广播"置顶"记录
      const existing = this.one<{ id: number }>(
        'SELECT id FROM clipboard_history WHERE type = ? AND content = ? ORDER BY created_at DESC LIMIT 1',
        [type, content]
      )
      if (existing) {
        this.run('UPDATE clipboard_history SET created_at = ? WHERE id = ?', [now, existing.id])
        this.#saveDebounced()
        broadcast(
          BROADCAST.clipboardNew,
          { id: existing.id, content, created_at: now, type } satisfies HistoryItem,
          { onlyVisible: true }
        )
        this.#notifyHistoryChanged()
        return
      }

      this.run('INSERT INTO clipboard_history (content, created_at, type) VALUES (?, ?, ?)', [
        content,
        now,
        type
      ])
      this.#saveDebounced()

      const newItem: HistoryItem = {
        id: this.lastInsertId(),
        content,
        created_at: now,
        type
      }
      broadcast(BROADCAST.clipboardNew, newItem, { onlyVisible: true })
      this.#notifyHistoryChanged()
      log.info('[ClipboardService] 新增记录:', type, content.substring(0, 50))
    } catch (err) {
      log.error('[ClipboardService] 插入失败:', err)
    }
  }

  /** 落盘防抖：短时间多次写入合并为一次全量导出 */
  #saveDebounced(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, SAVE_DEBOUNCE_MS)
  }

  /** 图片存储目录（懒创建） */
  #imageDir(): string {
    const dir = join(app.getPath('userData'), 'clipboard-images')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  /** 图片文件完整路径 */
  #imagePath(filename: string): string {
    return join(this.#imageDir(), filename)
  }

  /** 删除图片文件（静默失败：文件不存在等） */
  #removeImageFile(filename: string): void {
    try {
      if (IMAGE_NAME_RE.test(filename)) unlinkSync(this.#imagePath(filename))
    } catch {
      // 忽略：文件可能已被清理
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
    // 仅搜索文本记录；图片的 content 是文件名，参与搜索无意义
    return this.all<HistoryItem>(
      "SELECT * FROM clipboard_history WHERE type = 'text' AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 50",
      [`%${this.#escapeLike(keyword)}%`]
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
      "SELECT * FROM favorites WHERE content LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' ORDER BY created_at DESC",
      [`%${this.#escapeLike(keyword)}%`, `%${this.#escapeLike(keyword)}%`]
    )
  }

  /** 读取图片为 data URL（渲染端预览用）；文件名非法或不存在返回空串 */
  getImageData(filename: string): string {
    if (!IMAGE_NAME_RE.test(filename)) return ''
    const path = this.#imagePath(filename)
    if (!existsSync(path)) return ''
    const ext = filename.split('.').pop()?.toLowerCase()
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext ?? 'png'}`
    return `data:${mime};base64,` + readFileSync(path).toString('base64')
  }

  /** LIKE 通配符转义（% _ \），配合 ESCAPE '\' 使用 */
  #escapeLike(keyword: string): string {
    return keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)
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
    const row = this.one<{ type: string; content: string }>(
      'SELECT type, content FROM clipboard_history WHERE id = ?',
      [id]
    )
    this.run('DELETE FROM clipboard_history WHERE id = ?', [id])
    if (row?.type === 'image') this.#removeImageFile(row.content)
    this.save()
    this.#notifyHistoryChanged()
  }

  /** 批量删除历史记录：先收集图片文件名，删行后同步删文件，单次落盘 */
  deleteBatch(ids: number[]): void {
    if (!Array.isArray(ids)) return
    // 防御性类型收窄：只保留有限正整数，去重
    const valid = [
      ...new Set(ids.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n)))
    ]
    if (!valid.length) return
    const placeholders = valid.map(() => '?').join(',')
    const images = this.all<{ content: string }>(
      `SELECT content FROM clipboard_history WHERE type = 'image' AND id IN (${placeholders})`,
      valid
    )
    this.run(`DELETE FROM clipboard_history WHERE id IN (${placeholders})`, valid)
    images.forEach((img) => this.#removeImageFile(img.content))
    this.save()
    this.#notifyHistoryChanged()
  }

  clearAll(): void {
    // 先收集图片文件名，删行后同步删文件
    const images = this.all<{ content: string }>(
      "SELECT content FROM clipboard_history WHERE type = 'image'"
    )
    this.run('DELETE FROM clipboard_history')
    images.forEach((img) => this.#removeImageFile(img.content))
    this.save()
    this.#notifyHistoryChanged()
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
    // 不立即清理：value/unit/autoClean 常被连续修改，立即清理会按中间态误删。
    // 改为防抖延迟，最后一次改动后按最终配置清理；定时任务与启动时也会兜底清理。
    this.scheduleCleanup()
  }

  /** 延迟触发清理：连续改动会重置计时，最终按最后一次的完整配置执行 */
  private scheduleCleanup(): void {
    if (this.cleanupDebounceTimer) clearTimeout(this.cleanupDebounceTimer)
    this.cleanupDebounceTimer = setTimeout(() => {
      this.cleanupDebounceTimer = null
      this.autoCleanup()
    }, CLEANUP_DEBOUNCE_MS)
  }

  /** 主动写入剪贴板后同步监控缓存，避免被当作"新复制"触发广播 */
  async syncMonitorCache(): Promise<void> {
    const { sig } = await this.#readClipboard()
    this.lastSignature = sig
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

  /** 清理超过保留策略的历史记录（开关关闭时不删除），并同步删除图片文件 */
  private autoCleanup(): void {
    if (!this.db || !this.retention.autoClean) return
    try {
      const cutoff = this.#computeCutoff(this.retention)
      const staleImages = this.all<{ content: string }>(
        "SELECT content FROM clipboard_history WHERE type = 'image' AND created_at < ?",
        [cutoff]
      )
      this.run('DELETE FROM clipboard_history WHERE created_at < ?', [cutoff])
      staleImages.forEach((img) => this.#removeImageFile(img.content))
      this.#saveDebounced()
    } catch (err) {
      log.error('[ClipboardService] 自动清理失败:', err)
    }
  }

  // -------------------------------------------------------------------------
  // 备份导出 / 导入（zip 打包，扩展名 .prismbackup）
  // -------------------------------------------------------------------------

  /** 列出图片目录中的图片文件名（防御性过滤非法文件名） */
  #listImageFiles(): string[] {
    const dir = this.#imageDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((f) => IMAGE_NAME_RE.test(f))
  }

  /** 删除图片目录中所有图片文件（replace 导入前清场用） */
  #clearImageFiles(): void {
    for (const f of this.#listImageFiles()) this.#removeImageFile(f)
  }

  /** 读取外部 sql.js 实例的查询结果（通用解析为行对象） */
  #readTable(db: Database, sql: string): Record<string, unknown>[] {
    const res = db.exec(sql)
    if (!res || res.length === 0) return []
    const cols = res[0].columns
    return res[0].values.map((v) => {
      const o: Record<string, unknown> = {}
      cols.forEach((c, i) => (o[c] = v[i]))
      return o
    })
  }

  /** 导出剪贴板记录备份：clipboard.db + 图片 + manifest，打包为 .prismbackup（zip） */
  async exportBackup(): Promise<BackupExportResult> {
    // 先把内存中防抖中的变更落盘，保证备份的是最新数据
    this.save()
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '')
      .replace('T', '-')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出剪贴板记录备份',
      defaultPath: `Prism-backup-${stamp}${BACKUP_EXTENSION}`,
      filters: [{ name: 'Prism 剪贴板备份', extensions: [BACKUP_EXTENSION.slice(1)] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }

    try {
      const historyCount = this.getHistoryCount()
      const favoriteCount = this.getFavorites().length
      const imageFiles = this.#listImageFiles()
      const manifest: BackupManifest = {
        app: 'prism2',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        historyCount,
        favoriteCount,
        imageCount: imageFiles.length
      }

      const zip = new AdmZip()
      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))
      if (existsSync(this.filePath)) zip.addFile('clipboard.db', readFileSync(this.filePath))
      for (const f of imageFiles) {
        const abs = this.#imagePath(f)
        if (existsSync(abs)) zip.addLocalFile(abs, 'images')
      }
      zip.writeZip(filePath)

      log.info(
        `[clipboard] backup exported: ${filePath} (history=${historyCount}, favorites=${favoriteCount}, images=${imageFiles.length})`
      )
      return {
        ok: true,
        canceled: false,
        path: filePath,
        historyCount,
        favoriteCount,
        imageCount: imageFiles.length
      }
    } catch (err) {
      log.error('[clipboard] backup export failed:', err)
      return { ok: false, canceled: false, error: String((err as Error)?.message ?? err) }
    }
  }

  /** 导入剪贴板记录备份：mode='merge' 保留双方；mode='replace' 清空后完全替换 */
  async importBackup(mode: BackupImportMode): Promise<BackupImportResult> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入剪贴板记录备份',
      properties: ['openFile'],
      filters: [{ name: 'Prism 剪贴板备份', extensions: [BACKUP_EXTENSION.slice(1)] }]
    })
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true }

    const srcPath = filePaths[0]
    try {
      const zip = new AdmZip(srcPath)
      const manifestEntry = zip.getEntry('manifest.json')
      const dbEntry = zip.getEntry('clipboard.db')
      if (!manifestEntry || !dbEntry) {
        return {
          ok: false,
          canceled: false,
          error: '不是有效的 Prism 备份文件（缺少 manifest.json 或 clipboard.db）'
        }
      }

      let manifest: { app?: string; formatVersion?: number }
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf-8'))
      } catch {
        return { ok: false, canceled: false, error: '备份文件 manifest 解析失败' }
      }
      if (manifest.app !== 'prism2' || manifest.formatVersion !== 1) {
        return {
          ok: false,
          canceled: false,
          error: `不支持的备份格式（app=${manifest.app ?? '未知'}, version=${manifest.formatVersion ?? '未知'}）`
        }
      }

      // 用独立的 sql.js 实例读取备份 DB，不改动当前服务实例的数据库
      const SQL = await initSqlJs({
        locateFile: (file) => join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file)
      })
      const backupDb = new SQL.Database(dbEntry.getData())
      const backupHistory = this.#readTable(backupDb, 'SELECT * FROM clipboard_history')
      const backupFavorites = this.#readTable(backupDb, 'SELECT * FROM favorites')
      backupDb.close()

      const importMode: BackupImportMode = mode === 'replace' ? 'replace' : 'merge'
      let importedHistory = 0
      let importedFavorites = 0
      let importedImages = 0
      let skippedHistory = 0
      let skippedFavorites = 0
      let skippedImages = 0

      if (importMode === 'replace') {
        this.run('DELETE FROM clipboard_history')
        this.run('DELETE FROM favorites')
        this.#clearImageFiles()
      }

      for (const row of backupHistory) {
        this.db?.run(
          'INSERT OR IGNORE INTO clipboard_history (id, content, created_at, type) VALUES (?, ?, ?, ?)',
          [row.id, row.content, row.created_at, row.type]
        )
        if ((this.db?.getRowsModified() ?? 0) > 0) {
          importedHistory++
        } else {
          skippedHistory++
        }
      }

      for (const row of backupFavorites) {
        this.db?.run(
          'INSERT OR IGNORE INTO favorites (id, content, category, description, created_at) VALUES (?, ?, ?, ?, ?)',
          [row.id, row.content, row.category, row.description, row.created_at]
        )
        if ((this.db?.getRowsModified() ?? 0) > 0) {
          importedFavorites++
        } else {
          skippedFavorites++
        }
      }

      const imageEntries = zip
        .getEntries()
        .filter((e) => !e.isDirectory && e.entryName.startsWith('images/'))
      for (const entry of imageEntries) {
        const name = basename(entry.entryName)
        if (!IMAGE_NAME_RE.test(name)) continue
        const dest = this.#imagePath(name)
        if (importMode === 'merge' && existsSync(dest)) {
          skippedImages++
          continue
        }
        writeFileSync(dest, entry.getData())
        importedImages++
      }

      this.save()
      this.#notifyHistoryChanged()

      log.info(
        `[clipboard] backup imported: ${srcPath} mode=${importMode} (history+${importedHistory}/skip${skippedHistory}, favorites+${importedFavorites}/skip${skippedFavorites}, images+${importedImages}/skip${skippedImages})`
      )
      return {
        ok: true,
        canceled: false,
        importedHistory,
        importedFavorites,
        importedImages,
        skippedHistory,
        skippedFavorites,
        skippedImages
      }
    } catch (err) {
      log.error('[clipboard] backup import failed:', err)
      return { ok: false, canceled: false, error: String((err as Error)?.message ?? err) }
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
    ipcMain.handle(C.deleteHistoryBatch, (_e, ids: number[]) => this.deleteBatch(ids))
    ipcMain.handle(C.clearHistory, () => this.clearAll())
    ipcMain.handle(C.getHistoryCount, () => this.getHistoryCount())
    ipcMain.handle(C.getRetentionState, () => this.getRetentionState())
    ipcMain.handle(C.setRetentionState, (_e, partial: Partial<ClipboardRetention>) =>
      this.setRetentionState(partial ?? {})
    )
    ipcMain.handle(C.getImageData, (_e, filename: string) =>
      this.getImageData(String(filename ?? ''))
    )

    ipcMain.handle(C.clickItem, async (event, payload: { content?: string; type?: string }) => {
      const content = String(payload?.content ?? '')
      const type: HistoryItem['type'] = payload?.type === 'image' ? 'image' : 'text'
      if (!content) return

      if (type === 'image') {
        if (!IMAGE_NAME_RE.test(content)) return
        const path = this.#imagePath(content)
        if (!existsSync(path)) return
        const ext = content.split('.').pop()?.toLowerCase()
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext ?? 'png'}`
        const data = readFileSync(path)
        await clipboard.write([new ClipboardItem({ [mime]: new Blob([data]) })])
      } else {
        await clipboard.writeText(content)
      }
      await this.syncMonitorCache()

      // 退场时应最小化"真正持有焦点的那个窗口"，才能把焦点可靠交还给上一个前台应用：
      // - 主页面是普通任务栏窗口，minimize() 会可靠归还焦点；
      // - 快捷粘贴是 alwaysOnTop + skipTaskbar 的工具窗，不能靠隐藏主页面来归还焦点，
      //   否则焦点回不到上一个应用，后续 SendKeys 的 ^v 就发到错误窗口。
      const senderWin = BrowserWindow.fromWebContents(event.sender)
      const quickPasteWin = windowFactory.getQuickPasteFrame().getWindow()

      if (senderWin && quickPasteWin && senderWin === quickPasteWin) {
        // 从快捷粘贴窗口发起：最小化它来归还焦点（内部抑制 blur 自动隐藏）
        await windowFactory.getQuickPasteFrame().dismissForPaste()
      } else {
        // 从主页面发起：关闭快捷粘贴（若有），并最小化主页面归还焦点
        windowFactory.hideQuickPaste()
        const mainPageFrame = windowFactory.getMainPageFrame()
        mainPageFrame.minimizeForPaste()
        // 等待窗口最小化后的前台焦点转移稳定
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

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

    ipcMain.handle(C.exportBackup, () => this.exportBackup())
    ipcMain.handle(C.importBackup, (_e, mode: BackupImportMode) =>
      this.importBackup(mode === 'replace' ? 'replace' : 'merge')
    )
  }
}

export const clipboardService = new ClipboardService()
