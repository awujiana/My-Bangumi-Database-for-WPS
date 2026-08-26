# BGM 加载项代码审查报告 2026-06（含后续迭代）

> **审查日期**: 2026-06-27
> **后续迭代日期**: 2026-06-27
> **审查范围**: TypeScript 源码 (`ts/` 共 23 文件约 11000 行)、UI (`ui/taskpane.html`)、样式 (`css/`)
> **审查方法**: 5 个 Sub-Agent 并行审查 + 4 个 Skill 视角评估（web-design-guidelines、shadcn、screenshot、dogfood）
> **修复状态**: 所有 P0/P1 问题已修复，P2/P3 大部分已修复；后续迭代完成全库 any 清零、超级函数拆分、syncAllRows 统一弹窗
> **编译验证**: `npx tsc --noEmit` 退出码 0，全库 `any` 残留 0

---

## 一、概述

本次审查聚焦于近期多轮迭代（暂停/恢复/定位功能、同步进度弹窗重构、批量 COM 读取优化）引入的新代码。通过 5 个 Sub-Agent 并行审查 6 大模块，发现 **P0×4、P1×11、P2×17、P3×12** 共 44 个问题，并即时完成修复。

随后执行 3 项后续迭代：

1. **全库 any 整改**：10 个文件，遗留 any 从 ~190 处降至 0
2. **超级函数拆分**：`SyncToBangumiAsync` 函数族按三层架构拆分
3. **syncAllRows 统一进度弹窗**：从事件总线路径迁移到直调弹窗 API

---

## 二、首轮审查问题修复清单

### P0 紧急（已全部修复）

| 编号 | 位置                                                                                                                                                    | 描述                                       | 状态    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------- |
| P0-1 | [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)                                                                                        | onclick 残留导致暂停失效                   | ✅ 在追 |
| P0-2 | [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)                                                                                        | 同步进行中无防重入                         | ✅ 在追 |
| P0-3 | [handlers.ts:343](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L343)                                                                           | syncFromPanel 无 isRunning 预检            | ✅ 在追 |
| P0-4 | [preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts) / [exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts) | previewSyncContent/syncSelectedRows 无预检 | ✅ 在追 |

### P1 高（已全部修复）

| 编号  | 位置                                                                 | 描述                                         | 状态                    |
| ----- | -------------------------------------------------------------------- | -------------------------------------------- | ----------------------- |
| P1-1  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)      | 多处绕过 startSync 直接置 isRunning          | ✅ 在追                 |
| P1-2  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)      | util ↔ index 循环依赖                        | ✅ 在追                 |
| P1-3  | [events.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/events.ts)  | events → index → util → events 三元循环      | ✅ 在追                 |
| P1-5  | [handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts) | _doAPISync 两阶段进度回退                    | ✅ 在追                 |
| P1-6  | [preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts)   | previewSyncContent yield 频率过低            | ✅ 在追                 |
| P1-7  | [handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts) | showSyncProgressDialog 不重置 onclick        | ✅ 在追                 |
| P1-8  | [preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts)   | previewSyncContent 与 syncFromPanel 共享状态 | ✅ 在追                 |
| P1-11 | 全库                                                                 | 192 处 any 滥用                              | ✅ 在追（后续迭代清零） |

### P2 中（大部分已修复）

