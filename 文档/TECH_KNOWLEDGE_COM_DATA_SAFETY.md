# 技术知识文档：COM 数据安全与全链路同步审计

> 生成日期：2026-10-15（v3.13）
> 适用读者：后续维护 `ts/sync/`、`ts/ui/`、`ts/panel/`、`ts/tools/` 的开发者
> 关联文档：`ARCHITECTURE.md` §2.8（COM 读写不变式）、`.workbuddy/memory/REF-com-io.md`

---

## 一、为什么需要这份文档

本项目是 WPS/Excel JS 加载项，所有表格读写都经由**跨进程 COM 代理**。这带来两个与普通 Web 项目完全不同的风险面：

1. **性能面**：每次属性读取都是一次进程间往返（IPC），比内存访问贵几个数量级。逐格读写会把「扫 1000 行」放大成几千次往返。
2. **数据安全面**：COM 的 `Value2` 返回值形状、`null` 的语义、读失败的传播方式，都与 JS 直觉不同，**踩坑的后果是静默吞掉或改坏用户数据**，且单元测试（jsdom mock）完全抓不到。

2026-10-15 做了一次全链路审计（下载 → 解析 → diff → 写入 → 删除），发现 **6 处真实数据安全缺陷**和大量 COM 往返浪费。本文固化结论。

---

## 二、三条 COM 数据安全不变式（最重要）

### 2.1 单行区域的 `Value2` 是一维数组

```
Range("A2:H2").Value2   →  [v1, v2, v3, ...]        // 一维！整个数组就是一行
Range("A2:H9").Value2   →  [[v1, v2, ...], [...]]   // 二维
Range("A2").Value2      →  v1                        // 标量
```

**这是 Excel/WPS 的既定行为，不是边缘 case。** 任何「读一行多列」的代码都会遇到。

#### 曾经的错误写法

```ts
// ts/sync/github-sync.ts batchUpdateRows（修复前）
const oldValues = range.Value2 as (string | number | null)[] | null
oldArray = Array.isArray(oldValues)
  ? ((oldValues[0] as (string | number | null)[] | undefined) ?? [])
  : []
```

一维时 `oldValues[0]` 拿到的是**首个单元格的值**（一个字符串），随后 `oldArray[index]` 变成**对字符串按下标取字符**：

- 旧值退化成首字符 → 合并逻辑写出 `"h | 远程标签"` 这种乱值
- undo 记录把 `"h"` 当旧值 → **用户点撤销，单元格变成 "h"**
- 「值无变化则跳过」判断失效 → 每次都写

#### 正确写法（形状归一化）

```ts
const raw: unknown = range.Value2
if (Array.isArray(raw)) {
  const row = Array.isArray(raw[0]) ? raw[0] : raw // 二维取首行，一维整体即一行
}
```

**已在 `github-sync.ts` 的 `batchUpdateRows` 与 `batchWriteNewRows` 两处落地。**

#### 为什么单测没抓到

测试桩普遍返回二维数组（`[['', '']]`）或 `null`，从不返回一维。**这是「桩不忠实」的典型**——见第六节。

---

### 2.2 `null` 在二维数组里的语义是「清空该单元格」

`range.Value2 = [[null, null, "x"]]` 会把前两个单元格**清空**，不是「保持不变」。

#### 曾经的错误写法

```ts
// ts/sync/github-sync.ts writeRowValuesWithUndo（修复前）
const finalValues = [...rowValues]              // rowValues 默认全 null
for (let c = 0; c < colCount; c += 1) {
  if (finalValues[c] !== null) {
    if (旧值 === 新值) finalValues[c] = null     // 「无变化，跳过」
    ...
  }
}
range.Value2 = finalValues                        // 未变化的列被写 null = 清空
```

危险在于 **`writeCols` 是整批 updates 的 fields 并集，列号不连续**：

> 一批 50 行更新里，第 1 行只改「名称」(列2)，第 2 行只改「评分」(列30)
> → `minCol=2, maxCol=30, colCount=29`
> → 列 3..29 全部铺 `null` → **用户在这 27 列的数据被清空**

#### 正确写法（以旧值为基底）

```ts
const finalValues: (string | number | null)[] = Array.from(
  { length: colCount },
  (_, c) => oldArray[c] ?? null, // 先铺旧值
)
// 只把「本次要写且值确实变了」的位置替换掉
```

**新增行同理**：`batchWriteNewRows` 的 `nextAppendRow` 由锚定列 `End(xlUp)` 定位，锚定列比别的列短时，目标行本来就有用户数据（比如「备注」列还有内容）。修复后同样先读旧值兜底。

---

### 2.3 读失败 / 读回为空 ＝ 放弃写入

项目铁律原文：「读失败或读回为空＝放弃写入（否则静默清用户数据）」。

对**合并型列**尤其致命：

```ts
function appendValueWithSeparator(localValue: string, remoteValue: string): string {
  const local = trim(localValue)
  const remote = trim(remoteValue)
  if (!remote) return local
  if (!local) return remote        // ← 旧值为空时直接返回远程值
  ...
}
```

旧值读失败 → `oldCellValue = ''` → 合并结果就是远程值 → **用户本地标签/别名被整体替换**。

#### 正确写法（读不全就走逐字段回退）

```ts
if (range !== null && oldArray.length < colCount) {
  bgmLog(LOG_LEVELS.WARN, `行 ${row} 旧值读取失败或形状异常，回退逐字段写入`)
  range = null // writeRowValuesWithUndo 的 range === null 分支会用
} // getCellValue 逐格重取旧值，天然带兜底
```

> 判据用 `oldArray.length < colCount` 而非 `=== 0`：能同时抓住「完全读不到」和「读了一半」两种情况。
> 且 update diff 的行必然带 Bangumi URL（匹配依据），不可能整行为空，所以空旧值一律按读失败处理是安全的。

---

## 三、本次审计发现并修复的 6 处缺陷

