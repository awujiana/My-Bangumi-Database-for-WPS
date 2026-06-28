import type { WpsWorksheet } from '../index.js';
export interface NameUrlMap {
    [nameOrAlias: string]: string;
}
export interface AutoFillResult {
    /** 补全的 URL 数量 */
    filled: number;
    /** 建立映射的名称数量 */
    mappedNames: number;
}
declare function _splitAliases(aliasVal: string): string[];
declare function _buildNameUrlMap(ws: WpsWorksheet, headerRow: number, lastRow: number, colMap: Map<string, number>): NameUrlMap;
export declare function autoFillUrls(): AutoFillResult;
export declare function showAutoFillUrlDialog(): void;
export { _buildNameUrlMap, _splitAliases };
//# sourceMappingURL=autoFillUrl.d.ts.map