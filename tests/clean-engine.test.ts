import { describe, it, expect, beforeEach, vi } from 'vitest'

/** 行规则 mock 的调用参数形状（scanRowRule 传入 excludedRows + 共享 layout） */
interface PlanCallOptions {
  excludedRows?: ReadonlySet<number>
  layout?: unknown
}

const mocks = vi.hoisted(() => ({
  getOpenWorkbooks: vi.fn(),
  findHeaderRow: vi.fn(),
  getColumnMap: vi.fn(),
  getCellValue: vi.fn(),
  getLastRow: vi.fn(),
  readRangeValues: vi.fn(),
  setCellValue: vi.fn(),
  bgmLog: vi.fn(),
  planDuplicateRows: vi.fn<(worksheet: unknown, options?: PlanCallOptions) => unknown>(),
  planDuplicateUrlRows: vi.fn<(worksheet: unknown, options?: PlanCallOptions) => unknown>(),
  planEmptyNameRows: vi.fn<(worksheet: unknown, options?: PlanCallOptions) => unknown>(),
  applyRowPlan: vi.fn(),
  readSheetLayout: vi.fn(),
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
  readSheetLayout: mocks.readSheetLayout,
}))

import {
  CLEAN_EXCLUDES,
  CLEAN_RULES,
  CLEAN_TARGETS,
  ROW_BYTES_FALLBACK,
} from '../ts/panel/clean-rules.js'
import type { CleanRule } from '../ts/panel/clean-rules.js'
import {
  listCleanTargets,
  collectExcludedRows,
  countCleanTargets,
  estimateRowBytes,
  scanCleanRules,
  aggregatePlans,
  runCleanPlans,
  mergeChangeValues,
  formatBytes,
  describeCleanScope,
  inspectWorksheet,
} from '../ts/panel/clean-engine.js'
import type { CleanTargetInfo, CleanScanResult } from '../ts/panel/clean-engine.js'
import { transformCellValue } from '../ts/panel/clean-transforms.js'

// ========== 测试工具 ==========

/**
 * 最近一次 setCellGrid 的表头网格。
 *
 * 真实工作表只有一张：逐格读（getCellValue）与矩形读（readRangeValues）必须看到
 * 同一份数据。此前两套网格互不相干，导致走矩形快路径的扫描
 * （scanXinFanHeaderRow）看不到表头行 —— 桩不忠实，改桩不改生产。
 */
let cellGrid: Record<number, Record<number, string>> = {}

/** 构造虚拟网格：grid[行][列] = 单元格文本（与 cellGrid 合并，rows 优先） */
function makeGrid(rows: Record<number, Record<number, string>>): void {
  const merged: Record<number, Record<number, string>> = { ...cellGrid }
  for (const [rowKey, cols] of Object.entries(rows)) {
    const row = Number(rowKey)
    merged[row] = { ...merged[row], ...cols }
  }
  mocks.readRangeValues.mockImplementation(
    (_ws: unknown, r1: number, r2: number, c1: number, c2: number) => {
      const out: string[][] = []
      for (let row = r1; row <= r2; row += 1) {
        const line: string[] = []
        for (let col = c1; col <= c2; col += 1) {
          line.push(merged[row]?.[col] ?? '')
        }
        out.push(line)
      }
      return out
    },
  )
}

/** 设置 getCellValue 的单格网格（供新番表表头 / 名称列探测使用） */
function setCellGrid(rows: Record<number, Record<number, string>>): void {
  cellGrid = rows
  mocks.getCellValue.mockImplementation(
    (_ws: unknown, row: number, col: number) => rows[row]?.[col] ?? '',
  )
}

const DEFAULT_COL_MAP = new Map<string, number>([
  ['名称', 1],
  ['Bangumi_URL', 2],
  ['标签/分级', 3],
])

function mockWorkbookSheet(
  sheetName: string,
  path = 'D:/books/数据表.xlsx',
  options: { usedRangeLastRow?: number } = {},
): unknown {
  const worksheet = {
    Name: sheetName,
    // 引擎优先读 UsedRange 计算末行（未提供时回退 getLastRow）
    ...(options.usedRangeLastRow !== undefined && {
      UsedRange: {
        Row: 1,
        Rows: { Count: options.usedRangeLastRow },
      },
    }),
  }
  const wb = {
    Name: '数据表.xlsx',
    FullName: path,
    Worksheets: { Count: 1, Item: () => worksheet },
  }
  mocks.getOpenWorkbooks.mockReturnValue([wb])
  mocks.findHeaderRow.mockReturnValue(1)
  mocks.getColumnMap.mockReturnValue(new Map(DEFAULT_COL_MAP))
  mocks.getLastRow.mockReturnValue(4)
  return worksheet
}

