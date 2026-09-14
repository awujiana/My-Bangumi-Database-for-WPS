/**
 * @fileoverview enrich-engine 字段级富化 / 匹配 / 搜索测试
 *
 * 补齐 `ts/sync/enrich-engine.ts` 中**此前无专测**的部分（对照覆盖率切片）：
 *   - detectColumns 额外平台列（重复「播放平台」表头 / 表头为空的连续列）、未知表头
 *   - readPlatformValues 平台聚合（多源 + 去空 + 去噪 + 去重）
 *   - readNewAnimeRow 全字段（周更时间 / 播放平台 / 独播 / 特殊）
 *   - getBangumiColumnMap、isBangumiSheetEmpty 的降级路径
 *   - buildBangumiIndexes（经 matchEntries 间接）名称列缺失 / 别名索引
 *   - matchEntries 精确 / 别名 / 未匹配 / 名称列缺失 / 外层异常兜底
 *   - enrichTags / enrichPlatform / enrichDate / enrichEpisodes / enrichFeatures
 *   - enrichEntries 空匹配、取消、error 分支、行号缺失、进度回调、批量记录失败提示、简介分支
 *   - searchSheet 全路径
 *   - detectAnimeSourceLayout 数据行探测（跳过标题行）
 *   - ensureBangumiColumns 样式降级路径
 *
 * 边界（与 vitest.config.ts「`ts/sync/**` 的 COM 模块不建议为数字硬造 mock」一致）：
 *   - 真实 Range / Font / Interior 的 COM 交互不在此模拟，只覆盖「降级不阻断」的语义。
 *   - 样式模板的**完整成功路径**已由 `tests/enrich-engine.columns.test.ts` 覆盖。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ========== Mock 基础设施（内存工作表） ==========

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  addEnrichRecords: vi.fn<(...arguments_: unknown[]) => boolean>(() => true),
  handleError: vi.fn(),
  toast: vi.fn<(message: string, type?: string) => void>(),
  /** 非 null 时 readRangeValues 直接返回该值（模拟 COM 读回） */
  readBackOverride: null as string[][] | null,
}))

/** 单元格存储：`表名_行_列` → 值 */
const store = new Map<string, string>()

/** 设为非 null 时，`getCellValue` 读到该列即抛错（模拟 COM 异常） */
let throwOnCol: number | null = null
/** 为 true 时 `getColumnMap` 抛错（用于 matchEntries 外层兜底） */
let isThrowOnGetColumnMap = false

function sheetNameOf(ws: unknown): string {
  return (ws as { Name?: string } | null | undefined)?.Name ?? 'ws'
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

/** 与生产接口同形；`throwOnCol` 用于制造 COM 读取异常 */
function mockGetCellValue(ws: unknown, row: number, col: number): string {
  if (throwOnCol !== null && col === throwOnCol) throw new Error('COM 读取失败')
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
  if (isThrowOnGetColumnMap) throw new Error('COM 读取表头失败')
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
  if (mocks.readBackOverride) return mocks.readBackOverride
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
  BGM: {
    handleError: mocks.handleError,
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
  addEnrichRecord: vi.fn(),
  addEnrichRecords: mocks.addEnrichRecords,
}))

// ========== 导入被测真实实现 ==========

import {
  detectColumns,
  readPlatformValues,
  readNewAnimeRow,
  getBangumiColumnMap,
  isBangumiSheetEmpty,
  matchEntries,
  enrichTags,
  enrichPlatform,
  enrichDate,
  enrichEpisodes,
  enrichFeatures,
  enrichEntries,
  ensureBangumiColumns,
  detectAnimeSourceLayout,
  buildIntroSheetContext,
  searchSheet,
} from '../ts/sync/enrich-engine.js'
import type {
  EnrichColumnMapping,
  EnrichConfig,
  EnrichedField,
  MatchResult,
  ProgressCallback,
} from '../ts/sync/enrich-engine.js'
import { registerNotifyApi } from '../ts/core/ui-bridge.js'

// ========== 测试替身 ==========

const ANIME = 'anime'
const BANGUMI = 'bangumi'

const animeSheet = { Name: ANIME } as never
const bangumiSheet = { Name: BANGUMI } as never

/** Bangumi 追踪表标准表头（第 1 行） */
function seedBangumiHeader(): void {
  setCell(BANGUMI, 1, 1, '名称')
  setCell(BANGUMI, 1, 2, '别名')
  setCell(BANGUMI, 1, 3, '标签/分级')
  setCell(BANGUMI, 1, 4, '开播日期')
  setCell(BANGUMI, 1, 5, '集数')
  setCell(BANGUMI, 1, 6, '在线播放平台')
  setCell(BANGUMI, 1, 7, '特点/印象')
}

