import type { WpsWorksheet } from '../../tools/wps.js';
/**
 * 同步任务项接口
 */
export interface SyncTask {
    rowNum: number;
    subjectId: string;
    bgmUrl: string;
    name: string;
    jsonBody: string;
    fingerprint?: string;
    type: number;
    epCount?: number;
}
/**
 * 同步结果统计对象类型（成功/失败/跳过/停止计数，会被 UI 更新层直接修改）
 */
export interface SyncResultStats {
    success: number;
    fail: number;
    skip: number;
    stopped: boolean;
}
/**
 * 观看状态类型名称映射（下标即数值：1=想看、2=看过、3=在看、4=搁置、5=抛弃）。
 *
 * 曾是本地字面量表且把 2/3 标反（「看过」标成「在看」），与 core/constants 的
 * WATCH_STATUS_MAP / COLLECTION_TYPE_NAMES 相反，导致同步记录「条目类型」列标签写反。
 * 现不再保留本地副本：名称一律取自 COLLECTION_TYPE_NAMES，TYPE_NAMES 仅作为其
 * 兼容别名转出（exceltobangumi/index.ts 等既有消费方不变）。
 */
export { COLLECTION_TYPE_NAMES as TYPE_NAMES } from '../../core/constants.js';
/** 序列号列默认索引 */
export declare const DEFAULT_SEQ_COLUMN = 4;
/**
 * 标记单元格同步结果颜色
 * @param worksheet 工作表
 * @param row 行号
 * @param isSuccess 是否成功
 * @param seqColumn 序列号列索引（可选，默认4）
 */
export declare function markSyncResultColor(worksheet: WpsWorksheet, row: number, isSuccess: boolean, seqColumn?: number): void;
/**
 * 应用成功任务结果到 UI 和记录（UI 更新层）
 * 标记单元格成功颜色 + 写入同步记录 + 累加成功计数。
 * @param worksheet 工作表
 * @param seqColumn 序列号列索引
 * @param successTasks 成功任务列表
 * @param result 结果统计对象（会被修改：累加 success）
 */
export declare function applySyncSuccessResults(worksheet: WpsWorksheet, seqColumn: number, successTasks: SyncTask[], result: SyncResultStats): void;
/**
 * 应用失败任务结果到 UI 和记录（UI 更新层）
 * 标记单元格失败颜色 + 写入同步记录 + 累加失败计数。
 * @param worksheet 工作表
 * @param seqColumn 序列号列索引
 * @param failTasks 失败任务列表
 * @param result 结果统计对象（会被修改：累加 fail）
 */
export declare function applySyncFailResults(worksheet: WpsWorksheet, seqColumn: number, failTasks: SyncTask[], result: SyncResultStats): void;
/**
 * 处理被停止时的剩余任务（UI 更新层）
 * 将未执行的任务统计为跳过，并设置 stopped 标志。
 * @param syncTasks 全部待同步任务列表
 * @param successTasks 已成功的任务列表
 * @param failTasks 已失败的任务列表
 * @param result 结果统计对象（会被修改：累加 skip、置 isStopped=true）
 */
export declare function handleStoppedRemainingTasks(syncTasks: SyncTask[], successTasks: SyncTask[], failTasks: SyncTask[], result: SyncResultStats): void;
/**
 * 批量更新 UI 和记录（协调函数 - 步骤 6）
 * 协调 applySyncSuccessResults → applySyncFailResults → handleStoppedRemainingTasks，
 * 完成标记颜色、写同步记录、统计剩余任务、reportProgress、BGM.setSyncComplete。
 * @param worksheet 工作表
 * @param seqColumn 序列号列索引
 * @param successTasks 成功任务列表
 * @param failTasks 失败任务列表
 * @param syncTasks 全部待同步任务列表
 * @param isStopped 是否被停止
 * @param result 同步结果统计对象（会被直接修改）
 * @param startTime 开始时间戳
 * @param reportProgress 进度回调
 */
export declare function finalizeSyncResults(worksheet: WpsWorksheet, seqColumn: number, successTasks: SyncTask[], failTasks: SyncTask[], syncTasks: SyncTask[], isStopped: boolean, result: SyncResultStats, startTime: number, reportProgress: (current: number, message: string) => void): void;
//# sourceMappingURL=progress-reporter.d.ts.map