| #   | 位置                                       | 问题                                                        | 后果                                  |
| --- | ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------- |
| 1   | `github-sync.ts` `batchUpdateRows`         | 读旧值失败用空值合并                                        | 用户标签/别名被远程值整体替换         |
| 2   | `github-sync.ts` `batchUpdateRows`         | 单行 `Value2` 一维当二维                                    | 旧值退化首字符、undo 记错、合并写乱值 |
| 3   | `github-sync.ts` `writeRowValuesWithUndo`  | 未变化列铺 `null` 整行写                                    | 清空 `writeCols` 区间中段的用户列     |
| 4   | `github-sync.ts` `batchWriteNewRows`       | 新增行同样铺 `null`                                         | 锚定列偏短时清掉目标行用户数据        |
| 5   | `tools/util/sheet.ts` `ensureSheetHeaders` | 守卫是「未识别到表头」非「表为空」                          | 用户第 1 行数据被 39 个标准表头覆盖   |
| 6   | `ui/handlers/incremental-bindings.ts`      | `initSkipConflictsFromRibbon` 被 `#chkIncremental` 早退挡住 | 主面板冲突策略下拉改动**不落配置**    |

### 缺陷 6 详解（唯一的行为 bug，其余 5 个是数据安全）

主面板 `ui/panel.html` 有 `#conflictStrategy`（select），**没有** `#chkIncremental`（它只存在于 2026-10-17 删除的孤儿文件 `panel-preview.html`）。而原代码：

```ts
export function initIncrementalSyncFromRibbon(): void {
  if (!isPanelContext()) return
  const chkIncremental = document.getElementById('chkIncremental')
  if (!chkIncremental) return          // ← 主面板在这里就返回了
  ...
  initSkipConflictsFromRibbon()        // ← 永远执行不到
}
```

→ `#conflictStrategy` 的 `change` 监听从未注册 → 用户改了下拉，`setSkipConflicts()` 不调用 → `bgm_skip_conflicts` 不更新 → Ribbon 侧与 `saveAllConfig` 看到的都是旧值。

**修法**：把 `initSkipConflictsFromRibbon()` 提到早退之前。两个功能本就独立，不该被彼此的 DOM 存在性绑架。

> ⚠️ 原测试 `tests/incremental-bindings.test.ts` 有一条用例**把这两个 bug 锁成了预期行为**（"复选框不存在 → 不注册监听也不初始化冲突策略"）。这是「测试锁旧行为」，已改为断言正确行为。

---

## 四、本次顺带修掉的小问题

| 位置                                     | 问题                                                                                                                                                         | 修法                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `github-sync.ts` `syncFromGithub`        | `date` 不在 `REQUIRED_FIELDS`，用户表无「开播日期」列时该字段不下载，而 `filterByTime` 完全依赖 `entry.date` → 全部条目被判无日期过滤，**同步 0 条且无提示** | 启用时间筛选时显式 `neededFields.add('date')`             |
| `ui/handlers/token.ts` `showUserProfile` | 三处 `addEventListener('error', 闭包)`，而该函数被 2 秒轮询反复调用 → **监听器无限累积**                                                                     | 提为模块级命名函数 + `bindAvatarError()` 先 remove 再 add |
| `sync-record.ts` `clearSyncRecords`      | `sheet.UsedRange` 被求值 3 次，每次含 `Row`+`Rows`+`Count` ≈ 8 次 IPC                                                                                        | 提为局部常量 `const usedRange = sheet.UsedRange`          |
| `tools/util/sheet.ts` 两处读函数         | `(range as unknown as { Value2?: unknown }).Value2` 双重强转，丢掉 `WpsRange` 已声明的类型                                                                   | 改 `const raw: unknown = range.Value2`                    |
| `exceltobangumi/index.ts`                | `nameCol === urlCol ? rowNumber : rowNumber` 恒等三元                                                                                                        | 直接 `getCellValue(ws, rowNumber, nameCol)`               |
| `enrich-engine.ts`                       | `key === '简介' ? '简介' : key` 恒等三元                                                                                                                     | 模板里直接用 `key`                                        |

---

## 五、COM 往返浪费：优化清单（按收益排序）

> **进度（2026-10-15 批次）**
>
> 5.1 已完成：enrichAlias 别名列外提、findHeaderRow、getColumnMap、
> locked-sheet buildCandidate、clean-engine scanXinFanHeaderRow、
> preview getRowData、ribbon detectConflicts、sync-result-dialog 日期统计。
> 仍未做：enrichIntoRow 整行批量读写、github-sync 删除 undo 快照、
> ui/handlers/sync.ts 收藏填充（改批量写需先读旧值做基底，且会丢掉
> setCellValue 的 Formula/Value 回退，收益风险比不划算，暂搁置）。
>
> 5.2 已完成：四个 `fetchXxxText` → `createRawTextFetcher`（含 abort 监听器泄漏修复）。
> 其余 10 项未做。
>
> 5.3 已完成：别名匹配 O(n²) → 反向索引。
>
> **进度（2026-10-18 批次）**：新增 §5.5 —— 清理页「执行前预览」重构：
> diff 视图模块（diff2html 范式 / 零依赖）、预览数据零额外 COM 采集、
> 三处卡顿源修复（PluginStorage 缓存 / 数据块共用 / 异步扫描）、
> 统计条六套手写变体收敛、横屏排版。
>
> **统一改法**：全部走「矩形读 + 逐格读回退」——只有读回的行数（单行时还要求宽度）
> 与请求一致才信任批量结果，否则回退原逐格路径。这样即便宿主/桩不支持区域读，
> 行为也与改造前**逐字一致**，优化只会在真实宿主上生效。

审计发现大量「循环内逐格读写」，门禁 `check:com-in-loop` **查不到**——它只查循环**条件**里的 COM 属性，不查循环**体**内的逐格读写。建议后续按此清单治理，每项都可独立提交。

### 5.1 高收益（单点改造，收益千次级 IPC）

