<template>
  <UiDialog
    :model-value="modelValue"
    :title="favorite ? '编辑片段' : '添加片段'"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="form-group">
      <label>内容 <span class="required">*</span></label>
      <textarea v-model="form.content" class="form-textarea" rows="4" placeholder="输入片段内容..."></textarea>
    </div>
    <div class="form-group">
      <label>分类</label>
      <input v-model="form.category" class="form-input" placeholder="如：Linux 命令" list="snippet-categories" />
      <datalist id="snippet-categories">
        <option v-for="cat in categories" :key="cat.name" :value="cat.name" />
      </datalist>
    </div>
    <div class="form-group">
      <label>描述（可选）</label>
      <input v-model="form.description" class="form-input" placeholder="添加备注..." />
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="$emit('update:modelValue', false)">取消</UiButton>
      <UiButton variant="primary" :disabled="!form.content.trim()" @click="save">
        {{ favorite ? '保存' : '添加' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import type { FavoriteItem, CategoryItem } from '@preload/ipc'

const props = defineProps<{
  modelValue: boolean
  /** 编辑目标；null = 新建 */
  favorite: FavoriteItem | null
  /** 分类建议（datalist 联想） */
  categories: CategoryItem[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'save', payload: { content: string; category: string; description: string }): void
}>()

const form = ref<{ content: string; category: string; description: string }>({
  content: '',
  category: '',
  description: ''
})

/** 打开时按编辑目标初始化表单（新建 → 空） */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      form.value = props.favorite
        ? {
            content: props.favorite.content,
            category: props.favorite.category,
            description: props.favorite.description
          }
        : { content: '', category: '', description: '' }
    }
  }
)

function save(): void {
  emit('save', {
    content: form.value.content,
    category: form.value.category,
    description: form.value.description
  })
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

.required {
  color: var(--danger);
}

.form-input,
.form-textarea {
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-surface);
  outline: none;
}

.form-input:focus,
.form-textarea:focus {
  border-color: var(--brand);
  box-shadow: var(--ring);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}
</style>
