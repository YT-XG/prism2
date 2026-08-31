/**
 * 旧版（v1）数据导入服务
 * @description 检测 v1 的剪贴板数据库（userData/Prism/clipboard.db），一键合并导入 v2。
 *
 * 与 scripts/import-legacy-db.mjs 同逻辑（sql.js 读 v1 库 → INSERT OR IGNORE 合并），
 * 这里改为应用内服务：主页检测到 v1 数据时展示横幅引导，点「导入」即执行。
 * 完成状态记录在 settings.json 的 legacyImportDone，导入过或用户选择暂不后不再提示。
 */
import { app, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import initSqlJs, { type Database } from 'sql.js'
import { clipboardService } from './clipboardService'
import { settingsService } from './settingsService'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { LegacyImportResult, LegacyImportState } from '@preload/ipc'

/** 旧版应用名候选（v1 userData 目录名：打包版大写 Prism、开发模式小写 prism） */
const LEGACY_DIR_NAMES = ['Prism', 'prism'] as const
/** 旧版数据库文件名 */
const LEGACY_DB_FILE = 'clipboard.db'

class LegacyImportService {
  /** 旧版剪贴板数据库路径（依次探测候选 v1 userData 目录，都不存在返回 null） */
  #legacyDbPath(): string | null {
    for (const name of LEGACY_DIR_NAMES) {
      const p = join(app.getPath('appData'), name, LEGACY_DB_FILE)
      if (existsSync(p)) return p
    }
    return null
  }

  /** 打开旧版数据库（不存在返回 null；调用方负责 close） */
  async #openLegacyDb(): Promise<Database | null> {
    const path = this.#legacyDbPath()
    if (!path) return null
    const SQL = await initSqlJs({
      locateFile: (file) => join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file)
    })
    return new SQL.Database(readFileSync(path))
  }

  /** 读取一张表的全部行（动态列名） */
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

  /** 查询旧版数据状态（是否可导入 + 数量预览） */
  async getState(): Promise<LegacyImportState> {
    const path = this.#legacyDbPath()
    if (!path) {
      return { legacyDbExists: false, done: true }
    }
    const db = await this.#openLegacyDb()
    if (!db) {
      return { legacyDbExists: false, done: true }
    }
    try {
      const count = (sql: string): number => {
        const row = this.#readTable(db, sql)[0]
        return row && typeof row.count === 'number' ? row.count : 0
      }
      return {
        legacyDbExists: true,
        done: Boolean(settingsService.getAll().legacyImportDone),
        legacyDbPath: path,
        historyCount: count('SELECT COUNT(*) AS count FROM clipboard_history'),
        favoriteCount: count('SELECT COUNT(*) AS count FROM favorites')
      }
    } catch (err) {
      log.warn('[LegacyImport] 读取旧版库状态失败:', err)
      return { legacyDbExists: false, done: true }
    } finally {
      db.close()
    }
  }

  /** 执行旧版数据导入（合并到 v2 剪贴板库，不覆盖已有记录） */
  async import(): Promise<LegacyImportResult> {
    const db = await this.#openLegacyDb()
    if (!db) {
      return { ok: false, importedHistory: 0, importedFavorites: 0, skippedHistory: 0, skippedFavorites: 0, error: '未检测到旧版数据' }
    }
    try {
      const history = this.#readTable(db, 'SELECT * FROM clipboard_history').map((r) => ({
        id: Number(r.id),
        content: String(r.content ?? ''),
        created_at: Number(r.created_at ?? 0),
        type: r.type === undefined ? undefined : String(r.type)
      }))
      const favorites = this.#readTable(db, 'SELECT * FROM favorites').map((r) => ({
        id: Number(r.id),
        content: String(r.content ?? ''),
        category: r.category === undefined ? '' : String(r.category),
        description: r.description === undefined ? '' : String(r.description),
        created_at: Number(r.created_at ?? 0)
      }))

      const counts = clipboardService.importLegacyData(history, favorites)
      settingsService.update({ legacyImportDone: true })
      log.info(
        `[LegacyImport] 完成：history+${counts.importedHistory}/skip${counts.skippedHistory}, favorites+${counts.importedFavorites}/skip${counts.skippedFavorites}`
      )
      return { ok: true, ...counts }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[LegacyImport] 导入失败:', message)
      return { ok: false, importedHistory: 0, importedFavorites: 0, skippedHistory: 0, skippedFavorites: 0, error: message }
    } finally {
      db.close()
    }
  }

  /** 用户选择暂不导入：标记完成，不再提示 */
  dismiss(): void {
    settingsService.update({ legacyImportDone: true })
  }

  /** 注册 IPC */
  init(): void {
    const L = SERVICE_CHANNELS.legacyImport
    ipcMain.handle(L.getState, () => this.getState())
    ipcMain.handle(L.import, () => this.import())
    ipcMain.handle(L.dismiss, () => this.dismiss())
    log.info('[LegacyImportService] 初始化完成')
  }
}

export const legacyImportService = new LegacyImportService()
