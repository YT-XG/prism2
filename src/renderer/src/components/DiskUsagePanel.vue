<template>
  <div class="du-panel">
    <div class="panel-head">
      <span class="panel-head__ic">
        <FolderSearch :size="18" :stroke-width="1.6" />
      </span>
      <div class="panel-head__info">
        <div class="panel-head__name">大文件（夹）排行</div>
        <div class="panel-head__desc">分析任意目录 / 盘符的占用情况，列出占用最大的文件与文件夹</div>
      </div>
      <div class="panel-head__actions">
        <UiButton variant="secondary" size="sm" @click="addRoots">添加目录/盘符</UiButton>
        <UiButton v-if="scanning" variant="danger" size="sm" @click="cancelScan">
          停止扫描
        </UiButton>
        <UiButton v-else variant="primary" size="sm" :disabled="!roots.length" @click="startScan">
          开始扫描
        </UiButton>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="roots.length" class="du-roots">
        <span
          v-for="(root, i) in roots"
          :key="root"
          class="du-root"
          :class="{ 'is-stale': staleRoots.has(root) }"
          :title="staleRoots.has(root) ? `${root}（路径不存在，请移除）` : root"
        >
          <Folder :size="12" :stroke-width="1.6" />
          <span class="du-root__path">{{ root }}</span>
          <button
            type="button"
            class="du-root__x"
            :disabled="scanning"
            :aria-label="`移除 ${root}`"
            @click="removeRoot(i)"
          >
            <X :size="12" :stroke-width="1.8" />
          </button>
        </span>
      </div>
      <div v-else class="du-root__hint">尚未添加目录，点击右上角添加</div>

      <div v-if="scanning" class="du-progress">
        <div class="du-progress__line">
          <span class="du-progress__label">扫描中</span>
          <span v-if="progress" class="du-progress__num num">
            {{ progress.dirs }} 目录 / {{ progress.files }} 文件
          </span>
        </div>
        <div class="du-progress__path" :title="progress?.currentPath">
          {{ progress?.currentPath || '…' }}
        </div>
        <div class="du-progress__meta num">
          已统计 {{ formatSize(progress?.scannedBytes ?? 0)
          }}<template v-if="progress?.skipped"> ，{{ progress.skipped }} 处无法访问</template>
        </div>
      </div>

      <template v-if="result">
        <div class="du-summary">
          <div
            v-for="root in result.roots"
            :key="root.path"
            class="du-summary__item"
            :title="root.path"
          >
            <div class="du-summary__top">
              <span class="du-summary__size num">{{ formatSize(root.totalSize) }}</span>
              <span v-if="root.totalBytes" class="du-summary__pct num">{{
                usagePercent(root).toFixed(0)
              }}%</span>
            </div>
            <div class="du-summary__path" :title="root.path">{{ root.path }}</div>
            <div class="du-summary__meta num">
              {{ root.dirs }} 目录 · {{ root.files }} 文件
            </div>
            <div v-if="root.totalBytes && root.freeBytes != null" class="du-summary__vol">
              <div class="du-vol__bar">
                <div
                  class="du-vol__fill"
                  :style="{ width: usagePercent(root) + '%' }"
                  role="progressbar"
                  :aria-valuenow="usagePercent(root)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                ></div>
              </div>
              <div class="du-vol__meta num">
                剩余 {{ formatSize(root.freeBytes) }} / {{ formatSize(root.totalBytes) }}
              </div>
            </div>
          </div>
          <div v-if="!result.roots.length" class="du-summary__none">没有有效目录被扫描</div>
        </div>

        <div v-if="result.cancelled" class="du-note">扫描已取消，结果为取消前已完成部分。</div>
        <div v-if="result.skipped.length" class="du-note">
          <span>{{ result.skipped.length }} 处无法访问</span>
          <template v-if="isMacPermissionDenied">
            ，macOS 需在「系统设置 → 隐私与安全性 → 完全磁盘访问」中授权本应用
          </template>
          <ul class="du-note__list">
            <li v-for="s in result.skipped.slice(0, 5)" :key="s.path">
              {{ s.path }}：{{ s.reason }}
            </li>
          </ul>
        </div>

        <div class="du-tabs">
          <UiPillTab :active="tab === 'files'" @click="tab = 'files'">
            <File :size="14" :stroke-width="1.6" />大文件
          </UiPillTab>
          <UiPillTab :active="tab === 'dirs'" @click="tab = 'dirs'">
            <Folder :size="14" :stroke-width="1.6" />大文件夹
          </UiPillTab>
        </div>

        <div v-if="activeEntries.length" class="du-list">
          <div v-for="entry in activeEntries" :key="entry.path" class="du-entry">
            <span class="du-entry__ic" :class="`is-${entry.kind}`">
              <Folder v-if="entry.kind === 'dir'" :size="16" :stroke-width="1.6" />
              <File v-else :size="16" :stroke-width="1.6" />
            </span>
            <span class="du-entry__main">
              <span class="du-entry__name">{{ entry.name }}</span>
              <span class="du-entry__path" :title="entry.path">{{ entry.path }}</span>
            </span>
            <span class="du-entry__size num">{{ formatSize(entry.size) }}</span>
            <UiButton variant="secondary" size="xs" @click="locate(entry.path)">定位</UiButton>
          </div>
        </div>
        <div v-else class="du-empty">该分类没有可展示的条目</div>
      </template>

      <UiEmptyState
        v-else-if="!scanning"
        title="尚未开始分析"
        hint="先添加要分析的目录（如 D:\ 或用户主目录），再点击「开始扫描」"
      >
        <template #action>
          <UiButton variant="primary" size="sm" @click="addRoots">添加目录/盘符</UiButton>
        </template>
      </UiEmptyState>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FolderSearch, File, Folder, X } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiPillTab from '@renderer/components/ui/UiPillTab.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import { useToast } from '@renderer/composables/useToast'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type { DiskScanEntry, DiskScanProgress, DiskScanResult, DiskScanRoot } from '@preload/ipc'

