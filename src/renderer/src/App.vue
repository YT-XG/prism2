<template>
  <div
    class="app-shell"
    :class="{ 'is-exiting': exiting, 'is-popup': isPopup, 'is-search': isSearch }"
    ref="shellRef"
    @animationend="onAnimationEnd"
  >
    <header v-if="!isStandalone" class="titlebar drag-region">
      <div class="titlebar-brand">
        <span class="brand-dot"></span>
        <span class="titlebar-title">
          Prism <span class="titlebar-version">v{{ version }}</span>
        </span>
        <!-- 全局状态中心：同步中 / 应用报错 / 软件更新 / toast 统一显示在品牌区后 -->
        <StatusCenter />
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
        <button
          class="tb-btn tb-update"
          :class="{
            'is-downloading': update.status === 'downloading',
            'is-downloaded': update.status === 'downloaded'
          }"
          :title="updateButtonTitle"
          @click="onUpdateButtonClick"
        >
          <ArrowUp :size="15" :stroke-width="1.75" />
          <span v-if="update.status === 'downloading'" class="tb-update__badge">
            {{ update.progress ?? 0 }}
          </span>
        </button>
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

    <!-- 功能搜索命令面板：仅主界面（通知浮窗/独立搜索窗小窗不挂载，搜索窗经 SearchView 自渲染） -->
    <FeatureSearchPanel v-if="!isStandalone && !isSearch" />

    <!-- 片段占位符输入弹窗：主界面与独立搜索窗均可用（搜索可命中片段） -->
    <SnippetPlaceholderDialog v-if="!isPopup" />

    <!-- 独立搜索窗：右上角浮动状态胶囊；通知浮窗不显示（浮窗只呈现通知卡片，避免胶囊遮挡） -->
    <StatusCenter v-if="isSearch" floating />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Minus, X, Square, Minimize2, Command, LayoutGrid, ArrowUp, RefreshCw, AlertCircle } from '@lucide/vue'
import StatusCenter from '@renderer/components/ui/StatusCenter.vue'
import UiSwitch from '@renderer/components/ui/UiSwitch.vue'
import FeatureSearchPanel from '@renderer/components/FeatureSearchPanel.vue'
import SnippetPlaceholderDialog from '@renderer/components/SnippetPlaceholderDialog.vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import { useFeatureSearch } from '@renderer/composables/useFeatureSearch'
import { useToast } from '@renderer/composables/useToast'
import { useStatusCenter } from '@renderer/composables/useStatusCenter'
import { useHomeModules, type HomeModuleDef } from '@renderer/composables/useHomeModules'
import { useMail } from '@renderer/composables/useMail'
import type { UpdateStatusInfo } from '@preload/ipc'

const router = useRouter()
const route = useRoute()
const { success, error, info } = useToast()
const exiting = ref(false)
const version = ref('')
const isMaximized = ref(false)
const shellRef = ref<HTMLElement | null>(null)
const { open: openFeatureSearch } = useFeatureSearch()

// ---------------------------------------------------------------------------
// 全局状态中心：同步中 / 应用报错 / 软件更新 统一为状态条目，渲染在标题栏品牌区后
// ---------------------------------------------------------------------------
const { set: setStatus, removeKey: removeStatusKey } = useStatusCenter()

// ---------------------------------------------------------------------------
// 邮箱账号同步状态：同步中显示「xx 同步中」警示条目（旋转图标），同步完自动移除
// ---------------------------------------------------------------------------
const { syncing: mailSyncing, init: initMail, refreshSyncing: refreshMailSyncing } = useMail()

watch(
  mailSyncing,
  (list) => {
    if (!list.length) {
      removeStatusKey('sync')
      return
    }
    const text = list.length === 1 ? `${list[0].name} 同步中` : `${list.length} 个账号同步中`
    setStatus('sync', { tone: 'warning', icon: RefreshCw, spin: true, text, title: '邮箱正在同步' })
  },
  { immediate: true }
)

// ---------------------------------------------------------------------------
// 软件更新状态：检查中/下载中/就绪 显示为状态条目，就绪条目可点击安装
// ---------------------------------------------------------------------------
const update = ref<UpdateStatusInfo>({ status: 'idle', currentVersion: '' })

watch(
  () => update.value.status,
  () => {
    const s = update.value
    switch (s.status) {
      case 'checking':
        setStatus('update', { tone: 'info', icon: ArrowUp, text: '正在检查更新…' })
        break
      case 'available':
        setStatus('update', {
          tone: 'brand',
          icon: ArrowUp,
          text: `发现新版本 v${s.version}`,
          action: onUpdateButtonClick
        })
        break
      case 'downloading':
        setStatus('update', {
          tone: 'warning',
          icon: ArrowUp,
          text: `正在下载 v${s.version} ${Math.round(s.progress ?? 0)}%`
        })
        break
      case 'downloaded':
        setStatus('update', {
          tone: 'brand',
          icon: ArrowUp,
          text: `新版本 v${s.version} 已就绪`,
          action: () => void window.electronAPI.update.quitAndInstall()
        })
        break
      default:
        removeStatusKey('update')
    }
  },
  { immediate: true }
)

/** 右上角更新按钮的 title 文案 */
const updateButtonTitle = computed(() => {
  switch (update.value.status) {
    case 'downloaded':
      return `新版本 v${update.value.version} 已就绪，点击安装并重启`
    case 'downloading':
      return `正在下载新版本 v${update.value.version}… ${update.value.progress ?? 0}%`
    case 'checking':
      return '正在检查更新…'
    default:
      return '检查版本更新'
  }
})

