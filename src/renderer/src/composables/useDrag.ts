/**
 * 通用拖拽组合式函数（pointer events，无依赖）
 *
 * 用于主页画布内的可拖拽 widget（合并记录框 / 贴到主页的便利贴卡）：
 * - 绑定到拖拽手柄的 pointerdown → 跟随指针移动 → 松开回调持久化。
 * - 移动与 window resize 时钳制在画布可视区内（画布需 position: relative）。
 * - 卸载时自动清理全局监听。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/** 判定为「拖动」而非「点击」的位移阈值（px） */
const MOVE_THRESHOLD_PX = 4

export interface UseDragOptions {
  /** 画布容器（用于边界钳制），取 clientWidth/clientHeight */
  container: () => HTMLElement | null
  /** 被拖拽元素（钳制时减去自身尺寸，避免整体拖出画布） */
  element: () => HTMLElement | null
  /** 初始位置（px） */
  initial: () => { x: number; y: number }
  /** 拖拽结束（松开）回调：moved=false 表示只是点击（未产生位移），用于区分点击/拖动 */
  onEnd: (pos: { x: number; y: number }, moved: boolean) => void
  /** 拖拽中的位置回调（可选） */
  onMove?: (pos: { x: number; y: number }) => void
}

export function useDrag(opts: UseDragOptions): {
  x: Ref<number>
  y: Ref<number>
  dragging: Ref<boolean>
  startDrag: (e: PointerEvent) => void
  /** 重新钳制到画布内（窗口缩放 / reShow 时调用） */
  clamp: () => void
} {
  const x = ref(opts.initial().x)
  const y = ref(opts.initial().y)
  const dragging = ref(false)

  /** 指针起点与元素位置之差，用于保持抓取点不跳动 */
  let offsetX = 0
  let offsetY = 0
  /** 本次按下是否产生了位移（用于区分点击/拖动） */
  let moved = false
  let startClientX = 0
  let startClientY = 0

  function clampToContainer(posX: number, posY: number): { x: number; y: number } {
    const c = opts.container()
    if (!c) return { x: posX, y: posY }
    const maxX = Math.max(0, c.clientWidth - (opts.element()?.offsetWidth ?? 0))
    const maxY = Math.max(0, c.clientHeight - (opts.element()?.offsetHeight ?? 0))
    return {
      x: Math.min(maxX, Math.max(0, posX)),
      y: Math.min(maxY, Math.max(0, posY))
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (
      !moved &&
      (Math.abs(e.clientX - startClientX) > MOVE_THRESHOLD_PX ||
        Math.abs(e.clientY - startClientY) > MOVE_THRESHOLD_PX)
    ) {
      moved = true
    }
    const clamped = clampToContainer(e.clientX - offsetX, e.clientY - offsetY)
    x.value = clamped.x
    y.value = clamped.y
    opts.onMove?.(clamped)
  }

  function onPointerUp(e: PointerEvent): void {
    ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    dragging.value = false
    opts.onEnd({ x: x.value, y: y.value }, moved)
    moved = false
  }

  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    startClientX = e.clientX
    startClientY = e.clientY
    offsetX = e.clientX - x.value
    offsetY = e.clientY - y.value
    moved = false
    dragging.value = true
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function clamp(): void {
    const clamped = clampToContainer(x.value, y.value)
    x.value = clamped.x
    y.value = clamped.y
  }

  onMounted(() => {
    window.addEventListener('resize', clamp)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', clamp)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  })

  return { x, y, dragging, startDrag, clamp }
}
