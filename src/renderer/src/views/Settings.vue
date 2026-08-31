<template>
  <div class="settings">
    <header class="settings-header">
      <h1 class="settings-title">设置</h1>
    </header>

    <div class="settings-body">
      <!-- 加载完成前不渲染，避免开关/快捷键等按默认值先渲染再跳到真实值 -->
      <template v-if="settingsLoaded">
        <section class="setting-group">
        <h3 class="group-title">通用</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">开机自启动</div>
            <div class="row-desc">登录系统时自动运行 Prism</div>
          </div>
          <button class="switch" :class="{ 'is-on': settings.autoStart }" type="button" @click="toggle('autoStart')">
            <span class="switch-knob"></span>
          </button>
        </div>
      </section>

      <section class="setting-group">
        <h3 class="group-title">外观</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">主题</div>
            <div class="row-desc">浅色 / 薰衣草 / 白绿（参考图）/ 深色</div>
          </div>
          <div class="cm-pills">
            <UiPillTab
              v-for="t in THEMES"
              :key="t.value"
              :active="settings.theme === t.value"
              @click="setTheme(t.value)"
            >
              {{ t.label }}
            </UiPillTab>
          </div>
        </div>
      </section>

      <section class="setting-group">
        <h3 class="group-title">快捷键</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">显示 / 隐藏主界面</div>
          </div>
          <div class="keycaps">
            <span class="keycap">{{ shortcutLabel(settings.shortcut) }}</span>
          </div>
        </div>
      </section>

      <section class="setting-group">
        <h3 class="group-title">通知</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">通知中心</div>
            <div class="row-desc">总开关：关闭后不再记录与提醒任何通知</div>
          </div>
          <button
            class="switch"
            :class="{ 'is-on': settings.notificationsEnabled }"
            type="button"
            @click="toggle('notificationsEnabled')"
          >
            <span class="switch-knob"></span>
          </button>
        </div>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">剪贴板新内容</div>
            <div class="row-desc">复制新内容时右下角浮窗提醒（不入通知中心，剪贴板历史已有记录）</div>
          </div>
          <button
            class="switch"
            :class="{ 'is-on': settings.notifyClipboard }"
            type="button"
            @click="toggle('notifyClipboard')"
          >
            <span class="switch-knob"></span>
          </button>
        </div>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">更新通知</div>
            <div class="row-desc">发现新版本 / 更新完成 / 检查失败时提醒</div>
          </div>
          <button
            class="switch"
            :class="{ 'is-on': settings.notifyUpdate }"
            type="button"
            @click="toggle('notifyUpdate')"
          >
            <span class="switch-knob"></span>
          </button>
        </div>
      </section>

      <section class="setting-group">
        <h3 class="group-title">数据备份</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">导出备份</div>
            <div class="row-desc">将剪贴板历史、收藏与图片打包为 .prismbackup 文件，便于留存或分享</div>
          </div>
          <button class="btn" type="button" @click="exportBackup">导出</button>
        </div>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">导入备份</div>
            <div class="row-desc">从 .prismbackup 文件恢复记录；合并保留双方，替换则清空后完全导入</div>
          </div>
          <div class="import-actions">
            <div class="cm-pills">
              <UiPillTab
                v-for="m in IMPORT_MODES"
                :key="m.value"
                :active="importMode === m.value"
                @click="importMode = m.value"
              >
                {{ m.label }}
              </UiPillTab>
            </div>
            <button class="btn" type="button" @click="importBackup">导入</button>
          </div>
        </div>
      </section>
      <section class="setting-group">
        <h3 class="group-title">更新</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">检查更新</div>
            <div class="row-desc">当前版本 v{{ updateStatus.currentVersion }}，从 GitHub Releases 自动检查</div>
          </div>
          <button class="btn" type="button" :disabled="updateBusy" @click="checkUpdate">
            {{ updateStatus.status === 'checking' ? '检查中…' : '检查更新' }}
          </button>
        </div>
        <div v-if="updateMessage" class="update-status">{{ updateMessage }}</div>
        <div v-if="updateStatus.status === 'downloading'" class="update-progress">
          <div class="update-progress__track">
            <div class="update-progress__bar" :style="{ width: `${updateStatus.progress ?? 0}%` }"></div>
          </div>
          <span class="update-progress__text">{{ updateStatus.progress ?? 0 }}%</span>
        </div>
        <div v-if="updateStatus.status === 'downloaded'" class="setting-row">
          <div class="row-info">
            <div class="row-name">新版本已就绪</div>
            <div class="row-desc">v{{ updateStatus.version }} 已下载，重启后生效</div>
          </div>
          <button class="btn btn--primary" type="button" @click="installUpdate">安装并重启</button>
        </div>
      </section>

      <section class="setting-group">
        <h3 class="group-title">旧版本（Prism v1）</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">旧版安装检测</div>
            <div class="row-desc">
              <template v-if="cleanup.install.detected">
                已检测到旧版 Prism v{{ cleanup.install.version }}（{{ cleanup.install.installPath }}）<span
                  v-if="cleanup.install.running"
                  >，旧版正在运行，卸载前请先退出</span
                >
              </template>
              <template v-else>未检测到旧版 Prism 安装</template>
            </div>
          </div>
          <div class="import-actions">
            <button
              class="btn btn--primary"
              type="button"
              :disabled="!cleanup.install.detected || uninstallBusy"
              @click="uninstallLegacy"
            >
              {{ uninstallBusy ? '处理中…' : '卸载旧版本' }}
            </button>
            <button class="btn" type="button" @click="refreshCleanup">重新检测</button>
          </div>
        </div>

        <div v-if="cleanup.dataDirs.length" class="legacy-data">
          <div class="legacy-data__title">旧版数据（删除后移入回收站，可恢复）</div>
          <div v-for="dir in cleanup.dataDirs" :key="dir.path" class="legacy-data__dir">
            <div class="legacy-data__dir-head">
              <span class="legacy-data__dir-name">{{ dir.dirName }}</span>
              <span class="legacy-data__dir-size">{{ formatSize(dir.totalSize) }}</span>
              <button
                class="btn btn--danger legacy-data__dir-del"
                type="button"
                @click="requestDeleteDir(dir)"
              >
                删除目录
              </button>
            </div>
          </div>
        </div>
        <div v-else class="legacy-data__empty">未检测到旧版 Prism 数据目录</div>
      </section>
      </template>

      <UiDialog
        :model-value="deleteConfirm"
        title="删除旧版数据"
        @update:model-value="deleteConfirm = false"
      >
        <p class="confirm-text">
          确定将旧版数据目录「{{ deleteDirTarget?.dirName }}」及其中所有内容移入回收站吗？可在回收站中恢复。
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="deleteConfirm = false">取消</UiButton>
          <UiButton variant="danger" @click="confirmDeleteData">移入回收站</UiButton>
        </template>
      </UiDialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import UiPillTab from '@renderer/components/ui/UiPillTab.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import { useToast } from '@renderer/composables/useToast'
