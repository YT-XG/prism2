<template>
  <div class="settings">
    <header class="settings-header">
      <h1 class="settings-title">设置</h1>
    </header>

    <div class="settings-body">
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
            <div class="row-desc">浅色 / 薰衣草 / 白绿（参考图）；深色将在后续版本提供</div>
          </div>
          <div class="cm-pills">
            <UiPillTab
              v-for="t in THEMES"
              :key="t.value"
              :active="settings.theme === t.value"
              :class="{ 'is-disabled': t.disabled }"
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
        <p v-if="status" class="backup-status">{{ status }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import UiPillTab from '@renderer/components/ui/UiPillTab.vue'
import type { AppSettings, BackupImportMode } from '@preload/ipc'

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
  theme: 'light'
})

async function toggle(key: 'autoStart'): Promise<void> {
  const next = !settings.value[key]
  settings.value[key] = next
  await window.electronAPI.settings.update({ [key]: next })
}

type ThemeValue = 'light' | 'lavender' | 'mint' | 'dark'

const THEMES: { value: ThemeValue; label: string; disabled?: boolean }[] = [
  { value: 'light', label: '浅色' },
  { value: 'lavender', label: '薰衣草（参考图）' },
  { value: 'mint', label: '白绿（参考图）' },
  { value: 'dark', label: '深色', disabled: true }
]

function setTheme(theme: ThemeValue): void {
  if (theme === 'dark') return // 深色尚未实现
  settings.value.theme = theme
  document.documentElement.dataset.theme = theme
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

/** 最近一次备份操作的反馈信息 */
const status = ref('')

/** 导出剪贴板记录备份 */
async function exportBackup(): Promise<void> {
  status.value = ''
  const r = await window.electronAPI.clipboard.exportBackup()
  if (r.canceled) return
  status.value = r.ok
    ? `已导出：${r.path}（历史 ${r.historyCount}、收藏 ${r.favoriteCount}、图片 ${r.imageCount}）`
    : `导出失败：${r.error ?? '未知错误'}`
}

/** 导入剪贴板记录备份（按所选合并方式） */
async function importBackup(): Promise<void> {
  status.value = ''
  const r = await window.electronAPI.clipboard.importBackup(importMode.value)
  if (r.canceled) return
  status.value = r.ok
    ? importMode.value === 'replace'
      ? `已替换导入：历史 ${r.importedHistory}、收藏 ${r.importedFavorites}、图片 ${r.importedImages}`
      : `已合并导入：历史 +${r.importedHistory}（跳过 ${r.skippedHistory}）、收藏 +${r.importedFavorites}（跳过 ${r.skippedFavorites}）、图片 +${r.importedImages}（跳过 ${r.skippedImages}）`
    : `导入失败：${r.error ?? '未知错误'}`
}

onMounted(async () => {
  settings.value = await window.electronAPI.settings.get()
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

.cm-pills :deep(.ui-pill.is-disabled) {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
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

.backup-status {
  margin: 0 0 var(--sp-2);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  word-break: break-all;
}
</style>
