/**
 * 面板资源追踪（定时器 / DOM 监听器 / 事件总线监听器）
 * @module ui/handlers/resource-tracking
 * @description 从 handlers/index.ts 抽出：统一登记模块级资源，便于面板重新初始化前一次性清理，
 *              防止重复注册与内存泄漏。仅依赖 tools/events，无上层依赖。
 */
import type { EventHandler } from '../../tools/events.js';
/**
 * 受追踪的 setTimeout：将 timeoutId 加入模块级 Set，便于统一清理。
 * 回调执行时自动从 Set 中移除。
 */
export declare function trackedSetTimeout(function_: () => void, delay: number): ReturnType<typeof setTimeout>;
/**
 * 清理所有仍在等待的 setTimeout，防止面板关闭后回调仍被触发。
 */
export declare function clearAllPendingTimeouts(): void;
/**
 * 清理所有已追踪的监听器。
 * 在 initializeHandlers 重新初始化前调用，防止同一面板内重复注册。
 */
export declare function clearTrackedListeners(): void;
/**
 * 受追踪的 addEventListener：自动记录，便于统一清理。
 */
export declare function trackedAddEventListener(element: EventTarget, type: string, handler: EventListenerOrEventListenerObject): void;
/**
 * 受追踪的 eventBus.on：自动记录，便于统一清理。
 */
export declare function trackedEventBusOn<T = unknown>(eventName: string, handler: EventHandler<T>): void;
//# sourceMappingURL=resource-tracking.d.ts.map