import { applyTheme } from '@renderer/composables/useTheme'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type {
  AppSettings,
  BackupImportMode,
  LegacyCleanupState,
  LegacyDataDir,
  UpdateStatusInfo
} from '@preload/ipc'

const toast = useToast()

const settings = ref<AppSettings>({
  shortcut: '',
  snippetShortcut: '',
  searchBoxShortcut: '',
  serverUrl: '',
  autoStart: false,
  updateSource: 'github',
  githubRepo: '',
  clipboardRetentionValue: 1,
  clipboardAutoClean: true,
  clipboardRetentionUnit: 'month',
  notificationsEnabled: true,
  notifyClipboard: true,
  notifyUpdate: true,
  // 主题从当前 DOM 即时取（App 已同步），避免进入设置页等待 settings.get() 期间误显示「浅色」被选中
  theme: (document.documentElement.dataset.theme ?? 'light') as AppSettings['theme']
})

/** 布尔型开关设置键（通用/通知分组内的 switch） */
type ToggleKey = 'autoStart' | 'notificationsEnabled' | 'notifyClipboard' | 'notifyUpdate'

async function toggle(key: ToggleKey): Promise<void> {
  const next = !settings.value[key]
  settings.value[key] = next
  await window.electronAPI.settings.update({ [key]: next })
}

type ThemeValue = 'light' | 'lavender' | 'mint' | 'dark'

const THEMES: { value: ThemeValue; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'lavender', label: '薰衣草（参考图）' },
  { value: 'mint', label: '白绿（参考图）' },
  { value: 'dark', label: '深色' }
]

