// @vitest-environment jsdom
/**
 * @fileoverview `ts/sync/sheet-cleaning.ts`（重复行清洗核心：扫描计划 + 写入）单元测试。
 *
 * 依赖形状：只 import `core/constants.js`（纯常量）与 `tools/util/index.js` 的 6 个 COM 薄封装
 * → 用一个「假工作表模型」（网格 cells + 记录 Delete 区间与 setCellValue）即可驱动真实实现，
 * 断言真实产出的计划与真实写盘调用，不存在假覆盖（判据见 `REF-testing.md`）。
 *
 * 两阶段设计是本模块的核心不变量：`plan*` 只读、`applyRowPlan` 才写。
 * 因此每个计划用例都额外断言「扫描阶段没有产生任何 Range.Delete / setCellValue 调用」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: string, message?: string) => void>(),
  findHeaderRow: vi.fn<(ws: unknown) => number>(),
  getColumnMap: vi.fn<(ws: unknown, headerRow: number) => Map<string, number>>(),
  getLastRow: vi.fn<(ws: unknown) => number>(),
  readRangeValues: vi.fn<
    (ws: unknown, r1: number, r2: number, c1: number, c2: number) => string[][]
  >(),
  setCellValue: vi.fn<(ws: unknown, row: number, col: number, value: string) => void>(),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  findHeaderRow: m.findHeaderRow,
  getColumnMap: m.getColumnMap,
  getLastRow: m.getLastRow,
  readRangeValues: m.readRangeValues,
  setCellValue: m.setCellValue,
}))

import {
  applyRowPlan,
  cleanSheetDuplicates,
  deleteRowsBatched,
  mergeTagValues,
  planDuplicateRows,
  planDuplicateUrlRows,
  planEmptyNameRows,
  readSheetLayout,
} from '../ts/sync/sheet-cleaning.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'

// ========== 假工作表模型 ==========

interface SheetModel {
  headerRow: number
  lastRow: number
  columns: Record<string, number>
  cells: Record<number, Record<number, string>>
  deletedRanges: string[]
  writes: { row: number; col: number; value: string }[]
  /** 列号 → 只返回前 N 行（模拟 COM 少返回数据，取值为缺失的 undefined） */
  truncatedColumns: Record<number, number>
  /** 列号 → 这些数据行返回空数组（模拟 COM 返回形状异常） */
  emptyRowsByColumn: Record<number, number[]>
}

let model: SheetModel

/** 造一个工作表模型：`headerCells` 为表头行文本，`dataRows` 为表头下方的数据行 */
function makeSheetModel(headerRow: number, headerCells: string[], dataRows: string[][]): SheetModel {
  const columns: Record<string, number> = {}
  const cells: Record<number, Record<number, string>> = {}
  const headerLine: Record<number, string> = {}
  for (const [index, text] of headerCells.entries()) {
    headerLine[index + 1] = text
    if (text !== '') columns[text] = index + 1
  }
  cells[headerRow] = headerLine
  for (const [rowIndex, line] of dataRows.entries()) {
    const record: Record<number, string> = {}
    for (const [colIndex, text] of line.entries()) {
      record[colIndex + 1] = text
    }
    cells[headerRow + 1 + rowIndex] = record
  }
  return {
    headerRow,
    lastRow: headerRow + dataRows.length,
    columns,
    cells,
    deletedRanges: [],
    writes: [],
    truncatedColumns: {},
    emptyRowsByColumn: {},
  }
}

/** 最小工作表替身：只需要 `Range(...).Delete` 这一面 */
function makeWorksheet(): WpsWorksheet {
  const worksheet = {
    Range: (address: string) => ({
      Delete: () => {
        model.deletedRanges.push(address)
      },
    }),
  }
  return worksheet as unknown as WpsWorksheet
}

