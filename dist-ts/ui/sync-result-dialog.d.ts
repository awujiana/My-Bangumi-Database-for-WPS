/**
 * @fileoverview 同步结果增强对话框
 * @module ui/syncResultDialog
 * @description 在同步完成后显示增强的统计结果弹窗，包含：
 * - 数据统计概览（总条数、新增、更新、删除、无变更、失败）
 * - 开播日期统计（最早/最晚开播日、最新开播季度）
 * - 导出为 JSONL 文件
 * - 查看同步详情
 * - 逐条查看与对比
 */
import type { GithubSyncResult } from '../sync/github-sync.js';
export interface DateStats {
    /** 最早开播日期（YYYY-MM-DD） */
    earliestDate: string | null;
    /** 最晚开播日期（YYYY-MM-DD） */
    latestDate: string | null;
    /** 最新开播季度（如 "2024年7月新番"） */
    latestSeason: string | null;
    /** 有开播日期的条目数 */
    datedCount: number;
    /** 总条目数 */
    totalCount: number;
}
export interface SyncResultDialogOptions {
    /** 同步结果统计 */
    result: GithubSyncResult;
    /** 总耗时（毫秒） */
    elapsedMs: number;
    /** 平均速度（行/秒） */
    avgSpeed: number;
    /** 同步策略显示名称 */
    strategyLabel: string;
    /** 是否被用户停止 */
    stopped: boolean;
    /** 查看详情时滚动到的目标行号（可选，默认跳转到最新记录） */
    scrollToRow?: number;
}
/**
 * 从 Excel 工作表中计算开播日期统计
 *
 * 遍历数据行，读取「开播日期」列，计算最早/最晚日期和最新季度。
 * 支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 格式。
 *
 * @returns 日期统计信息
 */
export declare function computeDateStatsFromSheet(): DateStats;
/**
 * 计算格式化耗时字符串。
 *
 * 实现已下沉到 `tools/util/duration.ts`（全项目唯一一份）；此处保留同名转出，
 * 因为 `ts/index.ts` 从本模块对外导出 `formatDuration`（`ui/handlers/*` 经 barrel 使用）。
 */
export { formatDuration } from '../tools/util/duration.js';
/**
 * 显示同步完成增强结果弹窗
 *
 * @param options 同步结果选项
 */
export declare function showSyncResultDialog(options: SyncResultDialogOptions): void;
/** 隐藏同步结果弹窗 */
export declare function hideSyncResultDialog(): void;
//# sourceMappingURL=sync-result-dialog.d.ts.map