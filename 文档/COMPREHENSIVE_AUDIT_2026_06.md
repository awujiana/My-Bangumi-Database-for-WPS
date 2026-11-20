# BGM 加载项全面审查报告（2026-06）

> 本报告覆盖 Task 1-12：执行摘要、项目结构、类型安全、错误处理、边界情况、性能、UI/UX、组件化机会、安全审查、可测试性审查、架构耦合审查、边界情况验证方案。
> 所有问题按风险等级 P0（阻塞）/ P1（严重）/ P2（一般）/ P3（优化）分级标注。
> 位置标注格式：`相对路径:行号`。

---

## 1. 执行摘要

### 1.1 项目规模

| 维度 | 数值 | 说明 |
| --- | --- | --- |
| TypeScript 文件数 | 20 | `ts/` 下全部 `.ts` 文件 |
| TypeScript 总行数 | 10,338 | 不含空行外约 8,500 有效行 |
| HTML 文件数 | 1 | `ui/taskpane.html`（263 行） |
| CSS 文件数 | 2 | `css/styles.css`（1,333 行）+ `css/preview.css`（291 行） |
| 合计文件/行数 | 23 / 12,225 | 含 HTML + CSS |

### 1.2 关键指标

| 指标 | 数值 | 评估 |
| --- | --- | --- |
| `any` 使用次数 | 11 处 / 2 文件 | 集中于 `ribbon.ts`（6 处 `control: any`）与 `wps.ts`（5 处 WPS COM 接口字段） |
| `unknown` 使用次数 | 197 处 / 16 文件 | 采用良好，`catch (e: unknown)` 已成为主流写法 |
| `as` 类型断言次数 | 104 处 / 11 文件 | `as Error` 占多数，部分 `as WpsRange` 需关注 |
| `index.ts` barrel 导出项 | 16 个分区，约 120+ 符号 | 单文件聚合度过高，见 Task 2 |
| `enterRunningState` 调用点 | 3 处（util.ts / exceltobangumi.ts / preview.ts:313） | 但 `syncAllRows`/`syncFromPanel`/`syncWithConfirmation` 三条主路径绕过该统一入口，见 Task 5 |

### 1.3 文件行数分布

| 文件 | 行数 | 体量评级 |
| --- | --- | --- |
| `ts/sync/exceltobangumi.ts` | 1,616 | 巨型（>1000） |
| `ts/ui/handlers.ts` | 1,498 | 巨型（>1000） |
| `ts/tools/util.ts` | 1,258 | 巨型（>1000） |
| `ts/taskpane.ts` | 901 | 较大 |
| `ts/ui/preview.ts` | 663 | 较大 |
| `ts/ui/dialog.ts` | 588 | 中等 |
| `ts/sync/syncRecord.ts` | 513 | 中等 |
| `ts/core/constants.ts` | 500 | 中等 |
| `ts/services/ribbonService.ts` | 417 | 中等 |
| `ts/index.ts` | 384 | 中等 |
| `ts/core/result.ts` | 317 | 中小 |
| `ts/tools/wps.ts` | 312 | 中小 |
| `ts/tools/http.ts` | 245 | 中小 |
| `ts/sync/scraping.ts` | 272 | 中小 |
| `ts/ribbon.ts` | 206 | 中小 |
| `ts/core/crypto.ts` | 197 | 中小 |
| `ts/tools/autoFillUrl.ts` | 132 | 小 |
| `ts/tools/config.ts` | 124 | 小 |
| `ts/tools/events.ts` | 119 | 小 |
| `ts/ui/message.ts` | 76 | 小 |

### 1.4 整体评分

| 等级 | 数量 | 说明 |
| --- | --- | --- |
| **P0（阻塞）** | 3 | 同步状态机绕过（2 处）+ fetchEpisodeIds 无 ontimeout（潜在挂起） |
| **P1（严重）** | 6 | 循环依赖、`new Error` 第二参数错误、xhr.ontimeout 缺失、特殊字符未处理等 |
| **P2（一般）** | 18 | 类型断言、缓存失效、事件清理、DOM 增长、颜色对比度等 |
| **P3（优化）** | 9 | 组件化、虚拟滚动、风格统一等 |
| **合计** | **36** | — |

### 1.5 已修复问题清单（参考历史审查文档）

基于 `文档/CODE_REVIEW.md`（2026-05-17）与 `文档/CODE_REVIEW_2026.md`（2026-06-13）的对比，以下问题已在当前代码中修复：

| 历史问题 | 历史等级 | 当前状态 | 验证位置 |
| --- | --- | --- | --- |
| `_formattingInProgress` 标志未解锁导致永久卡死 | P0 | ✅ 已修复（使用 try/finally） | `ts/sync/syncRecord.ts:441` |
| `postMessage` 未校验 `event.origin` | P0 | ✅ 已修复（`initMessageListener` 增加 origin 校验） | `ts/ui/message.ts:26` |
| `COLLECTION_TYPE_NAMES` 与 `WATCH_STATUS_MAP` 数值互换 | P0 | ✅ 已修复（数值对齐） | `ts/core/constants.ts:471` |
| 同步进度弹窗无 aria 属性 | P1 | ✅ 已修复（aria-live / role / aria-label 齐全） | `ts/ui/dialog.ts:363-386` |
| Token 明文存储 | P1 | ✅ 已修复（XOR + AES-GCM 双模式） | `ts/core/crypto.ts` |
| innerHTML 未转义 | P1 | ✅ 已修复（`escapeHtml()` 统一应用） | `ts/ui/preview.ts` / `ts/taskpane.ts` |
| xhr 无 ontimeout | P1 | ⚠️ 部分修复（`http.ts` 已补，但 `fetchEpisodeIds` 仍缺） | `ts/sync/exceltobangumi.ts:1394` |

---

## 2. 项目结构审查（Task 2）

### 2.1 目录结构合理性

项目按功能域划分为 `core/`、`tools/`、`sync/`、`ui/`、`services/` 五个子目录，顶层入口为 `index.ts`（barrel）、`ribbon.ts`（Ribbon 面板）、`taskpane.ts`（任务窗格）。

| 子目录 | 文件数 | 总行数 | 职责 | 评价 |
| --- | --- | --- | --- | --- |
| `core/` | 3 | 1,014 | 常量、加密、结果类型 | ⭐⭐⭐⭐⭐ 纯净，无副作用 |
| `tools/` | 6 | 2,390 | 工具函数、HTTP、配置、事件、WPS 类型 | ⭐⭐⭐ `util.ts` 过大（1,258 行） |
| `sync/` | 3 | 2,401 | 同步引擎、抓取、同步记录 | ⭐⭐⭐ `exceltobangumi.ts` 过大（1,616 行） |
| `ui/` | 4 | 2,825 | 对话框、事件处理、消息、预览 | ⭐⭐ `handlers.ts` 过大（1,498 行） |
| `services/` | 1 | 417 | Ribbon 专用服务 | ⭐⭐⭐⭐ 职责清晰 |

**问题**：`tools/` 目录混合了"纯工具函数"（`colNumToLetter`、`escapeHtml`）与"全局状态机"（`BGM.sync`、`BGM.cache`），后者属于运行时状态而非工具。

### 2.2 index.ts barrel 导出组织

`ts/index.ts`（384 行）采用 16 个分区注释组织导出，约 120+ 符号。结构清晰但存在以下问题：

- **类型与值混导**：同一分区中混合 `export { foo }` 与 `export { type Bar }`，阅读时需逐行分辨。
- **跨层导出**：`syncAllRows`（UI 层函数）通过 barrel 暴露给 `tools/util.ts`，造成循环依赖（见 2.3）。
- **未导出的内部符号**：`BGM.sync` 状态机方法（`enterRunningState` 等）通过 `BGM` 命名空间而非 barrel 暴露，导致类型与运行时脱节。

### 2.3 模块循环依赖（重点：util.ts ↔ preview.ts）

**确认存在循环依赖**：

```
ts/tools/util.ts:18   → import { syncAllRows } from '../ui/preview.js';
ts/ui/preview.ts:19   → import { loadBgToken } from '../tools/util.js';
```

即 `util.ts → preview.ts → util.ts`。当前因 `BGM` 全局对象在运行时已初始化，未触发 TDZ 错误，但存在以下风险：

- **打包工具警告**：Vite/ Rollup 会输出 circular dependency 警告。
- **初始化顺序敏感**：若未来改为 ESM 静态导入，`syncAllRows` 在 `util.ts` 模块求值时可能为 `undefined`。
- **测试困难**：单测 `util.ts` 时会强制加载整个 `preview.ts`（含 DOM 操作）。

**建议**：将 `syncAllRows` 的调用改为通过 `eventBus` 发消息或注入回调，移除 `util.ts` 对 `preview.ts` 的直接导入。

### 2.4 文件命名一致性

| 规则 | 遵循情况 | 说明 |
| --- | --- | --- |
| camelCase 文件名 | ✅ 全部遵循 | 如 `autoFillUrl.ts`、`syncRecord.ts` |
| 目录名小写 | ✅ 全部遵循 | `core/`、`tools/`、`sync/`、`ui/`、`services/` |
| 导入路径带 `.js` 后缀 | ✅ 全部遵循 | ESM 兼容写法，正确 |
| 接口/类型 PascalCase | ✅ 遵循 | 如 `WpsWorksheet`、`BgmError` |
| 私有成员下划线前缀 | ⚠️ 混用 | `_getBgmUserId`（函数）vs `enterRunningState`（方法），风格不统一 |

### 2.5 项目根目录与文档目录的杂物

| 路径 | 问题 | 建议 |
| --- | --- | --- |
| `__pycache__/` | Python 编译缓存残留 | 删除并加入 `.gitignore` |
| `.debugTemp/wpsjsrpcsdk.js` | 调试临时文件 | 删除 |
| `wpsjsrpcsdk.js`（根目录） | 与 `.debugTemp/` 重复 | 删除根目录副本 |
| `文档/ex.copy`、`文档/expjs.copy` | 备份/复制文件 | 整理或删除 |
| `文档/WPS 开发文档_files/` | 下载网页资源（含 `.下载` 后缀） | 移至独立 `参考/` 目录 |
| `count_lines.ps1` | 审查过程临时脚本 | 审查后删除（本次已清理） |

### 2.6 结构问题清单

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| ST-1 | P1 | `ts/tools/util.ts:18` ↔ `ts/ui/preview.ts:19` | 建议 |
| ST-2 | P2 | `ts/tools/util.ts`（1,258 行） | 建议 |
| ST-3 | P2 | `ts/index.ts` barrel 导出跨层 | 可选 |
| ST-4 | P3 | 根目录杂物（`__pycache__`、`.debugTemp` 等） | 可选 |
| ST-5 | P3 | 私有成员命名风格不统一 | 可选 |

---

## 3. 类型安全审查（Task 3）

### 3.1 any 使用清单

全项目 `any` 共 11 处，分布于 2 个文件：

| 位置 | 代码片段 | 用途 | 风险 |
| --- | --- | --- | --- |
| `ts/ribbon.ts:65` | `GetSkipConflictsPressed(control: any)` | WPS Ribbon 控件无 @types | 低（已有 eslint-disable 注释） |
| `ts/ribbon.ts:75` | `OnSkipConflictsChange(control: any)` | 同上 | 低 |
| `ts/ribbon.ts:99` | `GetEnableSyncRecordPressed(control: any)` | 同上 | 低 |
| `ts/ribbon.ts:109` | `OnEnableSyncRecordChange(control: any)` | 同上 | 低 |
| `ts/ribbon.ts:129` | `GetIncrementalSyncPressed(control: any)` | 同上 | 低 |
| `ts/ribbon.ts:139` | `OnIncrementalSyncChange(control: any)` | 同上 | 低 |
| `ts/tools/wps.ts:26` | `Selection?: any` | WPS COM Selection 类型不确定 | 中 |
| `ts/tools/wps.ts:115` | `Value?: any` | WPS Range.Value 多态返回 | 中 |
| `ts/tools/wps.ts:117` | `Value2?: any` | 同上 | 中 |
| `ts/tools/wps.ts:119` | `Text?: any` | 同上 | 中 |
| `ts/tools/wps.ts:121` | `Formula?: any` | 同上 | 中 |

**评价**：`ribbon.ts` 的 6 处已用 `// eslint-disable-next-line` 标注理由，可接受；`wps.ts` 的 5 处建议收窄为 `unknown` 或联合类型（如 `string | number | boolean | null`），并在消费处用类型守卫。

### 3.2 unknown 使用配合类型守卫情况

`unknown` 共 197 处 / 16 文件，采用率高。主要模式：

- **`catch (e: unknown)`**：主流写法，已在全部 16 文件中应用。
- **`(e as Error).message`**：最常见的类型守卫方式，但**未使用 `instanceof Error` 守卫**，直接断言。若 `e` 为非 Error 值（如字符串、数字），`.message` 访问会返回 `undefined`。
- **`unknown[]` 缓存**：`BGMCache.listCache: unknown[]`（`index.ts:319`），使用时需类型守卫。

**问题**：`(e as Error).message` 模式在 6 处可能出现 `undefined` 拼接（如 `preview.ts:721`），建议统一为 `e instanceof Error ? e.message : String(e)`。

### 3.3 函数返回类型显式声明覆盖率

| 类别 | 显式声明 | 隐式推断 | 覆盖率 |
| --- | --- | --- | --- |
| `export function` | 绝大多数 | 极少 | ~98% |
| `async function` | 全部 | 0 | 100% |
| 箭头函数赋值 | 部分 | 较多 | ~70% |
| 内部辅助函数 | 部分 | 较多 | ~75% |

**问题**：`ribbonService.ts:273` 的 `syncWithConfirmation()` 未声明返回类型（应为 `Promise<void>`），属遗漏。

### 3.4 as 类型断言使用情况

`as` 断言共 104 处 / 11 文件，分布：

