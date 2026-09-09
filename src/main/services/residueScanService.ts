/**
 * 系统残留扫描与清理服务
 * @description 存储优化的「残留」部分：扫描并可清理各平台残留项目。
 *
 * - Windows（仅 HKCU——HKLM 写入需管理员权限，普通权限下删除必然失败，
 *   不列出）：失效自启项（Run 值解析出可核验的绝对路径且不存在）、孤儿
 *   卸载注册项（引用路径全部不存在）、Prism 已知残留（v1 右键菜单键）、
 *   本应用 userData 内可安全清理的 Chromium 缓存/日志与历史版本更新包。
 * - macOS：枚举 v1（Prism）在 ~/Library 的足迹与 /Applications 旧安装；
 *   当前应用自身的文件（prism2/Prism 2 数据目录、com.prism.next 运行时
 *   文件、/Applications/Prism 2.app 本体）不属于残留，绝不列出。
 *
 * 安全模型：
 * - 文件清理统一 shell.trashItem（移入回收站，可恢复）；clean 前做路径
 *   边界校验（realpath 解析后仅允许 ~/Library、/Applications、
 *   ~/Applications 与 userData 内，拒绝盘符/文件系统根、用户主目录本身、
 *   系统目录与当前应用本体与 userData 根）。
 * - 环境变量无法展开、网络路径（UNC）、所在盘符不存在时一律视为「无法核验」
 *   跳过，宁可漏报不误报（避免把仍在使用的软件误判为孤儿而删除其注册项）。
 * - 注册表删除前先 REG EXPORT 导出 .reg 备份到 userData/residue-backups
 *   （只保留最近 10 份）；reg 子命令经 spawn 参数数组直传不经 shell，
 *   且键名/值名删除前做字符校验（拒绝开关前缀/引号/控制字符），防止被
 *   reg.exe 当作参数解析或破坏命令行。
 * - 本应用缓存/日志运行中可能被进程占用（Windows 文件锁），逐子项清理
 *   尽量回收空间，被占用项如实报错。
 */
import { app, ipcMain, shell } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import log from 'electron-log'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type {
  ResidueCleanResult,
  ResidueItem,
  ResidueKind,
  ResidueRisk,
  ResidueScanProgress,
  ResidueScanResult
} from '@preload/ipc'
import { broadcast } from '../utils/platform'
import {
  LEGACY_DIR_NAMES,
  MAC_SERVICES_WORKFLOW_NAME,
  WIN_RUN_KEY,
  WIN_SHELL_KEY
} from './legacyPaths'
import {
  backupRegistryKey,
  expandEnvPath,
  isSafeRegArg,
  pruneBackups,
  reg,
  trashDirContents,
  verifiablePath,
  verifiedCleanPath
} from './storageCleanup'

const execAsync = promisify(exec)

/** PowerShell stdout 强制 UTF-8（中文系统默认 OEM/GBK 代码页会被 Node 按 UTF-8 误解码成乱码） */
const PS_UTF8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'

/** mac 相关 bundle 标识（当前应用 appId，仅用于当前应用缓存定位与排除判断） */
const BUNDLE_ID = 'com.prism.next'
/** 当前应用在 mac ~/Library/Caches 下的缓存目录候选名 */
const CURRENT_APP_CACHE_NAMES = ['prism2', 'Prism 2', BUNDLE_ID] as const
/**
 * 本应用 userData 内可安全清理的 Chromium 缓存子目录。
 * 不含 Network / Local Storage / Session Storage（含用户会话与渲染端数据）。
 */
const APP_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'Dictionaries',
  'blob_storage',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Shared Dictionary'
] as const
/** 目录大小统计的并发闸门（同时在途的 fs 操作数） */
const SIZE_CONCURRENCY = 8
/** 单次扫描允许统计的最大条目数（防病态目录树长时间占用） */
const MAX_WALK_ENTRIES = 200_000

/** 进度广播节流（毫秒） */
const PROGRESS_INTERVAL_MS = 150