/** 把模型装进 COM 薄封装的替身 */
function installModel(next: SheetModel): WpsWorksheet {
  model = next
  m.findHeaderRow.mockImplementation(() => model.headerRow)
  m.getLastRow.mockImplementation(() => model.lastRow)
  m.getColumnMap.mockImplementation(() => new Map(Object.entries(model.columns)))
  m.readRangeValues.mockImplementation(
    (_ws: unknown, r1: number, r2: number, c1: number, c2: number) => {
      const out: string[][] = []
      const rowLimit = c1 === c2 ? model.truncatedColumns[c1] : undefined
      for (let rowNumber = r1; rowNumber <= r2; rowNumber += 1) {
        const isWithinLimit = rowLimit === undefined || rowNumber - r1 + 1 <= rowLimit
        if (isWithinLimit) {
          if ((model.emptyRowsByColumn[c1] ?? []).includes(rowNumber)) {
            out.push([])
          } else {
            const line: string[] = []
            for (let col = c1; col <= c2; col += 1) {
              line.push(model.cells[rowNumber]?.[col] ?? '')
            }
            out.push(line)
          }
        }
      }
      return out
    },
  )
  m.setCellValue.mockImplementation(
    (_ws: unknown, rowNumber: number, col: number, value: string) => {
      model.writes.push({ row: rowNumber, col, value })
    },
  )
  return makeWorksheet()
}

const STANDARD_HEADERS = ['名称', 'Bangumi_URL', '标签/分级', '开播日期', '集数']

/** 「名称 / URL / 标签 / 日期 / 集数」五列的一行 */
function row(name: string, url: string, tags: string, date: string, episodes: string): string[] {
  return [name, url, tags, date, episodes]
}

beforeEach(() => {
  vi.clearAllMocks()
  model = makeSheetModel(1, STANDARD_HEADERS, [])
})

// ========== readSheetLayout ==========

describe('readSheetLayout', () => {
  it('无表头行 → null', () => {
    const ws = installModel(makeSheetModel(0, STANDARD_HEADERS, [row('A', 'u', 't', 'd', 'e')]))

    expect(readSheetLayout(ws)).toBeNull()
  })

  it('只有表头没有数据行 → null', () => {
    const ws = installModel(makeSheetModel(1, STANDARD_HEADERS, []))

    expect(readSheetLayout(ws)).toBeNull()
  })

  it('正常表 → 返回表头行 / 末行 / 列映射 / 数据起始行', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [row('A', 'u', 't', 'd', 'e')]),
    )

    const layout = readSheetLayout(ws)

    expect(layout).not.toBeNull()
    expect(layout?.headerRow).toBe(1)
    expect(layout?.lastRow).toBe(2)
    expect(layout?.dataStartRow).toBe(2)
    expect(layout?.colMap.get('名称')).toBe(1)
    expect(layout?.colMap.get('标签/分级')).toBe(3)
  })

  it('表头不在首行时数据起始行随之偏移', () => {
    const ws = installModel(
      makeSheetModel(3, STANDARD_HEADERS, [row('A', 'u', 't', 'd', 'e')]),
    )

    const layout = readSheetLayout(ws)

    expect(layout?.headerRow).toBe(3)
    expect(layout?.dataStartRow).toBe(4)
  })
})

// ========== mergeTagValues ==========

describe('mergeTagValues', () => {
  it('保序去重并用「 | 」连接', () => {
    expect(mergeTagValues('A | B', 'B | C')).toBe('A | B | C')
  })

  it('兼容两侧多余空白与空段', () => {
    const spaces = ' '.repeat(2)
    expect(mergeTagValues(`${spaces}A|B${spaces}`, ` | B |${spaces}| C `)).toBe('A | B | C')
  })

  it('两侧都为空 → 空串', () => {
    expect(mergeTagValues('', ' '.repeat(3))).toBe('')
  })
})

// ========== planDuplicateRows ==========

