# 性能审计报告（2026-10-24）

> 需求：momo「你自己读取性能日志查看还有哪些功能的性能可以优化，哪些有问题，去解决」。
>
> **结论先行**：主链路（下载 → 解压解析 → diff → 批量写入）已在前序轮次深度优化，
> 真实数据实测全部在「百毫秒 ~ 1 秒」量级，**无需再动**。唯一确认的性能问题
> **删除阶段逐行 COM `Delete`（P1）与微优化（P3）均于当日实施完毕**（§4），
> 其中 P1 属 COM 写入行为变更，**真机验证后再上线**。
> 另核验了「分片数据预览」功能（需求①）：已存在、数据为当前期次、守护测试全绿，
> 用户文档缺口已补（USER_OPERATIONS §2.10.2.2）。

---

## 1. 方法论：为什么没有「日志」可读

按需求第一反应是找运行日志，实际情况：

| 候选 | 结论 |
| --- | --- |
| `[perf]` 分段耗时日志（`ts/panel/panel-lifecycle.ts:517/1187`、`user-info-polling.ts:100-119`） | **存在**（bc7257b0 引入：防抖等待 / 列表刷新 / 检测段 / 落地段分段打），但只进内存 RingBuffer，仅在 WPS 内「系统日志」浮窗可看，**无文件落盘**——我在仓库侧读不到历史 |
| `ts/tools/logger.ts` | 内存 RingBuffer（1000 条）+ 系统日志浮窗展示，不落盘；`exportLogsToFile()` 已被移除（源码注释明示，logger.ts:79） |
| `%TEMP%/wpsjs.log`、`wpsjs-debug.log` | 开发机 wpsjs 报错（「WPS未安装」），与插件运行无关 |
| PluginStorage / localStorage | 存配置与数据缓存，非日志 |

因此本报告用两条腿补上「读不到运行日志」的这一路：

1. **真实数据实测**——本机姊妹仓库 `D:/编程/awujiana/Bangumi-Archive-Anime-Excel/data`
   的 2026-10-20 期次（31,215 条、6 片 + 清单），直接跑插件的解析 / 拼接 / diff 纯函数计时；
2. **热路径代码审计**——按「循环内 COM 调用 / 循环内查找 / 逐格读写 / 全量重渲染」
   四类反模式扫 `ts/sync/`、`ts/panel/enrich-*.ts`、`ts/ui/preview.ts`。

> 与运行时的分工：`[perf]` 日志回答「哪一段贵」（防抖 / 列表 / 检测 / 落地），
> 本报告回答「纯 JS 管线多快 / 哪里还有结构性浪费」。删除阶段（§4.1）恰是
> `[perf]` 分段未覆盖、只有进度条「行/秒」能体现的一段。

## 2. 实测结果

环境：node 22.22.2 + vitest（node env）；数据：上述真实分片。
浏览器侧（WPS WebView / CEF）解压走 `DecompressionStream`、JSON.parse 与 V8 同源，
预计与 node 同量级（±50%）。

| 路径 | 数据量 | 耗时 | 说明 |
| --- | ---: | ---: | --- |
| gunzip + `parseShardText` × 6 片 | 31,215 行/片 | **865 ms** | 全量 21.23 MiB 的理论下限， dominated by JSON.parse（~4.6 µs/行） |
| `joinShardRows` × 6 片 | 31,215 条 | **130 ms** | 按行号合并 + 字段归属校验 |
| gunzip + parse（默认 3 片） | base+meta+relations | **193 ms** | 默认场景只拉 3.42 MiB |
| `joinShardRows`（默认 3 片） | 31,215 条 | **139 ms** | |
| `computeDiff` mirror | 31,215 对 | **453 ms** | 最坏工况：合成本地表使每条都有差异 → 31,175 个 diff |
| `computeDiff` mirror | 31,215 对 | **160 ms** | 常规工况：仅名称有差异 |

**读表**：即使全量 6 片，解析 + 拼接 ~1 秒；diff 最坏 0.45 秒。用户可感知的同步耗时
大头在**下载**（3.42 MiB ~ 21 MiB，网络决定）与**批量写入**（COM，已优化），
纯 JS 管线不是瓶颈。

## 3. 已验证「已优化」清单（避免重复劳动）

以下均为代码审计确认的既有优化，**不建议重复"优化"**：

