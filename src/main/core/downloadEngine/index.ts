/**
 * 多线程下载引擎核心实现
 */

import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, open, rename, rm, stat, unlink } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { Readable } from 'node:stream'
import { net } from 'electron'
import log from 'electron-log'
import { EMIT_INTERVAL_MS } from './config'
import {
  buildChunks,
  inferFileNameFromUrl,
  isAbortError,
  mergePartFiles,
  normalizeThreads,
  parseContentDispositionFileName,
  safeFileName,
  type ChunkInfo
} from './utils'

/** 下载任务状态 */
export type DownloadTaskStatus = 'downloading' | 'paused' | 'completed' | 'failed' | 'canceled'

/** 下载任务快照 */
export interface DownloadTaskSnapshot {
  /** 任务ID */
  id: string
  /** 下载URL */
  url: string
  /** 保存路径 */
  savePath: string
  /** 文件名 */
  fileName: string
  /** 文件总大小（字节） */
  totalBytes: number
  /** 已下载字节数 */
  downloadedBytes: number
  /** 下载进度（0-1） */
  progress: number
  /** 下载速度（字节/秒） */
  speedBytesPerSecond: number
  /** 预计完成时间戳 */
  estimatedFinishAt: number | null
  /** 下载线程数 */
  threads: number
  /** 任务状态 */
  status: DownloadTaskStatus
  /** 错误信息 */
  errorMessage?: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** 开始下载选项 */
export interface StartDownloadOptions {
  /** 下载URL */
  url: string
  /** 保存路径（可选，默认为 defaultDir/文件名） */
  savePath?: string
  /** 下载线程数（可选，默认为 8） */
  threads?: number
  /** 默认保存目录 */
  defaultDir: string
}

/** 下载引擎选项 */
interface DownloadEngineOptions {
  /** 任务更新回调 */
  onTaskUpdated?: (task: DownloadTaskSnapshot) => void
}

/** 下载探测结果 */
interface DownloadProbeResult {
  /** 文件名 */
  fileName: string
  /** 文件总大小（字节） */
  totalBytes: number
  /** 是否支持 Range 请求 */
  supportsRange: boolean
}

/** 内部任务结构 */
interface InternalTask extends DownloadTaskSnapshot {
  /** 临时目录 */
  tempDir: string
  /** 临时输出文件路径 */
  tempOutputPath: string
  /** 分片文件路径列表 */
  partPaths: string[]
  /** 是否支持 Range 请求 */
  supportsRange: boolean
  /** 中止控制器集合 */
  abortControllers: Set<AbortController>
  /** 上次采样时间 */
  lastSampleTime: number
  /** 上次采样已下载字节数 */
  lastSampleBytes: number
  /** 上次推送时间 */
  lastEmitTime: number
}

/**
 * 等待指定毫秒数，支持通过 AbortSignal 提前取消。
 * @param ms - 等待毫秒数
 * @param signal - 中止信号（可选）
 * @returns 等待结束的 Promise；若信号提前中止则拒绝为 AbortError
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handler)
      resolve()
    }, ms)
    function handler(): void {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', handler, { once: true })
  })
}

/**
 * 将内部任务转换为快照
 * @param task - 内部任务
 * @returns 任务快照
 */
function toTaskSnapshot(task: InternalTask): DownloadTaskSnapshot {
  return {
    id: task.id,
    url: task.url,
    savePath: task.savePath,
    fileName: task.fileName,
    totalBytes: task.totalBytes,
    downloadedBytes: task.downloadedBytes,
    progress: task.progress,
    speedBytesPerSecond: task.speedBytesPerSecond,
    estimatedFinishAt: task.estimatedFinishAt,
    threads: task.threads,
    status: task.status,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }
}

/**
 * 多线程下载引擎
 * @description 支持多线程分片下载、暂停/恢复/取消、实时进度追踪
 */
export class MultiThreadDownloadEngine {
  /** 引擎内任务数上限（与服务层 MAX_PERSISTED_TASKS 保持一致），防止终态任务无界滞留内存 */
  private static readonly MAX_TASKS = 200

  /** 任务映射表 */
  private readonly tasks = new Map<string, InternalTask>()

