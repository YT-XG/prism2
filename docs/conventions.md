# 代码规范（v2 Conventions）

> 本仓库是全新项目，**从第一天起就不存在旧债**（旧仓库的 `transition: all`、重复 DB 初始化、内联长模板、死通道等一律不迁入）。

## 1. 通信：IPC 契约单一来源

- 全部通道名常量 + 数据模型 + `ElectronAPI` 声明 **只定义在 `src/preload/ipc.ts`**。
- 主进程 services 与 preload 都 `import { SERVICE_CHANNELS, ... } from '@preload/ipc'`（或 main 用相对路径）。
- 渲染端**只调用 `window.electronAPI.*`**，不直接接触通道字符串、不 import preload 运行时。

通道命名沿用 v1 语法：

```
渲染→主:   to-main-{视图名}:{action}
主→渲染:   to-renderer-{视图名}:{action}
渲染→服务: to-service-{ServiceName}:{action}
广播:      broadcast:{domain}-{event}
```

## 2. 窗口 / 服务

- 窗口类继承 `BaseFrame`，只用 `recvOne/recvTwo/sendOne/sendTwo`；`destroy()` 自动清理已注册 handler。
- 服务类：模块级单例（`export const xxxService = new XxxService()`），构造器或 `.init()` 内注册 IPC。
- Python 风格命名：服务 `xxxService.ts`、窗口 `XxxFrame.ts`、页面 `Xxx.vue`（与通道 owner 一致）。

## 3. 动画（三层规则）

| 层 | 位置 | 内容 |
|----|------|------|
| token | `assets/styles/tokens.css` | `--duration-fast/base/slow`、`--ease-out-soft/in-soft/spring` |
| 共享 | `assets/styles/animations.css` | 复用的 keyframes（spin/fade-in/dialog-in/page-exit）+ reduced-motion 兜底 |
| 组件 | `<style scoped>` | 单组件专用 keyframes |

- ❌ `transition: all`。显式列出属性。
- ❌ 共享 keyframes 不重复定义。
- 窗口出入场：主进程 `sendOne('to-renderer-{视图}:animate')` → 渲染端切 class → 完成后回 `hideAfterAnimation`。

## 4. 跨平台

- `process.platform` 分支；快捷键 Win=Ctrl / mac=Command（accelerator 写 `CommandOrControl`）。
- 焦点管理 Win=`minimize()`，mac=`hide()`+`app.hide()`。

## 5. 强制禁令

- ❌ 动态 `require('./xxx')` 项目源文件；循环依赖用顶部静态 import。
- ❌ Electron API 出现在 renderer（只经 preload）。
- ❌ 手写成熟库已覆盖的逻辑（semver、pinyin-pro 等）。
- ❌ 敏感信息写入源码。
- ❌ `console.log` 做日志（一律 electron-log）。
