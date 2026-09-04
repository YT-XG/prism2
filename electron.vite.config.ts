import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': resolve('src/preload')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@preload': resolve('src/preload')
      }
    },
    plugins: [vue()],
    build: {
      rollupOptions: {
        output: {
          // 第三方大依赖拆 vendor chunk，利用浏览器缓存与并行加载，改善首屏
          manualChunks: {
            vue: ['vue', 'vue-router', 'pinia'],
            lucide: ['@lucide/vue']
          }
        }
      }
    }
  }
})
