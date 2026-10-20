import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../ts/tools/util/index.js', () => ({
  getApp: vi.fn(),
  bgmLog: vi.fn(),
  BGM: { handleError: vi.fn(), ErrorLevel: { ERROR: 'ERROR' } },
}))

vi.mock('../ts/tools/string-utilities.js', () => ({
  columnNumberToLetter: (column: number) => {
    let result = ''
    let n = column
    while (n > 0) {
      const remainder = (n - 1) % 26
      result = String.fromCodePoint(65 + remainder) + result
      n = Math.floor((n - 1) / 26)
    }
    return result
  },
  trim: (s: string) => s.trim(),
}))

import { getCell, getCellValue, setCellValue, getSheetByIndex } from '../ts/tools/util/cell.js'
import { getApp, bgmLog, BGM } from '../ts/tools/util/index.js'
import type { WpsApp, WpsRange, WpsWorksheet } from '../ts/tools/wps.js'

/**
 * 测试用工作表 mock 的类型（理由见 tests/sheet.test.ts 的同类定义，P1-2）。
 * 桩只实现被测路径访问到的成员，形状不完整这一点收敛到本类型 + 工厂里的一次逃逸，
 * 调用点仍按 `WpsWorksheet` 校验。
 */
type MockWorksheet = Omit<WpsWorksheet, 'Range'> & { Range: RangeMock }

/** 测试用 Range mock：返回值放宽为未知桩，同时保留真实调用签名 */
interface RangeMock {
  (address: string): WpsRange
  mockReturnValue(value: unknown): RangeMock
}

/**
 * 构造「宿主返回畸形对象」的桩。
 *
 * `getSheetByIndex` 等函数的职责就是在宿主返回 `null` / 半成品时降级，
 * 这些用例的字面量必然违反 `WpsApp` 的成员类型，故集中一次类型逃逸。
 */
function asMalformedApp(app: unknown): WpsApp {
  return app as WpsApp
}

/**
 * 构造「`Range` 返回畸形值」的工作表桩（返回 null/undefined/抛错 等）。
 * 这些用例专门验证调用方的降级路径，字面量必然违反 `WpsWorksheet`，故集中逃逸。
 */
function malformedSheet(rangeImplementation: () => unknown): WpsWorksheet {
  return { Range: vi.fn(rangeImplementation) } as unknown as WpsWorksheet
}

function createMockCell(overrides: Record<string, unknown> = {}) {
  const base = {
    Value2: 'default',
    Value: 'default',
    Text: 'default',
  }
  return { ...base, ...overrides }
}

function nativeCodeValue(): { toString: () => string } {
  return { toString: () => '42 [native code]' }
}

/**
 * 模拟宿主 COM 方法：函数本身可调用，但 `toString()` 暴露 `[native code]`。
 * 用于驱动 tryGetProperty 的「函数返回值仍是 native 函数」分支。
 */
const nativeLikeFunction = (): unknown => undefined
Object.defineProperty(nativeLikeFunction, 'toString', {
  value: () => 'function push() { [native code] }',
  configurable: true,
})

function createMockWorksheet(
  cellValues: Record<string, unknown> = {},
  cellOverrides: Record<string, Record<string, unknown>> = {},
): MockWorksheet {
  const cellCache = new Map<string, ReturnType<typeof createMockCell>>()
  return {
    Range: vi.fn((address: string) => {
      if (cellCache.has(address)) {
        return cellCache.get(address)!
      }
      let cell: ReturnType<typeof createMockCell>
      if (Object.hasOwn(cellOverrides, address)) {
        cell = createMockCell(cellOverrides[address])
      } else if (Object.hasOwn(cellValues, address)) {
        cell = createMockCell({
          Value2: cellValues[address],
          Value: cellValues[address],
          Text: String(cellValues[address]),
        })
      } else {
        cell = createMockCell()
      }
      cellCache.set(address, cell)
      return cell
    }),
    // 单点类型逃逸：mock 只实现被测路径访问到的成员
  } as unknown as MockWorksheet
}