describe('planDuplicateRows · 结构缺失', () => {
  it('无表头 → 跳过并给出原因', () => {
    const ws = installModel(makeSheetModel(0, STANDARD_HEADERS, [row('A', 'u', 't', 'd', 'e')]))

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([])
    expect(plan.skippedReason).toBe('未找到表头行或无数据行')
  })

  it('缺「名称」列 → 跳过', () => {
    const ws = installModel(
      makeSheetModel(1, ['Bangumi_URL', '标签/分级'], [['u', 't']]),
    )

    expect(planDuplicateRows(ws).skippedReason).toBe('未找到「名称」列')
  })

  it('缺「Bangumi_URL」列 → 跳过', () => {
    const ws = installModel(makeSheetModel(1, ['名称', '标签/分级'], [['A', 't']]))

    expect(planDuplicateRows(ws).skippedReason).toBe('未找到「Bangumi_URL」列')
  })
})

describe('planDuplicateRows · 组解析', () => {
  it('保留含 URL 的行，删除无 URL 重复行并把标签并入保留行', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', '', '标签Y', '2020-01', '12'),
      ]),
    )

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([3])
    expect(plan.changes).toEqual([{ row: 2, col: 3, value: '标签X | 标签Y' }])
    expect(plan.groups).toBe(1)
    expect(plan.mergedGroups).toBe(1)
    expect(plan.skippedReason).toBeUndefined()
    // 扫描阶段只读：不得产生任何写盘 / 删行
    expect(model.deletedRanges).toEqual([])
    expect(m.setCellValue).not.toHaveBeenCalled()
  })

  it('标签合并后无变化 → 只删行、不产生变更', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', '', '标签X', '2020-01', '12'),
      ]),
    )

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([3])
    expect(plan.changes).toEqual([])
    expect(plan.groups).toBe(1)
    expect(plan.mergedGroups).toBe(0)
  })

  it('被删行标签为空 → 不产生变更', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', '', ' '.repeat(3), '2020-01', '12'),
      ]),
    )

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([3])
    expect(plan.changes).toEqual([])
  })

  it('组内全无 URL → 不删，避免误删唯一数据', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', '', '标签X', '2020-01', '12'),
        row('动画A', '', '标签Y', '2020-01', '12'),
      ]),
    )

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([])
    expect(plan.skippedReason).toBe('未发现重复数据')
  })

  it('多个含 URL 行且开播日期不同 → 视为不同作品，不删', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', 'url-2', '标签Y', '2021-01', '12'),
        row('动画A', '', '标签Z', '2020-01', '12'),
      ]),
    )

    expect(planDuplicateRows(ws).deleteRows).toEqual([])
  })

  it('多个含 URL 行且集数不同 → 视为不同作品，不删', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', 'url-2', '标签Y', '2020-01', '24'),
      ]),
    )

    expect(planDuplicateRows(ws).deleteRows).toEqual([])
  })

  it('缺「开播日期 / 集数」列时不做作品区分，只删无 URL 行', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL', '标签/分级'], [
        ['动画A', 'url-1', '标签X'],
        ['动画A', 'url-2', '标签Y'],
        ['动画A', '', '标签Z'],
      ]),
    )

    const plan = planDuplicateRows(ws)

    // 两个 URL 行都保留（不是 victim），只有无 URL 行进入待删
    expect(plan.deleteRows).toEqual([4])
    expect(plan.mergedGroups).toBe(1)
    expect(plan.changes).toEqual([{ row: 2, col: 3, value: '标签X | 标签Z' }])
  })

  it('两个含 URL 行数据一致且存在空 URL 行 → 删除空 URL 行', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', 'url-2', '标签Y', '2020-01', '12'),
        row('动画A', '', '标签Z', '2020-01', '12'),
      ]),
    )

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([4])
    // 受害行只有第 4 行：第 3 行含 URL 会被保留，其标签不并入保留行
    expect(plan.changes).toEqual([{ row: 2, col: 3, value: '标签X | 标签Z' }])
  })

  it('缺「标签/分级」列 → 仍删行但不产生变更', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL'], [
        ['动画A', 'url-1'],
        ['动画A', ''],
      ]),
    )

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([3])
    expect(plan.changes).toEqual([])
    expect(plan.mergedGroups).toBe(0)
  })

  it('排除行不参与分组', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', '', '标签Y', '2020-01', '12'),
      ]),
    )

    const plan = planDuplicateRows(ws, { excludedRows: new Set([3]) })

    expect(plan.deleteRows).toEqual([])
    expect(plan.skippedReason).toBe('未发现重复数据')
  })

  it('空名称行不参与分组', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('', '', '', '', ''),
        row('', '', '', '', ''),
      ]),
    )

    expect(planDuplicateRows(ws).deleteRows).toEqual([])
  })

  it('多组命中的待删行按升序输出', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('A', 'url-1', 't', 'd', 'e'),
        row('B', 'url-2', 't', 'd', 'e'),
        row('A', '', 't', 'd', 'e'),
        row('B', '', 't', 'd', 'e'),
      ]),
    )

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([4, 5])
    expect(plan.groups).toBe(2)
    expect(plan.mergedGroups).toBe(0)
  })

  it('名称前后空白参与归一化分组', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', 't', 'd', 'e'),
        row('  动画A  ', '', 't2', 'd', 'e'),
      ]),
    )

    expect(planDuplicateRows(ws).deleteRows).toEqual([3])
  })
})