/** 新番表标准表头（第 1 行）+ 3 行数据 */
function seedAnimeSheet(): void {
  setCell(ANIME, 1, 1, '动漫名称')
  setCell(ANIME, 1, 2, 'TAGS')
  setCell(ANIME, 1, 3, '首播')
  setCell(ANIME, 1, 4, '集数')
  setCell(ANIME, 1, 5, '周更时间')
  setCell(ANIME, 2, 1, '芙莉莲')
  setCell(ANIME, 2, 2, '奇幻|冒险')
  setCell(ANIME, 2, 3, '2023-09')
  setCell(ANIME, 2, 4, '28')
  setCell(ANIME, 2, 5, '周五')
  setCell(ANIME, 3, 1, '葬送的芙莉莲')
  setCell(ANIME, 4, 1, '不存在的动画')
}

const ANIME_MAPPING: EnrichColumnMapping = {
  nameCol: 1,
  tagsCol: 2,
  premiereCol: 3,
  episodesCol: 4,
  weekdayCol: 5,
}

function makeConfig(mapping: EnrichColumnMapping = ANIME_MAPPING): EnrichConfig {
  return { filePath: 'anime.tsv', sheetName: '新番表', headerRow: 1, dataStartRow: 2, columnMapping: mapping }
}

/** 范围桩：`Font` 可配置为「读取即抛错」，用于样式降级路径 */
interface RangeStub {
  Font: { Name: string; Size: number; Bold: boolean; Color: number }
  Interior: { Color: number }
  Value: string[][]
}

function makeRange(shouldThrowFont: boolean): RangeStub {
  const range = { Interior: { Color: 0 }, Value: [] as string[][] } as RangeStub
  Object.defineProperty(range, 'Font', {
    get: () => {
      if (shouldThrowFont) throw new Error('样式读取失败')
      return { Name: '等线', Size: 11, Bold: true, Color: 0 }
    },
  })
  return range
}

/** 工作表桩：`A1:A1`（样式来源）与 `B1:B1`（新增列表头）返回不同范围桩 */
function createStyledSheet(isSourceFontBroken: boolean, isHeaderFontBroken: boolean): never {
  return {
    Name: BANGUMI,
    Range: (address: string) =>
      makeRange(address.startsWith('A') ? isSourceFontBroken : isHeaderFontBroken),
  } as never
}

beforeEach(() => {
  store.clear()
  throwOnCol = null
  isThrowOnGetColumnMap = false
  mocks.readBackOverride = null
  vi.clearAllMocks()
  mocks.addEnrichRecords.mockReturnValue(true)
  registerNotifyApi({
    alert: vi.fn(),
    confirm: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    toast: mocks.toast,
    input: vi.fn(),
  })
})

// ========== detectColumns ==========

describe('detectColumns 列识别', () => {
  it('识别基本列与简介专有列', () => {
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 2, '标签')
    setCell(BANGUMI, 1, 3, '最新话')
    setCell(BANGUMI, 1, 4, '导演')
    setCell(BANGUMI, 1, 5, '编剧')

    const mapping = detectColumns(bangumiSheet, 1)

    expect(mapping.nameCol).toBe(1)
    expect(mapping.tagsCol).toBe(2)
    expect(mapping.directorCol).toBe(4)
    expect(mapping.screenplayCol).toBe(5)
  })

  it('重复的「播放平台」表头进 platformExtraCols', () => {
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 5, '播放平台')
    setCell(BANGUMI, 1, 6, '播放平台')

    const mapping = detectColumns(bangumiSheet, 1)

    expect(mapping.platformCol).toBe(5)
    expect(mapping.platformExtraCols).toEqual([6])
  })

  it('播放平台与独播之间的空表头列进 platformExtraCols', () => {
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 5, '播放平台')
    // 第 6、7 列为空（合并单元格仅首列有值）
    setCell(BANGUMI, 1, 8, '独播')

    const mapping = detectColumns(bangumiSheet, 1)

    expect(mapping.platformCol).toBe(5)
    expect(mapping.exclusiveCol).toBe(8)
    expect(mapping.platformExtraCols).toEqual([6, 7])
  })

  it('未知表头被忽略且不影响其它列', () => {
    setCell(BANGUMI, 1, 1, '名称')
    setCell(BANGUMI, 1, 2, '完全没有的列名')

    const mapping = detectColumns(bangumiSheet, 1)

    expect(mapping.nameCol).toBe(1)
    expect(Object.keys(mapping)).toEqual(['nameCol'])
  })

  it('只有第一个名称类表头作为名称列', () => {
    setCell(BANGUMI, 1, 1, '番组名')
    setCell(BANGUMI, 1, 2, '动漫名称')

    expect(detectColumns(bangumiSheet, 1).nameCol).toBe(1)
  })
})