| 位置                                                                                   | 现状                                                           | 改法                                                                                                                                                                                                                                           | 预估收益                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| ~~`enrich-engine.ts:1850` `enrichAlias`~~ **已修（2026-10-17 标注）**                  | 每条匹配都重算 `findAliasColumn`（内部 50 次 `getCellValue`）  | 循环外算一次，经 `enrichIntoRow` 传入                                                                                                                                                                                                          | 10 万次 → 1 次              |
| `enrich-engine.ts:1100-1205` `enrichIntoRow`                                           | 逐字段读+写，每条约 20 次 IPC                                  | ⚠️ **只做了源表那一半**：`readNewAnimeRow` 7 次 / `readIntroSheetRow` 18 次逐格读 → 循环外一次 `readRowsCache`。目标表（bangumiSheet）**不缓存**——`enrichIntroData` 写特点列后 `enrichOpEdPv` 会再读同一格，只读缓存会拿到写前旧值导致合并出错 | 源表 2 万次 → 1 次          |
| ~~`github-sync.ts:1506-1509` delete 阶段~~ **已修**                                    | 逐格读整行记 undo（30+ 列）                                    | ✅ 删除循环前用 `readRowsCache` 一次矩形读全部待删行（倒序删除前任何行都还在原始行号上）                                                                                                                                                       | 6 万次 → 2000 次            |
| ~~`export-jsonl.ts:163-239`~~ **已修（2026-10-17 标注）**                              | 逐格读 + **映射表在循环体内重建**                              | 循环外一次矩形读；映射表改为从 `github-sync-diff.js` 导入并提模块顶层                                                                                                                                                                          | 5 万次 → 2 次，消 20 行重复 |
| ~~`exceltobangumi/index.ts:1036-1114` `syncSelectedRows`~~ **已修（2026-10-17 标注）** | 逐格读，没用本文件已有的 `createFieldGetter`                   | 对 rows 的 min..max 区间调一次 `createFieldGetter`                                                                                                                                                                                             | 1.4 万次 → 2 次             |
| ~~`panel-lifecycle.ts:325-355` `detectHeaderAndColumns`~~ **已修（2026-10-17 标注）**  | 10 行 × 60 列逐格扫 ≈ 2000 次/次 `refreshData`                 | 一次 `readRangeValues` 读 1–10 行进内存                                                                                                                                                                                                        | 2000 次 → 约 13 次          |
| ~~`tools/util/sheet.ts:223` `isRowHeaderMatch`~~ **已修（2026-10-17 标注）**           | 10 行 × 60 列逐格扫（`findHeaderRow` 被每张表调用）            | 循环外一次矩形读                                                                                                                                                                                                                               | 600 次 → 1 次/表            |
| ~~`tools/util/sheet.ts:271` `getColumnMap`~~ **已修（2026-10-17 标注）**               | 两个循环各 50 次逐格读                                         | 一次 `readRangeValues(ws, hr, hr, 1, 50)`                                                                                                                                                                                                      | 100 次 → 1 次               |
| ~~`locked-sheet.ts:306-330`~~ **已修（2026-10-17 标注）**                              | 每张表 660 次，多工作簿再乘表数                                | 一次矩形读 10×60                                                                                                                                                                                                                               | 660 次 → 11 次/表           |
| ~~`ribbon-service.ts:443` `detectConflicts`~~ **已修（2026-10-17 标注）**              | 每行 2-3 次逐格读，1000 行 ≈ 3000 次                           | 照抄同文件 `getSyncPreview:215` 的批量范式                                                                                                                                                                                                     | 3000 次 → 1 次              |
| ~~`ui/preview.ts:120-130` `getRowData`~~ **已修（2026-10-17 标注）**                   | 每行约 17 次 IPC，500 行 ≈ 8500 次（「预览同步」卡数秒的主因） | 循环外对列包围盒一次矩形读                                                                                                                                                                                                                     | N×17 → 1 次                 |
| ~~`ui/handlers/sync.ts:199-205` `_fillSheetWithCollections`~~ **主动搁置**             | 每条收藏逐格写 ~8 列                                           | ❌ 不改：批量写要先读旧值做基底（否则 `null`/空串会清掉区间中段的列），且会丢掉 `setCellValue` 的 `Formula`/`Value` 回退链。收益/风险比不划算                                                                                                  | —                           |
| ~~`sync-result-dialog.ts:128-149`~~ **已修（2026-10-17 标注）**                        | 每次同步完成弹窗全表走一遍，5000 行 ≈ 2 万次                   | 循环外一次读两列矩形                                                                                                                                                                                                                           | 2N → 1 次                   |
| ~~`clean-engine.ts:197-220` `scanXinFanHeaderRow`~~ **已修（2026-10-17 标注）**        | 30 行 × 50 列逐格扫，且被每张表放大                            | 逐行 `readRangeValues`                                                                                                                                                                                                                         | ~2100 次 → ~30 次/表        |

### 5.2 重复代码收敛（中等收益，消 500+ 行）

