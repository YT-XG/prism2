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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ClipboardList, Settings2, ChevronsLeft, ChevronsRight } from '@lucide/vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'

/** 侧栏折叠态：预留图标竖栏模式（参考图），后续模块增多后仍保持轻量导航 */
const collapsed = ref(false)
const count = ref(0)

/** 从主进程重新拉取权威历史计数（新增/删除/清空/导入后均以此为准） */
async function refreshCount(): Promise<void> {
  count.value = await window.electronAPI.clipboard.getHistoryCount()
}

onMounted(async () => {
  await refreshCount()

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
</style>
