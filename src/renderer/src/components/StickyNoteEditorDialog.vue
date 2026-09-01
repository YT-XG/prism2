<template>
  <UiDialog
    :model-value="modelValue"
    size="lg"
    :title="note ? '编辑便利贴' : '添加便利贴'"
    :overlay-close="false"
    fullscreen
    resizable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="form-group">
      <label>内容（支持富文本）</label>
      <RichTextEditor v-model="form.content" placeholder="写点什么…" />
    </div>
    <div class="form-group">
      <label>颜色</label>
      <div class="swatches">
        <button
          v-for="c in COLORS"
          :key="c"
          type="button"
          class="swatch"
          :class="[`swatch--${c}`, { 'is-active': form.color === c }]"
          :title="c"
          :aria-label="c"
          @click="form.color = c"
        />
      </div>
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="$emit('update:modelValue', false)">取消</UiButton>
      <UiButton variant="primary" :disabled="!canSave" @click="save">保存</UiButton>
    </template>
  </UiDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import RichTextEditor from '@renderer/components/ui/RichTextEditor.vue'
import type { StickyNote, StickyNoteColor } from '@preload/ipc'

/** 可选颜色（对应粉彩强调 token） */
const COLORS: readonly StickyNoteColor[] = ['lavender', 'mint', 'yellow', 'blue', 'violet']

const props = defineProps<{
  modelValue: boolean
  /** 编辑目标；null = 新建 */
  note: StickyNote | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'save', payload: { content: string; color: StickyNoteColor }): void
}>()

const form = ref<{ content: string; color: StickyNoteColor }>({ content: '', color: 'lavender' })

/** 空态判断：去标签后 trim 为空则禁用保存 */
const canSave = computed(() => form.value.content.replace(/<[^>]*>/g, ' ').trim().length > 0)

/** 打开时按编辑目标初始化表单（新建 → 空 + 默认色） */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      form.value = props.note
        ? { content: props.note.content, color: props.note.color }
        : { content: '', color: 'lavender' }
    }
  }
)

function save(): void {
  emit('save', { content: form.value.content, color: form.value.color })
}
</script>

<style scoped>
.form-group {
  margin-bottom: var(--sp-4);
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}

.swatches {
  display: flex;
  gap: var(--sp-2);
}

.swatch {
  width: 24px;
  height: 24px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 80ms var(--ease-out-soft), border-color var(--duration-fast) var(--ease-out-soft);
}

.swatch:hover {
  transform: scale(1.1);
}

.swatch.is-active {
  border-color: var(--brand);
  box-shadow: var(--ring);
}

.swatch--lavender {
  background: var(--accent-lavender);
}
.swatch--mint {
  background: var(--accent-mint);
}
.swatch--yellow {
  background: var(--accent-yellow);
}
.swatch--blue {
  background: var(--accent-blue);
}
.swatch--violet {
  background: var(--accent-violet);
}
</style>
