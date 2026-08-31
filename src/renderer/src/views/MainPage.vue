<template>
  <div class="main-page">
    <aside class="sidebar" :class="{ 'is-collapsed': collapsed }">
      <nav class="nav">
        <div class="nav-group">
          <Transition name="nav-fade">
            <div v-if="!collapsed" class="nav-label">Main menu</div>
          </Transition>
          <RouterLink
            class="nav-item"
            :title="collapsed ? '主页' : undefined"
            to="/mainPage/home"
          >
            <House :size="16" :stroke-width="1.6" />
            <Transition name="nav-fade">
              <span v-if="!collapsed" class="nav-item__label">主页</span>
            </Transition>
          </RouterLink>
          <RouterLink
            class="nav-item"
            :title="collapsed ? '剪贴板' : undefined"
            to="/mainPage/clipboard"
          >
            <ClipboardList :size="16" :stroke-width="1.6" />
            <Transition name="nav-fade">
              <span v-if="!collapsed" class="nav-item__label">剪贴板</span>
            </Transition>
            <span v-if="count && !collapsed" :key="count" class="nav-badge num">{{ count > 99 ? '99+' : count }}</span>
            <span v-else-if="count && collapsed" class="nav-dot" />
          </RouterLink>
          <RouterLink
            class="nav-item"
            :title="collapsed ? '便利贴' : undefined"
            to="/mainPage/notes"
          >
            <StickyNote :size="16" :stroke-width="1.6" />
            <Transition name="nav-fade">
              <span v-if="!collapsed" class="nav-item__label">便利贴</span>
            </Transition>
          </RouterLink>
        </div>

        <div class="nav-group">
          <Transition name="nav-fade">
            <div v-if="!collapsed" class="nav-label">Settings</div>
          </Transition>
          <RouterLink
            class="nav-item"
            :title="collapsed ? '设置' : undefined"
            to="/mainPage/settings"
          >
            <Settings2 :size="16" :stroke-width="1.6" />
            <Transition name="nav-fade">
              <span v-if="!collapsed" class="nav-item__label">设置</span>
            </Transition>
          </RouterLink>
        </div>
      </nav>

      <button
        class="nav-collapse"
        type="button"
        :title="collapsed ? '展开侧栏' : '折叠侧栏'"
        @click="collapsed = !collapsed"
      >
        <ChevronsLeft v-if="!collapsed" :size="15" :stroke-width="1.6" />
        <ChevronsRight v-else :size="15" :stroke-width="1.6" />
      </button>
    </aside>

    <section class="content">
      <RouterView />
    </section>

    <!-- 启动弹窗：检测到旧版（v1）安装且未选择「不再提醒」时询问是否卸载 -->
    <UiDialog
      :model-value="legacyPromptOpen"
      title="检测到旧版 Prism"
      @update:model-value="legacyPromptOpen = false"
    >
      <p class="confirm-text">
        检测到旧版 Prism v{{ legacyInstall.version }} 已安装，是否卸载旧版本？卸载后可前往
        设置 → 旧版本 清理旧版数据。
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="dismissLegacyPrompt">暂不</UiButton>
        <UiButton variant="ghost" @click="dismissLegacyPromptForever">不再提醒</UiButton>
        <UiButton variant="danger" @click="uninstallLegacy">卸载旧版</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { House, ClipboardList, StickyNote, Settings2, ChevronsLeft, ChevronsRight } from '@lucide/vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import { useToast } from '@renderer/composables/useToast'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type { LegacyInstallInfo } from '@preload/ipc'

const toast = useToast()

/** 侧栏折叠态：预留图标竖栏模式（参考图），后续模块增多后仍保持轻量导航 */
const collapsed = ref(false)
const count = ref(0)

// ---------------------------------------------------------------------------
// 旧版本（v1）启动提示弹窗
// ---------------------------------------------------------------------------
/** 弹窗是否打开 */
const legacyPromptOpen = ref(false)
/** 检测到的旧版安装信息 */
const legacyInstall = ref<LegacyInstallInfo>({ detected: false, platform: 'win' })
/** 本次运行是否已提示过（避免用户点「暂不」后因窗口重显反复弹出） */
let legacyPrompted = false

