/**
 * @fileoverview 富化引擎核心模块
 * @module sync/enrichEngine
 * @description 实现新番表数据富化的核心逻辑：
 *              1. 列名自动识别（表头关键字匹配）
 *              2. 双重匹配算法（精确名称 + 别名）
 *              3. 数据合并规则（空值填充 + 标签追加）
 *
 * @author BGM Development Team
 * @version 1.0.0
 */

import { LOG_LEVELS, PANEL_CONFIG } from '../core/constants.js'
import { getNotifyApi } from '../core/ui-bridge.js'
import {
  bgmLog,
  getCellValue,
  setCellValue,
  getLastRow,
  isEmptyValue,
  findHeaderRow,
  getColumnMap,
  readRangeValues,
  BGM,
} from '../tools/util/index.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'

import { addEnrichRecords } from './enrich-record.js'
import type { AddEnrichRecordParameters } from './enrich-record.js'
import {
  TAG_SEPARATOR,
  FEATURE_SEPARATOR,
  normalizeName,
  splitAliases,
  mergeTags,
  appendFeatures,
  shouldFilterNoise,
} from './enrich-normalize.js'

// 纯文本工具簇已迁至 `enrich-normalize.js`，此处再导出以保持既有导入路径不变。
export {
  normalizeName,
  splitAliases,
  splitTags,
  mergeTags,
  appendFeatures,
  resetNoiseKeywordCache,
  shouldFilterNoise,
} from './enrich-normalize.js'

// ========== 常量定义 ==========

/**
 * 新番表已知列名映射
 * 将各种可能的表头名称映射到标准字段 key
 */
const KNOWN_COLUMN_MAP: Record<string, keyof EnrichColumnMapping> = {
  名称: 'nameCol',
  动漫名称: 'nameCol',
  番组名: 'nameCol',
  TAGS: 'tagsCol',
  标签: 'tagsCol',
  分类: 'tagsCol',
  首播: 'premiereCol',
  开播: 'premiereCol',
  播出日期: 'premiereCol',
  集数: 'episodesCol',
  话数: 'episodesCol',
  周更时间: 'weekdayCol',
  播出时间: 'weekdayCol',
  播放平台: 'platformCol',
  平台: 'platformCol',
  独播: 'exclusiveCol',
  特殊: 'specialCol',
  备注: 'specialCol',
  // 简介工作表列名
  简介: 'introCol',
  剧情简介: 'introCol',
  作品简介: 'introCol',
  介绍: 'introCol',
  动画制作: 'studioCol',
  制作公司: 'studioCol',
  制作: 'studioCol',
  导演: 'directorCol',
  监督: 'directorCol',
  音乐: 'musicCol',
  配乐: 'musicCol',
  声优: 'voiceCol',
  声优阵容: 'voiceCol',
  OP: 'opCol',
  ED: 'edCol',
  PV: 'pvCol',
  // 简介专有列
  编剧: 'screenplayCol',
  脚本: 'screenplayCol',
  人设: 'characterDesignCol',
  人物设定: 'characterDesignCol',
  CG导演: 'cgDirectorCol',
  演出: 'cgDirectorCol',
  系列构成: 'seriesCompositionCol',
  分镜: 'storyboardCol',
  原作: 'originalWorkCol',
  语言: 'languageCol',
  制片国家: 'productionCountryCol',
  类型: 'typeCol',
}

/**
 * 新番来源表的横向表头关键字。
 *
 * 这类表格（例如「2026年4月新番表 v2.13」）不是标准数据库表：
 * 名称列 C 没有写「名称」表头，D:N 才从第 2 行开始写周更时间、首播、集数等字段，
 * 因此不能只依赖通用 Bangumi 表头关键字（否则会误判为没有表头）。
 */
const ANIME_SOURCE_HEADER_KEYWORDS = [
  '周更时间',
  '播放平台',
  '独播',
  '首播',
  '集数',
  '特殊',
  'tags',
] as const

// ========== 类型定义 ==========

/**
 * 富化列映射
 * 记录新番表中各字段对应的列号
 */
export interface EnrichColumnMapping {
  nameCol: number
  tagsCol?: number
  premiereCol?: number
  episodesCol?: number
  weekdayCol?: number
  platformCol?: number
  /**
   * 额外播放平台列：Hazx 新番表的「播放平台」横向占多列（如 F/G/H/I），
   * 第一列进 platformCol，其余列（含表头为空或重复「播放平台」的列）进这里。
   */
  platformExtraCols?: number[]
  exclusiveCol?: number
  specialCol?: number
  introCol?: number
  studioCol?: number
  directorCol?: number
  musicCol?: number
  voiceCol?: number
  opCol?: number
  edCol?: number
  pvCol?: number
  screenplayCol?: number
  characterDesignCol?: number
  cgDirectorCol?: number
  seriesCompositionCol?: number
  storyboardCol?: number
  originalWorkCol?: number
  languageCol?: number
  productionCountryCol?: number
  typeCol?: number
}

/**
 * 富化配置
 */
export interface EnrichConfig {
  filePath: string
  sheetName: string
  headerRow: number
  dataStartRow: number
  columnMapping: EnrichColumnMapping
  targetSheetName?: string
}

/**
 * 匹配结果
 */
export interface MatchResult {
  animeRow: number
  matchedAnimeName: string
  matchType: 'exact' | 'alias' | 'unmatched' | 'error'
  bangumiRow?: number
  bangumiName?: string
  aliases?: string[]
  errorMessage?: string
}

/**
 * 富化字段变更记录
 */
export interface EnrichedField {
  fieldName: string
  bangumiColumn: number
  oldValue: string | null
  updatedValue: string
  action: 'fill' | 'append' | 'skip'
  /** 附注：仅当来源字段名与目标列名不同时存在，形如「字段名差异: 编剧 → 脚本」 */
  note?: string
}

/**
 * 字段冲突信息（需用户确认）
 */
export interface ConflictInfo {
  fieldName: string
  bangumiColumn: number
  bangumiRow: number
  oldValue: string
  updatedValue: string
  animeRow: number
  matchedAnimeName: string
  resolution: 'append' | 'keep' | 'overwrite'
  note?: string
}

/**
 * 富化结果条目
 */
export interface EnrichResultItem {
  kind: 'matched' | 'unmatched' | 'error'
  animeRow: number
  name: string
  matchType?: 'exact' | 'alias' | 'unmatched' | 'error'
  enrichedFields: EnrichedField[]
  conflicts?: ConflictInfo[] | undefined
  errorMessage?: string
}

/**
 * 富化统计
 */
export interface EnrichStats {
  matched: number
  enriched: number
  skipped: number
  failed: number
}

/**
 * 单行富化结果（供 enrichEntries 累计统计）
 */
type EnrichRowOutcome = 'enriched' | 'skipped' | 'error'

/**
 * 富化进度
 */
export interface EnrichProgress {
  current: number
  total: number
  currentName: string
  stats: EnrichStats
  etaMs: number
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: EnrichProgress) => void

// ========== 核心函数 ==========

/**
 * 匹配表头对应的首个字段名（独立辅助函数，用 return 替代嵌套循环内 break，且不改写参数避免 no-param-reassign）
 * @returns 命中的字段名；无匹配返回 null
 */
function findKeywordField(normalizedHeader: string): keyof EnrichColumnMapping | null {
  for (const [keyword, field] of Object.entries(KNOWN_COLUMN_MAP)) {
    if (normalizedHeader.includes(keyword.toLowerCase())) {
      return field
    }
  }
  return null
}

/**
 * 检测新番表的列映射
 * 读取表头行，用 KNOWN_COLUMN_MAP 匹配列名
 */
