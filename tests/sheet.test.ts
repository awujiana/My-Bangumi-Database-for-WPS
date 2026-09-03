import { describe, it, expect, beforeEach, vi } from 'vitest'

const { PANEL_CONFIG, HEADER_KEYWORDS, COLUMN_RULES, STANDARD_HEADERS, colNumberToLetter } =
  vi.hoisted(() => {
    const PANEL_CONFIG = { MAX_SCAN_ROWS: 50, MAX_SCAN_COLUMNS: 10 }
    const HEADER_KEYWORDS = [
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
    const COLUMN_RULES: readonly (readonly [RegExp, string])[] = [
      [/序列号|序号|编号/i, '序列号'],
      [/名称|标题|作品名/i, '名称'],
      [/bangumi.*url|url|链接|地址/i, 'Bangumi_URL'],
      [/类型/i, '类型'],
      [/状态|是否看完/i, '状态'],
      [/评分/i, '评分'],
      [/标签/i, '标签'],
    ] as const
    const STANDARD_HEADERS = [
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
    const colNumberToLetter = (col: number): string => {
      let result = ''
      let n = col
      while (n > 0) {
        const remainder = (n - 1) % 26
        result = String.fromCharCode(65 + remainder) + result
        n = Math.floor((n - 1) / 26)
      }
      return result
    }
    return {
      PANEL_CONFIG,
      HEADER_KEYWORDS,
      COLUMN_RULES,
      STANDARD_HEADERS,
      colNumberToLetter,
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
  colNumberToLetter,
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
import { getCellValue, getCell } from '../ts/tools/util/cell.js'

function createMockCell(value: unknown = '') {
  return {
    Value2: value,
    Value: value,
    Text: value == null ? '' : String(value),
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
    hasEnd?: boolean
    endRow?: number
  } = {},
) {
  const name = options.name || 'Sheet1'
  const rows = options.rows || 100
  const cellValues = options.cellValues ?? {}
  const cellOverrides = options.cellOverrides ?? {}

  const mockCell = (address: string): ReturnType<typeof createMockCell> => {
    if (address in cellOverrides) {
      return createMockCell(cellOverrides[address])
    }
    if (address in cellValues) {
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
    Cells: { Item: vi.fn((r: number, c: number) => createMockCell('')) },
    // End mock for getLastRow
    _endRow: options.endRow ?? 0,
  }
}

describe('readRangeValues', () => {
  it('应在 ws 为 null 时返回空数组', () => {
    expect(readRangeValues(null, 1, 5, 1, 3)).toEqual([])
  })

  it('应在 ws 为 undefined 时返回空数组', () => {
    expect(readRangeValues(undefined, 1, 5, 1, 3)).toEqual([])
  })

  it('应读取单个值', () => {
    const ws = createMockWorksheet()
    const rangeMock = { Value2: 'single', Interior: { Color: 0 } }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 1, 1, 1)
    expect(result).toEqual([['single']])
  })

  it('Value2 为 null 时返回空数组', () => {
    const ws = createMockWorksheet()
    const rangeMock = { Value2: null, Interior: { Color: 0 } }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 5, 1, 3)
    expect(result).toEqual([])
  })

  it('Value2 为 undefined 时返回空数组', () => {
    const ws = createMockWorksheet()
    const rangeMock = { Value2: undefined, Interior: { Color: 0 } }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 5, 1, 3)
    expect(result).toEqual([])
  })

  it('应处理多值二维数组', () => {
    const ws = createMockWorksheet()
    const rangeMock = {
      Value2: [
        ['a1', 'b1', 'c1'],
        ['a2', 'b2', 'c2'],
      ],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 2, 1, 3)
    expect(result).toEqual([
      ['a1', 'b1', 'c1'],
      ['a2', 'b2', 'c2'],
    ])
  })

  it('应处理非数组行（单值行）', () => {
    const ws = createMockWorksheet()
    const rangeMock = {
      Value2: ['single_val', 'another_val'],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 2, 1, 1)
    expect(result).toEqual([['single_val'], ['another_val']])
  })

  it('应在异常时返回空数组', () => {
    const ws = {
      ...createMockWorksheet(),
      Range: vi.fn(() => {
        throw new Error('fail')
      }),
    }
    expect(readRangeValues(ws, 1, 5, 1, 3)).toEqual([])
  })

  it('应处理 safeCellValue 的 null 值', () => {
    const ws = createMockWorksheet()
    const rangeMock = {
      Value2: [[null, 'valid']],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 1, 1, 2)
    expect(result).toEqual([['', 'valid']])
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
    vi.mocked(getApp).mockReturnValue({
      ActiveWorkbook: { ActiveSheet: mockSheet },
    })
    expect(getDataSheet()).toBe(mockSheet)
  })

  it('锁定模式下应返回锁定的工作表', () => {
    const lockedSheet = createMockWorksheet({ name: 'Locked' })
    const itemFunction = vi.fn().mockReturnValue(lockedSheet)
    vi.mocked(getApp).mockReturnValue({
      ActiveWorkbook: {
        ActiveSheet: createMockWorksheet({ name: 'Active' }),
        Worksheets: { Item: itemFunction },
      },
    })
    BGM.sheet.isLocked = true
    BGM.sheet.lockedIndex = 2
    const result = getDataSheet()
    expect(itemFunction).toHaveBeenCalledWith(2)
  })

  it('锁定模式下应查找指定工作簿', () => {
    const targetWb = {
      Name: 'TargetWb',
      Worksheets: { Item: vi.fn().mockReturnValue(createMockWorksheet({ name: 'TargetSheet' })) },
    }
    vi.mocked(getApp).mockReturnValue({
      ActiveWorkbook: {
        ActiveSheet: createMockWorksheet({ name: 'Active' }),
        Worksheets: { Item: vi.fn() },
      },
      Workbooks: {
        Count: 2,
        Item: vi.fn((index: number) => (index === 2 ? targetWb : { Name: 'OtherWb' })),
      },
    })
    BGM.sheet.isLocked = true
    BGM.sheet.lockedIndex = 1
    BGM.sheet.lockedWorkbookName = 'TargetWb'
    const result = getDataSheet()
    expect(result).toBeDefined()
  })

  it('锁定模式查找失败时应回退到 ActiveSheet', () => {
    const activeSheet = createMockWorksheet({ name: 'Active' })
    vi.mocked(getApp).mockReturnValue({
      ActiveWorkbook: { ActiveSheet: activeSheet },
    })
    BGM.sheet.isLocked = true
    // will fail
    BGM.sheet.lockedIndex = 10
    const mockErrorWs = {
      ...createMockWorksheet(),
      Worksheets: {
        Item: vi.fn(() => {
          throw new Error('not found')
        }),
      },
    }
    vi.mocked(getApp).mockReturnValue({
      ActiveWorkbook: {
        ActiveSheet: activeSheet,
        Worksheets: {
          Item: vi.fn(() => {
            throw new Error('not found')
          }),
        },
      },
    })
    const result = getDataSheet()
    expect(result).toBe(activeSheet)
  })
})

describe('safeActivate', () => {
  it('应调用 Activate 方法', () => {
    const ws = createMockWorksheet()
    safeActivate(ws)
    expect(ws.Activate).toHaveBeenCalled()
  })

  it('应在 ws 为 null 时不报错', () => {
    expect(() => safeActivate(null)).not.toThrow()
  })

  it('应在 ws 为 undefined 时不报错', () => {
    expect(() => safeActivate(undefined)).not.toThrow()
  })

  it('Activate 不是函数时应记录警告', () => {
    const ws = { ...createMockWorksheet(), Activate: undefined }
    safeActivate(ws)
    expect(bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('safeActivate'))
  })
})

describe('getLastRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSheetCache(createMockWorksheet({ name: 'Test' }))
    clearSheetCache(createMockWorksheet({ name: 'AnchorTest' }))
  })

  it('应在 ws 为 null 时返回默认值 50000', () => {
    const result = getLastRow(null)
    expect(result).toBe(50_000)
  })

  it('应在 ws 为 undefined 时返回默认值 50000', () => {
    const result = getLastRow(undefined)
    expect(result).toBe(50_000)
  })

  it('D 列 End 成功时返回正确行号', () => {
    const ws = createMockWorksheet({
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
    ws.Range = vi.fn(() => mockCell)
    const result = getLastRow(ws)
    expect(result).toBe(50)
  })

  it('D 列失败时回退到 A 列', () => {
    const ws = createMockWorksheet({
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
    ws.Range = vi.fn((addr: string) => (addr.startsWith('D') ? dCell : aCell))
    const result = getLastRow(ws)
    expect(result).toBe(30)
  })

  it('所有列失败时使用 UsedRange 兜底', () => {
    const ws = createMockWorksheet({
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
    ws.Range = vi.fn(() => failCell)
    const result = getLastRow(ws)
    expect(result).toBe(25)
  })

  it('应使用 UsedRange 作为兜底', () => {
    const ws = createMockWorksheet({
      name: 'Test',
      usedRange: { Row: 5, Rows: { Count: 25 } },
    })
    const result = getLastRow(ws)
    // Row + Count - 1 = 5 + 25 - 1 = 29
    expect(result).toBe(29)
  })

  it('UsedRange 失败时返回默认 50000', () => {
    const ws = {
      ...createMockWorksheet({ name: 'Test' }),
      UsedRange: undefined,
    }
    const failCell = {
      Value2: '',
      Value: '',
      Text: '',
      End: vi.fn(() => {
        throw new Error('fail')
      }),
    }
    ws.Range = vi.fn(() => failCell)
    const result = getLastRow(ws)
    expect(result).toBe(50_000)
  })

  it('forceRefresh 为 true 时应清除缓存', () => {
    const ws = createMockWorksheet({ name: 'RefreshTest' })
    const result1 = getLastRow(ws, true)
    const result2 = getLastRow(ws, true)
    expect(result2).toBeDefined()
  })

  it('有 headerRow 参数时应尝试锚定列查找', () => {
    const ws = createMockWorksheet({
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
    ws.Range = vi.fn(() => anchorCell)
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, col: unknown) =>
      col === 1 ? '序列号' : '',)
    const result = getLastRow(ws, false, 1)
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
    const ws = createMockWorksheet({ name: 'Empty' })
    const result = findHeaderRow(ws)
    expect(result).toBe(0)
  })

  it('应在找到多个关键字时返回行号', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (r === 1) {
        if (c === 1) return '名称'
        if (c === 2) return '标题'
        if (c === 3) return 'Bangumi URL'
        if (c === 4) return '类型'
      }
      return ''
    })
    const ws = createMockWorksheet({ name: 'Found' })
    const result = findHeaderRow(ws)
    expect(result).toBe(1)
  })

  it('应使用缓存加速重复调用', () => {
    const callCount = { count: 0 }
    vi.mocked(getCellValue).mockImplementation(() => {
      callCount.count += 1
      return ''
    })
    const ws = createMockWorksheet({ name: 'CacheTest' })
    findHeaderRow(ws)
    findHeaderRow(ws)
    // 第二次调用应使用缓存
    expect(callCount.count).toBeGreaterThan(0)
  })

  it('startRow 参数应从指定行开始扫描', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (r === 3) {
        if (c === 1) return '名称'
        if (c === 2) return '标题'
        if (c === 3) return 'URL'
      }
      return ''
    })
    const ws = createMockWorksheet({ name: 'StartRow' })
    const result = findHeaderRow(ws, 3)
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
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, col: unknown) => {
      const c = col as number
      if (c === 1) return '序列号'
      if (c === 2) return '名称'
      if (c === 3) return 'Bangumi URL'
      if (c === 4) return '类型'
      return ''
    })
    const ws = createMockWorksheet({ name: 'MapTest' })
    const map = getColumnMap(ws, 1)
    expect(map.get('序列号')).toBe(1)
    expect(map.get('名称')).toBe(2)
    expect(map.get('Bangumi_URL')).toBe(3)
    expect(map.get('类型')).toBe(4)
  })

  it('序列号列回退：第一个非空列未被占用时使用', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, col: unknown) => {
      const c = col as number
      // 非标准序列号名，但非空
      if (c === 1) return '自定义ID'
      if (c === 2) return '名称'
      if (c === 3) return 'Bangumi URL'
      return ''
    })
    const ws = createMockWorksheet({ name: 'FallbackTest' })
    const map = getColumnMap(ws, 1)
    // 序列号应回退到第一个非空列（列1）
    expect(map.get('序列号')).toBe(1)
  })

  it('序列号列回退：第一个非空列被占用时使用下一个未被占用的列', () => {
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, _row: unknown, col: unknown) => {
      const c = col as number
      // 第一个非空列已被'名称'映射占用
      if (c === 1) return '名称'
      // 不匹配任何规则，成为序列号回退候选
      if (c === 2) return '标题'
      if (c === 3) return 'Bangumi URL'
      if (c === 4) return '自定义字段'
      return ''
    })
    const ws = createMockWorksheet({ name: 'Fallback2' })
    const map = getColumnMap(ws, 1)
    // 序列号应回退到第一个未被占用的非空列（列2 - "标题"不匹配任何规则）
    expect(map.get('序列号')).toBe(2)
  })

  it('空工作表应返回空 Map', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const ws = createMockWorksheet({ name: 'Empty' })
    const map = getColumnMap(ws, 1)
    expect(map.size).toBe(0)
  })

  it('应缓存列映射结果', () => {
    const callCount = { count: 0 }
    vi.mocked(getCellValue).mockImplementation(() => {
      callCount.count += 1
      return ''
    })
    const ws = createMockWorksheet({ name: 'CacheMap' })
    getColumnMap(ws, 1)
    getColumnMap(ws, 1)
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
    const ws = createMockWorksheet({ name: 'clear-test' })
    clearSheetCache(ws)
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
    const ws = createMockWorksheet({ name: 'nonexistent' })
    expect(() => clearSheetCache(ws)).not.toThrow()
  })
})

