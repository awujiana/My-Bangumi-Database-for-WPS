/**
 * @fileoverview 数据中心统计纯函数（状态分布 / 月度完成数 / 环比 / 喜好画像）
 * @module services/dataCenterStats
 * @description 只吃「行对象数组」，不碰 COM / DOM / i18n，便于单测与复用。
 *
 * 观看状态口径与 `core/constants.ts` 的 WATCH_STATUS_MAP 一致：
 *   1 想看 / 2 看过 / 3 在看 / 4 搁置 / 5 抛弃。
 * 「已完成」按用户需求复用观看状态：`type=2` 视为已完成，不新增打卡时间戳字段。
 */
/** 一条可用于统计的番剧记录（字段都在 STANDARD_HEADERS 内，不新增列） */
export interface StatisticsRecord {
    /** 唯一标识（SID / 条目 ID），用于推荐时排除已看条目 */
    sid: string;
    /** 名称，用于推荐列表展示 */
    name: string;
    /** 观看状态数值 1~5；非合法值视为未分类 */
    watchStatus: number;
    /** 完成/更新日期（可解析的日期字符串，如 2026-11-04）；缺失则不进时间统计 */
    date: string;
    /** 标签/题材（以分隔符切分前的原始文本） */
    tags: string;
}
/** 单一状态的计数 */
export interface StatusCount {
    status: number;
    count: number;
}
/** 单月的完成数 */
export interface MonthlyCount {
    /** 形如 2026-11 */
    month: string;
    count: number;
}
/** 环比结果 */
export interface PeriodComparison {
    current: number;
    previous: number;
    /** 百分比；上期为 0 时，当前 >0 记 100，当前=0 记 0 */
    changePercent: number;
}
/** 喜好画像：标签 → 权重（出现次数） */
export interface PreferenceProfile {
    /** 按权重降序的标签 */
    topTags: {
        tag: string;
        weight: number;
    }[];
    /** 参与画像计算的「看过」条目数 */
    sampleSize: number;
}
/** 完成状态常量：BGM API v0 的 collect */
export declare const COMPLETED_STATUS = 2;
/** 统计用的 5 个状态，顺序固定，缺计数补 0 */
export declare const STAT_STATUSES: readonly number[];
/**
 * 把任意文本状态归一到 1~5；无法识别返回 0（未分类）。
 * 与 `WATCH_STATUS_MAP` 的语义对齐，但这里刻意不 import 常量表，保持本模块纯数据依赖。
 */
export declare function normalizeWatchStatus(value: string | number): number;
/** 统计各状态数量（含 0 计数的状态，顺序按 STAT_STATUSES） */
export declare function countByStatus(records: readonly StatisticsRecord[]): StatusCount[];
/** 统计「已完成」（type=2）条目的月度完成数，按月份升序 */
export declare function countCompletedByMonth(records: readonly StatisticsRecord[]): MonthlyCount[];
/** 环比：当前月 vs 上一个月。months 需按升序，取最后两项 */
export declare function compareLastTwoMonths(months: readonly MonthlyCount[]): PeriodComparison;
/**
 * 从「看过」条目构建喜好画像：标签出现次数即权重，取前 limit 个。
 * 只统计非空标签，大小写/首尾空白归一。
 */
export declare function buildPreferenceProfile(records: readonly StatisticsRecord[], limit?: number): PreferenceProfile;
//# sourceMappingURL=data-center-stats.d.ts.map