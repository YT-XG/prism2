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
 * - 新内容同步触发通知服务（受「通知中心 / 剪贴板新内容」开关控制），通知中心留存历史。
 * - 所有 IPC handler 入参做类型收窄的防御性处理。
 */
import {
  ipcMain,
  clipboard,
  nativeImage,
  ClipboardItem,
  app,
  dialog,
  BrowserWindow
} from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import log from 'electron-log'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import AdmZip from 'adm-zip'
import { SqliteStore } from './db/sqliteDatabase'
import { inputService } from './inputService'
import { settingsService } from './settingsService'
import { notificationService } from './notificationService'
import { stickyNotesService } from './stickyNotesService'
import { quickFoldersService } from './quickFoldersService'
import { windowFactory } from '../frame/WindowFactory'
import { broadcast, minimizeWindowForPaste } from '../utils/platform'
import { BACKUP_EXTENSION, BACKUP_SECTIONS, BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type {
  HistoryItem,
  FavoriteItem,
  CategoryItem,
  ClipboardRetention,
  BackupImportMode,
  BackupExportResult,
  BackupInspectResult,
  BackupImportResult,
  BackupSection,
  FavoritesCursor
} from '@preload/ipc'

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 1000
/** 图片廉价签名采样字节数：只读前缀即可判断剪贴板图片是否变化，避免每轮整图读取 + 全量 SHA-1 */
const SAMPLE_BYTES = 4096
/** 自动清理执行间隔（ms，每小时一次） */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
/** 落盘防抖（ms）：高频复制时不至于每秒全量写盘 */
const SAVE_DEBOUNCE_MS = 2000
/** 保留期配置变更后的延迟清理（ms）：把 value/unit/autoClean 的连续改动合并为一次最终清理，避免中间态误删 */
const CLEANUP_DEBOUNCE_MS = 5000
/** 图片文件名合法格式（防御路径穿越；与 imageProtocol.ts 保持一致，禁用纯 `.`/`..`/首尾点） */
const IMAGE_NAME_RE = /^[\w-]+(?:\.[\w-]+)*$/

/** 备份文件内 manifest.json 的结构（app 标识 + 格式版本用于校验） */
interface BackupManifest {
  app: string
  formatVersion: number
  exportedAt: string
  /** 本次写入的分区（用户勾选） */
  sections: BackupSection[]
  historyCount: number
  favoriteCount: number
  imageCount: number
  stickyNoteCount: number
  quickFolderCount: number
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

  /** 上次剪贴板图片的廉价签名（image:<字节数>:<前4KB sha1>）：内容未变时跳过整图读取 */
  private lastCheapSig = ''

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
         type TEXT NOT NULL DEFAULT 'text',
         created_at INTEGER NOT NULL
       )`
    )
    // 旧库迁移：补充 type 列（富文本片段）
    const favColumns = this.all<{ name: string }>('PRAGMA table_info(favorites)')
    if (!favColumns.some((c) => c.name === 'type')) {
      this.run("ALTER TABLE favorites ADD COLUMN type TEXT NOT NULL DEFAULT 'text'")
    }
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
      this.saveNow()
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
        this.lastCheapSig = ''
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
      if (blob.size === 0) continue

      // 廉价预检：只读前 SAMPLE_BYTES 字节 + 大小，判断图片是否变化。
      // 截屏在剪贴板长期停留时，稳态轮询不必每 1s 整图读入 + 全量 SHA-1，显著降 CPU/内存。
      const sample = Buffer.from(await (blob.slice(0, SAMPLE_BYTES)).arrayBuffer())
      const cheapSig = `image:${blob.size}:${createHash('sha1').update(sample).digest('hex')}`
      if (cheapSig === this.lastCheapSig) {
        // 内容未变：沿用上次完整签名，不读全图、不做全量哈希
        return { sig: this.lastSignature, image: null }
      }

      // 变化（或首次）：全量读取 + 完整 SHA-1（用于去重文件名与入库），仅在此时发生一次
      const buf = Buffer.from(await blob.arrayBuffer())
      if (buf.length === 0) continue
      this.lastCheapSig = cheapSig
      return { sig: 'image:' + createHash('sha1').update(buf).digest('hex'), image: { buf, mime } }
    }
    const text = await clipboard.readText()
    // 剪贴板当前为文本（离开图片态）：遗忘上次图片缓存，保证之后重新复制同一图片仍能触发置顶去重
    this.lastCheapSig = ''
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
        // 通知：重新复制的既有内容同样提醒（仅浮窗弹出，不入通知中心——剪贴板历史已有记录）
        notificationService.notify({
          type: 'info',
          source: 'clipboard',
          title: '剪贴板新内容',
          message: type === 'image' ? '已复制一张图片' : content.substring(0, 120),
          persist: false
        })
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

      // 通知：新剪贴板内容（受「剪贴板新内容」开关控制；仅浮窗弹出不入通知中心——剪贴板历史已有记录）
      notificationService.notify({
        type: 'info',
        source: 'clipboard',
        title: '剪贴板新内容',
        message: type === 'image' ? '已复制一张图片' : content.substring(0, 120),
        persist: false
      })
    } catch (err) {
      log.error('[ClipboardService] 插入失败:', err)
    }
  }

  /** 落盘防抖：短时间多次写入合并为一次全量导出（服务级防抖后立即持久化，避免再叠加基类防抖延迟） */
  #saveDebounced(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
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
    // 仅搜索文本/富文本记录；图片的 content 是文件名，参与搜索无意义。
    // 富文本存 HTML，其文本子串可被 LIKE 命中（跨标签断词偶发漏搜属已知局限）。
    return this.all<HistoryItem>(
      "SELECT * FROM clipboard_history WHERE type IN ('text', 'richtext') AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 50",
      [`%${this.#escapeLike(keyword)}%`]
    )
  }

  getHistoryCount(): number {
    return this.one<{ count: number }>('SELECT COUNT(*) AS count FROM clipboard_history')?.count ?? 0
  }

  getFavorites(limit?: number, before?: FavoritesCursor, category?: string): FavoriteItem[] {
    // limit 缺省为单页上限（避免无界增长时全量经 IPC 传表）；before 为 keyset 游标（上一页末项），
    // category 存在时按分类过滤并在该分类内继续游标分页
    const safeLimit =
      typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 200
    const params: SqlValue[] = []
    const conds: string[] = []

    if (before && Number.isFinite(before.createdAt) && Number.isFinite(before.id)) {
      // keyset：ORDER BY created_at DESC, id DESC 对应的稳定翻页条件（避免 OFFSET 在新插入置顶项时漂移）
      conds.push('(created_at < ? OR (created_at = ? AND id < ?))')
      params.push(before.createdAt, before.createdAt, before.id)
    }
    if (category) {
      conds.push('category = ?')
      params.push(category)
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    params.push(safeLimit)

    return this.all<FavoriteItem>(
      `SELECT * FROM favorites ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params
    )
  }

  getFavoritesCount(): number {
    return this.one<{ count: number }>('SELECT COUNT(*) AS count FROM favorites')?.count ?? 0
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
      "SELECT * FROM favorites WHERE content LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 200",
      [`%${this.#escapeLike(keyword)}%`, `%${this.#escapeLike(keyword)}%`]
    )
  }

  /** LIKE 通配符转义（% _ \），配合 ESCAPE '\' 使用 */
  #escapeLike(keyword: string): string {
    return keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  }

  /** 去除 HTML 标签得到纯文本（富文本记录写系统剪贴板时附纯文本版本用） */
  #stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  // -------------------------------------------------------------------------
  // 收藏 CRUD
  // -------------------------------------------------------------------------

  addFavorite(content: string, category = '', description = '', type: FavoriteItem['type'] = 'text'): number {
    const now = Date.now()
    this.run(
      'INSERT INTO favorites (content, category, description, type, created_at) VALUES (?, ?, ?, ?, ?)',
      [content, category, description, type, now]
    )
    this.save()
    return this.lastInsertId()
  }

  updateFavorite(
    id: number,
    content: string,
    category: string,
    description: string,
    type: FavoriteItem['type'] = 'text'
  ): void {
    this.run('UPDATE favorites SET content = ?, category = ?, description = ?, type = ? WHERE id = ?', [
      content,
      category,
      description,
      type,
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
  // 历史删除 / 编辑
  // -------------------------------------------------------------------------

  /**
   * 修改历史记录内容（编辑后按富文本存储）。
   * @returns 是否成功（记录不存在或为图片时返回 false）
   */
  updateHistoryContent(id: number, content: string): boolean {
    const row = this.one<{ type: string }>(
      'SELECT type FROM clipboard_history WHERE id = ?',
      [id]
    )
    if (!row || row.type === 'image') return false
    // 保留 created_at：编辑不置顶，记录保持在原位置
    this.run("UPDATE clipboard_history SET content = ?, type = 'richtext' WHERE id = ?", [content, id])
    this.save()
    this.#notifyHistoryChanged()
    return true
  }

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

  /** 校验备份 zip 的 manifest（app 标识 + 格式版本），返回解析结果或错误信息 */
  #validateManifest(zip: AdmZip): { manifest: BackupManifest | null; error?: string } {
    const entry = zip.getEntry('manifest.json')
    if (!entry) {
      return { manifest: null, error: '不是有效的 Prism 备份文件（缺少 manifest.json）' }
    }
    let manifest: BackupManifest
    try {
      manifest = JSON.parse(entry.getData().toString('utf-8'))
    } catch {
      return { manifest: null, error: '备份文件 manifest 解析失败' }
    }
    if (manifest.app !== 'prism2' || manifest.formatVersion !== 1) {
      return {
        manifest: null,
        error: `不支持的备份格式（app=${manifest.app ?? '未知'}, version=${manifest.formatVersion ?? '未知'}）`
      }
    }
    return { manifest }
  }

  /**
   * 导出备份（zip 打包，扩展名 .prismbackup）。
   * @param sections - 用户勾选的数据分区：clipboard（clipboard.db + 图片）/ stickyNotes（sticky-notes.db）/ quickFolders（quick-folders.db）
   */
  async exportBackup(sections: BackupSection[]): Promise<BackupExportResult> {
    const selected = BACKUP_SECTIONS.filter((s) => sections.includes(s))
    if (selected.length === 0) {
      return { ok: false, canceled: false, error: '未选择任何要导出的数据' }
    }

    // 先把内存中防抖中的变更落盘，保证备份的是最新数据
    this.saveNow()
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '')
      .replace('T', '-')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: `Prism-backup-${stamp}${BACKUP_EXTENSION}`,
      filters: [{ name: 'Prism 备份', extensions: [BACKUP_EXTENSION.slice(1)] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }

    try {
      const historyCount = this.getHistoryCount()
      const favoriteCount = this.getFavorites().length
      const imageFiles = this.#listImageFiles()
      const stickyNoteCount = stickyNotesService.getAll().length
      const quickFolderCount = quickFoldersService.getAll().length
      const manifest: BackupManifest = {
        app: 'prism2',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        sections: selected,
        historyCount,
        favoriteCount,
        imageCount: imageFiles.length,
        stickyNoteCount,
        quickFolderCount
      }

      const zip = new AdmZip()
      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))
      if (selected.includes('clipboard')) {
        if (existsSync(this.filePath)) zip.addFile('clipboard.db', readFileSync(this.filePath))
        for (const f of imageFiles) {
          const abs = this.#imagePath(f)
          if (existsSync(abs)) zip.addLocalFile(abs, 'images')
        }
      }
      if (selected.includes('stickyNotes')) {
        const db = stickyNotesService.exportDb()
        if (db) zip.addFile('sticky-notes.db', db)
      }
      if (selected.includes('quickFolders')) {
        const db = quickFoldersService.exportDb()
        if (db) zip.addFile('quick-folders.db', db)
      }
      zip.writeZip(filePath)

      log.info(
        `[clipboard] backup exported: ${filePath} sections=${selected.join(',')} (history=${historyCount}, favorites=${favoriteCount}, images=${imageFiles.length}, notes=${stickyNoteCount}, folders=${quickFolderCount})`
      )
      return {
        ok: true,
        canceled: false,
        path: filePath,
        sections: selected,
        historyCount,
        favoriteCount,
        imageCount: imageFiles.length,
        stickyNoteCount,
        quickFolderCount
      }
    } catch (err) {
      log.error('[clipboard] backup export failed:', err)
      return { ok: false, canceled: false, error: String((err as Error)?.message ?? err) }
    }
  }

  /**
   * 导入备份第一步：弹打开对话框并检查备份内容。
   * 按 zip 内实际存在的库文件判定可用分区（兼容旧版备份只含 clipboard.db），供渲染端勾选。
   */
  async inspectBackup(): Promise<BackupInspectResult> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入备份',
      properties: ['openFile'],
      filters: [{ name: 'Prism 备份', extensions: [BACKUP_EXTENSION.slice(1)] }]
    })
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true }

    const srcPath = filePaths[0]
    try {
      const zip = new AdmZip(srcPath)
      const check = this.#validateManifest(zip)
      if (!check.manifest) {
        return { ok: false, canceled: false, error: check.error }
      }
      const sections: BackupSection[] = []
      if (zip.getEntry('clipboard.db')) sections.push('clipboard')
      if (zip.getEntry('sticky-notes.db')) sections.push('stickyNotes')
      if (zip.getEntry('quick-folders.db')) sections.push('quickFolders')
      if (sections.length === 0) {
        return { ok: false, canceled: false, error: '备份文件内没有可导入的数据' }
      }
      return { ok: true, canceled: false, path: srcPath, sections }
    } catch (err) {
      log.error('[clipboard] backup inspect failed:', err)
      return { ok: false, canceled: false, error: String((err as Error)?.message ?? err) }
    }
  }

  /**
   * 导入备份第二步：按用户勾选的分区导入指定备份文件。
   * @param path - inspectBackup 返回的备份文件路径
   * @param sections - 用户勾选的数据分区
   * @param mode - merge 保留双方；replace 清空所选分区后完全替换
   */
  async importBackup(
    path: string,
    sections: BackupSection[],
    mode: BackupImportMode
  ): Promise<BackupImportResult> {
    const selected = BACKUP_SECTIONS.filter((s) => sections.includes(s))
    if (selected.length === 0) {
      return { ok: false, canceled: false, error: '未选择任何要导入的数据' }
    }

    const srcPath = path
    try {
      const zip = new AdmZip(srcPath)
      const check = this.#validateManifest(zip)
      if (!check.manifest) {
        return { ok: false, canceled: false, error: check.error }
      }

      const importMode: BackupImportMode = mode === 'replace' ? 'replace' : 'merge'
      let importedHistory = 0
      let importedFavorites = 0
      let importedImages = 0
      let importedStickyNotes = 0
      let importedQuickFolders = 0
      let skippedHistory = 0
      let skippedFavorites = 0
      let skippedImages = 0
      let skippedStickyNotes = 0
      let skippedQuickFolders = 0

      const wantClipboard = selected.includes('clipboard')
      const wantNotes = selected.includes('stickyNotes')
      const wantFolders = selected.includes('quickFolders')

      if (wantClipboard) {
        const dbEntry = zip.getEntry('clipboard.db')
        if (!dbEntry) {
          return { ok: false, canceled: false, error: '备份文件缺少 clipboard.db' }
        }

        // 用独立的 sql.js 实例读取备份 DB，不改动当前服务实例的数据库
        const SQL = await initSqlJs({
          locateFile: (file) => join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file)
        })
        const backupDb = new SQL.Database(dbEntry.getData())
        const backupHistory = this.#readTable(backupDb, 'SELECT * FROM clipboard_history')
        const backupFavorites = this.#readTable(backupDb, 'SELECT * FROM favorites')
        backupDb.close()

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
            'INSERT OR IGNORE INTO favorites (id, content, category, description, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [row.id, row.content, row.category, row.description, row.type === 'richtext' ? 'richtext' : 'text', row.created_at]
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
      }

      if (wantNotes) {
        const entry = zip.getEntry('sticky-notes.db')
        if (entry) {
          const SQL = await initSqlJs({
            locateFile: (file) => join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file)
          })
          const backupDb = new SQL.Database(entry.getData())
          const r = stickyNotesService.importBackupData(backupDb, importMode)
          backupDb.close()
          importedStickyNotes = r.imported
          skippedStickyNotes = r.skipped
        }
      }

      if (wantFolders) {
        const entry = zip.getEntry('quick-folders.db')
        if (entry) {
          const SQL = await initSqlJs({
            locateFile: (file) => join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file)
          })
          const backupDb = new SQL.Database(entry.getData())
          const r = quickFoldersService.importBackupData(backupDb, importMode)
          backupDb.close()
          importedQuickFolders = r.imported
          skippedQuickFolders = r.skipped
        }
      }

      this.saveNow()
      if (wantClipboard) this.#notifyHistoryChanged()

      log.info(
        `[clipboard] backup imported: ${srcPath} mode=${importMode} sections=${selected.join(',')} (history+${importedHistory}/skip${skippedHistory}, favorites+${importedFavorites}/skip${skippedFavorites}, images+${importedImages}/skip${skippedImages}, notes+${importedStickyNotes}/skip${skippedStickyNotes}, folders+${importedQuickFolders}/skip${skippedQuickFolders})`
      )
      return {
        ok: true,
        canceled: false,
        importedHistory,
        importedFavorites,
        importedImages,
        importedStickyNotes,
        importedQuickFolders,
        skippedHistory,
        skippedFavorites,
        skippedImages,
        skippedStickyNotes,
        skippedQuickFolders
      }
    } catch (err) {
      log.error('[clipboard] backup import failed:', err)
      return { ok: false, canceled: false, error: String((err as Error)?.message ?? err) }
    }
  }

  // -------------------------------------------------------------------------
  // 旧版（v1）数据一次性合并导入
  // -------------------------------------------------------------------------

  /**
   * 合并导入旧版剪贴板数据（INSERT OR IGNORE 按主键 id 去重，不覆盖 v2 已有记录）。
   * @param history - 旧版历史行（type 缺失时按 'text' 处理）
   * @param favorites - 旧版收藏行
   * @returns 导入/跳过计数
   */
  importLegacyData(
    history: Array<{ id: number; content: string; created_at: number; type?: string }>,
    favorites: Array<{
      id: number
      content: string
      category?: string
      description?: string
      created_at: number
    }>
  ): { importedHistory: number; importedFavorites: number; skippedHistory: number; skippedFavorites: number } {
    let importedHistory = 0
    let importedFavorites = 0
    let skippedHistory = 0
    let skippedFavorites = 0
    for (const row of history) {
      this.db?.run(
        'INSERT OR IGNORE INTO clipboard_history (id, content, created_at, type) VALUES (?, ?, ?, ?)',
        [row.id, row.content, row.created_at, row.type === 'image' ? 'image' : 'text']
      )
      if ((this.db?.getRowsModified() ?? 0) > 0) {
        importedHistory++
      } else {
        skippedHistory++
      }
    }
    for (const row of favorites) {
      this.db?.run(
        'INSERT OR IGNORE INTO favorites (id, content, category, description, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [row.id, row.content, row.category ?? '', row.description ?? '', 'text', row.created_at]
      )
      if ((this.db?.getRowsModified() ?? 0) > 0) {
        importedFavorites++
      } else {
        skippedFavorites++
      }
    }
    this.saveNow()
    this.#notifyHistoryChanged()
    return { importedHistory, importedFavorites, skippedHistory, skippedFavorites }
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
    ipcMain.handle(C.updateHistory, (_e, id: number, content: string) =>
      this.updateHistoryContent(Number(id), String(content ?? ''))
    )
    ipcMain.handle(C.getHistoryCount, () => this.getHistoryCount())
    ipcMain.handle(C.getRetentionState, () => this.getRetentionState())
    ipcMain.handle(C.setRetentionState, (_e, partial: Partial<ClipboardRetention>) =>
      this.setRetentionState(partial ?? {})
    )

    ipcMain.handle(C.clickItem, async (e, payload: { content?: string; type?: string }) => {
      const content = String(payload?.content ?? '')
      const type: HistoryItem['type'] =
        payload?.type === 'image' ? 'image' : payload?.type === 'richtext' ? 'richtext' : 'text'
      if (!content) return

      if (type === 'image') {
        if (!IMAGE_NAME_RE.test(content)) return
        const path = this.#imagePath(content)
        if (!existsSync(path)) return
        const ext = content.split('.').pop()?.toLowerCase()
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext ?? 'png'}`
        const data = readFileSync(path)
        await clipboard.write([new ClipboardItem({ [mime]: new Blob([data]) })])
      } else if (type === 'richtext') {
        // 富文本：同时写 HTML 与纯文本，目标应用尽量保留格式
        await clipboard.write([
          new ClipboardItem({ 'text/html': new Blob([content], { type: 'text/html' }) }),
          new ClipboardItem({ 'text/plain': new Blob([this.#stripHtml(content)], { type: 'text/plain' }) })
        ])
      } else {
        await clipboard.writeText(content)
      }
      await this.syncMonitorCache()

      // 退场时应最小化唤起方窗口（主窗口 / 全局搜索窗），把焦点可靠交还给上一个前台应用，
      // 后续 SendKeys 的 ^v 才能发到正确窗口。用 minimize 而非 hide：hide 在 Windows 上焦点交还不可靠。
      const invoker = BrowserWindow.fromWebContents(e.sender)
      if (invoker && !invoker.isDestroyed() && invoker.isVisible()) {
        minimizeWindowForPaste(invoker)
      } else {
        // 唤起方不可见（异常路径）时兜底最小化主窗口
        windowFactory.getMainPageFrame().minimizeForPaste()
      }
      // 等待窗口最小化后的前台焦点转移稳定
      await new Promise((resolve) => setTimeout(resolve, 250))

      await inputService.pasteToPreviousWindow()
    })

    ipcMain.handle(C.getFavorites, (_e, limit?: number, before?: FavoritesCursor, category?: string) =>
      this.getFavorites(limit, before, String(category ?? '') || undefined)
    )
    ipcMain.handle(C.getFavoritesCount, () => this.getFavoritesCount())
    ipcMain.handle(C.getFavoritesByCategory, (_e, category: string) =>
      this.getFavoritesByCategory(String(category ?? ''))
    )
    ipcMain.handle(C.getCategories, () => this.getCategories())
    ipcMain.handle(C.searchSnippets, (_e, keyword: string) =>
      this.searchFavorites(String(keyword ?? ''))
    )
    ipcMain.handle(C.addFavorite, (_e, content: string, category?: string, description?: string, type?: string) =>
      this.addFavorite(
        String(content ?? ''),
        category ?? '',
        description ?? '',
        type === 'richtext' ? 'richtext' : 'text'
      )
    )
    ipcMain.handle(
      C.updateFavorite,
      (_e, id: number, content: string, category: string, description: string, type?: string) =>
        this.updateFavorite(
          Number(id),
          String(content ?? ''),
          String(category ?? ''),
          String(description ?? ''),
          type === 'richtext' ? 'richtext' : 'text'
        )
    )
    ipcMain.handle(C.deleteFavorite, (_e, id: number) => this.deleteFavorite(Number(id)))
    ipcMain.handle(C.clearFavorites, () => this.clearAllFavorites())

    ipcMain.handle(C.writeText, (_e, text: string) => this.writeText(String(text ?? '')))

    ipcMain.handle(C.exportBackup, (_e, sections: BackupSection[]) =>
      this.exportBackup(Array.isArray(sections) ? sections : [])
    )
    ipcMain.handle(C.inspectBackup, () => this.inspectBackup())
    ipcMain.handle(C.importBackup, (_e, path: string, sections: BackupSection[], mode: BackupImportMode) =>
      this.importBackup(String(path ?? ''), Array.isArray(sections) ? sections : [], mode)
    )
  }
}

export const clipboardService = new ClipboardService()
