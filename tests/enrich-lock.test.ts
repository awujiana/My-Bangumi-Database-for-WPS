/**
 * @fileoverview 共享锁定 + 富化锁定 UI 适配层单元测试
 *
 * 覆盖（方案一：统一 BGM.sheet + bgm_locked_sheet，跨所有已打开工作簿扫描）：
 *   - locked-sheet：saveLockedSheet / clearLockedSheet / restoreLockedSheet
 *   - locked-sheet：getLockedSheet（getLockedEnrichSheet 委托）
 *   - locked-sheet：findWorkbookByName / findSheetInWorkbook
 *   - locked-sheet：findBangumiTargetSheets（表头 + 数据行数 + 名称关键词，跨工作簿，优先活动工作簿/工作表）
 *   - enrich-lock：refreshEnrichWorkbooks / refreshEnrichSheets
 *   - enrich-lock：toggleEnrichWorkbookLock / updateEnrichLockButton
 *   - enrich-lock：lockEnrichWorkbookByName / autoSelectEnrichTarget / initEnrichLock
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
        Item: (sheetIndex: number) => {
          // 模拟 WPS：索引越界时抛错
          if (sheetIndex < 1 || sheetIndex > sheets.length) throw new RangeError('下标越界')
          return sheets[sheetIndex - 1] ?? null
        },
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
    getItem: (k: string) => (Object.hasOwn(s, k) ? (s[k] ?? null) : null),
    setItem: (k: string, v: string) => {
      s[k] = v
    },
    _store: s,
  }
}

type MockPluginStorage = ReturnType<typeof createMockPluginStorage>

function createMockApp(
  workbooks: MockWorkbook[],
  activeWbName = '',
  pluginStorage?: MockPluginStorage,
  activeSheetName = '',
): {
  Workbooks: { Count: number; Item: (index: number) => MockWorkbook | null }
  ActiveWorkbook: { Name: string; ActiveSheet?: { Name: string } | null } | null
  PluginStorage: MockPluginStorage
} {
  const storage = pluginStorage ?? createMockPluginStorage()
  return {
    Workbooks: {
      Count: workbooks.length,
      Item: (index: number) =>
        index >= 1 && index <= workbooks.length ? (workbooks[index - 1] ?? null) : null,
    },
    ActiveWorkbook: activeWbName
      ? { Name: activeWbName, ActiveSheet: activeSheetName ? { Name: activeSheetName } : null }
      : null,
    PluginStorage: storage,
  }
}

// ========== 跨工作簿扫描专用 mock ==========

interface ScanConfig {
  headerRow: number
  headerKeyCount: number
  dataCount: number
}

interface ScanSheet extends MockWorksheet {
  _scan: ScanConfig | null
}

type ScanWorkbookMap = Record<string, ScanSheet[]>

function createScanSheet(name: string, scan: ScanConfig | null): ScanSheet {
  return { Name: name, Index: 1, _scan: scan }
}

/** 按“工作簿名 -> 工作表数组”构建 mock 应用 */
function createScanApp(
  map: ScanWorkbookMap,
  activeWbName = '',
  activeSheetName = '',
  storage?: MockPluginStorage,
): ReturnType<typeof createMockApp> {
  const entries = Object.entries(map)
  const wbs: MockWorkbook[] = entries.map(([name, sheets], index) => ({
    Name: name,
    Index: index + 1,
    Worksheets: {
      Count: sheets.length,
      Item: (sheetIndex: number) =>
        sheetIndex >= 1 && sheetIndex <= sheets.length ? (sheets[sheetIndex - 1] ?? null) : null,
    },
  }))
  return createMockApp(wbs, activeWbName, storage, activeSheetName)
}

// ========== vi.hoisted 共享 mock 引用 ============
const mockReferences = vi.hoisted(() => ({
  mockBgmLog: vi.fn(),
  mockShowToast: vi.fn(),
}))

/** 共享的 BGM 状态：主面板与富化页面的 util/index、ts/index mock 必须指向同一对象 */
const sharedBGM = vi.hoisted(() => ({
  cache: {},
  sync: {},
  LOG_LEVEL: 0,
  sheet: {
    isLocked: false,
    lockedIndex: null as number | null,
    lockedName: null as string | null,
    lockedWorkbookName: null as string | null,
  },
}))

const mockGetCellValue = vi.hoisted(() => vi.fn())
const mockFindHeaderRow = vi.hoisted(() => vi.fn())

// ========== vi.mock 声明 ==========

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
  PANEL_CONFIG: { MAX_SCAN_ROWS: 50, MAX_SCAN_COLUMNS: 10 },
  HEADER_KEYWORDS: ['名称', '标题', 'bangumi', 'url', 'sid', '编号', '序号', 'name', 'title'],
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

// 主面板/富化 UI 层依赖 ts/index.js（仅取 getApp/bgmLog/BGM/LOG_LEVELS/showToast）
vi.mock('../ts/index.js', () => ({
  getApp: (): unknown => Reflect.get(globalThis, 'Application') ?? null,
  bgmLog: mockReferences.mockBgmLog,
  BGM: sharedBGM,
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  showToast: mockReferences.mockShowToast,
}))

