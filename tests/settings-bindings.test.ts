// @vitest-environment jsdom
/**
 * @fileoverview 设置页 UI 绑定单测（handlers/settings-bindings.ts）
 *
 * 这些 handler 的共同风险是「控件取不到就静默 return」：id 拼错、DOM 重构后忘了同步，
 * 表现都是「改了设置但不生效」，且不报错。因此每个 handler 都覆盖
 * 「控件缺失 → 早退」与「控件存在 → 落盘 + toast 文案」两侧。
 *
 * 覆盖：
 *  - handleEnableSyncRecordChange：缺控件早退、开/关两态
 *  - handleLogLevelFilterChange：委托 renderLogEntries
 *  - handleLogLevelChange：缺控件 / 非法值早退、正常 toast、未知级别回退、保存失败
 *  - updateThemePreview / handleThemeChange / handleThemePreviewClick
 *  - handleListTypeChange / handleTimeFilterChange / handleRefreshIntervalChange
 *  - setupTimeFilterControls：控件缺失早退、复选框与筛选范围联动
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReferences = vi.hoisted(() => ({
  mockBgmLog: vi.fn(),
  mockShowToast: vi.fn(),
  mockGetRefreshInterval: vi.fn(() => 30),
  mockSaveTheme: vi.fn(() => true),
  mockSetListType: vi.fn(() => true),
  mockSetLogLevel: vi.fn(() => true),
  mockSetRefreshInterval: vi.fn(() => true),
  mockSetSyncRecordEnabled: vi.fn(() => true),
  mockSetTimeFilter: vi.fn(() => true),
  mockRenderLogEntries: vi.fn(),
  mockApplyTheme: vi.fn(),
  mockSwitchThemeAnimated: vi.fn(),
  mockSetThemeSchedule: vi.fn(() => true),
  mockGetTheme: vi.fn(() => 'dark'),
  mockSetModalButtonsPosition: vi.fn(() => true),
}))

vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  bgmLog: mockReferences.mockBgmLog,
  showToast: mockReferences.mockShowToast,
  getRefreshInterval: mockReferences.mockGetRefreshInterval,
  saveTheme: mockReferences.mockSaveTheme,
  setListType: mockReferences.mockSetListType,
  setLogLevel: mockReferences.mockSetLogLevel,
  setRefreshInterval: mockReferences.mockSetRefreshInterval,
  setSyncRecordEnabled: mockReferences.mockSetSyncRecordEnabled,
  setTimeFilter: mockReferences.mockSetTimeFilter,
}))

vi.mock('../ts/ui/handlers/log-panel.js', () => ({
  renderLogEntries: mockReferences.mockRenderLogEntries,
}))

// settings-bindings 现在直接 import tools/theme 与 tools/config（不再经 index 中转）
vi.mock('../ts/tools/theme.js', () => ({
  applyTheme: mockReferences.mockApplyTheme,
  switchThemeAnimated: mockReferences.mockSwitchThemeAnimated,
}))

vi.mock('../ts/tools/config.js', () => ({
  setThemeSchedule: mockReferences.mockSetThemeSchedule,
  getTheme: mockReferences.mockGetTheme,
  setModalButtonsPosition: mockReferences.mockSetModalButtonsPosition,
}))

import {
  handleEnableSyncRecordChange,
  handleLogLevelFilterChange,
  handleLogLevelChange,
  handleListTypeChange,
  handleRefreshIntervalChange,
  handleThemeChange,
  handleModalButtonsPositionClick,
  handleThemeModeClick,
  handleThemePreviewClick,
  handleThemeScheduleChange,
  handleTimeFilterChange,
  setupTimeFilterControls,
  updateModalButtonsPositionButtons,
  updateThemeModeButtons,
  updateThemePreview,
} from '../ts/ui/handlers/settings-bindings.js'

// ========== DOM 构造助手 ==========

/** 建一个 select 并挂到文档 */
function mountSelect(id: string): HTMLSelectElement {
  const element = document.createElement('select')
  element.id = id
  document.body.append(element)
  return element
}

/** 建一个 input 并挂到文档 */
function mountInput(id: string): HTMLInputElement {
  const element = document.createElement('input')
  element.id = id
  document.body.append(element)
  return element
}

