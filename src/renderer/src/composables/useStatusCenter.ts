/**
 * 全局状态中心 —— 模块级单例 composable。
 *
 * 将「常驻状态」（邮箱同步中、应用报错、软件更新）与「瞬时提示」（toast）
 * 统一为同构条目，由 StatusCenter.vue 集中渲染在标题栏品牌区后，一处管理。
 *
 * - push(entry)：追加瞬时条目（带 dismissMs 自动消失），返回 id
 * - dismiss(id)：手动移除
 * - set(key, entry)：常驻条目按 key 覆盖（重复 set 先移除旧条目）
 * - removeKey(key)：移除常驻条目
 */
import { ref } from 'vue'
import type { Component } from 'vue'

export type StatusTone = 'info' | 'success' | 'warning' | 'error' | 'brand'

export interface StatusEntry {
  /** 唯一 id（store 分配） */
  id: number
  /** 语义色：决定胶囊底色/文字色 */
  tone: StatusTone
  /** 图标（@lucide/vue 组件） */
  icon?: Component
  /** 图标是否旋转（同步中旋转指示） */
  spin?: boolean
  /** 文案 */
  text: string
  /** hover 提示 */
  title?: string
  /** 点击回调（设置后条目可点按） */
  action?: () => void
  /** 自动消失时长 ms；不设则常驻，需 set/removeKey 或 dismiss 移除 */
  dismissMs?: number
}

const entries = ref<StatusEntry[]>([])
/** 常驻条目 id（按 key 去重覆盖） */
const byKey = new Map<string, number>()
let nextId = 1
const timers = new Map<number, number>()

function remove(id: number): void {
  entries.value = entries.value.filter((e) => e.id !== id)
  const t = timers.get(id)
  if (t !== undefined) {
    window.clearTimeout(t)
    timers.delete(id)
  }
}

/** 追加条目（瞬时条目带 dismissMs 自动消失），返回 id */
function push(entry: Omit<StatusEntry, 'id'>): number {
  // 瞬时条目去重：相同语义色 + 文案已存在时复用并重置消失计时（连续触发不堆叠）
  if (entry.dismissMs) {
    const dup = entries.value.find((e) => e.dismissMs && e.tone === entry.tone && e.text === entry.text)
    if (dup) {
      Object.assign(dup, entry)
      const t = timers.get(dup.id)
      if (t !== undefined) window.clearTimeout(t)
      timers.set(dup.id, window.setTimeout(() => remove(dup.id), entry.dismissMs))
      return dup.id
    }
  }
  const id = nextId++
  entries.value.push({ ...entry, id })
  if (entry.dismissMs) {
    timers.set(id, window.setTimeout(() => remove(id), entry.dismissMs))
  }
  return id
}

/** 常驻条目：按 key 覆盖（先移除旧条目再追加） */
function set(key: string, entry: Omit<StatusEntry, 'id'>): void {
  const existing = byKey.get(key)
  if (existing !== undefined) remove(existing)
  byKey.set(key, push(entry))
}

/** 移除常驻条目 */
function removeKey(key: string): void {
  const id = byKey.get(key)
  if (id !== undefined) {
    remove(id)
    byKey.delete(key)
  }
}

/** 手动移除条目 */
function dismiss(id: number): void {
  remove(id)
}

export function useStatusCenter() {
  return { entries, push, set, removeKey, dismiss }
}
