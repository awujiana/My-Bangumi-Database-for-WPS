/**
 * 富化功能 - 工作簿锁定模块
 * @module sync/enrichLock
 * @description 管理富化功能的 Bangumi 追踪表工作簿选择与锁定。
 *              与 Taskpane 的 BGM.sheet 锁定独立，使用 BGM.enrich 命名空间，
 *              通过 PluginStorage 键 `bgm_enrich_locked_workbook` 持久化。
 */
import type { WpsWorkbook, WpsWorksheet } from '../index.js';
interface LockedWorkbookInfo {
    workbookName: string;
    sheetName: string;
    sheetIndex: number;
}
/**
 * 刷新所有打开的 Excel 工作簿列表到 UI 下拉框
 * @param selectId - 工作簿选择下拉框的 DOM ID
 */
export declare function refreshEnrichWorkbooks(selectId?: string): void;
/**
 * 刷新指定工作簿的工作表列表到 UI 下拉框
 * @param workbookName - 目标工作簿名称，为空则使用下拉框当前值
 * @param selectId - 工作表选择下拉框的 DOM ID
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 */
export declare function refreshEnrichSheets(workbookName?: string, selectId?: string, wbSelectId?: string): void;
/**
 * 锁定/解锁富化目标 Bangumi 追踪表工作表
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param lockBtnId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export declare function toggleEnrichWorkbookLock(sheetSelectId?: string, wbSelectId?: string, lockBtnId?: string, statusId?: string): void;
/**
 * 更新锁定按钮的文字和状态显示
 * @param lockBtnId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export declare function updateEnrichLockButton(lockBtnId?: string, statusId?: string): void;
/**
 * 保存锁定信息到 PluginStorage
 * @param info - 锁定信息（null 表示清除）
 */
export declare function saveEnrichLockedWorkbook(info: LockedWorkbookInfo | null): void;
/**
 * 从 PluginStorage 恢复锁定状态，并校验工作簿/工作表是否仍存在
 * @returns 是否成功恢复
 */
export declare function restoreEnrichLockedWorkbook(): boolean;
/**
 * 获取当前锁定的 Bangumi 追踪表工作簿和工作表引用
 * @returns [WpsWorkbook, WpsWorksheet] 元组，未锁定或引用失效返回 null
 */
export declare function getLockedEnrichSheet(): [WpsWorkbook, WpsWorksheet] | null;
/**
 * 根据工作簿名称查找 WpsWorkbook 对象
 * @param name - 工作簿名称
 * @returns WpsWorkbook 对象或 null
 */
export declare function findWorkbookByName(name: string | null): WpsWorkbook | null;
/**
 * 在指定工作簿中查找工作表
 * @param wbName - 工作簿名称
 * @param sheetName - 工作表名称
 * @returns WpsWorksheet 对象或 null
 */
export declare function findSheetInWorkbook(wbName: string, sheetName: string): WpsWorksheet | null;
/**
 * 初始化富化锁定模块（启动时调用）
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param lockBtnId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export declare function initEnrichLock(wbSelectId?: string, sheetSelectId?: string, lockBtnId?: string, statusId?: string): void;
export {};
//# sourceMappingURL=enrichLock.d.ts.map