// ========== planDuplicateUrlRows ==========

describe('planDuplicateUrlRows', () => {
  it('无表头 → 跳过', () => {
    const ws = installModel(makeSheetModel(0, STANDARD_HEADERS, []))

    expect(planDuplicateUrlRows(ws).skippedReason).toBe('未找到表头行或无数据行')
  })

  it('缺 URL 列 → 跳过', () => {
    const ws = installModel(makeSheetModel(1, ['名称', '标签/分级'], [['A', 't']]))

    expect(planDuplicateUrlRows(ws).skippedReason).toBe('未找到「Bangumi_URL」列')
  })

  it('同 URL 跨名称出现多行 → 保留最大行号并合并标签', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画B', 'url-1', '标签Y', '2021-01', '24'),
      ]),
    )

    const plan = planDuplicateUrlRows(ws)

    expect(plan.deleteRows).toEqual([2])
    expect(plan.changes).toEqual([{ row: 3, col: 3, value: '标签Y | 标签X' }])
    expect(plan.groups).toBe(1)
    expect(plan.mergedGroups).toBe(1)
    expect(model.deletedRanges).toEqual([])
  })

  it('URL 只出现一次 → 无待删行', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', 't', 'd', 'e'),
        row('动画B', 'url-2', 't', 'd', 'e'),
      ]),
    )

    expect(planDuplicateUrlRows(ws).skippedReason).toBe('未发现同 URL 重复行')
  })

  it('空 URL 不参与分组', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', '', 't', 'd', 'e'),
        row('动画B', '', 't', 'd', 'e'),
      ]),
    )

    expect(planDuplicateUrlRows(ws).deleteRows).toEqual([])
  })

  it('排除行不参与分组', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画B', 'url-1', '标签Y', '2021-01', '24'),
      ]),
    )

    const plan = planDuplicateUrlRows(ws, { excludedRows: new Set([3]) })

    expect(plan.deleteRows).toEqual([])
  })

  it('缺「标签/分级」列 → 只删行不产生变更', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL'], [
        ['动画A', 'url-1'],
        ['动画B', 'url-1'],
      ]),
    )

    const plan = planDuplicateUrlRows(ws)

    expect(plan.deleteRows).toEqual([2])
    expect(plan.changes).toEqual([])
  })
})

// ========== planEmptyNameRows ==========

