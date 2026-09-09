import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOpenWorkbooks: vi.fn(),
  findHeaderRow: vi.fn(),
  getColumnMap: vi.fn(),
  getCellValue: vi.fn(),
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
  getCellValue: mocks.getCellValue,
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

import { CLEAN_EXCLUDES } from '../ts/panel/clean-rules.js'
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
import { transformCellValue } from '../ts/panel/clean-transforms.js'

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

/** 设置 getCellValue 的单格网格（供新番表表头 / 名称列探测使用） */
function setCellGrid(rows: Record<number, Record<number, string>>): void {
  mocks.getCellValue.mockImplementation(
    (_ws: unknown, row: number, col: number) => rows[row]?.[col] ?? '',
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

function fakeScanResult(
  plans: CleanScanResult['plans'],
  targets: CleanTargetInfo[],
): CleanScanResult {
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

  it('用户显式勾选的工作表（selectedSheets）命中时入选', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    const targets = listCleanTargets([{ workbookKey: 'D:/books/数据表.xlsx', sheetName: '动画' }])
    expect(targets).toHaveLength(1)
    expect(targets[0]?.sheetName).toBe('动画')
  })

  it('用户未勾选该工作表时返回空数组', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    expect(
      listCleanTargets([{ workbookKey: 'D:/books/数据表.xlsx', sheetName: '其他表' }]),
    ).toHaveLength(0)
  })

  it('selectedSheets 为空数组时退化为不限制（保留旧行为）', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    expect(listCleanTargets([])).toHaveLength(1)
  })

  it('月历式新番表（无「名称」表头）按专属签名入选，并映射名称列与 TAGS 列', () => {
    mockWorkbookSheet('2026年4月新番表')
    mocks.findHeaderRow.mockReturnValue(0) // 标准路径失败 → 走新番表签名
    // 表头行（行2）命中签名：周更时间(D4) / 播放平台(F6) / 集数(L12) / TAGS(N14)
    setCellGrid({
      2: {
        4: '周更时间',
        6: '播放平台',
        10: '独播',
        11: '首播',
        12: '集数',
        13: '特殊',
        14: 'TAGS',
      },
      // 名称列候选（C3，表头为空）数据区有值 → 锚定「周更时间」左侧
      3: { 3: '新番表 by Hazx.' },
      5: { 3: '淫狱团地', 14: '搞笑 / 抽象 / 涩涩' },
    })
    mocks.getLastRow.mockReturnValue(5)
    makeGrid({ 3: { 3: '新番表 by Hazx.' }, 5: { 3: '淫狱团地' } })
    const targets = listCleanTargets()
    expect(targets).toHaveLength(1)
    const colMap = targets[0]?.colMap
    expect(colMap?.get('名称')).toBe(3) // 名称列 = C 列
    expect(colMap?.get('标签/分级')).toBe(14) // TAGS 列复用「标签/分级」键
  })

  it('新番表表头未命中签名时仍按标准「名称」要求跳过', () => {
    mockWorkbookSheet('随机表')
    mocks.findHeaderRow.mockReturnValue(0)
    setCellGrid({ 2: { 3: '随便一列', 5: '又一列' } })
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

  it('新番表清理专用关键词：合计/小计/总计/示例/新番表 by Hazx/版权平台标注 全部命中', () => {
    const target = fakeTarget('k', '新番表.xlsx / Sheet1')
    // 行 2 为正常数据行（含「bilibili」平台信息但不在排除关键词中），不应被排除
    makeGrid({
      2: { 1: '周一日二 18:00 bilibili' },
      3: { 1: '合计（共X行）' },
      4: { 1: '小计' },
      5: { 1: '总计' },
      6: { 1: '示例：四格漫画格式' },
      7: { 1: '新番表 by Hazx' },
      8: { 1: '版权平台标注示例' },
    })
    // fakeTarget 默认 lastRow=5，扩展以覆盖 6/7/8 行
    target.lastRow = 8
    const excluded = collectExcludedRows(target)
    expect(excluded.has(3)).toBe(true)
    expect(excluded.has(4)).toBe(true)
    expect(excluded.has(5)).toBe(true)
    expect(excluded.has(6)).toBe(true)
    expect(excluded.has(7)).toBe(true)
    expect(excluded.has(8)).toBe(true)
  })
})

// ========== 新番表 / 噪声行 ==========

describe('scanCleanRules · 新番表噪声行', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('新番表水印行（新番表 by Hazx）/ 说明行（版权平台标注）被整行删除，正常行保留', () => {
    mockWorkbookSheet('2026年4月新番表')
    mocks.findHeaderRow.mockReturnValue(0)
    setCellGrid({
      2: { 4: '周更时间', 14: 'TAGS' },
      3: { 3: '新番表 by Hazx.' },
      4: { 3: '新番表 by Hazx.' },
      5: { 3: '淫狱团地', 14: '搞笑 / 抽象 / 涩涩' },
      102: { 3: '版权平台标注示例' },
    })
    mocks.getLastRow.mockReturnValue(102)
    makeGrid({
      3: { 3: '新番表 by Hazx.' },
      4: { 3: '新番表 by Hazx.' },
      5: { 3: '淫狱团地', 14: '搞笑 / 抽象 / 涩涩' },
      102: { 3: '版权平台标注示例' },
    })
    const result = scanCleanRules(['noise-rows'])
    const plans = result.plans.filter((plan) => plan.ruleId === 'noise-rows')
    expect(plans.length).toBeGreaterThan(0)
    const deleted = plans[0]?.deleteRows ?? []
    expect(deleted).toContain(3)
    expect(deleted).toContain(4)
    expect(deleted).toContain(102)
    expect(deleted).not.toContain(5) // 正常番剧行保留
  })
})

describe('transformCellValue · 新番表 TAGS 斜杠归一化', () => {
  it('「/」分隔统一为「 | 」', () => {
    const out = transformCellValue('normalizeTagSeparator', '搞笑 / 抽象 / 涩涩', { name: '' })
    expect(out.changed).toBe(true)
    expect(out.value).toBe('搞笑 | 抽象 | 涩涩')
  })

  it('重复的「/」分隔标签去重', () => {
    const out = transformCellValue('normalizeTagSeparator', '校园 / 恋爱 / 校园', { name: '' })
    expect(out.value).toBe('校园 | 恋爱')
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
