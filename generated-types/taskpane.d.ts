/**
 * 面板初始化
 */
export function initPanel(): void;
/**
 * 刷新工作表列表
 */
export function refreshSheets(): void;
/**
 * 刷新数据预览
 */
export function refreshData(): void;
/**
 * 切换工作表锁定状态，并缓存到 PluginStorage
 */
export function toggleSheetLock(): void;
/**
 * 模式切换处理
 */
export function onSelectModeChange(): void;
/**
 * 获取 BGM 收藏数据（委托给 handlers.js 增强版）
 */
export function fetchBgCollectionRecords(): void;
/**
 * 清除同步记录
 * 实际实现在 syncRecord.js 中，这里作为转发入口
 */
export function clearSyncRecords(): void;
import { markUploadedItems } from './ui/handlers.js';
/**
 * 标记已上传条目（当前选择的工作表）
 */
export function markUploadedItemsDefault(): void;
import { clearSheetMarks } from './ui/handlers.js';
/**
 * 清除工作表标记（当前选择的工作表）
 */
export function clearSheetMarksDefault(): void;
/**
 * 自动检测包含数据表头的工作表并选中
 * 扫描所有工作表，找表头匹配度最高的，自动选中、锁定、预览
 * @returns {{ sheetIndex: number, sheetName: string, headerRow: number, matchCount: number }|null}
 */
export function autoDetectSheet(): {
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
    matchCount: number;
} | null;
/**
 * 更新筛选状态显示（增强版：显示筛选列名、条件、可见/隐藏行数）
 */
export function updateFilterStatus(targetWs: any): void;
export { markUploadedItems, clearSheetMarks };
//# sourceMappingURL=taskpane.d.ts.map