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
export declare function previewSyncContent(): void;
export declare function uploadSingleRow(rowNum: number, btnElement?: HTMLButtonElement): void;
export declare function showDetailModal(): void;
export declare function closeDetailModal(): void;
export declare function viewSyncRecordDetail(sid: string): void;
/**
 * 一键同步所有可见数据行（由 BGM.sync.startSync 调用）
 * - 依赖 BGM.dataPreview 中的预览数据
 * - 跳过无 Bangumi URL 或无法提取 Subject ID 的行
 * - 调用 bgmRequestSync 执行单条同步
 * - 标记成功/失败颜色，更新同步记录
 * - 通过事件总线通知进度
 * @returns 同步结果统计 { success: number; fail: number; skip: number }
 */
export declare function syncAllRows(): Promise<{
    success: number;
    fail: number;
    skip: number;
}>;
//# sourceMappingURL=preview.d.ts.map