| 位置                                                                                                                | 重复内容                                                                                                                                                                                                                     | 建议                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~`dialog.ts:517-823` vs `sync-result-dialog.ts:214-529`~~ **已收敛**                                               | 两份 ~300 行的同步统计仪表盘渲染（donut SVG、柱状图、性能盘、元信息栏），连配色阈值与 SVG 参数都一样                                                                                                                         | ✅ 抽 `ts/ui/sync-stats-chart.ts`：`renderSyncStatsChart(stats: SyncProgressStats)` + `toSyncStatsChartModel()`（结果弹窗把 `GithubSyncResult` + 耗时/速度/策略收口成模型）。两处各删 330+ / 350 行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ~~`components/progress.ts` / `github-time-format.ts` / `sync-result-dialog.ts`~~ **已收敛**                         | **三份 `formatDuration` 实现已漂移**：999ms 是四舍五入（`1.00秒`）还是截断（`0.99秒`）、整分补不补 `00秒`，三份都不一样                                                                                                      | ✅ 下沉到 **`tools/util/duration.ts`**（全项目唯一一份）。**必须放 `tools/` 而不是 `ui/`** —— `sync/` 层有「不得反向依赖 `ui/`」的分层约束，而 `sync/github-time-format.ts` 也要用它。三处均改为 `export { formatDuration } from …` 转出（本地仍 import 供内部使用，如 `formatEta` 与进度条 ETA 渲染）。统一取 **progress 版截断语义**：`999ms → 0.99秒`、`60000ms → 1分`；两个测试文件的 5 条断言随之更新（**属改验收口径**，已在提交信息中逐条说明）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ~~`github-sync.ts:143-246` / `gitee-sync.ts:75-160` / `gitlab-sync.ts:75-160` / `gist-sync.ts:235-323`~~ **已收敛** | 四个 `fetchXxxText` 几乎逐字重复（各 ~85 行），且 **abort 监听器处理已分歧**：github 版有 `removeEventListener`，其余只 add 不 remove → 换配置就泄漏监听器                                                                   | ✅ 已提 `createRawTextFetcher({ buildUrl, logTag })` 工厂（净减 88 行），四个源均已改造                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ~~`github-sync.ts:1922-1969` vs `sync-source-registry.ts:299-350`~~ **已收敛**                                      | `getSelectedRowSids` 两份逐字重复（连日志文案都一样）                                                                                                                                                                        | ✅ 抽 `sync/selected-rows.ts`（零副作用叶子模块），两处 import                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ~~`sync-source-registry.ts` vs `github-sync.ts`~~ **已收敛（路线①，2026-10-17）**                                   | `syncFromRemote`（~190 行）与 `syncFromGithub`（~190 行）主体逐字重复 ~150 行；2026-10-15 逐行比对确认差异仅 5 处（source 获取 / 校验失败文案 / 日志 tag / 耗时格式 `${ms}` vs `formatDuration` / 时间筛选标签函数是否内联） | ✅ 抽 `ts/sync/remote-sync-apply.ts`（apply 阶段整体逐字迁入，1537 行）+ `ts/sync/remote-sync-core.ts`（`runRemoteSync` 统一编排，5 处差异全部参数化）；两入口变薄壳（`github-sync.ts` 1893→215、`sync-source-registry.ts` 314→118），apply 与 `GithubSyncResult` 经 `github-sync.ts` 兼容 re-export 保留（对外 API 不变）。**拍板路线①而非原建议②**：② 的「调用方注入 apply」会把夹在下载与 apply 之间的空文档表头填充 / 选中行 / 时间筛选 / 屏幕刷新收尾劈回调用方；① 的改动面风险由「apply 与编排必须分两个模块」化解 —— `vi.mock` 截不住模块内调用，这是 registry 测试 mock 接缝保活的硬约束，也因此**零测试断言变更**（仅 `sync-source-registry.test.ts` 的 mock 接缝随模块边界迁移：github-sync.js mock 收缩为源类 + 新增 `remote-sync-apply.js` 全量工厂 + github-sync-diff 部分 mock 补 `computeDiff`）。最终依赖单向无环：`remote-sync-apply.ts` ← `remote-sync-core.ts` ← {`github-sync.ts` / `sync-source-registry.ts`} 薄壳；耗时口径取 registry 版裸毫秒（apply 阶段内部 `formatDuration` 文案不变） |
| ~~4 个 `*-bootstrap.ts`~~ **已收敛（顺带修漂移）**                                                                  | 「禁用→`modulesReady`启用」整块复制                                                                                                                                                                                          | ✅ 抽 `ts/panel/action-buttons-gate.ts` 的 `installActionButtonsGate(logTag)`。漂移点：只有 settings 版带 5 秒超时兜底，其余三页一旦 `bgm:modulesReady` 没来（脚本 404 / 语法错误）就**永久禁用全部按钮且无提示**；统一后四页都有兜底                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ~~`github-settings.ts` vs `action-handlers.ts`~~ **已收敛**                                                         | 「读 8 个输入框 → 按 sourceType 取 path/gistId → 必填校验 → setGithubConfig/setSyncStrategy/setSyncSourceType」两份实现（~80 行）                                                                                            | ✅ 抽 `readGithubConfigForm()` + `findMissingConfigField()`（返回具体缺哪一项，而非 boolean：手动保存要三种不同文案，防抖自动保存只关心跳过与否）。**两侧语义差异原样保留**：手动保存缺元素报「UI 元素缺失」、缺值按类型报对应文案；自动保存一律静默跳过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ~~`github-sync.ts` 三处逐字段回退~~ **已收敛**                                                                      | 三处调用点各有一份逐字重复的 ~35 行样板（`writeRowValuesWithUndo` 读旧值失败 / `batchUpdateRows` 整行写异常 / `applyDiffToSheet` 新增回退）                                                                                  | ✅ 提 `fallbackWriteRemoteEntry(parameters)`：业务差异（add/update、成功与失败文案、失败明细带不带行号）全部参数化；**日志刻意留在调用方**——三处文案与触发条件不同，且测试按文案断言（`回退逐字段写入全部失败` / `逐字段写入也失败` / `逐行写入失败`）。三处样板 208 行 → 88 行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ~~`github-sync.ts:854-885` / `964-1016`~~ **已收敛**                                                                | `batchWriteNewRows`/`batchUpdateRows` 的 writeCols 收集逻辑重复 ~30 行                                                                                                                                                       | ✅ 提 `collectWriteCols(colMap, names)`（`WriteCol` 接口同时提到模块级），调用方只负责攒列名                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ~~`sheet.ts:115` vs `:160`~~ **已收敛**                                                                             | `readRangeValues`/`readRangeCellValues` ~90% 相同                                                                                                                                                                            | ✅ 提 `readRect<T>(ws,r1,r2,c1,c2,convert)`：两个导出函数只剩一行委托，形状守卫只有一份                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ~~`ribbon-service.ts` vs `tools/util/index.ts` 的剪贴板部分~~ **已收敛**                                            | `copyTokenForRibbon`/`copyTokenToClipboard` 各写一份逐字相同的「建 textarea → select → execCommand → 移除」                                                                                                                  | ✅ 抽 `copyTextWithResult(text): ClipboardCopyResult`（判别联合 `ok / unsupported / error`，保留 Ribbon 弹窗「不支持」与「带原因」两种文案）；`copyTokenToClipboard` 变一行委托                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ~~`ribbon-service.ts` vs `tools/util/index.ts` 的取用户资料~~ **已收敛**                                            | `testTokenForRibbon` 与 `_fetchBgmUserInfo` 是两份独立的 XHR 取用户资料（~80 / ~120 行），前者 async + 弹窗、后者回调式                                                                                                      | ✅ 抽 `fetchBgmMe(signal): Promise<BgmMeResult>`（**纯请求 + 解析，无副作用**），返回**带 HTTP 状态码的判别联合** `ok / http(status) / network / timeout / parse / aborted / no-token`。判别联合**刻意不压平** —— `testTokenForRibbon` 要按 401 与其它状态码给不同文案、且超时与网络错误文案不同， 而 `_fetchBgmUserInfo` 只需粗分类（timeout 并入 network）。副作用按需留在各自调用方：前者落库 userId/username + 通知 Token 更新，后者落库 + 头像缓存 + PluginStorage 持久化。 `ribbon-service.ts` 的独立 XHR 实现已删净（该文件内 0 处 `new XMLHttpRequest()`）。注意 `_fetchBgmUserInfo` 的回调因此变成**微任务**，其 11 条 XHR 用例已补 flush                                                                                                                                                                                                                                                                                                                                                                |
| `sync-record.ts` 两处表头写入                                                                                       | 新建表时**逐格**写表头（12 次 COM）、迁移时矩形一次写并顺带设底色 —— 同一件事两种写法                                                                                                                                        | ✅ 抽 `writeSyncRecordHeader(sheet, { gray? })`：两处共用一次 `Range.Value2 = [SYNC_RECORD_COLUMNS]` 矩形写，新建表路径顺带从 12 次 IPC 降到 1 次。 ⚠️ 已有表路径（`getOrCreateSyncRecordSheet` 的 else 分支）**不走本函数** —— 那里是「逐格读回比对 + 只修复不一致的列」并记修复日志，语义不同                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ~~`preview.ts` / `sync.ts`~~ **主动搁置**                                                                           | `{onPause,onResume,onStop}` handlers 对象重复（实测 5 处逐字相同 + `preview.ts` 1 处空实现变体）                                                                                                                             | ❌ 不改：① 各文件对 util barrel 的 mock 口径不一（`preview.test.ts` 压根没 mock `tools/util/index.js`，新增该路径 import 会把真实重模块拉进测试）；② 多个测试用 `{sync:{pause,resume,requestStop}}` 这类精简桩，把工厂挂到 `BGM.sync` 上会让桩缺方法直接 TypeError。收益仅 ~35 行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 5.3 CPU 热点（非 IPC）

