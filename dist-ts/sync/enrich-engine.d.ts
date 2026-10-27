/**
 * @fileoverview 富化引擎核心模块
 * @module sync/enrichEngine
 * @description 实现新番表数据富化的核心逻辑：
 *              1. 列名自动识别（表头关键字匹配）
 *              2. 双重匹配算法（精确名称 + 别名）
 *              3. 数据合并规则（空值填充 + 标签追加）
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import type { SheetCellCache } from '../tools/util/sheet.js';
import type { WpsWorksheet } from '../tools/wps.js';
import type { ConflictInfo, EnrichConfig, EnrichedField, EnrichResultItem, MatchResult, ProgressCallback } from './enrich-types.js';
import type { IntroSheetContext } from './enrich-intro.js';
export { normalizeName, splitAliases, splitTags, mergeTags, appendFeatures, resetNoiseKeywordCache, shouldFilterNoise, } from './enrich-normalize.js';
/**
 * 执行富化操作
 * 对每个匹配结果执行富化，写入富化记录，调用进度回调
 */
export declare function enrichEntries(animeSheet: WpsWorksheet, bangumiSheet: WpsWorksheet, matches: MatchResult[], config: EnrichConfig, progressCallback?: ProgressCallback, intro?: IntroSheetContext, isCancelled?: () => boolean): EnrichResultItem[];
export type { EnrichRecord } from './enrich-record.js';
/** 简介字段中需追加到特点/印象的键 */
/**
 * 解析字段冲突：根据用户选择的 resolution 执行相应操作
 * append: 增量更新（old | new）
 * keep: 保留原名
 * overwrite: 使用新番表字段的名字
 */
export declare function resolveConflictField(sheet: WpsWorksheet, conflict: ConflictInfo, enriched: EnrichedField[]): void;
/**
 * 检查并添加缺失的列到 Bangumi 追踪表
 *
 * 语义（P2-6）：**全成或全不成**。只有表头写入并读回校验通过，新增列才会进入
 * 返回的映射；失败时返回原映射（不含新列）并向用户提示，由下游按既有回退列处理。
 * 因此调用方拿到的映射里出现的列，一定是本次确实可用的列。
 *
 * @returns 更新后的列映射（失败时为未含新列的入参映射）
 */
export declare function ensureBangumiColumns(sheet: WpsWorksheet, columnMap: Map<string, number>, requiredFields: Record<string, string>, headerRow: number): Map<string, number>;
/**
 * 富化别名
 * 当新番表名称与 Bangumi 追踪表名称/别名不一致时，
 * 将新番表名称补充到 Bangumi 追踪表的别名列
 */
export declare function enrichAlias(sheet: WpsWorksheet, row: number, animeName: string, bangumiName: string | undefined, columnMap: Map<string, number>, enriched: EnrichedField[], aliasColumn?: number, cache?: SheetCellCache): void;
/**
 * 搜索结果条目
 */
export interface SearchResult {
    row: number;
    name: string;
    fieldMatches: {
        column: string;
        value: string;
    }[];
}
/**
 * 在工作表中搜索关键词
 * 支持多字段匹配，返回所有匹配行
 */
export declare function searchSheet(sheet: WpsWorksheet, keyword: string, columnMap: Map<string, number>, dataStartRow: number): SearchResult[];
//# sourceMappingURL=enrich-engine.d.ts.map