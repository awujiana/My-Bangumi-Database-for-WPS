/**
 * @fileoverview 防抖与节流工具
 * @module tools/debounce
 * @description 提供防抖（debounce）与节流（throttle）函数，
 *              用于高频事件（input、scroll、resize 等）的性能优化。
 */
/**
 * 防抖：在延迟期内只触发最后一次
 * @param fn 要执行的函数
 * @param delay 延迟毫秒数，默认 300
 */
export declare function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay?: number): (...args: Parameters<T>) => void;
/**
 * 节流：在固定间隔内最多触发一次
 * @param fn 要执行的函数
 * @param interval 间隔毫秒数，默认 300
 */
export declare function throttle<T extends (...args: unknown[]) => unknown>(fn: T, interval?: number): (...args: Parameters<T>) => void;
/** 取消防抖/节流的 timer（用于清理） */
export declare function clearDebounceTimer(fn: (...args: unknown[]) => void): void;
//# sourceMappingURL=debounce.d.ts.map