| 位置                                    | 问题                                                                    | 改法                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ~~`enrich-engine.ts:614-618`~~ **已修** | 别名匹配 O(n²)：1000 个未匹配行 × 5000 个别名索引 = 500 万次 `includes` | ✅ 构建 `aliasIndex` 时顺带产反向索引 `aliasByRow: Map<row, alias[]>`，此处 O(1) 查表 |

---

### 5.4 第六轮审查新增发现（2026-10-15，只读扫描，**未改动任何代码**）

> **✅ 2026-10-16 已全部修复并提交。** 下表为当时的发现记录，保留作为追溯。
> 修复提交：`26e7e391`（5 处确定 bug）、`efd1336f`（abort 泄漏 + enrich-engine 矩形读）、
> `58a9c17a`（formatTimeFilterLabel / sleep / 表头写入 / locked-sheet 四处小重复）、
> `0fada38c`（SyncSource 基类 + value-merge + barrel 局部合一）。
> 三处**结论与清单建议不同**的取舍（均有理由，详见各提交信息）：
> ① `verifyToken` **未**委托 `fetchBgmMe` —— 后者内部读「已存 token」，而前者要验证「调用方显式传入的 token」（可能是未保存的测试 Token），委托会改变签名语义；
> ② `tools/utility.js` 与 `tools/util/index.js` 的双轨 **只做局部合一**（删死守卫 + sync-result-dialog 同文件两 specifier 合一）—— 全局统一要改 19 个测试文件的 mock 路径，超过阈值；
> ③ 布局探测**未加跨调用缓存** —— 布局在 SheetActivate/编辑后会变，无失效机制的 memo 有写错数据风险。

四个并行审查（本轮 4 个提交的回归核对 / `ts/sync`+`ts/services` / `ts/ui`+`ts/panel`+`ts/tools` / 对照本清单比对）。

**本轮 4 个代码提交复盘：无回归。** `fallbackWriteRemoteEntry` 三处参数化忠实（处 1 带 `(回退逐字段写入)` 后缀与 `failRow`、处 3 无后缀无 row）；`formatDuration` 测试只改「999ms 四舍五入→截断」「整分补 00秒→不补」两类断言；`writeSyncRecordHeader` 的矩形写有桩支撑；`fetchBgmMe` 五种弹窗文案与旧实现逐字一致、`timeout→network` 映射保留、外层兜底契约保留。仅三处日志级痕迹：parse 失败日志丢了 error 详情（`ribbon-service.ts`）、起始日志去掉 API URL、已 aborted 的回调从同步变微任务（提交信息已声明）。

**确定是 bug（建议优先修）**

| #   | 位置                                                     | 问题                                                                                                                                                                                                 |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `sync-record.ts:919-927`                                 | 单行读**未做形状归一化**：一维时 `existing` 只剩首列，`buildUpdatedSyncRow` 以 `''` 补齐其余 11 列后整行写回 → **清空该行用户同步记录**（与 §8 已列的 `813-821` 同病，但这条批量路径当时未纳管）     |
| 2   | `sync/progress-reporter.ts:41-47`                        | `TYPE_NAMES` 把 2/3 标成「在看/看过」，与 `core/constants.ts` 的 `WATCH_STATUS_MAP`/`COLLECTION_TYPE_NAMES`（2=看过，3=在看）**相反** → 同步记录「条目类型」列标签写反                               |
| 3   | `sync/exceltobangumi/index.ts:1107-1122` vs `541-567`    | 章节标记条件两路径不一致：批量只标 `type=2`，选中行标 `2                                                                                                                                             | 3`  |
| 4   | `panel/clean-page.ts:302` vs `panel/clean-engine.ts:175` | `isWorkbookAllowed` 两份且行为分歧：clean-page 版只判 exclude，引擎版额外套 `includeWorkbookPath` 白名单 → 配了白名单时 **UI 候选与引擎实际清理范围不一致**                                          |
| 5   | `sync/scraping.ts:99-103`                                | abort 监听器只 add 不 remove（`sync/jsonl-response.ts` 已修同类泄漏）                                                                                                                                |
| 6   | `ui/panel-preview.html:644-661`                          | `.check-row` 被 `panel-theme.css:572` 的 `.form-group > label{display:block}`（0,1,1）压过同为 0,1,1 的 `.check-row{display:flex}` → flex/gap/居中失效；CSS 应写成 `.form-group .check-row` 提特异性 |
| 7   | `ui/panel.html:619-633`                                  | `.time-filter-row` 是 flex 行，唯一子元素 `p.hint` 收缩到内容宽，边框/背景不铺满（time-filter 修复只覆盖了 label/box）→ `.time-filter-row > .hint { flex: 1 }`                                       |

