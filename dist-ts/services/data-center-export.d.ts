/**
 * @fileoverview 搜索结果写入工作表的纯逻辑（行数据构造 + 表头定义）
 * @module services/dataCenterExport
 * @description 只做「结果 → 二维数组」的纯转换，不碰 COM / DOM / i18n，便于单测。
 *              实际写表由 panel 层的薄封装负责，用一次 Range.Value2 矩形写减少 COM 往返。
 */
import type { SearchResult } from './data-center-search.js';
import type { WpsCellValue } from '../tools/wps.js';
/** 搜索结果表的固定列名（简体兜底；写入 Excel 用源语言，避免语言漂移） */
export declare const SEARCH_RESULT_HEADERS: readonly string[];
/** 搜索结果工作表名（覆盖语义：同名则清空重写） */
export declare const SEARCH_RESULT_SHEET_NAME = "\u641C\u7D22\u7ED3\u679C";
/**
 * 把搜索结果转成写入工作表的二维数组（第 0 行是表头）。
 * 简介可能很长，Excel 单元格上限 32767 字符，这里截断避免写入失败。
 */
export declare function searchResultsToRows(results: readonly SearchResult[]): WpsCellValue[][];
/** 计算矩形写入范围所需的列字母个数（表头列数） */
export declare function resultColumnCount(): number;
//# sourceMappingURL=data-center-export.d.ts.map