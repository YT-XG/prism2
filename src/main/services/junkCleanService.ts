/**
 * 系统垃圾清理服务
 * @description 存储优化的「系统垃圾」部分：按分类枚举并清理系统临时文件、
 * 浏览器缓存、应用缓存、系统更新缓存、缩略图缓存、崩溃转储与回收站。
 *
 * 安全模型（与残留扫描一致）：
 * - 只清理本次扫描已登记的条目（按 id 匹配），杜绝任意路径删除。
 * - 文件清理统一入回收站（shell.trashItem / trashDirContents）；
 *   回收站分类为「清空」，其内容本就已是删除文件，用 fsp.rm 清空。
 * - 清理前经 shared/verifiedCleanPath 做路径边界校验（只允许本次扫描暴露的
 *   根目录：临时目录、%LOCALAPPDATA%、系统临时目录、userData 等）。
 * - 扫描可取消 + 进度 broadcast；单服务互斥。
 */
import { app, ipcMain, shell } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type {
  JunkCategory,
  JunkCategoryResult,
  JunkCleanResult,
  JunkRisk,
  JunkScanItem,
  JunkScanProgress,
  JunkScanResult
} from '@preload/ipc'
import { broadcast } from '../utils/platform'
import {
  expandEnvPath,
  trashDirContents,
  verifiedCleanPath
} from './storageCleanup'
import { forFs, measureDirSize } from './storageScan'

const CATEGORY_TITLE: Record<JunkCategory, string> = {
  'system-temp': '系统临时文件',
  'browser-cache': '浏览器缓存',
  'app-cache': '应用缓存',
  'update-cache': '系统更新缓存',
  thumbnail: '缩略图缓存',
  'crash-dump': '崩溃转储',
  'recycle-bin': '回收站'
}

/** 单分类最多登记的条目数（防目录树/浏览器 profile 爆炸） */
const MAX_ITEMS_PER_CATEGORY = 60
/** 单条目录大小统计的防御上限（条目） */
const MAX_MEASURE_ENTRIES = 200_000
/** 进度广播节流（毫秒） */
const PROGRESS_INTERVAL_MS = 150

/** 浏览器缓存扫描时要跳过的厂商根（交由浏览器缓存分类处理，避免跨类重复） */
const BROWSER_VENDOR_DIRS = [
  'Google',
  'Microsoft',
  'BraveSoftware',
  'Chromium',
  'Mozilla',
  'Opera Software',
  'Vivaldi',
  'Apple'
] as const

/** 垃圾清理允许的根（路径边界校验用），全部来自系统/应用可安全清理位置 */
function allowedJunkRoots(): string[] {
  const roots = new Set<string>([join(app.getPath('userData'), 'update-staging')])
  const add = (p?: string): void => {
    if (p) roots.add(p)
  }
  add(process.env.TEMP)
  add(process.env.TMP)
  add(process.env.LOCALAPPDATA)
  add(process.env.ProgramData)
  add(process.env.WINDIR)
  add(process.env.TMPDIR)
  add(process.env.TEMP ?? join(app.getPath('home'), 'tmp'))
  return [...roots]
}