function setTheme(theme: ThemeValue): void {
  settings.value.theme = theme
  applyTheme(theme)
  void window.electronAPI.settings.update({ theme })
}

function shortcutLabel(acc: string): string {
  return acc.replace(/CommandOrControl/g, 'Ctrl/Cmd').replace(/\+/g, ' ')
}

/** 备份导入合并方式选项 */
const IMPORT_MODES: { value: BackupImportMode; label: string }[] = [
  { value: 'merge', label: '合并' },
  { value: 'replace', label: '替换' }
]

/** 当前选择的导入合并方式 */
const importMode = ref<BackupImportMode>('merge')

/** 导出剪贴板记录备份 */
async function exportBackup(): Promise<void> {
  const r = await window.electronAPI.clipboard.exportBackup()
  if (r.canceled) return
  if (r.ok) {
    toast.success(`已导出：${r.path}（历史 ${r.historyCount}、收藏 ${r.favoriteCount}、图片 ${r.imageCount}）`)
  } else {
    toast.error(`导出失败：${r.error ?? '未知错误'}`)
  }
}

/** 导入剪贴板记录备份（按所选合并方式） */
async function importBackup(): Promise<void> {
  const r = await window.electronAPI.clipboard.importBackup(importMode.value)
  if (r.canceled) return
  if (r.ok) {
    toast.success(
      importMode.value === 'replace'
        ? `已替换导入：历史 ${r.importedHistory}、收藏 ${r.importedFavorites}、图片 ${r.importedImages}`
        : `已合并导入：历史 +${r.importedHistory}（跳过 ${r.skippedHistory}）、收藏 +${r.importedFavorites}（跳过 ${r.skippedFavorites}）、图片 +${r.importedImages}（跳过 ${r.skippedImages}）`
    )
  } else {
    toast.error(`导入失败：${r.error ?? '未知错误'}`)
  }
}

/** 设置是否已从主进程加载完成：加载前不渲染设置项，避免默认值闪现 */
const settingsLoaded = ref(false)

// ---------------------------------------------------------------------------
// 更新
// ---------------------------------------------------------------------------
const updateStatus = ref<UpdateStatusInfo>({ status: 'idle', currentVersion: '' })

const updateBusy = computed(
  () => updateStatus.value.status === 'checking' || updateStatus.value.status === 'downloading'
)

/** 状态行文案（downloaded 时由下方独立区块展示，返回空串） */
const updateMessage = computed(() => {
  const s = updateStatus.value
  switch (s.status) {
    case 'idle':
      return s.message ?? ''
    case 'up-to-date':
      return '已是最新版本'
    case 'available':
      return `发现新版本 v${s.version}，正在下载…`
    case 'error':
      return `更新失败：${s.error ?? '未知错误'}`
    default:
      return ''
  }
})

async function checkUpdate(): Promise<void> {
  updateStatus.value = await window.electronAPI.update.check()
}

function installUpdate(): void {
  void window.electronAPI.update.quitAndInstall()
}

// ---------------------------------------------------------------------------
// 旧版本（Prism v1）检测 / 卸载 / 旧数据清理
// ---------------------------------------------------------------------------
/** 旧版本整体状态（安装 + 数据目录） */
const cleanup = ref<LegacyCleanupState>({
  install: { detected: false, platform: 'win' },
  dataDirs: []
})
const uninstallBusy = ref(false)
/** 删除确认弹窗 */
const deleteConfirm = ref(false)
/** 待删除的旧版数据目录（整目录删除） */
const deleteDirTarget = ref<LegacyDataDir | null>(null)

/** 刷新旧版本检测状态 */
async function refreshCleanup(): Promise<void> {
  cleanup.value = await window.electronAPI.legacyCleanup.getState()
}

/** 字节数格式化为人类可读 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 卸载旧版本（win 静默卸载器 / mac 移入废纸篓） */
async function uninstallLegacy(): Promise<void> {
  if (uninstallBusy.value) return
  uninstallBusy.value = true
  try {
    const r = await window.electronAPI.legacyCleanup.uninstall()
    if (r.ok) {
      const extra = r.residue?.length ? `，已清理 ${r.residue.length} 处系统残留` : ''
      toast.success(
        (r.launched ? '已启动旧版卸载' : '旧版已移入废纸篓') + extra + '，完成后可重新检测确认'
      )
    } else {
      toast.error(`卸载失败：${r.error ?? '未知错误'}`)
    }
  } finally {
    uninstallBusy.value = false
  }
  await refreshCleanup()
}

