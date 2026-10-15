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
  const row = Array.isArray(raw[0]) ? raw[0] : raw   // 二维取首行，一维整体即一行
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
  (_, c) => oldArray[c] ?? null,      // 先铺旧值
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
  range = null        // writeRowValuesWithUndo 的 range === null 分支会用
}                     // getCellValue 逐格重取旧值，天然带兜底
```

> 判据用 `oldArray.length < colCount` 而非 `=== 0`：能同时抓住「完全读不到」和「读了一半」两种情况。
> 且 update diff 的行必然带 Bangumi URL（匹配依据），不可能整行为空，所以空旧值一律按读失败处理是安全的。

---

## 三、本次审计发现并修复的 6 处缺陷

| # | 位置 | 问题 | 后果 |
| --- | --- | --- | --- |
| 1 | `github-sync.ts` `batchUpdateRows` | 读旧值失败用空值合并 | 用户标签/别名被远程值整体替换 |
| 2 | `github-sync.ts` `batchUpdateRows` | 单行 `Value2` 一维当二维 | 旧值退化首字符、undo 记错、合并写乱值 |
| 3 | `github-sync.ts` `writeRowValuesWithUndo` | 未变化列铺 `null` 整行写 | 清空 `writeCols` 区间中段的用户列 |
| 4 | `github-sync.ts` `batchWriteNewRows` | 新增行同样铺 `null` | 锚定列偏短时清掉目标行用户数据 |
| 5 | `tools/util/sheet.ts` `ensureSheetHeaders` | 守卫是「未识别到表头」非「表为空」 | 用户第 1 行数据被 39 个标准表头覆盖 |
| 6 | `ui/handlers/incremental-bindings.ts` | `initSkipConflictsFromRibbon` 被 `#chkIncremental` 早退挡住 | 主面板冲突策略下拉改动**不落配置** |

### 缺陷 6 详解（唯一的行为 bug，其余 5 个是数据安全）

主面板 `ui/panel.html` 有 `#conflictStrategy`（select），**没有** `#chkIncremental`（那只在孤儿文件 `panel-preview.html` 里）。而原代码：

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

| 位置 | 问题 | 修法 |
| --- | --- | --- |
| `github-sync.ts` `syncFromGithub` | `date` 不在 `REQUIRED_FIELDS`，用户表无「开播日期」列时该字段不下载，而 `filterByTime` 完全依赖 `entry.date` → 全部条目被判无日期过滤，**同步 0 条且无提示** | 启用时间筛选时显式 `neededFields.add('date')` |
| `ui/handlers/token.ts` `showUserProfile` | 三处 `addEventListener('error', 闭包)`，而该函数被 2 秒轮询反复调用 → **监听器无限累积** | 提为模块级命名函数 + `bindAvatarError()` 先 remove 再 add |
| `sync-record.ts` `clearSyncRecords` | `sheet.UsedRange` 被求值 3 次，每次含 `Row`+`Rows`+`Count` ≈ 8 次 IPC | 提为局部常量 `const usedRange = sheet.UsedRange` |
| `tools/util/sheet.ts` 两处读函数 | `(range as unknown as { Value2?: unknown }).Value2` 双重强转，丢掉 `WpsRange` 已声明的类型 | 改 `const raw: unknown = range.Value2` |
| `exceltobangumi/index.ts` | `nameCol === urlCol ? rowNumber : rowNumber` 恒等三元 | 直接 `getCellValue(ws, rowNumber, nameCol)` |
| `enrich-engine.ts` | `key === '简介' ? '简介' : key` 恒等三元 | 模板里直接用 `key` |

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
> **统一改法**：全部走「矩形读 + 逐格读回退」——只有读回的行数（单行时还要求宽度）
> 与请求一致才信任批量结果，否则回退原逐格路径。这样即便宿主/桩不支持区域读，
> 行为也与改造前**逐字一致**，优化只会在真实宿主上生效。

审计发现大量「循环内逐格读写」，门禁 `check:com-in-loop` **查不到**——它只查循环**条件**里的 COM 属性，不查循环**体**内的逐格读写。建议后续按此清单治理，每项都可独立提交。

### 5.1 高收益（单点改造，收益千次级 IPC）