export function detectColumns(sheet: WpsWorksheet, headerRow: number): EnrichColumnMapping {
  const mapping: EnrichColumnMapping = { nameCol: 0 }

  const maxCols = 50
  for (let col = 1; col <= maxCols; col += 1) {
    const headerValue = getCellValue(sheet, headerRow, col).trim()
    if (headerValue) {
      const normalizedHeader = headerValue.toLowerCase()
      const field = findKeywordField(normalizedHeader)
      if (field === 'nameCol' && mapping.nameCol === 0) {
        mapping.nameCol = col
      } else if (field === 'platformCol' && mapping.platformCol !== undefined) {
        // 重复的「播放平台」表头：横向多列平台，追加进额外平台列
        mapping.platformExtraCols = [...(mapping.platformExtraCols ?? []), col]
      } else if (
        field !== null &&
        field !== 'nameCol' &&
        field !== 'platformExtraCols' &&
        mapping[field] === undefined
      ) {
        mapping[field] = col
      }
    }
  }

  // Hazx 新番表布局：「播放平台」F 列之后、独播 J 列之前的空表头列（G/H/I）也是平台列
  // （播放平台表头常为合并单元格，仅首列有值）。独播列之前且表头为空的连续列视作平台列。
  if (
    mapping.platformCol &&
    mapping.exclusiveCol &&
    mapping.exclusiveCol > mapping.platformCol + 1
  ) {
    for (let col = mapping.platformCol + 1; col < mapping.exclusiveCol; col += 1) {
      if (getCellValue(sheet, headerRow, col).trim() === '') {
        mapping.platformExtraCols = [...(mapping.platformExtraCols ?? []), col]
      }
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[detectColumns] 列映射: name=${String(mapping.nameCol)}, tags=${String(mapping.tagsCol ?? 'N/A')}, ` +
      `premiere=${String(mapping.premiereCol ?? 'N/A')}, episodes=${String(mapping.episodesCol ?? 'N/A')}, ` +
      `weekday=${String(mapping.weekdayCol ?? 'N/A')}, platform=${String(mapping.platformCol ?? 'N/A')}, ` +
      `platformExtra=${String(mapping.platformExtraCols?.length ?? 0)}列, ` +
      `exclusive=${String(mapping.exclusiveCol ?? 'N/A')}, special=${String(mapping.specialCol ?? 'N/A')}`,
  )

  return mapping
}

/**
 * 聚合一行全部播放平台值：platformCol + platformExtraCols + exclusiveCol，去空去重保序。
 * 署名/标注示例等噪声同时过滤（预览与富化写入共用口径）。
 */
export function readPlatformValues(
  sheet: WpsWorksheet,
  row: number,
  mapping: EnrichColumnMapping,
): string[] {
  const cols = [
    mapping.platformCol ?? 0,
    ...(mapping.platformExtraCols ?? []),
    mapping.exclusiveCol ?? 0,
  ]
  const values: string[] = []
  for (const col of cols) {
    if (col > 0) {
      for (const part of getCellValue(sheet, row, col).split(/[,，、/|]/)) {
        const value = part.trim()
        if (value && !shouldFilterNoise(value) && !values.includes(value)) values.push(value)
      }
    }
  }
  return values
}

export interface AnimeSourceLayout {
  headerRow: number
  dataStartRow: number
  columnMapping: EnrichColumnMapping
}

/**
 * 识别 Hazx 新番表这类「标题/分组行 + 横向字段行 + 数据」布局。
 * 通用 findHeaderRow 只认识 Bangumi 追踪表字段，无法识别该文件第 2 行的周更时间/播放平台等字段。
 */
export function detectAnimeSourceLayout(sheet: WpsWorksheet): AnimeSourceLayout | null {
  let headerRow = 0
  let firstFieldCol = 0

  for (let row = 1; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
    let matchedFields = 0
    let rowFirstFieldCol = 0
    for (let col = 1; col <= 50; col += 1) {
      const value = getCellValue(sheet, row, col).trim().toLowerCase()
      if (
        value &&
        ANIME_SOURCE_HEADER_KEYWORDS.some((keyword) => value === keyword.toLowerCase())
      ) {
        matchedFields += 1
        if (rowFirstFieldCol === 0) rowFirstFieldCol = col
      }
    }
    if (matchedFields >= 3) {
      headerRow = row
      firstFieldCol = rowFirstFieldCol
      break
    }
  }

  if (headerRow === 0 || firstFieldCol <= 1) return null

  const columnMapping = detectColumns(sheet, headerRow)
  if (columnMapping.nameCol === 0) {
    // 该模板的名称列紧邻第一个字段列左侧（C 列在 D 列「周更时间」之前）。
    columnMapping.nameCol = firstFieldCol - 1
  }

  let dataStartRow = headerRow + 1
  for (let row = headerRow + 1; row <= PANEL_CONFIG.MAX_SCAN_ROWS + 10; row += 1) {
    const name = getCellValue(sheet, row, columnMapping.nameCol).trim()
    if (name && !name.includes('新番表') && !name.includes('番组表')) {
      dataStartRow = row
      break
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[detectAnimeSourceLayout] 新番表布局识别成功: 表头行=${String(headerRow)} / 数据起始行=${String(dataStartRow)} / 名称列=${String(columnMapping.nameCol)}`,
  )
  return { headerRow, dataStartRow, columnMapping }
}

/**
 * 查找 Bangumi 追踪表的别名列
 */
export function findAliasColumn(sheet: WpsWorksheet): number {
  const headerRow = findHeaderRow(sheet)
  if (headerRow === 0) return 0

  const maxCols = 50
  for (let col = 1; col <= maxCols; col += 1) {
    const headerValue = getCellValue(sheet, headerRow, col).trim().toLowerCase()
    if (
      headerValue.includes('别名') ||
      headerValue.includes('alias') ||
      headerValue.includes('原名')
    ) {
      return col
    }
  }
  return 0
}

/**
 * 获取 Bangumi 追踪表的列映射
 * 基于 COLUMN_RULES 的 getColumnMap 封装
 */
export function getBangumiColumnMap(sheet: WpsWorksheet): Map<string, number> {
  const headerRow = findHeaderRow(sheet)
  if (headerRow === 0) {
    bgmLog(LOG_LEVELS.WARN, '[getBangumiColumnMap] 未找到表头行')
    return new Map()
  }
  return getColumnMap(sheet, headerRow)
}

/**
 * 读取新番表一行数据
 */
export function readNewAnimeRow(
  sheet: WpsWorksheet,
  row: number,
  mapping: EnrichColumnMapping,
): Record<string, string> {
  const data: Record<string, string> = { 名称: getCellValue(sheet, row, mapping.nameCol) || '' }
  if (mapping.tagsCol) data.TAGS = getCellValue(sheet, row, mapping.tagsCol) || ''
  if (mapping.premiereCol) data['首播'] = getCellValue(sheet, row, mapping.premiereCol) || ''
  if (mapping.episodesCol) data['集数'] = getCellValue(sheet, row, mapping.episodesCol) || ''
  if (mapping.weekdayCol) data['周更时间'] = getCellValue(sheet, row, mapping.weekdayCol) || ''
  // 播放平台聚合：platformCol + platformExtraCols + exclusiveCol 去空去重（富化与预览共用口径）
  data['播放平台'] = readPlatformValues(sheet, row, mapping).join(TAG_SEPARATOR)
  if (mapping.exclusiveCol) data['独播'] = getCellValue(sheet, row, mapping.exclusiveCol) || ''
  if (mapping.specialCol) data['特殊'] = getCellValue(sheet, row, mapping.specialCol) || ''
  return data
}

/**
 * 构建 Bangumi 追踪表的索引
 * 返回 [名称索引, 别名索引]
 */
function buildBangumiIndexes(
  bangumiSheet: WpsWorksheet,
  columnMap: Map<string, number>,
): [Map<string, number>, Map<string, number[]>, Map<number, string>] {
  const nameIndex = new Map<string, number>()
  const aliasIndex = new Map<string, number[]>()
  const rowNames = new Map<number, string>()

  const nameCol = columnMap.get('名称') ?? 0
  if (nameCol === 0) {
    bgmLog(LOG_LEVELS.WARN, '[buildBangumiIndexes] Bangumi表中未找到名称列')
    return [nameIndex, aliasIndex, rowNames]
  }

  const aliasCol = findAliasColumn(bangumiSheet)
  const lastRow = getLastRow(bangumiSheet)

  // 性能（P1-C）：一次矩形读取覆盖名称列与别名列，替代逐行 1~2 次 getCellValue
  const allData =
    lastRow >= 2 ? readRangeValues(bangumiSheet, 2, lastRow, 1, Math.max(nameCol, aliasCol)) : []

  for (const [index, rowData] of allData.entries()) {
    const row = index + 2
    const name = (rowData[nameCol - 1] ?? '').trim()
    if (name) {
      const normalizedName = normalizeName(name)
      nameIndex.set(normalizedName, row)
      rowNames.set(row, name)

      if (aliasCol > 0) {
        const aliasString = (rowData[aliasCol - 1] ?? '').trim()
        if (aliasString) {
          const aliases = splitAliases(aliasString)
          for (const alias of aliases) {
            const normalizedAlias = normalizeName(alias)
            if (!aliasIndex.has(normalizedAlias)) {
              aliasIndex.set(normalizedAlias, [])
            }
            const rows = aliasIndex.get(normalizedAlias)
            if (rows && !rows.includes(row)) {
              rows.push(row)
            }
          }
        }
      }
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[buildBangumiIndexes] 名称索引: ${String(nameIndex.size)} 条, 别名索引: ${String(aliasIndex.size)} 条`,
  )

  return [nameIndex, aliasIndex, rowNames]
}

/**
 * 判断 Bangumi 目标表是否为空（有表头但无数据行）
 * 空表时富化流程会将新番表条目作为新行追加写入
 * @returns true 表示目标表只有表头、没有任何数据行
 */
export function isBangumiSheetEmpty(bangumiSheet: WpsWorksheet): boolean {
  const headerRow = findHeaderRow(bangumiSheet)
  if (headerRow <= 0) return false
  const lastRow = getLastRow(bangumiSheet, true, headerRow)
  return lastRow <= headerRow
}

/**
 * 匹配新番表与 Bangumi 追踪表条目
 */
export function matchEntries(
  animeSheet: WpsWorksheet,
  bangumiSheet: WpsWorksheet,
  config: EnrichConfig,
): MatchResult[] {
  const results: MatchResult[] = []

  try {
    matchEntriesInner(animeSheet, bangumiSheet, config, results)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'matchEntries', showAlert: false })
  }

  return results
}

/**
 * matchEntries 主体（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function matchEntriesInner(
  animeSheet: WpsWorksheet,
  bangumiSheet: WpsWorksheet,
  config: EnrichConfig,
  results: MatchResult[],
): void {
  const bangumiColMap = getBangumiColumnMap(bangumiSheet)
  const [nameIndex, aliasIndex, rowNames] = buildBangumiIndexes(bangumiSheet, bangumiColMap)

  const lastRow = getLastRow(animeSheet)
  const { dataStartRow } = config

  const { nameCol } = config.columnMapping
  if (nameCol === 0) {
    bgmLog(LOG_LEVELS.ERROR, '[matchEntries] 新番表未找到名称列，无法匹配')
    return
  }

  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const rawName = getCellValue(animeSheet, row, nameCol).trim()
    if (rawName) {
      const normalizedName = normalizeName(rawName)
      let matchResult: MatchResult = {
        animeRow: row,
        matchedAnimeName: rawName,
        matchType: 'unmatched',
      }

      try {
        // 精确匹配
        if (nameIndex.has(normalizedName)) {
          const bangumiRow = nameIndex.get(normalizedName)
          if (bangumiRow !== undefined) {
            const matchedName = rowNames.get(bangumiRow)
            matchResult = {
              animeRow: row,
              matchedAnimeName: rawName,
              matchType: 'exact',
              bangumiRow,
              ...(matchedName !== undefined && { bangumiName: matchedName }),
            }
          }
        }

        // 别名匹配
        if (matchResult.matchType === 'unmatched') {
          const aliasRows = aliasIndex.get(normalizedName)
          if (aliasRows && aliasRows.length > 0) {
            const bangumiRow = aliasRows[0]
            if (bangumiRow !== undefined) {
              const aliases: string[] = []
              for (const [alias, rows] of aliasIndex) {
                if (rows.includes(bangumiRow)) {
                  aliases.push(alias)
                }
              }
              const matchedName = rowNames.get(bangumiRow)
              matchResult = {
                animeRow: row,
                matchedAnimeName: rawName,
                matchType: 'alias',
                bangumiRow,
                ...(matchedName !== undefined && { bangumiName: matchedName }),
                aliases,
              }
            }
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        matchResult = {
          animeRow: row,
          matchedAnimeName: rawName,
          matchType: 'error',
          errorMessage,
        }
        bgmLog(LOG_LEVELS.ERROR, `[matchEntries] 匹配 "${rawName}" 时出错: ${errorMessage}`)
      }

      results.push(matchResult)
    }
  }

  const unmatchedCount = results.filter((r) => r.matchType === 'unmatched').length
  const errorCount = results.filter((r) => r.matchType === 'error').length
  bgmLog(
    LOG_LEVELS.INFO,
    `[matchEntries] 匹配完成：精确 ${String(results.filter((r) => r.matchType === 'exact').length)} 条, ` +
      `别名 ${String(results.filter((r) => r.matchType === 'alias').length)} 条, ` +
      `未匹配 ${String(unmatchedCount)} 条, 错误 ${String(errorCount)} 条, 共 ${String(results.length)} 条`,
  )
}

/**
 * 富化标签
 * 追加模式（现有 + TAG_SEPARATOR + 新标签，去重），空值时填充
 */
export function enrichTags(
  sheet: WpsWorksheet,
  row: number,
  incomingData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiTagsCol = colMap.get('标签/分级') ?? colMap.get('标签')
  if (!bangumiTagsCol) return

  const incomingTags = incomingData.TAGS ?? ''
  if (isEmptyValue(incomingTags)) return

  const oldTags = getCellValue(sheet, row, bangumiTagsCol)
  if (isEmptyValue(oldTags)) {
    setCellValue(sheet, row, bangumiTagsCol, incomingTags)
    enriched.push({
      fieldName: '标签/分级',
      bangumiColumn: bangumiTagsCol,
      oldValue: null,
      updatedValue: incomingTags,
      action: 'fill',
    })
  } else {
    const merged = mergeTags(oldTags, incomingTags)
    if (merged === oldTags) {
      enriched.push({
        fieldName: '标签/分级',
        bangumiColumn: bangumiTagsCol,
        oldValue: oldTags,
        updatedValue: merged,
        action: 'skip',
      })
    } else {
      setCellValue(sheet, row, bangumiTagsCol, merged)
      enriched.push({
        fieldName: '标签/分级',
        bangumiColumn: bangumiTagsCol,
        oldValue: oldTags,
        updatedValue: merged,
        action: 'append',
      })
    }
  }
}

/**
 * 富化播放平台
 * 写入 Bangumi 表「在线播放平台」列；目标单元格已有值时合并去重，不重复写入已有平台
 */
export function enrichPlatform(
  sheet: WpsWorksheet,
  row: number,
  incomingData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const targetCol = colMap.get('在线播放平台') ?? colMap.get('播放平台')
  if (!targetCol) return

  const incomingPlatforms = incomingData['播放平台'] ?? ''
  if (isEmptyValue(incomingPlatforms)) return

  const oldPlatforms = getCellValue(sheet, row, targetCol)
  if (isEmptyValue(oldPlatforms)) {
    setCellValue(sheet, row, targetCol, incomingPlatforms)
    enriched.push({
      fieldName: '在线播放平台',
      bangumiColumn: targetCol,
      oldValue: null,
      updatedValue: incomingPlatforms,
      action: 'fill',
    })
  } else {
    const merged = mergeTags(oldPlatforms, incomingPlatforms)
    if (merged === oldPlatforms) {
      enriched.push({
        fieldName: '在线播放平台',
        bangumiColumn: targetCol,
        oldValue: oldPlatforms,
        updatedValue: merged,
        action: 'skip',
      })
    } else {
      setCellValue(sheet, row, targetCol, merged)
      enriched.push({
        fieldName: '在线播放平台',
        bangumiColumn: targetCol,
        oldValue: oldPlatforms,
        updatedValue: merged,
        action: 'append',
      })
    }
  }
}

/**
 * 富化首播日期
 * 仅在 Bangumi 列为空时填充
 */
export function enrichDate(
  sheet: WpsWorksheet,
  row: number,
  incomingData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiDateCol = colMap.get('开播日期')
  if (!bangumiDateCol) return

  const date = incomingData['首播'] ?? ''
  if (isEmptyValue(date)) return

  const oldDate = getCellValue(sheet, row, bangumiDateCol)
  if (isEmptyValue(oldDate)) {
    setCellValue(sheet, row, bangumiDateCol, date)
    enriched.push({
      fieldName: '开播日期',
      bangumiColumn: bangumiDateCol,
      oldValue: null,
      updatedValue: date,
      action: 'fill',
    })
  } else {
    enriched.push({
      fieldName: '开播日期',
      bangumiColumn: bangumiDateCol,
      oldValue: oldDate,
      updatedValue: date,
      action: 'skip',
    })
  }
}

/**
 * 富化集数
 * 仅在 Bangumi 列为空时填充
 */
export function enrichEpisodes(
  sheet: WpsWorksheet,
  row: number,
  incomingData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiEpisodesCol = colMap.get('集数')
  if (!bangumiEpisodesCol) return

  const incomingEpisodes = incomingData['集数'] ?? ''
  if (isEmptyValue(incomingEpisodes)) return

  const oldEpisodes = getCellValue(sheet, row, bangumiEpisodesCol)
  if (isEmptyValue(oldEpisodes)) {
    setCellValue(sheet, row, bangumiEpisodesCol, incomingEpisodes)
    enriched.push({
      fieldName: '集数',
      bangumiColumn: bangumiEpisodesCol,
      oldValue: null,
      updatedValue: incomingEpisodes,
      action: 'fill',
    })
  } else {
    enriched.push({
      fieldName: '集数',
      bangumiColumn: bangumiEpisodesCol,
      oldValue: oldEpisodes,
      updatedValue: incomingEpisodes,
      action: 'skip',
    })
  }
}

/**
 * 富化特点/印象
 * 追加模式（收集周更/平台/独播/特殊信息，以 FEATURE_SEPARATOR 分隔）
 */
export function enrichFeatures(
  sheet: WpsWorksheet,
  row: number,
  incomingData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiFeatureCol = colMap.get('特点/印象')
  if (!bangumiFeatureCol) return

  const featureParts: string[] = []

  const weekday = incomingData['周更时间'] ?? ''
  if (!isEmptyValue(weekday)) {
    featureParts.push(`周更:${weekday}`)
  }

  const platform = incomingData['播放平台'] ?? ''
  if (!isEmptyValue(platform)) {
    featureParts.push(`平台:${platform}`)
  }

  const exclusive = incomingData['独播'] ?? ''
  if (!isEmptyValue(exclusive)) {
    featureParts.push(`独播:${exclusive}`)
  }

  const special = incomingData['特殊'] ?? ''
  if (!isEmptyValue(special)) {
    featureParts.push(`特殊:${special}`)
  }

  if (featureParts.length === 0) return

  const features = featureParts.join(FEATURE_SEPARATOR)
  const oldFeature = getCellValue(sheet, row, bangumiFeatureCol)

  if (isEmptyValue(oldFeature)) {
    setCellValue(sheet, row, bangumiFeatureCol, features)
    enriched.push({
      fieldName: '特点/印象',
      bangumiColumn: bangumiFeatureCol,
      oldValue: null,
      updatedValue: features,
      action: 'fill',
    })
  } else {
    const merged = appendFeatures(oldFeature, features)
    if (merged === oldFeature) {
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        updatedValue: merged,
        action: 'skip',
      })
    } else {
      setCellValue(sheet, row, bangumiFeatureCol, merged)
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        updatedValue: merged,
        action: 'append',
      })
    }
  }
}

/**
 * 简介字段 → Bangumi追踪表列名映射
 * 键：新番表中的字段名；值：Bangumi追踪表中的列名
 */
const INTRO_FIELD_TO_BANGUMI: Record<string, string> = {
  导演: '导演',
  编剧: '脚本',
  人设: '人物设定',
  CG导演: '演出',
  音乐: '音乐',
  动画制作: '动画制作公司',
  系列构成: '系列构成',
  分镜: '分镜',
  原作: '原作',
  语言: '语言',
  制片国家: '制片国家',
  声优: '声优',
}

/**
 * 执行富化操作
 * 对每个匹配结果执行富化，写入富化记录，调用进度回调
 */
export function enrichEntries(
  animeSheet: WpsWorksheet,
  bangumiSheet: WpsWorksheet,
  matches: MatchResult[],
  config: EnrichConfig,
  progressCallback?: ProgressCallback,
  intro?: IntroSheetContext,
  isCancelled?: () => boolean,
): EnrichResultItem[] {
  const results: EnrichResultItem[] = []
  const stats = { matched: 0, enriched: 0, skipped: 0, failed: 0 }
  // 富化记录先累积、循环外一次性批量写入（逐条 addEnrichRecord 会重复取表句柄 + 9 次 COM 写入）
  const enrichRecords: AddEnrichRecordParameters[] = []
  const total = matches.length

  if (total === 0) {
    bgmLog(LOG_LEVELS.INFO, '[enrichEntries] 无匹配结果，跳过富化')
    return results
  }

  // startTime 声明移到 early return 之后（满足 unicorn/no-declarations-before-early-exit）
  const startTime = Date.now()

  let bangumiColMap = getBangumiColumnMap(bangumiSheet)

  if (intro || isIntroSheet(config.columnMapping)) {
    bangumiColMap = ensureBangumiColumns(
      bangumiSheet,
      bangumiColMap,
      INTRO_FIELD_TO_BANGUMI,
      config.headerRow,
    )
  }

  // 空目标表检测：表空时未匹配条目无行可匹配，改为作为新行追加写入
  const bangumiHeaderRow = findHeaderRow(bangumiSheet)
  const bangumiLastRow = bangumiHeaderRow > 0 ? getLastRow(bangumiSheet, true, bangumiHeaderRow) : 0
  const isBangumiEmpty = bangumiHeaderRow > 0 && bangumiLastRow <= bangumiHeaderRow
  let nextAppendRow = bangumiLastRow + 1
  const bangumiNameCol = bangumiColMap.get('名称') ?? 0

  for (const [index, match] of matches.entries()) {
    // 取消检查放在条目边界：当前条目已写入的单元格保留（不回滚），避免半行脏数据
    if (isCancelled?.() === true) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[enrichEntries] 用户取消富化：已完成 ${String(index)}/${String(total)} 条，已写入结果保留`,
      )
      break
    }

    const current = index + 1
    let outcome: EnrichRowOutcome = 'skipped'
    let didEnrich = false

    if (isBangumiEmpty && bangumiNameCol > 0 && match.matchType === 'unmatched') {
      // 空目标表：将新番表条目作为新行追加（先写名称，再走常规富化）
      const bangumiRow = nextAppendRow
      nextAppendRow += 1
      setCellValue(bangumiSheet, bangumiRow, bangumiNameCol, match.matchedAnimeName)
      outcome = enrichIntoRow(
        animeSheet,
        bangumiSheet,
        bangumiRow,
        match,
        match.matchedAnimeName,
        '新增',
        config,
        bangumiColMap,
        results,
        enrichRecords,
        intro,
      )
      didEnrich = true
    } else if (match.matchType === 'unmatched') {
      results.push({
        kind: 'unmatched',
        animeRow: match.animeRow,
        name: match.matchedAnimeName,
        matchType: 'unmatched',
        enrichedFields: [],
      })
      stats.skipped += 1
    } else if (match.matchType === 'error') {
      results.push({
        kind: 'error',
        animeRow: match.animeRow,
        name: match.matchedAnimeName,
        matchType: 'error',
        enrichedFields: [],
        ...(match.errorMessage !== undefined && { errorMessage: match.errorMessage }),
      })
      stats.failed += 1
    } else {
      const { bangumiRow } = match
      if (bangumiRow === undefined) {
        results.push({
          kind: 'error',
          animeRow: match.animeRow,
          name: match.matchedAnimeName,
          matchType: 'error',
          enrichedFields: [],
          errorMessage: '匹配行号缺失',
        })
        stats.failed += 1
      } else {
        outcome = enrichIntoRow(
          animeSheet,
          bangumiSheet,
          bangumiRow,
          match,
          match.bangumiName,
          match.matchType === 'exact' ? '精确' : '别名',
          config,
          bangumiColMap,
          results,
          enrichRecords,
          intro,
        )
        didEnrich = true
      }
    }

    if (didEnrich) {
      stats.matched += 1
      if (outcome === 'error') {
        stats.failed += 1
      } else if (outcome === 'enriched') {
        stats.enriched += 1
      } else {
        stats.skipped += 1
      }
      if (progressCallback) {
        const elapsed = Date.now() - startTime
        const etaMs = total > 0 ? Math.round((elapsed / current) * (total - current)) : 0
        progressCallback({
          current,
          total,
          currentName: match.matchedAnimeName,
          stats: { ...stats },
          etaMs,
        })
      }
    }
  }

  // 富化记录一次性批量写入（含用户取消时已累积的部分：对应单元格已写入，记录必须一致）
  // 失败必须让用户看见：单元格已改但审计记录没落盘，等于静默丢数据（P1-E）
  if (!addEnrichRecords(enrichRecords)) {
    getNotifyApi().toast(
      `富化记录写入失败：${String(enrichRecords.length)} 条记录未登记（单元格已修改）`,
      'error',
    )
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrichEntries] 富化完成：匹配 ${String(stats.matched)}, 富化 ${String(stats.enriched)}, ` +
      `跳过 ${String(stats.skipped)}, 失败 ${String(stats.failed)}, 耗时 ${String(Date.now() - startTime)}ms`,
  )

  return results
}

/**
 * 对单个匹配结果执行富化写入
 * 供「已匹配行更新」与「空目标表追加新行」两种场景共用：
 * - 已匹配：bangumiName 传匹配到的名称，recordMatchType 按匹配类型记『精确/别名』
 * - 空表追加：bangumiName 传新番表名称（名称列已写入，避免别名重复），recordMatchType 记『新增』
 * @param records 富化记录累积数组，由 `enrichEntries` 在循环外一次性批量写入（P1-C）
 * @returns 该行富化结果，由调用方累计统计
 */
function enrichIntoRow(
  animeSheet: WpsWorksheet,
  bangumiSheet: WpsWorksheet,
  bangumiRow: number,
  match: MatchResult,
  bangumiName: string | undefined,
  recordMatchType: '精确' | '别名' | '新增',
  config: EnrichConfig,
  bangumiColMap: Map<string, number>,
  results: EnrichResultItem[],
  records: AddEnrichRecordParameters[],
  intro?: IntroSheetContext,
): EnrichRowOutcome {
  const isIntro = isIntroSheet(config.columnMapping)
  const incomingData = isIntro
    ? readIntroSheetRow(animeSheet, match.animeRow, config.columnMapping)
    : readNewAnimeRow(animeSheet, match.animeRow, config.columnMapping)
  const enrichedFields: EnrichedField[] = []
  const fieldConflicts: ConflictInfo[] = []

  try {
    if (isIntro) {
      enrichIntroData(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColMap,
        enrichedFields,
        fieldConflicts,
        match.animeRow,
        match.matchedAnimeName,
      )
      enrichOpEdPv(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields)
    } else {
      enrichTags(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields)
      enrichDate(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields)
      enrichEpisodes(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields)
      enrichPlatform(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields)
      enrichFeatures(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields)
    }

    // 关联简介工作表：按名称查简介行，补写导演/编剧/人设等字段（主表与简介表独立时）
    if (intro) {
      enrichIntroFromContext(
        bangumiSheet,
        bangumiRow,
        intro,
        match.matchedAnimeName,
        bangumiColMap,
        enrichedFields,
        fieldConflicts,
      )
    }

    // 别名富化：新番表名称与 Bangumi 追踪表不一致时补全
    enrichAlias(
      bangumiSheet,
      bangumiRow,
      match.matchedAnimeName,
      bangumiName,
      bangumiColMap,
      enrichedFields,
    )

    for (const field of enrichedFields) {
      records.push({
        timestamp: new Date().toISOString(),
        matchType: recordMatchType,
        name: match.matchedAnimeName,
        row: bangumiRow,
        enrichedField: field.fieldName,
        oldValue: field.oldValue ?? '',
        updatedValue: field.updatedValue,
        action: field.action,
        ...(field.action === 'skip' && { note: '已有值，跳过' }),
      })
    }

    results.push({
      kind: 'matched',
      animeRow: match.animeRow,
      name: match.matchedAnimeName,
      matchType: match.matchType,
      enrichedFields,
      conflicts: fieldConflicts.length > 0 ? fieldConflicts : undefined,
    })

    const hasEnrichment = enrichedFields.some((f) => f.action !== 'skip')
    return hasEnrichment ? 'enriched' : 'skipped'
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(
      LOG_LEVELS.ERROR,
      `[enrichEntries] 富化 "${match.matchedAnimeName}" (行${String(bangumiRow)}) 失败: ${errorMessage}`,
    )
    results.push({
      kind: 'error',
      animeRow: match.animeRow,
      name: match.matchedAnimeName,
      matchType: match.matchType,
      enrichedFields: [],
      errorMessage,
    })
    return 'error'
  }
}

// ========== 导出类型 ==========

export type { EnrichRecord } from './enrich-record.js'

// 注：曾在此处重复定义一份 `AddEnrichRecordParameters`（与 enrich-record.ts 导出的一致）。
// 重复定义会随字段演进静默漂移，已改为从 enrich-record.ts 导入唯一事实来源。

// ========== 简介工作表富化函数 ==========

/** 简介字段中需追加到特点/印象的键 */
const INTRO_FEATURE_FIELDS = new Set(['简介', 'OP', 'ED', 'PV'])

/**
 * 解析字段冲突：根据用户选择的 resolution 执行相应操作
 * append: 增量更新（old | new）
 * keep: 保留原名
 * overwrite: 使用新番表字段的名字
 */
export function resolveConflictField(
  sheet: WpsWorksheet,
  conflict: ConflictInfo,
  enriched: EnrichedField[],
): void {
  const { fieldName, bangumiColumn, bangumiRow, oldValue, updatedValue, resolution } = conflict

  if (resolution === 'keep') {
    enriched.push({
      fieldName,
      bangumiColumn,
      oldValue,
      updatedValue,
      action: 'skip',
    })
    return
  }

  if (resolution === 'overwrite') {
    setCellValue(sheet, bangumiRow, bangumiColumn, updatedValue)
    enriched.push({
      fieldName,
      bangumiColumn,
      oldValue,
      updatedValue,
      action: 'fill',
    })
    return
  }

  // 此处 resolution 已被上方两个分支收窄为 'append'
  if (oldValue.includes(' | ') || oldValue.includes('|')) {
    const parts = oldValue
      .split(/\s*\|\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.includes(updatedValue)) {
      enriched.push({
        fieldName,
        bangumiColumn,
        oldValue,
        updatedValue,
        action: 'skip',
      })
    } else {
      const merged = parts.join(TAG_SEPARATOR) + TAG_SEPARATOR + updatedValue
      setCellValue(sheet, bangumiRow, bangumiColumn, merged)
      enriched.push({
        fieldName,
        bangumiColumn,
        oldValue,
        updatedValue: merged,
        action: 'append',
      })
    }
  } else {
    const merged = oldValue + TAG_SEPARATOR + updatedValue
    setCellValue(sheet, bangumiRow, bangumiColumn, merged)
    enriched.push({
      fieldName,
      bangumiColumn,
      oldValue,
      updatedValue: merged,
      action: 'append',
    })
  }
}

/**
 * 需要标注的字段映射白名单（只有这些映射会添加括号）
 * 格式: "源字段名→目标列名"
 */
const ANNOTATED_FIELD_MAPPINGS = new Set<string>(['编剧→脚本', '人设→人物设定', 'CG导演→演出'])

/**
 * 获取带字段名标注的值
 * 当源字段名与 Bangumi 列名不同时，只有在白名单中的映射才追加 (源字段名) 后缀
 * 空值不添加标注
 */
function getAnnotatedValue(sourceKey: string, targetColName: string, value: string): string {
  if (!value) return value
  if (sourceKey === targetColName) return value
  const mappingKey = `${sourceKey}→${targetColName}`
  if (!ANNOTATED_FIELD_MAPPINGS.has(mappingKey)) return value
  return `${value}(${sourceKey})`
}

/**
 * 检查并添加缺失的列到 Bangumi 追踪表
 *
 * 语义（P2-6）：**全成或全不成**。只有表头写入并读回校验通过，新增列才会进入
 * 返回的映射；失败时返回原映射（不含新列）并向用户提示，由下游按既有回退列处理。
 * 因此调用方拿到的映射里出现的列，一定是本次确实可用的列。
 *
 * @returns 更新后的列映射（失败时为未含新列的入参映射）
 */
export function ensureBangumiColumns(
  sheet: WpsWorksheet,
  colMap: Map<string, number>,
  requiredFields: Record<string, string>,
  headerRow: number,
): Map<string, number> {
  const updatedMap = new Map(colMap)
  let maxCol = 0

  for (const col of updatedMap.values()) {
    if (col > maxCol) maxCol = col
  }

  const missing: { field: string; sourceKey: string }[] = []
  for (const [sourceKey, targetName] of Object.entries(requiredFields)) {
    if (!updatedMap.has(targetName)) {
      missing.push({ field: targetName, sourceKey })
    }
  }

  if (missing.length === 0) return updatedMap

  const firstNewCol = maxCol + 1
  const lastNewCol = maxCol + missing.length
  // 新增列的映射增量：**校验通过后**才合并进 updatedMap（不在 try 内提前 set）。
  // 原实现在 try 内逐个 set 并在 catch 里静默返回，等于把"可能没写成表头"的列
  // 当成已存在 → 下游按映射往空列写值，用户看到表头缺失 + 数据错位（P2-6）。
  const additions: [string, number][] = []

  try {
    // 复制现有表头样式
    const existingStyleCol = maxCol > 0 ? 1 : firstNewCol
    const styleSourceRange = sheet.Range(
      `${WpsCellReference(headerRow, existingStyleCol)}:${WpsCellReference(headerRow, existingStyleCol)}`,
    )
    let templateFont: typeof styleSourceRange.Font | null = null
    let templateInterior: typeof styleSourceRange.Interior | null = null

    try {
      templateFont = styleSourceRange.Font
      templateInterior = styleSourceRange.Interior
    } catch {
      bgmLog(LOG_LEVELS.WARN, '[ensureBangumiColumns] 无法获取样式模板')
    }

    // 创建新列表头
    const headerRange = sheet.Range(
      `${WpsCellReference(headerRow, firstNewCol)}:${WpsCellReference(headerRow, lastNewCol)}`,
    )
    // 单行范围必须写 1×N 数组：Excel/WPS 对二维数组**按数组自身形状**写入（不按
    // 范围尺寸改写形状），N×1 会从起始列竖着写下去，覆盖起始列下方数据行的内容。
    // 既有约定见 sync-record.ts 的表头写入 `headerRange.Value2 = [SYNC_RECORD_COLUMNS]`。
    headerRange.Value = [missing.map((m) => m.field)]

    // 应用样式到新列
    try {
      if (templateFont) {
        const font = headerRange.Font
        if (font) {
          font.Name = templateFont.Name
          font.Size = templateFont.Size
          font.Bold = templateFont.Bold
          font.Color = templateFont.Color
        }
      }
      if (templateInterior) {
        const interior = headerRange.Interior
        if (interior) {
          interior.Color = templateInterior.Color
        }
      }
    } catch {
      bgmLog(LOG_LEVELS.WARN, '[ensureBangumiColumns] 复制样式失败，使用默认样式')
    }

    // 读回校验：COM 的批量赋值可能"部分成功"，读回是判断表头是否真落盘的唯一依据。
    // 读失败（返回空）时**不据此下结论** —— 与 buildCache 同一降级口径：本次不判断，
    // 下次运行时 getBangumiColumnMap 会从表头重新识别。
    const readBack = readRangeValues(sheet, headerRow, headerRow, firstNewCol, lastNewCol)
    const readBackRow = readBack[0]
    if (readBackRow) {
      // 按 missing 逐个比对（而非遍历读回结果）：读回列数不足时同样判为失败
      const hasMismatch = missing.some((m, index) => readBackRow[index]?.trim() !== m.field)
      if (hasMismatch) {
        throw new Error('新列表头写入后读回校验不通过')
      }
    }

    for (const [index, missingField] of missing.entries()) {
      additions.push([missingField.field, firstNewCol + index])
    }
  } catch (error) {
    // 不做部分提交：写入失败的列一律不写进 colMap，下游会按既有回退列处理。
    // 也**不清理**已写下的表头：读回可能因 COM 异常拿到空值，据不可靠信号去清空
    // 会擦掉正确表头（数据丢失代价远高于残留一个空列）。
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[ensureBangumiColumns] 添加列失败: ${errorMessage}`)
    getNotifyApi().toast(`自动添加缺失列失败：${errorMessage}。相关字段将回退到原有列。`, 'error')
    return updatedMap
  }

  for (const [field, col] of additions) {
    updatedMap.set(field, col)
    bgmLog(
      LOG_LEVELS.INFO,
      `[ensureBangumiColumns] 新增列: ${field} → 第 ${String(col)} 列 (样式已跟随现有列)`,
    )
  }

  return updatedMap
}

