<template>
  <!-- 独立小窗（通知浮窗/搜索窗）：无标题栏，退化为右上角浮动展示 -->
  <Teleport v-if="floating" to="body">
    <div class="status-center status-center--floating" aria-live="polite">
      <TransitionGroup name="sc">
        <div
          v-for="e in entries"
          :key="e.id"
          class="status-item"
          :class="itemClass(e)"
          :title="e.title"
          role="button"
          :tabindex="e.action ? 0 : undefined"
          @click="e.action?.()"
          @keydown.enter="e.action?.()"
        >
          <component
            :is="e.icon"
            v-if="e.icon"
            :size="12"
            :stroke-width="2"
            class="status-item__icon"
            :class="{ 'is-spin': e.spin }"
          />
          <span class="status-item__text">{{ e.text }}</span>
          <button
            v-if="e.dismissMs"
            type="button"
            class="status-item__close"
            title="关闭"
            @click.stop="dismiss(e.id)"
          >
            <X :size="10" :stroke-width="2" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>

  <!-- 主窗口：内联渲染在标题栏品牌区后 -->
  <div v-else class="status-center" aria-live="polite">
    <TransitionGroup name="sc">
      <div
        v-for="e in entries"
        :key="e.id"
        class="status-item"
        :class="itemClass(e)"
        :title="e.title"
        role="button"
        :tabindex="e.action ? 0 : undefined"
        @click="e.action?.()"
        @keydown.enter="e.action?.()"
      >
        <component
          :is="e.icon"
          v-if="e.icon"
          :size="12"
          :stroke-width="2"
          class="status-item__icon"
          :class="{ 'is-spin': e.spin }"
        />
        <span class="status-item__text">{{ e.text }}</span>
        <button
          v-if="e.dismissMs"
          type="button"
          class="status-item__close"
          title="关闭"
          @click.stop="dismiss(e.id)"
        >
          <X :size="10" :stroke-width="2" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { X } from '@lucide/vue'
import { useStatusCenter, type StatusEntry } from '@renderer/composables/useStatusCenter'

withDefaults(
  defineProps<{
    /** 独立小窗模式：右上角浮动；主窗口（默认）为标题栏内联 */
    floating?: boolean
  }>(),
  { floating: false }
)

const { entries, dismiss } = useStatusCenter()

/** 条目样式：语义色 + 可交互（有点击/有关闭按钮时需脱离标题栏拖动区） */
function itemClass(e: StatusEntry): string[] {
  const cls = [`status-item--${e.tone}`]
  if (e.action || e.dismissMs) cls.push('status-item--interactive')
  return cls
}
</script>

<style scoped>
.status-center {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

/* 独立小窗：右上角浮动卡片堆 */
.status-center--floating {
  position: fixed;
  top: var(--sp-4);
  right: var(--sp-4);
  z-index: 300;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: none;
}

.status-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 2px 10px;
  border: none;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
  pointer-events: auto;
  /* 状态条目均可交互（点按/关闭），整体脱离标题栏拖动区，避免拖拽误触发 */
  -webkit-app-region: no-drag;
}

.status-item--interactive {
  cursor: pointer;
}

.status-item__icon {
  flex-shrink: 0;
}

.status-item__icon.is-spin {
  animation: spin 1s linear infinite;
}

.status-item__text {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

.status-item__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: currentColor;
  opacity: 0.7;
  cursor: pointer;
}

.status-item__close:hover {
  opacity: 1;
}

/* 语义色：--*-soft 浅底 + 语义深字（--on-* 各主题已校准） */
.status-item--info {
  background: var(--info-soft);
  color: var(--info);
}

.status-item--success {
  background: var(--success-soft);
  color: var(--success);
}

.status-item--warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.status-item--error {
  background: var(--danger-soft);
  color: var(--danger);
}

.status-item--brand {
  background: var(--bg-selected-subtle);
  color: var(--brand);
}

/* 条目出入场：淡入 + 轻微上移 */
.sc-enter-active {
  animation: sc-in var(--duration-base) var(--ease-out-soft);
}

.sc-leave-active {
  transition: opacity 160ms var(--ease-out-soft), transform 160ms var(--ease-out-soft);
}

.sc-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@keyframes sc-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
