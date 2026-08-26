import type { WpsWorksheet } from '../../tools/wps.js';
/**
 * 同步任务项接口
 */
export interface SyncTask {
    rowNum: number;
    sid: string;
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
export type SyncResultStats = {
    success: number;
    fail: number;
    skip: number;
    stopped: boolean;
};
/** 观看状态类型名称映射 (优化点：提取常量) */
export declare const TYPE_NAMES: Record<number, string>;
/** 序列号列默认索引 */
export declare const DEFAULT_SEQ_COL = 4;
/**
 * 标记单元格同步结果颜色
 * @param ws 工作表
 * @param row 行号
 * @param isSuccess 是否成功
 * @param seqCol 序列号列索引（可选，默认4）
 */
export declare function markSyncResultColor(ws: WpsWorksheet, row: number, isSuccess: boolean, seqCol?: number): void;
/**
 * 应用成功任务结果到 UI 和记录（UI 更新层）
 * 标记单元格成功颜色 + 写入同步记录 + 累加成功计数。
 * @param ws 工作表
 * @param seqCol 序列号列索引
 * @param successTasks 成功任务列表
 * @param result 结果统计对象（会被修改：累加 success）
 */
export declare function applySyncSuccessResults(ws: WpsWorksheet, seqCol: number, successTasks: SyncTask[], result: SyncResultStats): void;
/**
 * 应用失败任务结果到 UI 和记录（UI 更新层）
 * 标记单元格失败颜色 + 写入同步记录 + 累加失败计数。
 * @param ws 工作表
 * @param seqCol 序列号列索引
 * @param failTasks 失败任务列表
 * @param result 结果统计对象（会被修改：累加 fail）
 */
export declare function applySyncFailResults(ws: WpsWorksheet, seqCol: number, failTasks: SyncTask[], result: SyncResultStats): void;
/**
 * 处理被停止时的剩余任务（UI 更新层）
 * 将未执行的任务统计为跳过，并设置 stopped 标志。
 * @param syncTasks 全部待同步任务列表
 * @param successTasks 已成功的任务列表
 * @param failTasks 已失败的任务列表
 * @param result 结果统计对象（会被修改：累加 skip、置 stopped=true）
 */
export declare function handleStoppedRemainingTasks(syncTasks: SyncTask[], successTasks: SyncTask[], failTasks: SyncTask[], result: SyncResultStats): void;
/**
 * 批量更新 UI 和记录（协调函数 - 步骤 6）
 * 协调 applySyncSuccessResults → applySyncFailResults → handleStoppedRemainingTasks，
 * 完成标记颜色、写同步记录、统计剩余任务、reportProgress、BGM.setSyncComplete。
 * @param ws 工作表
 * @param seqCol 序列号列索引
 * @param successTasks 成功任务列表
 * @param failTasks 失败任务列表
 * @param syncTasks 全部待同步任务列表
 * @param stopped 是否被停止
 * @param result 同步结果统计对象（会被直接修改）
 * @param startTime 开始时间戳
 * @param reportProgress 进度回调
 */
export declare function finalizeSyncResults(ws: WpsWorksheet, seqCol: number, successTasks: SyncTask[], failTasks: SyncTask[], syncTasks: SyncTask[], stopped: boolean, result: SyncResultStats, startTime: number, reportProgress: (current: number, message: string) => void): void;
//# sourceMappingURL=progressReporter.d.ts.map