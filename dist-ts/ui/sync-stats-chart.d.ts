/**
 * @fileoverview 同步统计仪表盘（概览条 + 环形分布图 + 柱状图 + 性能盘 + 元信息栏）
 * @module ui/syncStatsChart
 * @description `ui/dialog.ts`（进度弹窗完成态）与 `ui/sync-result-dialog.ts`（结果弹窗）
 *              此前各有一份 ~300 行**逐字重复**的仪表盘渲染，连配色阈值和 SVG 参数都一样，
 *              改一处就会在另一处静默漂移。收敛为一份，两处只负责组装数据。
 *
 *              入参统一用 `SyncProgressStats`（已下沉到 `core/types.ts` 的纯数据形状），
 *              因此 sync 层与 ui/handlers 也能复用，不必为了一个数据形状反向依赖 UI。
 *
 *              耗时格式化复用 `components/progress.ts` 的 canonical 实现（999ms 截断为
 *              `0.99秒`、整分不补 `00秒`）；此前 `sync-result-dialog.ts` 自带的是
 *              漂移版（四舍五入成 `1.00秒`、整分补 `00秒`）。
 */
import type { SyncProgressStats } from '../core/types.js';
/** 图表需要的计数部分（`GithubSyncResult` 与 `SyncProgressStats` 都满足） */
export type SyncStatsCounters = Pick<SyncProgressStats, 'added' | 'updated' | 'deleted' | 'unchanged' | 'failed' | 'skipped' | 'remoteTotal'>;
/**
 * 把「同步结果计数 + 运行期指标」组装成图表模型
 *
 * 结果弹窗拿到的是 `GithubSyncResult`，还要带上耗时/速度/策略文案，这里统一收口。
 */
export declare function toSyncStatsChartModel(result: SyncStatsCounters, elapsedMs: number, avgSpeed: number, strategyLabel: string): SyncProgressStats;
/**
 * 渲染同步统计图表（完整仪表盘布局，与 syncResultDialog 风格一致）
 *
 * 布局：
 * ┌─ 概览条（进度环 + 关键指标） ──────────────────────────┐
 * │  总条目  │  完成进度环  │  处理效率  │  耗时  │  速度   │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 图表区 ──────────────────────────────────────────────┐
 * │  ┌─ 环形分布图 ─┐  ┌─ 水平柱状图 ──────────────┐      │
 * │  │   🍩 SVG     │  │  ✅ 新增 ████████         │      │
 * │  │   图例       │  │  🔄 更新 ████            │      │
 * │  └──────────────┘  │  ❌ 删除 ██             │      │
 * │                    │  ⏭️ 无变更 ██████████     │      │
 * │                    │  ⚠️ 失败  █              │      │
 * │                    │  🔍 跳过  ███            │      │
 * │                    └──────────────────────────┘      │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 性能仪表盘 ────────────────────────────────────────┐
 * │  ⏱ 1分30秒  │  ⚡️ 15/s  │  📈 44%  │  🔮 预计剩余  │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 元信息栏 ──────────────────────────────────────────┐
 * │  🎯 策略  📥 远程  ✅ 完成  🔍 跳过  ⚠️ 失败        │
 * └──────────────────────────────────────────────────────┘
 */
export declare function renderSyncStatsChart(stats: SyncProgressStats): string;
//# sourceMappingURL=sync-stats-chart.d.ts.map