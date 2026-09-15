// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/panel-page.ts` 的单元测试。
 *
 * 该文件是面板的**聚合入口**：把 barrel（`../index.js`）、`panel-lifecycle`、
 * `tools/locked-sheet`、`user-info-polling` 四路依赖装配起来，并在模块求值时把
 * `initPanelCore` / `refreshPanelUI` 挂到 `window`（宿主桥接契约）。
 *
 * ## 断言口径
 * - 依赖全部换成 spy（本文件不碰真实 COM），断言打在**真实 DOM 写入**与**真实配置调用**上
 *   （`sheetSelect.value` / `saveLockedSheet(null)` / `BGM.sheet.*` 字段），不是 `not.toThrow()`。
 * - `window` / `document` 上的监听器**跨用例累积**（`initPanelCore` 每次调用都再注册一遍），
 *   且清 body 清不掉 window 上的。所以这类断言一律用 `toHaveBeenCalled()`，
 *   绝不用 `toHaveBeenCalledTimes(n)`。
 * - `bootstrapSheetSelection` 是 `setTimeout(…, 0)` 延迟执行的，需要 `advanceTimersByTime(0)` 才会跑。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({
  getApp: vi.fn(),
  bgmLog: vi.fn(),
  updateTokenStatus: vi.fn(),
  updateUserIdStatus: vi.fn(),
  closeDetailModal: vi.fn(),
  removeMessageListener: vi.fn(),
  clearAllPendingTimeouts: vi.fn(),
  handleError: vi.fn(),
  abort: vi.fn(),
  updateLockButton: vi.fn(),
  refreshSheets: vi.fn(),
  refreshWorkbooks: vi.fn(),
  autoDetectSheet: vi.fn(),
  refreshData: vi.fn(),
  onSelectModeChange: vi.fn(),
  autoDetectAndLockSheet: vi.fn(),
  saveLockedSheet: vi.fn(),
  restoreLockedSheet: vi.fn(),
  restoreUserInfoFromStorage: vi.fn(),
  startUserInfoPolling: vi.fn(),
  // 可变的 BGM 命名空间（用例直接改 sheet 字段驱动分支）
  bgm: {
    sheet: {
      isLocked: false,
      lockedIndex: null as number | null,
      lockedName: null as string | null,
      lockedWorkbookName: null as string | null,
    },
    abortController: { abort: vi.fn() },
    handleError: vi.fn(),
    ErrorLevel: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  },
}))

vi.mock('../ts/index.js', () => ({
  WPS_ENUM: { msoAutomationSecurityLow: 1 },
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  getApp: stubs.getApp,
  bgmLog: stubs.bgmLog,
  BGM: stubs.bgm,
  updateTokenStatus: stubs.updateTokenStatus,
  updateUserIdStatus: stubs.updateUserIdStatus,
  closeDetailModal: stubs.closeDetailModal,
  removeMessageListener: stubs.removeMessageListener,
  clearAllPendingTimeouts: stubs.clearAllPendingTimeouts,
}))

vi.mock('../ts/panel/panel-lifecycle.js', () => ({
  updateLockButton: stubs.updateLockButton,
  refreshSheets: stubs.refreshSheets,
  refreshWorkbooks: stubs.refreshWorkbooks,
  autoDetectSheet: stubs.autoDetectSheet,
  refreshData: stubs.refreshData,
  onSelectModeChange: stubs.onSelectModeChange,
  autoDetectAndLockSheet: stubs.autoDetectAndLockSheet,
}))

vi.mock('../ts/tools/locked-sheet.js', () => ({
  saveLockedSheet: stubs.saveLockedSheet,
  restoreLockedSheet: stubs.restoreLockedSheet,
}))

vi.mock('../ts/panel/user-info-polling.js', () => ({
  restoreUserInfoFromStorage: stubs.restoreUserInfoFromStorage,
  startUserInfoPolling: stubs.startUserInfoPolling,
}))

import { initPanel, initPanelCore } from '../ts/panel/panel-page.js'

