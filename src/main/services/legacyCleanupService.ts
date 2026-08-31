/**
 * 旧版本（v1）清理服务
 * @description 检测旧版 Prism（v1）是否安装、枚举旧版用户数据目录，
 * 提供「卸载旧版本」与「选择性删除旧数据（移入回收站）」能力。
 *
 * - Windows：枚举 HKCU/HKLM 卸载注册表项检测安装（排除 v2 自身），
 *   卸载走官方 NSIS 卸载器静默参数 /S。
 * - macOS：检测 /Applications/Prism.app（或用户目录下），卸载 = 移入废纸篓。
 * - 删除数据统一走 shell.trashItem（移入回收站，可恢复），
 *   且仅接受旧版数据目录内的路径（安全边界，拒绝候选目录之外/相对路径）。
 */
import { app, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import log from 'electron-log'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type {
  LegacyCleanupResult,
  LegacyCleanupState,
  LegacyDataDir,
  LegacyDataEntry,
  LegacyInstallInfo
} from '@preload/ipc'

const execAsync = promisify(exec)

/** 旧版应用名（v1 userData 目录名候选：打包版大写 Prism、开发模式小写 prism） */
const LEGACY_DIR_NAMES = ['Prism', 'prism'] as const

/** 解析注册表 UninstallString：剥离引号得到 exe 路径与其余参数 */
interface UninstallCommand {
  exe: string
  args: string[]
}

function parseUninstallString(raw: string): UninstallCommand {
  const s = raw.trim()
  const quoted = s.match(/^"([^"]+)"(?:\s+(.*))?$/)
  if (quoted) {
    return { exe: quoted[1], args: quoted[2] ? quoted[2].split(/\s+/) : [] }
  }
  const parts = s.split(/\s+/)
  return { exe: parts[0] ?? '', args: parts.slice(1) }
}

class LegacyCleanupService {
  /** 最近一次 Windows 检测到的旧版卸载命令（uninstall 复用） */
  #winUninstall: UninstallCommand | null = null

