/**
 * @fileoverview Excel到Bangumi同步模块 (优化版)
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 * @author BGM Development Team
 * @version 1.1.0
 */
import { WpsWorksheet } from '../index.js';
/**
 * 打开Bangumi Token申请页面
 */
export declare function openBangumiTokenPage(): void;
/**
 * 测试Token有效性（Ribbon版本）
 */
export declare function testTokenValidityForRibbon(token?: string): void;
export declare function openUserCollection(): void;
export declare function extractSubjectId(input: string): string;
export declare function mapWatchStatus(status: string): number;
export declare function addTagsFromStr(tagSet: Set<string>, raw: string): void;
export declare function buildTagsArray(tagsRaw: string): string[];
export declare function getFilterStatus(lastRow?: number, headerRow?: number): {
    hasFilter: boolean;
    visibleRows: number[];
    hiddenRows: number[];
};
export declare function getSequentialRowsBySeqCol(startRow: number, endRow: number): {
    validRows: number[];
    seqMap: Map<string, number>;
};
export declare function buildJsonPayload(ws: any, rowNum: number, colMap: Map<string, number>, finishedDate: string): string;
export declare function bgmRequestSync(method: string, endpoint: string, jsonBody: string, token: string): {
    code: number;
    message: string;
};
export declare function setBangumiToken(token: string): boolean;
export declare function clearRowColors(): void;
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
export declare function SyncToBangumiAsync(ws: WpsWorksheet | null | undefined, colMap: Map<string, number>, token: string, lastRow: number, headerRow: number, options?: SyncOptions): Promise<{
    success: number;
    fail: number;
    skip: number;
    stopped: boolean;
}>;
export declare function clearSheetMarksInSheet(sheetIndex: number): void;
export declare function testSingleUpdate(): void;
//# sourceMappingURL=exceltobangumi.d.ts.map