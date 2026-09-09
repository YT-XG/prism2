/**
 * 磁盘占用排行服务
 * @description 存储优化的「大文件（夹）排行」部分：支持扫描任意目录/盘符，
 * 返回各根占用汇总（含所在卷容量/可用空间）与 Top-N 大文件 / 大文件夹
 * （有界收集，内存可控）。
 *
 * - 目录选择走系统文件夹多选框（dialog.showOpenDialog，多选）。
 * - 递归遍历不跟随符号链接/连接点（防 junction 环）；无权限/被占用等异常
 *   目录进入 skipped 并从进度广播带出（mac 无全盘访问权限时给出引导文案）。
 * - 进度经 BROADCAST.diskScanProgress 实时回传；支持 cancel（单扫描互斥）。
 */
import { dialog, ipcMain, shell } from 'electron'
import { promises as fsp } from 'node:fs'
import { basename, resolve, sep } from 'node:path'
import log from 'electron-log'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type { DiskScanEntry, DiskScanProgress, DiskScanResult, DiskScanRoot } from '@preload/ipc'
import { broadcast } from '../utils/platform'
import { forFs, walkTree } from './storageScan'

/** Top-N 排行上限 */
const TOP_N = 200
/** skipped 列表上限（超出后只累加计数不再记录明细） */
const MAX_SKIPPED = 200
/** 单次扫描允许的根数量上限（防误传大批路径拖垮主进程） */
const MAX_ROOTS = 16

/** 有界大顶收集：保持 size 最大的 N 项（小根堆），内存 O(N) */
class TopNHeap {
  #items: DiskScanEntry[] = []
  #limit: number
  constructor(limit: number) {
    this.#limit = limit
  }

  push(item: DiskScanEntry): void {
    const a = this.#items
    if (a.length < this.#limit) {
      a.push(item)
      this.#bubbleUp(a.length - 1)
    } else if (item.size > a[0].size) {
      a[0] = item
      this.#bubbleDown(0)
    }
  }

  #bubbleUp(i: number): void {
    const a = this.#items
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (a[parent].size <= a[i].size) break
      ;[a[parent], a[i]] = [a[i], a[parent]]
      i = parent
    }
  }

  #bubbleDown(i: number): void {
    const a = this.#items
    for (;;) {
      const left = i * 2 + 1
      const right = left + 1
      let smallest = i
      if (left < a.length && a[left].size < a[smallest].size) smallest = left
      if (right < a.length && a[right].size < a[smallest].size) smallest = right
      if (smallest === i) break
      ;[a[smallest], a[i]] = [a[i], a[smallest]]
      i = smallest
    }
  }

  /** 按 size 降序返回 */
  sortedDesc(): DiskScanEntry[] {
    return [...this.#items].sort((x, y) => y.size - x.size)
  }
}

/** 单次扫描的运行时上下文 */
interface ScanContext {
  runId: number
  /** 当前遍历位置（进度展示用） */
  currentPath: string
  files: number
  dirs: number
  scannedBytes: number
  skippedCount: number
  skipped: { path: string; reason: string }[]
  topFiles: TopNHeap
  topDirs: TopNHeap
  lastEmit: number
  /** 上次广播时的条目计数（进度节流基线） */
  lastEmitCount: number
}

class DiskUsageService {
  #runId = 0
  #busy = false
  #cancelToken = false

