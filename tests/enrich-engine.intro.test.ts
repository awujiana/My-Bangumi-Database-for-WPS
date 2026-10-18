/**
 * @fileoverview 简介工作表富化功能专项测试（**真实实现**）
 *
 * ⚠️ 历史问题：本文件曾把生产逻辑复制进测试文件（`simulate*` / 本地 `isEmptyValue`
 * 等副本，注释自称「与代码保持同步」），49 条用例全部断言在副本上，导致
 * `ts/sync/enrich-engine.ts` 的 intro 家族约 160 条语句「有专测文件却零覆盖」。
 * 已改为 **直接 import 真实实现**，断言全部打在 `ts/sync/enrich-engine.ts` 上。
 *
 * 测试目标：
 *   - isIntroSheet 判断逻辑
 *   - INTRO_FIELD_TO_BANGUMI 映射（常量未导出 → 经 enrichIntroData 间接验证）
 *   - 标注白名单机制（ANNOTATED_FIELD_MAPPINGS 未导出 → 间接验证）
 *   - enrichIntroData / enrichOpEdPv / enrichAlias / resolveConflictField
 *   - readIntroSheetRow / findAliasColumn / buildIntroSheetContext
 *   - findIntroSheetInWorkbook / enrichIntroFromContext
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ========== Mock 基础设施（内存工作表） ==========

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  addEnrichRecords: vi.fn<(...arguments_: unknown[]) => boolean>(() => true),
}))

/** 单元格存储：`表名_行_列` → 值 */
const store = new Map<string, string>()

function sheetNameOf(ws: unknown): string {
  try {
    return (ws as { Name?: string } | null | undefined)?.Name ?? 'ws'
  } catch {
    // Name 读取抛错的工作表（COM 异常）按空名处理
    return 'ws'
  }
}

function cellKey(sheetName: string, row: number, col: number): string {
  return `${sheetName}_${String(row)}_${String(col)}`
}

function getCell(sheetName: string, row: number, col: number): string {
  return store.get(cellKey(sheetName, row, col)) ?? ''
}

function setCell(sheetName: string, row: number, col: number, value: string): void {
  store.set(cellKey(sheetName, row, col), value)
}

/** 该行在 1..50 列内是否存在非空值 */
function hasAnyValue(sheetName: string, row: number): boolean {
  for (let col = 1; col <= 50; col += 1) {
    if (getCell(sheetName, row, col).trim()) return true
  }
  return false
}

function mockGetCellValue(ws: unknown, row: number, col: number): string {
  return getCell(sheetNameOf(ws), row, col)
}

function mockSetCellValue(ws: unknown, row: number, col: number, value: unknown): void {
  setCell(sheetNameOf(ws), row, col, String(value))
}

function mockFindHeaderRow(ws: unknown, startRow = 1): number {
  const sheetName = sheetNameOf(ws)
  for (let row = startRow; row <= startRow + 9; row += 1) {
    for (let col = 1; col <= 12; col += 1) {
      const value = getCell(sheetName, row, col).trim()
      if (value.includes('名称') || value.toLowerCase().includes('name')) return row
    }
  }
  return 0
}

function mockGetColumnMap(ws: unknown, headerRow: number): Map<string, number> {
  const sheetName = sheetNameOf(ws)
  const map = new Map<string, number>()
  for (let col = 1; col <= 50; col += 1) {
    const value = getCell(sheetName, headerRow, col).trim()
    if (value) map.set(value, col)
  }
  return map
}

function mockGetLastRow(ws: unknown, _shouldForceRefresh = false, headerRow?: number): number {
  const sheetName = sheetNameOf(ws)
  const resolvedHeaderRow = headerRow ?? mockFindHeaderRow(ws)
  if (resolvedHeaderRow <= 0) return 1
  let lastRow = resolvedHeaderRow
  for (let row = resolvedHeaderRow + 1; row <= 500; row += 1) {
    if (hasAnyValue(sheetName, row)) lastRow = row
  }
  return lastRow
}

/** 矩形批量读取（生产接口）：按行/列区间从内存 store 取值 */
function mockReadRangeValues(
  ws: unknown,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): string[][] {
  const sheetName = sheetNameOf(ws)
  const result: string[][] = []
  for (let row = startRow; row <= endRow; row += 1) {
    const rowValues: string[] = []
    for (let col = startCol; col <= endCol; col += 1) {
      rowValues.push(getCell(sheetName, row, col))
    }
    result.push(rowValues)
  }
  return result
}

function isEmptyValue(value: string | null | undefined): boolean {
  if (!value) return true
  return value.trim() === ''
}

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  PANEL_CONFIG: { MAX_SCAN_ROWS: 100 },
  HEADER_KEYWORDS: [],
  COLUMN_RULES: {},
  STANDARD_HEADERS: [],
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mocks.bgmLog,
  BGM: { handleError: vi.fn(), ErrorLevel: { ERROR: 'ERROR' } },
  getCellValue: mockGetCellValue,
  setCellValue: mockSetCellValue,
  getLastRow: mockGetLastRow,
  findHeaderRow: mockFindHeaderRow,
  getColumnMap: mockGetColumnMap,
  readRangeValues: mockReadRangeValues,
  isEmptyValue,
}))

vi.mock('../ts/sync/enrich-record.js', () => ({
  addEnrichRecord: vi.fn(),
  addEnrichRecords: mocks.addEnrichRecords,
}))

// ========== 导入被测真实实现 ==========

import { createSheetCellCache } from '../ts/tools/util/sheet.js'
import {
  isIntroSheet,
  enrichIntroData,
  enrichOpEdPv,
  enrichAlias,
  resolveConflictField,
  readIntroSheetRow,
  findAliasColumn,
  buildIntroSheetContext,
  findIntroSheetInWorkbook,
  enrichIntroFromContext,
} from '../ts/sync/enrich-engine.js'
import type {
  EnrichColumnMapping,
  EnrichedField,
  ConflictInfo,
  IntroSheetContext,
} from '../ts/sync/enrich-engine.js'

