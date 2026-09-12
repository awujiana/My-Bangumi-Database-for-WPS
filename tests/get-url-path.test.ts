// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getUrlPath, buildTaskPaneUrl } from '../ts/tools/util/index.js'

const makeWindow = (
  app: unknown,
  href: string,
): { Application: unknown; location: { href: string } } => ({
  Application: app,
  location: { href },
})

describe('getUrlPath / buildTaskPaneUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    // 默认：无 Application，回退到 location
    vi.stubGlobal('window', makeWindow(undefined, 'https://host.com/app/taskpane.html'))
  })

  it('manifest_base_path 优先于 location', () => {
    vi.stubGlobal(
      'window',
      makeWindow(
        {
          ActiveWorkbook: {},
          PluginStorage: {
            getItem: (k: string) => (k === 'manifest_base_path' ? '/custom/base' : null),
          },
        },
        'https://host.com/app/taskpane.html',
      ),
    )
    expect(getUrlPath()).toBe('/custom/base')
  })

  it('无 Application 时回退 location 截断到最后斜杠', () => {
    expect(getUrlPath()).toBe('https://host.com/app')
  })

  it('buildTaskPaneUrl 拼接 /ui 前缀，并去掉尾部 /ui', () => {
    vi.stubGlobal(
      'window',
      makeWindow(
        {
          ActiveWorkbook: {},
          PluginStorage: { getItem: () => 'https://host.com/app/ui' },
        },
        'https://host.com/app/ui/taskpane.html',
      ),
    )
    expect(buildTaskPaneUrl('settings.html')).toBe('https://host.com/app/ui/settings.html')
  })

  it('buildTaskPaneUrl 去掉尾部多余斜杠', () => {
    vi.stubGlobal(
      'window',
      makeWindow(
        {
          ActiveWorkbook: {},
          PluginStorage: { getItem: () => 'https://host.com/app/' },
        },
        'x',
      ),
    )
    expect(buildTaskPaneUrl('clean.html')).toBe('https://host.com/app/ui/clean.html')
  })
})
