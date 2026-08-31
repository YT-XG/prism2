/**
 * 片段占位符 —— 模块级单例（仿 useToast）。
 * 片段内容中以 `{{名称}}` 标记占位符，点击片段粘贴时若有占位符则先弹输入框（SnippetPlaceholderDialog.vue），
 * 用户填写后替换占位符并走既有 clickItem 粘贴。
 */
import { ref } from 'vue'
import type { FavoriteItemType } from '@preload/ipc'

/** 待替换的片段载荷（内容 + 类型） */
export interface SnippetPastePayload {
  content: string
  type: FavoriteItemType
}

/** 提取占位符：匹配 `{{名称}}`（不含空白/花括号），去重保序 */
export function extractPlaceholders(content: string): string[] {
  const names: string[] = []
  const re = /\{\{([^{}\s]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}

/** 内容是否含占位符 */
export function hasPlaceholder(content: string): boolean {
  return /\{\{[^{}\s]+\}\}/.test(content)
}

/** HTML 实体转义（富文本替换时防止破坏标签 / 注入） */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 将占位符替换为用户输入值。
 * @param content 片段原始内容（richtext 为 HTML，text 为纯文本）
 * @param values  占位符名 → 输入值
 * @param type    richtext 时对输入值做 HTML 实体转义，text 原样替换
 */
export function replacePlaceholders(
  content: string,
  values: Record<string, string>,
  type: FavoriteItemType
): string {
  let out = content
  for (const [name, raw] of Object.entries(values)) {
    const value = type === 'richtext' ? escapeHtml(raw) : raw
    out = out.split(`{{${name}}}`).join(value)
  }
  return out
}

/** 弹窗是否可见 */
const isOpen = ref(false)
/** 去重后的占位符名（按首次出现顺序） */
const placeholderNames = ref<string[]>([])
/** 占位符名 → 用户输入值 */
const values = ref<Record<string, string>>({})

/** 待确认的原始内容与类型 */
let pendingContent = ''
let pendingType: FavoriteItemType = 'text'
/** 打开弹窗时挂起的 Promise resolve */
let resolveRef: ((payload: SnippetPastePayload | null) => void) | null = null

/**
 * 解析片段粘贴：有占位符则打开输入框等待用户填写，返回替换后的内容；
 * 无占位符直接返回原内容；用户取消返回 null（调用方不粘贴）。
 */
export function openPlaceholderDialog(
  payload: SnippetPastePayload
): Promise<SnippetPastePayload | null> {
  const names = extractPlaceholders(payload.content)
  if (names.length === 0) return Promise.resolve(payload)

  pendingContent = payload.content
  pendingType = payload.type
  placeholderNames.value = names
  values.value = Object.fromEntries(names.map((n) => [n, '']))
  isOpen.value = true

  return new Promise<SnippetPastePayload | null>((resolve) => {
    resolveRef = resolve
  })
}

/** 确认：替换占位符后返回结果并关闭弹窗 */
export function confirmPlaceholders(): void {
  const resolve = resolveRef
  resolveRef = null
  isOpen.value = false
  resolve?.({ content: replacePlaceholders(pendingContent, values.value, pendingType), type: pendingType })
}

/** 取消：返回 null 并关闭弹窗 */
export function cancelPlaceholders(): void {
  const resolve = resolveRef
  resolveRef = null
  isOpen.value = false
  resolve?.(null)
}

export function useSnippetPlaceholder() {
  return {
    isOpen,
    placeholderNames,
    values,
    openPlaceholderDialog,
    confirmPlaceholders,
    cancelPlaceholders
  }
}
