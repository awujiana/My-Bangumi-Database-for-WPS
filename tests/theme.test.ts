import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock 依赖：完全隔离 tools/config.ts，ts 运行时仅用到 getTheme / setTheme / 定时相关。
vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: { THEME: 'bgm_theme', THEME_SCHEDULE: 'bgm_theme_schedule' },
  getTheme: vi.fn(),
  setTheme: vi.fn(),
  getThemeSchedule: vi.fn(() => ({ enabled: true, darkStart: '19:00', lightStart: '07:00' })),
  resolveScheduledTheme: vi.fn(() => 'dark'),
}))

import { getTheme, setTheme } from '../ts/tools/config.js'
import {
  resolveTheme,
  saveTheme,
  applyTheme,
  initializeTheme,
  startThemeSync,
  startThemeScheduleWatch,
  switchThemeAnimated,
} from '../ts/tools/theme.js'

/**
 * 测试环境为 node（vitest.config.ts environment: 'node'），故：
 * - 模块加载时 `typeof window === 'undefined'`，`systemMedia` 恒为 null；
 *   因此 `resolveTheme('system')` 在本环境下固定解析为 'dark'（matchMedia 分支需真实 WPS/jsdom 验证）。
 * - `applyTheme`/`initializeTheme`/`startThemeSync` 的 document/window 早退分支天然覆盖，
 *   需要真实 DOM 行为的分支通过 vi.stubGlobal('document', ...) 在单测内重建。
 */
describe('tools/theme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('resolveTheme', () => {
    it("'dark' 原样返回 'dark'", () => {
      expect(resolveTheme('dark')).toBe('dark')
    })

    it("'light' 原样返回 'light'", () => {
      expect(resolveTheme('light')).toBe('light')
    })

    it("'system' 在 node 环境下（无 window.matchMedia）解析为 'dark'", () => {
      // 模块级 systemMedia 为 null → systemMedia?.matches 为 undefined（falsy）→ 'dark'
      expect(resolveTheme('system')).toBe('dark')
    })
  })

  describe('saveTheme', () => {
    it('非法 mode 直接返回 false 且不写入配置', () => {
      const isOk = saveTheme('not-a-mode')
      expect(isOk).toBe(false)
      expect(setTheme).not.toHaveBeenCalled()
    })

    it("'dark' 写入成功时返回 true 并应用主题", () => {
      vi.mocked(setTheme).mockReturnValue(true)
      const isOk = saveTheme('dark')
      expect(isOk).toBe(true)
      expect(setTheme).toHaveBeenCalledWith('dark')
    })

    it("'light' 写入成功时返回 true", () => {
      vi.mocked(setTheme).mockReturnValue(true)
      const isOk = saveTheme('light')
      expect(isOk).toBe(true)
      expect(setTheme).toHaveBeenCalledWith('light')
    })

    it("'system' 写入成功时返回 true", () => {
      vi.mocked(setTheme).mockReturnValue(true)
      const isOk = saveTheme('system')
      expect(isOk).toBe(true)
      expect(setTheme).toHaveBeenCalledWith('system')
    })

    it('写入失败时返回 false', () => {
      vi.mocked(setTheme).mockReturnValue(false)
      const isOk = saveTheme('dark')
      expect(isOk).toBe(false)
    })
  })

  describe('applyTheme', () => {
    it('node 下 document 未定义时不抛错（早退）', () => {
      expect(() => applyTheme('dark')).not.toThrow()
    })

    it("'dark' 写入 <html data-theme> 与 color-scheme", () => {
      const fakeDocument = {
        documentElement: {
          dataset: {} as Record<string, string>,
          style: {} as Record<string, string>,
        },
      }
      vi.stubGlobal('document', fakeDocument)
      applyTheme('dark')
      expect(fakeDocument.documentElement.dataset.theme).toBe('dark')
      expect(fakeDocument.documentElement.style.colorScheme).toBe('dark')
    })

    it("'light' 写入 <html data-theme> 与 color-scheme", () => {
      const fakeDocument = {
        documentElement: {
          dataset: {} as Record<string, string>,
          style: {} as Record<string, string>,
        },
      }
      vi.stubGlobal('document', fakeDocument)
      applyTheme('light')
      expect(fakeDocument.documentElement.dataset.theme).toBe('light')
      expect(fakeDocument.documentElement.style.colorScheme).toBe('light')
    })
  })

  describe('initializeTheme', () => {
    it('从配置读取并应用主题，不抛错', () => {
      vi.mocked(getTheme).mockReturnValue('dark')
      expect(() => initializeTheme()).not.toThrow()
      expect(getTheme).toHaveBeenCalledWith(true)
    })
  })

  describe('startThemeSync', () => {
    it('node 下 window 未定义时早退不抛错', () => {
      expect(() => startThemeSync()).not.toThrow()
    })
  })

  describe('startThemeScheduleWatch', () => {
    it('node 下 window 未定义时返回空退订函数，不抛错', () => {
      const stop = startThemeScheduleWatch()
      expect(typeof stop).toBe('function')
      expect(() => stop()).not.toThrow()
    })
  })

  describe('switchThemeAnimated', () => {
    it('node 下无 document 时静默返回（不抛错）', () => {
      expect(() => switchThemeAnimated('dark', { x: 0, y: 0 })).not.toThrow()
    })
  })

  describe('saveTheme', () => {
    it('schedule 模式写入成功时返回 true', () => {
      vi.mocked(setTheme).mockReturnValue(true)
      expect(saveTheme('schedule')).toBe(true)
      expect(setTheme).toHaveBeenCalledWith('schedule')
    })

    it('未知模式拒绝写入', () => {
      expect(saveTheme('rainbow')).toBe(false)
    })
  })
})
