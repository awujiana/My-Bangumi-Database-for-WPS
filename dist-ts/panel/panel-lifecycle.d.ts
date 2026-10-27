/**
 * 任务面板 - 工作表生命周期与预览渲染
 * @module panel/panelLifecycle
 * @description 工作表锁定/解锁、表头检测、筛选状态、预览渲染等核心 UI 逻辑。
 *              从原 panel 模块拆分而来，保持函数签名与行为不变。
 */
import type { WpsWorksheet } from '../index.js';
interface HeaderMeta {
    headerRow: number;
    headerNames: string[];
    isImportant: boolean[];
    dataStartRow: number;
    lastColumn: number;
    firstDataColumn: number;
    previewColumnStart: number;
    previewColumnEnd: number;
    previewColStartAbsolute: number;
    headerMatchCount: number;
}
export declare function toggleSheetLock(): void;
export declare function updateLockButton(): void;
export declare function refreshSheets(options?: {
    autoSelectActive?: boolean;
}): void;
/**
 * 刷新工作簿列表（所有打开的 Excel 工作簿）
 */
export declare function refreshWorkbooks(): void;
export declare function activateSheetIfNeeded(worksheet: WpsWorksheet): (() => void) | false;
export declare function detectHeaderAndColumns(worksheet: WpsWorksheet | null | undefined, options?: {
    visibleRowSet?: Set<number> | null;
    isFiltered?: boolean;
}): HeaderMeta;
export declare function autoDetectSheet(options?: {
    force?: boolean;
}): {
    workbookName: string;
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
    matchCount: number;
    columnCount: number;
} | null;
export declare function updateFilterStatus(targetWorksheet?: WpsWorksheet): void;
export declare function refreshData(): void;
export declare function onSelectModeChange(): void;
export declare function enlargePreview(): void;
/**
 * 跨所有已打开工作簿自动检测追踪表，找到后锁定该工作表并刷新预览
 * 返回 true 表示成功检测并锁定，false 表示未找到有效追踪表
 */
export declare function autoDetectAndLockSheet(options?: {
    force?: boolean;
}): boolean;
export {};
//# sourceMappingURL=panel-lifecycle.d.ts.map