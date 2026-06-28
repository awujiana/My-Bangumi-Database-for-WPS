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
     * @param {EventHandler} handler - 事件处理器
     * @param {boolean} [once=false] - 是否只触发一次
     */
    on(eventName, handler, once = false) {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }
        this.events.get(eventName).push({ handler, once });
    }
    /**
     * 订阅事件（只触发一次）
     * @param {string} eventName - 事件名称
     * @param {EventHandler} handler - 事件处理器
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
            const index = handlers.findIndex(h => h.handler === handler);
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
                console.error('[EventBus]', error);
            }
            if (entry.once) {
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
        return handlers?.length || 0;
    }
    /**
     * 清空所有事件
     */
    clear() {
        this.events.clear();
    }
}
// 事件名称常量定义
export const BGM_EVENTS = {
    TOKEN_UPDATED: 'state:tokenUpdated',
    USER_ID_UPDATED: 'state:userIdUpdated',
    USER_NAME_UPDATED: 'state:userNameUpdated',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_ERROR: 'sync:error',
    SHEET_LOCKED: 'sheet:locked',
    SHEET_UNLOCKED: 'sheet:unlocked',
    CONFIG_UPDATED: 'config:updated',
};
// 创建全局事件总线实例
export const eventBus = new EventBus();