// 每个用例前把矩形读桩复位为「未实现 ⇒ 空数组」：
// 否则上一个用例 makeGrid 设进去的实现会泄漏到下一个用例，
// 让走矩形快路径的代码读到别的用例的网格（桩不忠实，改桩不改生产）。
// makeGrid / 用例内的实现会在本钩子之后覆盖它。
beforeEach(() => {
  cellGrid = {}
  mocks.readRangeValues.mockImplementation(() => [])
})

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
    worksheet: { Name: sheetName } as CleanTargetInfo['worksheet'],
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

  it('未命中「名称 / Bangumi_URL」特征列的工作表跳过', () => {
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

  it('缺少「名称」但有 Bangumi_URL 的表（如「剧集和小说」）默认入选', () => {
    mockWorkbookSheet('剧集和小说', 'D:/books/娱乐影视游戏记录.xlsm', { usedRangeLastRow: 30 })
    // 表头行 + Bangumi_URL 列 → 判定为 Bangumi 数据表（名称列可能叫「剧集名 / 小说名」）
    mocks.getColumnMap.mockReturnValue(
      new Map([
        ['序列号', 1],
        ['是否看完', 2],
        ['开播季度', 4],
        ['Bangumi_URL', 9],
      ]),
    )
    makeGrid({ 2: { 1: '1' }, 3: { 1: '2' } })
    const targets = listCleanTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0]?.sheetName).toBe('剧集和小说')
    expect(targets[0]?.lastRow).toBe(30)
    // 名称列缺失，但 URL 类规则仍可用；缺列的行级规则扫描时自行跳过
    expect(targets[0]?.colMap.has('名称')).toBe(false)
  })

  it('既无「名称」也无「Bangumi_URL」的表跳过（非 Bangumi 数据表）', () => {
    mockWorkbookSheet('参数表')
    mocks.getColumnMap.mockReturnValue(
      new Map([
        ['序号', 1],
        ['说明', 2],
      ]),
    )
    expect(listCleanTargets()).toHaveLength(0)
  })

  it('用户显式勾选的工作表（selectedSheets）命中时入选', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    const targets = listCleanTargets([{ workbookKey: 'D:/books/数据表.xlsx', sheetName: '动画' }])
    expect(targets).toHaveLength(1)
    expect(targets[0]?.sheetName).toBe('动画')
  })

  it('显式勾选可绕过「特征列」硬门槛（页面能勾选 → 引擎必定处理）', () => {
    mockWorkbookSheet('参数表', 'D:/books/参数.xlsx', { usedRangeLastRow: 30 })
    // 既无「名称」也无「Bangumi_URL」→ 默认不入选
    mocks.getColumnMap.mockReturnValue(new Map([['序号', 1]]))
    makeGrid({ 2: { 1: '1' }, 3: { 1: '2' } })
    expect(listCleanTargets()).toHaveLength(0)

    const targets = listCleanTargets([{ workbookKey: 'D:/books/参数.xlsx', sheetName: '参数表' }])
    expect(targets).toHaveLength(1)
    expect(targets[0]?.headerRow).toBe(1)
    expect(targets[0]?.lastRow).toBe(30)
    // 特征列缺失 → colMap 无「名称」/「Bangumi_URL」，规则扫描时会自行跳过并说明原因
    expect(targets[0]?.colMap.has('名称')).toBe(false)
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
    // 标准路径失败 → 走新番表签名
    mocks.findHeaderRow.mockReturnValue(0)
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
    // 名称列 = C 列
    expect(colMap?.get('名称')).toBe(3)
    // TAGS 列复用「标签/分级」键
    expect(colMap?.get('标签/分级')).toBe(14)
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

  it('新番表水印行（新番表 by Hazx）/ 说明行（版权平台标注）被整行删除，正常行保留', async () => {
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
    const result = await scanCleanRules(['noise-rows'])
    const plans = result.plans.filter((plan) => plan.ruleId === 'noise-rows')
    expect(plans.length).toBeGreaterThan(0)
    const deleted = plans[0]?.deleteRows ?? []
    expect(deleted).toContain(3)
    expect(deleted).toContain(4)
    expect(deleted).toContain(102)
    // 正常番剧行保留
    expect(deleted).not.toContain(5)
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

  it('cellTransform 规则产出单元格变更（排除行不参与）', async () => {
    mockWorkbookSheet('动画')
    makeGrid({
      2: { 1: '作品A', 3: 'B站 | 漫画改' },
      3: { 1: '合计（示例）', 3: '待定档' },
      4: { 1: '作品C', 3: '漫画改 | 2020' },
    })
    const result = await scanCleanRules(['noise-tags'])
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

  it('行级规则（重复名称行）产出删除行计划', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: '作品A' }, 3: { 1: '作品A' } })
    mocks.planDuplicateRows.mockReturnValue({
      deleteRows: [3],
      changes: [{ row: 2, col: 3, value: '合并标签' }],
      groups: 1,
      mergedGroups: 1,
    })
    const result = await scanCleanRules(['dup-name'])
    const plan = result.plans[0]
    expect(plan?.deleteRows).toEqual([3])
    expect(plan?.changes[0]?.nextValue).toBe('合并标签')
    expect(plan?.estimatedBytes).toBeGreaterThan(0)
    expect(mocks.planDuplicateRows).toHaveBeenCalledTimes(1)
  })

  it('表结构每目标只解析一次，三个行规则共享同一 layout（§5.6 A1）', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: '作品A' }, 3: { 1: '作品A' } })
    const shared = {
      headerRow: 1,
      lastRow: 4,
      colMap: new Map(DEFAULT_COL_MAP),
      dataStartRow: 2,
    }
    mocks.readSheetLayout.mockReturnValue(shared)
    mocks.planDuplicateRows.mockReturnValue({
      deleteRows: [3],
      changes: [],
      groups: 1,
      mergedGroups: 0,
    })
    mocks.planDuplicateUrlRows.mockReturnValue({
      deleteRows: [],
      changes: [],
      groups: 0,
      mergedGroups: 0,
      skippedReason: '未发现同 URL 重复行',
    })
    mocks.planEmptyNameRows.mockReturnValue({
      deleteRows: [],
      changes: [],
      groups: 0,
      mergedGroups: 0,
      skippedReason: '未发现空白数据行',
    })

    const result = await scanCleanRules(['dup-name', 'dup-url', 'empty-name'])

    // 每目标一次解析（三个行规则共用），而非每规则各解析一次（~3 次 COM × 规则数）
    expect(mocks.readSheetLayout).toHaveBeenCalledTimes(1)
    expect(mocks.planDuplicateRows.mock.calls[0]?.[1]?.layout).toBe(shared)
    expect(mocks.planDuplicateUrlRows.mock.calls[0]?.[1]?.layout).toBe(shared)
    expect(mocks.planEmptyNameRows.mock.calls[0]?.[1]?.layout).toBe(shared)
    expect(result.plans).toHaveLength(1)
  })

  it('新番表目标（readSheetLayout 为 null）行规则收到 null：语义与自行解析失败一致', async () => {
    mockWorkbookSheet('2026年4月新番表')
    makeGrid({ 3: { 3: '新番表 by Hazx.' }, 5: { 3: '淫狱团地' } })
    // 新番表无标准「名称」表头 → readSheetLayout 标准路径解析失败返回 null。
    // 共享该结果不会让新番表突然获得行级清理能力（推导 colMap 不进 layout 选项）。
    mocks.readSheetLayout.mockReturnValue(null)
    mocks.planDuplicateRows.mockReturnValue({
      deleteRows: [],
      changes: [],
      groups: 0,
      mergedGroups: 0,
      skippedReason: '未找到表头行或无数据行',
    })

    const result = await scanCleanRules(['dup-name'])

    expect(mocks.planDuplicateRows.mock.calls[0]?.[1]?.layout).toBeNull()
    expect(result.plans).toHaveLength(0)
    expect(result.notes.join('\n')).toContain('未找到表头行或无数据行')
  })

  it('未知规则 ID 记入 notes', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    const result = await scanCleanRules(['__no_such_rule__'])
    expect(result.plans).toHaveLength(0)
    expect(result.notes.some((note) => note.includes('未知清理项'))).toBe(true)
  })

  it('规则跳过时原因写入 notes', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    mocks.planDuplicateUrlRows.mockReturnValue({
      deleteRows: [],
      changes: [],
      groups: 0,
      mergedGroups: 0,
      skippedReason: '未找到「Bangumi_URL」列',
    })
    const result = await scanCleanRules(['dup-url'])
    expect(result.plans).toHaveLength(0)
    expect(result.notes.join('\n')).toContain('未找到「Bangumi_URL」列')
  })

  it('无可用目标时 notes 提示', async () => {
    mocks.getOpenWorkbooks.mockReturnValue([])
    const result = await scanCleanRules(['noise-tags'])
    expect(result.targetCount).toBe(0)
    expect(result.notes.join('\n')).toContain('未找到可清理目标')
  })
})

