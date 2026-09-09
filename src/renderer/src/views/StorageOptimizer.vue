<template>
  <div class="storage-page">
    <header class="storage-header">
      <div>
        <h1 class="storage-title">存储优化</h1>
        <p class="storage-subtitle">扫描系统残留与大文件占用，清理空间</p>
      </div>
    </header>

    <div class="storage-body">
      <section class="storage-panels">
        <ResidueScanPanel />
        <DiskUsagePanel />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import ResidueScanPanel from '@renderer/components/ResidueScanPanel.vue'
import DiskUsagePanel from '@renderer/components/DiskUsagePanel.vue'
</script>

<style scoped>
/* 全局 html/body 与主窗口 .content 均为 overflow:hidden，页面滚动走自身内部滚动容器 */
.storage-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.storage-header {
  flex-shrink: 0;
  padding: var(--sp-4) var(--sp-7) var(--sp-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
}

.storage-title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.storage-subtitle {
  margin: var(--sp-1) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.storage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-5) var(--sp-7) var(--sp-6);
}

.storage-panels {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
</style>