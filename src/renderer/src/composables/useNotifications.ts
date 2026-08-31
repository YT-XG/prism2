/**
 * 通知中心状态管理 —— 模块级单例 composable（主窗口：通知中心页 + 侧栏角标）。
 *
 * - items / unread / loaded 为共享状态：通知中心页、侧栏角标各自读取。
 * - init() 订阅 onNew 广播 → 刷新未读（已加载列表则同步刷新列表）。
 *   瞬时卡片的展示已统一移至自绘通知浮窗窗口（NotificationPopup），此处不再管理卡片栈。
 * - MainPage 在 mount / reShow 时 refreshUnread 兜底（主窗口隐藏期间不广播，重新显示后补齐）。
 */
import { ref } from 'vue'
import type { NotificationItem } from '@preload/ipc'
import { subscribeOnUnmounted } from './useIpcListener'

const items = ref<NotificationItem[]>([])
const unread = ref(0)
/** 是否已从主进程拉取过列表（用于决定 onNew 时是否顺带刷新列表） */
const loaded = ref(false)

/** 订阅新通知到达：刷新未读（已加载列表则同步刷新）。需在组件 setup 内调用。 */
function init(): void {
  subscribeOnUnmounted(() =>
    window.electronAPI.notification.onNew((payload) => {
      unread.value = payload.unread
      if (loaded.value) {
        void refresh()
      }
    })
  )
}

/** 全量刷新（列表 + 未读），通知中心页使用 */
async function refresh(): Promise<void> {
  const [list, n] = await Promise.all([
    window.electronAPI.notification.getList(),
    window.electronAPI.notification.getUnread()
  ])
  items.value = list
  unread.value = n
  loaded.value = true
}

/** 仅刷新未读数（侧栏角标/重显兜底用） */
async function refreshUnread(): Promise<void> {
  unread.value = await window.electronAPI.notification.getUnread()
}

async function markRead(id: number): Promise<void> {
  await window.electronAPI.notification.markRead(id)
  await refresh()
}

async function markAllRead(): Promise<void> {
  await window.electronAPI.notification.markAllRead()
  await refresh()
}

async function clear(): Promise<void> {
  await window.electronAPI.notification.clear()
  await refresh()
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 时间格式化：今天 HH:mm / 昨天 HH:mm / MM-DD HH:mm（不引第三方库） */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (startOfDay === startOfToday) return hm
  if (startOfDay === startOfToday - 86_400_000) return `昨天 ${hm}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

export function useNotifications() {
  return {
    items,
    unread,
    loaded,
    init,
    refresh,
    refreshUnread,
    markRead,
    markAllRead,
    clear
  }
}
