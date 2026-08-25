# 设计系统（v2）

> 设计方向替代旧 `docs/design.md` 中「尚未实施」的 OKLCH 暖陶土方案，改为参考图同款
> **高级极简 SaaS 后台**风格。参考图在 `docs/design-ref/`（微信图片_*_27.jpg 三张）。

## 视觉语言一句话

浅色、干净、留白充足、大圆角、**药丸形激活态**、柔和弥散阴影、细线线性图标、**低饱和粉彩点缀**。

## 参考图 → 组件映射

- 图2（左图标竖栏 + 菜单卡 + 右折叠子区）→ 主界面侧边导航。
- 图1（左侧圆角面板 + 右侧仪表盘）→ 内容区布局 + 彩色数据卡 / 彩色悬浮动作钮。
- 图3（上下文菜单 + 悬浮工具条）→ 右键菜单 / 通知 / 快捷键键帽展示。

## Token（`assets/styles/tokens.css`，唯一取值来源）

- 色彩：`--bg-page #F5F5F6`、`--bg-surface #FFF`、`--bg-hover #F2F2F3`、`--bg-selected #111`（黑胶囊白字激活）、`--bg-selected-subtle #F4F4F5`、`--text-primary #171717`、`--text-secondary #8A8A8F`、`--text-muted #B3B3B8`、`--border #E6E6E8`。
- 粉彩（仅数据/事件卡）：`--accent-lavender/mint/yellow/blue/violet` + 对应深色文字 token。
- 字体：Inter / SF Pro Display / PingFang SC / HarmonyOS Sans SC（系统回退）。
- 圆角：小控件 8px、药丸/激活项/筛选 `9999px`、卡片 16px、面板/侧栏 20–28px。
- 阴影：xs/sm/md/lg 四级（浮层用 lg + `1px` 细边 + 三角尾巴）。
- 动效：沿用三个时长 + 三个缓动 token。

## 组件层（`components/ui/`）

- `UiButton`（primary 黑底 / secondary 描边 / ghost / danger）
- `UiInput`（带 leading 图标、聚焦光环）
- `UiPillTab`（药丸激活态）
- `UiEmptyState`、`UiDialog`（浮层）

> 业务视图只准用这层组件 + token 拼装。图标统一用 `@lucide/vue`（细线、stroke 1.5–1.75、20px）。

## 主题

已落地 **浅色** 与 **薰衣草**（参考图配色，`[data-theme='lavender']`，含侧边栏淡紫渐变、淡紫头像胶囊、紫罗兰强调）。**深色** 为后续迭代，预留 `--bg-*` token 但本期不做。

主题切换：设置 → 外观 → 主题；选择后写入 `settings.json` 并即时生效（`document.documentElement.dataset.theme`）。

## 原则

- 彩色只用于强调/数据卡，正文导航保持黑白灰。
- 主操作按钮黑色白字；激活态优先级 黑胶囊 > 浅灰胶囊 > 文字加粗。
- 留白充足；数据密集表格可收紧间距但保持圆角/配色/字体一致。