// locked-sheet 依赖 tools/util；getApp 必须与 ts/index 返回同一个 Application
vi.mock('../ts/tools/util/index.js', () => ({
  getApp: (): unknown => Reflect.get(globalThis, 'Application') ?? null,
  bgmLog: mockReferences.mockBgmLog,
  BGM: sharedBGM,
  getCellValue: mockGetCellValue,
  findHeaderRow: mockFindHeaderRow,
}))

// ========== 导入被测模块 ============
import {
  saveLockedSheet,
  clearLockedSheet,
  restoreLockedSheet,
  getLockedSheet,
  getOpenWorkbooks,
  findWorkbookByName,
  findSheetInWorkbook,
  findBangumiTargetSheets,
  findBangumiTargetSheetInWorkbook,
  LOCKED_SHEET_KEY,
} from '../ts/tools/locked-sheet.js'
import {
  refreshEnrichWorkbooks,
  refreshEnrichSheets,
  toggleEnrichWorkbookLock,
  updateEnrichLockButton,
  getLockedEnrichSheet,
  lockEnrichWorkbookByName,
  autoSelectEnrichTarget,
  initEnrichLock,
} from '../ts/sync/enrich-lock.js'

// ========== 测试套件 ==========

function resetBGM(): void {
  sharedBGM.sheet.isLocked = false
  sharedBGM.sheet.lockedIndex = null
  sharedBGM.sheet.lockedName = null
  sharedBGM.sheet.lockedWorkbookName = null
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReferences.mockBgmLog.mockClear()
  mockReferences.mockShowToast.mockClear()
  resetBGM()
  mockGetCellValue.mockImplementation(() => '')
  mockFindHeaderRow.mockImplementation(() => 0)
  document.body.replaceChildren()
})

afterEach(() => {
  vi.clearAllMocks()
  if ('Application' in window) {
    delete (window as Record<string, unknown>).Application
  }
})

// ============ 辅助函数 ============

function setMockApp(app: unknown): void {
  Reflect.set(globalThis, 'Application', app)
}

function setupBasicDom(): void {
  const ids = ['workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus']
  for (const id of ids) {
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
  }
}

/** 配置跨工作簿扫描的 getCellValue / findHeaderRow mock（基于 ws._scan） */
function setupScanMocks(): void {
  mockFindHeaderRow.mockImplementation((ws: ScanSheet) => ws._scan?.headerRow ?? 0)
  mockGetCellValue.mockImplementation((ws: ScanSheet, row: number, col: number) => {
    const scan = ws._scan
    if (!scan) return ''
    if (row === scan.headerRow) return col <= scan.headerKeyCount ? '名称' : ''
    if (row > scan.headerRow && row <= scan.headerRow + scan.dataCount) return '追踪数据'
    return ''
  })
}

// ============ 场景 1: saveLockedSheet / clearLockedSheet ============
describe('saveLockedSheet / clearLockedSheet', () => {
  it('保存锁定信息到 PluginStorage（统一 key）', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage()
    setMockApp(createMockApp(workbooks, 'wb1.xlsx', storage))

    saveLockedSheet({ index: 1, name: 'Sheet1', workbookName: 'wb1.xlsx' })

    expect(storage._store[LOCKED_SHEET_KEY]).toBe(
      JSON.stringify({ index: 1, name: 'Sheet1', workbookName: 'wb1.xlsx' }),
    )
  })

  it('传入 null 时清除持久化数据', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      [LOCKED_SHEET_KEY]: '{"index":1,"name":"Sheet1","workbookName":"wb1.xlsx"}',
    })
    setMockApp(createMockApp(workbooks, 'wb1.xlsx', storage))

    saveLockedSheet(null)

    expect(storage._store[LOCKED_SHEET_KEY]).toBe('')
  })

  it('clearLockedSheet 重置 BGM.sheet 并清除持久化', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      [LOCKED_SHEET_KEY]: '{"index":1,"name":"Sheet1","workbookName":"wb1.xlsx"}',
    })
    setMockApp(createMockApp(workbooks, 'wb1.xlsx', storage))
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedIndex = 1
    sharedBGM.sheet.lockedName = 'Sheet1'
    sharedBGM.sheet.lockedWorkbookName = 'wb1.xlsx'

    clearLockedSheet()

    expect(sharedBGM.sheet.isLocked).toBe(false)
    expect(sharedBGM.sheet.lockedIndex).toBeNull()
    expect(sharedBGM.sheet.lockedName).toBeNull()
    expect(sharedBGM.sheet.lockedWorkbookName).toBeNull()
    expect(storage._store[LOCKED_SHEET_KEY]).toBe('')
  })

  it('PluginStorage 不可用时记录警告且不抛错', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    app.PluginStorage = undefined as unknown as MockPluginStorage
    setMockApp(app)

    expect(() => saveLockedSheet({ index: 1, name: 'Sheet1' })).not.toThrow()
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })
})

