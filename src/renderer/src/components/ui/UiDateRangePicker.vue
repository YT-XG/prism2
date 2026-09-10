<template>
  <VueDatePicker
    v-model="model"
    class="drp"
    :range="{ partialRange: false, autoSwitchStartEnd: true }"
    :multi-calendars="2"
    :six-weeks="true"
    :enable-time-picker="false"
    :locale="locale"
    :week-start="1"
    :formats="{ input: formatInput }"
    :aria-labels="ariaLabels"
    :action-row="{ showSelect: false, showCancel: false, showPreview: false }"
    :input-attrs="{ clearable: false, autocomplete: 'off' }"
    :floating="{ placement: 'bottom-start', offset: 6, flip: true, shift: { padding: 12 } }"
    auto-apply
    teleport
    :placeholder="placeholder"
  >
    <template #calendar-icon>
      <Calendar :size="14" :stroke-width="1.6" />
    </template>
    <template #arrow-left>
      <ChevronLeft :size="15" :stroke-width="1.8" />
    </template>
    <template #arrow-right>
      <ChevronRight :size="15" :stroke-width="1.8" />
    </template>
  </VueDatePicker>
</template>

<script setup lang="ts">
/**
 * 日期区间选择器（设计系统对 @vuepic/vue-datepicker 的收口封装）。
 *
 * 为什么用组件库：日历网格、区间选择、键盘导航与 aria 语义属「成熟库已覆盖的逻辑」，
 * 自研只会重新踩一遍边界（跨月/跨年、时区、闰年、可访问性）。
 * 视觉一致性由两层保证：
 *   1. 变量桥接 —— `assets/styles/vendor/datepicker.css` 把组件库的 --dp-* 变量整组映射到项目 token；
 *   2. 插槽替换 —— 日历/翻页图标换成 @lucide/vue，与全站图标语言一致。
 * 常用快捷区间不放库的 preset-dates 侧栏（渲染样式不可控），由页面工具栏的药丸组承担。
 * 对外只暴露 'YYYY-MM-DD' 字符串（与页面既有的 dateFrom/dateTo 同源），不泄漏库的数据结构。
 */
import { computed } from 'vue'
import { VueDatePicker, type CalendarDay } from '@vuepic/vue-datepicker'
import { Calendar, ChevronLeft, ChevronRight } from '@lucide/vue'
import { format, parse } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const props = withDefaults(
  defineProps<{
    /** 起始日期（'YYYY-MM-DD'，空串表示不限） */
    from: string
    /** 结束日期（'YYYY-MM-DD'，空串表示不限） */
    to: string
    /** 无障碍标签：触发器与日历面板共用 */
    label?: string
    placeholder?: string
  }>(),
  { label: '日期区间', placeholder: '选择日期范围' }
)

const emit = defineEmits<{
  (e: 'update:from', value: string): void
  (e: 'update:to', value: string): void
}>()

/** 对外统一格式：与查询区间参数同源 */
const DATE_FMT = 'yyyy-MM-dd'
const locale = zhCN

function toDate(value: string): Date | null {
  if (!value) return null
  const d = parse(value, DATE_FMT, new Date())
  return Number.isNaN(d.getTime()) ? null : d
}

function toValue(date: Date | null): string {
  return date ? format(date, DATE_FMT) : ''
}

/** 组件库回调值兜底归一（正常为 Date[]，防御性兼容字符串） */
function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : toDate(String(value))
}

/** 双向绑定：对外字符串 ⇄ 对内 [Date, Date] */
const model = computed<[Date, Date] | null>({
  get() {
    const from = toDate(props.from)
    if (!from) return null
    return [from, toDate(props.to) ?? from]
  },
  set(next) {
    const pair = (next ?? []) as Array<Date | string | null | undefined>
    emit('update:from', toValue(asDate(pair[0])))
    emit('update:to', toValue(asDate(pair[1])))
  }
})

/** 输入框展示：'2026-09-01 至 2026-09-10'（区间未闭合时只显示单日） */
function formatInput(dates: Date | Date[]): string {
  const [start, end] = (Array.isArray(dates) ? dates : [dates]).filter(Boolean) as Date[]
  if (!start) return ''
  return end ? `${format(start, DATE_FMT)} 至 ${format(end, DATE_FMT)}` : format(start, DATE_FMT)
}

/** 无障碍标签：库内可翻译文案（默认英文）统一替换为中文 */
const ariaLabels = computed(() => ({
  input: props.label,
  menu: props.label,
  calendarIcon: props.label,
  clearInput: '清除日期',
  nextMonth: '下个月',
  prevMonth: '上个月',
  nextYear: '下一年',
  prevYear: '上一年',
  day: (d: CalendarDay) => format(d.value, 'yyyy年M月d日')
}))
</script>

<style scoped>
/* 触发器尺寸在此收口；面板样式（teleport 到 body）在 vendor/datepicker.css。
   宽度需完整容纳 'YYYY-MM-DD 至 YYYY-MM-DD'（约 176px 文案 + 图标区 + 内边距） */
.drp {
  display: inline-flex;
  width: 240px;
}
</style>
