<template>
  <div
    ref="el"
    class="home-note"
    :class="[`note--${note.color}`, { 'is-dragging': dragging }]"
    :style="{ left: `${x}px`, top: `${y}px`, zIndex: dragging ? 30 : 20 }"
    role="button"
    :title="note.content"
    @pointerdown="startDrag"
  >
    <p class="home-note__content">{{ note.content }}</p>
    <div class="home-note__footer">
      <span class="home-note__pinned"><Pin :size="11" :stroke-width="1.75" /> 已贴主页</span>
      <div class="home-note__actions" @pointerdown.stop @click.stop>
        <button class="home-note-btn" title="取消贴主页" @click="emit('unpin', note)">
          <Pin :size="13" :stroke-width="1.75" />
        </button>
        <button class="home-note-btn home-note-btn--danger" title="删除" @click="emit('delete', note)">
          <Trash2 :size="13" :stroke-width="1.6" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Pin, Trash2 } from '@lucide/vue'
import { useDrag } from '@renderer/composables/useDrag'
import type { StickyNote } from '@preload/ipc'

const props = defineProps<{
  note: StickyNote
  /** 画布容器（拖拽边界钳制用） */
  canvas: () => HTMLElement | null
  /** 默认位置（note.home_x/home_y 为 null 时的兜底） */
  fallbackPos: { x: number; y: number }
}>()

const emit = defineEmits<{
  (e: 'copy', note: StickyNote): void
  (e: 'unpin', note: StickyNote): void
  (e: 'delete', note: StickyNote): void
  (e: 'drag-end', payload: { id: number; x: number; y: number }): void
}>()

const el = ref<HTMLElement | null>(null)

const { x, y, dragging, startDrag } = useDrag({
  container: props.canvas,
  element: () => el.value,
  initial: () => ({
    x: props.note.home_x ?? props.fallbackPos.x,
    y: props.note.home_y ?? props.fallbackPos.y
  }),
  onEnd: (pos, moved) => {
    if (moved) emit('drag-end', { id: props.note.id, x: pos.x, y: pos.y })
    else emit('copy', props.note)
  }
})
</script>

<style scoped>
.home-note {
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--sp-3);
  width: 200px;
  min-height: 104px;
  max-height: 180px;
  padding: var(--sp-3);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: box-shadow var(--duration-fast) var(--ease-out-soft);
}

.home-note.is-dragging {
  cursor: grabbing;
  box-shadow: var(--shadow-lg);
  outline: 1px solid var(--brand);
}

.home-note:hover {
  box-shadow: var(--shadow-md);
}

.home-note--lavender {
  background: var(--accent-lavender);
  color: var(--text-on-accent-lavender);
}
.home-note--mint {
  background: var(--accent-mint);
  color: var(--text-on-accent-mint);
}
.home-note--yellow {
  background: var(--accent-yellow);
  color: var(--text-on-accent-yellow);
}
.home-note--blue {
  background: var(--accent-blue);
  color: var(--text-on-accent-blue);
}
.home-note--violet {
  background: var(--accent-violet);
  color: var(--text-on-accent-violet);
}

.home-note__content {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
}

.home-note__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
}

.home-note__pinned {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.85;
}

.home-note__actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out-soft);
}

.home-note:hover .home-note__actions {
  opacity: 1;
}

.home-note-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  opacity: 0.75;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out-soft),
    background-color var(--duration-fast) var(--ease-out-soft);
}

.home-note-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  opacity: 1;
}

.home-note-btn--danger:hover {
  color: var(--danger);
}
</style>
