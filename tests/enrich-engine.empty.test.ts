/**
 * @fileoverview 富化引擎空目标表追加测试
 *
 * 覆盖（需求：bangumi 原始数据表无数据时，直接使用新番表富化也能成功填入数据）：
 *   - isBangumiSheetEmpty 空表检测
 *   - matchEntries 空表时全部未匹配（匹配阶段行为不变）
 *   - enrichEntries 空表时未匹配条目作为新行追加写入（名称 + 常规字段富化）
 *   - enrichEntries 非空表时未匹配条目仍跳过（原行为不变）
 *   - 连续富化：空表追加后第二次匹配能命中新增行，不重复追加
 *   - 别名匹配：命中行反查其全部别名（原实现为遍历全局索引的 O(n²)）
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ========== Mock 基础设施（内存工作表） ==========

const mockReferences = vi.hoisted(() => ({
  mockBgmLog: vi.fn(),
  mockHandleError: vi.fn(),
  mockAddEnrichRecord: vi.fn(),
  /**
   * 富化记录现在由 enrichEntries 在循环外**一次**批量写入（P1-C），
   * 故断言改从本 mock 读取（每次调用的入参是整批记录数组）。
   */
  mockAddEnrichRecords: vi.fn<
    (records: { matchType?: string; enrichedField?: string; updatedValue: string }[]) => boolean
  >(() => true),
}))

const store = new Map<string, string>()

function sheetNameOf(ws: unknown): string {
  return (ws as { Name?: string } | null | undefined)?.Name ?? 'ws'
}

function cellKey(sheetName: string, row: number, col: number): string {
  return `${sheetName}_${String(row)}_${String(col)}`
}

function mockGetCellValue(ws: unknown, row: number, col: number): string {
  return store.get(cellKey(sheetNameOf(ws), row, col)) ?? ''
}

function mockSetCellValue(ws: unknown, row: number, col: number, value: unknown): void {
  store.set(cellKey(sheetNameOf(ws), row, col), String(value))
}

function mockFindHeaderRow(ws: unknown, startRow = 1): number {
  const sheetName = sheetNameOf(ws)
  for (let row = startRow; row <= startRow + 9; row += 1) {
    for (let col = 1; col <= 12; col += 1) {
      const value = (store.get(cellKey(sheetName, row, col)) ?? '').trim()
      if (value.includes('名称') || value.toLowerCase().includes('name')) return row
    }
  }
  return 0
}

function mockGetColumnMap(ws: unknown, headerRow: number): Map<string, number> {
  const sheetName = sheetNameOf(ws)
  const map = new Map<string, number>()
  for (let col = 1; col <= 12; col += 1) {
    const value = (store.get(cellKey(sheetName, headerRow, col)) ?? '').trim()
    if (value) map.set(value, col)
  }
  return map
}

function hasRowValue(sheetName: string, row: number): boolean {
  for (let col = 1; col <= 12; col += 1) {
    if ((store.get(cellKey(sheetName, row, col)) ?? '').trim()) return true
  }
  return false
}

function mockGetLastRow(ws: unknown, _shouldForceRefresh = false, headerRow?: number): number {
  const sheetName = sheetNameOf(ws)
  const resolvedHeaderRow = headerRow ?? mockFindHeaderRow(ws)
  if (resolvedHeaderRow <= 0) return 1
  let lastRow = resolvedHeaderRow
  for (let row = resolvedHeaderRow + 1; row <= 500; row += 1) {
    if (hasRowValue(sheetName, row)) lastRow = row
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
      rowValues.push(store.get(cellKey(sheetName, row, col)) ?? '')
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
  bgmLog: mockReferences.mockBgmLog,
  BGM: {
    handleError: mockReferences.mockHandleError,
    ErrorLevel: { ERROR: 'ERROR' },
  },
  getCellValue: mockGetCellValue,
  setCellValue: mockSetCellValue,
  getLastRow: mockGetLastRow,
  findHeaderRow: mockFindHeaderRow,
  getColumnMap: mockGetColumnMap,
  readRangeValues: mockReadRangeValues,
  isEmptyValue,
}))

vi.mock('../ts/sync/enrich-record.js', () => ({
  addEnrichRecord: mockReferences.mockAddEnrichRecord,
  addEnrichRecords: mockReferences.mockAddEnrichRecords,
}))

// ========== 导入被测模块 ============

import { isBangumiSheetEmpty, matchEntries, enrichEntries } from '../ts/sync/enrich-engine.js'
import type { EnrichConfig, MatchResult } from '../ts/sync/enrich-engine.js'

