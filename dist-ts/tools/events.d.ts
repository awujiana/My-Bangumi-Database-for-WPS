/**
 * 事件处理器类型
 *
 * @callback EventHandler
 * @param {any} [data] - 事件携带的数据
 */
export type EventHandler = (data?: any) => void;
/**
 * 事件总线类
 * @class
 */
export declare class EventBus {
    private events;
    constructor();
    /**
     * 订阅事件
     * @param {string} eventName - 事件名称
     * @param {EventHandler} handler - 事件处理器
     * @param {boolean} [once=false] - 是否只触发一次
     */
    on(eventName: string, handler: EventHandler, once?: boolean): void;
    /**
     * 订阅事件（只触发一次）
     * @param {string} eventName - 事件名称
     * @param {EventHandler} handler - 事件处理器
     */
    once(eventName: string, handler: EventHandler): void;
    /**
     * 退订事件
     * @param {string} eventName - 事件名称
     * @param {EventHandler} [handler] - 事件处理器（不传则移除所有）
     */
    off(eventName: string, handler?: EventHandler): void;
    /**
     * 发布事件
     * @param {string} eventName - 事件名称
     * @param {any} [data] - 事件数据
     */
    emit(eventName: string, data?: any): void;
    /**
     * 检查是否有指定事件的订阅者
     * @param {string} eventName - 事件名称
     * @returns {boolean}
     */
    has(eventName: string): boolean;
    /**
     * 获取指定事件的订阅者数量
     * @param {string} eventName - 事件名称
     * @returns {number}
     */
    listenerCount(eventName: string): number;
    /**
     * 清空所有事件
     */
    clear(): void;
}
export declare const BANGUMI_EVENTS: {
    readonly LOGIN_SUCCESS: "login:success";
    readonly LOGIN_FAILED: "login:failed";
    readonly LOGOUT: "logout";
    readonly SYNC_START: "sync:start";
    readonly SYNC_END: "sync:end";
    readonly SYNC_PROGRESS: "sync:progress";
    readonly SYNC_ERROR: "sync:error";
    readonly COLLECTION_UPDATED: "collection:updated";
    readonly SETTINGS_CHANGED: "settings:changed";
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
    readonly CONFIG_UPDATED: "config:updated";
};
export declare const eventBus: EventBus;
//# sourceMappingURL=events.d.ts.map