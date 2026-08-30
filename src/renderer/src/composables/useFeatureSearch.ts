/**
 * 功能搜索（命令面板）打开状态 —— 模块级单例，仿 useToast。
 * 主页入口卡与 App.vue 的 Ctrl+K 快捷键共用同一状态。
 */
import { ref } from 'vue'

/** 命令面板是否打开 */
const isOpen = ref(false)

export function useFeatureSearch() {
  return {
    isOpen,
    open: () => {
      isOpen.value = true
    },
    close: () => {
      isOpen.value = false
    },
    toggle: () => {
      isOpen.value = !isOpen.value
    }
  }
}
