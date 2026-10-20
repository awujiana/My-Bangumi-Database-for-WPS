import { describe, it, expect, beforeEach, vi } from 'vitest'

function columnToLetter(column: number): string {
  let result = ''
  let n = column
  while (n > 0) {
    const remainder = (n - 1) % 26
    result = String.fromCodePoint(65 + remainder) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

const { PANEL_CONFIG, HEADER_KEYWORDS, COLUMN_RULES, STANDARD_HEADERS, columnNumberToLetter } =
  vi.hoisted(() => {
    const panelConfig = { MAX_SCAN_ROWS: 50, MAX_SCAN_COLUMNS: 10 }
    const headerKeywords = [
      '名称',
      '标题',
      'bangumi',
      'url',
      'sid',
      '编号',
      '序号',
      'name',
      'title',
    ]
    const columnRules: readonly (readonly [RegExp, string])[] = [
      [/序列号|序号|编号/i, '序列号'],
      [/名称|标题|作品名/i, '名称'],
      [/bangumi.*url|url|链接|地址/i, 'Bangumi_URL'],
      [/类型/i, '类型'],
      [/状态|是否看完/i, '状态'],
      [/评分/i, '评分'],
      [/标签/i, '标签'],
    ] as const
    const standardHeaders = [
      '序列号',
      '名称',
      'Bangumi URL',
      '类型',
      '状态',
      '评分',
      '标签',
      '开播日期',
      '完播日',
      '集数',
    ]
    return {
      PANEL_CONFIG: panelConfig,
      HEADER_KEYWORDS: headerKeywords,
      COLUMN_RULES: columnRules,
      STANDARD_HEADERS: standardHeaders,
      columnNumberToLetter: columnToLetter,
    }
  })

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  PANEL_CONFIG,
  HEADER_KEYWORDS,
  COLUMN_RULES,
  STANDARD_HEADERS,
}))

vi.mock('../ts/tools/string-utilities.js', () => ({
  columnNumberToLetter,
  trim: (s: string) => s.trim(),
}))

vi.mock('../ts/tools/util/cell.js', () => ({
  getCellValue: vi.fn().mockReturnValue(''),
  getCell: vi.fn().mockReturnValue(null),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  getApp: vi.fn(),
  bgmLog: vi.fn(),
  BGM: {
    handleError: vi.fn(),
    sheet: { isLocked: false, lockedIndex: 0, lockedWorkbookName: '' },
  },
}))

import {
  readRangeValues,
  readRowsCache,
  createSheetCellCache,
  readRangeCellValues,
  cacheGet,
  clearSheetCache,
  getLastRow,
  isEmptyValue,
  getDataSheet,
  safeActivate,
  findHeaderRow,
  getColumnMap,
  ensureSheetHeaders,
} from '../ts/tools/util/sheet.js'
import { getApp, bgmLog, BGM } from '../ts/tools/util/index.js'
import { getCellValue } from '../ts/tools/util/cell.js'
import type { WpsApp, WpsCells, WpsRange, WpsWorkbook, WpsWorksheet } from '../ts/tools/wps.js'

/**
 * 测试用工作表 mock 的类型。
 *
 * 存在的理由（见 文档/TS_AUDIT_2026_09_10.md 的 P1-2）：
 * 测试只需要实现被测代码实际访问到的成员，不可能（也不必）逐字复刻整个 WPS 接口；
 * 但**调用点**必须是强类型的，否则 mock 与真实接口脱节不会被发现。
 * 于是把「形状不完整」这一点收敛到本类型 + 工厂里的一次 `as unknown as`：
 *   - 返回类型仍可赋给 `WpsWorksheet`（`Mock<T>` 携带 `T` 的调用签名）；
 *   - `Range` 保留 Mock（便于 `mockReturnValue` 与断言）。
 */
type MockWorksheet = Omit<WpsWorksheet, 'Range' | 'Cells'> & {
  Range: RangeMock
  Cells: Omit<WpsCells, 'Item'> & { Item: CellItemMock }
}

/**
 * 测试用 Range mock。
 *
 * 这里用自定义接口而不是 `Mock<(address: string) => WpsRange>`：
 * 桩只实现被测路径访问到的成员，而 `Mock<T>` 会强制 `mockReturnValue` 收下完整的
 * `WpsRange`，于是每个用例都要写一次 `as unknown as`。自定义接口把
 * 「返回值可以是任意桩」这一点显式化，同时保留调用签名 `(address) => WpsRange`，
 * 因此整体仍可赋给 `WpsWorksheet`（赋给真实接口时依然享受类型检查）。
 */
interface RangeMock {
  (address: string): WpsRange
  mockReturnValue(value: unknown): RangeMock
}

/** 构造 Range mock；`implementation` 省略时用 `mockReturnValue` 驱动 */
function createRangeMock(implementation?: (address: string) => unknown): RangeMock {
  return vi.fn(implementation) as unknown as RangeMock
}

/** 测试用 `Cells.Item` mock（理由同 RangeMock） */
interface CellItemMock {
  (row: number, column: number): WpsRange
  mockReturnValue(value: unknown): CellItemMock
}

/** 构造 `Cells.Item` mock */
function createCellItemMock(implementation?: () => unknown): CellItemMock {
  return vi.fn(implementation) as unknown as CellItemMock
}

/**
 * 构造工作簿桩。
 *
 * `WpsWorkbook` 有 5 个必需成员（Name/FullName/Worksheets/Sheets/ActiveSheet），
 * 而测试通常只关心 `ActiveSheet`；这里补齐骨架后按需覆盖，避免每个用例手写样板。
 */
function createMockWorkbook(overrides: Partial<WpsWorkbook> = {}): WpsWorkbook {
  return {
    Name: 'Book1',
    FullName: 'C:/Book1.xlsx',
    Worksheets: { Count: 1, Item: vi.fn() },
    Sheets: { Count: 1, Item: vi.fn(), Add: vi.fn() },
    ActiveSheet: createMockWorksheet(),
    ...overrides,
  }
}

/**
 * 构造 `getApp()` 返回值桩。
 *
 * 参数类型用 `Partial<WpsApp>` 而非 `Record<string, unknown>`：字面量仍按真实接口
 * 逐成员校验（写错 `Workbooks` 的形状会被抓出来），只是允许省略不关心的成员。
 */
function createMockApp(overrides: Partial<WpsApp>): WpsApp {
  // WpsApp 的成员全部可选，Partial<WpsApp> 与 WpsApp 同构，无需断言
  return overrides
}

