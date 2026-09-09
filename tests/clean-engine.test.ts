import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOpenWorkbooks: vi.fn(),
  findHeaderRow: vi.fn(),
  getColumnMap: vi.fn(),
  getLastRow: vi.fn(),
  readRangeValues: vi.fn(),
  setCellValue: vi.fn(),
  bgmLog: vi.fn(),
  planDuplicateRows: vi.fn(),
  planDuplicateUrlRows: vi.fn(),
  planEmptyNameRows: vi.fn(),
  applyRowPlan: vi.fn(),
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}))

vi.mock('../ts/tools/locked-sheet.js', () => ({
  getOpenWorkbooks: mocks.getOpenWorkbooks,
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mocks.bgmLog,
  findHeaderRow: mocks.findHeaderRow,
  getColumnMap: mocks.getColumnMap,
  getLastRow: mocks.getLastRow,
  readRangeValues: mocks.readRangeValues,
  setCellValue: mocks.setCellValue,
}))

vi.mock('../ts/sync/sheet-cleaning.js', () => ({
  planDuplicateRows: mocks.planDuplicateRows,
  planDuplicateUrlRows: mocks.planDuplicateUrlRows,
  planEmptyNameRows: mocks.planEmptyNameRows,
  applyRowPlan: mocks.applyRowPlan,
}))

import {
  CLEAN_EXCLUDES,
} from '../ts/panel/clean-rules.js'
import {
  listCleanTargets,
  collectExcludedRows,
  scanCleanRules,
  aggregatePlans,
  runCleanPlans,
  mergeChangeValues,
  formatBytes,
  describeCleanScope,
} from '../ts/panel/clean-engine.js'
import type { CleanTargetInfo, CleanScanResult } from '../ts/panel/clean-engine.js'

// ========== 测试工具 ==========

/** 构造虚拟网格：grid[行][列] = 单元格文本 */
function makeGrid(rows: Record<number, Record<number, string>>): void {
  mocks.readRangeValues.mockImplementation(
    (_ws: unknown, r1: number, r2: number, c1: number, c2: number) => {
      const out: string[][] = []
      for (let row = r1; row <= r2; row += 1) {
        const line: string[] = []
        for (let col = c1; col <= c2; col += 1) {
          line.push(rows[row]?.[col] ?? '')
        }
        out.push(line)
      }
      return out
    },
  )
}

const DEFAULT_COL_MAP = new Map<string, number>([
  ['名称', 1],
  ['Bangumi_URL', 2],
  ['标签/分级', 3],
])

function mockWorkbookSheet(sheetName: string, path = 'D:/books/数据表.xlsx'): void {
  const ws = { Name: sheetName }
  const wb = {
    Name: '数据表.xlsx',
    FullName: path,
    Worksheets: { Count: 1, Item: () => ws },
  }
  mocks.getOpenWorkbooks.mockReturnValue([wb])
  mocks.findHeaderRow.mockReturnValue(1)
  mocks.getColumnMap.mockReturnValue(new Map(DEFAULT_COL_MAP))
  mocks.getLastRow.mockReturnValue(4)
}

/** 构造最小 CleanTargetInfo（aggregatePlans / runCleanPlans 测试用） */
function fakeTarget(key: string, label: string, sheetName = '动画'): CleanTargetInfo {
  return {
    key,
    workbookName: label,
    workbookPath: `D:/books/${label}.xlsx`,
    sheetName,
    label,
    headerRow: 1,
    lastRow: 5,
    colMap: new Map(DEFAULT_COL_MAP),
    ws: { Name: sheetName } as CleanTargetInfo['ws'],
  }
}

function fakeScanResult(plans: CleanScanResult['plans'], targets: CleanTargetInfo[]): CleanScanResult {
  return {
    targets,
    plans,
    fileCount: new Set(targets.map((target) => target.workbookPath)).size,
    targetCount: targets.length,
    itemCount: plans.reduce((sum, plan) => sum + plan.deleteRows.length + plan.changes.length, 0),
    estimatedBytes: 0,
    notes: [],
  }
}

// ========== 目标解析 ==========

describe('listCleanTargets · 配置过滤', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('命中「名称」表头的正常表入选', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    const targets = listCleanTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0]?.label).toBe('数据表.xlsx / 动画')
  })

  it('WPS 临时锁文件（~$ 前缀路径）被排除', () => {
    mockWorkbookSheet('动画', 'D:/books/~$数据表.xlsx')
    expect(listCleanTargets()).toHaveLength(0)
  })

  it('排除表名关键词（同步记录 / 日志）整表跳过', () => {
    mockWorkbookSheet('同步记录')
    expect(listCleanTargets()).toHaveLength(0)
    mockWorkbookSheet('运行日志')
    expect(listCleanTargets()).toHaveLength(0)
  })

  it('缺少「名称」表头的工作表跳过', () => {
    mockWorkbookSheet('动画')
    mocks.getColumnMap.mockReturnValue(new Map([['标题', 1]]))
    expect(listCleanTargets()).toHaveLength(0)
  })

  it('数据行数低于 minDataRows 的表跳过', () => {
    mockWorkbookSheet('动画')
    // headerRow=1 → 0 数据行
    mocks.getLastRow.mockReturnValue(1)
    expect(listCleanTargets()).toHaveLength(0)
  })

  it('无打开工作簿时返回空数组', () => {
    mocks.getOpenWorkbooks.mockReturnValue([])
    expect(listCleanTargets()).toHaveLength(0)
  })
})

