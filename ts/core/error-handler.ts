/**
 * 全局错误处理器
 * @module core/errorHandler
 * @description 提供全局未捕获异常和 Promise 拒绝的兜底处理。
 *              此处理只作为兜底，不能替代局部 try/catch 与 Promise.catch()。
 */

let isInitialized = false

/**
 * 初始化全局错误处理器
 * 幂等调用，重复执行不会重复注册监听器。
 */
export function initGlobalErrorHandler(): void {
  if (isInitialized) return
  isInitialized = true

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason)
      // eslint-disable-next-line no-console -- console 是日志后端/启动兜底的唯一输出通道（未捕获异常兜底日志）
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
  isInitialized = false
}
