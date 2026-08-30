<template>
  <div class="notes">
    <!-- 头部：标题 + 添加 -->
    <header class="notes-header">
      <div>
        <h1 class="notes-title">便利贴</h1>
        <p class="notes-subtitle">随手记，置顶常用，本地保存</p>
      </div>
      <UiButton variant="primary" @click="openAdd">
        <Plus :size="14" :stroke-width="1.6" /> 添加
      </UiButton>
    </header>

    <!-- 便签网格 -->
    <div class="notes-body">
      <div v-if="!notes.length" class="notes-empty">
        <UiEmptyState title="暂无便利贴" hint="点击右上角按钮添加第一张便签">
          <template #icon>
            <StickyNoteIcon :size="30" :stroke-width="1.6" />
          </template>
        </UiEmptyState>
      </div>
      <TransitionGroup v-else tag="div" name="note" class="notes-grid">
        <div
          v-for="(note, index) in notes"
          :key="note.id"
          class="note"
          :class="[`note--${note.color}`, { 'is-pinned': note.pinned }]"
          :style="cardDelay(index)"
          @click="openEdit(note)"
        >
          <div class="note__content" v-html="note.content"></div>
          <div class="note__footer">
            <span v-if="note.pinned" class="note__pinned">
              <Pin :size="12" :stroke-width="1.75" /> 已置顶
            </span>
            <div class="note__actions" @click.stop>
              <button
                class="note-btn"
                :class="{ 'is-on': note.pinned }"
                :title="note.pinned ? '取消置顶' : '置顶'"
                @click="onTogglePin(note)"
              >
                <Pin :size="13" :stroke-width="1.75" />
              </button>
              <button
                class="note-btn note-btn--danger"
                title="删除"
                @click="requestDelete(note)"
              >
                <Trash2 :size="13" :stroke-width="1.6" />
              </button>
            </div>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <!-- 添加 / 编辑：大编辑框（富文本） -->
    <StickyNoteEditorDialog v-model="dialogOpen" :note="editing" @save="save" />

    <!-- 删除确认 -->
    <UiDialog
      :model-value="deleteConfirm"
      title="删除便利贴"
      @update:model-value="deleteConfirm = false"
    >
      <p class="confirm-text">确定删除这张便利贴吗？此操作不可恢复。</p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="confirmDelete">删除</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, StickyNote as StickyNoteIcon, Pin, Trash2 } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import StickyNoteEditorDialog from '@renderer/components/StickyNoteEditorDialog.vue'
import { useToast } from '@renderer/composables/useToast'
import type { StickyNote, StickyNoteColor } from '@preload/ipc'

const toast = useToast()

const notes = ref<StickyNote[]>([])
/** 大编辑框开关 + 编辑目标（null = 新建） */
const dialogOpen = ref(false)
const editing = ref<StickyNote | null>(null)
const deleteTarget = ref<StickyNote | null>(null)
const deleteConfirm = ref(false)

async function fetchNotes(): Promise<void> {
  notes.value = await window.electronAPI.stickyNotes.getNotes()
}

function openAdd(): void {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(note: StickyNote): void {
  editing.value = note
  dialogOpen.value = true
}

async function save(payload: { content: string; color: StickyNoteColor }): Promise<void> {
  if (editing.value) {
    await window.electronAPI.stickyNotes.updateNote(editing.value.id, payload.content, payload.color)
  } else {
    await window.electronAPI.stickyNotes.addNote(payload.content, payload.color)
  }
  dialogOpen.value = false
  await fetchNotes()
  toast.success(editing.value ? '便利贴已更新' : '便利贴已添加')
}

async function onTogglePin(note: StickyNote): Promise<void> {
  await window.electronAPI.stickyNotes.togglePin(note.id)
  await fetchNotes()
}

function requestDelete(note: StickyNote): void {
  deleteTarget.value = note
  deleteConfirm.value = true
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  deleteConfirm.value = false
  deleteTarget.value = null
  if (!target) return
  await window.electronAPI.stickyNotes.deleteNote(target.id)
  await fetchNotes()
  toast.success('已删除便利贴')
}

/** 卡片阶梯入场的延迟（最多 8 项封顶） */
function cardDelay(index: number): Record<string, string> {
  return { '--note-delay': `${Math.min(index, 8) * 40}ms` }
}

onMounted(() => {
  void fetchNotes()
})
</script>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

.notes-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.notes-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.notes-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-4) var(--sp-5) var(--sp-5);
}

.notes-empty {
  display: flex;
  justify-content: center;
  padding-top: var(--sp-8);
}

.notes-empty :deep(.ui-empty__icon) {
  animation: float 3s ease-in-out infinite;
}

.notes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--sp-3);
}

.note {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--sp-3);
  min-height: 120px;
  padding: var(--sp-4);
  border-radius: var(--radius-md);
  cursor: pointer;
  animation: card-in var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: var(--note-delay, 0ms);
  transition: transform 160ms var(--ease-out-soft), box-shadow var(--duration-base) var(--ease-out-soft);
}

.note:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.note.is-pinned {
  box-shadow: 0 0 0 1px var(--brand), var(--shadow-sm);
}

.note--lavender {
  background: var(--accent-lavender);
  color: var(--text-on-accent-lavender);
}
.note--mint {
  background: var(--accent-mint);
  color: var(--text-on-accent-mint);
}
.note--yellow {
  background: var(--accent-yellow);
  color: var(--text-on-accent-yellow);
}
.note--blue {
  background: var(--accent-blue);
  color: var(--text-on-accent-blue);
}
.note--violet {
  background: var(--accent-violet);
  color: var(--text-on-accent-violet);
}

.note__content {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.note__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
}

.note__pinned {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.85;
}

.note__actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.note:hover .note__actions {
  opacity: 1;
}

.note-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  opacity: 0.7;
  transition: opacity var(--duration-fast) var(--ease-out-soft),
    background-color var(--duration-fast) var(--ease-out-soft);
}

.note-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  opacity: 1;
}

.note-btn.is-on {
  opacity: 1;
  color: var(--brand);
}

.note-btn--danger:hover {
  color: var(--danger);
}

/* 便签增删的过渡（TransitionGroup） */
.note-enter-active {
  animation: card-in var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: var(--note-delay, 0ms);
}

.note-leave-active {
  transition: opacity 180ms var(--ease-out-soft), transform 180ms var(--ease-out-soft);
}

.note-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.note-move {
  transition: transform var(--duration-base) var(--ease-out-soft);
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
