/**
 * 任务面板主模块 - 聚合入口
 * @module panel/panelPage
 * @description 面板初始化、事件绑定、核心逻辑。
 *
 * 模块拆分结构：
 *   - panel/panelLifecycle.ts：工作表锁定/解锁、表头检测、筛选状态、预览渲染
 *   - panel/userInfoPolling.ts：用户信息恢复与轮询
 *   - panel/enrichPage.ts：新番表富化 UI 控制器
 */
import { toggleSheetLock, refreshSheets, refreshWorkbooks, autoDetectSheet, updateFilterStatus, refreshData, onSelectModeChange, enlargePreview, autoDetectAndLockSheet } from './panelLifecycle.js';
declare function initPanel(): void;
export { initPanel, refreshSheets, refreshWorkbooks, refreshData, toggleSheetLock, onSelectModeChange, enlargePreview, autoDetectSheet, autoDetectAndLockSheet, updateFilterStatus, };
/**
 * 初始化任务面板。
 *
 * 显式入口函数，由 `ts/entry/panel-entry.ts` 调用。
 * 不在模块加载时自动执行，避免在测试或非 panel 上下文下意外触发副作用。
 *
 * 行为：
 *  - 若文档已加载完成（readyState === 'complete'），立即执行 safeInitPanel()
 *  - 否则推迟到 window load 事件后执行
 */
export declare function initTaskpane(): void;
//# sourceMappingURL=panelPage.d.ts.map