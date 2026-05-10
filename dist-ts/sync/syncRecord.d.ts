/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
/**
 * 同步记录接口
 *
 * @interface SyncRecord
 */
export interface SyncRecord {
    /** 记录ID */
    id?: number;
    /** 同步时间 */
    time?: string;
    /** 条目名称 */
    name?: string;
    /** 条目URL */
    url?: string;
    /** 条目SID */
    sid?: string;
    /** 条目类型 */
    type?: string;
    /** 同步次数 */
    count?: number;
    /** 同步内容/Payload */
    content?: string;
    /** 同步状态 */
    status?: string;
    /** 备注/错误信息 */
    message?: string;
}
/**
 * 更新记录参数接口
 *
 * @interface UpdateRecordParams
 */
export interface UpdateRecordParams {
    /** 条目名称 */
    name?: string;
    /** 条目URL */
    url?: string;
    /** 条目SID */
    sid?: string;
    /** 条目类型 */
    type?: string;
    /** 同步内容 */
    content?: string;
    /** 同步状态 */
    status?: string;
    /** 备注信息 */
    message?: string;
    /** 同步次数 */
    count?: number;
}
/**
 * 获取或创建同步记录工作表
 *
 * @function getOrCreateSyncRecordSheet
 * @returns {any} 工作表对象
 *
 * @description
 * 如果「同步记录」工作表不存在，则创建一个新的。
 * 工作表包含10列：序号、时间、名称、URL、SID、类型、次数、内容、状态、备注
 */
/**
 * 获取或创建同步记录工作表
 *
 * @function getOrCreateSyncRecordSheet
 * @returns {any} 工作表对象
 */
export declare function getOrCreateSyncRecordSheet(): any;
/**
 * 添加同步记录
 *
 * @function addSyncRecord
 * @param {UpdateRecordParams} params - 记录参数
 * @returns {boolean} 是否添加成功
 *
 * @description
 * 如果该SID已有记录，则更新现有记录并增加计数。
 * 否则添加新记录。
 */
export declare function addSyncRecord(params: UpdateRecordParams): boolean;
/**
 * 获取所有同步记录
 *
 * @function getAllSyncRecords
 * @returns {SyncRecord[]} 所有同步记录数组
 *
 * @description
 * 从缓存中返回所有同步记录。
 * 如果缓存无效，会先重建缓存。
 */
export declare function getAllSyncRecords(): SyncRecord[];
/**
 * 清除所有同步记录
 *
 * @function clearSyncRecords
 * @returns {boolean} 是否清除成功
 */
export declare function clearSyncRecords(): boolean;
/**
 * 打开同步记录工作表
 *
 * @function openSyncRecordSheet
 */
export declare function openSyncRecordSheet(): void;
/**
 * 清除指定工作表的颜色标记
 *
 * @function clearSheetMarksInSheet
 * @param {number} sheetIndex - 工作表索引
 */
export declare function clearSheetMarksInSheet(sheetIndex: number): void;
//# sourceMappingURL=syncRecord.d.ts.map