// ============ 场景 2: restoreLockedSheet ============
describe('restoreLockedSheet', () => {
  it('成功恢复锁定状态到 BGM.sheet', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Target'] }])
    const storage = createMockPluginStorage({
      [LOCKED_SHEET_KEY]: '{"index":2,"name":"Target","workbookName":"wb1.xlsx"}',
    })
    setMockApp(createMockApp(workbooks, 'wb1.xlsx', storage))

    const isRestored = restoreLockedSheet()

    expect(isRestored).toBe(true)
    expect(sharedBGM.sheet.isLocked).toBe(true)
    expect(sharedBGM.sheet.lockedWorkbookName).toBe('wb1.xlsx')
    expect(sharedBGM.sheet.lockedName).toBe('Target')
    expect(sharedBGM.sheet.lockedIndex).toBe(2)
  })

  it('无持久化数据时返回 false', () => {
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    const isRestored = restoreLockedSheet()

    expect(isRestored).toBe(false)
    expect(sharedBGM.sheet.isLocked).toBe(false)
  })

  it('锁定的工作簿不存在时清除状态', () => {
    const workbooks = createMockWorkbooks([{ Name: 'other.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({
      [LOCKED_SHEET_KEY]: '{"index":1,"name":"Sheet1","workbookName":"deleted.xlsx"}',
    })
    setMockApp(createMockApp(workbooks, 'other.xlsx', storage))

    const isRestored = restoreLockedSheet()

    expect(isRestored).toBe(false)
    expect(sharedBGM.sheet.isLocked).toBe(false)
    expect(storage._store[LOCKED_SHEET_KEY]).toBe('')
  })

  it('JSON 数据损坏时清除状态', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const storage = createMockPluginStorage({ [LOCKED_SHEET_KEY]: 'invalid-json{{{' })
    setMockApp(createMockApp(workbooks, 'wb1.xlsx', storage))

    const isRestored = restoreLockedSheet()

    expect(isRestored).toBe(false)
    expect(sharedBGM.sheet.isLocked).toBe(false)
    expect(storage._store[LOCKED_SHEET_KEY]).toBe('')
  })

  it('PluginStorage 不可用时返回 false', () => {
    const workbooks = createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])
    const app = createMockApp(workbooks)
    app.PluginStorage = undefined as unknown as MockPluginStorage
    setMockApp(app)

    expect(restoreLockedSheet()).toBe(false)
  })
})

// ============ 场景 3: getLockedSheet / getLockedEnrichSheet ============
describe('getLockedSheet / getLockedEnrichSheet', () => {
  it('返回锁定的工作簿和工作表引用', () => {
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedWorkbookName = 'wb1.xlsx'
    sharedBGM.sheet.lockedName = 'Sheet1'

    setMockApp(
      createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2'] }])),
    )

    const result = getLockedEnrichSheet()

    expect(result).not.toBeNull()
    expect(result![0].Name).toBe('wb1.xlsx')
    expect(result![1].Name).toBe('Sheet1')
  })

  it('未锁定时返回 null', () => {
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    expect(getLockedSheet()).toBeNull()
  })

  it('锁定的工作簿不存在时清除锁状态', () => {
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedWorkbookName = 'deleted.xlsx'
    sharedBGM.sheet.lockedName = 'Sheet1'
    const storage = createMockPluginStorage()
    setMockApp(
      createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }]), '', storage),
    )

    const result = getLockedEnrichSheet()

    expect(result).toBeNull()
    expect(sharedBGM.sheet.isLocked).toBe(false)
    expect(storage._store[LOCKED_SHEET_KEY]).toBe('')
  })

  it('锁定的工作表不存在时清除锁状态', () => {
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedWorkbookName = 'wb1.xlsx'
    sharedBGM.sheet.lockedName = 'deletedSheet'
    const storage = createMockPluginStorage()
    setMockApp(
      createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }]), '', storage),
    )

    const result = getLockedEnrichSheet()

    expect(result).toBeNull()
    expect(sharedBGM.sheet.isLocked).toBe(false)
  })
})

// ============ 场景 4: findWorkbookByName / findSheetInWorkbook ============
describe('findWorkbookByName / findSheetInWorkbook', () => {
  it('findWorkbookByName 找到工作簿', () => {
    setMockApp(
      createMockApp(
        createMockWorkbooks([
          { Name: 'wb1.xlsx', Sheets: ['Sheet1'] },
          { Name: 'wb2.xlsx', Sheets: ['Data'] },
        ]),
      ),
    )

    const result = findWorkbookByName('wb2.xlsx')

    expect(result).not.toBeNull()
    expect(result!.Name).toBe('wb2.xlsx')
  })

  it('findWorkbookByName 未找到 / 空名返回 null', () => {
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    expect(findWorkbookByName('nonexistent.xlsx')).toBeNull()
    expect(findWorkbookByName(null)).toBeNull()
    expect(findWorkbookByName('')).toBeNull()
  })

  it('findSheetInWorkbook 找到工作表 / 未找到 / 工作簿不存在', () => {
    setMockApp(
      createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Target'] }])),
    )

    const found = findSheetInWorkbook('wb1.xlsx', 'Target')
    expect(found).not.toBeNull()
    expect(found!.Name).toBe('Target')
    expect(findSheetInWorkbook('wb1.xlsx', 'Nonexistent')).toBeNull()
    expect(findSheetInWorkbook('nonexistent.xlsx', 'Sheet1')).toBeNull()
  })
})