// ========== 测试替身 ==========

const BANGUMI = 'bangumi'
const INTRO = 'intro'

const bangumiSheet = { Name: BANGUMI } as never
const introSheet = { Name: INTRO } as never

/** Bangumi 追踪表行号（富化目标行） */
const BANGUMI_ROW = 5
/** 日常富化用的列映射：名称 / 导演 / 脚本 / 特点·印象 */
const BASE_COL_MAP = new Map<string, number>([
  ['名称', 1],
  ['导演', 3],
  ['脚本', 4],
  ['特点/印象', 10],
])

function runIntro(
  data: Record<string, string>,
  colMap: Map<string, number> = BASE_COL_MAP,
  row = BANGUMI_ROW,
): { enriched: EnrichedField[]; conflicts: ConflictInfo[] } {
  const enriched: EnrichedField[] = []
  const conflicts: ConflictInfo[] = []
  enrichIntroData(bangumiSheet, row, data, colMap, enriched, conflicts, 2, '葬送的芙莉莲')
  return { enriched, conflicts }
}

/** 构建工作簿桩：Worksheets.Count + Worksheets.Item(index) */
function createWorkbook(sheets: { Name: string }[]): never {
  return {
    Worksheets: {
      Count: sheets.length,
      Item: (index: number) => sheets[index - 1],
    },
  } as never
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

// ========== isIntroSheet 测试 ==========

describe('isIntroSheet 判断逻辑', () => {
  it('有简介列时返回 true', () => {
    expect(isIntroSheet({ nameCol: 1, introCol: 2 })).toBe(true)
  })

  it('有编剧列时返回 true', () => {
    expect(isIntroSheet({ nameCol: 1, screenplayCol: 3 })).toBe(true)
  })

  it('有人设列时返回 true', () => {
    expect(isIntroSheet({ nameCol: 1, characterDesignCol: 4 })).toBe(true)
  })

  it('有CG导演列时返回 true', () => {
    expect(isIntroSheet({ nameCol: 1, cgDirectorCol: 5 })).toBe(true)
  })

  it('只有基本列时返回 false', () => {
    expect(isIntroSheet({ nameCol: 1, tagsCol: 2 })).toBe(false)
  })

  it('空映射返回 false', () => {
    expect(isIntroSheet({ nameCol: 1 })).toBe(false)
  })

  it('有多个简介专有列时返回 true', () => {
    expect(
      isIntroSheet({
        nameCol: 1,
        introCol: 2,
        directorCol: 3,
        screenplayCol: 4,
        characterDesignCol: 5,
        cgDirectorCol: 6,
      }),
    ).toBe(true)
  })
})

// ========== INTRO_FIELD_TO_BANGUMI 映射（间接验证） ==========
//
// 常量未导出，故按「字段 → 期望落库值」逐条走 enrichIntroData：
// 目标列存在且为空时，值必须落在目标列上（白名单映射带括号标注）。

describe('INTRO_FIELD_TO_BANGUMI 映射（经 enrichIntroData 验证）', () => {
  const cases: { source: string; target: string; value: string; expected: string }[] = [
    { source: '导演', target: '导演', value: '新海诚', expected: '新海诚' },
    { source: '编剧', target: '脚本', value: '富野由悠季', expected: '富野由悠季(编剧)' },
    { source: '人设', target: '人物设定', value: '贞本义行', expected: '贞本义行(人设)' },
    { source: 'CG导演', target: '演出', value: '庵野秀明', expected: '庵野秀明(CG导演)' },
    { source: '音乐', target: '音乐', value: '天门', expected: '天门' },
    { source: '动画制作', target: '动画制作公司', value: 'Gainax', expected: 'Gainax' },
    { source: '系列构成', target: '系列构成', value: '虚渊玄', expected: '虚渊玄' },
    { source: '分镜', target: '分镜', value: '宫崎骏', expected: '宫崎骏' },
    { source: '原作', target: '原作', value: '谏山创', expected: '谏山创' },
    { source: '语言', target: '语言', value: '日语', expected: '日语' },
    { source: '制片国家', target: '制片国家', value: '日本', expected: '日本' },
    { source: '声优', target: '声优', value: '花泽香菜', expected: '花泽香菜' },
  ]

  it('12 条映射全部把值写入对应目标列', () => {
    for (const { source, target, value, expected } of cases) {
      store.clear()
      const colMap = new Map<string, number>([
        ['名称', 1],
        [target, 2],
        ['特点/印象', 10],
      ])

      runIntro({ [source]: value }, colMap)

      expect(getCell(BANGUMI, BANGUMI_ROW, 2)).toBe(expected)
      // 未回退到特点/印象
      expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('')
    }
  })

  it('映射表外的字段不会写入任何目标列', () => {
    // 该字段既不在 INTRO_FIELD_TO_BANGUMI，也不在 INTRO_FEATURE_FIELDS
    const { enriched, conflicts } = runIntro({ 无关字段: '某个值' })

    expect(enriched).toHaveLength(0)
    expect(conflicts).toHaveLength(0)
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('')
  })

  it('映射表中的目标列名各不相同（无重复目标列）', () => {
    const targets = cases.map((c) => c.target)
    expect(new Set(targets).size).toBe(targets.length)
  })
})

// ========== 标注白名单机制测试（间接验证） ==========

function written(sourceKey: string, targetCol: string, value: string): string {
  store.clear()
  const colMap = new Map<string, number>([
    ['名称', 1],
    [targetCol, 2],
  ])
  runIntro({ [sourceKey]: value }, colMap)
  return getCell(BANGUMI, BANGUMI_ROW, 2)
}

describe('简介字段标注白名单机制', () => {
  it('导演→导演：源字段名与目标列名相同，不添加标注', () => {
    expect(written('导演', '导演', '新海诚')).toBe('新海诚')
  })

  it('音乐→音乐：源字段名与目标列名相同，不添加标注', () => {
    expect(written('音乐', '音乐', '天门')).toBe('天门')
  })

  it('编剧→脚本：白名单中，添加 (编剧) 标注', () => {
    expect(written('编剧', '脚本', '富野由悠季')).toBe('富野由悠季(编剧)')
  })

  it('人设→人物设定：白名单中，添加 (人设) 标注', () => {
    expect(written('人设', '人物设定', '贞本义行')).toBe('贞本义行(人设)')
  })

  it('CG导演→演出：白名单中，添加 (CG导演) 标注', () => {
    expect(written('CG导演', '演出', '庵野秀明')).toBe('庵野秀明(CG导演)')
  })

  it('动画制作→动画制作公司：不在白名单，不添加标注', () => {
    expect(written('动画制作', '动画制作公司', 'Gainax')).toBe('Gainax')
  })

  it('声优→声优：源字段名与目标列名相同，不添加标注', () => {
    expect(written('声优', '声优', '花泽香菜')).toBe('花泽香菜')
  })

  it('系列构成→系列构成：源字段名相同，不添加标注', () => {
    expect(written('系列构成', '系列构成', '虚渊玄')).toBe('虚渊玄')
  })
})

// ========== enrichIntroData 逻辑测试 ==========

describe('enrichIntroData 逻辑', () => {
  describe('字段填充规则', () => {
    it('目标列存在且为空时，填充值', () => {
      const { enriched, conflicts } = runIntro({ 导演: '新海诚' })

      expect(enriched).toHaveLength(1)
      expect(enriched[0]).toMatchObject({
        fieldName: '导演',
        bangumiColumn: 3,
        oldValue: null,
        updatedValue: '新海诚',
        action: 'fill',
      })
      expect(conflicts).toHaveLength(0)
      expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('新海诚')
    })

    it('目标列存在且有值时，记录冲突且不覆盖原值', () => {
      setCell(BANGUMI, BANGUMI_ROW, 3, '宫崎骏')

      const { enriched, conflicts } = runIntro({ 导演: '新海诚' })

      expect(enriched).toHaveLength(0)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]).toMatchObject({
        fieldName: '导演',
        bangumiColumn: 3,
        bangumiRow: BANGUMI_ROW,
        oldValue: '宫崎骏',
        updatedValue: '新海诚',
        animeRow: 2,
        matchedAnimeName: '葬送的芙莉莲',
        resolution: 'append',
      })
      // 原值未被改写
      expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('宫崎骏')
    })

    it('字段名差异时在富化记录与冲突记录上附 note', () => {
      const fill = runIntro({ 编剧: '铃木智寻' })
      expect(fill.enriched[0]?.note).toBe('字段名差异: 编剧 → 脚本')

      store.clear()
      setCell(BANGUMI, BANGUMI_ROW, 4, '旧编剧')
      const conflict = runIntro({ 编剧: '铃木智寻' })
      expect(conflict.conflicts[0]?.note).toBe('字段名差异: 编剧 → 脚本')
    })

    it('目标列不存在时，回退到特点/印象', () => {
      const colMap = new Map<string, number>([
        ['名称', 1],
        ['特点/印象', 10],
      ])

      const { enriched } = runIntro({ 系列构成: '虚渊玄' }, colMap)

      expect(enriched).toHaveLength(1)
      expect(enriched[0]?.fieldName).toBe('特点/印象(系列构成)')
      expect(enriched[0]?.action).toBe('fill')
      expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('系列构成:虚渊玄')
    })

    it('目标列与特点/印象列都不存在时，整条字段被丢弃', () => {
      const colMap = new Map<string, number>([['名称', 1]])

      const { enriched, conflicts } = runIntro({ 系列构成: '虚渊玄' }, colMap)

      expect(enriched).toHaveLength(0)
      expect(conflicts).toHaveLength(0)
    })

    it('源字段值为空时跳过', () => {
      const { enriched, conflicts } = runIntro({ 导演: '' })

      expect(enriched).toHaveLength(0)
      expect(conflicts).toHaveLength(0)
      expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('')
    })

    it('源字段值为纯空白时跳过', () => {
      const { enriched } = runIntro({ 导演: ' '.repeat(3) })
      expect(enriched).toHaveLength(0)
    })

    it('回退到特点/印象且内容已存在时记录 skip', () => {
      const colMap = new Map<string, number>([
        ['名称', 1],
        ['特点/印象', 10],
      ])
      setCell(BANGUMI, BANGUMI_ROW, 10, '系列构成:虚渊玄')

      const { enriched } = runIntro({ 系列构成: '虚渊玄' }, colMap)

      expect(enriched).toHaveLength(1)
      expect(enriched[0]).toMatchObject({
        fieldName: '特点/印象(系列构成)',
        oldValue: '系列构成:虚渊玄',
        updatedValue: '系列构成:虚渊玄',
        action: 'skip',
      })
    })

    it('回退到特点/印象且已有不同内容时追加', () => {
      const colMap = new Map<string, number>([
        ['名称', 1],
        ['特点/印象', 10],
      ])
      setCell(BANGUMI, BANGUMI_ROW, 10, '其它:内容')

      const { enriched } = runIntro({ 系列构成: '虚渊玄' }, colMap)

      expect(enriched[0]).toMatchObject({
        fieldName: '特点/印象(系列构成)',
        oldValue: '其它:内容',
        updatedValue: '其它:内容 | 系列构成:虚渊玄',
        action: 'append',
      })
      expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('其它:内容 | 系列构成:虚渊玄')
    })
  })

  describe('特点/印象追加', () => {
    it('简介内容追加到特点/印象', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])

      const { enriched } = runIntro({ 简介: '这是一部非常精彩的动画作品' }, colMap)

      expect(enriched[0]?.fieldName).toBe('特点/印象(简介补充)')
      expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('简介:这是一部非常精彩的动画作品')
    })

    it('简介超过 80 字时截断并加省略号', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])
      const longIntro = 'A'.repeat(100)

      runIntro({ 简介: longIntro }, colMap)

      const feature = getCell(BANGUMI, BANGUMI_ROW, 10)
      expect(feature).toBe(`简介:${'A'.repeat(80)}...`)
    })

    it('正好 80 字不截断', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])
      const intro = 'B'.repeat(80)

      runIntro({ 简介: intro }, colMap)

      expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe(`简介:${intro}`)
    })

    it('已有特点/印象时追加而非替换', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])
      setCell(BANGUMI, BANGUMI_ROW, 10, '已有内容')

      runIntro({ 简介: '新简介' }, colMap)

      expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('已有内容 | 简介:新简介')
    })

    it('OP/ED/PV 与简介一起追加到特点/印象', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])

      runIntro({ 简介: '好作品', OP: '主题曲', ED: '片尾曲', PV: '预告' }, colMap)

      expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('简介:好作品 | OP:主题曲 | ED:片尾曲 | PV:预告')
    })
  })

  describe('多字段同时富化', () => {
    it('多个简介字段同时填充', () => {
      const colMap = new Map<string, number>([
        ['名称', 1],
        ['导演', 3],
        ['脚本', 4],
        ['音乐', 8],
        ['特点/印象', 10],
      ])

      const { enriched, conflicts } = runIntro(
        { 导演: '新海诚', 编剧: '铃木贵昭', 音乐: '天门' },
        colMap,
      )

      expect(conflicts).toHaveLength(0)
      expect(enriched.filter((item) => item.action === 'fill')).toHaveLength(3)
      expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('新海诚')
      expect(getCell(BANGUMI, BANGUMI_ROW, 4)).toBe('铃木贵昭(编剧)')
      expect(getCell(BANGUMI, BANGUMI_ROW, 8)).toBe('天门')
    })

    it('部分字段冲突时只处理空字段', () => {
      const colMap = new Map<string, number>([
        ['名称', 1],
        ['导演', 3],
        ['音乐', 8],
        ['特点/印象', 10],
      ])
      setCell(BANGUMI, BANGUMI_ROW, 3, '宫崎骏')

      const { enriched, conflicts } = runIntro({ 导演: '新海诚', 音乐: '天门' }, colMap)

      expect(conflicts).toHaveLength(1)
      expect(enriched.filter((item) => item.action === 'fill')).toHaveLength(1)
      expect(getCell(BANGUMI, BANGUMI_ROW, 8)).toBe('天门')
    })
  })
})

