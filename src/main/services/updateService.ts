/**
 * 应用更新服务
 * @description 平台分支：mac/win 走「统一自定义锚点(manifest) + 多线程下载引擎 + SHA-256 校验」，仅安装层不同；
 *  - mac：无签名原地替换 `.app`（无签名封条，可安全覆盖自身内容）→ relaunch；
 *  - win：下载 NSIS `*-setup.exe`，静默 `/S /D=<安装目录>` 覆盖安装 → 由安装器拉启新版；
 *  - linux：保留 electron-updater + GitHub provider。
 * 面向无签名（mac 无 Gatekeeper 复弹 / win 无 SmartScreen 阻塞），真正静默更新。
 *
 * 自更新源解析（**默认不暴露给用户，唯一锚点**）：
 *  - 唯一锚点：`https://github.com/{githubRepo}/releases/latest/download/latest.json`（GitHub「latest」别名，永远指向最新 release 的清单）。
 * manifest.redirect 支持整站迁移：换服务器时只需在旧锚点的 latest.json 里加 `redirect`（指向新清单）与/或 `mirrors`（二进制备用源），
 * 已安装客户端零改动即可跟随。binaries 按当前平台取安装包；下载按 url → mirrors 后缀拼接。
 *
 * 所有状态变化经 BROADCAST.updateStatus 广播 + getStatus 主动查询，渲染端无需轮询。
 */
import { app, ipcMain, net } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import semver from 'semver'
import AdmZip from 'adm-zip'
import { broadcast } from '../utils/platform'
import { notificationService } from './notificationService'
import { settingsService } from './settingsService'
import { MultiThreadDownloadEngine } from '../core/downloadEngine'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type { UpdateManifest, UpdateManifestBinary, UpdateStatusInfo } from '@preload/ipc'

class UpdateService {
  /** 当前更新状态（默认 idle，currentVersion 在加载时按 app.getVersion() 填充） */
  private status: UpdateStatusInfo = {
    status: 'idle',
    currentVersion: app.getVersion()
  }

  /** 是否已接线事件/引擎/IPC（幂等，防止重复注册） */
  private wired = false

  /** 更新下载引擎（mac 自定义路径专用，独立实例，避免混入用户下载列表） */
  private engine: MultiThreadDownloadEngine | null = null

  /** 当前更新下载任务 id（onTaskUpdated 过滤用） */
  private updateTaskId: string | null = null

  /** 已下载待安装的 manifest（downloaded 阶段保存，供安装使用） */
  private downloadedManifest: UpdateManifest | null = null

  /** 已下载 zip 的暂存路径 */
  private downloadedZipPath: string | null = null

  /** 安装进行中标记（防止重复触发） */
  private installing = false

  /** 初始化：创建更新引擎 + 接线 electron-updater（仅 linux）+ 注册 IPC */
  init(): void {
    if (this.wired) return
    this.wired = true

    this.engine = new MultiThreadDownloadEngine({
      onTaskUpdated: (task) => this.#onUpdateTask(task)
    })

    // 仅 linux 走 electron-updater（mac/win 用统一锚点自定义更新）
    if (process.platform === 'linux') {
      this.#wireElectronUpdater()
    }

    this.#registerIPC()
    log.info('[UpdateService] 初始化完成')
  }

  /** 查询当前更新状态 */
  getStatus(): UpdateStatusInfo {
    return { ...this.status }
  }

  /** 启动静默检查更新（仅打包后执行，dev 跳过避免无意义网络请求） */
  checkOnStartup(): void {
    if (!app.isPackaged) return
    setTimeout(() => void this.check(), 3000)
  }