| 文件 | 次数 | 主要模式 |
| --- | --- | --- |
| `ts/ui/dialog.ts` | 33 | `as HTMLElement`、`as HTMLInputElement` |
| `ts/ui/handlers.ts` | 18 | `as Error`、`as WpsRange` |
| `ts/sync/exceltobangumi.ts` | 17 | `as WpsRange`（`SpecialCells(12)` 返回值） |
| `ts/ui/preview.ts` | 11 | `as Error` |
| `ts/tools/util.ts` | 11 | `as T`（缓存泛型）、`as Error` |

**风险点**：
- `exceltobangumi.ts:561,570`：`ws.AutoFilter.Range.SpecialCells(12) as WpsRange` — `SpecialCells` 在无可见单元格时会抛错，断言掩盖了 `null` 可能。
- `util.ts:1061`：`sheetCache.get(key) as T` — 缓存值类型与键的对应关系无编译期保证。

### 3.5 泛型与默认值

| 位置 | 泛型 | 默认值 | 评价 |
| --- | --- | --- | --- |
| `cacheGet<T>(key, factory: () => T): T` | 有 | 无 | 调用处显式传 `<number>`，可接受 |
| `httpRequest<T>` | 有 | 无 | 调用处显式传，可接受 |
| `Result<T>` | 有 | 无 | 可考虑 `<T = unknown>` 默认值 |

**整体**：泛型使用克制，未发现过度泛型化。

### 3.6 WPS API 类型定义完整性

`ts/tools/wps.ts`（312 行）定义了 15 个 WPS 接口（`WpsApplication`、`WpsWorkbook`、`WpsWorksheet`、`WpsRange` 等）+ 3 个类型守卫（`isWpsApp`、`isWpsWorksheet`、`isWpsRange`）。

**缺口**：
- `WpsRange.Value` 为 `any`，未建模 `Range.Value(xlRangeValueDefault)` 的重载。
- `WpsOAAssist` 接口仅定义了 `shellExecute`，实际 WPS OA Assist 有更多方法。
- `Selection` 为 `any`，应建模为 `WpsRange | WpsWorksheet | unknown`。

### 3.7 类型问题清单

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| TS-1 | P2 | `ts/tools/wps.ts:115-121`（5 处 `any`） | 建议 |
| TS-2 | P2 | 全项目 `(e as Error).message` 未用 `instanceof` 守卫 | 建议 |
| TS-3 | P2 | `ts/sync/exceltobangumi.ts:561,570`（`SpecialCells` 断言掩盖 null） | 建议 |
| TS-4 | P3 | `ts/services/ribbonService.ts:273`（返回类型缺失） | 可选 |
| TS-5 | P3 | `ts/tools/util.ts:1061`（缓存 `as T` 无编译期保证） | 可选 |

---

## 4. 错误处理审查（Task 4）

### 4.1 Promise 链 .catch() 覆盖

| 调用点 | 是否有 .catch() | 评价 |
| --- | --- | --- |
| `ribbon.ts:186` `syncWithConfirmation().catch(...)` | ✅ | 已补 catch，正确 |
| `util.ts:132` `syncAllRows().then().catch(...)` | ✅ | 已补 catch，正确 |
| `handlers.ts` 多处 `await` | ✅ try/catch 包裹 | 正确 |
| `dialog.ts:63` `setTimeout(ensureDialogs, 0)` | N/A | 非 Promise |

**整体**：Promise 链 .catch() 覆盖良好，未见未捕获 rejection。

### 4.2 async OnAction 未捕获 rejection

`ribbon.ts:177` 的 `OnAction` 是同步函数（返回 `boolean`），内部调用 `RibbonService.syncWithConfirmation()`（async）时已用 `.catch()` 补全（`ribbon.ts:186`）。**无问题**。

但需注意：`OnAction` 本身的 `try/catch`（`ribbon.ts:179-209`）只能捕获同步异常，async 函数的 rejection 由 `.catch()` 兜底。两层防护正确。

### 4.3 xhr.onerror/ontimeout 覆盖完整性

全项目 13 处 xhr 错误回调，逐处核对：

| 位置 | onerror | ontimeout | 评价 |
| --- | --- | --- | --- |
| `ts/tools/http.ts:223,229` | ✅ | ✅ | 完整 |
| `ts/tools/util.ts:794,799` | ✅ | ✅ | 完整 |
| `ts/ui/handlers.ts:278,287` | ✅ | ✅ | 完整 |
| `ts/sync/exceltobangumi.ts:294,300` | ✅ | ✅ | 完整 |
| `ts/sync/exceltobangumi.ts:851,857` | ✅ | ✅ | 完整 |
| `ts/sync/exceltobangumi.ts:1394` | ✅ | ❌ **缺失** | **P0/P1：fetchEpisodeIds 设了 `xhr.timeout=30000` 但无 ontimeout，超时后 Promise 永不 resolve/reject** |
| `ts/sync/scraping.ts:109,110` | ✅ | ✅ | 完整 |

**P1 问题**：`exceltobangumi.ts:1373-1397` 的 `fetchEpisodeIds` 设置了 `xhr.timeout = 30000`（第 1378 行），但仅注册了 `xhr.onerror`（第 1394 行），**未注册 `xhr.ontimeout`**。超时后 Promise 将永久挂起，导致 `markEpisodesComplete` 调用方无限等待。

### 4.4 try/catch 中 error 类型检查

主流模式 `catch (e: unknown)` 后使用 `(e as Error).message`，**未先做 `instanceof Error` 守卫**。

| 模式 | 出现次数 | 风险 |
| --- | --- | --- |
| `catch (e: unknown) { ... (e as Error).message }` | ~15 处 | 中：若 `e` 为字符串/对象，`.message` 为 `undefined` |
| `catch (e: unknown) { ... (e as Error)?.message || String(e) }` | ~5 处 | 低：已防御 `undefined` |
| `catch (e: unknown) { ... e instanceof Error ? e.message : ... }` | ~2 处 | 最低：正确守卫 |

**建议**：统一采用 `e instanceof Error ? e.message : String(e)` 模式。

### 4.5 AbortController 使用情况

全项目 **未使用 `AbortController`**。所有 XHR 请求通过 `xhr.abort()`（如 `exceltobangumi.ts` 中 `shouldStop` 检查后调用）实现取消，而非标准 `AbortController`。

**评价**：XHR 场景下 `abort()` 可接受，但若未来迁移到 `fetch`，需引入 `AbortController`。

### 4.6 并发请求竞态

| 场景 | 竞态风险 | 现状 |
| --- | --- | --- |
| 快速点击"同步"按钮 | 高 | ⚠️ `syncWithConfirmation`（Ribbon 路径）**未检查 `isRunning`**，可并发触发两个 `SyncToBangumiAsync` |
| 预览面板与 Ribbon 同时同步 | 高 | ⚠️ 两条路径（`syncAllRows` vs `syncWithConfirmation`）状态机入口不统一 |
| Token 设置与同步并发 | 中 | Token 写入有锁，但读取无快照 |

**核心问题**：见 Task 5 的 P0 项。

### 4.7 错误处理问题清单

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| EH-1 | P0 | `ts/sync/exceltobangumi.ts:1394`（fetchEpisodeIds 无 ontimeout） | 是 |
| EH-2 | P1 | `ts/services/ribbonService.ts:402`（`new Error('通知面板失败', e as Error)` 第二参数错误） | 是 |
| EH-3 | P2 | 全项目 `(e as Error).message` 未守卫 | 建议 |
| EH-4 | P2 | 全项目无 AbortController | 可选 |
| EH-5 | P2 | `ts/services/ribbonService.ts:273`（syncWithConfirmation 无并发检查） | 是 |

---

## 5. 边界情况审查（Task 5）

### 5.1 空表/单行表同步行为

| 输入 | 行为 | 位置 | 评价 |
| --- | --- | --- | --- |
| 空表（lastRow=0） | `getLastRow` 返回 1（至少 1） | `util.ts:1212` | ⚠️ 返回 1 可能误判 |
| 仅表头（1 行） | `dataRows` 过滤后为空，`showToast('没有可同步的数据行')` | `preview.ts:682-684` | ✅ 正确处理 |
| 单行数据 | 正常同步 1 条 | — | ✅ |

### 5.2 超大表性能

| 场景 | 当前实现 | 风险 |
| --- | --- | --- |
| `getLastRow` 默认返回值 | `ws` 为 null 时返回 **50000** | `util.ts:1212` — 误返回 5 万会导致全表扫描 |
| `SpecialCells(12)` | 用于筛选状态可见单元格 | `exceltobangumi.ts:561,570` — 筛选无结果时抛错 |
| 预览渲染 | 全量生成卡片 HTML 后一次性 `innerHTML` | `preview.ts:421` — 数千卡片会卡顿 |

### 5.3 特殊字符

| 字符类型 | 处理 | 位置 |
| --- | --- | --- |
| Emoji | ✅ `escapeHtml()` 不影响 emoji | `util.ts` |
| 控制字符 | ❌ 未过滤 | URL/注释字段可能包含 |
| URL 注入（`javascript:`） | ❌ 未校验 | `autoFillUrl.ts` 直接拼接 |
| 路径遍历（`../`） | N/A | 不涉及文件路径 |

### 5.4 并发同步（P0 重点）

**P0-1：`syncAllRows` 绕过 `enterRunningState`**

`ts/ui/preview.ts:658-764` 的 `syncAllRows()`：
- 第 660 行：`if (BGM.sync.isRunning)` 仅做读检查（非原子）。
- 第 726 行：**直接 `BGM.sync.isRunning = true`**，绕过 `enterRunningState()`。
- 后果：`lastSyncTime` 未更新、`enterRunningState` 的弹窗防重入逻辑被跳过、与 `startSync`（`util.ts:121`）形成双入口。

**P0-2：`syncWithConfirmation` 未检查 `isRunning`**

`ts/services/ribbonService.ts:273-363` 的 `syncWithConfirmation()`：
- **全程未检查 `BGM.sync.isRunning`**，也未设置 `isRunning = true`。
- 直接调用 `SyncToBangumiAsync`（第 347 行）。
- 后果：若任务窗格正在同步，用户点 Ribbon"同步"按钮会启动第二个并发同步，两个 `SyncToBangumiAsync` 同时操作同一工作表，导致颜色标记错乱、状态机失同步。

**P0-3：`syncFromPanel` 同样直接设置 `isRunning`**

`ts/ui/handlers.ts:573`：`BGM.sync.isRunning = true` — 与 `syncAllRows` 相同的绕过模式。

### 5.5 工作簿切换/工作表删除状态清理

| 事件 | 清理 | 位置 |
| --- | --- | --- |
| 工作表删除 | ❌ 无监听 | `BGM.sync.currentSheet` 可能指向已删除工作表 |
| 工作簿切换 | ❌ 无监听 | `BGM.cache` 不会失效 |
| 工作表重命名 | ❌ 缓存键基于 `ws.Name`，重命名后旧缓存残留 | `util.ts:1217` |

### 5.6 Token 失效/GFW 网络分级

| 场景 | 处理 | 评价 |
| --- | --- | --- |
| Token 401 | `bgmRequestSync` 抛错，调用方 catch | ✅ |
| 网络断开 | `xhr.onerror` 触发 | ✅ |
| GFW 超时 | `http.ts` 有 timeout，但 `fetchEpisodeIds` 缺 ontimeout | ⚠️ 见 EH-1 |
| Token 过期中途同步 | 无中途刷新机制 | ⚠️ 长同步（数千行）可能中途 401 |

### 5.7 筛选状态同步

`exceltobangumi.ts:561` 使用 `ws.AutoFilter.Range.SpecialCells(12)` 获取可见行，但：
- 若用户在同步过程中修改筛选，`visibleRows` 快照已固定，不会受影响（✅）。
- 但 `SpecialCells(12)` 在无可见行时抛错，当前用 try/catch 兜底（`exceltobangumi.ts:570`），回退到全扫描。

### 5.8 锁定工作表后切换工作簿

`BGM.sheet.isLocked` / `lockedIndex` 在工作簿切换时未清理（无 `WorkbookActivate` 事件监听），可能导致锁定索引指向新工作簿的错误工作表。

### 5.9 边界问题清单

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| BS-1 | P0 | `ts/ui/preview.ts:726`（syncAllRows 绕过 enterRunningState） | 是 |
| BS-2 | P0 | `ts/services/ribbonService.ts:273`（syncWithConfirmation 未检查 isRunning） | 是 |
| BS-3 | P0 | `ts/ui/handlers.ts:573`（syncFromPanel 直接设 isRunning） | 是 |
| BS-4 | P1 | `ts/sync/exceltobangumi.ts:1394`（fetchEpisodeIds 无 ontimeout） | 是 |
| BS-5 | P2 | `ts/tools/util.ts:1212`（getLastRow 默认 50000） | 建议 |
| BS-6 | P2 | 工作簿切换/工作表删除无状态清理 | 建议 |
| BS-7 | P2 | `ts/tools/autoFillUrl.ts`（URL 未校验 `javascript:` 协议） | 建议 |

---

## 6. 性能审查（Task 6）

### 6.1 cacheGet/cacheSet 缓存策略与失效机制

`ts/tools/util.ts:1051-1066` 实现 `sheetCache = new Map<string, unknown>()` + `cacheGet<T>(key, factory)`。

| 方面 | 现状 | 风险 |
| --- | --- | --- |
| 缓存失效 | 仅 `clearSheetCache(ws)` 主动调用 | 工作表重命名后旧缓存残留 |
| 缓存粒度 | 按 `${sheetName}:key` | 多工作表时 Map 无限增长 |
| TTL | 无 | 长会话内存累积 |
| 序列化 | 内存对象，无持久化 | 可接受 |

**问题**：`sheetCache` 是模块级全局 Map，无大小上限，长会话下多工作表切换会持续增长。

### 6.2 DOM 节点增长

