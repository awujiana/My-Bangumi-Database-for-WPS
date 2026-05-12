/**
 * 事件处理器类型
 *
 * @callback EventHandler
 * @param {any} [data] - 事件携带的数据
 */
export type EventHandler = (data?: any) => void;
/**
 * 事件总线类
 * 实现发布-订阅模式，支持多个订阅者订阅同一事件
 *
 * @class EventBus
 *
 * @example
 * // 订阅事件
 * const unsubscribe = eventBus.on('sync:complete', (data) => {
 *     console.log('同步完成:', data);
 * });
 *
 * // 发布事件
 * eventBus.emit('sync:complete', { success: 10, fail: 2 });
 *
 * // 退订
 * unsubscribe();
 */
export declare class EventBus {
    /**
     * 事件存储
     * @private
     * @type {Map<string, EventEntry[]>}
     */
    private events;
    /**
     * 订阅事件
     *
     * @method on
     * @param {string} event - 事件名称
     * @param {EventHandler} handler - 事件处理器
     * @returns {() => void} 退订函数
     *
     * @example
     * const unsubscribe = eventBus.on('user:login', (user) => {
     *     console.log('用户登录:', user);
     * });
     */
    on(event: string, handler: EventHandler): () => void;
    /**
     * 退订事件
     *
     * @method off
     * @param {string} event - 事件名称
     * @param {EventHandler} handler - 要移除的事件处理器
     */
    off(event: string, handler: EventHandler): void;
    /**
     * 发布事件
     *
     * @method emit
     * @param {string} event - 事件名称
     * @param {any} [data] - 事件数据
     *
     * @example
     * eventBus.emit('sync:progress', { current: 5, total: 10 });
     */
    emit(event: string, data?: any): void;
    /**
     * 单次订阅
     * 事件触发一次后自动退订
     *
     * @method once
     * @param {string} event - 事件名称
     * @param {EventHandler} handler - 事件处理器
     * @returns {() => void} 退订函数
     *
     * @example
     * eventBus.once('app:ready', () => {
     *     console.log('应用已就绪');
     * });
     */
    once(event: string, handler: EventHandler): () => void;
    /**
     * 清除所有事件订阅
     *
     * @method clear
     */
    clear(): void;
    /**
     * 清除特定事件的所有订阅
     *
     * @method clearEvent
     * @param {string} event - 事件名称
     */
    clearEvent(event: string): void;
    /**
     * 获取事件订阅数量
     *
     * @method listenerCount
     * @param {string} event - 事件名称
     * @returns {number} 订阅数量
     */
    listenerCount(event: string): number;
}
/**
 * 全局事件总线实例
 *
 * @constant
 * @type {EventBus}
 *
 * @description
 * 预定义事件列表：
 * - sync:start - 开始同步
 * - sync:progress - 同步进度更新
 * - sync:complete - 同步完成
 * - sync:error - 同步出错
 * - token:updated - Token更新
 * - userid:updated - UserID更新
 * - panel:ready - 面板就绪
 */
export declare const eventBus: EventBus;
export declare const EVENTS: {
    readonly SYNC_START: "sync:start";
    readonly SYNC_PROGRESS: "sync:progress";
    readonly SYNC_COMPLETE: "sync:complete";
    readonly SYNC_ERROR: "sync:error";
    readonly TOKEN_UPDATED: "token:updated";
    readonly USERID_UPDATED: "userid:updated";
    readonly PANEL_READY: "panel:ready";
};
export declare const BGM_EVENTS: {
    readonly TOKEN_UPDATED: "state:tokenUpdated";
    readonly USER_ID_UPDATED: "state:userIdUpdated";
    readonly USER_NAME_UPDATED: "state:userNameUpdated";
    readonly SYNC_PROGRESS: "sync:progress";
    readonly SYNC_COMPLETED: "sync:completed";
    readonly SYNC_ERROR: "sync:error";
    readonly SHEET_LOCKED: "sheet:locked";
    readonly SHEET_UNLOCKED: "sheet:unlocked";
};
//# sourceMappingURL=events.d.ts.map