**重复与浪费（新增，未列入上方表格）**

| #   | 位置                                             | 问题                                                                                                                                                                                  |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `SyncSource` 四个实现类                          | `github-sync.ts:202-239`、`gitee-sync.ts:118-155`、`gitlab-sync.ts:118-155`、`gist-sync.ts:352-388` 逐字重复（`fetchXxxText` 已收敛，类没有）→ 抽基类/工厂                            |
| 9   | 标签合并三份                                     | `enrich-normalize.ts:62` `mergeTags`、`sheet-cleaning.ts:141` `mergeTagValues`、`github-time-format.ts:50` `appendValueWithSeparator`                                                 |
| 10  | `sync/scraping.ts:155-200`                       | `verifyToken` 是 `GET /v0/me` 的**第三份**实现（已有 `fetchBgmMe`）→ 应委托                                                                                                           |
| 11  | `sync/enrich-record.ts:131-138`                  | 新建表逐格写表头（`writeSyncRecordHeader` 已收敛矩形写）；`344-345` 又逐格重写；`277-279` `UsedRange` 求值 3 次（`clearSyncRecords` 已修同类）                                        |
| 12  | `sync-source-registry.ts:165-173`                | `formatTimeFilterLabel` 与 `github-time-format.ts:80-88` 逐字重复 → import。**注意它已改在 duration 收敛清单之外**                                                                    |
| 13  | `tools/../../sync/workbook-auto-detect.ts:73-87` | 复制 `locked-sheet.ts` 的 `isRowPopulated`/`countDataRowsAfter`（应为 `sync/workbook-auto-detect.ts`）                                                                                |
| 14  | `tools/http.ts:47` vs `tools/util/sleep.ts:15`   | 私有 sleep（Promise 版）与工具版（void 版）并存                                                                                                                                       |
| 15  | `tools/utility.js` vs `tools/util/index.js`      | 同一 barrel 两条 specifier：19 个测试 mock 前者、35 个 mock 后者；`ui/handlers/sync.ts:52` 因怕 undefined 挂了 `typeof ensureSheetHeaders !== 'function'` 死守卫 → 统一入口并删死守卫 |
| 16  | `enrich-engine.ts:395-430`                       | 每表 ~500 次逐格读且每次 `SheetActivate` 全簿重跑 → 矩形读 + 结果缓存                                                                                                                 |

**分层与测试卫生（低）**

- ui/panel 直连 sync 非 barrel 函数 5 处（`cleanSheetDuplicates`、`shouldFilterNoise`、`isBangumiSheetEmpty`、`readLocalFileContent`、`resetNoiseKeywordCache`）—— `check:cycles` 只查底层→上层，管不到上层→底层，建议补 barrel 导出或列豁免清单。
- 无 `...actual` 的整体 barrel mock 3 处（`tests/auto-fill-url.test.ts:6`、`tests/action-handlers.test.ts:129`、`tests/token.test.ts:42`）—— 目前工厂与导入逐字对齐，但新增导入即静默 undefined，建议加 CI 断言比对。
- `ribbon-service.ts` 的 `getField`（236-248）与 `exceltobangumi/index.ts` 的 `createFieldGetter`（162-175）同构；指纹数组三处逐字重复。
- `panel/panel-page.ts:40` 的 4 行 Escape 处理 vs `ui/components/modal-a11y.ts:52` 的完整 focus trap —— 详情模态疑似未复用 a11y 组件。
- `toggleSheetLock` 两套实现：`panel/enrich-page.ts:970`（委托锁引擎）vs `panel/panel-lifecycle.ts:74`（自管 `BGM.sheet`）。

---

### 5.5 清理页「执行前预览」重构（2026-10-18：diff 视图 + 横屏 + 性能）

> 用户诉求原话：执行前预览要能「看到将删哪些行、在哪里、做什么操作，有 diff 数据表示」；
> 「所有可对比的都要有 diff 页面可看」；「统一所有 UI 风格，统计页面统一为外部导航栏风格」；
> 「支持横屏排版」；「找到能减少卡顿的地方」。

#### 5.5.1 diff 视图模块（`ts/ui/diff-view.ts` + `css/diff.css`，四页共用）

参考 diff2html 的交互范式，**零依赖**（任务窗格 CSP 禁外链 + 包体敏感，不引本体）：

- 行类型四态：`keep`（重复组保留行，标记 `=`）/ `delete`（待删行或旧值，`-`，红）/ `insert`（新值，`+`，绿）/ `context`（分组说明行，跨列单格）；
- **行内高亮**：`splitInlineDiff(old, next)` 按公共前后缀裁剪出四段，差异中段包 `<span class="diff-del|diff-ins">`。纯函数、零依赖，不追求最小编辑脚本（LCS）—— 单元格值通常是小改动（去空格 / 改分隔符 / 补别名），前后缀裁剪已足够直观；
- **分页**：默认每页 50 行，「显示更多」按批 `insertAdjacentHTML` 追加 —— 千行级预览一次性 innerHTML 会把任务窗格卡死；
- **安全双路径**（本项目铁律）：所有用户数据先 `escapeHtml` 再整体 `sanitizeHtml`；**批量行追加必须走 `sanitizeTableRows`** —— DOMPurify 主路径用 DOMParser 按完整文档上下文解析，顶层裸 `<tr>` 会被剥成文本（`sanitizeTableRows` 的 JSDoc 已记此坑）；
- ⚠️ **`colspan` 不在 `sanitize.ts` 的 ALLOWED_ATTR 白名单里**：diff 视图的 context 行是运行时拼装表格首次使用跨列，严格白名单会静默剥掉 `colspan` → 跨列失效（**真机 bug，由真实 DOMPurify 路径的单测抓到**）。已补白名单 + 回归断言。教训：**运行时拼装表格用到任何新属性前，先查白名单**。

