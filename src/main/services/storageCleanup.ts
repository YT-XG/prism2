/**
 * 共享清理安全边界工具
 * @description 从 residueScanService 抽取的、与具体清理对象无关的「安全清理」纯逻辑，
 * 供系统残留清理 / 系统垃圾清理 / 重复文件去重等存储优化 Cleaner 共用，
 * 避免各处复制粘贴危险路径判断。
 *
 * 统一安全模型：
 * - 文件清理一律 shell.trashItem（移入回收站，可恢复）。
 * - 清理前做路径边界校验：realpath 解析后仍须落在调用方传入的 allowedRoots 内；
 *   一律拒绝盘符/文件系统根、用户主目录本身、系统目录、当前应用本体与 userData 根。
 * - 注册表删除前导出 .reg 备份；reg 子命令经参数数组直传不经 shell，且键名/值名
 *   删除前做字符校验，防止被当作参数解析或注入。
 */
import { app, shell } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { dirname, join, parse, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

/** 永不清理的系统目录（纵深防御，即使落在 allowedRoots 内也拒绝） */
export const FORBIDDEN_DIRS =
  process.platform === 'darwin'
    ? ['/System', '/usr', '/bin', '/sbin', '/etc', '/private', '/Volumes', '/Library']
    : ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)']

/** 路径比较用归一化（Windows 路径大小写不敏感） */
export function normPath(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** 扩展环境变量路径（%ProgramFiles% 等），未知名原样保留 */
export function expandEnvPath(raw: string): string {
  return raw.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`)
}

/** 展开后仍残留 %VAR% 占位 → 无法核验（否则必然判定为「不存在」而误报孤儿） */
export function hasEnvPlaceholder(value: string): boolean {
  return /%[^%]+%/.test(value)
}

/** 网络路径（UNC / 共享盘）：可能当前离线，核验结果不可靠 */
export function isNetworkPath(value: string): boolean {
  return /^[\\/]{2}/.test(value)
}

/** 路径所在盘符不存在（移动硬盘/网络盘未连接）→ 无法核验 */
export function driveMissing(value: string): boolean {
  if (process.platform !== 'win32') return false
  const root = parse(value).root
  return root.length > 0 && !existsSync(root)
}

/** 路径是否可被核验（非空、绝对、无未展开变量、非网络路径、盘符在线） */
export function verifiablePath(value: string): boolean {
  return (
    value.length > 0 && !hasEnvPlaceholder(value) && !isNetworkPath(value) && !driveMissing(value)
  )
}

/**
 * 注册表键/值名安全校验：reg.exe 会把以 `/` 或 `-` 开头的值名当作开关解析，
 * 引号会破坏命令行，控制字符会截断参数。不合法一律拒绝执行。
 */
export function isSafeRegArg(value: string): boolean {
  if (!value || value.length > 512) return false
  if (/^[-/]/.test(value)) return false
  return !/["\u0000-\u001f]/.test(value)
}

/**
 * 执行 reg.exe 子命令（EXPORT/DELETE）。
 * 键名/值名来自第三方的注册表扫描，必须用参数数组直传、不经 shell，
 * 防止 `&`/`|`/引号等字符破坏命令甚至注入执行任意命令。
 */
export function reg(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('reg', args, { windowsHide: true, stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`reg 命令失败（退出码 ${code ?? 'unknown'}）`))
    })
  })
}

/** 导出注册表键为 .reg 备份，返回备份文件路径 */
export async function backupRegistryKey(key: string, backupDir: string): Promise<string> {
  await fsp.mkdir(backupDir, { recursive: true })
  // 键名 → 文件名：截断避免超长，且带键名哈希后缀防止不同键映射到同一文件
  const safe = key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  const suffix = createHash('sha1').update(key).digest('hex').slice(0, 8)
  const file = join(backupDir, `${safe}-${suffix}.reg`)
  await reg(['EXPORT', key, file, '/y'])
  return file
}

/** 只保留最近 N 个 `.reg` 备份文件（按名字排序），避免无限累积 */
export async function pruneBackups(base: string, keep = 10): Promise<void> {
  let entries: string[]
  try {
    entries = await fsp.readdir(base)
  } catch {
    return
  }
  entries.sort()
  for (const victim of entries.slice(0, Math.max(0, entries.length - keep))) {
    await fsp.rm(join(base, victim), { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 清理前解析真实路径并做安全边界校验。
 * - 先 absolute(实际 resolve) 归一化，拒绝盘符/文件系统根、用户主目录本身、
 *   系统目录、当前应用本体（mac .app 包 / win 安装目录）与 userData 根。
 * - 再要求落在调用方传入的 allowedRoots 内（配合扫描侧的当前应用排除）。
 * - realpath 后仍须落回 allowedRoots 内（软链接可能把允许目录指向别处）；
 *   路径不存在/无法解析则拒绝。
 * @returns 通过校验的真实路径；越界/失效返回 null。
 */
export async function verifiedCleanPath(
  raw: string,
  allowedRoots: string[]
): Promise<string | null> {
  const resolved = resolve(raw)
  if (!isAllowedCleanPath(resolved, allowedRoots)) return null
  try {
    const real = await fsp.realpath(resolved)
    if (!isAllowedCleanPath(real, allowedRoots)) return null
    return real
  } catch {
    return null
  }
}

/** 清理路径安全边界（见 verifiedCleanPath；allowedRoots 由调用方按平台给定） */
function isAllowedCleanPath(resolved: string, allowedRoots: string[]): boolean {
  const norm = normPath(resolved)
  const home = app.getPath('home')
  const userData = app.getPath('userData')
  // 盘符根 / 文件系统根 / 用户主目录本身绝不清理
  const root = parse(resolved).root
  if (root && norm === normPath(root)) return false
  if (norm === normPath(home)) return false
  if (FORBIDDEN_DIRS.some((d) => norm === d || norm.startsWith(d + sep))) return false
  const selfRoots = [dirname(process.execPath)]
  const macApp = process.execPath.match(/^(.*\.app)[\\/]/i)?.[1]
  if (macApp) selfRoots.push(macApp)
  if (selfRoots.some((r) => norm === normPath(r) || norm.startsWith(normPath(r) + sep))) {
    return false
  }
  if (norm === normPath(userData)) return false
  return allowedRoots.some((r) => norm.startsWith(normPath(r) + sep))
}

/**
 * 逐子项移入回收站（被占用文件跳过）；全部子项成功（含空目录——无子项可占）
 * 时目录本身也入回收站。
 * @returns 成功回收的子项数 / 被占用跳过数 / 目录本身是否已入回收站。
 */
export async function trashDirContents(
  dir: string
): Promise<{ trashedCount: number; lockedCount: number; dirTrashed: boolean }> {
  let trashedCount = 0
  let lockedCount = 0
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return { trashedCount, lockedCount, dirTrashed: false }
  }
  for (const name of names) {
    try {
      await shell.trashItem(join(dir, name))
      trashedCount += 1
    } catch {
      lockedCount += 1
    }
  }
  // 空目录 names 为空：lockedCount 为 0，这里仍会把目录本身入回收站，否则
  // 调用方会误判为「目录内文件均被占用」而报错。
  let dirTrashed = false
  if (lockedCount === 0) {
    try {
      await shell.trashItem(dir)
      dirTrashed = true
    } catch {
      // 目录被占用（如 Windows 上 Cache 被进程锁住）时保持原样
    }
  }
  return { trashedCount, lockedCount, dirTrashed }
}
