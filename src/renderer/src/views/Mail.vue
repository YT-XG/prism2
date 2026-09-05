<template>
  <div class="mail">
    <!-- 顶栏 -->
    <header class="mail-header">
      <h1 class="mail-title">邮箱大师</h1>
      <div class="mail-header__actions">
        <UiButton variant="ghost" :disabled="syncingAll" @click="syncAll">
          <RefreshCw :size="14" :stroke-width="1.6" :class="{ 'is-spin': syncingAll }" />
          {{ syncingAll ? '同步中…' : '全部同步' }}
        </UiButton>
        <UiButton @click="openAddDialog">
          <Plus :size="14" :stroke-width="1.6" />
          添加账号
        </UiButton>
      </div>
    </header>

    <div class="mail-body">
      <!-- 左栏：账号 + 文件夹 -->
      <aside class="pane pane--accounts" aria-label="邮箱账号">
        <div v-if="loadingAccounts" class="pane-loading">
          <UiEmptyState title="正在加载账号…" variant="loading" />
        </div>
        <div v-else-if="!accounts.length" class="pane-empty">
          <UiEmptyState title="尚未添加账号" hint="添加一个邮箱账号（IMAP 授权码）开始收信">
            <template #icon><Mail :size="28" :stroke-width="1.5" /></template>
            <template #action>
              <UiButton @click="openAddDialog">添加账号</UiButton>
            </template>
          </UiEmptyState>
        </div>
        <div v-else class="accounts">
          <div
            v-for="acc in accounts"
            :key="acc.id"
            class="account"
            :class="{ 'is-selected': selectedAccountId === acc.id }"
            role="button"
            :aria-expanded="selectedAccountId === acc.id"
            @click="selectAccount(acc)"
          >
            <div class="account__head">
              <span class="account__name">{{ acc.name }}</span>
              <span v-if="unreadByAccount[acc.id]" class="num account__badge">{{ unreadByAccount[acc.id] }}</span>
              <RefreshCw
                v-if="syncing.includes(acc.id)"
                :size="13"
                :stroke-width="1.6"
                class="account__sync is-spin"
              />
            </div>
            <div class="account__email" :title="acc.email">{{ acc.email }}</div>
            <div class="account__actions">
              <button type="button" class="account-btn" title="立即同步" @click.stop="syncAccount(acc.id)">
                <RefreshCw :size="14" :stroke-width="1.6" />
              </button>
              <button type="button" class="account-btn" title="编辑账号" @click.stop="openEditDialog(acc)">
                <Pencil :size="14" :stroke-width="1.6" />
              </button>
              <button type="button" class="account-btn account-btn--danger" title="删除账号" @click.stop="confirmRemove(acc)">
                <Trash2 :size="14" :stroke-width="1.6" />
              </button>
            </div>
            <div v-if="selectedAccountId === acc.id" class="account__mailboxes">
              <button
                v-for="mb in mailboxes"
                :key="mb.id"
                type="button"
                class="mailbox"
                :class="{ 'is-selected': selectedMailboxId === mb.id }"
                @click.stop="selectMailbox(mb)"
              >
                <span class="mailbox__name">{{ mb.name }}</span>
                <span v-if="mb.unread" class="num mailbox__unread">{{ mb.unread }}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <!-- 中栏：邮件列表 -->
      <section class="pane pane--list" aria-label="邮件列表">
        <template v-if="selectedMailboxId">
          <div
            class="msg-list"
            @scroll="onListScroll"
          >
            <div v-if="loadingMessages && !messages.length" class="pane-loading">
              <UiEmptyState title="正在加载邮件…" variant="loading" />
            </div>
            <div v-else-if="!messages.length" class="pane-empty">
              <UiEmptyState title="暂无邮件" hint="同步后新邮件会出现在这里" />
            </div>
            <div v-else class="msg-list__inner">
              <button
                v-for="msg in messages"
                :key="msg.id"
                type="button"
                class="msg"
                :class="{ 'is-selected': selectedMessageId === msg.id, 'is-unread': !msg.seen }"
                @click="selectMessage(msg)"
              >
                <div class="msg__row">
                  <span class="msg__from">{{ msg.fromName || msg.fromAddr || '(未知发件人)' }}</span>
                  <span class="num msg__time">{{ formatMailTime(msg.date) }}</span>
                </div>
                <div class="msg__subject" :title="msg.subject">{{ msg.subject || '(无主题)' }}</div>
                <div v-if="msg.hasAttachments" class="msg__att">
                  <Paperclip :size="12" :stroke-width="1.6" />
                </div>
              </button>
              <div v-if="hasMore" class="msg-list__more">
                <UiEmptyState
                  v-if="loadingMessages"
                  title="加载更多…"
                  variant="loading"
                />
                <button v-else type="button" class="msg-list__more-btn" @click="loadMore">加载更多</button>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="pane-empty">
          <UiEmptyState title="选择一个文件夹" hint="左侧选择账号与文件夹查看邮件" />
        </div>
      </section>

      <!-- 右栏：阅读窗 -->
      <section class="pane pane--reader" aria-label="邮件阅读">
        <div v-if="detailLoading" class="pane-loading">
          <UiEmptyState title="正在加载邮件…" variant="loading" />
        </div>
        <div v-else-if="detail" class="reader">
          <div class="reader__head">
            <div class="reader__subject-row">
              <h2 class="reader__subject">{{ detail.subject || '(无主题)' }}</h2>
              <button type="button" class="reader__seen-toggle" @click="toggleSeen">
                {{ detail.seen ? '标为未读' : '标为已读' }}
              </button>
            </div>
            <div class="reader__meta">
              <div class="reader__from" :title="detail.fromAddr">
                <span class="reader__from-name">{{ detail.fromName || detail.fromAddr || '(未知发件人)' }}</span>
                <span v-if="detail.fromAddr && detail.fromAddr !== detail.fromName" class="reader__from-addr">{{ detail.fromAddr }}</span>
              </div>
              <div class="reader__to" :title="detail.toAddr">收件人：{{ detail.toName || detail.toAddr || '—' }}</div>
              <div v-if="detail.cc" class="reader__to">抄送：{{ detail.cc }}</div>
              <div class="reader__date">{{ formatFullTime(detail.date) }}</div>
            </div>
          </div>
          <div class="reader__body">
            <iframe
              v-if="readerDoc"
              class="reader__iframe"
              :srcdoc="readerDoc"
              sandbox=""
              referrerpolicy="no-referrer"
              title="邮件正文"
            />
            <div v-else-if="detail.textBody" class="reader__text">{{ detail.textBody }}</div>
            <div v-else class="reader__empty">（本邮件无正文）</div>
          </div>
          <div v-if="visibleAttachments.length" class="reader__atts">
            <div class="reader__atts-title">附件（{{ visibleAttachments.length }}）</div>
            <div v-for="att in visibleAttachments" :key="att.id" class="reader__att">
              <Paperclip :size="13" :stroke-width="1.6" class="reader__att-icon" />
              <span class="reader__att-name" :title="att.filename">{{ att.filename }}</span>
              <span class="num reader__att-size">{{ formatSize(att.size) }}</span>
              <button type="button" class="reader__att-btn" @click="openAttachment(att)">打开</button>
              <button type="button" class="reader__att-btn" @click="downloadAttachment(att)">下载</button>
            </div>
          </div>
        </div>
        <div v-else class="pane-empty">
          <UiEmptyState title="选择一封邮件" hint="点击中间列表的邮件查看正文与附件" />
        </div>
      </section>
    </div>

    <!-- 添加 / 编辑账号弹窗 -->
    <UiDialog
      :model-value="accountDialogOpen"
      :title="editingAccount ? '编辑账号' : '添加账号'"
      :overlay-close="false"
      @update:model-value="accountDialogOpen = false"
    >
      <div class="acc-form">
        <div class="acc-form__row">
          <label class="acc-form__label" for="acc-name">账号名称</label>
          <UiInput v-model="form.name" id="acc-name" placeholder="如：工作邮箱" label="账号名称" />
        </div>
        <div class="acc-form__row">
          <label class="acc-form__label" for="acc-email">邮箱地址</label>
          <UiInput v-model="form.email" id="acc-email" placeholder="name@example.com" label="邮箱地址" />
        </div>
        <div class="acc-form__grid">
          <div class="acc-form__row">
            <label class="acc-form__label" for="acc-host">IMAP 服务器</label>
            <UiInput v-model="form.host" id="acc-host" placeholder="imap.qq.com" label="IMAP 服务器" />
          </div>
          <div class="acc-form__row acc-form__row--port">
            <label class="acc-form__label" for="acc-port">端口</label>
            <UiInput
              :model-value="String(form.port)"
              id="acc-port"
              type="number"
              label="端口"
              @update:model-value="form.port = Number($event)"
            />
          </div>
        </div>
        <div class="acc-form__row">
          <div class="acc-form__ssl">
            <div>
              <div class="acc-form__label">SSL 加密连接</div>
              <div class="acc-form__hint">常用 SSL 端口：QQ/163 为 993</div>
            </div>
            <UiSwitch v-model="form.ssl" />
          </div>
        </div>
        <div class="acc-form__row">
          <label class="acc-form__label" for="acc-code">IMAP 授权码{{ editingAccount ? '（留空保持不变）' : '' }}</label>
          <UiInput v-model="form.authCode" id="acc-code" type="password" label="IMAP 授权码" />
        </div>
        <div class="acc-form__hint">
          授权码需先在邮箱网页设置中开启 IMAP 服务后获取（QQ/163 等为独立授权码，非登录密码）。
        </div>
        <div v-if="testResult" class="acc-form__test" :class="`acc-form__test--${testResult.ok ? 'ok' : 'fail'}`">
          {{ testResult.message }}
        </div>
      </div>
      <template #footer>
        <UiButton variant="ghost" :disabled="testing" @click="testConnection">测试连接</UiButton>
        <UiButton variant="ghost" @click="accountDialogOpen = false">取消</UiButton>
        <UiButton :disabled="formSaving" @click="saveAccount">{{ editingAccount ? '保存' : '添加' }}</UiButton>
      </template>
    </UiDialog>

    <!-- 删除账号确认 -->
    <UiDialog
      :model-value="confirmRemoveOpen"
      title="删除账号"
      @update:model-value="confirmRemoveOpen = false"
    >
      <p class="confirm-text">
        将删除「{{ removeTarget?.name }}」及其全部邮件与附件文件（服务器上的邮件不受影响）。此操作不可撤销，确定删除？
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmRemoveOpen = false">取消</UiButton>
        <UiButton variant="danger" @click="removeAccount">删除</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Mail, Paperclip, Pencil, Plus, RefreshCw, Trash2 } from '@lucide/vue'