#### 5.5.2 预览数据采集：零额外 COM

引擎原产出只有 `deleteRows: number[]`（行号）与 `changes`（含新旧值），页面无法回答「删的到底是哪条数据」。本轮把预览数据**顺带采集**（数据本就已读入内存，零额外 COM 读取）：

- `RowPlan.rowPreviews: DeletedRowPreview[]`（行号 + 名称 + URL）与 `groupPreviews: DuplicateGroupPreview[]`（保留行 vs 待删行，重复类规则产出）—— 后者让用户能逐组核对「引擎留对了行吗」；
- `RowChange.oldValue`：行级变更（标签合并）的旧值取自已在内存的 tags 列 —— 没有它，diff 只能显示 `- （空）→ + 新标签`，用户看不到改了什么；
- `planDuplicateUrlRows` 为取受害行名称**新增 1 次名称列矩形读**（同 URL 组内各行名称不同，没有名称用户无法核对）；
- `planEmptyNameRows` 的逐列读改**单次矩形读**（原列数 = COM 往返次数，30 列就是 30 次；语义不变——仍只检查 colMap 已识别列）。

#### 5.5.3 性能：三处卡顿源

| # | 卡顿源                                                                                       | 修法                                                                                                                                                                        | 收益                            |
 | - | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1 | `clean-page.ts` 勾选状态每次渲染 / 勾选 / 扫描都按候选表数量反复过 `PluginStorage.getItem`（跨 WebView 桥：IPC + JSON.parse）；50 张表时**一次勾选 = 上百次 IPC** | write-through 内存缓存（`sheetSelectionCache` + `sheetSelectionPersisted`）：读命中内存，写同时落缓存与持久化。一致性依据：勾选状态只由本页写入，无跨写者 | 一次勾选 ~N 次 IPC → 1 次       |
| 2 | `scanTarget` 原先 `collectExcludedRows` 1 次全量读 + `estimateRowBytes` 至多 30 次逐行采样读 + `planNoiseRules` 又 1 次全量读 | 数据区整块**只读一次**，排除行判定 / 行字节估算 / 噪声行扫描三者共用（`block` 可选参数；未提供时各函数按原行为自读，导出函数仍可独立使用） | 每目标至多 32 次 COM → 1 次 |
| 3 | `scanCleanRules` 全同步：大表扫描期间任务窗格**完全冻结**（按钮无反馈、无法滚动）           | 改异步，**逐目标之间让出宏任务**（`setTimeout(0)`）。⚠️ 必须是宏任务 —— 微任务（`await Promise.resolve()`）不足以让浏览器重绘，与首屏 COM 扫描同一原则；页面侧 `handleScan` 改 async + 扫描防重入（`isScanning`，防双击交错写 `scanResult`） | 扫描期间 UI 保持响应            |

**评估后不做**（风险 > 收益，记录备查）：多规则重复解析表结构（`planDuplicateRows` 等各自调 `readSheetLayout`）。共享 `buildTarget` 已解析的 layout 对新番表会**改变语义**——新番表无「名称」表头，`readSheetLayout` 的标准路径必然失败并返回空计划，而 `buildTarget` 走专属签名路径构造了推导 colMap；传入会让新番表突然能跑重复行规则。要做得先给 `CleanTargetInfo` 记 `isXinFan` 再分流，收益仅 (规则数−1)×3 次 COM/目标。

#### 5.5.4 UI 风格统一：统计条收敛六套手写变体

用户要求「所有页面统一风格、统计区统一为外部导航栏风格」。改前是**六套并存**：统一组件 `stat-cards.ts`（三页在用）+ `preview.ts` 手写卡（还带硬编码 hex `#f59e0b`/`#22c55e`，违反令牌化铁律）+ enrich 三处静态卡（`match-stat-*` / `enrich-stat-*` / `record-stat-*`）+ 两处死 CSS（`clean-stat-*` / `bgm-stat-card*`）。

收敛结果：**一套 `.stat-grid` / `.stat-card` 标记 + 导航栏视觉语言**（横排胶囊、`r-md` 圆角、1px 描边悬停加深、语义色只作用于数值，flex-wrap 自然折行无需窄档媒体查询）。静态统计块只换类名、**保留 JS 依赖的 `id`**（`textContent` 更新逻辑零改动）；死 CSS 全删。同步结果弹窗的统计**未**强改——它早已共用 `sync-stats-chart.ts` 仪表盘组件（环形图 / 图标卡是另一种信息密度场景，且已令牌化），强行套胶囊条会破坏仪表盘。

#### 5.5.5 横屏排版

任务窗格停靠成横排（宽而矮，典型如顶部停靠）时，单列主区留大片空白、上下滚动距离翻倍。改法：`panel-theme.css` 新增 960px / 1440px 两档，非 panel 页（panel 早已 `.main.main-grid`）主区切 2/3 列栅格；`.section-wide` 标记天然全宽区块（clean / enrich 的 `#sec-preview`，跨全部列）。

⚠️ **不用 `repeat(auto-fit, minmax(280px, 400px))`**（panel 的口径）：Chrome 探针实测 1500px 窗格下它给 2×400px，**右侧空出约 1/4 宽度**——正是要消除的问题。改用确定性列数 + `1fr` 铺满（超宽也不碎片化）。验证用一次性宽视口探针（量计算样式 + 截图），`audit:layout` 窄档 5 页面 × 2 档复测无异常。

---

## 六、测试桩忠实性原则（本次最重要的方法论收获）

### 原则

> **桩不忠实就修桩，不要为迁就桩弱化生产代码的守卫。**

本次修数据安全时打翻了 5 个既有测试，逐一核实后确认**全部是桩不忠实**，没有一个是「修复有错」：

