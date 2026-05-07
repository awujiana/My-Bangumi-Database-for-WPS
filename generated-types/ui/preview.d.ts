/**
 * 详细预览页面
 * @module ui/detail-preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */
interface ColumnMap extends Map<string, number> {
}
export declare function previewSyncContent(): void;
export declare function uploadSingleRow(rowNum: number, btnElement?: HTMLButtonElement): void;
export declare function updateUploadStats(): void;
export declare function filterDetailItems(filterType: string | number): void;
export declare function showDetailModal(): void;
export declare function closeDetailModal(): void;
export declare function viewSyncRecordDetail(sid: string): void;
export declare function buildPreviewPayload(ws: any, row: number, colMap: ColumnMap): string;
export declare function updateDetailCount(count: number): void;
export {};
//# sourceMappingURL=preview.d.ts.map