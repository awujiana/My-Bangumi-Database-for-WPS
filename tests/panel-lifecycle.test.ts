// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/panel-lifecycle.ts` 单元测试。
 *
 * 这个 1095 行的文件负责面板里最贴近宿主的一层：工作表锁定、表头检测、
 * 筛选状态解读、预览渲染。它依赖收敛在 4 个模块上（`../index.js` barrel +
 * sanitize / stat-cards / locked-sheet），因此**不需要拆文件**——mock 一个 barrel
 * 加一个假工作表对象，就能驱动全部真实实现；断言的是真实写盘、真实 DOM 输出、
 * 真实锁定状态，不是 mock 的行为。
 *
 * 假工作表（`FakeWorksheet`）只实现被测代码真正用到的那一面：
 * `Name` / `Activate` / `AutoFilterMode` / `AutoFilter` / `Range(address).Value2`。
 * 单元格内容放在 `__cells`（键为 `"行:列"`），由 mock 版的 `getCellValue` 读取——
 * 这样表数据可以逐格精确布置，而不必伪造整个 COM Range 对象。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WpsWorksheet } from '../ts/index.js'

// ========== 假宿主形状 ==========

interface FakeFilter {
  On: boolean
  Criteria1?: string
  Criteria2?: string
  Operator?: number
}

interface FakeAutoFilter {
  Mode?: boolean
  Filters?: { Count: number; Item: (index: number) => FakeFilter }
}

interface FakeWorksheet {
  Name: string
  Activate: () => void
  AutoFilterMode?: boolean
  AutoFilter?: FakeAutoFilter
  Range?: (address: string) => { Value2: unknown }
  /** 单元格内容：键为 `"行:列"`（1-based） */
  __cells?: Record<string, string>
}

interface FakeSheetCollection {
  Count: number
  Item: (index: number) => FakeWorksheet
}

interface FakeWorkbook {
  Name: string
  Worksheets: FakeSheetCollection
  ActiveSheet?: FakeWorksheet | undefined
}

const sheetState = vi.hoisted(() => ({
  isLocked: false,
  lockedIndex: null as number | null,
  lockedName: null as string | null,
  lockedWorkbookName: null as string | null,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- mock setter 会写入 unknown，字段类型须放宽
  dataPreview: null as unknown,
}))

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  handleError: vi.fn(() => ({ details: {} })),
  showToast: vi.fn(),
  getApp: vi.fn((): unknown => null),
  getLastRow: vi.fn(() => 0),
  getFilterStatus: vi.fn(() => ({ hasFilter: false, visibleRows: [] as number[] })),
  clearSheetCache: vi.fn(),
  escapeHtml: vi.fn((text: unknown) =>
    String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  ),
  /** 1 → A；测试列数远小于 26，故只需覆盖单字母区间 */
  colNumberToLetter: vi.fn((index: number) => String.fromCodePoint(64 + index)),
  getCellValue: vi.fn<(ws: FakeWorksheet, row: number, col: number) => string>(),
  renderStatCards: vi.fn(),
  sanitizeHtml: vi.fn((html: string) => html),
  saveLockedSheet: vi.fn(),
  findWorkbookByName: vi.fn<(name: string) => FakeWorkbook | null>(() => null),
  findBangumiTargetSheets: vi.fn(() => [] as unknown[]),
  getOpenWorkbooks: vi.fn(() => [] as FakeWorkbook[]),
}))

vi.mock('../ts/index.js', async () => {
  const constants = await import('../ts/core/constants.js')
  const bgmMock = {
    sheet: sheetState,
    ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
    handleError: mocks.handleError,
  }
  // 生产代码把预览元信息写在 BGM 顶层（BGM.dataPreview），而不是 BGM.sheet 上；
  // 用 getter/setter 桥接，让测试仍可通过 sheetState 断言。
  Object.defineProperty(bgmMock, 'dataPreview', {
    get: () => sheetState.dataPreview,
    set: (value: unknown) => {
      sheetState.dataPreview = value
    },
  })
  return {
    PANEL_CONFIG: constants.PANEL_CONFIG,
    HEADER_KEYWORDS: constants.HEADER_KEYWORDS,
    IMPORTANT_COLS: constants.IMPORTANT_COLS,
    LOG_LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
    BGM: bgmMock,
    getApp: mocks.getApp,
    bgmLog: mocks.bgmLog,
    escapeHtml: mocks.escapeHtml,
    getCellValue: mocks.getCellValue,
    colNumberToLetter: mocks.colNumberToLetter,
    showToast: mocks.showToast,
    getFilterStatus: mocks.getFilterStatus,
    getLastRow: mocks.getLastRow,
    clearSheetCache: mocks.clearSheetCache,
  }
})

vi.mock('../ts/tools/sanitize.js', () => ({ sanitizeHtml: mocks.sanitizeHtml }))
vi.mock('../ts/ui/stat-cards.js', () => ({ renderStatCards: mocks.renderStatCards }))
vi.mock('../ts/tools/locked-sheet.js', () => ({
  saveLockedSheet: mocks.saveLockedSheet,
  findWorkbookByName: mocks.findWorkbookByName,
  findBangumiTargetSheets: mocks.findBangumiTargetSheets,
  getOpenWorkbooks: mocks.getOpenWorkbooks,
}))

import {
  activateSheetIfNeeded,
  autoDetectAndLockSheet,
  autoDetectSheet,
  detectHeaderAndColumns,
  enlargePreview,
  onSelectModeChange,
  refreshData,
  refreshSheets,
  refreshWorkbooks,
  toggleSheetLock,
  updateFilterStatus,
  updateLockButton,
} from '../ts/panel/panel-lifecycle.js'

// ========== helpers ==========
/**
 * 刻意越界：假工作表只实现被测代码真正用到的那一面（Name/Activate/AutoFilter/Range），
 * 生产签名要求完整 WpsWorksheet（Rows/Columns/Cells 等宿主属性），此处集中断言放宽。
 * 泛型 T 由调用处的参数类型推断，兼容可选/必选两种宿主签名。
 */
function asWs(ws: FakeWorksheet | null | undefined): WpsWorksheet {
  return ws as WpsWorksheet
}


function makeSheet(name: string, cells: Record<string, string> = {}): FakeWorksheet {
  const sheet: FakeWorksheet = {
    Name: name,
    Activate: vi.fn(),
    __cells: cells,
  }
  return sheet
}