  /** 检查更新：mac/win 走统一锚点，linux 走 electron-updater */
  async check(): Promise<UpdateStatusInfo> {
    if (!app.isPackaged) {
      this.#setStatus({
        status: 'idle',
        message: '开发模式不支持自动更新，请打包后测试'
      })
      return this.getStatus()
    }

    if (process.platform === 'linux') {
      this.#setStatus({ status: 'checking' })
      try {
        await autoUpdater.checkForUpdates()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('[UpdateService] 检查更新失败:', message)
        this.#setStatus({ status: 'error', error: message })
      }
      return this.getStatus()
    }

    // mac / win → 统一自定义锚点
    return this.#checkCustom()
  }

  /** 安装已下载的更新并重启（mac 原地替换 / win NSIS 静默 / linux electron-updater） */
  quitAndInstall(): void {
    if (this.status.status !== 'downloaded') return

    const handleError = (err: unknown): void => {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[UpdateService] 安装失败:', message)
      this.#setStatus({ status: 'error', error: message })
    }

    if (process.platform === 'darwin') {
      void this.#installOnMac().catch(handleError)
    } else if (process.platform === 'win32') {
      void this.#installOnWindows().catch(handleError)
    } else {
      autoUpdater.quitAndInstall()
    }
  }

  // ---------------------------------------------------------------------------
  // mac 自定义更新
  // ---------------------------------------------------------------------------

  /** mac 自定义检查：拉取 manifest → 版本比较 → 自动下载 */
  async #checkCustom(): Promise<UpdateStatusInfo> {
    this.#setStatus({ status: 'checking' })

    let manifest: UpdateManifest
    try {
      manifest = await this.#fetchManifest()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[UpdateService] 拉取更新清单失败:', message)
      this.#setStatus({ status: 'error', error: message })
      this.#notifyError('更新检查失败', message)
      return this.getStatus()
    }

    const version = String(manifest.version || '').trim()
    if (!version) {
      this.#setStatus({ status: 'error', error: '更新清单缺少版本号' })
      return this.getStatus()
    }

    const current = this.status.currentVersion
    let isNewer = false
    try {
      isNewer = semver.gt(version, current)
    } catch {
      isNewer = version !== current
    }
    if (!isNewer) {
      this.#setStatus({ status: 'up-to-date' })
      return this.getStatus()
    }

    const binary = this.#pickBinary(manifest)
    if (!binary) {
      this.#setStatus({ status: 'error', error: '更新清单中没有当前平台的安装包' })
      return this.getStatus()
    }

    this.#setStatus({
      status: 'available',
      version,
      releaseDate: undefined,
      releaseNotes: manifest.notes
    })
    notificationService.notify({
      type: 'info',
      source: 'update',
      title: '发现新版本',
      message: `v${version} 已发布，正在后台下载…`
    })

    // 启动下载（实际进度经 #onUpdateTask 驱动状态机）
    try {
      await this.#startDownload(manifest, binary)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[UpdateService] 开始下载失败:', message)
      this.#setStatus({ status: 'error', error: message })
      this.#notifyError('更新下载失败', message)
    }
    return this.getStatus()
  }

  /** 解析更新清单（manifestSources 依次尝试；redirect 跟随深度≤2） */
  async #fetchManifest(): Promise<UpdateManifest> {
    const sources = this.#manifestSources()
    if (sources.length === 0) {
      throw new Error('未配置更新源')
    }
    let lastError: unknown
    for (const url of sources) {
      try {
        return await this.#fetchManifestFrom(url)
      } catch (err) {
        lastError = err
        log.warn('[UpdateService] 更新源不可用，尝试下一个:', url, err instanceof Error ? err.message : err)
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`所有更新源均不可用（${message}）`)
  }

  /** 从单个 URL 拉取 manifest（含 redirect 跟随，避免自指循环） */
  async #fetchManifestFrom(url: string): Promise<UpdateManifest> {
    let current = url
    for (let depth = 0; depth <= 3; depth++) {
      const resp = await net.fetch(current)
      if (!resp.ok) {
        throw new Error(`更新源响应失败: HTTP ${resp.status}`)
      }
      const manifest = (await resp.json()) as UpdateManifest
      const redirect = typeof manifest.redirect === 'string' ? manifest.redirect.trim() : ''
      if (redirect && redirect !== current) {
        current = redirect
        continue
      }
      if (!manifest || !Array.isArray(manifest.binaries)) {
        throw new Error('更新清单格式错误（缺少 binaries）')
      }
      return manifest
    }
    throw new Error('更新清单重定向层数过多')
  }

  /** 计算 manifest 源列表：唯一锚点 = GitHub「latest」别名（永远指向最新 release 的 latest.json）。
   *  换服务器时无需改客户端——只需在该锚点的 latest.json 里加 `redirect`/`mirrors`，客户端自动跟随。 */
  #manifestSources(): string[] {
    const repo = settingsService.getAll().githubRepo?.trim()
    if (!repo) return []
    const github = `https://github.com/${repo}/releases/latest/download/latest.json`
    return [github]
  }

  /** 从 manifest 中选取当前平台的安装包（mac 优先 universal；win/linux 取该平台首项） */
  #pickBinary(manifest: UpdateManifest): UpdateManifestBinary | null {
    const platform =
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
    const list = manifest.binaries.filter((b) => b.platform === platform)
    if (platform === 'mac') {
      return (
        list.find((b) => b.arch === 'universal') ??
        list.find((b) => b.arch === process.arch) ??
        list[0] ??
        null
      )
    }
    return list[0] ?? null
  }

  /** 用多线程引擎下载更新 zip 到暂存目录 */
  async #startDownload(manifest: UpdateManifest, binary: UpdateManifestBinary): Promise<void> {
    if (!this.engine) throw new Error('更新引擎未初始化')

    const stagingDir = join(app.getPath('userData'), 'update-staging', manifest.version)
    await mkdir(stagingDir, { recursive: true })

    const zipName = this.#basenameFromUrl(binary.url) || `update-${manifest.version}-${process.platform}.zip`
    const zipPath = join(stagingDir, zipName)

    this.downloadedManifest = manifest
    // 先落暂存路径，避免极小文件在 startDownload 返回前就完成的竞态
    this.downloadedZipPath = zipPath

    const task = await this.engine.startDownload({
      url: binary.url,
      savePath: zipPath,
      threads: 8,
      defaultDir: stagingDir
    })
    this.updateTaskId = task.id
    log.info(`[UpdateService] 更新下载已开始: ${task.id} -> ${zipPath}`)
  }

  /** 监听更新引擎任务（仅处理更新任务），驱动状态机 */
  #onUpdateTask(task: {
    id: string
    status: string
    progress: number
    errorMessage?: string
  }): void {
    if (task.id !== this.updateTaskId) return

    if (task.status === 'downloading') {
      this.#setStatus({
        status: 'downloading',
        version: this.status.version,
        progress: Math.round(task.progress * 100)
      })
    } else if (task.status === 'completed') {
      void this.#onUpdateDownloaded()
    } else if (task.status === 'failed' || task.status === 'canceled') {
      const message = task.errorMessage || '更新下载失败'
      log.error('[UpdateService] 更新下载失败:', message)
      this.#setStatus({ status: 'error', error: message })
      this.#notifyError('更新下载失败', message)
    }
  }

  /** 下载完成：SHA-256 校验 → 进入 downloaded 待安装 */
  async #onUpdateDownloaded(): Promise<void> {
    const manifest = this.downloadedManifest
    const zipPath = this.downloadedZipPath
    if (!manifest || !zipPath) return

    const binary = this.#pickBinary(manifest)
    try {
      if (binary?.sha256) {
        await this.#verifySha256(zipPath, binary.sha256)
      }
      this.#setStatus({
        status: 'downloaded',
        version: manifest.version,
        releaseNotes: manifest.notes
      })
      notificationService.notify({
        type: 'success',
        source: 'update',
        title: '更新已就绪',
        message: `v${manifest.version} 已下载，重启后生效`
      })
      log.info('[UpdateService] 更新已校验通过并下载完成:', manifest.version)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[UpdateService] 更新校验失败:', message)
      this.#setStatus({ status: 'error', error: message })
      this.#notifyError('更新校验失败', message)
      // 删除损坏的暂存包，避免下次启动误装
      await rm(join(app.getPath('userData'), 'update-staging', manifest.version), {
        recursive: true,
        force: true
      }).catch(() => {})
    }
  }

  /** 计算文件 SHA-256 */
  async #verifySha256(file: string, expected: string): Promise<void> {
    const hash = createHash('sha256')
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(file)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', resolvePromise)
      stream.on('error', reject)
    })
    const actual = hash.digest('hex')
    if (actual.toLowerCase() !== String(expected).trim().toLowerCase()) {
      throw new Error(`SHA-256 校验失败（期望 ${expected}，实际 ${actual}）`)
    }
  }

  /**
   * mac 原地替换安装：无签名 App 无签名封条，可安全原地替换自身。
   * 策略：把 bundleRoot/Contents 原子替换为新版 Contents（路径不变，relaunch 解析到新二进制），失败回滚。
   */
  async #installOnMac(): Promise<void> {
    const manifest = this.downloadedManifest
    const zipPath = this.downloadedZipPath
    if (!manifest || !zipPath) throw new Error('尚未下载更新')

    if (this.installing) return
    this.installing = true

    const version = manifest.version
    const stagingDir = join(app.getPath('userData'), 'update-staging', version)
    const extractDir = join(stagingDir, 'extracted')
    await mkdir(extractDir, { recursive: true })

    // 解压（adm-zip）；zip 内含 top-level `Prism 2.app`
    new AdmZip(zipPath).extractAllTo(extractDir, true)

    const appDirName = await this.#findAppDir(extractDir)
    if (!appDirName) {
      throw new Error('更新包内未找到应用目录')
    }

    const bundleRoot = resolve(dirname(app.getPath('exe')), '..', '..')
    const contents = join(bundleRoot, 'Contents')
    const oldContents = `${contents}.old-${version}`

    // 写权限检查（/Applications 等 root 目录可能只读）
    try {
      await access(bundleRoot, constants.W_OK)
    } catch {
      throw new Error('应用目录无写入权限（可能位于 /Applications 等受保护目录），请改为手动安装')
    }

    try {
      await rm(oldContents, { recursive: true, force: true }).catch(() => {})
      await rename(contents, oldContents)
      await rm(contents, { recursive: true, force: true }).catch(() => {})
      await rename(join(extractDir, appDirName, 'Contents'), contents)
    } catch (err) {
      // 回滚：若新 Contents 未就位，把旧的内容还原
      try {
        if (!existsSync(contents) && existsSync(oldContents)) {
          await rename(oldContents, contents)
        }
      } catch {
        // ignore
      }
      throw new Error(`应用更新替换失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 删除旧 Contents 备份 + 延迟清理 staging
    await rm(oldContents, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => {
      void rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    }, 2000)

    log.info('[UpdateService] 更新已安装到应用目录，重启应用:', version)
    app.relaunch()
    app.quit()
  }

  /**
   * Windows NSIS 静默安装更新。
   * 下载到的是 `*-setup.exe`（electron-builder NSIS 安装器）；用 `/S` 静默 + `/D=<安装目录>` 覆盖安装到原位置。
   * 注意：NSIS `/D=` 必须是最后一个参数且不加引号（即便路径含空格）。安装器会关闭正在运行的实例并替换文件，
   * 完成后（electron-builder 默认 runAfterFinish）拉启新版，因此这里直接 quit 即可。需在 Windows 真机实测。
   */
  async #installOnWindows(): Promise<void> {
    const manifest = this.downloadedManifest
    const setupPath = this.downloadedZipPath
    if (!manifest || !setupPath) throw new Error('尚未下载更新')
    if (this.installing) return
    this.installing = true

    const installDir = dirname(app.getPath('exe'))
    log.info(`[UpdateService] 调用 NSIS 静默安装更新到: ${installDir}`)

    // 脱离父进程启动安装器，随即退出主进程；安装器接管覆盖安装并拉启新版。
    spawn(setupPath, ['/S', `/D=${installDir}`], { detached: true, stdio: 'ignore' }).unref()
    // 延迟清理：安装完成后移除暂存的安装器
    setTimeout(() => {
      void rm(setupPath, { force: true }).catch(() => {})
    }, 2000)
    app.quit()
  }

  /** 在解压目录中找到 .app 顶层目录名 */
  async #findAppDir(dir: string): Promise<string | null> {
    const entries = await readdir(dir, { withFileTypes: true })
    const appDir = entries.find((e) => e.isDirectory() && e.name.endsWith('.app'))
    return appDir ? appDir.name : null
  }

  /** 从 URL 推断文件 basename（失败返回 ''） */
  #basenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname
      const name = pathname.split('/').filter(Boolean).pop()
      return name ? decodeURIComponent(name) : ''
    } catch {
      return ''
    }
  }

  // ---------------------------------------------------------------------------
  // electron-updater（非 mac）
  // ---------------------------------------------------------------------------

  /** 接线 electron-updater 事件 → 状态机 + 广播（仅非 mac 调用） */
  #wireElectronUpdater(): void {
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.#setStatus({ status: 'checking' })
    })
    autoUpdater.on('update-available', (info) => {
      log.info('[UpdateService] 发现新版本:', info.version)
      this.#setStatus({
        status: 'available',
        version: info.version,
        releaseDate: info.releaseDate
      })
      notificationService.notify({
        type: 'info',
        source: 'update',
        title: '发现新版本',
        message: `v${info.version} 已发布，正在后台下载…`
      })
    })
    autoUpdater.on('update-not-available', () => {
      this.#setStatus({ status: 'up-to-date' })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.#setStatus({
        status: 'downloading',
        version: this.status.version,
        progress: Math.round(progress.percent)
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      log.info('[UpdateService] 更新已下载:', info.version)
      this.#setStatus({
        status: 'downloaded',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
      })
      notificationService.notify({
        type: 'success',
        source: 'update',
        title: '更新已就绪',
        message: `v${info.version} 已下载，重启后生效`
      })
    })
    autoUpdater.on('error', (err) => {
      log.error('[UpdateService] 更新错误:', err)
      this.#setStatus({ status: 'error', error: err.message })
      notificationService.notify({
        type: 'error',
        source: 'update',
        title: '更新检查失败',
        message: err.message
      })
    })
  }

  // ---------------------------------------------------------------------------
  // 通用
  // ---------------------------------------------------------------------------

  /** 更新状态并广播给所有可见窗口 */
  #setStatus(patch: Partial<UpdateStatusInfo>): void {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: app.getVersion()
    }
    broadcast(BROADCAST.updateStatus, this.getStatus())
  }

  /** 通知错误（受通知中心开关控制） */
  #notifyError(title: string, message: string): void {
    notificationService.notify({ type: 'error', source: 'update', title, message })
  }

  #registerIPC(): void {
    const U = SERVICE_CHANNELS.update
    ipcMain.handle(U.getStatus, () => this.getStatus())
    ipcMain.handle(U.check, () => this.check())
    ipcMain.handle(U.quitAndInstall, () => this.quitAndInstall())
  }
}

export const updateService = new UpdateService()
