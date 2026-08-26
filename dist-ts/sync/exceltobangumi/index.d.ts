/**
 * @fileoverview Excel到Bangumi同步模块 - 统一导出入口
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * 拆分结构：
 *   - exceltobangumi/api.ts：API 请求（bgmRequestSync、setBangumiToken、testTokenValidityForRibbon、openBangumiTokenPage、notifyUserInfoUpdated）
 *   - exceltobangumi/chapterMarker.ts：章节标记（fetchEpisodeIds、markEpisodesComplete）
 *   - exceltobangumi/progressReporter.ts：进度上报（SyncTask、applySyncSuccessResults、applySyncFailResults、handleStoppedRemainingTasks、finalizeSyncResults）
 *   - exceltobangumi/index.ts：常量、辅助函数、getFilterStatus、getSequentialRowsBySeqCol、buildJsonPayload、SyncToBangumiAsync、syncSelectedRows 等
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版，保留原注释和日志)
 */
import type { WpsWorksheet } from '../../tools/wps.js';
export { isBangumiUrl, extractSubjectId, mapWatchStatus, getSeqColIndex, addTagsFromStr, buildTagsArray, } from '../pureUtils.js';
export { openBangumiTokenPage, testTokenValidityForRibbon, bgmRequestSync, setBangumiToken, notifyUserInfoUpdated, type BgmApiResponse, extractResponseMessage, parseErrorResponse, } from './api.js';
export { fetchEpisodeIds, markEpisodesComplete } from './chapterMarker.js';
export { type SyncTask, type SyncResultStats, TYPE_NAMES, DEFAULT_SEQ_COL, markSyncResultColor, applySyncSuccessResults, applySyncFailResults, handleStoppedRemainingTasks, finalizeSyncResults, } from './progressReporter.js';
/**
 * 获取筛选状态（可见行）
 * @param wsOrLastRow 工作表对象或最后行号（兼容旧用法）
 * @param lastRow 最后行号（当 wsOrLastRow 为工作表时）
 * @param headerRow 表头行号，用于排除
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export declare function getFilterStatus(wsOrLastRow?: WpsWorksheet | number, lastRow?: number, headerRow?: number, deepCheck?: boolean): {
    hasFilter: boolean;
    visibleRows: number[];
    hiddenRows: number[];
};
/**
 * 根据序列号列获取连续的有效行
 *
 * @function getSequentialRowsBySeqCol
 * @param {number} startRow - 起始行
 * @param {number} endRow - 结束行
 * @param {Map<string, number>} [colMap] - 列映射（可选）
 * @returns {{ validRows: number[]; seqMap: Map<string, number> }} 有效行和序列号映射
 *
 * @description
 * 扫描序列号列，找出有序列号的数据行。
 * 序列号格式应为数字，用于标记同步进度。
 */
export declare function getSequentialRowsBySeqCol(startRow: number, endRow: number, colMap?: Map<string, number>): {
    validRows: number[];
    seqMap: Map<string, number>;
};
/**
 * 构建API请求的JSON Payload
 *
 * @function buildJsonPayload
 * @param {WpsWorksheet} ws - 工作表对象
 * @param {number} rowNum - 数据行号
 * @param {Map<string, number>} colMap - 列映射
 * @param {string} finishedDate - 完播日期
 * @returns {string} JSON格式的请求体
 *
 * @description
 * 根据工作表中的数据构建Bangumi API所需的JSON格式。
 * 包含字段：type（状态）、rate（评分）、tags（标签）、
 * comment（感言）、private（是否私有）
 */
export declare function buildJsonPayload(getField: (key: string) => string, _finishedDate: string): string;
/**
 * 同步选项接口
 */
export interface SyncOptions {
    /** 进度回调 */
    onProgress?: (current: number, total: number, message: string) => void;
    /** 单条完成回调 */
    onItemComplete?: (row: number, success: boolean, result: {
        code: number;
        message: string;
    }) => void;
    /** 需要跳过的SID集合（冲突处理） */
    skipSids?: Set<string>;
    /** 是否启用增量同步（基于指纹） */
    incremental?: boolean;
}
export declare function SyncToBangumiAsync(ws: WpsWorksheet, colMap: Map<string, number>, token: string, lastRow: number, headerRow: number, options?: SyncOptions): Promise<{
    success: number;
    fail: number;
    skip: number;
    stopped: boolean;
}>;
/**
 * 选中行同步到 Bangumi（多行/单行）
 *
 * @function syncSelectedRows
 */
export declare function syncSelectedRows(): Promise<void>;
//# sourceMappingURL=index.d.ts.map