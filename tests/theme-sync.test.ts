// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { getConfig, getTheme } from '../ts/tools/config.js'
import { resetConfigPollForTest } from '../ts/tools/config-poll.js'

type ThemeModule = typeof import('../ts/tools/theme.js')

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: { THEME: 'bgm_theme' },
  getTheme: vi.fn(() => 'dark'),
  getConfig: vi.fn(() => 'dark'),
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
    resetConfigPollForTest()
    vi.mocked(getConfig).mockReturnValue('dark')
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
    vi.mocked(getConfig).mockReturnValue('light')
    themeModule.startThemeSync()
    // startThemeSync 仅在轮询检测到变化时才应用，初始不立即写 data-theme
    // 配置切换为 dark（原始值变化才触发 apply）→ 下一拍应重应用
    vi.mocked(getTheme).mockReturnValue('dark')
    vi.mocked(getConfig).mockReturnValue('dark')
    vi.advanceTimersByTime(3000)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('startThemeSync 容错：轮询回调异常被吞掉、不中断', () => {
    vi.mocked(getTheme).mockReturnValue('light')
    vi.mocked(getConfig).mockReturnValue('light')
    themeModule.startThemeSync()
    // 让原始值变化触发一次 apply，再让 apply 内的读取抛错（模块自己 try/catch 吞掉）
    vi.mocked(getConfig).mockReturnValue('dark')
    vi.mocked(getTheme).mockImplementationOnce(() => {
      throw new Error('read fail')
    })
    expect(() => {
      vi.advanceTimersByTime(3000)
    }).not.toThrow()
  })
})