const toast = useToast()

const ROOTS_KEY = 'prism2.storage.diskRoots'
/** 持久化的扫描根上限（防 localStorage 无限膨胀与误传大批路径） */
const MAX_ROOTS = 8
const isMac = window.electronAPI.platform === 'darwin'

const roots = ref<string[]>(loadRoots())
const scanning = ref(false)
const progress = ref<DiskScanProgress | null>(null)
const result = ref<DiskScanResult | null>(null)
const tab = ref<'files' | 'dirs'>('files')

function loadRoots(): string[] {
  try {
    const raw = localStorage.getItem(ROOTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, MAX_ROOTS)
      : []
  } catch {
    return []
  }
}

function persistRoots(): void {
  try {
    localStorage.setItem(ROOTS_KEY, JSON.stringify(roots.value.slice(0, MAX_ROOTS)))
  } catch {
    // 忽略持久化失败
  }
}

watch(roots, persistRoots, { deep: true })

const activeEntries = computed<DiskScanEntry[]>(() =>
  tab.value === 'files' ? (result.value?.topFiles ?? []) : (result.value?.topDirs ?? [])
)

const isMacPermissionDenied = computed(
  () => isMac && result.value?.skipped.some((s) => s.reason.includes('完全磁盘访问'))
)

/** 扫描结果中报「不是可访问的目录」的根 → 标记为失效（可直接移除） */
const staleRoots = computed(() => {
  const set = new Set<string>()
  for (const s of result.value?.skipped ?? []) {
    if (s.reason === '不是可访问的目录' || s.reason === '路径不存在') set.add(s.path)
  }
  return set
})

/** 根目录的卷使用率（%）；拿不到容量信息时返回 0 */
function usagePercent(root: DiskScanRoot): number {
  if (!root.totalBytes || root.freeBytes == null) return 0
  const used = Math.max(root.totalBytes - root.freeBytes, 0)
  return Math.min(100, (used / root.totalBytes) * 100)
}

/** 字节数格式化为人类可读 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function addRoots(): Promise<void> {
  try {
    const picked = await window.electronAPI.diskUsage.pickRoots()
    if (!picked.length) return
    const existing = new Set(roots.value)
    for (const p of picked) {
      if (roots.value.length >= MAX_ROOTS) {
        toast.info(`最多保留 ${MAX_ROOTS} 个扫描目录，已忽略其余选择`)
        break
      }
      if (!existing.has(p)) {
        existing.add(p)
        roots.value.push(p)
      }
    }
  } catch (err) {
    toast.error(`选择目录失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function removeRoot(index: number): void {
  roots.value.splice(index, 1)
}

/**
 * 本次扫描的 runId（0 = 尚未确定）。
 * 进度帧可能早于 scan() 返回，故首个帧即用于确定 runId；之后仅接受同 runId 的帧，
 * 避免上一轮的结束帧提前关掉「扫描中」状态。
 */
let currentRunId = 0

