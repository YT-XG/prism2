import { createRouter, createWebHashHistory } from 'vue-router'
import MainPage from '@renderer/views/MainPage.vue'
import Home from '@renderer/views/Home.vue'
import ClipboardManager from '@renderer/views/ClipboardManager.vue'
import StickyNotes from '@renderer/views/StickyNotes.vue'
import NotificationPopup from '@renderer/views/NotificationPopup.vue'
import SearchView from '@renderer/views/SearchView.vue'
import Settings from '@renderer/views/Settings.vue'
import Notifications from '@renderer/views/Notifications.vue'

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
        { path: 'notifications', name: 'notifications', component: Notifications },
        { path: 'settings', name: 'settings', component: Settings }
      ]
    },
    { path: '/notificationPopup', name: 'notificationPopup', component: NotificationPopup },
    { path: '/search', name: 'search', component: SearchView },
    { path: '/', redirect: '/mainPage/home' },
    { path: '/:pathMatch(.*)*', redirect: '/mainPage/home' }
  ]
})

export default router
