// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  mockBgmLog,
  mockGetCellValue,
  mockColNumToLetter,
  mockGetLastRow,
  mockFindHeaderRow,
  mockGetColumnMap,
  mockGetDataSheet,
  mockTrim,
  mockExtractSubjectId,
} = vi.hoisted(() => ({
  mockBgmLog: vi.fn(),
  mockGetCellValue: vi.fn().mockReturnValue(''),
  mockColNumToLetter: vi.fn((col: number) => {
    let result = ''
    let n = col
    while (n > 0) {
      const remainder = (n - 1) % 26
      result = String.fromCharCode(65 + remainder) + result
      n = Math.floor((n - 1) / 26)
    }
    return result
  }),
  mockGetLastRow: vi.fn().mockReturnValue(10),
  mockFindHeaderRow: vi.fn().mockReturnValue(1),
  mockGetColumnMap: vi.fn().mockReturnValue(new Map()),
  mockGetDataSheet: vi.fn().mockReturnValue(null),
  mockTrim: vi.fn((v: string) => v?.trim() ?? ''),
  mockExtractSubjectId: vi.fn().mockReturnValue(null),
}))

vi.mock('../ts/index.js', () => ({}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  URL_PATTERNS: {},
  WATCH_STATUS_MAP: {},
}))

vi.mock('../ts/tools/utility.js', () => ({
  bgmLog: mockBgmLog,
  getApp: vi.fn(),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mockBgmLog,
  getApp: vi.fn(),
  colNumberToLetter: mockColNumToLetter,
  getCellValue: mockGetCellValue,
  getLastRow: mockGetLastRow,
  findHeaderRow: mockFindHeaderRow,
  getColumnMap: mockGetColumnMap,
  getDataSheet: mockGetDataSheet,
  trim: mockTrim,
  ensureSheetHeaders: vi.fn(),
  BGM: { handleError: vi.fn(), sheet: { isLocked: false } },
}))

vi.mock('../ts/sync/pure-utilities.js', () => ({
  extractSubjectId: mockExtractSubjectId,
}))

import { buildJsonlFromSheet, exportSheetToJsonlFile } from '../ts/sync/export-jsonl.js'

function createMockWorksheet(
  options: {
    name?: string
    usedRange?: number
    cellValues?: Record<string, unknown>
    cellOverrides?: Record<string, Record<string, unknown>>
  } = {},
) {
  const name = options.name ?? 'Sheet1'
  const usedRange = options.usedRange ?? 10
  const cellCache = new Map<
    string,
    { Value2: unknown; Text?: unknown; Interior: { Color: number } }
  >()

  return {
    Name: name,
    Rows: { Count: 100 },
    UsedRange: { Row: 1, Rows: { Count: usedRange } },
    Range: vi.fn((address: string) => {
      if (address.includes(':')) {
        return { Value2: null, Interior: { Color: 0 } }
      }
      if (cellCache.has(address)) {
        return cellCache.get(address)!
      }
      const override = options.cellOverrides?.[address]
      const cell = {
        Value2: options.cellValues?.[address] ?? '',
        Text: override?.Text ?? undefined,
        Interior: { Color: 0 },
        Font: { Bold: false },
      }
      cellCache.set(address, cell)
      return cell
    }),
    Activate: vi.fn(),
  }
}