  /** 候选旧版数据目录的绝对路径列表 */
  #legacyDataDirs(): string[] {
    const appData = app.getPath('appData')
    return LEGACY_DIR_NAMES.map((name) => join(appData, name))
  }

  /** 判断路径是否为旧版数据目录本身或其子路径（安全校验用） */
  #isInsideLegacyDir(path: string): boolean {
    const resolved = resolve(path)
    return this.#legacyDataDirs().some((dir) => {
      const base = resolve(dir)
      return resolved === base || resolved.startsWith(base + sep)
    })
  }

  /**
   * 检测旧版安装信息。
   * @returns 平台分支调用对应实现；不支持平台返回未检测到。
   */
  async #detectInstall(): Promise<LegacyInstallInfo> {
    if (process.platform === 'win32') return this.#detectInstallWindows()
    if (process.platform === 'darwin') return this.#detectInstallMac()
    return { detected: false, platform: 'win' }
  }

  /** Windows：枚举卸载注册表项，过滤出真正的旧版（排除 v2 自身） */
  async #detectInstallWindows(): Promise<LegacyInstallInfo> {
    this.#winUninstall = null
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Prism' } | Select-Object DisplayName,DisplayVersion,UninstallString | ConvertTo-Json -Compress"`,
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      )
      const rows: Array<{
        DisplayName?: string
        DisplayVersion?: string
        UninstallString?: string
      }> = []
      const trimmed = stdout.trim()
      if (trimmed) {
        const parsed = JSON.parse(trimmed)
        const list = Array.isArray(parsed) ? parsed : [parsed]
        // 排除 v2 自身：当前版本号（dev/打包均取 package.json version）
        rows.push(...list.filter((r) => String(r.DisplayVersion ?? '') !== app.getVersion()))
      }
      const target = rows.find((r) => r.UninstallString) ?? rows[0]
      if (!target) return { detected: false, platform: 'win' }

      const info: LegacyInstallInfo = {
        detected: true,
        platform: 'win',
        displayName: target.DisplayName,
        version: target.DisplayVersion,
        running: await this.#isRunningWindows()
      }
      if (target.UninstallString) {
        const cmd = parseUninstallString(target.UninstallString)
        info.installPath = dirname(cmd.exe)
        this.#winUninstall = cmd
      }
      return info
    } catch (err) {
      log.warn('[LegacyCleanup] 检测旧版安装失败:', err)
      return { detected: false, platform: 'win' }
    }
  }

  /** macOS：检测 /Applications/Prism.app（或用户目录下），版本取 Info.plist */
  #detectInstallMac(): LegacyInstallInfo {
    const candidates = [
      '/Applications/Prism.app',
      join(app.getPath('home'), 'Applications', 'Prism.app')
    ]
    const appPath = candidates.find((p) => existsSync(p))
    if (!appPath) return { detected: false, platform: 'mac' }
    let version: string | undefined
    try {
      const plist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf-8')
      version = plist.match(/CFBundleShortVersionString<\/key>\s*<string>([^<]+)/)?.[1]
    } catch {
      // 读取 plist 失败不影响检测结果
    }
    return {
      detected: true,
      platform: 'mac',
      displayName: 'Prism',
      version,
      installPath: appPath
    }
  }

  /** Windows：检查旧版进程是否在运行 */
  async #isRunningWindows(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq prism.exe" /FO CSV /NH', {
        windowsHide: true
      })
      return stdout.toLowerCase().includes('prism.exe')
    } catch {
      return false
    }
  }

  /** 枚举旧版数据目录：顶层条目 + 递归大小 + 类型标记 */
  #scanDataDirs(): LegacyDataDir[] {
    return this.#legacyDataDirs()
      .filter((dir) => existsSync(dir))
      .map((dir) => {
        const entries = this.#scanEntries(dir)
        const totalSize = entries.reduce((sum, e) => sum + e.size, 0)
        // 已知数据文件（db/config）排最前，其余按大小降序
        entries.sort((a, b) => {
          const rankA = a.kind === 'db' || a.kind === 'config' ? 0 : 1
          const rankB = b.kind === 'db' || b.kind === 'config' ? 0 : 1
          return rankA - rankB || b.size - a.size
        })
        return { dirName: basename(dir), path: dir, totalSize, entries }
      })
  }

  /** 读取目录顶层条目（文件/子目录），子目录大小递归统计 */
  #scanEntries(dir: string): LegacyDataEntry[] {
    try {
      return readdirSync(dir).map((name) => {
        const full = join(dir, name)
        let size = 0
        let isDir = false
        try {
          const st = statSync(full)
          if (st.isDirectory()) {
            isDir = true
            size = this.#dirSize(full)
          } else {
            size = st.size
          }
        } catch {
          size = 0
        }
        return { name, path: full, size, kind: this.#kindOf(name, isDir) }
      })
    } catch (err) {
      log.warn('[LegacyCleanup] 枚举旧版数据目录失败:', dir, err)
      return []
    }
  }

  /** 递归统计目录总大小（无法读取的项按 0 计） */
  #dirSize(dir: string): number {
    let total = 0
    try {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        try {
          const st = statSync(full)
          total += st.isDirectory() ? this.#dirSize(full) : st.size
        } catch {
          // 跳过无法统计的项
        }
      }
    } catch {
      // 目录读取失败按 0 计
    }
    return total
  }

  /** 按名称/类型判定条目标记（供 UI 打标签） */
  #kindOf(name: string, isDir: boolean): LegacyDataEntry['kind'] {
    if (!isDir) {
      if (name === 'clipboard.db') return 'db'
      if (name === 'settings.json') return 'config'
    }
    if (isDir && (name === 'Cache' || name === 'Code Cache')) return 'cache'
    return 'other'
  }

  /** 获取旧版本整体状态（安装信息 + 数据目录清单） */
  async getState(): Promise<LegacyCleanupState> {
    return { install: await this.#detectInstall(), dataDirs: this.#scanDataDirs() }
  }

  /** 卸载旧版本（win 静默卸载器 /S；mac 移入废纸篓） */
  async uninstall(): Promise<LegacyCleanupResult> {
    const info = await this.#detectInstall()
    if (!info.detected || !info.installPath) {
      return { ok: false, error: '未检测到旧版本安装' }
    }
    if (process.platform === 'win32') {
      if (!this.#winUninstall) return { ok: false, error: '未找到旧版卸载器' }
      const { exe, args } = this.#winUninstall
      try {
        const child = spawn(exe, [...args, '/S'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        log.info('[LegacyCleanup] 已启动旧版静默卸载:', exe)
        return { ok: true, launched: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('[LegacyCleanup] 启动卸载器失败:', message)
        return { ok: false, error: message }
      }
    }
    if (process.platform === 'darwin') {
      try {
        await shell.trashItem(info.installPath)
        log.info('[LegacyCleanup] 旧版已移入废纸篓:', info.installPath)
        return { ok: true, trashed: [info.installPath] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('[LegacyCleanup] 移入废纸篓失败:', message)
        return { ok: false, error: message }
      }
    }
    return { ok: false, error: '当前平台不支持卸载' }
  }

  /**
   * 将选中的旧版数据条目移入回收站。
   * @param paths 旧版数据目录内的绝对路径（候选目录之外/相对路径会被忽略）
   */
  async deleteData(paths: string[]): Promise<LegacyCleanupResult> {
    const trashed: string[] = []
    const errors: string[] = []
    for (const raw of paths) {
      const p = typeof raw === 'string' ? raw : ''
      if (!p || !this.#isInsideLegacyDir(p)) {
        errors.push('存在候选目录之外的路径，已忽略')
        continue
      }
      if (!existsSync(p)) {
        errors.push(`${basename(p)} 不存在`)
        continue
      }
      try {
        await shell.trashItem(p)
        trashed.push(p)
      } catch (err) {
        errors.push(`${basename(p)} 删除失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (errors.length) log.warn('[LegacyCleanup] 部分删除未完成:', errors.join('；'))
    return {
      ok: errors.length === 0,
      trashed: trashed.length ? trashed : undefined,
      error: errors.length ? errors.join('；') : undefined
    }
  }

  /** 注册 IPC */
  init(): void {
    const C = SERVICE_CHANNELS.legacyCleanup
    ipcMain.handle(C.getState, () => this.getState())
    ipcMain.handle(C.uninstall, () => this.uninstall())
    ipcMain.handle(C.deleteData, (_event, paths: string[]) => this.deleteData(paths))
    log.info('[LegacyCleanupService] 初始化完成')
  }
}

export const legacyCleanupService = new LegacyCleanupService()