| 位置 | 优化 | 证据 |
| --- | --- | --- |
| `remote-sync-apply.ts` `batchWriteNewRows` / `batchUpdateRows` | `Range.Value2` 二维数组批量写（新增 50 条/批、更新 50 条/批），失败回退逐行 | :758、:889；注释载明比逐行快 100–1000x |
| `readRangeValues` / `readRowsCache` / `createSheetCellCache` | 逐格 COM 读 → 一次矩形读；目标表用**写穿透**缓存（写后读一致） | :200、enrich-engine.ts:127 |
| `github-sync-diff.ts` `computeDiff` | 全 Map/Set 查找（`localEntries.get` / `remoteSubjectIds.has`），无数组扫描 | :780+ |
| `applyDiffToSheet` | `ScreenUpdating=false` + `Calculation=-4135`（手动重算）包裹全程，finally 还原 | :1183–1191、:1513 |
| `enrich-engine.ts` `enrichEntries` | 源表 / 目标表行缓存；富化记录循环外一次性批量写 | :127、:106 |
| `buildRemovalSnapshot` | 删除前一次矩形读建 undo 基底（非逐格） | :1064 |
| 前序轮次 | 布局探测跨调用缓存、目标表识别结果缓存、日志区滚动合帧、浮动窗 transform 拖动 | CHANGELOG 2026-10-21/22 |
| `panel-lifecycle.ts` / `user-info-polling.ts`（bc7257b0） | 关工作簿卡顿治理：锁定态跳过表头检测（已锁定 + 非 force 直接返回）、工作簿变化 300ms 防抖（连续开关合并一次）、锁定目标失效兜底；`[perf]` 分段耗时日志 | commit bc7257b0 |
| `sortable-list.ts`（f6cf901e） | 吞「拖拽后 click」的窗口拦截器加 300ms 超时自摘（触摸/笔场景 pointerup 后无 click，拦截器会挂着吞掉后续真实点击） | commit f6cf901e |

## 4. 发现的问题

### 4.1 P1：删除阶段逐行 COM `Delete()` —— ✅ 已实施（当日）

**位置**：`ts/sync/remote-sync-apply.ts`（阶段 2b，原 :1379–1480）。

**原问题**：`deletedDiffs` 按行号降序，逐条执行
`worksheet.Range("<row>:<row>").Delete()`——n 个待删行 = n 次 COM 调用。
`ScreenUpdating` 虽已关（§3），但每次删除宿主仍要做行位移与内部数据搬运，
大表上单次删除代价随表规模增长；进度代码里「删除阶段专用速度」也说明此阶段
明显慢于新增 / 更新。

**已落地的实现**（commit 见 CHANGELOG 2026-10-24）：

1. 新增纯函数 `groupContiguousDeleteRuns(items, rowOf)`：把**降序**删除项按
   「行号连续」分组成 run（散乱行各自成组、一次删一行——与旧行为逐字一致）；
2. 每个 run 一次 `worksheet.Range("<max>:<min>").Delete()`（组内首元素是块内
   最大行、末元素是最小行）；
3. run 删除**失败**回退该 run 内逐行删除（保留旧健壮性，失败行单独记失败）；
4. undo 条目 / 同步记录 / 明细仍**逐行**记（run 删除成功后统一记，顺序不变——
   降序，与旧路径一致）；
5. 取消检查放 run 边界——**粒度从「逐行」变为「逐 run」**：一次批量删是原子
   COM 操作，做不到「删一半」；信号到达时正在删的 run 整组完成（undo/记录/明细
   逐行记），未开始的 run 整组保留并计入 skipped。这与新增 / 更新阶段「按批
   （50 条）检查取消」的粒度本来一致（那两批也是整批完成才检查），删除阶段
   原先的逐行粒度才是异类。既有回归测试（github-sync.test.ts「删除过程中被
   取消」）已按新语义改写为「第一个 run 原子完成 + 后续 run 整组跳过」；
6. undo 基底仍在任何删除发生前一次矩形读构建（`buildRemovalSnapshot` 不动）；
   单行取基底失败 → 该行不删并标记失败（与旧路径保证一致）。

**语义等价性**：连续块一次删 vs 逐行降序删，最终表状态相同（块内行全部消失、
块下方向上平移块大小）。**风险**：低（同一 `Delete` 原语，失败有回退）；
属 COM 写入行为变更，**真机验证后再上线**（见 §7）。

**回归钉**（`tests/remote-sync-apply.test.ts`，8 例）：分组语义 4 例 +
集成 4 例（假工作表直跑 `applyDiffToSheet`）——连续 3 行只调一次
`Range("30:28").Delete()`、散乱行一行一次、批量失败回退逐行且全部记为已删、
undo 逐行降序、取消后零删除计入 skipped。

**预期收益**：stale 行成片的场景从 n 次 COM → 1 次；完全散乱无增益（但也不会更慢）。