/** 路径是否指向现存文件（对无扩展名路径同时尝试补 .exe，模拟 CreateProcess） */
async function resolvesToFile(p: string): Promise<boolean> {
  if (!verifiablePath(p)) return false
  try {
    if ((await fsp.stat(p)).isFile()) return true
  } catch {
    // 路径不存在，继续按无扩展名规则尝试
  }
  if (!/\.[^\\/.]+$/.test(p)) {
    try {
      return (await fsp.stat(`${p}.exe`)).isFile()
    } catch {
      return false
    }
  }
  return false
}

/**
 * 解析 Run 值等命令字符串的实际目标（模拟 CreateProcess 对未加引号命令的
 * 逐段扩展解析：从最长空格前缀到最短，命中现存文件即为目标，避免
 * `C:\Program Files\...` 被截断成 `C:\Program` 的误报）。全不命中时返回
 * 首个参数标记前的路径形态供孤儿判定；无法判定时 target 为空。
 */
async function resolveCommandTarget(raw: string): Promise<{ target: string; exists: boolean }> {
  const s = raw.trim()
  const quoted = s.match(/^"([^"]+)"/)
  if (quoted?.[1]) {
    const p = expandEnvPath(quoted[1])
    if (!verifiablePath(p)) return { target: '', exists: false }
    return { target: p, exists: await resolvesToFile(p) }
  }
  const tokens = s.split(/\s+/)
  for (let i = tokens.length; i >= 1; i--) {
    const prefix = expandEnvPath(tokens.slice(0, i).join(' '))
    if (await resolvesToFile(prefix)) return { target: prefix, exists: true }
  }
  // 全部前缀都不是现存文件：取参数标记（-x / /x）前的路径形态作展示目标
  const cut: string[] = []
  for (const t of tokens) {
    if (cut.length && /^[-/]/.test(t)) break
    cut.push(t)
  }
  const target = expandEnvPath(cut.join(' '))
  if (target.includes('\\') && verifiablePath(target)) return { target, exists: false }
  return { target: '', exists: false }
}

/**
 * 从候选字符串（InstallLocation/UninstallString/DisplayIcon）解析出可核验
 * 的绝对路径：展开 %环境变量%、剥引号与 `,图标序号` 后缀、无引号时截到
 * 首个参数标记。返回 null 表示无法核验（非绝对路径如 MsiExec/rundll32 裸
 * 命令、环境变量未展开、网络路径、盘符离线）。
 */
function interpretAbsolutePath(raw: string): string | null {
  let s = expandEnvPath(raw.trim()).replace(/,\d+$/, '')
  const quoted = s.match(/^"([^"]+)"/)
  if (quoted?.[1]) {
    s = quoted[1]
  } else {
    const tokens = s.split(/\s+/)
    const cut: string[] = []
    for (const t of tokens) {
      if (cut.length && /^[-/]/.test(t)) break
      cut.push(t)
    }
    s = cut.join(' ')
  }
  s = s.replace(/\\+$/, '').trim()
  if (!s.includes('\\') || !verifiablePath(s)) return null
  return s
}

/** 简单并发闸门：限制同时在途的 fs 操作数，避免大目录树打满文件句柄 */
class Semaphore {
  #limit: number
  #active = 0
  #waiters: (() => void)[] = []

  constructor(limit: number) {
    this.#limit = limit
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limit) {
      await new Promise<void>((release) => this.#waiters.push(release))
    }
    this.#active += 1
    try {
      return await task()
    } finally {
      this.#active -= 1
      this.#waiters.shift()?.()
    }
  }
}

/** 单次目录统计的运行时状态 */
interface WalkState {
  sem: Semaphore
  isCancelled: () => boolean
  visited: number
}

/**
 * 递归统计目录总大小（异步遍历不阻塞主进程；跳过符号链接防环；
 * 无法读取的项按 0 计；取消或超出条目上限时返回已统计部分）。
 *
 * 并发闸门只包裹叶子级 fs 操作（readdir/lstat），**不**包裹递归调用本身：
 * 否则深层目录会嵌套持有闸门槽位，槽位耗尽后互相等待而死锁。
 * 同层文件 lstat 并发执行，深层子目录按序递归（与原串行实现同量级）。
 */