function makeWorkbook(name: string, sheets: FakeWorksheet[]): FakeWorkbook {
  return {
    Name: name,
    Worksheets: {
      Count: sheets.length,
      Item: (index: number) => {
        const sheet = sheets[index - 1]
        if (!sheet) throw new Error(`工作表 ${String(index)} 不存在`)
        return sheet
      },
    },
    ActiveSheet: sheets[0],
  }
}

function mountDiv(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.id = id
  document.body.append(element)
  return element
}

function mountSelect(id: string, value = ''): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  // jsdom 陷阱：select.value 只有存在匹配 value 的 option 才能落住，否则被静默置空。
  // 生产代码按 Number(select.value) / select.value === 名称 读取选择，必须先补一个假 option。
  if (value !== '') {
    const option = document.createElement('option')
    option.value = value
    select.append(option)
  }
  select.value = value
  document.body.append(select)
  return select
}

function mountButton(id: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.id = id
  document.body.append(button)
  return button
}

function mountOptionSelect(id: string, options: string[]): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  for (const [index, text] of options.entries()) {
    const option = document.createElement('option')
    // 生产代码按「option.value = 工作表索引数字」渲染（refreshSheets），文本放 text
    option.value = String(index + 1)
    option.text = text
    select.append(option)
  }
  document.body.append(select)
  return select
}

/** 造一张"表头 4 列关键字 + 2 行数据"的表（够触发 matchCount >= 3） */
function makeTrackedSheetCells(): Record<string, string> {
  return {
    '1:1': '序列号',
    '1:2': '名称',
    '1:3': '是否看完',
    '1:4': '打分',
    '2:1': '1',
    '2:2': '动画A',
    '2:3': '是',
    '2:4': '8',
    '3:1': '2',
    '3:2': '动画B',
    '3:3': '否',
    '3:4': '9',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  document.body.className = ''
  sheetState.isLocked = false
  sheetState.lockedIndex = null
  sheetState.lockedName = null
  sheetState.lockedWorkbookName = null
  sheetState.dataPreview = null
  mocks.getApp.mockReturnValue(null)
  mocks.getLastRow.mockReturnValue(0)
  mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [] })
  mocks.getCellValue.mockImplementation(
    (ws: FakeWorksheet, row: number, col: number) => ws.__cells?.[`${String(row)}:${String(col)}`] ?? '',
  )
  mocks.findWorkbookByName.mockReturnValue(null)
  mocks.findBangumiTargetSheets.mockReturnValue([])
  mocks.getOpenWorkbooks.mockReturnValue([])
})

afterEach(() => {
  document.body.replaceChildren()
})

// ========== toggleSheetLock / updateLockButton ==========

