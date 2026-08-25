/**
 * SQLite 存储基类
 *
 * v2 新增：把多个服务（剪贴板 / 翻译等）里重复的 sql.js 初始化、
 * live 保存、结果解析逻辑统一收敛到这里，子类专注各自的表结构与 CRUD。
 */
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'

type Row = Record<string, unknown>

export abstract class SqliteStore {
  /** sql.js 数据库实例 */
  protected db: Database | null = null

  /** 数据库文件完整路径（userData 目录下） */
  protected filePath = ''

  constructor(
    /** 数据库文件名，如 'clipboard.db' */
    protected readonly dbFileName: string,
    /** 日志前缀，用于区分不同服务 */
    protected readonly logTag: string
  ) {}

  /**
   * 打开（或创建）数据库。
   * 加载 sql.js WASM，读取已有文件或新建空库，再交由子类建表。
   */
  protected async open(): Promise<void> {
    const userDataPath = app.getPath('userData')
    if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
    this.filePath = join(userDataPath, this.dbFileName)

    const SQL = await initSqlJs({
      locateFile: (file) => join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file)
    })

    this.db = existsSync(this.filePath)
      ? new SQL.Database(readFileSync(this.filePath))
      : new SQL.Database()

    log.info(`[${this.logTag}] DB loaded:`, this.filePath)
  }

  /** 执行一条写 SQL */
  protected run(sql: string, params?: SqlValue[]): void {
    if (!this.db) return
    this.db.run(sql, params ?? [])
  }

  /** 执行一条查询并返回全部行对象 */
  protected all<T = Row>(sql: string, params?: SqlValue[]): T[] {
    if (!this.db) return []
    const res = this.db.exec(sql, params ?? [])
    return this.parseRows<T>(res)
  }

  /** 执行一条查询，返回第一行或 null */
  protected one<T = Row>(sql: string, params?: SqlValue[]): T | null {
    return this.all<T>(sql, params)[0] ?? null
  }

  /** 取最近一次 INSERT 的自增 id */
  protected lastInsertId(): number {
    const row = this.one<{ id: number }>('SELECT last_insert_rowid() AS id')
    return row?.id ?? 0
  }

  /** 将内存数据库写入磁盘 */
  protected save(): void {
    if (!this.db) return
    try {
      writeFileSync(this.filePath, Buffer.from(this.db.export()))
    } catch (err) {
      log.error(`[${this.logTag}] save failed:`, err)
    }
  }

  /** 关闭数据库并落盘 */
  protected close(): void {
    if (!this.db) return
    this.save()
    this.db.close()
    this.db = null
  }

  /** 把 sql.js exec 结果解析为行对象数组 */
  private parseRows<T>(result: ReturnType<Database['exec']>): T[] {
    if (!result || result.length === 0) return []
    const columns = result[0].columns
    return result[0].values.map((row) => {
      const item: Record<string, unknown> = {}
      columns.forEach((col, i) => {
        item[col] = row[i]
      })
      return item as T
    })
  }
}