/** 建一个带值的 input 并挂到文档（主题定时时刻用） */
function mountInputWithValue(id: string, value: string): HTMLInputElement {
  const element = mountInput(id)
  element.value = value
  return element
}

/** 建一个 div 并挂到文档 */
function mountDiv(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.id = id
  document.body.append(element)
  return element
}

/** 追加一个 option：同一 select 需要多次改值时，取值必须先存在于 options 里 */
function appendOption(select: HTMLSelectElement, value: string): void {
  const option = document.createElement('option')
  option.value = value
  select.append(option)
}

function mountSelectWithValue(id: string, value: string): HTMLSelectElement {
  const select = mountSelect(id)
  appendOption(select, value)
  select.value = value
  return select
}

function mountCheckbox(id: string, isChecked: boolean): HTMLInputElement {
  const checkbox = mountInput(id)
  checkbox.type = 'checkbox'
  checkbox.checked = isChecked
  return checkbox
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReferences.mockGetRefreshInterval.mockReturnValue(30)
  mockReferences.mockSaveTheme.mockReturnValue(true)
  mockReferences.mockSetListType.mockReturnValue(true)
  mockReferences.mockSetLogLevel.mockReturnValue(true)
  mockReferences.mockSetRefreshInterval.mockReturnValue(true)
  mockReferences.mockSetSyncRecordEnabled.mockReturnValue(true)
  mockReferences.mockSetTimeFilter.mockReturnValue(true)
  mockReferences.mockSetThemeSchedule.mockReturnValue(true)
  mockReferences.mockGetTheme.mockReturnValue('dark')
  mockReferences.mockSetModalButtonsPosition.mockReturnValue(true)
  delete document.documentElement.dataset.theme
  document.body.replaceChildren()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('settings-bindings · handleEnableSyncRecordChange', () => {
  it('控件缺失时静默早退', () => {
    handleEnableSyncRecordChange()
    expect(mockReferences.mockSetSyncRecordEnabled).not.toHaveBeenCalled()
    expect(mockReferences.mockShowToast).not.toHaveBeenCalled()
  })

  it('勾选 → 启用并提示', () => {
    mountCheckbox('chkEnableSyncRecord', true)
    handleEnableSyncRecordChange()
    expect(mockReferences.mockSetSyncRecordEnabled).toHaveBeenCalledWith(true)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('已启用同步记录功能', 'info')
  })

  it('取消勾选 → 关闭并提示', () => {
    mountCheckbox('chkEnableSyncRecord', false)
    handleEnableSyncRecordChange()
    expect(mockReferences.mockSetSyncRecordEnabled).toHaveBeenCalledWith(false)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('已关闭同步记录功能', 'info')
  })
})

describe('settings-bindings · handleLogLevelFilterChange', () => {
  it('委托给 renderLogEntries', () => {
    handleLogLevelFilterChange()
    expect(mockReferences.mockRenderLogEntries).toHaveBeenCalledTimes(1)
  })
})

describe('settings-bindings · handleLogLevelChange', () => {
  it('下拉框缺失时早退', () => {
    handleLogLevelChange()
    expect(mockReferences.mockSetLogLevel).not.toHaveBeenCalled()
  })

  it('非整数取值早退（不落盘、不提示）', () => {
    mountSelectWithValue('logLevelSelect', 'abc')
    handleLogLevelChange()
    expect(mockReferences.mockSetLogLevel).not.toHaveBeenCalled()
    expect(mockReferences.mockShowToast).not.toHaveBeenCalled()
  })

  it('合法级别 → 落盘并提示对应标签', () => {
    mountSelectWithValue('logLevelSelect', '1')
    handleLogLevelChange()
    expect(mockReferences.mockSetLogLevel).toHaveBeenCalledWith(1)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
      '日志记录级别已设为「INFO · 常规信息」',
      'success',
    )
  })

  it('未知级别 → 提示回退为数字本身', () => {
    mountSelectWithValue('logLevelSelect', '9')
    handleLogLevelChange()
    expect(mockReferences.mockSetLogLevel).toHaveBeenCalledWith(9)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('日志记录级别已设为「9」', 'success')
  })

  it('保存失败 → 错误提示', () => {
    mockReferences.mockSetLogLevel.mockReturnValue(false)
    mountSelectWithValue('logLevelSelect', '0')
    handleLogLevelChange()
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('日志级别保存失败', 'error')
  })
})

