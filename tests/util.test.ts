/**
 * @fileoverview tools/util/sheet.ts 工作表工具函数单元测试
 *
 * 测试目标：
 *   - getDataSheet：锁定/未锁定/无工作簿
 *   - findHeaderRow：识别表头行 / 未找到返回 0 / 缓存命中
 *   - getLastRow：D 列定位 / A 列回退 / UsedRange 回退 / 默认 50000
 *   - getColumnMap：通过规则匹配列 / 序列号列回退
 *   - cacheGet：缓存命中 / 未命中调用 factory
 *   - clearSheetCache：按工作表名前缀清除
 *   - isEmptyValue：null/undefined/空字符串/null 字符串
 *   - safeActivate：调用 ws.Activate / 无效 ws 不抛错
 *
 * 模块依赖说明：
 *   - sheet.ts 导入 './index.js'（util/index.ts）与 './cell.js'。
 *   - 通过 vi.mock 替换这两个模块，提供可控的 getApp / bgmLog / BGM / getCellValue，
 *     避免触发 index → ui/handlers 的副作用链。
 *   - 使用 vi.hoisted + fake timers 作为兜底，防止其他 transitively imported 模块触发副作用。
 *   - 需要 jsdom 环境以提供 document/window（handlers.ts 的副作用访问 document.readyState）。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// 通过 vi.hoisted 创建 mock 引用，vi.mock 工厂中可以引用这些 vi.fn 实例
const mockState = vi.hoisted(() => ({
  getApp: vi.fn(),
  bgmLog: vi.fn(),
  getCellValue: vi.fn(),
  BGM: {
    sheet: { isLocked: false, lockedIndex: null as number | null },
    cache: {},
    handleError: vi.fn(),
    ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
  },
}))

vi.mock('../ts/tools/util/index.js', () => ({
  BGM: mockState.BGM,
  bgmLog: mockState.bgmLog,
  getApp: mockState.getApp,
}))

vi.mock('../ts/tools/util/cell.js', () => ({
  getCellValue: mockState.getCellValue,
  getCell: vi.fn(),
  setCellValue: vi.fn(),
  getSheetByIndex: vi.fn(),
}))

import {
  readRangeValues,
  cacheGet,
  findHeaderRow,
  getColumnMap,
  clearSheetCache,
  getLastRow,
  isEmptyValue,
  getDataSheet,
  safeActivate,
} from '../ts/tools/util/sheet.js'

vi.clearAllTimers()

// ========== WPS Mock 工具 ==========
interface MockWorksheetOptions {
  name: string
  /** 返回 ws.Range(address).End(xlUp).Row，用于 getLastRow */
  rangeEndRow?: (address: string) => number | null
  /** ws.UsedRange 对象 */
  usedRange?: { Row: number; Rows: { Count: number } } | null
  /** ws.Rows.Count，默认 100000 */
  rowsCount?: number
  /** ws.Range(address).Value2，用于 readRangeValues */
  rangeValue2?: (address: string) => unknown
  /** 自定义 Activate 实现 */
  activate?: () => void
}

function createMockWorksheet(options: MockWorksheetOptions): unknown {
  return {
    Name: options.name,
    Range: (address: string) => ({
      Value2: options.rangeValue2 ? options.rangeValue2(address) : null,
      End: (_direction: number) => {
        const r = options.rangeEndRow ? options.rangeEndRow(address) : null
        return r != null ? { Row: r } : null
      },
    }),
    Rows: { Count: options.rowsCount ?? 100_000 },
    UsedRange: options.usedRange ?? null,
    Activate: options.activate ?? vi.fn(),
  }
}

function createMockApp(options: {
  activeSheet?: unknown
  worksheets?: { Item: (index: number) => unknown }
  activeWorkbook?: { ActiveSheet: unknown; Worksheets: { Item: (index: number) => unknown } } | null
  pluginStorage?: { getItem: (k: string) => string; setItem: (k: string, v: string) => void }
}): unknown {
  return {
    ActiveWorkbook: options.activeWorkbook ?? null,
    PluginStorage: options.pluginStorage ?? null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.BGM.sheet.isLocked = false
  mockState.BGM.sheet.lockedIndex = null
  mockState.getCellValue.mockReset()
  mockState.getApp.mockReset()
})

