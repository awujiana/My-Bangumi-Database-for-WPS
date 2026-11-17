// @vitest-environment jsdom
/**
 * @fileoverview `ts/tools/config-poll.ts` 共享配置轮询单测
 *
 * 钉 2026-10-24 真机缺陷（原生 `<select>` 下拉卡顿）的修复不变量：
 * 1. **一次 tick 每个键只读一次**（多个订阅者共享同一键时去重）——改造前是
 *    四个模块各一个 2s 定时器、共 5 次 COM 读 / 2s；
 * 2. **只在值变化时 apply**（未变化不触发副作用）；
 * 3. **页面隐藏跳过**（后台窗格不做无谓 COM）；
 * 4. **原生下拉聚焦 / 刚交互过时让路**（下拉展开期间不发起 COM）；
 * 5. **命中变化后进入快拍**（600ms），连续调整跟手；
 * 6. **退订后不再有定时器**（页面销毁不留轮询）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getConfig: vi.fn<(key: string, fallback?: string, isSilent?: boolean) => string>(),
}))

vi.mock('../ts/tools/config.js', () => ({ getConfig: m.getConfig }))

import { resetConfigPollForTest, subscribeConfigPoll } from '../ts/tools/config-poll.js'

/** 造一个可控的配置存储 */
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  m.getConfig.mockReset()
  m.getConfig.mockImplementation((key: string) => store.get(key) ?? '')
  resetConfigPollForTest()
  vi.useFakeTimers()
  document.body.replaceChildren()
})

afterEach(() => {
  resetConfigPollForTest()
  vi.useRealTimers()
})

describe('config-poll', () => {
  it('一次 tick 每个键只读一次（多订阅者共享键去重）', () => {
    store.set('a', '1')
    store.set('b', '2')
    const applyA = vi.fn()
    const applyB = vi.fn()
    subscribeConfigPoll({ keys: ['a'], apply: applyA })
    subscribeConfigPoll({ keys: ['a', 'b'], apply: applyB })
    m.getConfig.mockClear()

    vi.advanceTimersByTime(3000)

    // 'a' 被两个订阅者监听，但只读一次；'b' 读一次 → 共 2 次
    const readKeys = m.getConfig.mock.calls.map(([key]) => key)
    expect(readKeys.sort((left, right) => left.localeCompare(right))).toEqual(['a', 'b'])
  })

  it('值未变化时不调用 apply；变化时才调用并拿到快照', () => {
    store.set('a', '1')
    const apply = vi.fn()
    subscribeConfigPoll({ keys: ['a'], apply })

    vi.advanceTimersByTime(3000)
    expect(apply).not.toHaveBeenCalled()

    store.set('a', '2')
    vi.advanceTimersByTime(3000)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({ a: '2' })
  })

  it('页面隐藏时跳过（不读配置）', () => {
    const apply = vi.fn()
    subscribeConfigPoll({ keys: ['a'], apply })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    m.getConfig.mockClear()

    vi.advanceTimersByTime(3000)
    expect(m.getConfig).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    vi.advanceTimersByTime(3000)
    expect(m.getConfig).toHaveBeenCalled()
  })

  it('原生下拉聚焦时让路（不读配置），失焦后恢复', () => {
    const apply = vi.fn()
    subscribeConfigPoll({ keys: ['a'], apply })
    const select = document.createElement('select')
    document.body.append(select)
    select.focus()
    expect(document.activeElement).toBe(select)
    m.getConfig.mockClear()

    vi.advanceTimersByTime(3000)
    expect(m.getConfig).not.toHaveBeenCalled()

    select.blur()
    vi.advanceTimersByTime(3000)
    expect(m.getConfig).toHaveBeenCalled()
  })

  it('命中变化后进入快拍（600ms 内再次检查）', () => {
    store.set('a', '1')
    const apply = vi.fn()
    subscribeConfigPoll({ keys: ['a'], apply })

    store.set('a', '2')
    vi.advanceTimersByTime(3000)
    expect(apply).toHaveBeenCalledTimes(1)

    store.set('a', '3')
    vi.advanceTimersByTime(600)
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith({ a: '3' })
  })

  it('退订后清掉定时器、不再读配置', () => {
    const apply = vi.fn()
    const unsubscribe = subscribeConfigPoll({ keys: ['a'], apply })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unsubscribe()
    expect(vi.getTimerCount()).toBe(0)

    m.getConfig.mockClear()
    vi.advanceTimersByTime(30_000)
    expect(m.getConfig).not.toHaveBeenCalled()
  })

  it('读取抛错按空串处理，不向外抛', () => {
    const apply = vi.fn()
    subscribeConfigPoll({ keys: ['a'], apply })
    m.getConfig.mockImplementation(() => {
      throw new Error('桥未就绪')
    })
    expect(() => {
      vi.advanceTimersByTime(3000)
    }).not.toThrow()
  })
})