/**
 * WpsCellRef 辅助函数：生成单元格引用
 */
function WpsCellReference(row: number, col: number): string {
  let colString = ''
  let c = col
  while (c > 0) {
    c -= 1
    colString = String.fromCodePoint(65 + (c % 26)) + colString
    c = Math.floor(c / 26)
  }
  return `${colString}${String(row)}`
}

/**
 * 富化简介数据
 * 精准映射：导演→导演、编剧→脚本、人设→人物设定 等列
 * 字段名差异时追加标注：如 樋口七海(编剧)
 * 无匹配列的字段回退到特点/印象
 * 冲突（两边都有值）时记录到 conflicts 数组，由用户确认
 */
export function enrichIntroData(
  sheet: WpsWorksheet,
  row: number,
  incomingData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
  conflicts: ConflictInfo[],
  animeRow: number,
  matchedAnimeName: string,
): void {
  const bangumiFeatureCol = colMap.get('特点/印象')

  for (const [sourceKey, targetColName] of Object.entries(INTRO_FIELD_TO_BANGUMI)) {
    const rawValue = incomingData[sourceKey] ?? ''
    if (!isEmptyValue(rawValue)) {
      const annotatedValue = getAnnotatedValue(sourceKey, targetColName, rawValue)
      const targetCol = colMap.get(targetColName)
      if (targetCol !== undefined) {
        const oldValue = getCellValue(sheet, row, targetCol)
        if (isEmptyValue(oldValue)) {
          setCellValue(sheet, row, targetCol, annotatedValue)
          enriched.push({
            fieldName: targetColName,
            bangumiColumn: targetCol,
            oldValue: null,
            updatedValue: annotatedValue,
            action: 'fill',
            ...(sourceKey !== targetColName && {
              note: `字段名差异: ${sourceKey} → ${targetColName}`,
            }),
          })
        } else {
          conflicts.push({
            fieldName: targetColName,
            bangumiColumn: targetCol,
            bangumiRow: row,
            oldValue,
            updatedValue: annotatedValue,
            animeRow,
            matchedAnimeName,
            resolution: 'append',
            ...(sourceKey !== targetColName && {
              note: `字段名差异: ${sourceKey} → ${targetColName}`,
            }),
          })
        }
      } else if (bangumiFeatureCol !== undefined) {
        const oldFeature = getCellValue(sheet, row, bangumiFeatureCol)
        const featureEntry = `${sourceKey}:${annotatedValue}`
        if (isEmptyValue(oldFeature)) {
          setCellValue(sheet, row, bangumiFeatureCol, featureEntry)
          enriched.push({
            fieldName: `特点/印象(${sourceKey})`,
            bangumiColumn: bangumiFeatureCol,
            oldValue: null,
            updatedValue: featureEntry,
            action: 'fill',
          })
        } else {
          const merged = appendFeatures(oldFeature, featureEntry)
          if (merged === oldFeature) {
            enriched.push({
              fieldName: `特点/印象(${sourceKey})`,
              bangumiColumn: bangumiFeatureCol,
              oldValue: oldFeature,
              updatedValue: merged,
              action: 'skip',
            })
          } else {
            setCellValue(sheet, row, bangumiFeatureCol, merged)
            enriched.push({
              fieldName: `特点/印象(${sourceKey})`,
              bangumiColumn: bangumiFeatureCol,
              oldValue: oldFeature,
              updatedValue: merged,
              action: 'append',
            })
          }
        }
      }
    }
  }

  if (bangumiFeatureCol !== undefined) {
    const featureParts: string[] = []
    for (const key of INTRO_FEATURE_FIELDS) {
      const value = incomingData[key] ?? ''
      if (!isEmptyValue(value)) {
        const label = key === '简介' ? '简介' : key
        const display = key === '简介' && value.length > 80 ? `${value.substring(0, 80)}...` : value
        featureParts.push(`${label}:${display}`)
      }
    }
    if (featureParts.length > 0) {
      const oldFeature = getCellValue(sheet, row, bangumiFeatureCol)
      const merged = featureParts.join(FEATURE_SEPARATOR)
      if (isEmptyValue(oldFeature)) {
        setCellValue(sheet, row, bangumiFeatureCol, merged)
        enriched.push({
          fieldName: '特点/印象(简介补充)',
          bangumiColumn: bangumiFeatureCol,
          oldValue: null,
          updatedValue: merged,
          action: 'fill',
        })
      } else {
        const combined = appendFeatures(oldFeature, merged)
        if (combined !== oldFeature) {
          setCellValue(sheet, row, bangumiFeatureCol, combined)
          enriched.push({
            fieldName: '特点/印象(简介补充)',
            bangumiColumn: bangumiFeatureCol,
            oldValue: oldFeature,
            updatedValue: combined,
            action: 'append',
          })
        }
      }
    }
  }
}

