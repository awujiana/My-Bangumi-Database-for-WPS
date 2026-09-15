/**
 * @fileoverview 全局错误处理器测试
 *
 * 覆盖 `ts/core/error-handler.ts`：
 *   - `initGlobalErrorHandler()` 注册 `unhandledrejection` 监听并兜底日志
 *   - `Error` 与非 `Error`（字符串 / 对象）两种 reason 的处理
 *   - 幂等性：重复调用不得重复注册监听器
 *   - 无 `window` 环境（纯 Node）下静默跳过
 *
 * 测试环境：jsdom（需要真实的 `window.addEventListener` / `Event`）
 *
 * ⚠️ 为什么用「增量计数」而不是固定次数断言：
 *   `initGlobalErrorHandler()` 每次调用都会创建**新的**箭头函数监听器，
 *   幂等靠模块内的 `isInitialized` 标志实现；`resetErrorHandlerState()` 会把标志复位，
 *   因此同文件内后一个用例会叠加上前面用例注册的监听器。固定次数断言必然随用例顺序
 *   变动而失效，故用「同一次 dispatch 前后的调用数增量」来判定是否新增了监听器。
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  initGlobalErrorHandler,
  resetErrorHandlerState,
} from '../ts/core/error-handler.js'

/** 构造一个 unhandledrejection 事件并派发；返回 preventDefault 的 spy 以便断言 */
function dispatchRejection(reason: unknown): ReturnType<typeof vi.fn> {
  const preventDefault = vi.fn()
  const event = Object.assign(new Event('unhandledrejection'), { reason, preventDefault })
  window.dispatchEvent(event)
  return preventDefault
}

describe('core/error-handler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('应记录 Error reason 的消息并调用 preventDefault（阻止默认控制台噪音）', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetErrorHandlerState()
    initGlobalErrorHandler()

    const preventDefault = dispatchRejection(new Error('promise 炸了'))

    expect(errorSpy).toHaveBeenCalledWith('[unhandledrejection]', 'promise 炸了')
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('非 Error 的 reason 应使用 String() 兜底', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetErrorHandlerState()
    initGlobalErrorHandler()

    dispatchRejection('字符串原因')
    expect(errorSpy).toHaveBeenCalledWith('[unhandledrejection]', '字符串原因')

    errorSpy.mockClear()
    dispatchRejection({ code: 500 })
    expect(errorSpy).toHaveBeenCalledWith('[unhandledrejection]', '[object Object]')
  })

  it('重复调用是幂等的，不会重复注册监听器', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetErrorHandlerState()
    initGlobalErrorHandler()

    // 先量出「当前已注册监听器数」造成的日志条数（基线）
    errorSpy.mockClear()
    dispatchRejection(new Error('基线'))
    const baseline = errorSpy.mock.calls.length
    expect(baseline).toBeGreaterThan(0)

    // 再次调用应被 isInitialized 短路
    initGlobalErrorHandler()
    initGlobalErrorHandler()

    errorSpy.mockClear()
    dispatchRejection(new Error('幂等校验'))

    // 若幂等失效，这里会多出 2 条（多注册了 2 个监听器）
    expect(errorSpy.mock.calls.length).toBe(baseline)
  })

  it('resetErrorHandlerState 允许重新注册（供测试切换环境）', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetErrorHandlerState()
    initGlobalErrorHandler()

    errorSpy.mockClear()
    dispatchRejection(new Error('重置前'))
    const before = errorSpy.mock.calls.length

    // 复位后重新初始化 → 应新增一个监听器，日志条数随之 +1
    resetErrorHandlerState()
    initGlobalErrorHandler()

    errorSpy.mockClear()
    dispatchRejection(new Error('重置后'))

    expect(errorSpy.mock.calls.length).toBe(before + 1)
  })

  it('无 window 环境（纯 Node）时静默跳过注册', () => {
    vi.stubGlobal('window', undefined)
    resetErrorHandlerState()

    expect(() => initGlobalErrorHandler()).not.toThrow()
  })
})