// ========== readPlatformValues ==========

describe('readPlatformValues 平台聚合', () => {
  it('多平台列去空去噪去重且保序', () => {
    setCell(BANGUMI, 2, 2, 'B站,爱奇艺、B站/腾讯,（示例）')
    setCell(BANGUMI, 2, 3, '爱奇艺')
    setCell(BANGUMI, 2, 4, 'B站|优酷')

    const mapping: EnrichColumnMapping = {
      nameCol: 1,
      platformCol: 2,
      platformExtraCols: [3],
      exclusiveCol: 4,
    }

    expect(readPlatformValues(bangumiSheet, 2, mapping)).toEqual(['B站', '爱奇艺', '腾讯', '优酷'])
  })

  it('没有任何平台列时返回空数组', () => {
    expect(readPlatformValues(bangumiSheet, 2, { nameCol: 1 })).toEqual([])
  })

  it('列值全为空白时返回空数组', () => {
    setCell(BANGUMI, 2, 2, ' '.repeat(3))

    expect(readPlatformValues(bangumiSheet, 2, { nameCol: 1, platformCol: 2 })).toEqual([])
  })
})

// ========== readNewAnimeRow ==========

describe('readNewAnimeRow 行读取', () => {
  it('读取全部字段并把平台聚合成分隔符串', () => {
    seedAnimeSheet()
    setCell(ANIME, 2, 6, 'B站')
    setCell(ANIME, 2, 7, '爱奇艺')
    setCell(ANIME, 2, 8, '独家')
    setCell(ANIME, 2, 9, '跨季')

    const data = readNewAnimeRow(animeSheet, 2, {
      ...ANIME_MAPPING,
      platformCol: 6,
      exclusiveCol: 7,
      specialCol: 9,
    })

    expect(data).toMatchObject({
      名称: '芙莉莲',
      TAGS: '奇幻|冒险',
      首播: '2023-09',
      集数: '28',
      周更时间: '周五',
      独播: '爱奇艺',
      特殊: '跨季',
    })
    expect(data['播放平台']).toBe('B站 | 爱奇艺')
  })

  it('只配名称列时其余字段不出现且平台为空串', () => {
    setCell(ANIME, 2, 1, '芙莉莲')

    expect(readNewAnimeRow(animeSheet, 2, { nameCol: 1 })).toEqual({ 名称: '芙莉莲', 播放平台: '' })
  })
})

// ========== getBangumiColumnMap / isBangumiSheetEmpty ==========

describe('getBangumiColumnMap 列映射', () => {
  it('识别表头行并返回列映射', () => {
    seedBangumiHeader()

    const map = getBangumiColumnMap(bangumiSheet)

    expect(map.get('名称')).toBe(1)
    expect(map.get('特点/印象')).toBe(7)
  })

  it('没有表头行时告警并返回空映射', () => {
    const map = getBangumiColumnMap(bangumiSheet)

    expect(map.size).toBe(0)
    expect(mocks.bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('未找到表头行'))
  })
})

describe('isBangumiSheetEmpty 空表检测', () => {
  it('没有表头行时返回 false（无法判定为空表）', () => {
    expect(isBangumiSheetEmpty(bangumiSheet)).toBe(false)
  })

  it('只有表头时返回 true', () => {
    seedBangumiHeader()
    expect(isBangumiSheetEmpty(bangumiSheet)).toBe(true)
  })
})

// ========== matchEntries ==========

describe('matchEntries 匹配', () => {
  it('精确 / 别名 / 未匹配三种结果并存', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')
    setCell(BANGUMI, 2, 2, '葬送的芙莉莲 | 芙莉莲')
    setCell(BANGUMI, 3, 1, '间谍过家家')

    const results = matchEntries(animeSheet, bangumiSheet, makeConfig())

    expect(results).toHaveLength(3)

    const [first, second, third] = results
    expect(first).toMatchObject({ matchType: 'exact', bangumiRow: 2, bangumiName: '芙莉莲' })
    expect(second).toMatchObject({ matchType: 'alias', bangumiRow: 2, bangumiName: '芙莉莲' })
    expect(second?.aliases).toEqual(expect.arrayContaining(['葬送的芙莉莲', '芙莉莲']))
    expect(third).toMatchObject({ matchType: 'unmatched', animeRow: 4 })
  })

  it('新番表未配置名称列时告警并不产出结果', () => {
    seedAnimeSheet()
    seedBangumiHeader()

    const results = matchEntries(animeSheet, bangumiSheet, makeConfig({ nameCol: 0 }))

    expect(results).toEqual([])
    expect(mocks.bgmLog).toHaveBeenCalledWith('ERROR', expect.stringContaining('未找到名称列'))
  })

  it('Bangumi 表无名称列时全部未匹配（索引为空）', () => {
    seedAnimeSheet()
    // Bangumi 表只有「标签」表头，没有名称列
    setCell(BANGUMI, 1, 1, '标签')

    const results = matchEntries(animeSheet, bangumiSheet, makeConfig())

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.matchType === 'unmatched')).toBe(true)
  })

  it('列映射读取抛错时被外层兜底捕获并返回已有结果', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    isThrowOnGetColumnMap = true

    expect(matchEntries(animeSheet, bangumiSheet, makeConfig())).toEqual([])
    expect(mocks.handleError).toHaveBeenCalledTimes(1)
  })

  it('空行不产出匹配结果', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    // 第 3 行名称清空
    setCell(ANIME, 3, 1, '')

    expect(matchEntries(animeSheet, bangumiSheet, makeConfig())).toHaveLength(2)
  })
})

