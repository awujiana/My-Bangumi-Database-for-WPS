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
    const function_ = vi.fn()
    const debounced = debounce(function_, 300)
    debounced()
    debounced()
    debounced()
    expect(function_).not.toHaveBeenCalled()
    vi.advanceTimersByTime(299)
    expect(function_).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(function_).toHaveBeenCalledTimes(1)
  })

  it('默认延迟 300ms', () => {
    const function_ = vi.fn()
    const debounced = debounce(function_)
    debounced()
    vi.advanceTimersByTime(299)
    expect(function_).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(function_).toHaveBeenCalledTimes(1)
  })

  it('在延迟期内再次调用应重置计时器', () => {
    const function_ = vi.fn()
    const debounced = debounce(function_, 300)
    debounced()
    vi.advanceTimersByTime(200)
    expect(function_).not.toHaveBeenCalled()
    // 重置计时器
    debounced()
    vi.advanceTimersByTime(200)
    expect(function_).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(function_).toHaveBeenCalledTimes(1)
  })

  it('应将最后一次调用的参数传递给 fn', () => {
    const function_ = vi.fn()
    const debounced = debounce(function_, 100)
    debounced('a')
    debounced('b')
    debounced('c')
    vi.advanceTimersByTime(100)
    expect(function_).toHaveBeenCalledTimes(1)
    expect(function_).toHaveBeenCalledWith('c')
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
    const function_ = vi.fn()
    const throttled = throttle(function_, 300)
    // 立即触发
    throttled()
    expect(function_).toHaveBeenCalledTimes(1)
    // 被节流
    throttled()
    expect(function_).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(function_).toHaveBeenCalledTimes(2)
  })

  it('默认间隔 300ms', () => {
    const function_ = vi.fn()
    const throttled = throttle(function_)
    // 立即触发
    throttled()
    expect(function_).toHaveBeenCalledTimes(1)
    // 被节流
    throttled()
    expect(function_).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(function_).toHaveBeenCalledTimes(2)
  })

  it('间隔到期后下一次调用立即触发', () => {
    const function_ = vi.fn()
    const throttled = throttle(function_, 200)
    // 立即触发 #1
    throttled()
    vi.advanceTimersByTime(200)
    // 立即触发 #2
    throttled()
    expect(function_).toHaveBeenCalledTimes(2)
  })

  it('时钟跳跃导致剩余时间已过：清掉待触发的定时器并立即执行', () => {
    // 覆盖「remaining <= 0 且 timerId !== null」这一支：既要有尚未触发的定时器，
    // 又要让 Date.now 的推进量已经超过 interval。正常流程下两者互斥
    // （定时器到点就会把 timerId 置空），只有系统时钟被向前拨动时才会同时成立
    // —— 用 vi.setSystemTime 把时钟和定时器队列解耦来构造。
    const function_ = vi.fn()
    const throttled = throttle(function_, 300)

    vi.setSystemTime(0)
    throttled()
    expect(function_).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)

    vi.setSystemTime(1000)
    throttled()

    expect(function_).toHaveBeenCalledTimes(1)
    // 待触发的定时器已被 clearTimeout 摘掉，不会再补一次调用
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(function_).toHaveBeenCalledTimes(1)
  })
})

function noopTimerFunction(): void {
  /* noop */
}

describe('clearDebounceTimer', () => {
  it('调用不抛错（占位辅助函数）', () => {
    expect(() => clearDebounceTimer(noopTimerFunction)).not.toThrow()
  })
})
