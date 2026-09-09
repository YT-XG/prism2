<template>
  <div class="storage-page">
    <header class="storage-header">
      <div class="storage-header__badge">
        <HardDrive :size="22" :stroke-width="1.6" />
      </div>
      <div class="storage-header__text">
        <h1 class="storage-title">存储优化</h1>
        <p class="storage-subtitle">扫描系统残留、洞察磁盘占用，一键安全释放空间</p>
      </div>
      <div class="storage-header__safe">
        <ShieldCheck :size="14" :stroke-width="1.7" />
        <span>清理可恢复 · 注册表自动备份</span>
      </div>
    </header>

    <div class="storage-body">
      <div class="storage-stack">
        <section class="module-card" aria-label="系统残留扫描">
          <ResidueScanPanel />
        </section>
        <section class="module-card" aria-label="大文件（夹）排行">
          <DiskUsagePanel />
        </section>
      </div>

      <section class="roadmap" aria-label="可扩展能力">
        <div class="roadmap__head">
          <div class="roadmap__title">可扩展的能力</div>
          <div class="roadmap__desc">
            结合主流清理 / 卸载工具，为「存储优化」规划的下一步能力，后续版本逐步接入
          </div>
        </div>
        <div class="roadmap__grid">
          <div v-for="f in plannedFeatures" :key="f.name" class="roadmap-item">
            <span class="roadmap-item__icon" :class="`is-${f.tone}`">
              <component :is="f.icon" :size="16" :stroke-width="1.6" />
            </span>
            <span class="roadmap-item__main">
              <span class="roadmap-item__name">{{ f.name }}</span>
              <span class="roadmap-item__desc">{{ f.desc }}</span>
            </span>
            <span class="roadmap-item__tag">规划中</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  HardDrive,
  ShieldCheck,
  Trash2,
  Copy,
  FileSearch,
  Package,
  Gauge,
  AppWindow,
  FolderX,
  Database
} from '@lucide/vue'
import type { Component } from 'vue'
import ResidueScanPanel from '@renderer/components/ResidueScanPanel.vue'
import DiskUsagePanel from '@renderer/components/DiskUsagePanel.vue'

/** 可扩展能力清单：仅作规划展示，未接入逻辑（tag 标记「规划中」） */
interface PlannedFeature {
  name: string
  desc: string
  /** 图标着色用到的粉彩/语义 tone */
  tone: 'lavender' | 'mint' | 'yellow' | 'blue' | 'violet' | 'danger'
  icon: Component
}

const plannedFeatures: PlannedFeature[] = [
  {
    name: '系统垃圾清理',
    desc: 'Windows 临时文件、系统缓存、浏览器缓存一键清理',
    tone: 'mint',
    icon: Trash2
  },
  {
    name: '重复文件去重',
    desc: '按内容指纹查找重复文件，保留一份释放空间',
    tone: 'blue',
    icon: Copy
  },
  {
    name: '磁盘空间可视化',
    desc: '矩形树图逐层下钻，一眼看清占用分布',
    tone: 'violet',
    icon: FileSearch
  },
  {
    name: '不常用应用检测',
    desc: '按体积与最后使用时间，标出闲置软件',
    tone: 'yellow',
    icon: Package
  },
  {
    name: '启动项管理',
    desc: '管理开机自启应用与计划任务，加速启动',
    tone: 'lavender',
    icon: Gauge
  },
  {
    name: '卸载管理器',
    desc: '可视化卸载 + 清理残留，替代默认卸载',
    tone: 'danger',
    icon: AppWindow
  },
  {
    name: '空文件夹与零字节文件',
    desc: '清理无内容的目录占位与 0 字节文件',
    tone: 'blue',
    icon: FolderX
  },
  {
    name: '磁盘容量总览',
    desc: '各分区容量、已用 / 可用一目了然',
    tone: 'mint',
    icon: Database
  }
]
</script>

<style scoped>
/* 全局 html/body 与主窗口 .content 均为 overflow:hidden，页面滚动走自身内部滚动容器 */
.storage-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ---------- 页面头 ---------- */
.storage-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-7) var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
}

.storage-header__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--accent-lavender);
  color: var(--text-on-accent-lavender);
  box-shadow: var(--shadow-xs);
}

.storage-header__text {
  min-width: 0;
  flex: 1;
}

.storage-title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  letter-spacing: -0.01em;
  color: var(--text-primary);
  line-height: 1.2;
}

.storage-subtitle {
  margin: var(--sp-1) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.storage-header__safe {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  flex-shrink: 0;
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--radius-pill);
  background: var(--success-soft);
  color: var(--on-success);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

/* ---------- 内容 ---------- */
.storage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-5) var(--sp-7) var(--sp-6);
}

/* 多列：宽窗口两列并排，窄窗口自动回退单列，减少纵向滚轮下滑 */
.storage-stack {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(440px, 100%), 1fr));
  gap: var(--sp-5);
  align-items: start;
}

/* 模块卡壳：白面 + 圆角 + 柔和阴影，面板自己渲染头与内容区 */
.module-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

/* ---------- 可扩展能力（规划） ---------- */
.roadmap {
  margin-top: var(--sp-5);
  padding: var(--sp-4);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-selected-subtle);
}

.roadmap__head {
  margin-bottom: var(--sp-3);
}

.roadmap__title {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.roadmap__desc {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.roadmap__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: var(--sp-2);
}

.roadmap-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  transition:
    background-color var(--duration-fast) var(--ease-out-soft),
    border-color var(--duration-fast) var(--ease-out-soft),
    transform var(--duration-fast) var(--ease-out-soft);
}

.roadmap-item:hover {
  background: var(--bg-hover);
  transform: translateY(-1px);
}

.roadmap-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
}

.roadmap-item__icon.is-lavender {
  background: var(--accent-lavender);
  color: var(--text-on-accent-lavender);
}

.roadmap-item__icon.is-mint {
  background: var(--accent-mint);
  color: var(--text-on-accent-mint);
}

.roadmap-item__icon.is-yellow {
  background: var(--accent-yellow);
  color: var(--text-on-accent-yellow);
}

.roadmap-item__icon.is-blue {
  background: var(--accent-blue);
  color: var(--text-on-accent-blue);
}

.roadmap-item__icon.is-violet {
  background: var(--accent-violet);
  color: var(--text-on-accent-violet);
}

.roadmap-item__icon.is-danger {
  background: var(--danger-soft);
  color: var(--on-danger);
}

.roadmap-item__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.roadmap-item__name {
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.roadmap-item__desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.5;
}

.roadmap-item__tag {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}
</style>