describe('settings-bindings · updateThemePreview', () => {
  it('只给匹配的主题卡片加 active', () => {
    const dark = document.createElement('div')
    dark.dataset.themeCard = 'dark'
    const light = document.createElement('div')
    light.dataset.themeCard = 'light'
    document.body.append(dark, light)

    updateThemePreview('light')

    expect(light.classList.contains('active')).toBe(true)
    expect(dark.classList.contains('active')).toBe(false)
  })

  it('切回另一模式时旧卡片的高亮被撤销', () => {
    const dark = document.createElement('div')
    dark.dataset.themeCard = 'dark'
    document.body.append(dark)

    updateThemePreview('light')
    expect(dark.classList.contains('active')).toBe(false)

    updateThemePreview('dark')
    expect(dark.classList.contains('active')).toBe(true)
  })
})

describe('settings-bindings · handleThemeChange', () => {
  it('下拉框缺失 → 回退默认深色档', () => {
    handleThemeChange()
    expect(mockReferences.mockSaveTheme).toHaveBeenCalledWith('dark')
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('主题已切换为「深色模式」', 'success')
  })

  it('未知取值 → 提示回退为原始值', () => {
    mountSelectWithValue('themeSelect', 'sepia')
    handleThemeChange()
    expect(mockReferences.mockSaveTheme).toHaveBeenCalledWith('sepia')
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('主题已切换为「sepia」', 'success')
  })

  it('保存失败 → 错误提示，但按钮组高亮仍乐观更新', () => {
    mockReferences.mockSaveTheme.mockReturnValue(false)
    const button = mountThemeModeButton('light')
    mountSelectWithValue('themeSelect', 'light')

    handleThemeChange()

    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('主题保存失败', 'error')
    expect(button.classList.contains('active')).toBe(true)
  })
})

/** 建一个主题预览卡片，返回其内部元素（点击从内部元素冒泡到卡片） */
function mountThemeCard(mode: string | undefined): HTMLSpanElement {
  const card = document.createElement('div')
  if (mode !== undefined) card.dataset.themeCard = mode
  const span = document.createElement('span')
  card.append(span)
  document.body.append(card)
  return span
}

describe('settings-bindings · handleThemePreviewClick', () => {
  it('点击卡片 → 保存该模式并从卡片中心扩散切换', () => {
    const inner = mountThemeCard('light')

    handleThemePreviewClick({ currentTarget: inner } as unknown as Event)

    expect(mockReferences.mockSaveTheme).toHaveBeenCalledWith('light')
    expect(mockReferences.mockSwitchThemeAnimated).toHaveBeenCalledTimes(1)
  })

  it('点击非主题卡片 → 不做任何事', () => {
    const inner = mountThemeCard(undefined)
    handleThemePreviewClick({ currentTarget: inner } as unknown as Event)
    expect(mockReferences.mockSaveTheme).not.toHaveBeenCalled()
  })
})

// ========== 主题模式按钮组（momo：按钮形式 + 扩散动画） ==========

/** 建一个主题模式按钮，返回按钮本身 */
function mountThemeModeButton(mode: string | undefined): HTMLButtonElement {
  const button = document.createElement('button')
  if (mode !== undefined) button.dataset.themeMode = mode
  document.body.append(button)
  return button
}