import DOMPurify from 'dompurify'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import { useToast } from '@renderer/composables/useToast'
import { useMail } from '@renderer/composables/useMail'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type {
  MailAccount,
  MailAccountInput,
  MailAttachment,
  MailboxInfo,
  MailMessageDetail,
  MailMessageSummary,
  MailSyncResult
} from '@preload/ipc'

const toast = useToast()
const { accounts, init: initMail, refreshAccounts, refreshUnread } = useMail()

/** 每页邮件条数（滚动加载分页） */
const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// 账号 / 文件夹
// ---------------------------------------------------------------------------
const loadingAccounts = ref(true)
const selectedAccountId = ref<number | null>(null)
const selectedMailboxId = ref<number | null>(null)
/** accountId → 文件夹列表（左栏角标与展开共用） */
const mailboxMap = ref<Map<number, MailboxInfo[]>>(new Map())
/** 正在同步的账号 id 列表 */
const syncing = ref<number[]>([])
const syncingAll = ref(false)

const mailboxes = computed<MailboxInfo[]>(() =>
  selectedAccountId.value ? (mailboxMap.value.get(selectedAccountId.value) ?? []) : []
)

/** 每账号未读总数（左栏角标） */
const unreadByAccount = computed<Record<number, number>>(() => {
  const m: Record<number, number> = {}
  for (const [accId, mbs] of mailboxMap.value) {
    m[accId] = mbs.reduce((n, mb) => n + mb.unread, 0)
  }
  return m
})