describe('panel-lifecycle · toggleSheetLock', () => {
  it('没有工作表下拉框 → 直接返回', () => {
    expect(() => {
      toggleSheetLock()
    }).not.toThrow()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('未选择或选择了无效索引 → 提示先选工作表', () => {
    const select = mountSelect('sheetSelect', '0')
    toggleSheetLock()
    expect(mocks.showToast).toHaveBeenCalledWith('请先选择一个有效的工作表', 'warn')

    select.value = ''
    toggleSheetLock()
    expect(mocks.showToast).toHaveBeenCalledTimes(2)
  })

  it('锁定工作表：写入锁定状态、持久化并提示', () => {
    const select = mountOptionSelect('sheetSelect', ['动画', '漫画'])
    select.selectedIndex = 1
    select.value = '2'
    mountSelect('workbookSelect', 'BGM.xlsx')
    mountButton('lockSheetBtn')

    toggleSheetLock()

    expect(sheetState.isLocked).toBe(true)
    expect(sheetState.lockedIndex).toBe(2)
    expect(sheetState.lockedName).toBe('漫画')
    expect(sheetState.lockedWorkbookName).toBe('BGM.xlsx')
    expect(mocks.saveLockedSheet).toHaveBeenCalledWith({
      index: 2,
      name: '漫画',
      workbookName: 'BGM.xlsx',
    })
    expect(mocks.showToast).toHaveBeenCalledWith('已锁定工作表: 漫画（工作簿: BGM.xlsx）', 'info')
  })

  it('未选工作簿时只记工作表本身（不写空的 workbookName）', () => {
    const select = mountOptionSelect('sheetSelect', ['动画'])
    select.selectedIndex = 0
    select.value = '1'
    mountButton('lockSheetBtn')

    toggleSheetLock()

    expect(sheetState.lockedWorkbookName).toBeNull()
    expect(mocks.saveLockedSheet).toHaveBeenCalledWith({ index: 1, name: '动画' })
    expect(mocks.showToast).toHaveBeenCalledWith('已锁定工作表: 动画', 'info')
  })

  it('再次点击同一张已锁定的表 → 解锁并清空状态', () => {
    const select = mountOptionSelect('sheetSelect', ['动画'])
    select.selectedIndex = 0
    select.value = '1'
    mountButton('lockSheetBtn')
    sheetState.isLocked = true
    sheetState.lockedIndex = 1

    toggleSheetLock()

    expect(sheetState.isLocked).toBe(false)
    expect(sheetState.lockedIndex).toBeNull()
    expect(sheetState.lockedName).toBeNull()
    expect(sheetState.lockedWorkbookName).toBeNull()
    expect(mocks.saveLockedSheet).toHaveBeenCalledWith(null)
    expect(mocks.showToast).toHaveBeenCalledWith('已解锁工作表', 'info')
  })

  it('切到另一张表时按「锁定新表」处理（不是解锁）', () => {
    const select = mountOptionSelect('sheetSelect', ['动画', '漫画'])
    select.selectedIndex = 1
    select.value = '2'
    mountButton('lockSheetBtn')
    sheetState.isLocked = true
    sheetState.lockedIndex = 1

    toggleSheetLock()

    expect(sheetState.isLocked).toBe(true)
    expect(sheetState.lockedIndex).toBe(2)
  })
})

describe('panel-lifecycle · updateLockButton', () => {
  it('已锁定 → 按钮变成「解锁」并加类名，状态行显示锁定名', () => {
    const button = mountButton('lockSheetBtn')
    const status = mountDiv('lockStatus')
    sheetState.isLocked = true
    sheetState.lockedName = '动画'

    updateLockButton()

    expect(button.textContent).toBe('🔓 解锁')
    expect(button.classList.contains('locked')).toBe(true)
    expect(status.style.display).toBe('inline')
    expect(status.textContent).toBe('已锁定: 动画')
  })

  it('未锁定 → 按钮回到「锁定」，状态行隐藏', () => {
    const button = mountButton('lockSheetBtn')
    const status = mountDiv('lockStatus')
    button.classList.add('locked')
    status.style.display = 'inline'

    updateLockButton()

    expect(button.textContent).toBe('🔒 锁定')
    expect(button.classList.contains('locked')).toBe(false)
    expect(status.style.display).toBe('none')
  })

  it('元素缺失时静默', () => {
    expect(() => {
      updateLockButton()
    }).not.toThrow()
  })
})

// ========== refreshSheets / refreshWorkbooks ==========

describe('panel-lifecycle · refreshSheets', () => {
  it('下拉框缺失或无活动工作簿 → 不渲染，仅记录', () => {
    expect(() => {
      refreshSheets()
    }).not.toThrow()

    const select = mountSelect('sheetSelect')
    refreshSheets()
    expect(select.options).toHaveLength(0)
    expect(mocks.bgmLog).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('ActiveWorkbook'))
  })

  it('渲染工作表列表；未传 autoSelectActive 且未锁定时不预选', () => {
    const select = mountSelect('sheetSelect')
    const sheets = [makeSheet('动画'), makeSheet('漫画'), makeSheet('游戏')]
    const workbook = makeWorkbook('BGM.xlsx', sheets)
    const games = sheets.at(2)
    workbook.ActiveSheet = games
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })

    refreshSheets()

    // 含「-- 请选择 --」
    expect(select.options).toHaveLength(4)
    // 生产行为：只有 autoSelectActive 或已锁定分支才会写 select.value
    expect(select.value).toBe('')
    expect(select.selectedIndex).toBe(0)
  })

  it('autoSelectActive 时自动选中活动工作表', () => {
    const select = mountSelect('sheetSelect')
    const sheets = [makeSheet('动画'), makeSheet('漫画')]
    const workbook = makeWorkbook('BGM.xlsx', sheets)
    const [, manhua] = sheets
    workbook.ActiveSheet = manhua
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })

    refreshSheets({ autoSelectActive: true })

    expect(select.value).toBe('2')
  })

  it('已锁定的工作表优先于活动工作表被选中', () => {
    const select = mountSelect('sheetSelect')
    const sheets = [makeSheet('动画'), makeSheet('漫画')]
    const workbook = makeWorkbook('BGM.xlsx', sheets)
    const [, manhua] = sheets
    workbook.ActiveSheet = manhua
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })
    sheetState.isLocked = true
    sheetState.lockedIndex = 1

    refreshSheets({ autoSelectActive: true })

    expect(select.value).toBe('1')
  })

  it('选中了工作簿下拉框时按名称查找该工作簿', () => {
    const select = mountSelect('sheetSelect')
    mountSelect('workbookSelect', '其他.xlsx')
    const target = makeWorkbook('其他.xlsx', [makeSheet('表X')])
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: makeWorkbook('BGM.xlsx', [makeSheet('动画')]),
    })
    mocks.findWorkbookByName.mockReturnValue(target)

    refreshSheets()

    expect(mocks.findWorkbookByName).toHaveBeenCalledWith('其他.xlsx')
    expect(select.options[1]?.text).toBe('表X')
  })

  it('探测活动工作表时抛错 → 记录但不中断渲染', () => {
    const select = mountSelect('sheetSelect')
    const workbook = makeWorkbook('BGM.xlsx', [makeSheet('动画')])
    Object.defineProperty(workbook, 'ActiveSheet', {
      get() {
        throw new Error('宿主不支持 ActiveSheet')
      },
    })
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })

    refreshSheets()

    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'refreshSheets.getActiveSheet' }),
    )
    expect(select.options).toHaveLength(2)
  })

  it('已锁定但锁定索引悬空时，自动选中回退到活动工作表索引', () => {
    const select = mountSelect('sheetSelect')
    const sheets = [makeSheet('动画'), makeSheet('漫画')]
    const workbook = makeWorkbook('BGM.xlsx', sheets)
    const [, manhua] = sheets
    workbook.ActiveSheet = manhua
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })
    // 状态损坏形态：isLocked 为真但 lockedIndex 不指向任何一张在列表里的表
    // （锁定表被删除 / 持久化只存了名字），此时两个选中条件都不成立。
    sheetState.isLocked = true
    sheetState.lockedIndex = null

    refreshSheets({ autoSelectActive: true })

    expect(select.value).toBe('2')
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('自动选中当前活动工作表: 2'),
    )
  })
})

describe('panel-lifecycle · refreshWorkbooks', () => {
  it('下拉框缺失或无法获取 Workbooks → 不渲染', () => {
    expect(() => {
      refreshWorkbooks()
    }).not.toThrow()

    mountSelect('workbookSelect')
    refreshWorkbooks()
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Workbooks'),
    )
  })

  it('渲染所有已打开工作簿，并默认选中活动工作簿', () => {
    const select = mountSelect('workbookSelect')
    const active = makeWorkbook('BGM.xlsx', [])
    const other = makeWorkbook('其他.xlsx', [])
    mocks.getApp.mockReturnValue({ Workbooks: {}, ActiveWorkbook: active })
    mocks.getOpenWorkbooks.mockReturnValue([active, other])

    refreshWorkbooks()

    // 含「-- 当前活动工作簿 --」
    expect(select.options).toHaveLength(3)
    expect(select.value).toBe('BGM.xlsx')
  })

  it('保留用户此前的选择', () => {
    const select = mountSelect('workbookSelect', '其他.xlsx')
    const active = makeWorkbook('BGM.xlsx', [])
    const other = makeWorkbook('其他.xlsx', [])
    mocks.getApp.mockReturnValue({ Workbooks: {}, ActiveWorkbook: active })
    mocks.getOpenWorkbooks.mockReturnValue([active, other])

    refreshWorkbooks()

    expect(select.value).toBe('其他.xlsx')
  })

  it('读名字失败的工作簿被跳过（不产生空选项）', () => {
    const select = mountSelect('workbookSelect')
    const broken: FakeWorkbook = {
      Name: '',
      Worksheets: { Count: 0, Item: () => makeSheet('x') },
    }
    Object.defineProperty(broken, 'Name', {
      get() {
        throw new Error('工作簿已关闭')
      },
    })
    mocks.getApp.mockReturnValue({ Workbooks: {}, ActiveWorkbook: makeWorkbook('BGM.xlsx', []) })
    mocks.getOpenWorkbooks.mockReturnValue([broken, makeWorkbook('其他.xlsx', [])])

    refreshWorkbooks()

    expect(select.options).toHaveLength(2)
    expect(select.options[1]?.text).toBe('其他.xlsx')
  })
})

