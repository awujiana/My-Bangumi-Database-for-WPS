/**
 * 任务面板 - 工作表生命周期与预览渲染
 * @module taskpane/panelLifecycle
 * @description 工作表锁定/解锁、表头检测、筛选状态、预览渲染等核心 UI 逻辑。
 *              从原 taskpane.ts 拆分而来，保持函数签名与行为不变。
 */
import type { WpsWorksheet } from '../index.js';
interface LockedSheetInfo {
    index: number;
    name: string;
}
interface HeaderMeta {
    headerRow: number;
    headerNames: string[];
    isImportant: boolean[];
    dataStartRow: number;
    lastCol: number;
    firstDataCol: number;
    previewColStart: number;
    previewColEnd: number;
    previewColStartAbsolute: number;
    headerMatchCount: number;
}
export declare function toggleSheetLock(): void;
export declare function saveLockedSheet(info: LockedSheetInfo | null): void;
export declare function restoreLockedSheet(): boolean;
export declare function updateLockButton(): void;
export declare function refreshSheets(opts?: {
    autoSelectActive?: boolean;
}): void;
export declare function activateSheetIfNeeded(ws: WpsWorksheet): (() => void) | false;
export declare function detectHeaderAndColumns(ws: WpsWorksheet | null | undefined, opts?: {
    visibleRowSet?: Set<number> | null;
    isFiltered?: boolean;
}): HeaderMeta;
export declare function autoDetectSheet(): {
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
    matchCount: number;
    colCount: number;
} | null;
export declare function updateFilterStatus(targetWs?: WpsWorksheet): void;
export declare function refreshData(): void;
export declare function onSelectModeChange(): void;
export {};
//# sourceMappingURL=panelLifecycle.d.ts.map