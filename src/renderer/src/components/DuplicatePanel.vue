<template>
  <div class="dp-panel">
    <div class="panel-head">
      <span class="panel-head__ic">
        <Copy :size="18" :stroke-width="1.6" />
      </span>
      <div class="panel-head__info">
        <div class="panel-head__name">重复文件去重</div>
        <div class="panel-head__desc">在选定目录内按内容指纹找出重复文件，保留一份、删除其余</div>
      </div>
      <div class="panel-head__actions">
        <UiButton variant="secondary" size="sm" @click="addRoots">添加目录</UiButton>
        <UiButton v-if="scanning" variant="danger" size="sm" @click="cancelScan">
          停止扫描
        </UiButton>
        <UiButton v-else variant="primary" size="sm" :disabled="!roots.length" @click="startScan">
          开始扫描
        </UiButton>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="roots.length" class="dp-roots">
        <span
          v-for="(root, i) in roots"
          :key="root"
          class="dp-root"
          :title="root"
        >
          <Folder :size="12" :stroke-width="1.6" />
          <span class="dp-root__path">{{ root }}</span>
          <button
            type="button"
            class="dp-root__x"
            :disabled="scanning"
            :aria-label="`移除 ${root}`"
            @click="removeRoot(i)"
          >
            <X :size="12" :stroke-width="1.8" />
          </button>
        </span>
      </div>
      <div v-else class="dp-root__hint">尚未添加目录，点击右上角添加</div>

      <div v-if="scanning" class="dp-progress">
        <div class="dp-progress__line">
          <span class="dp-progress__label">扫描中</span>
          <span v-if="progress" class="dp-progress__num num">
            {{ progress.files }} 个文件 · {{ progress.groups }} 组重复
          </span>
        </div>
        <div class="dp-progress__path" :title="progress?.currentPath">
          {{ progress?.currentPath || '…' }}
        </div>
        <div class="dp-progress__meta num">
          已统计 {{ formatSize(progress?.scannedBytes ?? 0)
          }}<template v-if="progress?.skipped"> ，{{ progress.skipped }} 处无法访问</template>
        </div>
      </div>

      <template v-if="result">
        <div class="dp-summary">
          <span class="dp-summary__size num">{{ formatSize(result.totalDuplicateBytes) }}</span>
          <span class="dp-summary__meta num">{{ result.groups.length }} 组重复</span>
        </div>
        <div v-if="result.cancelled" class="dp-note">扫描已取消，结果为取消前已完成部分。</div>
        <div v-if="result.error" class="dp-note">{{ result.error }}</div>

        <div v-if="groups.length" class="dp-toolbar">
          <label class="dp-check">
            <input
              type="checkbox"
              :checked="allRemovableChecked"
              :indeterminate="selectedCount > 0 && !allRemovableChecked"
              @change="toggleAll"
            />
            全选可删副本
          </label>
          <span class="num">{{ selectedCount }} 项已选</span>
        </div>

        <div v-for="g in groups" :key="g.key" class="dp-group">
          <div class="dp-group__head">
            <span class="dp-group__size num">{{ formatSize(g.size) }}</span>
            <span class="dp-group__meta num">{{ g.files.length }} 份 · 可释放 {{ formatSize(g.reclaimableBytes) }}</span>
          </div>
          <div class="dp-files">
            <div v-for="f in g.files" :key="f.path" class="dp-file" :class="{ 'is-keep': f.path === g.keepPath }">
              <input
                v-if="f.path !== g.keepPath"
                v-model="selectedPaths"
                type="checkbox"
                :value="f.path"
              />
              <span v-else class="dp-file__keep-dot"></span>
              <span class="dp-file__ic"><File :size="14" :stroke-width="1.6" /></span>
              <span class="dp-file__main">
                <span class="dp-file__name">{{ f.name }}</span>
                <span class="dp-file__path" :title="f.path">{{ f.path }}</span>
              </span>
              <span v-if="f.path === g.keepPath" class="dp-file__keep">保留</span>
            </div>
          </div>
        </div>

        <div v-if="!groups.length && !result.cancelled" class="dp-empty">未发现重复文件</div>

        <div v-if="selectedPaths.length" class="panel-actions">
          <UiButton
            variant="danger"
            size="sm"
            :disabled="cleaning"
            @click="openConfirm"
          >
            {{ cleaning ? '清理中…' : `清理选中（${selectedPaths.length}）` }}
          </UiButton>
        </div>
      </template>

      <UiEmptyState
        v-else-if="!scanning"
        title="尚未开始查找"
        hint="添加要查找重复文件的目录（如 D:\ 图片或下载目录），再点击「开始扫描」"
      >
        <template #action>
          <UiButton variant="primary" size="sm" @click="addRoots">添加目录</UiButton>
        </template>
      </UiEmptyState>
    </div>

    <UiDialog
      :model-value="confirmOpen"
      title="清理重复副本"
      @update:model-value="confirmOpen = false"
    >
      <p class="dp-confirm__text">
        将删除 {{ selectedPaths.length }} 份重复副本，每组的「保留」项不受影响。文件将移入回收站可恢复。确定继续吗？
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmOpen = false">取消</UiButton>
        <UiButton variant="danger" @click="doClean">确认清理</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Copy, File, Folder, X } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import { useToast } from '@renderer/composables/useToast'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type { DuplicateGroup, DuplicateScanProgress, DuplicateScanResult } from '@preload/ipc'

const toast = useToast()

const ROOTS_KEY = 'prism2.storage.dupRoots'
const MAX_ROOTS = 8

