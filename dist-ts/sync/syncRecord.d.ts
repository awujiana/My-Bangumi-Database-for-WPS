/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.1.0
 */
import type { WpsWorksheet } from '../tools/wps.js';
export interface SyncRecord {
    seq?: number | string;
    id?: number;
    time?: string;
    name?: string;
    url?: string;
    sid?: string;
    type?: string;
    source?: string | undefined;
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
    source?: string | undefined;
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
export declare function getOrCreateSyncRecordSheet(): WpsWorksheet;
/**
 * 查找现有的同步记录工作表（不创建新表）
 * @returns 现有的同步记录工作表，若不存在则返回 null
 */
export declare function getSyncRecordSheetIfExists(): WpsWorksheet | null;
export declare function addSyncRecord(params: UpdateRecordParams): boolean;
/**
 * 批量写入同步记录
 *
 * 性能优化入口：相比逐条调用 addSyncRecord，本函数一次性计算所有新行的起始位置，
 * 并通过 Range.Value2 批量写入二维数组，显著减少 WPS COM 调用次数。
 * 对于已存在的 SID，仍按单条更新（合并次数）。
 *
 * @param records 待写入的记录数组
 * @returns 是否全部成功
 */
export declare function addSyncRecords(records: UpdateRecordParams[]): boolean;
/**
 * 写入汇总同步记录
 *
 * 用于记录一次批量同步的整体结果（如 GitHub 仓库同步结束后新增/更新/删除统计）。
 * 汇总行以 SID 为空标识，不参与按 SID 合并次数。
 *
 * @param params 汇总记录参数，建议 content 写"仓库同步汇总"，message 写统计信息
 * @returns 是否成功
 */
export declare function addSyncRecordSummary(params: UpdateRecordParams): boolean;
export declare function getAllSyncRecords(): SyncRecord[];
export declare function deduplicateSyncRecords(): boolean;
export declare function formatSyncRecordSheet(sheet?: WpsWorksheet): void;
export declare function clearSyncRecords(): boolean;
export declare function openSyncRecordSheet(scrollToRow?: number): void;
//# sourceMappingURL=syncRecord.d.ts.map