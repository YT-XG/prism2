# Prism v2（prism2）— 项目主文档

> 从旧仓库（父目录的 electron-vite-learn）全新搭建的第二代 Prism。
> 代码规范见 [../docs/prism2/conventions.md](../docs/prism2/conventions.md)，设计系统见 [../docs/prism2/design.md](../docs/prism2/design.md)。
> 旧仓库已冻结为"活规格书"，仅致命 bug 修复；本仓库只增不迁旧债。

## 产品

桌面效率工具集（剪贴板管理、翻译、Markdown 预览、多线程下载、局域网互传、全局搜索、JSON 工具、Claude Code 监控通知）。当前进度：**骨架 + 剪贴板试点**已落地。

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
│   │   ├── inputService.ts       # 模拟粘贴（平台分支）
│   │   └── trayService.ts
│   └── utils/platform.ts         # broadcast()
├── preload/
│   ├── ipc.ts                    # 【核心】通道名常量 + 数据模型 + ElectronAPI（唯一来源）
│   ├── index.ts                  # contextBridge 暴露类型化 electronAPI
│   ├── index.d.ts
└── renderer/src/
    ├── assets/styles/            # tokens.css / animations.css / main.css
    ├── components/ui/            # 设计系统组件层
    ├── composables/useIpcListener.ts
    ├── views/                    # MainPage / ClipboardManager / QuickPaste / Settings
    └── router/  types.d.ts
scripts/import-legacy-db.mjs      # 旧剪贴板数据一次性导入
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
- 旧版数据迁移用 `scripts/import-legacy-db.mjs`。

## 迁移进度

| 功能 | 状态 |
|------|------|
| 骨架（入口/托盘/主页/设置/设计系统/契约层） | ✅ |
| 剪贴板管理（历史/收藏/搜索/保留期/导入） | ✅ |
| 翻译、Markdown 预览、下载、文件互传、弹窗族、OCR | ⬜ 见 ../docs/prism2/migration-roadmap.md |