describe('planEmptyNameRows', () => {
  it('无表头 → 跳过', () => {
    const ws = installModel(makeSheetModel(0, STANDARD_HEADERS, []))

    expect(planEmptyNameRows(ws).skippedReason).toBe('未找到表头行或无数据行')
  })

  it('缺「名称」列 → 跳过', () => {
    const ws = installModel(makeSheetModel(1, ['Bangumi_URL'], [['u']]))

    expect(planEmptyNameRows(ws).skippedReason).toBe('未找到「名称」列')
  })

  it('名称空且其余识别列全空 → 判为空白行', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL', '标签/分级'], [
        ['', '', ''],
        ['', 'url-1', ''],
        ['动画A', '', ''],
      ]),
    )

    const plan = planEmptyNameRows(ws)

    expect(plan.deleteRows).toEqual([2])
    expect(plan.groups).toBe(1)
    expect(plan.changes).toEqual([])
  })

  it('名称空但还有其它列有值 → 不判为空白行', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL', '标签/分级'], [
        ['', '', '标签X'],
        ['', '', ' '.repeat(3)],
      ]),
    )

    expect(planEmptyNameRows(ws).deleteRows).toEqual([3])
  })

  it('排除行不参与', () => {
    const ws = installModel(makeSheetModel(1, ['名称', 'Bangumi_URL'], [['', '']]))

    expect(planEmptyNameRows(ws, { excludedRows: new Set([2]) }).deleteRows).toEqual([])
  })

  it('没有空白行 → 跳过', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL'], [['动画A', 'url-1']]),
    )

    expect(planEmptyNameRows(ws).skippedReason).toBe('未发现空白数据行')
  })
})

// ========== deleteRowsBatched / applyRowPlan ==========

describe('deleteRowsBatched', () => {
  it('空数组 → 不产生任何调用', () => {
    const ws = installModel(makeSheetModel(1, STANDARD_HEADERS, []))

    expect(deleteRowsBatched(ws, [])).toBe(0)
    expect(model.deletedRanges).toEqual([])
  })

  it('单行 → 单点区间', () => {
    const ws = installModel(makeSheetModel(1, STANDARD_HEADERS, []))

    expect(deleteRowsBatched(ws, [5])).toBe(1)
    expect(model.deletedRanges).toEqual(['5:5'])
  })

  it('连续行合并为一次 Range 调用', () => {
    const ws = installModel(makeSheetModel(1, STANDARD_HEADERS, []))

    expect(deleteRowsBatched(ws, [5, 6, 7])).toBe(1)
    expect(model.deletedRanges).toEqual(['5:7'])
  })

  it('不连续行按从大到小分段调用', () => {
    const ws = installModel(makeSheetModel(1, STANDARD_HEADERS, []))

    expect(deleteRowsBatched(ws, [5, 7, 8])).toBe(2)
    expect(model.deletedRanges).toEqual(['7:8', '5:5'])
  })
})

describe('applyRowPlan', () => {
  it('先写变更再删行，且跳过即将被删除行上的变更', () => {
    const ws = installModel(makeSheetModel(1, STANDARD_HEADERS, []))

    const removed = applyRowPlan(ws, {
      deleteRows: [5, 6],
      changes: [
        { row: 5, col: 3, value: '不该写' },
        { row: 9, col: 3, value: '应该写' },
      ],
      groups: 1,
      mergedGroups: 1,
    })

    expect(model.writes).toEqual([{ row: 9, col: 3, value: '应该写' }])
    expect(model.deletedRanges).toEqual(['5:6'])
    expect(removed).toBe(2)
  })

  it('无待删行 → 只写变更并返回 0', () => {
    const ws = installModel(makeSheetModel(1, STANDARD_HEADERS, []))

    const removed = applyRowPlan(ws, {
      deleteRows: [],
      changes: [{ row: 3, col: 3, value: 'X' }],
      groups: 0,
      mergedGroups: 1,
    })

    expect(removed).toBe(0)
    expect(model.writes).toEqual([{ row: 3, col: 3, value: 'X' }])
    expect(model.deletedRanges).toEqual([])
  })
})

