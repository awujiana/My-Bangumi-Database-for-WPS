/**
 * 任务面板主模块 - re-export 入口
 * @module taskpane
 * @description 兼容入口：原 taskpane.ts 已按职责拆分到 taskpane/ 子目录，
 *              此文件仅做 re-export，保持外部 import 路径 `'./taskpane.js'` 不变。
 *
 * 拆分结构：
 *   - taskpane/panelLifecycle.ts：工作表锁定/解锁、表头检测、筛选状态、预览渲染
 *   - taskpane/userInfoPolling.ts：用户信息恢复与轮询（PluginStorage）
 *   - taskpane/index.ts：initPanel 初始化、window 全局挂载、initTaskpane() 显式入口、re-export
 *
 * 注意：自 Task 13 重构后，taskpane/index.ts 不再在模块加载时自动初始化。
 *       显式初始化需调用 initTaskpane()，或通过 ts/entry/taskpane-entry.ts 入口模块触发。
 *       window.initPanel / window.refreshTaskpaneUI 仍在模块加载时挂载（仅为全局函数引用，无副作用）。
 */
export * from './taskpane/index.js';
//# sourceMappingURL=taskpane.d.ts.map