function onProgress(p: DiskScanProgress): void {
  if (!scanning.value) return
  if (currentRunId !== 0 && p.runId !== currentRunId) return
  currentRunId = p.runId
  progress.value = p
  if (p.finished) scanning.value = false
}

subscribeOnUnmounted(() => window.electronAPI.diskUsage.onProgress(onProgress))

async function startScan(): Promise<void> {
  if (scanning.value) return
  if (!roots.value.length) {
    toast.error('请先添加要分析的目录或盘符')
    return
  }
  scanning.value = true
  currentRunId = 0
  result.value = null
  progress.value = null
  try {
    // 浅拷贝为普通数组：ref 的 .value 是 reactive Proxy，无法结构化克隆过 IPC
    const r = await window.electronAPI.diskUsage.scan([...roots.value])
    currentRunId = r.runId
    result.value = r
    if (r.error) {
      toast.error(r.error)
    } else if (r.cancelled) {
      toast.info('扫描已取消')
    } else if (r.skipped.length) {
      toast.info(`扫描完成，${r.skipped.length} 处无法访问`)
    } else {
      toast.success('扫描完成')
    }
  } catch (err) {
    toast.error(`扫描失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    scanning.value = false
  }
}

async function cancelScan(): Promise<void> {
  try {
    await window.electronAPI.diskUsage.cancel()
  } catch (err) {
    toast.error(`取消失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function locate(path: string): Promise<void> {
  try {
    await window.electronAPI.diskUsage.showItemInFolder(path)
  } catch {
    toast.error('定位失败：路径可能已不存在')
  }
}

// 离开页面即停止主进程扫描，避免切页后仍持续占用 IO
onBeforeUnmount(() => {
  if (scanning.value) void window.electronAPI.diskUsage.cancel()
})
</script>

<style scoped>
.du-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
  background: var(--accent-blue);
  color: var(--text-on-accent-blue);
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

.panel-head__actions {
  display: flex;
  gap: var(--sp-2);
  flex-shrink: 0;
}

/* ---------- 卡体 ---------- */
.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-5);
  /* 等高填充 + 长列表在卡内滚动 */
  flex: 1;
  min-height: 0;
  max-height: min(52vh, 520px);
  overflow-y: auto;
}

.du-roots {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.du-root {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  max-width: 320px;
  padding: 4px 8px 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.du-root.is-stale {
  border-color: var(--danger-bg);
  color: var(--on-danger);
}

.du-root__path {
  overflow: hidden;
  text-overflow: ellipsis;
}

.du-root__x {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--radius-pill);
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.du-root__x:hover:not(:disabled) {
  background: var(--danger-soft);
  color: var(--on-danger);
}

.du-root__x:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.du-root__hint {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.du-progress {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-selected-subtle);
}

.du-progress__line {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.du-progress__num {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.du-progress__path {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.du-progress__meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* ---------- 根汇总（卷容量条） ---------- */
.du-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.du-summary__item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  min-width: 240px;
  flex: 1 1 240px;
  background: var(--bg-selected-subtle);
}

.du-summary__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}

.du-summary__size {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.du-summary__pct {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-on-accent-blue);
  background: var(--accent-blue);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
}

.du-summary__path {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.du-summary__meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.du-summary__vol {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-top: 2px;
}

.du-vol__bar {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--border);
  overflow: hidden;
}

.du-vol__fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--brand);
  transition: width var(--duration-slow) var(--ease-out-soft);
}

.du-vol__meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.du-summary__none {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.du-note {
  font-size: var(--text-sm);
  color: var(--on-warning);
  background: var(--warning-soft);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
}

.du-note__list {
  margin: var(--sp-2) 0 0;
  padding-left: var(--sp-4);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.6;
}

.du-tabs {
  display: flex;
  gap: var(--sp-1);
}

.du-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.du-entry {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border);
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.du-entry:last-child {
  border-bottom: none;
}

.du-entry:hover {
  background: var(--bg-hover);
}

.du-entry__ic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
}

.du-entry__ic.is-file {
  background: var(--accent-blue);
  color: var(--text-on-accent-blue);
}

.du-entry__ic.is-dir {
  background: var(--accent-lavender);
  color: var(--text-on-accent-lavender);
}

.du-entry__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.du-entry__name {
  font-size: var(--text-base);
  color: var(--text-primary);
  word-break: break-all;
}

.du-entry__path {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.du-entry__size {
  flex-shrink: 0;
  width: 76px;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-medium);
  color: var(--text-primary);
  text-align: right;
}

.du-empty {
  padding: var(--sp-5) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
</style>