| 桩问题         | 具体                                                                                   | 后果                                                                  |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 返回值形状错误 | `asThrowingRowRangeMock` 的 getter 返回 `[['']]`（1 列），而区间是 2 列                | 被完整性守卫判为「读不全」而走回退，测不到「整行写入抛错 → 回退」路径 |
| 返回值类型错误 | `mockSetCellValue.mockImplementation(() => {})` 返回 `undefined`，真实签名是 `boolean` | 逐字段回退路径检查该返回值 → 判定失败                                 |
| 读回形状不真实 | `createMockWorksheet` 的 Range 对区域一律返回 `Value2: null`                           | 从不模拟一维/二维真实形状                                             |
| 测试锁旧行为   | `incremental-bindings.test.ts` 断言「复选框不存在 → 不初始化冲突策略」                 | 把 bug 固化成预期                                                     |

### 操作守则

1. **桩要模拟真实宿主的返回形状**，尤其是 `Value2` 的一维/二维/标量三种情况。
2. **mock 的返回值类型要与真实签名一致**（`setCellValue` 返回 `boolean` 就不能返回 `undefined`）。
3. **发现测试锁定了错误行为时，改测试而不是迁就它**——但要在提交信息里写清楚为什么改。
4. 修完生产代码后跑测试，**逐个看失败原因**，不要一键 `--update` 或直接删用例。

---

## 七、工具链约定：PowerShell 7

本项目在 Windows 上开发，**一律用 PowerShell 7**（`pwsh`），不用 Windows 自带的 PowerShell 5.1。

### 为什么

Windows PowerShell 5.1 的控制台默认编码是 **GBK**（`[Console]::OutputEncoding`），导致：

- `git log` / `node` 输出的中文变成乱码
- `Out-File -Encoding utf8` 写入的文件被二次编码破坏
- 曾经因此误判过「commit message 存坏了」（实际只是显示层乱码）

PowerShell 7 默认 UTF-8，且需显式设置以保证管道一致：

```powershell
& pwsh -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; `$OutputEncoding=[System.Text.Encoding]::UTF8; <命令>"
```

### 校验 commit message 是否真被编码破坏

不要看 `git log` 的终端输出（可能只是显示层乱码）。用 node 读原始字节：

```js
// .workbuddy/check.mjs
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const out = execSync('git --no-pager log -1 --format=%B', { cwd: '<项目根目录>' })
writeFileSync('<临时文件>', out) // Buffer 原样落盘，不经 shell 编码转换
```

再用编辑器打开该临时文件确认中文是否正常。

### 其他环境注意事项

- 本环境的 Bash 工具时好时坏（`dirname`/`ls`/`grep` 可能缺失），文件操作用 Glob/Grep/Read 工具，命令执行优先 PowerShell 7。
- 跑测试/覆盖率必须用**大写盘符** cwd（`D:/…`），否则 vitest 会因盘符大小写不匹配全挂。

---

## 八、待办与风险

### 需要真机验证（未擅自改）

`ts/sync/sync-record.ts:800-810`：

```ts
const existingRows = readRangeCellValues(
  sheet,
  existingRow,
  existingRow,
  1,
  SYNC_RECORD_COLUMNS.length,
)
const existing = existingRows[0]
```

读**单行多列**后取 `[0]`。而 `readRangeCellValues` 对一维输入返回 `[[v1],[v2],…]`（多行单列），那样只会拿到第一列 → `existing[COUNT-1]` 为 undefined → `Number(undefined)` = NaN → `|| 0` → **同步记录表的 count 被重置**。

**无法在 Node 测试环境判定 `Value2` 到底返回一维还是二维**，需在真机 WPS 里跑一次同步，看同步记录表「次数」列是否正常累加。确认后按 §2.1 的形状归一化修法处理。

### 公开 API 无内部调用方（未删）

`getSequentialRowsBySeqCol`（`exceltobangumi/index.ts:226`）：全库无生产调用方，但有 2 个测试文件 ~15 条用例覆盖，且从 `ts/index.ts` barrel 导出。删除会掉覆盖又破坏公开 API，**保留**，若确认不再对外可连测试一起删。

### 已知未治理

- ~~`readLocalEntries` / `batchUpdateRows` / `batchWriteNewRows` 仍是**内联 `Range.Value2`**，未走统一的 `readRangeValues()` 入口。已按形状归一化补齐，但建议后续收敛。~~
  **2026-10-17 已治理**：三处读路径全部改走统一入口（`readRangeValues` / `readRangeCellValues`，内部 `readRect` 含形状守卫）。顺带修掉 `readLocalEntries` 的**单行一维 bug**——本地只有 1 条数据时 `Value2` 返回一维，整行退化成「第 1 个单元格的值」→ 字段全空 → 该行被跳过 → 远程同 SID 被判新增，**重复写一行**。写路径仍用 `Range.Value2` 批量写（有意的性能优化，形状由构造方保证）。
- ~~`parseJsonl` 的 `errors`（非法远程行）只进 WARN 日志、不告知用户 —— 远程有坏行时用户看不到提示。~~
  **2026-10-17 已治理**：`loadEntriesFromPath` 回报 `skippedInvalidRecords`（缺合法 sid 被跳过的条数），经 `fetchXxxJson` 的可选出参 `FetchLoadStats` → `BaseSyncSource.loadStats` → `GithubSyncResult.skippedInvalidLines` 透传到结果弹窗（与 `missingColumns` 同口径，>0 才展示）。Gist 单片源保持原行为（全非法抛错、部分非法 WARN）。
- ~~`ui/panel-preview.html` 是无任何引用的孤儿文件（`#chkIncremental` 只在它里面），确认无用可删。~~
  **2026-10-17 已删除**：死代码四步判定——① TS 无引用；② 构建入口无（`vite.config.js` 的 rollup input 只有 `index.html`，`ui/*` 拷贝是 glob 不点名）；③ HTML/XML 无交叉引用、任务面板 URL 是 `ui/panel.html`（`showBangumiPanel` 注册）；④ 无动态构造。连带删除只被它引用的 `css/preview.css`。
  连带清理：`ts/panel/user-info-polling.ts` 里同步 `#chkIncremental` 复选框的分支随该控件一起消失（panel.html 的「仅同步变更」已收拢到设置页，主面板无此控件，该分支是永久空转的死代码），对应 4 条测试用例随死分支删除。
