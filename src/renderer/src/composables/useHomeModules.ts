/**
 * 主页模块显隐 —— 模块级单例，仿 useFeatureSearch。
 * App.vue 标题栏「显示」面板与 Home.vue 共用同一状态，localStorage 持久化。
 */
import { ref } from 'vue'

/** 主页可显隐模块状态（key 对应各模块，后续新增模块在此扩展） */
export interface HomeModules {
  /** 精简剪贴板（最近记录框） */
  compactClipboard: boolean
}

/** 「显示」面板的模块清单项（后续新增模块在此扩展） */
export interface HomeModuleDef {
  key: keyof HomeModules
  label: string
}

const STORAGE_KEY = 'prism.home.modules'
const DEFAULT_MODULES: HomeModules = { compactClipboard: true }

function load(): HomeModules {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HomeModules>
      return { ...DEFAULT_MODULES, ...parsed }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return { ...DEFAULT_MODULES }
}

const modules = ref<HomeModules>(load())

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modules.value))
  } catch {
    // 忽略持久化失败
  }
}

export function useHomeModules() {
  return {
    modules,
    setModule: (key: keyof HomeModules, value: boolean): void => {
      modules.value = { ...modules.value, [key]: value }
      persist()
    }
  }
}
