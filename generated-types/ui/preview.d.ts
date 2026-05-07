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