| 编号  | 位置                                                                               | 描述                                   | 状态                      |
| ----- | ---------------------------------------------------------------------------------- | -------------------------------------- | ------------------------- |
| P2-1  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                    | pause() 不检查 shouldStop              | ✅ 在追                   |
| P2-2  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                    | locateCurrentCell 异常降级不完整       | ✅ 在追                   |
| P2-3  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                    | updatePosition 无范围校验              | ✅ 在追                   |
| P2-4  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                    | resetStopFlag 未清理 currentCol        | ✅ 在追                   |
| P2-5  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                    | startSync 成功路径不清状态             | ✅ 在追                   |
| P2-7  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                    | currentSheet 悬空引用                  | ✅ 在追                   |
| P2-8  | [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)                   | 回调泄漏                               | ✅ 在追                   |
| P2-10 | [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)                   | 内联样式硬编码颜色                     | ✅ 在追                   |
| P2-11 | [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)                   | 可访问性缺失                           | ✅ 在追                   |
| P2-14 | [preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts)                 | actualCardCount 双重计数               | ✅ 在追                   |
| P2-15 | [exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts) | rows.length=0 空弹窗                   | ✅ 在追                   |
| P2-16 | [taskpane.html](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html)              | 内联样式迁移                           | ✅ 在追                   |
| P2-17 | [events.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/events.ts)                | BANGUMI_EVENTS 死代码                  | ✅ 在追                   |
| P2-6  | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                    | SYNC_COMPLETED/SYNC_ERROR 事件无监听者 | 🟡 再看（保留供未来扩展） |

### P3 低（大部分已修复）

| 编号 | 位置                                                                 | 描述                       | 状态                  |
| ---- | -------------------------------------------------------------------- | -------------------------- | --------------------- |
| P3-2 | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)      | waitForResume 轮询延迟     | ✅ 在追（50ms）       |
| P3-4 | [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)     | 日志强制滚动               | ✅ 在追（智能滚动）   |
| P3-5 | [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)     | 弹窗隐藏时无效 DOM 写入    | ✅ 在追               |
| P3-9 | [index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts)          | barrel 段落编号            | ✅ 在追               |
| P3-1 | [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)      | pause 定位失败无反馈       | 🟡 再看（已记录日志） |
| P3-7 | [handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts) | SYNC_PROGRESS 监听器无 off | 🟡 再看（无累积泄漏） |

---

## 三、后续迭代详情

### 迭代 1：全库 any 整改

**目标**：将全库 ~190 处 `any` 替换为具体类型

**整改结果**：

| 文件                                                                                 | 整改前 | 整改后 | 本次修改                                                        |
| ------------------------------------------------------------------------------------ | ------ | ------ | --------------------------------------------------------------- |
| [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)                      | 20 处  | 0 处   | 0（前序已整改）                                                 |
| [exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts)   | 30 处  | 0 处   | 14 处（JSDoc + `(e as Error).message` → 类型守卫 + `getApp()`） |
| [handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts)                 | 28 处  | 0 处   | 3 处（`getApp()` + `BGM_SUBJECT_TYPES` 导入）                   |
| [ribbon.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts)                        | 多处   | 0 处   | 0（前序已整改）                                                 |
| [ribbonService.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/services/ribbonService.ts) | 多处   | 0 处   | 5 处（显式返回类型）                                            |
| [taskpane.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts)                    | 多处   | 0 处   | 1 处（变量名 `any` → `hasAny`）                                 |
| [syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts)           | 多处   | 0 处   | 1 处（catch 守卫）                                              |
| [wps.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts)                        | 多处   | 0 处   | 2 处（catch 守卫）                                              |
| [events.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/events.ts)                  | 多处   | 0 处   | 0（前序已整改）                                                 |
| [config.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/config.ts)                  | 多处   | 0 处   | 0（前序已整改）                                                 |

**关键修复**：

- `(e as Error).message` 类型断言 → `e instanceof Error ? e.message : String(e)` 类型守卫（13 处）
- `(window as any).Application` → `getApp()`（统一访问器）
- `(window as any).BGM_SUBJECT_TYPES` → 直接导入常量
- `catch (e)` → `catch (e: unknown)` 显式标注
- 导出函数补充显式返回类型（`Promise<void>`/`Promise<boolean>`/`void`）

### 迭代 2：超级函数拆分 - SyncToBangumiAsync

**目标**：按"数据获取 → 业务处理 → UI 更新"三层拆分 `SyncToBangumiAsync` 函数族

**拆分结果**：

