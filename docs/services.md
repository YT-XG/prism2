# 服务 & IPC 表（v2）

> 全部通道/数据模型唯一来源：`src/preload/ipc.ts`。此表仅为「人读」清单。

## 数据模型

| 类型 | 字段 |
|------|------|
| `HistoryItemType` | `'text' \| 'image'`（图片的 content 为文件名） |
| `HistoryItem` | id, content, created_at, type |
| `FavoriteItem` | id, content, category, description, created_at |
| `CategoryItem` | name, count |
| `ClipboardRetention` | autoClean, value(1-30), unit(day/week/month/year) |
| `AppSettings` | shortcut, snippetShortcut, searchBoxShortcut, serverUrl, autoStart, updateSource, githubRepo, clipboardRetentionValue, clipboardAutoClean, clipboardRetentionUnit, theme |

## SettingsService（`to-service-SettingsService:*`）

| 通道 | 方向 | 载荷 → 返回 |
|------|------|------|
| `get` | rend→main invoke | `() -> AppSettings` |
| `update` | rend→main invoke | `(Partial<AppSettings>) -> void` |

## ClipboardService（`to-service-ClipboardService:*`）

| 通道 | 方向 | 载荷 → 返回 |
|------|------|------|
| `getHistory` | invoke | `(limit?, offset?) -> HistoryItem[]` |
| `searchHistory` | invoke | `(keyword) -> HistoryItem[]` |
| `deleteHistory` | invoke | `(id) -> void` |
| `deleteHistoryBatch` | invoke | `(ids: number[]) -> void`（批量删行 + 同步删图片文件，单次落盘） |
| `clearHistory` | invoke | `() -> void` |
| `getHistoryCount` | invoke | `() -> number` |
| `getRetentionState` | invoke | `() -> ClipboardRetention` |
| `setRetentionState` | invoke | `(Partial<ClipboardRetention>) -> void`（合并后清理一次） |
| `clickItem` | invoke | `({ content, type }) -> void`（写剪贴板→按发起窗口最小化归还焦点→模拟粘贴） |
| `getImageData` | invoke | `(filename) -> string`（图片 data URL，空串=不可用） |
| `getFavorites` | invoke | `() -> FavoriteItem[]` |
| `getFavoritesByCategory` | invoke | `(category) -> FavoriteItem[]` |
| `getCategories` | invoke | `() -> CategoryItem[]` |
| `searchSnippets` | invoke | `(keyword) -> FavoriteItem[]` |
| `addFavorite` | invoke | `(content, category?, description?) -> number` |
| `updateFavorite` | invoke | `(id, content, category, description) -> void` |
| `deleteFavorite` | invoke | `(id) -> void` |
| `clearFavorites` | invoke | `() -> void` |
| `writeText` | invoke | `(text) -> void` |

## 广播

| 通道 | 数据 | 说明 |
|------|------|------|
| `broadcast:clipboard-new` | `HistoryItem` | 新增或"置顶"（重复复制）剪贴板记录时推送给可见窗口 |

## DB 结构（sql.js）

- `clipboard_history(id, content, created_at, type)` + `idx_created_at`；`type` 列由旧库自动迁移补齐
- 图片内容存于 `userData/clipboard-images/<时间戳>-<哈希前缀>.png`，DB 的 content 只存文件名；删除/清理历史时同步删文件
- `favorites(id, content, category, description, created_at)` + `idx_fav_category`, `idx_fav_created_at`

## 渲染端 API（`window.electronAPI`）

按 `ipc.ts` 中 `ElectronAPI` 接口：`platform`、`window.*`（含 `hide`、`onNewItem`、`onWindowEvent`、`onSetPage` 等 subscribe 型，返回取消函数）、`settings.*`、`clipboard.*`。

## 窗口（WindowFactory）

| 窗口 | 路由 | 说明 |
|------|------|------|
| `MainPageFrame` | `/mainPage` | 主界面（热键 `shortcut`） |
| `QuickPasteFrame` | `/quickPaste` | 快捷粘贴搜索框（热键 `searchBoxShortcut`，失焦隐藏，回车粘贴，显示时刷新历史） |
