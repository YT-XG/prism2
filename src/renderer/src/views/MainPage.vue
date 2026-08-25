<template>
  <div class="main-page">
    <aside class="sidebar">
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
  gap: var(--sp-2);
  height: 100%;
  padding: var(--sp-2);
  background: transparent;
}

.sidebar {
  width: 224px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-2);
  border: none;
  border-radius: var(--radius-xl);
  background: var(--sidebar-bg);
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
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
  height: 36px;
  padding: 0 var(--sp-3);
  border-radius: var(--radius-pill);
  color: var(--text-primary);
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
  background: var(--brand);
  color: #fff;
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
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
}

.nav-item.router-link-active .nav-badge {
  background: rgba(255, 255, 255, 0.18);
  color: var(--text-on-primary);
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
