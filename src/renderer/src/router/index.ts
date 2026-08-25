import { createRouter, createWebHashHistory } from 'vue-router'
import MainPage from '@renderer/views/MainPage.vue'
import ClipboardManager from '@renderer/views/ClipboardManager.vue'
import Settings from '@renderer/views/Settings.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/mainPage',
      component: MainPage,
      children: [
        { path: '', redirect: '/mainPage/clipboard' },
        { path: 'clipboard', name: 'clipboard', component: ClipboardManager },
        { path: 'settings', name: 'settings', component: Settings }
      ]
    },
    { path: '/', redirect: '/mainPage/clipboard' },
    { path: '/:pathMatch(.*)*', redirect: '/mainPage/clipboard' }
  ]
})

export default router