/**
 * 富化 OP/ED/PV 信息
 * 追加到特点/印象列
 */
export function enrichOpEdPv(
  sheet: WpsWorksheet,
  row: number,
  incomingData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiFeatureCol = colMap.get('特点/印象')
  if (!bangumiFeatureCol) return

  const parts: string[] = []

  const op = incomingData.OP ?? ''
  if (!isEmptyValue(op)) {
    parts.push(`OP:${op}`)
  }

  const ed = incomingData.ED ?? ''
  if (!isEmptyValue(ed)) {
    parts.push(`ED:${ed}`)
  }

  const pv = incomingData.PV ?? ''
  if (!isEmptyValue(pv)) {
    parts.push(`PV:${pv}`)
  }

  if (parts.length === 0) return

  const featureText = parts.join(FEATURE_SEPARATOR)
  const oldFeature = getCellValue(sheet, row, bangumiFeatureCol)

  if (isEmptyValue(oldFeature)) {
    setCellValue(sheet, row, bangumiFeatureCol, featureText)
    enriched.push({
      fieldName: '特点/印象',
      bangumiColumn: bangumiFeatureCol,
      oldValue: null,
      updatedValue: featureText,
      action: 'fill',
    })
  } else {
    const merged = appendFeatures(oldFeature, featureText)
    if (merged === oldFeature) {
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        updatedValue: merged,
        action: 'skip',
      })
    } else {
      setCellValue(sheet, row, bangumiFeatureCol, merged)
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        updatedValue: merged,
        action: 'append',
      })
    }
  }
}