// ============ 场景 5: findBangumiTargetSheets ============
describe('findBangumiTargetSheets', () => {
  it('没有任何有效候选时返回空数组', () => {
    setupScanMocks()
    // 表头行=0，不满足表头校验
    setMockApp(createScanApp({ wb1: [createScanSheet('bangumi 表', null)] }, 'wb1'))

    expect(findBangumiTargetSheets()).toEqual([])
  })

  it('数据行数不足（<2）时跳过', () => {
    setupScanMocks()
    // 表头命中 3 个关键词，但仅 1 行数据
    const sheet = createScanSheet('bangumi 追踪', {
      headerRow: 1,
      headerKeyCount: 3,
      dataCount: 1,
    })
    setMockApp(createScanApp({ wb1: [sheet] }, 'wb1'))

    expect(findBangumiTargetSheets()).toEqual([])
  })

  it('跳过系统工作表（同步记录 / SEARCH 等）', () => {
    setupScanMocks()
    const systemSheet = createScanSheet('同步记录', {
      headerRow: 1,
      headerKeyCount: 3,
      dataCount: 3,
    })
    setMockApp(createScanApp({ wb1: [systemSheet] }, 'wb1', '同步记录'))

    expect(findBangumiTargetSheets()).toEqual([])
  })

  it('名称关键词命中时生成候选并填充字段', () => {
    setupScanMocks()
    const sheet = createScanSheet('bangumi 追踪', {
      headerRow: 2,
      headerKeyCount: 3,
      dataCount: 4,
    })
    setMockApp(createScanApp({ wb1: [sheet] }, 'wb1'))

    const result = findBangumiTargetSheets()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      workbookName: 'wb1',
      sheetIndex: 1,
      sheetName: 'bangumi 追踪',
      headerRow: 2,
      headerMatchCount: 3,
      dataRowCount: 4,
      isNameHit: true,
    })
  })

  it('无名称命中时回退扫描全部通过表头+数据校验的工作表，并标记 isNameHit=false', () => {
    setupScanMocks()
    const plainSheet = createScanSheet('Sheet数据', {
      headerRow: 1,
      headerKeyCount: 4,
      dataCount: 3,
    })
    setMockApp(createScanApp({ wb1: [plainSheet] }, 'wb1'))

    const result = findBangumiTargetSheets()

    expect(result).toHaveLength(1)
    expect(result[0]?.sheetName).toBe('Sheet数据')
    expect(result[0]?.isNameHit).toBe(false)
  })

  it('优先当前活动工作簿 + 活动工作表的候选', () => {
    setupScanMocks()
    const activeHit = createScanSheet('bangumi A', {
      headerRow: 1,
      headerKeyCount: 3,
      dataCount: 3,
    })
    const activeTarget = createScanSheet('bangumi B', {
      headerRow: 1,
      headerKeyCount: 3,
      dataCount: 3,
    })
    setMockApp(createScanApp({ active: [activeHit, activeTarget] }, 'active', 'bangumi B'))

    const result = findBangumiTargetSheets()

    expect(result).toHaveLength(2)
    expect(result[0]?.sheetName).toBe('bangumi B')
    expect(result[1]?.sheetName).toBe('bangumi A')
  })

  it('当前活动工作簿的候选优先于非活动工作簿的名称命中候选', () => {
    setupScanMocks()
    const activeSheet = createScanSheet('bangumi 主表', {
      headerRow: 1,
      headerKeyCount: 3,
      dataCount: 3,
    })
    const otherSheet = createScanSheet('bangumi 副表', {
      headerRow: 1,
      headerKeyCount: 3,
      dataCount: 3,
    })
    setMockApp(createScanApp({ active: [activeSheet], other: [otherSheet] }, 'active'))

    const result = findBangumiTargetSheets()

    expect(result).toHaveLength(2)
    expect(result[0]?.workbookName).toBe('active')
    expect(result[1]?.workbookName).toBe('other')
  })

  it('Workbooks 不可用时记录警告并返回空数组', () => {
    setupScanMocks()
    const app = createScanApp({})
    app.Workbooks = null as unknown as ReturnType<typeof createMockApp>['Workbooks']
    setMockApp(app)

    expect(findBangumiTargetSheets()).toEqual([])
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })
})

// ============ 场景 6: refreshEnrichWorkbooks ============
describe('refreshEnrichWorkbooks', () => {
  it('刷新工作簿列表到下拉框', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    setMockApp(createMockApp(workbooks, 'wb1.xlsx'))

    refreshEnrichWorkbooks('workbookSelect')

    const select = document.getElementById('workbookSelect') as HTMLSelectElement
    expect(select.options.length).toBe(3)
    expect(select.options[0]?.textContent).toContain('请选择')
    expect(select.options[1]?.value).toBe('wb1.xlsx')
    expect(select.options[2]?.value).toBe('wb2.xlsx')
  })

  it('锁定状态时选中锁定的工作簿', () => {
    setupBasicDom()
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedWorkbookName = 'wb2.xlsx'
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1'] },
      { Name: 'wb2.xlsx', Sheets: ['Data'] },
    ])
    setMockApp(createMockApp(workbooks, 'wb1.xlsx'))

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
    setMockApp(createMockApp(workbooks, 'wb1.xlsx'))

    refreshEnrichWorkbooks('workbookSelect')

    const select = document.getElementById('workbookSelect') as HTMLSelectElement
    expect(select.value).toBe('wb1.xlsx')
  })

  it('DOM 不存在 / Workbooks 不可用时记录警告且不抛错', () => {
    const app = createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }]))
    setMockApp(app)

    expect(() => refreshEnrichWorkbooks('nonexistent')).not.toThrow()

    setupBasicDom()
    ;(app as unknown as { Workbooks: null }).Workbooks = null
    setMockApp(app)
    refreshEnrichWorkbooks('workbookSelect')
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })
})

