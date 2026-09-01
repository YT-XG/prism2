<template>
  <UiDialog
    :model-value="modelValue"
    size="lg"
    title="编辑记录"
    :overlay-close="false"
    fullscreen
    resizable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="form-group">
      <label>内容（支持富文本）</label>
      <RichTextEditor v-model="form.content" placeholder="编辑内容…" />
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
import { stripHtml } from '@renderer/composables/useClipboardText'
import type { HistoryItem } from '@preload/ipc'

const props = defineProps<{
  modelValue: boolean
  /** 编辑目标历史记录（图片记录不可编辑，由入口处隐藏按钮） */
  item: HistoryItem | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'save', payload: { content: string }): void
}>()

const form = ref<{ content: string }>({ content: '' })

/** 空态判断：去标签后 trim 为空则禁用保存 */
const canSave = computed(() => stripHtml(form.value.content).trim().length > 0)

/** 打开时按编辑目标初始化（text 喂纯文本、richtext 喂 HTML，编辑器均直接渲染） */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      form.value = { content: props.item?.content ?? '' }
    }
  }
)

function save(): void {
  emit('save', { content: form.value.content })
}
</script>

<style scoped>
.form-group {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
</style>