// ========== enrichOpEdPv 逻辑测试 ==========

describe('enrichOpEdPv 逻辑', () => {
  function runOpEdPv(
    data: Record<string, string>,
    colMap: Map<string, number>,
    row = BANGUMI_ROW,
  ): EnrichedField[] {
    const enriched: EnrichedField[] = []
    enrichOpEdPv(bangumiSheet, row, data, colMap, enriched)
    return enriched
  }

  const featureColMap = new Map<string, number>([['特点/印象', 10]])

  it('OP/ED/PV 追加到特点/印象', () => {
    const enriched = runOpEdPv({ OP: 'OP1: 歌曲A', ED: 'ED1: 歌曲B' }, featureColMap)

    expect(enriched).toHaveLength(1)
    expect(enriched[0]).toMatchObject({ fieldName: '特点/印象', action: 'fill', oldValue: null })
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('OP:OP1: 歌曲A | ED:ED1: 歌曲B')
  })

  it('只有 OP 时只添加 OP', () => {
    runOpEdPv({ OP: 'OP1: 歌曲A' }, featureColMap)

    const feature = getCell(BANGUMI, BANGUMI_ROW, 10)
    expect(feature).toBe('OP:OP1: 歌曲A')
    expect(feature).not.toContain('ED:')
  })

  it('只有 PV 时只添加 PV', () => {
    const enriched = runOpEdPv({ PV: '预告片' }, featureColMap)

    expect(enriched[0]?.action).toBe('fill')
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('PV:预告片')
  })

  it('没有 OP/ED/PV 时不添加', () => {
    expect(runOpEdPv({}, featureColMap)).toHaveLength(0)
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('')
  })

  it('OP/ED/PV 全为空字符串时不添加', () => {
    expect(runOpEdPv({ OP: '', ED: '  ', PV: '' }, featureColMap)).toHaveLength(0)
  })

  it('特点/印象列不存在时跳过', () => {
    const enriched = runOpEdPv({ OP: 'OP1' }, new Map<string, number>([['导演', 3]]))
    expect(enriched).toHaveLength(0)
  })

  it('已有内容时追加', () => {
    setCell(BANGUMI, BANGUMI_ROW, 10, '已有')

    const enriched = runOpEdPv({ OP: 'OP1' }, featureColMap)

    expect(enriched[0]?.action).toBe('append')
    expect(enriched[0]?.oldValue).toBe('已有')
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('已有 | OP:OP1')
  })

  it('内容已存在时记录 skip 且不改写单元格', () => {
    setCell(BANGUMI, BANGUMI_ROW, 10, 'OP:OP1')

    const enriched = runOpEdPv({ OP: 'OP1' }, featureColMap)

    expect(enriched).toHaveLength(1)
    expect(enriched[0]?.action).toBe('skip')
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('OP:OP1')
  })
})