// ============ 场景 7: refreshEnrichSheets ============
describe('refreshEnrichSheets', () => {
  it('刷新指定工作簿的工作表列表', () => {
    setupBasicDom()
    const workbooks = createMockWorkbooks([
      { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2', 'Data'] },
    ])
    setMockApp(createMockApp(workbooks))

    refreshEnrichSheets('wb1.xlsx', 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.options.length).toBe(4)
    expect(select.options[1]?.textContent).toBe('Sheet1')
    expect(select.options[3]?.textContent).toBe('Data')
  })

  it('未指定工作簿名称时使用下拉框当前值', () => {
    setupBasicDom()
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    wbSelect.replaceChildren()
    const opt = document.createElement('option')
    opt.value = 'wb1.xlsx'
    opt.textContent = 'wb1.xlsx'
    wbSelect.appendChild(opt)
    wbSelect.value = 'wb1.xlsx'
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    refreshEnrichSheets(undefined, 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.options.length).toBe(2)
  })

  it('工作簿名为空时显示提示', () => {
    setupBasicDom()
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    refreshEnrichSheets('', 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.options[0]?.textContent).toContain('请先选择工作簿')
    expect(select.options.length).toBe(1)
  })

  it('锁定状态时选中锁定的工作表', () => {
    setupBasicDom()
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedName = 'Sheet2'
    setMockApp(
      createMockApp(
        createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Sheet2', 'Data'] }]),
      ),
    )

    refreshEnrichSheets('wb1.xlsx', 'sheetSelect', 'workbookSelect')

    const select = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(select.value).toBe('2')
  })

  it('工作簿不存在 / DOM 不存在时不抛错', () => {
    setupBasicDom()
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    refreshEnrichSheets('nonexistent.xlsx', 'sheetSelect', 'workbookSelect')
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
    expect(() => refreshEnrichSheets('wb1.xlsx', 'nonexistent', 'workbookSelect')).not.toThrow()
  })
})

// ============ 场景 8: toggleEnrichWorkbookLock ============

function prepareToggle(): {
  storage: MockPluginStorage
} {
  setupBasicDom()
  const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
  wbSelect.replaceChildren()
  const wbOpt = document.createElement('option')
  wbOpt.value = 'wb1.xlsx'
  wbOpt.textContent = 'wb1.xlsx'
  wbSelect.appendChild(wbOpt)
  wbSelect.value = 'wb1.xlsx'

  const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
  sheetSelect.replaceChildren()
  const sheetOpt = document.createElement('option')
  sheetOpt.value = '2'
  sheetOpt.textContent = 'TargetSheet'
  sheetSelect.appendChild(sheetOpt)
  sheetSelect.value = '2'

  const storage = createMockPluginStorage()
  setMockApp(
    createMockApp(
      createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'TargetSheet'] }]),
      'wb1.xlsx',
      storage,
    ),
  )
  return { storage }
}

describe('toggleEnrichWorkbookLock', () => {
  it('选择工作表后写入共享 BGM.sheet 并持久化', () => {
    const { storage } = prepareToggle()

    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')

    expect(sharedBGM.sheet.isLocked).toBe(true)
    expect(sharedBGM.sheet.lockedWorkbookName).toBe('wb1.xlsx')
    expect(sharedBGM.sheet.lockedName).toBe('TargetSheet')
    expect(sharedBGM.sheet.lockedIndex).toBe(2)
    expect(storage._store[LOCKED_SHEET_KEY]).toBeTruthy()
    expect(mockReferences.mockShowToast).toHaveBeenCalled()
  })

  it('已锁定相同目标时点击解锁并清除状态', () => {
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedWorkbookName = 'wb1.xlsx'
    sharedBGM.sheet.lockedName = 'TargetSheet'
    sharedBGM.sheet.lockedIndex = 2
    const storage = createMockPluginStorage({
      [LOCKED_SHEET_KEY]: '{"index":2,"name":"TargetSheet","workbookName":"wb1.xlsx"}',
    })
    setupBasicDom()
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    wbSelect.innerHTML = '<option value="wb1.xlsx">wb1.xlsx</option>'
    wbSelect.value = 'wb1.xlsx'
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.innerHTML = '<option value="2">TargetSheet</option>'
    sheetSelect.value = '2'
    setMockApp(
      createMockApp(
        createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'TargetSheet'] }]),
        'wb1.xlsx',
        storage,
      ),
    )

    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')

    expect(sharedBGM.sheet.isLocked).toBe(false)
    expect(sharedBGM.sheet.lockedWorkbookName).toBeNull()
    expect(sharedBGM.sheet.lockedIndex).toBeNull()
    expect(storage._store[LOCKED_SHEET_KEY]).toBe('')
    expect(mockReferences.mockShowToast).toHaveBeenCalled()
  })

  it('未选择工作表 / 未选择工作簿时提示错误', () => {
    const { storage } = prepareToggle()
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement

    sheetSelect.value = ''
    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')
    expect(sharedBGM.sheet.isLocked).toBe(false)
    expect(mockReferences.mockShowToast).toHaveBeenCalled()

    sheetSelect.value = '2'
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    wbSelect.value = ''
    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')
    expect(storage._store[LOCKED_SHEET_KEY]).toBeUndefined()
  })

  it('DOM 元素不存在时不抛错', () => {
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    expect(() =>
      toggleEnrichWorkbookLock('nonexistent', 'workbookSelect', 'lockSheetBtn', 'lockStatus'),
    ).not.toThrow()
  })
})