/**
 * 读取简介工作表一行数据
 * 支持简介专有字段：编剧/人设/CG导演/系列构成/分镜/原作/语言/制片国家 等
 */
export function readIntroSheetRow(
  sheet: WpsWorksheet,
  row: number,
  mapping: EnrichColumnMapping,
): Record<string, string> {
  const data: Record<string, string> = { 名称: getCellValue(sheet, row, mapping.nameCol) || '' }
  if (mapping.introCol) data['简介'] = getCellValue(sheet, row, mapping.introCol) || ''
  if (mapping.studioCol) data['动画制作'] = getCellValue(sheet, row, mapping.studioCol) || ''
  if (mapping.directorCol) data['导演'] = getCellValue(sheet, row, mapping.directorCol) || ''
  if (mapping.musicCol) data['音乐'] = getCellValue(sheet, row, mapping.musicCol) || ''
  if (mapping.voiceCol) data['声优'] = getCellValue(sheet, row, mapping.voiceCol) || ''
  if (mapping.opCol) data.OP = getCellValue(sheet, row, mapping.opCol) || ''
  if (mapping.edCol) data.ED = getCellValue(sheet, row, mapping.edCol) || ''
  if (mapping.pvCol) data.PV = getCellValue(sheet, row, mapping.pvCol) || ''
  if (mapping.screenplayCol) data['编剧'] = getCellValue(sheet, row, mapping.screenplayCol) || ''
  if (mapping.characterDesignCol)
    data['人设'] = getCellValue(sheet, row, mapping.characterDesignCol) || ''
  if (mapping.cgDirectorCol) data['CG导演'] = getCellValue(sheet, row, mapping.cgDirectorCol) || ''
  if (mapping.seriesCompositionCol)
    data['系列构成'] = getCellValue(sheet, row, mapping.seriesCompositionCol) || ''
  if (mapping.storyboardCol) data['分镜'] = getCellValue(sheet, row, mapping.storyboardCol) || ''
  if (mapping.originalWorkCol)
    data['原作'] = getCellValue(sheet, row, mapping.originalWorkCol) || ''
  if (mapping.languageCol) data['语言'] = getCellValue(sheet, row, mapping.languageCol) || ''
  if (mapping.productionCountryCol)
    data['制片国家'] = getCellValue(sheet, row, mapping.productionCountryCol) || ''
  if (mapping.typeCol) data['类型'] = getCellValue(sheet, row, mapping.typeCol) || ''
  return data
}

