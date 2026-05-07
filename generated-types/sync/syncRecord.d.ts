/**
 * 同步记录模块
 * @module sync/syncRecord
 * @description 管理同步记录工作表，记录同步历史
 */
import { SyncRecord, UpdateRecordParams } from '../tools/index.js';
export declare function sendToTaskpaneSR(data: any): any;
export declare function showDialogSR(title: string, message: string): void;
export declare function setSyncRecordHeaders(sheet: any): void;
export declare function checkHeaderExists(sheet: any): boolean;
/**
 * 添加同步记录（同时支持新增与更新）
 * 调用方式灵活：
 *   addSyncRecord(options) - 自动获取工作表
 *   addSyncRecord(sheet, record) - 指定工作表
 */
export declare function addSyncRecord(sheetOrOptions: any, record?: SyncRecord): boolean;
export declare function getOrCreateSyncRecordSheet(): any;
export declare function updateSyncRecord(sid: string, updates: UpdateRecordParams): boolean;
export declare function getAllSyncRecords(): SyncRecord[];
export declare function clearSyncRecords(confirmPrompt?: boolean): void;
export declare function activateSyncRecordSheet(): any;
export declare function finalizeSyncRecordBatch(): void;
export declare function openSyncRecordSheet(): void;
export declare function formatCurrentTime(): string;
export declare function fetchAndRecordBgCollections(_token: string, _userId: string, collections: any[]): void;
export declare function clearSheetMarksInSheet(sheetIndex: number): void;
//# sourceMappingURL=syncRecord.d.ts.map