// ========== activateSheetIfNeeded ==========

describe('panel-lifecycle · activateSheetIfNeeded', () => {
  it('无活动工作簿 → false', () => {
    expect(activateSheetIfNeeded(asWs(makeSheet('动画')))).toBe(false)
  })

  it('目标就是当前活动表 → 不做切换', () => {
    const sheet = makeSheet('动画')
    const workbook = makeWorkbook('BGM.xlsx', [sheet])
    workbook.ActiveSheet = sheet
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })

    expect(activateSheetIfNeeded(asWs(sheet))).toBe(false)
    expect(sheet.Activate).not.toHaveBeenCalled()
  })

  it('目标不是活动表 → 激活它并返回恢复函数', () => {
    const active = makeSheet('动画')
    const target = makeSheet('漫画')
    const workbook = makeWorkbook('BGM.xlsx', [active, target])
    workbook.ActiveSheet = active
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })

    const restore = activateSheetIfNeeded(asWs(target))

    expect(target.Activate).toHaveBeenCalledTimes(1)
    expect(typeof restore).toBe('function')
    if (restore) restore()
    expect(active.Activate).toHaveBeenCalledTimes(1)
  })

  it('恢复时抛错 → 记录但不影响调用方', () => {
    const active = makeSheet('动画')
    ;(active.Activate as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('表已被删除')
    })
    const target = makeSheet('漫画')
    const workbook = makeWorkbook('BGM.xlsx', [active, target])
    workbook.ActiveSheet = active
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })

    const restore = activateSheetIfNeeded(asWs(target))
    expect(() => {
      if (restore) restore()
    }).not.toThrow()
    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'activateSheetIfNeeded' }),
    )
  })

  it('读取活动表名抛错 → 记录并返回 false', () => {
    const workbook = makeWorkbook('BGM.xlsx', [])
    Object.defineProperty(workbook, 'ActiveSheet', {
      get() {
        throw new Error('宿主异常')
      },
    })
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })

    expect(activateSheetIfNeeded(asWs(makeSheet('动画')))).toBe(false)
    expect(mocks.handleError).toHaveBeenCalled()
  })
})

// ========== detectHeaderAndColumns ==========

describe('panel-lifecycle · detectHeaderAndColumns', () => {
  it('空表 → 返回全 0 的元信息', () => {
    const meta = detectHeaderAndColumns(asWs(makeSheet('空表')))
    expect(meta.headerRow).toBe(0)
    expect(meta.headerNames).toEqual([])
    expect(meta.lastCol).toBe(0)
    expect(meta.headerMatchCount).toBe(0)
  })

  it('识别出表头行、列名与数据起始行', () => {
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', makeTrackedSheetCells())))

    expect(meta.headerRow).toBe(1)
    expect(meta.headerMatchCount).toBe(4)
    expect(meta.dataStartRow).toBe(2)
    expect(meta.firstDataCol).toBe(1)
    expect(meta.lastCol).toBe(4)
  })

  it('关键字少于 3 个的行不算表头', () => {
    const meta = detectHeaderAndColumns(
        asWs(makeSheet('动画', { '1:1': '序列号', '1:2': '名称', '2:1': 'x' })),
    )
    expect(meta.headerRow).toBe(0)
  })

  it('优先选择列数最多的候选行（同列数取行号最小）', () => {
    const cells = {
      '1:1': '序列号',
      '1:2': '名称',
      '1:3': '打分',
      // 第 3 行关键字更多 → 应胜出
      '3:1': '序列号',
      '3:2': '名称',
      '3:3': '打分',
      '3:4': '是否看完',
      '4:1': '1',
    }
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', cells)))
    expect(meta.headerRow).toBe(3)
  })

  it('单个单元格读取失败 → 记录后继续扫描其余列', () => {
    let hasThrown = false
    mocks.getCellValue.mockImplementation((ws: FakeWorksheet, row: number, col: number) => {
      // 每个坐标只抛一次：表头扫描阶段有 try/catch 能兜住并继续；
      // 表头名回读阶段（第二遍逐列读，无 try/catch）必须正常返回，否则错误会冒泡。
      if (row === 1 && col === 2 && !hasThrown) {
        hasThrown = true
        throw new Error('该单元格不可读')
      }
      return ws.__cells?.[`${String(row)}:${String(col)}`] ?? ''
    })

    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', makeTrackedSheetCells())))
    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'detectHeaderAndColumns' }),
    )
    // 少了一列关键字，但仍有 3 个 → 依然是表头
    expect(meta.headerRow).toBe(1)
  })

  it('筛选模式下只扫描可见行（表头行永远可见）', () => {
    const cells = makeTrackedSheetCells()
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', cells)), {
      isFiltered: true,
      visibleRowSet: new Set([1, 2]),
    })
    expect(meta.headerRow).toBe(1)
    expect(meta.dataStartRow).toBe(2)
  })

  it('重要列被标记（名称 / bangumi url 等）', () => {
    const meta = detectHeaderAndColumns(
        asWs(makeSheet('动画', {
        '1:1': '名称',
        '1:2': '序列号',
        '1:3': '打分',
        '2:1': '动画A',
      })),
    )
    // 表头切片后的第一列是「名称」→ 应为重要列
    expect(meta.isImportant[0]).toBe(true)
  })

  it('表头列为空但数据列更多时，列范围以表头为准', () => {
    const cells = {
      '1:1': '序列号',
      '1:2': '名称',
      '1:3': '打分',
      '2:1': '1',
      '2:2': '动画A',
      '2:3': '9',
      '2:5': '表头没这一列',
    }
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', cells)))
    expect(meta.firstDataCol).toBe(1)
    expect(meta.lastCol).toBe(5)
    expect(meta.previewColEnd).toBe(3)
  })

  it('预览列范围按真实表头宽度收敛，不是 MAX_SCAN_COLUMNS', () => {
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', makeTrackedSheetCells())))

    expect(meta.headerNames).toEqual(['序列号', '名称', '是否看完', '打分'])
    expect(meta.lastCol).toBe(4)
    expect(meta.previewColEnd).toBe(4)
    expect(meta.previewColEnd - meta.previewColStart).toBe(4)
  })

  it('两行表头：续行补齐空列时合并列名，数据起始行后移一行', () => {
    const cells = {
      '1:1': '序列号',
      '1:2': '名称',
      '1:3': '打分',
      // 第 2 行补齐第 1 行为空的第 4~6 列
      '2:4': '开播日期',
      '2:5': '集数',
      '2:6': '标签',
      '3:1': '1',
      '3:2': '动画A',
      '3:3': '9',
      '3:4': '2026-07',
      '3:5': '12',
      '3:6': '恋爱',
    }
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', cells)))

    expect(meta.headerRow).toBe(1)
    expect(meta.dataStartRow).toBe(3)
    expect(meta.headerNames).toEqual(['序列号', '名称', '打分', '开播日期', '集数', '标签'])
    expect(meta.lastCol).toBe(6)
  })

  it('补齐行比主表头行更宽时，表头行仍取上一行（不丢主列名）', () => {
    const cells = {
      '1:1': '序列号',
      '1:2': '名称',
      '1:3': '打分',
      // 第 2 行补 5 列 —— 列数比第 1 行多，只按 colCount 排序会把第 2 行误当表头
      '2:4': '开播日期',
      '2:5': '集数',
      '2:6': '标签',
      '2:7': '别名',
      '2:8': '备注',
      '3:1': '1',
      '3:2': '动画A',
    }
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', cells)))

    expect(meta.headerRow).toBe(1)
    expect(meta.dataStartRow).toBe(3)
    expect(meta.headerNames[0]).toBe('序列号')
  })

  it('表头与数据都从第 12 列开始时，预览起始列跟随表头而非左扩 5 列', () => {
    const cells = {
      '1:12': '序列号',
      '1:13': '名称',
      '1:14': '打分',
      '1:15': '是否看完',
      '2:12': '1',
      '2:13': '动画A',
    }
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', cells)))

    expect(meta.firstDataCol).toBe(12)
    expect(meta.previewColStartAbsolute).toBe(12)
    expect(meta.lastCol).toBe(15)
    expect(meta.previewColEnd).toBe(4)
  })
  it('数据区全空时首个数据列回退到第 1 列', () => {
    // 表头行有 3 个关键字（够成为候选），但数据区一格值都没有：
    // firstDataCol 扫描不到任何非空单元格，必须回退成 1，否则列范围算不出来。
    const meta = detectHeaderAndColumns(
      asWs(
        makeSheet('动画', {
          '1:1': '序列号',
          '1:2': '名称',
          '1:3': '是否看完',
        }),
      ),
    )

    expect(meta.headerRow).toBe(1)
    expect(meta.firstDataCol).toBe(1)
  })

  it('续行只补上不到 3 列时不算多行表头，避免吞掉首行数据', () => {
    const cells = {
      '1:1': '序列号',
      '1:2': '名称',
      '1:3': '打分',
      '2:1': '1',
      '2:2': '动画A',
      '2:3': '9',
      '2:4': '备注甲',
      '2:5': '备注乙',
      '3:1': '2',
    }
    const meta = detectHeaderAndColumns(asWs(makeSheet('动画', cells)))

    // 第 2 行只有 2 列落在「表头为空」的列上 → 低于阈值，按数据行处理
    expect(meta.headerRow).toBe(1)
    expect(meta.dataStartRow).toBe(2)
  })
})

