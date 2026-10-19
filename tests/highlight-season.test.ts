// @vitest-environment node
/**
 * @fileoverview `ts/panel/highlight-season.ts` 季度引擎单测（纯函数，Node 环境直跑）
 *
 * 守住的东西：
 * 1. 季度归属表与数据页公式 LOOKUP 一致——尤其 **12 月 → 次年 1 月季**（宏在这点是错的）
 * 2. 三种日期形态都能解析：中文文本 / ISO / Excel 序列值（String() 化后的纯数字串）
 * 3. 解析不了的一律跳过不猜（公式列的「一次放出」「日期格式错误」天然落空）
 * 4. 两种口径：原始日期列先归一再比；公式列直接比（非日漫原始年月永远匹配不上季目标）
 */

import { describe, expect, it } from 'vitest'

import {
  currentSeason,
  excelSerialToYearMonth,
  formatSeasonKey,
  formatSeasonLabel,
  parseYearMonth,
  seasonStartMonth,
  rowsToRangeAddresses,
  chunkRangeAddresses,
  selectSeasonRows,
  toSeason,
} from '../ts/panel/highlight-season.js'

describe('seasonStartMonth：air 月 → 所属季', () => {
  it('与 LOOKUP(m,{1..12},{1,1,4,4,4,7,7,7,10,10,10,1}) 逐项一致', () => {
    const table: Record<number, number | null> = {
      1: 1,
      2: 1,
      3: 4,
      4: 4,
      5: 4,
      6: 7,
      7: 7,
      8: 7,
      9: 10,
      10: 10,
      11: 10,
      12: 1,
    }
    for (const [month, expected] of Object.entries(table)) {
      expect(seasonStartMonth(Number(month))).toBe(expected)
    }
  })

  it('越界月份返回 null（0 / 13 / 负数 / 非整数）', () => {
    expect(seasonStartMonth(0)).toBeNull()
    expect(seasonStartMonth(13)).toBeNull()
    expect(seasonStartMonth(-1)).toBeNull()
    expect(seasonStartMonth(4.5)).toBeNull()
  })
})