function createMockCell(value: unknown = '') {
  let text: string
  if (value == null) {
    text = ''
  } else if (typeof value === 'object') {
    // JSON.stringify 对含 toJSON 且返回 undefined 的对象会返回 undefined，需保留兜底
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- 运行时 JSON.stringify 可能返回 undefined
    text = JSON.stringify(value) ?? ''
  } else {
    // 排除 object 后剩余为原始类型/函数，String() 转换与原来一致
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- 原实现即 String(value)，保持等价语义
    text = String(value)
  }
  return {
    Value2: value,
    Value: value,
    Text: text,
    Interior: { Color: 0 },
    Font: { Bold: false, Name: '' },
  }
}

function createMockWorksheet(
  options: {
    name?: string
    rows?: number
    cellValues?: Record<string, unknown>
    cellOverrides?: Record<string, Record<string, unknown>>
    usedRange?: { Row: number; Rows: { Count: number } }

    // eslint-disable-next-line unicorn/no-unused-properties -- 预留测试选项，当前用例未使用
    hasEnd?: boolean
    endRow?: number
  } = {},
): MockWorksheet {
  const name = options.name ?? 'Sheet1'
  const rows = options.rows ?? 100
  const cellValues = options.cellValues ?? {}
  const cellOverrides = options.cellOverrides ?? {}

  const mockCell = (address: string): ReturnType<typeof createMockCell> => {
    if (Object.hasOwn(cellOverrides, address)) {
      return createMockCell(cellOverrides[address])
    }
    if (Object.hasOwn(cellValues, address)) {
      return createMockCell(cellValues[address])
    }
    return createMockCell('')
  }

  return {
    Name: name,
    Rows: { Count: rows },
    UsedRange: options.usedRange ?? { Row: 1, Rows: { Count: 10 } },
    Range: vi.fn((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
      }
      return mockCell(address)
    }),
    Activate: vi.fn(),
    Cells: { Item: vi.fn((_r: number, _c: number) => createMockCell('')) },
    // End mock for getLastRow
    _endRow: options.endRow ?? 0,
    // 单点类型逃逸：mock 只实现被测路径访问到的成员（详见 MockWorksheet 的说明）
  } as unknown as MockWorksheet
}

describe('readRangeValues', () => {
  it('应在 worksheet 为 null 时返回空数组', () => {
    expect(readRangeValues(null, 1, 5, 1, 3)).toEqual([])
  })

  it('应在 worksheet 为 undefined 时返回空数组', () => {
    expect(readRangeValues(undefined, 1, 5, 1, 3)).toEqual([])
  })

  it('应读取单个值', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = { Value2: 'single', Interior: { Color: 0 } }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 1)
    expect(result).toEqual([['single']])
  })

  it('Value2 为 null 时返回空数组', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = { Value2: null, Interior: { Color: 0 } }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 5, 1, 3)
    expect(result).toEqual([])
  })

  it('Value2 为 undefined 时返回空数组', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = { Value2: undefined, Interior: { Color: 0 } }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 5, 1, 3)
    expect(result).toEqual([])
  })

  it('应处理多值二维数组', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = {
      Value2: [
        ['a1', 'b1', 'c1'],
        ['a2', 'b2', 'c2'],
      ],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 2, 1, 3)
    expect(result).toEqual([
      ['a1', 'b1', 'c1'],
      ['a2', 'b2', 'c2'],
    ])
  })

  it('应处理非数组行（单值行）', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = {
      Value2: ['single_val', 'another_val'],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 2, 1, 1)
    expect(result).toEqual([['single_val'], ['another_val']])
  })

  it('单行多列：宿主返回一维数组时必须读成「1 行 N 列」而非「N 行 1 列」', () => {
    // WPS 对单行范围返回一维数组；旧实现逐标量 push([v]) 会读成 3 行 1 列，
    // 整行读-改-写时只拿得到第 1 个单元格，写回后 2..N 列被空值填满（静默清数据）。
    const worksheet = createMockWorksheet()
    const rangeMock = {
      Value2: ['a1', 'b1', 'c1'],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 3)
    expect(result).toEqual([['a1', 'b1', 'c1']])
  })

  it('请求多行多列却读回一维（形状不可信）时返回空数组，绝不猜形状', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = {
      Value2: ['a1', 'b1', 'c1'],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    expect(readRangeValues(worksheet, 1, 2, 1, 3)).toEqual([])
  })

  it('应在异常时返回空数组', () => {
    const worksheet = {
      ...createMockWorksheet(),
      Range: vi.fn(() => {
        throw new Error('fail')
      }),
    }
    expect(readRangeValues(worksheet, 1, 5, 1, 3)).toEqual([])
  })

  it('应处理 safeCellValue 的 null 值', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = {
      Value2: [[null, 'valid']],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 2)
    expect(result).toEqual([['', 'valid']])
  })
})

/** 造一个按请求范围返回二维 Value2 的工作表桩（readRowsCache 用例共用） */
function createGridWs(grid: string[][]): ReturnType<typeof createMockWorksheet> {
  const worksheet = createMockWorksheet()
  worksheet.Range = createRangeMock((address: string) => {
    const parts = address.split(':', 2)
    const start = parts[0] ?? ''
    const end = parts[1] ?? start
    const startRow = Number(start.slice(1))
    const endRow = Number(end.slice(1))
    return {
      Value2: grid.slice(startRow - 1, endRow),
      Interior: { Color: 0 },
      Font: { Bold: false },
    }
  })
  return worksheet
}

describe('readRowsCache', () => {
  it('行号为空 / maxCol < 1 时返回空 Map（不发起 COM 读）', () => {
    const worksheet = createMockWorksheet()
    expect(readRowsCache(worksheet, [], 3)).toEqual(new Map())
    expect(readRowsCache(worksheet, [2], 0)).toEqual(new Map())
  })

  it('应为离散行号建缓存：一次矩形读覆盖 1..maxCol', () => {
    const worksheet = createGridWs([
      ['r1c1', 'r1c2'],
      ['r2c1', 'r2c2'],
      ['r3c1', 'r3c2'],
      ['r4c1', 'r4c2'],
    ])
    const cache = readRowsCache(worksheet, [4, 2], 2)
    expect(cache).not.toBeNull()
    expect(cache?.get(2)).toEqual(['r2c1', 'r2c2'])
    expect(cache?.get(4)).toEqual(['r4c1', 'r4c2'])
    expect(cache?.has(3)).toBe(false)
  })

  it('读回行数不足时返回 null（形状不可信，调用方须回退逐格读）', () => {
    const worksheet = createGridWs([['r1c1', 'r1c2']])
    expect(readRowsCache(worksheet, [1, 2], 2)).toBeNull()
  })

  it('读回列宽不足时返回 null', () => {
    const worksheet = createGridWs([['r1c1'], ['r2c1']])
    expect(readRowsCache(worksheet, [1, 2], 2)).toBeNull()
  })

  it('首行缺失（minRow 起点偏移）时返回 null', () => {
    const worksheet = createGridWs([['r1c1', 'r1c2']])
    // 请求 2..3 行，只有 1 行数据 → block[1] 为 undefined
    expect(readRowsCache(worksheet, [3], 2)).toBeNull()
  })

  it('worksheet 为空时返回 null（readRangeValues 返回空 ⇒ 行数不足）', () => {
    expect(readRowsCache(null, [1, 2], 2)).toBeNull()
    expect(readRowsCache(undefined, [1, 2], 2)).toBeNull()
  })
})

