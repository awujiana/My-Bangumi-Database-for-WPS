/**
 * @fileoverview 富化引擎 · 逐字段写入（标签 / 平台 / 日期 / 集数 / 特点）
 * @module sync/enrichFields
 * @description 从 enrich-engine.ts 拆出的「字段富化组」：把匹配到的新番数据按列
 *              写入 Bangumi 追踪表，统一走「空值填充 + 有值合并（去重）」的口径。
 *
 *              依赖（单向，无反向环）：enrich-cells.js（单元格读写，含会话缓存
 *              写穿透）、enrich-normalize.js（标签/特点合并）、enrich-types.js。
 *
 * @author BGM Development Team
 */
import type { SheetCellCache } from '../tools/util/sheet.js';
import type { WpsWorksheet } from '../tools/wps.js';
import type { EnrichedField } from './enrich-types.js';
/**
 * 富化标签
 * 追加模式（现有 + TAG_SEPARATOR + 新标签，去重），空值时填充
 */
export declare function enrichTags(sheet: WpsWorksheet, row: number, incomingData: Record<string, string>, columnMap: Map<string, number>, enriched: EnrichedField[], cache?: SheetCellCache): void;
/**
 * 富化播放平台
 * 写入 Bangumi 表「在线播放平台」列；目标单元格已有值时合并去重，不重复写入已有平台
 */
export declare function enrichPlatform(sheet: WpsWorksheet, row: number, incomingData: Record<string, string>, columnMap: Map<string, number>, enriched: EnrichedField[], cache?: SheetCellCache): void;
/**
 * 富化首播日期
 * 仅在 Bangumi 列为空时填充
 */
export declare function enrichDate(sheet: WpsWorksheet, row: number, incomingData: Record<string, string>, columnMap: Map<string, number>, enriched: EnrichedField[], cache?: SheetCellCache): void;
/**
 * 富化集数
 * 仅在 Bangumi 列为空时填充
 */
export declare function enrichEpisodes(sheet: WpsWorksheet, row: number, incomingData: Record<string, string>, columnMap: Map<string, number>, enriched: EnrichedField[], cache?: SheetCellCache): void;
/**
 * 富化特点/印象
 * 追加模式（收集周更/平台/独播/特殊信息，以 FEATURE_SEPARATOR 分隔）
 */
export declare function enrichFeatures(sheet: WpsWorksheet, row: number, incomingData: Record<string, string>, columnMap: Map<string, number>, enriched: EnrichedField[], cache?: SheetCellCache): void;
//# sourceMappingURL=enrich-fields.d.ts.map