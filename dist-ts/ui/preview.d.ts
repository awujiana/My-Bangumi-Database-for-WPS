/**
 * 详细预览页面（模块化版）
 * @module ui/detail-preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */
import { WpsRange } from '../index.js';
export interface DetailItem {
    row: number;
    name: string;
    bgmUrl: string;
    sid: string;
    status: string;
    rate: string;
    tagsRaw: string;
    finishedDate: string;
    typeNum: number;
    isUploaded: boolean;
    urlCell: WpsRange | null;
}
export interface PreviewItem {
    html: string;
    type: number;
}
export interface DetailPreviewData {
    allItems: PreviewItem[];
    currentFilter: string;
    totalWithType: number;
    totalValid: number;
    totalUploaded: number;
    typeCount: Record<number, number>;
    uploadedCount: Record<number, number>;
}
export declare function previewSyncContent(): Promise<void>;
export declare function uploadSingleRow(rowNum: number, btnElement?: HTMLButtonElement): Promise<void>;
export declare function showDetailModal(): void;
export declare function closeDetailModal(): void;
export declare function viewSyncRecordDetail(sid: string): void;
export declare function syncAllRows(): Promise<{
    success: number;
    fail: number;
    skip: number;
}>;
//# sourceMappingURL=preview.d.ts.map