// ========== cleanSheetDuplicates ==========

describe('cleanSheetDuplicates', () => {
  it('无重复 → 不执行写入并给出原因', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [row('动画A', 'url-1', 't', 'd', 'e')]),
    )

    const result = cleanSheetDuplicates(ws)

    expect(result).toEqual({
      performed: false,
      deletedRows: 0,
      mergedTagGroups: 0,
      duplicateNameGroups: 0,
      skippedReason: '未发现重复数据',
    })
    expect(model.deletedRanges).toEqual([])
    expect(m.bgmLog).toHaveBeenCalled()
  })

  it('有重复 → 执行删除并汇总统计', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', '', '标签Y', '2020-01', '12'),
      ]),
    )

    const result = cleanSheetDuplicates(ws)

    expect(result).toEqual({
      performed: true,
      deletedRows: 1,
      mergedTagGroups: 1,
      duplicateNameGroups: 1,
    })
    expect(model.writes).toEqual([{ row: 2, col: 3, value: '标签X | 标签Y' }])
    expect(model.deletedRanges).toEqual(['3:3'])
    const messages = m.bgmLog.mock.calls.map((call) => call[1] ?? '')
    expect(messages.some((message) => message.includes('开始清洗重复行'))).toBe(true)
    expect(messages.some((message) => message.includes('清洗完成: 删除 1 行'))).toBe(true)
  })
})

// ========== COM 异常形状：列被截断 / 行返回空 ==========

describe('sheet-cleaning · COM 返回数据不完整时', () => {
  it('某行返回空数组 → 该行各列按空串处理', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', '', '标签Y', '2020-01', '12'),
      ]),
    )
    // 第 3 行（受害行）的标签列读回为空数组 —— 名称列必须完整，否则该行不参与分组
    model.emptyRowsByColumn = { 3: [3] }

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([3])
    // 受害行标签读不到 → 不产生变更
    expect(plan.changes).toEqual([])
  })

  it('标签列读回不足行数 → 保留行与受害行标签都按空串处理', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', '', '标签Y', '2020-01', '12'),
      ]),
    )
    model.truncatedColumns = { 3: 0 }

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([3])
    expect(plan.changes).toEqual([])
    expect(plan.mergedGroups).toBe(0)
  })

  it('URL 列读回不足行数 → 缺失行视为无 URL', () => {
    const ws = installModel(
      makeSheetModel(1, STANDARD_HEADERS, [
        row('动画A', 'url-1', '标签X', '2020-01', '12'),
        row('动画A', 'url-2', '标签Y', '2020-01', '12'),
      ]),
    )
    // 第 2 行有 URL，第 3 行读不到 → 第 3 行落入受害行
    model.truncatedColumns = { 2: 1 }

    const plan = planDuplicateRows(ws)

    expect(plan.deleteRows).toEqual([3])
  })

  it('开播日期列读回不足行数 → 缺失取值不参与作品区分', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL', '标签/分级', '开播日期'], [
        ['动画A', 'url-1', '标签X', '2020-01'],
        ['动画A', 'url-2', '标签Y', '2021-01'],
      ]),
    )
    // 第 3 行日期读不到 → 去重后只剩 1 种取值 → 不判为「不同作品」
    model.truncatedColumns = { 4: 1 }

    const plan = planDuplicateRows(ws)

    // 两行都含 URL → 无受害行，仍不删
    expect(plan.deleteRows).toEqual([])
    expect(plan.skippedReason).toBe('未发现重复数据')
  })

  it('空白行扫描中其它列读回不足行数 → 缺失取值视为空', () => {
    const ws = installModel(
      makeSheetModel(1, ['名称', 'Bangumi_URL'], [
        ['', ''],
        ['', ''],
      ]),
    )
    model.truncatedColumns = { 2: 1 }

    const plan = planEmptyNameRows(ws)

    expect(plan.deleteRows).toEqual([2, 3])
  })
})