/** 建面板最小宿主 DOM（含各选择器与模态框） */
function mountPanelDom(): void {
  document.body.innerHTML = `
    <select id="sheetSelect"></select>
    <select id="workbookSelect"></select>
    <input type="radio" name="selectMode" value="auto">
    <input type="radio" name="selectMode" value="manual">
    <button id="closeSyncPreview"></button>
    <div id="syncPreviewModal" style="display: block"></div>
  `
}

/** bgmLog 是否输出过包含某片段的日志 */
function hasLog(fragment: string): boolean {
  return stubs.bgmLog.mock.calls.some((call) => String(call[1]).includes(fragment))
}

/**
 * 给下拉框预置 option。
 * jsdom 对「没有同名 option」的 `select.value = 'x'` 会**静默丢弃**赋值（取值保持 `''`），
 * 所以凡是要断言 `select.value` 的用例，必须先把目标值做成 option。
 */
function addOptions(id: string, ...values: string[]): HTMLSelectElement {
  const select = document.getElementById(id) as HTMLSelectElement
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    select.append(option)
  }
  return select
}

beforeEach(() => {
  vi.clearAllMocks()
  stubs.handleError.mockClear()
  stubs.bgm.handleError = stubs.handleError
  stubs.bgm.abortController = { abort: stubs.abort }
  stubs.bgm.sheet.isLocked = false
  stubs.bgm.sheet.lockedIndex = null
  stubs.bgm.sheet.lockedName = null
  stubs.bgm.sheet.lockedWorkbookName = null
  stubs.restoreLockedSheet.mockReturnValue(false)
  stubs.autoDetectSheet.mockReturnValue(null)
  stubs.getApp.mockReturnValue(null)
  vi.useFakeTimers()
  mountPanelDom()
})

describe('window 桥接契约', () => {
  it('模块求值时把两个入口挂到 window，且可写可配置', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'initPanelCore')
    const refreshDescriptor = Object.getOwnPropertyDescriptor(window, 'refreshPanelUI')

    expect(typeof descriptor?.value).toBe('function')
    expect(descriptor?.writable).toBe(true)
    expect(descriptor?.configurable).toBe(true)
    expect(typeof refreshDescriptor?.value).toBe('function')
  })

  it('refreshPanelUI 恢复用户信息并打印日志', () => {
    const refresh = (window as unknown as { refreshPanelUI: () => void }).refreshPanelUI

    refresh()

    expect(stubs.restoreUserInfoFromStorage).toHaveBeenCalled()
    expect(hasLog('[refreshPanelUI] UI 已刷新')).toBe(true)
  })

  it('refreshPanelUI 失败时记 WARN（不向宿主抛错）', () => {
    stubs.restoreUserInfoFromStorage.mockImplementationOnce(() => {
      throw new Error('storage 坏了')
    })
    const refresh = (window as unknown as { refreshPanelUI: () => void }).refreshPanelUI

    expect(() => {
      refresh()
    }).not.toThrow()

    expect(hasLog('[refreshPanelUI] 刷新失败: storage 坏了')).toBe(true)
  })
})