// ========== 字段级富化函数 ==========

/** 构造一个「字段级富化函数」的调用器 */
function runFieldFunction(
  function_: (
    sheet: never,
    row: number,
    incoming: Record<string, string>,
    colMap: Map<string, number>,
    enriched: EnrichedField[],
  ) => void,
  incoming: Record<string, string>,
  colMap: Map<string, number>,
  row = 2,
): EnrichedField[] {
  const enriched: EnrichedField[] = []
  function_(bangumiSheet, row, incoming, colMap, enriched)
  return enriched
}

describe('enrichTags 标签富化', () => {
  it('目标列不存在时直接返回', () => {
    expect(runFieldFunction(enrichTags, { TAGS: '奇幻' }, new Map([['导演', 3]]))).toEqual([])
  })

  it('新番表标签为空时直接返回', () => {
    expect(runFieldFunction(enrichTags, {}, new Map([['标签/分级', 3]]))).toEqual([])
  })

  it('目标列为空时填充', () => {
    const enriched = runFieldFunction(enrichTags, { TAGS: '奇幻|冒险' }, new Map([['标签/分级', 3]]))

    expect(enriched[0]).toMatchObject({ fieldName: '标签/分级', action: 'fill', oldValue: null })
    expect(getCell(BANGUMI, 2, 3)).toBe('奇幻|冒险')
  })

  it('回退到「标签」列名同样生效', () => {
    expect(runFieldFunction(enrichTags, { TAGS: '奇幻' }, new Map([['标签', 4]]))).toHaveLength(1)
    expect(getCell(BANGUMI, 2, 4)).toBe('奇幻')
  })

  it('已有标签时去重追加', () => {
    setCell(BANGUMI, 2, 3, '奇幻')

    const enriched = runFieldFunction(enrichTags, { TAGS: '奇幻|冒险' }, new Map([['标签/分级', 3]]))

    expect(enriched[0]).toMatchObject({ action: 'append', updatedValue: '奇幻 | 冒险' })
    expect(getCell(BANGUMI, 2, 3)).toBe('奇幻 | 冒险')
  })

  it('标签完全重复时记录 skip 且不改写', () => {
    setCell(BANGUMI, 2, 3, '奇幻')

    const enriched = runFieldFunction(enrichTags, { TAGS: '奇幻' }, new Map([['标签/分级', 3]]))

    expect(enriched[0]).toMatchObject({ action: 'skip', oldValue: '奇幻' })
    expect(getCell(BANGUMI, 2, 3)).toBe('奇幻')
  })
})

describe('enrichPlatform 播放平台富化', () => {
  it('新番表无平台信息时直接返回', () => {
    expect(runFieldFunction(enrichPlatform, {}, new Map([['在线播放平台', 6]]))).toEqual([])
    expect(runFieldFunction(enrichPlatform, { 播放平台: '  ' }, new Map([['在线播放平台', 6]]))).toEqual(
      [],
    )
  })

  it('目标列不存在时直接返回', () => {
    expect(runFieldFunction(enrichPlatform, { 播放平台: 'B站' }, new Map([['导演', 3]]))).toEqual([])
  })

  it('目标列为空时填充', () => {
    const enriched = runFieldFunction(
      enrichPlatform,
      { 播放平台: 'B站' },
      new Map([['在线播放平台', 6]]),
    )

    expect(enriched[0]).toMatchObject({ fieldName: '在线播放平台', action: 'fill' })
    expect(getCell(BANGUMI, 2, 6)).toBe('B站')
  })

  it('回退到「播放平台」列名同样生效', () => {
    expect(
      runFieldFunction(enrichPlatform, { 播放平台: 'B站' }, new Map([['播放平台', 7]])),
    ).toHaveLength(1)
  })

  it('已有平台时去重追加', () => {
    setCell(BANGUMI, 2, 6, 'B站')

    const enriched = runFieldFunction(
      enrichPlatform,
      { 播放平台: 'B站 | 爱奇艺' },
      new Map([['在线播放平台', 6]]),
    )

    expect(enriched[0]).toMatchObject({ action: 'append' })
    expect(getCell(BANGUMI, 2, 6)).toBe('B站 | 爱奇艺')
  })

  it('平台完全重复时记录 skip', () => {
    setCell(BANGUMI, 2, 6, 'B站')

    const enriched = runFieldFunction(
      enrichPlatform,
      { 播放平台: 'B站' },
      new Map([['在线播放平台', 6]]),
    )

    expect(enriched[0]?.action).toBe('skip')
  })
})