/** 造一个「内存单元格 + 计数」的后备 IO（验证缓存是否真的拦下了读写） */
function makeIo(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  const stats = { reads: 0, writes: 0 }
  return {
    stats,
    io: {
      read: (_ws: unknown, row: number, column: number): string => {
        stats.reads += 1
        return store.get(`${String(row)}:${String(column)}`) ?? ''
      },
      write: (_ws: unknown, row: number, column: number, value: string): void => {
        stats.writes += 1
        store.set(`${String(row)}:${String(column)}`, value)
      },
    },
    store,
  }
}

describe('createSheetCellCache', () => {
  it('写穿透：write 之后 read 拿到的是新值（而非写前旧值）', () => {
    const { io, store } = makeIo({ '2:3': '旧标签' })
    const cache = createSheetCellCache(createMockWorksheet(), [2], 3, io)

    expect(cache.read(2, 3)).toBe('旧标签')
    cache.write(2, 3, '旧标签 | 新标签')
    // 关键断言：写后读必须拿到新值——只读缓存在这里会返回写前旧值导致合并出错
    expect(cache.read(2, 3)).toBe('旧标签 | 新标签')
    expect(store.get('2:3')).toBe('旧标签 | 新标签')
  })

  it('write 先走后备 IO（COM 写真实发生），成功后更新缓存', () => {
    const { io, stats } = makeIo()
    const cache = createSheetCellCache(createMockWorksheet(), [2], 3, io)

    cache.write(5, 1, '值')
    expect(stats.writes).toBe(1)
    // 缓存已更新：后续读不再打后备 IO
    const before = stats.reads
    expect(cache.read(5, 1)).toBe('值')
    expect(stats.reads).toBe(before)
  })

  it('后备 IO 读抛错时不回填缓存（异常直接透出，不缓存坏值）', () => {
    const cache = createSheetCellCache(createMockWorksheet(), [2], 3, {
      read: (): string => {
        throw new Error('COM 炸了')
      },
      write: (): void => {},
    })
    expect(() => cache.read(2, 3)).toThrow('COM 炸了')
  })

  it('矩形读播种成功：读命中缓存，零次后备 IO；未播种的行列才回落', () => {
    const worksheet = createGridWs([
      ['a1', 'b1'],
      ['a2', 'b2'],
    ])
    const { io, stats } = makeIo()
    const cache = createSheetCellCache(worksheet, [1, 2], 2, io)

    expect(cache.read(1, 1)).toBe('a1')
    expect(cache.read(2, 2)).toBe('b2')
    // 全部命中播种，没有一次逐格读
    expect(stats.reads).toBe(0)
    // 未播种的行 / 超出 maxCol 的列：回落后备 IO 并回填
    expect(cache.read(9, 9)).toBe('')
    expect(stats.reads).toBe(1)
    // 第二次命中回填
    expect(cache.read(9, 9)).toBe('')
    expect(stats.reads).toBe(1)
  })

  it('播种失败（形状不符）时读写全部回落，行为与不建缓存一致', () => {
    // 列宽不足 → readRowsCache 返回 null
    const worksheet = createGridWs([['only-one-column']])
    const { io, stats } = makeIo({ '1:1': 'fallback' })
    const cache = createSheetCellCache(worksheet, [1], 2, io)

    expect(cache.read(1, 1)).toBe('fallback')
    expect(stats.reads).toBe(1)
    cache.write(1, 1, 'x')
    expect(stats.writes).toBe(1)
  })
})

describe('isEmptyValue', () => {
  it('应识别 null/undefined', () => {
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
  })

  it('应识别空字符串', () => {
    expect(isEmptyValue('')).toBe(true)
  })

  it('应识别字符串 null/undefined', () => {
    expect(isEmptyValue('null')).toBe(true)
    expect(isEmptyValue('NULL')).toBe(true)
    expect(isEmptyValue('Null')).toBe(true)
    expect(isEmptyValue('undefined')).toBe(true)
  })

  it('应将非空值识别为非空', () => {
    expect(isEmptyValue('hello')).toBe(false)
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue('0')).toBe(false)
  })
})

