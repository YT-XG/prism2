# 服务 & IPC 表（v2）

> 全部通道/数据模型唯一来源：`src/preload/ipc.ts`。此表仅为「人读」清单。

## 数据模型

| 类型 | 字段 |
|------|------|
| `HistoryItem` | id, content, created_at |
| `FavoriteItem` | id, content, category, description, created_at |
| `CategoryItem` | name, count |
| `AppSettings` | shortcut, snippetShortcut, searchBoxShortcut, serverUrl, autoStart, updateSource, githubRepo, clipboardRetentionDays, theme |

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
| `clearHistory` | invoke | `() -> void` |
| `getHistoryCount` | invoke | `() -> number` |
| `getRetentionDays` | invoke | `() -> number` |
| `setRetentionDays` | invoke | `(days) -> void` |
| `clickItem` | invoke | `(content) -> void`（写剪贴板→隐藏窗口→恢复焦点→粘贴） |
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
| `broadcast:clipboard-new` | `HistoryItem` | 新增剪贴板记录时推送给可见窗口 |

## DB 结构（sql.js，同旧版 schema）

- `clipboard_history(id, content, created_at)` + `idx_created_at`
- `favorites(id, content, category, description, created_at)` + `idx_fav_category`, `idx_fav_created_at`

## 渲染端 API（`window.electronAPI`）

按 `ipc.ts` 中 `ElectronAPI` 接口：`platform`、`window.*`、`settings.*`、`clipboard.*`（含 `onNewItem`、`onWindowEvent`、`onSetPage` 等 subscribe 型，返回取消函数）。
