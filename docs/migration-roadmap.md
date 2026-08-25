# 迁移路线图（v2）

> 目标：把旧仓库（electron-vite-learn）的功能逐片迁移到本仓库，每片走同一 SOP，不一次性大搬。

## 版本决策（2026-08 创建时锁定）

- **工具链**：Electron 44 / electron-vite 5 / Vite 7 / Vue 3.5 / TS 5.9 / ESLint 9（flat config）。
- **刻意回退的原因（写进代码注释与本次记录）**：
  - `electron-vite@5` 的 peer 只接受 `vite ^7`（Vite 8 不支持）→ 用 Vite 7.3.6。
  - `typescript-eslint` 要求 `typescript <6.1`（TS 7 是 Go 重写版，尚不兼容）→ 用 TS 5.9.3。
  - `ESLint 10` 与 `typescript-eslint`/`eslint-plugin-vue` 的 peer 尚不稳定 → 用 ESLint 9.39.5。
- **依赖按需引入**：native 重依赖（`@nut-tree/nut-js`、`onnxruntime-node`、`paddleocr`、`multicast-dns`）等对应功能迁移时再装，当前未装。
- **图标**：`@lucide/vue`（`lucide-vue-next` 已废弃）。

## 垂直切片 SOP（每个功能重复）

1. 读旧仓库对应 `service + 视图 + docs`，列出全部 IPC 通道、DB 表、交互清单。
2. **契约先行**：在 `preload/ipc.ts` 声明通道与会话签名。
3. 主进程：基于 `SqliteStore`/既有模式重写 service（入参收窄、electron-log、try/catch）。
4. 渲染端：用 `components/ui/` + token **重写**视图（不复制旧样式代码）。
5. 双开验收：新旧并排逐项核对（注意全局快捷键冲突，必要时先退旧应用）。
6. 文档同步：`AGENTS.md` 目录 + `docs/*`。

## 已完成

- ✅ 骨架（入口/托盘/主页/设置/设计系统/契约层/防冲突隔离）
- ✅ 剪贴板管理（历史/收藏/搜索/保留期/legacy 数据导入）

## 待迁移（依赖序）

| 顺序 | 功能 | 备注 |
|------|------|------|
| 1 | SearchBox + searchService + SnippetPicker | 依赖剪贴板数据 |
| 2 | Translate + MarkdownPreview | 轻量，先验证契约层 |
| 3 | DownloadManager + downloadEngine | 引擎近乎原样移植 + 补 vitest |
| 4 | FileTransfer / QuickShare / textShare | 网络族一起搬（mDNS + HTTP） |
| 5 | NoticeNew / UpdateNew / PermissionNotice 弹窗族 + PopupManager + githubUpdateService | 通知/更新 |
| 6 | claudeCodeService | 140 行内联模板届时必须提取为独立 `.cjs` + extraResources |
| 7 | OCR（最后） | native ABI 风险最高，需重新评估 paddleocr 维护状态 |

> 每步迁移先确认新版 Electron API 是否破坏性变更（如 v1 的 `clipboard` 主进程方法在 Electron 44 已改为异步 `Promise`——本仓库已据此处理）。

## 迁移注意点（旧仓库踩坑，勿重犯）

- Electron 44 起 `clipboard.readText()/writeText()` 为 **Promise**（async）。
- 双开冲突：appId/userData 已隔离；快捷键冲突验收时错开。
- 通知弹窗 / PopupManager 在步骤 5 才引入；当前剪贴板插入只广播 `broadcast:clipboard-new`，不弹通知。