// ========== 测试数据 ==========

const ANIME_SHEET_NAME = 'anime'
const BANGUMI_SHEET_NAME = 'bangumi'

/** 新番表：表头行 1，数据行 2-3 */
function seedAnimeSheet(): void {
  store.set(cellKey(ANIME_SHEET_NAME, 1, 1), '动漫名称')
  store.set(cellKey(ANIME_SHEET_NAME, 1, 2), 'TAGS')
  store.set(cellKey(ANIME_SHEET_NAME, 1, 3), '首播')
  store.set(cellKey(ANIME_SHEET_NAME, 1, 4), '集数')
  store.set(cellKey(ANIME_SHEET_NAME, 2, 1), '芙莉莲')
  store.set(cellKey(ANIME_SHEET_NAME, 2, 2), '奇幻')
  store.set(cellKey(ANIME_SHEET_NAME, 2, 3), '2023-09')
  store.set(cellKey(ANIME_SHEET_NAME, 2, 4), '28')
  store.set(cellKey(ANIME_SHEET_NAME, 3, 1), '间谍过家家')
  store.set(cellKey(ANIME_SHEET_NAME, 3, 2), '搞笑')
  store.set(cellKey(ANIME_SHEET_NAME, 3, 3), '2022-04')
  store.set(cellKey(ANIME_SHEET_NAME, 3, 4), '25')
}

/** Bangumi 目标表：仅表头，无数据行 */
function seedEmptyBangumiSheet(): void {
  store.set(cellKey(BANGUMI_SHEET_NAME, 1, 1), '名称')
  store.set(cellKey(BANGUMI_SHEET_NAME, 1, 2), '标签')
  store.set(cellKey(BANGUMI_SHEET_NAME, 1, 3), '开播日期')
  store.set(cellKey(BANGUMI_SHEET_NAME, 1, 4), '集数')
  store.set(cellKey(BANGUMI_SHEET_NAME, 1, 5), '特点/印象')
  store.set(cellKey(BANGUMI_SHEET_NAME, 1, 6), '别名')
}

/** Bangumi 目标表：含 1 行数据（芙莉莲） */
function seedBangumiSheetWithData(): void {
  seedEmptyBangumiSheet()
  store.set(cellKey(BANGUMI_SHEET_NAME, 2, 1), '芙莉莲')
}

const animeSheet = { Name: ANIME_SHEET_NAME } as never
const bangumiSheet = { Name: BANGUMI_SHEET_NAME } as never

const animeConfig: EnrichConfig = {
  filePath: 'anime.tsv',
  sheetName: '新番表',
  headerRow: 1,
  dataStartRow: 2,
  columnMapping: { nameCol: 1, tagsCol: 2, premiereCol: 3, episodesCol: 4 },
}

/** 从批量写入的实参中筛出指定匹配类型 + 字段名的记录 */
function countEnrichRecords(matchType: string, fieldName: string): { updatedValue: string }[] {
  return mockReferences.mockAddEnrichRecords.mock.calls
    .flatMap((call) => call[0])
    .filter((record) => record.matchType === matchType && record.enrichedField === fieldName)
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

// ========== 测试套件 ==========

describe('isBangumiSheetEmpty 空表检测', () => {
  it('只有表头时返回 true', () => {
    seedEmptyBangumiSheet()
    expect(isBangumiSheetEmpty(bangumiSheet)).toBe(true)
  })

  it('有数据行时返回 false', () => {
    seedBangumiSheetWithData()
    expect(isBangumiSheetEmpty(bangumiSheet)).toBe(false)
  })
})

describe('matchEntries 空表匹配', () => {
  it('空表时全部未匹配（匹配阶段行为不变）', () => {
    seedAnimeSheet()
    seedEmptyBangumiSheet()

    const matches = matchEntries(animeSheet, bangumiSheet, animeConfig)

    expect(matches).toHaveLength(2)
    expect(matches.every((m) => m.matchType === 'unmatched')).toBe(true)
  })
})

describe('enrichEntries 空表追加新行', () => {
  it('空表时未匹配条目作为新行写入名称与富化字段', () => {
    seedAnimeSheet()
    seedEmptyBangumiSheet()

    const matches = matchEntries(animeSheet, bangumiSheet, animeConfig)
    const results = enrichEntries(animeSheet, bangumiSheet, matches, animeConfig)

    // 结果全部为已匹配（成功写入）
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.kind === 'matched')).toBe(true)

    // 新行从表头下一行开始依次写入
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 2, 1))).toBe('芙莉莲')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 2, 2))).toBe('奇幻')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 2, 3))).toBe('2023-09')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 2, 4))).toBe('28')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 3, 1))).toBe('间谍过家家')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 3, 2))).toBe('搞笑')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 3, 3))).toBe('2022-04')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 3, 4))).toBe('25')
  })

  it('富化记录 matchType 记为「新增」', () => {
    seedAnimeSheet()
    seedEmptyBangumiSheet()

    const matches = matchEntries(animeSheet, bangumiSheet, animeConfig)
    enrichEntries(animeSheet, bangumiSheet, matches, animeConfig)

    const tagRecords = countEnrichRecords('新增', '标签/分级')
    expect(tagRecords).toHaveLength(2)
    expect(tagRecords.map((r) => r.updatedValue)).toEqual(['奇幻', '搞笑'])
  })

  it('名称列已写入时别名富化不重复追加', () => {
    seedAnimeSheet()
    seedEmptyBangumiSheet()

    const matches = matchEntries(animeSheet, bangumiSheet, animeConfig)
    enrichEntries(animeSheet, bangumiSheet, matches, animeConfig)

    // 别名列保持为空（animeName 与已写入名称一致 → skip）
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 2, 6)) ?? '').toBe('')
  })
})

