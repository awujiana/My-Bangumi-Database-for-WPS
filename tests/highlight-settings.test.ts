/**
 * 高亮页功能开关 handler 单元测试
 * 覆盖：表单回填（模式 select / 自动关注 checkbox）、保存写键、写失败走 handleError、放弃修改。
 * @module tests/highlight-settings.test
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setConfig: vi.fn<(key: string, value: string) => boolean>(),
  getConfig: vi.fn<(key: string, defaultValue?: string, isSilent?: boolean) => string>(
    (_key: string, defaultValue = '', _isSilent = false): string => defaultValue,
  ),
  alert: vi.fn<(title: string, message: string) => void>(),
  handleError: vi.fn<(error: unknown, options?: unknown) => void>(),
}))

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: {
    HIGHLIGHT_MODE: 'highlight.mode',
    HIGHLIGHT_AUTO_WATCH: 'highlight.autoWatch',
  },
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}))

vi.mock('../ts/tools/util/index.js', () => ({
  BGM: {
    Dialog: { alert: mocks.alert },
    handleError: mocks.handleError,
  },
}))

const { setConfig, getConfig, alert, handleError } = mocks

/** 极简下拉桩：仅 value 属性 */
function fakeSelect(value = ''): HTMLSelectElement {
  return { value } as unknown as HTMLSelectElement
}

/** 极简复选框桩：仅 checked 属性 */
function fakeCheckbox(isChecked = true): HTMLInputElement {
  return { checked: isChecked } as unknown as HTMLInputElement
}

const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {}

vi.stubGlobal('document', {
  getElementById: (id: string) => inputs[id] ?? null,
})

import {
  loadHighlightSettingsIntoForm,
  reloadHighlightSettings,
  saveHighlightSettings,
} from '../ts/ui/handlers/highlight-settings.js'

function seedForm(mode: string, isAutoWatch: boolean): void {
  inputs.highlightMode = fakeSelect(mode)
  inputs.highlightAutoWatch = fakeCheckbox(isAutoWatch)
}

describe('loadHighlightSettingsIntoForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) delete inputs[key]
  })

  it('无任何表单元素时静默返回（非设置页场景）', () => {
    expect(() => loadHighlightSettingsIntoForm()).not.toThrow()
    expect(getConfig).not.toHaveBeenCalled()
  })

  it('从配置读取并填充模式 / 自动关注', () => {
    seedForm('auto', false)
    getConfig.mockImplementation((key: string, defaultValue = '') => {
      if (key === 'highlight.mode') return 'manual'
      if (key === 'highlight.autoWatch') return '1'
      return defaultValue
    })
    loadHighlightSettingsIntoForm()
    expect((inputs.highlightMode as HTMLSelectElement).value).toBe('manual')
    expect((inputs.highlightAutoWatch as HTMLInputElement).checked).toBe(true)
  })

  it('配置为空时回填默认值 auto / 关', () => {
    seedForm('manual', true)
    getConfig.mockImplementation((_key: string, defaultValue = '') => defaultValue)
    loadHighlightSettingsIntoForm()
    expect((inputs.highlightMode as HTMLSelectElement).value).toBe('auto')
    expect((inputs.highlightAutoWatch as HTMLInputElement).checked).toBe(false)
  })

  it('自动关注：仅显式 "1" 视为开，其余（含 "0"）为关', () => {
    seedForm('auto', false)
    getConfig.mockImplementation((key: string, defaultValue = '') =>
      key === 'highlight.autoWatch' ? '0' : defaultValue,
    )
    loadHighlightSettingsIntoForm()
    expect((inputs.highlightAutoWatch as HTMLInputElement).checked).toBe(false)
  })
})

describe('saveHighlightSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) delete inputs[key]
  })

  it('合法输入：模式与自动关注两个键全部写入', () => {
    seedForm('manual', true)
    saveHighlightSettings()
    expect(setConfig).toHaveBeenCalledWith('highlight.mode', 'manual')
    expect(setConfig).toHaveBeenCalledWith('highlight.autoWatch', '1')
    expect(alert).toHaveBeenCalledWith('成功', '功能开关已保存，下次加载工作表即生效')
  })

  it('模式 auto + 自动关注关 → 写 auto / 0', () => {
    seedForm('auto', false)
    saveHighlightSettings()
    expect(setConfig).toHaveBeenCalledWith('highlight.mode', 'auto')
    expect(setConfig).toHaveBeenCalledWith('highlight.autoWatch', '0')
  })

  it('写入配置抛错 → 交给 BGM.handleError 统一处理，不谎报成功', () => {
    seedForm('manual', true)
    setConfig.mockImplementation(() => {
      throw new Error('PluginStorage 写入失败')
    })

    expect(() => saveHighlightSettings()).not.toThrow()
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), {
      context: 'saveHighlightSettings',
      showAlert: true,
    })
    expect(alert).not.toHaveBeenCalledWith('成功', '功能开关已保存，下次加载工作表即生效')
  })
})

describe('reloadHighlightSettings', () => {
  it('放弃修改：重新从配置覆盖表单', () => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) delete inputs[key]
    seedForm('manual', true)
    getConfig.mockImplementation((_key: string, defaultValue = '') => defaultValue)
    reloadHighlightSettings()
    expect((inputs.highlightMode as HTMLSelectElement).value).toBe('auto')
    expect((inputs.highlightAutoWatch as HTMLInputElement).checked).toBe(false)
  })
})