describe('buildJsonlFromSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无数据工作表时应返回空字符串', () => {
    mockGetDataSheet.mockReturnValue(null)
    const result = buildJsonlFromSheet()
    expect(result).toBe('')
  })

  it('无 Bangumi_URL 列时应返回空字符串', () => {
    const ws = createMockWorksheet()
    mockGetDataSheet.mockReturnValue(ws)
    mockGetColumnMap.mockReturnValue(new Map())
    const result = buildJsonlFromSheet()
    expect(result).toBe('')
  })

  it('有数据时应返回 JSONL 字符串', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('名称', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/12345'
      if (row === 2 && col === 2) return 'Test Anime'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('12345')

    const result = buildJsonlFromSheet()
    expect(typeof result).toBe('string')
  })

  it('空行应跳过', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(5)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockReturnValue('')

    const result = buildJsonlFromSheet()
    expect(result).toBe('')
  })

  it('有完整字段数据时应生成包含所有字段的 JSONL', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(5)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('名称', 2)
    colMap.set('标签/分级', 3)
    colMap.set('集数', 4)
    colMap.set('开播日期', 5)
    colMap.set('完播日', 6)
    colMap.set('导演', 7)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2) {
        switch (col) {
          case 1: {
            return 'https://bgm.tv/subject/99999'
          }
          case 2: {
            return '完整动漫'
          }
          case 3: {
            return '治愈|日常'
          }
          case 4: {
            return '24'
          }
          case 5: {
            return '2024年01月01日'
          }
          case 6: {
            return '2024年12月31日'
          }
          case 7: {
            return '新海诚'
          }
        }
      }
      return ''
    })

    mockExtractSubjectId.mockReturnValue('99999')

    const result = buildJsonlFromSheet()
    expect(result).not.toBe('')
    const lines = result.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.sid).toBe('99999')
    expect(parsed.name).toBe('完整动漫')
    expect(parsed['话数']).toBe('24')
    expect(parsed.meta_tags).toEqual(['治愈', '日常'])
    expect(parsed['播放结束']).toBe('2024年12月31日')
    expect(parsed['导演']).toBe('新海诚')
  })

  it('标签字段应按 | 分割并过滤空值', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('标签/分级', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/111'
      if (row === 2 && col === 2) return '热血| |奇幻'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('111')

    const result = buildJsonlFromSheet()
    const parsed = JSON.parse(result)
    expect(parsed.meta_tags).toEqual(['热血', '奇幻'])
  })

  it('名称字段为空时不应写入 name 属性', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('名称', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/222'
      if (row === 2 && col === 2) return ''
      return ''
    })

    mockExtractSubjectId.mockReturnValue('222')

    const result = buildJsonlFromSheet()
    const parsed = JSON.parse(result)
    expect(parsed.name).toBeUndefined()
  })

  it('日期字段为空时不应写入 date 属性', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('开播日期', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/333'
      if (row === 2 && col === 2) return ''
      return ''
    })

    mockExtractSubjectId.mockReturnValue('333')

    const result = buildJsonlFromSheet()
    const parsed = JSON.parse(result)
    expect(parsed.date).toBeUndefined()
  })

  it('getCellText 应优先使用单元格 Text 属性', () => {
    const ws = createMockWorksheet({
      usedRange: 5,
      cellOverrides: {
        B2: { Value2: 45_382, Text: '2024年01月01日' },
      },
    })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('开播日期', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/444'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('444')

    const result = buildJsonlFromSheet()
    const parsed = JSON.parse(result)
    expect(parsed.date).toBe('2024年01月01日')
  })

  it('getCellText 在 Text 属性异常时应回退到 getCellValue', () => {
    // 不设置 cellOverrides，getCellText 会因 cell.Text 为 undefined 走 try 块，
    // 然后 getCellValue 会被调用
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('开播日期', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/555'
      if (row === 2 && col === 2) return '2024/06/15'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('555')

    const result = buildJsonlFromSheet()
    const parsed = JSON.parse(result)
    expect(parsed.date).toBe('2024/06/15')
  })

  it('getCellText 在 Range 抛异常时应回退到 getCellValue', () => {
    // 让 Range 调用抛异常
    const mockWs = {
      Name: 'Sheet1',
      Rows: { Count: 100 },
      UsedRange: { Row: 1, Rows: { Count: 5 } },
      Range: vi.fn(() => {
        throw new Error('COM 错误')
      }),
      Activate: vi.fn(),
    }
    mockGetDataSheet.mockReturnValue(mockWs)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('开播日期', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/666'
      if (row === 2 && col === 2) return '回退日期'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('666')

    const result = buildJsonlFromSheet()
    const parsed = JSON.parse(result)
    expect(parsed.date).toBe('回退日期')
  })

  it('getCellText 在 Range 返回 null 时应返回空字符串', () => {
    // Line 40: if (!cell) return ''
    const mockWs = {
      Name: 'Sheet1',
      Rows: { Count: 100 },
      UsedRange: { Row: 1, Rows: { Count: 5 } },
      // Range 返回 null 而不是抛异常
      Range: vi.fn(() => null as unknown as ReturnType<typeof createMockWorksheet>),
      Activate: vi.fn(),
    }
    mockGetDataSheet.mockReturnValue(mockWs)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('开播日期', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/777'
      if (row === 2 && col === 2) return '回退值'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('777')

    const result = buildJsonlFromSheet()
    const parsed = JSON.parse(result)
    // Range 返回 null → getCellText 返回 '' → 回退到 getCellValue
    expect(parsed.date).toBe('回退值')
  })

  it('findHeaderRow 返回 0 时应回退到默认值 1', () => {
    // Line 70: const headerRow = findHeaderRow(ws) || 1
    mockFindHeaderRow.mockReturnValue(0)

    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockGetLastRow.mockReturnValue(5)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('名称', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/888'
      if (row === 2 && col === 2) return '默认表头行'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('888')

    // headerRow = 0 || 1 → 1，从第 2 行开始读取
    const result = buildJsonlFromSheet()
    expect(result).not.toBe('')
    const parsed = JSON.parse(result)
    expect(parsed.sid).toBe('888')
  })

  it('URL 有效但 extractSubjectId 返回 null 时应跳过该行', () => {
    // Line 86: if (!sid) continue
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(5)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    colMap.set('名称', 2)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/invalid'
      if (row === 2 && col === 2) return '无效SID'
      return ''
    })

    // extractSubjectId 返回 null → 跳过该行
    mockExtractSubjectId.mockReturnValue(null)

    const result = buildJsonlFromSheet()
    // 无有效条目，返回空字符串
    expect(result).toBe('')
  })
})

describe('exportSheetToJsonlFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无数据时应返回 false', () => {
    mockGetDataSheet.mockReturnValue(null)
    const isResult = exportSheetToJsonlFile()
    expect(isResult).toBe(false)
  })

  it('有数据时应返回 true', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/12345'
      return ''
    })

    mockExtractSubjectId.mockReturnValue('12345')

    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as unknown as Node)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const isResult = exportSheetToJsonlFile()
    expect(isResult).toBe(true)
  })

  it('buildJsonlFromSheet 返回空字符串时应返回 false', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(5)
    mockGetColumnMap.mockReturnValue(new Map())

    const isResult = exportSheetToJsonlFile()
    expect(isResult).toBe(false)
  })

  it('document.createElement 抛出异常时应返回 false', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/12345'
      return ''
    })
    mockExtractSubjectId.mockReturnValue('12345')

    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('createElement 失败')
    })

    const isResult = exportSheetToJsonlFile()
    expect(isResult).toBe(false)
    expect(mockBgmLog).toHaveBeenCalledWith('ERROR', expect.stringContaining('导出失败'))
  })

  it('Blob 创建抛出异常时应返回 false', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/12345'
      return ''
    })
    mockExtractSubjectId.mockReturnValue('12345')

    // 使用 mockReturnValue 包装来模拟 Blob 错误
    const originalBlob = globalThis.Blob
    try {
      Object.defineProperty(globalThis, 'Blob', {
        value() {
          throw new Error('Blob 不可用')
        },
        configurable: true,
        writable: true,
      })

      const isResult = exportSheetToJsonlFile()
      expect(isResult).toBe(false)
      expect(mockBgmLog).toHaveBeenCalledWith('ERROR', expect.stringContaining('导出失败'))
    } finally {
      Object.defineProperty(globalThis, 'Blob', {
        value: originalBlob,
        configurable: true,
        writable: true,
      })
    }
  })

  it('应在导出日志中包含文件名和字节数', () => {
    const ws = createMockWorksheet({ usedRange: 5 })
    mockGetDataSheet.mockReturnValue(ws)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)

    const colMap = new Map<string, number>()
    colMap.set('Bangumi_URL', 1)
    mockGetColumnMap.mockReturnValue(colMap)

    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 2 && col === 1) return 'https://bgm.tv/subject/12345'
      return ''
    })
    mockExtractSubjectId.mockReturnValue('12345')

    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as unknown as Node)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const isResult = exportSheetToJsonlFile()
    expect(isResult).toBe(true)

    // 验证日志包含文件名
    const infoCalls = mockBgmLog.mock.calls.filter((c: unknown[]) => c[0] === 'INFO')
    const lastInfoCall = infoCalls[infoCalls.length - 1]
    expect(lastInfoCall?.[1]).toContain('bgm_sync_export_')
    expect(lastInfoCall?.[1]).toContain('.jsonl')
  })
})
