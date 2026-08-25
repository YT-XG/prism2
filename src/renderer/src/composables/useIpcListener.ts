/**
 * 监听器生命周期工具：注册即返回清理函数的模式，卸载时自动清理。
 * @param register - 返回一个 `() => void` 的清理函数（对应 preload 各 onXxx 的返回值）
 */
import { onUnmounted } from 'vue'

export function subscribeOnUnmounted(register: () => (() => void) | undefined): void {
  const cleanup = register()
  onUnmounted(() => cleanup?.())
}