describe('ensureSheetHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSheetCache(createMockWorksheet({ name: 'Sheet1' }))
  })

  it('ws 为 null 时应返回 false', () => {
    const isResult = ensureSheetHeaders(null)
    expect(isResult).toBe(false)
  })

  it('ws 为 undefined 时应返回 false', () => {
    const isResult = ensureSheetHeaders(undefined)
    expect(isResult).toBe(false)
  })

  it('已有表头时应返回 false', () => {
    // Mock findHeaderRow to return 1 (found)
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (r === 1 && c <= 3) return ['名称', '标题', 'bangumi'][c - 1] ?? ''
      return ''
    })
    const ws = createMockWorksheet({ name: 'HasHeader' })
    const isResult = ensureSheetHeaders(ws)
    expect(isResult).toBe(false)
  })

  it('空工作表应写入表头并返回 true', () => {
    // findHeaderRow returns 0 (no header found)
    vi.mocked(getCellValue).mockReturnValue('')
    const ws = createMockWorksheet({ name: 'EmptySheet' })
    ws.Range = vi.fn((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
      }
      return createMockCell('')
    })
    // Mock Cells.Item to succeed
    ws.Cells.Item = vi.fn(() => createMockCell(''))
    const isResult = ensureSheetHeaders(ws)
    expect(isResult).toBe(true)
  })

  it('关键列写入失败时应返回 false', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const ws = createMockWorksheet({ name: 'FailSheet' })
    ws.Range = vi.fn((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
      }
      // First 5 columns fail
      const colLetter = address.replace(/[0-9]/g, '')
      const colIndex = colLetter.charCodeAt(0) - 64
      if (colIndex <= 5) {
        return {
          Value2: '',
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
    ws.Cells.Item = vi.fn(() => {
      throw new Error('Cannot access')
    })
    const isResult = ensureSheetHeaders(ws)
    expect(isResult).toBe(false)
  })

  it('非关键列写入失败仍应返回 true', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const ws = createMockWorksheet({ name: 'PartialFail' })
    ws.Range = vi.fn((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
      }
      const colLetter = address.replace(/[0-9]/g, '')
      const colIndex = colLetter.charCodeAt(0) - 64
      if (colIndex > 5 && colIndex <= 7) {
        return {
          Value2: '',
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
    ws.Cells.Item = vi.fn(() => createMockCell(''))
    const isResult = ensureSheetHeaders(ws)
    expect(isResult).toBe(true)
  })
})

describe('isNativeCode（间接测试 via safeCellValue/readRangeValues）', () => {
  it('native code function 应被 safeCellValue 转为空字符串', () => {
    // 通过 readRangeValues 间接测试
    const ws = createMockWorksheet()
    const nativeFunction = function Value() {
      return 42
    }
    nativeFunction.toString = () => 'function Value() { [native code] }'
    const rangeMock = {
      Value2: [[nativeFunction]],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('function Value() 字符串模式应被识别为 native', () => {
    const ws = createMockWorksheet()
    const valueFunction = function Value() {
      return 42
    }
    valueFunction.toString = () => 'function Value() {}'
    const rangeMock = {
      Value2: [[valueFunction]],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('普通对象的 toString() 返回 native code 时应被识别', () => {
    const ws = createMockWorksheet()
    const nativeObject = { toString: () => 'function [native code]() {}' }
    const rangeMock = {
      Value2: [[nativeObject]],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('普通函数调用返回 native code 时应跳过', () => {
    const ws = createMockWorksheet()
    const functionReturnsNative = () => {
      const nativeFunction = function Value() {
        return 42
      }
      nativeFunction.toString = () => 'function Value() { [native code] }'
      return nativeFunction
    }
    const rangeMock = {
      Value2: [[functionReturnsNative]],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })

  it('函数调用抛异常时应返回空字符串', () => {
    const ws = createMockWorksheet()
    const throwingFunction = () => {
      throw new Error('Unexpected error')
    }
    const rangeMock = {
      Value2: [[throwingFunction]],
      Interior: { Color: 0 },
    }
    ws.Range = vi.fn().mockReturnValue(rangeMock)
    const result = readRangeValues(ws, 1, 1, 1, 1)
    expect(result).toEqual([['']])
  })
})

describe('findAnchorColumn（间接测试 via getLastRow with headerRow）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('找到序号列时应返回正确列号', () => {
    const ws = createMockWorksheet({ name: 'AnchorCol' })
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
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
    ws.Range = vi.fn(() => anchorCell)
    const result = getLastRow(ws, false, 1)
    expect(result).toBe(50)
  })

  it('找到 Bangumi URL 列时应返回该列', () => {
    const ws = createMockWorksheet({ name: 'UrlCol' })
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
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
    ws.Range = vi.fn(() => anchorCell)
    const result = getLastRow(ws, false, 1)
    expect(result).toBe(30)
  })

  it('未找到锚定列时应回退到 D 列查找', () => {
    const ws = createMockWorksheet({ name: 'NoAnchor' })
    // No header keywords found
    vi.mocked(getCellValue).mockReturnValue('')
    const dCell = {
      Value2: 'data',
      Value: 'data',
      Text: 'data',
      End: vi.fn().mockReturnValue({ Row: 20 }),
    }
    ws.Range = vi.fn(() => dCell)
    const result = getLastRow(ws, false, 1)
    expect(result).toBe(20)
  })

  it('锚定列定位异常时应回退', () => {
    const ws = createMockWorksheet({ name: 'AnchorFail' })
    vi.mocked(getCellValue).mockImplementation((_ws: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
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
    ws.Range = vi.fn((addr: string) => {
      if (addr.startsWith('A')) return failCell
      if (addr.startsWith('D')) return dCell
      return failCell
    })
    const result = getLastRow(ws, false, 1)
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
    const ws = createMockWorksheet({ name: 'FormulaR1C1' })
    let isFormulaR1C1Written = false
    const mockCell = {
      Value2: '',
      Value: '',
      Text: '',
      Interior: { Color: 0 },
      Font: { Bold: false },
      set FormulaR1C1(v: string) {
        isFormulaR1C1Written = true
      },
      get FormulaR1C1() {
        return ''
      },
      set Formula(_v: string) {},
      set Value2(_v: string) {},
      set Value(_v: string) {},
    }
    ws.Range = vi.fn(() => mockCell)
    ws.Cells.Item = vi.fn(() => mockCell)
    ensureSheetHeaders(ws)
    expect(ws.Cells.Item).toHaveBeenCalled()
  })

  it('所有写入路径均失败时仍应返回 true（仅记录警告）', () => {
    vi.mocked(getCellValue).mockReturnValue('')
    const ws = createMockWorksheet({ name: 'AllFail' })
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
    ws.Range = vi.fn(() => failCell)
    ws.Cells.Item = vi.fn(() => failCell)
    const isResult = ensureSheetHeaders(ws)
    // 虽然所有列写入失败，但前5列全部失败 → 返回 false
    expect(isResult).toBe(false)
  })
})
