/**
 * @fileoverview 富化详情弹窗的纯渲染逻辑
 * @module panel/enrichDetailRender
 * @description 从 enrich-page.ts 抽出的纯函数簇：匹配方式/字段操作枚举→中文标记映射，
 * 以及「分组 → 条目 → 字段」三级 HTML 渲染。全部无 DOM 副作用，便于单测。
 */
import type { EnrichedField, EnrichResultItem, MatchResult } from '../sync/enrich-types.js';
/** 详情弹窗中的一个文件分组（含该文件全部富化条目） */
export interface EnrichDetailGroup {
    fileName: string;
    items: EnrichResultItem[];
}
/** 把匹配方式枚举映射为用户可读的中文标记 */
export declare function matchTypeLabel(matchType: MatchResult['matchType']): {
    text: string;
    badge: string;
};
/** 把富化操作枚举映射为中文标记 */
export declare function fieldActionLabel(action: EnrichedField['action']): {
    text: string;
    cssClass: string;
};
export declare function renderEnrichDetailHtml(groups: EnrichDetailGroup[]): string;
//# sourceMappingURL=enrich-detail-render.d.ts.map