/**
 * @fileoverview tools/theme 的「跟随系统」分支测试（jsdom）
 *
 * 为什么单独一个文件：
 *   `theme.test.ts` 跑在 node 环境，模块加载时 `typeof window === 'undefined'`，
 *   于是模块级常量 `systemMedia` 恒为 `null` —— `initializeTheme` 里的
 *   `systemMedia?.addEventListener('change', …)` 整条被短路，
 *   `startThemeSync` 的 `beforeunload` 清理也一并够不到。
 *
 *   本文件改用 jsdom，并在 **import theme 之前** stub `window.matchMedia`，
 *   让 `systemMedia` 拿到一个可编程的 MediaQueryList 替身，
 *   从而覆盖「系统外观变化 → 重应用主题」与「页面卸载 → 清轮询」两条分支。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: { THEME: 'bgm_theme' },
  getTheme: vi.fn(),
  getConfig: vi.fn(() => 'dark'),
  setTheme: vi.fn(),
}))

/**
 * MediaQueryList 替身。
 * 必须在 `vi.stubGlobal('matchMedia', …)` 之前声明 —— stub 会被提升到 import 之前执行，
 * 工厂里引用的变量只能用 `vi.hoisted` 提升。
 */
const mediaQuery = vi.hoisted(() => {
  const listeners: (() => void)[] = []
  return {
    listeners,
    list: {
      matches: false,
      addEventListener: (_type: string, listener: () => void): void => {
        listeners.push(listener)
      },
    },
  }
})

vi.stubGlobal(
  'matchMedia',
  vi.fn(() => mediaQuery.list),
)

/**
 * ⚠️ 这里**不能用顶层 `await import(…)`**：`n/no-top-level-await` 会判定本文件属于
 * 「已发布模块」而报错（且顶层 await 也让「stub 先于模块求值」这一前提变得不明显）。
 * 改在 `beforeAll` 里动态 import —— 那时上面的 `vi.stubGlobal` 已执行，
 * `theme.js` 模块求值时读到的 `window.matchMedia` 就是替身。
 */
let theme: typeof import('../ts/tools/theme.js')
let getTheme: (typeof import('../ts/tools/config.js'))['getTheme']

beforeAll(async () => {
  theme = await import('../ts/tools/theme.js')
  const configModule = await import('../ts/tools/config.js')
  getTheme = configModule.getTheme
})

describe('tools/theme · 跟随系统（systemMedia 非空）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mediaQuery.listeners.length = 0
    mediaQuery.list.matches = false
    delete document.documentElement.dataset.theme
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializeTheme 注册系统外观监听，系统切到浅色后重新应用主题', () => {
    vi.mocked(getTheme).mockReturnValue('system')

    theme.initializeTheme()

    // 初始应用：matches=false → system 解析为 dark
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(mediaQuery.listeners).toHaveLength(1)

    // 模拟系统外观切到浅色：resolveTheme 会随 matches 变化
    mediaQuery.list.matches = true
    delete document.documentElement.dataset.theme
    mediaQuery.listeners[0]!()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('配置不是 system 时，系统外观变化不改变主题', () => {
    vi.mocked(getTheme).mockReturnValue('light')

    theme.initializeTheme()
    expect(document.documentElement.dataset.theme).toBe('light')

    // 把 dataset 改成哨兵值，再触发系统外观变化 —— 不应被重新写入
    document.documentElement.dataset.theme = 'sentinel'
    mediaQuery.list.matches = true
    mediaQuery.listeners[0]!()

    expect(document.documentElement.dataset.theme).toBe('sentinel')
  })

  it('startThemeSync 返回退订函数：退订后清除轮询定时器', () => {
    vi.useFakeTimers()
    vi.mocked(getTheme).mockReturnValue('dark')

    const unsubscribe = theme.startThemeSync()
    expect(vi.getTimerCount()).toBe(1)

    // 轮询本体已迁到 tools/config-poll.ts（单定时器共享），销毁走退订而非 beforeunload
    unsubscribe()
    expect(vi.getTimerCount()).toBe(0)

    // 退订后不再有新的轮询被排入
    vi.advanceTimersByTime(60_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