/** 拉取全部账号的文件夹列表 */
async function loadAllMailboxes(): Promise<void> {
  for (const acc of accounts.value) {
    mailboxMap.value.set(acc.id, await window.electronAPI.mail.getMailboxes(acc.id))
  }
}

/** 刷新单个账号的文件夹（未读角标/新文件夹） */
async function refreshMailboxes(accountId: number): Promise<void> {
  mailboxMap.value.set(accountId, await window.electronAPI.mail.getMailboxes(accountId))
}

async function selectAccount(acc: MailAccount): Promise<void> {
  selectedAccountId.value = acc.id
  if (!mailboxMap.value.has(acc.id)) {
    mailboxMap.value.set(acc.id, await window.electronAPI.mail.getMailboxes(acc.id))
  }
  const mbs = mailboxMap.value.get(acc.id) ?? []
  const first = mbs.find((mb) => mb.path.toUpperCase() === 'INBOX') ?? mbs[0]
  if (first) await selectMailbox(first)
  else {
    selectedMailboxId.value = null
    messages.value = []
    detail.value = null
  }
}

// ---------------------------------------------------------------------------
// 邮件列表（滚动分页）
// ---------------------------------------------------------------------------
const messages = ref<MailMessageSummary[]>([])
const hasMore = ref(false)
const loadingMessages = ref(false)
/** 当前已加载条数（下一页 offset） */
let messageOffset = 0

