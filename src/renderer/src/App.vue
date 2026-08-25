<template>
  <div class="app-shell" :class="{ 'is-exiting': exiting }">
    <header class="titlebar drag-region">
      <div class="titlebar-brand">
        <span class="brand-dot"></span>
        <span class="titlebar-title">Prism</span>
      </div>
      <div class="titlebar-actions no-drag">
        <button class="tb-btn" title="最小化" @click="minimize">
          <Minus :size="15" :stroke-width="1.75" />
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
import { Minus, X } from '@lucide/vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'

const router = useRouter()
const exiting = ref(false)

function minimize(): void {
  window.electronAPI.window.minimize()
}

function hideWindow(): void {
  playExit()
}

function playExit(): void {
  exiting.value = true
  setTimeout(() => window.electronAPI.window.hideAfterAnimation(), 320)
}

onMounted(() => {
  window.electronAPI.window.notifyReady()

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onSetPage((p) => {
      if (p.page) router.push(`/mainPage/${p.page}`)
    })
  )

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('startHide', playExit)
  )

  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', () => {
      exiting.value = false
    })
  )
})
</script>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  transition: opacity var(--duration-base) var(--ease-out-soft),
    transform var(--duration-base) var(--ease-out-soft);
}

.app-shell.is-exiting {
  opacity: 0;
  transform: translateY(6px);
}

.titlebar {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-3) 0 var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
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