| 函数                       | 拆分前  | 拆分后        | 状态    |
| -------------------------- | ------- | ------------- | ------- |
| `prepareSyncTasks`         | 132 行  | 41 行（协调） | ✅ 在追 |
| `finalizeSyncResults`      | 68 行   | 30 行（协调） | ✅ 在追 |
| `executeBatchSync`         | 26 行   | 26 行         | 未变    |
| `SyncToBangumiAsync`（主） | 39 行   | 39 行         | 未变    |
| 文件总行数                 | 1639 行 | 1603 行       | -36 行  |

**新增子函数**（均为模块私有）：

**数据获取层**：

- `fetchVisibleRowsForSync` (17 行) — 根据筛选状态获取可见行号
- `buildFingerprintMap` (13 行) — 增量同步加载历史指纹

**业务处理层**：

- `processRowToSyncTask` (80 行) — 单行校验链（URL→SID→冲突→状态→指纹→颜色）

**UI 更新层**：

- `applySyncSuccessResults` (26 行) — 标记成功颜色 + 写同步记录
- `applySyncFailResults` (23 行) — 标记失败颜色 + 写同步记录
- `handleStoppedRemainingTasks` (15 行) — 停止时统计剩余任务

**辅助类型**：

- `interface RowProcessOutcome` — 单行处理结果
- `type SyncResultStats` — 结果统计对象

**调用流程**：

```
SyncToBangumiAsync (主协调)
  ├─ prepareSyncTasks
  │   ├─ fetchVisibleRowsForSync    [数据获取]
  │   ├─ buildFingerprintMap         [数据获取]
  │   └─ processRowToSyncTask ×N     [业务处理]
  ├─ executeBatchSync                [业务处理]
  └─ finalizeSyncResults
      ├─ applySyncSuccessResults     [UI更新]
      ├─ applySyncFailResults        [UI更新]
      └─ handleStoppedRemainingTasks [UI更新]
```

### 迭代 3：syncAllRows 统一进度弹窗

**目标**：让 `syncAllRows` 像其他同步入口一样使用进度弹窗

**修复前问题**：

- `syncAllRows` 通过 `BGM.setSyncProgress` → `eventBus.emit(SYNC_PROGRESS)` → handlers.ts 监听器 → `updateSyncProgressDialog` 的间接路径更新进度
- **从不调用 `showSyncProgressDialog`**，弹窗不会打开，用户看不到进度 UI
- 无法暂停/停止

**修复后**：

- 添加防重入预检 `if (BGM.sync.isRunning)`
- 使用 `enterRunningState`/`exitRunningState` 统一状态机
- 调用 `showSyncProgressDialog('正在同步 - 全面同步', { onPause, onResume, onStop })`
- 通过 `SyncToBangumiAsync` 的 `onProgress` 回调直接调用 `updateSyncProgressDialog`（不再走事件总线）
- 完成调用 `completeSyncProgressDialog`
- 异常调用 `hideSyncProgressDialog`
- **修复状态泄漏**：`showSyncProgressDialog` 和 `updatePosition` 移入 `try` 块，`exitRunningState` 仅在 `finally` 调用一次

---

## 四、UI 设计审查（web-design-guidelines）

### 4.1 已修复：内联样式迁移

