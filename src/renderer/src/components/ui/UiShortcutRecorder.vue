<template>
  <div ref="rootEl" class="shortcut-recorder">
    <!-- 录制中 -->
    <div v-if="recording" class="sr-recording" role="status">
      <span v-if="hint" class="sr-hint">{{ hint }}</span>
      <span v-else-if="previewParts.length" class="keycaps">
        <span v-for="k in previewParts" :key="k" class="keycap">{{ formatKeycap(k) }}</span>
      </span>
      <span v-else class="sr-hint">请按下新的组合键…</span>
      <span class="keycap keycap--ghost" @click="cancel">Esc 取消</span>
    </div>

    <!-- 已设置 -->
    <button
      v-else-if="modelValue"
      class="sr-button"
      type="button"
      title="点击修改"
      @click="start"
    >
      <span class="keycaps">
        <span v-for="k in keycaps" :key="k" class="keycap">{{ formatKeycap(k) }}</span>
      </span>
      <span class="sr-edit">修改</span>
    </button>

    <!-- 未设置 -->
    <button v-else class="sr-button" type="button" @click="start">
      <span class="sr-edit">设置快捷键</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const rootEl = ref<HTMLElement | null>(null)
const recording = ref(false)
/** 无效组合提示文案（如缺少修饰键 / 不支持按键） */
const hint = ref('')
/** 录制中按下合法组合的预览 */
const previewParts = ref<string[]>([])

let keydownHandler: ((e: KeyboardEvent) => void) | null = null
let docMouseDownHandler: ((e: MouseEvent) => void) | null = null
let blurHandler: (() => void) | null = null

/** 当前快捷键拆分为各键（显示用） */
const keycaps = computed(() => props.modelValue.split('+').filter(Boolean))

function formatKeycap(k: string): string {
  const map: Record<string, string> = {
    CommandOrControl: 'Ctrl/Cmd',
    Command: 'Cmd',
    Control: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
    Super: 'Win',
    Meta: 'Meta',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→'
  }
  return map[k] ?? k
}

/** 进入录制：先暂停全局快捷键，避免按下待设组合被系统级拦截 */
async function start(): Promise<void> {
  if (recording.value) return
  recording.value = true
  hint.value = ''
  previewParts.value = []
  await window.electronAPI.settings.suspendShortcuts()

  keydownHandler = (e) => onKeydown(e)
  docMouseDownHandler = (e) => {
    if (rootEl.value && !rootEl.value.contains(e.target as Node)) void cancel()
  }
  blurHandler = () => void cancel()
  window.addEventListener('keydown', keydownHandler, true)
  document.addEventListener('mousedown', docMouseDownHandler, true)
  window.addEventListener('blur', blurHandler)
}

function stopListeners(): void {
  if (keydownHandler) window.removeEventListener('keydown', keydownHandler, true)
  if (docMouseDownHandler) document.removeEventListener('mousedown', docMouseDownHandler, true)
  if (blurHandler) window.removeEventListener('blur', blurHandler)
  keydownHandler = null
  docMouseDownHandler = null
  blurHandler = null
}

function onKeydown(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()

  // Esc 取消录制
  if (e.key === 'Escape') {
    void cancel()
    return
  }
  // Backspace / Delete 清除快捷键（空串 = 不注册，等价于关闭该全局快捷键）
  if (e.key === 'Backspace' || e.key === 'Delete') {
    commit('')
    return
  }
  // 纯修饰键：等待主键
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

  const hasCtrl = e.ctrlKey || e.metaKey
  const hasShift = e.shiftKey
  const hasAlt = e.altKey
  // 全局快捷键需含修饰键（纯单键在系统级易冲突且不稳定）
  if (!hasCtrl && !hasShift && !hasAlt) {
    hint.value = '需包含 Ctrl / Cmd / Alt / Shift 之一'
    previewParts.value = []
    return
  }

  const mainKey = codeToAccelerator(e.code)
  if (!mainKey) {
    hint.value = '暂不支持该按键'
    previewParts.value = []
    return
  }

  const parts: string[] = []
  if (hasCtrl) parts.push('CommandOrControl')
  if (hasAlt) parts.push('Alt')
  if (hasShift) parts.push('Shift')
  parts.push(mainKey)
  previewParts.value = parts
  commit(parts.join('+'))
}

/** 将 DOM KeyboardEvent.code 映射为 Electron accelerator 主键名 */
function codeToAccelerator(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const map: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`'
  }
  return map[code] ?? null
}

/** 提交新值并恢复全局快捷键（按最新设置重新注册） */
function commit(value: string): void {
  recording.value = false
  stopListeners()
  emit('update:modelValue', value)
  void window.electronAPI.settings.resumeShortcuts()
}

/** 取消录制：恢复原快捷键 */
async function cancel(): Promise<void> {
  if (!recording.value) return
  recording.value = false
  stopListeners()
  await window.electronAPI.settings.resumeShortcuts()
}

onUnmounted(() => {
  stopListeners()
  if (recording.value) void window.electronAPI.settings.resumeShortcuts()
})
</script>

<style scoped>
.shortcut-recorder {
  display: inline-flex;
  align-items: center;
}

.sr-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
}

.sr-button:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-sm);
}

.sr-edit {
  font-size: 11px;
  color: var(--text-muted);
  transition: color var(--duration-fast) var(--ease-out-soft);
}

.sr-button:hover .sr-edit {
  color: var(--brand);
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
  white-space: nowrap;
}

.sr-recording {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px dashed var(--brand);
  border-radius: var(--radius-md);
}

.sr-hint {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.keycap--ghost {
  cursor: pointer;
  background: transparent;
  box-shadow: none;
  color: var(--text-muted);
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    color var(--duration-fast) var(--ease-out-soft);
}

.keycap--ghost:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
