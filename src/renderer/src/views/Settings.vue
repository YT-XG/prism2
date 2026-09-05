<template>
  <div class="settings">
    <header class="settings-header">
      <h1 class="settings-title">设置</h1>
    </header>

    <div class="settings-body">
      <!-- 加载完成前不渲染，避免开关/快捷键等按默认值先渲染再跳到真实值 -->
      <template v-if="settingsLoaded">
        <!-- macOS 专属：自动粘贴依赖「辅助功能」权限，引导用户授权 -->
        <div v-if="platform === 'darwin'" class="mac-hint">
          <div class="mac-hint__info">
            <div class="mac-hint__title">macOS 需要「辅助功能」权限</div>
            <div class="mac-hint__desc">
              点击剪贴板历史项时通过 AppleScript 模拟按键自动粘贴；未授权时粘贴不会生效。
            </div>
          </div>
          <button class="btn" type="button" @click="openAccessibility">打开系统设置</button>
        </div>

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
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">全局搜索</div>
            <div class="row-desc">任意界面按下即可唤起全局搜索；点击右侧修改，Backspace 清除</div>
          </div>
          <UiShortcutRecorder
            :model-value="settings.searchBoxShortcut"
            @update:model-value="saveSearchBoxShortcut"
          />
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
        <h3 class="group-title">邮箱大师</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">新邮件通知</div>
            <div class="row-desc">收到新邮件时右下角浮窗提醒（记入通知中心）</div>
          </div>
          <button
            class="switch"
            :class="{ 'is-on': settings.notifyMail }"
            type="button"
            @click="toggle('notifyMail')"
          >
            <span class="switch-knob"></span>
          </button>
        </div>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">同步间隔</div>
            <div class="row-desc">后台自动检查新邮件的间隔（分钟，1-60）</div>
          </div>
          <input
            class="num-input"
            type="number"
            min="1"
            max="60"
            step="1"
            :value="settings.mailPollIntervalMin"
            aria-label="同步间隔（分钟）"
            @change="savePollInterval"
          />
        </div>
      </section>

      <section class="setting-group">
        <h3 class="group-title">数据备份</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">导出备份</div>
            <div class="row-desc">将剪贴板历史、片段收藏与图片、便利贴、快捷文件夹打包为 .prismbackup 文件，导出前可勾选数据类别</div>
          </div>
          <button class="btn" type="button" @click="exportBackup">导出</button>
        </div>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">导入备份</div>
            <div class="row-desc">从 .prismbackup 文件恢复数据；可勾选要导入的类别，合并保留双方，替换则清空所选类别后完全导入</div>
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
            <div class="row-desc">当前版本 v{{ updateStatus.currentVersion }}，自动从更新源检查</div>
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

      <section class="setting-group">
        <h3 class="group-title">日志</h3>
        <div class="setting-row">
          <div class="row-info">
            <div class="row-name">查看日志</div>
            <div class="row-desc">运行日志文件：{{ logFilePath }}</div>
          </div>
          <div class="row-actions">
            <button class="btn" type="button" :disabled="logBusy" @click="openLogFile">打开日志</button>
            <button class="btn" type="button" :disabled="logBusy" @click="openLogDirectory">打开所在文件夹</button>
          </div>
        </div>
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

      <UiDialog
        :model-value="backupDialog !== null"
        :title="backupDialog === 'export' ? '导出备份' : '导入备份'"
        :overlay-close="false"
        @update:model-value="backupDialog = null"
      >
        <p class="backup-dialog__hint">
          {{ backupDialog === 'export' ? '选择要导出到 .prismbackup 文件的数据类别：' : '该备份文件中包含以下数据，选择要导入的类别：' }}
        </p>
        <div class="backup-dialog__options">
          <label
            v-for="opt in BACKUP_OPTIONS"
            :key="opt.section"
            class="backup-option"
            :class="{ 'is-disabled': backupDialog === 'import' && !importAvailable.includes(opt.section) }"
          >
            <input
              type="checkbox"
              class="backup-option__check"
              :checked="backupSelected.includes(opt.section)"
              :disabled="backupDialog === 'import' && !importAvailable.includes(opt.section)"
              @change="toggleBackupSection(opt.section, ($event.target as HTMLInputElement).checked)"
            />
            <span class="backup-option__info">
              <span class="backup-option__name">{{ opt.label }}</span>
              <span class="backup-option__desc">{{ opt.desc }}</span>
            </span>
          </label>
        </div>
        <template #footer>
          <UiButton variant="ghost" @click="backupDialog = null">取消</UiButton>
          <UiButton variant="primary" :disabled="backupSelected.length === 0" @click="confirmBackup">
            {{ backupDialog === 'export' ? '导出' : '导入' }}
          </UiButton>
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
import UiShortcutRecorder from '@renderer/components/ui/UiShortcutRecorder.vue'
import { useToast } from '@renderer/composables/useToast'
import { applyTheme } from '@renderer/composables/useTheme'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type {
  AppSettings,
  BackupImportMode,
  BackupSection,
  LegacyCleanupState,
  LegacyDataDir,
  UpdateStatusInfo
} from '@preload/ipc'

