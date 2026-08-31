<template>
  <UiDialog
    :model-value="isOpen"
    title="填写片段占位符"
    @update:model-value="onCloseRequest"
  >
    <div class="sp-list">
      <div v-for="(name, i) in placeholderNames" :key="name" class="sp-field">
        <label class="sp-label">{{ name }}</label>
        <input
          v-model="values[name]"
          class="sp-input"
          type="text"
          :placeholder="`为 {{${name}}} 输入值`"
          :data-index="i"
          @keydown.enter.prevent="onEnter(i)"
        />
      </div>
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="cancel">取消</UiButton>
      <UiButton variant="primary" @click="confirm">粘贴</UiButton>
    </template>
  </UiDialog>
</template>

<script setup lang="ts">
import { watch, nextTick } from 'vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import { useSnippetPlaceholder } from '@renderer/composables/useSnippetPlaceholder'

const { isOpen, placeholderNames, values, confirmPlaceholders, cancelPlaceholders } =
  useSnippetPlaceholder()

/** 打开时聚焦第一个输入框 */
watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  document.querySelector<HTMLInputElement>('.sp-input')?.focus()
})

/** Esc / 遮罩点击 / 取消按钮统一走取消语义 */
function onCloseRequest(open: boolean): void {
  if (!open) cancelPlaceholders()
}

/** Enter：非末位跳到下一个输入框，末位直接粘贴 */
function onEnter(index: number): void {
  if (index < placeholderNames.value.length - 1) {
    const next = document.querySelectorAll<HTMLInputElement>('.sp-input')[index + 1]
    next?.focus()
    return
  }
  confirm()
}

function confirm(): void {
  confirmPlaceholders()
}

function cancel(): void {
  cancelPlaceholders()
}
</script>

<style scoped>
.sp-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  max-height: 320px;
  overflow-y: auto;
}

.sp-field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.sp-label {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-secondary);
}

.sp-input {
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-surface);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
}

.sp-input:focus {
  border-color: var(--brand);
  box-shadow: var(--ring);
}
</style>
