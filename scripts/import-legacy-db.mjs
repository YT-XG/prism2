#!/usr/bin/env node
/**
 * 旧版剪贴板数据一次性导入脚本。
 *
 * 用法（在 prism-next 目录下）：
 *   node scripts/import-legacy-db.mjs
 *   node scripts/import-legacy-db.mjs --from "C:\\Users\\you\\AppData\\Roaming\\Prism\\clipboard.db"
 *   node scripts/import-legacy-db.mjs --to "C:\\Users\\you\\AppData\\Roaming\\prism-next\\clipboard.db"
 *
 * 旧版 Prism 与 v2 使用相同表结构（clipboard_history / favorites），
 * 按主键 `id` 用 INSERT OR IGNORE 合并，避免覆盖 v2 已有数据。
 */
import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function readArg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function appData() {
  if (process.env.APPDATA) return process.env.APPDATA
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return join(homedir(), '.config')
}

const DEFAULT_FROM = join(appData(), 'Prism', 'clipboard.db')
const DEFAULT_TO = join(appData(), 'prism-next', 'clipboard.db')

const from = readArg('--from') || DEFAULT_FROM
const to = readArg('--to') || DEFAULT_TO

if (!existsSync(from)) {
  console.error(`[import] 源数据库不存在: ${from}`)
  console.error('[import] 如不同路径，用 --from 指定。例如:')
  console.error('[import]   node scripts/import-legacy-db.mjs --from "C:\\Users\\you\\AppData\\Roaming\\Prism\\clipboard.db"')
  process.exit(1)
}

const SQL = await initSqlJs({
  locateFile: (file) => join(root, 'node_modules', 'sql.js', 'dist', file)
})

const src = new SQL.Database(readFileSync(from))
const dst = existsSync(to) ? new SQL.Database(readFileSync(to)) : new SQL.Database()

// 确保目标表存在（与 v2 SqliteStore 建表一致）
const ddl = [
  `CREATE TABLE IF NOT EXISTS clipboard_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     content TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS favorites (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     content TEXT NOT NULL,
     category TEXT DEFAULT '',
     description TEXT DEFAULT '',
     created_at INTEGER NOT NULL
   )`
]
for (const sql of ddl) dst.run(sql)

function migrate(table) {
  const res = src.exec(`SELECT * FROM ${table}`)
  if (!res.length || !res[0].values.length) return 0
  const columns = res[0].columns
  const placeholders = columns.map(() => '?').join(',')
  let count = 0
  for (const row of res[0].values) {
    dst.run(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`, row)
    count += 1
  }
  return count
}

const history = migrate('clipboard_history')
const favorites = migrate('favorites')

mkdirSync(dirname(to), { recursive: true })
writeFileSync(to, Buffer.from(dst.export()))
dst.close()
src.close()

console.log(`[import] 完成：history=${history} 条，favorites=${favorites} 条 -> ${to}`)
