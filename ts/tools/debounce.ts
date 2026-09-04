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
export function debounce<T extends (...arguments_: unknown[]) => unknown>(
  function_: T,
  delay = 300,
): (...arguments_: Parameters<T>) => void {
  let timerId: ReturnType<typeof setTimeout> | null = null
  return (...arguments_: Parameters<T>): void => {
    if (timerId !== null) {
      clearTimeout(timerId)
    }
    timerId = setTimeout(() => {
      function_(...arguments_)
      timerId = null
    }, delay)
  }
}

/**
 * 节流：在固定间隔内最多触发一次
 * @param function_ 要执行的函数
 * @param interval 间隔毫秒数，默认 300
 */
export function throttle<T extends (...arguments_: unknown[]) => unknown>(
  function_: T,
  interval = 300,
): (...arguments_: Parameters<T>) => void {
  let lastTime = 0
  let timerId: ReturnType<typeof setTimeout> | null = null
  return (...arguments_: Parameters<T>): void => {
    const now = Date.now()
    const remaining = interval - (now - lastTime)
    if (remaining <= 0) {
      if (timerId !== null) {
        clearTimeout(timerId)
        timerId = null
      }
      function_(...arguments_)
      lastTime = now
    } else {
      timerId ??= setTimeout(() => {
        function_(...arguments_)
        lastTime = Date.now()
        timerId = null
      }, remaining)
    }
  }
}

/** 取消防抖/节流的 timer（用于清理） */
export function clearDebounceTimer(function_: (...arguments_: unknown[]) => void): void {
  // 这是一个简单的清理辅助，实际清理需要在调用点保存 timerId
  void function_
}