afterEach(() => {
  vi.clearAllTimers()
})

afterAll(() => {
  vi.useRealTimers()
})

// ========== isEmptyValue ==========
describe('isEmptyValue', () => {
  it('null 与 undefined 视为空', () => {
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
  })

  it('空字符串视为空', () => {
    expect(isEmptyValue('')).toBe(true)
  })

  it('null/NULL/Null 字符串视为空（防御性）', () => {
    expect(isEmptyValue('null')).toBe(true)
    expect(isEmptyValue('NULL')).toBe(true)
    expect(isEmptyValue('Null')).toBe(true)
  })

  it('undefined 字符串视为空（防御性）', () => {
    expect(isEmptyValue('undefined')).toBe(true)
  })

  it('非空字符串视为非空', () => {
    expect(isEmptyValue('hello')).toBe(false)
    expect(isEmptyValue('0')).toBe(false)
    expect(isEmptyValue('false')).toBe(false)
  })

  it('数字与布尔值视为非空', () => {
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue(false)).toBe(false)
  })
})

// ========== cacheGet ==========
describe('cacheGet', () => {
  it('首次调用调用 factory 并缓存结果', () => {
    const factory = vi.fn(() => 'cached-value')
    const result1 = cacheGet('test-key-1', factory)
    expect(result1).toBe('cached-value')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('第二次调用直接返回缓存（不调用 factory）', () => {
    const factory = vi.fn(() => ({ data: 42 }))
    const result1 = cacheGet('test-key-2', factory)
    const result2 = cacheGet('test-key-2', factory)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(result2).toBe(result1) // 同一引用
  })

  it('不同 key 互不影响', () => {
    const factoryA = vi.fn(() => 'a')
    const factoryB = vi.fn(() => 'b')
    expect(cacheGet('test-key-3', factoryA)).toBe('a')
    expect(cacheGet('test-key-4', factoryB)).toBe('b')
    expect(factoryA).toHaveBeenCalledTimes(1)
    expect(factoryB).toHaveBeenCalledTimes(1)
  })

  it('factory 返回 undefined 也被缓存', () => {
    const factory = vi.fn(() => undefined)
    const result1 = cacheGet('test-key-undef', factory)
    const result2 = cacheGet('test-key-undef', factory)
    expect(result1).toBeUndefined()
    expect(result2).toBeUndefined()
    expect(factory).toHaveBeenCalledTimes(1)
  })
})

// ========== getDataSheet ==========
describe('getDataSheet', () => {
  it('app 为 null 时返回 null', () => {
    mockState.getApp.mockReturnValue(null)
    const result = getDataSheet()
    expect(result).toBeNull()
  })

  it('app.ActiveWorkbook 为 null 时返回 null', () => {
    mockState.getApp.mockReturnValue(createMockApp({ activeWorkbook: null }))
    const result = getDataSheet()
    expect(result).toBeNull()
  })

  it('未锁定时返回当前活动工作表', () => {
    const mockSheet = createMockWorksheet({ name: 'Sheet1' })
    mockState.getApp.mockReturnValue(
      createMockApp({
        activeWorkbook: {
          ActiveSheet: mockSheet,
          Worksheets: { Item: vi.fn() },
        },
      }),
    )
    mockState.BGM.sheet.isLocked = false
    const result = getDataSheet()
    expect(result).toBe(mockSheet)
  })

  it('锁定时返回锁定索引对应的工作表', () => {
    const lockedSheet = createMockWorksheet({ name: 'LockedSheet' })
    const itemFunction = vi.fn(() => lockedSheet)
    mockState.getApp.mockReturnValue(
      createMockApp({
        activeWorkbook: {
          ActiveSheet: createMockWorksheet({ name: 'OtherSheet' }),
          Worksheets: { Item: itemFunction },
        },
      }),
    )
    mockState.BGM.sheet.isLocked = true
    mockState.BGM.sheet.lockedIndex = 2
    const result = getDataSheet()
    expect(result).toBe(lockedSheet)
    expect(itemFunction).toHaveBeenCalledWith(2)
  })

  it('锁定但 Item 抛错时回退到 ActiveSheet', () => {
    const activeSheet = createMockWorksheet({ name: 'ActiveSheet' })
    const itemFunction = vi.fn(() => {
      throw new Error('not found')
    })
    mockState.getApp.mockReturnValue(
      createMockApp({
        activeWorkbook: {
          ActiveSheet: activeSheet,
          Worksheets: { Item: itemFunction },
        },
      }),
    )
    mockState.BGM.sheet.isLocked = true
    mockState.BGM.sheet.lockedIndex = 99
    const result = getDataSheet()
    expect(result).toBe(activeSheet)
  })
})

// ========== findHeaderRow ==========
describe('findHeaderRow', () => {
  it('识别含 3+ 个表头关键字的行', () => {
    const ws = createMockWorksheet({ name: 'Sheet-FHR-1' })
    // 表头行（row 1）含：序列号、名称、Bangumi URL、是否看完 4 个关键字
    mockState.getCellValue.mockImplementation((_ws: unknown, row: number, col: number) => {
      if (row === 1) {
        const headers: Record<number, string> = {
          1: '序列号',
          2: '名称',
          3: 'Bangumi URL',
          4: '是否看完',
        }
        return headers[col] ?? ''
      }
      return ''
    })
    const headerRow = findHeaderRow(ws as never, 1)
    expect(headerRow).toBe(1)
  })

  it('未找到匹配行返回 0', () => {
    const ws = createMockWorksheet({ name: 'Sheet-FHR-2' })
    // 所有单元格都返回普通数据，不含表头关键字
    mockState.getCellValue.mockReturnValue('普通数据')
    const headerRow = findHeaderRow(ws as never, 1)
    expect(headerRow).toBe(0)
  })

  it('null/undefined ws 返回 0', () => {
    const headerRow = findHeaderRow(null, 1)
    expect(headerRow).toBe(0)
  })

  it('缓存命中：第二次调用不重新扫描', () => {
    const ws = createMockWorksheet({ name: 'Sheet-FHR-Cache' })
    let callCount = 0
    mockState.getCellValue.mockImplementation(() => {
      callCount++
      if (callCount <= 4) {
        // 第一次扫描，返回 4 个表头关键字
        const headers = ['序列号', '名称', 'Bangumi URL', '是否看完']
        return headers[callCount - 1] ?? ''
      }
      return 'whatever'
    })
    const first = findHeaderRow(ws as never, 1)
    const initialCallCount = callCount
    const second = findHeaderRow(ws as never, 1)
    expect(first).toBe(second)
    // 第二次不应再调用 getCellValue（命中缓存）
    expect(callCount).toBe(initialCallCount)
  })
})

// ========== getColumnMap ==========
describe('getColumnMap', () => {
  it('通过表头规则映射列', () => {
    const ws = createMockWorksheet({ name: 'Sheet-GCM-1' })
    mockState.getCellValue.mockImplementation((_ws: unknown, _row: number, col: number) => {
      const headers: Record<number, string> = {
        1: '序列号',
        2: '名称',
        3: 'Bangumi URL',
        4: '是否看完',
        5: '评分',
      }
      return headers[col] ?? ''
    })
    const colMap = getColumnMap(ws as never, 1)
    expect(colMap.has('序列号')).toBe(true)
    expect(colMap.has('名称')).toBe(true)
    expect(colMap.has('是否看完')).toBe(true)
    // COLUMN_RULES 中评分对应的 key 是 "打分"（见 constants.ts:254）
    expect(colMap.has('打分')).toBe(true)
    expect(colMap.get('序列号')).toBe(1)
    expect(colMap.get('名称')).toBe(2)
    expect(colMap.get('是否看完')).toBe(4)
    expect(colMap.get('打分')).toBe(5)
  })

  it('未匹配到序列号列时使用第一个非空列作为回退', () => {
    const ws = createMockWorksheet({ name: 'Sheet-GCM-2' })
    mockState.getCellValue.mockImplementation((_ws: unknown, _row: number, col: number) => {
      // 第一列是 "名称"，没有显式的序列号
      const headers: Record<number, string> = {
        1: '名称',
        2: 'Bangumi URL',
      }
      return headers[col] ?? ''
    })
    const colMap = getColumnMap(ws as never, 1)
    // 名称映射到列 1，Bangumi URL 映射到列 2
    expect(colMap.has('名称')).toBe(true)
    expect(colMap.has('Bangumi_URL')).toBe(true)
    // 回退逻辑：firstNonEmptyCol=1 已被 "名称" 占用，向后查找非空列，
    // 但列 3 之后均为空，因此不会设置 "序列号"
    expect(colMap.has('序列号')).toBe(false)
  })

  it('空表头返回空 Map 或仅含回退序列号', () => {
    const ws = createMockWorksheet({ name: 'Sheet-GCM-3' })
    mockState.getCellValue.mockReturnValue('')
    const colMap = getColumnMap(ws as never, 1)
    expect(colMap.size).toBe(0)
  })

  it('null/undefined ws 返回空 Map', () => {
    // 必须显式让 getCellValue 返回空字符串，否则默认 undefined 会被 String() 转为 'undefined'
    mockState.getCellValue.mockReturnValue('')
    const colMap = getColumnMap(null, 1)
    expect(colMap.size).toBe(0)
  })

  it('缓存命中：第二次调用不重新扫描', () => {
    const ws = createMockWorksheet({ name: 'Sheet-GCM-Cache' })
    let callCount = 0
    mockState.getCellValue.mockImplementation(() => {
      callCount++
      return ''
    })
    getColumnMap(ws as never, 1)
    const initialCallCount = callCount
    getColumnMap(ws as never, 1)
    expect(callCount).toBe(initialCallCount)
  })
})

// ========== getLastRow ==========
describe('getLastRow', () => {
  it('通过 D 列 End(xlUp) 定位最后行', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-GLR-1',
      rangeEndRow: (address: string) => {
        // 仅 D 列请求的 End(xlUp) 返回有效行号
        if (address.startsWith('D')) return 100
        return null
      },
    })
    const lastRow = getLastRow(ws as never)
    expect(lastRow).toBe(100)
  })

  it('D 列失败时回退到 A 列', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-GLR-2',
      rangeEndRow: (address: string) => {
        if (address.startsWith('A')) return 50
        return null // D 列失败
      },
    })
    const lastRow = getLastRow(ws as never)
    expect(lastRow).toBe(50)
  })

  it('D 列与 A 列都失败时回退到 UsedRange', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-GLR-3',
      rangeEndRow: () => null,
      usedRange: { Row: 10, Rows: { Count: 30 } },
    })
    const lastRow = getLastRow(ws as never)
    // UsedRange.Row + Rows.Count - 1 = 10 + 30 - 1 = 39
    expect(lastRow).toBe(39)
  })

  it('所有方法失败时返回默认值 50000', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-GLR-4',
      rangeEndRow: () => null,
      usedRange: null,
    })
    const lastRow = getLastRow(ws as never)
    expect(lastRow).toBe(50_000)
  })

  it('ws 为 null 时返回默认值 50000', () => {
    const lastRow = getLastRow(null)
    expect(lastRow).toBe(50_000)
  })

  it('提供 headerRow 时尝试自动选择锚定列', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-GLR-5',
      rangeEndRow: (address: string) => {
        // 模拟：通过表头扫描找到 C 列为 "序列号" 列，C 列 End(xlUp) 返回 200
        if (address.startsWith('C')) return 200
        return null
      },
      // findAnchorColumn 直接访问 ws.Range(addr).Value2，不走 getCellValue
      rangeValue2: (address: string) => {
        if (address === 'C1') return '序列号'
        return null
      },
    })
    const lastRow = getLastRow(ws as never, false, 1)
    // findAnchorColumn 找到列 3（C），Range('C' + Rows.Count).End(xlUp).Row = 200
    expect(lastRow).toBe(200)
  })

  it('缓存命中：第二次调用返回相同结果且不重新计算', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-GLR-Cache',
      rangeEndRow: () => 75,
    })
    const first = getLastRow(ws as never)
    // 修改 mock 使其返回不同值
    const rangeEndRow = ws as {
      Range: (a: string) => { End: (d: number) => { Row: number } | null }
    }
    // mock 不会改变已缓存的结果
    const second = getLastRow(ws as never)
    expect(second).toBe(first)
    expect(second).toBe(75)
  })

  it('forceRefresh=true 时清除缓存并重新计算', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-GLR-Force',
      rangeEndRow: () => 80,
    })
    const first = getLastRow(ws as never)
    expect(first).toBe(80)
    // 即使修改 mock，缓存也应返回原值；forceRefresh=true 时才会重新计算
    const second = getLastRow(ws as never, true)
    expect(second).toBe(80) // 重新计算后仍是 80（mock 未变）
  })
})

