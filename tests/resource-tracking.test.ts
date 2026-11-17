/**
 * resource-tracking.ts 单元测试
 *
 * 覆盖：trackedSetTimeout / clearAllPendingTimeouts / trackedAddEventListener /
 *       trackedEventBusOn / clearTrackedListeners。
 *
 * 策略：仅 mock `tools/events` 的事件总线（唯一运行时依赖）；定时器用 vitest 假时钟驱动，
 *       以真实行为断言（而非统计内部 Set），故 clear 后推进时钟回调必须不执行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { eventBus } from '../ts/tools/events.js'
import {
  clearAllPendingTimeouts,
  clearTrackedListeners,
  trackedAddEventListener,
  trackedEventBusOn,
  trackedSetTimeout,
} from '../ts/ui/handlers/resource-tracking.js'

vi.mock('../ts/tools/events.js', () => ({
  eventBus: { on: vi.fn(), off: vi.fn() },
}))

interface ListenerHost {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
}

function createListenerHost(): ListenerHost {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

describe('ui/handlers/resource-tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    // 清空模块级登记，避免用例间相互污染
    clearAllPendingTimeouts()
    clearTrackedListeners()
    vi.useRealTimers()
  })

  describe('trackedSetTimeout', () => {
    it('延迟到期后执行回调', () => {
      const callback = vi.fn()
      trackedSetTimeout(callback, 100)

      expect(callback).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('到期前不执行回调', () => {
      const callback = vi.fn()
      trackedSetTimeout(callback, 100)

      vi.advanceTimersByTime(99)
      expect(callback).not.toHaveBeenCalled()
    })

    it('返回可用的定时器 id', () => {
      const id = trackedSetTimeout(() => {
        /* noop */
      }, 0)
      expect(id).toBeDefined()
    })
  })

  describe('clearAllPendingTimeouts', () => {
    it('清理后未到期的回调不再执行', () => {
      const callback = vi.fn()
      trackedSetTimeout(callback, 500)
      trackedSetTimeout(callback, 800)

      clearAllPendingTimeouts()
      vi.advanceTimersByTime(1000)

      expect(callback).not.toHaveBeenCalled()
    })

    it('已执行过的回调不受影响，且重复调用不抛错', () => {
      const callback = vi.fn()
      trackedSetTimeout(callback, 10)
      vi.advanceTimersByTime(10)
      expect(callback).toHaveBeenCalledTimes(1)

      expect(() => {
        clearAllPendingTimeouts()
        clearAllPendingTimeouts()
      }).not.toThrow()
    })
  })

  describe('trackedAddEventListener / clearTrackedListeners', () => {
    it('立即注册到目标元素', () => {
      const host = createListenerHost()
      const handler = vi.fn()

      trackedAddEventListener(host as unknown as EventTarget, 'click', handler)

      expect(host.addEventListener).toHaveBeenCalledWith('click', handler)
    })

    it('清理时对每个已注册监听器按原参数 removeEventListener', () => {
      const host = createListenerHost()
      const handler = vi.fn()
      trackedAddEventListener(host as unknown as EventTarget, 'click', handler)
      trackedAddEventListener(host as unknown as EventTarget, 'change', handler)

      clearTrackedListeners()

      expect(host.removeEventListener).toHaveBeenCalledTimes(2)
      expect(host.removeEventListener).toHaveBeenCalledWith('click', handler)
      expect(host.removeEventListener).toHaveBeenCalledWith('change', handler)
    })

    it('清理后再清理不会重复移除', () => {
      const host = createListenerHost()
      const handler = vi.fn()
      trackedAddEventListener(host as unknown as EventTarget, 'click', handler)

      clearTrackedListeners()
      clearTrackedListeners()

      expect(host.removeEventListener).toHaveBeenCalledTimes(1)
    })
  })

  describe('trackedEventBusOn / clearTrackedListeners', () => {
    it('立即在事件总线上注册', () => {
      const handler = vi.fn()
      trackedEventBusOn('bgm:token-updated', handler)

      expect(eventBus.on).toHaveBeenCalledWith('bgm:token-updated', handler)
    })

    it('清理时对事件总线监听器调用 off', () => {
      const handler = vi.fn()
      trackedEventBusOn('bgm:user-id-updated', handler)

      clearTrackedListeners()

      expect(eventBus.off).toHaveBeenCalledWith('bgm:user-id-updated', handler)
    })

    it('DOM 监听器与事件总线监听器可混合登记并一并清理', () => {
      const host = createListenerHost()
      const domHandler = vi.fn()
      const busHandler = vi.fn()
      trackedAddEventListener(host as unknown as EventTarget, 'input', domHandler)
      trackedEventBusOn('bgm:config-updated', busHandler)

      clearTrackedListeners()

      expect(host.removeEventListener).toHaveBeenCalledWith('input', domHandler)
      expect(eventBus.off).toHaveBeenCalledWith('bgm:config-updated', busHandler)
    })
  })
})