// ========== 目标表写穿透缓存：写后读语义（文档所述隐患的回归） ==========

describe('enrichIntroData → enrichOpEdPv 写穿透缓存', () => {
  /** 无「脚本」列：编剧 回退写「特点/印象」列（同一格被两条链路先后写） */
  const fallbackColMap = new Map<string, number>([['特点/印象', 10]])

  it('走缓存时：enrichIntroData 写特点列后，enrichOpEdPv 读到写后新值并正确合并', () => {
    const cache = createSheetCellCache(bangumiSheet, [BANGUMI_ROW], 12, {
      read: mockGetCellValue,
      write: mockSetCellValue,
    })

    const introEnriched: EnrichedField[] = []
    enrichIntroData(
      bangumiSheet,
      BANGUMI_ROW,
      { 编剧: '奈须蘑菇' },
      fallbackColMap,
      introEnriched,
      [],
      2,
      '葬送的芙莉莲',
      cache,
    )
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('编剧:奈须蘑菇(编剧)')

    const opEnriched: EnrichedField[] = []
    enrichOpEdPv(bangumiSheet, BANGUMI_ROW, { OP: 'OP1: 歌曲A' }, fallbackColMap, opEnriched, cache)

    // 关键断言：OP 必须追加在 intro 写入之后——只读缓存会拿到写前空值，
    // 走 fill 分支把「编剧」整个覆盖掉（文档记录过的合并出错）
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('编剧:奈须蘑菇(编剧) | OP:OP1: 歌曲A')
    expect(opEnriched[0]?.action).toBe('append')
    expect(opEnriched[0]?.oldValue).toBe('编剧:奈须蘑菇(编剧)')
  })

  it('不传缓存时行为不变（逐格读同样拿到写后值，两条链路等价）', () => {
    const introEnriched: EnrichedField[] = []
    enrichIntroData(
      bangumiSheet,
      BANGUMI_ROW,
      { 编剧: '奈须蘑菇' },
      fallbackColMap,
      introEnriched,
      [],
      2,
      '葬送的芙莉莲',
    )
    const opEnriched: EnrichedField[] = []
    enrichOpEdPv(bangumiSheet, BANGUMI_ROW, { OP: 'OP1: 歌曲A' }, fallbackColMap, opEnriched)

    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('编剧:奈须蘑菇(编剧) | OP:OP1: 歌曲A')
    expect(opEnriched[0]?.action).toBe('append')
  })

  it('缓存构建不因工作表桩抛错（readRowsCache 播种失败时静默回落逐格）', () => {
    expect(() =>
      createSheetCellCache(bangumiSheet, [BANGUMI_ROW], 12, {
        read: mockGetCellValue,
        write: mockSetCellValue,
      }),
    ).not.toThrow()
  })
})

