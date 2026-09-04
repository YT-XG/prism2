<template>
  <div class="notif-page">
    <!-- 头部：标题 + 操作 -->
    <header class="notif-header">
      <div>
        <h1 class="notif-title">通知中心</h1>
        <p class="notif-subtitle">更新等事件的通知历史，可回看</p>
      </div>
      <div class="notif-actions">
        <UiButton variant="ghost" :disabled="!unread" @click="markAllRead">全部已读</UiButton>
        <UiButton variant="ghost" :disabled="!items.length" @click="requestClear">清空</UiButton>
      </div>
    </header>

    <!-- 来源过滤（剪贴板复制仅浮窗不入中心，故无「剪贴板」来源记录可选） -->
    <div class="notif-filter">
      <UiPillTab :active="filter === 'all'" @click="filter = 'all'">全部</UiPillTab>
      <UiPillTab :active="filter === 'update'" @click="filter = 'update'">更新</UiPillTab>
    </div>

    <!-- 列表 -->
    <div class="notif-body">
      <div v-if="!items.length" class="notif-empty">
        <UiEmptyState title="暂无通知" hint="更新事件会记录在这里">
          <template #icon>
            <Bell :size="30" :stroke-width="1.6" />
          </template>
        </UiEmptyState>
      </div>
      <div v-else-if="!filtered.length" class="notif-empty">
        <UiEmptyState title="该分类暂无通知" />
      </div>
      <TransitionGroup v-else tag="div" name="notif" class="notif-list">
        <UiNotificationCard
          v-for="(n, index) in filtered"
          :key="n.id"
          :type="n.type"
          :title="n.title"
          :message="n.message"
          :time="formatTime(n.created_at)"
          :unread="n.read === 0"
          role="button"
          tabindex="0"
          :style="cardDelay(index)"
          @click="read(n)"
          @keydown.enter="read(n)"
        />
      </TransitionGroup>
    </div>

    <!-- 清空确认 -->
    <UiDialog :model-value="clearConfirm" title="清空通知" @update:model-value="clearConfirm = false">
      <p class="confirm-text">确定清空全部通知记录吗？此操作不可恢复。</p>
      <template #footer>
        <UiButton variant="ghost" @click="clearConfirm = false">取消</UiButton>
        <UiButton variant="danger" @click="confirmClear">清空</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Bell } from '@lucide/vue'
import UiButton from '@renderer/components/ui/UiButton.vue'
import UiPillTab from '@renderer/components/ui/UiPillTab.vue'
import UiEmptyState from '@renderer/components/ui/UiEmptyState.vue'
import UiDialog from '@renderer/components/ui/UiDialog.vue'
import UiNotificationCard from '@renderer/components/ui/UiNotificationCard.vue'
import { useNotifications, formatTime } from '@renderer/composables/useNotifications'
import { subscribeOnUnmounted } from '@renderer/composables/useIpcListener'
import type { NotificationSource } from '@preload/ipc'

const { items, unread, refresh, markRead, markAllRead, clear } = useNotifications()

/** 来源过滤：all / update（剪贴板复制仅浮窗不入中心，无剪贴板来源记录） */
const filter = ref<'all' | NotificationSource>('all')

/** 清空确认框 */
const clearConfirm = ref(false)

const filtered = computed(() =>
  filter.value === 'all' ? items.value : items.value.filter((n) => n.source === filter.value)
)

/** 点击单条：标记已读 */
async function read(n: { id: number; read: 0 | 1 }): Promise<void> {
  if (n.read === 0) await markRead(n.id)
}

function requestClear(): void {
  clearConfirm.value = true
}

async function confirmClear(): Promise<void> {
  clearConfirm.value = false
  await clear()
}

/** 列表项阶梯入场的延迟（最多 8 项封顶） */
function cardDelay(index: number): Record<string, string> {
  return { '--notif-delay': `${Math.min(index, 8) * 40}ms` }
}

onMounted(() => {
  void refresh()
  // 查看期间有新通知 → 由 useNotifications 单例订阅（init 已在主窗口壳注册）统一刷新列表
  // 窗口重新显示时刷新列表：隐藏期间 onlyVisible 广播被跳过，避免通知列表停留旧数据
  subscribeOnUnmounted(() =>
    window.electronAPI.window.onWindowEvent('reShow', () => {
      void refresh()
    })
  )
})
</script>

<style scoped>
.notif-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  animation: fade-up var(--duration-enter) var(--ease-out-soft);
}

.notif-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.notif-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.notif-actions {
  display: flex;
  gap: var(--sp-2);
}

.notif-filter {
  display: flex;
  gap: var(--sp-1);
  padding: var(--sp-3) var(--sp-5) 0;
}

.notif-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-3) var(--sp-5) var(--sp-5);
}

.notif-empty {
  display: flex;
  justify-content: center;
  padding-top: var(--sp-8);
}

.notif-empty :deep(.ui-empty__icon) {
  animation: float 3s ease-in-out infinite;
}

.notif-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* 通知卡片可点击（标记已读），hover 轻微上浮 */
.notif-list :deep(.ui-notif) {
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out-soft),
    box-shadow var(--duration-fast) var(--ease-out-soft);
  animation: card-in var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: var(--notif-delay, 0ms);
  /* 长列表原生虚拟化：未进入视口的卡片跳过布局/绘制 */
  content-visibility: auto;
  contain-intrinsic-size: auto 72px;
}

.notif-list :deep(.ui-notif:hover) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}

/* 列表增删的过渡（TransitionGroup） */
.notif-enter-active {
  animation: card-in var(--duration-enter) var(--ease-out-soft) backwards;
  animation-delay: var(--notif-delay, 0ms);
}

.notif-leave-active {
  transition: opacity 180ms var(--ease-out-soft), transform 180ms var(--ease-out-soft);
}

.notif-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

.notif-move {
  transition: transform var(--duration-base) var(--ease-out-soft);
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