// ============ 场景 9: updateEnrichLockButton ============
describe('updateEnrichLockButton', () => {
  it('锁定状态下更新按钮文字和状态显示', () => {
    setupBasicDom()
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedWorkbookName = 'wb1.xlsx'
    sharedBGM.sheet.lockedName = 'Sheet1'

    updateEnrichLockButton('lockSheetBtn', 'lockStatus')

    const button = document.getElementById('lockSheetBtn') as HTMLButtonElement
    const status = document.getElementById('lockStatus') as HTMLDivElement
    expect(button.textContent).toContain('解锁')
    expect(button.classList.contains('locked')).toBe(true)
    expect(status.classList.contains('show')).toBe(true)
    expect(status.textContent).toContain('wb1.xlsx')
    expect(status.textContent).toContain('Sheet1')
  })

  it('未锁定状态下更新按钮文字', () => {
    setupBasicDom()

    updateEnrichLockButton('lockSheetBtn', 'lockStatus')

    const button = document.getElementById('lockSheetBtn') as HTMLButtonElement
    const status = document.getElementById('lockStatus') as HTMLDivElement
    expect(button.textContent).toContain('锁定')
    expect(button.classList.contains('locked')).toBe(false)
    expect(status.classList.contains('show')).toBe(false)
  })

  it('DOM 元素不存在时不抛错', () => {
    expect(() => updateEnrichLockButton('nonexistentBtn', 'nonexistentStatus')).not.toThrow()
  })
})

// ============ 场景 10: lockEnrichWorkbookByName ============
describe('lockEnrichWorkbookByName', () => {
  it('按工作簿 + 索引锁定并写入共享状态', () => {
    const storage = createMockPluginStorage()
    setMockApp(
      createMockApp(
        createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Target'] }]),
        'wb1.xlsx',
        storage,
      ),
    )

    const isLocked = lockEnrichWorkbookByName('wb1.xlsx', 2)

    expect(isLocked).toBe(true)
    expect(sharedBGM.sheet.isLocked).toBe(true)
    expect(sharedBGM.sheet.lockedWorkbookName).toBe('wb1.xlsx')
    expect(sharedBGM.sheet.lockedName).toBe('Target')
    expect(sharedBGM.sheet.lockedIndex).toBe(2)
    expect(storage._store[LOCKED_SHEET_KEY]).toBeTruthy()
  })

  it('工作簿不存在 / 索引越界返回 false', () => {
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    expect(lockEnrichWorkbookByName('deleted.xlsx', 1)).toBe(false)
    expect(lockEnrichWorkbookByName('wb1.xlsx', 99)).toBe(false)
    expect(sharedBGM.sheet.isLocked).toBe(false)
  })
})

// ============ 场景 11: autoSelectEnrichTarget ============
describe('autoSelectEnrichTarget', () => {
  it('唯一候选时自动锁定并返回 locked', () => {
    setupBasicDom()
    setupScanMocks()
    const sheet = createScanSheet('bangumi 追踪', {
      headerRow: 1,
      headerKeyCount: 3,
      dataCount: 3,
    })
    const storage = createMockPluginStorage()
    setMockApp(createScanApp({ wb1: [sheet] }, 'wb1', '', storage))

    const result = autoSelectEnrichTarget(
      'workbookSelect',
      'sheetSelect',
      'lockSheetBtn',
      'lockStatus',
    )

    expect(result).toBe('locked')
    expect(sharedBGM.sheet.isLocked).toBe(true)
    expect(sharedBGM.sheet.lockedWorkbookName).toBe('wb1')
    expect(sharedBGM.sheet.lockedName).toBe('bangumi 追踪')
    expect(storage._store[LOCKED_SHEET_KEY]).toBeTruthy()
  })

  it('多个候选时预选首个并返回 preselected（不锁定）', () => {
    setupBasicDom()
    setupScanMocks()
    const sheetA = createScanSheet('bangumi A', { headerRow: 1, headerKeyCount: 3, dataCount: 3 })
    const sheetB = createScanSheet('bangumi B', { headerRow: 1, headerKeyCount: 3, dataCount: 3 })
    const storage = createMockPluginStorage()
    setMockApp(createScanApp({ wb1: [sheetA, sheetB] }, 'wb1', '', storage))
    // 先刷新工作簿下拉框（真实流程中 initEnrichLock 会先调用 refreshEnrichWorkbooks）
    refreshEnrichWorkbooks('workbookSelect')

    const result = autoSelectEnrichTarget(
      'workbookSelect',
      'sheetSelect',
      'lockSheetBtn',
      'lockStatus',
    )

    expect(result).toBe('preselected')
    expect(sharedBGM.sheet.isLocked).toBe(false)
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    expect(wbSelect.value).toBe('wb1')
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(sheetSelect.value).toBe('1')
  })

  it('已锁定状态时直接返回 locked', () => {
    sharedBGM.sheet.isLocked = true
    expect(autoSelectEnrichTarget()).toBe('locked')
  })

  it('无候选时返回 none', () => {
    setupBasicDom()
    setupScanMocks()
    setMockApp(createScanApp({ wb1: [createScanSheet('Sheet数据', null)] }, 'wb1'))

    expect(
      autoSelectEnrichTarget('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus'),
    ).toBe('none')
  })
})