describe('getDataSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BGM.sheet.isLocked = false
    BGM.sheet.lockedIndex = 0
    BGM.sheet.lockedWorkbookName = ''
  })

  it('应在无 Application 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue(null)
    expect(getDataSheet()).toBeNull()
  })

  it('应在无 ActiveWorkbook 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue({})
    expect(getDataSheet()).toBeNull()
  })

  it('应返回 ActiveSheet', () => {
    const mockSheet = createMockWorksheet({ name: 'Data' })
    vi.mocked(getApp).mockReturnValue(
      createMockApp({ ActiveWorkbook: createMockWorkbook({ ActiveSheet: mockSheet }) }),
    )
    expect(getDataSheet()).toBe(mockSheet)
  })

  it('锁定模式下应返回锁定的工作表', () => {
    const lockedSheet = createMockWorksheet({ name: 'Locked' })
    const itemFunction = vi.fn().mockReturnValue(lockedSheet)
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        ActiveWorkbook: createMockWorkbook({
          ActiveSheet: createMockWorksheet({ name: 'Active' }),
          Worksheets: { Count: 1, Item: itemFunction },
        }),
      }),
    )
    BGM.sheet.isLocked = true
    BGM.sheet.lockedIndex = 2
    getDataSheet()
    expect(itemFunction).toHaveBeenCalledWith(2)
  })

  it('锁定模式下应查找指定工作簿', () => {
    const targetWb = createMockWorkbook({
      Name: 'TargetWb',
      Worksheets: {
        Count: 1,
        Item: vi.fn().mockReturnValue(createMockWorksheet({ name: 'TargetSheet' })),
      },
    })
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        ActiveWorkbook: createMockWorkbook({
          ActiveSheet: createMockWorksheet({ name: 'Active' }),
          Worksheets: { Count: 1, Item: vi.fn() },
        }),
        Workbooks: {
          Count: 2,
          Item: vi.fn((index: number) =>
            index === 2 ? targetWb : createMockWorkbook({ Name: 'OtherWb' }),
          ),
        },
      }),
    )
    BGM.sheet.isLocked = true
    BGM.sheet.lockedIndex = 1
    BGM.sheet.lockedWorkbookName = 'TargetWb'
    const result = getDataSheet()
    expect(result).toBeDefined()
  })

  it('锁定模式查找失败时应回退到 ActiveSheet', () => {
    const activeSheet = createMockWorksheet({ name: 'Active' })
    vi.mocked(getApp).mockReturnValue(
      createMockApp({ ActiveWorkbook: createMockWorkbook({ ActiveSheet: activeSheet }) }),
    )
    BGM.sheet.isLocked = true
    // will fail
    BGM.sheet.lockedIndex = 10
    const _mockErrorWs = {
      ...createMockWorksheet(),
      Worksheets: {
        Count: 1,
        Item: vi.fn(() => {
          throw new Error('not found')
        }),
      },
    }
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        ActiveWorkbook: createMockWorkbook({
          ActiveSheet: activeSheet,
          Worksheets: {
            Count: 1,
            Item: vi.fn(() => {
              throw new Error('not found')
            }),
          },
        }),
      }),
    )
    const result = getDataSheet()
    expect(result).toBe(activeSheet)
  })
})

describe('safeActivate', () => {
  it('应调用 Activate 方法', () => {
    const worksheet = createMockWorksheet()
    safeActivate(worksheet)
    expect(worksheet.Activate).toHaveBeenCalled()
  })

  it('应在 worksheet 为 null 时不报错', () => {
    expect(() => safeActivate(null)).not.toThrow()
  })

  it('应在 worksheet 为 undefined 时不报错', () => {
    expect(() => safeActivate(undefined)).not.toThrow()
  })

  it('Activate 不是函数时应记录警告', () => {
    // 故意构造畸形 sheet（Activate 不是函数）以验证 safeActivate 的降级：
    // 这里的 `as unknown as WpsWorksheet` 是刻意的——现实的畸形对象本就违反接口
    const worksheet = { ...createMockWorksheet(), Activate: undefined } as unknown as WpsWorksheet
    safeActivate(worksheet)
    expect(bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('safeActivate'))
  })
})

describe('getLastRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSheetCache(createMockWorksheet({ name: 'Test' }))
    clearSheetCache(createMockWorksheet({ name: 'AnchorTest' }))
  })

  it('应在 worksheet 为 null 时返回默认值 50000', () => {
    const result = getLastRow(null)
    expect(result).toBe(50_000)
  })

  it('应在 worksheet 为 undefined 时返回默认值 50000', () => {
    const result = getLastRow(undefined)
    expect(result).toBe(50_000)
  })

  it('D 列 End 成功时返回正确行号', () => {
    const worksheet = createMockWorksheet({
      name: 'Test',
      rows: 100,
      cellOverrides: {
        D100: { Value2: 'data', Value: 'data', Text: 'data', _endRow: 50 },
      },
    })
    // Mock Range to return cell with End method
    const mockCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 50 }),
    }
    worksheet.Range = createRangeMock(() => mockCell)
    const result = getLastRow(worksheet)
    expect(result).toBe(50)
  })

  it('D 列失败时回退到 A 列', () => {
    const worksheet = createMockWorksheet({
      name: 'Test',
      rows: 100,
    })
    const dCell = {
      Value2: '',
      Value: '',
      Text: '',
      End: vi.fn(() => {
        throw new Error('D列失败')
      }),
    }
    const aCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 30 }),
    }
    worksheet.Range = createRangeMock((addr: string) => (addr.startsWith('D') ? dCell : aCell))
    const result = getLastRow(worksheet)
    expect(result).toBe(30)
  })

  it('所有列失败时使用 UsedRange 兜底', () => {
    const worksheet = createMockWorksheet({
      name: 'Test',
      rows: 100,
      usedRange: { Row: 1, Rows: { Count: 25 } },
    })
    const failCell = {
      Value2: '',
      Value: '',
      Text: '',
      End: vi.fn(() => {
        throw new Error('fail')
      }),
    }
    worksheet.Range = createRangeMock(() => failCell)
    const result = getLastRow(worksheet)
    expect(result).toBe(25)
  })

  it('应使用 UsedRange 作为兜底', () => {
    const worksheet = createMockWorksheet({
      name: 'Test',
      usedRange: { Row: 5, Rows: { Count: 25 } },
    })
    const result = getLastRow(worksheet)
    // Row + Count - 1 = 5 + 25 - 1 = 29
    expect(result).toBe(29)
  })

  it('UsedRange 失败时返回默认 50000', () => {
    // 故意去掉 UsedRange 以验证兜底路径（exactOptionalPropertyTypes 下不能写 undefined）
    const worksheet = {
      ...createMockWorksheet({ name: 'Test' }),
      UsedRange: undefined,
    } as unknown as WpsWorksheet
    const failCell = {
      Value2: '',
      Value: '',
      Text: '',
      End: vi.fn(() => {
        throw new Error('fail')
      }),
    }
    worksheet.Range = createRangeMock(() => failCell)
    const result = getLastRow(worksheet)
    expect(result).toBe(50_000)
  })

  it('forceRefresh 为 true 时应清除缓存', () => {
    const worksheet = createMockWorksheet({ name: 'RefreshTest' })
    getLastRow(worksheet, true)
    const result2 = getLastRow(worksheet, true)
    expect(result2).toBeDefined()
  })

  it('有 headerRow 参数时应尝试锚定列查找', () => {
    const worksheet = createMockWorksheet({
      name: 'AnchorTest',
      rows: 100,
      cellOverrides: {
        A1: { Value2: '序列号', Value: '序列号', Text: '序列号' },
      },
    })
    const anchorCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 40 }),
    }
    worksheet.Range = createRangeMock(() => anchorCell)
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, column: unknown) =>
      column === 1 ? '序列号' : '',
    )
    const result = getLastRow(worksheet, false, 1)
    expect(result).toBeDefined()
  })
})