// ========== 工作表探测（页面与引擎共用） ==========

describe('inspectWorksheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('标准数据表：表头行 / 行数 / 名称列 / 可清理', () => {
    mockWorkbookSheet('动画')
    const info = inspectWorksheet({ Name: '动画' } as CleanTargetInfo['worksheet'])
    expect(info.headerRow).toBe(1)
    expect(info.lastRow).toBe(4)
    expect(info.dataRows).toBe(3)
    expect(info.hasNameColumn).toBe(true)
    expect(info.eligible).toBe(true)
    expect(info.reason).toBe('')
    expect(info.isXinFan).toBe(false)
  })

  it('优先用 UsedRange 计算末行（真实数据行数）', () => {
    const worksheet = mockWorkbookSheet('动画', 'D:/books/数据表.xlsx', { usedRangeLastRow: 120 })
    const info = inspectWorksheet(worksheet as CleanTargetInfo['worksheet'])
    expect(info.lastRow).toBe(120)
    expect(info.dataRows).toBe(119)
    expect(info.eligible).toBe(true)
  })

  it('未命中特征列：eligible=false 且给出原因', () => {
    mockWorkbookSheet('参数表')
    mocks.getColumnMap.mockReturnValue(new Map([['序号', 1]]))
    const info = inspectWorksheet({ Name: '参数表' } as CleanTargetInfo['worksheet'])
    expect(info.hasNameColumn).toBe(false)
    expect(info.isBangumiSheet).toBe(false)
    expect(info.eligible).toBe(false)
    expect(info.reason).toContain('特征列')
  })

  it('仅有 Bangumi_URL 而无「名称」列：仍判定为 Bangumi 数据表且可清理', () => {
    const worksheet = mockWorkbookSheet('剧集和小说', 'D:/books/娱乐影视游戏记录.xlsm', {
      usedRangeLastRow: 30,
    })
    mocks.getColumnMap.mockReturnValue(
      new Map([
        ['序列号', 1],
        ['Bangumi_URL', 9],
      ]),
    )
    const info = inspectWorksheet(worksheet as CleanTargetInfo['worksheet'])
    expect(info.hasNameColumn).toBe(false)
    expect(info.isBangumiSheet).toBe(true)
    expect(info.eligible).toBe(true)
    expect(info.reason).toBe('')
    expect(info.dataRows).toBe(29)
  })

  it('完全没有表头：reason 为未识别到表头行', () => {
    mockWorkbookSheet('空白表')
    // 无标准表头，且新番表签名也不命中（所有单元格为空）
    mocks.findHeaderRow.mockReturnValue(0)
    mocks.getCellValue.mockReturnValue('')
    const info = inspectWorksheet({ Name: '空白表' } as CleanTargetInfo['worksheet'])
    expect(info.headerRow).toBe(0)
    expect(info.eligible).toBe(false)
    expect(info.reason).toBe('未识别到表头行')
  })

  it('有名称列但无数据行：reason 为无数据行', () => {
    mockWorkbookSheet('空数据表')
    mocks.findHeaderRow.mockReturnValue(3)
    mocks.getLastRow.mockReturnValue(3)
    const info = inspectWorksheet({ Name: '空数据表' } as CleanTargetInfo['worksheet'])
    expect(info.dataRows).toBe(0)
    expect(info.reason).toBe('无数据行')
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

    expect(mocks.setCellValue).toHaveBeenCalledWith(target.worksheet, 2, 3, '')
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
    mocks.applyRowPlan.mockImplementation((worksheet: { Name: string }) => {
      if (worksheet.Name === '动画') throw new Error('COM 异常')
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
    expect(scope.identityColumns).toContain('Bangumi_URL')
    expect(scope.excludeSheetName).toContain('同步记录')
    expect(scope.maxDataRows).toBeGreaterThan(0)
    // 返回的是副本，改动不影响原配置
    scope.excludeSheetName.push('hack')
    expect(CLEAN_EXCLUDES.sheetName).not.toContain('hack')
  })
})

