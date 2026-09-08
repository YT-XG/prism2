/**
 * 通知浮窗状态管理 —— 模块级单例 composable（仅通知浮窗窗口 NotificationPopup 使用）。
 *
 * - 订阅 onNew 广播，把新通知压入卡片栈（上限 MAX_POPUPS，超限丢弃最旧）。
 * - 普通卡片 POPUP_DURATION 后自动消失；悬停暂停、移开按剩余时长续走；邮件通知长时悬停不自动消失，
 *   等用户点击或点「已读」收起。
 * - 卡片点击：剪贴板类（仅浮窗、不入中心）跳剪贴板历史；邮件类跳邮箱大师并标记已读；其余标记已读 + 跳通知中心。
 * - 内容高度变化时上报主进程缩放窗口（按显示位置锚定）。
 */
import { ref, nextTick } from 'vue'
import type { NotificationItem, NotificationPopupPosition } from '@preload/ipc'
import { subscribeOnUnmounted } from './useIpcListener'

/** 普通卡片展示时长（ms）；邮件通知不自动消失 */
const POPUP_DURATION = 4000
/** 卡片栈上限：超出丢弃最旧（浮窗高度有界） */
const MAX_POPUPS = 4
/** 离场动画后再隐藏/缩放，避免窗口先于动画收缩而裁切 */
const LEAVE_MS = 200

const popups = ref<NotificationItem[]>([])
/** 浮窗显示位置（跟随主进程每次投递上报；顶部居中时切换动画方向） */
const position = ref<NotificationPopupPosition>('bottom-right')

/** 单条卡片的自动消失调度：记录剩余毫秒，悬停暂停 / 移开续走（避免一悬停就重置为全时长） */
interface DismissTimer {
  timer: ReturnType<typeof setTimeout>
  remaining: number
  lastStartedAt: number
}
const dismissTimers = new Map<number, DismissTimer>()

/** 订阅新通知到达（需在组件 setup 内调用，卸载自动清理） */
function init(): void {
  subscribeOnUnmounted(() =>
    window.electronAPI.notification.onNew((payload) => {
      position.value = payload.position
      push(payload.item)
    })
  )
  // 订阅完成后上报主进程：浮窗渲染端已就绪，主进程可补发就绪前暂存的通知（防首条复制通知丢失）
  window.electronAPI.window.notificationPopupReady()
}

/** 入卡片栈；邮件通知长时悬停（不排自动消失），其余按 POPUP_DURATION 自动消失 */
function push(item: NotificationItem): void {
  if (popups.value.some((p) => p.id === item.id)) return
  popups.value = [...popups.value, item].slice(-MAX_POPUPS)
  if (item.source !== 'mail') {
    dismissTimers.set(item.id, {
      timer: setTimeout(() => dismiss(item.id), POPUP_DURATION),
      remaining: POPUP_DURATION,
      lastStartedAt: Date.now()
    })
  }
  void resize()
}

/** 移除卡片（定时器触发或用户点关闭/已读） */
function dismiss(id: number): void {
  const t = dismissTimers.get(id)
  if (t) {
    clearTimeout(t.timer)
    dismissTimers.delete(id)
  }
  popups.value = popups.value.filter((p) => p.id !== id)
  setTimeout(() => {
    resize()
    if (!popups.value.length) window.electronAPI.window.notificationPopupHide()
  }, LEAVE_MS)
}

/** 悬停暂停自动消失（记录剩余时长；邮件通知无定时器，此调用为空操作） */
function pause(id: number): void {
  const t = dismissTimers.get(id)
  if (!t) return
  clearTimeout(t.timer)
  t.remaining = Math.max(0, t.remaining - (Date.now() - t.lastStartedAt))
}

/** 移开恢复自动消失：按剩余时长续走，不重置为全时长 */
function resume(id: number): void {
  const t = dismissTimers.get(id)
  if (!t || t.remaining <= 0) return
  t.lastStartedAt = Date.now()
  t.timer = setTimeout(() => dismiss(id), t.remaining)
}

/** 按来源跳转目标页 */
function pageFor(source: NotificationItem['source']): string {
  if (source === 'mail') return 'mail'
  if (source === 'clipboard') return 'clipboard'
  return 'notifications'
}

/** 卡片点击：跳转对应页面；持久化通知标记已读并收起，剪贴板类仅跳转 */
function open(id: number): void {
  const item = popups.value.find((p) => p.id === id)
  dismiss(id)
  void markRead(item)
  window.electronAPI.window.showPage(pageFor(item?.source ?? 'clipboard'))
}

/** 「已读」按钮：标记已读 + 仅收起浮窗（不跳转） */
function markReadAndDismiss(id: number): void {
  const item = popups.value.find((p) => p.id === id)
  dismiss(id)
  void markRead(item)
}

/** 持久化通知（非剪贴板瞬时类）标记已读 */
function markRead(item: NotificationItem | undefined): void {
  if (item && item.source !== 'clipboard') void window.electronAPI.notification.markRead(item.id)
}

/** 上报内容高度给主进程缩放浮窗 */
async function resize(): Promise<void> {
  await nextTick()
  const el = document.getElementById('notif-popup')
  window.electronAPI.window.notificationPopupResize(el?.offsetHeight ?? 0)
}

export function useNotificationPopups() {
  return { popups, position, init, dismiss, open, markReadAndDismiss, pause, resume }
}
