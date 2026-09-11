/**
 * 拼音搜索工具
 * @description 支持用「拼音首字母 / 全拼」检索中文内容。
 * 例如内容「这是一条复制信息」，可输入 zsyt（这是一条）、zsytfzxx（全首字母）、fz（复制）、zhes（这是）等命中。
 * 只处理纯拼音字母查询；命中策略为「全拼子序列 或 首字母子序列」，对拼音的整词/部分前缀均宽松匹配。
 */
import { pinyin } from 'pinyin-pro'

/** 是否含中文，排除纯英文内容被拼音子序列误命中（英文 content 仍走普通子串匹配） */
const CN_RE = /[\u4e00-\u9fa5]/

/**
 * 判断查询是否为纯拼音字母串（允许空格；去掉空格后仅剩 a-zA-Z）。
 * 空串 / 含中文 / 含数字符号的查询不视为拼音查询。
 */
export function isPinyinQuery(q: string): boolean {
  const t = q.replace(/\s+/g, '')
  return t.length > 0 && /^[a-zA-Z]+$/.test(t)
}

/** 拼音特征一次性转换的文本长度上限（只取前若干字符，避免富文本长文逐字转换拖慢输入） */
const PINYIN_TEXT_MAX = 120

/** 子序列匹配：needle 的字符按顺序逐个出现在 hay 中（允许跳跃） */
function isSubsequence(hay: string, needle: string): boolean {
  let i = 0
  let j = 0
  while (i < hay.length && j < needle.length) {
    if (hay[i] === needle[j]) j++
    i++
  }
  return j === needle.length
}

/**
 * 判断 text 是否被拼音查询 query 命中。
 * 仅当 text 含中文且 query 为纯拼音字母串时启用；
 * 比较对象为全拼串（如 zheshiyitiaofuzhixinxi）与首字母串（如 zsytfzxx）。
 */
export function matchesPinyin(text: string, query: string): boolean {
  const q = query.replace(/\s+/g, '').toLowerCase()
  if (!isPinyinQuery(q)) return false
  const sample = text.slice(0, PINYIN_TEXT_MAX)
  if (!CN_RE.test(sample)) return false

  const syllables = pinyin(sample, { type: 'array', toneType: 'none', v: false })
  let full = ''
  let ini = ''
  for (const sy of syllables) {
    const s = sy.toLowerCase()
    if (/^[a-z]/.test(s)) {
      full += s
      ini += s[0]
    }
  }
  return isSubsequence(full, q) || isSubsequence(ini, q)
}