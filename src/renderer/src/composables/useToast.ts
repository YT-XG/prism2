import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
}

/** 模块级单例：所有视图共享同一份 toast 列表（UiToast.vue 负责渲染） */
const toasts = ref<ToastItem[]>([])

let nextId = 1

/** 默认展示时长（ms），error 适当延长便于阅读 */
const DURATION: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  error: 4500
}

function push(message: string, type: ToastType): void {
  const id = nextId++
  toasts.value.push({ id, message, type })
  setTimeout(() => dismiss(id), DURATION[type])
}

export function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

export function useToast() {
  return {
    toasts,
    dismiss,
    show: (message: string, type: ToastType = 'info') => push(message, type),
    success: (message: string) => push(message, 'success'),
    error: (message: string) => push(message, 'error'),
    info: (message: string) => push(message, 'info')
  }
}
