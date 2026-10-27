/**
 * 任务面板 - 用户信息轮询
 * @module panel/userInfoPolling
 * @description 从 PluginStorage 恢复用户信息、定时轮询 Token/用户信息/配置变更。
 *              从原 panel 模块拆分而来，保持函数签名与行为不变。
 */
/**
 * 从 PluginStorage 恢复用户信息到内存缓存
 * Ribbon 设置的用户信息通过 PluginStorage 在 Ribbon 和 Panel 之间共享
 */
export declare function restoreUserInfoFromStorage(): void;
/**
 * 定时轮询 PluginStorage 检查用户信息和 Token 变更
 * 由于 WPS 中 Ribbon 和 Panel 是独立 iframe，postMessage 无法跨上下文通信，
 * 因此 Panel 需要定期从 PluginStorage 读取最新数据并更新 UI。
 */
/**
 * 工作簿开/关/切换的统一处理防抖（ms）
 *
 * 关闭工作簿时 WPS 主进程正在销毁簿，此间的 COM 往返全部排队——
 * momo 实测：一关簿就卡，卡到「已自动检测表头」toast 才弹出来。
 * 等 300ms 让主进程腾出手再访问；连续开关多个簿也合并成一次处理。
 */
export declare const WORKBOOK_CHANGE_DEBOUNCE_MS = 300;
export declare function startUserInfoPolling(): void;
//# sourceMappingURL=user-info-polling.d.ts.map