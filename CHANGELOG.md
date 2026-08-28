# 更新日志（CHANGELOG）

> 本文件按「内部功能版本」记录重大变更。注意：`package.json` 中的 `version` 字段（当前 `1.0.0`）为 npm 包发布版本，与本文档的 `v3.x` 内部功能版本相互独立，二者不要求一致。

本文档与 [`文档/USER_OPERATIONS.md`](文档/USER_OPERATIONS.md)（用户手册版本历史）、[`文档/ARCHITECTURE.md`](文档/ARCHITECTURE.md)（架构文档版本历史）互为补充：架构级变更以架构文档为准，操作级变更以用户手册为准，本文件提供跨文档的总览索引。

---

## [v3.5] - 2026-08-28

### 新增

- **收藏回写空表自动填充**：当工作表为空（无 Bangumi URL 数据行）时，`syncCollectionFromBgm` 在验证 Token 并拉取用户收藏列表后，会弹出确认对话框，经用户确认后自动写入标准表头并将 Bangumi 账号收藏条目（URL、名称、别名、类别、是否看完、打分、标签、感言、序列号）填充到 Excel，随后继续原有颜色标记流程。详见 `ts/ui/handlers/sync.ts` 的 `_fillSheetWithCollections` 与重构后的 `_doAPISync`。

### 修复

- 恢复缺失的 `css/panel-theme.css` 源文件（此前仅 `dist/css/panel-theme.css` 被跟踪，源码缺失会导致 Vite 构建后面板样式 404）。

---

## [v3.4] - 2026-08-26

### 变更

- **移除收藏回写数据源选择**：收藏回写固定走 Bangumi API，删除「Bangumi API / GitHub 仓库」二选一下拉框、对应 UI、配置键 `bgm_writeback_source` 及文档说明。相关提交：`ad6e6f18`。

---

## [v3.3] - 2026-08-26

### 变更

- 循环依赖治理：创建 `types.ts`/`container.ts`/`services.ts`/`errorHandler.ts` 核心模块；扩展 EventBus 新增 `STATE_CHANGED`/`CONFIG_CHANGED` 事件；`index.ts` 瘦身为纯 re-export 便利桶；移除各模块对 `index.ts` 的直接依赖；函数名统一（`initTaskpane`→`initPanel` 等）。

---

## [v3.2] - 2026-08-26

### 变更

- 命名规范重构：`taskpane/` 目录重命名为 `panel/`，页面文件使用 `Page` 后缀（`panelPage.ts`/`enrichPage.ts`），`taskpane-entry.ts` → `panel-entry.ts`；删除旧兼容文件 `ts/taskpane.ts`；统一 `@module` JSDoc 标签。

---

## [v3.1] - 2026-08-26

### 修复

- enrichLock.ts 边界加固：WPS API null 返回安全处理、冗余查找逻辑简化、边界情况文档完善。

---

## [v3.0] - 2026-08-26

### 新增

- 富化功能工作簿选择与锁定机制（`enrichLock.ts`）：跨工作簿 Bangumi 追踪表选择、PluginStorage 持久化、启动恢复校验、与面板锁定独立运行。

---

## [v2.9] - 2026-08-26

### 新增

- 新增 enrichEngine 富化引擎（新番表 + 简介工作表双阶段富化）、标注白名单机制、自动添加缺失列、声优字段支持、数据同步列位置无关性验证、边界情况修复（parseRemoteContent 空值检查、getAnnotatedValue 空值守卫）、42 项边界测试。

---

## [v2.8] - 2026-08-21

### 修复

- 修复 GitHub 同步编译错误、同步完成弹窗支持明细表格。

---

## [v1.0] - 2026-08-10

### 初始版本

- WPS Excel 加载项基础能力：上传同步、数据同步（远程仓库 → Excel）、收藏下载、5 种同步策略、同步偏好、新番表富化、Token 管理、双面板 UI。