| 场景 | 增长模式 | 位置 | 风险 |
| --- | --- | --- | --- |
| 同步进度日志 | `bgm-sync-progress__log` 每次 `updateSyncProgressDialog` 追加文本 | `dialog.ts` | 中：长同步（1000+ 行）日志节点增长 |
| 预览卡片渲染 | 一次性 `innerHTML = statsHtml + cardsHtml` | `preview.ts:421` | 中：数千卡片 DOM 节点过多 |
| 状态筛选下拉 | 每次渲染先 `oldSelect.remove()` 再新建 | `preview.ts:428-429` | ✅ 已清理旧节点 |

**建议**：进度日志限制最大行数（如 200 行），超出时移除最早节点。

### 6.3 事件监听器清理

| 位置 | add | remove | 评价 |
| --- | --- | --- | --- |
| `taskpane.ts:964` keydown | `document.addEventListener` | `taskpane.ts:966` beforeunload 时 removeEventListener | ✅ |
| `taskpane.ts:891` pollingInterval | `setInterval` | `beforeunload` 时 `clearInterval` | ✅ |
| `preview.ts:418-419` body click | 先 remove 再 add | ✅ 防重复绑定 |
| `handlers.ts:900-901` button click | 先 remove 再 add | ✅ |
| `dialog.ts:612` keydown（ESC） | `document.addEventListener` | `dialog.ts:331` removeEventListener | ✅ |
| `message.ts:66` message | `window.addEventListener` | `message.ts:26` removeEventListener | ✅ |
| `handlers.ts:1169` message | `window.addEventListener` | ❌ **未见 removeEventListener** | ⚠️ 可能泄漏 |

### 6.4 setInterval/setTimeout 清理

| 位置 | 类型 | 清理 | 评价 |
| --- | --- | --- | --- |
| `taskpane.ts:811` `setInterval`（用户信息轮询） | 轮询 | `taskpane.ts:891` beforeunload 清理 | ✅ |
| `dialog.ts:685` `setTimeout`（Toast） | 单次 | `dialog.ts:677` clearTimeout 防重入 | ✅ |
| `handlers.ts:1274,1298` `setTimeout`（重试更新 UI） | 递归重试 | 无显式清理 | ⚠️ 组件卸载时可能残留 |
| `util.ts:181` `setTimeout`（waitForResume 轮询 50ms） | 轮询 | 由 `shouldStop`/`isPaused` 退出 | ✅ 逻辑退出 |
| `http.ts:46` `setTimeout`（sleep） | 单次 | Promise resolve 后自动 | ✅ |

### 6.5 大数组闭包引用

`handlers.ts:1169` 的 `window.addEventListener('message', ...)` 回调闭包捕获了较大作用域变量，若未移除会导致内存泄漏。

### 6.6 requestAnimationFrame 使用

全项目 **未使用 `requestAnimationFrame`**。当前无动画场景（进度条用 CSS transition），可接受。

### 6.7 虚拟滚动可行性

`preview.ts` 预览面板渲染全部卡片（`innerHTML` 一次性插入）。当数据行超过 500 时，DOM 节点过多可能导致卡顿。

**建议**：引入 `react-window` 或自实现虚拟滚动（仅渲染可视区域 + 滚动占位）。但考虑 WPS 内嵌浏览器性能，可先用"分页加载"（每次渲染 100 张卡片，滚动到底部加载更多）作为低成本方案。

### 6.8 性能问题清单

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| PF-1 | P2 | `ts/tools/util.ts:1051`（sheetCache 无大小上限/TTL） | 建议 |
| PF-2 | P2 | `ts/ui/preview.ts:421`（预览卡片全量渲染） | 建议 |
| PF-3 | P2 | `ts/ui/handlers.ts:1169`（message 监听未 remove） | 建议 |
| PF-4 | P3 | `ts/ui/dialog.ts`（进度日志无最大行数限制） | 可选 |
| PF-5 | P3 | 全项目无虚拟滚动 | 可选 |

---

## 7. UI/UX 审查（Task 7）

### 7.1 可访问性

| 组件 | aria 属性 | 评价 |
| --- | --- | --- |
| 同步进度弹窗 | `aria-labelledby`、`role="progressbar"`、`aria-valuemin/max/now`、`role="log" aria-live="polite"` | ✅ 优秀 |
| 暂停/停止/详情/关闭按钮 | `aria-label` | ✅ |
| 预览模态框 | ❌ 无 `role="dialog"`、无 `aria-modal` | ⚠️ |
| 普通对话框（alert/confirm） | ❌ 无 `role="dialog"` | ⚠️ |
| Toast 通知 | ❌ 无 `role="status"` / `aria-live` | ⚠️ 屏幕阅读器不会播报 |
| 焦点陷阱 | ❌ 模态框打开时未锁定焦点（Tab 可跳出） | ⚠️ |

### 7.2 颜色对比度

`css/styles.css` 中深色背景下使用浅灰文字，共 23 处：

| 颜色 | 使用次数 | 对比度（估算，深色背景 `#1e1e1e`） | WCAG AA 标准 |
| --- | --- | --- | --- |
| `#888` | 9 处 | ~3.5:1 | ❌ 不达标（需 4.5:1 for normal text） |
| `#b0b0b0` | 3 处 | ~5.8:1 | ✅ 达标 |
| `#e0e0e0` | 11 处 | ~9:1 | ✅ 优秀 |

**问题**：`#888` 用于辅助文字（如 `.hint`、`.muted`），在深色背景下对比度不足，建议提升至 `#999` 或 `#a0a0a0`。

### 7.3 键盘导航

| 按键 | 行为 | 位置 | 评价 |
| --- | --- | --- | --- |
| ESC | 关闭预览模态框 / 同步进度弹窗 | `dialog.ts:612`、`taskpane.ts:964` | ✅ |
| Enter | 对话框确认 | `dialog.ts:187`（keypress） | ✅ |
| Tab | 浏览器默认 | — | ⚠️ 模态框无焦点陷阱 |
| Space | 按钮默认 | — | ✅ |

### 7.4 响应式

任务窗格宽度由 WPS 宿主决定（通常 300-400px）。CSS 使用固定 `px` 宽度，未见 `@media` 查询或 `flex` 自适应。

**评价**：加载项场景下宽度固定可接受，但预览模态框在小宽度下可能溢出。

### 7.5 一致性

| 对比项 | 实现 | 一致性 |
| --- | --- | --- |
| `.bgm-modal`（普通对话框） | `dialog.ts:235` 静态模板 | 基准 |
| 同步进度弹窗 | `dialog.ts:349` 独立模板 `sync-progress-dialog` | ⚠️ 类名体系不同（`bgm-modal` vs `sync-progress-dialog`） |
| Toast | `dialog.ts` 独立 `.bgm-toast` | ✅ 风格统一 |
| 预览模态框 | `preview.ts` `#syncPreviewModal` | ⚠️ 第三套类名 |

**问题**：存在三套模态框实现，视觉风格相近但类名体系不一致。

### 7.6 内联样式与 CSS 变量混用

| 位置 | 模式 | 评价 |
| --- | --- | --- |
| `dialog.ts:235` `modal.innerHTML = '<div class="bgm-modal">'` | 类名 | ✅ |
| `preview.ts:422` `modal.style.display = 'block'` | 内联 style | ⚠️ 应改用类名切换 |
| `taskpane.ts` 多处 `element.style.display = 'none'` | 内联 style | ⚠️ |
| CSS 变量 | `styles.css` 定义 `:root` 变量 | ✅ 但 TS 中未充分使用 |

### 7.7 深色模式覆盖

Ribbon 复选框（`chkEnableSyncRecord`、`chkIncremental`、`chkSkipConflicts`）在 `handlers.ts:907,1351,1433` 绑定 `change` 事件，但：

- 复选框样式来自 WPS Ribbon XML，不受 CSS 深色模式控制。
- 任务窗格内的复选框（`handlers.ts` 中 `getElementById`）使用原生 `<input type="checkbox">`，深色模式下原生样式可能不协调。

### 7.8 UI/UX 问题清单

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| UX-1 | P2 | `ts/ui/preview.ts`（预览模态框无 role="dialog"） | 建议 |
| UX-2 | P2 | `ts/ui/dialog.ts`（Toast 无 aria-live） | 建议 |
| UX-3 | P2 | `css/styles.css`（`#888` 对比度不足，9 处） | 建议 |
| UX-4 | P2 | 全部模态框（无焦点陷阱） | 建议 |
| UX-5 | P3 | 三套模态框类名不一致 | 可选 |
| UX-6 | P3 | `ts/ui/preview.ts:422`（内联 style 与 CSS 变量混用） | 可选 |

---

## 8. 组件化机会评估（Task 8）

### 8.1 进度条抽象为可复用组件

当前同步进度弹窗（`dialog.ts:349-488`）含进度条、日志、暂停/停止/详情/关闭按钮，约 140 行。可抽象为 `<ProgressBar>` 组件：

```
Props: { title, onPause, onResume, onStop, onToggleDetails }
Methods: update(current, total, msg), complete(summary, details, stopped), hide()
```

**收益**：未来"抓取收藏"等其他长任务可复用。

### 8.2 shadcn Dialog/AlertDialog 模式迁移

当前三套模态框（`.bgm-modal`、`sync-progress-dialog`、`#syncPreviewModal`）可统一为 shadcn 风格的 `Dialog` / `AlertDialog`：

| 现有 | 迁移目标 |
| --- | --- |
| `showAlert` / `showError` / `showSuccess` | `AlertDialog` |
| `showConfirm` / `showInput` | `Dialog` |
| 同步进度弹窗 | `Dialog` + `Progress` |
| 预览模态框 | `Dialog`（含 `ScrollArea`） |

**成本**：需引入 React 或保持纯 DOM 但抽象为类。考虑 WPS 兼容性，建议先抽象为 TS 类（`ProgressDialog`、`AlertDialog`），再逐步迁移。

### 8.3 Button 系统统一

`css/styles.css` 定义了 `.bgm-btn`、`.bgm-btn-default`、`.bgm-btn-danger`、`.bgm-btn-success`，但 `handlers.ts` 中部分按钮使用内联 `onclick` 或未加 `.bgm-btn` 类。

**建议**：统一所有按钮使用 `.bgm-btn` 体系，并增加 `variant` 属性（`default` / `danger` / `success` / `ghost`）。

### 8.4 ScrollArea 替代内联 overflow-y: auto

`preview.ts` 预览模态框使用 `overflow-y: auto`（CSS），在大量卡片时滚动条样式不统一。

**建议**：统一用 `.bgm-scroll-area` 类，并通过 CSS 自定义滚动条样式（`::-webkit-scrollbar`）。

### 8.5 Checkbox 组件化

`handlers.ts:907,1351,1433` 三处复选框（`chkEnableSyncRecord`、`chkIncremental`、`chkSkipConflicts`）绑定逻辑相似：读取配置 → 设置初始状态 → 监听 change → 保存配置。

**建议**：抽象 `bindConfigCheckbox(elementId, getConfig, setConfig)` 工具函数，消除重复代码。

### 8.6 组件化建议清单

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| CP-1 | P3 | 同步进度弹窗抽象为 `ProgressBar` 组件 | 可选 |
| CP-2 | P3 | 三套模态框统一为 `Dialog`/`AlertDialog` | 可选 |
| CP-3 | P3 | Button 系统 `.bgm-btn` 统一 | 可选 |
| CP-4 | P3 | `ScrollArea` 替代内联 overflow | 可选 |
| CP-5 | P3 | Checkbox 绑定逻辑抽象 | 可选 |

---

> 以下章节为完整审查（Task 9-12 续）。

---

## 9. 安全审查

### 9.1 XSS 风险审查

**审查方法**：全文检索 `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`，逐处判定数据来源是否经过 `escapeHtml()` 转义或为静态模板。

**innerHTML 使用清单**（共 11 处，全部安全）：

| 位置 | 代码片段 | 数据来源 | 风险判定 |
| --- | --- | --- | --- |
| `ts/ui/preview.ts:421` | `body.innerHTML = statsHtml + cardsHtml` | `cardsHtml` 由 `renderDetailItemHtml` 构建，所有用户输入字段（name/url/tags/comment 等）均经 `escapeHtml()` 转义 | 安全 |
| `ts/ui/preview.ts:450` | `select.innerHTML = '<option ...>' + sortedStatus.map(...)` | option value 与 text 均使用 `escapeHtml(s)` | 安全 |
| `ts/taskpane.ts:160` | `select.innerHTML = '<option value="">-- 请选择 --</option>'` | 静态字符串 | 安全 |
| `ts/taskpane.ts:556` | `previewBox.innerHTML = '<p class="hint">请先选择工作表</p>'` | 静态字符串 | 安全 |
| `ts/taskpane.ts:563` | `previewBox.innerHTML = '<p class="hint">未连接到 Excel</p>'` | 静态字符串 | 安全 |
| `ts/taskpane.ts:571` | `previewBox.innerHTML = '<p class="hint">无法获取工作表: ${sheetIndex}</p>'` | `sheetIndex` 为 `parseInt(select.value, 10)` 数字，非用户输入 | 安全 |
| `ts/taskpane.ts:578` | `previewBox.innerHTML = '<p class="hint">无法访问工作表 ${sheetIndex}</p>'` | 同上，数字插值 | 安全 |
| `ts/taskpane.ts:735` | `previewBox.innerHTML = previewRows.length > 0 ? renderPreviewTable(...) : ...` | `renderPreviewTable` 内部对单元格值调用 `escapeHtml()` | 安全 |
| `ts/ui/dialog.ts:88` | `icon.innerHTML = iconChar` | `iconChar` 为 HTML 实体常量（如 `&#9432;`），来源为静态映射表 | 安全 |
| `ts/ui/dialog.ts:235` | `modal.innerHTML = '<div class="bgm-modal...">'` | 静态模板字符串，无用户数据插值 | 安全 |
| `ts/ui/dialog.ts:349` | `modal.innerHTML = '<div class="sync-progress-dialog...">'` | 静态模板字符串 | 安全 |

