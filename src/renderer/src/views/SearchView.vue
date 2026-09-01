<template>
  <FeatureSearchPanel standalone />
</template>

<script setup lang="ts">
/**
 * 全局搜索独立窗口视图 —— 承载 Ctrl+K 独立搜索窗（SearchFrame）。
 * 复用 FeatureSearchPanel，standalone 模式下无主页遮罩、面板铺满窗口，
 * 选中功能项经 IPC 唤起主窗口跳转，Esc/选中后隐藏自身。
 */
import FeatureSearchPanel from '@renderer/components/FeatureSearchPanel.vue'
</script>
