/**
 * 剪贴板文本工具：富文本（HTML）与纯文本展示互转。
 * 历史记录 / 片段在列表单行预览时，richtext 类型需去除标签展示纯文本。
 */

/** 去除 HTML 标签得到纯文本（含常见实体还原，块级标签换行） */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 列表单行预览：richtext 取纯文本，其余原样返回 */
export function itemText(item: { content: string; type: string }): string {
  return item.type === 'richtext' ? stripHtml(item.content) : item.content
}
