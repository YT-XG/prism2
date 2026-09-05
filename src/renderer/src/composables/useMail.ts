/**
 * 邮箱大师状态管理 —— 模块级单例 composable（侧栏角标 + 邮箱大师页共用）。
 *
 * - unread / accounts / loaded 为共享状态：邮箱大师页、侧栏角标各自读取。
 * - init() 幂等订阅 onMailUnreadChanged / onMailSync 广播：
 *   未读变化直接刷新角标；同步完成且产生新邮件（或尚未拉取过）时刷新账号列表。
 * - MainPage / Mail 在 mount / reShow 时 refreshUnread 兜底（主窗口隐藏期间不广播）。
 */
import { ref } from 'vue'
import type { MailAccount, MailSyncingInfo } from '@preload/ipc'

const unread = ref(0)
const accounts = ref<MailAccount[]>([])
/** 正在同步中的账号列表（标题栏「同步中」指示共用） */
const syncing = ref<MailSyncingInfo[]>([])
/** 是否已从主进程拉取过账号（决定 onMailSync 时是否顺带刷新账号） */
const loaded = ref(false)

/** 是否已注册广播订阅（模块级单例只注册一次） */
let subscribed = false

/** 订阅未读/同步/同步中广播（幂等，需在组件 setup 内调用） */
function init(): void {
  if (subscribed) return
  subscribed = true
  window.electronAPI.mail.onMailUnreadChanged((total) => {
    unread.value = total
  })
  window.electronAPI.mail.onMailSync((result) => {
    if (result.newCount > 0 || !loaded.value) {
      void refreshAccounts()
    }
  })
  window.electronAPI.mail.onMailSyncingChanged((list) => {
    syncing.value = list
  })
}

/** 刷新账号列表 */
async function refreshAccounts(): Promise<void> {
  accounts.value = await window.electronAPI.mail.getAccounts()
  loaded.value = true
}

/** 仅刷新未读总数（侧栏角标/重显兜底用） */
async function refreshUnread(): Promise<void> {
  unread.value = await window.electronAPI.mail.getUnreadTotal()
}

/** 刷新同步中状态（窗口重显兜底用：隐藏期间同步状态广播被跳过） */
async function refreshSyncing(): Promise<void> {
  syncing.value = await window.electronAPI.mail.getSyncing()
}

export function useMail() {
  return { unread, accounts, syncing, loaded, init, refreshAccounts, refreshUnread, refreshSyncing }
}
