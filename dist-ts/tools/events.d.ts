/**
 * @fileoverview 事件总线模块
 * @module tools/events
 * @description 实现模块间的发布-订阅事件系统，提供松耦合的组件通信方式。
 *              支持事件的订阅、退订、单次订阅和发布。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
/**
 * 事件处理器类型
 *
 * @callback EventHandler
 * @param {unknown} data - 事件携带的数据（emit 不传时为 undefined）
 */
export type EventHandler<T = unknown> = (data: T) => void;
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
     * @param {EventHandler<T>} handler - 事件处理器
     * @param {boolean} [once=false] - 是否只触发一次
     */
    on<T = unknown>(eventName: string, handler: EventHandler<T>, once?: boolean): void;
    /**
     * 订阅事件（只触发一次）
     * @param {string} eventName - 事件名称
     * @param {EventHandler<T>} handler - 事件处理器
     */
    once<T = unknown>(eventName: string, handler: EventHandler<T>): void;
    /**
     * 退订事件
     * @param {string} eventName - 事件名称
     * @param {EventHandler} [handler] - 事件处理器（不传则移除所有）
     */
    off(eventName: string, handler?: EventHandler): void;
    /**
     * 发布事件
     * @param {string} eventName - 事件名称
     * @param {unknown} [data] - 事件数据
     */
    emit(eventName: string, data?: unknown): void;
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
export declare const BGM_EVENTS: {
    readonly TOKEN_UPDATED: "state:tokenUpdated";
    readonly USER_ID_UPDATED: "state:userIdUpdated";
    readonly USER_NAME_UPDATED: "state:userNameUpdated";
    readonly SYNC_PROGRESS: "sync:progress";
    readonly SYNC_COMPLETED: "sync:completed";
    readonly SYNC_ERROR: "sync:error";
    /** 同步状态变更（开始/暂停/恢复/停止/空闲） */
    readonly SYNC_STATE_CHANGED: "sync:stateChanged";
    readonly SHEET_LOCKED: "sheet:locked";
    readonly SHEET_UNLOCKED: "sheet:unlocked";
    readonly CONFIG_UPDATED: "config:updated";
    /** Ribbon 请求执行数据同步（远程仓库 → Excel） */
    readonly REQUEST_GITHUB_SYNC: "request:githubSync";
};
export declare const eventBus: EventBus;
//# sourceMappingURL=events.d.ts.map