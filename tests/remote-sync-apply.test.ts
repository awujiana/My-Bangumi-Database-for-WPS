// @vitest-environment node
/**
 * @fileoverview `ts/sync/remote-sync-apply.ts` 删除阶段单测（假工作表，Node 直跑）
 *
 * 覆盖重点（性能审计 2026-10-24 P1 的回归钉）：
 * 删除阶段原来是 n 个待删行 = n 次 COM `Range(row:row).Delete()`——每次宿主都要
 * 做行位移与内部数据搬运，删除阶段明显慢于新增/更新。现改为**连续行合并成 run、
 * 一次 `Range(max:min).Delete()`**，本测试钉死：
 * 1. `groupContiguousDeleteRuns` 的分组语义（降序连续才合并；散乱各自成组）；
 * 2. 集成层：连续块只调一次 Delete 且地址是 "max:min"；散乱行仍一行一次
 *    （与旧行为逐字一致，永不比旧实现慢）；
 * 3. 批量删失败 → 回退逐行，全部行仍记为已删（不丢不错）；
 * 4. undo 条目仍逐行记、顺序不变（降序）；
 * 5. 取消检查在 run 边界：取消后未开始的 run 整组不删，计入 skipped。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: number, message?: string) => void>(),
  getDataSheet: vi.fn<() => unknown>(),
  findHeaderRow: vi.fn<(worksheet: unknown) => number>(),
  getLastRow: vi.fn<(worksheet: unknown) => number>(),
  getColumnMap: vi.fn<(worksheet: unknown, headerRow: number) => Map<string, number>>(),
  getCellValue: vi.fn<(worksheet: unknown, row: number, column: number) => string>(),
  readRowsCache: vi.fn<(worksheet: unknown, rows: readonly number[], maxColumn: number) => unknown>(),
  readRangeValues: vi.fn<(...arguments_: unknown[]) => unknown[]>(),
  readRangeCellValues: vi.fn<(...arguments_: unknown[]) => unknown[]>(),
  setCellValue: vi.fn<(...arguments_: unknown[]) => void>(),
  columnNumberToLetter: vi.fn<(column: number) => string>(),
  trim: vi.fn<(value: string) => string>(),
  getApp: vi.fn<() => unknown>(),
  addSyncRecords: vi.fn<(...arguments_: unknown[]) => void>(),
  recordRowDeleteEntry: vi.fn<(entry: { row: number; values: Record<number, string> }) => void>(),
  recordUndoEntry: vi.fn<(...arguments_: unknown[]) => void>(),
  beginUndoSession: vi.fn<() => void>(),
  endUndoSession: vi.fn<() => void>(),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  getDataSheet: m.getDataSheet,
  findHeaderRow: m.findHeaderRow,
  getLastRow: m.getLastRow,
  getColumnMap: m.getColumnMap,
  getCellValue: m.getCellValue,
  readRangeValues: m.readRangeValues,
  readRangeCellValues: m.readRangeCellValues,
  readRowsCache: m.readRowsCache,
  setCellValue: m.setCellValue,
  columnNumberToLetter: m.columnNumberToLetter,
  trim: m.trim,
  getApp: m.getApp,
}))

vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => ({ toast: vi.fn() }),
}))

vi.mock('../ts/sync/sync-record.js', () => ({
  addSyncRecords: m.addSyncRecords,
  addSyncRecordSummary: vi.fn(),
}))

vi.mock('../ts/sync/undo-stack.js', () => ({
  beginUndoSession: m.beginUndoSession,
  endUndoSession: m.endUndoSession,
  recordRowDeleteEntry: m.recordRowDeleteEntry,
  recordUndoEntry: m.recordUndoEntry,
}))

import { applyDiffToSheet, groupContiguousDeleteRuns } from '../ts/sync/remote-sync-apply.js'
import type { GithubSyncDiff } from '../ts/sync/github-sync-diff.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'

/** 假工作表：Range(addr) 记录地址并返回可抛错的 Delete */
function makeWorksheet(onDelete?: (address: string) => void): {
  worksheet: WpsWorksheet
  calls: string[]
} {
  const calls: string[] = []
  const worksheet: Record<string, unknown> = {
    Range: (address: string) => {
      calls.push(address)
      return {
        Delete: () => {
          onDelete?.(address)
        },
      }
    },
  }
  return { worksheet: worksheet as unknown as WpsWorksheet, calls }
}

