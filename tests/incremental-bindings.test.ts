// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/incremental-bindings.ts`（增量同步 / 冲突策略 UI 绑定）单元测试。
 *
 * 依赖形状（决定 mock 策略）：
 *   - `../../index.js` **barrel** → 单点 mock，工厂内只 `await import('core/constants.js')`
 *     取真实 `LOG_LEVELS`（**绝不能**改成 `importOriginal()`：barrel 与
 *     `ribbon-service` / `handlers/sync` 互相 re-export，会死锁并让 vitest 静默
 *     回退真实现 —— 见 `.workbuddy/memory/REF-testing.md`）；
 *   - `./panel-context.js` → 1 行谓词，mock 一个可翻转开关来控制「是否任务窗格上下文」；
 *   - `./resource-tracking.js` → **用真实模块**：它只是 `addEventListener` 的薄包装，
 *     用真的才能「挂载 DOM → 派发 change 事件 → 断言 handler 真被执行」，
 *     而不是断言「某个 mock 被调用过」这种假覆盖。
 *
 * 重试链路（`tryUpdateSkipConflictsUI` 的 3 次 × 100ms）用 `vi.useFakeTimers()` 推进，
 * 逐跳验证：未找到 → 排定时器 → 重试 → 命中 / 退到 radio / 退到 checkbox / 静默结束。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: unknown, message: string) => void>(),
  handleError: vi.fn<(error: unknown, options?: unknown) => void>(),
  isIncrementalSyncEnabled: vi.fn((): boolean => true),
  isSkipConflictsEnabled: vi.fn((): boolean => false),
  setIncrementalSync: vi.fn((): boolean => true),
  setSkipConflicts: vi.fn((): boolean => true),
}))

/** 宿主上下文开关：翻转它即可覆盖 `if (!isPanelContext()) return` 的早退分支 */
const { flags } = vi.hoisted(() => ({
  flags: { isPanel: true },
}))

vi.mock('../ts/index.js', async () => {
  const constants = await import('../ts/core/constants.js')
  return {
    LOG_LEVELS: constants.LOG_LEVELS,
    bgmLog: m.bgmLog,
    BGM: {
      handleError: m.handleError,
      ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
    },
    isIncrementalSyncEnabled: m.isIncrementalSyncEnabled,
    isSkipConflictsEnabled: m.isSkipConflictsEnabled,
    setIncrementalSync: m.setIncrementalSync,
    setSkipConflicts: m.setSkipConflicts,
  }
})

vi.mock('../ts/ui/handlers/panel-context.js', () => ({
  isPanelContext: () => flags.isPanel,
}))

import { LOG_LEVELS } from '../ts/core/constants.js'
import { clearTrackedListeners } from '../ts/ui/handlers/resource-tracking.js'
import {
  handleChkSkipConflictsChange,
  handleConflictStrategyChange,
  handleIncrementalChange,
  handleOverwriteRadioChange,
  handleSkipRadioChange,
  initIncrementalSyncFromRibbon,
  initSkipConflictsFromRibbon,
  tryUpdateEnableSyncRecordUI,
  tryUpdateIncrementalCheckbox,
  tryUpdateSkipConflictsUI,
} from '../ts/ui/handlers/incremental-bindings.js'

// ========== DOM 辅助 ==========

function mountElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (id !== undefined) element.id = id
  document.body.append(element)
  return element
}

function mountInput(id: string): HTMLInputElement {
  return mountElement('input', id)
}

/**
 * 挂载带选项的 select。**必须有同名 option**：与浏览器一致，jsdom 里给
 * `select.value` 赋一个不存在的 option 值会被静默丢弃（值保持 `''`），
 * 缺选项的用例会得到「看似没生效」的假失败。
 */
function mountSelect(id: string, values: string[] = ['skip', 'excel']): HTMLSelectElement {
  const select = mountElement('select', id)
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    select.append(option)
  }
  return select
}

