/**
 * 富化预览设置 handler 单元测试
 * 覆盖：表单回填、阈值校验（非法值拒绝 / 完结≤单集拒绝）、关键词规范化去重。
 * @module tests/enrich-preview-settings.test
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setConfig: vi.fn<(key: string, value: string) => boolean>(),
  getConfig: vi.fn<(key: string, defaultValue?: string, isSilent?: boolean) => string>(
    (_key: string, defaultValue = '', _isSilent = false): string => defaultValue,
  ),
  alert: vi.fn<(title: string, message: string) => void>(),
}))

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: {
    ENRICH_EP_SINGLE: 'bgm_enrich_ep_single',
    ENRICH_EP_FULL: 'bgm_enrich_ep_full',
    ENRICH_FILTER_KEYWORDS: 'bgm_enrich_filter_keywords',
    ENRICH_TAGS_COLOR: 'bgm_enrich_tags_color',
    ENRICH_PREMIERE_COLOR: 'bgm_enrich_premiere_color',
    ENRICH_PLATFORM_COLOR: 'bgm_enrich_platform_color',
    ENRICH_AUTO_CLEAN: 'bgm_enrich_auto_clean',
  },
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}))

vi.mock('../ts/tools/util/index.js', () => ({
  BGM: {
    Dialog: { alert: mocks.alert },
    handleError: vi.fn(),
  },
}))

const { setConfig, getConfig, alert } = mocks

/** 极简表单元素桩：仅 value 属性 */
function fakeInput(value = ''): HTMLInputElement {
  return { value } as unknown as HTMLInputElement
}

/** 极简复选框桩：仅 checked 属性 */
function fakeCheckbox(isChecked = true): HTMLInputElement {
  return { checked: isChecked } as unknown as HTMLInputElement
}

const inputs: Record<string, HTMLInputElement> = {}

vi.stubGlobal('document', {
  getElementById: (id: string) => inputs[id] ?? null,
})

import {
  loadEnrichPreviewSettingsIntoForm,
  reloadEnrichPreviewSettings,
  saveEnrichPreviewSettings,
} from '../ts/ui/handlers/enrich-preview-settings.js'

function seedForm(single: string, full: string, keywords: string): void {
  inputs.enrichEpSingle = fakeInput(single)
  inputs.enrichEpFull = fakeInput(full)
  inputs.enrichFilterKeywords = fakeInput(keywords)
}

describe('loadEnrichPreviewSettingsIntoForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) delete inputs[key]
  })

  it('无任何表单元素时静默返回（面板页场景）', () => {
    expect(() => loadEnrichPreviewSettingsIntoForm()).not.toThrow()
    expect(getConfig).not.toHaveBeenCalled()
  })

  it('从配置读取并填充三个字段', () => {
    seedForm('', '', '')
    getConfig.mockImplementation((key: string, defaultValue = '') => {
      if (key === 'bgm_enrich_ep_single') return '2'
      if (key === 'bgm_enrich_ep_full') return '24'
      return defaultValue
    })
    loadEnrichPreviewSettingsIntoForm()
    expect(inputs.enrichEpSingle?.value).toBe('2')
    expect(inputs.enrichEpFull?.value).toBe('24')
  })

  it('配置为空时回填默认值 1 / 12', () => {
    seedForm('', '', '')
    getConfig.mockImplementation((_key: string, defaultValue = '') => defaultValue)
    loadEnrichPreviewSettingsIntoForm()
    expect(inputs.enrichEpSingle?.value).toBe('1')
    expect(inputs.enrichEpFull?.value).toBe('12')
  })

  it('开关复选框：配置 "false" 时回填未勾选，其余默认勾选', () => {
    seedForm('', '', '')
    inputs.enrichTagsColor = fakeCheckbox(true)
    inputs.enrichAutoClean = fakeCheckbox(true)
    getConfig.mockImplementation((key: string, defaultValue = '') => {
      if (key === 'bgm_enrich_tags_color') return 'false'
      return defaultValue
    })
    loadEnrichPreviewSettingsIntoForm()
    expect(inputs.enrichTagsColor.checked).toBe(false)
    expect(inputs.enrichAutoClean.checked).toBe(true)
  })
})

describe('saveEnrichPreviewSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) delete inputs[key]
  })

  it('合法输入：三个键全部写入', () => {
    seedForm('1', '12', '噪声A, 噪声B')
    saveEnrichPreviewSettings()
    expect(setConfig).toHaveBeenCalledWith('bgm_enrich_ep_single', '1')
    expect(setConfig).toHaveBeenCalledWith('bgm_enrich_ep_full', '12')
    expect(setConfig).toHaveBeenCalledWith('bgm_enrich_filter_keywords', '噪声A\n噪声B')
    expect(alert).toHaveBeenCalledWith('成功', '富化预览设置已保存，重新打开富化页预览即生效')
  })

  it('完结阈值 ≤ 单集阈值：拒绝保存并弹窗', () => {
    seedForm('12', '12', '')
    saveEnrichPreviewSettings()
    expect(setConfig).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalled()
  })

  it('非整数阈值：拒绝保存并弹窗', () => {
    seedForm('abc', '12', '')
    saveEnrichPreviewSettings()
    expect(setConfig).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalled()
  })

  it('关键词去空与去重', () => {
    seedForm('1', '12', '噪声A,, 噪声A\n噪声B')
    saveEnrichPreviewSettings()
    expect(setConfig).toHaveBeenCalledWith('bgm_enrich_filter_keywords', '噪声A\n噪声B')
  })
})

describe('reloadEnrichPreviewSettings', () => {
  it('放弃修改：重新从配置覆盖表单', () => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) delete inputs[key]
    seedForm('999', '999', '草稿')
    getConfig.mockImplementation((_key: string, defaultValue = ''): string => defaultValue)
    reloadEnrichPreviewSettings()
    expect(inputs.enrichEpSingle?.value).toBe('1')
    expect(inputs.enrichEpFull?.value).toBe('12')
    expect(inputs.enrichFilterKeywords?.value).toBe('')
  })
})