  /** 任务更新回调 */
  private readonly onTaskUpdated?: (task: DownloadTaskSnapshot) => void

  constructor(options?: DownloadEngineOptions) {
    this.onTaskUpdated = options?.onTaskUpdated
  }

  /**
   * 获取所有任务列表
   * @returns 任务快照数组
   */
  listTasks(): DownloadTaskSnapshot[] {
    return Array.from(this.tasks.values()).map((task) => toTaskSnapshot(task))
  }

  /**
   * 获取单个任务详情
   * @param taskId - 任务ID
   * @returns 任务快照，不存在返回 null
   */
  getTask(taskId: string): DownloadTaskSnapshot | null {
    const task = this.tasks.get(taskId)
    return task ? toTaskSnapshot(task) : null
  }

  /**
   * 开始下载任务
   * @param options - 下载选项
   * @returns 任务快照
   */
  async startDownload(options: StartDownloadOptions): Promise<DownloadTaskSnapshot> {
    const normalizedUrl = String(options.url || '').trim()
    if (!normalizedUrl) {
      throw new Error('下载地址不能为空')
    }
    const parsedUrl = new URL(normalizedUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('仅支持 HTTP/HTTPS 下载地址')
    }

    const probe = await this.probeRemoteFile(parsedUrl)
    const threads = normalizeThreads(options.threads)
    const savePath =
      options.savePath && options.savePath.trim()
        ? options.savePath.trim()
        : join(options.defaultDir, probe.fileName)

    await mkdir(dirname(savePath), { recursive: true })

    const taskId = randomUUID()
    const tempDir = join(dirname(savePath), `.download-${taskId}`)
    const tempOutputPath = join(tempDir, `target${extname(savePath) || '.tmp'}`)
    await mkdir(tempDir, { recursive: true })

    const now = Date.now()
    const task: InternalTask = {
      id: taskId,
      url: parsedUrl.toString(),
      savePath,
      fileName: basename(savePath),
      totalBytes: probe.totalBytes,
      downloadedBytes: 0,
      progress: 0,
      speedBytesPerSecond: 0,
      estimatedFinishAt: null,
      threads,
      status: 'downloading',
      createdAt: now,
      updatedAt: now,
      tempDir,
      tempOutputPath,
      partPaths: [],
      supportsRange: probe.supportsRange,
      abortControllers: new Set<AbortController>(),
      lastSampleTime: now,
      lastSampleBytes: 0,
      lastEmitTime: 0
    }

    this.tasks.set(task.id, task)
    this.emitTask(task, true)

    void this.executeDownload(task, probe).catch((error) => {
      this.handleTaskFailure(task, error)
    })

    return toTaskSnapshot(task)
  }

  /**
   * 取消下载任务
   * @param taskId - 任务ID
   * @returns 是否成功取消
   */
  cancelDownload(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    // 支持取消 downloading 和 paused 状态的任务
    if (task.status !== 'downloading' && task.status !== 'paused') return false

    task.status = 'canceled'
    task.updatedAt = Date.now()
    // 中止所有正在进行的请求
    task.abortControllers.forEach((controller) => {
      try {
        controller.abort()
      } catch {
        // ignore
      }
    })
    task.abortControllers.clear()
    this.emitTask(task, true)
    void this.cleanupTaskFiles(task)
    this.trimTaskMap()
    log.info(`[DownloadEngine] 任务已取消: ${taskId}`)
    return true
  }

  /**
   * 暂停下载任务
   * @param taskId - 任务ID
   * @returns 是否成功暂停
   */
  pauseDownload(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    if (task.status !== 'downloading') return false

    task.status = 'paused'
    task.speedBytesPerSecond = 0
    task.estimatedFinishAt = null
    task.updatedAt = Date.now()
    // 中止所有正在进行的请求
    task.abortControllers.forEach((controller) => {
      try {
        controller.abort()
      } catch {
        // ignore
      }
    })
    task.abortControllers.clear()
    this.emitTask(task, true)
    log.info(`[DownloadEngine] 任务已暂停: ${taskId}`)
    return true
  }

