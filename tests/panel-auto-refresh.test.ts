/**
 * @fileoverview `ts/panel/panel-auto-refresh.ts`（预览自动刷新）单元测试。
 *
 * 契约：事件后按防抖窗口合并刷新；闸门可拦截；disposer 清定时器并还原事件；
 * 宿主不支持事件时静默降级（不影响面板启动）。
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AUTO_REFRESH_DEBOUNCE_MS,
  registerSheetChangeAutoRefresh,
  registerVisibilityRefresh,
} from '../ts/panel/panel-auto-refresh.js'
import type { SheetChangeHost } from '../ts/panel/panel-auto-refresh.js'

describe('registerSheetChangeAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认防抖窗口为 400ms', () => {
    expect(AUTO_REFRESH_DEBOUNCE_MS).toBe(400)
  })

  it('事件后到窗口才刷新，窗口内不刷新', () => {
    const app: SheetChangeHost = {}
    const refresh = vi.fn()
    registerSheetChangeAutoRefresh(app, refresh)

    app.SheetChange?.()
    vi.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS - 1)
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('连续事件只刷新一次（防抖合并）', () => {
    const app: SheetChangeHost = {}
    const refresh = vi.fn()
    registerSheetChangeAutoRefresh(app, refresh, { debounceMs: 100 })

    app.SheetChange?.()
    vi.advanceTimersByTime(60)
    app.SheetChange?.()
    vi.advanceTimersByTime(60)
    app.SheetChange?.()
    vi.advanceTimersByTime(100)

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shouldRefresh 返回 false 时不刷新', () => {
    const app: SheetChangeHost = {}
    const refresh = vi.fn()
    registerSheetChangeAutoRefresh(app, refresh, {
      debounceMs: 100,
      shouldRefresh: () => false,
    })

    app.SheetChange?.()
    vi.advanceTimersByTime(100)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('disposer 清除待触发定时器并还原事件', () => {
    const app: SheetChangeHost = {}
    const refresh = vi.fn()
    const dispose = registerSheetChangeAutoRefresh(app, refresh, { debounceMs: 100 })

    app.SheetChange?.()
    dispose()
    vi.advanceTimersByTime(100)

    expect(refresh).not.toHaveBeenCalled()
    expect(app.SheetChange).toBeUndefined()
  })

  it('事件已被别的模块改写时，disposer 不覆盖它', () => {
    const app: SheetChangeHost = {}
    const dispose = registerSheetChangeAutoRefresh(app, vi.fn())
    const other = vi.fn()
    app.SheetChange = other

    dispose()

    expect(app.SheetChange).toBe(other)
  })

  it('宿主不支持事件（赋值抛错）→ 静默降级，返回可用 disposer', () => {
    const throwing = {
      set SheetChange(_value: unknown) {
        throw new Error('只读代理')
      },
    } as unknown as SheetChangeHost

    const dispose = registerSheetChangeAutoRefresh(throwing, vi.fn())

    expect(() => {
      dispose()
    }).not.toThrow()
  })

  it('宿主「接受赋值但不保存」→ 视为不支持，不留下待触发定时器', () => {
    // 模拟冻结对象 / 只读代理：setter 不抛错但也不保存
    // 只有 setter 没有 getter：读回来恒为 undefined（TS 需要显式标注）
    const app = {
      set SheetChange(_value: unknown) {
        /* 吞掉 */
      },
    } as unknown as SheetChangeHost
    const refresh = vi.fn()
    const dispose = registerSheetChangeAutoRefresh(app, refresh, { debounceMs: 100 })

    expect(app.SheetChange).toBeUndefined()
    dispose()
    vi.advanceTimersByTime(100)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('app 为空 → 返回 noop disposer', () => {
    const dispose = registerSheetChangeAutoRefresh(null, vi.fn())
    expect(() => {
      dispose()
    }).not.toThrow()
  })
})

describe('registerVisibilityRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('窗口重新获得焦点 → 防抖后刷新一次', () => {
    const refresh = vi.fn()
    const dispose = registerVisibilityRefresh(refresh, { debounceMs: 100 })

    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(99)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)

    dispose()
  })

  it('连续 focus 合并为一次刷新', () => {
    const refresh = vi.fn()
    const dispose = registerVisibilityRefresh(refresh, { debounceMs: 100 })

    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(50)
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(100)

    expect(refresh).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('visibilitychange 回到可见 → 刷新', () => {
    const refresh = vi.fn()
    const dispose = registerVisibilityRefresh(refresh, { debounceMs: 100 })

    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(100)

    expect(refresh).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('shouldRefresh 返回 false 时不刷新', () => {
    const refresh = vi.fn()
    const dispose = registerVisibilityRefresh(refresh, {
      debounceMs: 100,
      shouldRefresh: () => false,
    })

    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(100)

    expect(refresh).not.toHaveBeenCalled()
    dispose()
  })

  it('disposer 解绑监听并清除待触发定时器', () => {
    const refresh = vi.fn()
    const dispose = registerVisibilityRefresh(refresh, { debounceMs: 100 })

    window.dispatchEvent(new Event('focus'))
    dispose()
    vi.advanceTimersByTime(100)

    expect(refresh).not.toHaveBeenCalled()
    // 解绑后再触发也不再排队
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(100)
    expect(refresh).not.toHaveBeenCalled()
  })
})