// ========== autoDetectSheet ==========

describe('panel-lifecycle · autoDetectSheet', () => {
  it('未找到追踪表 → 记录警告并返回 null', () => {
    expect(autoDetectSheet()).toBeNull()
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('未在任何工作簿中找到有效追踪表'),
    )
  })

  it('找到候选 → 取第一个并按字段映射返回', () => {
    mocks.findBangumiTargetSheets.mockReturnValue([
      {
        workbookName: 'BGM.xlsx',
        sheetIndex: 2,
        sheetName: '动画',
        headerRow: 1,
        headerMatchCount: 5,
        dataRowCount: 30,
      },
    ])

    expect(autoDetectSheet()).toEqual({
      workbookName: 'BGM.xlsx',
      sheetIndex: 2,
      sheetName: '动画',
      headerRow: 1,
      matchCount: 5,
      colCount: 5,
    })
  })
})

// ========== collectActiveFilterCols / updateFilterStatus ==========

describe('panel-lifecycle · updateFilterStatus', () => {
  it('状态元素缺失或取不到工作表 → 直接返回', () => {
    expect(() => {
      updateFilterStatus()
    }).not.toThrow()

    mountDiv('filterStatus')
    updateFilterStatus()
    expect(mocks.getApp).toHaveBeenCalled()
  })

  it('未开启筛选 → 提示同步全部数据且不残留 title', () => {
    const element = mountDiv('filterStatus')
    element.setAttribute('title', '旧提示')

    updateFilterStatus(asWs(makeSheet('动画', {})))

    expect(element.textContent).toBe('未开启筛选，同步全部数据')
    expect(element.hasAttribute('title')).toBe(false)
  })

  it('AutoFilterMode 读取抛错 → 记录后按未开启筛选处理', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    Object.defineProperty(sheet, 'AutoFilterMode', {
      get() {
        throw new Error('宿主不支持')
      },
    })

    updateFilterStatus(asWs(sheet))

    expect(mocks.handleError).toHaveBeenCalled()
    expect(element.textContent).toBe('未开启筛选，同步全部数据')
  })

  it('AutoFilter 探测抛错 → 记录后继续', () => {
    mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    Object.defineProperty(sheet, 'AutoFilter', {
      get() {
        throw new Error('宿主不支持')
      },
    })

    expect(() => {
      updateFilterStatus(asWs(sheet))
    }).not.toThrow()
    expect(mocks.handleError).toHaveBeenCalled()
  })

  it('开启了筛选但 AutoFilter 对象缺失 → 如实说明无活动筛选', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    sheet.AutoFilterMode = true

    updateFilterStatus(asWs(sheet))
    expect(element.textContent).toBe('筛选已开启但无活动筛选')
  })

  it('开启了筛选但列数为 0 → 提示按全部数据同步', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    sheet.AutoFilterMode = true
    sheet.AutoFilter = { Filters: { Count: 0, Item: () => ({ On: false }) } }

    updateFilterStatus(asWs(sheet))

    expect(element.textContent).toBe('筛选已开启但无活动筛选，同步全部数据')
  })
  it('AutoFilterMode 为假但 AutoFilter.Mode 为真 → 仍按已开启筛选处理', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    // 有些宿主只暴露 AutoFilter 对象、AutoFilterMode 恒为假，靠 AutoFilter.Mode 兜底。
    sheet.AutoFilterMode = false
    sheet.AutoFilter = { Mode: true, Filters: { Count: 0, Item: () => ({ On: false }) } }

    updateFilterStatus(asWs(sheet))

    // 兜底生效才会走到「已开启筛选」文案；否则会是「未开启筛选，同步全部数据」
    expect(element.textContent).toBe('筛选已开启但无活动筛选，同步全部数据')
  })

  it('有活动筛选 → 列出「列名(条件)」并设置 title', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', { '1:1': '名称', '1:2': '是否看完' })
    sheet.AutoFilterMode = true
    sheet.Range = (address: string) => ({ Value2: address.startsWith('A') ? '名称' : '是否看完' })
    sheet.AutoFilter = {
      Filters: {
        Count: 2,
        Item: (index: number) =>
          index === 1 ? { On: true, Criteria1: '动画A' } : { On: false },
      },
    }

    updateFilterStatus(asWs(sheet))

    expect(element.textContent).toContain('筛选已开启（1 列）')
    expect(element.textContent).toContain('名称(动画A)')
    expect(element.getAttribute('title')).toBe(element.textContent)
  })

  it('双条件筛选按 Operator 拼接「且 / 或 / 斜杠」', () => {
    const element = mountDiv('filterStatus')

    for (const [operator, expected] of [
      [1, ' 且 B'],
      [2, ' 或 B'],
      [7, ' / B'],
    ] as [number, string][]) {
      element.textContent = ''
      const sheet = makeSheet('动画', { '1:1': '名称' })
      sheet.AutoFilterMode = true
      sheet.Range = () => ({ Value2: '名称' })
      sheet.AutoFilter = {
        Filters: {
          Count: 1,
          Item: () => ({ On: true, Criteria1: 'A', Criteria2: 'B', Operator: operator }),
        },
      }

      updateFilterStatus(asWs(sheet))

      expect(element.textContent).toContain(`名称(A${expected})`)
    }
  })

  it('读列名失败 → 退回「列N」而不是丢掉整列信息', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    sheet.AutoFilterMode = true
    sheet.Range = () => ({ Value2: '列名' })
    sheet.AutoFilter = {
      Filters: { Count: 1, Item: () => ({ On: true, Criteria1: 'X' }) },
    }
    // 让列名读取失败
    sheet.Range = () => {
      throw new Error('单元格不可读')
    }

    updateFilterStatus(asWs(sheet))

    expect(mocks.handleError).toHaveBeenCalled()
    // 生产行为：列名读取失败时退回「列N」且不带条件括号（colName 为空即丢弃整个括号段）
    expect(element.textContent).toContain('列1')
  })

  it('遍历筛选项时抛错 → 记录后按「无活动筛选」收尾', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    sheet.AutoFilterMode = true
    sheet.AutoFilter = {
      Filters: {
        Count: 1,
        Item: () => {
          throw new Error('筛选项不可访问')
        },
      },
    }

    updateFilterStatus(asWs(sheet))

    expect(mocks.handleError).toHaveBeenCalled()
    expect(element.textContent).toBe('筛选已开启但无活动筛选，同步全部数据')
  })

  it('外层探测抛错 → 在状态栏写明检测失败', () => {
    const element = mountDiv('filterStatus')
    const sheet = makeSheet('动画', {})
    sheet.AutoFilterMode = true
    Object.defineProperty(sheet, 'AutoFilter', {
      get() {
        throw new Error('桥接对象失效')
      },
    })
    // AutoFilterMode=true 时走外层 try，AutoFilter getter 在 try 内抛错 → 外层 catch 写明失败原因
    updateFilterStatus(asWs(sheet))

    expect(element.textContent).toBe('检测筛选状态失败: 桥接对象失效')
  })
})

