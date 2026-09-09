/**
 * 重复文件去重服务
 * @description 存储优化的「重复文件」部分：在用户选择的目录/盘符内，按
 * size → 首尾签名 → 整文件哈希 三级过滤找出真正重复的文件，供用户选择
 * 保留一份、删掉其余（入回收站）。
 *
 * - 复用 storageScan 的遍历内核（不跟随符号链接、可取消、进度节流、skipped）。
 * - 内存有界：只收集 >= 1KB 的文件，MAX_COLLECTED_FILES 超出后停止新增并提示。
 * - 清理只作用于本次扫描登记的「非保留副本」路径，且仅在所选根内；入回收站。
 */
import { createReadStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { dialog, ipcMain, shell } from 'electron'
import { createHash } from 'node:crypto'
import log from 'electron-log'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type {
  DuplicateCleanResult,
  DuplicateGroup,
  DuplicateScanProgress,
  DuplicateScanResult
} from '@preload/ipc'
import { broadcast } from '../utils/platform'
import { createWalkContext, forFs, walkTree } from './storageScan'
import type { WalkContext } from './storageScan'

/** 最小重复判定大小（>= 1KB 才进入候选，避免海量零碎文件） */
const MIN_SIZE = 1024
/** 收集的文件总数上限（内存有界） */
const MAX_COLLECTED_FILES = 200_000
/** 重复组上限（展示与清理有界） */
const MAX_GROUPS = 500
/** 进度广播节流（新增条目数） */
const PROGRESS_EVERY_FILES = 512
/** 进度广播节流（毫秒） */
const PROGRESS_INTERVAL_MS = 150

interface Candidate {
  path: string
  name: string
  size: number
}

class DuplicateFinderService {
  #runId = 0
  #busy = false
  #cancelToken = false
  /** 最近一次扫描的「非保留副本」路径 → 大小（清理只允许这里面的路径） */
  #lastRemovable = new Map<string, number>()
  /** 最近一次扫描的根（清理需落在其中） */
  #lastRoots: string[] = []

  async pickRoots(): Promise<string[]> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择要查找重复文件的目录或盘符',
      properties: ['openDirectory', 'multiSelections']
    })
    return canceled ? [] : filePaths
  }

  async cancel(): Promise<void> {
    this.#cancelToken = true
  }

  /** 首尾各 4KB 的签名（< 8KB 时取整文件） */
  async #partialHash(p: string): Promise<string> {
    const fh = await fsp.open(forFs(p), 'r')
    try {
      const st = await fh.stat()
      const size = st.size
      const chunk = size < 8192 ? Math.max(1, size) : 4096
      const head = Buffer.alloc(chunk)
      const tail = Buffer.alloc(chunk)
      await fh.read(head, 0, Math.min(chunk, head.length), 0)
      if (size > chunk) await fh.read(tail, 0, Math.min(chunk, tail.length), size - chunk)
      const h = createHash('sha1')
      h.update(head)
      if (size > chunk) h.update(tail)
      return h.digest('hex')
    } finally {
      await fh.close()
    }
  }

  /** 整文件 SHA-1 */
  #fullHash(p: string): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const h = createHash('sha1')
      const s = createReadStream(forFs(p))
      s.on('error', reject)
      s.on('data', (d) => h.update(d))
      s.on('end', () => resolvePromise(h.digest('hex')))
    })
  }

  /** 扫描指定目录/盘符，返回重复文件分组 */
  async scan(roots: string[]): Promise<DuplicateScanResult> {
    if (this.#busy) {
      return { runId: this.#runId, cancelled: false, error: '已有扫描进行中', roots: [], groups: [], totalDuplicateBytes: 0, skipped: [] }
    }
    if (!Array.isArray(roots)) {
      return { runId: this.#runId, cancelled: false, error: '扫描参数无效（需为目录数组）', roots: [], groups: [], totalDuplicateBytes: 0, skipped: [] }
    }
    this.#busy = true
    this.#runId += 1
    this.#cancelToken = false
    const runId = this.#runId
    const ctx = createWalkContext()
    this.#lastRemovable.clear()
    const bucket = new Map<number, Candidate[]>()
    let collected = 0
    let overflow = false

    try {
      for (const raw of roots) {
        if (this.#cancelToken) break
        if (typeof raw !== 'string' || !raw.trim()) continue
        await walkTree(raw, {
          ctx,
          hooks: {
            onFile: (full, name, size) => {
              if (size >= MIN_SIZE && collected < MAX_COLLECTED_FILES) {
                const arr = bucket.get(size)
                if (arr) arr.push({ path: full, name, size })
                else bucket.set(size, [{ path: full, name, size }])
                collected += 1
              } else if (collected >= MAX_COLLECTED_FILES) {
                overflow = true
              }
            },
            maybeEmit: (c) => this.#emitProgress(runId, c, 0, false)
          },
          isCancelled: () => this.#cancelToken,
          noteSkipped: (p, r) => {
            ctx.skippedCount += 1
            if (ctx.skipped.length < 200) ctx.skipped.push({ path: p, reason: r })
          },
          progressEvery: PROGRESS_EVERY_FILES,
          progressInterval: PROGRESS_INTERVAL_MS
        })
      }

      const groups: DuplicateGroup[] = []
      let totalDuplicateBytes = 0
      for (const [size, cands] of bucket) {
        if (this.#cancelToken) break
        if (cands.length < 2) continue
        // ① 首尾签名分桶
        const partial = new Map<string, Candidate[]>()
        for (const c of cands) {
          const sig = await this.#partialHash(c.path)
          const arr = partial.get(sig)
          if (arr) arr.push(c)
          else partial.set(sig, [c])
        }
        for (const sigCands of partial.values()) {
          if (this.#cancelToken) break
          if (sigCands.length < 2) continue
          // ② 整哈希确认
          const byHash = new Map<string, Candidate[]>()
          for (const c of sigCands) {
            const h = await this.#fullHash(c.path)
            const arr = byHash.get(h)
            if (arr) arr.push(c)
            else byHash.set(h, [c])
          }
          for (const [hash, hashCands] of byHash) {
            if (this.#cancelToken) break
            if (hashCands.length < 2) continue
            // 保留最短路径的一份（更可能是「正本」），其余标记为可删
            hashCands.sort(
              (a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path)
            )
            const keep = hashCands[0]
            const removable = hashCands.slice(1)
            const reclaimableBytes = size * removable.length
            groups.push({
              key: `${size}:${hash}`,
              size,
              keepPath: keep.path,
              files: hashCands.map((c) => ({ path: c.path, name: c.name })),
              reclaimableBytes
            })
            totalDuplicateBytes += reclaimableBytes
            for (const r of removable) this.#lastRemovable.set(r.path, size)
            if (groups.length >= MAX_GROUPS) break
          }
          if (groups.length >= MAX_GROUPS) break
        }
        if (groups.length >= MAX_GROUPS) break
      }

      this.#lastRoots = [...roots]
      const cancelled = this.#cancelToken
      this.#emitProgress(runId, ctx, groups.length, true)
      return {
        runId,
        cancelled,
        error: overflow ? '文件过多，结果可能不完整' : undefined,
        roots: [...roots],
        groups,
        totalDuplicateBytes,
        skipped: ctx.skipped
      }
    } finally {
      this.#busy = false
    }
  }

  /** 进度广播（finished 帧必发） */
  #emitProgress(runId: number, ctx: WalkContext, groups: number, finished: boolean): void {
    broadcast(BROADCAST.duplicateScanProgress, {
      runId,
      currentPath: ctx.currentPath,
      files: ctx.files,
      scannedBytes: ctx.scannedBytes,
      groups,
      skipped: ctx.skippedCount,
      finished
    } satisfies DuplicateScanProgress)
    ctx.lastEmit = Date.now()
    ctx.lastEmitCount = ctx.files + ctx.dirs
  }

  /** 路径是否落在本次扫描的根内（归一化前缀，杜绝越界） */
  #withinRoots(p: string): boolean {
    const target = p.toLowerCase()
    return this.#lastRoots.some((r) => {
      const norm = r.toLowerCase().replace(/[\\/]+$/, '')
      return target === norm || target.startsWith(norm + '\\') || target.startsWith(norm + '/')
    })
  }

  /** 清理重复分组中多余的副本（入回收站） */
  async clean(paths: string[]): Promise<DuplicateCleanResult> {
    const result: DuplicateCleanResult = { ok: true, removed: [], reclaimedBytes: 0, errors: [] }
    if (!Array.isArray(paths)) {
      return { ...result, ok: false, errors: ['清理参数无效（需为路径数组）'] }
    }
    if (this.#busy) {
      return { ...result, ok: false, errors: ['已有清理任务进行中'] }
    }
    this.#busy = true
    try {
      for (const p of new Set(paths)) {
        const size = this.#lastRemovable.get(p)
        if (size == null) {
          result.errors.push(`该路径不是本次扫描的重复副本，已跳过：${p}`)
          continue
        }
        if (!this.#withinRoots(p)) {
          result.errors.push(`路径超出扫描根，已拒绝清理：${p}`)
          continue
        }
        try {
          await shell.trashItem(p)
          result.removed.push(p)
          result.reclaimedBytes += size
          this.#lastRemovable.delete(p)
        } catch (err) {
          result.errors.push(`删除失败：${p}（${err instanceof Error ? err.message : String(err)}）`)
        }
      }
      result.ok = result.errors.length === 0
      log.info(`[DuplicateFinder] 清理完成：成功 ${result.removed.length}，失败 ${result.errors.length}`)
      return result
    } finally {
      this.#busy = false
    }
  }

  /** 注册 IPC */
  init(): void {
    const C = SERVICE_CHANNELS.duplicateFinder
    ipcMain.handle(C.pickRoots, () => this.pickRoots())
    ipcMain.handle(C.scan, (_event, roots: string[]) => this.scan(roots))
    ipcMain.handle(C.cancel, () => this.cancel())
    ipcMain.handle(C.clean, (_event, paths: string[]) => this.clean(paths))
    log.info('[DuplicateFinderService] 初始化完成')
  }
}

export const duplicateFinderService = new DuplicateFinderService()