describe('findHeaderRow', () => {
  beforeEach(() => {
    vi.mocked(getCellValue).mockReset()
    clearSheetCache(createMockWorksheet({ name: 'EmptySheet' }))
  })

  it('应在未找到关键字时返回 0', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const worksheet = createMockWorksheet({ name: 'Empty' })
    const result = findHeaderRow(worksheet)
    expect(result).toBe(0)
  })

  it('应在找到多个关键字时返回行号', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, column: unknown) => {
      const r = row as number
      const c = column as number
      if (r === 1) {
        if (c === 1) return '名称'
        if (c === 2) return '标题'
        if (c === 3) return 'Bangumi URL'
        if (c === 4) return '类型'
      }
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'Found' })
    const result = findHeaderRow(worksheet)
    expect(result).toBe(1)
  })

  it('应使用缓存加速重复调用', () => {
    const callCount = { count: 0 }
    vi.mocked(getCellValue).mockImplementation(() => {
      callCount.count += 1
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'CacheTest' })
    findHeaderRow(worksheet)
    findHeaderRow(worksheet)
    // 第二次调用应使用缓存
    expect(callCount.count).toBeGreaterThan(0)
  })

  it('startRow 参数应从指定行开始扫描', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, column: unknown) => {
      const r = row as number
      const c = column as number
      if (r === 3) {
        if (c === 1) return '名称'
        if (c === 2) return '标题'
        if (c === 3) return 'URL'
      }
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'StartRow' })
    const result = findHeaderRow(worksheet, 3)
    expect(result).toBe(3)
  })
})

describe('getColumnMap', () => {
  beforeEach(() => {
    vi.mocked(getCellValue).mockReset()
    clearSheetCache(createMockWorksheet({ name: 'MapTest' }))
    clearSheetCache(createMockWorksheet({ name: 'FallbackTest' }))
    clearSheetCache(createMockWorksheet({ name: 'Fallback2' }))
    clearSheetCache(createMockWorksheet({ name: 'Empty' }))
    clearSheetCache(createMockWorksheet({ name: 'CacheMap' }))
  })

  it('应建立列映射', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, column: unknown) => {
      const c = column as number
      if (c === 1) return '序列号'
      if (c === 2) return '名称'
      if (c === 3) return 'Bangumi URL'
      if (c === 4) return '类型'
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'MapTest' })
    const map = getColumnMap(worksheet, 1)
    expect(map.get('序列号')).toBe(1)
    expect(map.get('名称')).toBe(2)
    expect(map.get('Bangumi_URL')).toBe(3)
    expect(map.get('类型')).toBe(4)
  })

  it('序列号列回退：第一个非空列未被占用时使用', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, column: unknown) => {
      const c = column as number
      // 非标准序列号名，但非空
      if (c === 1) return '自定义ID'
      if (c === 2) return '名称'
      if (c === 3) return 'Bangumi URL'
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'FallbackTest' })
    const map = getColumnMap(worksheet, 1)
    // 序列号应回退到第一个非空列（列1）
    expect(map.get('序列号')).toBe(1)
  })

  it('序列号列回退：第一个非空列被占用时使用下一个未被占用的列', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, column: unknown) => {
      const c = column as number
      // 第一个非空列已被'名称'映射占用
      if (c === 1) return '名称'
      // 不匹配任何规则，成为序列号回退候选
      if (c === 2) return '标题'
      if (c === 3) return 'Bangumi URL'
      if (c === 4) return '自定义字段'
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'Fallback2' })
    const map = getColumnMap(worksheet, 1)
    // 序列号应回退到第一个未被占用的非空列（列2 - "标题"不匹配任何规则）
    expect(map.get('序列号')).toBe(2)
  })

  it('空工作表应返回空 Map', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const worksheet = createMockWorksheet({ name: 'Empty' })
    const map = getColumnMap(worksheet, 1)
    expect(map.size).toBe(0)
  })

  it('应缓存列映射结果', () => {
    const callCount = { count: 0 }
    vi.mocked(getCellValue).mockImplementation(() => {
      callCount.count += 1
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'CacheMap' })
    getColumnMap(worksheet, 1)
    getColumnMap(worksheet, 1)
    // 第二次调用应使用缓存
    expect(callCount.count).toBeGreaterThan(0)
  })
})

describe('cacheGet / clearSheetCache', () => {
  it('应在首次调用时执行 factory', () => {
    let called = 0
    const result = cacheGet('test-key', () => {
      called += 1
      return 'value'
    })
    expect(result).toBe('value')
    expect(called).toBe(1)
  })

  it('应在后续调用时返回缓存值', () => {
    let called = 0
    cacheGet('cache-key', () => {
      called += 1
      return 42
    })
    cacheGet('cache-key', () => {
      called += 1
      return 99
    })
    expect(called).toBe(1)
  })

  it('清除缓存后应重新执行 factory', () => {
    let called = 0
    cacheGet('clear-test', () => {
      called += 1
      return 1
    })
    cacheGet('clear-test', () => {
      called += 1
      return 2
    })
    const worksheet = createMockWorksheet({ name: 'clear-test' })
    clearSheetCache(worksheet)
    cacheGet('clear-test', () => {
      called += 1
      return 3
    })
    expect(called).toBe(2)
  })

  it('不同 key 应独立缓存', () => {
    let aCalled = 0
    let bCalled = 0
    cacheGet('key-a', () => {
      aCalled += 1
      return 'a'
    })
    cacheGet('key-b', () => {
      bCalled += 1
      return 'b'
    })
    expect(aCalled).toBe(1)
    expect(bCalled).toBe(1)
    // 再次获取应命中缓存
    cacheGet('key-a', () => {
      aCalled += 1
      return 'a-new'
    })
    // 未增加
    expect(aCalled).toBe(1)
  })

  it('清除不存在的 key 不应报错', () => {
    const worksheet = createMockWorksheet({ name: 'nonexistent' })
    expect(() => clearSheetCache(worksheet)).not.toThrow()
  })
})

/**
 * 带用户数据的首行（宽度 = HEADER_SCAN_COLUMNS = 64）
 *
 * 真实 COM 对 A1:BL1 一定返回 64 个单元格；此前桩只给 2 列，
 * 会被「单行读回宽度不足 = 读失败」守卫判为读不全（桩不忠实，改桩不改守卫）。
 */
function firstRowWithUserData(): string[] {
  return ['用户数据A', '用户数据B', ...Array.from({ length: 62 }, () => '')]
}

