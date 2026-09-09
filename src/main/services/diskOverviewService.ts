/**
 * 磁盘容量总览服务
 * @description 存储优化的「容量总览」部分：枚举系统各分区/卷并给出角色（system/external）、
 * 容量、已用、可用与只读标记。
 *
 * 平台差异：
 * - **Windows**：多磁盘模型，枚举 `C..Z:` 存在的本地盘（全部 role=system，各自独立计量）。
 * - **macOS**：单一卷文件系统（APFS 容器），无 Windows 式多磁盘。`/` 即系统盘（role=system，
 *   展示名取 VolumeName，缺省「主磁盘」）；`/Volumes/*` 下的为外接/挂载卷（role=external）。
 *
 * 读取失败（不可访问/无权限）的卷跳过，不影响其它卷。statfs 无需特殊权限。
 */
import { constants } from 'node:fs'
import { existsSync, promises as fsp } from 'node:fs'
import { basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ipcMain } from 'electron'
import log from 'electron-log'
import { SERVICE_CHANNELS } from '@preload/ipc'
import type { VolumeInfo } from '@preload/ipc'
import { forFs } from './storageScan'

const execFileAsync = promisify(execFile)

/** 列出某目录下的直接子卷目录名（mac /Volumes、linux /media） */
async function listMountDirs(base: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(forFs(base), { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

class DiskOverviewService {
  /** mac 根卷展示名缓存（主磁盘名，如「Macintosh HD」） */
  #macRootName: string | null = null

  /** 读取单卷容量信息；失败返回 null */
  async #volumeInfo(p: string, role: 'system' | 'external'): Promise<VolumeInfo | null> {
    try {
      const st = await fsp.statfs(forFs(p))
      const totalBytes = st.bsize * st.blocks
      const freeBytes = st.bsize * st.bavail
      let readonly = false
      try {
        await fsp.access(forFs(p), constants.W_OK)
      } catch {
        readonly = true
      }
      return {
        path: p,
        label: basename(p) || p,
        totalBytes,
        freeBytes,
        usedBytes: totalBytes - freeBytes,
        readonly,
        role
      }
    } catch {
      return null
    }
  }

  /** mac 根卷展示名：diskutil info / 解析 VolumeName，失败回退「主磁盘」 */
  async #macRootLabel(): Promise<string> {
    if (this.#macRootName) return this.#macRootName
    try {
      const { stdout } = await execFileAsync('diskutil', ['info', '/'], { timeout: 3000 })
      const m = stdout.match(/Volume Name:\s*(.+)/)
      if (m?.[1]) {
        this.#macRootName = m[1].trim()
        return this.#macRootName
      }
    } catch {
      // 忽略，回退默认名
    }
    return (this.#macRootName = '主磁盘')
  }

  /** 枚举系统各分区/卷（平台区分：win 多磁盘 / mac 单系统盘 + 外接卷） */
  async listVolumes(): Promise<VolumeInfo[]> {
    if (process.platform === 'win32') {
      const out: VolumeInfo[] = []
      for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${c}:\\`
        if (!existsSync(root)) continue
        const info = await this.#volumeInfo(root, 'system')
        if (info) out.push({ ...info, label: `${root} 盘` })
      }
      // Windows 多磁盘：按已用降序（最满的盘排前面）
      out.sort((a, b) => b.usedBytes - a.usedBytes)
      return out
    }

    // macOS：单一卷文件系统，主磁盘（/）优先，外接/挂载卷（/Volumes）归组在后
    const system: VolumeInfo[] = []
    const external: VolumeInfo[] = []
    const primary = await this.#volumeInfo('/', 'system')
    if (primary) {
      system.push({ ...primary, label: await this.#macRootLabel() })
    }
    const mounts = await listMountDirs(process.platform === 'darwin' ? '/Volumes' : '/media')
    for (const m of mounts) {
      const p =
        process.platform === 'darwin' ? `/Volumes/${m}` : `/media/${m}`
      const info = await this.#volumeInfo(p, 'external')
      if (info && info.totalBytes > 0) external.push(info)
    }
    external.sort((a, b) => b.usedBytes - a.usedBytes)
    return [...system, ...external]
  }

  /** 注册 IPC */
  init(): void {
    const C = SERVICE_CHANNELS.diskOverview
    ipcMain.handle(C.listVolumes, () => this.listVolumes())
    log.info('[DiskOverviewService] 初始化完成')
  }
}

export const diskOverviewService = new DiskOverviewService()