describe('enrichDate 首播日期富化', () => {
  it('目标列不存在时直接返回', () => {
    expect(runFieldFunction(enrichDate, { 首播: '2023-09' }, new Map([['导演', 3]]))).toEqual([])
  })

  it('新番表日期为空时直接返回', () => {
    expect(runFieldFunction(enrichDate, {}, new Map([['开播日期', 4]]))).toEqual([])
  })

  it('目标列为空时填充', () => {
    const enriched = runFieldFunction(enrichDate, { 首播: '2023-09' }, new Map([['开播日期', 4]]))

    expect(enriched[0]).toMatchObject({ fieldName: '开播日期', action: 'fill' })
    expect(getCell(BANGUMI, 2, 4)).toBe('2023-09')
  })

  it('目标列已有值时记录 skip 且不覆盖', () => {
    setCell(BANGUMI, 2, 4, '2022-10')

    const enriched = runFieldFunction(enrichDate, { 首播: '2023-09' }, new Map([['开播日期', 4]]))

    expect(enriched[0]).toMatchObject({ action: 'skip', oldValue: '2022-10' })
    expect(getCell(BANGUMI, 2, 4)).toBe('2022-10')
  })
})

describe('enrichEpisodes 集数富化', () => {
  it('目标列不存在时直接返回', () => {
    expect(runFieldFunction(enrichEpisodes, { 集数: '28' }, new Map([['导演', 3]]))).toEqual([])
  })

  it('新番表集数为空时直接返回', () => {
    expect(runFieldFunction(enrichEpisodes, {}, new Map([['集数', 5]]))).toEqual([])
  })

  it('目标列为空时填充', () => {
    const enriched = runFieldFunction(enrichEpisodes, { 集数: '28' }, new Map([['集数', 5]]))

    expect(enriched[0]).toMatchObject({ fieldName: '集数', action: 'fill' })
    expect(getCell(BANGUMI, 2, 5)).toBe('28')
  })

  it('目标列已有值时记录 skip', () => {
    setCell(BANGUMI, 2, 5, '12')

    const enriched = runFieldFunction(enrichEpisodes, { 集数: '28' }, new Map([['集数', 5]]))

    expect(enriched[0]).toMatchObject({ action: 'skip', oldValue: '12' })
  })
})

describe('enrichFeatures 特点/印象富化', () => {
  const featureColMap = new Map<string, number>([['特点/印象', 7]])

  it('目标列不存在时直接返回', () => {
    expect(runFieldFunction(enrichFeatures, { 周更时间: '周五' }, new Map([['导演', 3]]))).toEqual([])
  })

  it('四个来源字段都为空时不写入', () => {
    expect(runFieldFunction(enrichFeatures, {}, featureColMap)).toEqual([])
  })

  it('周更/平台/独播/特殊按序拼接后填充', () => {
    const enriched = runFieldFunction(
      enrichFeatures,
      { 周更时间: '周五 23:00', 播放平台: 'B站', 独播: 'B站', 特殊: '跨季' },
      featureColMap,
    )

    expect(enriched[0]).toMatchObject({ action: 'fill', oldValue: null })
    expect(getCell(BANGUMI, 2, 7)).toBe('周更:周五 23:00 | 平台:B站 | 独播:B站 | 特殊:跨季')
  })

  it('只有部分来源有值时只拼接有值的', () => {
    runFieldFunction(enrichFeatures, { 特殊: 'OVA' }, featureColMap)

    expect(getCell(BANGUMI, 2, 7)).toBe('特殊:OVA')
  })

  it('已有内容时追加', () => {
    setCell(BANGUMI, 2, 7, '手绘')

    const enriched = runFieldFunction(enrichFeatures, { 周更时间: '周五' }, featureColMap)

    expect(enriched[0]).toMatchObject({ action: 'append', oldValue: '手绘' })
    expect(getCell(BANGUMI, 2, 7)).toBe('手绘 | 周更:周五')
  })

  it('内容完全重复时记录 skip', () => {
    setCell(BANGUMI, 2, 7, '周更:周五')

    const enriched = runFieldFunction(enrichFeatures, { 周更时间: '周五' }, featureColMap)

    expect(enriched[0]?.action).toBe('skip')
    expect(getCell(BANGUMI, 2, 7)).toBe('周更:周五')
  })
})

