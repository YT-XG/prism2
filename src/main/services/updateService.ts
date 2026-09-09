/**
 * 应用更新服务
 * @description 平台分支：mac/win 走「统一自定义锚点(manifest) + 多线程下载引擎 + SHA-256 校验」，仅安装层不同；
 *  - mac：无签名原地替换 `.app`（无签名封条，可安全覆盖自身内容）→ relaunch；
 *  - win：下载 NSIS `*-setup.exe`，静默 `/S /D=<安装目录>` 覆盖安装 → 由安装器拉启新版；
 * 面向无签名（mac 无 Gatekeeper 复弹 / win 无 SmartScreen 阻塞），真正静默更新。
 *
 * 自更新源解析（**默认不暴露给用户，双源锚点**）：
 *  - 主源：`https://gitee.com/{GITEE_ANCHOR_REPO}/raw/{GITEE_ANCHOR_BRANCH}/latest.json`（Gitee raw，国内访问好；CI 每次发版 `git push -f gitee master` 覆盖该文件，等效「始终最新」；均为构建期常量，不读设置）。
 *  - 兜底：`https://github.com/{UPDATE_ANCHOR_REPO}/releases/latest/download/latest.json`（GitHub「latest」别名，永远指向最新 release 的清单；旧客户端 v2.0.4–v2.0.8 仍唯一指向这里，必须一直可达且自包含）。
 * manifest.redirect 支持整站迁移：换服务器时只需在锚点的 latest.json 里加 `redirect`（指向新清单）与/或 `mirrors`（二进制备用源，字段已声明、下载引擎暂未消费），
 * 已安装客户端零改动即可跟随。binaries 按当前平台取安装包；下载按 url。
 *
 * 所有状态变化经 BROADCAST.updateStatus 广播 + getStatus 主动查询，渲染端无需轮询。
 */
import { app, ipcMain, net, shell } from 'electron'
import log from 'electron-log'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream, existsSync } from 'node:fs'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import semver from 'semver'
import { broadcast } from '../utils/platform'
import { notificationService } from './notificationService'
import { MultiThreadDownloadEngine } from '../core/downloadEngine'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type { UpdateManifest, UpdateManifestBinary, UpdateStatusInfo } from '@preload/ipc'

/**
 * 更新锚点仓库（owner/repo）——构建期唯一来源，**不读持久化设置**。
 * 新客户端主源 = Gitee raw（国内访问好），兜底 = 下方 GitHub「latest」别名；旧客户端（v2.0.4–v2.0.8）仍只读 GitHub。
 * 换服务器/换仓库时只需改这些常量（或让该仓库的 latest.json 加 redirect/mirrors 指向新地址），客户端零改动。
 * 刻意不读取 AppSettings.githubRepo，避免用户 settings.json 里残留的旧值覆盖新默认值导致更新源错误（如曾 404 到旧仓库）。
 */
const UPDATE_ANCHOR_REPO = 'YT-XG/prism2'

/**
 * Gitee 锚点仓库（owner/repo）——构建期常量，须与 release.yml 的 GITEE_ANCHOR_REPO secret 完全一致。
 * Gitee 无 GitHub「latest」别名，改用 `raw/{branch}/{file}` 稳定路径：CI 每次发版 `git push -f gitee master`
 * 覆盖该文件，等效「始终最新」。与 GitHub 锚点同一位（yt-xg/prism2，空仓库，master 分支）。
 */
