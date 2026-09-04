/**
 * 便利贴服务
 * @description 本地便签：增删改 + 置顶，用 sql.js 持久化到 userData/sticky-notes.db。
 *
 * v2 架构：
 * - 继承 SqliteStore，复用 sql.js 初始化 / 落盘 / 结果解析。
 * - 数据量小，全量拉取即可，无分页、无广播（唯一编辑入口为便利贴视图）。
 * - 所有 IPC handler 入参做类型收窄的防御性处理。
 */
import { ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import log from 'electron-log'
import type { Database } from 'sql.js'
import { SqliteStore } from './db/sqliteDatabase'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { BackupImportMode, StickyNote, StickyNoteColor } from '@preload/ipc'

/** 合法便利贴颜色（非法值回落默认） */
const COLORS: readonly StickyNoteColor[] = ['lavender', 'mint', 'yellow', 'blue', 'violet']
const DEFAULT_COLOR: StickyNoteColor = 'lavender'

/** 防御性收窄：非法颜色回落为默认色 */
function normalizeColor(color: unknown): StickyNoteColor {
  return COLORS.includes(color as StickyNoteColor) ? (color as StickyNoteColor) : DEFAULT_COLOR
}

class StickyNotesService extends SqliteStore {
  constructor() {
    super('sticky-notes.db', 'StickyNotesService')
  }

  /** 初始化：建表 + 索引 + 注册 IPC */
  async init(): Promise<void> {
    await this.open()

    this.run(
      `CREATE TABLE IF NOT EXISTS sticky_notes (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         content TEXT NOT NULL,
         color TEXT NOT NULL DEFAULT 'lavender',
         pinned INTEGER NOT NULL DEFAULT 0,
         home_x INTEGER,
         home_y INTEGER,
         home_w INTEGER,
         home_h INTEGER,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`
    )
    // 旧库迁移：补充 home_x/home_y（贴主页拖拽位置）与 home_w/home_h（尺寸）列，未设置过为 NULL
    const columns = this.all<{ name: string }>('PRAGMA table_info(sticky_notes)')
    if (!columns.some((c) => c.name === 'home_x')) {
      this.run('ALTER TABLE sticky_notes ADD COLUMN home_x INTEGER')
    }
    if (!columns.some((c) => c.name === 'home_y')) {
      this.run('ALTER TABLE sticky_notes ADD COLUMN home_y INTEGER')
    }
    if (!columns.some((c) => c.name === 'home_w')) {
      this.run('ALTER TABLE sticky_notes ADD COLUMN home_w INTEGER')
    }
    if (!columns.some((c) => c.name === 'home_h')) {
      this.run('ALTER TABLE sticky_notes ADD COLUMN home_h INTEGER')
    }

    this.run('CREATE INDEX IF NOT EXISTS idx_notes_pin_created ON sticky_notes(pinned DESC, created_at DESC)')

    this.save()
    this.registerIPC()
  }

  /** 停止服务：落盘并关闭数据库 */
  stop(): void {
    this.close()
  }

  /** 查询全部便利贴：置顶在前，其余按创建时间倒序 */
  getAll(): StickyNote[] {
    return this.all<StickyNote>('SELECT * FROM sticky_notes ORDER BY pinned DESC, created_at DESC')
  }

  add(content: string, color: unknown, pinned?: unknown): number {
    const now = Date.now()
    this.run(
      'INSERT INTO sticky_notes (content, color, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [content, normalizeColor(color), pinned ? 1 : 0, now, now]
    )
    this.save()
    return this.lastInsertId()
  }

  update(id: number, content: string, color: unknown): void {
    this.run('UPDATE sticky_notes SET content = ?, color = ?, updated_at = ? WHERE id = ?', [
      content,
      normalizeColor(color),
      Date.now(),
      id
    ])
    this.save()
  }

  delete(id: number): void {
    this.run('DELETE FROM sticky_notes WHERE id = ?', [id])
    this.save()
  }

  /** 翻转置顶（贴到主页）状态 */
  togglePin(id: number): void {
    this.run('UPDATE sticky_notes SET pinned = 1 - pinned, updated_at = ? WHERE id = ?', [
      Date.now(),
      id
    ])
    this.save()
  }

  /** 记录便利贴在主页画布上的位置（钳制非负整数） */
  setPosition(id: number, x: number, y: number): void {
    const px = Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0
    const py = Number.isFinite(y) ? Math.max(0, Math.floor(y)) : 0
    this.run('UPDATE sticky_notes SET home_x = ?, home_y = ?, updated_at = ? WHERE id = ?', [
      px,
      py,
      Date.now(),
      id
    ])
    this.save()
  }

  /** 记录便利贴在主页画布上的尺寸（钳制非负整数） */
  setSize(id: number, w: number, h: number): void {
    const pw = Number.isFinite(w) ? Math.max(0, Math.floor(w)) : 0
    const ph = Number.isFinite(h) ? Math.max(0, Math.floor(h)) : 0
    this.run('UPDATE sticky_notes SET home_w = ?, home_h = ?, updated_at = ? WHERE id = ?', [
      pw,
      ph,
      Date.now(),
      id
    ])
    this.save()
  }

  // -------------------------------------------------------------------------
  // 备份导出 / 导入（由 ClipboardService 备份流程调用，不注册独立 IPC）
  // -------------------------------------------------------------------------

  /** 导出：返回当前库文件字节（供备份打包）；库未就绪返回 null */
  exportDb(): Buffer | null {
    if (!this.db) return null
    this.saveNow()
    try {
      return readFileSync(this.filePath)
    } catch (err) {
      log.error('[StickyNotesService] exportDb 失败:', err)
      return null
    }
  }

  /**
   * 从外部备份库导入便利贴（merge=按 id INSERT OR IGNORE 保留双方；replace=清空后完全替换）。
   * @param db - 备份 zip 中解析出的独立 sql.js 实例（只读，由调用方负责 close）
   * @returns 导入/跳过计数
   */
  importBackupData(
    db: Database,
    mode: BackupImportMode
  ): { imported: number; skipped: number } {
    const res = db.exec('SELECT * FROM sticky_notes')
    const cols = res[0]?.columns ?? []
    const rows = res[0]?.values ?? []
    if (mode === 'replace') this.run('DELETE FROM sticky_notes')

    let imported = 0
    let skipped = 0
    for (const row of rows) {
      const o: Record<string, unknown> = {}
      cols.forEach((c, i) => (o[c] = row[i]))
      this.db?.run(
        'INSERT OR IGNORE INTO sticky_notes (id, content, color, pinned, home_x, home_y, home_w, home_h, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          o.id,
          o.content,
          normalizeColor(o.color),
          o.pinned ? 1 : 0,
          o.home_x,
          o.home_y,
          o.home_w,
          o.home_h,
          o.created_at,
          o.updated_at
        ]
      )
      if ((this.db?.getRowsModified() ?? 0) > 0) {
        imported++
      } else {
        skipped++
      }
    }
    this.saveNow()
    return { imported, skipped }
  }

  private registerIPC(): void {
    const N = SERVICE_CHANNELS.stickyNotes

    ipcMain.handle(N.getNotes, () => this.getAll())
    ipcMain.handle(N.addNote, (_e, content: string, color?: string, pinned?: boolean) =>
      this.add(String(content ?? ''), color, pinned)
    )
    ipcMain.handle(N.updateNote, (_e, id: number, content: string, color?: string) =>
      this.update(Number(id), String(content ?? ''), color)
    )
    ipcMain.handle(N.deleteNote, (_e, id: number) => this.delete(Number(id)))
    ipcMain.handle(N.togglePin, (_e, id: number) => this.togglePin(Number(id)))
    ipcMain.handle(N.setNotePosition, (_e, id: number, x: number, y: number) =>
      this.setPosition(Number(id), Number(x), Number(y))
    )
    ipcMain.handle(N.setNoteSize, (_e, id: number, w: number, h: number) =>
      this.setSize(Number(id), Number(w), Number(h))
    )
  }
}

export const stickyNotesService = new StickyNotesService()