// ============ 场景 12: initEnrichLock ============
describe('initEnrichLock', () => {
  it('无锁定状态时初始化下拉框（扫描无候选）', () => {
    setupBasicDom()
    setupScanMocks()
    setMockApp(createScanApp({ wb1: [createScanSheet('Sheet数据', null)] }, 'wb1'))

    initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')

    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    // 活动工作簿（wb1）自动选中，其工作表已填充
    expect(wbSelect.options.length).toBe(2)
    expect(wbSelect.value).toBe('wb1')
    expect(sheetSelect.options.length).toBe(2)
    expect(sharedBGM.sheet.isLocked).toBe(false)
  })

  it('有锁定状态时恢复选中值', () => {
    setupBasicDom()
    const storage = createMockPluginStorage({
      [LOCKED_SHEET_KEY]: '{"index":2,"name":"Target","workbookName":"wb1.xlsx"}',
    })
    setMockApp(
      createMockApp(
        createMockWorkbooks([
          { Name: 'wb1.xlsx', Sheets: ['Sheet1', 'Target'] },
          { Name: 'wb2.xlsx', Sheets: ['Data'] },
        ]),
        'wb1.xlsx',
        storage,
      ),
    )

    initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')

    expect(sharedBGM.sheet.isLocked).toBe(true)
    expect(sharedBGM.sheet.lockedWorkbookName).toBe('wb1.xlsx')
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    expect(wbSelect.value).toBe('wb1.xlsx')
    expect(sheetSelect.value).toBe('2')
  })

  it('锁定的工作簿不存在时降级为扫描/未锁定', () => {
    setupBasicDom()
    setupScanMocks()
    const storage = createMockPluginStorage({
      [LOCKED_SHEET_KEY]: '{"index":1,"name":"Sheet1","workbookName":"deleted.xlsx"}',
    })
    setMockApp(createScanApp({ other: [createScanSheet('Sheet数据', null)] }, 'other', '', storage))

    initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')

    expect(sharedBGM.sheet.isLocked).toBe(false)
  })
})

// ============================================================
//  补测（2026-09-15）：locked-sheet 的容错分支
// ============================================================
//
// 上面各场景打的是「宿主正常」主路径。以下四组打的是 WPS COM 的**真实边界**：
// 集合在窗口切换期瞬时失效、属性 getter 抛错、Application 尚未注入、活动工作簿为空。
// 这些分支的共同后果是「静默少认出一个工作簿/工作表」，不补测就等于没有防线。

/** findBangumiTargetSheetInWorkbook 的参数类型（避免为一个 cast 新增 wps.js 的 type import） */
type WorkbookArgument = Parameters<typeof findBangumiTargetSheetInWorkbook>[0]

describe('getOpenWorkbooks 的容错分支', () => {
  it('无 Application 时返回空数组', () => {
    setMockApp(null)

    expect(getOpenWorkbooks()).toEqual([])
  })

  it('工作簿的 FullName / Name 读取抛错时跳过该项', () => {
    const throwingWorkbook = {
      get FullName(): string {
        throw new Error('窗口切换中')
      },
      get Name(): string {
        throw new Error('窗口切换中')
      },
    }
    setMockApp({ Workbooks: { Count: 1, Item: () => throwingWorkbook }, ActiveWorkbook: null })

    expect(getOpenWorkbooks()).toEqual([])
  })

  it('Workbooks.Count 读取抛错时按 0 张处理', () => {
    setMockApp({
      Workbooks: {
        get Count(): number {
          throw new Error('集合瞬时失效')
        },
        Item: () => null,
      },
      ActiveWorkbook: null,
    })

    expect(getOpenWorkbooks()).toEqual([])
  })

  it('Windows.Count 读取抛错时按 0 个窗口处理', () => {
    setMockApp({
      Windows: {
        get Count(): number {
          throw new Error('集合瞬时失效')
        },
        Item: () => null,
      },
      ActiveWorkbook: null,
    })

    expect(getOpenWorkbooks()).toEqual([])
  })

  it('Workbooks 未枚举到的窗口工作簿会经 Windows 补齐', () => {
    const windowWorkbook = { Name: 'win.xlsx', FullName: 'C:/win.xlsx' }
    setMockApp({
      Windows: { Count: 1, Item: () => ({ Workbook: windowWorkbook }) },
      ActiveWorkbook: null,
    })

    const result = getOpenWorkbooks()

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(windowWorkbook)
  })
})

