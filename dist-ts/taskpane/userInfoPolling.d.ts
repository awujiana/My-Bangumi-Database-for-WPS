/**
 * 任务面板 - 用户信息轮询
 * @module taskpane/userInfoPolling
 * @description 从 PluginStorage 恢复用户信息、定时轮询 Token/用户信息/配置变更。
 *              从原 taskpane.ts 拆分而来，保持函数签名与行为不变。
 */
/**
 * 从 PluginStorage 恢复用户信息到内存缓存
 * Ribbon 设置的用户信息通过 PluginStorage 在 Ribbon 和 Taskpane 之间共享
 */
export declare function restoreUserInfoFromStorage(): void;
/**
 * 定时轮询 PluginStorage 检查用户信息和 Token 变更
 * 由于 WPS 中 Ribbon 和 Taskpane 是独立 iframe，postMessage 无法跨上下文通信，
 * 因此 Taskpane 需要定期从 PluginStorage 读取最新数据并更新 UI。
 */
export declare function startUserInfoPolling(): void;
//# sourceMappingURL=userInfoPolling.d.ts.map