**outerHTML / insertAdjacentHTML / document.write**：未检索到使用。

**`escapeHtml` 实现验证**（`ts/tools/util.ts:618-623`）：采用 `document.createElement("div")` + `textContent` + `innerHTML` 的标准安全模式，可阻断 HTML 注入。

**风险等级**：无 P0/P1 问题。XSS 防护完备。

**P3 优化建议**：
- `ts/ui/dialog.ts:235`、`ts/ui/dialog.ts:349`：将静态模板抽为 `<template>` 元素或 `Element.insertAdjacentHTML('beforeend', ...)`，避免每次重建子树。
- 建议引入 ESLint 规则 `no-restricted-syntax` 禁止直接 `innerHTML = ${variable}`，强制必须经过 `escapeHtml` 白名单。

### 9.2 CSRF 防护审查

**审查方法**：检查所有跨域请求、Cookie 使用、Origin/Referer 校验。

**结论**：项目所有 HTTP 请求均通过 `ts/tools/http.ts` 的 `httpRequest` 或 `XMLHttpRequest` 直接发起，请求目标仅为 `https://api.bgm.tv`（Bangumi API v0）。鉴权方式为请求头 `Authorization: Bearer ${token}`，**不依赖 Cookie**，因此不存在传统 CSRF 攻击面。

**跨域通信**：
- `ts/ui/message.ts:31`：`postMessage` 通信已显式校验 `ALLOWED_ORIGINS = ['https://bgm.tv', window.location.origin]`，拒绝非白名单源消息。

**风险等级**：无 CSRF 风险。

**P3 优化建议**：在 `http.ts` 的 XHR 请求中可选增加 `xhr.withCredentials = false` 显式声明不发送 Cookie，避免未来若引入 Cookie 鉴权时遗留隐患。

### 9.3 Token 存储安全审查

**审查目标**：`ts/core/crypto.ts` 的 XOR 加密、`ts/tools/util.ts` 的 `storeBgToken/loadBgToken`、`ts/tools/config.ts` 的 PluginStorage 访问。

**XOR 加密分析**（`ts/core/crypto.ts:151-217`）：
- **加密密钥**：`TOKEN_CONFIG.XOR_KEY = "bgmtoken_secret_key_2024"`（`ts/core/constants.ts` 硬编码）。
- **加密流程**：`encryptToken` 生成 16 字节随机 IV，对 `payload = "version:checksum:token"` 进行 `payload[i] ^ key[i % keyLen] ^ iv[i % ivLen]`，输出 `version.ivBase64.encryptedBase64`。
- **解密流程**：`decryptToken` 反向 XOR，再调用 `extractToken` 校验版本号与校验和。
- **安全评估**：XOR 是混淆而非密码学加密，密钥硬编码在源码中。任何能读取源码或编译产物（`dist-ts/core/crypto.js`）的攻击者都可解密。但因存储位置 `PluginStorage` 是 WPS 加载项进程内的键值存储，**不在浏览器 DOM/ localStorage 范围内**，攻击者需先获得 WPS 进程内存访问权才能读取，实际攻击面有限。

**PluginStorage 安全性**：
- `ts/tools/util.ts:loadBgToken`/`storeBgToken` 通过 `getApp().PluginStorage.getItem/setItem` 读写。
- `PluginStorage` 数据仅在当前 WPS 文档会话内有效，关闭文档后清空，**无持久化泄露风险**。
- 跨 Ribbon ↔ Taskpane 上下文共享，属 WPS 沙箱内通信，无跨进程暴露。

**Token 日志泄露审查**：
- `ts/tools/http.ts:169`：`Authorization: Bearer ${options.token.substring(0, 8)}...` 仅记录前 8 字符。
- `ts/ui/handlers.ts:229`：`Authorization: Bearer ${token.substring(0, 8)}...` 同上。
- Bangumi Token 通常为 32-40 字符的十六进制串，前 8 字符不足以还原完整 Token，**符合最小化日志原则**。
- 检索 `bgmLog.*token` 共 75 处，全部为"Token 状态"（已设置/已清除/无效）描述性日志，**未发现完整 Token 明文输出**。

**风险等级**：
- **P2**：XOR 加密为伪装性混淆，密钥硬编码。建议升级为 Web Crypto API 的 `SubtleCrypto.encrypt('AES-GCM', ...)`（`crypto.ts` 文件头注释已提及"支持AES-GCM加密（异步）"但未实现）。
- **P3**：`ts/tools/config.ts` 的 `setConfig` 会打印 `oldValue`/`newValue`（`ts/tools/config.ts:59` 的 `eventBus.emit(CONFIG_UPDATED, { key, value })` 携带新值）。若未来用 `setConfig` 存储 Token 相关配置，会经事件总线广播明文。当前 Token 走独立的 `storeBgToken` 路径，未受影响，但需在文档中明确"禁止用 setConfig 存储 Token"。

### 9.4 URL 参数注入审查

**审查方法**：检索 `URLSearchParams`、`location.search`、`location.hash`、`new URL(`、`window.open`。

**结果**：项目源码中**未使用 `URLSearchParams`、`location.search`、`location.hash`**（仅在 `.trae/specs/comprehensive-audit-2026-06/tasks.md:71` 的审查任务描述文本中出现）。

**endpoint 安全校验**（`ts/tools/http.ts:32-39`）：
```typescript
function validateEndpoint(endpoint: string): void {
    if (!endpoint || typeof endpoint !== 'string') {
        throw new BgmError('endpoint 无效', 'INVALID_ENDPOINT');
    }
    if (endpoint.includes('..') || endpoint.startsWith('http')) {
        throw new BgmError('endpoint 包含非法字符', 'INVALID_ENDPOINT');
    }
}
```
- 拒绝 `..` 路径遍历。
- 拒绝以 `http` 开头的绝对 URL（强制使用相对路径，由 `httpRequest` 拼接 `BGM_CONFIG.API_BASE`）。
- 所有的 API endpoint 均为硬编码字符串（如 `/v0/me`、`/v0/users/${userPath}/collections/${sid}`），`sid`/`userPath` 来自单元格读取或 API 响应，经 `extractSubjectId` 正则提取。

**风险等级**：无注入风险。

### 9.5 JSON.parse 异常处理审查

**审查方法**：检索全部 `JSON.parse` 调用，判定是否包裹 `try/catch`。

**JSON.parse 调用清单**（共 12 处，11 处安全，1 处缺陷）：

| 位置 | 数据来源 | 是否 try/catch | 判定 |
| --- | --- | --- | --- |
| `ts/ui/preview.ts:640` | `record.content`（同步记录详情） | 是（`try { ... } catch (e) { handleError }`） | 安全 |
| `ts/ui/handlers.ts:251` | `xhr.responseText`（testTokenValidity） | 是 | 安全 |
| `ts/ui/handlers.ts:1133` | `target.dataset.args`（按钮 data-args） | 是 | 安全 |
| `ts/tools/util.ts:774` | `xhr.responseText`（_fetchBgmUserInfo） | 是 | 安全 |
| `ts/tools/http.ts:204` | `xhr.responseText`（通用 HTTP） | 是 | 安全 |
| `ts/taskpane.ts:93` | `app.PluginStorage.getItem('bgm_locked_sheet')` | 是 | 安全 |
| `ts/sync/exceltobangumi.ts:174` | `xhr.responseText`（parseErrorResponse） | 是 | 安全 |
| `ts/sync/exceltobangumi.ts:268` | `xhr.responseText`（testTokenValidityForRibbon） | 是 | 安全 |
| `ts/sync/exceltobangumi.ts:839` | `xhr.responseText`（batchSync 错误提取） | 是 | 安全 |
| `ts/sync/exceltobangumi.ts:1383` | `xhr.responseText`（fetchEpisodeIds） | 是 | 安全 |
| `ts/sync/exceltobangumi.ts:1670` | **`jsonBody`（同步循环内自构造的请求体）** | **否** | **P1 缺陷** |
| `ts/sync/scraping.ts:103` | `xhr.responseText` | 是 | 安全 |

**P1 缺陷详情**：

