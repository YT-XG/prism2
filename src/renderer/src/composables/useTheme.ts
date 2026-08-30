/**
 * 主题应用（renderer 端唯一入口）。
 *
 * 切换主题时会给 <html> 临时挂上 .theme-transition-off，关闭全局 CSS transition，
 * 避免 --brand 等 token 变更被 transition 动画化——否则激活态/主题按钮会从旧色
 * 扫动到新色（如设置页主题按钮「从浅色闪到白绿」）。
 */
let restoreTimer: ReturnType<typeof setTimeout> | null = null

export function applyTheme(theme: string): void {
  const root = document.documentElement
  root.classList.add('theme-transition-off')
  root.dataset.theme = theme
  if (restoreTimer) clearTimeout(restoreTimer)
  // 覆盖 --duration-base 后再恢复，避免连续切换时提前恢复
  restoreTimer = setTimeout(() => root.classList.remove('theme-transition-off'), 260)
}