describe('enrichEntries 非空表原行为', () => {
  it('未匹配条目仍跳过，不追加新行', () => {
    seedAnimeSheet()
    seedBangumiSheetWithData()

    const matches = matchEntries(animeSheet, bangumiSheet, animeConfig)
    const results = enrichEntries(animeSheet, bangumiSheet, matches, animeConfig)

    // 芙莉莲精确匹配更新，间谍过家家未匹配跳过
    const kinds = results.map((r) => r.kind)
    expect(kinds).toEqual(['matched', 'unmatched'])

    // 只更新已有行，不写第 3 行
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 2, 1))).toBe('芙莉莲')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 2, 2))).toBe('奇幻')
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 3, 1)) ?? '').toBe('')
  })

  it('非空表时富化记录 matchType 按匹配类型记录', () => {
    seedAnimeSheet()
    seedBangumiSheetWithData()

    const matches = matchEntries(animeSheet, bangumiSheet, animeConfig)
    enrichEntries(animeSheet, bangumiSheet, matches, animeConfig)

    const tagRecords = countEnrichRecords('精确', '标签/分级')
    expect(tagRecords).toHaveLength(1)
    expect(tagRecords[0]?.updatedValue).toBe('奇幻')
  })
})

describe('连续富化', () => {
  it('空表追加后第二次匹配能命中新增行，不重复追加', () => {
    seedAnimeSheet()
    seedEmptyBangumiSheet()

    // 第一次：空表追加 2 行
    const firstMatches = matchEntries(animeSheet, bangumiSheet, animeConfig)
    enrichEntries(animeSheet, bangumiSheet, firstMatches, animeConfig)

    // 第二次：表已非空，全部精确匹配
    const secondMatches: MatchResult[] = matchEntries(animeSheet, bangumiSheet, animeConfig)
    expect(secondMatches.every((m) => m.matchType === 'exact')).toBe(true)

    const secondResults = enrichEntries(animeSheet, bangumiSheet, secondMatches, animeConfig)
    expect(secondResults.every((r) => r.kind === 'matched')).toBe(true)

    // 没有产生第 4 行新数据
    expect(store.get(cellKey(BANGUMI_SHEET_NAME, 4, 1)) ?? '').toBe('')
  })
})

describe('matchEntries 别名匹配（行 → 别名反向索引）', () => {
  it('按别名命中时应返回该 Bangumi 行的全部别名', () => {
    seedAnimeSheet()
    seedEmptyBangumiSheet()
    // 第 2 行名称与 anime 表不同，只能靠别名命中
    store.set(cellKey(BANGUMI_SHEET_NAME, 2, 1), '葬送的芙莉莲')
    store.set(cellKey(BANGUMI_SHEET_NAME, 2, 6), '芙莉莲 / 芙莉莲第二季')

    const matches = matchEntries(animeSheet, bangumiSheet, animeConfig)

    const frieren = matches.find((m) => m.matchedAnimeName === '芙莉莲')
    expect(frieren?.matchType).toBe('alias')
    expect(frieren?.bangumiRow).toBe(2)
    // 别名取自「命中行」而非遍历全局索引：顺序 = 该行别名书写顺序
    expect(frieren?.aliases).toEqual(['芙莉莲', '芙莉莲第二季'])
  })
})
