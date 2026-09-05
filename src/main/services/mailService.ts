/**
 * 邮箱大师服务
 * @description 多账号 IMAP 收信：
 * - 账号管理（授权码经 safeStorage 加密后入库，不存明文）
 * - 文件夹同步（首次每文件夹仅收最近 INITIAL_SYNC_MAX 封，此后按 UID 增量）
 * - 邮件正文解析入库（sql.js），附件落盘 userData/mail-attachments/<messageId>/
 * - 轮询同步（默认 60s，间隔读 settings.mailPollIntervalMin），短连接模式
 * - 新邮件通知（notificationService，受 notifyMail 开关控制）+ 未读广播
 *
 * 数据落盘：
 * - userData/mail.db（账号 / 文件夹 / 邮件 / 附件元数据）
 * - userData/mail-attachments/<messageId>/<文件名>（附件实体）
 */
import { app, dialog, ipcMain, safeStorage, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import log from 'electron-log'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { SqliteStore } from './db/sqliteDatabase'
import { settingsService } from './settingsService'
import { notificationService } from './notificationService'
import { broadcast } from '../utils/platform'
import { BROADCAST, SERVICE_CHANNELS } from '@preload/ipc'
import type {
  MailAccount,
  MailAccountInput,
  MailAttachment,
  MailAuthTestResult,
  MailboxInfo,
  MailMarkAllReadResult,
  MailMessageDetail,
  MailMessageSummary,
  MailOpResult,
  MailSyncResult,
  MailSyncingInfo
} from '@preload/ipc'

/** 首次同步每个文件夹最多拉取的邮件数（避免首次全量拉爆） */
const INITIAL_SYNC_MAX = 200

/** UID 增量未命中时按序号尾部对账的窗口（封）：兜底服务器 UID 状态变化导致的漏收 */
const RECONCILE_WINDOW = 100

/** 每个文件夹在库内保留的邮件上限（超出按日期裁剪，级联删除附件文件） */
const MAX_MESSAGES_PER_MAILBOX = 500

/** 启动后首次轮询的延迟（ms）：已存账号在应用启动后稍作延迟即首轮同步 */
const POLL_FIRST_DELAY_MS = 5000

/** 单页消息列表上限（防御性） */
const MAX_PAGE_SIZE = 200

/** 单次同步后新邮件聚合通知展示的首条主题截断长度 */
const SUBJECT_PREVIEW_LEN = 60

/** 单次同步内收集到的待入库邮件摘要（取自 fetch 的信封） */
interface FetchedSummary {
  uid: number
  subject: string
  fromName: string
  fromAddr: string
  seen: boolean
}

/**
 * 常见英文系统文件夹 → 中文显示名映射。
 * QQ/163/Outlook 等 IMAP 服务器的系统文件夹返回英文名（INBOX/Drafts/Junk/...），
 * 直接展示不友好；用户自建文件夹（如「QQ邮件订阅」）为服务器原样名，不参与映射。
 */
const MAILBOX_NAME_MAP: Record<string, string> = {
  inbox: '收件箱',
  drafts: '草稿箱',
  'draft messages': '草稿箱',
  'sent messages': '已发送',
  'sent items': '已发送',
  sent: '已发送',
  'sent mail': '已发送',
  junk: '垃圾邮件',
  'junk e-mail': '垃圾邮件',
  'junk email': '垃圾邮件',
  'junk messages': '垃圾邮件',
  spam: '垃圾邮件',
  'deleted messages': '已删除',
  'deleted items': '已删除',
  'deleted': '已删除',
  trash: '已删除',
  archive: '归档',
  outbox: '发件箱'
}

/** SPECIAL-USE 标志 → 中文显示名（服务器显式声明时优先于名称映射） */
const SPECIAL_USE_NAME_MAP: Record<string, string> = {
  '\\Inbox': '收件箱',
  '\\Sent': '已发送',
  '\\Drafts': '草稿箱',
  '\\Trash': '已删除',
  '\\Junk': '垃圾邮件',
  '\\Archive': '归档'
}

/** 已读状态回写 IMAP 所需的最小连接信息 */
interface SeenConnInfo {
  path: string
  email: string
  host: string
  port: number
  ssl: boolean
  passwordEnc: string
}

/** 单个邮件已读状态回写所需信息 */
interface SeenStoreInfo extends SeenConnInfo {
  uid: number
}

/** 单个文件夹同步结果 */
interface MailboxSyncOutcome {
  newCount: number
  firstSubject: string
}

class MailService extends SqliteStore {
  /** 轮询定时器（setTimeout 链式，每 tick 重读设置间隔） */
  private pollTimer: ReturnType<typeof setTimeout> | null = null

  /** 正在同步中的账号 id 集合（防止重复同步并发） */
  private readonly syncing = new Set<number>()

  constructor() {
    super('mail.db', 'MailService')
  }

  /** 附件根目录（userData/mail-attachments） */
  private get attachmentsDir(): string {
    return join(app.getPath('userData'), 'mail-attachments')
  }

  /** 初始化：建表建索引 + 注册 IPC + 启动轮询 */
  async init(): Promise<void> {
    await this.open()

    this.run(
      `CREATE TABLE IF NOT EXISTS accounts (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         name TEXT NOT NULL,
         email TEXT NOT NULL,
         host TEXT NOT NULL,
         port INTEGER NOT NULL,
         ssl INTEGER NOT NULL DEFAULT 1,
         password_enc TEXT NOT NULL,
         last_sync_at INTEGER,
         created_at INTEGER NOT NULL
       )`
    )
    this.run(
      `CREATE TABLE IF NOT EXISTS mailboxes (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         account_id INTEGER NOT NULL,
         name TEXT NOT NULL,
         path TEXT NOT NULL,
         delimiter TEXT NOT NULL DEFAULT '/',
         last_uid INTEGER NOT NULL DEFAULT 0,
         uidvalidity INTEGER,
         sync_at INTEGER
       )`
    )
    // 旧库迁移：补齐 uidvalidity 列（服务端 UIDVALIDITY 变化检测用）
    const mbCols = this.all<{ name: string }>('PRAGMA table_info(mailboxes)')
    if (!mbCols.some((c) => c.name === 'uidvalidity')) {
      this.run('ALTER TABLE mailboxes ADD COLUMN uidvalidity INTEGER')
      log.info('[MailService] mailboxes 表新增 uidvalidity 列（迁移）')
    }
    this.run(
      `CREATE TABLE IF NOT EXISTS messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         account_id INTEGER NOT NULL,
         mailbox_id INTEGER NOT NULL,
         uid INTEGER NOT NULL,
         subject TEXT NOT NULL DEFAULT '',
         from_name TEXT NOT NULL DEFAULT '',
         from_addr TEXT NOT NULL DEFAULT '',
         to_name TEXT NOT NULL DEFAULT '',
         to_addr TEXT NOT NULL DEFAULT '',
         cc TEXT NOT NULL DEFAULT '',
         date INTEGER NOT NULL,
         received_at INTEGER NOT NULL,
         text_body TEXT NOT NULL DEFAULT '',
         html_body TEXT NOT NULL DEFAULT '',
         has_attachments INTEGER NOT NULL DEFAULT 0,
         seen INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         UNIQUE(mailbox_id, uid)
       )`
    )
    this.run(
      `CREATE TABLE IF NOT EXISTS attachments (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         message_id INTEGER NOT NULL,
         filename TEXT NOT NULL,
         mime_type TEXT NOT NULL DEFAULT '',
         size INTEGER NOT NULL DEFAULT 0,
         file_path TEXT NOT NULL,
         cid TEXT
       )`
    )
    this.run('CREATE INDEX IF NOT EXISTS idx_mbox_account ON mailboxes(account_id)')
    this.run('CREATE INDEX IF NOT EXISTS idx_msg_mailbox_date ON messages(mailbox_id, date DESC)')
    this.run('CREATE INDEX IF NOT EXISTS idx_msg_account_date ON messages(account_id, date DESC)')
    this.run('CREATE INDEX IF NOT EXISTS idx_att_message ON attachments(message_id)')

    this.save()
    this.registerIPC()
    this.#startPolling()
    log.info(`[MailService] 初始化完成，账号数:`, this.all<{ n: number }>('SELECT COUNT(*) AS n FROM accounts')[0]?.n ?? 0)
  }

  /** 停止服务：停止轮询并落盘关闭数据库 */
  stop(): void {
    this.#stopPolling()
    this.close()
  }

  // ---------------------------------------------------------------------------
  // 账号管理
  // ---------------------------------------------------------------------------

  /** 新增账号：校验 → 测试连接 → 加密授权码入库 → 立即首轮同步 */
  async addAccount(input: MailAccountInput): Promise<{ ok: boolean; id?: number; error?: string }> {
    const acc = this.#validateInput(input)
    if (acc instanceof Error) return { ok: false, error: acc.message }
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: '系统安全存储不可用，无法加密保存授权码' }
    }
    const test = await this.testConnection(acc)
    if (!test.ok) return { ok: false, error: test.error }

    this.run(
      `INSERT INTO accounts (name, email, host, port, ssl, password_enc, last_sync_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      [acc.name, acc.email, acc.host, acc.port, acc.ssl ? 1 : 0, this.#encrypt(acc.authCode), Date.now()]
    )
    const id = this.lastInsertId()
    this.save()
    log.info(`[MailService] 账号已添加:`, acc.email)
    // 立即首轮同步（fire-and-forget，失败不影响添加）
    void this.#syncAccount(id)
    return { ok: true, id }
  }

  /** 仅测试 IMAP 连接（不保存、不建表） */
  async testConnection(input: MailAccountInput): Promise<MailAuthTestResult> {
    const acc = this.#validateInput(input)
    if (acc instanceof Error) return { ok: false, error: acc.message }
    const client = this.#newClient(acc.email, acc.host, acc.port, acc.ssl, acc.authCode)
    try {
      await client.connect()
      await client.list()
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`[MailService] 测试连接失败 (${acc.email}):`, msg)
      return { ok: false, error: msg }
    } finally {
      try {
        await client.logout()
      } catch {
        /* 连接未建立时 logout 会抛错，忽略 */
      }
    }
  }

  /** 编辑账号（authCode 传空串表示不改密码） */
  async updateAccount(input: MailAccountInput): Promise<MailOpResult> {
    const id = Number(input?.id)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: '账号不存在' }
    const existing = this.one<{ password_enc: string }>('SELECT password_enc FROM accounts WHERE id = ?', [id])
    if (!existing) return { ok: false, error: '账号不存在' }

    const name = String(input?.name ?? '').trim()
    const email = String(input?.email ?? '').trim().toLowerCase()
    const host = String(input?.host ?? '').trim()
    const port = Number(input?.port)
    const ssl = Boolean(input?.ssl)
    const authCode = String(input?.authCode ?? '').trim()
    if (!name) return { ok: false, error: '请输入账号名称' }
    if (!this.#isEmail(email)) return { ok: false, error: '邮箱地址格式不正确' }
    if (!host) return { ok: false, error: '请输入 IMAP 服务器地址' }
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: '端口号不正确' }
    if (authCode && !safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: '系统安全存储不可用，无法加密保存授权码' }
    }

    const enc = authCode ? this.#encrypt(authCode) : existing.password_enc
    this.run(
      'UPDATE accounts SET name = ?, email = ?, host = ?, port = ?, ssl = ?, password_enc = ? WHERE id = ?',
      [name, email, host, port, ssl ? 1 : 0, enc, id]
    )
    this.save()
    // 配置变更后立即重新同步（拉取新文件夹）
    void this.#syncAccount(id)
    return { ok: true }
  }

  /** 删除账号：级联删除其文件夹/邮件/附件文件 */
  async removeAccount(accountId: number): Promise<MailOpResult> {
    const id = Number(accountId)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: '账号不存在' }

    const atts = this.all<{ file_path: string }>(
      `SELECT a.file_path FROM attachments a
       JOIN messages m ON a.message_id = m.id
       WHERE m.account_id = ?`,
      [id]
    )
    for (const a of atts) this.#removeFile(a.file_path)
    this.run(
      'DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE account_id = ?)',
      [id]
    )
    this.run('DELETE FROM messages WHERE account_id = ?', [id])
    this.run('DELETE FROM mailboxes WHERE account_id = ?', [id])
    this.run('DELETE FROM accounts WHERE id = ?', [id])
    this.save()
    this.#emitUnread()
    broadcast(BROADCAST.mailSync, { ok: true, accountId: id, newCount: 0 }, { onlyVisible: true })
    return { ok: true }
  }

  /** 全部账号（不含密码） */
  getAccounts(): MailAccount[] {
    const rows = this.all<Record<string, unknown>>('SELECT * FROM accounts ORDER BY created_at ASC')
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      email: String(r.email),
      host: String(r.host),
      port: Number(r.port),
      ssl: Boolean(r.ssl),
      lastSyncAt: r.last_sync_at == null ? null : Number(r.last_sync_at),
      createdAt: Number(r.created_at)
    }))
  }

  // ---------------------------------------------------------------------------
  // 文件夹与邮件
  // ---------------------------------------------------------------------------

  /**
   * 导出全部邮箱账号连接配置（供备份 zip 打包）。
   * 仅含 accounts 表（不含邮件/附件数据）；password_enc 为 safeStorage 加密后的授权码，
   * 同机导入可解密恢复，跨机导入将自动置空需重新填写。
   */
  exportAccountsJson(): { json: string; count: number } {
    const rows = this.all<Record<string, unknown>>('SELECT * FROM accounts ORDER BY id ASC')
    const list = rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      email: String(r.email),
      host: String(r.host),
      port: Number(r.port),
      ssl: Boolean(r.ssl),
      password_enc: String(r.password_enc),
      last_sync_at: r.last_sync_at == null ? null : Number(r.last_sync_at),
      created_at: Number(r.created_at)
    }))
    return { json: JSON.stringify(list), count: list.length }
  }

  /** 从备份导入邮箱账号配置（merge=按 id 保留双方；replace=清空后完全替换）。返回导入/跳过/待重填授权码计数 */
  async importAccountsFromJson(
    json: string,
    mode: 'merge' | 'replace'
  ): Promise<{ imported: number; skipped: number; authMissing: number }> {
    let list: Record<string, unknown>[]
    try {
      list = JSON.parse(json) as Record<string, unknown>[]
      if (!Array.isArray(list)) throw new Error('格式错误')
    } catch (err) {
      log.warn('[MailService] 导入邮箱账号失败：解析备份数据出错:', err)
      return { imported: 0, skipped: 0, authMissing: 0 }
    }

    let imported = 0
    let skipped = 0
    let authMissing = 0
    const newIds: number[] = []

    if (mode === 'replace') {
      // 清空旧账号（级联删邮件/附件）
      const atts = this.all<{ file_path: string }>(
        `SELECT a.file_path FROM attachments a
         JOIN messages m ON a.message_id = m.id`
      )
      for (const a of atts) this.#removeFile(a.file_path)
      this.run('DELETE FROM attachments')
      this.run('DELETE FROM messages')
      this.run('DELETE FROM mailboxes')
      this.run('DELETE FROM accounts')
    }

    for (const raw of list) {
      const id = Number(raw.id)
      const name = String(raw.name ?? '')
      const email = String(raw.email ?? '').toLowerCase()
      const host = String(raw.host ?? '')
      const port = Number(raw.port)
      const ssl = Boolean(raw.ssl)
      const enc = String(raw.password_enc ?? '')
      const createdAt = Number(raw.created_at) || Date.now()
      const lastSync = raw.last_sync_at == null ? null : Number(raw.last_sync_at)
      if (!id || !email || !host) {
        skipped++
        continue
      }

      // 尝试解密授权码：同机导入可解；跨机/密钥不可用时置空，账号保留但需重新填写授权码
      let passwordEnc = enc
      if (enc && safeStorage.isEncryptionAvailable()) {
        try {
          safeStorage.decryptString(Buffer.from(enc, 'base64'))
        } catch {
          passwordEnc = ''
          authMissing++
        }
      } else if (enc) {
        passwordEnc = ''
        authMissing++
      }

      const existed = this.one<{ id: number }>('SELECT id FROM accounts WHERE id = ?', [id])
      if (mode === 'merge' && existed) {
        skipped++
        continue
      }
      this.run(
        `INSERT INTO accounts (id, name, email, host, port, ssl, password_enc, last_sync_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, email, host, port, ssl ? 1 : 0, passwordEnc, lastSync, createdAt]
      )
      imported++
      newIds.push(id)
    }
    this.save()

    // 导入后为新增账号触发同步（fire-and-forget，失败不影响导入）
    for (const id of newIds) {
      void this.#syncAccount(id)
    }
    log.info(`[MailService] 从备份导入账号：+${imported}/跳过${skipped}/待重填授权码${authMissing}`)
    return { imported, skipped, authMissing }
  }

  /** 指定账号的文件夹列表（含每文件夹未读/总数） */
  getMailboxes(accountId: number): MailboxInfo[] {
    const rows = this.all<Record<string, unknown>>(
      `SELECT mb.*,
         (SELECT COUNT(*) FROM messages m WHERE m.mailbox_id = mb.id) AS total,
         (SELECT COUNT(*) FROM messages m WHERE m.mailbox_id = mb.id AND m.seen = 0) AS unread
       FROM mailboxes mb
       WHERE mb.account_id = ?
       ORDER BY mb.path ASC`,
      [accountId]
    )
    return rows.map((r) => ({
      id: Number(r.id),
      accountId: Number(r.account_id),
      name: String(r.name),
      path: String(r.path),
      delimiter: String(r.delimiter),
      lastUid: Number(r.last_uid),
      unread: Number(r.unread ?? 0),
      total: Number(r.total ?? 0)
    }))
  }

  /** 指定文件夹邮件列表（date DESC，offset/limit 分页） */
  getMessages(mailboxId: number, offset = 0, limit = 50): MailMessageSummary[] {
    const rows = this.all<Record<string, unknown>>(
      `SELECT * FROM messages
       WHERE mailbox_id = ?
       ORDER BY date DESC, uid DESC
       LIMIT ? OFFSET ?`,
      [mailboxId, Math.min(Math.max(1, limit), MAX_PAGE_SIZE), Math.max(0, offset)]
    )
    return rows.map((r) => this.#toSummary(r))
  }

  /** 邮件详情（正文 + 附件） */
  getMessageDetail(messageId: number): MailMessageDetail | null {
    const r = this.one<Record<string, unknown>>('SELECT * FROM messages WHERE id = ?', [messageId])
    if (!r) return null
    const atts = this.all<Record<string, unknown>>('SELECT * FROM attachments WHERE message_id = ?', [messageId])
    return {
      ...this.#toSummary(r),
      toName: String(r.to_name),
      toAddr: String(r.to_addr),
      cc: String(r.cc),
      textBody: String(r.text_body),
      htmlBody: String(r.html_body),
      attachments: atts.map((a) => this.#toAttachment(a))
    }
  }

  /** 标记已读/未读：先改 DB，再异步回写 IMAP（best-effort） */
  markSeen(messageId: number, seen: boolean): void {
    const id = Number(messageId)
    const r = this.one<Record<string, unknown>>(
      `SELECT m.uid, m.seen, mb.path, a.email, a.host, a.port, a.ssl, a.password_enc
       FROM messages m
       JOIN mailboxes mb ON m.mailbox_id = mb.id
       JOIN accounts a ON mb.account_id = a.id
       WHERE m.id = ?`,
      [id]
    )
    if (!r) return
    this.run('UPDATE messages SET seen = ? WHERE id = ?', [seen ? 1 : 0, id])
    this.save()
    this.#emitUnread()
    if (Number(r.seen) === (seen ? 1 : 0)) return
    void this.#storeSeenFlag(
      {
        uid: Number(r.uid),
        path: String(r.path),
        email: String(r.email),
        host: String(r.host),
        port: Number(r.port),
        ssl: Boolean(r.ssl),
        passwordEnc: String(r.password_enc)
      },
      seen
    )
  }

  /** 当前文件夹全部标为已读：先改 DB，再异步批量回写 IMAP（best-effort） */
  markAllRead(mailboxId: number): MailMarkAllReadResult {
    const id = Number(mailboxId)
    const r = this.one<Record<string, unknown>>(
      `SELECT mb.path, a.email, a.host, a.port, a.ssl, a.password_enc
       FROM mailboxes mb
       JOIN accounts a ON mb.account_id = a.id
       WHERE mb.id = ?`,
      [id]
    )
    if (!r) return { ok: false, count: 0 }
    const unread = this.all<{ uid: number }>('SELECT uid FROM messages WHERE mailbox_id = ? AND seen = 0', [id])
    if (!unread.length) return { ok: true, count: 0 }
    this.run('UPDATE messages SET seen = 1 WHERE mailbox_id = ? AND seen = 0', [id])
    this.save()
    this.#emitUnread()
    void this.#storeSeenFlags(
      {
        path: String(r.path),
        email: String(r.email),
        host: String(r.host),
        port: Number(r.port),
        ssl: Boolean(r.ssl),
        passwordEnc: String(r.password_enc)
      },
      unread.map((u) => Number(u.uid))
    )
    return { ok: true, count: unread.length }
  }

  /** 全部账号未读总数（侧栏角标） */
  getUnreadTotal(): number {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE seen = 0')?.n ?? 0
  }

  /** 正在同步中的账号列表（标题栏「同步中」状态指示） */
  getSyncing(): MailSyncingInfo[] {
    if (!this.syncing.size) return []
    const infos: MailSyncingInfo[] = []
    for (const id of this.syncing) {
      const acc = this.one<{ name: string }>('SELECT name FROM accounts WHERE id = ?', [id])
      if (acc) infos.push({ accountId: id, name: acc.name })
    }
    return infos
  }

  /** 手动同步（accountId 缺省 = 全部账号） */
  async syncNow(accountId?: number): Promise<MailSyncResult | MailSyncResult[]> {
    const id = Number(accountId)
    if (Number.isInteger(id) && id > 0) {
      return this.#syncAccount(id)
    }
    const accounts = this.all<{ id: number }>('SELECT id FROM accounts ORDER BY id ASC')
    const results: MailSyncResult[] = []
    for (const a of accounts) {
      results.push(await this.#syncAccount(a.id))
    }
    return results
  }

  // ---------------------------------------------------------------------------
  // 附件
  // ---------------------------------------------------------------------------

  /** 下载附件：弹保存对话框，复制到用户指定位置（不动库内副本） */
  async downloadAttachment(attachmentId: number): Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }> {
    const id = Number(attachmentId)
    const att = this.one<{ filename: string; file_path: string }>('SELECT filename, file_path FROM attachments WHERE id = ?', [id])
    if (!att || !existsSync(att.file_path)) return { ok: false, canceled: false, error: '附件不存在' }
    const r = await dialog.showSaveDialog({ defaultPath: att.filename })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    try {
      copyFileSync(att.file_path, r.filePath)
      return { ok: true, canceled: false, path: r.filePath }
    } catch (err) {
      return { ok: false, canceled: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 用系统默认程序打开附件（直接用库内存储副本） */
  async openAttachment(attachmentId: number): Promise<MailOpResult> {
    const id = Number(attachmentId)
    const att = this.one<{ file_path: string }>('SELECT file_path FROM attachments WHERE id = ?', [id])
    if (!att || !existsSync(att.file_path)) return { ok: false, error: '附件不存在' }
    try {
      const errMsg = await shell.openPath(att.file_path)
      return errMsg ? { ok: false, error: errMsg } : { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ---------------------------------------------------------------------------
  // 同步核心
  // ---------------------------------------------------------------------------

  /** 同步单个账号（短连接：connect → 同步文件夹与邮件 → logout） */
  async #syncAccount(accountId: number): Promise<MailSyncResult> {
    const acc = this.one<Record<string, unknown>>('SELECT * FROM accounts WHERE id = ?', [accountId])
    if (!acc) return { ok: false, accountId, newCount: 0, error: '账号不存在' }
    if (this.syncing.has(accountId)) return { ok: false, accountId, newCount: 0, error: '该账号正在同步中' }
    this.syncing.add(accountId)
    this.#emitSyncing()
    try {
      const client = this.#newClient(
        String(acc.email),
        String(acc.host),
        Number(acc.port),
        Boolean(acc.ssl),
        this.#decrypt(String(acc.password_enc))
      )
      try {
        await client.connect()
        // 1. 同步文件夹列表（新增文件夹入库）
        await this.#syncMailboxes(client, accountId)
        // 2. 逐文件夹增量同步
        const mailboxes = this.all<Record<string, unknown>>(
          'SELECT * FROM mailboxes WHERE account_id = ?',
          [accountId]
        )
        let newCount = 0
        let firstSubject = ''
        let inboxNewCount = 0
        let inboxFirstSubject = ''
        for (const mb of mailboxes) {
          const outcome = await this.#syncMailbox(client, mb)
          newCount += outcome.newCount
          if (!firstSubject) firstSubject = outcome.firstSubject
          // 仅收件箱计入通知：发件/其他文件夹同步到的新邮件不弹通知
          if (this.#isInboxMailbox(mb)) {
            inboxNewCount += outcome.newCount
            if (!inboxFirstSubject) inboxFirstSubject = outcome.firstSubject
          }
        }
        this.run('UPDATE accounts SET last_sync_at = ? WHERE id = ?', [Date.now(), accountId])
        this.save()

        if (inboxNewCount > 0) {
          notificationService.notify({
            type: 'info',
            source: 'mail',
            title: String(acc.name) || String(acc.email),
            message:
              inboxNewCount === 1
                ? `新邮件：${inboxFirstSubject || '(无主题)'}`
                : `收到 ${inboxNewCount} 封新邮件${inboxFirstSubject ? `（如：${inboxFirstSubject.slice(0, SUBJECT_PREVIEW_LEN)}）` : ''}`
          })
        }
        const result: MailSyncResult = { ok: true, accountId, newCount }
        broadcast(BROADCAST.mailSync, result, { onlyVisible: true })
        this.#emitUnread()
        log.info(`[MailService] 同步完成 (${acc.email}):`, `${newCount} 封新邮件`)
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn(`[MailService] 同步失败 (${acc.email}):`, msg)
        return { ok: false, accountId, newCount: 0, error: msg }
      } finally {
        try {
          await client.logout()
        } catch {
          /* 连接失败时 logout 会抛错，忽略 */
        }
      }
    } finally {
      this.syncing.delete(accountId)
      this.#emitSyncing()
    }
  }

  /** 同步文件夹列表：新增服务端存在的文件夹入库（\Noselect 跳过），已知文件夹刷新中文显示名 */
  async #syncMailboxes(client: ImapFlow, accountId: number): Promise<void> {
    const list = await client.list()
    for (const mb of list) {
      if (mb.flags?.has('\\Noselect')) continue
      const displayName = this.#mailboxDisplayName(mb)
      const known = this.one<{ id: number; name: string }>(
        'SELECT id, name FROM mailboxes WHERE account_id = ? AND path = ?',
        [accountId, mb.path]
      )
      if (known) {
        // 显示名映射变化（如「INBOX」→「收件箱」）时就地更新，无需重新添加账号
        if (known.name !== displayName) {
          this.run('UPDATE mailboxes SET name = ? WHERE id = ?', [displayName, known.id])
        }
        continue
      }
      this.run(
        'INSERT INTO mailboxes (account_id, name, path, delimiter, last_uid, uidvalidity, sync_at) VALUES (?, ?, ?, ?, 0, NULL, NULL)',
        [accountId, displayName, mb.path, mb.delimiter || '/']
      )
    }
    this.save()
  }

  /** 同步单个文件夹：首次取最近 INITIAL_SYNC_MAX 封，此后按 last_uid 增量（含 UID 状态异常兜底） */
  async #syncMailbox(client: ImapFlow, mb: Record<string, unknown>): Promise<MailboxSyncOutcome> {
    const mailboxId = Number(mb.id)
    const accountId = Number(mb.account_id)
    const path = String(mb.path)

    let opened: { exists: number; uidNext?: number; uidValidity?: bigint | number }
    try {
      opened = await client.mailboxOpen(path)
    } catch (err) {
      log.warn(`[MailService] 打开文件夹失败:`, path, err)
      return { newCount: 0, firstSubject: '' }
    }
    const exists = opened.exists ?? 0
    if (exists === 0) return { newCount: 0, firstSubject: '' }

    // 服务端 UIDVALIDITY（SELECT 响应必含）。变化说明历史 UID 已全部失效：
    // 若继续用旧 UID 区间（lastUid+1:*）会永远匹配不到新邮件 → 重置游标走序号尾部对账。
    const uidValidity = Number(opened.uidValidity ?? 0)
    let lastUid = Number(mb.last_uid ?? 0)
    if (uidValidity && Number(mb.uidvalidity ?? 0) !== uidValidity) {
      log.warn(
        `[MailService] 文件夹 UIDVALIDITY 变化 (${path}): ${String(mb.uidvalidity ?? '')} -> ${uidValidity}，重置同步游标`
      )
      lastUid = 0
    }

    // 收集信封：首次/重置按序号尾部；增量按 UID；UID 未命中但服务器确实有更新的邮件时按序号尾部对账
    const summaries: FetchedSummary[] = []
    if (lastUid === 0) {
      const startSeq = Math.max(1, exists - INITIAL_SYNC_MAX + 1)
      for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, flags: true, uid: true })) {
        if (msg.uid != null && msg.uid > 0) summaries.push(this.#toFetchedSummary(msg))
      }
    } else {
      for await (const msg of client.fetch(`${lastUid + 1}:*`, { envelope: true, flags: true, uid: true })) {
        if (msg.uid != null && msg.uid > 0) summaries.push(this.#toFetchedSummary(msg))
      }
      // uidNext = 服务器将为下封新邮件分配的 UID；若它仍大于 lastUid+1，说明存在比 lastUid
      // 更新的邮件但 UID 区间未命中（服务器 UID 状态异常），改按序号尾部拉最近 RECONCILE_WINDOW 封对账。
      if (!summaries.length) {
        const uidNext = Number(opened.uidNext ?? 0)
        if (uidNext > 0 && uidNext > lastUid + 1) {
          log.warn(
            `[MailService] UID 增量未命中但服务器有新邮件 (${path}): lastUid=${lastUid} uidNext=${uidNext}，按序号尾部对账最近 ${RECONCILE_WINDOW} 封`
          )
          const startSeq = Math.max(1, exists - RECONCILE_WINDOW + 1)
          for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, flags: true, uid: true })) {
            if (msg.uid != null && msg.uid > 0) summaries.push(this.#toFetchedSummary(msg))
          }
        }
      }
    }
    // 无论是否取到新邮件，都落盘最新 uidvalidity 供下次比对；无新邮件时仅更新该值
    if (!summaries.length) {
      this.run('UPDATE mailboxes SET uidvalidity = ?, sync_at = ? WHERE id = ?', [
        uidValidity,
        Date.now(),
        mailboxId
      ])
      this.save()
      return { newCount: 0, firstSubject: '' }
    }
    summaries.sort((a, b) => a.uid - b.uid)
    const maxUid = summaries[summaries.length - 1].uid

    // 过滤已入库的（中断重试等场景），批量拉取 source 一次
    const existing = new Set(
      this.all<{ uid: number }>('SELECT uid FROM messages WHERE mailbox_id = ?', [mailboxId]).map((r) => r.uid)
    )
    const toFetch = summaries.filter((s) => !existing.has(s.uid))
    const sources = new Map<number, Buffer>()
    if (toFetch.length) {
      const range = toFetch.map((s) => s.uid).join(',')
      for await (const msg of client.fetch(range, { source: true }, { uid: true })) {
        if (msg.uid != null && msg.source) sources.set(msg.uid, msg.source)
      }
    }

    let newCount = 0
    let firstSubject = ''
    for (const s of summaries) {
      const source = sources.get(s.uid)
      if (!source) continue
      if (await this.#storeParsedMessage(mailboxId, accountId, s, source)) {
        newCount++
        if (!firstSubject) firstSubject = s.subject
      }
    }
    this.run('UPDATE mailboxes SET last_uid = ?, uidvalidity = ?, sync_at = ? WHERE id = ?', [
      maxUid,
      uidValidity,
      Date.now(),
      mailboxId
    ])
    this.save()
    return { newCount, firstSubject }
  }

  /** 解析并入库一封邮件（含附件落盘与容量裁剪）；已存在返回 false */
  async #storeParsedMessage(
    mailboxId: number,
    accountId: number,
    s: FetchedSummary,
    source: Buffer
  ): Promise<boolean> {
    try {
      const parsed = await simpleParser(source)
      const from = parsed.from?.value?.[0]
      const to = parsed.to?.value?.[0]
      const cc = (parsed.cc?.value ?? [])
        .map((a) => a.address)
        .filter((x): x is string => Boolean(x))
        .join(', ')
      const subject = String(parsed.subject ?? '')
      const textBody = typeof parsed.text === 'string' ? parsed.text : ''
      const htmlBody = typeof parsed.html === 'string' ? parsed.html : ''
      const dateMs = parsed.date ? parsed.date.getTime() : Date.now()

      const existing = this.one<{ id: number }>('SELECT id FROM messages WHERE mailbox_id = ? AND uid = ?', [
        mailboxId,
        s.uid
      ])
      if (existing) return false

      this.run(
        `INSERT INTO messages
           (account_id, mailbox_id, uid, subject, from_name, from_addr, to_name, to_addr, cc,
            date, received_at, text_body, html_body, has_attachments, seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          accountId,
          mailboxId,
          s.uid,
          subject,
          from?.name ?? '',
          from?.address ?? '',
          to?.name ?? '',
          to?.address ?? '',
          cc,
          dateMs,
          Date.now(),
          textBody,
          htmlBody,
          s.seen ? 1 : 0,
          Date.now()
        ]
      )
      const messageId = this.lastInsertId()
      if (!messageId) return false

      // 附件写盘（含内嵌图片；内嵌不参与 has_attachments 判定）
      let hasReal = false
      for (const att of parsed.attachments ?? []) {
        if (!att.content || att.content.length === 0) continue
        const filename = this.#safeFilename(att.filename)
        const dir = join(this.attachmentsDir, String(messageId))
        mkdirSync(dir, { recursive: true })
        const filePath = join(dir, filename)
        writeFileSync(filePath, att.content)
        const isInline = Boolean(att.cid)
        if (!isInline) hasReal = true
        this.run(
          'INSERT INTO attachments (message_id, filename, mime_type, size, file_path, cid) VALUES (?, ?, ?, ?, ?, ?)',
          [messageId, filename, att.contentType ?? '', att.content.length, filePath, att.cid ?? null]
        )
      }
      if (hasReal) {
        this.run('UPDATE messages SET has_attachments = 1 WHERE id = ?', [messageId])
      }
      this.save()
      this.#trimMailbox(mailboxId)
      return true
    } catch (err) {
      log.warn('[MailService] 解析邮件失败:', err)
      return false
    }
  }

  /** 容量裁剪：每个文件夹仅保留最近 MAX_MESSAGES_PER_MAILBOX 封，级联删除附件文件 */
  #trimMailbox(mailboxId: number): void {
    const excess = this.all<{ id: number }>(
      `SELECT id FROM messages
       WHERE mailbox_id = ?
       ORDER BY date DESC, id DESC
       LIMIT -1 OFFSET ?`,
      [mailboxId, MAX_MESSAGES_PER_MAILBOX]
    )
    if (!excess.length) return
    const ids = excess.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(',')
    const atts = this.all<{ file_path: string }>(
      `SELECT file_path FROM attachments WHERE message_id IN (${placeholders})`,
      ids
    )
    for (const a of atts) this.#removeFile(a.file_path)
    this.run(`DELETE FROM attachments WHERE message_id IN (${placeholders})`, ids)
    this.run(`DELETE FROM messages WHERE id IN (${placeholders})`, ids)
    this.save()
  }

  // ---------------------------------------------------------------------------
  // 轮询
  // ---------------------------------------------------------------------------

  #startPolling(): void {
    this.#stopPolling()
    this.pollTimer = setTimeout(() => void this.#pollTick(), POLL_FIRST_DELAY_MS)
  }

  #stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
  }

  /** 轮询一轮：每 tick 重读设置间隔（分钟 → ms），串行同步全部账号 */
  async #pollTick(): Promise<void> {
    const raw = Number(settingsService.getAll().mailPollIntervalMin)
    const intervalMin = Number.isFinite(raw) && raw > 0 ? raw : 1
    this.pollTimer = setTimeout(() => void this.#pollTick(), intervalMin * 60_000)
    const accounts = this.all<{ id: number }>('SELECT id FROM accounts ORDER BY id ASC')
    for (const a of accounts) {
      await this.#syncAccount(a.id)
    }
  }

  // ---------------------------------------------------------------------------
  // 工具方法
  // ---------------------------------------------------------------------------

  /** 新建 IMAP 客户端（短连接，logger 关闭避免刷日志） */
  #newClient(email: string, host: string, port: number, ssl: boolean, pass: string): ImapFlow {
    return new ImapFlow({
      host,
      port,
      secure: ssl,
      auth: { user: email, pass },
      logger: false
    })
  }

  /**
   * 文件夹显示名：优先用服务器 SPECIAL-USE 标志映射中文名，其次按常见英文名映射，
   * 均未命中（用户自建文件夹）则原样展示服务器名称。
   */
  #mailboxDisplayName(mb: { name?: string; path?: string; specialUse?: string }): string {
    if (mb.specialUse) {
      const byFlag = SPECIAL_USE_NAME_MAP[mb.specialUse]
      if (byFlag) return byFlag
    }
    const raw = String(mb.name || mb.path || '')
    return MAILBOX_NAME_MAP[raw.toLowerCase()] ?? raw
  }

  /** 判断文件夹是否为收件箱：RFC 3501 保留名 INBOX（大小写不敏感）；个别服务器以本地化路径/名称呈现 */
  #isInboxMailbox(mb: Record<string, unknown>): boolean {
    const path = String(mb.path ?? '').toLowerCase()
    const name = String(mb.name ?? '')
    return path === 'inbox' || path === '收件箱' || name === '收件箱'
  }

  /** 输入归一化 + 校验（新增/测试连接用）；非法返回 Error */
  #validateInput(input: MailAccountInput): MailAccountInput | Error {
    const name = String(input?.name ?? '').trim()
    const email = String(input?.email ?? '').trim().toLowerCase()
    const host = String(input?.host ?? '').trim()
    const port = Number(input?.port)
    const ssl = Boolean(input?.ssl)
    const authCode = String(input?.authCode ?? '')
    if (!name) return new Error('请输入账号名称')
    if (!this.#isEmail(email)) return new Error('邮箱地址格式不正确')
    if (!host) return new Error('请输入 IMAP 服务器地址')
    if (!Number.isInteger(port) || port < 1 || port > 65535) return new Error('端口号不正确')
    if (!authCode) return new Error('请输入 IMAP 授权码')
    return { name, email, host, port, ssl, authCode }
  }

  #isEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  /** fetch 结果 → 待入库摘要（防御性收窄字段） */
  #toFetchedSummary(msg: {
    uid: number
    envelope?: { subject?: string | null; from?: Array<{ name?: string | null; address?: string | null }> | null }
    flags?: Set<string>
  }): FetchedSummary {
    const from = msg.envelope?.from?.[0]
    return {
      uid: msg.uid,
      subject: String(msg.envelope?.subject ?? ''),
      fromName: String(from?.name ?? ''),
      fromAddr: String(from?.address ?? ''),
      seen: Boolean(msg.flags?.has('\\Seen'))
    }
  }

  /** 邮件行 → 列表摘要 */
  #toSummary(r: Record<string, unknown>): MailMessageSummary {
    return {
      id: Number(r.id),
      mailboxId: Number(r.mailbox_id),
      uid: Number(r.uid),
      subject: String(r.subject),
      fromName: String(r.from_name),
      fromAddr: String(r.from_addr),
      date: Number(r.date),
      receivedAt: Number(r.received_at),
      seen: Number(r.seen) === 1,
      hasAttachments: Number(r.has_attachments) === 1
    }
  }

  /** 附件行 → 附件模型 */
  #toAttachment(a: Record<string, unknown>): MailAttachment {
    return {
      id: Number(a.id),
      messageId: Number(a.message_id),
      filename: String(a.filename),
      mimeType: String(a.mime_type),
      size: Number(a.size),
      filePath: String(a.file_path),
      cid: a.cid == null ? null : String(a.cid)
    }
  }

  /** 加密授权码 → base64（safeStorage，OS 级密钥环） */
  #encrypt(plain: string): string {
    return safeStorage.encryptString(plain).toString('base64')
  }

  /** base64 → 解密授权码 */
  #decrypt(enc: string): string {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  }

  /** 附件文件名清洗：取 basename + 去非法字符 + 限长 */
  #safeFilename(name: string | undefined): string {
    const cleaned = basename(String(name ?? ''))
      .replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
      .trim()
    const base = cleaned || 'attachment'
    return base.length > 120 ? base.slice(0, 120) : base
  }

  /** 删除单个文件（不存在/失败静默） */
  #removeFile(path: string): void {
    if (!path) return
    try {
      if (existsSync(path)) rmSync(path, { force: true })
    } catch (err) {
      log.warn('[MailService] 删除附件文件失败:', path, err)
    }
  }

  /** 已读状态回写 IMAP（best-effort，失败仅记日志） */
  async #storeSeenFlag(info: SeenStoreInfo, seen: boolean): Promise<void> {
    const client = this.#newClient(info.email, info.host, info.port, info.ssl, this.#decrypt(info.passwordEnc))
    try {
      await client.connect()
      try {
        await client.mailboxOpen(info.path)
        if (seen) {
          await client.messageFlagsAdd(String(info.uid), ['\\Seen'], { uid: true })
        } else {
          await client.messageFlagsRemove(String(info.uid), ['\\Seen'], { uid: true })
        }
      } finally {
        try {
          await client.logout()
        } catch {
          /* 忽略 */
        }
      }
    } catch (err) {
      log.warn('[MailService] 回写 IMAP 已读状态失败:', err)
    }
  }

  /** 批量已读回写 IMAP（best-effort，失败仅记日志；uid 集一次 STORE） */
  async #storeSeenFlags(info: SeenConnInfo, uids: number[]): Promise<void> {
    if (!uids.length) return
    const client = this.#newClient(info.email, info.host, info.port, info.ssl, this.#decrypt(info.passwordEnc))
    try {
      await client.connect()
      try {
        await client.mailboxOpen(info.path)
        await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
      } finally {
        try {
          await client.logout()
        } catch {
          /* 忽略 */
        }
      }
    } catch (err) {
      log.warn('[MailService] 批量回写 IMAP 已读状态失败:', err)
    }
  }

  /** 广播未读总数变化 */
  #emitUnread(): void {
    broadcast(BROADCAST.mailUnreadChanged, this.getUnreadTotal(), { onlyVisible: true })
  }

  /** 广播同步中状态变化（标题栏「同步中」指示） */
  #emitSyncing(): void {
    broadcast(BROADCAST.mailSyncingChanged, this.getSyncing(), { onlyVisible: true })
  }

  private registerIPC(): void {
    const M = SERVICE_CHANNELS.mail

    ipcMain.handle(M.getAccounts, () => this.getAccounts())
    ipcMain.handle(M.addAccount, (_e, input: MailAccountInput) => this.addAccount(input))
    ipcMain.handle(M.testConnection, (_e, input: MailAccountInput) => this.testConnection(input))
    ipcMain.handle(M.updateAccount, (_e, input: MailAccountInput) => this.updateAccount(input))
    ipcMain.handle(M.removeAccount, (_e, accountId: number) => this.removeAccount(Number(accountId)))
    ipcMain.handle(M.getMailboxes, (_e, accountId: number) => this.getMailboxes(Number(accountId)))
    ipcMain.handle(M.getMessages, (_e, mailboxId: number, offset?: number, limit?: number) =>
      this.getMessages(Number(mailboxId), Number(offset) || 0, Number(limit) || 50)
    )
    ipcMain.handle(M.getMessageDetail, (_e, messageId: number) => this.getMessageDetail(Number(messageId)))
    ipcMain.handle(M.markSeen, (_e, messageId: number, seen: boolean) =>
      this.markSeen(Number(messageId), Boolean(seen))
    )
    ipcMain.handle(M.markAllRead, (_e, mailboxId: number) => this.markAllRead(Number(mailboxId)))
    ipcMain.handle(M.syncNow, (_e, accountId?: number) =>
      this.syncNow(accountId == null ? undefined : Number(accountId))
    )
    ipcMain.handle(M.getSyncing, () => this.getSyncing())
    ipcMain.handle(M.getUnreadTotal, () => this.getUnreadTotal())
    ipcMain.handle(M.downloadAttachment, (_e, attachmentId: number) =>
      this.downloadAttachment(Number(attachmentId))
    )
    ipcMain.handle(M.openAttachment, (_e, attachmentId: number) => this.openAttachment(Number(attachmentId)))
  }
}

/** 邮箱大师服务单例 */
export const mailService = new MailService()
