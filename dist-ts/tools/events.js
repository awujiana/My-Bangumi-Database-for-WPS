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
 * 事件名称常量定义
 *
 * 事件命名规范：
 * - state: 前缀 → 应用状态变更（Token、用户信息、同步状态等）
 * - sync: 前缀 → 同步进度与结果
 * - sheet: 前缀 → 工作表操作
 * - config: 前缀 → 配置变更
 * - request: 前缀 → 组件间请求（Ribbon ↔ Panel）
 */
export const BGM_EVENTS = {
    // —— 通用状态变更（携带状态名和值） ——
    /** 任意应用状态变更，payload: { key: string, value: unknown } */
    STATE_CHANGED: 'state:changed',
    /** 应用配置变更，payload: { key: string, value: unknown } */
    CONFIG_CHANGED: 'config:changed',
    // —— 具体状态事件 ——
    TOKEN_UPDATED: 'state:tokenUpdated',
    USER_ID_UPDATED: 'state:userIdUpdated',
    USER_NAME_UPDATED: 'state:userNameUpdated',
    // —— 同步事件 ——
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_ERROR: 'sync:error',
    /** 同步状态变更（开始/暂停/恢复/停止/空闲） */
    SYNC_STATE_CHANGED: 'sync:stateChanged',
    // —— 工作表事件 ——
    SHEET_LOCKED: 'sheet:locked',
    SHEET_UNLOCKED: 'sheet:unlocked',
    // —— 配置事件 ——
    CONFIG_UPDATED: 'config:updated',
    // —— 跨组件请求 ——
    /** Ribbon 请求执行数据同步（远程仓库 → Excel） */
    REQUEST_GITHUB_SYNC: 'request:githubSync',
    /** Ribbon 请求撤销最近一次同步 */
    REQUEST_UNDO_LAST_SYNC: 'request:undoLastSync',
};
/**
 * 事件总线类
 * @class
 */
export class EventBus {
    events;
    constructor() {
        this.events = new Map();
    }
    /**
     * 订阅事件
     * @param {string} eventName - 事件名称
     * @param {EventHandler<T>} handler - 事件处理器
     * @param {boolean} [isOnce=false] - 是否只触发一次
     */
    on(eventName, handler, isOnce = false) {
        // 内部以 EventHandler<unknown> 存储，调用方传入的 EventHandler<T> 在运行时
        // 接收 emit 推送的实际 T 类型数据，此处断言是安全的（contravariance 限制仅类型层面）。
        const handlers = this.events.get(eventName) ?? [];
        handlers.push({ handler: handler, isOnce });
        this.events.set(eventName, handlers);
    }
    /**
     * 订阅事件（只触发一次）
     * @param {string} eventName - 事件名称
     * @param {EventHandler<T>} handler - 事件处理器
     */
    once(eventName, handler) {
        this.on(eventName, handler, true);
    }
    /**
     * 退订事件
     * @param {string} eventName - 事件名称
     * @param {EventHandler} [handler] - 事件处理器（不传则移除所有）
     */
    off(eventName, handler) {
        const handlers = this.events.get(eventName);
        if (!handlers)
            return;
        if (handler) {
            const index = handlers.findIndex((h) => h.handler === handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
        else {
            this.events.delete(eventName);
        }
    }
    /**
     * 发布事件
     * @param {string} eventName - 事件名称
     * @param {unknown} [data] - 事件数据
     */
    emit(eventName, data) {
        const handlers = this.events.get(eventName);
        if (!handlers || handlers.length === 0)
            return;
        // 创建副本以防止在处理过程中被修改
        const handlersCopy = [...handlers];
        for (const entry of handlersCopy) {
            try {
                entry.handler(data);
            }
            catch (error) {
                // 不依赖 BGM.handleError，避免循环依赖；直接输出到控制台
                // eslint-disable-next-line no-console -- console 是日志后端/启动兜底的唯一输出通道（事件总线异常兜底日志）
                console.error('[EventBus]', error);
            }
            if (entry.isOnce) {
                this.off(eventName, entry.handler);
            }
        }
    }
    /**
     * 检查是否有指定事件的订阅者
     * @param {string} eventName - 事件名称
     * @returns {boolean}
     */
    has(eventName) {
        const handlers = this.events.get(eventName);
        return !!(handlers && handlers.length > 0);
    }
    /**
     * 获取指定事件的订阅者数量
     * @param {string} eventName - 事件名称
     * @returns {number}
     */
    listenerCount(eventName) {
        const handlers = this.events.get(eventName);
        return handlers?.length ?? 0;
    }
    /**
     * 清空所有事件
     */
    clear() {
        this.events.clear();
    }
    /**
     * 便捷方法：发射通用状态变更事件
     * @param key - 状态键名
     * @param value - 状态值
     */
    emitStateChanged(key, value) {
        this.emit(BGM_EVENTS.STATE_CHANGED, { key, value });
    }
    /**
     * 便捷方法：发射通用配置变更事件
     * @param key - 配置键名
     * @param value - 配置值
     */
    emitConfigChanged(key, value) {
        this.emit(BGM_EVENTS.CONFIG_CHANGED, { key, value });
    }
}
// 创建全局事件总线实例
export const eventBus = new EventBus();
