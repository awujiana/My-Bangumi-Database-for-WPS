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
 * @param {any} [data] - 事件携带的数据
 */
export type EventHandler = (data?: any) => void;

/**
 * 事件条目接口
 *
 * @interface EventEntry
 */
interface EventEntry {
    /** 事件处理器 */
    handler: EventHandler;
    /** 是否为单次订阅 */
    once: boolean;
}

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
export class EventBus {
    /**
     * 事件存储
     * @private
     * @type {Map<string, EventEntry[]>}
     */
    private events: Map<string, EventEntry[]> = new Map();

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
    on(event: string, handler: EventHandler): () => void {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }

        const entry: EventEntry = { handler, once: false };
        this.events.get(event)!.push(entry);

        // 返回退订函数
        return () => this.off(event, handler);
    }

    /**
     * 退订事件
     *
     * @method off
     * @param {string} event - 事件名称
     * @param {EventHandler} handler - 要移除的事件处理器
     */
    off(event: string, handler: EventHandler): void {
        const entries = this.events.get(event);
        if (!entries) return;

        const index = entries.findIndex(e => e.handler === handler);
        if (index !== -1) {
            entries.splice(index, 1);
        }
    }

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
    emit(event: string, data?: any): void {
        const entries = this.events.get(event);
        if (!entries) return;

        // 复制一份，防止订阅/退订影响当前执行
        const entriesCopy = [...entries];

        for (const entry of entriesCopy) {
            try {
                entry.handler(data);
            } catch (e) {
                console.error(`[EventBus] Error in event handler for '${event}':`, e);
            }

            // 如果是单次订阅，处理后移除
            if (entry.once) {
                this.off(event, entry.handler);
            }
        }
    }

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
    once(event: string, handler: EventHandler): () => void {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }

        const entry: EventEntry = { handler, once: true };
        this.events.get(event)!.push(entry);

        return () => this.off(event, handler);
    }

    /**
     * 清除所有事件订阅
     *
     * @method clear
     */
    clear(): void {
        this.events.clear();
    }

    /**
     * 清除特定事件的所有订阅
     *
     * @method clearEvent
     * @param {string} event - 事件名称
     */
    clearEvent(event: string): void {
        this.events.delete(event);
    }

    /**
     * 获取事件订阅数量
     *
     * @method listenerCount
     * @param {string} event - 事件名称
     * @returns {number} 订阅数量
     */
    listenerCount(event: string): number {
        return this.events.get(event)?.length || 0;
    }
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
export const eventBus = new EventBus();

// 预定义事件常量
export const EVENTS = {
    SYNC_START: 'sync:start',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETE: 'sync:complete',
    SYNC_ERROR: 'sync:error',
    TOKEN_UPDATED: 'token:updated',
    USERID_UPDATED: 'userid:updated',
    PANEL_READY: 'panel:ready'
} as const;
export const BGM_EVENTS = {
    TOKEN_UPDATED:   'state:tokenUpdated',
    USER_ID_UPDATED: 'state:userIdUpdated',
    USER_NAME_UPDATED: 'state:userNameUpdated',
    SYNC_PROGRESS:   'sync:progress',
    SYNC_COMPLETED:  'sync:completed',
    SYNC_ERROR:      'sync:error',
    SHEET_LOCKED:    'sheet:locked',
    SHEET_UNLOCKED:  'sheet:unlocked',
} as const;