<template>
  <div class="dov-panel">
    <div class="panel-head">
      <span class="panel-head__ic">
        <HardDrive :size="18" :stroke-width="1.6" />
      </span>
      <div class="panel-head__info">
        <div class="panel-head__name">磁盘容量</div>
        <div class="panel-head__desc">
          <template v-if="loading">正在读取…</template>
          <template v-else-if="isMac">
            macOS 单卷文件系统 ·
            <span class="panel-head__em">{{ primary?.label || '主磁盘' }}</span
            ><template v-if="external.length"> + {{ external.length }} 个外接卷</template>
          </template>
          <template v-else-if="volumes.length">
            多磁盘 · {{ volumes.length }} 个分区，最满为
            <span class="panel-head__em">{{ fullest?.label }}</span>
          </template>
          <template v-else>暂无可读分区</template>
        </div>
      </div>
      <div class="panel-head__actions">
        <UiButton variant="ghost" size="sm" :disabled="loading" @click="refresh">
          <template v-if="loading">读取中…</template>
          <template v-else>刷新</template>
        </UiButton>
      </div>
    </div>

    <div class="panel-body">
      <!-- Windows：多磁盘网格（各盘符独立计量） -->
      <template v-if="!isMac">
        <div v-if="volumes.length" class="dov-grid">
          <div
            v-for="v in volumes"
            :key="v.path"
            class="dov-item"
            :class="{ 'is-full': v.path === fullest?.path }"
            :title="v.path"
          >
            <div class="dov-item__top">
              <span class="dov-item__label">{{ v.label }}</span>
              <span class="dov-item__pct num">{{ usage(v).toFixed(0) }}%</span>
            </div>
            <div class="dov-bar">
              <div
                class="dov-bar__fill"
                :style="{ width: usage(v) + '%' }"
                role="progressbar"
                :aria-valuenow="usage(v)"
                aria-valuemin="0"
                aria-valuemax="100"
              ></div>
            </div>
            <div class="dov-item__meta num">
              已用 {{ formatSize(v.usedBytes) }} / {{ formatSize(v.totalBytes) }}
              <template v-if="v.readonly"> · 只读</template>
            </div>
            <div class="dov-item__free num">剩余 {{ formatSize(v.freeBytes) }}</div>
          </div>
        </div>
        <div v-else class="dov-loading">{{ loading ? '正在读取分区信息…' : '暂无可读分区' }}</div>
      </template>

      <!-- macOS：单一卷文件系统，主磁盘 + 外接卷分组 -->
      <template v-else>
        <div v-if="primary" class="dov-primary">
          <div class="dov-primary__top">
            <span class="dov-primary__label">{{ primary.label }}</span>
            <span class="dov-primary__pct num">{{ usage(primary).toFixed(0) }}%</span>
          </div>
          <div class="dov-bar">
            <div
              class="dov-bar__fill"
              :style="{ width: usage(primary) + '%' }"
              role="progressbar"
              :aria-valuenow="usage(primary)"
              aria-valuemin="0"
              aria-valuemax="100"
            ></div>
          </div>
          <div class="dov-primary__meta num">
            已用 {{ formatSize(primary.usedBytes) }} / 共 {{ formatSize(primary.totalBytes) }} ·
            剩余 {{ formatSize(primary.freeBytes) }}
            <template v-if="primary.readonly"> · 只读</template>
          </div>
        </div>

        <div class="dov-section">
          <div class="dov-section__head">
            <span class="dov-section__title">外接 / 其它卷</span>
            <span class="dov-section__count num">{{ external.length }}</span>
          </div>
          <div v-if="external.length" class="dov-grid">
            <div v-for="v in external" :key="v.path" class="dov-item" :title="v.path">
              <div class="dov-item__top">
                <span class="dov-item__label">{{ v.label }}</span>
                <span class="dov-item__pct num">{{ usage(v).toFixed(0) }}%</span>
              </div>
              <div class="dov-bar">
                <div
                  class="dov-bar__fill"
                  :style="{ width: usage(v) + '%' }"
                  role="progressbar"
                  :aria-valuenow="usage(v)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                ></div>
              </div>
              <div class="dov-item__meta num">
                已用 {{ formatSize(v.usedBytes) }} / {{ formatSize(v.totalBytes) }}
                <template v-if="v.readonly"> · 只读</template>
              </div>
              <div class="dov-item__free num">剩余 {{ formatSize(v.freeBytes) }}</div>
            </div>
          </div>
          <div v-else class="dov-section__empty">未挂载外接磁盘</div>
        </div>

        <div class="dov-hint">
          macOS 为单一卷文件系统（APFS 容器），无 Windows 式多磁盘概念；主磁盘即系统盘，外接磁盘在此列出。
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { HardDrive } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import type { VolumeInfo } from '@preload/ipc'

const volumes = ref<VolumeInfo[]>([])
const loading = ref(false)
const isMac = window.electronAPI.platform === 'darwin'

const primary = computed<VolumeInfo | null>(() => volumes.value.find((v) => v.role === 'system') ?? null)
const external = computed<VolumeInfo[]>(() => volumes.value.filter((v) => v.role === 'external'))
const fullest = computed<VolumeInfo | null>(() => volumes.value[0] ?? null)

function usage(v: VolumeInfo): number {
  if (!v.totalBytes) return 0
  return Math.min(100, (v.usedBytes / v.totalBytes) * 100)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    volumes.value = await window.electronAPI.diskOverview.listVolumes()
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.dov-panel {
  display: flex;
  flex-direction: column;
}

/* ---------- 卡头 ---------- */
.panel-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5);
  border-bottom: 1px solid var(--border);
}

.panel-head__ic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--accent-violet);
  color: var(--text-on-accent-violet);
}

.panel-head__info {
  min-width: 0;
  flex: 1;
}

.panel-head__name {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.panel-head__desc {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.panel-head__em {
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.panel-head__actions {
  display: flex;
  gap: var(--sp-2);
  flex-shrink: 0;
}

/* ---------- 卡体 ---------- */
.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5) var(--sp-5);
}

.dov-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--sp-3);
}

/* 通用容量条 */
.dov-bar {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--border);
  overflow: hidden;
}

.dov-bar__fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--brand);
  transition: width var(--duration-slow) var(--ease-out-soft);
}

/* 单个磁盘卡（Windows / 外接卷） */
.dov-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-selected-subtle);
}

.dov-item.is-full {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--border));
  background: var(--accent-lavender);
}

.dov-item.is-full .dov-bar__fill {
  background: var(--warning);
}

.dov-item__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}

.dov-item__label {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dov-item__pct {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.dov-item__meta,
.dov-item__free {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

/* ---------- macOS 主磁盘 ---------- */
.dov-primary {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background:
    linear-gradient(180deg, var(--bg-selected-subtle), var(--bg-surface));
  box-shadow: var(--shadow-xs);
}

.dov-primary__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}

.dov-primary__label {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.dov-primary__pct {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.dov-primary__meta {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* ---------- 外接卷分组 ---------- */
.dov-section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.dov-section__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.dov-section__title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.dov-section__count {
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.dov-section__empty {
  padding: var(--sp-3);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
}

.dov-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.5;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  background: var(--bg-selected-subtle);
}

.dov-loading {
  padding: var(--sp-4) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
</style>