/**
 * 判断是否为简介工作表
 * 基于列名特征判断
 */
export function isIntroSheet(mapping: EnrichColumnMapping): boolean {
  return (
    mapping.introCol !== undefined ||
    mapping.screenplayCol !== undefined ||
    mapping.characterDesignCol !== undefined ||
    mapping.cgDirectorCol !== undefined
  )
}

// ========== 新番简介工作表识别与关联富化 ==========

/** 简介表头关键字：某行命中 ≥2 个即认为该工作表是「新番简介」表 */
const INTRO_SHEET_HEADER_KEYWORDS = [
  '导演',
  '编剧',
  '人设',
  'CG导演',
  '系列构成',
  '分镜',
  '原作',
  '动画制作',
] as const

/** 统计某行命中简介表头关键字的次数 */
function countIntroHeaderHits(sheet: WpsWorksheet, row: number): number {
  let hits = 0
  for (let col = 1; col <= 50; col += 1) {
    const value = getCellValue(sheet, row, col).trim()
    if (value && INTRO_SHEET_HEADER_KEYWORDS.some((keyword) => value.includes(keyword))) {
      hits += 1
    }
  }
  return hits
}

/**
 * 简介工作表上下文：表头行、列映射与按名称的行索引。
 * 简介表与主新番表行号不对应，必须按名称关联。
 */
