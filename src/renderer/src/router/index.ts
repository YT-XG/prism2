import { createRouter, createWebHashHistory } from 'vue-router'
import MainPage from '@renderer/views/MainPage.vue'
import Home from '@renderer/views/Home.vue'
import ClipboardManager from '@renderer/views/ClipboardManager.vue'
import StickyNotes from '@renderer/views/StickyNotes.vue'
import QuickPaste from '@renderer/views/QuickPaste.vue'
import Settings from '@renderer/views/Settings.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/mainPage',
      component: MainPage,
      children: [
        { path: '', redirect: '/mainPage/home' },
        { path: 'home', name: 'home', component: Home },
        { path: 'clipboard', name: 'clipboard', component: ClipboardManager },
        { path: 'notes', name: 'notes', component: StickyNotes },
        { path: 'settings', name: 'settings', component: Settings }
      ]
    },
    { path: '/quickPaste', name: 'quickPaste', component: QuickPaste },
    { path: '/', redirect: '/mainPage/home' },
    { path: '/:pathMatch(.*)*', redirect: '/mainPage/home' }
  ]
})

export default router
