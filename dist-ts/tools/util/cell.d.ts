import type { WpsWorksheet, WpsRange } from '../wps.js';
export declare function getCell(worksheet: WpsWorksheet | null | undefined, row: number, column: number): WpsRange | null;
/**
 * 获取单元格的值
 * @param worksheet - 工作表对象，可能为 null 或 undefined
 * @param row - 行号
 * @param column - 列号
 * @returns 单元格的字符串值；如果工作表无效或单元格不存在，则返回空字符串
 */
export declare function getCellValue(worksheet: WpsWorksheet | null | undefined, row: number, column: number): string;
/**
 * 设置单元格值
 */
export declare function setCellValue(worksheet: WpsWorksheet | null | undefined, row: number, column: number, value: unknown): boolean;
/**
 * 获取工作表对象
 */
export declare function getSheetByIndex(sheetIndex: number): unknown;
//# sourceMappingURL=cell.d.ts.map