// ========== enrichEntries ==========

describe('enrichEntries 批量富化', () => {
  it('无匹配结果时直接返回空数组', () => {
    seedBangumiHeader()

    expect(enrichEntries(animeSheet, bangumiSheet, [], makeConfig())).toEqual([])
    expect(mocks.bgmLog).toHaveBeenCalledWith('INFO', expect.stringContaining('无匹配结果'))
  })

  it('精确匹配走常规字段富化并按字段写入', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')
    setCell(BANGUMI, 2, 2, '葬送的芙莉莲 | 芙莉莲')

    const matches = matchEntries(animeSheet, bangumiSheet, makeConfig())
    expect(matches.map((m) => m.matchType)).toEqual(['exact', 'alias', 'unmatched'])
    const progress = vi.fn<ProgressCallback>()
    const results = enrichEntries(animeSheet, bangumiSheet, matches, makeConfig(), progress)

    const [item] = results
    expect(item).toMatchObject({ kind: 'matched', name: '芙莉莲', matchType: 'exact' })
    expect(item?.conflicts).toBeUndefined()
    expect(item?.enrichedFields.map((f) => f.fieldName)).toEqual(
      expect.arrayContaining(['标签/分级', '开播日期', '集数', '特点/印象']),
    )

    expect(getCell(BANGUMI, 2, 3)).toBe('奇幻|冒险')
    expect(getCell(BANGUMI, 2, 4)).toBe('2023-09')
    expect(getCell(BANGUMI, 2, 5)).toBe('28')
    expect(getCell(BANGUMI, 2, 7)).toBe('周更:周五')

    // 名称相同 → 别名富化记一条 skip
    expect(item?.enrichedFields.some((f) => f.fieldName === '别名' && f.action === 'skip')).toBe(
      true,
    )

    // 进度回调只在成功进入富化的条目上触发；最后一次 total 恒为条目总数
    expect(progress).toHaveBeenCalled()
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ total: matches.length })
    expect(mocks.addEnrichRecords).toHaveBeenCalledTimes(1)
  })

  it('未匹配条目按跳过计入结果且不写单元格', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')

    const matches = matchEntries(animeSheet, bangumiSheet, makeConfig())
    const results = enrichEntries(animeSheet, bangumiSheet, matches, makeConfig())

    const unmatched = results.filter((r) => r.kind === 'unmatched')
    expect(unmatched.length).toBeGreaterThanOrEqual(1)
    expect(unmatched[0]?.enrichedFields).toEqual([])
  })

  it('错误条目记入结果并携带 errorMessage', () => {
    seedBangumiHeader()
    const matches: MatchResult[] = [
      { animeRow: 2, matchedAnimeName: '坏数据', matchType: 'error', errorMessage: '匹配失败' },
    ]

    const results = enrichEntries(animeSheet, bangumiSheet, matches, makeConfig())

    const [item] = results
    expect(item).toMatchObject({ kind: 'error', matchType: 'error', errorMessage: '匹配失败' })
  })

  it('匹配类型为 exact 但缺少行号时记为错误', () => {
    seedBangumiHeader()
    const matches: MatchResult[] = [{ animeRow: 2, matchedAnimeName: '芙莉莲', matchType: 'exact' }]

    const results = enrichEntries(animeSheet, bangumiSheet, matches, makeConfig())

    const [item] = results
    expect(item).toMatchObject({ kind: 'error', errorMessage: '匹配行号缺失' })
  })

  it('富化中途抛错时该条记为 error 且不影响其它条目', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')
    // Bangumi 侧「特点/印象」（第 7 列）读取抛错 → enrichFeatures 抛错 → enrichIntoRow 兜底为 error
    // （不能用第 3 列：新番表读取在 enrichIntoRow 的 try 之外，会直接冒泡）
    throwOnCol = 7

    const matches: MatchResult[] = [{ animeRow: 2, matchedAnimeName: '芙莉莲', matchType: 'exact', bangumiRow: 2, bangumiName: '芙莉莲' }]
    const results = enrichEntries(animeSheet, bangumiSheet, matches, makeConfig())

    const [item] = results
    expect(item).toMatchObject({ kind: 'error', matchType: 'exact' })
    expect(item?.errorMessage).toContain('COM 读取失败')
    expect(mocks.bgmLog).toHaveBeenCalledWith('ERROR', expect.stringContaining('COM 读取失败'))
  })

  it('取消检查在条目边界生效，保留已写入结果', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')
    setCell(BANGUMI, 3, 1, '葬送的芙莉莲')

    const matches: MatchResult[] = [
      { animeRow: 2, matchedAnimeName: '芙莉莲', matchType: 'exact', bangumiRow: 2, bangumiName: '芙莉莲' },
      { animeRow: 3, matchedAnimeName: '葬送的芙莉莲', matchType: 'alias', bangumiRow: 3, bangumiName: '葬送的芙莉莲' },
    ]
    const results = enrichEntries(animeSheet, bangumiSheet, matches, makeConfig(), undefined, undefined, () => true)

    // 第一个条目边界即取消 → 一条都没处理
    expect(results).toHaveLength(0)
    expect(mocks.bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('用户取消富化'))
  })

  it('富化记录批量写入失败时 toast 提示用户', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')
    mocks.addEnrichRecords.mockReturnValue(false)

    const matches: MatchResult[] = [{ animeRow: 2, matchedAnimeName: '芙莉莲', matchType: 'exact', bangumiRow: 2, bangumiName: '芙莉莲' }]
    enrichEntries(animeSheet, bangumiSheet, matches, makeConfig())

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringContaining('富化记录写入失败'),
      'error',
    )
  })

  it('传入简介表上下文时按名称关联富化（主表与简介表独立场景）', () => {
    seedAnimeSheet()
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')
    // 独立的简介工作表
    setCell('intro', 1, 1, '名称')
    setCell('intro', 1, 2, '导演')
    setCell('intro', 1, 3, '编剧')
    setCell('intro', 2, 1, '芙莉莲')
    setCell('intro', 2, 2, '斋藤圭一郎')
    setCell('intro', 2, 3, '铃木智寻')

    const intro = buildIntroSheetContext({ Name: 'intro' } as never)
    expect(intro).not.toBeNull()

    const matches: MatchResult[] = [
      { animeRow: 2, matchedAnimeName: '芙莉莲', matchType: 'exact', bangumiRow: 2, bangumiName: '芙莉莲' },
    ]
    const results = enrichEntries(
      animeSheet,
      bangumiSheet,
      matches,
      makeConfig(),
      undefined,
      intro ?? undefined,
    )

    const [item] = results
    expect(item?.kind).toBe('matched')
    expect(item?.enrichedFields.map((f) => f.fieldName)).toEqual(
      expect.arrayContaining(['特点/印象(导演)', '特点/印象(编剧)']),
    )
    // Bangumi 表没有导演/脚本列 → 回退到特点/印象
    expect(getCell(BANGUMI, 2, 7)).toContain('导演:斋藤圭一郎')
    expect(getCell(BANGUMI, 2, 7)).toContain('编剧:铃木智寻(编剧)')
  })

  it('简介列配置走 enrichIntroData 分支并自动补齐缺失列失败时提示', () => {
    setCell(ANIME, 1, 1, '名称')
    setCell(ANIME, 1, 2, '简介')
    setCell(ANIME, 1, 3, '导演')
    setCell(ANIME, 2, 1, '芙莉莲')
    setCell(ANIME, 2, 2, '简介内容')
    setCell(ANIME, 2, 3, '斋藤圭一郎')
    seedBangumiHeader()
    setCell(BANGUMI, 2, 1, '芙莉莲')

    // 样式/表头 Range 不可用 → ensureBangumiColumns 走降级分支（不阻断富化）
    const noStyleSheet = {
      Name: BANGUMI,
      Range: () => {
        throw new Error('样式不可用')
      },
    } as never

    const introMapping: EnrichColumnMapping = { nameCol: 1, introCol: 2, directorCol: 3 }
    const matches: MatchResult[] = [{ animeRow: 2, matchedAnimeName: '芙莉莲', matchType: 'exact', bangumiRow: 2, bangumiName: '芙莉莲' }]

    const results = enrichEntries(animeSheet, noStyleSheet, matches, makeConfig(introMapping))

    const [item] = results
    expect(item?.kind).toBe('matched')
    expect(item?.enrichedFields.map((f) => f.fieldName)).toEqual(
      expect.arrayContaining(['特点/印象(简介补充)']),
    )
    // 导演列在 Bangumi 表不存在 → 回退到特点/印象
    expect(getCell(BANGUMI, 2, 7)).toContain('导演:斋藤圭一郎')
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('自动添加缺失列失败'), 'error')
  })
})

