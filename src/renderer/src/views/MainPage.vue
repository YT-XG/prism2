<template>
  <div class="main-page">
    <aside class="sidebar">
      <div class="sidebar-mark">
        <span class="mark-dot"></span>
        <div class="mark-text">
          <div class="mark-title">Prism</div>
          <div class="mark-sub">Desktop Toolkit</div>
        </div>
      </div>

      <nav class="nav">
        <div class="nav-group">
          <div class="nav-label">Main menu</div>
          <RouterLink class="nav-item" to="/mainPage/clipboard">
            <ClipboardList :size="17" :stroke-width="1.6" />
            <span class="nav-item__label">剪贴板</span>
            <span v-if="count" class="nav-badge">{{ count > 99 ? '99+' : count }}</span>
          </RouterLink>
        </div>

        <div class="nav-group">
          <div class="nav-label">Settings</div>
          <RouterLink class="nav-item" to="/mainPage/settings">
            <Settings2 :size="17" :stroke-width="1.6" />
            <span class="nav-item__label">设置</span>
          </RouterLink>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div class="version">v{{ version }}</div>
      </div>
    </aside>

    <section class="content">
      <RouterView />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ClipboardList, Settings2 } from '@lucide/vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'

const count = ref(0)
const version = ref('2.0.0')

onMounted(async () => {
  count.value = await window.electronAPI.clipboard.getHistoryCount()

  subscribeOnUnmounted(() =>
    window.electronAPI.clipboard.onNewItem((_item) => {
      if (!count.value) count.value = 0
      count.value += 1
    })
  )
})
</script>

<style scoped>
.main-page {
  display: flex;
  height: 100%;
  background: var(--bg-page);
}

.sidebar {
  width: 224px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-4) var(--sp-3);
  border-right: 1px solid var(--border);
  background: var(--sidebar-bg);
}

.sidebar-mark {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3);
  margin-bottom: var(--sp-2);
  border-radius: var(--radius-md);
  background: var(--sidebar-header-bg);
  border: 1px solid var(--sidebar-header-border);
}

.mark-dot {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-pill);
  background: var(--avatar-bg);
  color: var(--avatar-text);
  position: relative;
  flex-shrink: 0;
}

.mark-dot::after {
  content: 'P';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
}

.mark-title {
  font-size: 14px;
  font-weight: 600;
}

.mark-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  overflow-y: auto;
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
  color: var(--text-muted);
  padding: 0 var(--sp-2) var(--sp-1);
  text-transform: uppercase;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 38px;
  padding: 0 var(--sp-3);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.router-link-active {
  background: var(--bg-selected);
  color: var(--text-on-primary);
}

.nav-item__label {
  flex: 1;
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
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.nav-item.router-link-active .nav-badge {
  background: rgba(255, 255, 255, 0.18);
  color: var(--text-on-primary);
}

.sidebar-footer {
  padding: var(--sp-3) var(--sp-2) var(--sp-1);
  border-top: 1px solid var(--border);
}

.version {
  font-size: 11px;
  color: var(--text-muted);
}

.content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
