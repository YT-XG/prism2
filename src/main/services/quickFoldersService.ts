/**
 * 快捷文件夹服务
 * @description 主页「快捷打开文件夹」：记录要快捷打开的文件夹（路径 + 画布位置/尺寸），
 * 用 sql.js 持久化到 userData/quick-folders.db，并在系统资源管理器中打开文件夹。
 *
 * v2 架构（仿 StickyNotesService）：
 * - 继承 SqliteStore，复用 sql.js 初始化 / 落盘 / 结果解析。
 * - 数据量小，全量拉取即可，无分页、无广播（唯一消费端为主页）。
 * - 系统文件夹选择（多选）在 add() 内用 dialog.showOpenDialog 弹出。
 * - 打开文件夹经 shell.openPath 交给系统资源管理器。
 * - 所有 IPC handler 入参做类型收窄的防御性处理。
 */
import { dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import log from 'electron-log'
import type { Database } from 'sql.js'
import { SqliteStore } from './db/sqliteDatabase'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { BackupImportMode, QuickFolder, QuickFolderOpenResult } from '@preload/ipc'

class QuickFoldersService extends SqliteStore {
  constructor() {
    super('quick-folders.db', 'QuickFoldersService')
  }

  /** 初始化：建表（含存量库迁移）+ 注册 IPC */
  async init(): Promise<void> {
    await this.open()

    this.run(
      `CREATE TABLE IF NOT EXISTS quick_folders (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         path TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL,
         alias TEXT,
         home_x INTEGER,
         home_y INTEGER,
         home_w INTEGER,
         home_h INTEGER,
         sort_order INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL
       )`
    )
    this.run('CREATE INDEX IF NOT EXISTS idx_quick_folders_created ON quick_folders(created_at)')

    // 存量库迁移：补 sort_order 列并按既有顺序（创建时间）回填，保证老用户首次排序稳定
    const cols = this.all<{ name: string }>('PRAGMA table_info(quick_folders)')
    if (!cols.some((c) => c.name === 'sort_order')) {
      this.run('ALTER TABLE quick_folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
      this.all<{ id: number }>('SELECT id FROM quick_folders ORDER BY created_at ASC, id ASC').forEach(
        (row, i) => this.run('UPDATE quick_folders SET sort_order = ? WHERE id = ?', [i, row.id])
      )
    }
    // 存量库迁移：补 alias 列（可选别名，默认空则回退到文件夹名展示）
    if (!cols.some((c) => c.name === 'alias')) {
      this.run('ALTER TABLE quick_folders ADD COLUMN alias TEXT')
    }

    this.save()
    this.registerIPC()
  }

  /** 停止服务：落盘并关闭数据库 */
  stop(): void {
    this.close()
  }

  /** 查询全部快捷文件夹（按 sort_order 正序，新增的排在最后）；path 实时校验，失效的标记 missing */
  getAll(): QuickFolder[] {
    return this.all<QuickFolder>(
      'SELECT * FROM quick_folders ORDER BY sort_order ASC, created_at ASC, id ASC'
    ).map((r) => ({ ...r, missing: !existsSync(r.path) }))
  }

  /**
   * 校验并入库一批路径（仅保留存在的目录；path 唯一去重）。
   * 系统多选对话框与拖放添加共用此逻辑。
   */
  private insertValidPaths(paths: string[]): void {
    // 新加的一律排在现有列表末尾（sort_order 从当前最大值递增）
    const max = this.one<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM quick_folders')
    let nextSort = (max?.m ?? 0) + 1
    for (const raw of paths) {
      const path = typeof raw === 'string' ? raw.trim() : ''
      if (!path || !existsSync(path)) continue
      let name: string
      try {
        if (!statSync(path).isDirectory()) continue
        name = basename(path) || path
      } catch {
        continue
      }
      this.run(
        'INSERT OR IGNORE INTO quick_folders (path, name, sort_order, created_at) VALUES (?, ?, ?, ?)',
        [path, name, nextSort, Date.now()]
      )
      nextSort += 1
    }
  }

  /**
   * 弹出系统文件夹多选对话框并添加去重入库。
   * 用户取消时返回当前列表不变。
   */
  async add(): Promise<QuickFolder[]> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择要快捷打开的文件夹',
      properties: ['openDirectory', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return this.getAll()

    this.insertValidPaths(filePaths)
    this.save()
    log.info(`[QuickFoldersService] 已添加快捷文件夹:`, filePaths)
    return this.getAll()
  }

  /** 按给定路径批量添加（拖放来源）；仅入库合法目录，返回更新后的完整列表 */
  addPaths(paths: string[]): QuickFolder[] {
    this.insertValidPaths(Array.isArray(paths) ? paths : [])
    this.save()
    return this.getAll()
  }

  delete(id: number): void {
    this.run('DELETE FROM quick_folders WHERE id = ?', [id])
    this.save()
  }

  /** 按给定 id 顺序重排（面板内拖拽排序），sort_order 取数组下标持久化 */
  reorder(orderedIds: number[]): void {
    if (!Array.isArray(orderedIds)) return
    orderedIds.forEach((raw, i) => {
      const id = Number(raw)
      if (Number.isInteger(id) && id > 0) {
        this.run('UPDATE quick_folders SET sort_order = ? WHERE id = ?', [i, id])
      }
    })
    this.save()
  }

  /** 设置自定义别名（空串视为清除，回退到文件夹名展示） */
  setAlias(id: number, alias: string | null): void {
    const normalized = typeof alias === 'string' ? alias.trim() || null : null
    this.run('UPDATE quick_folders SET alias = ? WHERE id = ?', [normalized, id])
    this.save()
  }

  /** 记录快捷文件夹在主页画布上的位置（钳制非负整数） */
  setPosition(id: number, x: number, y: number): void {
    const px = Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0
    const py = Number.isFinite(y) ? Math.max(0, Math.floor(y)) : 0
    this.run('UPDATE quick_folders SET home_x = ?, home_y = ? WHERE id = ?', [px, py, id])
    this.save()
  }

  /** 记录快捷文件夹在主页画布上的尺寸（钳制非负整数） */
  setSize(id: number, w: number, h: number): void {
    const pw = Number.isFinite(w) ? Math.max(0, Math.floor(w)) : 0
    const ph = Number.isFinite(h) ? Math.max(0, Math.floor(h)) : 0
    this.run('UPDATE quick_folders SET home_w = ?, home_h = ? WHERE id = ?', [pw, ph, id])
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
      log.error('[QuickFoldersService] exportDb 失败:', err)
      return null
    }
  }

  /**
   * 从外部备份库导入快捷文件夹（merge=按 id INSERT OR IGNORE 保留双方；replace=清空后完全替换）。
   * @param db - 备份 zip 中解析出的独立 sql.js 实例（只读，由调用方负责 close）
   * @returns 导入/跳过计数
   */
  importBackupData(
    db: Database,
    mode: BackupImportMode
  ): { imported: number; skipped: number } {
    const res = db.exec('SELECT * FROM quick_folders')
    const cols = res[0]?.columns ?? []
    const rows = res[0]?.values ?? []
    if (mode === 'replace') this.run('DELETE FROM quick_folders')

    let imported = 0
    let skipped = 0
    for (const row of rows) {
      const o: Record<string, unknown> = {}
      cols.forEach((c, i) => (o[c] = row[i]))
      this.db?.run(
        'INSERT OR IGNORE INTO quick_folders (id, path, name, alias, home_x, home_y, home_w, home_h, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          o.id,
          o.path,
          o.name,
          o.alias,
          o.home_x,
          o.home_y,
          o.home_w,
          o.home_h,
          o.sort_order,
          o.created_at
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

  /** 在系统资源管理器中打开文件夹 */
  async openFolder(path: string): Promise<QuickFolderOpenResult> {
    if (!path || !existsSync(path)) {
      return { ok: false, error: '文件夹不存在或已被移动' }
    }
    let isDir = false
    try {
      isDir = statSync(path).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) {
      return { ok: false, error: '路径不是有效的文件夹' }
    }
    const err = await shell.openPath(path)
    if (err) {
      log.error('[QuickFoldersService] 打开文件夹失败:', err)
      return { ok: false, error: err }
    }
    return { ok: true }
  }

  private registerIPC(): void {
    const QF = SERVICE_CHANNELS.quickFolders

    ipcMain.handle(QF.getFolders, () => this.getAll())
    ipcMain.handle(QF.addFolders, () => this.add())
    ipcMain.handle(QF.addFoldersByPaths, (_e, paths: string[]) => this.addPaths(paths))
    ipcMain.handle(QF.deleteFolder, (_e, id: number) => this.delete(Number(id)))
    ipcMain.handle(QF.reorder, (_e, orderedIds: number[]) => this.reorder(orderedIds))
    ipcMain.handle(QF.setAlias, (_e, id: number, alias: string | null) =>
      this.setAlias(Number(id), alias)
    )
    ipcMain.handle(QF.setPosition, (_e, id: number, x: number, y: number) =>
      this.setPosition(Number(id), Number(x), Number(y))
    )
    ipcMain.handle(QF.setSize, (_e, id: number, w: number, h: number) =>
      this.setSize(Number(id), Number(w), Number(h))
    )
    ipcMain.handle(QF.openFolder, (_e, path: string) => this.openFolder(String(path ?? '')))
  }
}

export const quickFoldersService = new QuickFoldersService()