// ========== ensureBangumiColumns 样式降级 ==========

describe('ensureBangumiColumns 样式降级', () => {
  it('样式来源读取失败时降级为默认样式且仍添加列', () => {
    mocks.readBackOverride = [['导演']]

    const result = ensureBangumiColumns(
      createStyledSheet(true, false),
      new Map([['名称', 1]]),
      { 导演: '导演' },
      1,
    )

    expect(result.get('导演')).toBe(2)
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      'WARN',
      expect.stringContaining('无法获取样式模板'),
    )
  })

  it('复制样式到新列失败时降级且仍添加列', () => {
    mocks.readBackOverride = [['导演']]

    const result = ensureBangumiColumns(
      createStyledSheet(false, true),
      new Map([['名称', 1]]),
      { 导演: '导演' },
      1,
    )

    expect(result.get('导演')).toBe(2)
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      'WARN',
      expect.stringContaining('复制样式失败'),
    )
  })
})

// ========== detectAnimeSourceLayout ==========

describe('detectAnimeSourceLayout 新番来源表布局', () => {
  it('识别横向字段行并跳过标题行定位数据起始行', () => {
    // 第 1 行标题；第 2 行横向字段（命中 3 个）；名称列在 C（第 3 列左侧）
    setCell(ANIME, 1, 1, '2026年4月新番一览')
    setCell(ANIME, 2, 3, '周更时间')
    setCell(ANIME, 2, 4, '播放平台')
    setCell(ANIME, 2, 5, '独播')
    setCell(ANIME, 3, 2, '2026年4月新番表 v2')
    setCell(ANIME, 4, 2, '芙莉莲')

    const layout = detectAnimeSourceLayout(animeSheet)

    expect(layout).not.toBeNull()
    expect(layout?.headerRow).toBe(2)
    expect(layout?.dataStartRow).toBe(4)
    expect(layout?.columnMapping.nameCol).toBe(2)
  })

  it('字段行不足 3 个命中时返回 null', () => {
    setCell(ANIME, 2, 3, '周更时间')
    setCell(ANIME, 2, 4, '播放平台')

    expect(detectAnimeSourceLayout(animeSheet)).toBeNull()
  })

  it('字段行从第 1 列开始时返回 null（不是该模板布局）', () => {
    setCell(ANIME, 2, 1, '周更时间')
    setCell(ANIME, 2, 2, '播放平台')
    setCell(ANIME, 2, 3, '独播')

    expect(detectAnimeSourceLayout(animeSheet)).toBeNull()
  })
})