describe('countCleanTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('返回当前可清理的目标表数量（= listCleanTargets 长度）', () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    expect(countCleanTargets()).toBe(1)
  })

  it('无可清理目标时返回 0', () => {
    mocks.getOpenWorkbooks.mockReturnValue([])
    expect(countCleanTargets()).toBe(0)
  })
})

// ========== COM 异常兜底（工作簿 / 工作表属性读取失败） ==========

describe('listCleanTargets · COM 读取异常兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('FullName 读取抛错时回退 Name（退化路径不阻断清理）', () => {
    const worksheet = { Name: '动画' }
    mocks.getOpenWorkbooks.mockReturnValue([
      {
        Name: '数据表.xlsx',
        get FullName(): string {
          throw new Error('COM 未就绪')
        },
        Worksheets: { Count: 1, Item: () => worksheet },
      },
    ])
    mocks.findHeaderRow.mockReturnValue(1)
    mocks.getColumnMap.mockReturnValue(new Map(DEFAULT_COL_MAP))
    mocks.getLastRow.mockReturnValue(4)

    const targets = listCleanTargets()
    expect(targets).toHaveLength(1)
    // FullName 不可得 → workbookPath 为空串，但工作簿名与目标仍可用
    expect(targets[0]?.workbookPath).toBe('')
    expect(targets[0]?.label).toBe('数据表.xlsx / 动画')
  })

  it('枚举工作表抛错时记 WARN 日志并跳过该工作簿', () => {
    mocks.getOpenWorkbooks.mockReturnValue([
      {
        Name: '坏簿.xlsx',
        FullName: 'D:/books/坏簿.xlsx',
        get Worksheets(): never {
          throw new Error('枚举失败')
        },
      },
    ])
    expect(listCleanTargets()).toHaveLength(0)
    expect(mocks.bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('枚举工作表失败'))
  })

  it('工作表名读取抛错时该表被跳过（不误伤其他表）', () => {
    const badWs = {
      get Name(): never {
        throw new Error('COM 失败')
      },
    }
    const goodWs = { Name: '动画' }
    mocks.getOpenWorkbooks.mockReturnValue([
      {
        Name: '数据表.xlsx',
        FullName: 'D:/books/数据表.xlsx',
        Worksheets: { Count: 2, Item: (index: number) => (index === 1 ? badWs : goodWs) },
      },
    ])
    mocks.findHeaderRow.mockReturnValue(1)
    mocks.getColumnMap.mockReturnValue(new Map(DEFAULT_COL_MAP))
    mocks.getLastRow.mockReturnValue(4)

    const targets = listCleanTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0]?.sheetName).toBe('动画')
  })
})