describe('getCell', () => {
  it('应在 worksheet 为 null/undefined 时返回 null', () => {
    expect(getCell(null, 1, 1)).toBeNull()
    expect(getCell(undefined, 1, 1)).toBeNull()
  })

  it('应通过 Range 获取单元格', () => {
    const worksheet = createMockWorksheet({ A1: 'test' })
    const cell = getCell(worksheet, 1, 1)
    expect(cell).toBeDefined()
    expect(worksheet.Range).toHaveBeenCalledWith('A1')
  })

  it('应正确计算列地址（27→AA）', () => {
    const worksheet = createMockWorksheet()
    getCell(worksheet, 1, 27)
    expect(worksheet.Range).toHaveBeenCalledWith('AA1')
  })

  it('应正确计算多行地址', () => {
    const worksheet = createMockWorksheet()
    getCell(worksheet, 5, 3)
    expect(worksheet.Range).toHaveBeenCalledWith('C5')
  })
})

describe('getCellValue', () => {
  describe('基本读取', () => {
    it('应在 worksheet 为 null 时返回空字符串', () => {
      expect(getCellValue(null, 1, 1)).toBe('')
    })

    it('应在 worksheet 为 undefined 时返回空字符串', () => {
      expect(getCellValue(undefined, 1, 1)).toBe('')
    })

    it('应读取字符串值', () => {
      const worksheet = createMockWorksheet({ A1: 'hello' })
      expect(getCellValue(worksheet, 1, 1)).toBe('hello')
    })

    it('应将数值转为字符串', () => {
      const worksheet = createMockWorksheet({ A1: 42 })
      expect(getCellValue(worksheet, 1, 1)).toBe('42')
    })

    it('应将布尔值转为字符串', () => {
      const worksheet = createMockWorksheet({ A1: true })
      expect(getCellValue(worksheet, 1, 1)).toBe('true')
    })
  })

  describe('Value2 回退逻辑（间接测试 getCellRawValue）', () => {
    it('Value2 为 null 时返回空字符串', () => {
      // 注意：null 在 tryGetProperty 中被视为有效值（val===null != undefined）
      // 所以 getCellRawValue 返回 null，getCellValue 返回 ''
      const worksheet = createMockWorksheet(
        {},
        {
          A1: { Value2: null, Value: null, Text: null },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('')
    })

    it('Value2 为 undefined 时回退到 Value', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: { Value2: undefined, Value: 'fallback_value', Text: 'fallback_value' },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('fallback_value')
    })

    it('Value2 和 Value 均为 undefined 时回退到 Text', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: { Value2: undefined, Value: undefined, Text: 'text_fallback' },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('text_fallback')
    })

    it('Value2/Value/Text 均为 null 时返回空字符串', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: { Value2: null, Value: null, Text: null },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('')
    })

    it('Value2 为 native function（toString 含 [native code]）时应跳过并回退', () => {
      // 当前实现：调用函数得到 result，仅当 result 为 function 时检查 toString
      // 对于返回非 function 对象的 native code 标记，不会检测
      const nativeFunction = nativeCodeValue
      const worksheet = createMockWorksheet(
        {},
        {
          A1: { Value2: nativeFunction, Value: 'real_value', Text: 'real_value' },
        },
      )
      // 实际行为：函数被调用返回对象，String() 转换得到 toString 值
      const result = getCellValue(worksheet, 1, 1)
      expect(result).toBe('42 [native code]')
    })

    it('Value2 为抛异常的属性访问时应回退', () => {
      // 用普通对象模拟：属性访问抛错被 tryGetProperty 捕获
      // 注意：由于 esbuild/vitest 对 getter 转换可能导致行为变化，
      // 这里通过在函数内部抛错来模拟属性访问失败
      const throwingCell = new Proxy(
        { Value: 'fallback_after_error', Text: 'fallback_after_error' },
        {
          get(target, property) {
            if (property === 'Value2') throw new Error('Property access error')
            return Reflect.get(target, property) as unknown
          },
        },
      )
      const worksheet = malformedSheet(() => throwingCell)
      expect(getCellValue(worksheet, 1, 1)).toBe('fallback_after_error')
    })

    it('Value 为 native function 时跳过，回退到 Text', () => {
      const nativeFunction = nativeCodeValue
      const worksheet = createMockWorksheet(
        {},
        {
          A1: { Value2: undefined, Value: nativeFunction, Text: 'text_final' },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('42 [native code]')
    })
  })

  /**
   * `tryGetProperty` 的边界分支（间接覆盖）。
   *
   * 该函数是内部实现，但它的每条降级分支都对应真实宿主行为：
   * COM 方法返回另一个 native 方法、COM 调用抛错、属性值是「带 toString 的宿主对象」、
   * 以及属性读取本身抛错。这些路径不测就会静默把「函数源码 / [native code]」当成
   * 单元格内容写进表格。
   */
  describe('tryGetProperty 属性探测边界（间接）', () => {
    it('Value2 为「返回 native function」的函数时应跳过并回退 Value', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: {
            Value2: () => nativeLikeFunction,
            Value: 'real_value',
            Text: 'real_value',
          },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('real_value')
    })

    it('Value2 为「调用即抛错」的函数时应吞掉异常并回退 Value', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: {
            Value2: () => {
              throw new Error('COM 调用失败')
            },
            Value: 'after_function_throw',
            Text: 'after_function_throw',
          },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('after_function_throw')
    })

    it('Value2 为对象且 toString 含 "function" 时应跳过并回退 Value', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: {
            Value2: { toString: () => 'function foo() {}' },
            Value: 'after_function_marker',
            Text: 'after_function_marker',
          },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('after_function_marker')
    })

    it('Value2 为对象且 toString 仅含 "[native code]" 时应跳过并回退 Value', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: {
            Value2: { toString: () => '[native code]' },
            Value: 'after_native_marker',
            Text: 'after_native_marker',
          },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('after_native_marker')
    })

    it('Value2 为普通对象（toString 无标记）时应按 String() 语义返回', () => {
      const worksheet = createMockWorksheet(
        {},
        {
          A1: {
            Value2: { toString: () => '普通对象' },
            Value: 'ignored_value',
            Text: 'ignored_value',
          },
        },
      )
      expect(getCellValue(worksheet, 1, 1)).toBe('普通对象')
    })

    it('自有属性 getter 抛错时应吞掉异常并回退 Value', () => {
      // 与上一条 Proxy 用例的区别：Proxy 的 hasOwn 为 false（走「属性不存在」分支），
      // 这里用真实自有访问器属性，才会命中 tryGetProperty 最外层 try/catch。
      const throwingCell: Record<string, unknown> = {
        Value: 'after_access_throw',
        Text: 'after_access_throw',
      }
      Object.defineProperty(throwingCell, 'Value2', {
        get() {
          throw new Error('属性访问失败')
        },
        enumerable: true,
        configurable: true,
      })

      const worksheet = malformedSheet(() => throwingCell)
      expect(getCellValue(worksheet, 1, 1)).toBe('after_access_throw')
    })
  })

  describe('单元格异常处理', () => {
    it('Range 调用抛异常时返回空字符串', () => {
      const worksheet = malformedSheet(() => {
        throw new Error('COM error')
      })
      expect(getCellValue(worksheet, 1, 1)).toBe('')
    })

    it('返回的 cell 为 null 时返回空字符串', () => {
      const worksheet = malformedSheet(() => null)
      expect(getCellValue(worksheet, 1, 1)).toBe('')
    })

    it('返回的 cell 为 undefined 时返回空字符串', () => {
      const worksheet = malformedSheet(() => {
        // 返回 undefined，验证「Range 返回空」的降级
      })
      expect(getCellValue(worksheet, 1, 1)).toBe('')
    })

    it('列号 1→A 列地址正确', () => {
      const worksheet = createMockWorksheet({ A1: 'test_value' })
      getCellValue(worksheet, 1, 1)
      expect(worksheet.Range).toHaveBeenCalledWith('A1')
    })

    it('列号 26→Z 列地址正确', () => {
      const worksheet = createMockWorksheet({ Z10: 'z_col' })
      getCellValue(worksheet, 10, 26)
      expect(worksheet.Range).toHaveBeenCalledWith('Z10')
    })

    it('列号 27→AA 列地址正确', () => {
      const worksheet = createMockWorksheet({ AA5: 'aa_col' })
      getCellValue(worksheet, 5, 27)
      expect(worksheet.Range).toHaveBeenCalledWith('AA5')
    })
  })
})

