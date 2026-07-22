import type { WpsWorksheet } from '../wps.js';
export declare function readRangeValues(ws: WpsWorksheet | null | undefined, startRow: number, endRow: number, startCol: number, endCol: number): string[][];
/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export declare function cacheGet<T>(key: string, factory: () => T): T;
export declare function findHeaderRow(ws: WpsWorksheet | null | undefined, startRow?: number): number;
/**
 * 获取列名到列号的映射（优化版：正则规则数组 + 缓存）
 * @param ws 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列名 -> 列号
 */
export declare function getColumnMap(ws: WpsWorksheet | null | undefined, headerRow: number): Map<string, number>;
/** 清除指定工作表的所有缓存 */
export declare function clearSheetCache(ws: WpsWorksheet | null | undefined): void;
/**
 * 获取工作表的最后有效数据行
 * @param ws            工作表对象（WpsWorksheet）
 * @param forceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export declare function getLastRow(ws: WpsWorksheet | null | undefined, forceRefresh?: boolean, headerRow?: number): number;
export declare function isEmptyValue(val: unknown): boolean;
export declare function getDataSheet(): WpsWorksheet | null | undefined;
export declare function safeActivate(ws: WpsWorksheet | null | undefined): void;
//# sourceMappingURL=sheet.d.ts.map