  /** 弹系统文件夹多选框，返回选中目录（取消返回空数组） */
  async pickRoots(): Promise<string[]> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择要分析占用空间的目录或盘符',
      properties: ['openDirectory', 'multiSelections']
    })
    return canceled ? [] : filePaths
  }

  /** 在系统资源管理器中定位文件/文件夹（路径不存在时抛错，渲染端据此提示） */
  async showItemInFolder(path: string): Promise<void> {
    if (typeof path !== 'string' || !path.trim()) throw new Error('路径无效')
    // shell.showItemInFolder 对不存在的路径静默失败、无返回值，这里显式校验
    try {
      await fsp.stat(forFs(path))
    } catch {
      throw new Error('路径已不存在')
    }
    shell.showItemInFolder(path)
  }

  /** 取消当前扫描（无扫描时 no-op） */
  async cancel(): Promise<void> {
    this.#cancelToken = true
  }

  /** 所在卷容量/可用空间（statfs 取不到时省略，不影响扫描结果） */
  async #volumeSpace(root: string): Promise<{ totalBytes?: number; freeBytes?: number }> {
    try {
      const st = await fsp.statfs(forFs(root))
      return {
        totalBytes: st.bsize * st.blocks,
        freeBytes: st.bsize * st.bavail
      }
    } catch {
      return {}
    }
  }

  /** 扫描指定目录/盘符，返回各根汇总与 Top-N 排行 */
  async scan(roots: string[]): Promise<DiskScanResult> {
    if (this.#busy) {
      return {
        runId: this.#runId,
        cancelled: false,
        error: '已有扫描进行中',
        roots: [],
        topFiles: [],
        topDirs: [],
        skipped: []
      }
    }
    if (!Array.isArray(roots)) {
      return {
        runId: this.#runId,
        cancelled: false,
        error: '扫描参数无效（需为目录数组）',
        roots: [],
        topFiles: [],
        topDirs: [],
        skipped: []
      }
    }
    this.#busy = true
    this.#runId += 1
    this.#cancelToken = false
    const runId = this.#runId
    const ctx: ScanContext = {
      runId,
      currentPath: '',
      files: 0,
      dirs: 0,
      scannedBytes: 0,
      skippedCount: 0,
      skipped: [],
      topFiles: new TopNHeap(TOP_N),
      topDirs: new TopNHeap(TOP_N),
      lastEmit: 0,
      lastEmitCount: 0
    }

    try {
      const rootSummary: DiskScanRoot[] = []
      /** 已接受的根（用于跳过被其它根包含的重复根，避免体积重复统计） */
      const accepted: string[] = []
      let index = 0
      for (const raw of roots) {
        if (this.#cancelToken) break
        index += 1
        if (index > MAX_ROOTS) {
          this.#noteSkipped(ctx, String(raw ?? ''), `超过单次扫描根数量上限（${MAX_ROOTS}）`)
          continue
        }
        // 无效/空路径防御：resolve('') 会解析为主进程 cwd，导致误扫应用目录
        if (typeof raw !== 'string' || !raw.trim()) {
          this.#noteSkipped(ctx, String(raw ?? ''), '无效路径')
          continue
        }
        const root = resolve(raw)
        let valid = true
        try {
          if (!(await fsp.stat(forFs(root)).then((st) => st.isDirectory()))) valid = false
        } catch {
          valid = false
        }
        if (!valid) {
          this.#noteSkipped(ctx, raw, '不是可访问的目录')
          continue
        }
        if (accepted.some((a) => root === a || root.startsWith(a + sep))) {
          this.#noteSkipped(ctx, root, '已包含在其它扫描根中，跳过以免重复统计')
          continue
        }
        accepted.push(root)
        const startFiles = ctx.files
        const startDirs = ctx.dirs
        const totalSize = await this.#scanDir(root, ctx)
        const space = await this.#volumeSpace(root)
        rootSummary.push({
          path: root,
          totalSize,
          files: ctx.files - startFiles,
          dirs: ctx.dirs - startDirs,
          ...space
        })
      }
      const cancelled = this.#cancelToken
      this.#emit(ctx, true)
      return this.#result(runId, cancelled, rootSummary, ctx)
    } finally {
      this.#busy = false
    }
  }

  /** 组装最终结果 */
  #result(
    runId: number,
    cancelled: boolean,
    roots: DiskScanRoot[],
    ctx: ScanContext
  ): DiskScanResult {
    return {
      runId,
      cancelled,
      roots,
      topFiles: ctx.topFiles.sortedDesc(),
      topDirs: ctx.topDirs.sortedDesc(),
      skipped: ctx.skipped
    }
  }

  /** 进度广播（节流；finished 帧必发） */
  #emit(ctx: ScanContext, finished: boolean): void {
    ctx.lastEmit = Date.now()
    ctx.lastEmitCount = ctx.files + ctx.dirs
    broadcast(BROADCAST.diskScanProgress, {
      runId: ctx.runId,
      currentPath: ctx.currentPath,
      files: ctx.files,
      dirs: ctx.dirs,
      scannedBytes: ctx.scannedBytes,
      skipped: ctx.skippedCount,
      finished
    } satisfies DiskScanProgress)
  }

  #noteSkipped(ctx: ScanContext, path: string, reason: string): void {
    ctx.skippedCount += 1
    if (ctx.skipped.length < MAX_SKIPPED) {
      ctx.skipped.push({ path: path || '(无效路径)', reason })
    }
  }

  /** 递归遍历目录，返回子树总字节数（不跟随符号链接；取消时提前返回） */
  async #scanDir(dir: string, ctx: ScanContext): Promise<number> {
    return walkTree(dir, {
      ctx,
      hooks: {
        onFile: (full, name, size) =>
          ctx.topFiles.push({ path: full, name, size, kind: 'file' }),
        onDirEnd: (d, size) => ctx.topDirs.push({ path: d, name: basename(d) || d, size, kind: 'dir' }),
        maybeEmit: (c) => this.#emit(c as ScanContext, false)
      },
      isCancelled: () => this.#cancelToken,
      noteSkipped: (p, r) => this.#noteSkipped(ctx, p, r)
    })
  }

  /** 注册 IPC */
  init(): void {
    const C = SERVICE_CHANNELS.diskUsage
    ipcMain.handle(C.pickRoots, () => this.pickRoots())
    ipcMain.handle(C.scan, (_event, roots: string[]) => this.scan(roots))
    ipcMain.handle(C.cancel, () => this.cancel())
    ipcMain.handle(C.showItemInFolder, (_event, path: string) => this.showItemInFolder(path))
    log.info('[DiskUsageService] 初始化完成')
  }
}

export const diskUsageService = new DiskUsageService()