// ========== enrichAlias 逻辑测试 ==========

/** 别名表头在 col 8；名称在 col 1（findHeaderRow 靠「名称」定位表头行） */
function seedAliasHeader(): void {
  setCell(BANGUMI, 1, 1, '名称')
  setCell(BANGUMI, 1, 8, '别名')
}

function runAlias(
  animeName: string,
  bangumiName: string | undefined,
  colMap: Map<string, number> = new Map<string, number>([['名称', 1]]),
  row = BANGUMI_ROW,
): EnrichedField[] {
  const enriched: EnrichedField[] = []
  enrichAlias(bangumiSheet, row, animeName, bangumiName, colMap, enriched)
  return enriched
}

describe('enrichAlias 逻辑', () => {
  it('名称相同时跳过（记录 skip，别名列不改写）', () => {
    seedAliasHeader()

    const enriched = runAlias('芙莉莲', '芙莉莲')

    expect(enriched).toHaveLength(1)
    expect(enriched[0]).toMatchObject({
      fieldName: '别名',
      bangumiColumn: 1,
      oldValue: '',
      updatedValue: '芙莉莲',
      action: 'skip',
    })
    expect(getCell(BANGUMI, BANGUMI_ROW, 8)).toBe('')
  })

  it('名称不同时追加到别名', () => {
    seedAliasHeader()

    const enriched = runAlias('葬送的芙莉莲', '芙莉莲')

    expect(enriched[0]?.action).toBe('append')
    expect(enriched[0]?.bangumiColumn).toBe(8)
    expect(enriched[0]?.oldValue).toBeNull()
    expect(getCell(BANGUMI, BANGUMI_ROW, 8)).toBe('葬送的芙莉莲')
  })

  it('已有别名时追加新名称', () => {
    seedAliasHeader()
    setCell(BANGUMI, BANGUMI_ROW, 8, '芙莉莲')

    const enriched = runAlias('葬送的芙莉莲', '芙莉莲')

    expect(enriched[0]?.action).toBe('append')
    expect(enriched[0]?.oldValue).toBe('芙莉莲')
    expect(getCell(BANGUMI, BANGUMI_ROW, 8)).toBe('芙莉莲 | 葬送的芙莉莲')
  })

  it('别名已存在时跳过', () => {
    seedAliasHeader()
    setCell(BANGUMI, BANGUMI_ROW, 8, '芙莉莲 | 葬送的芙莉莲')

    const enriched = runAlias('葬送的芙莉莲', '芙莉莲')

    expect(enriched[0]?.action).toBe('skip')
    expect(getCell(BANGUMI, BANGUMI_ROW, 8)).toBe('芙莉莲 | 葬送的芙莉莲')
  })

  it('名称列不存在时直接返回且无记录', () => {
    seedAliasHeader()

    expect(runAlias('新名', '旧名', new Map<string, number>([['导演', 3]]))).toHaveLength(0)
  })

  it('未找到别名列时直接返回且无记录', () => {
    // 只有「名称」表头，没有别名列
    setCell(BANGUMI, 1, 1, '名称')

    expect(runAlias('葬送的芙莉莲', '芙莉莲')).toHaveLength(0)
  })

  it('别名大小写/空格差异视为已存在', () => {
    seedAliasHeader()
    setCell(BANGUMI, BANGUMI_ROW, 8, '葬送的 芙莉莲')

    const enriched = runAlias('葬送的芙莉莲', '别的名字')

    expect(enriched[0]?.action).toBe('skip')
  })
})

