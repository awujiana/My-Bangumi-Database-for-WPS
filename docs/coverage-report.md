# BGM Excel 加载项 - 单元测试覆盖率报告

> **生成日期**: 2026-08-14  
> **测试框架**: Vitest v4.1.9  
> **测试文件数**: 38  
> **测试用例总数**: 1214  
> **测试通过率**: 100% (1214/1214)

---

## 一、总体覆盖率概览

| 指标                  | 已覆盖 | 目标  | 状态      |
| --------------------- | ------ | ----- | --------- |
| **Statements (语句)** | 41.19% | ≥ 80% | ⚠️ 需改进 |
| **Branches (分支)**   | 33.57% | ≥ 80% | ⚠️ 需改进 |
| **Functions (函数)**  | 47.22% | ≥ 80% | ⚠️ 需改进 |
| **Lines (行)**        | 41.47% | ≥ 80% | ⚠️ 需改进 |

> **说明**: 整体覆盖率偏低的主要原因是大量 WPS 宿主 API（COM 接口）无法在 Node.js 环境中执行。核心业务逻辑模块（`ts/sync/`、`ts/core/`、`ts/tools/`）的覆盖率已达到较高水平。

---

## 二、核心业务模块覆盖率（重点）

### 2.1 数据同步模块 (`ts/sync/`)

| 文件                      | Statements    | Branch      | Functions     | Lines         | 未覆盖行         |
| ------------------------- | ------------- | ----------- | ------------- | ------------- | ---------------- |
| **exportJsonl.ts**        | **98.8%** ✅  | **100%** ✅ | 85.71%        | **100%** ✅   | —                |
| **githubSync.ts**         | **90.44%** ✅ | 74.35%      | **97.87%** ✅ | **91.83%** ✅ | 1027, 1060, 1113 |
| **githubSyncDiff.ts**     | 83.72%        | 76.69%      | 100% ✅       | 92.3%         | 328, 359-368     |
| **githubCache.ts**        | 95.12% ✅     | 88.88%      | 100% ✅       | 94.59%        | 116-117          |
| **githubConfig.ts**       | 92.7%         | 87.09%      | 100% ✅       | 92.7%         | 287-288, 329-330 |
| **gistSync.ts**           | 92.63%        | 89.39%      | 92.85%        | 94.31%        | 15, 267, 274-275 |
| **giteeSync.ts**          | 96.29% ✅     | 89.28%      | 90.9%         | 96.29% ✅     | 95, 123          |
| **gitlabSync.ts**         | 96.29% ✅     | 89.28%      | 90.9%         | 96.29% ✅     | 95, 123          |
| **localFileSync.ts**      | **100%** ✅   | 96.55%      | **100%** ✅   | **100%** ✅   | 113              |
| **syncSourceRegistry.ts** | 94.44% ✅     | 73.01%      | 100% ✅       | 95.41%        | 149-152, 305     |
| **syncRecord.ts**         | 80.17%        | 61.65%      | 95%           | 85.02%        | 708-709, 787-788 |
| **undoStack.ts**          | 98.21% ✅     | 88.46%      | **100%** ✅   | **100%** ✅   | 85, 131, 157     |
| **pureUtils.ts**          | **100%** ✅   | **100%** ✅ | **100%** ✅   | **100%** ✅   | —                |
| **pureUtilsCore.ts**      | 96.07% ✅     | 95.55%      | 83.33%        | **100%** ✅   | 155-156          |

### 2.2 核心模块 (`ts/core/`)

| 文件             | Statements  | Branch      | Functions   | Lines       | 未覆盖行 |
| ---------------- | ----------- | ----------- | ----------- | ----------- | -------- |
| **constants.ts** | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ | —        |
| **crypto.ts**    | 92%         | **100%** ✅ | **100%** ✅ | 91.66%      | 96-97    |
| **result.ts**    | **100%** ✅ | 94.44%      | **100%** ✅ | **100%** ✅ | 278      |

### 2.3 工具模块 (`ts/tools/`)

| 文件                   | Statements  | Branch      | Functions   | Lines       | 未覆盖行          |
| ---------------------- | ----------- | ----------- | ----------- | ----------- | ----------------- |
| **sleep.ts**           | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ | —                 |
| **events.ts**          | **100%** ✅ | 94.73%      | **100%** ✅ | **100%** ✅ | 73                |
| **logBuffer.ts**       | **100%** ✅ | 85.71%      | **100%** ✅ | **100%** ✅ | 60                |
| **stringUtils.ts**     | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ | —                 |
| **stringUtilsPure.ts** | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ | —                 |
| **debounce.ts**        | 91.66%      | 80%         | **100%** ✅ | 91.66%      | 45-46             |
| **http.ts**            | 90.29%      | 78.49%      | 94.11%      | 90.22%      | 330-334, 344-347  |
| **logger.ts**          | 69.23%      | **100%** ✅ | 85.71%      | 67.56%      | 64-76             |
| **sanitize.ts**        | 72.58%      | 74.07%      | 66.66%      | 74.07%      | 202, 228, 249-276 |
| **zodCompat.ts**       | 64.11%      | 54.3%       | 58.66%      | 66.09%      | 507, 516-518, 573 |