/** 卸载旧版：执行后关闭弹窗（不置「不再提醒」，用户仍可在设置页操作） */
async function uninstallLegacy(): Promise<void> {
  legacyPromptOpen.value = false
  legacyPrompted = true
  const r = await window.electronAPI.legacyCleanup.uninstall()
  if (r.ok) {
    toast.success(r.launched ? '已启动旧版卸载' : '旧版已移入废纸篓')
  } else {
    toast.error(`卸载失败：${r.error ?? '未知错误'}`)
  }
}

/** 暂不：本次运行不再提示 */
function dismissLegacyPrompt(): void {
  legacyPromptOpen.value = false
  legacyPrompted = true
}

/** 不再提醒：写入设置，后续启动不再弹窗 */
async function dismissLegacyPromptForever(): Promise<void> {
  legacyPromptOpen.value = false
  legacyPrompted = true
  await window.electronAPI.settings.update({ legacyUninstallPromptDone: true })
}

/** 从主进程重新拉取权威历史计数（新增/删除/清空/导入后均以此为准） */
async function refreshCount(): Promise<void> {
  count.value = await window.electronAPI.clipboard.getHistoryCount()
}

onMounted(async () => {
  await refreshCount()

  // 检测旧版安装：已检测到且未「不再提醒」且本运行未提示过 → 弹窗
  if (!legacyPrompted) {
    const [cleanup, settings] = await Promise.all([
      window.electronAPI.legacyCleanup.getState(),
      window.electronAPI.settings.get()
    ])
    if (cleanup.install.detected && !settings.legacyUninstallPromptDone) {
      legacyInstall.value = cleanup.install
      legacyPromptOpen.value = true
    }
  }

  // 历史变更广播触发时刷新计数，避免删除/清空/导入后侧栏角标残留
  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onHistoryChanged(() => {
      void refreshCount()
    })
  )

  // 窗口重新显示时兜底刷新（隐藏期间的变更广播被 onlyVisible 跳过）
  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', () => {
      void refreshCount()
    })
  )
})
</script>

<style scoped>
.main-page {
  display: flex;
  gap: var(--sp-2);
  height: 100%;
  padding: var(--sp-2);
  background: transparent;
}

.sidebar {
  width: 176px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-2);
  border: none;
  border-radius: var(--radius-xl);
  background: var(--sidebar-bg);
  transition: width var(--duration-base) var(--ease-out-soft);
}

.sidebar.is-collapsed {
  width: 60px;
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  overflow-y: auto;
  overflow-x: hidden;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.nav-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  padding: 0 var(--sp-2) var(--sp-1);
  text-transform: uppercase;
  white-space: nowrap;
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

/* 折叠/展开时，分组标签与导航文字淡出 + 轻微左移（避免生硬消失） */
.nav-fade-enter-active,
.nav-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out-soft),
    transform var(--duration-fast) var(--ease-out-soft);
}

.nav-fade-enter-from,
.nav-fade-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 36px;
  padding: 0 var(--sp-3);
  border-radius: var(--radius-pill);
  color: var(--text-primary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  animation: card-in var(--duration-enter) var(--ease-out-soft);
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft),
    transform var(--duration-fast) var(--ease-out-soft);
}

/* 导航项阶梯入场 */
.nav-item:nth-child(1) {
  animation-delay: 60ms;
}

.nav-item:nth-child(2) {
  animation-delay: 120ms;
}

.nav-item svg {
  flex-shrink: 0;
  transition: transform var(--duration-fast) var(--ease-out-soft);
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item:hover svg {
  transform: translateX(2px);
}

/* 激活时品牌色立即落位：去掉 background 过渡，避免路由切换时从透明淡入（闪浅色） */
.nav-item.router-link-active {
  background: var(--brand);
  color: var(--text-on-primary);
  transition: none;
}

.sidebar.is-collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

.sidebar.is-collapsed .nav-item:hover svg {
  transform: none;
}

.nav-item__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  animation: pop var(--duration-base) var(--ease-spring);
}

.nav-item.router-link-active .nav-badge {
  background: rgba(255, 255, 255, 0.18);
  color: var(--text-on-primary);
}

/* 折叠态：角标退化为右上小圆点，新内容时柔和脉动提示 */
.nav-dot {
  position: absolute;
  top: 6px;
  right: 10px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 0 2px var(--bg-surface);
  animation: pulse-soft 3.2s var(--ease-in-soft) infinite;
}

.nav-collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.nav-collapse:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