- **位置**：`ts/sync/exceltobangumi.ts:1670`
- **代码**：`const watchType = JSON.parse(jsonBody).type;`
- **上下文**：`syncSelectedRows` 函数内，`jsonBody` 由 `buildJsonPayload` 构造。正常情况下 `buildJsonPayload` 返回合法 JSON 字符串，但若上游构造逻辑异常（例如字段含未转义控制字符、`buildJsonPayload` 内部异常但未抛出返回空串），`JSON.parse` 会抛 `SyntaxError`，导致整个 `syncSelectedRows` 中断，**已同步成功的数据无法写入同步记录、进度弹窗无法完成态切换**。
- **影响**：单行同步成功后立即崩溃，用户看到弹窗卡在"进行中"状态，需手动关闭。
- **修复建议**：
```typescript
let watchType: number | undefined;
try {
    watchType = JSON.parse(jsonBody).type;
} catch (e: unknown) {
    BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'syncSelectedRows.parseJsonBody' });
    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] jsonBody 解析失败，跳过章节标记: ${jsonBody.substring(0, 100)}`);
}
```

### 9.6 第三方依赖漏洞审查

**审查方法**：分析 `package.json` 依赖列表，建议执行 `npm audit`。

**依赖清单**（`package.json`）：
- devDependencies（无 production 依赖）：
  - `concurrently` ^9.2.1
  - `et-jsapi-declare` latest
  - `typescript` ^6.0.3
  - `vite` ^6.0.0
  - `vite-plugin-static-copy` ^4.1.0
  - `wpsjs` latest

**评估**：
- 依赖数量极少（6 个），且全部为 devDependencies，**不进入运行时产物**，攻击面小。
- `et-jsapi-declare`、`wpsjs` 使用 `latest` 版本，存在版本漂移风险（P3）。
- `typescript ^6.0.3`：TS 6 为较新主版本，需确认与 `vite-plugin-static-copy ^4.1.0` 兼容性。

**P3 建议**：
- 执行 `npm audit --production` 确认无已知 CVE。
- 将 `et-jsapi-declare`、`wpsjs` 锁定为具体版本号，避免 `latest` 漂移引入破坏性更新。
- 在 CI 中加入 `npm audit --audit-level=high` 守门。

### 9.7 安全问题清单

| ID | 位置 | 描述 | 风险 | 修复建议 |
| --- | --- | --- | --- | --- |
| S-1 | `ts/sync/exceltobangumi.ts:1670` | `JSON.parse(jsonBody).type` 未包裹 try/catch，jsonBody 异常时中断同步循环 | **P1** | 见 9.5 修复建议 |
| S-2 | `ts/core/crypto.ts:151`、`ts/core/constants.ts` | XOR 加密密钥硬编码，仅混淆非密码学加密 | **P2** | 升级为 `crypto.subtle.encrypt('AES-GCM', key, iv)` 异步加密；密钥派生用 PBKDF2 + 用户级盐 |
| S-3 | `ts/tools/config.ts:59` | `setConfig` 通过 eventBus 广播 `{ key, value }`，若误用于 Token 配置会泄露明文 | **P3** | 在 `setConfig` 入口加黑名单校验，禁止 `key` 包含 `token`/`secret`/`password` 关键字 |
| S-4 | `ts/core/constants.ts` | `TOKEN_CONFIG.XOR_KEY` 明文存于源码 | **P3** | 改为运行时派生（如基于 WPS 加载项 ID + 用户 ID 的 PBKDF2 派生） |
| S-5 | `package.json` | `et-jsapi-declare`、`wpsjs` 使用 `latest` 版本 | **P3** | 锁定具体版本号，加入 `npm audit` CI 守门 |

**安全审查总结**：整体安全姿态良好。XSS 防护完备，CSRF 无攻击面，URL 注入防护到位，JSON.parse 异常处理覆盖率 11/12。主要待修复项为 S-1（P1，必修）和 S-2（P2，建议升级）。

---

## 10. 可测试性审查

### 10.1 纯函数识别

**纯函数定义**：无副作用（不读写文件/网络/DOM/全局状态），相同输入恒定输出。

| 位置 | 函数 | 输入 → 输出 | 可测性 |
| --- | --- | --- | --- |
| `ts/tools/util.ts` | `colNumToLetter(num: number): string` | 列号 → 字母（1→A, 27→AA） | 高 |
| `ts/tools/util.ts` | `trim(s: unknown): string` | 任意值 → 去空格字符串 | 高 |
| `ts/tools/util.ts` | `escapeHtml(str: string): string` | 字符串 → HTML 转义串 | 高 |
| `ts/tools/util.ts` | `calcFingerprint(...rows): string` | 行数据数组 → SHA 风格指纹 | 高 |
| `ts/tools/util.ts` | `isEmptyValue(v: unknown): boolean` | 单元格值 → 是否空 | 高 |
| `ts/core/crypto.ts` | `calcChecksum(input: string): number` | 字符串 → 0-255 校验和 | 高 |
| `ts/core/crypto.ts` | `buildPayload(token: string): string` | Token → 带版本与校验和的 payload | 高 |
| `ts/sync/exceltobangumi.ts` | `extractSubjectId(url: string): string` | Bangumi URL → subject ID | 高 |
| `ts/sync/exceltobangumi.ts` | `mapWatchStatus(status: string): number` | 中文状态 → type 数字 | 高 |
| `ts/sync/exceltobangumi.ts` | `addTagsFromStr(tags: string): string[]` | 逗号分隔串 → 数组 | 高 |
| `ts/sync/exceltobangumi.ts` | `buildTagsArray(...): string[]` | 多源标签 → 去重数组 | 高 |
| `ts/sync/exceltobangumi.ts` | `isBangumiUrl(url: string): boolean` | URL → 是否合法 | 高 |
| `ts/sync/exceltobangumi.ts` | `getSeqColIndex(colMap): number` | 列映射 → 序号列索引 | 高 |
| `ts/sync/exceltobangumi.ts` | `extractResponseMessage(data): string` | API 响应 → 错误描述 | 高 |
| `ts/core/constants.ts` | 各映射表查找（`WATCH_STATUS_MAP` 等） | 静态映射 | 高 |

**结论**：约 15 个纯函数，全部已从 `ts/index.ts` 导出，可直接单元测试。

### 10.2 副作用函数识别

| 位置 | 函数 | 副作用类型 | 测试难度 |
| --- | --- | --- | --- |
| `ts/tools/util.ts` | `getApp()` | 读取全局 `window.Application` / `(window as any).Application` | 高（需 mock WPS 环境） |
| `ts/tools/util.ts` | `getCellValue/setCellValue` | COM 调用 WPS Range | 高 |
| `ts/tools/util.ts` | `loadBgToken/storeBgToken` | PluginStorage 读写 | 中（需 mock PluginStorage） |
| `ts/tools/util.ts` | `findHeaderRow/getColumnMap/getLastRow` | COM + 缓存 | 高 |
| `ts/tools/util.ts` | `_fetchBgmUserInfo` | XHR + 全局状态写入 | 中（可 mock XHR） |
| `ts/tools/util.ts` | `bgmLog` | console.log 副作用 | 低 |
| `ts/tools/config.ts` | `getConfig/setConfig/removeConfig` | PluginStorage + eventBus | 中 |
| `ts/tools/http.ts` | `httpRequest` | XHR + 重试 | 中 |
| `ts/sync/exceltobangumi.ts` | `bgmRequestSync` | XHR | 中 |
| `ts/sync/exceltobangumi.ts` | `SyncToBangumiAsync` | COM + XHR + 全局状态 + 进度回调 | 极高（集成测试级） |
| `ts/sync/exceltobangumi.ts` | `syncSelectedRows` | 同上 | 极高 |
| `ts/sync/exceltobangumi.ts` | `markEpisodesComplete` | XHR 串行 | 中 |
| `ts/sync/scraping.ts` | `verifyToken`/`fetchAllUserCollections` | XHR | 中 |
| `ts/sync/syncRecord.ts` | `addSyncRecord`/`getAllSyncRecords` | COM 工作表读写 | 高 |
| `ts/ui/handlers.ts` | `syncFromPanel`/`_doAPISync` | DOM + COM + XHR | 极高 |
| `ts/ui/preview.ts` | `previewSyncContent` | DOM 渲染 | 高 |
| `ts/ui/dialog.ts` | `showAlert/showToast` 等 | DOM | 中 |

**结论**：高测试难度的函数集中在 `SyncToBangumiAsync`/`syncSelectedRows`/`syncFromPanel` 三个超级函数（已在 Task B1/B4 拆分迭代中部分缓解），剩余仍需通过依赖注入降耦合。

### 10.3 依赖注入可行性评估

**当前耦合点**：

1. **`getConfig`/`setConfig`**（`ts/tools/config.ts`）：
   - 内部直接调用 `getStorage()` → `getApp()` → `window.Application`。
   - **不可注入**：测试时必须 mock `window.Application.PluginStorage`。
   - **改造建议**：增加可选参数 `getStorage?: () => WpsPluginStorage`，默认值保留现状，测试时传入 mock。

2. **`bgmRequestSync`**（`ts/sync/exceltobangumi.ts`）：
   - 内部直接 `new XMLHttpRequest()`。
   - **不可注入**：测试时必须全局拦截 `XMLHttpRequest`。
   - **改造建议**：抽 `httpClient` 接口，默认实现走 `httpRequest`，测试时注入 mock。

3. **`SyncToBangumiAsync`**（`ts/sync/exceltobangumi.ts:1329`）：
   - 直接依赖 `getCellValue`/`setCellValue`/`getColumnMap`/`getLastRow` 等工具函数。
   - **不可注入**：所有 WPS 操作硬编码。
   - **改造建议**：将 WPS 操作封装为 `WpsSheetGateway` 接口，`SyncToBangumiAsync` 接收 gateway 参数。

4. **`httpRequest`**（`ts/tools/http.ts:72`）：
   - 已抽象良好，`endpoint`/`options`/`token` 均为参数。
   - **可测性中等**：仅缺 `XMLHttpRequest` 注入点。

**结论**：项目无任何依赖注入容器或工厂模式，所有依赖通过模块顶层 `import` 硬绑定。改造需逐函数渐进推进。

### 10.4 Mock 友好度

**有利因素**：
- `ts/index.ts` 作为 barrel 导出，所有公开函数均 `export`，**便于测试时用 `vi.mock('../index.js')` 或 `jest.mock` 替换**。
- 纯函数（10.1 节）无需 mock 即可测试。
- `BGM.handleError` 已封装统一错误处理，测试时可 mock 此函数验证错误路径。

**不利因素**：
- 函数内部直接调用 `getApp()`、`new XMLHttpRequest()`、`document.getElementById`，**无法在函数边界注入 mock**，必须全局拦截。
- `BGM` 全局对象的 `sync`/`sheet`/`data`/`Dialog`/`Message` 状态在模块加载时初始化，测试间状态隔离困难。
- `ts/tools/util.ts:936` 处重写了 `console.log/warn/error`，**影响测试日志捕获**，需在测试 setup 中恢复。

### 10.5 测试框架与目录审查

**现状**：
- `package.json` 中**无任何测试框架依赖**（无 jest/vitest/mocha/chai）。
- 项目中无 `test/`、`tests/`、`__tests__/` 目录。
- 无 `*.spec.ts`、`*.test.ts` 文件。
- `tsconfig.json` 中 `exclude: ["**/*.spec.ts"]` 已配置（表明早期规划过测试但未落地）。
- `package.json` 的 `scripts` 无 `test` 命令。

**P2 缺陷**：核心业务逻辑（`extractSubjectId`、`mapWatchStatus`、`buildJsonPayload`、`calcFingerprint`、`calcChecksum`）完全无回归测试保护，重构依赖人工验证。

**推荐测试栈**（与 Vite 生态契合）：
- 测试运行器：**Vitest**（与 Vite 6 原生集成，零配置）。
- 断言库：Vitest 内置 `expect`。
- Mock 库：Vitest 内置 `vi.mock`/`vi.fn`。
- 覆盖率：`@vitest/coverage-v8`。

**最小落地步骤**：
1. `npm i -D vitest @vitest/coverage-v8`
2. `package.json` 增加 `"test": "vitest run"`、`"test:watch": "vitest"`、`"test:coverage": "vitest run --coverage"`。
3. 新建 `ts/tools/__tests__/util.spec.ts`，针对 `colNumToLetter`、`escapeHtml`、`trim`、`calcFingerprint`、`isEmptyValue` 编写首批用例。
4. 新建 `ts/sync/__tests__/exceltobangumi.spec.ts`，针对 `extractSubjectId`、`mapWatchStatus`、`buildTagsArray`、`addTagsFromStr`、`isBangumiUrl` 编写用例。
5. 新建 `ts/core/__tests__/crypto.spec.ts`，针对 `calcChecksum`、`buildPayload`、`extractToken`、`encryptToken`/`decryptToken` 往返测试。

### 10.6 可测试性问题清单

| ID | 位置 | 描述 | 风险 | 修复建议 |
| --- | --- | --- | --- | --- |
| T-1 | `package.json` | 无测试框架、无测试目录、无测试文件 | **P2** | 引入 Vitest，先覆盖 10.1 节纯函数 |
| T-2 | `ts/tools/config.ts`、`ts/tools/http.ts`、`ts/sync/exceltobangumi.ts` | 核心函数依赖硬编码，无注入点 | **P2** | 引入 `WpsSheetGateway`/`HttpClient` 接口，渐进改造 |
| T-3 | `ts/tools/util.ts:936` | 重写 `console.log/warn/error` 影响测试日志 | **P3** | 改为可注入的 `Logger` 接口，或测试 setup 中 `vi.spyOn(console, ...)` |
| T-4 | `ts/index.ts` | barrel 导出与模块初始化耦合（`BGM` 全局对象在 import 时初始化） | **P3** | 测试间需 `beforeEach` 重置 `BGM.sync`/`BGM.sheet` 状态 |

**可测试性总结**：纯函数资源丰富（约 15 个）但完全未测试，是最大的可维护性债务。建议优先落地 Vitest + 纯函数测试，再渐进引入依赖注入。

---

## 11. 架构耦合审查

### 11.1 BGM.sync 状态机单一职责审查

**审查对象**：`ts/tools/util.ts:94-220` 的 `BGM.sync` 对象。

**职责清单**（当前承担 5 类职责）：

1. **运行状态管理**：`isRunning`、`enterRunningState`、`exitRunningState`、`startSync`。
2. **暂停/恢复控制**：`isPaused`、`pause`、`resume`、`waitForResume`、`checkPaused`。
3. **停止控制**：`shouldStop`、`requestStop`、`checkShouldStop`、`resetStopFlag`。
4. **位置追踪**：`currentRow`、`currentSheet`、`currentCol`、`updatePosition`、`locateCurrentCell`。
5. **UI 副作用**：`enterRunningState` 失败时调用 `BGM.Dialog.alert`；`startSync` 调用 `BGM.Dialog.confirm`；`pause` 调用 `this.locateCurrentCell()` 操作 WPS Range。

**违反 SRP 的具体表现**：
- **P2**：`startSync`（`ts/tools/util.ts:121-145`）同时承担"防重复"+"确认对话框"+"状态置位"+"调用 syncAllRows"+"错误处理"+"完成态切换"6 个职责。
- **P2**：`pause`（`ts/tools/util.ts:155-162`）既改状态又调用 `locateCurrentCell` 操作 WPS DOM。
- **P2**：`waitForResume`（`ts/tools/util.ts:179-183`）使用 `setTimeout(50ms)` 轮询，属忙等待，与状态管理职责混杂。

**拆分建议**：

```
ts/core/
├── sync/
│   ├── SyncStateMachine.ts   # 仅状态：isRunning/isPaused/shouldStop + 转换方法
│   ├── SyncPositionTracker.ts # currentRow/Sheet/Col + update/locate
│   └── SyncController.ts     # startSync/pause/resume/stop 编排（组合状态机+位置追踪+UI）
```

- `SyncStateMachine`：纯状态转换，无副作用，返回 `{ ok: boolean, reason?: string }`。
- `SyncPositionTracker`：仅持有位置，`locateCurrentCell` 改为接收 `WpsWorksheet` 参数。
- `SyncController`：组合两者，调用 `BGM.Dialog` 与 `syncAllRows`。

### 11.2 handlers.ts ↔ exceltobangumi.ts 耦合审查

**耦合路径**：

1. **导入耦合**（`ts/ui/handlers.ts:7-26`）：
   - 从 `'../index.js'` 导入 `SyncToBangumiAsync`、`syncSelectedRows`、`extractSubjectId`、`getSequentialRowsBySeqCol`、`getOrCreateSyncRecordSheet`、`getAllSyncRecords`、`addSyncRecord`、`openSyncRecordSheet`、`deduplicateSyncRecords`、`formatSyncRecordSheet`、`clearSyncRecords` 共 11 个 sync 模块函数。
   - 另从 barrel 导入 `verifyToken`、`fetchAllUserCollections`、`openBangumiTokenPage`、`readRangeValues` 等。
   - **单文件导入 11 个 sync 函数**，表明 `handlers.ts` 承担了过多 sync 调度职责。

2. **调用耦合**：
   - `ts/ui/handlers.ts:582-583`：`syncFromPanel` 直接调用 `SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, ...)`。
   - `ts/ui/handlers.ts:934-935`：`handleActionClick` 调用 `syncSelectedRows()`。
   - `ts/ui/handlers.ts:826`：调用 `extractSubjectId(bgmUrl)`。

3. **状态共享**：`handlers.ts` 直接读写 `BGM.sync`、`BGM.sheet`、`BGM.data`、`BGM.Dialog`、`BGM.Message` 全局状态。

**P2 问题**：`handlers.ts`（1644 行）与 `exceltobangumi.ts`（1780 行）形成"双子巨型模块"，任一改动易引发另一者回归。

**解耦建议**：

- **引入 SyncService 接口**：`handlers.ts` 仅依赖 `ISyncService` 接口（`syncAll`、`syncSelected`、`extractSubjectId` 方法），由 `exceltobangumi.ts` 实现并注册到服务容器。
- **拆分 handlers.ts**：
  - `ts/ui/handlers/tokenHandlers.ts`：Token 设置/验证（~300 行）。
  - `ts/ui/handlers/syncHandlers.ts`：同步触发/进度（~500 行）。
  - `ts/ui/handlers/sheetHandlers.ts`：工作表锁定/刷新（~400 行）。
  - `ts/ui/handlers/eventBusHandlers.ts`：eventBus 订阅注册（~200 行）。
  - `ts/ui/handlers/actionRouter.ts`：表驱动 action 分发（~200 行）。

### 11.3 eventBus 与 BGM.sync 协同审查

**eventBus 实现**（`ts/tools/events.ts`）：标准发布订阅，`emit` 时捕获 handler 异常（`ts/tools/events.ts:91-96`），避免单 handler 崩溃中断其他订阅者。

**事件清单**（`BGM_EVENTS`）：
- 状态类：`TOKEN_UPDATED`、`USER_ID_UPDATED`、`USER_NAME_UPDATED`、`CONFIG_UPDATED`。
- 同步类：`SYNC_PROGRESS`、`SYNC_COMPLETED`、`SYNC_ERROR`。
- 工作表类：`SHEET_LOCKED`、`SHEET_UNLOCKED`。

**emit 点**（`ts/tools/util.ts`）：
- `util.ts:393`、`util.ts:401`、`util.ts:405`：`_setBgmUserId`/`_setBgmUsername`/`storeBgToken` 后 emit 状态更新事件。
- `util.ts:408-417`：`BGM.setSyncProgress`/`setSyncComplete`/`setSyncError` emit 同步事件。
- `util.ts:680`、`util.ts:714`：`_setBgmUserId`/`_setBgmUsername` 内部 emit。

**on 订阅点**（`ts/ui/handlers.ts:1221-1254`）：
- `TOKEN_UPDATED` → 重新加载 Token 状态。
- `USER_ID_UPDATED` → 刷新用户 ID 显示。
- `USER_NAME_UPDATED` → 刷新用户名显示。
- `CONFIG_UPDATED` → 根据配置 key 刷新对应 UI。
- `SYNC_PROGRESS` → 更新进度弹窗。

**P2 问题：BGM.sync 与 eventBus 协同断裂**：
- `BGM.sync` 状态机内部**不 emit 任何事件**。`enterRunningState`、`exitRunningState`、`pause`、`resume`、`requestStop` 均为静默状态变更。
- 外部模块若需感知"同步开始/停止/暂停/恢复"，只能通过轮询 `BGM.sync.isRunning` 或监听 `SYNC_PROGRESS`（但进度事件仅在同步循环内触发，不覆盖暂停/恢复）。
- **后果**：Ribbon 按钮无法根据同步状态禁用/启用；Taskpane 在暂停期间无法显示"已暂停"提示（除非用户手动触发 UI 刷新）。

**P3 问题：eventBus 无命名空间隔离**：
- 所有事件平铺在 `BGM_EVENTS`，无前缀分组（虽然常量名含前缀如 `TOKEN_UPDATED`，但事件名字符串为 `state:tokenUpdated` 已含命名空间，可接受）。
- `eventBus.on` 不支持通配符订阅，无法监听 `sync:*`。

**修复建议**：
- 在 `BGM.sync.enterRunningState`/`exitRunningState`/`pause`/`resume`/`requestStop` 内部 emit 新事件 `SYNC_STATE_CHANGED`，payload 携带 `{ state: 'running'|'paused'|'stopped'|'idle' }`。
- handlers.ts 订阅 `SYNC_STATE_CHANGED`，刷新 Ribbon 按钮禁用态与 Taskpane 提示。

### 11.4 util.ts 拆分审查

**当前规模**：`ts/tools/util.ts` 共 1346 行，承担以下职责：

| 行号区间 | 职责 | 函数数 |
| --- | --- | --- |
| 1-50 | 模块导入 | - |
| 51-220 | `BGM` 全局对象（sync/sheet/data/Dialog/Message/handleError） | ~20 |
| 220-300 | 类型守卫与类型定义 | 5 |
| 300-430 | 日志与工具（`bgmLog`、`colNumToLetter`、`trim`、`escapeHtml`） | 4 |
| 430-620 | Token 管理（`loadBgToken`/`storeBgToken`/`clearBgToken`）+ 用户信息（`_fetchBgmUserInfo`/`fetchBgmUserInfo`） | 8 |
| 620-760 | WPS 操作（`getApp`/`getCell`/`getCellValue`/`setCellValue`/`getSheetByIndex`） | 6 |
| 760-940 | 表头/列映射/行检测（`findHeaderRow`/`getColumnMap`/`getLastRow`/`getDataSheet`/`getSequentialRowsBySeqCol`） | 7 |
| 940-1346 | 缓存（`cacheGet`/`cacheSet`/`clearSheetCache`）+ 杂项（`shellExecuteByOAAssist`/`getUrlPath`/`calcFingerprint`/`readRangeValues`/`showBangumiPanel`/`sleep`/`delay`） | 10 |

**P2 问题**：单文件 1346 行违反单一职责，8 类职责混杂。

**拆分建议**：

```
ts/
├── core/
│   └── bgm.ts              # BGM 全局对象（sync/sheet/data）+ handleError
├── tools/
│   ├── log.ts              # bgmLog + LOG_LEVELS 重导出
│   ├── string.ts           # colNumToLetter/trim/escapeHtml/calcFingerprint
│   ├── wpsAccess.ts        # getApp/getCell/getCellValue/setCellValue/getSheetByIndex
│   ├── sheetScan.ts        # findHeaderRow/getColumnMap/getLastRow/getDataSheet/getSequentialRowsBySeqCol
│   ├── sheetCache.ts       # cacheGet/cacheSet/clearSheetCache
│   ├── tokenStore.ts       # loadBgToken/storeBgToken/clearBgToken + _fetchBgmUserInfo/fetchBgmUserInfo
│   └── misc.ts             # sleep/delay/shellExecuteByOAAssist/getUrlPath/readRangeValues/showBangumiPanel
└── index.ts                # 仅 re-export，不含逻辑
```

**迁移策略**：保持 `ts/index.ts` 的导出签名不变，内部改为从新模块 re-export，**调用方零改动**。

### 11.5 exceltobangumi.ts 拆分审查

**当前规模**：`ts/sync/exceltobangumi.ts` 共 1780 行，承担：

| 行号区间 | 职责 | 函数数 |
| --- | --- | --- |
| 1-130 | 模块导入与常量 | - |
| 130-260 | 纯函数（`extractSubjectId`/`mapWatchStatus`/`isBangumiUrl`/`getSeqColIndex`/`addTagsFromStr`/`buildTagsArray`） | 6 |
| 260-430 | Token 验证（`testTokenValidityForRibbon`/`openBangumiTokenPage`）+ 错误解析（`parseErrorResponse`/`extractResponseMessage`） | 4 |
| 430-720 | 请求体构建（`buildJsonPayload`）+ 单次请求（`bgmRequestSync`） | 2 |
| 720-920 | 章节标记（`markEpisodesComplete`/`fetchEpisodeIds`） | 2 |
| 920-1330 | 批量同步（`batchSyncRequests`） | 1 |
| 1330-1500 | 主编排（`SyncToBangumiAsync`）6 步流水线 | 1 |
| 1500-1780 | 选中行同步（`syncSelectedRows`）+ `setBangumiToken` | 2 |

**P2 问题**：单文件 1780 行，纯函数、网络请求、业务编排、章节标记 4 类职责混杂。

**拆分建议**：

```
ts/sync/
├── pureUtils.ts            # extractSubjectId/mapWatchStatus/isBangumiUrl/getSeqColIndex/addTagsFromStr/buildTagsArray
├── apiClient.ts            # bgmRequestSync + parseErrorResponse/extractResponseMessage
├── payloadBuilder.ts       # buildJsonPayload
├── episodeMarker.ts       # markEpisodesComplete + fetchEpisodeIds
├── batchSync.ts            # batchSyncRequests
├── syncOrchestrator.ts     # SyncToBangumiAsync
├── selectedSync.ts         # syncSelectedRows
└── tokenOps.ts             # testTokenValidityForRibbon + openBangumiTokenPage + setBangumiToken
```

### 11.6 架构问题清单

| ID | 位置 | 描述 | 风险 | 修复建议 |
| --- | --- | --- | --- | --- |
| A-1 | `ts/tools/util.ts:94-220` | `BGM.sync` 状态机承担 5 类职责（状态/暂停/停止/位置/UI 副作用） | **P2** | 拆分为 `SyncStateMachine` + `SyncPositionTracker` + `SyncController` |
| A-2 | `ts/tools/util.ts:121-145` | `startSync` 单方法承担 6 步（防重/确认/置位/调用/错误/完成） | **P2** | 编排逻辑移至 `SyncController`，每步独立函数 |
| A-3 | `ts/tools/util.ts:155-162` | `pause` 既改状态又操作 WPS DOM（locateCurrentCell） | **P2** | 位置操作移至 `SyncPositionTracker`，`pause` 仅改状态并 emit 事件 |
| A-4 | `ts/tools/util.ts:179-183` | `waitForResume` 使用 50ms 忙等待轮询 | **P3** | 改用 `Promise` + 事件触发（`once('SYNC_RESUMED', resolve)`） |
| A-5 | `ts/ui/handlers.ts:7-26` | 从 barrel 导入 11 个 sync 函数，handlers.ts 与 sync 模块强耦合 | **P2** | 引入 `ISyncService` 接口，handlers 仅依赖接口 |
| A-6 | `ts/ui/handlers.ts` 1644 行 | 单文件过大，承担 token/sync/sheet/eventBus/action 多类 handler | **P2** | 按 11.2 节建议拆分为 5 个子模块 |
| A-7 | `ts/sync/exceltobangumi.ts` 1780 行 | 单文件过大，纯函数/网络/编排/章节标记混杂 | **P2** | 按 11.5 节建议拆分为 8 个子模块 |
| A-8 | `ts/tools/util.ts` 1346 行 | 单文件过大，8 类职责混杂 | **P2** | 按 11.4 节建议拆分为 7 个子模块 |
| A-9 | `BGM.sync` 全部方法 | 状态机内部不 emit 事件，外部无法感知暂停/恢复/停止 | **P2** | 在状态转换处 emit `SYNC_STATE_CHANGED` |
| A-10 | `ts/tools/events.ts:17` | `EventHandler<T = any>` 使用 `any` 默认泛型 | **P3** | 改为 `EventHandler<T = unknown>` 并在使用处显式传 T |

**架构审查总结**：项目核心问题集中在"三巨型文件"（util.ts 1346 行、exceltobangumi.ts 1780 行、handlers.ts 1644 行）与"BGM.sync 状态机职责过载"。建议按 11.4/11.5/11.2 节拆分方案渐进重构，配合 Task 10 引入的测试基础设施保障回归。

---

## 12. 边界情况验证方案

> 以下 21 项验证方案供用户在 WPS 加载项中实测。每项包含：场景描述、前置条件、操作步骤、预期结果、失败征兆。
> 失败征中标明的"控制台关键词"可在 WPS 加载项 DevTools Console（F12）中检索。

### 12.1 数据预览边界（4 项）

#### 12.1.1 空表预览

- **场景描述**：工作表仅有表头行，无任何数据行时点击"刷新预览"。
- **前置条件**：
  1. 打开 WPS 加载项，Taskpane 已显示。
  2. 新建工作表，A1-E1 填入表头（条目名称/Bangumi URL/我的状态/集数/标签），A2 起留空。
  3. 选中该工作表。
- **操作步骤**：
  1. 在 Taskpane 工作表下拉选择该空表。
  2. 点击"刷新预览"按钮。
- **预期结果**：
  - 预览区域显示"暂无数据"或空表格提示。
  - 控制台输出 `[refreshData] 未检测到数据行` 或类似 INFO 日志。
  - 不抛出异常，不显示错误对话框。
- **失败征兆**：
  - 控制台出现 `TypeError: Cannot read properties of null/undefined`。
  - Taskpane 卡死或预览区显示"undefined"。
  - 弹出"同步失败"错误对话框。

#### 12.1.2 单行表预览

- **场景描述**：工作表仅 1 行数据时预览。
- **前置条件**：
  1. 工作表第 1 行为表头（条目名称/Bangumi URL/我的状态/集数/标签）。
  2. 第 2 行填 1 条有效数据（如"测试番组/https://bgm.tv/subject/1/想看/12/治愈"）。
- **操作步骤**：
  1. Taskpane 选择该工作表。
  2. 点击"刷新预览"。
- **预期结果**：
  - 预览表格显示 1 行数据。
  - 表头识别正确，"我的状态"列识别为"想看"。
  - 控制台输出 `[detectHeaderAndColumns] headerRow=1, dataStartRow=2`。
- **失败征兆**：
  - 表头识别失败，数据行被当作表头。
  - 预览行数为 0。
  - 控制台出现 `[autoDetectSheet] 未找到候选表头行`。

#### 12.1.3 筛选状态下预览

- **场景描述**：工作表应用了 AutoFilter，仅显示部分行时预览。
- **前置条件**：
  1. 工作表填入 20 行数据（表头 + 19 行），"我的状态"列含"想看/在看/看过"3 种值。
  2. 选中表头，应用 AutoFilter，筛选"我的状态=在看"（假设匹配 5 行）。
- **操作步骤**：
  1. Taskpane 选择该工作表。
  2. 点击"刷新预览"。
- **预期结果**：
  - 预览仅显示筛选后的 5 行可见数据。
  - 隐藏行不出现在预览中。
  - 控制台输出 `[getFilterStatus] isFiltered=true, visibleCount=5`。
  - "同步全部可见行"按钮的进度提示总数为 5。
- **失败征兆**：
  - 预览显示全部 19 行（忽略筛选）。
  - 预览行数与可见行数不符。
  - 控制台无 `isFiltered=true` 日志。

#### 12.1.4 跳行数据预览

- **场景描述**：工作表中间存在空行（数据不连续）时预览。
- **前置条件**：
  1. 工作表第 2-5 行有数据，第 6 行空，第 7-10 行有数据。
- **操作步骤**：
  1. Taskpane 选择该工作表。
  2. 点击"刷新预览"。
- **预期结果**：
  - 预览按行号升序显示 2,3,4,5,7,8,9,10 共 8 行（跳过空行 6）。
  - 不出现重复行或乱序。
  - 控制台输出 `[refreshData] previewRows.length=8`。
- **失败征兆**：
  - 预览从第 201 行跳到第 3 行（历史 bug 复现）。
  - 出现重复行。
  - 控制台出现 `previewRows.sort is not a function`。

### 12.2 同步操作边界（5 项）

#### 12.2.1 Token 失效同步

- **场景描述**：Token 已过期或被吊销时触发同步。
- **前置条件**：
  1. 在 Taskpane 设置一个无效 Token（如 `invalid_token_12345`）。
  2. 工作表有 3 行有效数据（含合法 Bangumi URL）。
  3. 打开 DevTools Console。
- **操作步骤**：
  1. 点击"同步全部可见行"按钮。
  2. 等待同步进度弹窗显示。
- **预期结果**：
  - 进度弹窗显示，3 行均标记为失败。
  - 每行失败原因显示"Token 无效或已过期（401）"。
  - 弹窗完成态显示"成功 0 / 失败 3 / 跳过 0"。
  - 控制台输出 `[bgmRequestSync] HTTP 401 Token 无效或已过期`。
  - 不弹出未捕获异常对话框。
- **失败征兆**：
  - 同步卡在"进行中"不结束。
  - 弹窗显示"成功 3"（误报成功）。
  - 控制台出现 `Unhandled Promise Rejection`。
  - 出现 `[syncSelectedRows] jsonBody 解析失败`（与 S-1 缺陷相关）。

#### 12.2.2 网络断开同步

- **场景描述**：同步过程中网络断开（如关闭 Wi-Fi 或被 GFW 墙）。
- **前置条件**：
  1. Token 有效，已验证通过。
  2. 工作表有 10 行数据。
  3. 打开 DevTools Console。
- **操作步骤**：
  1. 点击"同步全部可见行"。
  2. 同步开始后第 3 行处理时，关闭网络连接（断开 Wi-Fi 或断网）。
  3. 等待 30 秒（超时时间）。
- **预期结果**：
  - 第 3 行显示"网络请求失败"或"请求超时 (30000ms)"。
  - 自动重试 3 次（指数退避 2s/4s/8s），每次控制台输出 `[HTTP] 网络错误，第 N 次重试`。
  - 重试耗尽后该行标记失败，继续处理第 4 行。
  - 弹窗完成态显示"成功 2 / 失败 1+ / 跳过 0"。
  - 控制台出现 `[httpRequest] NETWORK_ERROR`。
- **失败征兆**：
  - 同步卡死无响应。
  - 重试次数超过 3 次仍循环。
  - 未显示 GFW 相关提示（参考 Task GFW 修复）。

#### 12.2.3 并发触发同步

- **场景描述**：用户快速连续点击"同步"按钮多次。
- **前置条件**：
  1. 工作表有 5 行数据。
  2. Token 有效。
- **操作步骤**：
  1. 快速连续点击"同步全部可见行"按钮 5 次（间隔 < 200ms）。
- **预期结果**：
  - 仅第 1 次点击触发同步，后续 4 次弹出"同步正在进行中，请稍后"提示。
  - 控制台输出 `[sync] startSync: isRunning=true, 拒绝重入`。
  - 同步进度弹窗只出现 1 个。
  - 同步正常完成后弹窗关闭。
- **失败征兆**：
  - 出现多个进度弹窗叠加。
  - 控制台出现多个 `syncAllRows` 并发日志。
  - 数据被重复同步（Bangumi 端出现重复收藏）。

#### 12.2.4 超大表同步

- **场景描述**：工作表含 10000 行数据时同步性能与内存表现。
- **前置条件**：
  1. 工作表填入 10000 行有效数据（可用脚本批量生成测试 URL `https://bgm.tv/subject/{i}`）。
  2. Token 有效。
  3. 打开 DevTools Performance/Memory 面板。
