/**
 * 下载服务
 * @description 封装下载引擎，提供全局单例、任务持久化和 IPC 接口。
 * 通道名与数据模型均来自 @preload/ipc 契约（SERVICE_CHANNELS.download / BROADCAST.downloadTaskUpdated）。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import log from 'electron-log'
import {
  MultiThreadDownloadEngine,
  type DownloadTaskSnapshot as EngineDownloadTaskSnapshot
} from '../core/downloadEngine'
import { broadcast } from '../utils/platform'
import { SERVICE_CHANNELS, BROADCAST } from '@preload/ipc'
import type {
  DownloadTaskSnapshot,
  StartDownloadPayload,
  StartDownloadResult
} from '@preload/ipc'

/** 最大持久化任务数 */
const MAX_PERSISTED_TASKS = 200

/** 持久化防抖间隔（毫秒） */
const PERSIST_DEBOUNCE_MS = 600

/** 检查任务状态是否合法 */
function isDownloadTaskStatus(value: unknown): value is DownloadTaskSnapshot['status'] {
  return (
    value === 'downloading' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'canceled'
  )
}

/** 转换为可持久化的任务格式 */
function toPersistableTask(raw: unknown): DownloadTaskSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (
    typeof row.id !== 'string' ||
    typeof row.url !== 'string' ||
    typeof row.savePath !== 'string' ||
    typeof row.fileName !== 'string' ||
    typeof row.totalBytes !== 'number' ||
    typeof row.downloadedBytes !== 'number' ||
    typeof row.progress !== 'number' ||
    typeof row.speedBytesPerSecond !== 'number' ||
    (row.estimatedFinishAt !== null && typeof row.estimatedFinishAt !== 'number') ||
    typeof row.threads !== 'number' ||
    !isDownloadTaskStatus(row.status) ||
    typeof row.createdAt !== 'number' ||
    typeof row.updatedAt !== 'number'
  ) {
    return null
  }
  return {
    id: row.id,
    url: row.url,
    savePath: row.savePath,
    fileName: row.fileName,
    totalBytes: row.totalBytes,
    downloadedBytes: row.downloadedBytes,
    progress: row.progress,
    speedBytesPerSecond: row.speedBytesPerSecond,
    estimatedFinishAt: row.estimatedFinishAt,
    threads: row.threads,
    status: row.status,
    errorMessage: typeof row.errorMessage === 'string' ? row.errorMessage : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** 按创建时间倒序排列任务 */
function sortTasks(tasks: DownloadTaskSnapshot[]): DownloadTaskSnapshot[] {
  return tasks.slice().sort((a, b) => b.createdAt - a.createdAt)
}

/** 标准化加载的任务列表 */
function normalizeLoadedTasks(raw: unknown): DownloadTaskSnapshot[] {
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  const list: DownloadTaskSnapshot[] = []
  const seen = new Set<string>()
  raw.forEach((item) => {
    const task = toPersistableTask(item)
    if (!task) return
    if (seen.has(task.id)) return
    seen.add(task.id)
    if (task.status === 'downloading') {
      task.status = 'failed'
      task.speedBytesPerSecond = 0
      task.estimatedFinishAt = null
      task.errorMessage = task.errorMessage || '应用重启后任务中断'
      task.updatedAt = now
    }
    list.push(task)
  })
  return sortTasks(list).slice(0, MAX_PERSISTED_TASKS)
}

/** 加载持久化的任务列表 */
function loadPersistedTasks(storePath: string): DownloadTaskSnapshot[] {
  try {
    if (!existsSync(storePath)) return []
    const content = readFileSync(storePath, 'utf-8')
    if (!content.trim()) return []
    const parsed = JSON.parse(content)
    return normalizeLoadedTasks(parsed)
  } catch (error) {
    log.error('[Download] load persisted tasks error:', error)
    return []
  }
}

/** 保存任务列表到持久化存储 */
function savePersistedTasks(storePath: string, tasks: DownloadTaskSnapshot[]): void {
  try {
    mkdirSync(dirname(storePath), { recursive: true })
    writeFileSync(
      storePath,
      JSON.stringify(sortTasks(tasks).slice(0, MAX_PERSISTED_TASKS), null, 2),
      'utf-8'
    )
  } catch (error) {
    log.error('[Download] save persisted tasks error:', error)
  }
}

/** 标准化线程数参数（1-16） */
function sanitizeThreads(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 8
  return Math.max(1, Math.min(16, Math.floor(value)))
}

/** 清洗建议的文件名 */
function sanitizeSuggestedName(input: unknown): string {
  if (typeof input !== 'string') return `download-${Date.now()}.bin`
  const safe = input.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  return safe || `download-${Date.now()}.bin`
}

/** 标准化开始下载的参数 */
function normalizeStartPayload(payload: unknown): {
  url: string
  savePath?: string
  threads: number
} {
  const row = (payload ?? {}) as { url?: unknown; savePath?: unknown; threads?: unknown }
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const savePath = typeof row.savePath === 'string' ? row.savePath.trim() : ''
  const threads = sanitizeThreads(row.threads)
  return {
    url,
    savePath: savePath || undefined,
    threads
  }
}

/**
 * 下载服务类
 * @description 全局单例，管理下载任务的生命周期、持久化和 IPC 通信
 */
class DownloadService {
  /** 下载引擎实例 */
  private engine: MultiThreadDownloadEngine | null = null

  /** 任务存储路径 */
  private taskStorePath: string = ''

  /** 任务快照映射表（引擎侧快照，与 IPC 契约结构兼容） */
  private taskSnapshotMap: Map<string, EngineDownloadTaskSnapshot> = new Map()

  /** 持久化定时器 */
  private persistTimer: NodeJS.Timeout | null = null

  /** 引擎与任务快照是否已初始化（懒加载，首次使用时才创建） */
  private initialized = false

  /** IPC 处理器是否已注册 */
  private ipcRegistered = false

  /**
   * 初始化下载服务
   * @description 仅注册 IPC 处理器（轻量）；加载持久化任务与创建引擎延迟到首次调用
   */
  init(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true
    this.registerIPC()
    log.info('[Download] 已注册 IPC，引擎按首次调用懒初始化')
  }

  /**
   * 懒初始化：首次使用时加载持久化任务并创建下载引擎（幂等）
   */
  private ensureInitialized(): void {
    if (this.initialized) return
    this.initialized = true

    this.taskStorePath = join(app.getPath('userData'), 'download-tasks.json')

    // 加载持久化的任务
    loadPersistedTasks(this.taskStorePath).forEach((task) => {
      this.taskSnapshotMap.set(task.id, task)
    })

    // 创建下载引擎
    this.engine = new MultiThreadDownloadEngine({
      onTaskUpdated: (task) => this.emitToRenderer(task)
    })

    log.info('[Download] 服务初始化完成，已加载', this.taskSnapshotMap.size, '个任务')
  }

  /**
   * 移除任务
   * @param taskId - 任务ID
   * @returns 是否成功移除
   */
  private removeTask(taskId: string): boolean {
    if (!this.engine) return false
    const snapshot = this.taskSnapshotMap.get(taskId)
    if (!snapshot) return false

    const removedFromEngine = this.engine.removeTask(taskId)
    if (!removedFromEngine && snapshot.status === 'downloading') {
      return false
    }

    this.taskSnapshotMap.delete(taskId)
    this.schedulePersist()
    return true
  }

  /**
   * 获取所有任务列表
   * @returns 任务快照数组
   */
  private listTasks(): DownloadTaskSnapshot[] {
    return sortTasks(Array.from(this.taskSnapshotMap.values()))
  }

  /**
   * 获取默认下载目录
   * @returns 下载目录路径
   */
  private getDefaultDir(): string {
    return app.getPath('downloads')
  }

  /**
   * 注册 IPC 处理器
   */
  private registerIPC(): void {
    const D = SERVICE_CHANNELS.download

    // 开始下载
    ipcMain.handle(
      D.start,
      async (_event, payload?: StartDownloadPayload): Promise<StartDownloadResult> => {
        this.ensureInitialized()
        try {
          const normalized = normalizeStartPayload(payload)
          if (!normalized.url) {
            return { ok: false, message: '下载地址不能为空' }
          }
          const task = await this.engine!.startDownload({
            url: normalized.url,
            savePath: normalized.savePath,
            threads: normalized.threads,
            defaultDir: this.getDefaultDir()
          })
          this.upsertTaskSnapshot(task)
          this.schedulePersist()
          return { ok: true, task }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, message }
        }
      }
    )

    // 暂停下载
    ipcMain.handle(D.pause, (_event, taskId: unknown) => {
      this.ensureInitialized()
      const id = typeof taskId === 'string' ? taskId.trim() : ''
      if (!id) return false
      return this.engine!.pauseDownload(id)
    })

    // 恢复下载
    ipcMain.handle(
      D.resume,
      async (_event, taskId: unknown): Promise<StartDownloadResult> => {
        this.ensureInitialized()
        try {
          const id = typeof taskId === 'string' ? taskId.trim() : ''
          if (!id) return { ok: false, message: '任务标识不能为空' }
          const task = await this.engine!.resumeDownload(id)
          this.upsertTaskSnapshot(task)
          this.schedulePersist()
          return { ok: true, task }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, message }
        }
      }
    )

    // 取消下载
    ipcMain.handle(D.cancel, (_event, taskId: unknown) => {
      this.ensureInitialized()
      const id = typeof taskId === 'string' ? taskId.trim() : ''
      if (!id) return false
      return this.engine!.cancelDownload(id)
    })

    // 移除任务
    ipcMain.handle(D.remove, (_event, taskId: unknown) => {
      this.ensureInitialized()
      const id = typeof taskId === 'string' ? taskId.trim() : ''
      if (!id) return false
      return this.removeTask(id)
    })

    // 获取任务列表
    ipcMain.handle(D.list, () => {
      this.ensureInitialized()
      return this.listTasks()
    })

    // 选择保存路径
    ipcMain.handle(D.pickSavePath, async (event, suggestedName: unknown) => {
      try {
        const win =
          BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
        if (!win) return null
        const fileName = sanitizeSuggestedName(suggestedName)
        const result = await dialog.showSaveDialog(win, {
          title: '选择保存位置',
          defaultPath: join(this.getDefaultDir(), fileName)
        })
        if (result.canceled) return null
        return result.filePath ?? null
      } catch (error) {
        log.error('[Download] pick save path error:', error)
        return null
      }
    })

    // 获取默认下载目录
    ipcMain.handle(D.getDefaultDir, () => {
      return this.getDefaultDir()
    })

    // 在系统默认文件管理器中定位到某文件所在目录
    ipcMain.handle(D.openFolder, (_event, path: unknown) => {
      const p = typeof path === 'string' ? path.trim() : ''
      if (p) {
        shell.showItemInFolder(p)
      }
    })
  }

  /**
   * 更新任务快照
   * @param task - 任务快照
   */
  private upsertTaskSnapshot(task: EngineDownloadTaskSnapshot): void {
    this.taskSnapshotMap.set(task.id, task)
    if (this.taskSnapshotMap.size <= MAX_PERSISTED_TASKS) return
    const trimmed = sortTasks(Array.from(this.taskSnapshotMap.values())).slice(
      0,
      MAX_PERSISTED_TASKS
    )
    this.taskSnapshotMap.clear()
    trimmed.forEach((item) => this.taskSnapshotMap.set(item.id, item))
  }

  /**
   * 推送任务更新到渲染进程
   * @param task - 任务快照
   */
  private emitToRenderer(task: EngineDownloadTaskSnapshot): void {
    this.upsertTaskSnapshot(task)
    this.schedulePersist()
    broadcast(BROADCAST.downloadTaskUpdated, task, { onlyVisible: true })
  }

  /**
   * 调度持久化保存
   */
  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistSnapshots()
    }, PERSIST_DEBOUNCE_MS)
  }

  /**
   * 执行持久化保存
   */
  private persistSnapshots(): void {
    const tasks = Array.from(this.taskSnapshotMap.values())
    savePersistedTasks(this.taskStorePath, tasks)
  }
}

/** 下载服务单例 */
export const downloadService = new DownloadService()