export interface IntroSheetContext {
  sheet: WpsWorksheet
  headerRow: number
  dataStartRow: number
  mapping: EnrichColumnMapping
  /** normalizeName(名称) → 简介表行号 */
  nameIndex: Map<string, number>
}

/**
 * 在工作簿中查找「新番简介」工作表：
 * 某行命中 ≥2 个简介表头关键字、且不是主新番表布局（无周更时间/播放平台等横向字段）。
 * @param excludeSheetName 排除的工作表名（当前主源表）
 */
export function findIntroSheetInWorkbook(
  wb: WpsWorkbook,
  excludeSheetName?: string,
): WpsWorksheet | null {
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    let ws: WpsWorksheet | null = null
    try {
      ws = wb.Worksheets.Item(index)
    } catch {
      ws = null
    }
    if (ws) {
      const name = (() => {
        try {
          return ws.Name
        } catch {
          return ''
        }
      })()
      // 排除当前主源表与主新番表布局的工作表，其余表头命中简介关键字的才算候选
      if ((!name || name !== excludeSheetName) && !detectAnimeSourceLayout(ws)) {
        for (let row = 1; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
          if (countIntroHeaderHits(ws, row) >= 2) return ws
        }
      }
    }
  }
  return null
}

/** 构建简介工作表上下文（表头识别 + 名称行索引）；非简介表返回 null */
export function buildIntroSheetContext(sheet: WpsWorksheet): IntroSheetContext | null {
  let headerRow = 0
  for (let row = 1; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
    if (countIntroHeaderHits(sheet, row) >= 2) {
      headerRow = row
      break
    }
  }
  if (headerRow === 0) return null

  const mapping = detectColumns(sheet, headerRow)
  if (mapping.nameCol === 0) return null

  const dataStartRow = headerRow + 1
  const lastRow = getLastRow(sheet)
  const nameIndex = new Map<string, number>()
  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const name = getCellValue(sheet, row, mapping.nameCol).trim()
    if (name) nameIndex.set(normalizeName(name), row)
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[buildIntroSheetContext] 简介表识别成功: ${sheet.Name || '未知'} 表头行=${String(headerRow)} 名称索引=${String(nameIndex.size)} 条`,
  )
  return { sheet, headerRow, dataStartRow, mapping, nameIndex }
}

/**
 * 用简介表上下文富化单行：按名称关联简介行，写入导演/编剧/人设等字段。
 * 简介表无该名称时静默跳过。
 */
export function enrichIntroFromContext(
  bangumiSheet: WpsWorksheet,
  bangumiRow: number,
  intro: IntroSheetContext,
  matchedAnimeName: string,
  bangumiColMap: Map<string, number>,
  enriched: EnrichedField[],
  conflicts: ConflictInfo[],
): void {
  const introRow = intro.nameIndex.get(normalizeName(matchedAnimeName))
  if (introRow === undefined) return
  const incomingData = readIntroSheetRow(intro.sheet, introRow, intro.mapping)
  enrichIntroData(
    bangumiSheet,
    bangumiRow,
    incomingData,
    bangumiColMap,
    enriched,
    conflicts,
    introRow,
    matchedAnimeName,
  )
}

/**
 * 富化别名
 * 当新番表名称与 Bangumi 追踪表名称/别名不一致时，
 * 将新番表名称补充到 Bangumi 追踪表的别名列
 */
export function enrichAlias(
  sheet: WpsWorksheet,
  row: number,
  animeName: string,
  bangumiName: string | undefined,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const nameCol = colMap.get('名称')
  if (!nameCol) return

  if (animeName === bangumiName) {
    enriched.push({
      fieldName: '别名',
      bangumiColumn: nameCol,
      oldValue: '',
      updatedValue: animeName,
      action: 'skip',
    })
    return
  }

  const aliasCol = findAliasColumn(sheet)
  if (aliasCol === 0) return

  const existingAliases = getCellValue(sheet, row, aliasCol)
  const aliasList = splitAliases(existingAliases)

  const normalizedNew = normalizeName(animeName)
  const isAlreadyExists = aliasList.some((a) => normalizeName(a) === normalizedNew)

  if (isAlreadyExists) {
    enriched.push({
      fieldName: '别名',
      bangumiColumn: aliasCol,
      oldValue: existingAliases,
      updatedValue: animeName,
      action: 'skip',
    })
    return
  }

  const merged = existingAliases ? existingAliases + TAG_SEPARATOR + animeName : animeName

  setCellValue(sheet, row, aliasCol, merged)
  enriched.push({
    fieldName: '别名',
    bangumiColumn: aliasCol,
    oldValue: existingAliases || null,
    updatedValue: merged,
    action: 'append',
  })
}

// ========== 搜索与查询 ==========

/**
 * 搜索结果条目
 */
export interface SearchResult {
  row: number
  name: string
  fieldMatches: { column: string; value: string }[]
}

/**
 * 在工作表中搜索关键词
 * 支持多字段匹配，返回所有匹配行
 */
export function searchSheet(
  sheet: WpsWorksheet,
  keyword: string,
  colMap: Map<string, number>,
  dataStartRow: number,
): SearchResult[] {
  if (!keyword.trim()) return []

  const results: SearchResult[] = []
  const normalizedKeyword = normalizeName(keyword)
  const nameCol = colMap.get('名称') ?? colMap.get('动漫名称') ?? colMap.get('番组名') ?? 0

  if (nameCol === 0) return results

  const lastRow = getLastRow(sheet)
  if (lastRow < dataStartRow) return results

  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const nameValue = getCellValue(sheet, row, nameCol)
    if (nameValue) {
      const normalizedName = normalizeName(nameValue)
      if (normalizedName.includes(normalizedKeyword)) {
        const fieldMatches: SearchResult['fieldMatches'] = [{ column: '名称', value: nameValue }]

        const aliasCol = colMap.get('别名')
        if (aliasCol) {
          const aliasValue = getCellValue(sheet, row, aliasCol)
          if (aliasValue) {
            const aliases = splitAliases(aliasValue)
            const matchedAliases = aliases.filter((a) =>
              normalizeName(a).includes(normalizedKeyword),
            )
            for (const alias of matchedAliases) {
              fieldMatches.push({ column: '别名', value: alias })
            }
          }
        }

        results.push({ row, name: nameValue, fieldMatches })
      }
    }
  }

  bgmLog(LOG_LEVELS.INFO, `[searchSheet] 搜索 "${keyword}" 找到 ${String(results.length)} 条结果`)
  return results
}
