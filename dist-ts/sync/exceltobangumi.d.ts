/**
 * Bangumi API 同步模块（修复版）
 * @module bangumi
 * @description 从 Excel 读取条目并批量同步到 Bangumi 收藏
 */
import { BatchSyncResult } from '../core/result.js';
interface FilterStatus {
    hasFilter: boolean;
    filteredColumns: Array<{
        column: number;
        columnName: string;
        criteria: string;
    }>;
    hiddenRows: number[];
    visibleRows: number[];
    filterDetails: string;
    columnCounts: {
        [key: number]: {
            [key: string]: number;
        };
    };
    totalRows: number;
    visibleCount: number;
    hiddenCount: number;
}
interface SequentialRowsResult {
    validRows: number[];
    filteredRows: Array<{
        startSeq: number;
        endSeq: number;
        count: number;
        afterRow: number;
    }>;
    totalFiltered: number;
    hasFilter: boolean;
    visibleCount: number;
    hiddenCount: number;
}
interface SyncOptions {
    onProgress?: (current: number, total: number, message: string) => void;
    onItemComplete?: (row: number, success: boolean, result: {
        code: number;
        message: string;
    }) => void;
}
interface ColumnMap extends Map<string, number> {
}
export declare const HEADER_KEYWORDS: string[];
export declare const IMPORTANT_COLS: {
    [key: string]: boolean;
};
export declare function parseJsonBodySummary(jsonStr: string): string;
export declare function isEmptyValue(val: any): boolean;
export declare function getDataSheet(): any;
export declare function getBgmtoken(): string | null;
export declare function getLastRow(ws: any): number;
export declare function extractSubjectId(url: string): string;
export declare function findHeaderRow(ws: any, startRow?: number): number;
export declare function getColumnMap(ws: any, headerRow: number): ColumnMap;
export declare function mapWatchStatus(status: any): number;
export declare function addTagsFromStr(tagSet: Set<string>, raw: any): void;
export declare function buildJsonPayload(ws: any, row: number, colMap: ColumnMap, finishedDate: any): string;
export declare function bgmRequestSync(method: string, endpoint: string, body: any, token: string): {
    code: number;
    message: string;
};
export declare function bgmRequest(method: string, endpoint: string, body: any, token: string): Promise<{
    code: number;
    message: string;
}>;
export declare function SyncToBangumi(): BatchSyncResult | undefined;
export declare function syncToBangumiAsync(ws: any, colMap: ColumnMap, token: string, lastRow: number, headerRow: number, options?: SyncOptions): Promise<BatchSyncResult>;
export declare function getFilterStatus(endRow?: number, getColumnCounts?: boolean): FilterStatus | null;
export declare function getColumnValueCounts(ws: any, endRow: number): {
    [key: number]: {
        [key: string]: number;
    };
};
export declare function getVisibleRows(): number[];
export declare function getFilteredRows(): number[];
export declare function getSequentialRowsBySeqCol(startRow?: number, endRow?: number): SequentialRowsResult;
export declare function clearRowColors(): void;
export declare function testSingleUpdate(): void;
export declare function previewSubjectIdExtraction(): void;
export declare function previewJsonPayload(): void;
export declare function setBangumiToken(): void;
export declare function openBangumiTokenPage(): void;
export declare function testTokenValidityForRibbon(token: string): void;
export declare function openUserCollection(): void;
export declare function buildTagsArray(tagsStr: string): string[];
export {};
//# sourceMappingURL=exceltobangumi.d.ts.map