// ========== refreshData ==========

describe('panel-lifecycle · refreshData', () => {
  it('未选择工作表 → 提示先选择', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '0')

    refreshData()

    expect(box.innerHTML).toContain('请先选择工作表')
  })

  it('拿不到工作簿 → 提示未连接到 Excel', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')

    refreshData()

    expect(box.innerHTML).toContain('未连接到 Excel')
  })

  it('取工作表失败 → 提示无法获取并记录', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '9')
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: makeWorkbook('BGM.xlsx', [makeSheet('动画')]),
    })

    refreshData()

    expect(box.innerHTML).toContain('无法获取工作表')
    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'refreshData' }),
    )
  })

  it('工作表对象不可用（无 Activate）→ 提示无法访问', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const broken = { Name: '坏表' } as unknown as FakeWorksheet
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: makeWorkbook('BGM.xlsx', [broken]),
    })

    refreshData()

    expect(box.innerHTML).toContain('无法访问工作表')
  })

  it('正常渲染预览：表头 + 数据行、统计卡片、并自动锁定工作表', () => {
    const box = mountDiv('previewBox')
    const select = mountSelect('sheetSelect', '1')
    mountButton('lockSheetBtn')
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })

    refreshData()

    expect(box.innerHTML).toContain('<table class="preview-table">')
    expect(box.innerHTML).toContain('名称')
    expect(box.innerHTML).toContain('动画A')
    expect(mocks.clearSheetCache).toHaveBeenCalledWith(sheet)
    expect(mocks.renderStatCards).toHaveBeenCalledTimes(1)
    // 有数据且未锁定 → 自动锁定并提示
    expect(sheetState.isLocked).toBe(true)
    expect(sheetState.lockedIndex).toBe(1)
    expect(select.value).toBe('1')
    expect(mocks.showToast).toHaveBeenCalledWith('已自动锁定工作表: 动画', 'info')
  })

  it('二维批量读取到数据时按起始列切片渲染', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    sheet.Range = () => ({
      Value2: [
        ['1', '动画A', '是', '8'],
        ['2', '动画B', '否', '9'],
      ],
    })
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })

    refreshData()

    expect(box.innerHTML).toContain('动画A')
    expect(box.innerHTML).toContain('动画B')
  })

  it('批量读取抛错 → 回退到逐单元格读取（不丢数据）', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    sheet.Range = () => {
      throw new Error('批量读取失败')
    }
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })

    refreshData()

    expect(box.innerHTML).toContain('动画A')
  })

  it('多列范围却拿到标量返回值时，退回逐单元格读取', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    // WPS 桥接层对某些 Range 会返回标量而不是二维数组，此时 is2D 为假。
    sheet.Range = () => ({ Value2: '动画A' })
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })

    refreshData()

    expect(box.innerHTML).toContain('动画A')
    expect(box.innerHTML).toContain('动画B')
  })

  it('预览收敛到单列且拿到标量返回值时，直接按标量取值', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    // 表头 4 列（1-4），数据行只在第 9 列有值：firstDataCol=9 > headerLastCol=4，
    // previewColStart 被推到 4 → 预览列数 = 4-4+1 = 1，批量读取的 Range 是单格。
    const sheet = makeSheet('动画', {
      '1:1': '序列号',
      '1:2': '名称',
      '1:3': '是否看完',
      '1:4': '打分',
      '2:9': '远处数据',
    })
    const rangeAddresses: string[] = []
    sheet.Range = (address: string) => {
      rangeAddresses.push(address)
      return { Value2: '打分' }
    }
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(2)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2] })

    refreshData()

    // 单格范围 D2:D2，证明预览确实收敛到 1 列、且落进 segLength===1 的单格分支
    expect(rangeAddresses).toEqual(['D2:D2'])
    // 该分支把标量当作这一格的值：渲染出 '打分'
    expect(box.innerHTML).toContain('打分')
  })
  it('可见行跳号时按不连续分段读取（隐藏行不并入段）', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', {
      '1:1': '序列号',
      '1:2': '名称',
      '1:3': '是否看完',
      '1:4': '打分',
      '2:1': '1',
      '2:2': '动画A',
      '2:3': '是',
      '2:4': '8',
      '4:1': '2',
      '4:2': '动画B',
      '4:3': '否',
      '4:4': '9',
    })
    const rangeAddresses: string[] = []
    sheet.Range = (address: string) => {
      rangeAddresses.push(address)
      return {
        Value2: address.startsWith('A2')
          ? [['1', '动画A', '是', '8']]
          : [['2', '动画B', '否', '9']],
      }
    }
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(4)
    // 第 3 行被隐藏：第 2 行与第 4 行不连续，必须拆成两段各读一次
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 4] })

    refreshData()

    expect(rangeAddresses).toEqual(['A2:D2', 'A4:D4'])
    expect(box.innerHTML).toContain('动画A')
    expect(box.innerHTML).toContain('动画B')
  })

  it('无表头时按回退逻辑展示前几行数据', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', { '1:1': '随手记', '2:1': '随便写' })
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(2)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2] })

    refreshData()

    expect(box.innerHTML).toContain('随手记')
    // 无表头 → 统计卡片里「表头行」应显示未识别
    expect(mocks.renderStatCards).toHaveBeenCalledWith(
      document.getElementById('previewStats'),
      expect.arrayContaining([expect.objectContaining({ value: '未识别', tone: 'warning' })]),
    )
  })

  it('无任何数据 → 提示未检测到数据', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('空表', {})
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(0)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [] })

    refreshData()

    expect(box.innerHTML).toContain('未检测到数据')
  })

  it('已锁定时不重复自动锁定，也不会覆盖用户选择', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })
    sheetState.isLocked = true
    sheetState.lockedIndex = 1

    refreshData()

    expect(mocks.saveLockedSheet).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('自动锁定'), 'info')
    expect(box.innerHTML).toContain('动画A')
  })

  it('在锁定状态下完整跑一遍（含恢复活动表）', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '2')
    const active = makeSheet('动画', {})
    const target = makeSheet('漫画', makeTrackedSheetCells())
    const workbook = makeWorkbook('BGM.xlsx', [active, target])
    workbook.ActiveSheet = active
    mocks.getApp.mockReturnValue({ ActiveWorkbook: workbook })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })
    sheetState.isLocked = true
    sheetState.lockedIndex = 2

    refreshData()

    expect(target.Activate).toHaveBeenCalledTimes(1)
    expect(active.Activate).toHaveBeenCalledTimes(1)
    expect(box.innerHTML).toContain('漫画')
  })

  it('锁定到指定工作簿时跨工作簿定位', () => {
    const box = mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const other = makeWorkbook('其他.xlsx', [makeSheet('动画', makeTrackedSheetCells())])
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: makeWorkbook('BGM.xlsx', [makeSheet('无关')]),
    })
    mocks.findWorkbookByName.mockReturnValue(other)
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })
    sheetState.lockedWorkbookName = '其他.xlsx'
    sheetState.isLocked = true
    sheetState.lockedIndex = 1

    refreshData()

    expect(mocks.findWorkbookByName).toHaveBeenCalledWith('其他.xlsx')
    expect(box.innerHTML).toContain('动画A')
  })

  it('筛选开启时统计卡片标注「仅可见行」', () => {
    mountDiv('previewBox')
    // expect.anything() 不匹配 null，须真实挂载统计容器
    mountDiv('previewStats')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: true, visibleRows: [1, 2] })

    refreshData()

    expect(mocks.renderStatCards).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ value: '仅可见行', tone: 'accent' })]),
    )
  })

  it('预置的 BGM.dataPreview 被写成预览读取所需的元信息', () => {
    mountDiv('previewBox')
    mountSelect('sheetSelect', '1')
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet]) })
    mocks.getLastRow.mockReturnValue(3)
    mocks.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [1, 2, 3] })

    refreshData()

    expect(sheetState.dataPreview).toEqual(
      expect.objectContaining({ ws: sheet, headerRow: 1, dataStartRow: 2 }),
    )
  })
})

