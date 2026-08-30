# Prism v2（prism2）— 项目主文档

> 从旧仓库（父目录的 electron-vite-learn）全新搭建的第二代 Prism。
> 代码规范见 [../docs/prism2/conventions.md](../docs/prism2/conventions.md)，设计系统见 [../docs/prism2/design.md](../docs/prism2/design.md)。
> 旧仓库已冻结为"活规格书"，仅致命 bug 修复；本仓库只增不迁旧债。

## 产品

桌面效率工具集（剪贴板管理、翻译、Markdown 预览、多线程下载、局域网互传、全局搜索、JSON 工具、Claude Code 监控通知）。当前进度：**骨架 + 剪贴板 + 主页/便利贴/功能搜索**已落地。

## 技术栈（创建时锁定，见 ../docs/prism2/migration-roadmap.md 的版本决策）

Electron 44 + Vue 3.5 + TypeScript 5.9 + Vite 7 + electron-vite 5 + ESLint 9（flat config）。

## 开发命令（均在 prism2 目录）

```bash
npm run dev          # 热重载
npm run typecheck    # 必须零错误
npm run lint         # 零错误零警告
npm run build        # typecheck 后构建
```

## 目录结构

```
src/
├── main/                         # 主进程
│   ├── index.ts                  # 入口：单实例、生命周期、服务初始化、托盘
│   ├── frame/                    # BaseFrame v2 + WindowFactory + MainPageFrame + QuickPasteFrame
│   ├── services/                 # services/ 复数；模块级单例 + 构造器注册 IPC
│   │   ├── db/sqliteDatabase.ts  # SQLite 公共基类（init/save/run/all/one）
│   │   ├── settingsService.ts
│   │   ├── clipboardService.ts
│   │   ├── stickyNotesService.ts # 便利贴（sql.js 持久化，无广播）
│   │   ├── inputService.ts       # 模拟粘贴（平台分支）
│   │   ├── updateService.ts      # 应用更新（electron-updater + GitHub provider，dev 返回提示）
│   │   ├── legacyImportService.ts # 旧版 v1 剪贴板数据一键导入（读 v1 userData/Prism/clipboard.db 合并）
│   │   └── trayService.ts
│   └── utils/platform.ts         # broadcast()
├── preload/
│   ├── ipc.ts                    # 【核心】通道名常量 + 数据模型 + ElectronAPI（唯一来源）
│   ├── index.ts                  # contextBridge 暴露类型化 electronAPI
│   ├── index.d.ts
└── renderer/src/
    ├── assets/styles/            # tokens.css / animations.css / main.css
    ├── components/ui/            # 设计系统组件层（含 RichTextEditor.vue 富文本编辑器）
    ├── components/FeatureSearchPanel.vue  # 功能搜索命令面板（Ctrl/Cmd+K）
    ├── components/HomeNoteCard.vue        # 贴到主页的便利贴可拖拽卡片
    ├── components/StickyNoteEditorDialog.vue # 便利贴大编辑框（富文本 + 颜色，主页/便利贴页共用）
    ├── components/SnippetEditorDialog.vue # 片段添加/编辑弹窗（剪贴板页/主页共用）
    ├── composables/useIpcListener.ts  useToast.ts  useTheme.ts  useFeatureSearch.ts  useDrag.ts  useHomeModules.ts
    ├── views/                    # MainPage / Home / ClipboardManager / StickyNotes / QuickPaste / Settings
    └── router/  types.d.ts
scripts/import-legacy-db.mjs      # 旧剪贴板数据一次性导入（已由应用内 legacyImportService 承接）
.github/workflows/release.yml     # 打 v* tag 时三平台自动打包并发 GitHub Release
dev-app-update.yml                # 开发模式 electron-updater 配置（打包时被排除）
../docs/prism2/                     # 文档已集中到工作区根 docs/prism2/（含 design-ref/ 参考图）
```

## 强制规则

1. **IPC 通道一律从 `@preload/ipc` 的常量导入**，禁止散落字符串字面量；数据模型也定义于此。
2. 渲染端**只用** `window.electronAPI.*`（preload），禁止直接用原始通道。
3. 每处 `on()` 用 `subscribeOnUnmounted` 包裹（`composables/useIpcListener.ts`）。
4. 改 IPC / 数据模型 → 同步 `@preload/ipc.ts` + `../docs/prism2/services.md`；新增文件 → 更新本文目录索引。
5. `npm run typecheck` 零错误；不提交 `out/`、`dist/`、`node_modules/`。

## 与旧仓库的隔离

- 独立 git 仓库（父仓库已 ignore `prism2/`）。
- `package.json` name = `prism2`，userData 与旧版（`Prism`）不同，互不干扰数据/全局快捷键/托盘。
- 旧版数据迁移：应用内 `legacyImportService`（主页横幅一键导入）已承接，`scripts/import-legacy-db.mjs` 作为 CLI 兜底保留。

## 更新与发版

- **自动打包**：`.github/workflows/release.yml` 在打 `v*` tag 时于三平台构建并 `electron-builder --publish always` 发布到 GitHub Release。
- **自动更新**：`updateService`（electron-updater + GitHub provider）→ 设置页「检查更新」；发现新版本后自动下载，UI 展示进度与「安装并重启」。
- **旧版升级到 v2**：v1 的 `githubRepo` 默认指向本仓库，v1 用户检查更新会看到 v2 并下载安装；两者并存，v2 内一键导入 v1 数据。
- ⚠️ 仓库地址占位：`electron-builder.yml`、`.github/workflows/release.yml`、`dev-app-update.yml` 与 v1 `settingsService.ts` 的 githubRepo 均为 `YT-XG/prism2` 占位，建好新仓库后需统一替换。

## 迁移进度

| 功能 | 状态 |
|------|------|
| 骨架（入口/托盘/主页/设置/设计系统/契约层） | ✅ |
| 剪贴板管理（历史/收藏/搜索/保留期/导入） | ✅ |
| 主页（可拖拽合并记录框：剪贴板+片段跨类全搜 + 自定义尺寸 + 概览 + 入口卡（新增便利贴/新增片段） + 模块显隐开关） | ✅ |
| 便利贴（本地便签，增删改 + 富文本大编辑框 + 贴到主页可拖拽定位/自由缩放 + 主页点击编辑/一键创建默认贴主页） | ✅ |
| 功能搜索（命令面板，Ctrl/Cmd+K） | ✅ |
| 自动更新（electron-updater + GitHub CI 自动发版 + 设置页检查更新） | ✅（接入就绪，待建仓库替换占位地址后实际发版） |
| 旧版数据引导导入（主页横幅一键合并 v1 剪贴板数据） | ✅ |
| 翻译、Markdown 预览、下载、文件互传、弹窗族、OCR | ⬜ 见 ../docs/prism2/migration-roadmap.md |
