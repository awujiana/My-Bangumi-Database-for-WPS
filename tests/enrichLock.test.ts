/**
 * @fileoverview enrichLock 单元测试
 *
 * 测试目标：
 *   - refreshEnrichWorkbooks 工作簿列表刷新
 *   - refreshEnrichSheets 工作表列表刷新
 *   - toggleEnrichWorkbookLock 锁定/解锁切换
 *   - updateEnrichLockButton 按钮状态更新
 *   - saveEnrichLockedWorkbook 持久化存储
 *   - restoreEnrichLockedWorkbook 启动恢复与校验
 *   - getLockedEnrichSheet 获取锁定工作表引用
 *   - findWorkbookByName / findSheetInWorkbook 辅助函数
 *   - initEnrichLock 初始化流程
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// ========== Mock 基础设施 ==========

interface MockWorksheet {
  Name: string
  Index: number
}

interface MockWorkbook {
  Name: string
  Index: number
  Worksheets: {
    Count: number
    Item: (index: number) => MockWorksheet | null
  }
}

function createMockWorksheets(names: string[]): MockWorksheet[] {
  return names.map((name, index) => ({ Name: name, Index: index + 1 }))
}

function createMockWorkbooks(workbooks: { Name: string; Sheets: string[] }[]): MockWorkbook[] {
  return workbooks.map((wb, index) => {
    const sheets = createMockWorksheets(wb.Sheets)
    return {
      Name: wb.Name,
      Index: index + 1,
      Worksheets: {
        Count: sheets.length,
        Item: (index: number) => (index >= 1 && index <= sheets.length ? sheets[index - 1] : null),
      },
    }
  })
}

function createMockPluginStorage(store: Record<string, string> = {}): {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  _store: Record<string, string>
} {
  const s = { ...store }
  return {
    getItem: (k: string) => (k in s ? s[k] : null),
    setItem: (k: string, v: string) => {
      s[k] = v
    },
    _store: s,
  }
}

function createMockApp(
  workbooks: MockWorkbook[],
  activeWbName = '',
  pluginStorage?: ReturnType<typeof createMockPluginStorage>,
): {
  Workbooks: { Count: number; Item: (index: number) => MockWorkbook | null }
  ActiveWorkbook: { Name: string } | null
  PluginStorage: ReturnType<typeof createMockPluginStorage>
} {
  const storage = pluginStorage ?? createMockPluginStorage()
  return {
    Workbooks: {
      Count: workbooks.length,
      Item: (index: number) => (index >= 1 && index <= workbooks.length ? workbooks[index - 1] : null),
    },
    ActiveWorkbook: activeWbName ? { Name: activeWbName } : null,
    PluginStorage: storage,
  }
}

// ========== vi.hoisted 共享 mock 引用 ============
const mockReferences = vi.hoisted(() => ({
  mockBgmLog: vi.fn(),
  mockShowToast: vi.fn(),
  mockEnrichState: {
    lockedWorkbookName: null as string | null,
    lockedSheetName: null as string | null,
    lockedSheetIndex: null as number | null,
    isLocked: false,
  },
}))

// ========== vi.mock 声明 ============

// 必须先 mock logger，因为 index.js 依赖它
vi.mock('../ts/tools/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: mockReferences.mockBgmLog,
    warn: vi.fn(),
    error: vi.fn(),
  },
  LogLevel: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}))

vi.mock('../ts/core/constants.js', () => ({
  WPS_ENUM: { msoCTPDockPositionLeft: 0, msoCTPDockPositionRight: 2 },
  BGM_CONFIG: {},
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ERROR_LEVELS: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
  ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
}))

vi.mock('../ts/ui/preview.js', () => ({
  syncAllRows: vi.fn(),
  enlargePreview: vi.fn(),
  WATCH_STATUS_MAP: {},
}))

vi.mock('../ts/ui/handlers/index.js', () => ({
  onAction: vi.fn(),
  setupButtonListeners: vi.fn(),
  initHandlers: vi.fn(),
  clearAllPendingTimeouts: vi.fn(),
  ACTION_HANDLERS: {},
}))

// mock ts/index.js — enrichLock.ts 从 '../index.js'（即 ts/index.js）导入
// mockBGMState 必须用 vi.hoisted，因为 vi.mock 工厂被提升到文件顶部
const mockBGMState = vi.hoisted(() => ({
  enrich: {
    lockedWorkbookName: null as string | null,
    lockedSheetName: null as string | null,
    lockedSheetIndex: null as number | null,
    isLocked: false,
  },
}))

vi.mock('../ts/index.js', () => ({
  getApp: () => (window as Record<string, unknown>).Application || null,
  bgmLog: mockReferences.mockBgmLog,
  BGM: mockBGMState,
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  CONFIG_KEYS: {
    ENRICH_LOCKED_WORKBOOK: 'bgm_enrich_locked_workbook',
  },
  showToast: mockReferences.mockShowToast,
}))

// ========== 导入被测模块 ============
import {
  refreshEnrichWorkbooks,
  refreshEnrichSheets,
  toggleEnrichWorkbookLock,
  updateEnrichLockButton,
  saveEnrichLockedWorkbook,
  restoreEnrichLockedWorkbook,
  getLockedEnrichSheet,
  findWorkbookByName,
  findSheetInWorkbook,
  initEnrichLock,
} from '../ts/sync/enrichLock.js'

// ========== 测试套件 ============

beforeEach(() => {
  vi.clearAllMocks()
  mockReferences.mockBgmLog.mockClear()
  mockReferences.mockShowToast.mockClear()

  // 重置 BGM.enrich 状态
  mockBGMState.enrich = {
    lockedWorkbookName: null,
    lockedSheetName: null,
    lockedSheetIndex: null,
    isLocked: false,
  }

  // 清理 DOM
  document.body.replaceChildren();
})

afterEach(() => {
  vi.clearAllMocks()
  // 清理 window.Application
  if ('Application' in window) {
    delete (window as Record<string, unknown>).Application
  }
})

// ============ 辅助函数 ============

function setMockApp(app: unknown): void {
  ;(window as Record<string, unknown>).Application = app
}

function setupBasicDom(): void {
  const ids = ['workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus']
  ids.forEach((id) => {
    let element: HTMLElement
    if (id === 'workbookSelect' || id === 'sheetSelect') {
      element = document.createElement('select')
    } else if (id === 'lockSheetBtn') {
      element = document.createElement('button')
    } else {
      element = document.createElement('div')
    }
    element.id = id
    document.body.appendChild(element)
  })
}

// ============ 场景 1: refreshEnrichWorkbooks ============
describe('refreshEnrichWorkbooks', () => {
  it('刷新工作簿列表到下拉框', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    const app = createMockApp(workbooks, 'wb1.xlsx')
    setMockApp(app)

    refreshEnrichWorkbooks('workbookSelect')

    const select = document.getElementById('workbookSelect') as HTMLSelectElement
    expect(select.options.length).toBe(3) // 默认 + 2 个工作簿
    expect(select.options[0].textContent).toContain('请选择')
    expect(select.options[1].value).toBe('wb1.xlsx')
    expect(select.options[2].value).toBe('wb2.xlsx')
  })

  it('锁定状态时选中锁定的工作簿', () => {
    setupBasicDom()
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedWorkbookName = 'wb2.xlsx'

    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    const app = createMockApp(workbooks, 'wb1.xlsx')
    setMockApp(app)

    refreshEnrichWorkbooks('workbookSelect')

    const select = document.getElementById('workbookSelect') as HTMLSelectElement
    expect(select.value).toBe('wb2.xlsx')
  })

  it('未锁定时默认选中活动工作簿', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    const app = createMockApp(workbooks, 'wb1.xlsx')
    setMockApp(app)

    refreshEnrichWorkbooks('workbookSelect')

    const select = document.getElementById('workbookSelect') as HTMLSelectElement
    expect(select.value).toBe('wb1.xlsx')
  })

  it('DOM 元素不存在时不报错', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    expect(() => refreshEnrichWorkbooks('nonexistent')).not.toThrow()
  })

  it('Workbooks 不可用时记录警告', () => {
    setupBasicDom()
    const app = createMockApp([])
    ;(app as unknown as { Workbooks: null }).Workbooks = null
    setMockApp(app)

    refreshEnrichWorkbooks('workbookSelect')

    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })
})

// ============ 场景 2: refreshEnrichSheets ============
describe('refreshEnrichSheets', () => {
  it('刷新指定工作簿的工作表列表', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2', 'Data'] },
    ])
    const app = createMockApp(workbooks)
    setMockApp(app)

    refreshEnrichSheets('wb1.xlsx', 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.options.length).toBe(4) // 默认 + 3 个工作表
    expect(select.options[1].textContent).toBe('Sheet1')
    expect(select.options[2].textContent).toBe('Sheet2')
    expect(select.options[3].textContent).toBe('Data')
  })

  it('未指定工作簿名称时使用下拉框值', () => {
    setupBasicDom()
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    wbSelect.replaceChildren();
    const opt = document.createElement('option')
    opt.value = 'wb1.xlsx'
    opt.textContent = 'wb1.xlsx'
    wbSelect.appendChild(opt)
    wbSelect.value = 'wb1.xlsx'

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    refreshEnrichSheets(undefined, 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.options.length).toBe(2) // 默认 + 1
  })

  it('工作簿名称为空时显示提示', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    refreshEnrichSheets('', 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.options[0].textContent).toContain('请先选择工作簿')
    expect(select.options.length).toBe(1)
  })

  it('锁定状态时选中锁定的工作表', () => {
    setupBasicDom()
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedSheetName = 'Sheet2'

    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2', 'Data'] },
    ])
    const app = createMockApp(workbooks)
    setMockApp(app)

    refreshEnrichSheets('wb1.xlsx', 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.value).toBe('2') // Sheet2 的索引
  })

  it('工作簿不存在时记录警告', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    refreshEnrichSheets('nonexistent.xlsx', 'sheetSelect', 'workbookSelect')

    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })

  it('DOM 元素不存在时不报错', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    expect(() => refreshEnrichSheets('wb1.xlsx', 'nonexistent', 'workbookSelect')).not.toThrow()
  })
})

// ============ 场景 3: toggleEnrichWorkbookLock ============
describe('toggleEnrichWorkbookLock', () => {
  it('选择工作表后锁定', () => {
    setupBasicDom()
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    wbSelect.replaceChildren();
    const wbOpt = document.createElement('option')
    wbOpt.value = 'wb1.xlsx'
    wbOpt.textContent = 'wb1.xlsx'
    wbSelect.appendChild(wbOpt)
    wbSelect.value = 'wb1.xlsx'

    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.replaceChildren();
    const sheetOpt = document.createElement('option')
    sheetOpt.value = '2'
    sheetOpt.textContent = 'TargetSheet'
    sheetSelect.appendChild(sheetOpt)
    sheetSelect.value = '2'

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'TargetSheet'] }])
    const storage = createMockPluginStorage()
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')

    expect(mockBGMState.enrich.isLocked).toBe(true)
    expect(mockBGMState.enrich.lockedWorkbookName).toBe('wb1.xlsx')
    expect(mockBGMState.enrich.lockedSheetName).toBe('TargetSheet')
    expect(mockBGMState.enrich.lockedSheetIndex).toBe(2)
    expect(storage._store.bgm_enrich_locked_workbook).toBeTruthy()
    expect(mockReferences.mockShowToast).toHaveBeenCalled()
  })

  it('已锁定状态下点击解锁', () => {
    setupBasicDom()
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedWorkbookName = 'wb1.xlsx'
    mockBGMState.enrich.lockedSheetName = 'TargetSheet'
    mockBGMState.enrich.lockedSheetIndex = 2

    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    wbSelect.innerHTML = '<option value="wb1.xlsx">wb1.xlsx</option>'
    wbSelect.value = 'wb1.xlsx'

    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.innerHTML = '<option value="2">TargetSheet</option>'
    sheetSelect.value = '2'

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'TargetSheet'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook:
        '{"workbookName":"wb1.xlsx","sheetName":"TargetSheet","sheetIndex":2}',
    })
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')

    expect(mockBGMState.enrich.isLocked).toBe(false)
    expect(mockBGMState.enrich.lockedWorkbookName).toBeNull()
    expect(mockBGMState.enrich.lockedSheetName).toBeNull()
    expect(mockBGMState.enrich.lockedSheetIndex).toBeNull()
    expect(mockReferences.mockShowToast).toHaveBeenCalled()
  })

  it('未选择工作表时提示错误', () => {
    setupBasicDom()
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.value = ''

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')

    expect(mockReferences.mockShowToast).toHaveBeenCalled()
    expect(mockBGMState.enrich.isLocked).toBe(false)
  })

  it('未选择工作簿时提示错误', () => {
    setupBasicDom()
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    wbSelect.value = ''

    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.innerHTML = '<option value="1">Sheet1</option>'
    sheetSelect.value = '1'

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')

    expect(mockReferences.mockShowToast).toHaveBeenCalled()
  })

  it('DOM 元素不存在时不报错', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    expect(() =>
      toggleEnrichWorkbookLock('nonexistent', 'workbookSelect', 'lockSheetBtn', 'lockStatus'),).not.toThrow()
  })
})

// ============ 场景 4: updateEnrichLockButton ============
describe('updateEnrichLockButton', () => {
  it('锁定状态下更新按钮文字和状态显示', () => {
    setupBasicDom()
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedWorkbookName = 'wb1.xlsx'
    mockBGMState.enrich.lockedSheetName = 'Sheet1'

    updateEnrichLockButton('lockSheetBtn', 'lockStatus')

    const button = document.getElementById('lockSheetBtn') as HTMLButtonElement
    const status = document.getElementById('lockStatus') as HTMLDivElement
    expect(button.textContent).toContain('解锁')
    expect(button.classList.contains('locked')).toBe(true)
    expect(status.style.display).not.toBe('none')
    expect(status.textContent).toContain('wb1.xlsx')
    expect(status.textContent).toContain('Sheet1')
  })

  it('未锁定状态下更新按钮文字', () => {
    setupBasicDom()
    mockBGMState.enrich.isLocked = false

    updateEnrichLockButton('lockSheetBtn', 'lockStatus')

    const button = document.getElementById('lockSheetBtn') as HTMLButtonElement
    const status = document.getElementById('lockStatus') as HTMLDivElement
    expect(button.textContent).toContain('锁定')
    expect(button.classList.contains('locked')).toBe(false)
    expect(status.style.display).toBe('none')
  })

  it('DOM 元素不存在时不报错', () => {
    expect(() => updateEnrichLockButton('nonexistentBtn', 'nonexistentStatus')).not.toThrow()
  })
})

// ============ 场景 5: saveEnrichLockedWorkbook ============
describe('saveEnrichLockedWorkbook', () => {
  it('保存锁定信息到 PluginStorage', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage()
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    saveEnrichLockedWorkbook({
      workbookName: 'wb1.xlsx',
      sheetName: 'Sheet1',
      sheetIndex: 1,
    })

    expect(storage._store.bgm_enrich_locked_workbook).toBe(
      JSON.stringify({ workbookName: 'wb1.xlsx', sheetName: 'Sheet1', sheetIndex: 1 }),
    )
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })

  it('传入 null 时清除持久化数据', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook: '{"workbookName":"wb1.xlsx","sheetName":"Sheet1","sheetIndex":1}',
    })
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    saveEnrichLockedWorkbook(null)

    expect(storage._store.bgm_enrich_locked_workbook).toBe('')
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })

  it('PluginStorage 不可用时记录警告', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    app.PluginStorage = undefined as unknown as typeof app.PluginStorage
    setMockApp(app)

    saveEnrichLockedWorkbook({
      workbookName: 'wb1.xlsx',
      sheetName: 'Sheet1',
      sheetIndex: 1,
    })

    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })
})

// ============ 场景 6: restoreEnrichLockedWorkbook ============
describe('restoreEnrichLockedWorkbook', () => {
  it('成功恢复锁定状态', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Target'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook: '{"workbookName":"wb1.xlsx","sheetName":"Target","sheetIndex":2}',
    })
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    const isResult = restoreEnrichLockedWorkbook()

    expect(isResult).toBe(true)
    expect(mockBGMState.enrich.isLocked).toBe(true)
    expect(mockBGMState.enrich.lockedWorkbookName).toBe('wb1.xlsx')
    expect(mockBGMState.enrich.lockedSheetName).toBe('Target')
    expect(mockBGMState.enrich.lockedSheetIndex).toBe(2)
  })

  it('无持久化数据时返回 false', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage()
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    const isResult = restoreEnrichLockedWorkbook()

    expect(isResult).toBe(false)
    expect(mockBGMState.enrich.isLocked).toBe(false)
  })

  it('锁定的工作簿不存在时清除状态', () => {
    const workbooks = createMockWorkbooks([{ Name: 'other.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook:
        '{"workbookName":"deleted.xlsx","sheetName":"Sheet1","sheetIndex":1}',
    })
    const app = createMockApp(workbooks, 'other.xlsx', storage)
    setMockApp(app)

    const isResult = restoreEnrichLockedWorkbook()

    expect(isResult).toBe(false)
    expect(mockBGMState.enrich.isLocked).toBe(false)
    expect(mockBGMState.enrich.lockedWorkbookName).toBeNull()
    expect(storage._store.bgm_enrich_locked_workbook).toBe('')
  })

  it('锁定的工作表不存在时清除状态', () => {
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1'] }, // 只有 Sheet1，没有 Target
    ])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook: '{"workbookName":"wb1.xlsx","sheetName":"Target","sheetIndex":2}',
    })
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    const isResult = restoreEnrichLockedWorkbook()

    expect(isResult).toBe(false)
    expect(mockBGMState.enrich.isLocked).toBe(false)
    expect(storage._store.bgm_enrich_locked_workbook).toBe('')
  })

  it('JSON 数据损坏时清除状态', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook: 'invalid-json{{{',
    })
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    const isResult = restoreEnrichLockedWorkbook()

    expect(isResult).toBe(false)
    expect(mockBGMState.enrich.isLocked).toBe(false)
    expect(storage._store.bgm_enrich_locked_workbook).toBe('')
  })

  it('Workbooks 不可用时清除状态', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook: '{"workbookName":"wb1.xlsx","sheetName":"Sheet1","sheetIndex":1}',
    })
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    ;(app as unknown as { Workbooks: null }).Workbooks = null
    setMockApp(app)

    const isResult = restoreEnrichLockedWorkbook()

    expect(isResult).toBe(false)
    expect(mockBGMState.enrich.isLocked).toBe(false)
  })

  it('PluginStorage 不可用时返回 false', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks, 'wb1.xlsx')
    app.PluginStorage = undefined as unknown as typeof app.PluginStorage
    setMockApp(app)

    const isResult = restoreEnrichLockedWorkbook()

    expect(isResult).toBe(false)
  })
})

// ============ 场景 7: getLockedEnrichSheet ============
describe('getLockedEnrichSheet', () => {
  it('返回锁定的工作簿和工作表引用', () => {
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedWorkbookName = 'wb1.xlsx'
    mockBGMState.enrich.lockedSheetName = 'Sheet1'

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    const result = getLockedEnrichSheet()

    expect(result).not.toBeNull()
    expect(result![0].Name).toBe('wb1.xlsx')
    expect(result![1].Name).toBe('Sheet1')
  })

  it('未锁定时返回 null', () => {
    mockBGMState.enrich.isLocked = false

    const result = getLockedEnrichSheet()

    expect(result).toBeNull()
  })

  it('锁定的工作簿不存在时返回 null 并清除状态', () => {
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedWorkbookName = 'deleted.xlsx'
    mockBGMState.enrich.lockedSheetName = 'Sheet1'

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook:
        '{"workbookName":"deleted.xlsx","sheetName":"Sheet1","sheetIndex":1}',
    })
    const app = createMockApp(workbooks)
    app.PluginStorage = storage
    setMockApp(app)

    const result = getLockedEnrichSheet()

    expect(result).toBeNull()
    expect(mockBGMState.enrich.isLocked).toBe(false)
  })

  it('锁定的工作表不存在时返回 null 并清除状态', () => {
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedWorkbookName = 'wb1.xlsx'
    mockBGMState.enrich.lockedSheetName = 'deletedSheet'

    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1'] }, // 没有 deletedSheet
    ])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook:
        '{"workbookName":"wb1.xlsx","sheetName":"deletedSheet","sheetIndex":2}',
    })
    const app = createMockApp(workbooks)
    app.PluginStorage = storage
    setMockApp(app)

    const result = getLockedEnrichSheet()

    expect(result).toBeNull()
    expect(mockBGMState.enrich.isLocked).toBe(false)
  })

  it('Workbooks 不可用时返回 null', () => {
    mockBGMState.enrich.isLocked = true
    mockBGMState.enrich.lockedWorkbookName = 'wb1.xlsx'
    mockBGMState.enrich.lockedSheetName = 'Sheet1'

    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    ;(app as unknown as { Workbooks: null }).Workbooks = null
    setMockApp(app)

    const result = getLockedEnrichSheet()

    expect(result).toBeNull()
  })
})

// ============ 场景 8: findWorkbookByName / findSheetInWorkbook ============
describe('findWorkbookByName / findSheetInWorkbook', () => {
  it('findWorkbookByName 找到工作簿', () => {
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    const app = createMockApp(workbooks)
    setMockApp(app)

    const result = findWorkbookByName('wb2.xlsx')

    expect(result).not.toBeNull()
    expect(result!.Name).toBe('wb2.xlsx')
  })

  it('findWorkbookByName 未找到返回 null', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    const result = findWorkbookByName('nonexistent.xlsx')

    expect(result).toBeNull()
  })

  it('findWorkbookByName 名称为 null/空返回 null', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    expect(findWorkbookByName(null)).toBeNull()
    expect(findWorkbookByName('')).toBeNull()
  })

  it('findSheetInWorkbook 找到工作表', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Target'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    const result = findSheetInWorkbook('wb1.xlsx', 'Target')

    expect(result).not.toBeNull()
    expect(result!.Name).toBe('Target')
  })

  it('findSheetInWorkbook 未找到工作表返回 null', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    const result = findSheetInWorkbook('wb1.xlsx', 'Nonexistent')

    expect(result).toBeNull()
  })

  it('findSheetInWorkbook 工作簿不存在返回 null', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    setMockApp(app)

    const result = findSheetInWorkbook('nonexistent.xlsx', 'Sheet1')

    expect(result).toBeNull()
  })
})

// ============ 场景 9: initEnrichLock 初始化流程 ============
describe('initEnrichLock', () => {
  it('无锁定状态时初始化下拉框', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    const storage = createMockPluginStorage()
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')

    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(wbSelect.options.length).toBe(3) // 默认 + 2 个工作簿
    expect(sheetSelect.options.length).toBeGreaterThan(1) // 至少有默认
    expect(mockBGMState.enrich.isLocked).toBe(false)
  })

  it('有锁定状态时恢复选中值', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Target'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook: '{"workbookName":"wb1.xlsx","sheetName":"Target","sheetIndex":2}',
    })
    const app = createMockApp(workbooks, 'wb1.xlsx', storage)
    setMockApp(app)

    initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')

    expect(mockBGMState.enrich.isLocked).toBe(true)
    expect(mockBGMState.enrich.lockedWorkbookName).toBe('wb1.xlsx')

    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(wbSelect.value).toBe('wb1.xlsx')
    expect(sheetSelect.value).toBe('2')
  })

  it('锁定的工作簿不存在时降级为未锁定状态', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([{ Name: 'other.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      bgm_enrich_locked_workbook:
        '{"workbookName":"deleted.xlsx","sheetName":"Sheet1","sheetIndex":1}',
    })
    const app = createMockApp(workbooks, 'other.xlsx', storage)
    setMockApp(app)

    initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')

    expect(mockBGMState.enrich.isLocked).toBe(false)
  })
})