// ========== onSelectModeChange ==========

/** 挂载一组选择模式单选框（模块级：unicorn/consistent-function-scoping 要求非仅单处使用才可内嵌） */
function mountRadios(selected: 'manual' | 'auto'): void {
  for (const value of ['manual', 'auto']) {
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'selectMode'
    radio.value = value
    radio.checked = value === selected
    document.body.append(radio)
  }
}

describe('panel-lifecycle · onSelectModeChange', () => {
  it('选择「手动」→ 显示手动输入、隐藏自动信息', () => {
    const manual = mountDiv('manualRangeInputs')
    const auto = mountDiv('autoRangeInfo')
    mountRadios('manual')

    onSelectModeChange()

    expect(manual.style.display).toBe('block')
    expect(auto.style.display).toBe('none')
  })

  it('选择「自动」→ 隐藏手动输入、显示自动信息', () => {
    const manual = mountDiv('manualRangeInputs')
    const auto = mountDiv('autoRangeInfo')
    mountRadios('auto')

    onSelectModeChange()

    expect(manual.style.display).toBe('none')
    expect(auto.style.display).toBe('block')
  })

  it('没有选中任何模式 / 面板元素缺失 → 静默', () => {
    expect(() => {
      onSelectModeChange()
    }).not.toThrow()

    mountRadios('auto')
    expect(() => {
      onSelectModeChange()
    }).not.toThrow()
  })
})