async function loadMessages(reset: boolean): Promise<void> {
  if (selectedMailboxId.value == null) return
  if (reset) {
    messageOffset = 0
    messages.value = []
  }
  loadingMessages.value = true
  try {
    const page = await window.electronAPI.mail.getMessages(selectedMailboxId.value, messageOffset, PAGE_SIZE)
    messages.value = reset ? page : [...messages.value, ...page]
    messageOffset += page.length
    hasMore.value = page.length === PAGE_SIZE
  } finally {
    loadingMessages.value = false
  }
}

async function loadMore(): Promise<void> {
  await loadMessages(false)
}

function onListScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160 && hasMore.value && !loadingMessages.value) {
    void loadMessages(false)
  }
}

async function selectMailbox(mb: MailboxInfo): Promise<void> {
  selectedMailboxId.value = mb.id
  selectedMessageId.value = null
  detail.value = null
  await loadMessages(true)
}

// ---------------------------------------------------------------------------
// 阅读窗
// ---------------------------------------------------------------------------
const selectedMessageId = ref<number | null>(null)
const detail = ref<MailMessageDetail | null>(null)
const detailLoading = ref(false)

async function selectMessage(msg: MailMessageSummary): Promise<void> {
  selectedMessageId.value = msg.id
  detail.value = null
  detailLoading.value = true
  try {
    const d = await window.electronAPI.mail.getMessageDetail(msg.id)
    detail.value = d
    if (d && !d.seen) {
      msg.seen = true
      void window.electronAPI.mail.markSeen(d.id, true)
      if (selectedAccountId.value != null) void refreshMailboxes(selectedAccountId.value)
    }
  } finally {
    detailLoading.value = false
  }
}

/** 标记已读/未读切换（阅读窗顶部） */
async function toggleSeen(): Promise<void> {
  if (!detail.value) return
  const next = !detail.value.seen
  detail.value.seen = next
  await window.electronAPI.mail.markSeen(detail.value.id, next)
  const m = messages.value.find((x) => x.id === detail.value!.id)
  if (m) m.seen = next
  if (selectedAccountId.value != null) await refreshMailboxes(selectedAccountId.value)
}