describe('toSeason：播出的年月 → 所属季', () => {
  it('12 月播的归属次年 1 月季（宏在这里会错算成 10 月季）', () => {
    expect(toSeason({ year: 2025, month: 12 })).toEqual({ year: 2026, month: 1 })
    expect(toSeason({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 })
  })

  it('季中月归到本季起点', () => {
    expect(toSeason({ year: 2026, month: 3 })).toEqual({ year: 2026, month: 4 })
    expect(toSeason({ year: 2026, month: 9 })).toEqual({ year: 2026, month: 10 })
  })

  it('对已归一的公式列值幂等', () => {
    // 公式列输出 "26年10月"（9 月播的日漫）→ 再归一一次不变
    expect(toSeason({ year: 2026, month: 10 })).toEqual({ year: 2026, month: 10 })
    // 公式列输出 "26年1月"（上年 12 月播的日漫）→ 再归一一次不变
    expect(toSeason({ year: 2026, month: 1 })).toEqual({ year: 2026, month: 1 })
  })

  it('月份越界返回 null', () => {
    expect(toSeason({ year: 2026, month: 0 })).toBeNull()
    expect(toSeason({ year: 2026, month: 13 })).toBeNull()
  })
})

describe('currentSeason：今天 → 当前季目标', () => {
  it('10 月 → 当年 10 月季（今天 2026-10-19 的场景）', () => {
    expect(currentSeason(new Date(2026, 9, 19))).toEqual({ year: 2026, month: 10 })
  })

  it('12 月 → 次年 1 月季（跨年）', () => {
    expect(currentSeason(new Date(2026, 11, 15))).toEqual({ year: 2027, month: 1 })
  })

  it('1 月 → 当年 1 月季（不跨年）', () => {
    expect(currentSeason(new Date(2027, 0, 3))).toEqual({ year: 2027, month: 1 })
  })

  it('十二个月逐一核对', () => {
    const expected: Record<number, [number, number]> = {
      1: [2026, 1],
      2: [2026, 1],
      3: [2026, 4],
      4: [2026, 4],
      5: [2026, 4],
      6: [2026, 7],
      7: [2026, 7],
      8: [2026, 7],
      9: [2026, 10],
      10: [2026, 10],
      11: [2026, 10],
      12: [2027, 1],
    }
    for (const [month, [year, seasonMonth]] of Object.entries(expected)) {
      const got = currentSeason(new Date(2026, Number(month) - 1, 15))
      expect([got.year, got.month]).toEqual([year, seasonMonth])
    }
  })
})

describe('parseYearMonth：三种日期形态', () => {
  it('中文文本（两位年 / 四位年 / 带日）', () => {
    expect(parseYearMonth('25年4月')).toEqual({ year: 2025, month: 4 })
    expect(parseYearMonth('2026年10月')).toEqual({ year: 2026, month: 10 })
    expect(parseYearMonth('2026年10月1日')).toEqual({ year: 2026, month: 10 })
    expect(parseYearMonth(' 26年9月 ')).toEqual({ year: 2026, month: 9 })
  })

  it('ISO 风格（日可选，三种分隔符）', () => {
    expect(parseYearMonth('2026-10-01')).toEqual({ year: 2026, month: 10 })
    expect(parseYearMonth('2026/10/1')).toEqual({ year: 2026, month: 10 })
    expect(parseYearMonth('2026.10')).toEqual({ year: 2026, month: 10 })
  })

  it('Excel 序列值（数字与 String() 化后的纯数字串）', () => {
    // 46023 = 2026-01-01（45292 = 2024-01-01，+366(2024 闰年)+365 = 46023）
    expect(excelSerialToYearMonth(46_023)).toEqual({ year: 2026, month: 1 })
    expect(parseYearMonth(46_023)).toEqual({ year: 2026, month: 1 })
    expect(parseYearMonth('46023')).toEqual({ year: 2026, month: 1 })
    // 44927 = 2023-01-01（常用基准值）
    expect(excelSerialToYearMonth(44_927)).toEqual({ year: 2023, month: 1 })
  })

  it('公式列产物与杂值一律 null（不猜）', () => {
    expect(parseYearMonth('一次放出')).toBeNull()
    expect(parseYearMonth('一次性放出')).toBeNull()
    expect(parseYearMonth('日期格式错误')).toBeNull()
    expect(parseYearMonth('')).toBeNull()
    expect(parseYearMonth(' '.repeat(3))).toBeNull()
    expect(parseYearMonth('abc')).toBeNull()
    expect(parseYearMonth('2026年13月')).toBeNull()
    expect(parseYearMonth('0年0月')).toBeNull()
    expect(parseYearMonth('125年4月')).toBeNull()
    expect(parseYearMonth(null)).toBeNull()
    expect(parseYearMonth(undefined)).toBeNull()
    expect(parseYearMonth({})).toBeNull()
  })

  it('序列值越界拒绝', () => {
    expect(excelSerialToYearMonth(0)).toBeNull()
    expect(excelSerialToYearMonth(-5)).toBeNull()
    expect(excelSerialToYearMonth(2_958_466)).toBeNull()
    expect(excelSerialToYearMonth(NaN)).toBeNull()
  })
})

describe('格式化', () => {
  it('formatSeasonKey 两位年、不补零（与公式列输出一致）', () => {
    expect(formatSeasonKey({ year: 2026, month: 10 })).toBe('26年10月')
    expect(formatSeasonKey({ year: 2027, month: 1 })).toBe('27年1月')
  })

  it('formatSeasonLabel 完整年（UI 展示）', () => {
    expect(formatSeasonLabel({ year: 2026, month: 10 })).toBe('2026 年 10 月')
  })
})

describe('selectSeasonRows', () => {
  const target = { year: 2026, month: 10 }

  it('原始日期列口径：9/10/11 月都命中，12 月归到次年 1 月季不命中', () => {
    const result = selectSeasonRows(
      [
        { row: 2, value: '26年9月' },
        { row: 3, value: '2026-10-01' },
        { row: 4, value: '26年11月' },
        // 25年12月 → 26年1月季，不命中 10 月季
        { row: 5, value: '25年12月' },
        // 26年8月 → 7 月季
        { row: 6, value: '26年8月' },
        { row: 7, value: '' },
        { row: 8, value: '一次放出' },
      ],
      target,
      { mapAirMonthToSeason: true },
    )
    expect(result.matchedRows).toEqual([2, 3, 4])
    expect(result.emptyCount).toBe(1)
    expect(result.invalidCount).toBe(1)
  })

  it('公式列口径：值已归一直接比；非日漫原始年月永远匹配不上季目标', () => {
    const result = selectSeasonRows(
      [
        // 9/10/11 月播的日漫，公式列已归一到 10 月季
        { row: 2, value: '26年10月' },
        // 上年 12 月播的日漫，公式归一到 1 月季
        { row: 3, value: '26年1月' },
        // 非日漫：公式保留原始年月 → 不命中任何季目标
        { row: 4, value: '25年12月' },
        { row: 5, value: '一次放出' },
      ],
      target,
      { mapAirMonthToSeason: false },
    )
    expect(result.matchedRows).toEqual([2])
    expect(result.invalidCount).toBe(1)
  })

  it('公式列口径下 1 月季目标能接住 12 月播的日漫', () => {
    const result = selectSeasonRows(
      [
        // 25年12月播的日漫，公式归一后落入 26年1月季
        { row: 2, value: '26年1月' },
        { row: 3, value: '26年10月' },
      ],
      { year: 2026, month: 1 },
      { mapAirMonthToSeason: false },
    )
    expect(result.matchedRows).toEqual([2])
  })

  it('空输入返回空结果', () => {
    expect(selectSeasonRows([], target, { mapAirMonthToSeason: true })).toEqual({
      matchedRows: [],
      emptyCount: 0,
      invalidCount: 0,
    })
  })
})

describe('rowsToRangeAddresses：连续行合并', () => {
  it('连续行合并成一个区域；单行不成区域', () => {
    expect(rowsToRangeAddresses([100, 101, 102, 103, 104, 105], 'H')).toEqual(['H100:H105'])
    expect(rowsToRangeAddresses([7], 'H')).toEqual(['H7'])
  })

  it('断点拆成多个区域；无需预先有序', () => {
    expect(rowsToRangeAddresses([100, 108, 101, 102, 103], 'H')).toEqual(['H100:H103', 'H108'])
  })

  it('空列表返回空数组', () => {
    expect(rowsToRangeAddresses([], 'H')).toEqual([])
  })

  it('整季连续匹配时一列只剩一个地址（255 字符上限的关键）', () => {
    const rows = Array.from({ length: 200 }, (_, index) => 500 + index)
    expect(rowsToRangeAddresses(rows, 'H')).toEqual(['H500:H699'])
  })
})

describe('chunkRangeAddresses：地址分块', () => {
  it('贪心装车，不超 maxChars', () => {
    const chunks = chunkRangeAddresses(['H100:H105', 'H108', 'H200:H210', 'H300'], 30)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30)
    }
    // 拼回来不丢地址
    expect(chunks.join(',').split(',').filter(Boolean)).toEqual([
      'H100:H105',
      'H108',
      'H200:H210',
      'H300',
    ])
  })

  it('单个地址超限时独立成块（不丢）', () => {
    expect(chunkRangeAddresses(['H1:H100000'], 5)).toEqual(['H1:H100000'])
  })

  it('空输入返回空数组', () => {
    expect(chunkRangeAddresses([])).toEqual([])
  })
})
