/**
 * @fileoverview 任务窗格「页面心跳」单测（ts/tools/pane-alive.ts）
 * @module tests/paneAlive
 * @description 覆盖「黑屏窗格自愈」判定链路中容易静默失效的分支：
 *   1. 心跳写入 → isPanePageAlive 判活；
 *   2. 心跳缺失 / 过期 / 脏值 → 判死（调用方重建窗格而不是显示黑屏）；
 *   3. startPaneHeartbeat 幂等（bootstrap 重放不会叠出多个 interval）。
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HEARTBEAT_MAX_AGE_MS,
  isPanePageAlive,
  resetPaneHeartbeatForTest,
  startPaneHeartbeat,
} from '../ts/tools/pane-alive.js'

/** 假 PluginStorage：内存 Map */
function installFakeHost(): Map<string, string> {
  const storage = new Map<string, string>()
  ;(window as unknown as { Application: unknown }).Application = {
    PluginStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
    },
  }
  return storage
}

describe('isPanePageAlive', () => {
  beforeEach(() => {
    installFakeHost()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    resetPaneHeartbeatForTest()
  })

  it('无心跳记录 → 判活（保守：旧版本升级 / PluginStorage 不可写不能判死，否则每次点击都重建堆孤儿窗）', () => {
    expect(isPanePageAlive('panel')).toBe(true)
  })

  it('心跳新鲜 → 判活', () => {
    ;(
      window as unknown as {
        Application: { PluginStorage: { setItem: (k: string, v: string) => void } }
      }
    ).Application.PluginStorage.setItem('pane_alive_panel', String(Date.now()))
    expect(isPanePageAlive('panel')).toBe(true)
  })

  it('心跳过期（超过 3 个周期没跳动）→ 判死', () => {
    ;(
      window as unknown as {
        Application: { PluginStorage: { setItem: (k: string, v: string) => void } }
      }
    ).Application.PluginStorage.setItem(
      'pane_alive_panel',
      String(Date.now() - HEARTBEAT_MAX_AGE_MS - 1),
    )
    expect(isPanePageAlive('panel')).toBe(false)
  })

  it('心跳过期但没超过上限（页面被节流但还活着）→ 判活', () => {
    ;(
      window as unknown as {
        Application: { PluginStorage: { setItem: (k: string, v: string) => void } }
      }
    ).Application.PluginStorage.setItem('pane_alive_panel', String(Date.now() - 60_000))
    expect(isPanePageAlive('panel')).toBe(true)
  })

  it('脏值（非数字 / 负数 / NaN）→ 判活（保守：无法判定时不重建）', () => {
    const host = (
      window as unknown as {
        Application: { PluginStorage: { setItem: (k: string, v: string) => void } }
      }
    ).Application.PluginStorage
    host.setItem('pane_alive_panel', '不是数字')
    expect(isPanePageAlive('panel')).toBe(true)
    host.setItem('pane_alive_panel', '-5')
    expect(isPanePageAlive('panel')).toBe(true)
    host.setItem('pane_alive_panel', '')
    expect(isPanePageAlive('panel')).toBe(true)
  })

  it('宿主不存在（纯 Node / 宿主未注入）→ 判活而不是抛错', () => {
    ;(window as unknown as { Application?: unknown }).Application = undefined
    expect(isPanePageAlive('panel')).toBe(true)
  })
})

describe('startPaneHeartbeat', () => {
  beforeEach(() => {
    installFakeHost()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    resetPaneHeartbeatForTest()
  })

  it('启动即写一次心跳 → isPanePageAlive 立即为 true', () => {
    startPaneHeartbeat('enrich')
    expect(isPanePageAlive('enrich')).toBe(true)
  })

  it('时间推进后 interval 持续补跳（30s 周期）', () => {
    startPaneHeartbeat('enrich')
    vi.advanceTimersByTime(120_000)
    expect(isPanePageAlive('enrich')).toBe(true)
  })

  it('重复调用幂等：bootstrap 重放不会叠出多个 interval', () => {
    const intervalSpy = vi.spyOn(window, 'setInterval')
    startPaneHeartbeat('enrich')
    const afterFirst = intervalSpy.mock.calls.length
    startPaneHeartbeat('enrich')
    startPaneHeartbeat('enrich')
    expect(intervalSpy.mock.calls.length).toBe(afterFirst)
  })

  it('宿主不存在（纯 Node）→ 不抛错也不启动', () => {
    ;(window as unknown as { Application?: unknown }).Application = undefined
    expect(() => {
      startPaneHeartbeat('enrich')
    }).not.toThrow()
  })
})
