/**
 * UI 事件处理模块 - 入口与聚合
 * @module ui/handlers/index
 * @description 资源追踪、按钮监听、ACTION_HANDLERS 分发、消息监听、事件总线监听、
 *              配置 UI 回填等。同时 re-export 子模块的公开 API，保持原 handlers.ts 的外部接口。
 */
import { showConnectionTestDialog, hideConnectionTestDialog } from '../githubConfigDialog.js';
export { showTokenDialog, showUserIdDialog, updateTokenStatus, updateUserIdStatus, openUserCollection, testTokenValidity, testDebugConnection, showUserProfile, hideUserProfile, renewToken, } from './token.js';
export { syncFromPanel, syncCollectionFromBgm, syncFromBgmByAPI } from './sync.js';
export { cleanLockedDataSheet } from './sheet.js';
export { showConnectionTestDialog, hideConnectionTestDialog };
/**
 * 清理所有仍在等待的 setTimeout，防止面板关闭后回调仍被触发。
 */
export declare function clearAllPendingTimeouts(): void;
export declare function onAction(action: string): void;
export declare function setupButtonListeners(): void;
/**
 * 初始化 UI 事件处理模块。
 *
 * 显式入口函数，由 `ts/entry/taskpane-entry.ts` 调用。
 * 不在模块加载时自动执行，避免：
 *  - 模块加载期间触发 trackedSetTimeout(setupButtonListeners, 0)
 *  - 在测试环境（无 DOM/BGM 全局对象）下意外触发副作用
 *
 * 行为：
 *  - 根据 document.readyState 决定同步执行还是延迟到 DOMContentLoaded
 *  - 调用 setupButtonListeners() 注册按钮点击监听
 *  - 注册消息监听器（接收 token/userId 等更新通知）
 *  - 注册事件总线监听器（接收配置变更与同步进度通知）
 *  - 从配置恢复增量同步、跳过冲突 UI 状态
 */
export declare function initHandlers(): void;
/**
 * 移除消息监听器，防止面板关闭后内存泄漏
 */
export declare function removeMessageListener(): void;
//# sourceMappingURL=index.d.ts.map