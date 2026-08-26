/**
 * 全局错误处理器
 * @module core/errorHandler
 * @description 提供全局未捕获异常和 Promise 拒绝的兜底处理。
 *              此处理只作为兜底，不能替代局部 try/catch 与 Promise.catch()。
 */
/**
 * 初始化全局错误处理器
 * 幂等调用，重复执行不会重复注册监听器。
 */
export declare function initGlobalErrorHandler(): void;
/**
 * 重置初始化状态（用于测试）
 * @internal
 */
export declare function resetErrorHandlerState(): void;
//# sourceMappingURL=errorHandler.d.ts.map