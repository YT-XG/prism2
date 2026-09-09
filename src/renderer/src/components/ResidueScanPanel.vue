<template>
  <div class="rp-panel">
    <div class="panel-head">
      <span class="panel-head__ic">
        <ScanSearch :size="18" :stroke-width="1.6" />
      </span>
      <div class="panel-head__info">
        <div class="panel-head__row">
          <div class="panel-head__name">系统残留扫描</div>
          <span v-if="result" class="panel-head__chip num">{{ result.items.length }} 项</span>
        </div>
        <div class="panel-head__desc">
          <template v-if="result">
            预计可释放
            <span class="panel-head__em">{{ formatSize(result.totalReclaimableBytes) }}</span>
            <template v-if="result.platform === 'darwin'">
              ；macOS 无注册表，残留来自卸载后遗留的 ~/Library 文件
            </template>
          </template>
          <template v-else>
            扫描注册表孤儿项（Win）、Prism 相关残留与本应用缓存日志；清理一律移入回收站，注册表删除前会自动导出 .reg 备份
          </template>
        </div>
      </div>
      <div class="panel-head__actions">
        <UiButton v-if="result" variant="ghost" size="sm" @click="openBackupDir">
          备份目录
        </UiButton>
        <UiButton v-if="scanning" variant="ghost" size="sm" @click="cancelScan">停止扫描</UiButton>
        <UiButton variant="primary" size="sm" :disabled="scanning" @click="scan">
          {{ scanning ? '扫描中…' : result ? '重新扫描' : '扫描残留' }}
        </UiButton>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="scanning" class="panel-hint">
        {{ progress ? `${progress.label}…` : '正在扫描…' }}
        <span v-if="progress" class="panel-hint__num">已登记 {{ progress.items }} 项</span>
      </div>

      <template v-if="result && !scanning">
        <div v-if="result.cancelled" class="panel-note">扫描已取消，结果为取消前已完成的阶段。</div>
        <div v-if="!result.items.length" class="panel-empty">
          {{ result.cancelled ? '取消前未发现残留' : '未发现系统残留' }}
        </div>
        <template v-else>
          <div class="panel-toolbar">
            <label class="rp-check rp-check--all">
              <input
                type="checkbox"
                :checked="allSelectableChecked"
                :indeterminate="selectedCount > 0 && !allSelectableChecked"
                @change="toggleAll"
              />
              全选（不含危险项）
            </label>
            <span class="num">{{ selectedCount }} 项已选</span>
          </div>
          <div v-for="group in groups" :key="group.title" class="rp-group">
            <div class="rp-group__title">
              {{ group.title }}
              <span class="rp-group__count num">{{ group.items.length }}</span>
            </div>
            <label
              v-for="item in group.items"
              :key="item.id"
              class="rp-item"
              :class="[`is-${item.risk}`]"
            >
              <input v-model="selectedIds" type="checkbox" :value="item.id" />
              <span class="rp-item__main">
                <span class="rp-item__title">{{ item.title }}</span>
                <span class="rp-item__detail">{{ item.detail }}</span>
                <span v-if="item.size != null" class="rp-item__size num">{{
                  formatSize(item.size)
                }}</span>
              </span>
              <span class="rp-risk" :class="`is-${item.risk}`">{{ RISK_LABEL[item.risk] }}</span>
            </label>
          </div>
          <div class="panel-actions">
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
    </div>

    <UiDialog
      :model-value="confirmOpen"
      title="清理选中的残留"
      @update:model-value="confirmOpen = false"
    >
      <p class="rp-confirm__text">
        将清理 {{ selectedIds.length }} 项，其中<span class="rp-confirm__danger">
          {{ dangerCount }} 项为危险级（含数据或系统键）</span
        >。
      </p>
      <p class="rp-confirm__text">
        文件将移入回收站可恢复；注册表项删除前会自动导出 .reg 备份到应用数据目录。确定继续吗？
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmOpen = false">取消</UiButton>
        <UiButton variant="danger" @click="onConfirmFirst">确认清理</UiButton>
      </template>
    </UiDialog>

    <UiDialog
      :model-value="dangerConfirmOpen"
      title="危险级条目二次确认"
      @update:model-value="dangerConfirmOpen = false"
    >
      <p class="rp-confirm__text">
        以下
        <span class="rp-confirm__danger">{{ dangerTitles.length }} 项为危险级</span
        >（含系统注册表键或应用数据）：
      </p>
      <ul class="rp-danger-list">
        <li v-for="t in dangerTitles" :key="t">{{ t }}</li>
      </ul>
      <p class="rp-confirm__text">
        注册表项已自动导出 .reg 备份、文件入回收站可恢复，但仍可能影响对应软件。确定继续吗？
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="dangerConfirmOpen = false">取消</UiButton>
        <UiButton variant="danger" @click="onConfirmDanger">确认清理危险级条目</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ScanSearch } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import { useToast } from '@renderer/composables/useToast'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type {
  ResidueItem,
  ResidueKind,
  ResidueRisk,
  ResidueScanProgress,
  ResidueScanResult
} from '@preload/ipc'

const toast = useToast()

const RISK_LABEL: Record<ResidueRisk, string> = {
  safe: '安全',
  confirm: '需确认',
  danger: '危险'
}

