/**
 * @fileoverview 富化引擎 · 新番表 ↔ Bangumi 追踪表条目匹配
 * @module sync/enrichMatching
 * @description 从 enrich-engine.ts 拆出的「匹配组」：读新番表一行、构建 Bangumi
 *              追踪表的名称/别名索引、按「精确名称 → 别名」双重策略匹配条目。
 *
 *              依赖（单向，无反向环）：enrich-layout.js（列映射 / findAliasColumn）。
 *
 * @author BGM Development Team
 */
import type { WpsWorksheet } from '../tools/wps.js';
import type { EnrichColumnMapping } from './enrich-layout.js';
import type { EnrichConfig, MatchResult } from './enrich-types.js';
/**
 * 读取新番表一行数据
 */
export declare function readNewAnimeRow(sheet: WpsWorksheet, row: number, mapping: EnrichColumnMapping, rowCells?: readonly string[]): Record<string, string>;
/**
 * 判断 Bangumi 目标表是否为空（有表头但无数据行）
 * 空表时富化流程会将新番表条目作为新行追加写入
 * @returns true 表示目标表只有表头、没有任何数据行
 */
export declare function isBangumiSheetEmpty(bangumiSheet: WpsWorksheet): boolean;
/**
 * 匹配新番表与 Bangumi 追踪表条目
 */
export declare function matchEntries(animeSheet: WpsWorksheet, bangumiSheet: WpsWorksheet, config: EnrichConfig): MatchResult[];
//# sourceMappingURL=enrich-matching.d.ts.map