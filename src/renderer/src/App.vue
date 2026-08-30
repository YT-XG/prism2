<template>
  <div
    class="app-shell"
    :class="{ 'is-exiting': exiting }"
    ref="shellRef"
    @animationend="onAnimationEnd"
  >
    <header v-if="!isQuickPaste" class="titlebar drag-region">
      <div class="titlebar-brand">
        <span class="brand-dot"></span>
        <span class="titlebar-title">Prism <span class="titlebar-version">v{{ version }}</span></span>
      </div>

      <!-- 居中工具栏：功能搜索 + 主页显示设置 -->
      <div ref="centerRef" class="titlebar-center no-drag">
        <button class="tb-tool" title="功能搜索 (Ctrl+K)" @click="openFeatureSearch">
          <Command :size="14" :stroke-width="1.75" /> 功能搜索
        </button>
        <button
          class="tb-tool"
          :class="{ 'is-active': showModules }"
          title="主页显示设置"
          @click="showModules = !showModules"
        >
          <LayoutGrid :size="14" :stroke-width="1.75" /> 显示
        </button>

        <Transition name="pop">
          <div v-if="showModules" class="module-pop" role="menu" aria-label="主页显示设置">
            <div class="module-pop__title">主页显示</div>
            <div v-for="def in moduleDefs" :key="def.key" class="module-pop__item">
              <span class="module-pop__label">{{ def.label }}</span>
              <UiSwitch
                :model-value="modules[def.key]"
                @update:model-value="(v: boolean) => setModule(def.key, v)"
              />
            </div>
          </div>
        </Transition>
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
      <Transition name="route" mode="out-in">
        <RouterView />
      </Transition>
    </main>

    <!-- 功能搜索命令面板：仅主界面可见（快捷粘贴小窗不挂载） -->
    <FeatureSearchPanel v-if="!isQuickPaste" />

    <UiToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Minus, X, Square, Minimize2, Command, LayoutGrid } from '@lucide/vue'
import UiToast from '@renderer/components/ui/UiToast.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import FeatureSearchPanel from '@renderer/components/FeatureSearchPanel.vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import { useFeatureSearch } from '@renderer/composables/useFeatureSearch'
import { useHomeModules, type HomeModuleDef } from '@renderer/composables/useHomeModules'
import { applyTheme } from '@renderer/composables/useTheme'

const router = useRouter()
const route = useRoute()
const exiting = ref(false)
const version = ref('')
const isMaximized = ref(false)
const shellRef = ref<HTMLElement | null>(null)
const { open: openFeatureSearch, toggle } = useFeatureSearch()

/** 主页显示设置面板：开关 + 模块清单 */
const showModules = ref(false)
const centerRef = ref<HTMLElement | null>(null)
const { modules, setModule } = useHomeModules()
const moduleDefs: HomeModuleDef[] = [{ key: 'compactClipboard', label: '精简剪贴板' }]

/** 点击面板外区域关闭「显示」面板 */
function onDocPointerDown(e: PointerEvent): void {
  if (!showModules.value) return
  const target = e.target as Node
  if (centerRef.value && !centerRef.value.contains(target)) showModules.value = false
}

/** 快捷粘贴窗口：无标题栏的轻量视图 */
const isQuickPaste = computed(() => route.path.startsWith('/quickPaste'))

/** Ctrl+K / Cmd+K：呼出/关闭功能搜索命令面板；Esc：关闭主页显示面板 */
function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    toggle()
    return
  }
  if (e.key === 'Escape') showModules.value = false
}

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

  window.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('pointerdown', onDocPointerDown)

  // 应用持久化的主题（启动时）
  void window.electronAPI.settings.get().then((s) => {
    applyTheme(s.theme)
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

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('pointerdown', onDocPointerDown)
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
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 var(--sp-3) 0 var(--sp-4);
  background: transparent;
}

.titlebar-brand {
  justify-self: start;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* 居中工具栏（功能搜索 + 显示），弹层相对其定位 */
.titlebar-center {
  justify-self: center;
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.tb-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.tb-tool:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tb-tool.is-active {
  background: var(--bg-selected-subtle);
  color: var(--brand);
}

/* 主页显示设置弹层 */
.module-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 100;
  min-width: 180px;
  padding: var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
}

.module-pop__title {
  padding: var(--sp-1) var(--sp-3) var(--sp-2);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.module-pop__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.module-pop__item:hover {
  background: var(--bg-hover);
}

.module-pop__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

/* 弹层出入场：淡入 + 轻微上移 */
.pop-enter-active,
.pop-leave-active {
  transition: opacity var(--duration-base) var(--ease-out-soft),
    transform var(--duration-base) var(--ease-out-soft);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.brand-dot {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-pill);
  background: var(--brand);
  animation: pulse-soft 3.2s var(--ease-in-soft) infinite;
}

/* 路由切换过渡：出场淡出上移，入场淡入上移 */
.route-enter-active,
.route-leave-active {
  transition: opacity var(--duration-base) var(--ease-out-soft),
    transform var(--duration-base) var(--ease-out-soft);
}

.route-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.route-leave-to {
  opacity: 0;
  transform: translateY(-8px);
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
  justify-self: end;
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
