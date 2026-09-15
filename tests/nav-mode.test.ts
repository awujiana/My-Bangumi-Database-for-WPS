// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startNavModeSync } from '../ts/tools/nav-mode.js'
import { areNavIconsOnly } from '../ts/tools/config.js'

vi.mock('../ts/tools/config.js', () => ({
  areNavIconsOnly: vi.fn(() => false),
}))

describe('startNavModeSync（跨页导航模式同步）', () => {
  beforeEach(() => {
    document.body.className = ''
    vi.useFakeTimers()
    vi.mocked(areNavIconsOnly).mockReturnValue(false)
  })

  it('启动时应用当前配置，配置未变化时轮询不切换', () => {
    startNavModeSync()
    expect(document.body.classList.contains('nav-icons-only')).toBe(false)
    // 触发一次轮询，配置仍 false → 不应切换
    vi.advanceTimersByTime(2000)
    expect(document.body.classList.contains('nav-icons-only')).toBe(false)
  })

  it('配置变为启用后轮询切换 nav-icons-only 并派发 resize', () => {
    startNavModeSync()
    vi.mocked(areNavIconsOnly).mockReturnValue(true)
    const onResize = vi.fn()
    window.addEventListener('resize', onResize)
    vi.advanceTimersByTime(2000)
    expect(document.body.classList.contains('nav-icons-only')).toBe(true)
    expect(onResize).toHaveBeenCalledTimes(1)
  })

  it('容错：轮询回调异常不抛出、不中断', () => {
    vi.mocked(areNavIconsOnly).mockReturnValue(false)
    startNavModeSync()
    // 仅让下一次轮询（位于 try/catch 内）抛错；初始读取仍正常返回
    vi.mocked(areNavIconsOnly).mockImplementationOnce(() => {
      throw new Error('read fail')
    })
    expect(() => {
      vi.advanceTimersByTime(2000)
    }).not.toThrow()
    expect(document.body.classList.contains('nav-icons-only')).toBe(false)
  })

  it('页面卸载（beforeunload）时清除轮询定时器', () => {
    startNavModeSync()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    window.dispatchEvent(new Event('beforeunload'))
    // 各次 startNavModeSync 注册的监听器都是 once + 各自清自己的 interval，
    // 因此派发一次 beforeunload 后不应残留任何定时器
    expect(vi.getTimerCount()).toBe(0)
    // 清理后再推进时间也不会触发轮询（不会读配置）
    vi.mocked(areNavIconsOnly).mockClear()
    vi.advanceTimersByTime(10_000)
    expect(areNavIconsOnly).not.toHaveBeenCalled()
  })
})