describe('ensureSheetHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSheetCache(createMockWorksheet({ name: 'Sheet1' }))
  })

  it('worksheet 为 null 时应返回 false', () => {
    const isResult = ensureSheetHeaders(null)
    expect(isResult).toBe(false)
  })

  it('worksheet 为 undefined 时应返回 false', () => {
    const isResult = ensureSheetHeaders(undefined)
    expect(isResult).toBe(false)
  })

  it('已有表头时应返回 false', () => {
    // Mock findHeaderRow to return 1 (found)
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, column: unknown) => {
      const r = row as number
      const c = column as number
      if (r === 1 && c <= 3) return ['名称', '标题', 'bangumi'][c - 1] ?? ''
      return ''
    })
    const worksheet = createMockWorksheet({ name: 'HasHeader' })
    const isResult = ensureSheetHeaders(worksheet)
    expect(isResult).toBe(false)
  })

  it('空工作表应写入表头并返回 true', () => {
    // findHeaderRow returns 0 (no header found)
    vi.mocked(getCellValue).mockReturnValue('')
    const worksheet = createMockWorksheet({ name: 'EmptySheet' })
    worksheet.Range = createRangeMock((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
      }
      return createMockCell('')
    })
    // Mock Cells.Item to succeed
    worksheet.Cells.Item = createCellItemMock(() => createMockCell(''))
    const isResult = ensureSheetHeaders(worksheet)
    expect(isResult).toBe(true)
  })

  it('第 1 行已有内容但未识别到表头时应拒绝写入（避免覆盖用户数据）', () => {
    // findHeaderRow 返回 0（表头认不出来），但第 1 行有用户数据
    vi.mocked(getCellValue).mockReturnValue('')
    const writtenCells: string[] = []
    const worksheet = createMockWorksheet({ name: 'NoHeaderButHasData' })
    worksheet.Range = createRangeMock((address: string) => {
      if (address.includes(':')) {
        // 单行多列区域：二维形状。宽度必须是 HEADER_SCAN_COLUMNS(64)——
        // 真实 COM 对 A1:BL1 会返回 64 个单元格，给 2 列会被「宽度不足 = 读失败」守卫拦掉。
        return {
          Value2: [firstRowWithUserData()],
          Interior: { Color: 0 },
          Font: { Bold: false },
        }
      }
      writtenCells.push(address)
      return createMockCell('')
    })

    const isResult = ensureSheetHeaders(worksheet)

    expect(isResult).toBe(false)
    expect(writtenCells).toHaveLength(0)
  })

  it('第 1 行有内容且 Value2 为一维数组（单行区域真实形状）时同样拒绝写入', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const writtenCells: string[] = []
    const worksheet = createMockWorksheet({ name: 'NoHeader1D' })
    worksheet.Range = createRangeMock((address: string) => {
      if (address.includes(':')) {
        // Excel/WPS 对单行范围返回一维数组（真实形状），宽度同样是 64
        // 宽度同样是 HEADER_SCAN_COLUMNS(64)
        return {
          Value2: firstRowWithUserData(),
          Interior: { Color: 0 },
          Font: { Bold: false },
        }
      }
      writtenCells.push(address)
      return createMockCell('')
    })

    const isResult = ensureSheetHeaders(worksheet)

    expect(isResult).toBe(false)
    expect(writtenCells).toHaveLength(0)
  })

  it('关键列写入失败时应返回 false', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const worksheet = createMockWorksheet({ name: 'FailSheet' })
    worksheet.Range = createRangeMock((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
      }
      // First 5 columns fail
      const columnLetter = address.replace(/[0-9]/g, '')
      const columnIndex = (columnLetter.codePointAt(0) ?? 0) - 64
      if (columnIndex <= 5) {
        return {
          Interior: { Color: 0 },
          Font: { Bold: false },
          get FormulaR1C1() {
            throw new Error('Cannot write')
          },
          set FormulaR1C1(_v: unknown) {
            throw new Error('Cannot write')
          },
          get Formula() {
            throw new Error('Cannot write')
          },
          set Formula(_v: unknown) {
            throw new Error('Cannot write')
          },
          get Value2() {
            throw new Error('Cannot write')
          },
          set Value2(_v: unknown) {
            throw new Error('Cannot write')
          },
          get Value() {
            throw new Error('Cannot write')
          },
          set Value(_v: unknown) {
            throw new Error('Cannot write')
          },
        }
      }
      return createMockCell('')
    })
    worksheet.Cells.Item = createCellItemMock(() => {
      throw new Error('Cannot access')
    })
    const isResult = ensureSheetHeaders(worksheet)
    expect(isResult).toBe(false)
  })

  it('非关键列写入失败仍应返回 true', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const worksheet = createMockWorksheet({ name: 'PartialFail' })
    worksheet.Range = createRangeMock((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
      }
      const columnLetter = address.replace(/[0-9]/g, '')
      const columnIndex = (columnLetter.codePointAt(0) ?? 0) - 64
      if (columnIndex > 5 && columnIndex <= 7) {
        return {
          Interior: { Color: 0 },
          Font: { Bold: false },
          get FormulaR1C1() {
            throw new Error('Cannot write')
          },
          set FormulaR1C1(_v: unknown) {
            throw new Error('Cannot write')
          },
          get Formula() {
            throw new Error('Cannot write')
          },
          set Formula(_v: unknown) {
            throw new Error('Cannot write')
          },
          get Value2() {
            throw new Error('Cannot write')
          },
          set Value2(_v: unknown) {
            throw new Error('Cannot write')
          },
          get Value() {
            throw new Error('Cannot write')
          },
          set Value(_v: unknown) {
            throw new Error('Cannot write')
          },
        }
      }
      return createMockCell('')
    })
    worksheet.Cells.Item = createCellItemMock(() => createMockCell(''))
    const isResult = ensureSheetHeaders(worksheet)
    expect(isResult).toBe(true)
  })
})

function createNativeValueFunction(toStringValue: string): () => number {
  // fixture 工厂：每次调用须返回新实例并覆写其 toString，外提会破坏 fixture 身份；
  // 函数体不依赖外层作用域，规则静态判定可外提，按测试意图豁免。
  // eslint-disable-next-line unicorn/consistent-function-scoping -- 保持函数本地作用域以维护 fixture 身份
  const function_ = function Value(): number {
    return 42
  }
  function_.toString = () => toStringValue
  return function_
}

function functionReturnsNative(): () => number {
  return createNativeValueFunction('function Value() { [native code] }')
}

function throwingFunction(): never {
  throw new Error('Unexpected error')
}