/** 把正文里的内嵌图片 `src="cid:xxx"` 改写为自定义协议 URL（指向本地邮件图片） */
function rewriteInlineImages(html: string): string {
  const list = detail.value?.attachments ?? []
  const cidMap = new Map<string, string>()
  const norm = (c: string): string => c.replace(/^<|>$/g, '').trim()
  for (const a of list) {
    if (!a.cid) continue
    cidMap.set(
      norm(a.cid),
      `prism-mail-attachment://${a.messageId}/${encodeURIComponent(a.filename)}`
    )
  }
  if (!cidMap.size) return html
  return html.replace(/src=["']cid:([^"']+)["']/gi, (m, cidValue: string) => {
    const url = cidMap.get(norm(cidValue))
    return url ? `src="${url}"` : m
  })
}

/** 正文安全渲染：dompurify 净化 + sandbox iframe + CSP 禁外部资源 */
const readerDoc = computed(() => {
  const html = detail.value?.htmlBody ?? ''
  if (!html) return ''
  const clean = DOMPurify.sanitize(rewriteInlineImages(html), {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'formaction', 'action', 'onerror', 'onload', 'onclick', 'onmouseover'],
    // 放行自定义的邮件内嵌图片协议（默认会拦截非标准 scheme）
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|prism-mail-attachment):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  })
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: prism-mail-attachment:; style-src 'unsafe-inline'">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:0;word-break:break-word;color:#1f1f1f;font-size:14px;line-height:1.7}img{max-width:100%;height:auto}</style>
</head><body>${clean}</body></html>`
})

/** 附件列表（排除内嵌图片） */
const visibleAttachments = computed<MailAttachment[]>(() =>
  (detail.value?.attachments ?? []).filter((a) => !a.cid)
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatFullTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 列表时间：今天仅显示时分；非今天（含昨天）带年份 YYYY-MM-DD HH:mm */
function formatMailTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (startOfDay === startOfToday) return hm
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

async function downloadAttachment(att: MailAttachment): Promise<void> {
  const r = await window.electronAPI.mail.downloadAttachment(att.id)
  if (r.ok) toast.success('附件已保存')
  else if (!r.canceled) toast.error(`下载失败：${r.error ?? '未知错误'}`)
}

async function openAttachment(att: MailAttachment): Promise<void> {
  const r = await window.electronAPI.mail.openAttachment(att.id)
  if (!r.ok) toast.error(`打开失败：${r.error ?? '未知错误'}`)
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------
async function syncAccount(accountId: number): Promise<void> {
  if (syncing.value.includes(accountId)) return
  syncing.value = [...syncing.value, accountId]
  try {
    const r = await window.electronAPI.mail.syncNow(accountId)
    if (Array.isArray(r)) return
    if (r.ok) {
      toast.success(r.newCount ? `同步完成，收到 ${r.newCount} 封新邮件` : '已是最新')
    } else {
      toast.error(`同步失败：${r.error ?? '未知错误'}`)
    }
  } finally {
    syncing.value = syncing.value.filter((id) => id !== accountId)
  }
}

async function syncAll(): Promise<void> {
  if (syncingAll.value) return
  syncingAll.value = true
  try {
    const r = await window.electronAPI.mail.syncNow()
    if (Array.isArray(r)) {
      const failed = r.filter((x) => !x.ok)
      const newTotal = r.reduce((n, x) => n + x.newCount, 0)
      if (failed.length) {
        toast.error(`${failed.length} 个账号同步失败：${failed[0].error ?? '未知错误'}`)
      } else {
        toast.success(newTotal ? `同步完成，收到 ${newTotal} 封新邮件` : '已是最新')
      }
    }
  } finally {
    syncingAll.value = false
  }
}

// ---------------------------------------------------------------------------
// 账号弹窗（添加/编辑/删除）
// ---------------------------------------------------------------------------
const accountDialogOpen = ref(false)
const editingAccount = ref<MailAccount | null>(null)
const form = ref({ name: '', email: '', host: '', port: 993, ssl: true, authCode: '' })
const formSaving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

const confirmRemoveOpen = ref(false)
const removeTarget = ref<MailAccount | null>(null)

function openAddDialog(): void {
  editingAccount.value = null
  form.value = { name: '', email: '', host: '', port: 993, ssl: true, authCode: '' }
  testResult.value = null
  accountDialogOpen.value = true
}

function openEditDialog(acc: MailAccount): void {
  editingAccount.value = acc
  form.value = { name: acc.name, email: acc.email, host: acc.host, port: acc.port, ssl: acc.ssl, authCode: '' }
  testResult.value = null
  accountDialogOpen.value = true
}

function toInput(): MailAccountInput {
  return {
    id: editingAccount.value?.id,
    name: form.value.name,
    email: form.value.email,
    host: form.value.host,
    port: Number(form.value.port),
    ssl: form.value.ssl,
    authCode: form.value.authCode
  }
}

async function testConnection(): Promise<void> {
  if (testing.value) return
  testing.value = true
  testResult.value = null
  try {
    const r = await window.electronAPI.mail.testConnection(toInput())
    testResult.value = r.ok ? { ok: true, message: '连接成功，IMAP 可用' } : { ok: false, message: r.error ?? '连接失败' }
  } finally {
    testing.value = false
  }
}

async function saveAccount(): Promise<void> {
  if (formSaving.value) return
  formSaving.value = true
  try {
    if (editingAccount.value) {
      const r = await window.electronAPI.mail.updateAccount(toInput())
      if (!r.ok) {
        toast.error(`保存失败：${r.error ?? '未知错误'}`)
        return
      }
      toast.success('账号已更新')
    } else {
      const r = await window.electronAPI.mail.addAccount(toInput())
      if (!r.ok) {
        toast.error(`添加失败：${r.error ?? '未知错误'}`)
        return
      }
      toast.success('账号已添加，开始收信')
    }
    accountDialogOpen.value = false
    await refreshAll()
  } finally {
    formSaving.value = false
  }
}

function confirmRemove(acc: MailAccount): void {
  removeTarget.value = acc
  confirmRemoveOpen.value = true
}

async function removeAccount(): Promise<void> {
  const target = removeTarget.value
  if (!target) return
  const r = await window.electronAPI.mail.removeAccount(target.id)
  if (r.ok) {
    toast.success('账号已删除')
    confirmRemoveOpen.value = false
    if (selectedAccountId.value === target.id) {
      selectedAccountId.value = null
      selectedMailboxId.value = null
      messages.value = []
      detail.value = null
    }
    await refreshAll()
  } else {
    toast.error(`删除失败：${r.error ?? '未知错误'}`)
  }
}

// ---------------------------------------------------------------------------
// 全量刷新（增删改账号 / reShow 兜底）
// ---------------------------------------------------------------------------
async function refreshAll(): Promise<void> {
  await refreshAccounts()
  await loadAllMailboxes()
  await refreshUnread()
  if (selectedAccountId.value && !accounts.value.some((a) => a.id === selectedAccountId.value)) {
    selectedAccountId.value = null
    selectedMailboxId.value = null
    messages.value = []
    detail.value = null
  }
  if (selectedAccountId.value == null && accounts.value.length) {
    await selectAccount(accounts.value[0])
  } else if (selectedMailboxId.value) {
    await loadMessages(true)
  }
}

/** 同步广播回调：刷新对应账号文件夹；新邮件且正在看该账号时刷新当前列表 */
async function onMailSynced(result: MailSyncResult): Promise<void> {
  if (mailboxMap.value.has(result.accountId)) {
    await refreshMailboxes(result.accountId)
  }
  if (result.newCount > 0 && result.accountId === selectedAccountId.value) {
    await loadMessages(true)
  }
}

onMounted(async () => {
  initMail()
  subscribeOnUnmounted(() =>
    window.electronAPI.mail.onMailSync((result) => {
      void onMailSynced(result)
    })
  )
  // 窗口重显兜底刷新（隐藏期间的同步广播被 onlyVisible 跳过）
  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', () => {
      void refreshAll()
    })
  )
  await refreshAccounts()
  await loadAllMailboxes()
  await refreshUnread()
  loadingAccounts.value = false
  if (accounts.value.length) {
    await selectAccount(accounts.value[0])
  }
})
</script>

<style scoped>
.mail {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--sp-4);
  gap: var(--sp-3);
  overflow: hidden;
}

.mail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-shrink: 0;
}

.mail-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
}

.mail-header__actions {
  display: flex;
  gap: var(--sp-2);
}

.mail-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px 320px 1fr;
  gap: var(--sp-3);
}

.pane {
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.pane--accounts {
  overflow-y: auto;
}

.pane-loading,
.pane-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

/* ── 左栏：账号 ── */
.accounts {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2);
}

.account {
  padding: var(--sp-3);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft);
}

.account:hover {
  background: var(--bg-hover);
}

.account.is-selected {
  background: var(--bg-selected-subtle);
  border-color: var(--brand);
}

.account__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.account__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account__badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  background: var(--brand);
  color: var(--text-on-primary);
  font-size: 11px;
  font-weight: 600;
}

.account__sync {
  color: var(--text-muted);
}

.account__email {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account__actions {
  display: none;
  gap: var(--sp-1);
  margin-top: var(--sp-2);
}

.account:hover .account__actions,
.account.is-selected .account__actions {
  display: flex;
}

.account-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.account-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.account-btn--danger:hover {
  background: var(--danger-bg);
  color: var(--text-on-primary);
}

.account__mailboxes {
  margin-top: var(--sp-2);
  margin-left: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 1px solid var(--border);
  padding-left: var(--sp-2);
}

.mailbox {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: 6px var(--sp-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.mailbox:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mailbox.is-selected {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
  font-weight: 600;
}

.mailbox__name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mailbox__unread {
  color: var(--brand);
  font-size: 11px;
  font-weight: 600;
}

/* ── 中栏：邮件列表 ── */
.msg-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.msg-list__inner {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-2);
}

.msg {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.msg:hover {
  background: var(--bg-hover);
}

.msg.is-unread {
  color: var(--text-primary);
}

.msg.is-unread .msg__from,
.msg.is-unread .msg__subject {
  font-weight: 600;
}

.msg.is-selected {
  background: var(--bg-selected-subtle);
}

/* 未读圆点 */
.msg.is-unread::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand);
}

.msg__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.msg__from {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msg__time {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.msg__subject {
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msg__att {
  position: absolute;
  right: 8px;
  bottom: 6px;
  color: var(--text-muted);
  display: flex;
}

.msg-list__more {
  padding: var(--sp-2);
}

.msg-list__more-btn {
  width: 100%;
  height: 32px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.msg-list__more-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── 右栏：阅读窗 ── */
.reader {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.reader__head {
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.reader__subject-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.reader__subject {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  word-break: break-word;
}

.reader__seen-toggle {
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.reader__seen-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.reader__meta {
  margin-top: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-secondary);
}

.reader__from {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}

.reader__from-name {
  font-weight: 600;
  color: var(--text-primary);
}

.reader__from-addr {
  color: var(--text-muted);
}

.reader__date {
  color: var(--text-muted);
  font-size: 11px;
}

.reader__body {
  flex: 1;
  min-height: 120px;
  padding: var(--sp-4) var(--sp-5);
}

.reader__iframe {
  width: 100%;
  height: 100%;
  min-height: 260px;
  border: none;
  background: #fff;
  border-radius: var(--radius-sm);
}

.reader__text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
}

.reader__empty {
  color: var(--text-muted);
  font-size: 13px;
}

.reader__atts {
  flex-shrink: 0;
  padding: 0 var(--sp-5) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.reader__atts-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.reader__att {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.reader__att-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.reader__att-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reader__att-size {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.reader__att-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.reader__att-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── 账号表单 ── */
.acc-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.acc-form__grid {
  display: grid;
  grid-template-columns: 1fr 96px;
  gap: var(--sp-3);
}

.acc-form__row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.acc-form__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.acc-form__ssl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.acc-form__hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.acc-form__test {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.acc-form__test--ok {
  background: color-mix(in srgb, var(--success, #16a34a) 12%, transparent);
  color: var(--success, #16a34a);
}

.acc-form__test--fail {
  background: var(--danger-bg);
  color: var(--text-on-primary);
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.is-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
