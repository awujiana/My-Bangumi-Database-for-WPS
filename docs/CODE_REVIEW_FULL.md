# BGM 项目全面代码审查报告

> 审查时间：2026-05-06  
> 项目类型：WPS/Excel JS 加载项（Bangumi 收藏同步工具）  
> 源文件总计：约 6,600+ 行（JS/TS）

---

## 一、项目文件概览

| 文件 | 行数 | 职责 |
|------|------|------|
| `js/core/constants.js` | 79 | 统一常量 |
| `js/core/crypto.js` | 250 | Token 加密/解密 |
| `js/core/unified.js` | 338 | 统一对话框/错误处理 |
| `js/util.js` | 708 | 核心工具函数 |
| `js/http.js` | 119 | HTTP 请求 |
| `js/bangumi.js` | 940 | Bangumi API 同步 |
| `js/syncRecord.js` | 553 | 同步记录管理 |
| `js/ribbon.js` | 125 | Ribbon 按钮回调 |
| `js/taskpane.js` | 374 | 任务面板初始化 |
| `js/ui/dialog.js` | 587 | UI 对话框系统 |
| `js/ui/handlers.js` | 379 | UI 事件处理 |
| `js/ui/message.js` | 81 | 消息通信 |
| `js/ui/preview.js` | 254 | 数据预览 |
| `js/sync/scraping.js` | 189 | 收藏数据抓取 |
| `ui/taskpane.html` | 309 | 任务面板 UI |
| `css/styles.css` | 1063 | 全局样式 |

---

## 二、严重问题（影响功能正确性）

### 2.1 `openUserCollection` 两个实现 URL 不同

- `bangumi.js:918`：`"https://bgm.tv/" + userId + "/collect"`
- `dialog.js:546`：`"https://bgm.tv/user/" + userId + "/collection"`

两者都挂在 `window.openUserCollection` 上，后加载者覆盖前者，导致打开的 URL 可能不正确。

**建议**：统一到一个正确的 URL，删除重复实现。

### 2.2 `onAction` 等函数被多个模块重复挂载 window

| 函数 | 挂载位置 1 | 挂载位置 2 |
|------|-----------|-----------|
| `onAction` | `handlers.js:290` | `taskpane.js:363` |
| `syncCollectionFromBgm` | `handlers.js:292` | `taskpane.js:364` |
| `markUploadedItems` | `handlers.js:294` | `taskpane.js:365` |
| `clearSheetMarks` | `handlers.js:295` | `taskpane.js:366` |

**建议**：`taskpane.js` 从 `handlers.js` import 了这些函数，不应再重复挂载到 window。统一由 `handlers.js` 负责 window 挂载。

### 2.3 `SyncResult` 类型定义字段冲突

- `bangumi.d.ts:102`：`{ success, fail, skip }`
- `result.ts:121`：`{ code, message, data }`

两个同名接口字段完全不同，可能导致类型混淆。

### 2.4 `main.js` 模块加载列表不完整

`main.js:10-21` 的 `MODULES` 数组缺少以下模块（taskpane.html 有独立加载）：
- `js/http.js`
- `js/ui/dialog.js`、`js/ui/message.js`、`js/ui/preview.js`、`js/ui/handlers.js`
- `js/sync/scraping.js`
- `js/core/unified.js`

**建议**：更新 `main.js` 的加载列表，或明确文档说明 `main.js` 和 `taskpane.html` 各自的加载范围。

### 2.5 `showTokenDialog` 参数不一致

- `dialog.js:443` 定义：`showTokenDialog()` — 无参数
- `ribbon.js:52` / `handlers.js:39` 调用：`showTokenDialog(loadBgToken())` — 传了参数

**建议**：`showTokenDialog` 接受可选的 `currentToken` 参数用于预填充。

### 2.6 `js/js/` 嵌套重复文件

`js/js/util.js`、`js/js/http.js`、`js/js/types/result.js` 是 `js/` 下对应文件的完全副本，且 import 路径不可达。

**建议**：删除整个 `js/js/` 目录。

