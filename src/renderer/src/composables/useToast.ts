/**
 * 全局轻提示 —— 统一经全局状态中心（useStatusCenter）呈现于标题栏状态区。
 * 保留原 useToast API：success / error / info / show + dismiss，所有视图调用不变。
 */
import type { Component } from 'vue'
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from '@lucide/vue'
import { useStatusCenter, type StatusTone } from './useStatusCenter'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

/** 各类型展示时长（ms）：error 适当延长便于阅读 */
const DURATION: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warning: 3500,
  error: 4500
}

const TONE: Record<ToastType, StatusTone> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  error: 'error'
}

const ICON: Record<ToastType, Component> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle
}

export function useToast() {
  const { push, dismiss } = useStatusCenter()
  return {
    dismiss,
    show: (message: string, type: ToastType = 'info') =>
      push({ tone: TONE[type], icon: ICON[type], text: message, dismissMs: DURATION[type] }),
    success: (message: string) =>
      push({ tone: TONE.success, icon: ICON.success, text: message, dismissMs: DURATION.success }),
    error: (message: string) =>
      push({ tone: TONE.error, icon: ICON.error, text: message, dismissMs: DURATION.error }),
    info: (message: string) =>
      push({ tone: TONE.info, icon: ICON.info, text: message, dismissMs: DURATION.info })
  }
}
