/**
 * 通知浮窗状态管理 —— 模块级单例 composable（仅通知浮窗窗口 NotificationPopup 使用）。
 *
 * - 订阅 onNew 广播，把新通知压入卡片栈（上限 MAX_POPUPS，超限丢弃最旧）。
 * - 普通卡片 POPUP_DURATION 后自动消失；邮件通知长时悬停不自动消失，等用户点击或点「已读」收起。
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
/** 每条卡片的自动消失定时器（按 id） */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

/** 订阅新通知到达（需在组件 setup 内调用，卸载自动清理） */
function init(): void {
  subscribeOnUnmounted(() =>
    window.electronAPI.notification.onNew((payload) => {
      position.value = payload.position
      push(payload.item)
    })
  )
}

/** 入卡片栈；邮件通知长时悬停（不排自动消失），其余按 POPUP_DURATION 自动消失 */
function push(item: NotificationItem): void {
  if (popups.value.some((p) => p.id === item.id)) return
  popups.value = [...popups.value, item].slice(-MAX_POPUPS)
  if (item.source !== 'mail') {
    timers.set(
      item.id,
      setTimeout(() => dismiss(item.id), POPUP_DURATION)
    )
  }
  void resize()
}

/** 移除卡片（定时器触发或用户点关闭/已读） */
function dismiss(id: number): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
  popups.value = popups.value.filter((p) => p.id !== id)
  setTimeout(() => {
    resize()
    if (!popups.value.length) window.electronAPI.window.notificationPopupHide()
  }, LEAVE_MS)
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
  return { popups, position, init, dismiss, open, markReadAndDismiss }
}
