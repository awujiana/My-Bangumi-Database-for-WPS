/**
 * @fileoverview 同步记录管理模块 (优化版)
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
    row?: number;
}
/**
 * 获取或创建同步记录工作表
 */
export declare function getOrCreateSyncRecordSheet(): any;
/**
 * 添加或更新同步记录
 * @param params 记录参数
 * @returns 是否成功
 */
export declare function addSyncRecord(params: UpdateRecordParams): boolean;
/**
 * 获取所有同步记录 (返回缓存副本)
 */
export declare function getAllSyncRecords(): SyncRecord[];
/**
 * 清除所有同步记录 (保留表头)
 */
export declare function clearSyncRecords(): boolean;
/**
 * 激活并切换到同步记录工作表
 */
export declare function openSyncRecordSheet(): void;
/**
 * 清除指定工作表指定列的颜色颜色标记 (默认清除D列)
 * @param sheetIndex 工作表索引 (1-based)
 * @param columnLetter 要清除的列，默认为 'D'
 */
export declare function clearSheetMarksInSheet(sheetIndex: number, columnLetter?: string): void;
//# sourceMappingURL=syncRecord.d.ts.map