<template>
  <div class="jc-panel">
    <div class="panel-head">
      <span class="panel-head__ic">
        <Trash2 :size="18" :stroke-width="1.6" />
      </span>
      <div class="panel-head__info">
        <div class="panel-head__row">
          <div class="panel-head__name">系统垃圾清理</div>
          <span v-if="result" class="panel-head__chip num">{{ result.categories.length }} 类</span>
        </div>
        <div class="panel-head__desc">
          <template v-if="result">
            预计可释放
            <span class="panel-head__em num">{{ formatSize(result.totalReclaimableBytes) }}</span>
            ；清理移入回收站可恢复，回收站 / 系统更新缓存需二次确认
          </template>
          <template v-else>
            临时文件、浏览器缓存、应用缓存、更新缓存与崩溃转储；清理移入回收站
          </template>
        </div>
      </div>
      <div class="panel-head__actions">
        <UiButton v-if="scanning" variant="ghost" size="sm" @click="cancelScan">停止扫描</UiButton>
        <UiButton variant="primary" size="sm" :disabled="scanning" @click="scan">
          {{ scanning ? '扫描中…' : result ? '重新扫描' : '扫描垃圾' }}
        </UiButton>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="scanning" class="panel-hint">
        {{ progress ? `${progress.label}…` : '正在扫描…' }}
        <span v-if="progress" class="panel-hint__num num">已登记 {{ progress.items }} 项</span>
      </div>

      <template v-if="result && !scanning">
        <div v-if="result.cancelled" class="panel-note">扫描已取消，结果为取消前已完成的阶段。</div>
        <div v-if="!groups.length" class="panel-empty">
          {{ result.cancelled ? '取消前未发现垃圾' : '未发现可清理的垃圾文件' }}
        </div>
        <template v-else>
          <div v-for="cat in groups" :key="cat.category" class="jc-group">
            <button
              type="button"
              class="jc-group__head"
              :aria-expanded="!collapsedCats.has(cat.category)"
              @click="toggleCat(cat.category)"
            >
              <span class="jc-group__head-main">
                <ChevronDown
                  :size="15"
                  :stroke-width="1.7"
                  class="jc-group__chevron"
                  :class="{ 'is-collapsed': collapsedCats.has(cat.category) }"
                />
                <span class="jc-group__title">
                  {{ cat.title }}
                  <span class="jc-group__count num">{{ cat.items.length }}</span>
                </span>
              </span>
              <span v-if="cat.totalBytes" class="jc-group__size num">
                {{ formatSize(cat.totalBytes) }}
              </span>
            </button>
            <template v-if="!collapsedCats.has(cat.category)">
              <label
                v-for="item in cat.items"
                :key="item.id"
                class="jc-item"
                :class="[`is-${item.risk}`, { 'is-dir': item.isDir }]"
              >
                <input v-model="selectedIds" type="checkbox" :value="item.id" />
                <span class="jc-item__main">
                  <span class="jc-item__title">{{ item.title }}</span>
                  <span class="jc-item__detail">{{ item.path }}</span>
                </span>
                <span v-if="item.size != null" class="jc-item__size num">{{
                  formatSize(item.size)
                }}</span>
                <span v-if="item.risk === 'confirm'" class="jc-risk is-confirm">需确认</span>
              </label>
            </template>
          </div>
          <div class="panel-bar">
            <label class="jc-check jc-check--all">
              <input
                type="checkbox"
                :checked="allSelectableChecked"
                :indeterminate="selectedCount > 0 && !allSelectableChecked"
                @change="toggleAll"
              />
              全选安全项
            </label>
            <span class="panel-bar__count num">{{ selectedCount }} 项已选</span>
            <UiButton
              variant="danger"
              size="sm"
              :disabled="cleaning || !selectedIds.length"
              @click="openConfirm"
            >
              {{ cleaning ? '清理中…' : `清理选中（${selectedIds.length}）` }}
            </UiButton>
          </div>
        </template>
      </template>

      <UiEmptyState
        v-else-if="!scanning"
        title="尚未扫描系统垃圾"
        hint="扫描临时文件、浏览器缓存、应用缓存等，清理移入回收站"
      >
        <template #action>
          <UiButton variant="primary" size="sm" @click="scan">扫描垃圾</UiButton>
        </template>
      </UiEmptyState>
    </div>

    <UiDialog
      :model-value="confirmOpen"
      title="清理选中的垃圾"
      @update:model-value="confirmOpen = false"
    >
      <p class="jc-confirm__text">
        将清理 {{ selectedIds.length }} 项，其中<span class="jc-confirm__danger">
          {{ confirmCount }} 项为需确认项</span
        >（含回收站 / 系统更新缓存 / 崩溃转储）。
      </p>
      <p class="jc-confirm__text">
        常规文件与缓存将移入回收站可恢复；回收站清空为永久删除，更新缓存可能使系统下次更新重新下载。确定继续吗？
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmOpen = false">取消</UiButton>
        <UiButton variant="danger" @click="doClean">确认清理</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2, ChevronDown } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import { useToast } from '@renderer/composables/useToast'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type { JunkScanItem, JunkScanProgress, JunkScanResult } from '@preload/ipc'

const toast = useToast()