### 4.2 P3：微优化 —— ✅ 已实施（当日，仅一项）

| 位置 | 观察 | 处置 |
| --- | --- | --- |
| `shard-manifest.ts` `mergeRowAt` | `row.at(column)` ~62 万次（`.at()` 比下标慢 2–3x） | ✅ **已改为下标直取**（行长度已校验等于表头长，不存在越界） |
| `shard-manifest.ts` `parseShardText` | `lines.slice(1)` 整表拷贝（31k 引用） | ⏸ 保持原样——实测属亚毫秒级；为它改单趟结构要对抗 `no-continue` / `no-for-loop` 两条 lint，收益抵不上复杂度 |
| `github-sync-diff.ts` `toRemoteEntry` | 每条一次对象 spread（31k 次） | ⏸ 勿动（已很快） |

**实测**（预热 JIT 后复跑同基准）：6 片 parse+join 合计从改动前的冷测
865+130ms 降到 786+123ms——与预估「几十 ms」量级一致（冷/热测有差异，
取「确认方向正确、量级不大」的结论）。

## 5. 附带核验：分片数据预览（需求①）

**功能已存在且数据为当前期次**，无需新开发：

- 实现：`ts/ui/handlers/shard-samples.ts`（**自动生成，勿手改**，
  由 `scripts/build-shard-samples.mjs` 从本地分片数据生成）；
- UI：设置面板 → 数据分片 →「📋 分片清单」浮窗，每片一张四列表格
  （**远程字段 / 类型 / 示例值 / 本地列**），未映射行置灰并给原因；
- 样本条目：**sid=243430《机动战士高达 闪光的哈萨维 喀耳刻的魔女》**
  （2026-01-30 播出，31 个非空字段，六片覆盖最全：infobox 6.1KB、summary 883B、
  评分分布 / 收藏 / 关联条目俱全）；
- **重新生成验证**：`node scripts/build-shard-samples.mjs` → 与工作区现有产物逐字节一致（零 drift），
  样本挑选逻辑（2026 年播出 × 字段最全）与数据仓库 2026-10-20 期次吻合；
- 守护：`tests/shard-samples.test.ts` 8 例（localColumn 与 `github-sync-diff` 的映射表
  对齐，防漂移）；
- **文档缺口（本次补）**：USER_OPERATIONS 此前只记录了分片**多选**，未记录清单浮窗的
  预览表 → 已补 §2.10.2.2。

## 6. 复现指南

```bash
# 在 BGM 仓库根目录；数据路径按本机姊妹仓库位置调整
cat > tests/zz-bench.test.ts <<'EOF'
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseShardText, joinShardRows } from '../ts/sync/shard-manifest.js'
import { computeDiff } from '../ts/sync/github-sync-diff.js'

const DATA = 'D:/编程/awujiana/Bangumi-Archive-Anime-Excel/data'

describe('bench', () => {
  it('pipeline', () => {
    const files = ['base', 'meta', 'relations', 'stats', 'summary', 'infobox']
    const t0 = Date.now()
    const shards = files.map((name) => {
      const text = gunzipSync(readFileSync(`${DATA}/anime.${name}.jsonlines.gz`)).toString('utf8')
      const parsed = parseShardText(name, text)
      if (parsed === null) throw new Error('parse failed')
      return parsed
    })
    const t1 = Date.now()
    const joined = joinShardRows(shards)
    if ('errors' in joined) throw new Error('join failed')
    console.log(`[bench] parse ${t1 - t0}ms; join ${Date.now() - t1}ms; entries ${joined.entries.length}`)
    expect(joined.entries.length).toBeGreaterThan(0)
  }, 120000)
})
EOF
node node_modules/vitest/vitest.mjs run tests/zz-bench.test.ts
rm tests/zz-bench.test.ts   # 临时文件，勿入库（测试禁 node 内置模块，无法常驻）
```

分片预览重新生成：`node scripts/build-shard-samples.mjs`（输出零 drift 即为最新）。

## 7. 结论与后续

| 项 | 状态 |
| --- | --- |
| 主链路（解析/拼接/diff/批量写/富化） | ✅ 已优化，实测达标，不再投入 |
| 删除阶段逐行 COM Delete（P1） | ✅ **已实施**（连续行合并 run 级一次 Delete，8 例回归钉）；属 COM 写入行为变更，**真机验证后再上线** |
| parse/join 微优化（P3） | ✅ **已实施** `mergeRowAt` 的 `.at()`→下标；`parseShardText` 的 slice 经评估保持原样（亚毫秒级，不值得对抗 lint） |
| 分片数据预览 | ✅ 功能在、数据新、测试绿；文档已补 |