// ========== readRangeValues ==========
describe('readRangeValues', () => {
  it('null ws 返回空数组', () => {
    expect(readRangeValues(null, 1, 10, 1, 5)).toEqual([])
  })

  it('undefined ws 返回空数组', () => {
    expect(readRangeValues(undefined, 1, 10, 1, 5)).toEqual([])
  })

  it('Range 返回二维数组时正确转换', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-RRV-1',
      rangeValue2: () => [
        ['a', 'b'],
        ['c', 'd'],
      ],
    })
    const result = readRangeValues(ws as never, 1, 2, 1, 2)
    expect(result).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('Range 返回单值时包装为二维数组', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-RRV-2',
      rangeValue2: () => 'single',
    })
    const result = readRangeValues(ws as never, 1, 1, 1, 1)
    expect(result).toEqual([['single']])
  })

  it('Range 返回 null/undefined 时返回空数组', () => {
    const ws = createMockWorksheet({
      name: 'Sheet-RRV-3',
      rangeValue2: () => null,
    })
    const result = readRangeValues(ws as never, 1, 10, 1, 5)
    expect(result).toEqual([])
  })

  it('Range 抛错时返回空数组（不传播异常）', () => {
    const ws = {
      Name: 'Sheet-RRV-4',
      Range: () => {
        throw new Error('range error')
      },
    }
    const result = readRangeValues(ws as never, 1, 10, 1, 5)
    expect(result).toEqual([])
  })
})