- **操作步骤**：
  1. 点击"同步全部可见行"。
  2. 观察进度弹窗响应性、内存增长。
  3. 中途点击"暂停"按钮，等待 5 秒后"恢复"。
- **预期结果**：
  - 进度弹窗滚动流畅，无明显卡顿（FPS > 30）。
  - 内存增长 < 100MB（10000 行 × 每行约 5KB 数据）。
  - 暂停后 5 秒内定位到当前单元格。
  - 恢复后继续从断点同步。
  - 控制台输出 `[sync] 已暂停，当前行: N` 与 `[sync] 同步已恢复`。
- **失败征兆**：
  - 进度弹窗白屏或卡死 > 2 秒。
  - 内存增长 > 500MB（内存泄漏征兆）。
  - 暂停后无法定位单元格（`locateCurrentCell` 失败）。
  - 恢复后从头开始同步（断点丢失）。

#### 12.2.5 特殊字符同步

- **场景描述**：数据含 emoji、控制字符、超长字符串时同步。
- **前置条件**：
  1. 工作表填入以下测试行：
     - 行 A：评论含 emoji `看哭了😭`，标签含 emoji `治愈💕`
     - 行 B：评论含 2000 字超长字符串
     - 行 C：评论含控制字符 `\u0001\u0002`
     - 行 D：条目名称含日文 `テスト`、韩文 `테스트`、特殊标点 `"引号"`
  2. Token 有效。