describe('settings-bindings · handleThemeModeClick', () => {
  it('点深色 → 保存 + 从按钮中心扩散切换', () => {
    const button = mountThemeModeButton('light')
    // jsdom 的 getBoundingClientRect 全 0 → 走视口中心兜底
    handleThemeModeClick({ currentTarget: button } as unknown as Event)

    expect(mockReferences.mockSaveTheme).toHaveBeenCalledWith('light')
    expect(mockReferences.mockSwitchThemeAnimated).toHaveBeenCalledTimes(1)
    const firstCall = mockReferences.mockSwitchThemeAnimated.mock.calls[0]
    expect(firstCall?.[0]).toBe('light')
    expect(firstCall?.[1]).toEqual({ x: 512, y: 384 })
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('主题已切换为「浅色模式」', 'success')
  })

  it('已是当前主题 → 不播放扩散动画（避免同色闪一下）', () => {
    mockReferences.mockGetTheme.mockReturnValue('dark')
    document.documentElement.dataset.theme = 'dark'
    const button = mountThemeModeButton('dark')

    handleThemeModeClick({ currentTarget: button } as unknown as Event)

    expect(mockReferences.mockSaveTheme).toHaveBeenCalledWith('dark')
    expect(mockReferences.mockSwitchThemeAnimated).not.toHaveBeenCalled()
    expect(mockReferences.mockApplyTheme).toHaveBeenCalledWith('dark')
  })

  it('非 dark/light 模式（system/schedule）不走动画，直接应用', () => {
    const button = mountThemeModeButton('system')

    handleThemeModeClick({ currentTarget: button } as unknown as Event)

    expect(mockReferences.mockSaveTheme).toHaveBeenCalledWith('system')
    expect(mockReferences.mockSwitchThemeAnimated).not.toHaveBeenCalled()
    expect(mockReferences.mockApplyTheme).toHaveBeenCalledWith('system')
  })

  it('点无 data-theme-mode 的元素 → 早退', () => {
    const button = mountThemeModeButton(undefined)
    handleThemeModeClick({ currentTarget: button } as unknown as Event)
    expect(mockReferences.mockSaveTheme).not.toHaveBeenCalled()
  })

  it('保存失败 → 错误提示', () => {
    mockReferences.mockSaveTheme.mockReturnValue(false)
    const button = mountThemeModeButton('light')
    handleThemeModeClick({ currentTarget: button } as unknown as Event)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('主题保存失败', 'error')
  })
})

describe('settings-bindings · handleThemeScheduleChange', () => {
  it('两个时刻合法 → 保存并（定时模式下）立即按新时刻重解析', () => {
    mockReferences.mockGetTheme.mockReturnValue('schedule')
    mountInputWithValue('themeDarkStart', '21:30')
    mountInputWithValue('themeLightStart', '06:45')

    handleThemeScheduleChange()

    expect(mockReferences.mockSetThemeSchedule).toHaveBeenCalledWith({
      enabled: true,
      darkStart: '21:30',
      lightStart: '06:45',
    })
    expect(mockReferences.mockApplyTheme).toHaveBeenCalledWith('schedule')
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
      '定时已更新：06:45 浅 → 21:30 深',
      'success',
    )
  })

  it('非定时模式 → 只保存，不重解析', () => {
    mockReferences.mockGetTheme.mockReturnValue('dark')
    mountInputWithValue('themeDarkStart', '22:00')
    mountInputWithValue('themeLightStart', '07:00')

    handleThemeScheduleChange()

    expect(mockReferences.mockSetThemeSchedule).toHaveBeenCalledTimes(1)
    expect(mockReferences.mockApplyTheme).not.toHaveBeenCalled()
  })

  it('保存失败 → 错误提示', () => {
    mockReferences.mockSetThemeSchedule.mockReturnValue(false)
    mountInputWithValue('themeDarkStart', '99:99')
    mountInputWithValue('themeLightStart', '07:00')

    handleThemeScheduleChange()

    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('时刻格式应为 HH:MM', 'error')
  })
})

describe('settings-bindings · updateThemeModeButtons', () => {
  it('active 与 aria-pressed 只落在匹配的按钮上，定时框随 schedule 显隐', () => {
    const dark = mountThemeModeButton('dark')
    const schedule = mountThemeModeButton('schedule')
    const box = document.createElement('div')
    box.id = 'themeScheduleBox'
    document.body.append(box)

    updateThemeModeButtons('schedule')

    expect(dark.classList.contains('active')).toBe(false)
    expect(schedule.classList.contains('active')).toBe(true)
    expect(schedule.getAttribute('aria-pressed')).toBe('true')
    expect(dark.getAttribute('aria-pressed')).toBe('false')
    expect(box.hidden).toBe(false)

    updateThemeModeButtons('dark')
    expect(box.hidden).toBe(true)
  })
})

/** 建一个模态框按钮位置分段按钮 */
function mountModalButtonsPositionButton(position: string | undefined): HTMLButtonElement {
  const button = document.createElement('button')
  if (position !== undefined) button.dataset.modalButtonsPosition = position
  document.body.append(button)
  return button
}

