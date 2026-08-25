# Prism v2（prism-next）

桌面效率工具集的第二代全新实现：全新架构、全新设计系统（高级极简 SaaS 风格，见 `docs/design-ref/` 参考图）、技术栈全面升级。

## 启动

```bash
npm install        # 首次
npm run dev        # 开发模式
```

> 依赖安装若在沙箱环境被拦截，可 `export ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts`（正常开发机无需如此）。

## 验收基线

- `npm run typecheck` 零错误
- `npm run lint` 零错误零警告
- `npm run build` 通过

## 已实现

- 骨架：主进程入口 / 托盘 / 设置 / 主页壳 / 设计系统（token + `components/ui/`）/ IPC 契约层（`preload/ipc.ts`）
- **剪贴板管理**：历史 / 收藏 / 搜索 / 保留期 / 旧数据导入（`node scripts/import-legacy-db.mjs`）

## 文档

- 入口：`AGENTS.md`
- 代码规范：`docs/conventions.md`
- 设计系统：`docs/design.md`
- 服务 & IPC 表：`docs/services.md`
- 迁移路线图 + 版本决策：`docs/migration-roadmap.md`
- 参考图：`docs/design-ref/`

## 与旧版隔离

独立 git 仓库；`userData` 为 `prism-next`（旧版为 `Prism`），数据/全局快捷键/托盘互不干扰。