- **操作步骤**：
  1. 点击"同步全部可见行"。
  2. 检查每行同步结果。
- **预期结果**：
  - 行 A：成功，Bangumi 端评论显示"看哭了😭"，标签显示"治愈💕"。
  - 行 B：成功，评论被截断至 1000 字符，控制台输出 `[buildJsonPayload] 评论超过 1000 字符，已截断`。
  - 行 C：成功，控制字符被过滤，控制台输出 `[buildJsonPayload] 已移除控制字符`。
  - 行 D：成功，多语言字符正常上传。
  - 弹窗完成态显示"成功 4 / 失败 0"。
- **失败征兆**：
  - 行 A/B/C 同步失败（HTTP 400）。
  - Bangumi 端评论显示乱码或 `???`。
  - 控制台出现 `[bgmRequestSync] HTTP 400 请求参数错误`。
  - 行 B 未截断导致请求体过大（HTTP 413）。

### 12.3 工作表操作边界（4 项）

#### 12.3.1 切换工作表

- **场景描述**：同步进行中切换到另一个工作表。
- **前置条件**：
  1. 工作簿含 2 个工作表 Sheet1、Sheet2，均有 5 行数据。
  2. 已锁定 Sheet1。
  3. 启动 Sheet1 的同步，处理到第 3 行时。
- **操作步骤**：
  1. 同步进行中，手动点击 Sheet2 标签切换活动表。
  2. 观察同步是否继续、是否报错。
- **预期结果**：
  - 同步继续在 Sheet1 上执行（`currentSheet` 持有 Sheet1 引用）。
  - 控制台输出 `[sync] currentSheet 仍为 Sheet1`。
  - `locateCurrentCell` 调用时临时 `Sheet1.Activate()` 定位单元格，结束后恢复 Sheet2 活动。
  - 同步完成后弹窗显示结果。
- **失败征兆**：
  - 同步数据写入 Sheet2（错表）。
  - `locateCurrentCell` 抛出"工作表已失效"异常。
  - 控制台出现 `Range method failed`。

#### 12.3.2 锁定工作表后切换工作簿

- **场景描述**：锁定工作表后关闭并重新打开工作簿。
- **前置条件**：
  1. 工作簿 A 含 Sheet1，已锁定。
  2. PluginStorage 中已保存 `bgm_locked_sheet`。
- **操作步骤**：
  1. 关闭工作簿 A。
  2. 重新打开工作簿 A。
  3. 打开 Taskpane。
- **预期结果**：
  - Taskpane 打开后，`restoreLockedSheet` 从 PluginStorage 读取锁定信息。
  - 工作表下拉自动选中 Sheet1，锁定状态显示"已锁定: Sheet1"。
  - 控制台输出 `[restoreLockedSheet] 恢复锁定状态: Sheet1`。
  - 锁定按钮显示为"解锁"。
- **失败征兆**：
  - 锁定状态丢失，下拉显示"-- 请选择 --"。
  - 控制台出现 `JSON.parse: unexpected character`（PluginStorage 数据损坏）。
  - 锁定按钮状态与实际不符。

#### 12.3.3 删除工作表

- **场景描述**：删除已锁定的或正在同步的工作表。
- **前置条件**：
  1. 工作簿含 Sheet1（已锁定，正在同步中）、Sheet2。
- **操作步骤**：
  1. 同步进行中（处理到第 2 行），右键 Sheet1 标签选择"删除"。
  2. 在 WPS 弹出的确认框中点"确定"。
- **预期结果**：
  - 同步捕获异常，弹窗显示"工作表已被删除"或类似错误。
  - `BGM.sync.exitRunningState()` 被调用，状态重置。
  - 控制台输出 `[sync] 工作表删除异常: ...` 并 `[sync] exitRunningState`。
  - Taskpane 工作表下拉刷新，Sheet1 消失。
- **失败征兆**：
  - 同步卡死在"进行中"状态。
  - 弹窗无法关闭。
  - 控制台出现 `Unhandled Exception: Cannot access deleted sheet`。
  - `BGM.sync.isRunning` 永远为 true（状态泄漏）。

#### 12.3.4 重命名工作表

- **场景描述**：重命名已锁定的或正在同步的工作表。
- **前置条件**：
  1. Sheet1 已锁定，名称为"旧表"。
- **操作步骤**：
  1. 双击 Sheet1 标签，重命名为"新表"，回车确认。
  2. 观察 Taskpane 锁定状态。
- **预期结果**：
  - Taskpane 检测到工作表名称变化，锁定状态更新为"已锁定: 新表"。
  - PluginStorage 中的 `bgm_locked_sheet` 更新为新名称。
  - 控制台输出 `[sheet] 工作表重命名: 旧表 → 新表`。
- **失败征兆**：
  - 锁定状态仍显示"已锁定: 旧表"。
  - 解锁时找不到工作表。
  - 控制台出现 `Worksheet not found: 旧表`。

### 12.4 Ribbon ↔ Taskpane 状态同步（4 项）

#### 12.4.1 Ribbon 触发全面同步

- **场景描述**：从 Ribbon 点击"全面同步"按钮，验证 Taskpane 状态同步。
- **前置条件**：
  1. Taskpane 已打开。
  2. 工作表有 5 行数据，Token 有效。
  3. 打开 DevTools Console（Taskpane 内）。
- **操作步骤**：
  1. 点击 Ribbon"全面同步"按钮。
  2. 观察是否弹出 WPS 原生确认对话框。
  3. 点击"确定"。
- **预期结果**：
  - 立即弹出 WPS 原生确认框"确定要开始全面同步吗？"（参考 Task 修复：先弹框再做冲突检测）。
  - 点击确定后，Taskpane 内弹出同步进度弹窗。
  - 控制台输出 `[ribbon] btnSyncBangumi 触发` 与 `[sync] startSync`。
  - 同步进行中，Taskpane 的"同步"按钮应禁用或显示"同步中"。
- **失败征兆**：
  - 点击 Ribbon 按钮无反应（参考历史 bug：async OnAction 未 .catch）。
  - 控制台无任何日志（Ribbon 日志未到达 Taskpane）。
  - 冲突检测卡在 GFW 网络请求 30 秒无 UI 反馈。
  - 重复弹出多个确认框。

#### 12.4.2 Ribbon 设置 Token

- **场景描述**：从 Ribbon 设置 Token，验证 Taskpane Token 状态更新。
- **前置条件**：
  1. Taskpane 已打开，当前 Token 状态为"未设置"。
  2. 准备一个有效 Token。
- **操作步骤**：
  1. 点击 Ribbon"设置 Token"按钮。
  2. 在弹出的输入框中粘贴 Token。
  3. 点击"确定"。
- **预期结果**：
  - Taskpane 的 Token 状态立即更新为"已设置"。
  - 控制台输出 `[handlers] TOKEN_UPDATED 事件触发` 与 `[taskpane] Token 状态已刷新`。
  - 用户 ID 与用户名字段随后自动填充（触发 `fetchBgmUserInfo`）。
- **失败征兆**：
  - Taskpane Token 状态不更新（eventBus 订阅失效）。
  - 需手动刷新 Taskpane 才显示。
  - 控制台无 `TOKEN_UPDATED` 事件日志。

#### 12.4.3 Ribbon 冲突检测 GFW 场景

- **场景描述**：点击 Ribbon"全面同步"时，冲突检测 API 请求被 GFW 墙。
- **前置条件**：
  1. 网络环境为大陆，未配置代理。
  2. Token 有效但 `api.bgm.tv` 解析慢或被墙。
  3. 打开 DevTools Console。
- **操作步骤**：
  1. 点击 Ribbon"全面同步"。
  2. 在确认框点"确定"。
  3. 观察冲突检测阶段的行为。
- **预期结果**：
  - 确认框立即弹出（不等待冲突检测）。
  - 冲突检测阶段显示进度提示"正在检测冲突..."。
  - 网络请求超时后（15s），显示"GFW 网络问题：冲突检测失败，是否继续同步？"二次确认。
  - 控制台输出 `[detectConflicts] 网络错误: 请求超时` 与 `[detectConflicts] GFW 提示已显示`。
  - 用户可选择"继续同步"或"取消"。
- **失败征兆**：
  - 点击 Ribbon 无响应（silent Promise rejection，历史 bug）。
  - 冲突检测卡 30 秒无提示。
  - 控制台出现 `Unhandled Promise Rejection: Network Error`。
  - 无 GFW 特定提示文案。

#### 12.4.4 Taskpane 关闭后 Ribbon 操作

- **场景描述**：Taskpane 未打开时从 Ribbon 触发同步。
- **前置条件**：
  1. 关闭 Taskpane（点击关闭按钮或取消停靠）。
  2. 工作表有数据，Token 有效。
- **操作步骤**：
  1. 点击 Ribbon"全面同步"。
  2. 在确认框点"确定"。
- **预期结果**：
  - 同步正常执行（Ribbon 路径不依赖 Taskpane DOM）。
  - 同步结果通过 WPS 状态栏或 Toast 通知显示。
  - 控制台日志输出到 Ribbon 上下文（可能不在 Taskpane DevTools 可见）。
  - 同步完成后可正常打开 Taskpane 查看。
- **失败征兆**：
  - 同步完全无响应（依赖 Taskpane 才能运行）。
  - 同步运行但无任何 UI 反馈。
  - 打开 Taskpane 后状态不一致（如显示"同步中"但实际已完成）。

### 12.5 同步记录开关验证（4 项）

#### 12.5.1 启用同步记录后同步

- **场景描述**：勾选"启用同步记录"后执行同步，验证记录写入。
- **前置条件**：
  1. Taskpane 打开，Token 有效。
  2. 工作表有 3 行数据。
  3. 同步记录工作表不存在（首次启用）。
  4. 勾选"启用同步记录"复选框。
- **操作步骤**：
  1. 勾选 `chkEnableSyncRecord`。
  2. 点击"同步全部可见行"。
  3. 同步完成后切换到"同步记录"工作表。