// ========== 排除行计算 ==========

describe('collectExcludedRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('行内文本命中排除关键词的行被排除', () => {
    const target = fakeTarget('k', '数据表 / 动画')
    makeGrid({ 2: { 1: '作品A' }, 3: { 1: '合计' }, 4: { 1: '新番表 by Hazx.' } })
    const excluded = collectExcludedRows(target)
    expect(excluded.has(3)).toBe(true)
    expect(excluded.has(4)).toBe(true)
    expect(excluded.has(2)).toBe(false)
  })

  it('正常数据行不误伤', () => {
    const target = fakeTarget('k', '数据表 / 动画')
    makeGrid({ 2: { 1: '作品A', 2: 'url' }, 3: { 1: '作品B' } })
    expect(collectExcludedRows(target).size).toBe(0)
  })
})

// ========== 扫描（预览） ==========

describe('scanCleanRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cellTransform 规则产出单元格变更（排除行不参与）', () => {
    mockWorkbookSheet('动画')
    makeGrid({
      2: { 1: '作品A', 3: 'B站 | 漫画改' },
      3: { 1: '合计（示例）', 3: '待定档' },
      4: { 1: '作品C', 3: '漫画改 | 2020' },
    })
    const result = scanCleanRules(['noise-tags'])
    expect(result.targets).toHaveLength(1)
    expect(result.plans).toHaveLength(1)
    const plan = result.plans[0]
    expect(plan?.ruleId).toBe('noise-tags')
    // 行 3 是排除行（含「合计」），不产生变更；行 2/4 正常
    expect(plan?.changes.map((change) => change.row)).toEqual([2, 4])
    expect(plan?.changes[0]?.nextValue).toBe('漫画改')
    // 行 4：「2020」命中噪声年份正则，「漫画改」保留
    expect(plan?.changes[1]?.nextValue).toBe('漫画改')
    expect(result.itemCount).toBe(2)
  })

  it('行级规则（重复名称行）产出删除行计划', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: '作品A' }, 3: { 1: '作品A' } })
    mocks.planDuplicateRows.mockReturnValue({
      deleteRows: [3],
      changes: [{ row: 2, col: 3, value: '合并标签' }],
      groups: 1,
      mergedGroups: 1,
    })
    const result = scanCleanRules(['dup-name'])
    const plan = result.plans[0]
    expect(plan?.deleteRows).toEqual([3])
    expect(plan?.changes[0]?.nextValue).toBe('合并标签')
    expect(plan?.estimatedBytes).toBeGreaterThan(0)
    expect(mocks.planDuplicateRows).toHaveBeenCalledTimes(1)
  })

  it('未知规则 ID 记入 notes', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    const result = scanCleanRules(['__no_such_rule__'])
    expect(result.plans).toHaveLength(0)
    expect(result.notes.some((note) => note.includes('未知清理项'))).toBe(true)
  })

  it('规则跳过时原因写入 notes', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    mocks.planDuplicateUrlRows.mockReturnValue({
      deleteRows: [],
      changes: [],
      groups: 0,
      mergedGroups: 0,
      skippedReason: '未找到「Bangumi_URL」列',
    })
    const result = scanCleanRules(['dup-url'])
    expect(result.plans).toHaveLength(0)
    expect(result.notes.join('\n')).toContain('未找到「Bangumi_URL」列')
  })

  it('无可用目标时 notes 提示', () => {
    mocks.getOpenWorkbooks.mockReturnValue([])
    const result = scanCleanRules(['noise-tags'])
    expect(result.targetCount).toBe(0)
    expect(result.notes.join('\n')).toContain('未找到符合目标配置')
  })
})

// ========== 聚合与执行 ==========

describe('mergeChangeValues', () => {
  it('按 | 拆分后保序去重合并', () => {
    expect(mergeChangeValues('A | B', 'B | C')).toBe('A | B | C')
  })

  it('空输入不产生多余分隔符', () => {
    expect(mergeChangeValues('', 'A')).toBe('A')
  })
})

