/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.1.0
 */
export interface SyncRecord {
    seq?: number | string;
    id?: number;
    time?: string;
    name?: string;
    url?: string;
    sid?: string;
    type?: string;
    count?: number;
    content?: string;
    status?: string;
    message?: string;
    fingerprint?: string;
    collType?: string;
    row?: number;
}
export interface UpdateRecordParams {
    name?: string;
    url?: string;
    sid?: string;
    type?: string;
    content?: string;
    status?: string;
    message?: string;
    count?: number;
    fingerprint?: string;
    collType?: string;
    row?: number;
}
/**
 * 获取或创建同步记录工作表
 */
export declare function getOrCreateSyncRecordSheet(): any;
export declare function addSyncRecord(params: UpdateRecordParams): boolean;
export declare function getAllSyncRecords(): SyncRecord[];
export declare function deduplicateSyncRecords(): boolean;
export declare function formatSyncRecordSheet(): void;
export declare function clearSyncRecords(): boolean;
export declare function openSyncRecordSheet(): void;
export declare function clearSheetMarksInSheet(sheetIndex: number): void;
//# sourceMappingURL=syncRecord.d.ts.map