// ========== 配置驱动的包含 / 排除分支 ==========

describe('listCleanTargets · include 白名单配置生效', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includeWorkbookPath / includeSheetName 非空时按关键词过滤', () => {
    // 默认配置两项均为空（= 不限制），此处临时注入关键词以驱动包含分支，用后还原
    const previousWorkbookPath = CLEAN_TARGETS.includeWorkbookPath
    const previousSheetName = CLEAN_TARGETS.includeSheetName
    try {
      CLEAN_TARGETS.includeWorkbookPath = ['数据表']
      CLEAN_TARGETS.includeSheetName = ['动画']

      // 路径命中 + 表名命中 → 入选
      mockWorkbookSheet('动画')
      makeGrid({ 2: { 1: 'A' } })
      expect(listCleanTargets()).toHaveLength(1)

      // 路径不命中 include → 整簿跳过
      mockWorkbookSheet('动画', 'D:/books/别的表.xlsx')
      makeGrid({ 2: { 1: 'A' } })
      expect(listCleanTargets()).toHaveLength(0)

      // 路径命中但表名不命中 include → 该表跳过
      mockWorkbookSheet('其他表')
      makeGrid({ 2: { 1: 'A' } })
      expect(listCleanTargets()).toHaveLength(0)
    } finally {
      CLEAN_TARGETS.includeWorkbookPath = previousWorkbookPath
      CLEAN_TARGETS.includeSheetName = previousSheetName
    }
  })

  it('排除表名词表为空时视为不排除（空关键词表不生效）', () => {
    const previousSheetName = CLEAN_EXCLUDES.sheetName
    try {
      CLEAN_EXCLUDES.sheetName = []
      mockWorkbookSheet('同步记录')
      makeGrid({ 2: { 1: 'A' } })
      // 词表为空 → 不再整表跳过，正常入选
      expect(listCleanTargets()).toHaveLength(1)
    } finally {
      CLEAN_EXCLUDES.sheetName = previousSheetName
    }
  })

  it('数据行数超过 maxDataRows 护栏时该表不入选', () => {
    mockWorkbookSheet('动画', 'D:/books/数据表.xlsx', { usedRangeLastRow: 60_000 })
    makeGrid({ 2: { 1: 'A' } })
    expect(listCleanTargets()).toHaveLength(0)
  })
})