const toast = useToast()

/** 当前平台（mac 上显示「辅助功能」引导横幅等） */
const platform = window.electronAPI.platform

/** 打开 macOS「辅助功能」系统设置面板（模拟粘贴授权引导） */
async function openAccessibility(): Promise<void> {
  const r = await window.electronAPI.settings.openAccessibilitySettings()
  if (!r.ok) toast.error(`打开设置失败：${r.error ?? '未知错误'}`)
}

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
  notifyMail: true,
  mailPollIntervalMin: 1,
  // 主题从当前 DOM 即时取（App 已同步），避免进入设置页等待 settings.get() 期间误显示「浅色」被选中
  theme: (document.documentElement.dataset.theme ?? 'light') as AppSettings['theme']
})

/** 布尔型开关设置键（通用/通知/邮箱分组内的 switch） */
type ToggleKey =
  | 'autoStart'
  | 'notificationsEnabled'
  | 'notifyClipboard'
  | 'notifyUpdate'
  | 'notifyMail'

async function toggle(key: ToggleKey): Promise<void> {
  const next = !settings.value[key]
  settings.value[key] = next
  await window.electronAPI.settings.update({ [key]: next })
}

/** 保存邮箱轮询同步间隔（分钟，1-60；非法输入回退当前值） */
async function savePollInterval(e: Event): Promise<void> {
  const raw = Number((e.target as HTMLInputElement).value)
  const min = Number.isFinite(raw) && raw >= 1 ? Math.min(60, Math.round(raw)) : settings.value.mailPollIntervalMin
  settings.value.mailPollIntervalMin = min
  await window.electronAPI.settings.update({ mailPollIntervalMin: min })
  toast.success(`邮件同步间隔已设为 ${min} 分钟`)
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

/** 保存全局搜索快捷键（空串 = 清除，等价于关闭） */
async function saveSearchBoxShortcut(value: string): Promise<void> {
  settings.value.searchBoxShortcut = value
  await window.electronAPI.settings.update({ searchBoxShortcut: value })
  toast.success(value ? `全局搜索快捷键已设为 ${shortcutLabel(value)}` : '已清除全局搜索快捷键')
}

/** 备份导入合并方式选项 */
const IMPORT_MODES: { value: BackupImportMode; label: string }[] = [
  { value: 'merge', label: '合并' },
  { value: 'replace', label: '替换' }
]

/** 当前选择的导入合并方式 */
const importMode = ref<BackupImportMode>('merge')

/** 备份数据分区选项（导出/导入勾选弹窗展示） */
const BACKUP_OPTIONS: { section: BackupSection; label: string; desc: string }[] = [
  { section: 'clipboard', label: '剪贴板数据', desc: '历史记录、片段收藏与图片' },
  { section: 'stickyNotes', label: '便利贴', desc: '全部便利贴（含贴主页的便签）' },
  { section: 'quickFolders', label: '快捷文件夹', desc: '主页快捷打开的文件夹列表' }
]

/** 当前备份勾选弹窗：export=导出 / import=导入 / null=关闭 */
const backupDialog = ref<'export' | 'import' | null>(null)
/** 弹窗内用户勾选的数据分区 */
const backupSelected = ref<BackupSection[]>([])
/** 导入弹窗中备份文件实际可用的分区（其余项置灰禁用） */
const importAvailable = ref<BackupSection[]>([])
/** 导入弹窗选中的备份文件路径（inspectBackup 返回，确认导入时回传） */
const importBackupPath = ref('')

/** 勾选 / 取消某个备份分区 */
function toggleBackupSection(section: BackupSection, on: boolean): void {
  backupSelected.value = on
    ? [...backupSelected.value, section]
    : backupSelected.value.filter((s) => s !== section)
}

/** 导出：弹出勾选列表（默认全选），确认后导出所选分区 */
function exportBackup(): void {
  backupSelected.value = BACKUP_OPTIONS.map((o) => o.section)
  importAvailable.value = []
  backupDialog.value = 'export'
}

/** 导入：先选文件并检查备份内容，再弹出可用分区勾选列表 */
async function importBackup(): Promise<void> {
  const r = await window.electronAPI.clipboard.inspectBackup()
  if (r.canceled) return
  if (!r.ok || !r.path) {
    toast.error(`导入失败：${r.error ?? '未知错误'}`)
    return
  }
  importBackupPath.value = r.path
  importAvailable.value = r.sections ?? []
  backupSelected.value = [...importAvailable.value]
  backupDialog.value = 'import'
}

/** 备份勾选弹窗确认：按当前模式（导出/导入）执行 */
async function confirmBackup(): Promise<void> {
  const mode = backupDialog.value
  if (!mode) return
  const sections = backupSelected.value
  backupDialog.value = null
  if (sections.length === 0) return

  if (mode === 'export') {
    // 传普通数组副本（ref 的 value 是响应式 Proxy，直接过 IPC 结构化克隆会失败）
    const r = await window.electronAPI.clipboard.exportBackup([...sections])
    if (r.canceled) return
    if (r.ok) {
      const parts: string[] = []
      if (sections.includes('clipboard')) {
        parts.push(`历史 ${r.historyCount ?? 0}、收藏 ${r.favoriteCount ?? 0}、图片 ${r.imageCount ?? 0}`)
      }
      if (sections.includes('stickyNotes')) parts.push(`便利贴 ${r.stickyNoteCount ?? 0}`)
      if (sections.includes('quickFolders')) parts.push(`快捷文件夹 ${r.quickFolderCount ?? 0}`)
      toast.success(`已导出：${r.path}（${parts.join('、')}）`)
    } else {
      toast.error(`导出失败：${r.error ?? '未知错误'}`)
    }
    return
  }

  const r = await window.electronAPI.clipboard.importBackup(
    importBackupPath.value,
    [...sections],
    importMode.value
  )
  if (r.canceled) return
  if (r.ok) {
    const parts: string[] = []
    if (importMode.value === 'replace') {
      if (sections.includes('clipboard')) {
        parts.push(`历史 ${r.importedHistory ?? 0}、收藏 ${r.importedFavorites ?? 0}、图片 ${r.importedImages ?? 0}`)
      }
      if (sections.includes('stickyNotes')) parts.push(`便利贴 ${r.importedStickyNotes ?? 0}`)
      if (sections.includes('quickFolders')) parts.push(`快捷文件夹 ${r.importedQuickFolders ?? 0}`)
      toast.success(`已替换导入：${parts.join('、')}`)
    } else {
      if (sections.includes('clipboard')) {
        parts.push(
          `历史 +${r.importedHistory ?? 0}（跳过 ${r.skippedHistory ?? 0}）、收藏 +${r.importedFavorites ?? 0}（跳过 ${r.skippedFavorites ?? 0}）、图片 +${r.importedImages ?? 0}（跳过 ${r.skippedImages ?? 0}）`
        )
      }
      if (sections.includes('stickyNotes')) {
        parts.push(`便利贴 +${r.importedStickyNotes ?? 0}（跳过 ${r.skippedStickyNotes ?? 0}）`)
      }
      if (sections.includes('quickFolders')) {
        parts.push(`快捷文件夹 +${r.importedQuickFolders ?? 0}（跳过 ${r.skippedQuickFolders ?? 0}）`)
      }
      toast.success(`已合并导入：${parts.join('、')}`)
    }
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

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------
/** 日志文件完整路径（展示用） */
const logFilePath = ref('')
const logBusy = ref(false)

/** 用系统默认程序打开日志文件 */
async function openLogFile(): Promise<void> {
  if (logBusy.value) return
  logBusy.value = true
  try {
    const r = await window.electronAPI.log.openFile()
    if (r.ok) {
      toast.success('已打开日志文件')
    } else {
      toast.error(`打开日志失败：${r.error ?? '未知错误'}`)
    }
  } finally {
    logBusy.value = false
  }
}

/** 用系统默认程序打开日志文件所在目录 */
async function openLogDirectory(): Promise<void> {
  if (logBusy.value) return
  logBusy.value = true
  try {
    const r = await window.electronAPI.log.openDirectory()
    if (r.ok) {
      toast.success('已打开日志所在文件夹')
    } else {
      toast.error(`打开日志目录失败：${r.error ?? '未知错误'}`)
    }
  } finally {
    logBusy.value = false
  }
}

onMounted(async () => {
  settings.value = await window.electronAPI.settings.get()
  settingsLoaded.value = true

  logFilePath.value = await window.electronAPI.log.getPath()

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

.mac-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-selected-subtle);
}

.mac-hint__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.mac-hint__desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
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

/* 数字输入（邮箱同步间隔等） */
.num-input {
  width: 72px;
  height: 32px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  text-align: center;
  flex-shrink: 0;
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
}

.num-input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: var(--ring);
}

/* 行内操作按钮组：多个按钮靠右相邻排布，避免被 space-between 拆散 */
.row-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-shrink: 0;
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

/* 备份导出/导入勾选弹窗 */
.backup-dialog__hint {
  margin: 0 0 var(--sp-3);
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}

.backup-dialog__options {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.backup-option {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft);
}

.backup-option:hover {
  background: var(--bg-selected-subtle);
  border-color: var(--border-strong, var(--border));
}

.backup-option.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.backup-option.is-disabled:hover {
  background: transparent;
}

.backup-option__check {
  margin-top: 2px;
  width: 15px;
  height: 15px;
  accent-color: var(--brand);
  cursor: inherit;
}

.backup-option__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.backup-option__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.backup-option__desc {
  font-size: 12px;
  color: var(--text-muted);
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
