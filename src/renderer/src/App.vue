<template>
  <div
    class="app-shell"
    :class="{ 'is-exiting': exiting }"
    ref="shellRef"
    @animationend="onAnimationEnd"
  >
    <header class="titlebar drag-region">
      <div class="titlebar-brand">
        <span class="brand-dot"></span>
        <span class="titlebar-title">Prism <span class="titlebar-version">v{{ version }}</span></span>
      </div>
      <div class="titlebar-actions no-drag">
        <button class="tb-btn" title="最小化" @click="minimize">
          <Minus :size="15" :stroke-width="1.75" />
        </button>
        <button class="tb-btn" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximize">
          <Square v-if="!isMaximized" :size="13" :stroke-width="1.75" />
          <Minimize2 v-else :size="13" :stroke-width="1.75" />
        </button>
        <button class="tb-btn tb-close" title="隐藏" @click="hideWindow">
          <X :size="15" :stroke-width="1.75" />
        </button>
      </div>
    </header>

    <main class="app-content">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Minus, X, Square, Minimize2 } from '@lucide/vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'

const router = useRouter()
const exiting = ref(false)
const version = ref('')
const isMaximized = ref(false)
const shellRef = ref<HTMLElement | null>(null)

/** 入场：窗口 mount / reShow 时由渲染端触发，播 page-enter 动画 */
function playEnter(): void {
  const el = shellRef.value
  if (!el) return
  exiting.value = false
  el.classList.remove('page-enter', 'page-exit')
  void el.offsetWidth // 强制 reflow，保证重复显示时动画能重新播放
  el.classList.add('page-enter')
}

/** 出场：收到 startHide 后切 page-exit，播完（animationend）再通知主进程隐藏 */
function playExit(): void {
  const el = shellRef.value
  if (!el || exiting.value) return
  exiting.value = true
  el.classList.add('page-exit')
}

function onAnimationEnd(e: AnimationEvent): void {
  const el = shellRef.value
  if (!el) return
  if (e.animationName === 'page-enter') {
    el.classList.remove('page-enter')
  } else if (e.animationName === 'page-exit') {
    window.electronAPI.window.hideAfterAnimation()
  }
}

function minimize(): void {
  window.electronAPI.window.minimize()
}

function toggleMaximize(): void {
  window.electronAPI.window.toggleMaximize()
}

function hideWindow(): void {
  playExit()
}

onMounted(() => {
  window.electronAPI.window.notifyReady()

  // 应用持久化的主题（启动时）
  void window.electronAPI.settings.get().then((s) => {
    document.documentElement.dataset.theme = s.theme
  })

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onSetPage((p) => {
      if (p.page) router.push(`/mainPage/${p.page}`)
    })
  )

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('startHide', playExit)
  )

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', playEnter)
  )

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onVersion((v) => {
      version.value = v
    })
  )

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onMaximizeState((max) => {
      isMaximized.value = max
    })
  )

  playEnter()
})
</script>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--page-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.app-shell.is-exiting {
  animation: page-exit var(--duration-base) var(--ease-out-soft) forwards;
  pointer-events: none;
}

.titlebar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-3) 0 var(--sp-4);
  background: transparent;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.brand-dot {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-pill);
  background: var(--brand);
}

.titlebar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.titlebar-version {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: var(--sp-2);
}

.titlebar-actions {
  display: flex;
  gap: 2px;
}

.tb-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.tb-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tb-close:hover {
  background: rgba(229, 72, 77, 0.12);
  color: var(--danger);
}

.app-content {
  flex: 1;
  min-height: 0;
}
</style>
