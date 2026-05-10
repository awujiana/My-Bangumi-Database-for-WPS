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
export declare function updateUploadStats(): void;
export declare function filterDetailItems(filterType: string | number): void;
export declare function showDetailModal(): void;
export declare function closeDetailModal(): void;
export declare function viewSyncRecordDetail(sid: string): void;
//# sourceMappingURL=preview.d.ts.map