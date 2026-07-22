/**
 * @fileoverview 防抖与节流工具测试
 *
 * 测试策略：直接从 ts/tools/debounce.js 导入，该模块为纯函数无副作用，
 * 可在 Node 测试环境中直接运行。使用 vitest 的 fake timers 控制时间推进。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce, throttle, clearDebounceTimer } from '../ts/tools/debounce.js'

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('只在最后一次调用后延迟毫秒触发', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 300)
    debounced()
    debounced()
    debounced()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('默认延迟 300ms', () => {
    const fn = vi.fn()
    const debounced = debounce(fn)
    debounced()
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('在延迟期内再次调用应重置计时器', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 300)
    debounced()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    debounced() // 重置计时器
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('应将最后一次调用的参数传递给 fn', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('a')
    debounced('b')
    debounced('c')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })
})

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('固定间隔内最多触发一次', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 300)
    throttled() // 立即触发
    expect(fn).toHaveBeenCalledTimes(1)
    throttled() // 被节流
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('默认间隔 300ms', () => {
    const fn = vi.fn()
    const throttled = throttle(fn)
    throttled() // 立即触发
    expect(fn).toHaveBeenCalledTimes(1)
    throttled() // 被节流
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('间隔到期后下一次调用立即触发', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 200)
    throttled() // 立即触发 #1
    vi.advanceTimersByTime(200)
    throttled() // 立即触发 #2
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('clearDebounceTimer', () => {
  it('调用不抛错（占位辅助函数）', () => {
    const fn = (): void => {
      /* noop */
    }
    expect(() => clearDebounceTimer(fn)).not.toThrow()
  })
})
