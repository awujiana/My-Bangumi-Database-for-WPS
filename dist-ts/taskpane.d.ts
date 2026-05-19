/**
 * 任务面板主模块（TypeScript 版）
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑
 */
import { WpsWorksheet } from './index.js';
declare function toggleSheetLock(): void;
declare function refreshSheets(): void;
declare function autoDetectSheet(): {
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
    matchCount: number;
    colCount: number;
} | null;
declare function updateFilterStatus(targetWs?: WpsWorksheet): void;
declare function refreshData(): void;
declare function onSelectModeChange(): void;
declare function initPanel(): void;
export { initPanel, refreshSheets, refreshData, toggleSheetLock, onSelectModeChange, autoDetectSheet, updateFilterStatus };
//# sourceMappingURL=taskpane.d.ts.map