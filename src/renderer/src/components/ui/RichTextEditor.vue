<template>
  <div class="rte">
    <!-- 工具栏 -->
    <div class="rte__toolbar" role="toolbar" aria-label="富文本格式">
      <button
        v-for="btn in groups"
        :key="btn.label"
        type="button"
        class="rte-btn"
        :title="btn.label"
        :aria-label="btn.label"
        @mousedown.prevent
        @click="btn.run"
      >
        <component :is="btn.icon" :size="14" :stroke-width="1.75" />
      </button>

      <span class="rte__sep" />

      <!-- 链接：点击后内嵌 URL 输入 -->
      <template v-if="linkOpen">
        <input
          ref="linkInput"
          v-model="linkUrl"
          class="rte-link"
          placeholder="粘贴链接地址，回车确认"
          @keydown.enter.prevent="applyLink"
          @keydown.esc="closeLink"
        />
        <button
          type="button"
          class="rte-btn rte-btn--confirm"
          title="确认链接"
          aria-label="确认链接"
          @mousedown.prevent
          @click="applyLink"
        >
          <Check :size="14" :stroke-width="2" />
        </button>
      </template>
      <button
        v-else
        type="button"
        class="rte-btn"
        title="插入链接"
        aria-label="插入链接"
        @mousedown.prevent
        @click="openLink"
      >
        <Link2 :size="14" :stroke-width="1.75" />
      </button>
    </div>

    <!-- 编辑区 -->
    <div
      ref="editor"
      class="rte__editor"
      :class="{ 'is-empty': isEmpty }"
      :data-placeholder="placeholder"
      contenteditable="true"
      @input="emitContent()"
      @blur="emitContent(true)"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, type Component } from 'vue'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  RemoveFormatting,
  Link2,
  Check
} from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    /** 富文本 HTML 内容 */
    modelValue: string
    placeholder?: string
  }>(),
  { placeholder: '' }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editor = ref<HTMLElement | null>(null)

/** 去除标签后的纯文本是否为空（用于空态与占位符） */
const isEmpty = computed(() => stripHtml(props.modelValue).trim().length === 0)

interface ToolBtn {
  label: string
  icon: Component
  run: () => void
}

/** 一组直接调用 execCommand 的格式按钮 */
const groups: ToolBtn[] = [
  { label: '加粗', icon: Bold, run: () => exec('bold') },
  { label: '斜体', icon: Italic, run: () => exec('italic') },
  { label: '下划线', icon: Underline, run: () => exec('underline') },
  { label: '删除线', icon: Strikethrough, run: () => exec('strikeThrough') },
  { label: '标题 2', icon: Heading2, run: () => exec('formatBlock', 'h2') },
  { label: '标题 3', icon: Heading3, run: () => exec('formatBlock', 'h3') },
  { label: '无序列表', icon: List, run: () => exec('insertUnorderedList') },
  { label: '有序列表', icon: ListOrdered, run: () => exec('insertOrderedList') },
  { label: '撤销', icon: Undo2, run: () => exec('undo') },
  { label: '重做', icon: Redo2, run: () => exec('redo') },
  { label: '清除格式', icon: RemoveFormatting, run: () => exec('removeFormat') }
]

function exec(command: string, value?: string): void {
  // 焦点保持在编辑区（@mousedown.prevent 已保证），execCommand 对当前选区生效
  editor.value?.focus()
  document.execCommand(command, false, value)
  emitContent(true)
}

// ---------------------------------------------------------------------------
// 链接：内嵌 URL 输入（回车/确认应用，Esc 取消）
// ---------------------------------------------------------------------------
const linkOpen = ref(false)
const linkUrl = ref('')
const linkInput = ref<HTMLInputElement | null>(null)

function openLink(): void {
  linkOpen.value = true
  linkUrl.value = ''
  nextTick(() => linkInput.value?.focus())
}

function applyLink(): void {
  const url = linkUrl.value.trim()
  if (url) {
    editor.value?.focus()
    document.execCommand('createLink', false, url)
    emitContent(true)
  }
  linkOpen.value = false
}

function closeLink(): void {
  linkOpen.value = false
  linkUrl.value = ''
}

/** 同步编辑区内容 → v-model（打字防抖合并；工具条/失焦用 immediate 立即发） */
let emitTimer: ReturnType<typeof setTimeout> | null = null

function emitContent(immediate = false): void {
  if (!editor.value) return
  if (immediate) {
    if (emitTimer) {
      clearTimeout(emitTimer)
      emitTimer = null
    }
    emit('update:modelValue', editor.value.innerHTML)
    return
  }
  // 打字路径：防抖合并，避免每次击键全量 innerHTML 序列化 + 父级 canSave 的 stripHtml 重算
  if (emitTimer) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    if (editor.value) emit('update:modelValue', editor.value.innerHTML)
  }, 200)
}

/** 去除 HTML 标签得到纯文本（用于空态判断 / 提示条） */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

// 外部重置（打开弹窗 / 切换便签）：与当前 innerHTML 不一致时回填
watch(
  () => props.modelValue,
  (val) => {
    const html = val ?? ''
    if (editor.value && editor.value.innerHTML !== html) {
      editor.value.innerHTML = html
    }
  }
)

onMounted(() => {
  if (editor.value) editor.value.innerHTML = props.modelValue ?? ''
})

onBeforeUnmount(() => {
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
    // 冲刷最后一次未发射的内容：卸载前若还有 200ms 防抖在途（且未触发 blur），立即发射，避免编辑后立刻卸载丢最后输入
    if (editor.value) emit('update:modelValue', editor.value.innerHTML)
  }
})
</script>

<style scoped>
.rte {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  overflow: hidden;
}

.rte:focus-within {
  border-color: var(--brand);
  box-shadow: var(--ring);
}

.rte__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: var(--sp-2);
  border-bottom: 1px solid var(--border);
  background: var(--bg-hover);
}

.rte-btn {
  width: 28px;
  height: 26px;
  display: inline-flex;
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

.rte-btn:hover {
  background: var(--bg-selected-subtle);
  color: var(--text-primary);
}

.rte-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}

.rte-btn--confirm {
  color: var(--brand);
}

.rte__sep {
  width: 1px;
  height: 16px;
  margin: 0 var(--sp-1);
  background: var(--border);
}

.rte-link {
  flex: 1;
  min-width: 140px;
  height: 26px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-surface);
  outline: none;
}

.rte-link:focus {
  border-color: var(--brand);
  box-shadow: var(--ring);
}

.rte__editor {
  min-height: 180px;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--sp-3);
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  outline: none;
  word-break: break-word;
}

/* 空态占位符 */
.rte__editor.is-empty::before {
  content: attr(data-placeholder);
  color: var(--text-muted);
  pointer-events: none;
}

/* 编辑区内的基础排版 */
.rte__editor :deep(p) {
  margin: 0 0 var(--sp-2);
}

.rte__editor :deep(p:last-child) {
  margin-bottom: 0;
}

.rte__editor :deep(h2) {
  margin: var(--sp-2) 0;
  font-size: 18px;
  font-weight: 600;
}

.rte__editor :deep(h3) {
  margin: var(--sp-2) 0;
  font-size: 16px;
  font-weight: 600;
}

.rte__editor :deep(ul),
.rte__editor :deep(ol) {
  margin: 0 0 var(--sp-2);
  padding-left: var(--sp-5);
}

.rte__editor :deep(a) {
  color: var(--brand);
  text-decoration: underline;
}
</style>