describe('settings-bindings · 模态框按钮位置', () => {
  it('点「模态框外」→ 保存配置 + 按钮态更新 + toast', () => {
    const button = mountModalButtonsPositionButton('outside')

    handleModalButtonsPositionClick({ currentTarget: button } as unknown as Event)

    expect(mockReferences.mockSetModalButtonsPosition).toHaveBeenCalledWith('outside')
    expect(button.classList.contains('active')).toBe(true)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
      '模态框按钮位置：模态框外（标题栏右上角）',
      'success',
    )
  })

  it('点无 data 属性的元素 → 早退', () => {
    const button = mountModalButtonsPositionButton(undefined)
    handleModalButtonsPositionClick({ currentTarget: button } as unknown as Event)
    expect(mockReferences.mockSetModalButtonsPosition).not.toHaveBeenCalled()
  })

  it('保存失败 → 错误提示', () => {
    mockReferences.mockSetModalButtonsPosition.mockReturnValue(false)
    const button = mountModalButtonsPositionButton('inside')
    handleModalButtonsPositionClick({ currentTarget: button } as unknown as Event)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('保存失败', 'error')
  })

  it('updateModalButtonsPositionButtons：active 只落在匹配项', () => {
    const inside = mountModalButtonsPositionButton('inside')
    const outside = mountModalButtonsPositionButton('outside')

    updateModalButtonsPositionButtons('outside')

    expect(inside.classList.contains('active')).toBe(false)
    expect(outside.classList.contains('active')).toBe(true)
    expect(outside.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('settings-bindings · handleListTypeChange', () => {
  it('控件缺失时早退', () => {
    handleListTypeChange()
    expect(mockReferences.mockSetListType).not.toHaveBeenCalled()
  })

  it('合法取值 → 落盘并提示标签', () => {
    mountSelectWithValue('listTypeSelect', 'wish')
    handleListTypeChange()
    expect(mockReferences.mockSetListType).toHaveBeenCalledWith('wish')
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('默认收藏列表类型：想看', 'success')
  })

  it('未知取值 → 提示回退为原始值；保存失败 → 错误提示', () => {
    mountSelectWithValue('listTypeSelect', 'unknown')
    handleListTypeChange()
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith(
      '默认收藏列表类型：unknown',
      'success',
    )

    mockReferences.mockSetListType.mockReturnValue(false)
    handleListTypeChange()
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith('收藏列表类型保存失败', 'error')
  })
})

describe('settings-bindings · handleTimeFilterChange', () => {
  it('控件缺失时早退', () => {
    handleTimeFilterChange()
    expect(mockReferences.mockSetTimeFilter).not.toHaveBeenCalled()
  })

  it('合法取值 → 落盘并提示标签', () => {
    mountSelectWithValue('timeFilterSelect', 'quarter')
    handleTimeFilterChange()
    expect(mockReferences.mockSetTimeFilter).toHaveBeenCalledWith('quarter')
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
      '默认时间筛选范围：季度新番',
      'success',
    )
  })

  it('未知取值 → 回退原始值；保存失败 → 错误提示', () => {
    mountSelectWithValue('timeFilterSelect', 'unknown')
    handleTimeFilterChange()
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith(
      '默认时间筛选范围：unknown',
      'success',
    )

    mockReferences.mockSetTimeFilter.mockReturnValue(false)
    handleTimeFilterChange()
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith('时间筛选范围保存失败', 'error')
  })
})

describe('settings-bindings · handleRefreshIntervalChange', () => {
  it('控件缺失时早退', () => {
    handleRefreshIntervalChange()
    expect(mockReferences.mockSetRefreshInterval).not.toHaveBeenCalled()
  })

  it('留空 → 回填当前值，不落盘也不提示', () => {
    const input = mountInput('refreshIntervalInput')
    input.value = ' '.repeat(3)
    mockReferences.mockGetRefreshInterval.mockReturnValue(45)

    handleRefreshIntervalChange()

    expect(input.value).toBe('45')
    expect(mockReferences.mockSetRefreshInterval).not.toHaveBeenCalled()
    expect(mockReferences.mockShowToast).not.toHaveBeenCalled()
  })

  it('非数字 / 越界 → 警告并回填当前值', () => {
    const input = mountInput('refreshIntervalInput')
    mockReferences.mockGetRefreshInterval.mockReturnValue(30)

    for (const raw of ['abc', '-1', '1441']) {
      vi.clearAllMocks()
      mockReferences.mockGetRefreshInterval.mockReturnValue(30)
      input.value = raw

      handleRefreshIntervalChange()

      expect(mockReferences.mockSetRefreshInterval).not.toHaveBeenCalled()
      expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
        '刷新间隔需为 0–1440 之间的整数（分钟）',
        'warn',
      )
      expect(input.value).toBe('30')
    }
  })

  it('0 分钟 → 落盘并标注「已关闭」', () => {
    const input = mountInput('refreshIntervalInput')
    input.value = '0'
    handleRefreshIntervalChange()
    expect(mockReferences.mockSetRefreshInterval).toHaveBeenCalledWith(0)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
      '自动刷新间隔已设为 0 分钟（已关闭）',
      'success',
    )
  })

  it('小数 → 按原值落盘、提示按四舍五入展示', () => {
    const input = mountInput('refreshIntervalInput')
    input.value = '15.4'
    handleRefreshIntervalChange()
    expect(mockReferences.mockSetRefreshInterval).toHaveBeenCalledWith(15.4)
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
      '自动刷新间隔已设为 15 分钟',
      'success',
    )
  })

  it('保存失败 → 错误提示', () => {
    mockReferences.mockSetRefreshInterval.mockReturnValue(false)
    const input = mountInput('refreshIntervalInput')
    input.value = '10'
    handleRefreshIntervalChange()
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith('刷新间隔保存失败', 'error')
  })
})

