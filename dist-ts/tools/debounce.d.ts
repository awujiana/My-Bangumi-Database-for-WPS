/**
 * @fileoverview 防抖与节流工具
 * @module tools/debounce
 * @description 提供防抖（debounce）与节流（throttle）函数，
 *              用于高频事件（input、scroll、resize 等）的性能优化。
 */
/**
 * 防抖：在延迟期内只触发最后一次
 * @param function_ 要执行的函数
 * @param delay 延迟毫秒数，默认 300
 */
export declare function debounce<T extends (...arguments_: unknown[]) => unknown>(function_: T, delay?: number): (...arguments_: Parameters<T>) => void;
/**
 * 节流：在固定间隔内最多触发一次
 * @param function_ 要执行的函数
 * @param interval 间隔毫秒数，默认 300
 */
export declare function throttle<T extends (...arguments_: unknown[]) => unknown>(function_: T, interval?: number): (...arguments_: Parameters<T>) => void;
/** 取消防抖/节流的 timer（用于清理） */
export declare function clearDebounceTimer(_function_: (...arguments_: unknown[]) => void): void;
//# sourceMappingURL=debounce.d.ts.map