| 位置 | 现状 | 改法 | 预估收益 |
| --- | --- | --- | --- |
| `enrich-engine.ts:1850` `enrichAlias` | 每条匹配都重算 `findAliasColumn`（内部 50 次 `getCellValue`） | 循环外算一次，经 `enrichIntoRow` 传入 | 10 万次 → 1 次 |
| `enrich-engine.ts:1100-1205` `enrichIntoRow` | 逐字段读+写，每条约 20 次 IPC | 入口一次 `readRangeValues` 读全映射列矩形，最后一次批量写 | 2 万次 → 约 4 次 |
| `github-sync.ts:1506-1509` delete 阶段 | 逐格读整行记 undo（30+ 列） | 删除循环前一次矩形读全部待删行 | 6 万次 → 2000 次 |
| `export-jsonl.ts:163-239` | 逐格读 + **映射表在循环体内重建** | 循环外一次矩形读；映射表改为从 `github-sync-diff.js` 导入并提模块顶层 | 5 万次 → 2 次，消 20 行重复 |
| `exceltobangumi/index.ts:1036-1114` `syncSelectedRows` | 逐格读，没用本文件已有的 `createFieldGetter` | 对 rows 的 min..max 区间调一次 `createFieldGetter` | 1.4 万次 → 2 次 |
| `panel-lifecycle.ts:325-355` `detectHeaderAndColumns` | 10 行 × 60 列逐格扫 ≈ 2000 次/次 `refreshData` | 一次 `readRangeValues` 读 1–10 行进内存 | 2000 次 → 约 13 次 |
| `tools/util/sheet.ts:223` `isRowHeaderMatch` | 10 行 × 60 列逐格扫（`findHeaderRow` 被每张表调用） | 循环外一次矩形读 | 600 次 → 1 次/表 |
| `tools/util/sheet.ts:271` `getColumnMap` | 两个循环各 50 次逐格读 | 一次 `readRangeValues(ws, hr, hr, 1, 50)` | 100 次 → 1 次 |
| `locked-sheet.ts:306-330` | 每张表 660 次，多工作簿再乘表数 | 一次矩形读 10×60 | 660 次 → 11 次/表 |
| `ribbon-service.ts:443` `detectConflicts` | 每行 2-3 次逐格读，1000 行 ≈ 3000 次 | 照抄同文件 `getSyncPreview:215` 的批量范式 | 3000 次 → 1 次 |
| `ui/preview.ts:120-130` `getRowData` | 每行约 17 次 IPC，500 行 ≈ 8500 次（「预览同步」卡数秒的主因） | 循环外对列包围盒一次矩形读 | N×17 → 1 次 |
| `ui/handlers/sync.ts:199-205` `_fillSheetWithCollections` | 每条收藏逐格写 ~8 列 | 每行一次 `Range.Value2` 矩形写 | 1.6 万次 → ~行数 |
| `sync-result-dialog.ts:128-149` | 每次同步完成弹窗全表走一遍，5000 行 ≈ 2 万次 | 循环外一次读两列矩形 | 2N → 1 次 |
| `clean-engine.ts:197-220` `scanXinFanHeaderRow` | 30 行 × 50 列逐格扫，且被每张表放大 | 逐行 `readRangeValues` | ~2100 次 → ~30 次/表 |

### 5.2 重复代码收敛（中等收益，消 500+ 行）

| 位置 | 重复内容 | 建议 |
| --- | --- | --- |
| `dialog.ts:517-823` vs `sync-result-dialog.ts:214-529` | 两份 ~300 行的同步统计仪表盘渲染（donut SVG、柱状图、性能盘、元信息栏） | 抽 `renderSyncChartSection(model)` 到共用模块 |
| ~~`github-sync.ts:143-246` / `gitee-sync.ts:75-160` / `gitlab-sync.ts:75-160` / `gist-sync.ts:235-323`~~ **已收敛** | 四个 `fetchXxxText` 几乎逐字重复（各 ~85 行），且 **abort 监听器处理已分歧**：github 版有 `removeEventListener`，其余只 add 不 remove → 换配置就泄漏监听器 | ✅ 已提 `createRawTextFetcher({ buildUrl, logTag })` 工厂（净减 88 行），四个源均已改造 |
| `github-sync.ts:1922-1969` vs `sync-source-registry.ts:299-350` | `getSelectedRowSids` 两份逐字重复（连日志文案都一样） | 保留一份，registry import |
| `sync-source-registry.ts:100-281` vs `github-sync.ts:1729-1915` | `syncFromRemote` 与 `syncFromGithub` 主体重复 ~150 行，且**功能已漂移**：`missingColumns` 缺列体检只有 github 路径有 → 从 Gitee/GitLab/本地同步时用户看不到缺列提示 | 合并为一份；registry 版本补缺列体检 |
| 4 个 `*-bootstrap.ts` | 「禁用→`modulesReady`启用」整块复制 | 抽 `disableActionsUntilReady(tag)` |
| `github-settings.ts` vs `action-handlers.ts` | GitHub 配置读/存两套实现（~80 行） | handler 委托 `saveGithubConfigFromDom` |
| `github-sync.ts:756-829` / `1111-1180` / `1329-1399` | 逐字段回退路径三份重复（~120 行） | 提 `fallbackWriteRemoteEntry(...)` |
| `github-sync.ts:854-885` / `964-1016` | `batchWriteNewRows`/`batchUpdateRows` 的 writeCols 收集逻辑重复 ~30 行 | 提 `collectWriteCols(colMap, predicate)` |
| `sheet.ts:115` vs `:160` | `readRangeValues`/`readRangeCellValues` ~90% 相同 | 提 `readRect(ws,r1,r2,c1,c2,convert)` |
| `ribbon-service.ts` vs `tools/util/index.ts` | `copyTokenForRibbon`/`copyTokenToClipboard`、`testTokenForRibbon`/`_fetchBgmUserInfo` 各重复 20+ 行 | 提 `copyTextToClipboard` / `fetchBgmMe` |
| `preview.ts` / `sync.ts` | `{onPause,onResume,onStop}` handlers 对象重复 4 次 | 提 `createSyncControlHandlers()` |