describe('isNativeCode（间接测试 via safeCellValue/readRangeValues）', () => {
  it('native code function 应被 safeCellValue 转为空字符串', () => {
    // 通过 readRangeValues 间接测试
    const worksheet = createMockWorksheet()
    const nativeFunction = createNativeValueFunction('function Value() { [native code] }')
    const rangeMock = {
      Value2: [[nativeFunction]],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('function Value() 字符串模式应被识别为 native', () => {
    const worksheet = createMockWorksheet()
    const valueFunction = createNativeValueFunction('function Value() {}')
    const rangeMock = {
      Value2: [[valueFunction]],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('普通对象的 toString() 返回 native code 时应被识别', () => {
    const worksheet = createMockWorksheet()
    const nativeObject = { toString: () => 'function [native code]() {}' }
    const rangeMock = {
      Value2: [[nativeObject]],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('普通函数调用返回 native code 时应跳过', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = {
      Value2: [[functionReturnsNative()]],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('函数调用抛异常时应返回空字符串', () => {
    const worksheet = createMockWorksheet()
    const rangeMock = {
      Value2: [[throwingFunction]],
      Interior: { Color: 0 },
    }
    worksheet.Range = createRangeMock().mockReturnValue(rangeMock)
    const result = readRangeValues(worksheet, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })
})

describe('findAnchorColumn（间接测试 via getLastRow with headerRow）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('找到序号列时应返回正确列号', () => {
    const worksheet = createMockWorksheet({ name: 'AnchorCol' })
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, column: unknown) => {
      const r = row as number
      const c = column as number
      if (r === 1) {
        if (c === 1) return '序号'
        if (c === 2) return '名称'
        if (c === 3) return 'Bangumi URL'
        if (c === 4) return '类型'
      }
      return ''
    })
    // Set up End mock
    const anchorCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 50 }),
    }
    worksheet.Range = createRangeMock(() => anchorCell)
    const result = getLastRow(worksheet, false, 1)
    expect(result).toBe(50)
  })

  it('找到 Bangumi URL 列时应返回该列', () => {
    const worksheet = createMockWorksheet({ name: 'UrlCol' })
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, column: unknown) => {
      const r = row as number
      const c = column as number
      if (r === 1) {
        if (c === 1) return 'ID'
        if (c === 2) return '标题'
        if (c === 3) return '链接'
      }
      return ''
    })
    const anchorCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 30 }),
    }
    worksheet.Range = createRangeMock(() => anchorCell)
    const result = getLastRow(worksheet, false, 1)
    expect(result).toBe(30)
  })

  it('未找到锚定列时应回退到 D 列查找', () => {
    const worksheet = createMockWorksheet({ name: 'NoAnchor' })
    // No header keywords found
    vi.mocked(getCellValue).mockReturnValue('')
    const dCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 20 }),
    }
    worksheet.Range = createRangeMock(() => dCell)
    const result = getLastRow(worksheet, false, 1)
    expect(result).toBe(20)
  })

  it('锚定列定位异常时应回退', () => {
    const worksheet = createMockWorksheet({ name: 'AnchorFail' })
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, column: unknown) => {
      const r = row as number
      const c = column as number
      if (r === 1 && c === 1) return '序号'
      return ''
    })
    const failCell = {
      Value2: '',
      Value: '',
      Text: '',
      End: vi.fn(() => {
        throw new Error('COM error')
      }),
    }
    const dCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 15 }),
    }
    worksheet.Range = createRangeMock((addr: string) => {
      if (addr.startsWith('A')) return failCell
      if (addr.startsWith('D')) return dCell
      return failCell
    })
    const result = getLastRow(worksheet, false, 1)
    expect(result).toBe(15)
  })
})

describe('setCellValueDirect（间接测试 via ensureSheetHeaders）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSheetCache(createMockWorksheet({ name: 'Sheet1' }))
  })

  it('FormulaR1C1 路径成功时应写入', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const worksheet = createMockWorksheet({ name: 'FormulaR1C1' })
    const mockCell = {
      Text: '',
      Interior: { Color: 0 },
      Font: { Bold: false },
      set FormulaR1C1(_v: string) {
        /* empty */
      },
      get FormulaR1C1() {
        return ''
      },
      set Formula(_v: string) {
        /* empty */
      },
      set Value2(_v: string) {
        /* empty */
      },
      set Value(_v: string) {
        /* empty */
      },
    }
    worksheet.Range = createRangeMock(() => mockCell)
    worksheet.Cells.Item = createCellItemMock(() => mockCell)
    ensureSheetHeaders(worksheet)
    expect(worksheet.Cells.Item).toHaveBeenCalled()
  })

  it('所有写入路径均失败时仍应返回 true（仅记录警告）', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const worksheet = createMockWorksheet({ name: 'AllFail' })
    const failCell = {
      get Value2() {
        throw new Error('blocked')
      },
      set Value2(_v: unknown) {
        throw new Error('blocked')
      },
      get Value() {
        throw new Error('blocked')
      },
      set Value(_v: unknown) {
        throw new Error('blocked')
      },
      get Formula() {
        throw new Error('blocked')
      },
      set Formula(_v: unknown) {
        throw new Error('blocked')
      },
      get FormulaR1C1() {
        throw new Error('blocked')
      },
      set FormulaR1C1(_v: unknown) {
        throw new Error('blocked')
      },
      Interior: { Color: 0 },
      Font: { Bold: false },
    }
    worksheet.Range = createRangeMock(() => failCell)
    worksheet.Cells.Item = createCellItemMock(() => failCell)
    const isResult = ensureSheetHeaders(worksheet)
    // 虽然所有列写入失败，但前5列全部失败 → 返回 false
    expect(isResult).toBe(false)
  })
})

// ============================================================
//  补测块（2026-09-15）：此前只测了 readRangeValues / getLastRow 的「顺路径」，
//  以下四组打的是同一模块里真正会被生产调用、却从未被任何用例触发的分支。
// ============================================================

