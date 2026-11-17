/**
 * @fileoverview 数据中心纯 SVG 图表（饼图 / 月度柱状图 / 环比箭头）
 * @module ui/dataCenterCharts
 * @description 不引入图表库：与 `sync-stats-chart.ts` 同风格，直接吃 tokens.css 的主题变量，
 *              在 file:// 安装态稳定。所有可见文案由调用方以已翻译文本传入，模块本身不 import i18n。
 *
 * 安全：标签一律经 escapeHtml 转义，颜色只用固定调色板（非用户输入），避免 XSS。
 */
import type { MonthlyCount, PeriodComparison, StatusCount } from '../services/data-center-stats.js';
/**
 * 渲染状态分布饼图 + 图例
 * @param counts 各状态计数（含 0）
 * @param labels 已翻译的状态名（5 项，顺序同 STAT_STATUSES）
 */
export declare function renderStatusPie(counts: readonly StatusCount[], labels?: readonly string[]): string;
/** 渲染月度完成数柱状图 */
export declare function renderMonthlyBars(months: readonly MonthlyCount[], emptyText: string): string;
/** 渲染环比：绿色向上 / 红色向下（涨跌语义按中国习惯：增为红？此处是完成数，增用 success 绿） */
export declare function renderComparison(comparison: PeriodComparison, labels: {
    up: string;
    down: string;
    flat: string;
}): string;
//# sourceMappingURL=data-center-charts.d.ts.map