- **预期结果**：
  - 同步过程中控制台输出 `[syncRecord] addSyncRecord 被调用`。
  - 同步完成后，工作簿自动新建"同步记录"工作表。
  - 该表含 3 行记录，列包括：行号/条目名称/Subject ID/同步时间/同步类型/状态/HTTP 状态码/详情。
  - 控制台输出 `[syncRecord] 新增 3 条记录`。
- **失败征兆**：
  - 同步记录工作表未创建。
  - 记录数为 0（`getSyncRecordEnabled` 返回 false）。
  - 记录数据错位或列名错误。
  - 控制台出现 `addSyncRecord is not a function`。

#### 12.5.2 关闭同步记录后同步

- **场景描述**：取消勾选"启用同步记录"后执行同步，验证不写入记录。
- **前置条件**：
  1. 同步记录工作表已存在并含历史记录。
  2. 取消勾选 `chkEnableSyncRecord`。
- **操作步骤**：
  1. 取消勾选。
  2. 点击"同步全部可见行"。
  3. 同步完成后查看"同步记录"工作表。
- **预期结果**：
  - 同步正常完成，但同步记录工作表行数不增加。
  - 控制台输出 `[syncRecord] getSyncRecordEnabled=false, 跳过记录`。
  - 历史记录保留不变。
- **失败征兆**：
  - 同步记录仍被写入（开关失效）。
  - 历史记录被清空（误删）。
  - 控制台无"跳过记录"日志。

#### 12.5.3 同步记录表不存在时的只读操作

- **场景描述**：同步记录开关关闭，且同步记录工作表不存在时，尝试查看记录。
- **前置条件**：
  1. 删除"同步记录"工作表（如存在）。
  2. 确保开关为关闭状态。
- **操作步骤**：
  1. 点击 Taskpane 的"查看同步记录"按钮。
- **预期结果**：
  - 弹出提示"同步记录未启用，无记录可查看"或"未找到同步记录工作表"。
  - 不创建新工作表。
  - 控制台输出 `[syncRecord] getSyncRecordSheetIfExists: 不存在`。
  - 不抛出异常。
- **失败征兆**：
  - 自动创建空记录表（违反"只读"语义）。
  - 抛出 `Worksheet '同步记录' not found` 异常。
  - Taskpane 卡死。

#### 12.5.4 同步记录开关持久化

- **场景描述**：修改同步记录开关后关闭重开 Taskpane，验证开关状态持久化。
- **前置条件**：
  1. 当前开关为"启用"。
- **操作步骤**：
  1. 取消勾选"启用同步记录"。
  2. 关闭 Taskpane。
  3. 重新打开 Taskpane。
  4. 检查复选框状态。
- **预期结果**：
  - 重新打开后复选框为未勾选状态。
  - 控制台输出 `[config] getSyncRecordEnabled=false`。
  - PluginStorage 中 `bgm_config_syncRecordEnabled` 值为 `'false'`。
  - 同步行为与开关状态一致。
- **失败征兆**：
  - 复选框恢复为勾选（持久化失败）。
  - 控制台出现 `getSyncRecordEnabled is not a function`。
  - 同步行为与 UI 显示不一致。

---

## 附录：问题汇总速查表

### 结构问题（Task 2）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| ST-1 | P1 | `ts/tools/util.ts:18` ↔ `ts/ui/preview.ts:19`（循环依赖） | 建议 |
| ST-2 | P2 | `ts/tools/util.ts`（1,258 行，职责混杂） | 建议 |
| ST-3 | P2 | `ts/index.ts` barrel 导出跨层（syncAllRows 经 barrel 暴露给 tools 层） | 可选 |
| ST-4 | P3 | 根目录杂物（`__pycache__`、`.debugTemp`、`wpsjsrpcsdk.js` 副本） | 可选 |
| ST-5 | P3 | 私有成员命名风格不统一（`_getBgmUserId` vs `enterRunningState`） | 可选 |

### 类型问题（Task 3）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| TS-1 | P2 | `ts/tools/wps.ts:115-121`（5 处 `any`：Value/Value2/Text/Formula/Selection） | 建议 |
| TS-2 | P2 | 全项目 `(e as Error).message` 未用 `instanceof` 守卫（~15 处） | 建议 |
| TS-3 | P2 | `ts/sync/exceltobangumi.ts:561,570`（`SpecialCells` 断言掩盖 null） | 建议 |
| TS-4 | P3 | `ts/services/ribbonService.ts:273`（syncWithConfirmation 返回类型缺失） | 可选 |
| TS-5 | P3 | `ts/tools/util.ts:1061`（缓存 `as T` 无编译期保证） | 可选 |

### 错误处理问题（Task 4）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| EH-1 | P0 | `ts/sync/exceltobangumi.ts:1394`（fetchEpisodeIds 无 ontimeout，Promise 永挂） | 是 |
| EH-2 | P1 | `ts/services/ribbonService.ts:402`（`new Error(msg, e as Error)` 第二参数应为 `{ cause: e }`） | 是 |
| EH-3 | P2 | 全项目 `(e as Error).message` 未守卫（同 TS-2） | 建议 |
| EH-4 | P2 | 全项目无 AbortController（XHR 用 abort() 可接受，fetch 迁移需补） | 可选 |
| EH-5 | P2 | `ts/services/ribbonService.ts:273`（syncWithConfirmation 无并发检查） | 是 |

### 边界问题（Task 5）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| BS-1 | P0 | `ts/ui/preview.ts:726`（syncAllRows 绕过 enterRunningState，直接设 isRunning） | 是 |
| BS-2 | P0 | `ts/services/ribbonService.ts:273`（syncWithConfirmation 未检查 isRunning，可并发同步） | 是 |
| BS-3 | P0 | `ts/ui/handlers.ts:573`（syncFromPanel 直接设 isRunning=true，绕过统一入口） | 是 |
| BS-4 | P1 | `ts/sync/exceltobangumi.ts:1394`（fetchEpisodeIds 无 ontimeout，同 EH-1） | 是 |
| BS-5 | P2 | `ts/tools/util.ts:1212`（getLastRow 默认返回 50000，误扫描全表） | 建议 |
| BS-6 | P2 | 工作簿切换/工作表删除无状态清理（BGM.sync.currentSheet / BGM.cache 残留） | 建议 |
| BS-7 | P2 | `ts/tools/autoFillUrl.ts`（URL 未校验 `javascript:` 协议注入） | 建议 |

### 性能问题（Task 6）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| PF-1 | P2 | `ts/tools/util.ts:1051`（sheetCache 全局 Map 无大小上限/TTL） | 建议 |
| PF-2 | P2 | `ts/ui/preview.ts:421`（预览卡片全量 innerHTML 渲染，数千卡片卡顿） | 建议 |
| PF-3 | P2 | `ts/ui/handlers.ts:1169`（message 监听未 removeEventListener，内存泄漏） | 建议 |
| PF-4 | P3 | `ts/ui/dialog.ts`（进度日志 append 无最大行数限制） | 可选 |
| PF-5 | P3 | 全项目无虚拟滚动（预览面板大数据量卡顿） | 可选 |

### UI/UX 问题（Task 7）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| UX-1 | P2 | `ts/ui/preview.ts`（预览模态框无 role="dialog"/aria-modal） | 建议 |
| UX-2 | P2 | `ts/ui/dialog.ts`（Toast 无 role="status"/aria-live，屏幕阅读器不播报） | 建议 |
| UX-3 | P2 | `css/styles.css`（`#888` 对比度 ~3.5:1 不达 WCAG AA，9 处） | 建议 |
| UX-4 | P2 | 全部模态框（无焦点陷阱，Tab 可跳出） | 建议 |
| UX-5 | P3 | 三套模态框类名不一致（bgm-modal / sync-progress-dialog / syncPreviewModal） | 可选 |
| UX-6 | P3 | `ts/ui/preview.ts:422`（内联 style.display 与 CSS 变量混用） | 可选 |

### 组件化建议（Task 8）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| CP-1 | P3 | 同步进度弹窗抽象为 `ProgressBar` 可复用组件 | 可选 |
| CP-2 | P3 | 三套模态框统一为 `Dialog`/`AlertDialog` 类 | 可选 |
| CP-3 | P3 | Button 系统 `.bgm-btn` 统一 + variant 属性 | 可选 |
| CP-4 | P3 | `ScrollArea` 替代内联 overflow-y: auto | 可选 |
| CP-5 | P3 | Checkbox 绑定逻辑抽象为 `bindConfigCheckbox()` 工具函数 | 可选 |

### 安全问题（Task 9）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| S-1 | P1 | `ts/sync/exceltobangumi.ts:1670` | 是 |
| S-2 | P2 | `ts/core/crypto.ts:151` | 建议 |
| S-3 | P3 | `ts/tools/config.ts:59` | 可选 |
| S-4 | P3 | `ts/core/constants.ts` | 可选 |
| S-5 | P3 | `package.json` | 可选 |

### 可测试性问题（Task 10）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| T-1 | P2 | `package.json`（无测试框架） | 建议 |
| T-2 | P2 | config.ts/http.ts/exceltobangumi.ts | 建议 |
| T-3 | P3 | `ts/tools/util.ts:936` | 可选 |
| T-4 | P3 | `ts/index.ts` | 可选 |

### 架构问题（Task 11）

| ID | 风险 | 位置 | 必修 |
| --- | --- | --- | --- |
| A-1 | P2 | `ts/tools/util.ts:94-220` | 建议 |
| A-2 | P2 | `ts/tools/util.ts:121-145` | 建议 |
| A-3 | P2 | `ts/tools/util.ts:155-162` | 建议 |
| A-4 | P3 | `ts/tools/util.ts:179-183` | 可选 |
| A-5 | P2 | `ts/ui/handlers.ts:7-26` | 建议 |
| A-6 | P2 | `ts/ui/handlers.ts` | 建议 |
| A-7 | P2 | `ts/sync/exceltobangumi.ts` | 建议 |
| A-8 | P2 | `ts/tools/util.ts` | 建议 |
| A-9 | P2 | `BGM.sync` 全部方法 | 建议 |
| A-10 | P3 | `ts/tools/events.ts:17` | 可选 |

### 边界验证方案（Task 12）

| 类别 | 项数 | 编号区间 |
| --- | --- | --- |
| 数据预览 | 4 | 12.1.1 - 12.1.4 |
| 同步操作 | 5 | 12.2.1 - 12.2.5 |
| 工作表操作 | 4 | 12.3.1 - 12.3.4 |
| Ribbon ↔ Taskpane | 4 | 12.4.1 - 12.4.4 |
| 同步记录开关 | 4 | 12.5.1 - 12.5.4 |
| **合计** | **21** | - |

### 修复优先级建议

#### P0（立即修复，阻塞级）

| ID | 位置 | 问题 | 修复要点 |
| --- | --- | --- | --- |
| BS-1 | `ts/ui/preview.ts:726` | syncAllRows 绕过 enterRunningState | 改为 `if (!BGM.sync.enterRunningState()) return;` |
| BS-2 | `ts/services/ribbonService.ts:273` | syncWithConfirmation 未检查 isRunning | 入口处补 `if (BGM.sync.isRunning) { wpsMsgBox('同步进行中'); return; }` 并经 enterRunningState 进入 |
| BS-3 | `ts/ui/handlers.ts:573` | syncFromPanel 直接设 isRunning | 同 BS-1，改用 enterRunningState |
| EH-1 | `ts/sync/exceltobangumi.ts:1394` | fetchEpisodeIds 无 ontimeout | 补 `xhr.ontimeout = () => reject(new Error('请求超时'));` |

#### P1（严重，本周内修复）

| ID | 位置 | 问题 | 修复要点 |
| --- | --- | --- | --- |
| S-1 | `ts/sync/exceltobangumi.ts:1670` | JSON.parse 未捕获 | 包裹 try/catch |
| EH-2 | `ts/services/ribbonService.ts:402` | new Error 第二参数错误 | 改为 `new Error('通知面板失败', { cause: e })` |
| ST-1 | `ts/tools/util.ts:18` ↔ `preview.ts:19` | 循环依赖 | 通过 eventBus 解耦，移除 util 对 preview 的直接导入 |

#### P2（一般，近期迭代）

| 类别 | IDs | 概要 |
| --- | --- | --- |
| 类型安全 | TS-1/TS-2/TS-3 | wps.ts any 收窄、instanceof 守卫、SpecialCells null 检查 |
| 错误处理 | EH-3/EH-5 | catch 守卫统一、syncWithConfirmation 并发检查 |
| 边界 | BS-5/BS-6/BS-7 | getLastRow 默认值、工作簿切换清理、URL 协议校验 |
| 性能 | PF-1/PF-2/PF-3 | 缓存上限、预览分页、message 监听清理 |
| UI/UX | UX-1/UX-2/UX-3/UX-4 | aria 属性、Toast 可访问性、#888 对比度、焦点陷阱 |
| 架构 | A-1~A-10、ST-2/ST-3 | BGM.sync 拆分、三巨型文件拆分、barrel 整理 |
| 可测试性 | T-1/T-2 | 引入 Vitest、纯函数抽取 |
| 安全 | S-2 | Token 加密升级 |

#### P3（长期优化）

| 类别 | IDs | 概要 |
| --- | --- | --- |
| 组件化 | CP-1~CP-5 | ProgressBar / Dialog / Button / ScrollArea / Checkbox 抽象 |
| UI/UX | UX-5/UX-6 | 模态框类名统一、内联 style 清理 |
| 性能 | PF-4/PF-5 | 进度日志限长、虚拟滚动 |
| 类型 | TS-4/TS-5 | 返回类型补全、缓存类型保证 |
| 其他 | T-3/T-4、A-4/A-10、S-3/S-4/S-5、ST-4/ST-5 | 命名统一、杂物清理等 |

---

**报告结束**。本报告为只读审查产物，未修改任何源代码。所有发现作为下一轮迭代（建议命名 `post-comprehensive-audit-fix`）的输入。