// ========== 新番表锚点缺失 ==========

describe('listCleanTargets · 新番表锚点列缺失', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('命中新番表签名但无「周更时间」锚点时，名称列缺省而 TAGS 列仍映射', () => {
    mockWorkbookSheet('2026年4月新番表')
    mocks.findHeaderRow.mockReturnValue(0)
    // 表头行（行 2）命中「播放平台 + TAGS」两个签名关键词，但不含「周更时间」
    setCellGrid({
      2: { 6: '播放平台', 14: 'TAGS' },
      5: { 14: '搞笑 / 抽象' },
    })
    mocks.getLastRow.mockReturnValue(5)
    makeGrid({ 5: { 14: '搞笑 / 抽象' } })

    const targets = listCleanTargets()
    expect(targets).toHaveLength(1)
    // 锚点查找失败 → 名称列无法推导（规则扫描时自行跳过）
    expect(targets[0]?.colMap.has('名称')).toBe(false)
    expect(targets[0]?.colMap.get('标签/分级')).toBe(14)
  })

  it('锚点左侧列有表头文本时停止名称列回退查找（名称列缺省）', () => {
    mockWorkbookSheet('2026年4月新番表')
    mocks.findHeaderRow.mockReturnValue(0)
    // 锚点「周更时间」在 D 列，其左侧 C 列已有表头文本 → 不再继续向左探测
    setCellGrid({
      2: { 3: '番剧名', 4: '周更时间', 14: 'TAGS' },
      5: { 3: '淫狱团地', 14: '搞笑 / 抽象' },
    })
    mocks.getLastRow.mockReturnValue(5)
    makeGrid({ 5: { 3: '淫狱团地', 14: '搞笑 / 抽象' } })

    const targets = listCleanTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0]?.colMap.has('名称')).toBe(false)
    expect(targets[0]?.colMap.get('标签/分级')).toBe(14)
  })
})

// ========== 排除行 / 行字节估算的退化输入 ==========

describe('collectExcludedRows · 空排除词表', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('排除行词表为空时直接返回空集合（不读取表格）', () => {
    const previousRowText = CLEAN_EXCLUDES.rowText
    try {
      CLEAN_EXCLUDES.rowText = []
      const target = fakeTarget('k', '数据表 / 动画')
      makeGrid({ 2: { 1: '合计' } })
      expect(collectExcludedRows(target).size).toBe(0)
      expect(mocks.readRangeValues).not.toHaveBeenCalled()
    } finally {
      CLEAN_EXCLUDES.rowText = previousRowText
    }
  })
})

describe('estimateRowBytes · 退化输入兜底', () => {
  it('无数据行（末行不晚于表头行）时返回 0', () => {
    const target = fakeTarget('k', '数据表 / 动画')
    target.lastRow = target.headerRow
    expect(estimateRowBytes(target)).toBe(0)
  })

  it('末行号非有限值时采样循环不执行，回退到兜底字节数', () => {
    const target = fakeTarget('k', '数据表 / 动画')
    // COM 未就绪等极端情况下末行号可能非有限；采样无法进行 → 使用兜底值而非 0
    target.lastRow = NaN
    expect(estimateRowBytes(target)).toBe(ROW_BYTES_FALLBACK)
  })
})

// ========== 表头 / 末行读取异常兜底 ==========

