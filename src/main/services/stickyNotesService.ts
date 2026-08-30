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
import { SqliteStore } from './db/sqliteDatabase'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { StickyNote, StickyNoteColor } from '@preload/ipc'

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
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`
    )
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

  add(content: string, color: unknown): number {
    const now = Date.now()
    this.run(
      'INSERT INTO sticky_notes (content, color, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      [content, normalizeColor(color), now, now]
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

  /** 翻转置顶状态 */
  togglePin(id: number): void {
    this.run('UPDATE sticky_notes SET pinned = 1 - pinned, updated_at = ? WHERE id = ?', [
      Date.now(),
      id
    ])
    this.save()
  }

  private registerIPC(): void {
    const N = SERVICE_CHANNELS.stickyNotes

    ipcMain.handle(N.getNotes, () => this.getAll())
    ipcMain.handle(N.addNote, (_e, content: string, color?: string) =>
      this.add(String(content ?? ''), color)
    )
    ipcMain.handle(N.updateNote, (_e, id: number, content: string, color?: string) =>
      this.update(Number(id), String(content ?? ''), color)
    )
    ipcMain.handle(N.deleteNote, (_e, id: number) => this.delete(Number(id)))
    ipcMain.handle(N.togglePin, (_e, id: number) => this.togglePin(Number(id)))
  }
}

export const stickyNotesService = new StickyNotesService()