---

## 三、高优先级问题（影响代码质量/维护性）

### 3.1 `BgmError` 类重复定义

- `util.js:20-31` — 简单版本
- `core/unified.js:219-241` — 带 `toJSON()` 的扩展版本

**建议**：统一到 `core/unified.js`，`util.js` 从 `unified.js` 导入。

### 3.2 五种对话框调用模式并存

| 模式 | 示例 | 位置 |
|------|------|------|
| 原生 `alert/confirm` | `confirm(confirmMsg)` | `bangumi.js:186` |
| `window.BGMConfirm` | `window.BGMConfirm(msg, title, cb)` | `bangumi.js:178` |
| `BGM.Dialog.confirm` | `BGM.Dialog.confirm(msg, cb)` | `util.js:76` |
| `Dialog.confirm` (unified) | `Dialog.confirm(msg, cb)` | `unified.js:39` |
| `showAlert` (dialog.js) | `showAlert(msg, title)` | `dialog.js:205` |

**建议**：统一使用 `ui/dialog.js` 导出的 `showAlert/showConfirm`，删除其他模式的旧实现。

### 3.3 对话框参数顺序不一致

- `showAlert(message, title, onOk)` — `dialog.js:205`
- `showAlertDialog(title, message)` — `util.js:630`
- `Dialog.alert(title, message)` — `unified.js:26`
- `showDialog(title, message)` — `bangumi.js:141`

**建议**：全部统一为 `(message, title, callback)` 顺序。

### 3.4 `unified.js` 与 `util.js` 潜在循环依赖

`unified.js:16` 导出 `BGM` from `util.js`，而 `unified.js` 内部的 `handleError` 引用 `bgmLog`（定义在 `util.js`）。

**建议**：`unified.js` 应完全独立于 `util.js`，或将 `handleError` 的日志功能解耦。

### 3.5 `scraping.js` 完全不使用 import

`scraping.js` 没有任何 `import` 语句，完全依赖 `window` 全局变量（`bgmLog`、`setStatus`、`BGM_CONFIG` 等）。

**建议**：改为标准 ES Module import。

### 3.6 `ERROR_LEVELS` 类型定义与实际值不匹配

- `config.d.ts:77`：`MINOR/MODERATE/SERIOUS/FATAL`
- `constants.js:67`：`SILENT/WARN/ERROR/THROW`

**建议**：更新 `config.d.ts` 与实际代码一致。

### 3.7 约 70% 代码无类型覆盖

`bangumi.js`(940行)、`syncRecord.js`(553行)、`taskpane.js`(374行)、`dialog.js`(587行)、`handlers.js`(379行) 等核心模块均无类型定义。

**建议**：逐步为各模块添加 `.d.ts` 类型声明，或迁移为 `.ts`。

---

## 四、中优先级问题（影响规范/一致性）

### 4.1 `tsconfig.json` 注释乱码

`tsconfig.json` 第 3, 20, 26, 31 行中文注释显示为 `????`。

### 4.2 `iconv-lite` 依赖未被使用

`package.json` 中声明了 `iconv-lite`，但项目中没有任何文件引用它。

**建议**：执行 `npm uninstall iconv-lite`。

### 4.3 `lint`/`format` 脚本引用不存在路径

- `prettier --write src/` — `src/` 目录不存在
- eslint 配置 `.eslintrc` 不存在
- 项目中没有 `.vue` 文件

### 4.4 `latest` 标签未锁定版本

`et-jsapi-declare` 和 `wpsjs` 使用 `latest` 标签。

**建议**：锁定具体版本号。

### 4.5 CSS 双套对话框系统

- 旧系统：`.modal/.modal-content/.dialog-buttons`（`styles.css:4-60`）
- 新系统：`.bgm-modal/.bgm-btn/.bgm-toast`（`styles.css:826-1062`）

HTML 中的静态对话框已改为新系统类名，但旧系统样式仍保留。

**建议**：确认无引用后删除旧系统样式。

