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
 *   - exceltobangumi/index.ts：常量、辅助函数、getFilterStatus、buildJsonPayload、SyncToBangumiAsync、syncSelectedRows 等
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版，保留原注释和日志)
 */
import type { WpsWorksheet } from '../../tools/wps.js';
export { isBangumiUrl, extractSubjectId, mapWatchStatus, getSeqColumnIndex, addTagsFromString, buildTagsArray, } from '../pure-utilities.js';
export { openBangumiTokenPage, testTokenValidityForRibbon, bgmRequestSync, setBangumiToken, notifyUserInfoUpdated, type BgmApiResponse, extractResponseMessage, parseErrorResponse, } from './api.js';
export { fetchEpisodeIds, markEpisodesComplete } from './chapter-marker.js';
export { type SyncTask, type SyncResultStats, TYPE_NAMES, DEFAULT_SEQ_COLUMN, markSyncResultColor, applySyncSuccessResults, applySyncFailResults, handleStoppedRemainingTasks, finalizeSyncResults, } from './progress-reporter.js';
/**
 * 批量读取数据并创建字段快速访问器
 *
 * 已收敛到 `tools/util/field-getter.ts` 的 {@link createBatchFieldGetter}
 * （矩形读 + 逐格回退，与 ribbon-service 的同步预览共用一份实现），
 * 此处经 `../../tools/util/index.js` 引入。
 */
/**
 * 获取筛选状态（可见行）
 * @param worksheetOrLastRow 工作表对象或最后行号（兼容旧用法）
 * @param lastRow 最后行号（当 worksheetOrLastRow 为工作表时）
 * @param headerRow 表头行号，用于排除
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export declare function getFilterStatus(worksheetOrLastRow?: WpsWorksheet | number, lastRow?: number, headerRow?: number, shouldDeepCheck?: boolean): {
    hasFilter: boolean;
    visibleRows: number[];
    hiddenRows: number[];
};
/**
 * 构建API请求的JSON Payload
 *
 * @function buildJsonPayload
 * @param getField - 按列名读取单元格值的取数函数
 * @param _finishedDate - 完播日期（预留，当前未参与构建）
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
    onItemComplete?: (row: number, isSuccess: boolean, result: {
        code: number;
        message: string;
    }) => void;
    /** 需要跳过的SID集合（冲突处理） */
    skipSubjectIds?: Set<string>;
    /** 是否启用增量同步（基于指纹） */
    incremental?: boolean;
}
export declare function SyncToBangumiAsync(worksheet: WpsWorksheet, columnMap: Map<string, number>, token: string, lastRow: number, headerRow: number, options?: SyncOptions): Promise<{
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