/** 造 delete diff 列表（行号即传入顺序） */
function deleteDiffs(rows: readonly number[]): GithubSyncDiff[] {
  return rows.map((row) => ({
    kind: 'delete' as const,
    subjectId: `sid-${String(row)}`,
    localRow: row,
    changedFields: [] as string[],
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  m.findHeaderRow.mockReturnValue(1)
  m.getLastRow.mockReturnValue(100)
  m.getColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5], ['名称', 2]]))
  m.getCellValue.mockReturnValue('')
  // 快照缓存：每行给两列旧值（命中缓存就不走逐格读）
  m.readRowsCache.mockImplementation((_worksheet: unknown, rows: readonly number[]) => {
    const cache = new Map<number, Map<number, string>>()
    for (const row of rows) cache.set(row, new Map([[2, '旧名称'], [5, 'https://bgm.tv/subject/x']]))
    return cache
  })
  m.trim.mockImplementation((value: string) => value.trim())
  m.columnNumberToLetter.mockImplementation((column: number) => String.fromCodePoint(64 + column))
  m.getApp.mockReturnValue({ ScreenUpdating: true, Calculation: 0 })
})

// ========== 纯函数：分组语义 ==========

describe('groupContiguousDeleteRuns', () => {
  it('降序连续行合并成一个 run', () => {
    const runs = groupContiguousDeleteRuns([30, 29, 28], (row) => row)
    expect(runs).toEqual([[30, 29, 28]])
  })

  it('有缺口就分组；散乱行各自成组（与旧逐行行为一致）', () => {
    expect(groupContiguousDeleteRuns([30, 29, 15, 3], (row) => row)).toEqual([[30, 29], [15], [3]])
    expect(groupContiguousDeleteRuns([10, 8, 5], (row) => row)).toEqual([[10], [8], [5]])
  })

  it('空 / 单行 / 重复行号', () => {
    expect(groupContiguousDeleteRuns([], (row) => row)).toEqual([])
    expect(groupContiguousDeleteRuns([7], (row) => row)).toEqual([[7]])
    // 行号相同不连续（差 0），各自成组
    expect(groupContiguousDeleteRuns([7, 7], (row) => row)).toEqual([[7], [7]])
  })

  it('按对象字段取行号（真实调用形状）', () => {
    const runs = groupContiguousDeleteRuns(deleteDiffs([12, 11, 4]), (diff) => diff.localRow ?? 0)
    expect(runs.map((run) => run.map((diff) => diff.localRow))).toEqual([[12, 11], [4]])
  })
})

// ========== 集成：删除阶段的 COM 调用形态 ==========

describe('applyDiffToSheet 删除阶段', () => {
  it('连续行只调一次 Delete（地址 max:min），散乱行一行一次', async () => {
    const { worksheet, calls } = makeWorksheet()
    m.getDataSheet.mockReturnValue(worksheet)

    const result = await applyDiffToSheet(deleteDiffs([30, 29, 28, 15, 3]), 'mirror')

    // 3 次调用：一个 3 行块 + 两个单行（旧实现是 5 次）
    expect(calls).toEqual(['30:28', '15:15', '3:3'])
    expect(result.deleted).toBe(5)
    expect(result.failed).toBe(0)
  })

  it('undo 条目逐行记且顺序不变（降序）', async () => {
    const { worksheet } = makeWorksheet()
    m.getDataSheet.mockReturnValue(worksheet)

    await applyDiffToSheet(deleteDiffs([30, 29, 28]), 'mirror')

    expect(m.recordRowDeleteEntry.mock.calls.map(([entry]) => entry.row)).toEqual([30, 29, 28])
  })

  it('批量删失败 → 回退逐行，全部行仍记为已删', async () => {
    // 多行地址（含冒号且非 "n:n"）抛错 → 触发逐行兜底
    const { worksheet, calls } = makeWorksheet((address) => {
      // 单行地址 "n:n" 放行；多行块地址抛错 → 触发逐行兜底
      const [from, to] = address.split(':', 2)
      if (from !== to) throw new Error('宿主拒绝多区域删除')
    })
    m.getDataSheet.mockReturnValue(worksheet)

    const result = await applyDiffToSheet(deleteDiffs([30, 29, 28]), 'mirror')

    // 先试一次批量（30:28），失败后逐行 30/29/28
    expect(calls).toEqual(['30:28', '30:30', '29:29', '28:28'])
    expect(result.deleted).toBe(3)
    expect(result.failed).toBe(0)
  })

  it('取消：未开始的 run 整组不删，计入 skipped', async () => {
    const { worksheet, calls } = makeWorksheet()
    m.getDataSheet.mockReturnValue(worksheet)
    // 快照读取时（删任何行之前）取消——模拟用户在删除阶段点了停止
    const controller = new AbortController()
    m.readRowsCache.mockImplementation(() => {
      controller.abort()
      return null
    })

    const result = await applyDiffToSheet(deleteDiffs([30, 29, 15]), 'mirror', undefined, undefined, controller.signal)

    expect(calls).toEqual([])
    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(3)
  })
})