describe('initPanel', () => {
  it('readyState=complete → 立即同步初始化并广播模块就绪', () => {
    const ready: string[] = []
    document.addEventListener('bgm:modulesReady', () => {
      ready.push('ready')
    })

    initPanel()

    expect(hasLog('initPanelCore 完成')).toBe(true)
    expect(ready).toHaveLength(1)
  })

  it('readyState 非 complete → 推迟到 load 事件', () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
    try {
      initPanel()
      expect(hasLog('initPanelCore 开始')).toBe(false)

      window.dispatchEvent(new Event('load'))
      expect(hasLog('initPanelCore 开始')).toBe(true)
    } finally {
      Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true })
    }
  })

  it('初始化抛错 → 走 handleError 并仍然广播模块就绪（按钮不会永久禁用）', () => {
    stubs.restoreUserInfoFromStorage.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const ready: string[] = []
    document.addEventListener('bgm:modulesReady', () => {
      ready.push('ready')
    })

    initPanel()

    expect(stubs.handleError).toHaveBeenCalledWith(expect.any(Error), {
      showAlert: false,
      level: 'INFO',
      context: 'initPanelCore',
    })
    expect(ready).toHaveLength(1)
  })

  it('无 document 环境时走同步分支（因缺少 DOM 而失败，但确实同步进入）', () => {
    // 注意：`vi.stubGlobal('document', undefined)` 让 `typeof document === 'undefined'` 成立，
    // 但 `document.getElementById` 会抛 TypeError（而不是 ReferenceError）
    vi.stubGlobal('document', undefined)
    try {
      expect(() => {
        initPanel()
      }).toThrow(TypeError)
      // 同步进入 initPanelCore 的证据：这些步骤在触碰 document 之前
      expect(stubs.restoreUserInfoFromStorage).toHaveBeenCalled()
      expect(stubs.updateTokenStatus).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('initPanelCore · 装配', () => {
  it('宿主未设置 Enum 时补上 WPS_ENUM', () => {
    const app: { Enum?: unknown } = {}
    stubs.getApp.mockReturnValue(app)

    initPanelCore()

    expect(app.Enum).toEqual({ msoAutomationSecurityLow: 1 })
  })

  it('宿主已设置 Enum 时不覆盖', () => {
    const existing = { custom: true }
    const app: { Enum?: unknown } = { Enum: existing }
    stubs.getApp.mockReturnValue(app)

    initPanelCore()

    expect(app.Enum).toBe(existing)
  })

  it('无宿主时不抛错', () => {
    stubs.getApp.mockReturnValue(null)

    expect(() => {
      initPanelCore()
    }).not.toThrow()
  })

  it('恢复用户信息、启动轮询、恢复锁定表并刷新状态显示', () => {
    initPanelCore()

    expect(stubs.restoreUserInfoFromStorage).toHaveBeenCalledTimes(1)
    expect(stubs.startUserInfoPolling).toHaveBeenCalledTimes(1)
    expect(stubs.restoreLockedSheet).toHaveBeenCalledTimes(1)
    expect(stubs.updateTokenStatus).toHaveBeenCalledTimes(1)
    expect(stubs.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('首帧之后才做工作表扫描（setTimeout 0 宏任务）', () => {
    initPanelCore()
    expect(stubs.refreshSheets).not.toHaveBeenCalled()

    vi.advanceTimersByTime(0)

    expect(stubs.refreshSheets).toHaveBeenCalledTimes(1)
    expect(stubs.refreshWorkbooks).toHaveBeenCalledTimes(1)
  })
})

describe('initPanelCore · 工作表自动检测', () => {
  it('未检测到追踪表且上次锁定仍有效 → 沿用锁定下标并刷新预览', () => {
    stubs.restoreLockedSheet.mockReturnValue(true)
    stubs.bgm.sheet.isLocked = true
    stubs.bgm.sheet.lockedIndex = 3
    addOptions('sheetSelect', '3')
    initPanelCore()

    vi.advanceTimersByTime(0)

    expect(stubs.refreshData).toHaveBeenCalledTimes(1)
    expect((document.getElementById('sheetSelect') as HTMLSelectElement).value).toBe('3')
    // 未检测到 → 不写锁定配置
    expect(stubs.saveLockedSheet).not.toHaveBeenCalled()
  })

  it('未检测到追踪表且未锁定 → 不刷新预览', () => {
    stubs.restoreLockedSheet.mockReturnValue(false)
    stubs.bgm.sheet.isLocked = false
    initPanelCore()

    vi.advanceTimersByTime(0)

    expect(stubs.refreshData).not.toHaveBeenCalled()
  })

  it('检测到追踪表 → 写锁定配置、同步两个下拉框并刷新预览', () => {
    stubs.autoDetectSheet.mockReturnValue({
      sheetIndex: 2,
      sheetName: '动画',
      workbookName: '数据表.xlsx',
    })
    addOptions('workbookSelect', '数据表.xlsx')
    addOptions('sheetSelect', '2')
    initPanelCore()

    vi.advanceTimersByTime(0)

    expect(stubs.bgm.sheet.lockedIndex).toBe(2)
    expect(stubs.bgm.sheet.lockedName).toBe('动画')
    expect(stubs.bgm.sheet.lockedWorkbookName).toBe('数据表.xlsx')
    expect(stubs.bgm.sheet.isLocked).toBe(true)
    expect(stubs.saveLockedSheet).toHaveBeenCalledWith({
      index: 2,
      name: '动画',
      workbookName: '数据表.xlsx',
    })
    expect((document.getElementById('workbookSelect') as HTMLSelectElement).value).toBe('数据表.xlsx')
    expect((document.getElementById('sheetSelect') as HTMLSelectElement).value).toBe('2')
    expect(stubs.updateLockButton).toHaveBeenCalled()
    expect(stubs.refreshData).toHaveBeenCalledTimes(1)
  })

  it('检测到的结果没有工作簿名 → 不写 workbookName，也不设工作簿下拉框', () => {
    stubs.autoDetectSheet.mockReturnValue({ sheetIndex: 1, sheetName: '动画', workbookName: '' })
    const select = addOptions('workbookSelect', '保持不变')
    select.value = '保持不变'
    initPanelCore()

    vi.advanceTimersByTime(0)

    expect(stubs.saveLockedSheet).toHaveBeenCalledWith({ index: 1, name: '动画' })
    expect(stubs.bgm.sheet.lockedWorkbookName).toBeNull()
    expect(select.value).toBe('保持不变')
  })
})

describe('initPanelCore · 事件绑定', () => {
  it('切换工作表 → 清锁定状态、写回 null 配置并刷新预览', () => {
    stubs.bgm.sheet.isLocked = true
    stubs.bgm.sheet.lockedIndex = 5
    initPanelCore()
    const select = document.getElementById('sheetSelect') as HTMLSelectElement

    select.dispatchEvent(new Event('change'))

    expect(stubs.bgm.sheet.lockedIndex).toBeNull()
    expect(stubs.bgm.sheet.lockedName).toBeNull()
    expect(stubs.bgm.sheet.isLocked).toBe(false)
    expect(stubs.saveLockedSheet).toHaveBeenCalledWith(null)
    expect(stubs.updateLockButton).toHaveBeenCalled()
    expect(stubs.refreshData).toHaveBeenCalled()
  })

  it('切换工作簿 → 刷新工作表列表并重新自动检测表头', () => {
    initPanelCore()
    const select = document.getElementById('workbookSelect') as HTMLSelectElement

    select.dispatchEvent(new Event('change'))

    expect(stubs.refreshSheets).toHaveBeenCalled()
    expect(stubs.autoDetectAndLockSheet).toHaveBeenCalled()
  })

  it('切换自动/手动模式 → 交给 onSelectModeChange', () => {
    initPanelCore()
    const radio = document.querySelector<HTMLInputElement>('input[name="selectMode"]')

    radio?.dispatchEvent(new Event('change'))

    expect(stubs.onSelectModeChange).toHaveBeenCalled()
  })

  it('点关闭按钮 → 隐藏同步预览弹窗', () => {
    initPanelCore()
    const modal = document.getElementById('syncPreviewModal')

    document.getElementById('closeSyncPreview')?.dispatchEvent(new MouseEvent('click'))

    expect(modal?.style.display).toBe('none')
  })

  it('按 Escape → 关闭详情模态框；其它键不触发', () => {
    initPanelCore()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(stubs.closeDetailModal).not.toHaveBeenCalled()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(stubs.closeDetailModal).toHaveBeenCalled()
  })

  it('beforeunload → 摘掉键盘监听、中止请求并清理消息监听与待执行定时器', () => {
    initPanelCore()

    window.dispatchEvent(new Event('beforeunload'))

    expect(stubs.abort).toHaveBeenCalled()
    expect(stubs.removeMessageListener).toHaveBeenCalled()
    expect(stubs.clearAllPendingTimeouts).toHaveBeenCalled()

    // 键盘监听已摘掉 → 再按 Escape 不再调用 closeDetailModal
    stubs.closeDetailModal.mockClear()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(stubs.closeDetailModal).not.toHaveBeenCalled()
  })

  it('初始化完成时广播 bgm:modulesReady 并打印完成日志', () => {
    const ready: string[] = []
    document.addEventListener('bgm:modulesReady', () => {
      ready.push('ready')
    })

    initPanelCore()

    expect(ready).toHaveLength(1)
    expect(hasLog('initPanelCore 完成')).toBe(true)
  })
})