  /**
   * 恢复下载任务
   * @param taskId - 任务ID
   * @returns 任务快照
   */
  async resumeDownload(taskId: string): Promise<DownloadTaskSnapshot> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('下载任务不存在')
    }
    if (task.status !== 'paused') {
      throw new Error('仅可继续已暂停的任务')
    }

    log.info(`[DownloadEngine] 恢复下载任务: ${taskId}`)

    const now = Date.now()

    // 尝试探测远程文件，失败时使用已知信息继续下载
    let probe: DownloadProbeResult
    try {
      probe = await this.probeRemoteFile(new URL(task.url))
    } catch (error) {
      log.warn('[DownloadEngine] 探测文件失败，使用已知信息继续下载:', error)
      // 使用任务已知信息继续下载
      probe = {
        fileName: task.fileName,
        totalBytes: task.totalBytes,
        supportsRange: task.supportsRange
      }
    }

    const canResume =
      probe.supportsRange && probe.totalBytes > 0 && probe.totalBytes === task.totalBytes

    if (!canResume) {
      await this.cleanupTaskFiles(task)
      await mkdir(task.tempDir, { recursive: true })
      task.downloadedBytes = 0
      task.progress = 0
      task.partPaths = []
    }

    task.status = 'downloading'
    task.errorMessage = undefined
    task.totalBytes = probe.totalBytes
    task.supportsRange = probe.supportsRange
    task.speedBytesPerSecond = 0
    task.estimatedFinishAt = null
    task.abortControllers.clear()
    task.lastSampleTime = now
    task.lastSampleBytes = task.downloadedBytes
    task.lastEmitTime = 0
    task.updatedAt = now

    this.emitTask(task, true)
    void this.executeDownload(task, probe).catch((error) => {
      this.handleTaskFailure(task, error)
    })

