/**
 * @fileoverview 喜好推荐纯函数（基于已看条目的标签权重）
 * @module services/dataCenterRecommend
 * @description 从候选库里挑出与用户喜好最接近、且不在排除集里的条目，附推荐理由。
 *              纯数据逻辑，不碰 COM / DOM / i18n；理由Text 由 UI 层用 tOr 组装。
 */
import type { StatisticsRecord } from './data-center-stats.js';
/** 单条推荐结果 */
export interface Recommendation {
    sid: string;
    name: string;
    /** 命中的标签（用于 UI 生成「因为你喜欢 X」） */
    matchedTags: string[];
    /** 匹配得分 = 命中标签权重之和 */
    score: number;
}
/** 推荐参数 */
export interface RecommendOptions {
    /** 已经看过的 SID 集合（sourceRecords 中 type=2 的条目会自动加入） */
    excludeSids?: ReadonlySet<string>;
    /** 最多返回几条 */
    limit?: number;
}
/**
 * 生成推荐：
 *  1. 用「看过」条目建喜好画像（标签 → 权重）；
 *  2. 排除已看过的 SID 与外部指定 SID；
 *  3. 对候选按命中标签权重求和打分，取分数 > 0 的前 limit 条。
 *
 * 没有画像（一条看过记录都没有或都没标签）时返回空数组，UI 层提示先积累数据。
 */
export declare function recommendByPreference(sourceRecords: readonly StatisticsRecord[], candidates: readonly StatisticsRecord[], options?: RecommendOptions): Recommendation[];
//# sourceMappingURL=data-center-recommend.d.ts.map