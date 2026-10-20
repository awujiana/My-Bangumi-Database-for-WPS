import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WpsRange, WpsWorksheet } from '../ts/tools/wps.js'
import { BGM_COLOR } from '../ts/core/constants.js'

const mockBgmLog = vi.hoisted(() => vi.fn<(level: string, message: string) => void>())
const mockHandleError = vi.hoisted(() => vi.fn())
const mockGetApp = vi.hoisted(() => vi.fn())
const mockGetLastRow = vi.hoisted(() => vi.fn<() => number>())
const mockColumnNumberToLetter = vi.hoisted(() =>
  vi.fn((column: number) => {
    let result = ''
    let n = column
    while (n > 0) {
      result = String.fromCodePoint(65 + ((n - 1) % 26)) + result
      n = Math.floor((n - 1) / 26)
    }
    return result
  }),
)
const mockSetCellValue = vi.hoisted(() => vi.fn<() => boolean>())
const mockReadRangeValues = vi.hoisted(() => vi.fn<() => string[][]>())

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mockBgmLog,
  getApp: mockGetApp,
  getLastRow: mockGetLastRow,
  columnNumberToLetter: mockColumnNumberToLetter,
  setCellValue: mockSetCellValue,
  readRangeValues: mockReadRangeValues,
  BGM: { handleError: mockHandleError },
}))

import {
  ENRICH_RECORD_COLUMNS,
  ENRICH_RECORD_COLUMN,
  ENRICH_RECORD_SHEET_NAME,
  getActionColor,
  getOrCreateEnrichRecordSheet,
  addEnrichRecord,
  addEnrichRecords,
  clearEnrichRecords,
  getAllEnrichRecords,
  getEnrichRecordSheetIfExists,
  openEnrichRecordSheet,
  formatEnrichRecordSheet,
} from '../ts/sync/enrich-record.js'
import type { AddEnrichRecordParameters } from '../ts/sync/enrich-record.js'

/** 记录所有 `Value2 = x` 写入（地址 → 值），含单格与整片 */
const rangeWrites = new Map<string, unknown>()
/** 记录 `Interior.Color = x` 写入（地址 → 颜色） */
const interiorColors = new Map<string, number>()
/** 记录 `Font.Bold = x` 写入（地址 → 布尔） */
const fontBolds = new Map<string, number | boolean>()

/** 控制桩形状的开关：让「可选成员缺失 / 宿主调用抛错」分支可达 */
const flags = {
  withInterior: true,
  withFont: true,
  throwOnWrite: false,
  throwOnMove: false,
  throwOnActivate: false,
  throwOnAutoFit: false,
  throwOnFontName: false,
  throwOnDelete: false,
}

/** 取某地址最后一次写入的值（未写入为 undefined） */
function getWritten(address: string): unknown {
  return rangeWrites.get(address)
}

/** 取某地址最后一次设置的底色（未设置为 undefined） */
function getInteriorColor(address: string): number | undefined {
  return interiorColors.get(address)
}

/** 构造带记录能力的 Range 桩；`cells` 为该表的单元格初始值 */
function createRangeStub(address: string, cells: Map<string, unknown>): WpsRange {
  const stub: Record<string, unknown> = {
    Borders: { LineStyle: 0 },
    ColumnWidth: 0,
    HorizontalAlignment: 0,
    Delete: vi.fn(() => {
      if (flags.throwOnDelete) throw new Error('删除失败')
    }),
    EntireColumn: {
      AutoFit: vi.fn(() => {
        if (flags.throwOnAutoFit) throw new Error('列宽自适应失败')
      }),
    },
  }

  if (flags.withInterior) {
    const interior: Record<string, unknown> = {}
    Object.defineProperty(interior, 'Color', {
      get: () => interiorColors.get(address) ?? 0,
      set: (value: number) => {
        interiorColors.set(address, value)
      },
    })
    stub.Interior = interior
  }

  if (flags.withFont) {
    const font: Record<string, unknown> = {}
    Object.defineProperties(font, {
      Bold: {
        get: () => fontBolds.get(address) ?? false,
        set: (isBold: boolean) => {
          fontBolds.set(address, isBold)
        },
      },
      Name: {
        get: () => '',
        set: () => {
          if (flags.throwOnFontName) throw new Error('字体设置失败')
        },
      },
    })
    stub.Font = font
  }

  Object.defineProperty(stub, 'Value2', {
    get: () => cells.get(address) ?? null,
    set: (value: unknown) => {
      if (flags.throwOnWrite) throw new Error('写入失败')
      cells.set(address, value)
      rangeWrites.set(address, value)
    },
  })

  return stub as unknown as WpsRange
}

