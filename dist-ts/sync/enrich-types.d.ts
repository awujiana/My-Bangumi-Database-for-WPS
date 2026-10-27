/**
 * @fileoverview 富化引擎 · 跨模块共享类型
 * @module sync/enrichTypes
 * @description enrich-engine 拆分时被多个模块同时引用的接口集中到这里，避免
 *              「为两个接口反向 import 主模块」的尴尬：
 *
 *              - `EnrichConfig` / `MatchResult`：匹配组与编排组都要
 *              - `EnrichedField` / `ConflictInfo`：字段富化组、简介组、编排组都要
 *              - 统计与进度：编排组产出、UI 层消费
 *
 *              本模块**零运行时依赖**（只有 `import type`），是最底层。
 *
 * @author BGM Development Team
 */
import type { EnrichColumnMapping } from './enrich-layout.js';
export interface EnrichConfig {
    filePath: string;
    sheetName: string;
    headerRow: number;
    dataStartRow: number;
    columnMapping: EnrichColumnMapping;
    targetSheetName?: string;
}
/**
 * 匹配结果
 */
export interface MatchResult {
    animeRow: number;
    matchedAnimeName: string;
    matchType: 'exact' | 'alias' | 'unmatched' | 'error';
    bangumiRow?: number;
    bangumiName?: string;
    aliases?: string[];
    errorMessage?: string;
}
/**
 * 富化字段变更记录
 */
export interface EnrichedField {
    fieldName: string;
    bangumiColumn: number;
    oldValue: string | null;
    updatedValue: string;
    action: 'fill' | 'append' | 'skip';
    /** 附注：仅当来源字段名与目标列名不同时存在，形如「字段名差异: 编剧 → 脚本」 */
    note?: string;
}
/**
 * 字段冲突信息（需用户确认）
 */
export interface ConflictInfo {
    fieldName: string;
    bangumiColumn: number;
    bangumiRow: number;
    oldValue: string;
    updatedValue: string;
    animeRow: number;
    matchedAnimeName: string;
    resolution: 'append' | 'keep' | 'overwrite';
    note?: string;
}
/**
 * 富化结果条目
 */
export interface EnrichResultItem {
    kind: 'matched' | 'unmatched' | 'error';
    animeRow: number;
    name: string;
    matchType?: 'exact' | 'alias' | 'unmatched' | 'error';
    enrichedFields: EnrichedField[];
    conflicts?: ConflictInfo[] | undefined;
    errorMessage?: string;
}
/**
 * 富化统计
 */
export interface EnrichStats {
    matched: number;
    enriched: number;
    skipped: number;
    failed: number;
}
/**
 * 富化进度
 */
export interface EnrichProgress {
    current: number;
    total: number;
    currentName: string;
    stats: EnrichStats;
    etaMs: number;
}
/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: EnrichProgress) => void;
//# sourceMappingURL=enrich-types.d.ts.map