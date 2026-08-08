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
export function debounce(fn, delay = 300) {
    let timerId = null;
    return (...args) => {
        if (timerId !== null) {
            clearTimeout(timerId);
        }
        timerId = setTimeout(() => {
            fn(...args);
            timerId = null;
        }, delay);
    };
}
/**
 * 节流：在固定间隔内最多触发一次
 * @param fn 要执行的函数
 * @param interval 间隔毫秒数，默认 300
 */
export function throttle(fn, interval = 300) {
    let lastTime = 0;
    let timerId = null;
    return (...args) => {
        const now = Date.now();
        const remaining = interval - (now - lastTime);
        if (remaining <= 0) {
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
            fn(...args);
            lastTime = now;
        }
        else if (timerId === null) {
            timerId = setTimeout(() => {
                fn(...args);
                lastTime = Date.now();
                timerId = null;
            }, remaining);
        }
    };
}
/** 取消防抖/节流的 timer（用于清理） */
export function clearDebounceTimer(fn) {
    // 这是一个简单的清理辅助，实际清理需要在调用点保存 timerId
    void fn;
}
//# sourceMappingURL=debounce.js.map