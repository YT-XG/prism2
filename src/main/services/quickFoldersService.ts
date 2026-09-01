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
import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import log from 'electron-log'
import { SqliteStore } from './db/sqliteDatabase'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { QuickFolder, QuickFolderOpenResult } from '@preload/ipc'

class QuickFoldersService extends SqliteStore {
  constructor() {
    super('quick-folders.db', 'QuickFoldersService')
  }

  /** 初始化：建表 + 注册 IPC */
  async init(): Promise<void> {
    await this.open()

    this.run(
      `CREATE TABLE IF NOT EXISTS quick_folders (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         path TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL,
         home_x INTEGER,
         home_y INTEGER,
         home_w INTEGER,
         home_h INTEGER,
         created_at INTEGER NOT NULL
       )`
    )
    this.run('CREATE INDEX IF NOT EXISTS idx_quick_folders_created ON quick_folders(created_at)')

    this.save()
    this.registerIPC()
  }

  /** 停止服务：落盘并关闭数据库 */
  stop(): void {
    this.close()
  }

  /** 查询全部快捷文件夹（按创建时间正序） */
  getAll(): QuickFolder[] {
    return this.all<QuickFolder>(
      'SELECT * FROM quick_folders ORDER BY created_at ASC, id ASC'
    )
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

    const now = Date.now()
    for (const path of filePaths) {
      // 校验为存在的目录，避免记录被删除/无权限的路径
      if (!existsSync(path)) continue
      let name: string
      try {
        if (!statSync(path).isDirectory()) continue
        name = basename(path) || path
      } catch {
        continue
      }
      this.run(
        'INSERT OR IGNORE INTO quick_folders (path, name, created_at) VALUES (?, ?, ?)',
        [path, name, now]
      )
    }
    this.save()
    log.info(`[QuickFoldersService] 已添加快捷文件夹:`, filePaths)
    return this.getAll()
  }

  delete(id: number): void {
    this.run('DELETE FROM quick_folders WHERE id = ?', [id])
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
    ipcMain.handle(QF.deleteFolder, (_e, id: number) => this.delete(Number(id)))
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
