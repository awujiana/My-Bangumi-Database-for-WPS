/**
 * @fileoverview 富化记录管理模块
 * @module sync/enrichRecord
 * @description 管理「富化记录」工作表，记录所有新番表富化操作的详细信息。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import type { WpsWorksheet } from '../tools/wps.js';
export declare const ENRICH_RECORD_SHEET_NAME = "\u5BCC\u5316\u8BB0\u5F55";
export declare const ENRICH_RECORD_COLUMNS: readonly ["时间戳", "匹配方式", "动漫名称", "行号", "富化字段", "原字段", "新字段", "操作类型", "备注"];
export declare const ENRICH_RECORD_COLUMN: {
    readonly TIMESTAMP: 1;
    readonly MATCH_TYPE: 2;
    readonly NAME: 3;
    readonly ROW: 4;
    readonly ENRICHED_FIELD: 5;
    readonly OLD_VALUE: 6;
    readonly NEW_VALUE: 7;
    readonly ACTION: 8;
    readonly NOTE: 9;
};
export interface EnrichRecord {
    timestamp: string;
    matchType: '精确' | '别名' | '新增' | '未匹配';
    name: string;
    row: number;
    enrichedField: string;
    oldValue: string;
    updatedValue: string;
    action: 'fill' | 'append' | 'skip' | 'error';
    note?: string;
}
export interface AddEnrichRecordParameters {
    timestamp: string;
    matchType: '精确' | '别名' | '新增' | '未匹配';
    name: string;
    row: number;
    enrichedField: string;
    oldValue: string;
    updatedValue: string;
    action: 'fill' | 'append' | 'skip' | 'error';
    note?: string;
}
export declare function getActionColor(action: string): number;
export declare function getOrCreateEnrichRecordSheet(): WpsWorksheet;
/**
 * 写入单条富化记录
 *
 * 性能提示：批量场景请用 `addEnrichRecords()` —— 本函数每次调用都会重新获取表句柄
 * 并逐单元格写入 9 次，循环调用会产生大量跨进程 COM 调用（P1-C）。
 *
 * @returns 是否写入成功（失败时已记录日志）
 */
export declare function addEnrichRecord(parameters: AddEnrichRecordParameters): boolean;
/**
 * 批量写入富化记录（性能入口）
 *
 * 相比逐条 `addEnrichRecord`：只获取一次表句柄，并通过一次 `Range.Value2` 写入全部行。
 *
 * @returns 是否写入成功（失败时已记录日志）
 */
export declare function addEnrichRecords(records: AddEnrichRecordParameters[]): boolean;
export declare function clearEnrichRecords(): void;
export declare function getAllEnrichRecords(): EnrichRecord[];
/**
 * 获取富化记录表（如果存在）
 * @returns 工作表或 null
 */
export declare function getEnrichRecordSheetIfExists(): WpsWorksheet | null;
/**
 * 打开富化记录表（激活工作表）
 */
export declare function openEnrichRecordSheet(): void;
/**
 * 格式化富化记录表样式
 */
export declare function formatEnrichRecordSheet(): void;
//# sourceMappingURL=enrich-record.d.ts.map