const GITEE_ANCHOR_REPO = 'yt-xg/prism2'
const GITEE_ANCHOR_BRANCH = 'master'
const GITEE_ANCHOR_FILE = 'latest.json'

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

  /** App Translocation（只读暂存副本）场景解析出的真实可执行文件路径，用于安装完成后拉起新版 */
  private macRealExePath: string | null = null

  /** 检查序号：cancel() 或新检查会自增，使在途检查/下载结果失效（取消检查的幂等防护） */
  private checkSeq = 0

  /** 初始化：创建更新引擎 + 注册 IPC */
  init(): void {
    if (this.wired) return
    this.wired = true

    this.engine = new MultiThreadDownloadEngine({
      onTaskUpdated: (task) => this.#onUpdateTask(task)
    })

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

  /** 检查更新：mac/win 走统一自定义锚点 */
  async check(): Promise<UpdateStatusInfo> {
    if (!app.isPackaged) {
      this.#setStatus({
        status: 'idle',
        message: '开发模式不支持自动更新，请打包后测试'
      })
      return this.getStatus()
    }

    // mac / win → 统一自定义锚点
    return this.#checkCustom()
  }

  /** 安装已下载的更新并重启（mac 原地替换 / win NSIS 静默） */
  quitAndInstall(): void {
    if (this.status.status !== 'downloaded') return

    const handleError = (err: unknown): void => {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[UpdateService] 安装失败:', message)
      // 安装失败时保留安装包并带出本地路径/下载链接，供用户手动安装（打开目录 / 浏览器下载）
      this.#setStatus({
        status: 'error',
        error: message,
        installerPath: this.downloadedZipPath ?? undefined,
        downloadUrl: this.downloadedManifest ? this.#pickBinary(this.downloadedManifest)?.url ?? undefined : undefined
      })
    }

    if (process.platform === 'darwin') {
      void this.#installOnMac().catch(handleError)
    } else {
      void this.#installOnWindows().catch(handleError)
    }
  }

  /** 暂停更新下载（保留已下载进度，可恢复） */
  pause(): UpdateStatusInfo {
    if (this.status.status === 'downloading' && this.updateTaskId) {
      this.engine?.pauseDownload(this.updateTaskId)
    }
    return this.getStatus()
  }

  /** 恢复已暂停的更新下载（断点续传） */
  async resume(): Promise<UpdateStatusInfo> {
    if (this.status.status !== 'paused' || !this.updateTaskId) return this.getStatus()
    try {
      await this.engine?.resumeDownload(this.updateTaskId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[UpdateService] 恢复下载失败:', message)
      this.#setStatus({ status: 'error', error: message })
    }
    return this.getStatus()
  }

  /**
   * 取消正在进行的更新检查或下载。
   * - 检查阶段：自增 checkSeq 使在途检查结果失效，回到 idle；
   * - 下载/暂停阶段：取消引擎任务，引擎 emit canceled → 状态回到「发现新版本」可重新下载。
   */
  cancel(): UpdateStatusInfo {
    this.checkSeq++
    if (this.updateTaskId) {
      this.engine?.cancelDownload(this.updateTaskId)
    } else if (this.status.status === 'checking' || this.status.status === 'available') {
      this.#setStatus({ status: 'idle' })
    }
    return this.getStatus()
  }

  /**
   * 重新安装最新版本：与 check() 同一流程，但跳过版本比较，强制下载最新安装包并进入「已下载可安装」状态。
   * 用于验证安装流程（无需等待发布新版本）。
   */
  async reinstall(): Promise<UpdateStatusInfo> {
    if (!app.isPackaged) {
      this.#setStatus({
        status: 'idle',
        message: '开发模式不支持自动更新，请打包后测试'
      })
      return this.getStatus()
    }
    return this.#checkCustom(true)
  }

  // ---------------------------------------------------------------------------
  // mac 自定义更新
  // ---------------------------------------------------------------------------

  /** mac 自定义检查：拉取 manifest → 版本比较 → 自动下载；force=true 时跳过版本比较强制重装 */
  async #checkCustom(force = false): Promise<UpdateStatusInfo> {
    const seq = ++this.checkSeq
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

    // 检查期间被取消（或被新的检查取代）：忽略本次结果
    if (seq !== this.checkSeq) return this.getStatus()

    const version = String(manifest.version || '').trim()
    if (!version) {
      this.#setStatus({ status: 'error', error: '更新清单缺少版本号' })
      return this.getStatus()
    }

    // 非强制检查才做版本比较；强制重装（reinstall）直接下载最新包
    if (!force) {
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
      title: force ? '重新安装最新版本' : '发现新版本',
      message: force ? `v${version} 正在后台下载，完成后可安装` : `v${version} 已发布，正在后台下载…`
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

  /** 计算 manifest 源列表：主源 = Gitee raw（国内访问好，CI 每次发版 `git push -f gitee master` 覆盖该文件，等效「始终最新」）；
   *  兜底 = GitHub「latest」别名（旧客户端 v2.0.4–v2.0.8 仍唯一指向这里，必须一直可达且自包含）。
   *  换服务器时无需改客户端——只需在该锚点的 latest.json 里加 `redirect`/`mirrors`，客户端自动跟随。 */
  #manifestSources(): string[] {
    return [
      `https://gitee.com/${GITEE_ANCHOR_REPO}/raw/${GITEE_ANCHOR_BRANCH}/${GITEE_ANCHOR_FILE}`,
      `https://github.com/${UPDATE_ANCHOR_REPO}/releases/latest/download/latest.json`
    ]
  }

  /** 从 manifest 中选取当前平台的安装包（mac 优先 universal；win/linux 取该平台首项） */
  #pickBinary(manifest: UpdateManifest): UpdateManifestBinary | null {
    const platform = process.platform === 'darwin' ? 'mac' : 'win'
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

    const seq = this.checkSeq

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
    // 任务建立期间被用户取消：取消刚创建的任务（此时 updateTaskId 未赋值，canceled 事件会被过滤）
    if (seq !== this.checkSeq) {
      this.engine.cancelDownload(task.id)
      return
    }
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
    } else if (task.status === 'paused') {
      this.#setStatus({
        status: 'paused',
        version: this.status.version,
        progress: Math.round(task.progress * 100)
      })
    } else if (task.status === 'completed') {
      void this.#onUpdateDownloaded()
    } else if (task.status === 'canceled') {
      // 用户主动取消下载：回到「发现新版本」，可点击重新下载
      this.updateTaskId = null
      this.#setStatus({
        status: 'available',
        version: this.status.version,
        releaseDate: undefined,
        releaseNotes: this.status.releaseNotes
      })
    } else if (task.status === 'failed') {
      const message = task.errorMessage || '更新下载失败'
      log.error('[UpdateService] 更新下载失败:', message)
      this.updateTaskId = null
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

    // 解压更新包：mac 应用包 Frameworks 内含符号链接（Versions/Current → A、Resources → Versions/Current/Resources 等，
    // 链接目标即条目内容，如 size=1/26），adm-zip 0.6.x 无符号链接支持会把链接条目当普通文件落地 → .app 无法启动；
    // 且其 writeFileTo 在 macOS 上 openSync 失败后兜底 chmodSync 会对「路径尚不存在/残留半成品」抛 `chmod ENOENT`
    // （线上即此报错）。改用 macOS 原生 ditto 解压，原生保留符号链接与权限；每次先清空旧解压残留，失败也清，
    // 保证重试（含上一次失败遗留的脏 extracted/）都从全新目录开始。
    await rm(extractDir, { recursive: true, force: true })
    await mkdir(extractDir, { recursive: true })
    await this.#extractMacZip(zipPath, extractDir)

    const appDirName = await this.#findAppDir(extractDir)
    if (!appDirName) {
      throw new Error('更新包内未找到应用目录')
    }

    // 真实应用目录：正常由 exe 路径推导；若运行于 App Translocation 只读暂存副本
    // （从下载目录/磁盘镜像等隔离位置直接启动触发），则解析真实安装位置再安装，
    // 否则原地替换只会写进只读副本、且更新后拉起的仍是旧代码。
    let bundleRoot: string
    let realExePath: string | null = null
    if (this.#isMacAppTranslocated()) {
      const real = await this.#resolveMacRealBundleRoot()
      if (!real) {
        throw new Error('应用运行于 App Translocation 只读暂存位置且未定位到真实应用目录，请退出后从应用安装位置重新打开，或改为手动安装')
      }
      bundleRoot = real
      realExePath = join(real, 'Contents', 'MacOS', basename(app.getPath('exe')))
    } else {
      bundleRoot = resolve(dirname(app.getPath('exe')), '..', '..')
    }
    this.macRealExePath = realExePath

    const contents = join(bundleRoot, 'Contents')
    const oldContents = `${contents}.old-${version}`
    const newContents = join(extractDir, appDirName, 'Contents')

    // 写权限检查（/Applications 等 root 目录或 root 属主应用可能只读）：
    // 普通路径原地替换；无权限则经系统鉴权弹窗以管理员权限完成同样的原子替换。
    try {
      await access(bundleRoot, constants.W_OK)
    } catch {
      await this.#installOnMacAsAdmin(bundleRoot, oldContents, newContents)
      this.#finishMacUpdate(stagingDir, version)
      return
    }

    try {
      await rm(oldContents, { recursive: true, force: true }).catch(() => {})
      await rename(contents, oldContents)
      await rm(contents, { recursive: true, force: true }).catch(() => {})
      await rename(newContents, contents)
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

    // 删除旧 Contents 备份 + 延迟清理 staging：仅成功路径到达此处（失败在抛错处提前返回，staging 保留
    // 安装包，供 quitAndInstall 的 handleError 带出 installerPath 手动安装）。
    await rm(oldContents, { recursive: true, force: true }).catch(() => {})
    this.#finishMacUpdate(stagingDir, version)
  }

  /** 是否运行于 App Translocation 只读暂存副本（macOS 对隔离应用的阴影执行） */
  #isMacAppTranslocated(): boolean {
    return process.execPath.includes('/AppTranslocation/')
  }

  /**
   * 解析 App Translocation 场景的真实应用目录：暂存路径形如
   * `.../T/AppTranslocation/<hash>/d/<App>.app/Contents/MacOS/<exe>`，`d/` 之后即为应用相对路径。
   * 到 `/Applications` 与 `~/Applications` 匹配同名 `.app`，并按 CFBundleIdentifier 校验防止替换到错误应用；
   * 未定位（如应用原先位于下载目录等）返回 null，交由外层转手动安装引导。
   */
  async #resolveMacRealBundleRoot(): Promise<string | null> {
    const marker = '/AppTranslocation/'
    const idx = process.execPath.indexOf(marker)
    if (idx === -1) return null
    const segs = process.execPath.slice(idx + marker.length).split('/')
    if (segs.length < 3 || segs[1] !== 'd') return null
    const appName = segs[2]
    const exeName = basename(process.execPath)
    const currentBundleId = await this.#readMacBundleId(resolve(dirname(process.execPath), '..'))
    if (!currentBundleId) return null
    const candidates = [join('/Applications', appName), join(homedir(), 'Applications', appName)]
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      if (!existsSync(join(candidate, 'Contents', 'MacOS', exeName))) continue
      if ((await this.#readMacBundleId(candidate)) === currentBundleId) return candidate
    }
    return null
  }

  /** 读取 macOS 应用包 CFBundleIdentifier（Info.plist XML 简单提取，失败返回 null） */
  async #readMacBundleId(bundlePath: string): Promise<string | null> {
    try {
      const raw = await readFile(join(bundlePath, 'Contents', 'Info.plist'), 'utf8')
      const m = raw.match(/CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)
      return m ? m[1].trim() : null
    } catch {
      return null
    }
  }

  /**
   * macOS 管理员授权安装：应用目录当前用户不可写（/Applications 等受保护位置或 root 属主）时调用。
   * 将原子替换脚本写入 userData 后经 `osascript do shell script ... with administrator privileges`
   * 拉起系统鉴权弹窗，以管理员权限完成与普通路径一致的 `Contents` 原子替换（`.old-<version>` 备份 + 失败回滚 +
   * 恢复原属主，避免下次更新反复弹鉴权）。用户取消鉴权或执行失败则抛错，回落 error 状态与手动安装引导。
   */
  async #installOnMacAsAdmin(bundleRoot: string, oldContents: string, newContents: string): Promise<void> {
    const scriptPath = join(app.getPath('userData'), 'admin-update-install.sh')
    const script = [
      '#!/bin/bash',
      'set -e',
      `APP=${this.#shellQuote(bundleRoot)}`,
      `OLD=${this.#shellQuote(oldContents)}`,
      `NEW=${this.#shellQuote(newContents)}`,
      // 记录原 Contents 属主，管理员写入后归还，避免下次更新反复弹鉴权
      'OWNER=$(stat -f \'%u:%g\' "$APP/Contents" 2>/dev/null || true)',
      'rm -rf "$OLD"',
      'mv "$APP/Contents" "$OLD"',
      'if ! mv "$NEW" "$APP/Contents"; then',
      '  mv "$OLD" "$APP/Contents" 2>/dev/null || true',
      '  exit 1',
      'fi',
      '[ -n "$OWNER" ] && chown -R "$OWNER" "$APP/Contents" 2>/dev/null || true',
      'rm -rf "$OLD"',
      ''
    ].join('\n')
    await writeFile(scriptPath, script, { mode: 0o755 })
    try {
      await new Promise<void>((resolvePromise, reject) => {
        execFile(
          'osascript',
          ['-e', `do shell script "${this.#escapeAppleScript(scriptPath)}" with administrator privileges`],
          { timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 },
          (err, _stdout, stderr) => {
            if (!err) {
              resolvePromise()
              return
            }
            const detail = `${err instanceof Error ? err.message : String(err)} ${stderr ?? ''}`.trim()
            if (detail.includes('-128') || /user canceled/i.test(detail)) {
              reject(new Error('未获得系统授权，已取消管理员安装，请改为手动安装'))
            } else {
              reject(new Error(`管理员安装失败: ${detail || '未知错误'}`))
            }
          }
        )
      })
      log.info('[UpdateService] 经管理员授权完成安装，重启应用')
    } finally {
      await rm(scriptPath, { force: true }).catch(() => {})
    }
  }

  /** bash 单引号安全引用（路径含空格/引号时防注入） */
  #shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`
  }

  /** AppleScript 字符串字面量转义（`\` 与 `"`） */
  #escapeAppleScript(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }

  /** mac 安装成功收尾：延迟清理 staging + 重启（Translocation 场景显式拉起真实可执行文件） */
  #finishMacUpdate(stagingDir: string, version: string): void {
    setTimeout(() => {
      void rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    }, 2000)
    log.info('[UpdateService] 更新已安装到应用目录，重启应用:', version)
    if (this.macRealExePath) {
      const child = spawn(this.macRealExePath, [], { detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
      app.quit()
    } else {
      app.relaunch()
      app.quit()
    }
  }

  /**
   * macOS 原生解压 zip（`ditto -x -k`）：保留 Frameworks 符号链接与可执行权限，解压失败清理半成品目录并抛错。
   * 不用 adm-zip（无符号链接支持，且存在 `chmod ENOENT` 类错误兜底路径）。
   */
  #extractMacZip(zipPath: string, extractDir: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      execFile('ditto', ['-x', '-k', zipPath, extractDir], { timeout: 5 * 60 * 1000 }, (err) => {
        if (err) {
          void rm(extractDir, { recursive: true, force: true })
            .catch(() => {})
            .then(() => reject(err))
        } else {
          resolvePromise()
        }
      })
    })
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
    // 关键：用 shell 启动——Node 在 Windows 不带 shell 直接 spawn 下载的 exe 可能报 EFTYPE（系统不认作可执行文件），
    // 经 cmd.exe 启动可绕开（v1 即 shell:true）；/D= 目录含空格时 cmd 会拆引号，本路径仅取 dirname，通常无空格。
    try {
      const child = spawn(setupPath, ['/S', `/D=${installDir}`], {
        detached: true,
        stdio: 'ignore',
        shell: true
      })
      child.on('error', (err) => this.#onWinInstallSpawnError(err, setupPath))
      child.unref()
    } catch (err) {
      this.#onWinInstallSpawnError(err, setupPath)
    }
    // 延迟清理：安装完成后移除暂存的安装器
    setTimeout(() => {
      void rm(setupPath, { force: true }).catch(() => {})
    }, 2000)
    app.quit()
  }

  /** 安装器启动失败兜底：定位文件 + 提示手动安装，避免静默卡死 */
  #onWinInstallSpawnError(err: unknown, setupPath: string): void {
    const message = err instanceof Error ? err.message : String(err)
    log.error('[UpdateService] 安装器启动失败:', message)
    shell.showItemInFolder(setupPath)
    this.#notifyError('自动安装失败', '系统拒绝运行更新安装器，已定位文件，请手动运行完成更新')
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
  // 手动安装引导（安装失败兜底）
  // ---------------------------------------------------------------------------

  /** 打开已下载安装包所在目录（Finder/资源管理器），供用户手动安装 */
  openInstallerFolder(): void {
    const zipPath = this.downloadedZipPath
    if (!zipPath || !existsSync(zipPath)) {
      this.#notifyError('安装包不可用', '暂存目录未找到安装包，请点击「检查更新」重新下载')
      return
    }
    shell.showItemInFolder(zipPath)
  }

  /** 在系统浏览器打开安装包下载链接，供用户自行下载安装 */
  openDownloadUrl(): void {
    const url = this.downloadedManifest ? this.#pickBinary(this.downloadedManifest)?.url : undefined
    if (!url) {
      this.#notifyError('下载链接不可用', '未获取到安装包下载链接，请点击「检查更新」重新获取')
      return
    }
    void shell.openExternal(url)
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
    broadcast(BROADCAST.updateStatus, this.getStatus(), { onlyVisible: true })
  }

  /** 通知错误（受通知中心开关控制） */
  #notifyError(title: string, message: string): void {
    notificationService.notify({ type: 'error', source: 'update', title, message })
  }

  #registerIPC(): void {
    const U = SERVICE_CHANNELS.update
    ipcMain.handle(U.getStatus, () => this.getStatus())
    ipcMain.handle(U.check, () => this.check())
    ipcMain.handle(U.reinstall, () => this.reinstall())
    ipcMain.handle(U.pause, () => this.pause())
    ipcMain.handle(U.resume, () => this.resume())
    ipcMain.handle(U.cancel, () => this.cancel())
    ipcMain.handle(U.quitAndInstall, () => this.quitAndInstall())
    ipcMain.handle(U.openInstallerFolder, () => this.openInstallerFolder())
    ipcMain.handle(U.openDownloadUrl, () => this.openDownloadUrl())
  }
}

export const updateService = new UpdateService()
