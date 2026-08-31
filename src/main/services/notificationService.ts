/**
 * 通知服务
 * @description 持久化通知中心 + 自绘通知浮窗（统一呈现通道，不依赖系统通知）。
 *
 * v2 架构：
 * - 继承 SqliteStore，落盘到 userData/notifications.db，通知可回看（v1 无历史）。
 * - notify() 为对外统一入口：任意主进程模块（剪贴板 / 更新 / 未来 Claude Code 等）调用即产生一条通知。
 * - 投递统一走自绘通知浮窗（NotificationFrame + NotificationPopup）：主窗口隐藏与否都弹，
 *   浮窗渲染端可完全自定义（未来可加链接/翻译等按钮），规避 Windows 系统通知无按钮的局限。
 * - 同 source+title+message 且 30 秒内重复 → 仅刷新时间，不新增记录（防连续复制刷屏）。
 */
import { ipcMain } from 'electron'
import { SqliteStore } from './db/sqliteDatabase'
import { settingsService } from './settingsService'
import { trayService } from './trayService'
import { windowFactory } from '../frame/WindowFactory'
import { broadcast } from '../utils/platform'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type { NotificationItem, NotificationNewPayload, NotificationSource, NotificationType } from '@preload/ipc'

/** 去重窗口：同来源+标题+内容在窗口期内重复仅刷新时间（ms） */
const DEDUP_WINDOW_MS = 30_000

/** notify 入参 */
export interface NotificationInput {
  type: NotificationType
  source: NotificationSource
  title: string
  message: string
  /** 是否写入通知中心（持久化 + 计未读）。缺省 true；false = 仅浮窗弹出不留存（如剪贴板复制，历史已有记录，避免与剪贴板页重叠） */
  persist?: boolean
}

class NotificationService extends SqliteStore {
  constructor() {
    super('notifications.db', 'NotificationService')
  }

  /** 初始化：建表 + 索引 + 注册 IPC */
  async init(): Promise<void> {
    await this.open()

    this.run(
      `CREATE TABLE IF NOT EXISTS notifications (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         type TEXT NOT NULL,
         source TEXT NOT NULL,
         title TEXT NOT NULL,
         message TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         read INTEGER NOT NULL DEFAULT 0
       )`
    )
    this.run('CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC)')

    this.save()
    this.registerIPC()
    // 启动时把持久化的未读数同步到托盘 tooltip
    trayService.setUnread(this.getUnread())
  }

  /** 停止服务：落盘并关闭数据库 */
  stop(): void {
    this.close()
  }

  /**
   * 产生一条通知（对外统一入口）。
   * 受总开关与来源开关控制；`persist` 缺省为 true（更新/未来来源落库）；
   * 剪贴板复制传 `persist:false` → 仅浮窗弹出，不入库、不计未读。
   */
  notify(input: NotificationInput): void {
    const s = settingsService.getAll()
    if (!s.notificationsEnabled) return
    if (input.source === 'clipboard' && !s.notifyClipboard) return
    if (input.source === 'update' && !s.notifyUpdate) return

    const persist = input.persist !== false

    let item: NotificationItem
    let unread: number
    if (persist) {
      const now = Date.now()
      const dup = this.one<{ id: number; created_at: number }>(
        `SELECT id, created_at FROM notifications
         WHERE source = ? AND title = ? AND message = ?
         ORDER BY created_at DESC LIMIT 1`,
        [input.source, input.title, input.message]
      )

      let id: number
      if (dup && now - dup.created_at < DEDUP_WINDOW_MS) {
        this.run('UPDATE notifications SET created_at = ? WHERE id = ?', [now, dup.id])
        id = dup.id
      } else {
        this.run(
          'INSERT INTO notifications (type, source, title, message, created_at, read) VALUES (?, ?, ?, ?, ?, 0)',
          [input.type, input.source, input.title, input.message, now]
        )
        id = this.lastInsertId()
      }
      this.save()

      const stored = this.one<NotificationItem>('SELECT * FROM notifications WHERE id = ?', [id])
      if (!stored) return
      item = stored
      unread = this.getUnread()
      trayService.setUnread(unread)
    } else {
      // 仅浮窗展示：构建瞬时记录（负 id 避开自增主键，不入库、不计未读、不更新托盘）
      item = {
        id: -Date.now(),
        type: input.type,
        source: input.source,
        title: input.title,
        message: input.message,
        created_at: Date.now(),
        read: 0
      }
      unread = this.getUnread()
    }

    // 投递：统一唤起自绘通知浮窗（主窗口隐藏与否都弹），浮窗渲染端订阅 onNew 展示
    windowFactory.getNotificationFrame().showPopups()
    broadcast(BROADCAST.notificationNew, { item, unread } satisfies NotificationNewPayload)
  }

  /** 全部通知记录（按时间倒序） */
  getList(): NotificationItem[] {
    return this.all<NotificationItem>('SELECT * FROM notifications ORDER BY created_at DESC, id DESC')
  }

  /** 未读数 */
  getUnread(): number {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE read = 0')?.n ?? 0
  }

  /** 标记单条已读 */
  markRead(id: number): void {
    this.run('UPDATE notifications SET read = 1 WHERE id = ?', [id])
    this.save()
    trayService.setUnread(this.getUnread())
  }

  /** 全部标记已读 */
  markAllRead(): void {
    this.run('UPDATE notifications SET read = 1 WHERE read = 0')
    this.save()
    trayService.setUnread(0)
  }

  /** 清空全部通知 */
  clear(): void {
    this.run('DELETE FROM notifications')
    this.save()
    trayService.setUnread(0)
  }

  private registerIPC(): void {
    const N = SERVICE_CHANNELS.notification

    ipcMain.handle(N.getList, () => this.getList())
    ipcMain.handle(N.getUnread, () => this.getUnread())
    ipcMain.handle(N.markRead, (_e, id: number) => this.markRead(Number(id)))
    ipcMain.handle(N.markAllRead, () => this.markAllRead())
    ipcMain.handle(N.clear, () => this.clear())
  }
}

export const notificationService = new NotificationService()
