/**
 * 全局错误处理器
 * @module core/errorHandler
 * @description 提供全局未捕获异常和 Promise 拒绝的兜底处理。
 *              此处理只作为兜底，不能替代局部 try/catch 与 Promise.catch()。
 */

let initialized = false

/**
 * 初始化全局错误处理器
 * 幂等调用，重复执行不会重复注册监听器。
 */
export function initGlobalErrorHandler(): void {
  if (initialized) return
  initialized = true

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      console.error('[unhandledrejection]', message)
      event.preventDefault()
    })
  }
}

/**
 * 重置初始化状态（用于测试）
 * @internal
 */
export function resetErrorHandlerState(): void {
  initialized = false
}
