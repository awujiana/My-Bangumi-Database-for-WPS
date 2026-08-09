/**
 * 任务面板主模块 - 聚合入口
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑。
 *
 * 拆分结构（从原 taskpane.ts 拆分而来）：
 *   - taskpane/panelLifecycle.ts：工作表锁定/解锁、表头检测、筛选状态、预览渲染（toggleSheetLock、refreshSheets、refreshData、autoDetectSheet、updateFilterStatus 等）
 *   - taskpane/userInfoPolling.ts：用户信息恢复与轮询（restoreUserInfoFromStorage、startUserInfoPolling）
 *   - taskpane/index.ts：initPanel 初始化入口、window 全局挂载、自动初始化逻辑、re-export
 *
 * 备注：原计划中的 tokenDisplay.ts 未创建。原因：本文件中并无独立的 Token 显示逻辑，
 *       updateTokenStatus/updateUserIdStatus 等函数均来自 `../index.js`（实现在 handlers/token.ts），
 *       无可拆分内容。遵循"保守策略"，不为对齐文件清单而创建空模块。
 */
import { toggleSheetLock, refreshSheets, refreshWorkbooks, autoDetectSheet, updateFilterStatus, refreshData, onSelectModeChange } from './panelLifecycle.js';
declare function initPanel(): void;
export { initPanel, refreshSheets, refreshWorkbooks, refreshData, toggleSheetLock, onSelectModeChange, autoDetectSheet, updateFilterStatus, };
/**
 * 初始化任务面板。
 *
 * 显式入口函数，由 `ts/entry/taskpane-entry.ts` 调用。
 * 不在模块加载时自动执行，避免在测试或非 taskpane 上下文下意外触发副作用。
 *
 * 行为：
 *  - 若文档已加载完成（readyState === 'complete'），立即执行 safeInitPanel()
 *  - 否则推迟到 window load 事件后执行
 */
export declare function initTaskpane(): void;
//# sourceMappingURL=index.d.ts.map