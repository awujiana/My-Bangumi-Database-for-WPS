// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startNavModeSync } from '../ts/tools/nav-mode.js'
import { areNavIconsOnly, getConfig } from '../ts/tools/config.js'
import { resetConfigPollForTest } from '../ts/tools/config-poll.js'

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: { NAV_ICONS_ONLY: 'bgm_nav_icons_only' },
  areNavIconsOnly: vi.fn(() => false),
  getConfig: vi.fn(() => 'false'),
}))

describe('startNavModeSync（跨页导航模式同步）', () => {
  beforeEach(() => {
    document.body.className = ''
    vi.useFakeTimers()
    resetConfigPollForTest()
    vi.mocked(getConfig).mockReturnValue('false')
    vi.mocked(areNavIconsOnly).mockReturnValue(false)
  })

  it('启动时应用当前配置，配置未变化时轮询不切换', () => {
    startNavModeSync()
    expect(document.body.classList.contains('nav-icons-only')).toBe(false)
    // 触发一次轮询，配置仍 false → 不应切换
    vi.advanceTimersByTime(3000)
    expect(document.body.classList.contains('nav-icons-only')).toBe(false)
  })

  it('配置变为启用后轮询切换 nav-icons-only 并派发 resize', () => {
    startNavModeSync()
    vi.mocked(getConfig).mockReturnValue('true')
    vi.mocked(areNavIconsOnly).mockReturnValue(true)
    const onResize = vi.fn()
    window.addEventListener('resize', onResize)
    vi.advanceTimersByTime(3000)
    expect(document.body.classList.contains('nav-icons-only')).toBe(true)
    expect(onResize).toHaveBeenCalledTimes(1)
  })

  it('容错：轮询回调异常不抛出、不中断', () => {
    vi.mocked(areNavIconsOnly).mockReturnValue(false)
    startNavModeSync()
    // 仅让下一次轮询的读取抛错（轮询内部按空串吞掉，不向外抛）
    vi.mocked(getConfig).mockImplementationOnce(() => {
      throw new Error('read fail')
    })
    expect(() => {
      vi.advanceTimersByTime(3000)
    }).not.toThrow()
    expect(document.body.classList.contains('nav-icons-only')).toBe(false)
  })

  it('退订后清除轮询定时器（页面销毁时调用）', () => {
    const unsubscribe = startNavModeSync()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unsubscribe()
    expect(vi.getTimerCount()).toBe(0)
    // 退订后再推进时间也不会触发轮询（不会读配置）
    vi.mocked(getConfig).mockClear()
    vi.advanceTimersByTime(10_000)
    expect(getConfig).not.toHaveBeenCalled()
  })
})