const result = ref<JunkScanResult | null>(null)
const scanning = ref(false)
const cleaning = ref(false)
const confirmOpen = ref(false)
const progress = ref<JunkScanProgress | null>(null)
const selectedIds = ref<string[]>([])
/** 已折叠的分类（点击分组标题折叠/展开） */
const collapsedCats = ref<Set<string>>(new Set())

const groups = computed(() => (result.value?.categories ?? []).filter((c) => c.items.length))

function toggleCat(cat: string): void {
  const next = new Set(collapsedCats.value)
  if (next.has(cat)) next.delete(cat)
  else next.add(cat)
  collapsedCats.value = next
}

const selectedCount = computed(() => selectedIds.value.length)
/** 「全选」只覆盖安全项（需确认项逐项勾选 + 二次确认） */
const selectableItems = computed(() =>
  (result.value?.categories ?? [])
    .flatMap((c) => c.items)
    .filter((it) => it.risk === 'safe')
)
const allSelectableChecked = computed(
  () =>
    selectableItems.value.length > 0 &&
    selectableItems.value.every((it) => selectedIds.value.includes(it.id))
)
const confirmCount = computed(
  () =>
    selectedIds.value.filter(
      (id) => findItem(id)?.risk === 'confirm'
    ).length
)

function findItem(id: string): JunkScanItem | undefined {
  return (result.value?.categories ?? [])
    .flatMap((c) => c.items)
    .find((it) => it.id === id)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function scan(): Promise<void> {
  if (scanning.value) return
  scanning.value = true
  progress.value = null
  try {
    result.value = await window.electronAPI.junkClean.scan()
    selectedIds.value = []
    if (result.value.error) toast.error(result.value.error)
  } catch (err) {
    toast.error(`扫描失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    scanning.value = false
  }
}

async function cancelScan(): Promise<void> {
  await window.electronAPI.junkClean.cancel()
}

function toggleAll(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  selectedIds.value = checked ? selectableItems.value.map((it) => it.id) : []
}

function openConfirm(): void {
  if (!selectedIds.value.length) return
  confirmOpen.value = true
}

async function doClean(): Promise<void> {
  confirmOpen.value = false
  if (cleaning.value) return
  cleaning.value = true
  try {
    const r = await window.electronAPI.junkClean.clean([...selectedIds.value])
    if (r.cleanedIds.length) {
      toast.success(`已清理 ${r.cleanedIds.length} 项，释放 ${formatSize(r.reclaimedBytes)}`)
    }
    if (r.errors.length) toast.error(`清理失败 ${r.errors.length} 项：${r.errors[0]}`)
  } catch (err) {
    toast.error(`清理失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    cleaning.value = false
  }
  await scan()
}

subscribeOnUnmounted(() =>
  window.electronAPI.junkClean.onProgress((p) => {
    progress.value = p
    if (p.finished) scanning.value = false
  })
)
</script>

<style scoped>
.jc-panel {
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
  background: var(--accent-mint);
  color: var(--text-on-accent-mint);
}

.panel-head__info {
  min-width: 0;
  flex: 1;
}

.panel-head__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.panel-head__name {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.panel-head__chip {
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.panel-head__desc {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.panel-head__em {
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
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

/* 关键：flex 列容器内部滚动时子项会被压缩（含 overflow:hidden 的卡片子项
   min-height 解析为 0），列表会被压成横线；禁止子项收缩，改为整体滚动 */
.panel-body > * {
  flex-shrink: 0;
}

.panel-hint {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.panel-hint__num {
  font-variant-numeric: tabular-nums;
}

.panel-empty {
  padding: var(--sp-6) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.panel-note {
  font-size: var(--text-sm);
  color: var(--on-warning);
  background: var(--warning-soft);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
}

.panel-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-1) calc(var(--sp-5) * -1) 0;
  padding: var(--sp-3) var(--sp-5) var(--sp-3);
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
}

.panel-bar__count {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.jc-check--all {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--text-secondary);
  cursor: pointer;
}

.jc-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.jc-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-1) 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: color var(--duration-fast) var(--ease-out-soft);
}

.jc-group__head:hover {
  color: var(--text-primary);
}

.jc-group__head:focus-visible {
  outline: none;
  box-shadow: var(--ring);
  border-radius: var(--radius-sm);
}

.jc-group__head-main {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}

.jc-group__chevron {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform var(--duration-base) var(--ease-out-soft);
}

.jc-group__chevron.is-collapsed {
  transform: rotate(-90deg);
}

.jc-group__title {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.jc-group__count {
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.jc-group__size {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.jc-item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft);
}

.jc-item:hover {
  background: var(--bg-hover);
}

.jc-item.is-confirm {
  border-color: color-mix(in srgb, var(--warning) 30%, var(--border));
}

.jc-item input {
  margin-top: 3px;
  accent-color: var(--brand);
}

.jc-item__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.jc-item__title {
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--text-primary);
  word-break: break-all;
}

.jc-item__detail {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.5;
}

.jc-item__size {
  margin-top: 2px;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.jc-risk {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.jc-risk.is-confirm {
  background: var(--warning-soft);
  color: var(--on-warning);
}

.jc-confirm__text {
  margin: 0 0 var(--sp-3);
  font-size: var(--text-base);
  line-height: 1.6;
  color: var(--text-secondary);
}

.jc-confirm__danger {
  color: var(--on-danger);
  font-weight: var(--font-semibold);
}
</style>
