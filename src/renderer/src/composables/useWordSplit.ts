/**
 * 剪贴板拆词工具：把一段文本按「词块」智能切分，供历史记录卡片自动展示可分词组。
 * 切分覆盖：换行 / 空白 / 标点 / 中英文边界切换，返回过滤空串后的片段列表。
 */

/** 单个卡片预览下方最多展示的分词胶囊数，超出截断为「+N」 */
export const MAX_WORD_CHIPS = 5

type CharKind = 'ws' | 'cn' | 'lo' | 'punct'

/** 字符分组：空白 → 分隔；汉字 → cn；ASCII 字母/数字 → lo；其余标点 → punct（也作分隔） */
function kindOf(ch: string): CharKind {
  if (/\s/u.test(ch)) return 'ws'
  if (/[\u4e00-\u9fa5]/.test(ch)) return 'cn'
  if (/[A-Za-z0-9]/.test(ch)) return 'lo'
  return 'punct'
}

/**
 * 智能拆词：字符级一次扫描。
 * - 命中空白或标点 → 结束当前片段（二者自身作分隔丢弃）；
 * - 相邻字符分组不同（cn↔lo 中英切换，或 lo/cn 与 punct 间的非连续）→ 结束当前片段；
 * - 同组连续（cn-cn / lo-lo）→ 继续累积。
 */
export function splitWords(text: string): string[] {
  const words: string[] = []
  let cur = ''
  let last: CharKind | '' = ''
  const flush = (): void => {
    if (cur) {
      words.push(cur)
      cur = ''
    }
  }
  for (const ch of text) {
    const kind = kindOf(ch)
    if (kind === 'ws' || kind === 'punct') {
      flush()
    } else if (cur && kind !== last) {
      flush()
      cur = ch
    } else {
      cur += ch
    }
    last = kind
  }
  flush()
  return words
}