/** 请求删除整个旧版数据目录（弹确认框） */
function requestDeleteDir(dir: LegacyDataDir): void {
  deleteDirTarget.value = dir
  deleteConfirm.value = true
}

/** 确认删除：整目录移入回收站后刷新 */
async function confirmDeleteData(): Promise<void> {
  const dir = deleteDirTarget.value
  deleteConfirm.value = false
  deleteDirTarget.value = null
  if (!dir) return
  const r = await window.electronAPI.legacyCleanup.deleteData([dir.path])
  if (r.ok) {
    toast.success(`已移入回收站：${dir.dirName}`)
  } else {
    toast.error(`删除失败：${r.error ?? '未知错误'}`)
  }
  await refreshCleanup()
}

onMounted(async () => {
  settings.value = await window.electronAPI.settings.get()
  settingsLoaded.value = true

  // 同步当前更新状态并订阅后续变化
  updateStatus.value = await window.electronAPI.update.getStatus()
  subscribeOnUnmounted(() =>
    window.electronAPI.update.onStatus((info) => {
      updateStatus.value = info
    })
  )

  // 同步旧版本检测状态（安装 + 数据目录）
  await refreshCleanup()
})
</script>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.settings-header {
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
}

.settings-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4) var(--sp-5) var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}

.group-title {
  margin: 0 0 var(--sp-2);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.setting-group {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-2) var(--sp-4);
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

.setting-group:nth-child(2) {
  animation-delay: 60ms;
}

.setting-group:nth-child(3) {
  animation-delay: 120ms;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3) 0;
  border-radius: var(--radius-sm);
  transition: background-color var(--duration-fast) var(--ease-out-soft);
}

.setting-row:hover {
  background: var(--bg-selected-subtle);
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border);
}

.row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.row-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.switch {
  width: 44px;
  height: 24px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--border);
  position: relative;
  transition: background-color var(--duration-base) var(--ease-out-soft);
  padding: 0;
}

.switch.is-on {
  background: var(--brand);
}

.switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-base) var(--ease-out-soft);
}

.switch.is-on .switch-knob {
  transform: translateX(20px);
}

.cm-pills {
  display: flex;
  gap: var(--sp-2);
}

.keycaps {
  display: flex;
  gap: 4px;
}

.keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-surface);
  box-shadow: 0 1px 0 var(--border);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  transition: transform var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
}

.keycap:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px var(--shadow-sm), 0 1px 0 var(--border);
}

.import-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.btn {
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.btn:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn--primary {
  border-color: var(--brand);
  background: var(--brand);
  color: var(--text-on-brand, #fff);
}

.btn--primary:hover {
  color: var(--text-on-brand, #fff);
  filter: brightness(1.05);
}

.btn--danger {
  border-color: var(--danger);
  color: var(--danger);
}

.btn--danger:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(229, 72, 77, 0.1);
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* 旧版本（Prism v1）区块 */
.legacy-data {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3) 0;
}

.legacy-data__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.legacy-data__dir {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.legacy-data__dir-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-selected-subtle);
}

.legacy-data__dir-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.legacy-data__dir-size {
  flex: 1;
  font-size: 12px;
  color: var(--text-muted);
}

.legacy-data__dir-del {
  padding: 3px 10px;
  font-size: 12px;
}

.legacy-data__empty {
  padding: var(--sp-3) 0;
  font-size: 12px;
  color: var(--text-muted);
}

.update-status {
  font-size: 12px;
  color: var(--text-muted);
  padding: 0 0 var(--sp-3);
}

.update-progress {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 18px;
  padding: 0 0 var(--sp-3);
}

.update-progress__track {
  flex: 1;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  overflow: hidden;
}

.update-progress__bar {
  height: 100%;
  border-radius: inherit;
  background: var(--brand);
  transition: width var(--duration-fast) var(--ease-out-soft);
}

.update-progress__text {
  font-size: 11px;
  color: var(--text-muted);
  width: 36px;
  text-align: right;
}
</style>