/** 点击更新按钮：已下载则安装并重启；否则手动检查更新，并据结果给出可见反馈 */
function onUpdateButtonClick(): void {
  const s = update.value.status
  if (s === 'downloaded') {
    void window.electronAPI.update.quitAndInstall()
    return
  }
  if (s === 'downloading' || s === 'checking') return

  void window.electronAPI.update.check().then((info_) => {
    if (info_?.message) {
      info(info_.message)
    } else if (info_?.status === 'up-to-date') {
      success('已是最新版本')
    } else if (info_?.status === 'error') {
      error(info_.error ?? '检查更新失败')
    }
  })
}

// ---------------------------------------------------------------------------
// 应用报错状态：主进程 error 级日志到达时显示红色报错条目，1 分钟自动消失（连续报错会顺延）
// ---------------------------------------------------------------------------
function onAppError(payload: { feature: string }): void {
  const text = payload.feature ? `${payload.feature}功能发生错误` : '软件发生错误'
  setStatus('appError', { tone: 'error', icon: AlertCircle, text, dismissMs: 60_000, title: text })
}

/** 主页显示设置面板：开关 + 模块清单 */
const showModules = ref(false)
const centerRef = ref<HTMLElement | null>(null)
const { modules, setModule } = useHomeModules()
const moduleDefs: HomeModuleDef[] = [
  { key: 'compactClipboard', label: '精简剪贴板' },
  { key: 'quickFolders', label: '快捷文件夹' }
]

/** 点击面板外区域关闭「显示」面板 */
function onDocPointerDown(e: PointerEvent): void {
  if (!showModules.value) return
  const target = e.target as Node
  if (centerRef.value && !centerRef.value.contains(target)) showModules.value = false
}

/** 通知浮窗：透明小窗，只显示通知卡片栈 */
const isPopup = computed(() => route.path.startsWith('/notificationPopup'))
/** 独立搜索窗（Ctrl+K SearchFrame）：只显示全局搜索面板 */
const isSearch = computed(() => route.path.startsWith('/search'))
/** 独立小窗（通知浮窗/独立搜索窗）：隐藏标题栏与主界面专属面板 */
const isStandalone = computed(() => isPopup.value || isSearch.value)

/** Esc：关闭主页显示面板。Ctrl+K 由主进程全局快捷键统一处理（系统级唤起全局搜索） */
function onGlobalKeydown(e: KeyboardEvent): void {
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
  // 兜底：部分环境（透明窗口合成异常 / 系统关闭动画 / 动画被中断）下 animationend 可能不触发，
  // 此时窗口停在"已淡出但未隐藏"态，主进程 isVisible() 恒为 true，托盘将永远无法再唤起窗口。
  // 超时后强制走一次隐藏流程，保证窗口最终进入隐藏态、下次托盘点击能正常显示。
  window.setTimeout(() => {
    if (exiting.value) window.electronAPI.window.hideAfterAnimation()
  }, 400)
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
      playEnter()
      // 隐藏期间同步状态广播被 onlyVisible 跳过，重显时兜底拉取
      void refreshMailSyncing()
    })
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

  // 标题栏更新提示：同步当前状态 + 订阅后续变化（启动检查/下载进度/已下载）
  void window.electronAPI.update.getStatus().then((s) => {
    update.value = s
  })
  subscribeOnUnmounted(() =>
    window.electronAPI.update.onStatus((info) => {
      update.value = info
    })
  )

  // 标题栏账号同步提示：订阅变化 + 初始兜底拉取（应用启动时可能已在同步中）
  initMail()
  void refreshMailSyncing()

  // 标题栏应用报错提示：订阅主进程 error 级广播
  subscribeOnUnmounted(() => window.electronAPI.onAppError(onAppError))

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
}

.app-shell.is-exiting {
  animation: page-exit var(--duration-base) var(--ease-out-soft) forwards;
  pointer-events: none;
}

/* 通知浮窗：透明背景、去边框圆角阴影，让窗口只显示卡片本身；高度随内容由主进程缩放 */
.app-shell.is-popup {
  height: auto;
  display: block;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  overflow: visible;
}

.app-shell.is-popup .app-content {
  overflow: visible;
}

/* 独立搜索窗（Ctrl+K）：透明背景去边框，去掉"最外层背景色层"，只显示全局搜索面板卡片本身 */
.app-shell.is-search {
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.titlebar {
  height: 42px;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 var(--sp-3) 0 var(--sp-4);
  background: transparent;
  border-bottom: 1px solid var(--border);
}

.titlebar-brand {
  justify-self: start;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

/* 居中工具栏（功能搜索 + 显示），弹层相对其定位 */
.titlebar-center {
  justify-self: center;
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.tb-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
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
  width: 10px;
  height: 10px;
  border-radius: var(--radius-pill);
  background: var(--brand);
  animation: pulse-soft 3.2s var(--ease-in-soft) infinite;
}

/* 右上角「检查更新」箭头按钮：下载中变黄并显示进度角标，已就绪变品牌色示意可安装 */
/* 标题栏整体是拖动区（drag-region），按钮所在 .titlebar-actions 已标 no-drag 才能收到点击 */
.tb-update {
  position: relative;
}

.tb-update.is-downloading {
  color: var(--warning);
}

.tb-update.is-downloaded {
  color: var(--brand);
}

.tb-update__badge {
  position: absolute;
  top: 1px;
  right: -2px;
  min-width: 14px;
  height: 12px;
  padding: 0 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  background: var(--warning);
  color: var(--text-on-primary);
  font-size: 8px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.4px;
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
  line-height: 1.2;
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
  width: 30px;
  height: 30px;
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
  overflow: hidden;
}
</style>