// ========== findAliasColumn 测试 ==========

describe('findAliasColumn', () => {
  it('找到包含「别名」的表头列', () => {
    // findAliasColumn 先靠 findHeaderRow 定位表头行，故必须有「名称」表头
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 3, '别名')
    expect(findAliasColumn(bangumiSheet)).toBe(3)
  })

  it('支持 alias 与「原名」写法', () => {
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 5, 'Alias')
    expect(findAliasColumn(bangumiSheet)).toBe(5)

    store.clear()
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 6, '原名')
    expect(findAliasColumn(bangumiSheet)).toBe(6)
  })

  it('没有表头行时返回 0', () => {
    expect(findAliasColumn(bangumiSheet)).toBe(0)
  })

  it('有表头行但没有别名列时返回 0', () => {
    setCell(BANGUMI, 1, 1, '名称')
    expect(findAliasColumn(bangumiSheet)).toBe(0)
  })
})

// ========== resolveConflictField 冲突解决测试 ==========

/** 构造字段冲突记录（默认 append 模式） */
function makeConflict(overrides: Partial<ConflictInfo> = {}): ConflictInfo {
  return {
    fieldName: '导演',
    bangumiColumn: 3,
    bangumiRow: BANGUMI_ROW,
    oldValue: '宫崎骏',
    updatedValue: '新海诚',
    animeRow: 2,
    matchedAnimeName: '葬送的芙莉莲',
    resolution: 'append',
    ...overrides,
  }
}

describe('resolveConflictField 冲突解决', () => {

  it('keep 模式：保留原值，只记录 skip', () => {
    const enriched: EnrichedField[] = []

    resolveConflictField(bangumiSheet, makeConflict({ resolution: 'keep' }), enriched)

    expect(enriched).toHaveLength(1)
    expect(enriched[0]).toMatchObject({ action: 'skip', oldValue: '宫崎骏' })
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('')
  })

  it('overwrite 模式：用新值覆盖', () => {
    const enriched: EnrichedField[] = []

    resolveConflictField(bangumiSheet, makeConflict({ resolution: 'overwrite' }), enriched)

    expect(enriched[0]?.action).toBe('fill')
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('新海诚')
  })

  it('append 模式：原值无分隔符时直接拼接', () => {
    const enriched: EnrichedField[] = []

    resolveConflictField(bangumiSheet, makeConflict({ resolution: 'append' }), enriched)

    expect(enriched[0]).toMatchObject({ action: 'append', updatedValue: '宫崎骏 | 新海诚' })
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('宫崎骏 | 新海诚')
  })

  it('append 模式：原值含分隔符时按段去重后追加', () => {
    const enriched: EnrichedField[] = []

    resolveConflictField(
      bangumiSheet,
      makeConflict({ resolution: 'append', oldValue: '宫崎骏 | 高畑勋' }),
      enriched,
    )

    expect(enriched[0]?.updatedValue).toBe('宫崎骏 | 高畑勋 | 新海诚')
  })

  it('append 模式：新值已存在于分段中时记录 skip 且不改写', () => {
    const enriched: EnrichedField[] = []

    resolveConflictField(
      bangumiSheet,
      makeConflict({ resolution: 'append', oldValue: '宫崎骏 | 新海诚' }),
      enriched,
    )

    expect(enriched[0]?.action).toBe('skip')
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('')
  })

  it('append 模式：紧凑分隔符（无空格）同样按段处理', () => {
    const enriched: EnrichedField[] = []

    resolveConflictField(
      bangumiSheet,
      makeConflict({ resolution: 'append', oldValue: '宫崎骏|高畑勋' }),
      enriched,
    )

    expect(enriched[0]?.updatedValue).toBe('宫崎骏 | 高畑勋 | 新海诚')
  })
})

// ========== readIntroSheetRow 测试 ==========

describe('readIntroSheetRow 行读取', () => {
  const FULL_MAPPING: EnrichColumnMapping = {
    nameCol: 1,
    introCol: 2,
    studioCol: 3,
    directorCol: 4,
    musicCol: 5,
    voiceCol: 6,
    opCol: 7,
    edCol: 8,
    pvCol: 9,
    screenplayCol: 10,
    characterDesignCol: 11,
    cgDirectorCol: 12,
    seriesCompositionCol: 13,
    storyboardCol: 14,
    originalWorkCol: 15,
    languageCol: 16,
    productionCountryCol: 17,
    typeCol: 18,
  }

  it('读取全部简介专有字段', () => {
    const values = [
      '葬送的芙莉莲',
      '简介内容',
      'Madhouse',
      '斋藤圭一郎',
      'Evan Call',
      '种崎敦美',
      'OP歌曲',
      'ED歌曲',
      'PV视频',
      '铃木智寻',
      '长泽礼子',
      '某CG导演',
      '某系列构成',
      '某人分镜',
      '山田钟人',
      '日语',
      '日本',
      '奇幻',
    ]
    for (const [index, value] of values.entries()) {
      setCell(INTRO, 2, index + 1, value)
    }

    expect(readIntroSheetRow(introSheet, 2, FULL_MAPPING)).toEqual({
      名称: '葬送的芙莉莲',
      简介: '简介内容',
      动画制作: 'Madhouse',
      导演: '斋藤圭一郎',
      音乐: 'Evan Call',
      声优: '种崎敦美',
      OP: 'OP歌曲',
      ED: 'ED歌曲',
      PV: 'PV视频',
      编剧: '铃木智寻',
      人设: '长泽礼子',
      CG导演: '某CG导演',
      系列构成: '某系列构成',
      分镜: '某人分镜',
      原作: '山田钟人',
      语言: '日语',
      制片国家: '日本',
      类型: '奇幻',
    })
  })

  it('未配置的列不出现在结果里（只返回名称）', () => {
    setCell(INTRO, 2, 1, '只有名称')
    expect(readIntroSheetRow(introSheet, 2, { nameCol: 1 })).toEqual({ 名称: '只有名称' })
  })

  it('空单元格返回空字符串而非 undefined', () => {
    const data = readIntroSheetRow(introSheet, 9, FULL_MAPPING)
    expect(data['名称']).toBe('')
    expect(data.导演).toBe('')
    expect(data.简介).toBe('')
  })
})

