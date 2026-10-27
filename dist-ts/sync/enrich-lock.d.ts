/**
 * 富化功能 - 目标工作表锁定 UI 适配层
 * @module sync/enrichLock
 * @description 富化页面的目标工作表选择与锁定 UI 控制器。
 *              与主面板共用 BGM.sheet 锁定状态，持久化键 `bgm_locked_sheet_<page>`，
 *              底层读写/扫描逻辑统一委托给 tools/locked-sheet.js（方案一）。
 */
/** 富化页面的锁定工作表引用解析（委托共享实现，保持向后兼容） */
export { findBangumiTargetSheets, findWorkbookByName } from '../tools/locked-sheet.js';
export { getLockedSheet as getLockedEnrichSheet } from '../tools/locked-sheet.js';
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
 * 锁定/解锁富化目标 Bangumi 追踪表工作表（写入共享 BGM.sheet 锁定状态）
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export declare function toggleEnrichWorkbookLock(sheetSelectId?: string, wbSelectId?: string, lockButtonId?: string, statusId?: string): void;
/**
 * 更新锁定按钮的文字和状态显示
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export declare function updateEnrichLockButton(lockButtonId?: string, statusId?: string): void;
/**
 * 按工作簿名称 + 工作表索引执行锁定（不依赖 UI 下拉框）
 * @param workbookName - 目标工作簿名称
 * @param sheetIndex - 目标工作表索引（1-based）
 * @returns 是否锁定成功
 */
export declare function lockEnrichWorkbookByName(workbookName: string, sheetIndex: number): boolean;
/**
 * 按**工作簿名 + 工作表名**定位并锁定（索引由名字反查）。
 *
 * 供「一键套用」使用：跨页数据上下文快照里存的是名字而非索引
 * （索引跨会话会因用户增删表而漂移，名字不会）。簿或表不存在时返回 false，
 * 由调用方把按钮置为「套用失败」——不静默锁定到别的表上。
 */
export declare function lockEnrichSheetByName(workbookName: string, sheetName: string): boolean;
/**
 * 初始化富化锁定模块（启动时调用）
 *
 * 流程：先尝试恢复共享持久化锁定；未恢复时自动扫描候选 Bangumi 追踪表，
 * 唯一候选直接自动锁定，多候选则预选首个并提示用户确认。
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export declare function initializeEnrichLock(wbSelectId?: string, sheetSelectId?: string, lockButtonId?: string, statusId?: string): void;
/**
 * 自动选择目标工作表：唯一候选直接锁定，多候选预选首个并提示确认。
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param lockButtonId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 * @returns 'locked' 已自动锁定 | 'preselected' 已预选待确认 | 'none' 未找到候选
 */
export declare function autoSelectEnrichTarget(wbSelectId?: string, sheetSelectId?: string, lockButtonId?: string, statusId?: string, options?: {
    force?: boolean;
}): 'locked' | 'preselected' | 'none';
//# sourceMappingURL=enrich-lock.d.ts.map