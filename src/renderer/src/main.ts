import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { applyTheme } from './composables/useTheme'
import './assets/styles/main.css'

// 首帧前应用持久化主题：避免主窗口/独立搜索窗首次绘制仍用 :root 浅色默认值，
// 造成主题切换前的错色/无边框观感（本机 IPC 毫秒级，不影响启动速度）
const settings = await window.electronAPI.settings.get().catch(() => null)
if (settings) applyTheme(settings.theme)

createApp(App).use(createPinia()).use(router).mount('#app')
