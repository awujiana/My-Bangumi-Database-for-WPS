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
interface PreviewRow {
    row: number;
    columns: string[] | {
        text: string;
        important: boolean;
    }[];
    isHeader: boolean;
    aligned: boolean;
    isImportant?: boolean[];
}
/**
 * 一次预览的完整数据快照
 *
 * 放大预览**必须**用它重新渲染，而不是从 `#previewBox` 里偷 `innerHTML`：
 * 克隆 DOM 会连带复制面板里的布局约束（`max-height: 300px`、窄窗格宽度），
 * 于是「放大」只放大了外框、表格还是按面板的列宽排版；而且克隆出来的节点
 * 不经过 {@link renderPreviewTable}，两份 HTML 迟早不一致。
 */
export interface PreviewSnapshot {
    rows: PreviewRow[];
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
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
/**
 * 放大预览
 *
 * 数据源是 {@link lastPreviewSnapshot}，渲染走 {@link renderPreviewTable} ——
 * 和面板内预览是**同一个出口**。此前是 `previewBox.innerHTML` 直接克隆：
 * 克隆会把面板的布局约束（300px 高度、窄窗格列宽）一起搬进模态框，等于只放大了
 * 外框；而且克隆出来的 DOM 绕过了渲染函数，两处结构一旦改动就会静默分叉。
 *
 * @param snapshot 仅供测试注入；生产路径用模块内快照
 */
export declare function enlargePreview(snapshot?: PreviewSnapshot | null): void;
/**
 * 跨所有已打开工作簿自动检测追踪表，找到后锁定该工作表并刷新预览
 * 返回 true 表示成功检测并锁定，false 表示未找到有效追踪表
 */
export declare function autoDetectAndLockSheet(options?: {
    force?: boolean;
}): boolean;
export {};
//# sourceMappingURL=panel-lifecycle.d.ts.map