// ========== buildIntroSheetContext 测试 ==========

function seedIntroTable(): void {
  // 表头行 1：导演 + 编剧 + 简介 → 命中 2 个简介关键字
  setCell(INTRO, 1, 1, '名称')
  setCell(INTRO, 1, 2, '导演')
  setCell(INTRO, 1, 3, '编剧')
  setCell(INTRO, 1, 4, '简介')
  // 数据行
  setCell(INTRO, 2, 1, '葬送的芙莉莲')
  setCell(INTRO, 2, 2, '斋藤圭一郎')
  setCell(INTRO, 2, 3, '铃木智寻')
  setCell(INTRO, 2, 4, '简介内容')
  setCell(INTRO, 3, 1, '间谍过家家')
  setCell(INTRO, 3, 2, '古桥一浩')
}

describe('buildIntroSheetContext 简介表识别', () => {
  it('识别表头行、数据起始行与列映射', () => {
    seedIntroTable()

    const context = buildIntroSheetContext(introSheet)

    expect(context).not.toBeNull()
    expect(context?.headerRow).toBe(1)
    expect(context?.dataStartRow).toBe(2)
    expect(context?.mapping.nameCol).toBe(1)
    expect(context?.mapping.directorCol).toBe(2)
    expect(context?.mapping.screenplayCol).toBe(3)
    expect(context?.mapping.introCol).toBe(4)
    expect(isIntroSheet(context?.mapping ?? { nameCol: 0 })).toBe(true)
  })

  it('名称索引按 normalizeName 归一，可跨大小写/空格命中', () => {
    seedIntroTable()

    const context = buildIntroSheetContext(introSheet)

    expect(context?.nameIndex.get('葬送的芙莉莲')).toBe(2)
    expect(context?.nameIndex.get('间谍过家家')).toBe(3)
    expect(context?.nameIndex.size).toBe(2)
  })

  it('表头无简介关键字时返回 null', () => {
    setCell(INTRO, 1, 1, '名称')
    setCell(INTRO, 1, 2, '标签')

    expect(buildIntroSheetContext(introSheet)).toBeNull()
  })

  it('命中简介关键字但无名称列时返回 null', () => {
    setCell(INTRO, 1, 1, '导演')
    setCell(INTRO, 1, 2, '编剧')

    expect(buildIntroSheetContext(introSheet)).toBeNull()
  })

  it('名称为空的数据行不进索引', () => {
    seedIntroTable()
    // 第 4 行有名称为空但有其它值
    setCell(INTRO, 4, 2, '某导演')

    const context = buildIntroSheetContext(introSheet)

    expect(context?.nameIndex.size).toBe(2)
  })
})

// ========== findIntroSheetInWorkbook 测试 ==========

/** 一份「新番来源表」布局：第 2 行 3 个横向字段（周更时间/首播/集数），名称列在 D 列左侧 */
function seedAnimeSourceSheet(): void {
  setCell('anime', 2, 3, '周更时间')
  setCell('anime', 2, 4, '首播')
  setCell('anime', 2, 5, '集数')
  setCell('anime', 3, 3, '芙莉莲')
}

function seedIntroSheetInBook(): void {
  setCell(INTRO, 1, 1, '名称')
  setCell(INTRO, 1, 2, '导演')
  setCell(INTRO, 1, 3, '编剧')
  setCell(INTRO, 2, 1, '葬送的芙莉莲')
}

describe('findIntroSheetInWorkbook 工作簿内查找', () => {
  it('找到简介工作表并返回其引用', () => {
    seedIntroSheetInBook()
    const wb = createWorkbook([{ Name: BANGUMI }, introSheet])

    expect(findIntroSheetInWorkbook(wb)).toBe(introSheet)
  })

  it('通过 excludeSheetName 排除当前主源表', () => {
    seedIntroSheetInBook()
    const wb = createWorkbook([{ Name: INTRO }])

    expect(findIntroSheetInWorkbook(wb, INTRO)).toBeNull()
  })

  it('新番来源表布局的工作表不作为简介表候选', () => {
    seedAnimeSourceSheet()
    const animeSheet = { Name: 'anime' }
    const wb = createWorkbook([animeSheet])

    expect(findIntroSheetInWorkbook(wb)).toBeNull()
  })

  it('没有简介表时返回 null', () => {
    setCell(BANGUMI, 1, 1, '名称')
    const wb = createWorkbook([{ Name: BANGUMI }])

    expect(findIntroSheetInWorkbook(wb)).toBeNull()
  })

  it('Name 读取抛错的工作表按空名处理且仍可识别为简介表', () => {
    // Name getter 抛错时 sheetNameOf 回退到 'ws'，故单元格播种在 'ws' 名下
    setCell('ws', 1, 1, '名称')
    setCell('ws', 1, 2, '导演')
    setCell('ws', 1, 3, '编剧')
    const hostile = {
      get Name(): string {
        throw new Error('COM 读取失败')
      },
    }
    const wb = createWorkbook([hostile])

    expect(findIntroSheetInWorkbook(wb)).toBe(hostile)
  })

  it('Item 抛错的工作表被跳过，不影响后续表识别', () => {
    seedIntroSheetInBook()
    const wb = {
      Worksheets: {
        Count: 2,
        Item: (index: number) => {
          if (index === 1) throw new Error('COM 读取失败')
          return introSheet
        },
      },
    } as never

    expect(findIntroSheetInWorkbook(wb)).toBe(introSheet)
  })
})

