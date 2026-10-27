import type { WpsWorksheet } from '../index.js';
export type NameUrlMap = Record<string, string>;
export interface AutoFillResult {
    /** 补全的 URL 数量 */
    filled: number;
    /** 建立映射的名称数量 */
    mappedNames: number;
}
declare function _splitAliases(aliasValue: string): string[];
declare function _buildNameUrlMap(worksheet: WpsWorksheet, headerRow: number, lastRow: number, columnMap: Map<string, number>): NameUrlMap;
export declare function autoFillUrls(): AutoFillResult;
export declare function showAutoFillUrlDialog(): void;
export { _buildNameUrlMap, _splitAliases };
//# sourceMappingURL=auto-fill-url.d.ts.map