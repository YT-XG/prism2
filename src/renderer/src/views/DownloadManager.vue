<template>
  <div class="download">
    <header class="download-header">
      <h1 class="download-title">下载管理</h1>
    </header>

    <!-- 新建下载 -->
    <section class="new-download">
      <div class="new-download__row">
        <UiInput v-model="url" placeholder="输入下载链接（http/https）" :label="'下载链接'" class="new-download__url">
          <template #leading><Link :size="15" :stroke-width="1.6" /></template>
        </UiInput>
        <div class="new-download__threads">
          <label class="field-label" for="dl-threads">线程</label>
          <select id="dl-threads" v-model.number="threads" class="threads-select">
            <option v-for="t in [1, 2, 4, 8, 16]" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
      </div>
      <div class="new-download__row new-download__row--actions">
        <button type="button" class="path-toggle" @click="chooseSavePath">
          <FolderOpen :size="14" :stroke-width="1.6" />
          <span class="path-toggle__text">{{ savePath || (activeDir ? `默认目录 · ${activeDir}` : '默认下载目录') }}</span>
        </button>
        <div class="new-download__start">
          <UiButton :disabled="!canStart" @click="startDownload">开始下载</UiButton>
        </div>
      </div>
    </section>

    <!-- 任务列表 -->
    <section class="task-list" aria-label="下载任务列表" :aria-busy="loading">
      <div v-if="loading" class="loading">
        <UiEmptyState title="正在加载下载任务…" variant="loading" />
      </div>

      <div v-else-if="!tasks.length" class="empty">
        <UiEmptyState title="暂无下载任务" hint="粘贴链接开始一个多线程下载">
          <template #icon><Download :size="28" :stroke-width="1.5" /></template>
        </UiEmptyState>
      </div>

      <div v-else class="tasks">
        <article
          v-for="task in tasks"
          :key="task.id"
          class="task"
          :class="`task--${task.status}`"
        >
          <div class="task__main">
            <div class="task__name-row">
              <span class="task__file" :title="task.url">{{ task.fileName }}</span>
              <UiStatusChip :variant="statusMeta[task.status].variant">
                {{ statusMeta[task.status].label }}
              </UiStatusChip>
            </div>
            <div class="task__url" :title="task.url">{{ task.url }}</div>

            <div v-if="task.status === 'downloading' || task.status === 'paused'" class="task__progress">
              <div class="task__bar" role="progressbar" :aria-valuenow="progressPercent(task)" aria-valuemin="0" aria-valuemax="100">
                <div class="task__bar-fill" :style="{ width: progressPercent(task) + '%' }"></div>
              </div>
            </div>

            <div class="task__meta num">
              <span class="task__size">{{ sizeText(task) }}</span>
              <template v-if="task.status === 'downloading'">
                <span class="dot">·</span>
                <span class="task__speed">{{ speedText(task.speedBytesPerSecond) }}</span>
                <span v-if="task.estimatedFinishAt" class="task__eta">剩余 {{ etaText(task.estimatedFinishAt) }}</span>
              </template>
              <span v-if="task.errorMessage" class="task__err">{{ task.errorMessage }}</span>
            </div>
          </div>

          <div class="task__actions">
            <button
              v-if="task.status === 'downloading'"
              type="button"
              class="task-btn"
              title="暂停"
              @click="pauseTask(task.id)"
            >
              <Pause :size="15" :stroke-width="1.6" />
            </button>
            <button
              v-if="task.status === 'paused'"
              type="button"
              class="task-btn"
              title="继续"
              @click="resumeTask(task.id)"
            >
              <Play :size="15" :stroke-width="1.6" />
            </button>
            <button
              v-if="task.status === 'downloading' || task.status === 'paused'"
              type="button"
              class="task-btn"
              title="取消"
              @click="cancelTask(task.id)"
            >
              <X :size="15" :stroke-width="1.6" />
            </button>
            <button
              v-if="task.status !== 'downloading' && task.status !== 'paused'"
              type="button"
              class="task-btn task-btn--danger"
              title="移除"
              @click="removeTask(task.id)"
            >
              <Trash2 :size="15" :stroke-width="1.6" />
            </button>
            <button
              type="button"
              class="task-btn"
              title="打开文件所在目录"
              @click="openFolder(task.savePath)"
            >
              <FolderOpen :size="15" :stroke-width="1.6" />
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- 活跃下载计数（屏幕阅读器上下文播报，不裸报数字） -->
    <p class="sr-live" role="status" aria-atomic="true">{{ liveStatusText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Download, FolderOpen, Link, Pause, Play, Trash2, X } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiInput from '@renderer/components/ui/UiInput.vue'
import UiStatusChip from '@renderer/components/ui/UiStatusChip.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import { useToast } from '@renderer/composables/useToast'
import type { DownloadTaskSnapshot, DownloadTaskStatus } from '@preload/ipc'

const toast = useToast()

const tasks = ref<DownloadTaskSnapshot[]>([])
const url = ref('')
const threads = ref(8)
/** 保存路径 override；空 = 使用默认下载目录 */
const savePath = ref('')
/** 默认下载目录（只读展示） */
const activeDir = ref('')
const loading = ref(true)

/** 状态 → 徽标（语义色 token 映射） */
const statusMeta: Record<DownloadTaskStatus, { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  downloading: { label: '下载中', variant: 'info' },
  paused: { label: '已暂停', variant: 'warning' },
  completed: { label: '已完成', variant: 'success' },
  failed: { label: '失败', variant: 'danger' },
  canceled: { label: '已取消', variant: 'neutral' }
}

const activeCount = computed(
  () => tasks.value.filter((t) => t.status === 'downloading' || t.status === 'paused').length
)
/** 活跃任务上下文状态（屏幕阅读器友好） */
const liveStatusText = computed(() => {
  if (!tasks.value.length) return '暂无下载任务'
  return `共 ${tasks.value.length} 个任务，其中 ${activeCount.value} 个活跃`
})

const canStart = computed(() => url.value.trim().length > 0)

function progressPercent(task: DownloadTaskSnapshot): number {
  if (task.totalBytes <= 0) return 0
  // 保持细粒度（不取整），配合 CSS 过渡让进度条平滑线性增长
  return Math.min(100, (task.downloadedBytes / task.totalBytes) * 100)
}

// ---------------------------------------------------------------------------
// 任务数据
// ---------------------------------------------------------------------------

async function refreshTasks(): Promise<void> {
  tasks.value = await window.electronAPI.download.list()
  if (!activeDir.value) activeDir.value = await window.electronAPI.download.getDefaultDir()
}

/** 任务更新：按 id 原地替换（对已移除任务的迟发广播用 filter 兜底） */
function upsertTask(task: DownloadTaskSnapshot): void {
  const idx = tasks.value.findIndex((t) => t.id === task.id)
  if (idx >= 0) {
    tasks.value[idx] = task
  } else {
    tasks.value.unshift(task)
  }
}

// ---------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------

async function startDownload(): Promise<void> {
  const link = url.value.trim()
  if (!link) return
  const r = await window.electronAPI.download.start({
    url: link,
    savePath: savePath.value.trim() || undefined,
    threads: threads.value
  })
  if (r.ok) {
    toast.success('已开始下载')
    upsertTask(r.task)
    url.value = ''
    savePath.value = ''
  } else {
    toast.error(`启动失败：${r.message}`)
  }
}

async function chooseSavePath(): Promise<void> {
  const suggested = url.value.trim() ? suggestedName(url.value) : undefined
  const p = await window.electronAPI.download.pickSavePath(suggested)
  if (p) {
    savePath.value = p
    toast.info('已选择保存位置')
  }
}

/** 从下载链接推断建议文件名 */
function suggestedName(raw: string): string {
  try {
    const pathname = new URL(raw).pathname
    const name = pathname.split('/').filter(Boolean).pop()
    return name ? decodeURIComponent(name) : 'download'
  } catch {
    return 'download'
  }
}

async function pauseTask(id: string): Promise<void> {
  await window.electronAPI.download.pause(id)
}
async function resumeTask(id: string): Promise<void> {
  const r = await window.electronAPI.download.resume(id)
  if (!r.ok) toast.error(`继续失败：${r.message}`)
}
async function cancelTask(id: string): Promise<void> {
  await window.electronAPI.download.cancel(id)
  toast.info('已取消下载')
}
async function removeTask(id: string): Promise<void> {
  const ok = await window.electronAPI.download.remove(id)
  if (ok) {
    tasks.value = tasks.value.filter((t) => t.id !== id)
    toast.success('已移除任务')
  }
}

/** 打开文件所在目录（shell.showItemInFolder，主进程执行） */
async function openFolder(path: string): Promise<void> {
  await window.electronAPI.download.openFolder(path)
}

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

function sizeText(task: DownloadTaskSnapshot): string {
  if (task.totalBytes <= 0) return `${formatBytes(task.downloadedBytes)}`
  return `${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}`
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

function speedText(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

function etaText(finishAt: number): string {
  const remain = Math.max(0, Math.round((finishAt - Date.now()) / 1000))
  const s = remain % 60
  const m = Math.floor(remain / 60) % 60
  const h = Math.floor(remain / 3600)
  if (h > 0) return `${h}小时${m}分`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

onMounted(async () => {
  await refreshTasks()
  loading.value = false
  // 订阅任务更新（返回清理函数，卸载自动取消）
  subscribeOnUnmounted(() =>
    window.electronAPI.download.onTaskUpdated((task) => {
      upsertTask(task)
    })
  )
  // 窗口重新显示时刷新：隐藏期间 onlyVisible 广播被跳过，避免「下载完成后进度卡在旧值」等陈旧状态
  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', () => {
      void refreshTasks()
    })
  )
})
</script>

<style scoped>
.download {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--sp-4) var(--sp-5) var(--sp-5);
  overflow: hidden;
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

.download-header {
  display: flex;
  align-items: center;
  padding: 0 var(--sp-1) var(--sp-3);
}

.download-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

/* 新建下载 */
.new-download {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.new-download__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.new-download__url {
  flex: 1;
}

.new-download__threads {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
}

.field-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  white-space: nowrap;
}

.threads-select {
  height: 36px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

.new-download__row--actions {
  justify-content: space-between;
}

.path-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: var(--sp-1) var(--sp-1);
  border-radius: var(--radius-sm);
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.path-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.path-toggle__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}

.new-download__start {
  flex-shrink: 0;
}

/* 任务列表 */
.task-list {
  flex: 1;
  min-height: 0;
  margin-top: var(--sp-4);
  overflow-y: auto;
}

.loading,
.empty {
  padding-top: var(--sp-8);
}

.tasks {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.task {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: border-color var(--duration-base) var(--ease-out-soft),
    box-shadow var(--duration-base) var(--ease-out-soft);
}

.task:hover {
  border-color: color-mix(in srgb, var(--brand) 30%, var(--border));
}

.task--failed {
  border-color: color-mix(in srgb, var(--danger) 30%, var(--border));
}

.task__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.task__name-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.task__file {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task__url {
  font-size: var(--text-sm);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task__progress {
  margin-top: 2px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-selected-subtle);
  overflow: hidden;
}

.task__bar {
  height: 100%;
}

.task__bar-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--brand);
  transition: width var(--duration-base) var(--ease-out-soft);
}

.task__meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.task__meta .dot {
  color: var(--text-muted);
}

.task__speed {
  color: var(--brand);
}

.task__eta {
  color: var(--text-muted);
}

.task__err {
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.task-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.task-btn:hover {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
}

.task-btn--danger:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

/* 屏幕阅读器专用 */
.sr-live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
