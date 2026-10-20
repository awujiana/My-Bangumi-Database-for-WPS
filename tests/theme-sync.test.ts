// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { getTheme } from '../ts/tools/config.js'

type ThemeModule = typeof import('../ts/tools/theme.js')

vi.mock('../ts/tools/config.js', () => ({
  getTheme: vi.fn(() => 'dark'),
  setTheme: vi.fn(() => true),
}))

// 必须在导入 theme 之前安装 matchMedia，否则模块级 systemMedia 会是 null，
// 导致 initializeTheme/startThemeSync 内依赖 systemMedia 的分支永远走不到。
// systemMedia 在模块加载时捕获 matchMedia 返回对象的 addEventListener，故此处
// 用稳定的 vi.fn 实例，便于在测试中断言「系统外观变化监听已注册」。
const mediaAddEventListener = vi.fn()
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: () => ({
    matches: false,
    addEventListener: mediaAddEventListener,
    removeEventListener: vi.fn(),
  }),
})

// 动态导入放到 beforeAll，避免顶层 await（n/no-top-level-await）
let themeModule: ThemeModule
beforeAll(async () => {
  themeModule = await import('../ts/tools/theme.js')
})

describe('theme（jsdom：systemMedia 非 null）', () => {
  beforeEach(() => {
    delete (document.documentElement.dataset as Record<string, string>).theme
    document.documentElement.style.colorScheme = ''
    vi.useFakeTimers()
  })

  it('initializeTheme 注册系统外观变化监听', () => {
    mediaAddEventListener.mockClear()
    themeModule.initializeTheme()
    expect(getTheme).toHaveBeenCalledWith(true)
    expect(mediaAddEventListener).toHaveBeenCalled()
  })

  it('startThemeSync 轮询：配置变化时重应用主题', () => {
    vi.mocked(getTheme).mockReturnValue('light')
    themeModule.startThemeSync()
    // startThemeSync 仅在轮询检测到变化时才应用，初始不立即写 data-theme
    // 配置切换为 dark → 下一轮询应重应用
    vi.mocked(getTheme).mockReturnValue('dark')
    vi.advanceTimersByTime(2000)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('startThemeSync 容错：轮询回调异常被吞掉、不中断', () => {
    vi.mocked(getTheme).mockReturnValue('light')
    themeModule.startThemeSync()
    // 仅让下一次轮询（位于 try/catch 内）抛错；初始读取仍正常返回
    vi.mocked(getTheme).mockImplementationOnce(() => {
      throw new Error('read fail')
    })
    expect(() => {
      vi.advanceTimersByTime(2000)
    }).not.toThrow()
  })
})