describe('inspectWorksheet · 表头与末行读取异常兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('findHeaderRow 抛错时视为未识别到表头', () => {
    mockWorkbookSheet('动画')
    setCellGrid({})
    mocks.findHeaderRow.mockImplementation(() => {
      throw new Error('COM 失败')
    })

    const info = inspectWorksheet({ Name: '动画' } as CleanTargetInfo['worksheet'])
    expect(info.headerRow).toBe(0)
    expect(info.isBangumiSheet).toBe(false)
    expect(info.reason).toBe('未识别到表头行')
  })

  it('getColumnMap 抛错时列映射退化为空（特征列判定不通过）', () => {
    mockWorkbookSheet('动画')
    mocks.getColumnMap.mockImplementation(() => {
      throw new Error('COM 失败')
    })

    const info = inspectWorksheet({ Name: '动画' } as CleanTargetInfo['worksheet'])
    expect(info.headerRow).toBe(1)
    expect(info.hasNameColumn).toBe(false)
    expect(info.reason).toContain('特征列')
  })

  it('getLastRow 抛错时末行退化为 0（判为无数据行）', () => {
    mockWorkbookSheet('动画')
    mocks.getLastRow.mockImplementation(() => {
      throw new Error('COM 失败')
    })

    const info = inspectWorksheet({ Name: '动画' } as CleanTargetInfo['worksheet'])
    expect(info.lastRow).toBe(0)
    expect(info.dataRows).toBe(0)
    expect(info.reason).toBe('无数据行')
  })

  it('数据行数超过 maxDataRows 护栏时给出原因', () => {
    const worksheet = mockWorkbookSheet('动画', 'D:/books/数据表.xlsx', {
      usedRangeLastRow: 60_000,
    })
    const info = inspectWorksheet(worksheet as CleanTargetInfo['worksheet'])
    expect(info.dataRows).toBe(59_999)
    expect(info.eligible).toBe(false)
    expect(info.reason).toContain('数据行超过护栏')
  })

  it('表头行有文本时用于展示（前 8 个非空值）', () => {
    mockWorkbookSheet('动画')
    setCellGrid({ 1: { 1: '名称', 2: 'Bangumi_URL' } })
    const info = inspectWorksheet({ Name: '动画' } as CleanTargetInfo['worksheet'])
    expect(info.headers).toEqual(['名称', 'Bangumi_URL'])
  })
})

// ========== 目标列解析退化匹配 ==========

describe('scanCleanRules · 目标列解析退化匹配', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('列键包含规则关键词时按包含匹配取列（兼容「标签/分级（备注）」类组合表头）', async () => {
    mockWorkbookSheet('动画')
    mocks.getColumnMap.mockReturnValue(
      new Map([
        ['名称', 1],
        ['Bangumi_URL', 2],
        ['标签/分级（备注）', 3],
      ]),
    )
    makeGrid({ 2: { 3: 'B站 | 漫画改' } })

    const result = await scanCleanRules(['noise-tags'])
    expect(result.plans).toHaveLength(1)
    expect(result.plans[0]?.changes[0]?.col).toBe(3)
    expect(result.plans[0]?.changes[0]?.columnName).toBe('标签/分级（备注）')
  })

  it('列键完全不匹配时跳过该规则并说明缺失列', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })

    // category-prefix 需要「类别」列，默认列映射中没有
    const result = await scanCleanRules(['category-prefix'])
    expect(result.plans).toHaveLength(0)
    expect(result.notes.join('\n')).toContain('未找到目标列')
  })

  it('变更列不在列映射中时列名退化为「第N列」', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: '作品A' }, 3: { 1: '作品A' } })
    mocks.planDuplicateRows.mockReturnValue({
      deleteRows: [3],
      changes: [{ row: 2, col: 99, value: '合并标签' }],
      groups: 1,
      mergedGroups: 1,
    })

    const result = await scanCleanRules(['dup-name'])
    expect(result.plans[0]?.changes[0]?.columnName).toBe('第99列')
  })
})

// ========== 规则分派与扫描异常 ==========