// ========== searchSheet ==========

function seedSearchSheet(): void {
  setCell(BANGUMI, 1, 1, '名称')
  setCell(BANGUMI, 1, 2, '别名')
  setCell(BANGUMI, 2, 1, '芙莉莲')
  setCell(BANGUMI, 2, 2, '葬送的芙莉莲 | 芙莉莲')
  setCell(BANGUMI, 3, 1, '间谍过家家')
}

describe('searchSheet 搜索', () => {
  const colMap = new Map<string, number>([
    ['名称', 1],
    ['别名', 2],
  ])

  it('关键词为空（含纯空白）时返回空数组', () => {
    seedSearchSheet()

    expect(searchSheet(bangumiSheet, '', colMap, 2)).toEqual([])
    expect(searchSheet(bangumiSheet, ' '.repeat(3), colMap, 2)).toEqual([])
  })

  it('缺少名称列时返回空数组', () => {
    seedSearchSheet()

    expect(searchSheet(bangumiSheet, '芙莉莲', new Map([['别名', 2]]), 2)).toEqual([])
  })

  it('数据起始行大于末行时返回空数组', () => {
    seedSearchSheet()

    expect(searchSheet(bangumiSheet, '芙莉莲', colMap, 10)).toEqual([])
  })

  it('命中名称并附带命中的别名', () => {
    seedSearchSheet()

    const results = searchSheet(bangumiSheet, '芙莉莲', colMap, 2)

    expect(results).toHaveLength(1)
    const [first] = results
    expect(first?.row).toBe(2)
    expect(first?.name).toBe('芙莉莲')
    expect(first?.fieldMatches).toEqual([
      { column: '名称', value: '芙莉莲' },
      { column: '别名', value: '葬送的芙莉莲' },
      { column: '别名', value: '芙莉莲' },
    ])
  })

  it('只有名称列时也能命中且不产出别名字段', () => {
    seedSearchSheet()

    const results = searchSheet(bangumiSheet, '芙莉莲', new Map([['名称', 1]]), 2)

    expect(results).toHaveLength(1)
    expect(results[0]?.fieldMatches).toEqual([{ column: '名称', value: '芙莉莲' }])
  })

  it('无命中时返回空数组', () => {
    seedSearchSheet()

    expect(searchSheet(bangumiSheet, '不存在的番', colMap, 2)).toEqual([])
  })
})