### 4.6 HTML 静态对话框与 dialog.js 动态对话框重复

`taskpane.html:52-83` 的 `#inputDialog/#confirmDialog/#alertDialog` 与 `dialog.js` 动态创建的 `#bgmAlertDialog/#bgmConfirmDialog` 功能重复。

**建议**：保留 `dialog.js` 动态创建的版本，删除 HTML 中的静态版本，或明确各自的使用场景。

### 4.7 大量内联样式

`taskpane.html` 中多处使用内联 `style` 属性。

**建议**：提取为 CSS 类。

### 4.8 未使用的导出函数（约 25+ 个）

| 文件 | 未使用导出 |
|------|-----------|
| `bangumi.js` | `getFilterStatus`, `getColumnValueCounts`, `getSequentialRowsBySeqCol`, `openBangumiTokenPage`, `bgmRequest` |
| `syncRecord.js` | `sendToTaskpaneSR`, `showDialogSR`, `fetchCollectionsByType` |
| `util.js` | `shellExecuteByOAAssist`, `trim`, `showAlertDialog` |
| `dialog.js` | `showDialog`, `sendToTaskpane`, `testDebugConnection`, `closeDialog` |
| `preview.js` | `filterDetailItems`, `viewSyncRecordDetail` |
| `scraping.js` | `_fetchRecordsScopeSelect`, `_runFetchBgRecords`, `httpRequestAsync` |

**建议**：清理未使用导出，或标记为 `@internal`。

---

## 五、低优先级问题（小问题/建议）

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 1 | `bgmiRequestSync` 拼写错误 | `bangumi.js:936` | 改为 `bgmRequestSync` |
| 2 | `WebNotifycount=0` 未被使用 | `ribbon.js:107` | 删除 |
| 3 | `systemdemo.js`/`functions.js` 模板残留 | 两个文件 | 删除或移到示例目录 |
| 4 | AES 密钥硬编码在前端 | `constants.js:47-52` | 接受为前端"混淆"局限，但应在文档中说明 |
| 5 | `sleep` 使用忙等待阻塞 UI | `util.js:612-625` | 在非同步场景下改用 `Promise` + `setTimeout` |
| 6 | `index.html` 结构不规范 | 全文 | 补全 `<head>`、`<title>` |
| 7 | 兼容性别名未被使用 | `constants.js:76-78` | 删除 `BGM_API_CONFIG`、`BGM_COLORS`、`TOKEN_CFG` |
| 8 | `main.js` 的 `MODULES` 数组与 `taskpane.html` 的 import 列表不一致 | 两处 | 统一加载入口 |
| 9 | `tsconfig.json`（strict）和 `tsconfig.build.json`（loose）target 不一致 | 两个文件 | 统一 target 版本 |

---

## 六、架构优化建议

### 6.1 统一 window 挂载策略

当前各模块自行挂载 window，容易冲突。建议：

```
window 挂载集中到各模块底部，taskpane.js 不再重复挂载来自 handlers.js/dialog.js 的函数
```

### 6.2 统一错误处理

将所有 `showDialog`/`showAlertDialog`/`BGM.Dialog.xxx` 统一到 `ui/dialog.js` 的一套 API：

```js
// 推荐统一接口
showAlert(message, title?)
showConfirm(message, title?, onOk?, onCancel?)
showError(message, title?)
showToast(message, type?)
```

### 6.3 清理重复文件

1. 删除 `js/js/` 目录
2. 删除 HTML 中的静态对话框（如果 dialog.js 动态版本功能完备）
3. 删除 CSS 旧样式系统

### 6.4 模块化改进

1. `scraping.js` 改为标准 ES Module（添加 import）
2. `unified.js` 解除对 `util.js` 的依赖
3. 为核心模块添加 `.d.ts` 类型声明

---

## 七、问题统计

| 严重级别 | 数量 |
|---------|------|
| 严重（影响功能） | 6 |
| 高（影响质量） | 7 |
| 中（影响规范） | 8 |
| 低（小问题） | 9 |
| **合计** | **30** |
