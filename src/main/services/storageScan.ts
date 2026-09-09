/**
 * 共享目录遍历内核
 * @description 从 diskUsageService 抽取的目录递归遍历通用内核，供磁盘占用排行 /
 * 重复文件去重 / 系统垃圾清理（目录大小统计）共用，保证「不跟随符号链接、
 * 无权限/占用 → skipped、可取消、进度节流、win 长路径/UNC 包装」行为一致。
 */
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

/** 进度节流默认值（与 diskUsageService 原值一致） */
const DEFAULT_PROGRESS_INTERVAL_MS = 150
const DEFAULT_PROGRESS_EVERY_FILES = 512

/** 返回记录写入前使用的长路径包装（win 超过 259 字符前缀 \\?\，UNC 用 \\?\UNC\） */
export function forFs(path: string): string {
  if (process.platform !== 'win32' || path.length <= 247 || path.startsWith('\\\\?\\')) {
    return path
  }
  // \\?\ 不能直接前缀 UNC 路径，必须写成 \\?\UNC\server\share\...
  return path.startsWith('\\\\') ? `\\\\?\\UNC\\${path.slice(2)}` : `\\\\?\\${path}`
}

/** 遍历异常的展示原因 */
export function reasonOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') {
    return process.platform === 'darwin'
      ? '无访问权限（macOS 需要开启「完全磁盘访问」授权）'
      : '无访问权限'
  }
  if (code === 'EBUSY') return '文件被占用'
  if (code === 'ENOENT') return '路径不存在'
  if (code === 'EISDIR') return '预期文件但为目录'
  return `读取失败（${code ?? 'unknown'}）`
}

/** 单次遍历的运行上下文（进度节流基线、计数、跳过累计） */
export interface WalkContext {
  /** 当前遍历位置（进度展示用） */
  currentPath: string
  files: number
  dirs: number
  scannedBytes: number
  skippedCount: number
  skipped: { path: string; reason: string }[]
  lastEmit: number
  /** 上次广播时的条目计数（进度节流基线） */
  lastEmitCount: number
}

/** 遍历钩子：由调用方决定每个文件/目录如何入各自的数据结构 */
export interface WalkHooks {
  onDirStart?(dir: string): void
  onFile?(full: string, name: string, size: number): void
  /** 子目录遍历完毕，size 为该子树合计 */
  onDirEnd?(dir: string, size: number): void
  /** 达到节流阈值时调用；由调用方更新 ctx.lastEmit/lastEmitCount 并广播 */
  maybeEmit?(ctx: WalkContext): void
}

export interface WalkOptions {
  ctx: WalkContext
  hooks: WalkHooks
  isCancelled: () => boolean
  /** 每个被跳过（读目录/文件失败、符号链接等）的路径记录 */
  noteSkipped?(path: string, reason: string): void
  progressEvery?: number
  progressInterval?: number
}

/** 遍历时跳过的 Windows 系统目录（回收站 / 系统卷信息）——并非用户文件，
 *  且含大量 *.asar 归档碎片，Electron 的 asar-aware fs 会对它们做归档解析报错 */
function isSkippedSystemDir(name: string): boolean {
  return /^\$recycle\.bin$/i.test(name) || /^system volume information$/i.test(name)
}

/**
 * 递归遍历目录并返回子树总字节数。不跟随符号链接；isCancelled() 为真时提前返回。
 * 计数（files/dirs/scannedBytes）与跳过累计统一写入 ctx，进度节流由调用方在
 * maybeEmit 中处理（此处只判定阈值并触发调用）。
 */
export async function walkTree(root: string, opts: WalkOptions): Promise<number> {
  const { ctx, hooks, isCancelled } = opts
  const progressEvery = opts.progressEvery ?? DEFAULT_PROGRESS_EVERY_FILES
  const progressInterval = opts.progressInterval ?? DEFAULT_PROGRESS_INTERVAL_MS
  if (isCancelled()) return 0
  ctx.dirs += 1
  ctx.currentPath = root
  hooks.onDirStart?.(root)
  let size = 0
  let dirents
  try {
    dirents = await fsp.readdir(forFs(root), { withFileTypes: true })
  } catch (err) {
    opts.noteSkipped?.(root, reasonOf(err))
    return 0
  }
  for (const ent of dirents) {
    if (isCancelled()) return size
    const full = join(root, ent.name)
    try {
      if (ent.isSymbolicLink()) {
        opts.noteSkipped?.(full, '符号链接，跳过')
        continue
      }
      if (ent.isDirectory()) {
        if (isSkippedSystemDir(ent.name)) {
          opts.noteSkipped?.(full, '系统目录，跳过')
          continue
        }
        size += await walkTree(full, opts)
      } else if (ent.isFile()) {
        const st = await fsp.stat(forFs(full))
        size += st.size
        ctx.files += 1
        ctx.scannedBytes += st.size
        hooks.onFile?.(full, ent.name, st.size)
      }
      // socket/设备等其它类型忽略
    } catch (err) {
      opts.noteSkipped?.(full, reasonOf(err))
    }
    // 节流广播：距上次广播新增条目数达标且距上次发送超过时间阈值
    // （用累计差值而非取模：目录树中的计数可能跳值，取模会漏掉整批广播）
    if (
      ctx.files + ctx.dirs - ctx.lastEmitCount >= progressEvery &&
      Date.now() - ctx.lastEmit >= progressInterval
    ) {
      hooks.maybeEmit?.(ctx)
    }
  }
  hooks.onDirEnd?.(root, size)
  return size
}

/** 新建遍历上下文 */
export function createWalkContext(): WalkContext {
  return {
    currentPath: '',
    files: 0,
    dirs: 0,
    scannedBytes: 0,
    skippedCount: 0,
    skipped: [],
    lastEmit: 0,
    lastEmitCount: 0
  }
}

/**
 * 统计单个目录的总字节数（无需进度/跳过的轻量入口，供垃圾项大小预估用）。
 * isCancelled 为真时提前返回已统计部分；maxEntries 用于防御病态目录树。
 */
export async function measureDirSize(
  dir: string,
  isCancelled: () => boolean,
  maxEntries = 200_000
): Promise<{ totalBytes: number; files: number; dirs: number; skipped: number }> {
  const ctx = createWalkContext()
  const size = await walkTree(dir, {
    ctx,
    hooks: {},
    isCancelled: () => isCancelled() || ctx.files + ctx.dirs > maxEntries,
    noteSkipped: () => {
      ctx.skippedCount += 1
    }
  })
  return { totalBytes: size, files: ctx.files, dirs: ctx.dirs, skipped: ctx.skippedCount }
}