### 2.4 工作表工具 (`ts/tools/util/`)

| 文件         | Statements | Branch | Functions   | Lines     | 未覆盖行          |
| ------------ | ---------- | ------ | ----------- | --------- | ----------------- |
| **sheet.ts** | 95.94% ✅  | 85%    | **100%** ✅ | 96.37% ✅ | 322, 362, 506     |
| **cell.ts**  | 84.84%     | 78%    | **100%** ✅ | 85.45%    | 43, 47, 51-55, 61 |

### 2.5 Schema 模块 (`ts/schemas/`)

| 文件                 | Statements  | Branch      | Functions   | Lines       |
| -------------------- | ----------- | ----------- | ----------- | ----------- |
| **bgmCollection.ts** | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ |
| **bgmUser.ts**       | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ |
| **githubEntry.ts**   | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ |
| **index.ts**         | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ |
| **pluginStorage.ts** | **100%** ✅ | **100%** ✅ | **100%** ✅ | **100%** ✅ |

---

## 三、覆盖率达标模块汇总（≥ 90% 行覆盖率）

| #   | 模块              | 文件                  | 行覆盖率   |
| --- | ----------------- | --------------------- | ---------- |
| 1   | `ts/core/`        | constants.ts          | **100%**   |
| 2   | `ts/core/`        | result.ts             | **100%**   |
| 3   | `ts/schemas/`     | bgmCollection.ts      | **100%**   |
| 4   | `ts/schemas/`     | bgmUser.ts            | **100%**   |
| 5   | `ts/schemas/`     | githubEntry.ts        | **100%**   |
| 6   | `ts/schemas/`     | index.ts              | **100%**   |
| 7   | `ts/schemas/`     | pluginStorage.ts      | **100%**   |
| 8   | `ts/sync/`        | exportJsonl.ts        | **100%**   |
| 9   | `ts/sync/`        | localFileSync.ts      | **100%**   |
| 10  | `ts/sync/`        | pureUtils.ts          | **100%**   |
| 11  | `ts/sync/`        | undoStack.ts          | **100%**   |
| 12  | `ts/tools/util/`  | sleep.ts              | **100%**   |
| 13  | `ts/tools/util/`  | stringUtils.ts        | **100%**   |
| 14  | `ts/tools/util/`  | stringUtilsPure.ts    | **100%**   |
| 15  | `ts/tools/`       | events.ts             | **100%**   |
| 16  | `ts/tools/`       | logBuffer.ts          | **100%**   |
| 17  | `ts/ui/handlers/` | _constants.ts         | **100%**   |
| 18  | `ts/ui/`          | handlers.ts           | **100%**   |
| 19  | `ts/sync/`        | giteeSync.ts          | **96.29%** |
| 20  | `ts/sync/`        | gitlabSync.ts         | **96.29%** |
| 21  | `ts/tools/util/`  | sheet.ts              | **96.37%** |
| 22  | `ts/sync/`        | syncSourceRegistry.ts | **95.41%** |
| 23  | `ts/sync/`        | githubCache.ts        | **94.59%** |
| 24  | `ts/sync/`        | githubSync.ts         | **91.83%** |
| 25  | `ts/sync/`        | gistSync.ts           | **94.31%** |
| 26  | `ts/sync/`        | githubSyncDiff.ts     | **92.3%**  |
| 27  | `ts/sync/`        | githubConfig.ts       | **92.7%**  |
| 28  | `ts/tools/`       | http.ts               | **90.22%** |

---

## 四、本次优化提升详情

### 4.1 exportJsonl.ts 优化

| 指标       | 优化前 | 优化后    | 提升    |
| ---------- | ------ | --------- | ------- |
| Statements | 76.27% | **98.8%** | +22.53% |
| Branch     | 71.42% | **100%**  | +28.58% |
| Lines      | 76.19% | **100%**  | +23.81% |

**新增测试用例**:

- `getCellText` 在 `Range` 返回 null 时回退到 `getCellValue` (Line 40)
- `findHeaderRow` 返回 0 时使用默认行号 1 (Line 70)
- `extractSubjectId` 返回 null 时跳过无效 SID (Line 86)

### 4.2 githubSync.ts 优化

| 指标       | 优化前 | 优化后     | 提升   |
| ---------- | ------ | ---------- | ------ |
| Statements | 87.67% | **90.44%** | +2.77% |
| Branch     | 71.09% | **74.35%** | +3.26% |
| Functions  | 89.36% | **97.87%** | +8.51% |
| Lines      | 89.45% | **91.83%** | +2.38% |