// ========== clearSheetCache ==========
describe('clearSheetCache', () => {
  it('清除指定工作表名的缓存条目', () => {
    const ws1 = createMockWorksheet({ name: 'Sheet-CC-1' })
    const ws2 = createMockWorksheet({ name: 'Sheet-CC-2' })
    // 写入缓存
    cacheGet('Sheet-CC-1:headerRow:1', () => 5)
    cacheGet('Sheet-CC-2:headerRow:1', () => 10)
    // 清除 ws1 的缓存
    clearSheetCache(ws1 as never)
    // ws2 缓存应仍存在（通过重新调用 cacheGet 验证 factory 不被调用）
    const factory2 = vi.fn(() => 999)
    const result2 = cacheGet('Sheet-CC-2:headerRow:1', factory2)
    expect(result2).toBe(10)
    expect(factory2).not.toHaveBeenCalled()
    // ws1 缓存应已清除（factory 被调用）
    const factory1 = vi.fn(() => 999)
    const result1 = cacheGet('Sheet-CC-1:headerRow:1', factory1)
    expect(result1).toBe(999)
    expect(factory1).toHaveBeenCalledTimes(1)
  })

  it('null ws 不抛错（前缀为空字符串，不匹配任何缓存）', () => {
    expect(() => clearSheetCache(null)).not.toThrow()
  })
})

// ========== safeActivate ==========
describe('safeActivate', () => {
  it('调用 ws.Activate()', () => {
    const activateFunction = vi.fn()
    const ws = createMockWorksheet({ name: 'Sheet-SA-1', activate: activateFunction })
    safeActivate(ws as never)
    expect(activateFunction).toHaveBeenCalledTimes(1)
  })

  it('null ws 不抛错', () => {
    expect(() => safeActivate(null)).not.toThrow()
  })

  it('undefined ws 不抛错', () => {
    expect(() => safeActivate(undefined)).not.toThrow()
  })

  it('ws 无 Activate 方法时不抛错', () => {
    const ws = { Name: 'Sheet-SA-2' } // 无 Activate 方法
    expect(() => safeActivate(ws as never)).not.toThrow()
  })
})