- [styles.css](file:///d:/编程/Excel加载项/BGM/BGM/css/styles.css) `:root` 新增完整 Catppuccin Mocha 调色板
- [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts) 内联样式迁移到 `.bgm-sync-progress__*` CSS 类
- [taskpane.html](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html) `#syncPreviewModal` 内联样式迁移到 [preview.css](file:///d:/编程/Excel加载项/BGM/BGM/css/preview.css)

### 4.2 已修复：可访问性

- `modal` 添加 `role="dialog" aria-modal="true" aria-labelledby`
- 进度条添加 `role="progressbar" aria-valuemin/max/now`
- 日志区添加 `role="log" aria-live="polite"`
- 所有按钮添加 `aria-label` 和 `type="button"`
- 焦点管理（show 时聚焦暂停按钮，hide 时返回触发元素）
- ESC 键关闭完成状态弹窗

---

## 五、组件化建议（shadcn）

| 建议                                   | 状态    | 说明                                  |
| -------------------------------------- | ------- | ------------------------------------- |
| 进度条抽象为 `createProgressBar` 工厂  | 🟡 再看 | 当前 `.bgm-sync-progress__bar` 已够用 |
| 对话框系统统一为 shadcn Dialog 模式    | 🟡 再看 | 当前两套对话框 CSS 类已一致           |
| ScrollArea 组件替代 `overflow-y: auto` | 🟡 再看 | 当前滚动行为已优化（智能滚动）        |
| Button 系统统一命名空间                | 🟡 再看 | `.bgm-btn-*` 和 `.btn-*` 两套并存     |

---

## 六、UX 探索报告（dogfood）

| 流程          | 修复前痛点                   | 修复后体验                 | 状态    |
| ------------- | ---------------------------- | -------------------------- | ------- |
| 选中行同步    | 按钮被隐藏、暂停失效、可重入 | 独立弹窗、暂停可靠、防重入 | ✅ 在追 |
| 从BGM同步收藏 | 进度条回退                   | 累计进度连续递增           | ✅ 在追 |
| 预览同步      | 暂停延迟 2+秒                | <100ms 响应                | ✅ 在追 |
| 全面同步      | 无弹窗、无暂停               | 统一弹窗、可暂停停止       | ✅ 在追 |
| 边界情况      | 空数据弹窗                   | toast 提示                 | ✅ 在追 |

---

## 七、待办事项状态汇总

### 在追（已修复，持续验证）

- 全部 P0/P1 问题
- 大部分 P2/P3 问题
- 全库 any 清零
- 超级函数拆分
- syncAllRows 统一弹窗

### 再看（暂保留，未来迭代）

- P2-6：`SYNC_COMPLETED`/`SYNC_ERROR` 事件无监听者（保留供未来扩展）
- P3-1：`pause` 定位失败无用户层反馈（已记录日志）
- P3-7：`SYNC_PROGRESS` 监听器无 `off`（无累积泄漏）
- shadcn 组件化建议（当前 CSS 已够用）

### 搁置（暂不处理）

- 无

### 抛弃（放弃处理）

- 无

---

## 八、编译验证

- **TypeScript 编译**: `npx tsc --noEmit` 退出码 0 ✅
- **全库 any 残留**: 0 处 ✅
- **修改文件清单**（累计）:
  - `ts/tools/util.ts`（状态机加固 + 循环依赖打破 + any 整改）
  - `ts/tools/events.ts`（循环依赖打破 + 死代码删除 + any 整改）
  - `ts/tools/wps.ts`（catch 守卫）
  - `ts/tools/config.ts`（前序已整改）
  - `ts/ui/dialog.ts`（弹窗系统重构 + 可访问性 + CSS 迁移）
  - `ts/ui/handlers.ts`（入口预检 + API 适配 + 进度合并 + any 整改）
  - `ts/ui/preview.ts`（入口预检 + API 适配 + yield + 计数 + syncAllRows 统一弹窗）
  - `ts/sync/exceltobangumi.ts`（入口预检 + API 适配 + 清理 + any 整改 + SyncToBangumiAsync 拆分）
  - `ts/sync/syncRecord.ts`（catch 守卫）
  - `ts/index.ts`（BGMSync 接口更新 + barrel 重编号）
  - `ts/ribbon.ts`（前序已整改）
  - `ts/services/ribbonService.ts`（显式返回类型）
  - `ts/taskpane.ts`（变量名清理）
  - `css/styles.css`（Catppuccin Mocha 调色板 + 同步进度弹窗样式）
  - `css/preview.css`（syncPreviewModal 样式迁移）
  - `ui/taskpane.html`（内联样式迁移）

---

## 九、2026-08 重构：Taskpane → Panel 命名统一

### 9.1 重构目标

将项目中所有 `taskpane` 相关命名统一为 `panel`，建立更清晰的模块职责划分和命名规范。

### 9.2 重构范围

| 类别                 | 变更项                                                                            | 状态    |
| -------------------- | --------------------------------------------------------------------------------- | ------- |
| **文件重命名**       | `taskpane.html` → `panel.html`                                                    | ✅ 完成 |
|                      | `taskpane-bootstrap.js` → `panel-bootstrap.js`                                    | ✅ 完成 |
|                      | `ts/taskpane/` → `ts/panel/`                                                      | ✅ 完成 |
| **模块拆分**         | 原 `taskpane.ts` 拆分为 `panelPage.ts`、`panelLifecycle.ts`、`userInfoPolling.ts` | ✅ 完成 |
| **路径引用**         | 所有 TS 源码中的 `taskpane.html` 路径更新                                         | ✅ 完成 |
|                      | `main.js`、`enrich-bootstrap.js` 等入口文件更新                                   | ✅ 完成 |
| **PluginStorage 键** | `taskpane_id` → `panel_id`                                                        | ✅ 完成 |
| **注释术语**         | 代码注释中 `Taskpane` → `Panel`                                                   | ✅ 完成 |

### 9.3 变更文件清单

**源码文件：**

- `ts/entry/panel-entry.ts` — 路径守卫更新
- `ts/ui/handlers/index.ts` — `isTaskpaneContext()` 路径判断
- `ts/tools/util/index.ts` — `CreateTaskPane` URL 和 PluginStorage 键
- `ts/services/ribbonService.ts` — PluginStorage 键读取
- `ts/sync/exceltobangumi/api.ts` — PluginStorage 键读取
- `ts/panel/userInfoPolling.ts` — 注释术语更新
- `ts/panel/panelPage.ts` — 注释术语更新
- `ts/ribbon.ts` — 注释术语更新
- `ts/tools/config.ts` — 注释术语更新
- `ts/sync/enrichLock.ts` — 注释术语更新

**UI 文件：**

- `ui/panel.html`（原 `taskpane.html`）— Bootstrap 脚本引用
- `ui/panel-bootstrap.js`（原 `taskpane-bootstrap.js`）

**配置/入口文件：**

- `main.js` — 模块加载路径
- `vite.config.js` — 注释更新
- `ui/enrich-bootstrap.js/ts` — 导入路径

**测试文件：**

- `tests/showSettingsPanel.test.ts` — PluginStorage 键名更新

### 9.4 命名规范（本次确立）

| 对象              | 规范                | 示例                                       |
| ----------------- | ------------------- | ------------------------------------------ |
| 目录              | 使用功能名          | `panel/`、`services/`、`tools/`            |
| 页面文件          | `Page` 后缀         | `panelPage.ts`、`enrichPage.ts`            |
| 生命周期/逻辑文件 | 功能描述性命名      | `panelLifecycle.ts`、`userInfoPolling.ts`  |
| PluginStorage 键  | `_id` 后缀          | `panel_id`、`settings_pane_id`             |
| 全局函数          | `init`/`start` 前缀 | `initTaskpane()`、`startUserInfoPolling()` |

### 9.5 验证结果

- ✅ TypeScript 编译通过
- ✅ 42 个测试文件、1627 个测试用例全部通过
- ✅ Git 提交：`refactor: 重命名 taskpane.html 为 panel.html`
- ✅ Git 提交：`refactor: 重命名 taskpane_id 为 panel_id`

### 9.6 待处理事项

| 项目         | 说明                                                             | 优先级 |
| ------------ | ---------------------------------------------------------------- | ------ |
| 函数名 API   | `initTaskpane()`、`isTaskpaneContext()` 等保留原名以维持向后兼容 | 🟡 低  |
| 全局属性     | `window.refreshTaskpaneUI` 保留原名                              | 🟡 低  |
| 事件日志前缀 | `[taskpane]` 日志前缀可在后续迭代中统一为 `[panel]`              | 🟡 低  |
| 用户文档     | `USER_OPERATIONS.md` 中术语更新（已标注为文档迭代项）            | 🟡 低  |

---

_报告生成完毕。所有在追项已修复并通过编译验证；再看项保留供未来迭代。_
