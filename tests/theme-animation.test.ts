// @vitest-environment jsdom
/**
 * @fileoverview 主题切换扩散动画测试（momo：点击时从按钮中心向外扩散到整个应用）
 *
 * 覆盖三条路径：
 * 1. View Transition（新内核）：startViewTransition 里换 data-theme，再对
 *    `::view-transition-new(root)` 做 clip-path circle(0 → R) 动画；
 * 2. 覆盖层降级（老 WebView）：旧主题色圆环从满屏收缩到点击点，中点切主题；
 * 3. 减弱动态效果（prefers-reduced-motion）：直接切，不动画。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: { THEME: 'bgm_theme', THEME_SCHEDULE: 'bgm_theme_schedule' },
  getTheme: vi.fn(() => 'dark'),
  setTheme: vi.fn(() => true),
  getThemeSchedule: vi.fn(() => ({ enabled: true, darkStart: '19:00', lightStart: '07:00' })),
  resolveScheduledTheme: vi.fn(() => 'dark'),
}))

import { switchThemeAnimated } from '../ts/tools/theme.js'

/** startViewTransition 的真实宿主是 document，stubGlobal 只改 globalThis，够不到 */
interface FakeTransition {
  ready: Promise<void>
  apply: () => void
}

/** 记录型 animate 调用 */
interface RecordedAnimationCall {
  keyframes: unknown
  options: unknown
}

/** 在 document 上装一个假的 startViewTransition，返回记录与卸载函数 */
function installViewTransition(): {
  calls: FakeTransition[]
  uninstall: () => void
} {
  const calls: FakeTransition[] = []
  Reflect.set(document, 'startViewTransition', (apply: () => void) => {
    const entry: FakeTransition = { ready: Promise.resolve(), apply }
    calls.push(entry)
    return entry
  })
  return { calls, uninstall: () => Reflect.deleteProperty(document, 'startViewTransition') }
}

/** 在 documentElement 上装记录型假 animate（jsdom 没实现 Web Animations） */
function installRecordingAnimate(): { calls: RecordedAnimationCall[] } {
  const calls: RecordedAnimationCall[] = []
  Reflect.set(document.documentElement, 'animate', (keyframes: unknown, options: unknown) => {
    calls.push({ keyframes, options })
    return {}
  })
  return { calls }
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark'
  document.body.replaceChildren()
})

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition')
  Reflect.deleteProperty(document.documentElement, 'animate')
  vi.useRealTimers()
})

describe('switchThemeAnimated：View Transition 路径', () => {
  it('在 startViewTransition 回调里切 data-theme 与 color-scheme', () => {
    const { calls } = installViewTransition()

    switchThemeAnimated('light', { x: 120, y: 240 })

    expect(calls.length).toBe(1)
    calls[0]?.apply()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('ready 后对 root 做 clip-path 动画：circle(0 at 点击点) → 覆盖全屏', async () => {
    // ready 已 resolve：实现里 await ready 只是排到微任务，animate 前先装好替身即可
    installViewTransition()
    const { calls: animateCalls } = installRecordingAnimate()

    switchThemeAnimated('light', { x: 100, y: 100 })
    await Promise.resolve()
    await Promise.resolve()

    expect(animateCalls.length).toBe(1)
    const { keyframes, options } = animateCalls[0] ?? {}
    const { clipPath } = keyframes as { clipPath: string[] }
    expect(clipPath[0]).toBe('circle(0px at 100px 100px)')
    expect(clipPath[1]).toContain('at 100px 100px)')
    // 半径 = hypot(max(x, w-x), max(y, h-y))：jsdom 视口 1024×768，点击点 (100,100)
    const radius = Number(/circle\(([\d.]+)px/.exec(clipPath[1] ?? '')?.[1] ?? '0')
    expect(radius).toBeGreaterThan(900)
    const animationOptions = options as { duration: number; pseudoElement: string }
    expect(animationOptions.duration).toBe(500)
    expect(animationOptions.pseudoElement).toBe('::view-transition-new(root)')
  })
})

describe('switchThemeAnimated：覆盖层降级（无 View Transition）', () => {
  it('盖旧主题色圆环，150ms 切主题，520ms 后移除覆盖层', () => {
    vi.useFakeTimers()
    switchThemeAnimated('light', { x: 60, y: 80 })

    const overlay = document.querySelector<HTMLElement>('.theme-ripple-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.style.getPropertyValue('--ripple-x')).toBe('60px')
    expect(overlay?.style.getPropertyValue('--ripple-y')).toBe('80px')
    // 切换前仍是旧主题（覆盖层盖着，用户看不到瞬间）
    expect(document.documentElement.dataset.theme).toBe('dark')

    vi.advanceTimersByTime(160)
    expect(document.documentElement.dataset.theme).toBe('light')

    vi.advanceTimersByTime(400)
    expect(document.querySelector('.theme-ripple-overlay')).toBeNull()
  })
})

describe('switchThemeAnimated：减弱动态效果', () => {
  it('prefers-reduced-motion=reduce 时直接切，不装覆盖层', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    switchThemeAnimated('light', { x: 10, y: 10 })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.querySelector('.theme-ripple-overlay')).toBeNull()
  })
})