### 5.3 CPU 热点（非 IPC）

| 位置 | 问题 | 改法 |
| --- | --- | --- |
| ~~`enrich-engine.ts:614-618`~~ **已修** | 别名匹配 O(n²)：1000 个未匹配行 × 5000 个别名索引 = 500 万次 `includes` | ✅ 构建 `aliasIndex` 时顺带产反向索引 `aliasByRow: Map<row, alias[]>`，此处 O(1) 查表 |

---

## 六、测试桩忠实性原则（本次最重要的方法论收获）

### 原则

> **桩不忠实就修桩，不要为迁就桩弱化生产代码的守卫。**

本次修数据安全时打翻了 5 个既有测试，逐一核实后确认**全部是桩不忠实**，没有一个是「修复有错」：

| 桩问题 | 具体 | 后果 |
| --- | --- | --- |
| 返回值形状错误 | `asThrowingRowRangeMock` 的 getter 返回 `[['']]`（1 列），而区间是 2 列 | 被完整性守卫判为「读不全」而走回退，测不到「整行写入抛错 → 回退」路径 |
| 返回值类型错误 | `mockSetCellValue.mockImplementation(() => {})` 返回 `undefined`，真实签名是 `boolean` | 逐字段回退路径检查该返回值 → 判定失败 |
| 读回形状不真实 | `createMockWorksheet` 的 Range 对区域一律返回 `Value2: null` | 从不模拟一维/二维真实形状 |
| 测试锁旧行为 | `incremental-bindings.test.ts` 断言「复选框不存在 → 不初始化冲突策略」 | 把 bug 固化成预期 |

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
writeFileSync('<临时文件>', out)   // Buffer 原样落盘，不经 shell 编码转换
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
const existingRows = readRangeCellValues(sheet, existingRow, existingRow, 1, SYNC_RECORD_COLUMNS.length)
const existing = existingRows[0]
```

读**单行多列**后取 `[0]`。而 `readRangeCellValues` 对一维输入返回 `[[v1],[v2],…]`（多行单列），那样只会拿到第一列 → `existing[COUNT-1]` 为 undefined → `Number(undefined)` = NaN → `|| 0` → **同步记录表的 count 被重置**。

**无法在 Node 测试环境判定 `Value2` 到底返回一维还是二维**，需在真机 WPS 里跑一次同步，看同步记录表「次数」列是否正常累加。确认后按 §2.1 的形状归一化修法处理。

### 公开 API 无内部调用方（未删）

`getSequentialRowsBySeqCol`（`exceltobangumi/index.ts:226`）：全库无生产调用方，但有 2 个测试文件 ~15 条用例覆盖，且从 `ts/index.ts` barrel 导出。删除会掉覆盖又破坏公开 API，**保留**，若确认不再对外可连测试一起删。

### 已知未治理

- `readLocalEntries` / `batchUpdateRows` / `batchWriteNewRows` 仍是**内联 `Range.Value2`**，未走统一的 `readRangeValues()` 入口。已按形状归一化补齐，但建议后续收敛。
- `parseJsonl` 的 `errors`（非法远程行）只进 WARN 日志、不告知用户 —— 远程有坏行时用户看不到提示。
- `ui/panel-preview.html` 是无任何引用的孤儿文件（`#chkIncremental` 只在它里面），确认无用可删。
