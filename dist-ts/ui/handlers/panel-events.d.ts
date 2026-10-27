/**
 * 面板消息监听与事件总线订阅
 * @module ui/handlers/panel-events
 * @description 从 handlers/index.ts 抽出：window message 监听（跨文档通知）+ 事件总线处理器
 *              （Token/用户/配置变更、同步进度与状态）+ 订阅注册。
 */
export declare function setupMessageListener(): void;
/**
 * 移除消息监听器，防止面板关闭后内存泄漏
 */
export declare function removeMessageListener(): void;
export declare function setupEventListeners(): void;
//# sourceMappingURL=panel-events.d.ts.map