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
            <div class="row-desc">暗色主题将在后续版本提供</div>
          </div>
          <div class="cm-pills">
            <UiPillTab
              v-for="t in ['light', 'dark']"
              :key="t"
              :active="settings.theme === t"
              @click="setTheme(t)"
            >
              {{ t === 'light' ? '浅色' : '深色' }}
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import UiPillTab from '@renderer/components/ui/UiPillTab.vue'
import type { AppSettings } from '@preload/ipc'

const settings = ref<AppSettings>({
  shortcut: '',
  snippetShortcut: '',
  searchBoxShortcut: '',
  serverUrl: '',
  autoStart: false,
  updateSource: 'github',
  githubRepo: '',
  clipboardRetentionDays: 30,
  theme: 'light'
})

async function toggle(key: 'autoStart'): Promise<void> {
  const next = !settings.value[key]
  settings.value[key] = next
  await window.electronAPI.settings.update({ [key]: next })
}

function setTheme(theme: 'light' | 'dark'): void {
  settings.value.theme = theme
  void window.electronAPI.settings.update({ theme })
}

function shortcutLabel(acc: string): string {
  return acc.replace(/CommandOrControl/g, 'Ctrl/Cmd').replace(/\+/g, ' ')
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
  background: var(--bg-page);
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
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3) 0;
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
  background: var(--bg-selected);
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
}
</style>