// ========== enlargePreview ==========

describe('panel-lifecycle · enlargePreview', () => {
  it('没有预览框 → 提示无可放大内容', () => {
    enlargePreview()
    expect(mocks.showToast).toHaveBeenCalledWith('没有可放大的预览内容', 'info')
  })

  it('预览里还没有表格 → 提示先刷新数据', () => {
    const box = mountDiv('previewBox')
    box.innerHTML = '<p class="hint">请先选择工作表</p>'

    enlargePreview()

    expect(mocks.showToast).toHaveBeenCalledWith('请先刷新数据加载预览', 'info')
    expect(document.querySelector('.enlarge-preview-modal')).toBeNull()
  })

  it('正常放大 → 生成带对话框语义的模态框并拷贝预览内容', () => {
    const box = mountDiv('previewBox')
    box.innerHTML = '<table class="preview-table"><tbody><tr><td>A</td></tr></tbody></table>'

    enlargePreview()

    const modal = document.querySelector('.enlarge-preview-modal')
    expect(modal).not.toBeNull()
    expect(modal?.getAttribute('role')).toBe('dialog')
    expect(modal?.getAttribute('aria-modal')).toBe('true')
    expect(modal?.innerHTML).toContain('数据预览（放大）')
    expect((modal as HTMLElement).style.display).toBe('flex')
  })

  it('点关闭按钮 → 移除模态框', () => {
    const box = mountDiv('previewBox')
    box.innerHTML = '<table></table>'
    enlargePreview()

    const closeButton = document.querySelector('.enlarge-close-btn')
    if (!closeButton) throw new Error('缺少关闭按钮')
    closeButton.dispatchEvent(new Event('click'))

    expect(document.querySelector('.enlarge-preview-modal')).toBeNull()
  })

  it('按 Esc → 移除模态框', () => {
    const box = mountDiv('previewBox')
    box.innerHTML = '<table></table>'
    enlargePreview()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(document.querySelector('.enlarge-preview-modal')).toBeNull()
  })

  it('按其他键不会关闭', () => {
    const box = mountDiv('previewBox')
    box.innerHTML = '<table></table>'
    enlargePreview()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))

    expect(document.querySelector('.enlarge-preview-modal')).not.toBeNull()
  })

  it('点击模态框背景 → 关闭', () => {
    const box = mountDiv('previewBox')
    box.innerHTML = '<table></table>'
    enlargePreview()

    const modal = document.querySelector('.enlarge-preview-modal')
    modal?.dispatchEvent(new Event('click'))

    expect(document.querySelector('.enlarge-preview-modal')).toBeNull()
  })

  it('重复放大 → 先移除上一个模态框（不叠加）', () => {
    const box = mountDiv('previewBox')
    box.innerHTML = '<table></table>'

    enlargePreview()
    enlargePreview()

    expect(document.querySelectorAll('.enlarge-preview-modal')).toHaveLength(1)
  })
})

// ========== autoDetectAndLockSheet ==========

describe('panel-lifecycle · autoDetectAndLockSheet', () => {
  it('未检测到追踪表 → 返回 false 且不改动锁定状态', () => {
    expect(autoDetectAndLockSheet()).toBe(false)
    expect(sheetState.isLocked).toBe(false)
    expect(mocks.saveLockedSheet).not.toHaveBeenCalled()
  })

  it('检测成功 → 写锁定状态、同步下拉框并提示', () => {
    const workbookSelect = mountSelect('workbookSelect')
    // 生产会执行 wbSelect.value = detected.workbookName，jsdom 需要匹配的 option 才能落住
    const bgmOption = document.createElement('option')
    bgmOption.value = 'BGM.xlsx'
    workbookSelect.append(bgmOption)
    const sheetSelect = mountSelect('sheetSelect')
    mountButton('lockSheetBtn')
    mocks.findBangumiTargetSheets.mockReturnValue([
      {
        workbookName: 'BGM.xlsx',
        sheetIndex: 2,
        sheetName: '动画',
        headerRow: 1,
        headerMatchCount: 4,
        dataRowCount: 10,
      },
    ])
    const sheet = makeSheet('动画', makeTrackedSheetCells())
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [sheet, sheet]) })

    expect(autoDetectAndLockSheet()).toBe(true)

    expect(workbookSelect.value).toBe('BGM.xlsx')
    expect(sheetSelect.value).toBe('2')
    expect(sheetState.isLocked).toBe(true)
    expect(sheetState.lockedIndex).toBe(2)
    expect(sheetState.lockedName).toBe('动画')
    expect(sheetState.lockedWorkbookName).toBe('BGM.xlsx')
    expect(mocks.saveLockedSheet).toHaveBeenCalledWith({
      index: 2,
      name: '动画',
      workbookName: 'BGM.xlsx',
    })
    expect(mocks.showToast).toHaveBeenCalledWith('已自动检测表头: 动画', 'info')
  })

  it('检测结果没有工作簿名 → 不写空的工作簿字段', () => {
    mountButton('lockSheetBtn')
    mocks.findBangumiTargetSheets.mockReturnValue([
      {
        workbookName: '',
        sheetIndex: 1,
        sheetName: '动画',
        headerRow: 1,
        headerMatchCount: 3,
        dataRowCount: 5,
      },
    ])
    mocks.getApp.mockReturnValue({ ActiveWorkbook: makeWorkbook('BGM.xlsx', [makeSheet('动画')]) })

    autoDetectAndLockSheet()

    expect(sheetState.lockedWorkbookName).toBeNull()
    expect(mocks.saveLockedSheet).toHaveBeenCalledWith({ index: 1, name: '动画' })
  })
})