async function dirSize(dir: string, state: WalkState): Promise<number> {
  if (state.isCancelled() || state.visited >= MAX_WALK_ENTRIES) return 0
  let names: string[]
  try {
    names = await state.sem.run(() => fsp.readdir(dir))
  } catch {
    // 目录读取失败按 0 计
    return 0
  }
  let total = 0
  const subdirs: string[] = []
  const sizes = await Promise.all(
    names.map((name) =>
      state.sem.run(async () => {
        if (state.isCancelled() || state.visited >= MAX_WALK_ENTRIES) return 0
        state.visited += 1
        const full = join(dir, name)
        try {
          const st = await fsp.lstat(full)
          if (st.isSymbolicLink()) return 0
          if (st.isDirectory()) {
            subdirs.push(full)
            return 0
          }
          return st.size
        } catch {
          return 0
        }
      })
    )
  )
  for (const size of sizes) total += size
  for (const sub of subdirs) {
    if (state.isCancelled()) break
    total += await dirSize(sub, state)
  }
  return total
}

/** 单次扫描的运行时上下文 */
interface ScanContext {
  items: ResidueItem[]
  seen: Set<string>
  isCancelled: () => boolean
  walk: WalkState
  /** 上次进度广播时间（节流基线） */
  lastEmit: number
}

class ResidueScanService {
  /** 最近一次扫描结果缓存（clean 按 id 查找条目） */
  #lastItems: ResidueItem[] = []
  /** 扫描中互斥 */
  #scanning = false
  /** 清理中互斥 */
  #cleaning = false
  /** 取消标记（scan 期间有效） */
  #cancelToken = false