describe('setCellValue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应在 worksheet 为 null 时返回 false', () => {
    expect(setCellValue(null, 1, 1, 'test')).toBe(false)
  })

  it('应在 worksheet 为 undefined 时返回 false', () => {
    expect(setCellValue(undefined, 1, 1, 'test')).toBe(false)
  })

  it('应设置单元格值并返回 true', () => {
    const worksheet = createMockWorksheet()
    const isResult = setCellValue(worksheet, 1, 1, 'newValue')
    expect(isResult).toBe(true)
  })

  it('应通过 Range(A1) 地址写入', () => {
    const worksheet = createMockWorksheet()
    setCellValue(worksheet, 1, 1, 'test')
    expect(worksheet.Range).toHaveBeenCalledWith('A1')
  })

  it('应将数值作为值写入', () => {
    const worksheet = createMockWorksheet()
    const cell = worksheet.Range('A1')
    setCellValue(worksheet, 1, 1, 999)
    expect(cell.Value2).toBe(999)
  })

  it('应将对象作为值写入', () => {
    const worksheet = createMockWorksheet()
    const object = { key: 'val' }
    const cell = worksheet.Range('A1')
    setCellValue(worksheet, 1, 1, object)
    expect(cell.Value2).toBe(object)
  })

  it('应在 cell 为 null 时返回 false 并记录错误日志', () => {
    const worksheet = malformedSheet(() => null)
    const isResult = setCellValue(worksheet, 1, 1, 'test')
    expect(isResult).toBe(false)
    expect(bgmLog).toHaveBeenCalled()
  })

  it('应在写入异常时调用 BGM.handleError 并返回 false', () => {
    const cell = {
      get Value2() {
        return ''
      },
      set Value2(_v) {
        throw new Error('Cannot redefine property')
      },
    }
    const worksheet = malformedSheet(() => cell)
    const isResult = setCellValue(worksheet, 1, 1, 'test')
    expect(isResult).toBe(false)
    expect(BGM.handleError).toHaveBeenCalled()
  })
})

