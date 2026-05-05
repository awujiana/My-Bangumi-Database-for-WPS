# taskpane.html 代码审查报告

> 分析范围: `ui/taskpane.html` 及相关 JS 模块
> 修复状态: ✅ 全部完成

## 问题修复总结

### P0：添加缺失函数 ✅

| 函数 | 文件 | 说明 |
|------|------|------|
| `closeDialog()` | `dialog.js` | 关闭所有对话框 |
| `testDebugConnection()` | `dialog.js` | 测试调试连接 |
| `openUserCollection()` | `dialog.js` | 打开用户收藏页面 |
| `testTokenValidity()` | `dialog.js` | 测试 Token 有效性 |

### P0：移除无效引用 ✅

- `handlers.js`: 移除 `window.testTokenValidity` 赋值（移到 dialog.js）

### P1：DOM 元素 ID 一致化 ✅

| JS 引用 | 修复方式 |
|---------|----------|
| `statusDisplay` | `message.js` 改为同时查找 `statusBox` |
| `syncBtn` | `taskpane.html` 添加 `id="syncBtn"` |
| `refreshBtn` | `taskpane.js` 移除绑定（通过 onclick 处理） |
| `detailFilter` | `taskpane.js` 移除绑定 |
| `closeDetailModal` | `taskpane.js` 移除绑定（通过 onclick 处理） |
| `debugNotifyCount` | `taskpane.js` 移除引用 |
| `detailList` | `taskpane.html` 添加元素 |
| `detailCount` | `taskpane.html` 添加元素 |

### P2：CSS 类名统一 ✅

- `taskpane.html`: 内联对话框（`inputDialog`/`confirmDialog`/`alertDialog`）的样式类从 `.modal/.modal-content/.btn/.dialog-buttons` 统一为 `.bgm-modal/.bgm-modal-content/.bgm-btn/.bgm-dialog-footer`
- 移除不再使用的旧 CSS 类引用（`.confirm-modal-content`/`.confirm-btn`/`.confirm-no`/`.confirm-yes`）

### P2：函数签名兼容 ✅

- `handlers.js` 中 `markUploadedItems()` 支持两种调用方式：
  - `markUploadedItems(sheetIndex, collections)` - 直接传索引和数据（内部调用）
  - `markUploadedItems(sheetName)` - 传工作表名称字符串，自动查找索引并获取收藏数据（HTML 按钮调用）
- `handlers.js` 中 `clearSheetMarks()` 同样支持按名称和按索引清除

### P2：文件编码修复 ✅

- `dialog.js`: 修复所有乱码中文注释，重新写入 UTF-8 编码
- `handlers.js`: 修复所有乱码中文注释，重新写入 UTF-8 编码

### P3：函数全局可访问性 ✅

- `scraping.js`: 添加 `window.fetchAllUserCollections` 等导出

### P4：清理重复代码 ✅

- `taskpane.js`: 移除重复的 `window.markUploadedItems` 和 `window.clearSheetMarks`
- `taskpane.js`: 移除未使用的 `filterDetailItems` 导入
- `taskpane.js`: 修复 `clearSyncRecords()` 递归调用 bug，改为从 `syncRecord.js` 导入实现

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `js/ui/dialog.js` | 重写 | 修复编码乱码，新增 4 个兼容函数，统一中文注释 |
| `js/ui/handlers.js` | 重写 | 修复编码乱码，增强 `markUploadedItems`/`clearSheetMarks` 支持按名称调用 |
| `js/ui/message.js` | 修改 | `statusDisplay` 兼容查找 `statusBox` |
| `js/taskpane.js` | 修改 | 修复递归 bug、清理重复代码、统一调用方式 |
| `js/sync/scraping.js` | 修改 | 添加全局函数导出 |
| `ui/taskpane.html` | 修改 | 添加缺失 DOM 元素，CSS 类名统一为 `bgm-` 前缀 |