// ========== enrichIntroFromContext 测试 ==========

function buildContext(): IntroSheetContext {
  setCell(INTRO, 1, 1, '名称')
  setCell(INTRO, 1, 2, '导演')
  setCell(INTRO, 1, 3, '编剧')
  setCell(INTRO, 1, 4, '简介')
  setCell(INTRO, 2, 1, '葬送的芙莉莲')
  setCell(INTRO, 2, 2, '斋藤圭一郎')
  setCell(INTRO, 2, 3, '铃木智寻')
  setCell(INTRO, 2, 4, '简介内容')
  const context = buildIntroSheetContext(introSheet)
  if (!context) throw new Error('简介表上下文构建失败')
  return context
}

describe('enrichIntroFromContext 按名称关联富化', () => {
  it('命中名称时把简介表字段富化到 Bangumi 行', () => {
    const enriched: EnrichedField[] = []
    const conflicts: ConflictInfo[] = []

    enrichIntroFromContext(
      bangumiSheet,
      BANGUMI_ROW,
      buildContext(),
      '葬送的芙莉莲',
      BASE_COL_MAP,
      enriched,
      conflicts,
    )

    expect(conflicts).toHaveLength(0)
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('斋藤圭一郎')
    expect(getCell(BANGUMI, BANGUMI_ROW, 4)).toBe('铃木智寻(编剧)')
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('简介:简介内容')
  })

  it('名称未命中时静默跳过', () => {
    const enriched: EnrichedField[] = []
    const conflicts: ConflictInfo[] = []

    enrichIntroFromContext(
      bangumiSheet,
      BANGUMI_ROW,
      buildContext(),
      '不存在的动画',
      BASE_COL_MAP,
      enriched,
      conflicts,
    )

    expect(enriched).toHaveLength(0)
    expect(conflicts).toHaveLength(0)
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('')
  })

  it('名称归一后仍能命中（空格/大小写差异）', () => {
    const enriched: EnrichedField[] = []
    const conflicts: ConflictInfo[] = []

    enrichIntroFromContext(
      bangumiSheet,
      BANGUMI_ROW,
      buildContext(),
      ' 葬送的 芙莉莲 ',
      BASE_COL_MAP,
      enriched,
      conflicts,
    )

    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('斋藤圭一郎')
  })
})

// ========== 综合场景测试 ==========

describe('简介工作表富化综合场景', () => {
  it('完整的简介富化流程（填充 / 冲突 / 标注 / 特点·印象）', () => {
    const colMap = new Map<string, number>([
      ['名称', 1],
      ['导演', 3],
      ['脚本', 4],
      ['音乐', 8],
      ['特点/印象', 10],
    ])
    // 导演已有值（会冲突）
    setCell(BANGUMI, BANGUMI_ROW, 3, '宫崎骏')

    const { enriched, conflicts } = runIntro(
      {
        // 导演冲突；编剧填充（带标注）；音乐填充；简介追加到特点/印象
        导演: '新海诚',
        编剧: '铃木贵昭',
        音乐: '天门',
        简介: '精彩的动画',
      },
      colMap,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.fieldName).toBe('导演')
    expect(enriched.filter((item) => item.action === 'fill').length).toBeGreaterThanOrEqual(2)
    expect(getCell(BANGUMI, BANGUMI_ROW, 4)).toBe('铃木贵昭(编剧)')
    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe('简介:精彩的动画')
    // 冲突字段未被覆盖
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('宫崎骏')
  })

  it('冲突经 resolveConflictField 以 append 落地', () => {
    const colMap = new Map<string, number>([
      ['名称', 1],
      ['导演', 3],
      ['特点/印象', 10],
    ])
    setCell(BANGUMI, BANGUMI_ROW, 3, '宫崎骏')

    const { conflicts } = runIntro({ 导演: '新海诚' }, colMap)
    const enriched: EnrichedField[] = []
    const conflict = conflicts[0]
    if (!conflict) throw new Error('未产生冲突记录')
    resolveConflictField(bangumiSheet, conflict, enriched)

    expect(enriched[0]?.action).toBe('append')
    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('宫崎骏 | 新海诚')
  })

  it('OP/ED/PV 与简介富化的组合', () => {
    const colMap = new Map<string, number>([['特点/印象', 10]])

    runIntro({ 简介: '这是一部好作品' }, colMap)
    const enriched: EnrichedField[] = []
    enrichOpEdPv(bangumiSheet, BANGUMI_ROW, { OP: '主题曲A', ED: '片尾曲B' }, colMap, enriched)

    expect(getCell(BANGUMI, BANGUMI_ROW, 10)).toBe(
      '简介:这是一部好作品 | OP:主题曲A | ED:片尾曲B',
    )
  })

  it('别名富化与简介富化的组合', () => {
    const colMap = new Map<string, number>([
      ['名称', 1],
      ['导演', 3],
      ['特点/印象', 10],
    ])
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 8, '别名')

    runIntro({ 导演: '新海诚' }, colMap)
    const enriched: EnrichedField[] = []
    enrichAlias(bangumiSheet, BANGUMI_ROW, '葬送的芙莉莲', '芙莉莲', colMap, enriched)

    expect(getCell(BANGUMI, BANGUMI_ROW, 3)).toBe('新海诚')
    expect(enriched[0]?.action).toBe('append')
    expect(getCell(BANGUMI, BANGUMI_ROW, 8)).toBe('葬送的芙莉莲')
  })
})