describe('getLockedSheet 的工作簿回退分支', () => {
  it('未记录工作簿名时回退到活动工作簿', () => {
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedName = 'Sheet1'
    const activeWorkbook = createMockWorkbooks([{ Name: 'active.xlsx', Sheets: ['Sheet1'] }])[0]!
    setMockApp({
      ActiveWorkbook: activeWorkbook,
      Workbooks: { Count: 1, Item: () => activeWorkbook },
    })

    const result = getLockedSheet()

    expect(result?.[0]).toBe(activeWorkbook)
    expect(result?.[1].Name).toBe('Sheet1')
  })

  it('无活动工作簿时清锁并返回 null', () => {
    const storage = createMockPluginStorage()
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedName = 'Sheet1'
    setMockApp({ ActiveWorkbook: null, PluginStorage: storage })

    expect(getLockedSheet()).toBeNull()
    expect(sharedBGM.sheet.isLocked).toBe(false)
    expect(storage._store[LOCKED_SHEET_KEY]).toBe('')
  })

  it('锁定的工作表名为空时清锁并返回 null', () => {
    const storage = createMockPluginStorage()
    sharedBGM.sheet.isLocked = true
    sharedBGM.sheet.lockedName = null
    sharedBGM.sheet.lockedWorkbookName = 'wb1.xlsx'
    setMockApp(
      createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }]), '', storage),
    )

    expect(getLockedSheet()).toBeNull()
    expect(sharedBGM.sheet.isLocked).toBe(false)
  })

  it('无 Application 时 saveLockedSheet / restoreLockedSheet 只记警告', () => {
    // clearLockedSheet 会连带调用 saveLockedSheet，因此这里同时覆盖两处的 `app?.` 短路侧
    setMockApp(null)

    expect(() => saveLockedSheet({ index: 1, name: 'Sheet1' })).not.toThrow()
    expect(restoreLockedSheet()).toBe(false)
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })

  it('findWorkbookByName 对纯空白名返回 null', () => {
    setMockApp(createMockApp(createMockWorkbooks([{ Name: 'wb1.xlsx', Sheets: ['Sheet1'] }])))

    expect(findWorkbookByName(' '.repeat(3))).toBeNull()
  })
})

describe('findBangumiTargetSheets 的过滤分支', () => {
  it('无 Application 时记警告并返回空数组', () => {
    setMockApp(null)

    expect(findBangumiTargetSheets()).toEqual([])
    expect(mockReferences.mockBgmLog).toHaveBeenCalled()
  })

  it('Worksheets.Item 抛错时跳过该工作表', () => {
    setupScanMocks()
    const workbook = createMockWorkbooks([{ Name: 'wb1', Sheets: ['动画'] }])[0]!
    ;(workbook.Worksheets as { Item: (index: number) => unknown }).Item = () => {
      throw new RangeError('集合瞬时失效')
    }
    setMockApp(createMockApp([workbook], 'wb1'))

    expect(findBangumiTargetSheets()).toEqual([])
  })

  it('表头关键词命中不足 3 个时不生成候选', () => {
    setupScanMocks()
    const sheet = createScanSheet('bangumi 表', { headerRow: 1, headerKeyCount: 2, dataCount: 5 })
    setMockApp(createScanApp({ wb1: [sheet] }, 'wb1'))

    expect(findBangumiTargetSheets()).toEqual([])
  })

  it('Worksheets.Count 读取抛错时按 0 张处理', () => {
    setupScanMocks()
    const workbook = createMockWorkbooks([{ Name: 'wb1', Sheets: ['动画'] }])[0]!
    Object.defineProperty(workbook.Worksheets, 'Count', {
      get() {
        throw new Error('集合瞬时失效')
      },
    })
    setMockApp(createMockApp([workbook], 'wb1'))

    expect(findBangumiTargetSheets()).toEqual([])
  })

  it('活动工作簿无候选时，其余候选按扫描顺序排在最后', () => {
    setupScanMocks()
    // 两个工作表都不命中名称关键词（走 collect(false) 回退，isNameHit 被强制为 false），
    // 活动工作簿名又不指向任何候选 → 两条都落到排序偏好最低的一档。
    const first = createScanSheet('表一', { headerRow: 1, headerKeyCount: 3, dataCount: 3 })
    const second = createScanSheet('表二', { headerRow: 1, headerKeyCount: 3, dataCount: 3 })
    setMockApp(createScanApp({ wb1: [first, second] }, '不存在的活动工作簿'))

    const result = findBangumiTargetSheets()

    expect(result.map((candidate) => candidate.sheetName)).toEqual(['表一', '表二'])
    expect(result.every((candidate) => !candidate.isNameHit)).toBe(true)
  })
})

describe('findBangumiTargetSheetInWorkbook', () => {
  it('优先返回名称命中关键词的强候选', () => {
    setupScanMocks()
    const plain = createScanSheet('表数据', { headerRow: 1, headerKeyCount: 3, dataCount: 3 })
    const nameHit = createScanSheet('bangumi 追番', { headerRow: 1, headerKeyCount: 3, dataCount: 3 })
    const app = createScanApp({ wb1: [plain, nameHit] })

    const result = findBangumiTargetSheetInWorkbook(
      app.Workbooks.Item(1) as unknown as WorkbookArgument,
    )

    expect(result).toBe(nameHit)
  })

  it('无名称命中时返回扫描顺序里首个通过校验的工作表', () => {
    setupScanMocks()
    const noHeader = createScanSheet('表头', { headerRow: 0, headerKeyCount: 0, dataCount: 0 })
    const plain = createScanSheet('表数据', { headerRow: 1, headerKeyCount: 3, dataCount: 3 })
    const app = createScanApp({ wb1: [noHeader, plain] })

    const result = findBangumiTargetSheetInWorkbook(
      app.Workbooks.Item(1) as unknown as WorkbookArgument,
    )

    expect(result).toBe(plain)
  })

  it('无任何通过校验的工作表时返回 null', () => {
    setupScanMocks()
    const app = createScanApp({ wb1: [createScanSheet('空表', null)] })

    const result = findBangumiTargetSheetInWorkbook(
      app.Workbooks.Item(1) as unknown as WorkbookArgument,
    )

    expect(result).toBeNull()
  })
})