**新增测试用例**:

- `finally` 块恢复 `ScreenUpdating`/`Calculation` 正常路径
- `finally` 块恢复 `ScreenUpdating`/`Calculation` 异常路径
- `finally` 块恢复失败（setter 抛异常）仍安全返回
- `getSelectedRowSids` 无 `Bangumi_URL` 列警告分支
- `getSelectedRowSids` 循环内异常 ERROR 记录分支
- 时间筛选路径日志和 `onProgress` 调用验证
- `app` 为 null 时恢复逻辑安全执行
- `ScreenUpdating` setter 抛异常时同步不中断
- `readLocalEntriesForSync` 返回 null 错误路径 (Line 1391)
- `conflictResolution` 冲突解决分支 (Lines 1401-1402)
- `ensureSheetHeaders` 返回 true 路径 (Lines 1350-1351)
- 11 条 delete diffs 触发 `yieldToEventLoop` (Line 1184)

### 4.3 sleep.ts 优化

| 指标       | 优化前 | 优化后   | 提升  |
| ---------- | ------ | -------- | ----- |
| Statements | ~85%   | **100%** | +15%+ |
| Branch     | ~80%   | **100%** | +20%+ |
| Lines      | ~85%   | **100%** | +15%+ |

**新增测试用例**:

- `app.Wait` 路径调用验证
- `app.Wait` 抛异常回退到 DoEvents 路径
- `DoEvents` 抛出异常时 break 退出循环
- `bgmLog` 为非函数值时仍能正常 break
- `sleep(0)` 边界值测试
- `delay` 异步函数正确性验证

---

## 五、未覆盖分支分析

### 5.1 githubSync.ts 剩余未覆盖行 (1027, 1060, 1113)

| 行号     | 代码上下文                              | 未覆盖原因                                                                           | 建议                                    |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| **1027** | 批量写入失败后逐行写入 catch 块         | 需要 `batchWriteNewRows` 返回 0 且 `writeRemoteEntryToRow` 抛异常，依赖 WPS COM 模拟 | 在集成测试或 WPS 宿主中验证             |
| **1060** | 批量 add 写入后的 `yieldToEventLoop`    | 需要 `addTotal > BATCH_WRITE_SIZE` 且剩余未处理完                                    | 增加 BATCH_WRITE_SIZE+1 个 add diffs    |
| **1113** | 批量 update 写入后的 `yieldToEventLoop` | 需要超过 10 条 update diffs 且未全部处理完                                           | 增加 BATCH_WRITE_SIZE+1 个 update diffs |

### 5.2 githubSyncDiff.ts 剩余未覆盖行 (328, 359-368)

| 行号        | 代码上下文                              | 未覆盖原因                 |
| ----------- | --------------------------------------- | -------------------------- |
| **328**     | `parseJsonl` 空输入边界                 | 需要传入空字符串且不抛异常 |
| **359-368** | `computeDiff` mirror 策略的 delete 逻辑 | 需要完整的 mirror 策略场景 |

### 5.3 其他未覆盖模块

| 文件               | 覆盖率 | 原因                          | 建议     |
| ------------------ | ------ | ----------------------------- | -------- |
| `scraping.ts`      | 0%     | 依赖浏览器 DOM + WPS 宿主环境 | 集成测试 |
| `wps.ts`           | 16.66% | WPS COM 接口封装，需宿主环境  | 集成测试 |
| `autoFillUrl.ts`   | 0%     | 依赖 WPS 宿主                 | 集成测试 |
| `ribbonService.ts` | 0.26%  | 依赖 WPS Ribbon UI            | 集成测试 |
| `preview.ts`       | 6.33%  | 依赖 WPS 预览功能             | 集成测试 |
| `token.ts`         | 0.33%  | 依赖 WPS 认证                 | 集成测试 |

---

## 六、测试基础设施

### 6.1 测试文件清单