/** 测试用工作表桩：只实现被测路径访问到的成员，形状不完整收敛在本工厂内 */
function createMockSheet(
  options: {
    name?: string
    rowCount?: number
    usedRange?: { Row: number; Rows: { Count: number } } | null
    cells?: Record<string, unknown>
  } = {},
): WpsWorksheet {
  const cells = new Map<string, unknown>(Object.entries(options.cells ?? {}))
  // 同一地址必须复用同一桩：否则生产代码写入的样式与断言取到的不是同一对象
  const rangeCache = new Map<string, WpsRange>()
  const usedRange =
    options.usedRange === undefined ? { Row: 1, Rows: { Count: 10 } } : options.usedRange
  return {
    Name: options.name ?? 'Sheet1',
    Rows: { Count: options.rowCount ?? 50 },
    UsedRange: usedRange,
    Range: vi.fn((address: string) => {
      const cached = rangeCache.get(address)
      if (cached) return cached
      const stub = createRangeStub(address, cells)
      rangeCache.set(address, stub)
      return stub
    }),
    Activate: vi.fn(() => {
      if (flags.throwOnActivate) throw new Error('激活失败')
    }),
    Select: vi.fn(),
    Delete: vi.fn(),
    Move: vi.fn(() => {
      if (flags.throwOnMove) throw new Error('移动失败')
    }),
  } as unknown as WpsWorksheet
}

/** 构造工作簿桩；`sheets` 为空时只含一张无关表（用于「富化记录表不存在」场景） */
function createMockWorkbook(sheets: WpsWorksheet[] = [], isThrowOnItem = false) {
  const all = sheets.length > 0 ? sheets : [createMockSheet({ name: '动画' })]
  const item = vi.fn((index: number) => {
    if (isThrowOnItem) throw new Error('读取工作表失败')
    return all[index - 1] ?? all[0]
  })
  return {
    Sheets: {
      Count: all.length,
      Item: item,
      Add: vi.fn(() => createMockSheet({ name: 'NewSheet' })),
    },
    Worksheets: {
      Count: all.length,
      Item: vi.fn((index: number) => all[index - 1] ?? all[0]),
    },
    ActiveSheet: all[0],
  }
}

/** 组装一条完整的富化记录参数 */
function makeRecord(overrides: Partial<AddEnrichRecordParameters> = {}): AddEnrichRecordParameters {
  return {
    timestamp: '2026-09-14 20:00:00',
    matchType: '精确',
    name: '葬送的芙莉莲',
    row: 12,
    enrichedField: '标签',
    oldValue: '',
    updatedValue: '奇幻',
    action: 'fill',
    ...overrides,
  }
}