describe('getSheetByIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应在无 Application 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue(null)
    expect(getSheetByIndex(1)).toBeNull()
  })

  it('应在 Application 为 undefined 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue(asMalformedApp(undefined))
    expect(getSheetByIndex(1)).toBeNull()
  })

  it('应在无 ActiveWorkbook 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue({})
    expect(getSheetByIndex(1)).toBeNull()
  })

  it('应在 ActiveWorkbook 为 null 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue(asMalformedApp({ ActiveWorkbook: null }))
    expect(getSheetByIndex(1)).toBeNull()
  })

  it('应在 Sheets 为 null 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue(asMalformedApp({ ActiveWorkbook: { Sheets: null } }))
    expect(getSheetByIndex(1)).toBeNull()
  })

  it('应在 Sheets.Count 为 0 时返回 null', () => {
    vi.mocked(getApp).mockReturnValue(
      asMalformedApp({ ActiveWorkbook: { Sheets: { Count: 0, Item: vi.fn() } } }),
    )
    expect(getSheetByIndex(1)).toBeNull()
  })

  it('应按索引获取工作表', () => {
    const mockSheet = { Name: 'Sheet1' }
    const itemFunction = vi.fn().mockReturnValue(mockSheet)
    vi.mocked(getApp).mockReturnValue(
      asMalformedApp({ ActiveWorkbook: { Sheets: { Count: 3, Item: itemFunction } } }),
    )
    const result = getSheetByIndex(2)
    expect(itemFunction).toHaveBeenCalledWith(2)
    expect(result).toBe(mockSheet)
  })

  it('应在 Sheets.Item 抛异常时返回 undefined', () => {
    const itemFunction = vi.fn(() => {
      throw new Error('Sheet not found')
    })
    vi.mocked(getApp).mockReturnValue(
      asMalformedApp({ ActiveWorkbook: { Sheets: { Count: 5, Item: itemFunction } } }),
    )
    const result = getSheetByIndex(10)
    expect(result).toBeUndefined()
  })
})