describe('readRangeCellValues（保留原始类型，供「读-改-写整行」使用）', () => {
  it('worksheet 为空时返回空数组（调用方必须据此放弃写入，否则会清空用户数据）', () => {
    expect(readRangeCellValues(null, 1, 5, 1, 3)).toEqual([])
    expect(readRangeCellValues(undefined, 1, 5, 1, 3)).toEqual([])
  })

  it('Value2 为 null / undefined（假值）时返回空数组', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: null })
    expect(readRangeCellValues(worksheet, 1, 5, 1, 3)).toEqual([])
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: undefined })
    expect(readRangeCellValues(worksheet, 1, 5, 1, 3)).toEqual([])
  })

  it('单个值（非数组）包装为 1x1 并保留类型', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: 42 })
    expect(readRangeCellValues(worksheet, 1, 1, 1, 1)).toEqual([[42]])
  })

  it('二维数组保留 number / boolean / Date，其余一律归 null（避免数字列被写成文本列）', () => {
    const date = new Date('2026-01-02T03:04:05.000Z')
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({
      Value2: [
        [1, '壹', true, date],
        [null, '', () => 1, { a: 1 }],
      ],
    })
    expect(readRangeCellValues(worksheet, 1, 2, 1, 4)).toEqual([
      [1, '壹', true, date],
      [null, '', null, null],
    ])
  })

  it('原生代码对象（WPS 内部 Proxy）与函数一律归 null', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({
      Value2: [
        [createNativeValueFunction('function Value() { [native code] }'), functionReturnsNative()],
      ],
    })
    expect(readRangeCellValues(worksheet, 1, 1, 1, 2)).toEqual([[null, null]])
  })

  it('单列多行：一维数组按「每元素一行」处理（列向量）', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: [7, 'x'] })
    expect(readRangeCellValues(worksheet, 1, 2, 1, 1)).toEqual([[7], ['x']])
  })

  it('单行多列（读-改-写整行的唯一形状）必须读成「1 行 N 列」并保留类型', () => {
    // 同步记录整行更新走的就是这条路径：读错形状 ⇒ 只拿到第 1 个单元格 ⇒ 写回清空其余列。
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: [7, 'x', true] })
    expect(readRangeCellValues(worksheet, 1, 1, 1, 3)).toEqual([[7, 'x', true]])
  })

  it('请求多行多列却读回一维时返回空数组（调用方据此放弃写入）', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: [7, 'x', true] })
    expect(readRangeCellValues(worksheet, 1, 2, 1, 3)).toEqual([])
  })

  it('单行读回宽度不足（读不全）时返回空数组：整行写回会把缺失列清成空值', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: [['a', 'b']] })
    expect(readRangeCellValues(worksheet, 1, 1, 1, 12)).toEqual([])
  })

  it('读取抛错时返回空数组', () => {
    const worksheet = {
      ...createMockWorksheet(),
      Range: vi.fn(() => {
        throw new Error('读取失败')
      }),
    }
    expect(readRangeCellValues(worksheet, 1, 5, 1, 3)).toEqual([])
  })
})

describe('safeStringify 的对象分支与函数返回值分支（间接 via readRangeValues）', () => {
  it('对象自带普通 toString 时按其 toString 序列化', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({
      Value2: [[{ toString: () => 'plain-value' }]],
    })
    expect(readRangeValues(worksheet, 1, 1, 1, 1)).toEqual([['plain-value']])
  })

  it('对象没有可调用 toString 时返回空串', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({
      Value2: [[Object.create(null) as object]],
    })
    expect(readRangeValues(worksheet, 1, 1, 1, 1)).toEqual([['']])
  })

  it('函数返回 null 时走「值为空」分支返回空串', () => {
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: [[() => null]] })
    expect(readRangeValues(worksheet, 1, 1, 1, 1)).toEqual([['']])
  })

  it('函数返回原生代码对象时走 isNativeCode 分支返回空串', () => {
    const nativeObject = { toString: () => 'function Value() { [native code] }' }
    const worksheet = createMockWorksheet()
    worksheet.Range = createRangeMock().mockReturnValue({ Value2: [[() => nativeObject]] })
    expect(readRangeValues(worksheet, 1, 1, 1, 1)).toEqual([['']])
  })
})

describe('getLastRow 的异常回退与缓存文案', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 前缀为 '' 的 clearSheetCache 会清空整个缓存，避免用例间互相命中
    clearSheetCache(createMockWorksheet({ name: '' }))
  })

  it('锚定列定位抛错时记警告并回退到 D 列', () => {
    const worksheet = createMockWorksheet({ name: 'AnchorThrow', rows: 100 })
    const anchorCell = {
      Value2: 'd',
      End: vi.fn(() => {
        throw new Error('COM 桥接失效')
      }),
    }
    const dCell = { Value2: 'd', End: vi.fn().mockReturnValue({ Row: 77 }) }
    worksheet.Range = createRangeMock((address: string) => {
      if (address === 'A1') return { Value2: '序号' }
      return address.startsWith('A') ? anchorCell : dCell
    })

    expect(getLastRow(worksheet, false, 1)).toBe(77)
    expect(bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('回退到原有逻辑'))
  })

  it('UsedRange 读取抛错时记警告并返回默认 50000', () => {
    const base = createMockWorksheet({ name: 'UsedRangeThrow', rows: 10 })
    const failCell = {
      Value2: '',
      End: vi.fn(() => {
        throw new Error('无 End')
      }),
    }
    const worksheet = {
      ...base,
      Range: createRangeMock(() => failCell),
      get UsedRange(): never {
        throw new Error('COM 桥接失效')
      },
    } as unknown as WpsWorksheet

    expect(getLastRow(worksheet)).toBe(50_000)
    expect(bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('UsedRange 失败'))
  })

  it('工作表名为空串时缓存键退化为空前缀，仍能定位最后行', () => {
    const worksheet = createMockWorksheet({
      name: '',
      rows: 10,
      usedRange: { Row: 1, Rows: { Count: 4 } },
    })
    worksheet.Range = createRangeMock(() => ({
      Value2: '',
      End: vi.fn(() => {
        throw new Error('无 End')
      }),
    }))

    expect(getLastRow(worksheet)).toBe(4)
  })

  it('「首次计算」与「来自缓存」两种日志文案可区分', () => {
    const worksheet = createMockWorksheet({
      name: 'LogText',
      rows: 10,
      usedRange: { Row: 1, Rows: { Count: 3 } },
    })
    worksheet.Range = createRangeMock(() => ({
      Value2: '',
      End: vi.fn(() => {
        throw new Error('无 End')
      }),
    }))
    clearSheetCache(worksheet)

    getLastRow(worksheet)
    expect(bgmLog).toHaveBeenCalledWith('INFO', expect.stringContaining('(首次计算)'))

    // 不清空调用记录：第一次的「首次计算」必须留在历史里，第二次再叠加一条
    getLastRow(worksheet)
    expect(bgmLog).toHaveBeenCalledWith('INFO', expect.stringContaining('(来自缓存)'))
  })
})