/** 挂载一组冲突策略 radio（`name=conflictStrategy`，值为 skip / overwrite） */
function mountStrategyRadios(): { skip: HTMLInputElement; overwrite: HTMLInputElement } {
  const skip = mountElement('input')
  skip.type = 'radio'
  skip.name = 'conflictStrategy'
  skip.value = 'skip'
  const overwrite = mountElement('input')
  overwrite.type = 'radio'
  overwrite.name = 'conflictStrategy'
  overwrite.value = 'overwrite'
  return { skip, overwrite }
}

function dispatchChange(element: HTMLElement): void {
  element.dispatchEvent(new Event('change'))
}

// ========== 日志辅助 ==========

/**
 * 取全部日志消息体。`LOG_LEVELS.INFO` 是**数字**而非字符串，
 * 首参不能用 `expect.any(String)` 匹配，因此统一取第二个参数。
 */
function logMessages(): string[] {
  return m.bgmLog.mock.calls.map((call) => call[1])
}

function hasLog(fragment: string): boolean {
  return logMessages().some((message) => message.includes(fragment))
}

function hasLogAtLevel(level: number, fragment: string): boolean {
  return m.bgmLog.mock.calls.some(
    (call) => call[0] === level && call[1].includes(fragment),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  // 全文件统一假时钟：重试链路显式 advance，其余用例下「没人推进的定时器」
  // 绝不会在后续用例里突然触发并改动新挂载的 DOM（真实定时器会跨用例串场）
  vi.useFakeTimers()
  document.body.replaceChildren()
  clearTrackedListeners()
  flags.isPanel = true
  // 默认值集中锚定：resetAllMocks 清掉了实现，这里把基线重新压回去
  m.isIncrementalSyncEnabled.mockReturnValue(true)
  m.isSkipConflictsEnabled.mockReturnValue(false)
  m.setIncrementalSync.mockReturnValue(true)
  m.setSkipConflicts.mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

// ========== tryUpdateIncrementalCheckbox ==========

describe('tryUpdateIncrementalCheckbox', () => {
  it('非任务窗格上下文 → 直接返回且不碰 DOM', () => {
    flags.isPanel = false
    const checkbox = mountInput('chkIncremental')

    tryUpdateIncrementalCheckbox(true)

    expect(checkbox.checked).toBe(false)
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('元素不存在 → 静默跳过（不刷 ERROR 日志）', () => {
    tryUpdateIncrementalCheckbox(true)

    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('元素存在 → 回写 checked 并打两条状态日志', () => {
    const checkbox = mountInput('chkIncremental')

    tryUpdateIncrementalCheckbox(true)

    expect(checkbox.checked).toBe(true)
    expect(hasLog('增量同步复选框已更新: 开启')).toBe(true)
    expect(hasLogAtLevel(LOG_LEVELS.INFO, '当前状态: 关闭')).toBe(true)
  })

  it('目标为关闭 → 日志显示「关闭」并回写 false', () => {
    const checkbox = mountInput('chkIncremental')
    checkbox.checked = true

    tryUpdateIncrementalCheckbox(false)

    expect(checkbox.checked).toBe(false)
    expect(hasLog('增量同步复选框已更新: 关闭')).toBe(true)
    expect(hasLogAtLevel(LOG_LEVELS.INFO, '当前状态: 开启')).toBe(true)
  })
})

// ========== tryUpdateSkipConflictsUI ==========

describe('tryUpdateSkipConflictsUI · 主路径（select 存在）', () => {
  it('非任务窗格上下文 → 直接返回', () => {
    flags.isPanel = false
    const select = mountSelect('conflictStrategy')
    select.value = 'excel'

    tryUpdateSkipConflictsUI(true)

    // 未被改写：仍是用例预置的值
    expect(select.value).toBe('excel')
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('shouldSkipConflicts=true → select 置为 skip', () => {
    const select = mountSelect('conflictStrategy')

    tryUpdateSkipConflictsUI(true)

    expect(select.value).toBe('skip')
    expect(hasLog('找到 conflictStrategy select 元素')).toBe(true)
    expect(hasLog('冲突策略 select 已更新: skip')).toBe(true)
  })

  it('shouldSkipConflicts=false → select 置为 excel', () => {
    const select = mountSelect('conflictStrategy')

    tryUpdateSkipConflictsUI(false)

    expect(select.value).toBe('excel')
    expect(hasLog('目标状态: Excel覆盖')).toBe(true)
  })
})

describe('tryUpdateSkipConflictsUI · 重试链路', () => {
  it('首次未找到 → 排 100ms 定时器；元素随后出现则重试命中', () => {
    tryUpdateSkipConflictsUI(true)
    expect(hasLogAtLevel(LOG_LEVELS.WARN, '未找到 conflictStrategy select 元素，延迟重试 (1/3)')).toBe(
      true,
    )
    // 首次未命中只排定时器，不应直接升级为 ERROR
    expect(hasLogAtLevel(LOG_LEVELS.ERROR, '重试3次后仍未找到')).toBe(false)

    // 面板后续才渲染出 select
    const select = mountSelect('conflictStrategy')
    vi.advanceTimersByTime(100)

    expect(select.value).toBe('skip')
    expect(hasLog('冲突策略 select 已更新: skip')).toBe(true)
  })

  it('连续 3 次未找到 → 落到 radio 备用控件并互斥勾选', () => {
    const { skip, overwrite } = mountStrategyRadios()

    tryUpdateSkipConflictsUI(true)
    // 重试 1 → 重试 2 → 重试 3 用尽后转备用控件
    vi.advanceTimersByTime(100)
    vi.advanceTimersByTime(100)
    vi.advanceTimersByTime(100)

    expect(hasLogAtLevel(LOG_LEVELS.ERROR, '重试3次后仍未找到 conflictStrategy select 元素')).toBe(true)
    expect(skip.checked).toBe(true)
    expect(overwrite.checked).toBe(false)
    expect(hasLog('冲突策略 radio 已更新')).toBe(true)
  })

  it('重试 3 次后无 radio → 落到 #chkSkipConflicts 复选框', () => {
    const checkbox = mountInput('chkSkipConflicts')

    tryUpdateSkipConflictsUI(true, 3)

    expect(checkbox.checked).toBe(true)
    expect(hasLog('跳过冲突复选框已更新')).toBe(true)
  })

  it('重试 3 次后三种控件都没有 → 只留 ERROR 日志，不抛错', () => {
    expect(() => {
      tryUpdateSkipConflictsUI(false, 3)
    }).not.toThrow()

    expect(hasLog('重试3次后仍未找到')).toBe(true)
    expect(hasLog('冲突策略 radio 已更新')).toBe(false)
    expect(hasLog('跳过冲突复选框已更新')).toBe(false)
  })

  it('radio 只找到一个（另一个缺失）→ 不算命中，继续往下找', () => {
    const skipOnly = mountElement('input')
    skipOnly.name = 'conflictStrategy'
    skipOnly.value = 'skip'
    const checkbox = mountInput('chkSkipConflicts')

    tryUpdateSkipConflictsUI(true, 3)

    expect(skipOnly.checked).toBe(false)
    expect(checkbox.checked).toBe(true)
  })
})

// ========== tryUpdateEnableSyncRecordUI ==========

describe('tryUpdateEnableSyncRecordUI', () => {
  it('非任务窗格上下文 → 直接返回', () => {
    flags.isPanel = false
    const checkbox = mountInput('chkEnableSyncRecord')

    tryUpdateEnableSyncRecordUI(true)

    expect(checkbox.checked).toBe(false)
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('元素不存在 → 静默跳过', () => {
    tryUpdateEnableSyncRecordUI(true)

    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('元素存在 → 回写 checked 并同时打印当前 / 目标状态', () => {
    const checkbox = mountInput('chkEnableSyncRecord')

    tryUpdateEnableSyncRecordUI(true)

    expect(checkbox.checked).toBe(true)
    expect(hasLog('当前状态: 关闭，目标状态: 开启')).toBe(true)
    expect(hasLog('启用同步记录复选框已更新: 开启')).toBe(true)
  })

  it('目标为关闭 → 回写 false', () => {
    const checkbox = mountInput('chkEnableSyncRecord')
    checkbox.checked = true

    tryUpdateEnableSyncRecordUI(false)

    expect(checkbox.checked).toBe(false)
    expect(hasLog('启用同步记录复选框已更新: 关闭')).toBe(true)
  })
})

// ========== handleIncrementalChange ==========

describe('handleIncrementalChange', () => {
  it('元素不存在 → 直接返回', () => {
    handleIncrementalChange()

    expect(m.setIncrementalSync).not.toHaveBeenCalled()
  })

  it('勾选中 → setIncrementalSync(true) 成功路径', () => {
    const checkbox = mountInput('chkIncremental')
    checkbox.checked = true

    handleIncrementalChange()

    expect(m.setIncrementalSync).toHaveBeenCalledWith(true)
    expect(hasLog('增量同步状态已成功同步到配置和 Ribbon')).toBe(true)
  })

  it('取消勾选 → setIncrementalSync(false)，写入失败落 WARN', () => {
    const checkbox = mountInput('chkIncremental')
    checkbox.checked = false
    m.setIncrementalSync.mockReturnValue(false)

    handleIncrementalChange()

    expect(m.setIncrementalSync).toHaveBeenCalledWith(false)
    expect(hasLogAtLevel(LOG_LEVELS.WARN, '增量同步状态同步失败')).toBe(true)
  })

  it('写入抛错 → 落 WARN 且不向上抛', () => {
    const checkbox = mountInput('chkIncremental')
    checkbox.checked = true
    m.setIncrementalSync.mockImplementation(() => {
      throw new Error('Ribbon 不可用')
    })

    expect(() => {
      handleIncrementalChange()
    }).not.toThrow()

    expect(hasLogAtLevel(LOG_LEVELS.WARN, '更新增量同步状态失败: Ribbon 不可用')).toBe(true)
  })
})

// ========== handleConflictStrategyChange ==========

describe('handleConflictStrategyChange', () => {
  it('select 不存在 → 直接返回', () => {
    handleConflictStrategyChange()

    expect(m.setSkipConflicts).not.toHaveBeenCalled()
  })

  it('选中 skip → setSkipConflicts(true)', () => {
    const select = mountSelect('conflictStrategy')
    select.value = 'skip'

    handleConflictStrategyChange()

    expect(m.setSkipConflicts).toHaveBeenCalledWith(true)
    expect(hasLog('策略类型: 跳过冲突（保留Bangumi数据）')).toBe(true)
    expect(hasLog('冲突策略已成功同步到配置和 Ribbon')).toBe(true)
  })

  it('选中 excel → setSkipConflicts(false)，写入失败落 WARN', () => {
    const select = mountSelect('conflictStrategy')
    select.value = 'excel'
    m.setSkipConflicts.mockReturnValue(false)

    handleConflictStrategyChange()

    expect(m.setSkipConflicts).toHaveBeenCalledWith(false)
    expect(hasLog('策略类型: Excel覆盖（用Excel数据覆盖）')).toBe(true)
    expect(hasLogAtLevel(LOG_LEVELS.WARN, '冲突策略同步失败')).toBe(true)
  })
})

// ========== radio / checkbox 变更处理器 ==========

describe('handleSkipRadioChange / handleOverwriteRadioChange', () => {
  it('skip radio 未勾选 → 不写配置', () => {
    mountStrategyRadios()

    handleSkipRadioChange()

    expect(m.setSkipConflicts).not.toHaveBeenCalled()
  })

  it('skip radio 勾选 → setSkipConflicts(true)', () => {
    const { skip } = mountStrategyRadios()
    skip.checked = true

    handleSkipRadioChange()

    expect(m.setSkipConflicts).toHaveBeenCalledWith(true)
    expect(hasLog('冲突策略已更新: 跳过冲突')).toBe(true)
  })

  it('overwrite radio 勾选 → setSkipConflicts(false)', () => {
    const { overwrite } = mountStrategyRadios()
    overwrite.checked = true

    handleOverwriteRadioChange()

    expect(m.setSkipConflicts).toHaveBeenCalledWith(false)
    expect(hasLog('冲突策略已更新: Excel覆盖')).toBe(true)
  })

  it('overwrite radio 未勾选 → 不写配置', () => {
    mountStrategyRadios()

    handleOverwriteRadioChange()

    expect(m.setSkipConflicts).not.toHaveBeenCalled()
  })

  it('radio 完全不存在 → 不抛错', () => {
    expect(() => {
      handleSkipRadioChange()
      handleOverwriteRadioChange()
    }).not.toThrow()

    expect(m.setSkipConflicts).not.toHaveBeenCalled()
  })
})

describe('handleChkSkipConflictsChange', () => {
  it('元素不存在 → 直接返回', () => {
    handleChkSkipConflictsChange()

    expect(m.setSkipConflicts).not.toHaveBeenCalled()
  })

  it('勾选中 → setSkipConflicts(true)', () => {
    const checkbox = mountInput('chkSkipConflicts')
    checkbox.checked = true

    handleChkSkipConflictsChange()

    expect(m.setSkipConflicts).toHaveBeenCalledWith(true)
    expect(hasLog('跳过冲突状态已更新: 跳过冲突')).toBe(true)
  })

  it('取消勾选 → setSkipConflicts(false)', () => {
    mountInput('chkSkipConflicts')

    handleChkSkipConflictsChange()

    expect(m.setSkipConflicts).toHaveBeenCalledWith(false)
    expect(hasLog('跳过冲突状态已更新: Excel覆盖')).toBe(true)
  })

  it('写入抛错 → 落 WARN 且不向上抛', () => {
    const checkbox = mountInput('chkSkipConflicts')
    checkbox.checked = true
    m.setSkipConflicts.mockImplementation(() => {
      throw new Error('配置只读')
    })

    expect(() => {
      handleChkSkipConflictsChange()
    }).not.toThrow()

    expect(hasLogAtLevel(LOG_LEVELS.WARN, '更新跳过冲突状态失败: 配置只读')).toBe(true)
  })
})

// ========== initIncrementalSyncFromRibbon ==========

describe('initIncrementalSyncFromRibbon', () => {
  it('非任务窗格上下文 → 直接返回', () => {
    flags.isPanel = false
    const checkbox = mountInput('chkIncremental')
    m.isIncrementalSyncEnabled.mockReturnValue(true)

    initIncrementalSyncFromRibbon()

    expect(checkbox.checked).toBe(false)
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('复选框不存在 → 增量部分直接返回，但冲突策略仍要初始化', () => {
    // 主面板 panel.html 只有 #conflictStrategy、没有 #chkIncremental。
    // 旧实现把 initSkipConflictsFromRibbon 放在函数尾部，被早退挡住 →
    // 冲突策略下拉的 change 监听永不注册，用户改了下拉却不落配置。
    const select = mountSelect('conflictStrategy')
    select.value = 'excel'

    initIncrementalSyncFromRibbon()

    expect(m.isIncrementalSyncEnabled).not.toHaveBeenCalled()
    expect(hasLog('已注册冲突策略 select 变化监听器')).toBe(true)

    // 监听器真的连上了：改下拉应落配置
    select.value = 'skip'
    dispatchChange(select)
    expect(m.setSkipConflicts).toHaveBeenCalledWith(true)
  })

  it('从配置读取状态回填复选框，并真连上 change 事件', () => {
    const checkbox = mountInput('chkIncremental')
    m.isIncrementalSyncEnabled.mockReturnValue(true)

    initIncrementalSyncFromRibbon()

    expect(checkbox.checked).toBe(true)
    expect(hasLog('从配置读取增量同步状态: 开启')).toBe(true)

    // 真实资源追踪模块注册的是真的 addEventListener：派发事件应触发 handler
    checkbox.checked = false
    dispatchChange(checkbox)
    expect(m.setIncrementalSync).toHaveBeenCalledWith(false)
  })

  it('配置为关闭 → 复选框回填 false', () => {
    const checkbox = mountInput('chkIncremental')
    checkbox.checked = true
    m.isIncrementalSyncEnabled.mockReturnValue(false)

    initIncrementalSyncFromRibbon()

    expect(checkbox.checked).toBe(false)
    expect(hasLog('从配置读取增量同步状态: 关闭')).toBe(true)
  })

  it('读取配置抛错 → 落 WARN，但仍继续注册监听与初始化冲突策略', () => {
    mountInput('chkIncremental')
    const select = mountSelect('conflictStrategy')
    m.isIncrementalSyncEnabled.mockImplementation(() => {
      throw new Error('配置损坏')
    })

    initIncrementalSyncFromRibbon()

    expect(hasLogAtLevel(LOG_LEVELS.WARN, '读取增量同步状态失败: 配置损坏')).toBe(true)
    expect(hasLog('已注册冲突策略 select 变化监听器')).toBe(true)

    select.value = 'skip'
    dispatchChange(select)
    expect(m.setSkipConflicts).toHaveBeenCalledWith(true)
  })
})

// ========== initSkipConflictsFromRibbon ==========

describe('initSkipConflictsFromRibbon', () => {
  it('非任务窗格上下文 → 直接返回', () => {
    flags.isPanel = false

    initSkipConflictsFromRibbon()

    expect(m.isSkipConflictsEnabled).not.toHaveBeenCalled()
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('select 存在 → 回填值并注册 change 监听', () => {
    const select = mountSelect('conflictStrategy')
    m.isSkipConflictsEnabled.mockReturnValue(true)

    initSkipConflictsFromRibbon()

    expect(select.value).toBe('skip')
    expect(hasLog('从配置读取跳过冲突状态: 跳过冲突')).toBe(true)
    expect(hasLog('已注册冲突策略 select 变化监听器')).toBe(true)

    select.value = 'excel'
    dispatchChange(select)
    expect(m.setSkipConflicts).toHaveBeenCalledWith(false)
  })

  it('读取配置抛错 → 交给 BGM.handleError 上报，后续监听仍注册', () => {
    const select = mountSelect('conflictStrategy')
    select.value = 'excel'
    m.isSkipConflictsEnabled.mockImplementation(() => {
      throw new Error('配置损坏')
    })

    initSkipConflictsFromRibbon()

    const options = m.handleError.mock.calls[0]?.[1]
    expect(options).toMatchObject({
      showAlert: false,
      // BGM.ErrorLevel.WARN
      level: 1,
      context: 'initSkipConflictsFromRibbon',
    })
    expect(hasLog('已注册冲突策略 select 变化监听器')).toBe(true)
    // 回填逻辑在 try 内、抛错后未执行，预置值保持不变
    expect(select.value).toBe('excel')
  })

  it('无 select 但 radio 成对存在 → 两个 radio 都注册 change 监听', () => {
    const { skip, overwrite } = mountStrategyRadios()

    initSkipConflictsFromRibbon()

    skip.checked = true
    dispatchChange(skip)
    expect(m.setSkipConflicts).toHaveBeenLastCalledWith(true)

    overwrite.checked = true
    dispatchChange(overwrite)
    expect(m.setSkipConflicts).toHaveBeenLastCalledWith(false)
  })

  it('无 select 无 radio 但有 #chkSkipConflicts → 注册复选框监听', () => {
    const checkbox = mountInput('chkSkipConflicts')

    initSkipConflictsFromRibbon()

    checkbox.checked = true
    dispatchChange(checkbox)

    expect(m.setSkipConflicts).toHaveBeenCalledWith(true)
  })

  it('三种控件都没有 → 静默结束，不抛错', () => {
    expect(() => {
      initSkipConflictsFromRibbon()
    }).not.toThrow()

    expect(hasLog('已注册冲突策略 select 变化监听器')).toBe(false)
  })
})