/** 展示分组：注册表残留 → Prism 系统残留 → 应用缓存与日志 */
const GROUPS: Array<{ title: string; kinds: ResidueKind[] }> = [
  { title: '注册表残留', kinds: ['startup-orphan', 'uninstall-orphan'] },
  { title: 'Prism 系统残留', kinds: ['prism-residue'] },
  { title: '应用缓存与日志', kinds: ['app-cache', 'app-log'] }
]

const result = ref<ResidueScanResult | null>(null)
const scanning = ref(false)
const cleaning = ref(false)
const confirmOpen = ref(false)
const dangerConfirmOpen = ref(false)
const progress = ref<ResidueScanProgress | null>(null)
/** 勾选的条目 id */
const selectedIds = ref<string[]>([])

const groups = computed(() =>
  GROUPS.map((g) => ({
    title: g.title,
    items: (result.value?.items ?? []).filter((it) => g.kinds.includes(it.kind))
  })).filter((g) => g.items.length)
)

const selectedCount = computed(() => selectedIds.value.length)
/** 「全选」只覆盖非危险项（危险项需逐项勾选 + 二次确认） */
const selectableItems = computed(() =>
  (result.value?.items ?? []).filter((it) => it.risk !== 'danger')
)
const allSelectableChecked = computed(
  () =>
    selectableItems.value.length > 0 &&
    selectableItems.value.every((it) => selectedIds.value.includes(it.id))
)
const dangerCount = computed(
  () =>
    selectedIds.value.filter(
      (id) => result.value?.items.find((it) => it.id === id)?.risk === 'danger'
    ).length
)

/** 选中的危险级条目标题（二次确认弹窗逐项列出） */
const dangerTitles = computed(() =>
  selectedIds.value
    .map((id) => result.value?.items.find((it) => it.id === id))
    .filter((it): it is ResidueItem => it !== undefined && it.risk === 'danger')
    .map((it) => it.title)
)

/** 字节数格式化为人类可读 */
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
    result.value = await window.electronAPI.residueScan.scan()
    selectedIds.value = []
    if (result.value.error) toast.error(result.value.error)
  } catch (err) {
    toast.error(`扫描失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    scanning.value = false
  }
}

async function cancelScan(): Promise<void> {
  await window.electronAPI.residueScan.cancel()
}

async function openBackupDir(): Promise<void> {
  try {
    await window.electronAPI.residueScan.openBackupDir()
  } catch {
    toast.error('打开备份目录失败')
  }
}

function toggleAll(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  selectedIds.value = checked ? selectableItems.value.map((it) => it.id) : []
}

function openConfirm(): void {
  if (!selectedIds.value.length) return
  confirmOpen.value = true
}

function onConfirmFirst(): void {
  confirmOpen.value = false
  // 危险级条目（含数据或系统键）需二次确认
  if (dangerCount.value > 0) {
    dangerConfirmOpen.value = true
    return
  }
  void doClean()
}

function onConfirmDanger(): void {
  dangerConfirmOpen.value = false
  void doClean()
}

async function doClean(): Promise<void> {
  if (cleaning.value) return
  cleaning.value = true
  try {
    // 浅拷贝为普通数组：ref 的 .value 是 reactive Proxy，无法结构化克隆过 IPC
    const r = await window.electronAPI.residueScan.clean([...selectedIds.value])
    if (r.cleanedIds.length) {
      toast.success(`已清理 ${r.cleanedIds.length} 项，备份 ${r.backups.length} 份注册表`)
    }
    if (r.errors.length) {
      toast.error(`清理失败 ${r.errors.length} 项：${r.errors[0]}`)
    }
  } catch (err) {
    toast.error(`清理失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    cleaning.value = false
  }
  await scan()
}

subscribeOnUnmounted(() =>
  window.electronAPI.residueScan.onProgress((p) => {
    progress.value = p
    if (p.finished) scanning.value = false
  })
)

onMounted(() => {
  void scan()
})
</script>

<style scoped>
.rp-panel {
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
  background: var(--danger-soft);
  color: var(--on-danger);
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

/* ---------- 卡体 ---------- */
.panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-5);
  /* 长列表在卡内滚动，避免把页面撑高、减少纵向滚轮下滑 */
  max-height: 52vh;
  overflow-y: auto;
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

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.rp-check--all {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--text-secondary);
  cursor: pointer;
}

.rp-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.rp-group__title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.rp-group__count {
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.rp-item {
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

.rp-item:hover {
  background: var(--bg-hover);
}

.rp-item.is-danger {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
}

.rp-item input {
  margin-top: 3px;
  accent-color: var(--brand);
}

.rp-item__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.rp-item__title {
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--text-primary);
  word-break: break-all;
}

.rp-item__detail {
  font-size: var(--text-xs);
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.5;
}

.rp-item__size {
  margin-top: 2px;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.rp-risk {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.rp-risk.is-safe {
  background: var(--success-soft);
  color: var(--on-success);
}

.rp-risk.is-confirm {
  background: var(--warning-soft);
  color: var(--on-warning);
}

.rp-risk.is-danger {
  background: var(--danger-soft);
  color: var(--on-danger);
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--sp-1);
}

.rp-confirm__text {
  margin: 0 0 var(--sp-3);
  font-size: var(--text-base);
  line-height: 1.6;
  color: var(--text-secondary);
}

.rp-danger-list {
  margin: 0 0 var(--sp-3);
  padding-left: var(--sp-4);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
}

.rp-confirm__danger {
  color: var(--on-danger);
  font-weight: var(--font-semibold);
}
</style>