describe('enrich-record', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rangeWrites.clear()
    interiorColors.clear()
    fontBolds.clear()
    flags.withInterior = true
    flags.withFont = true
    flags.throwOnWrite = false
    flags.throwOnMove = false
    flags.throwOnActivate = false
    flags.throwOnAutoFit = false
    flags.throwOnFontName = false
    flags.throwOnDelete = false
    mockGetApp.mockReturnValue(null)
    mockGetLastRow.mockReturnValue(10)
    mockSetCellValue.mockReturnValue(true)
    mockReadRangeValues.mockReturnValue([])
  })

  describe('getActionColor 操作类型配色', () => {
    it('fill 用成功色', () => {
      expect(getActionColor('fill')).toBe(BGM_COLOR.SUCCESS)
    })

    it('append 用固定淡黄色', () => {
      expect(getActionColor('append')).toBe(0xffff80)
    })

    it('skip 用跳过色', () => {
      expect(getActionColor('skip')).toBe(BGM_COLOR.SKIP)
    })

    it('error 用失败色', () => {
      expect(getActionColor('error')).toBe(BGM_COLOR.FAIL)
    })

    it('未知类型回退灰色', () => {
      expect(getActionColor('unknown')).toBe(BGM_COLOR.GRAY)
    })
  })

  describe('getOrCreateEnrichRecordSheet 获取或建表', () => {
    it('无活动工作簿时抛错', () => {
      mockGetApp.mockReturnValue(null)
      expect(() => getOrCreateEnrichRecordSheet()).toThrow('无法获取工作簿')
    })

    it('ActiveWorkbook 缺失时抛错', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: null })
      expect(() => getOrCreateEnrichRecordSheet()).toThrow('无法获取工作簿')
    })

    it('已存在且表头正确时不改写表头', () => {
      const cells: Record<string, unknown> = {}
      for (const [index, header] of ENRICH_RECORD_COLUMNS.entries()) {
        cells[`${String.fromCodePoint(65 + index)}1`] = header
      }
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME, cells })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const result = getOrCreateEnrichRecordSheet()

      expect(result.Name).toBe(ENRICH_RECORD_SHEET_NAME)
      expect(getWritten('A1')).toBeUndefined()
      expect(mockBgmLog).not.toHaveBeenCalled()
    })

    it('表头不符时逐列修复并记录日志', () => {
      const sheet = createMockSheet({
        name: ENRICH_RECORD_SHEET_NAME,
        cells: { A1: '时间', B1: '匹配方式' },
      })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      getOrCreateEnrichRecordSheet()

      expect(getWritten('A1')).toBe('时间戳')
      expect(getWritten('C1')).toBe('动漫名称')
      expect(getWritten('I1')).toBe('备注')
      const messages = mockBgmLog.mock.calls.map((call) => call[1])
      expect(messages.some((m) => m.includes('修复表头'))).toBe(true)
    })

    it('表不存在时新建：命名、写表头、置灰、移动到末尾、设字体与列宽', () => {
      const added = createMockSheet({ name: 'NewSheet' })
      const wb = createMockWorkbook([])
      wb.Sheets.Add = vi.fn(() => added)
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

      const result = getOrCreateEnrichRecordSheet()

      expect(wb.Sheets.Add).toHaveBeenCalledTimes(1)
      expect(result.Name).toBe(ENRICH_RECORD_SHEET_NAME)
      // 表头已收敛为一次矩形写（writeSheetHeaderRow），地址为 A1:I1
      expect(getWritten('A1:I1')).toEqual([ENRICH_RECORD_COLUMNS])
      expect(getInteriorColor('A1:I1')).toBe(BGM_COLOR.GRAY)
      expect(added.Move).toHaveBeenCalledTimes(1)
      const createdMessages = mockBgmLog.mock.calls.map((call) => call[1])
      expect(createdMessages).toContain('已创建富化记录工作表')
    })

    it('新建时 Move 失败仅记录错误、不影响返回', () => {
      flags.throwOnMove = true
      const wb = createMockWorkbook([])
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

      const result = getOrCreateEnrichRecordSheet()

      expect(result.Name).toBe(ENRICH_RECORD_SHEET_NAME)
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'getOrCreateEnrichRecordSheet' }),
      )
    })

    it('新建时字体设置失败被忽略', () => {
      flags.throwOnFontName = true
      const wb = createMockWorkbook([])
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

      expect(() => getOrCreateEnrichRecordSheet()).not.toThrow()
    })

    it('新建时列宽自适应失败被忽略', () => {
      flags.throwOnAutoFit = true
      const wb = createMockWorkbook([])
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

      expect(() => getOrCreateEnrichRecordSheet()).not.toThrow()
    })

    it('遍历工作表抛错时降级为新建', () => {
      const wb = createMockWorkbook([], true)
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

      const result = getOrCreateEnrichRecordSheet()

      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'getOrCreateEnrichRecordSheet' }),
      )
      expect(result.Name).toBe(ENRICH_RECORD_SHEET_NAME)
    })
  })

  describe('addEnrichRecord 写单条', () => {
    it('按 UsedRange 定位下一行并写入全部字段', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const isOk = addEnrichRecord(makeRecord({ note: '备注内容' }))

      expect(isOk).toBe(true)
      expect(mockSetCellValue).toHaveBeenCalledTimes(9)
      expect(mockSetCellValue).toHaveBeenCalledWith(
        sheet,
        11,
        ENRICH_RECORD_COLUMN.TIMESTAMP,
        '2026-09-14 20:00:00',
      )
      expect(mockSetCellValue).toHaveBeenCalledWith(sheet, 11, ENRICH_RECORD_COLUMN.ROW, 12)
      expect(mockSetCellValue).toHaveBeenCalledWith(
        sheet,
        11,
        ENRICH_RECORD_COLUMN.NOTE,
        '备注内容',
      )
      expect(getInteriorColor('H11')).toBe(BGM_COLOR.SUCCESS)
    })

    it('note 缺省时不写第 9 列', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const isOk = addEnrichRecord(makeRecord())

      expect(isOk).toBe(true)
      expect(mockSetCellValue).toHaveBeenCalledTimes(8)
    })

    it('UsedRange 缺失且行数大于 1 时落到第 2 行', () => {
      const sheet = createMockSheet({
        name: ENRICH_RECORD_SHEET_NAME,
        usedRange: null,
        rowCount: 50,
      })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      addEnrichRecord(makeRecord())

      expect(mockSetCellValue).toHaveBeenCalledWith(
        sheet,
        2,
        ENRICH_RECORD_COLUMN.NAME,
        '葬送的芙莉莲',
      )
    })

    it('UsedRange 缺失且只有 1 行时落到第 1 行', () => {
      const sheet = createMockSheet({
        name: ENRICH_RECORD_SHEET_NAME,
        usedRange: null,
        rowCount: 1,
      })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      addEnrichRecord(makeRecord())

      expect(mockSetCellValue).toHaveBeenCalledWith(
        sheet,
        1,
        ENRICH_RECORD_COLUMN.NAME,
        '葬送的芙莉莲',
      )
    })

    it('操作单元格无 Interior 时跳过着色', () => {
      flags.withInterior = false
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const isOk = addEnrichRecord(makeRecord())

      expect(isOk).toBe(true)
      expect(getInteriorColor('H11')).toBeUndefined()
    })

    it('写入异常时返回 false 并记录错误', () => {
      flags.throwOnWrite = true
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const isOk = addEnrichRecord(makeRecord())

      expect(isOk).toBe(false)
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'addEnrichRecord' }),
      )
    })

    it('建表失败（无工作簿）时返回 false 而非抛出', () => {
      mockGetApp.mockReturnValue(null)

      const isOk = addEnrichRecord(makeRecord())

      expect(isOk).toBe(false)
      expect(mockHandleError).toHaveBeenCalled()
    })
  })

  describe('addEnrichRecords 批量写入', () => {
    it('空数组直接返回 true 且不建表', () => {
      const isOk = addEnrichRecords([])

      expect(isOk).toBe(true)
      expect(mockGetApp).not.toHaveBeenCalled()
    })

    it('按 UsedRange 定位起始行，一次矩形写入全部记录', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const isOk = addEnrichRecords([
        makeRecord({ name: 'A', action: 'fill' }),
        makeRecord({ name: 'B', action: 'error' }),
      ])

      expect(isOk).toBe(true)
      // 铁律：二维数组按自身形状一次矩形写入，地址须为 A11:I12（2 行 × 9 列）
      expect(getWritten('A11:I12')).toEqual([
        ['2026-09-14 20:00:00', '精确', 'A', '12', '标签', '', '奇幻', 'fill', ''],
        ['2026-09-14 20:00:00', '精确', 'B', '12', '标签', '', '奇幻', 'error', ''],
      ])
    })

    it('逐行按操作类型着色', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      addEnrichRecords([
        makeRecord({ action: 'fill' }),
        makeRecord({ action: 'error' }),
        makeRecord({ action: 'skip' }),
      ])

      expect(getInteriorColor('H11')).toBe(BGM_COLOR.SUCCESS)
      expect(getInteriorColor('H12')).toBe(BGM_COLOR.FAIL)
      expect(getInteriorColor('H13')).toBe(BGM_COLOR.SKIP)
    })

    it('UsedRange 缺失时从第 2 行开始', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME, usedRange: null })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      addEnrichRecords([makeRecord()])

      expect(getWritten('A2:I2')).toBeDefined()
    })

    it('操作单元格无 Interior 时跳过着色', () => {
      flags.withInterior = false
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const isOk = addEnrichRecords([makeRecord()])

      expect(isOk).toBe(true)
      expect(getInteriorColor('H11')).toBeUndefined()
    })

    it('批量写入异常时返回 false 并记录错误', () => {
      flags.throwOnWrite = true
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      const isOk = addEnrichRecords([makeRecord()])

      expect(isOk).toBe(false)
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'addEnrichRecords' }),
      )
    })
  })

  describe('clearEnrichRecords 清空记录', () => {
    it('删除第 2 行到末行', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      clearEnrichRecords()

      const target = sheet.Range('2:10')
      expect(target.Delete).toHaveBeenCalledTimes(1)
      const clearMessages = mockBgmLog.mock.calls.map((call) => call[1])
      expect(clearMessages).toContain('已清除所有富化记录')
    })

    it('UsedRange 缺失时用总行数兜底', () => {
      const sheet = createMockSheet({
        name: ENRICH_RECORD_SHEET_NAME,
        usedRange: null,
        rowCount: 60,
      })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      clearEnrichRecords()

      expect(sheet.Range('2:60').Delete).toHaveBeenCalledTimes(1)
    })

    it('只有表头行时不删除', () => {
      const sheet = createMockSheet({
        name: ENRICH_RECORD_SHEET_NAME,
        usedRange: { Row: 1, Rows: { Count: 1 } },
      })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      clearEnrichRecords()

      expect(sheet.Range('2:1').Delete).not.toHaveBeenCalled()
    })

    it('删除异常时记录错误', () => {
      flags.throwOnDelete = true
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      expect(() => clearEnrichRecords()).not.toThrow()
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'clearEnrichRecords' }),
      )
    })
  })

  describe('getAllEnrichRecords 读取记录', () => {
    it('无应用时返回空数组', () => {
      mockGetApp.mockReturnValue(null)

      expect(getAllEnrichRecords()).toEqual([])
    })

    it('无 ActiveWorkbook 时返回空数组', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: null })

      expect(getAllEnrichRecords()).toEqual([])
    })

    it('富化记录表不存在时返回空数组', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([]) })

      expect(getAllEnrichRecords()).toEqual([])
    })

    it('只有表头行时返回空数组', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(1)

      expect(getAllEnrichRecords()).toEqual([])
    })

    it('读到空数据块时返回空数组', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockReadRangeValues.mockReturnValue([])

      expect(getAllEnrichRecords()).toEqual([])
    })

    it('按列映射解析出完整记录', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(3)
      mockReadRangeValues.mockReturnValue([
        ['2026-09-14 20:00:00', '精确', '葬送的芙莉莲', '12', '标签', '', '奇幻', 'fill', '备注A'],
        ['2026-09-14 20:01:00', '别名', '芙莉莲', '13', '平台', '', 'B站', 'append', '备注B'],
      ])

      const records = getAllEnrichRecords()

      expect(records).toHaveLength(2)
      expect(records[0]).toEqual({
        timestamp: '2026-09-14 20:00:00',
        matchType: '精确',
        name: '葬送的芙莉莲',
        row: 12,
        enrichedField: '标签',
        oldValue: '',
        updatedValue: '奇幻',
        action: 'fill',
        note: '备注A',
      })
      expect(records[1]?.row).toBe(13)
      expect(records[1]?.action).toBe('append')
    })

    it('缺失列回退默认值：匹配方式→未匹配、操作→skip、行号→0', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(2)
      mockReadRangeValues.mockReturnValue([
        [
          't',
          undefined as unknown as string,
          'n',
          'abc',
          'f',
          '',
          '',
          undefined as unknown as string,
          '',
        ],
      ])

      const records = getAllEnrichRecords()

      expect(records[0]?.matchType).toBe('未匹配')
      expect(records[0]?.action).toBe('skip')
      expect(records[0]?.row).toBe(0)
    })

    it('小数行号截断为整数', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(2)
      mockReadRangeValues.mockReturnValue([['t', '精确', 'n', '12.9', 'f', '', '', 'fill', '']])

      expect(getAllEnrichRecords()[0]?.row).toBe(12)
    })

    it('遍历工作表抛错时返回空数组并记录错误', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([], true) })

      expect(getAllEnrichRecords()).toEqual([])
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'getAllEnrichRecords' }),
      )
    })

    it('读取异常时返回空数组并记录错误', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockReadRangeValues.mockImplementation(() => {
        throw new Error('读取失败')
      })

      expect(getAllEnrichRecords()).toEqual([])
      expect(mockHandleError).toHaveBeenCalled()
    })
  })

  describe('getEnrichRecordSheetIfExists 存在性查询', () => {
    it('无应用时返回 null', () => {
      mockGetApp.mockReturnValue(null)

      expect(getEnrichRecordSheetIfExists()).toBeNull()
    })

    it('无 ActiveWorkbook 时返回 null', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: null })

      expect(getEnrichRecordSheetIfExists()).toBeNull()
    })

    it('找到时返回该表', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      expect(getEnrichRecordSheetIfExists()).toBe(sheet)
    })

    it('不存在时返回 null', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([]) })

      expect(getEnrichRecordSheetIfExists()).toBeNull()
    })

    it('读取抛错时返回 null', () => {
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          get Worksheets(): never {
            throw new Error('宿主异常')
          },
        },
      })

      expect(getEnrichRecordSheetIfExists()).toBeNull()
    })
  })

  describe('openEnrichRecordSheet 打开记录表', () => {
    it('激活富化记录表', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      openEnrichRecordSheet()

      expect(sheet.Activate).toHaveBeenCalledTimes(1)
    })

    it('激活失败时弹窗提示用户', () => {
      flags.throwOnActivate = true
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      openEnrichRecordSheet()

      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'openEnrichRecordSheet', showAlert: true }),
      )
    })
  })

  describe('formatEnrichRecordSheet 样式格式化', () => {
    it('重写表头并设置表头样式', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(10)

      formatEnrichRecordSheet()

      // 表头重写已收敛为一次矩形写（writeSheetHeaderRow），不再逐格 setCellValue
      expect(mockSetCellValue).not.toHaveBeenCalled()
      expect(getWritten('A1:I1')).toEqual([ENRICH_RECORD_COLUMNS])
      expect(fontBolds.get('1:1')).toBe(true)
      expect(getInteriorColor('1:1')).toBe(BGM_COLOR.GRAY)
      expect(sheet.Range('1:1').HorizontalAlignment).toBe(-4108)
    })

    it('有数据行时加边框', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(10)

      formatEnrichRecordSheet()

      expect(sheet.Range('A2:I10').Borders.LineStyle).toBe(1)
    })

    it('无数据行时不加边框', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(1)

      formatEnrichRecordSheet()

      expect(sheet.Range('A2:I1').Borders.LineStyle).toBe(0)
    })

    it('设置各列列宽，动漫名称/原字段/新字段/备注更宽', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockReturnValue(5)

      formatEnrichRecordSheet()

      expect(sheet.Range('A:A').ColumnWidth).toBe(15)
      expect(sheet.Range('C:C').ColumnWidth).toBe(25)
      expect(sheet.Range('F:F').ColumnWidth).toBe(20)
      expect(sheet.Range('G:G').ColumnWidth).toBe(40)
      expect(sheet.Range('I:I').ColumnWidth).toBe(20)
    })

    it('表头无 Font 时跳过加粗', () => {
      flags.withFont = false
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      expect(() => formatEnrichRecordSheet()).not.toThrow()
      expect(fontBolds.get('1:1')).toBeUndefined()
    })

    it('表头无 Interior 时跳过底色', () => {
      flags.withInterior = false
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })

      expect(() => formatEnrichRecordSheet()).not.toThrow()
      expect(getInteriorColor('1:1')).toBeUndefined()
    })

    it('格式化异常时记录错误', () => {
      const sheet = createMockSheet({ name: ENRICH_RECORD_SHEET_NAME })
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook([sheet]) })
      mockGetLastRow.mockImplementation(() => {
        throw new Error('取末行失败')
      })

      expect(() => formatEnrichRecordSheet()).not.toThrow()
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'formatEnrichRecordSheet' }),
      )
    })
  })

  describe('常量一致性', () => {
    it('列名与列号常量一一对应', () => {
      expect(ENRICH_RECORD_COLUMNS).toHaveLength(9)
      expect(ENRICH_RECORD_COLUMN.TIMESTAMP).toBe(1)
      expect(ENRICH_RECORD_COLUMN.NOTE).toBe(9)
      expect(ENRICH_RECORD_COLUMNS[ENRICH_RECORD_COLUMN.NAME - 1]).toBe('动漫名称')
      expect(ENRICH_RECORD_COLUMNS[ENRICH_RECORD_COLUMN.ACTION - 1]).toBe('操作类型')
    })

    it('表名常量为「富化记录」', () => {
      expect(ENRICH_RECORD_SHEET_NAME).toBe('富化记录')
    })
  })
})
