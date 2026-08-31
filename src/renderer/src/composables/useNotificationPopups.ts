/**
 * 通知浮窗状态管理 —— 模块级单例 composable（仅通知浮窗窗口 NotificationPopup 使用）。
 *
 * - 订阅 onNew 广播，把新通知压入卡片栈（上限 MAX_POPUPS，超限丢弃最旧）。
 * - 每条卡片约 POPUP_DURATION 后自动消失；全部消失后请求主进程隐藏浮窗。
 * - 卡片点击：剪贴板类（仅浮窗、不入中心）跳剪贴板历史；其余标记已读 + 唤起主窗口跳转通知中心（后续可扩展链接/翻译等按钮动作）。
 * - 内容高度变化时上报主进程缩放窗口（保持右下角锚定）。
 */
import { ref, nextTick } from 'vue'
import type { NotificationItem } from '@preload/ipc'
import { subscribeOnUnmounted } from './useIpcListener'

/** 单条卡片展示时长（ms） */
const POPUP_DURATION = 4000
/** 卡片栈上限：超出丢弃最旧（浮窗高度有界） */
const MAX_POPUPS = 4
/** 离场动画后再隐藏/缩放，避免窗口先于动画收缩而裁切 */
const LEAVE_MS = 200

const popups = ref<NotificationItem[]>([])
/** 每条卡片的自动消失定时器（按 id） */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

/** 订阅新通知到达（需在组件 setup 内调用，卸载自动清理） */
function init(): void {
  subscribeOnUnmounted(() =>
    window.electronAPI.notification.onNew((payload) => {
      push(payload.item)
    })
  )
}

/** 入卡片栈 + 启动自动消失计时（按 id 去重） */
function push(item: NotificationItem): void {
  if (popups.value.some((p) => p.id === item.id)) return
  popups.value = [...popups.value, item].slice(-MAX_POPUPS)
  timers.set(
    item.id,
    setTimeout(() => dismiss(item.id), POPUP_DURATION)
  )
  void resize()
}

/** 移除卡片（定时器触发或用户点关闭） */
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

/** 卡片点击：剪贴板类（仅浮窗展示、不入通知中心）直接跳剪贴板历史；其余标记已读 + 跳通知中心 */
function open(id: number): void {
  const item = popups.value.find((p) => p.id === id)
  dismiss(id)
  const toCenter = item?.source !== 'clipboard'
  if (toCenter) void window.electronAPI.notification.markRead(id)
  window.electronAPI.window.showPage(toCenter ? 'notifications' : 'clipboard')
}

/** 上报内容高度给主进程缩放浮窗 */
async function resize(): Promise<void> {
  await nextTick()
  const el = document.getElementById('notif-popup')
  window.electronAPI.window.notificationPopupResize(el?.offsetHeight ?? 0)
}

export function useNotificationPopups() {
  return { popups, init, dismiss, open }
}
