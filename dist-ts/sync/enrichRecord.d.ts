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
export declare const ENRICH_RECORD_COL: {
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
    matchType: '精确' | '别名' | '未匹配';
    name: string;
    row: number;
    enrichedField: string;
    oldValue: string;
    newValue: string;
    action: 'fill' | 'append' | 'skip' | 'error';
    note?: string;
}
export interface AddEnrichRecordParams {
    timestamp: string;
    matchType: '精确' | '别名' | '未匹配';
    name: string;
    row: number;
    enrichedField: string;
    oldValue: string;
    newValue: string;
    action: 'fill' | 'append' | 'skip' | 'error';
    note?: string;
}
export declare function getActionColor(action: string): number;
export declare function getOrCreateEnrichRecordSheet(): WpsWorksheet;
export declare function addEnrichRecord(params: AddEnrichRecordParams): void;
export declare function addEnrichRecords(records: AddEnrichRecordParams[]): void;
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
//# sourceMappingURL=enrichRecord.d.ts.map