/** 目录内子目录名列表（读不到/非目录返回 []） */
async function listDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(forFs(dir), { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/** 判断路径是否存在（且为 dir / file） */
async function exists(p: string, asDir?: boolean): Promise<boolean> {
  try {
    const st = await fsp.stat(forFs(p))
    return asDir === undefined ? true : asDir ? st.isDirectory() : st.isFile()
  } catch {
    return false
  }
}

/** 统计文件/目录字节数（不存在返回 0；目录走有界递归） */
async function sizeOf(path: string, isDir: boolean, cancel: () => boolean): Promise<number> {
  try {
    if (isDir) {
      const r = await measureDirSize(path, cancel, MAX_MEASURE_ENTRIES)
      return r.totalBytes
    }
    return (await fsp.stat(forFs(path))).size
  } catch {
    return 0
  }
}

class JunkCleanService {
  #busy = false
  #cancelToken = false
  /** 最近一次扫描的条目（清理只允许这里面的 id） */
  #lastItems: JunkScanItem[] = []

  /** 取消当前扫描（无扫描时 no-op） */
  async cancel(): Promise<void> {
    this.#cancelToken = true
  }

  async #scanCategory(
    cat: JunkCategory,
    cancel: () => boolean
  ): Promise<{ items: JunkScanItem[]; totalBytes: number }> {
    let items: JunkScanItem[] = []
    if (cat === 'system-temp') {
      items = await this.#scanSystemTemp(cancel)
    } else if (cat === 'browser-cache') {
      items = await this.#scanBrowserCache(cancel)
    } else if (cat === 'app-cache') {
      items = await this.#scanAppCache(cancel)
    } else if (cat === 'update-cache') {
      items = await this.#scanUpdateCache(cancel)
    } else if (cat === 'thumbnail') {
      items = await this.#scanThumbnail(cancel)
    } else if (cat === 'crash-dump') {
      items = await this.#scanCrashDump(cancel)
    } else if (cat === 'recycle-bin') {
      items = await this.#scanRecycleBin(cancel)
    }
    items = items.filter((it) => it.size != null && it.size > 0)
    if (items.length > MAX_ITEMS_PER_CATEGORY) items = items.slice(0, MAX_ITEMS_PER_CATEGORY)
    const totalBytes = items.reduce((s, it) => s + (it.size ?? 0), 0)
    return { items, totalBytes }
  }

  /** 生成 item（id 由 分类:路径 派生） */
  #item(
    cat: JunkCategory,
    path: string,
    title: string,
    detail: string,
    isDir: boolean,
    risk: JunkRisk,
    size?: number
  ): JunkScanItem {
    return { id: `${cat}:${path}`, category: cat, title, detail, path, isDir, risk, size }
  }

  /** 系统临时文件 */
  async #scanSystemTemp(cancel: () => boolean): Promise<JunkScanItem[]> {
    const out: JunkScanItem[] = []
    const cands = [
      { p: process.env.TEMP || expandEnvPath('%TEMP%'), label: '用户临时目录' },
      {
        p:
          process.platform === 'win32'
            ? expandEnvPath('%WINDIR%\\Temp')
            : expandEnvPath('/tmp'),
        label: process.platform === 'win32' ? '系统临时目录 (Windows\\Temp)' : '系统临时目录 (/tmp)'
      }
    ]
    for (const { p, label } of cands) {
      if (cancel()) break
      if (!p || !(await exists(p, true))) continue
      out.push(
        await this.#mkMeasured('system-temp', p, label, true, 'safe', cancel)
      )
    }
    return out
  }

  /** 浏览器缓存：扫描各浏览器 profile 下的 Cache / Code Cache / GPUCache */
  async #scanBrowserCache(cancel: () => boolean): Promise<JunkScanItem[]> {
    const out: JunkScanItem[] = []
    const userData = process.env.LOCALAPPDATA
    if (!userData) return out
    // 固定浏览器厂商根（Chrome/Edge/Brave/Chromium/Firefox）
    const browsers: { root: string; names: string[] }[] = [
      { root: join(userData, 'Google', 'Chrome', 'User Data'), names: ['Default'] },
      { root: join(userData, 'Microsoft', 'Edge', 'User Data'), names: ['Default'] },
      { root: join(userData, 'BraveSoftware', 'Brave-Browser', 'User Data'), names: ['Default'] },
      { root: join(userData, 'Chromium', 'User Data'), names: ['Default'] },
      { root: join(userData, 'Mozilla', 'Firefox'), names: [] }
    ]
    const subDirs = ['Cache', 'Code Cache', 'GPUCache']
    for (const b of browsers) {
      if (cancel()) break
      if (!(await exists(b.root, true))) continue
      const profiles = b.names.length ? b.names : (await listDirNames(b.root))
      for (const profile of profiles) {
        if (cancel()) break
        if (profile.startsWith('.')) continue
        const base = join(b.root, profile)
        for (const sd of subDirs) {
          const dir = join(base, sd)
          if (await exists(dir, true)) {
            out.push(await this.#mkMeasured('browser-cache', dir, `${profile} · ${sd}`, true, 'safe', cancel))
          }
        }
        // Firefox cache2
        const cache2 = join(base, 'cache2')
        if (await exists(cache2, true)) {
          out.push(await this.#mkMeasured('browser-cache', cache2, `${profile} · cache2`, true, 'safe', cancel))
        }
      }
    }
    return out
  }

  /** 应用缓存：%LOCALAPPDATA% 顶层应用下的 Cache / Code Cache / GPUCache（跳过浏览器厂商） */
  async #scanAppCache(cancel: () => boolean): Promise<JunkScanItem[]> {
    const out: JunkScanItem[] = []
    const base = process.env.LOCALAPPDATA
    if (!base) return out
    const appDirs = await listDirNames(base)
    const subDirs = ['Cache', 'Code Cache', 'GPUCache']
    for (const appDir of appDirs) {
      if (cancel()) break
      if (BROWSER_VENDOR_DIRS.includes(appDir as (typeof BROWSER_VENDOR_DIRS)[number])) continue
      const appRoot = join(base, appDir)
      for (const sd of subDirs) {
        const dir = join(appRoot, sd)
        if (await exists(dir, true)) {
          out.push(await this.#mkMeasured('app-cache', dir, `${appDir} · ${sd}`, true, 'safe', cancel))
          if (out.length >= MAX_ITEMS_PER_CATEGORY) return out
        }
      }
    }
    return out
  }

  /** 系统更新缓存（rm 前需确认） */
  async #scanUpdateCache(cancel: () => boolean): Promise<JunkScanItem[]> {
    const out: JunkScanItem[] = []
    if (process.platform !== 'win32') return out
    const dirs = [
      expandEnvPath('%WINDIR%\\SoftwareDistribution\\Download'),
      expandEnvPath('%WINDIR%\\SoftwareDistribution\\DataStore')
    ]
    for (const d of dirs) {
      if (cancel()) break
      if (await exists(d, true)) {
        out.push(await this.#mkMeasured('update-cache', d, 'Windows 更新缓存', true, 'confirm', cancel))
      }
    }
    // 更新暂存目录（本应用）
    const staging = join(app.getPath('userData'), 'update-staging')
    if (await exists(staging, true)) {
      out.push(await this.#mkMeasured('update-cache', staging, '本应用更新包暂存', true, 'safe', cancel))
    }
    return out
  }

  /** 缩略图缓存 */
  async #scanThumbnail(cancel: () => boolean): Promise<JunkScanItem[]> {
    const out: JunkScanItem[] = []
    if (process.platform !== 'win32') return out
    const dir = expandEnvPath('%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer')
    let files: string[] = []
    try {
      const dirents = await fsp.readdir(forFs(dir), { withFileTypes: true })
      files = dirents
        .filter((e) => e.isFile() && /^(thumbcache_|iconcache_)/.test(e.name))
        .map((e) => e.name)
    } catch {
      files = []
    }
    for (const name of files.slice(0, MAX_ITEMS_PER_CATEGORY)) {
      if (cancel()) break
      const p = join(dir, name)
      const size = await sizeOf(p, false, cancel)
      if (size > 0) out.push(this.#item('thumbnail', p, name, '缩略图 / 图标缓存', false, 'safe', size))
    }
    return out
  }

  /** 崩溃转储 */
  async #scanCrashDump(cancel: () => boolean): Promise<JunkScanItem[]> {
    const out: JunkScanItem[] = []
    if (process.platform !== 'win32') return out
    const cands = [
      expandEnvPath('%LOCALAPPDATA%\\CrashDumps'),
      expandEnvPath('%ProgramData%\\Microsoft\\Windows\\WER\\ReportQueue')
    ]
    for (const d of cands) {
      if (cancel()) break
      if (await exists(d, true)) {
        out.push(await this.#mkMeasured('crash-dump', d, d.endsWith('CrashDumps') ? '崩溃转储' : 'Windows 错误报告', true, 'confirm', cancel))
      }
    }
    return out
  }

  /** 回收站（清空；内容本就是删除文件） */
  async #scanRecycleBin(cancel: () => boolean): Promise<JunkScanItem[]> {
    const out: JunkScanItem[] = []
    if (process.platform !== 'win32') return out
    const seen = new Set<string>()
    for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (cancel()) break
      const root = `${c}:\\`
      const bin = `${root}$Recycle.Bin`
      if (await exists(bin, true)) {
        const size = await sizeOf(bin, true, cancel)
        if (size > 0) {
          seen.add(bin)
          out.push(this.#item('recycle-bin', bin, `回收站 (${root})`, '清空回收站', true, 'confirm', size))
        }
      }
    }
    return out
  }

  /** 生成 item 并测量大小 */
  async #mkMeasured(
    cat: JunkCategory,
    path: string,
    title: string,
    isDir: boolean,
    risk: JunkRisk,
    cancel: () => boolean
  ): Promise<JunkScanItem> {
    const size = await sizeOf(path, isDir, cancel)
    return this.#item(cat, path, title, CATEGORY_TITLE[cat], isDir, risk, size)
  }

  /** 扫描全部垃圾分类 */
  async scan(): Promise<JunkScanResult> {
    if (this.#busy) {
      return {
        platform: process.platform as 'win' | 'darwin',
        categories: [],
        totalReclaimableBytes: 0,
        scannedAt: Date.now(),
        error: '已有扫描进行中'
      }
    }
    this.#busy = true
    this.#cancelToken = false
    let total = 0
    const categories: JunkCategoryResult[] = []
    const catOrder: JunkCategory[] = [
      'system-temp',
      'browser-cache',
      'app-cache',
      'update-cache',
      'thumbnail',
      'crash-dump',
      'recycle-bin'
    ]
    let lastEmit = 0
    const emit = (phase: string, label: string, items: number, finished: boolean): void => {
      broadcast(BROADCAST.junkScanProgress, {
        phase,
        label,
        items,
        finished
      } satisfies JunkScanProgress)
      lastEmit = Date.now()
    }
    try {
      for (const cat of catOrder) {
        if (this.#cancelToken) break
        if (Date.now() - lastEmit >= PROGRESS_INTERVAL_MS) emit(`${cat}:start`, `扫描${CATEGORY_TITLE[cat]}…`, 0, false)
        const { items } = await this.#scanCategory(cat, () => this.#cancelToken)
        const res = { category: cat, title: CATEGORY_TITLE[cat], items, totalBytes: items.reduce((s, it) => s + (it.size ?? 0), 0) }
        categories.push(res)
        total += res.totalBytes
        emit(`${cat}:done`, `已扫描${CATEGORY_TITLE[cat]}`, items.length, false)
      }
      const cancelled = this.#cancelToken
      this.#lastItems = categories.flatMap((c) => c.items)
      emit('done', '扫描完成', this.#lastItems.length, true)
      return {
        platform: process.platform as 'win' | 'darwin',
        categories,
        totalReclaimableBytes: total,
        scannedAt: Date.now(),
        cancelled
      }
    } finally {
      this.#busy = false
    }
  }

  /** 回收站清空（内容本就是删除文件，直接删除） */
  async #emptyRecycleBin(bin: string): Promise<void> {
    let names: string[] = []
    try {
      names = await fsp.readdir(forFs(bin))
    } catch {
      return
    }
    for (const name of names) {
      await fsp.rm(join(bin, name), { recursive: true, force: true }).catch(() => {})
    }
  }

  /** 清理选中的垃圾条目 */
  async clean(ids: string[]): Promise<JunkCleanResult> {
    const result: JunkCleanResult = {
      ok: true,
      cleanedIds: [],
      trashed: [],
      reclaimedBytes: 0,
      errors: []
    }
    if (!Array.isArray(ids)) {
      return { ...result, ok: false, errors: ['清理参数无效（需为条目 id 数组）'] }
    }
    if (this.#busy) {
      return { ...result, ok: false, errors: ['已有清理任务进行中'] }
    }
    this.#busy = true
    try {
      const byId = new Map(this.#lastItems.map((it) => [it.id, it]))
      const roots = allowedJunkRoots()
      for (const id of new Set(ids)) {
        const item = byId.get(id)
        if (!item) {
          result.errors.push(`未找到条目：${id}（请重新扫描）`)
          continue
        }
        try {
          if (item.category === 'recycle-bin') {
            await this.#emptyRecycleBin(item.path)
            result.reclaimedBytes += item.size ?? 0
            result.cleanedIds.push(id)
            continue
          }
          const safePath = await verifiedCleanPath(item.path, roots)
          if (!safePath) {
            result.errors.push(`路径超出安全边界或已失效，已拒绝清理：${item.path}`)
            continue
          }
          if (item.isDir) {
            const { trashedCount, lockedCount, dirTrashed } = await trashDirContents(safePath)
            if (dirTrashed || trashedCount > 0) {
              result.trashed.push(safePath)
              result.reclaimedBytes += item.size ?? 0
              result.cleanedIds.push(id)
              if (lockedCount > 0) {
                result.errors.push(`${item.title}：${lockedCount} 项文件被占用未能清理（重启后可再试）`)
              }
            } else {
              result.errors.push(`${item.title} 清理失败：目录内文件均被占用`)
            }
          } else {
            await shell.trashItem(safePath)
            result.trashed.push(safePath)
            result.reclaimedBytes += item.size ?? 0
            result.cleanedIds.push(id)
          }
        } catch (err) {
          result.errors.push(`${item.title} 清理失败：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // 清理过的条目不再可重复操作
      this.#lastItems = this.#lastItems.filter((it) => !ids.includes(it.id))
      result.ok = result.errors.length === 0
      log.info(`[JunkClean] 清理完成：成功 ${result.cleanedIds.length}，失败 ${result.errors.length}`)
      return result
    } finally {
      this.#busy = false
    }
  }

  /** 注册 IPC */
  init(): void {
    const C = SERVICE_CHANNELS.junkClean
    ipcMain.handle(C.scan, () => this.scan())
    ipcMain.handle(C.cancel, () => this.cancel())
    ipcMain.handle(C.clean, (_event, ids: string[]) => this.clean(ids))
    log.info('[JunkCleanService] 初始化完成')
  }
}

export const junkCleanService = new JunkCleanService()