describe('settings-bindings · setupTimeFilterControls', () => {
  it('缺少复选框或容器时早退（不注册任何监听）', () => {
    expect(() => {
      setupTimeFilterControls()
    }).not.toThrow()

    mountCheckbox('chkTimeFilter', false)
    expect(() => {
      setupTimeFilterControls()
    }).not.toThrow()
  })

  it('复选框切换 → 显示/隐藏筛选控件区', () => {
    const checkbox = mountCheckbox('chkTimeFilter', false)
    const controls = mountDiv('timeFilterControls')
    setupTimeFilterControls()

    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    expect(controls.style.display).toBe('block')

    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change'))
    expect(controls.style.display).toBe('none')
  })

  it('筛选范围切到「预告/未来」→ 隐藏年月季度、显示提示行', () => {
    mountCheckbox('chkTimeFilter', true)
    mountDiv('timeFilterControls')
    const range = mountSelectWithValue('timeFilterRange', 'future')
    const yearRow = mountDiv('yearRow')
    const quarterRow = mountDiv('quarterRow')
    const monthRow = mountDiv('monthRow')
    const futureHintRow = mountDiv('futureHintRow')
    setupTimeFilterControls()

    range.dispatchEvent(new Event('change'))

    expect(yearRow.style.display).toBe('none')
    expect(quarterRow.style.display).toBe('none')
    expect(monthRow.style.display).toBe('none')
    expect(futureHintRow.style.display).toBe('')
  })

  it('筛选范围切到「季度」/「月份」→ 只显示对应行', () => {
    mountCheckbox('chkTimeFilter', true)
    mountDiv('timeFilterControls')
    const range = mountSelectWithValue('timeFilterRange', 'quarter')
    appendOption(range, 'month')
    const yearRow = mountDiv('yearRow')
    const quarterRow = mountDiv('quarterRow')
    const monthRow = mountDiv('monthRow')
    const futureHintRow = mountDiv('futureHintRow')
    setupTimeFilterControls()

    range.value = 'quarter'
    range.dispatchEvent(new Event('change'))
    expect(quarterRow.style.display).toBe('')
    expect(monthRow.style.display).toBe('none')
    expect(yearRow.style.display).toBe('')
    // 非 future 范围时提示行必须收起（否则会残留「预告」说明文字）
    expect(futureHintRow.style.display).toBe('none')

    range.value = 'month'
    range.dispatchEvent(new Event('change'))
    expect(monthRow.style.display).toBe('')
    expect(quarterRow.style.display).toBe('none')
  })

  it('缺少提示行元素时不报错（提示行非必需）', () => {
    mountCheckbox('chkTimeFilter', true)
    mountDiv('timeFilterControls')
    const range = mountSelectWithValue('timeFilterRange', 'future')
    mountDiv('yearRow')
    mountDiv('quarterRow')
    mountDiv('monthRow')
    setupTimeFilterControls()

    expect(() => {
      range.dispatchEvent(new Event('change'))
    }).not.toThrow()
  })
})
