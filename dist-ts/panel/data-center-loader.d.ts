/**
 * @fileoverview 数据中心读表适配器（工作表二维数组 → 统计记录）
 * @module panel/dataCenterLoader
 * @description `rowsToRecords` 是纯函数，接收表头行 + 数据行 + 可选列名映射，便于单测；
 *              `loadRecordsFromActiveSheet` 才是碰 COM 的薄封装，由页面在 COM 闸门内调用。
 */
import type { StatisticsRecord } from '../services/data-center-stats.js';
/**
 * 把表格行转成统计记录（纯函数）。
 * @param rows 二维数组，第 0 行为表头
 * @param aliases 可选列名映射覆盖
 */
export declare function rowsToRecords(rows: readonly (readonly string[])[], aliases?: Record<string, readonly string[]>): StatisticsRecord[];
/**
 * 从当前活动工作表读取统计记录（碰 COM 的薄封装）。
 * 用注入的读取函数，便于页面层统一传 readRangeValues / getLastRow，也便于测试替换。
 */
export declare function loadRecordsWith(read: (startRow: number, endRow: number, startColumn: number, endColumn: number) => string[][], lastRow: number, aliases?: Record<string, readonly string[]>): StatisticsRecord[];
//# sourceMappingURL=data-center-loader.d.ts.map