  /** 条目 id 唯一性去重（Set 判重，O(1)） */
  #push(ctx: ScanContext, item: ResidueItem): void {
    if (ctx.seen.has(item.id)) return
    ctx.seen.add(item.id)
    ctx.items.push(item)
  }

  /** 进度广播（节流；finished 帧必发） */
  #emit(ctx: ScanContext, phase: string, label: string, finished: boolean): void {
    ctx.lastEmit = Date.now()
    broadcast(BROADCAST.residueScanProgress, {
      phase,
      label,
      items: ctx.items.length,
      finished
    } satisfies ResidueScanProgress)
  }

  /** 进入阶段：置进度文案（节流，避免频繁广播） */
  #phase(ctx: ScanContext, phase: string, label: string): void {
    if (Date.now() - ctx.lastEmit >= PROGRESS_INTERVAL_MS) this.#emit(ctx, phase, label, false)
  }

  /** 统计目录大小（绑定当前扫描的取消标记与并发闸门） */
  #sizeOf(ctx: ScanContext, dir: string): Promise<number> {
    return dirSize(dir, ctx.walk)
  }

  // -------------------------------------------------------------------------
  // Win 扫描
  // -------------------------------------------------------------------------

  /**
   * Win：失效自启项——解析 Run 键下指向不存在目标的值（仅 HKCU）。
   * 经 PowerShell 读值并强制 UTF-8 输出：REG QUERY 走系统 OEM 代码页
   * （中文系统为 GBK），中文值名/路径会被 Node 按 UTF-8 误解码成乱码，
   * 导致显示乱码且 existsSync 恒 false 而误判孤儿。
   */
  async #detectWinStartupOrphans(ctx: ScanContext): Promise<void> {
    // HKLM 的 Run 值写入需管理员权限，普通权限下删除必然失败，不列出
    const psRunKey = WIN_RUN_KEY.replace(/^HKCU/, 'HKCU:')
    let stdout: string
    try {
      const out = await execAsync(
        `powershell -NoProfile -Command "${PS_UTF8} $k='${psRunKey}'; (Get-Item $k).Property | ForEach-Object { [PSCustomObject]@{ Name = $_; Data = [string](Get-ItemPropertyValue $k $_) } } | ConvertTo-Json -Compress"`,
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      )
      stdout = out.stdout
    } catch {
      // 键不存在时忽略
      return
    }
    const trimmed = stdout.trim()
    if (!trimmed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      log.warn('[ResidueScan] 解析 Run 键枚举输出失败:', err)
      return
    }
    const rows: Array<{ Name?: string; Data?: string }> = Array.isArray(parsed)
      ? parsed
      : parsed
        ? [parsed]
        : []
    for (const row of rows) {
      if (ctx.isCancelled()) return
      const name = row.Name
      const data = row.Data
      if (!name || typeof data !== 'string') continue
      const { target, exists } = await resolveCommandTarget(data)
      // 解析不出可核验的绝对路径（纯文件名、未展开变量、网络路径等）时宁可漏报不误报
      if (!target || !target.includes('\\')) continue
      if (target.toLowerCase().startsWith('c:\\windows')) continue
      if (exists) continue
      if (!isSafeRegArg(name)) {
        // 值名含开关前缀/引号等字符：仍列出（用户可见），但 clean 阶段会拒绝执行删除
        log.warn('[ResidueScan] 自启项值名含不安全字符，仅展示不可清理:', name)
      }
      this.#push(ctx, {
        id: `win:run:${WIN_RUN_KEY}:${name}`,
        kind: 'startup-orphan',
        title: `${name}（当前用户）`,
        detail: `开机自启项指向的文件不存在：${target}`,
        risk: 'confirm',
        platform: 'win',
        registryKey: WIN_RUN_KEY,
        registryValue: name
      })
    }
  }

  /** Win：孤儿卸载注册项——Uninstall 项引用的路径全部不存在（仅 HKCU） */
  async #detectWinUninstallOrphans(ctx: ScanContext): Promise<void> {
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${PS_UTF8} Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation,UninstallString,DisplayIcon,PSChildName,PSPath | ConvertTo-Json -Compress"`,
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      )
      const trimmed = stdout.trim()
      if (!trimmed) return
      const parsed = JSON.parse(trimmed)
      const rows: Array<{
        DisplayName?: string
        DisplayVersion?: string
        Publisher?: string
        InstallLocation?: string
        UninstallString?: string
        DisplayIcon?: string
        PSChildName?: string
        PSPath?: string
      }> = Array.isArray(parsed) ? parsed : [parsed]

      for (const row of rows) {
        if (ctx.isCancelled()) return
        if (!row.DisplayName || !row.UninstallString || !row.PSPath) continue
        // 候选路径（安装目录/卸载器/图标）：展开环境变量、剥引号与图标序号，
        // 无引号含空格时截到首个参数标记（避免截断成 `C:\Program` 误判）
        const candidates = [row.InstallLocation ?? '', row.UninstallString, row.DisplayIcon ?? '']
          .map((raw) => interpretAbsolutePath(raw))
          .filter((p): p is string => p !== null)
        // 一个可核验的绝对路径候选都没有（MsiExec/rundll32 裸命令、变量未展开、
        // 网络路径、盘符离线）→ 无法核验，跳过
        if (!candidates.length) continue
        // 保守补目录候选：卸载器/图标已删但安装目录还在时不判孤儿
        const checks = [...candidates, ...candidates.map((p) => dirname(p))]
        if (checks.some((p) => p.toLowerCase().startsWith('c:\\windows'))) continue
        if (checks.some((p) => existsSync(p))) continue

        const regKey = row.PSPath.replace(/^Microsoft\.PowerShell\.Core\\Registry::/, '')
          .replace(/^HKEY_CURRENT_USER/, 'HKCU')
          .replace(/^HKEY_LOCAL_MACHINE/, 'HKLM')
        if (!isSafeRegArg(regKey)) {
          log.warn('[ResidueScan] 卸载注册项键名含不安全字符，跳过:', regKey)
          continue
        }
        this.#push(ctx, {
          id: `win:uninstall:${row.PSPath}`,
          kind: 'uninstall-orphan',
          title: row.DisplayName,
          detail: `卸载注册项引用的路径均不存在（孤儿项）：${candidates.join('；')}`,
          risk: 'danger',
          platform: 'win',
          registryKey: regKey,
          displayName: row.DisplayName,
          publisher: row.Publisher,
          version: row.DisplayVersion
        })
      }
    } catch (err) {
      log.warn('[ResidueScan] 查询卸载注册项失败:', err)
    }
  }

  /** Win：Prism 已知残留——v1 右键菜单集成键 */
  async #detectWinPrismResidue(ctx: ScanContext): Promise<void> {
    try {
      await execAsync(`REG QUERY "${WIN_SHELL_KEY}"`, { windowsHide: true })
      this.#push(ctx, {
        id: `win:prism:${WIN_SHELL_KEY}`,
        kind: 'prism-residue',
        title: 'Prism v1 右键菜单集成',
        detail: `右键菜单残留键（旧版「分享到妙妙屋」集成）：${WIN_SHELL_KEY}`,
        risk: 'danger',
        platform: 'win',
        registryKey: WIN_SHELL_KEY
      })
    } catch {
      // 键不存在 = 无残留
    }
  }

  // -------------------------------------------------------------------------
  // 本应用缓存/日志与历史更新包（两平台共用 userData 结构）
  // -------------------------------------------------------------------------

  /** 枚举 v2 userData 内可安全清理的 Chromium 缓存与日志目录 */
  async #detectAppCache(ctx: ScanContext): Promise<void> {
    const userData = app.getPath('userData')
    const targets: Array<{ name: string; kind: Extract<ResidueKind, 'app-cache' | 'app-log'> }> = [
      ...APP_CACHE_DIRS.map((name) => ({ name, kind: 'app-cache' as const })),
      { name: 'logs', kind: 'app-log' as const }
    ]
    for (const { name, kind } of targets) {
      if (ctx.isCancelled()) return
      const full = join(userData, name)
      if (!existsSync(full)) continue
      this.#push(ctx, {
        id: `path:${full}`,
        kind,
        title: name,
        detail: `本应用${kind === 'app-cache' ? '缓存' : '日志'}目录：${full}`,
        risk: 'safe',
        platform: process.platform === 'win32' ? 'win' : 'darwin',
        path: full,
        size: await this.#sizeOf(ctx, full)
      })
    }
  }

  /**
   * 历史版本更新包：userData/update-staging/<version>。
   * updateService 安装成功后只清理当前版本目录，历史版本会永久累积
   * （单个安装包上百 MB），这里登记为可清理项；当前版本目录保留，
   * 供「打开安装包」兜底入口使用。
   */
  async #detectUpdateStaging(ctx: ScanContext): Promise<void> {
    const base = join(app.getPath('userData'), 'update-staging')
    let names: string[]
    try {
      names = await fsp.readdir(base)
    } catch {
      // 目录不存在 = 无暂存包
      return
    }
    const current = app.getVersion()
    for (const name of names) {
      if (ctx.isCancelled()) return
      if (name === current) continue
      const full = join(base, name)
      let isDir = false
      try {
        isDir = (await fsp.stat(full)).isDirectory()
      } catch {
        continue
      }
      if (!isDir) continue
      this.#push(ctx, {
        id: `path:${full}`,
        kind: 'app-cache',
        title: `历史版本更新包 ${name}`,
        detail: `已下载且不再使用的更新安装包（当前版本 ${current} 的暂存包保留）：${full}`,
        risk: 'safe',
        platform: process.platform === 'win32' ? 'win' : 'darwin',
        path: full,
        size: await this.#sizeOf(ctx, full)
      })
    }
  }

  // -------------------------------------------------------------------------
  // mac 扫描
  // -------------------------------------------------------------------------

  /** Mac：枚举 v1（Prism）残留足迹；当前应用自身的文件绝不作为残留登记 */
  async #detectMacResidue(ctx: ScanContext): Promise<void> {
    const home = app.getPath('home')
    const lib = join(home, 'Library')

    /** 存在则登记条目（文件取自身大小；目录递归统计） */
    const addDir = async (
      dir: string,
      label: string,
      detail: string,
      risk: ResidueRisk = 'confirm',
      kind: ResidueItem['kind'] = 'prism-residue'
    ): Promise<void> => {
      if (ctx.isCancelled()) return
      const resolved = resolve(dir)
      if (!existsSync(resolved) || ctx.seen.has(`path:${resolved}`)) return
      const st = await fsp.lstat(resolved).catch(() => null)
      if (!st) return
      this.#push(ctx, {
        id: `path:${resolved}`,
        kind,
        title: label,
        detail: `${detail}：${resolved}`,
        risk,
        platform: 'darwin',
        path: resolved,
        size: st.isDirectory() ? await this.#sizeOf(ctx, resolved) : st.size
      })
    }

    // v1 应用数据目录（当前应用数据目录 prism2/Prism 2 不属于残留，不列出）
    for (const name of LEGACY_DIR_NAMES) {
      await addDir(join(lib, 'Application Support', name), name, '旧版（v1）应用数据目录')
    }
    // v1 缓存目录
    for (const name of LEGACY_DIR_NAMES) {
      await addDir(join(lib, 'Caches', name), `${name}（旧版缓存）`, '旧版（v1）缓存目录')
    }
    // 当前应用缓存目录（运行态缓存，可安全清理）与废弃 Squirrel 更新缓存
    for (const name of CURRENT_APP_CACHE_NAMES) {
      await addDir(
        join(lib, 'Caches', name),
        `${name}（缓存）`,
        '本应用缓存目录',
        'safe',
        'app-cache'
      )
    }
    await addDir(
      join(lib, 'Caches', `${BUNDLE_ID}.ShipIt`),
      'ShipIt 更新缓存',
      'Squirrel 自动更新临时缓存（已废弃机制）',
      'safe',
      'app-cache'
    )
    // v1 右键菜单工作流
    await addDir(
      join(lib, 'Services', MAC_SERVICES_WORKFLOW_NAME),
      '分享到妙妙屋.workflow',
      'v1 右键菜单工作流'
    )
    // v1 日志目录（卸载后遗留，可安全清理）
    await addDir(join(lib, 'Logs', 'Prism'), 'Prism（旧版日志）', '旧版（v1）日志目录')
    // 登录项 plist（文件可直接删；系统登录项无法用 Electron API 移除的限制见文档）
    try {
      for (const name of await fsp.readdir(join(lib, 'LaunchAgents'))) {
        if (ctx.isCancelled()) break
        // 排除当前应用自身（prism2 / Prism 2 / com.prism.next），只登记 v1 的
        if (/prism/i.test(name) && !/prism\s*2|prism2|com\.prism\.next/i.test(name)) {
          await addDir(join(lib, 'LaunchAgents', name), name, '登录项/守护配置')
        }
      }
    } catch {
      // LaunchAgents 目录不存在
    }
    // v1 旧安装（/Applications 下的 Prism 2.app 是当前应用本体，绝不列出）
    await addDir(
      '/Applications/Prism.app',
      'Prism（v1）.app',
      '旧版安装残留（移入废纸篓即卸载）',
      'danger'
    )
    await addDir(
      join(home, 'Applications', 'Prism.app'),
      'Prism（v1）.app',
      '旧版安装残留（移入废纸篓即卸载）',
      'danger'
    )
  }

  // -------------------------------------------------------------------------
  // 扫描 / 清理
  // -------------------------------------------------------------------------

  /** 取消当前扫描（无扫描时 no-op） */
  async cancel(): Promise<void> {
    this.#cancelToken = true
  }

  /** 扫描全部残留（平台分支） */
  async scan(): Promise<ResidueScanResult> {
    if (this.#scanning) {
      return {
        platform: process.platform === 'darwin' ? 'darwin' : 'win',
        items: [],
        totalReclaimableBytes: 0,
        scannedAt: Date.now(),
        error: '已有扫描进行中'
      }
    }
    this.#scanning = true
    this.#cancelToken = false
    const ctx: ScanContext = {
      items: [],
      seen: new Set<string>(),
      isCancelled: () => this.#cancelToken,
      walk: {
        sem: new Semaphore(SIZE_CONCURRENCY),
        isCancelled: () => this.#cancelToken,
        visited: 0
      },
      lastEmit: 0
    }

    try {
      if (process.platform === 'win32') {
        this.#phase(ctx, 'registry-startup', '检查开机自启项')
        await this.#detectWinStartupOrphans(ctx)
        this.#phase(ctx, 'registry-uninstall', '检查卸载注册项')
        await this.#detectWinUninstallOrphans(ctx)
        this.#phase(ctx, 'prism-residue', '检查 Prism 系统残留')
        await this.#detectWinPrismResidue(ctx)
        this.#phase(ctx, 'app-cache', '统计本应用缓存与日志')
        await this.#detectAppCache(ctx)
        this.#phase(ctx, 'update-staging', '检查历史版本更新包')
        await this.#detectUpdateStaging(ctx)
      } else if (process.platform === 'darwin') {
        this.#phase(ctx, 'prism-residue', '检查 Prism 足迹')
        await this.#detectMacResidue(ctx)
        this.#phase(ctx, 'app-cache', '统计本应用缓存与日志')
        await this.#detectAppCache(ctx)
        this.#phase(ctx, 'update-staging', '检查历史版本更新包')
        await this.#detectUpdateStaging(ctx)
      } else {
        this.#emit(ctx, 'unsupported', '当前平台不支持残留扫描', true)
        return {
          platform: 'win',
          items: [],
          totalReclaimableBytes: 0,
          scannedAt: Date.now(),
          error: '当前平台不支持残留扫描'
        }
      }
    } finally {
      this.#scanning = false
    }

    const cancelled = ctx.isCancelled()
    // 排序：注册表孤儿 → Prism 残留 → 本应用缓存/日志
    const rank: Record<ResidueKind, number> = {
      'startup-orphan': 0,
      'uninstall-orphan': 1,
      'prism-residue': 2,
      'app-cache': 3,
      'app-log': 4
    }
    ctx.items.sort((a, b) => rank[a.kind] - rank[b.kind])
    this.#lastItems = ctx.items
    this.#emit(ctx, 'done', cancelled ? '扫描已取消' : '扫描完成', true)
    log.info(
      `[ResidueScan] 扫描完成：平台=${process.platform}，检出 ${ctx.items.length} 项残留${cancelled ? '（已取消）' : ''}`
    )
    return {
      platform: process.platform === 'darwin' ? 'darwin' : 'win',
      items: ctx.items,
      totalReclaimableBytes: ctx.items.reduce((sum, it) => sum + (it.size ?? 0), 0),
      scannedAt: Date.now(),
      cancelled
    }
  }

  async #isDirectory(p: string): Promise<boolean> {
    try {
      return (await fsp.stat(p)).isDirectory()
    } catch {
      return false
    }
  }

  /** 打开注册表备份目录（清理后可从 .reg 还原） */
  async openBackupDir(): Promise<void> {
    const dir = join(app.getPath('userData'), 'residue-backups')
    await fsp.mkdir(dir, { recursive: true }).catch(() => {})
    await shell.openPath(dir)
  }

  /** 清理选中的残留条目（文件入回收站；注册表删除前导出 .reg 备份） */
  async clean(ids: string[]): Promise<ResidueCleanResult> {
    const result: ResidueCleanResult = {
      ok: true,
      cleanedIds: [],
      trashed: [],
      regDeleted: [],
      backups: [],
      errors: []
    }
    if (!Array.isArray(ids)) {
      return { ...result, ok: false, errors: ['清理参数无效（需为条目 id 数组）'] }
    }
    if (this.#cleaning) {
      return { ...result, ok: false, errors: ['已有清理任务进行中'] }
    }
    this.#cleaning = true
    try {
      const byId = new Map(this.#lastItems.map((it) => [it.id, it]))
      const backupDir = join(
        app.getPath('userData'),
        'residue-backups',
        new Date().toISOString().replace(/[:.]/g, '-')
      )
      // 清理路径安全边界允许的根（与迁移到 storageCleanup 的 verifiedCleanPath 配套）
      const home = app.getPath('home')
      const userData = app.getPath('userData')
      const allowedRoots =
        process.platform === 'darwin'
          ? [join(home, 'Library'), '/Applications', join(home, 'Applications'), userData]
          : [userData]

      for (const id of new Set(ids)) {
        const item = byId.get(id)
        if (!item) {
          result.errors.push(`未找到条目：${id}（请重新扫描）`)
          continue
        }
        try {
          if (item.path) {
            const safePath = await verifiedCleanPath(item.path, allowedRoots)
            if (!safePath) {
              result.errors.push(`路径超出安全边界或已失效，已拒绝清理：${item.path}`)
              log.warn('[ResidueScan] 拒绝越界/失效路径清理:', item.path)
              continue
            }
            // 本应用缓存/日志目录运行中可能被进程占用（尤其 Windows 文件锁），
            // 逐子项清理尽量回收空间，被占用的子项如实报错
            if (
              (item.kind === 'app-cache' || item.kind === 'app-log') &&
              (await this.#isDirectory(safePath))
            ) {
              const { trashedCount, lockedCount, dirTrashed } = await trashDirContents(safePath)
              // 空目录 trashedCount 为 0：以 dirTrashed 或至少回收了部分内容为成功
              const reclaimed = dirTrashed || trashedCount > 0
              if (reclaimed) {
                result.trashed.push(safePath)
                result.cleanedIds.push(id)
                if (lockedCount > 0) {
                  result.errors.push(
                    `${item.title}：${lockedCount} 项文件被占用未能清理（重启应用后可再清理）`
                  )
                }
              } else {
                result.errors.push(`${item.title} 清理失败：目录内文件均被占用`)
              }
            } else {
              await shell.trashItem(safePath)
              result.trashed.push(safePath)
              result.cleanedIds.push(id)
            }
            log.info('[ResidueScan] 已清理（移入回收站）:', safePath)
          } else if (item.registryKey) {
            if (!isSafeRegArg(item.registryKey)) {
              result.errors.push(`注册表键名含不安全字符，已拒绝：${item.registryKey}`)
              continue
            }
            if (item.registryValue !== undefined && !isSafeRegArg(item.registryValue)) {
              result.errors.push(`注册表值名含不安全字符，已拒绝：${item.registryValue}`)
              continue
            }
            const backup = await backupRegistryKey(item.registryKey, backupDir)
            result.backups.push(backup)
            if (item.registryValue) {
              await reg(['DELETE', item.registryKey, '/v', item.registryValue, '/f'])
              result.regDeleted.push(`${item.registryKey}\\${item.registryValue}`)
            } else {
              await reg(['DELETE', item.registryKey, '/f'])
              result.regDeleted.push(item.registryKey)
            }
            result.cleanedIds.push(id)
            log.info('[ResidueScan] 已清理注册表项:', item.registryKey)
          } else {
            result.errors.push(`条目无清理目标：${id}（${item.title}）`)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          result.errors.push(`${item.title} 清理失败：${message}`)
        } finally {
          // 幂等：处理过的条目从缓存移除，重复清理同一 id 会提示「请重新扫描」
          byId.delete(id)
        }
      }
      // 清理过的条目不再可重复操作
      this.#lastItems = this.#lastItems.filter((it) => !ids.includes(it.id))
      result.ok = result.errors.length === 0
      await pruneBackups(join(app.getPath('userData'), 'residue-backups'))
      log.info(
        `[ResidueScan] 清理完成：成功 ${result.cleanedIds.length}，失败 ${result.errors.length}，备份 ${result.backups.length} 份`
      )
      return result
    } finally {
      this.#cleaning = false
    }
  }

  /** 注册 IPC */
  init(): void {
    const C = SERVICE_CHANNELS.residueScan
    ipcMain.handle(C.scan, () => this.scan())
    ipcMain.handle(C.cancel, () => this.cancel())
    ipcMain.handle(C.clean, (_event, ids: string[]) => this.clean(ids))
    ipcMain.handle(C.openBackupDir, () => this.openBackupDir())
    log.info('[ResidueScanService] 初始化完成')
  }
}

export const residueScanService = new ResidueScanService()