    return toTaskSnapshot(task)
  }

  /**
   * 移除任务
   * @param taskId - 任务ID
   * @returns 是否成功移除
   */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    if (task.status === 'downloading') return false
    this.tasks.delete(taskId)
    void this.cleanupTaskFiles(task)
    return true
  }

  /**
   * 裁剪最旧的非活动任务（completed/failed/canceled），保持 Map 有界。
   * 任务进入终态后调用，超出上限时按更新时间从旧到新移除。
   */
  private trimTaskMap(): void {
    if (this.tasks.size <= MultiThreadDownloadEngine.MAX_TASKS) return
    const inactive = Array.from(this.tasks.values())
      .filter((t) => t.status !== 'downloading' && t.status !== 'paused')
      .sort((a, b) => a.updatedAt - b.updatedAt)
    const excess = this.tasks.size - MultiThreadDownloadEngine.MAX_TASKS
    for (const task of inactive.slice(0, excess)) {
      this.tasks.delete(task.id)
    }
  }

  /**
   * 探测远程文件信息
   * @param url - 下载地址
   * @returns 探测结果
   */
  private async probeRemoteFile(url: URL): Promise<DownloadProbeResult> {
    let fileName = inferFileNameFromUrl(url)
    let totalBytes = 0
    let supportsRange = false

    try {
      log.info(`[DownloadEngine] 探测文件: ${url.toString()}`)

      // 使用 Electron net 模块（Chromium 网络栈）
      const response = await new Promise<Electron.IncomingMessage>((resolve, reject) => {
        const request = net.request({
          url: url.toString(),
          method: 'HEAD'
        })

        // 设置 30 秒超时
        const timeoutId = setTimeout(() => {
          request.abort()
          reject(new Error('HEAD 请求超时'))
        }, 30000)

        request.on('response', (response) => {
          clearTimeout(timeoutId)
          resolve(response)
        })

        request.on('error', (error) => {
          clearTimeout(timeoutId)
          reject(error)
        })

        request.end()
      })

      log.info(`[DownloadEngine] 探测响应: ${response.statusCode}`)

      if (response.statusCode === 200) {
        const contentLength = response.headers['content-length']
        totalBytes = Number(contentLength || 0) || 0
        const acceptRangesHeader = response.headers['accept-ranges']
        const acceptRanges = (
          Array.isArray(acceptRangesHeader) ? acceptRangesHeader[0] : acceptRangesHeader || ''
        ).toLowerCase()
        supportsRange = acceptRanges.includes('bytes')
        const disposition = response.headers['content-disposition'] || ''
        const dispositionName = parseContentDispositionFileName(
          Array.isArray(disposition) ? disposition[0] : disposition
        )
        if (dispositionName) {
          fileName = dispositionName
        }
      }
    } catch (error) {
      log.error('[DownloadEngine] 探测文件失败:', error)
      // ignore head errors
    }

    return {
      fileName: safeFileName(fileName),
      totalBytes,
      supportsRange
    }
  }

  /**
   * 执行下载任务
   * @param task - 内部任务
   * @param probe - 探测结果
   */
  private async executeDownload(task: InternalTask, probe: DownloadProbeResult): Promise<void> {
    // 如果是代理链接（gh-proxy），不支持 Range 请求，强制单线程
    const isProxy = task.url.includes('gh-proxy.org') || task.url.includes('ghproxy')
    const useMultiThread =
      !isProxy && probe.supportsRange && probe.totalBytes > 0 && task.threads > 1

    log.info(`[DownloadEngine] 开始下载: URL=${task.url}`)
    log.info(
      `[DownloadEngine] 探测结果: totalBytes=${probe.totalBytes}, supportsRange=${probe.supportsRange}, threads=${task.threads}`
    )
    log.info(`[DownloadEngine] 使用模式: ${useMultiThread ? '多线程' : '单线程'}`)

    if (isProxy) {
      log.info('[DownloadEngine] 检测到代理链接，强制使用单线程下载')
    }

    if (useMultiThread) {
      const chunks = buildChunks(probe.totalBytes, task.threads, task.tempDir)
      task.partPaths = chunks.map((chunk) => chunk.partPath)

      // Sync downloadedBytes with actual chunk file sizes on disk
      const chunkSizes = await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const fileStat = await stat(chunk.partPath)
            return fileStat.size
          } catch {
            return 0
          }
        })
      )
      const existingBytes = chunkSizes.reduce((sum, size) => sum + size, 0)
      task.downloadedBytes = Math.min(existingBytes, probe.totalBytes)
      if (existingBytes > 0) {
        this.updateTaskProgress(task)
      }

      await Promise.all(chunks.map((chunk) => this.downloadChunk(task, chunk)))
      if (task.status === 'canceled') {
        await this.cleanupTaskFiles(task)
        return
      }
      await mergePartFiles(task.partPaths, task.tempOutputPath)
    } else {
      // Sync downloadedBytes with actual temp file size on disk
      if (probe.supportsRange && probe.totalBytes > 0) {
        try {
          const fileStat = await stat(task.tempOutputPath)
          if (fileStat.size > 0 && fileStat.size < probe.totalBytes) {
            task.downloadedBytes = fileStat.size
            this.updateTaskProgress(task)
          } else {
            task.downloadedBytes = 0
          }
        } catch {
          task.downloadedBytes = 0
        }
      } else {
        task.downloadedBytes = 0
      }

      await this.downloadSingle(task)
      if (task.status === 'canceled') {
        await this.cleanupTaskFiles(task)
        return
      }
    }

    if (existsSync(task.savePath)) {
      await unlink(task.savePath).catch(() => {})
    }
    await rename(task.tempOutputPath, task.savePath)

    // 校验下载文件大小
    let fileValid = true
    try {
      const finalStat = await stat(task.savePath)
      const finalSize = finalStat.size

      log.info(
        `[DownloadEngine] 下载完成: 文件=${task.savePath}, 大小=${finalSize}, 预期=${task.totalBytes}`
      )

      // 如果已知文件大小，校验是否完整
      if (task.totalBytes > 0 && finalSize !== task.totalBytes) {
        log.error(`[DownloadEngine] 文件大小校验失败: 预期 ${task.totalBytes}, 实际 ${finalSize}`)
        // 删除损坏的文件
        await unlink(task.savePath).catch(() => {})
        fileValid = false
      } else {
        task.downloadedBytes = finalSize
        task.totalBytes = finalSize
      }
    } catch {
      // stat 失败时忽略，使用已有值
    }

    // 清理临时文件（无论成功失败都要清理）
    await this.cleanupTaskFiles(task)

    if (!fileValid) {
      throw new Error(`下载不完整: 文件大小与预期不符`)
    }

    task.progress = 1
    task.speedBytesPerSecond = 0
    task.estimatedFinishAt = null
    task.status = 'completed'
    task.updatedAt = Date.now()
    this.emitTask(task, true)
    this.trimTaskMap()
  }

  /**
   * 单线程下载
   * @param task - 内部任务
   */
  private async downloadSingle(task: InternalTask): Promise<void> {
    const controller = new AbortController()
    task.abortControllers.add(controller)
    try {
      let existingSize = 0
      if (task.supportsRange && task.totalBytes > 0) {
        try {
          const fileStat = await stat(task.tempOutputPath)
          if (fileStat.size > 0 && fileStat.size < task.totalBytes) {
            existingSize = fileStat.size
          }
        } catch {
          // file doesn't exist
        }
      }

      const headers: Record<string, string> = {}
      if (existingSize > 0) {
        headers['Range'] = `bytes=${existingSize}-`
      }

      log.info(`[DownloadEngine] 单线程下载: ${task.url}`)

      // 使用 Electron net 模块（Chromium 网络栈）
      const response = await new Promise<Electron.IncomingMessage>((resolve, reject) => {
        const request = net.request({
          url: task.url,
          method: 'GET',
          headers
        })

        request.on('response', (response) => {
          resolve(response)
        })

        request.on('error', (error) => {
          reject(error)
        })

        // 监听中止信号
        controller.signal.addEventListener('abort', () => {
          request.abort()
        })

        request.end()
      })

      log.info(`[DownloadEngine] 下载响应: ${response.statusCode}`)

      if (existingSize > 0 && response.statusCode !== 206) {
        // Server doesn't support range for this request, restart
        existingSize = 0
        task.downloadedBytes = 0
      }
      if (!existingSize && response.statusCode !== 200 && response.statusCode !== 206) {
        throw new Error(`下载请求失败: HTTP ${response.statusCode}`)
      }

      const contentLength = Number(response.headers['content-length'] || 0) || 0
      if (task.totalBytes <= 0 && contentLength > 0) {
        task.totalBytes = existingSize + contentLength
      }

      const fileHandle = await open(task.tempOutputPath, existingSize > 0 ? 'a' : 'w')
      try {
        // 使用 Node.js 流处理（背压感知：固定队列深度，避免无限链式 promise）
        await new Promise<void>((resolve, reject) => {
          const stream = response as unknown as Readable
          const writeQueue: Buffer[] = []
          const MAX_QUEUE_SIZE = 16
          let writing = false

          const flush = async (): Promise<void> => {
            if (writing) return
            writing = true
            while (writeQueue.length > 0) {
              const chunk = writeQueue.shift()!
              await fileHandle.write(chunk)
              task.downloadedBytes += chunk.length
              this.updateTaskProgress(task)
            }
            writing = false
            // 队列清空后恢复响应流
            stream.resume()
          }

          response.on('data', (chunk: Buffer) => {
            if (chunk && chunk.length > 0) {
              writeQueue.push(chunk)
              if (writeQueue.length >= MAX_QUEUE_SIZE) {
                stream.pause()
              }
              flush()
            }
          })

          response.on('end', async () => {
            await new Promise<void>((wait) => {
              const poll = (): void => {
                if (!writing && writeQueue.length === 0) wait()
                else setImmediate(poll)
              }
              poll()
            })
            resolve()
          })

          response.on('error', (error: Error) => {
            reject(error)
          })
        })
      } finally {
        await fileHandle.close()
      }
    } finally {
      task.abortControllers.delete(controller)
    }
  }

  /**
   * 多线程分片下载
   * @param task - 内部任务
   * @param chunk - 分片信息
   */
  private async downloadChunk(task: InternalTask, chunk: ChunkInfo): Promise<void> {
    const chunkExpectedSize = chunk.end - chunk.start + 1

    // 检查已有部分数据（断点续传）
    let existingSize = 0
    try {
      const fileStat = await stat(chunk.partPath)
      existingSize = fileStat.size
    } catch {
      // 文件不存在
    }

    // 分片已完整下载
    if (existingSize >= chunkExpectedSize) {
      return
    }

    const controller = new AbortController()
    task.abortControllers.add(controller)
    try {
      const rangeStart = chunk.start + existingSize
      log.info(`[DownloadEngine] 分片下载: ${task.url} [${rangeStart}-${chunk.end}]`)

      // 带退避重试地获取响应：仅在瞬时错误（网络错误/5xx/429）时重试，取消/暂停不重试
      const response = await this.fetchChunk(task, rangeStart, chunk.end, controller)

      log.info(`[DownloadEngine] 分片响应: ${response.statusCode}`)

      const fileHandle = await open(chunk.partPath, existingSize > 0 ? 'a' : 'w')
      try {
        // 使用 Node.js 流处理（背压感知：固定队列深度 + pause/resume，避免无限链式 promise）
        await new Promise<void>((resolve, reject) => {
          const stream = response as unknown as Readable
          const writeQueue: Buffer[] = []
          const MAX_QUEUE_SIZE = 16
          let writing = false

          const flush = async (): Promise<void> => {
            if (writing) return
            writing = true
            while (writeQueue.length > 0) {
              const writeChunk = writeQueue.shift()!
              await fileHandle.write(writeChunk)
              task.downloadedBytes += writeChunk.length
              this.updateTaskProgress(task)
            }
            writing = false
            // 写队列清空后恢复响应流
            stream.resume()
          }

          response.on('data', (dataChunk: Buffer) => {
            if (dataChunk && dataChunk.length > 0) {
              writeQueue.push(dataChunk)
              if (writeQueue.length >= MAX_QUEUE_SIZE) {
                stream.pause()
              }
              flush()
            }
          })

          response.on('end', async () => {
            await new Promise<void>((wait) => {
              const poll = (): void => {
                if (!writing && writeQueue.length === 0) wait()
                else setImmediate(poll)
              }
              poll()
            })
            resolve()
          })

          response.on('error', (error: Error) => {
            reject(error)
          })
        })
      } finally {
        await fileHandle.close()
      }
    } finally {
      task.abortControllers.delete(controller)
    }
  }

  /**
   * 获取分片响应，带指数退避的瞬时错误重试。
   * 仅在瞬时错误（请求 error 非 Abort 错误，或 HTTP 5xx/429）时重试；
   * 用户取消/暂停（AbortError）不得重试，立即终止。
   * @param task - 内部任务
   * @param rangeStart - 分片起始字节
   * @param rangeEnd - 分片结束字节
   * @param controller - 中止控制器
   * @returns 合法的分片响应对象（HTTP 200/206）
   */
  private async fetchChunk(
    task: InternalTask,
    rangeStart: number,
    rangeEnd: number,
    controller: AbortController
  ): Promise<Electron.IncomingMessage> {
    const MAX_ATTEMPTS = 3
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        // 使用 Electron net 模块（Chromium 网络栈）
        const response = await new Promise<Electron.IncomingMessage>((resolve, reject) => {
          const request = net.request({
            url: task.url,
            method: 'GET',
            headers: {
              Range: `bytes=${rangeStart}-${rangeEnd}`
            }
          })

          request.on('response', (response) => {
            resolve(response)
          })

          request.on('error', (error) => {
            reject(error)
          })

          // 监听中止信号
          controller.signal.addEventListener('abort', () => {
            request.abort()
          })

          request.end()
        })

        if (response.statusCode === 200 || response.statusCode === 206) {
          return response
        }

        // HTTP 5xx / 429 属于瞬时错误，指数退避后重试
        if (response.statusCode >= 500 || response.statusCode === 429) {
          if (attempt >= MAX_ATTEMPTS - 1) {
            throw new Error(`分片下载失败: HTTP ${response.statusCode}`)
          }
          const backoffMs = 500 * 2 ** attempt
          log.warn(
            `[DownloadEngine] 分片 HTTP ${response.statusCode}，${backoffMs}ms 后重试 (${attempt + 1}/${MAX_ATTEMPTS})`
          )
          await delay(backoffMs, controller.signal)
          continue
        }

        // 其余状态码为永久失败，不重试
        throw new Error(`分片下载失败: HTTP ${response.statusCode}`)
      } catch (error) {
        // 取消/暂停请求不得重试，立即终止
        if (controller.signal.aborted || isAbortError(error)) throw error

        if (attempt >= MAX_ATTEMPTS - 1) {
          throw error
        }

        const backoffMs = 500 * 2 ** attempt
        log.warn(
          `[DownloadEngine] 分片请求异常，${backoffMs}ms 后重试 (${attempt + 1}/${MAX_ATTEMPTS}):`,
          error instanceof Error ? error.message : String(error)
        )
        await delay(backoffMs, controller.signal)
      }
    }

    // 理论上不可达：循环内必然 return 或 throw
    throw new Error('分片下载失败: 重试次数耗尽')
  }

  /**
   * 更新任务进度
   * @param task - 内部任务
   */
  private updateTaskProgress(task: InternalTask): void {
    const now = Date.now()
    const elapsedMs = Math.max(1, now - task.lastSampleTime)
    const deltaBytes = task.downloadedBytes - task.lastSampleBytes

    task.speedBytesPerSecond = Math.max(0, Math.round((deltaBytes / elapsedMs) * 1000))
    task.lastSampleBytes = task.downloadedBytes
    task.lastSampleTime = now
    task.updatedAt = now

    if (
      task.totalBytes > 0 &&
      task.speedBytesPerSecond > 0 &&
      task.downloadedBytes < task.totalBytes
    ) {
      const remainBytes = task.totalBytes - task.downloadedBytes
      const remainSeconds = remainBytes / task.speedBytesPerSecond
      task.estimatedFinishAt = now + Math.max(0, Math.round(remainSeconds * 1000))
    } else {
      task.estimatedFinishAt = null
    }

    if (task.totalBytes > 0) {
      task.progress = Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes))
    }

    this.emitTask(task, false)
  }

  /**
   * 推送任务更新
   * @param task - 内部任务
   * @param force - 是否强制推送
   */
  private emitTask(task: InternalTask, force: boolean): void {
    const now = Date.now()
    if (!force && now - task.lastEmitTime < EMIT_INTERVAL_MS) return
    task.lastEmitTime = now
    this.onTaskUpdated?.(toTaskSnapshot(task))
  }

  /**
   * 清理任务临时文件
   * @param task - 内部任务
   * @param options - 清理选项
   */
  private async cleanupTaskFiles(
    task: InternalTask,
    options?: { keepOutput?: boolean }
  ): Promise<void> {
    if (!options?.keepOutput) {
      await rm(task.tempOutputPath, { force: true }).catch(() => {})
    }
    if (task.partPaths.length > 0) {
      await Promise.all(task.partPaths.map((path) => rm(path, { force: true }).catch(() => {})))
    }
    await rm(task.tempDir, { recursive: true, force: true }).catch(() => {})
  }

  /**
   * 处理任务失败
   * @param task - 内部任务
   * @param error - 错误对象
   */
  private handleTaskFailure(task: InternalTask, error: unknown): void {
    log.error('[DownloadEngine] 下载失败:', error)
    if (task.status === 'paused') {
      task.speedBytesPerSecond = 0
      task.estimatedFinishAt = null
      task.updatedAt = Date.now()
      this.emitTask(task, true)
      return
    }

    if (task.status === 'canceled' || isAbortError(error)) {
      task.status = 'canceled'
      task.speedBytesPerSecond = 0
      task.estimatedFinishAt = null
      task.updatedAt = Date.now()
      this.emitTask(task, true)
      void this.cleanupTaskFiles(task)
      this.trimTaskMap()
      return
    }

    task.status = 'failed'
    task.errorMessage = error instanceof Error ? error.message : String(error)
    task.speedBytesPerSecond = 0
    task.estimatedFinishAt = null
    task.updatedAt = Date.now()
    this.emitTask(task, true)
    void this.cleanupTaskFiles(task)
    this.trimTaskMap()
  }
}