describe('scanCleanRules · 规则分派与异常隔离', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emptyNameRows 规则分派到空白行扫描器', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    mocks.planEmptyNameRows.mockReturnValue({
      deleteRows: [4],
      changes: [],
      groups: 1,
      mergedGroups: 0,
    })

    const result = await scanCleanRules(['empty-name'])
    expect(result.plans[0]?.deleteRows).toEqual([4])
    expect(mocks.planEmptyNameRows).toHaveBeenCalledTimes(1)
  })

  it('行扫描器抛错时该规则跳过并记录原因（不影响其他规则）', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: 'A' } })
    mocks.planDuplicateRows.mockImplementation(() => {
      throw new Error('COM 扫描失败')
    })

    const result = await scanCleanRules(['dup-name'])
    expect(result.plans).toHaveLength(0)
    expect(result.notes.join('\n')).toContain('扫描失败：COM 扫描失败')
  })

  it('未配置噪声行词表时跳过并说明', async () => {
    const previousNoiseRowText = CLEAN_EXCLUDES.noiseRowText
    try {
      CLEAN_EXCLUDES.noiseRowText = []
      mockWorkbookSheet('动画')
      makeGrid({ 2: { 1: 'A' } })

      const result = await scanCleanRules(['noise-rows'])
      expect(result.plans).toHaveLength(0)
      expect(result.notes.join('\n')).toContain('未配置噪声行词表')
    } finally {
      CLEAN_EXCLUDES.noiseRowText = previousNoiseRowText
    }
  })

  it('表中没有噪声行时跳过并说明', async () => {
    mockWorkbookSheet('动画')
    makeGrid({ 2: { 1: '作品A' }, 3: { 1: '作品B' }, 4: { 1: '作品C' } })

    const result = await scanCleanRules(['noise-rows'])
    expect(result.plans).toHaveLength(0)
    expect(result.notes.join('\n')).toContain('未发现噪声行')
  })

  it('未知清理种类时跳过并说明（配置写错不炸引擎）', async () => {
    const rules = CLEAN_RULES as CleanRule[]
    const temporaryRule = {
      id: '__tmp_unknown_kind__',
      name: '未知种类',
      desc: '',
      group: '',
      icon: '',
      kind: 'notAKind',
      risk: 'low',
      defaultOn: false,
    } as unknown as CleanRule
    try {
      rules.push(temporaryRule)
      mockWorkbookSheet('动画')
      makeGrid({ 2: { 1: 'A' } })

      const result = await scanCleanRules(['__tmp_unknown_kind__'])
      expect(result.plans).toHaveLength(0)
      expect(result.notes.join('\n')).toContain('未知清理种类')
    } finally {
      rules.pop()
    }
  })

  it('cellTransform 规则缺少 transform 配置时跳过并说明', async () => {
    const rules = CLEAN_RULES as CleanRule[]
    const temporaryRule = {
      id: '__tmp_no_transform__',
      name: '缺变换配置',
      desc: '',
      group: '',
      icon: '',
      kind: 'cellTransform',
      columns: ['标签/分级'],
      risk: 'low',
      defaultOn: false,
    } as unknown as CleanRule
    try {
      rules.push(temporaryRule)
      mockWorkbookSheet('动画')
      makeGrid({ 2: { 3: 'B站 | 漫画改' } })

      const result = await scanCleanRules(['__tmp_no_transform__'])
      expect(result.plans).toHaveLength(0)
      expect(result.notes.join('\n')).toContain('规则未配置变换函数')
    } finally {
      rules.pop()
    }
  })
})

describe('scanCleanRules · 勾选白名单无目标时的提示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('已勾选工作表但无可清理目标时给出专门提示', async () => {
    mocks.getOpenWorkbooks.mockReturnValue([])
    const result = await scanCleanRules(['noise-tags'], {
      selectedSheets: [{ workbookKey: 'D:/books/数据表.xlsx', sheetName: '动画' }],
    })
    expect(result.targetCount).toBe(0)
    expect(result.notes.join('\n')).toContain('已勾选的工作表中没有可清理目标')
  })
})

// ========== 执行阶段的多行排序 ==========

describe('runCleanPlans · 多行删除排序', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('待删除行去重并升序排序后交给 applyRowPlan', async () => {
    const target = fakeTarget('t1', '数据表 / 动画')
    const result = fakeScanResult(
      [
        {
          ruleId: 'dup-name',
          ruleName: '重复名称行',
          targetKey: 't1',
          targetLabel: target.label,
          deleteRows: [4, 3],
          changes: [],
          estimatedBytes: 0,
        },
      ],
      [target],
    )
    mocks.applyRowPlan.mockReturnValue(2)

    const runResult = await runCleanPlans(result)
    expect(runResult.deletedRows).toBe(2)
    expect(mocks.applyRowPlan).toHaveBeenCalledWith(target.worksheet, {
      deleteRows: [3, 4],
      changes: [],
      groups: 0,
      mergedGroups: 0,
    })
  })

  it('多个单元格变更按行号升序写入', async () => {
    const target = fakeTarget('t1', '数据表 / 动画')
    const result = fakeScanResult(
      [
        {
          ruleId: 'noise-tags',
          ruleName: '噪声标签',
          targetKey: 't1',
          targetLabel: target.label,
          deleteRows: [],
          changes: [
            { row: 3, col: 3, columnName: '标签/分级', oldValue: 'A', nextValue: 'B' },
            { row: 2, col: 3, columnName: '标签/分级', oldValue: 'A', nextValue: 'C' },
          ],
          estimatedBytes: 0,
        },
      ],
      [target],
    )
    mocks.applyRowPlan.mockReturnValue(0)

    const runResult = await runCleanPlans(result)
    expect(runResult.changedCells).toBe(2)
    // 排序后按 2 → 3 顺序写入（WPS COM 同步调用，顺序可观测）
    const writtenRows = mocks.setCellValue.mock.calls.map((call: unknown[]) => call[1])
    expect(writtenRows).toEqual([2, 3])
  })
})