describe('aggregatePlans', () => {
  it('同格多次变更合并；落在待删除行上的写入被剔除', () => {
    const target = fakeTarget('t1', '数据表 / 动画')
    const result = fakeScanResult(
      [
        {
          ruleId: 'dup-name',
          ruleName: '重复名称行',
          targetKey: 't1',
          targetLabel: target.label,
          deleteRows: [3],
          changes: [],
          estimatedBytes: 0,
        },
        {
          ruleId: 'noise-tags',
          ruleName: '噪声标签',
          targetKey: 't1',
          targetLabel: target.label,
          deleteRows: [],
          changes: [
            { row: 2, col: 3, columnName: '标签/分级', oldValue: 'A', nextValue: 'A' },
            { row: 2, col: 3, columnName: '标签/分级', oldValue: 'A', nextValue: 'B' },
            { row: 3, col: 3, columnName: '标签/分级', oldValue: 'X', nextValue: 'X' },
          ],
          estimatedBytes: 0,
        },
      ],
      [target],
    )
    const buckets = aggregatePlans(result)
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.removedRows.has(3)).toBe(true)
    // 行 3 的写入被剔除，行 2 同格两次变更合并为 A | B
    expect(buckets[0]?.changes.size).toBe(1)
    expect(buckets[0]?.changes.get('2:3')?.nextValue).toBe('A | B')
  })
})

describe('runCleanPlans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('先写单元格变更再删行；进度回调逐步递增', async () => {
    const target = fakeTarget('t1', '数据表 / 动画')
    const result = fakeScanResult(
      [
        {
          ruleId: 'noise-tags',
          ruleName: '噪声标签',
          targetKey: 't1',
          targetLabel: target.label,
          deleteRows: [4],
          changes: [{ row: 2, col: 3, columnName: '标签/分级', oldValue: 'B站', nextValue: '' }],
          estimatedBytes: 0,
        },
      ],
      [target],
    )
    mocks.applyRowPlan.mockReturnValue(1)
    const progress: string[] = []
    const runResult = await runCleanPlans(result, (done, total, message) => {
      progress.push(`${String(done)}/${String(total)}:${message}`)
    })

    expect(mocks.setCellValue).toHaveBeenCalledWith(target.ws, 2, 3, '')
    expect(mocks.applyRowPlan).toHaveBeenCalledTimes(1)
    expect(runResult.deletedRows).toBe(1)
    expect(runResult.changedCells).toBe(1)
    expect(runResult.targets[0]?.error).toBeUndefined()
    expect(progress).toHaveLength(2)
    expect(progress[0]).toContain('正在清理')
  })

  it('单个目标失败不影响其他目标（异常隔离）', async () => {
    const t1 = fakeTarget('t1', '数据表 / 动画')
    const t2 = fakeTarget('t2', '数据表 / 剧场版', '剧场版')
    const result = fakeScanResult(
      [
        {
          ruleId: 'dup-name',
          ruleName: '重复名称行',
          targetKey: 't1',
          targetLabel: t1.label,
          deleteRows: [3],
          changes: [],
          estimatedBytes: 0,
        },
        {
          ruleId: 'dup-name',
          ruleName: '重复名称行',
          targetKey: 't2',
          targetLabel: t2.label,
          deleteRows: [4],
          changes: [],
          estimatedBytes: 0,
        },
      ],
      [t1, t2],
    )
    mocks.applyRowPlan.mockImplementation((ws: { Name: string }) => {
      if (ws.Name === '动画') throw new Error('COM 异常')
      return 1
    })
    const runResult = await runCleanPlans(result)
    expect(runResult.targets[0]?.error).toContain('COM 异常')
    expect(runResult.targets[0]?.deletedRows).toBe(0)
    expect(runResult.targets[1]?.deletedRows).toBe(1)
    expect(runResult.targets[1]?.error).toBeUndefined()
    expect(runResult.deletedRows).toBe(1)
  })

  it('空计划直接返回零结果', async () => {
    const runResult = await runCleanPlans(fakeScanResult([], []))
    expect(runResult.deletedRows).toBe(0)
    expect(runResult.changedCells).toBe(0)
    expect(runResult.targets).toHaveLength(0)
  })
})

// ========== 格式化与范围摘要 ==========

describe('formatBytes', () => {
  it('0 → 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('KB / MB 进位', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })

  it('非法输入兜底为 0 B', () => {
    expect(formatBytes(NaN)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
  })
})

describe('describeCleanScope', () => {
  it('返回配置快照（页面只读展示，不硬编码）', () => {
    const scope = describeCleanScope()
    expect(scope.requireHeaderKeywords).toContain('名称')
    expect(scope.excludeSheetName).toContain('同步记录')
    expect(scope.maxDataRows).toBeGreaterThan(0)
    // 返回的是副本，改动不影响原配置
    scope.excludeSheetName.push('hack')
    expect(CLEAN_EXCLUDES.sheetName).not.toContain('hack')
  })
})