| #     | 测试文件                            | 测试数 | 状态 |
| ----- | ----------------------------------- | ------ | ---- |
| 1     | `tests/boundary.test.ts`            | 113    | ✅   |
| 2     | `tests/githubSync.test.ts`          | 77     | ✅   |
| 3     | `tests/githubSyncDiff.test.ts`      | 44     | ✅   |
| 4     | `tests/githubSyncCore.test.ts`      | 42     | ✅   |
| 5     | `tests/exportJsonl.test.ts`         | 20     | ✅   |
| 6     | `tests/gitlabSync.test.ts`          | 34     | ✅   |
| 7     | `tests/giteeSync.test.ts`           | 34     | ✅   |
| 8     | `tests/exceltobangumi.test.ts`      | 58     | ✅   |
| 9     | `tests/http.test.ts`                | 45     | ✅   |
| 10    | `tests/util.test.ts`                | 44     | ✅   |
| 11    | `tests/handlers.test.ts`            | 60     | ✅   |
| 12    | `tests/schemas.test.ts`             | 26     | ✅   |
| 13    | `tests/syncSourceRegistry.test.ts`  | 31     | ✅   |
| 14    | `tests/pureUtils.test.ts`           | 24     | ✅   |
| 15    | `tests/syncRecord.test.ts`          | 24     | ✅   |
| 16    | `tests/undoStack.test.ts`           | 23     | ✅   |
| 17    | `tests/crypto.test.ts`              | 22     | ✅   |
| 18    | `tests/githubConfig.test.ts`        | 20     | ✅   |
| 19    | `tests/githubCache.test.ts`         | 17     | ✅   |
| 20    | `tests/localFileSync.test.ts`       | 28     | ✅   |
| 21    | `tests/gistSync.test.ts`            | 48     | ✅   |
| 22    | `tests/util.pure.test.ts`           | 7      | ✅   |
| 23    | `tests/logger.test.ts`              | 18     | ✅   |
| 24    | `tests/debounce.test.ts`            | 8      | ✅   |
| 25    | `tests/events.test.ts`              | 14     | ✅   |
| 26    | `tests/logBuffer.test.ts`           | 7      | ✅   |
| 27    | `tests/cell.test.ts`                | —      | ✅   |
| 28    | `tests/sheet.test.ts`               | —      | ✅   |
| 29    | `tests/sleep.test.ts`               | 11     | ✅   |
| 30    | `tests/result.test.ts`              | 39     | ✅   |
| 31    | `tests/configService.test.ts`       | 22     | ✅   |
| 32    | `tests/showSettingsPanel.test.ts`   | 12     | ✅   |
| 33    | `tests/syncSource.test.ts`          | 7      | ✅   |
| 34    | `tests/exceltobangumi.pure.test.ts` | 31     | ✅   |
| 35-38 | 其他测试文件                        | ~96    | ✅   |

### 6.2 Mock 策略说明

| Mock 类型            | 覆盖范围              | 限制                 |
| -------------------- | --------------------- | -------------------- |
| **XMLHttpRequest**   | HTTP 请求模拟         | 不支持真实网络       |
| **WPS Application**  | `getApp()` 返回值     | 不支持真实 COM 调用  |
| **WPS Worksheet**    | `Range()`, `Cells` 等 | 不支持真实单元格操作 |
| **DOM API**          | `document`, `window`  | 仅支持基本属性       |
| **WPS LocalStorage** | 读写存储              | 不支持真实持久化     |

### 6.3 运行命令

```bash
# 全量测试
npx vitest run

# 单文件测试
npx vitest run tests/githubSync.test.ts

# 覆盖率报告
npx vitest run --coverage

# 覆盖率（指定文件）
npx vitest run --coverage tests/githubSync.test.ts
```

---

## 七、改进建议

### 7.1 短期改进（可立即执行）

1. **补充 `githubSync.ts` lines 1060/1113 覆盖**
   - 方案：构造超过 `BATCH_WRITE_SIZE` 条 diffs，验证批量写入后的 `yieldToEventLoop`
   - 预计提升：分支覆盖率 +2~3%

2. **补充 `githubSyncDiff.ts` 空输入边界测试**
   - 方案：为 `parseJsonl` 传入空字符串、纯空白字符串
   - 预计提升：行覆盖率 +1~2%

3. **补充 `syncRecord.ts` 未覆盖分支**
   - 方案：测试 `updateRecord` 的 null 参数、空数组参数
   - 预计提升：行覆盖率 +3~5%

### 7.2 中期改进（需 WPS 宿主环境）

1. **集成测试**：在 WPS Office 环境中运行端到端测试
2. **COM 接口测试**：使用 WPS Developer Mode 或录制宏验证真实 COM 调用
3. **UI 测试**：使用 Playwright/Puppeteer 测试 Taskpane 交互

### 7.3 长期架构优化

1. **抽象 WPS 接口层**：将 COM 调用封装为接口，便于 Mock
2. **引入测试数据库**：使用 SQLite/内存数据库替代 Excel 进行数据验证
3. **CI 集成**：设置覆盖率门禁，低于 80% 禁止合并

---

## 附录：覆盖率统计方法

- **工具**: Vitest v4.1.9 + @vitest/coverage-v8
- **配置**: `vitest.config.ts` / `vite.config.ts`
- **阈值**: 行覆盖率 ≥ 80%（核心模块 ≥ 90%）
- **数据来源**: `npx vitest run --coverage` 实际运行结果
- **报告生成时间**: 2026-08-14 12:43

---

_本文档由自动化测试运行生成，反映当前代码状态。每次提交后请重新运行 `npx vitest run --coverage` 验证。_