const roots = ref<string[]>(loadRoots())
const scanning = ref(false)
const cleaning = ref(false)
const confirmOpen = ref(false)
const progress = ref<DuplicateScanProgress | null>(null)
const result = ref<DuplicateScanResult | null>(null)
/** 选中要清理的重复副本路径 */
const selectedPaths = ref<string[]>([])

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
    // 忽略
  }
}

watch(roots, persistRoots, { deep: true })

/** 所有可删副本路径（每组不含保留项） */
const allRemovable = computed<string[]>(() =>
  (result.value?.groups ?? []).flatMap((g) =>
    g.files.filter((f) => f.path !== g.keepPath).map((f) => f.path)
  )
)
const selectedCount = computed(() => selectedPaths.value.length)
const allRemovableChecked = computed(
  () => allRemovable.value.length > 0 && allRemovable.value.every((p) => selectedPaths.value.includes(p))
)
const groups = computed<DuplicateGroup[]>(() => result.value?.groups ?? [])

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function addRoots(): Promise<void> {
  try {
    const picked = await window.electronAPI.duplicateFinder.pickRoots()
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

function toggleAll(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  selectedPaths.value = checked ? [...allRemovable.value] : []
}

let currentRunId = 0

function onProgress(p: DuplicateScanProgress): void {
  if (!scanning.value) return
  if (currentRunId !== 0 && p.runId !== currentRunId) return
  currentRunId = p.runId
  progress.value = p
  if (p.finished) scanning.value = false
}

subscribeOnUnmounted(() => window.electronAPI.duplicateFinder.onProgress(onProgress))

async function startScan(): Promise<void> {
  if (scanning.value) return
  if (!roots.value.length) {
    toast.error('请先添加要查找重复文件的目录或盘符')
    return
  }
  scanning.value = true
  currentRunId = 0
  result.value = null
  progress.value = null
  selectedPaths.value = []
  try {
    const r = await window.electronAPI.duplicateFinder.scan([...roots.value])
    currentRunId = r.runId
    result.value = r
    if (r.error) {
      toast.error(r.error)
    } else if (r.cancelled) {
      toast.info('扫描已取消')
    } else if (!r.groups.length) {
      toast.success('未发现重复文件')
    } else {
      toast.success(`发现 ${r.groups.length} 组重复文件`)
    }
  } catch (err) {
    toast.error(`扫描失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    scanning.value = false
  }
}

async function cancelScan(): Promise<void> {
  try {
    await window.electronAPI.duplicateFinder.cancel()
  } catch (err) {
    toast.error(`取消失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function openConfirm(): void {
  if (!selectedPaths.value.length) return
  confirmOpen.value = true
}

async function doClean(): Promise<void> {
  confirmOpen.value = false
  if (cleaning.value) return
  cleaning.value = true
  try {
    const r = await window.electronAPI.duplicateFinder.clean([...selectedPaths.value])
    if (r.removed.length) {
      toast.success(`已删除 ${r.removed.length} 份副本，释放 ${formatSize(r.reclaimedBytes)}`)
    }
    if (r.errors.length) toast.error(`清理失败 ${r.errors.length} 项：${r.errors[0]}`)
    selectedPaths.value = []
  } catch (err) {
    toast.error(`清理失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    cleaning.value = false
  }
}

onBeforeUnmount(() => {
  if (scanning.value) void window.electronAPI.duplicateFinder.cancel()
})
</script>

<style scoped>
.dp-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

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

.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) 0;
  /* 等高填充 + 长列表在卡内滚动 */
  flex: 1;
  min-height: 0;
  max-height: min(52vh, 520px);
  overflow-y: auto;
}

/* 关键：flex 列容器内部滚动时，子项默认会被压缩（含 overflow:hidden 的卡片子项
   min-height 解析为 0），大量重复组会被压成横线；禁止子项收缩，改为整体滚动 */
.panel-body > * {
  flex-shrink: 0;
}

.dp-roots {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.dp-root {
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
  white-space: nowrap;
}

.dp-root__path {
  overflow: hidden;
  text-overflow: ellipsis;
}

.dp-root__x {
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

.dp-root__x:hover:not(:disabled) {
  background: var(--danger-soft);
  color: var(--on-danger);
}

.dp-root__x:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.dp-root__hint {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.dp-progress {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-selected-subtle);
}

.dp-progress__line {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.dp-progress__num {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.dp-progress__path {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.dp-progress__meta {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.dp-summary {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}

.dp-summary__size {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.dp-summary__meta {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.dp-note {
  font-size: var(--text-sm);
  color: var(--on-warning);
  background: var(--warning-soft);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
}

.dp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.dp-check {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--text-secondary);
  cursor: pointer;
}

.dp-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.dp-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-selected-subtle);
  font-size: var(--text-sm);
}

.dp-group__size {
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.dp-group__meta {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.dp-files {
  display: flex;
  flex-direction: column;
}

.dp-file {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-top: 1px solid var(--border);
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.dp-file:hover {
  background: var(--bg-hover);
}

.dp-file.is-keep {
  background: var(--success-soft);
}

.dp-file input {
  accent-color: var(--brand);
}

.dp-file__keep-dot {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}

.dp-file__ic {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.dp-file__main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.dp-file__name {
  font-size: var(--text-base);
  color: var(--text-primary);
  word-break: break-all;
}

.dp-file__path {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dp-file__keep {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--success-soft);
  color: var(--on-success);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.dp-empty {
  padding: var(--sp-5) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.panel-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  margin: var(--sp-1) calc(var(--sp-5) * -1) 0;
  padding: var(--sp-3) var(--sp-5);
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
}

.dp-confirm__text {
  margin: 0;
  font-size: var(--text-base);
  line-height: 1.6;
  color: var(--text-secondary);
}
</style>
