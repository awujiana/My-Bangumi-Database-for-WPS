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

import { LOG_LEVELS } from '../core/constants.js'
import {
  bgmLog,
  getCellValue,
  setCellValue,
  getLastRow,
  isEmptyValue,
  findHeaderRow,
  getColumnMap,
  BGM,
} from '../tools/util/index.js'
import type { WpsWorksheet } from '../tools/wps.js'

import { addEnrichRecord } from './enrichRecord.js'

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

/** 标签分隔符 */
const TAG_SEPARATOR = ' | '

/** 特点/印象分隔符 */
const FEATURE_SEPARATOR = ' | '

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
  newAnimeRow: number
  newAnimeName: string
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
  newValue: string
  action: 'fill' | 'append' | 'skip'
}

/**
 * 字段冲突信息（需用户确认）
 */
export interface ConflictInfo {
  fieldName: string
  bangumiColumn: number
  bangumiRow: number
  oldValue: string
  newValue: string
  newAnimeRow: number
  newAnimeName: string
  resolution: 'append' | 'keep' | 'overwrite'
  note?: string
}

/**
 * 富化结果条目
 */
export interface EnrichResultItem {
  kind: 'matched' | 'unmatched' | 'error'
  newAnimeRow: number
  name: string
  matchType?: 'exact' | 'alias' | 'unmatched' | 'error'
  enrichedFields: EnrichedField[]
  conflicts?: ConflictInfo[] | undefined
  errorMessage?: string
}

/**
 * 富化进度
 */
export interface EnrichProgress {
  current: number
  total: number
  currentName: string
  stats: {
    matched: number
    enriched: number
    skipped: number
    failed: number
  }
  etaMs: number
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: EnrichProgress) => void

// ========== 辅助函数 ==========

/**
 * 规范化名称
 * 去空格、转小写、全角转半角
 */
export function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[！-～]/g, (char) => {
      const code = char.charCodeAt(0)
      return String.fromCharCode(code - 0xfee0)
    })
}

/**
 * 分割别名字符串
 * 按 |、/、;、， 等分隔符分割
 */
export function splitAliases(aliasesString: string): string[] {
  if (!aliasesString) return []
  return aliasesString
    .split(/\s*\|\s*|\s*[;，、]\s*|\s*\/\s*/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
}

/**
 * 分割标签字符串
 * 按 TAG_SEPARATOR 或常见分隔符分割
 */
export function splitTags(tags: string): string[] {
  if (!tags) return []
  return tags
    .split(/\s*\|\s*|\s*[,、;]\s*|\s*\/\s*/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/**
 * 合并标签去重
 * 现有标签 + 新标签，去重后以 TAG_SEPARATOR 连接
 */
export function mergeTags(oldTags: string, newTags: string): string {
  const oldList = splitTags(oldTags)
  const newList = splitTags(newTags)
  const merged = [...oldList]
  for (const tag of newList) {
    if (!merged.includes(tag)) {
      merged.push(tag)
    }
  }
  return merged.join(TAG_SEPARATOR)
}

/**
 * 追加特点信息去重
 * 将新特点追加到旧特点后，以 FEATURE_SEPARATOR 分隔
 */
export function appendFeatures(oldFeature: string, newFeatures: string): string {
  if (!oldFeature) return newFeatures
  if (!newFeatures) return oldFeature
  const oldList = oldFeature
    .split(FEATURE_SEPARATOR)
    .map((f) => f.trim())
    .filter(Boolean)
  const newList = newFeatures
    .split(FEATURE_SEPARATOR)
    .map((f) => f.trim())
    .filter(Boolean)
  const merged = [...oldList]
  for (const feat of newList) {
    if (!merged.includes(feat)) {
      merged.push(feat)
    }
  }
  return merged.join(FEATURE_SEPARATOR)
}

// ========== 核心函数 ==========

/**
 * 检测新番表的列映射
 * 读取表头行，用 KNOWN_COLUMN_MAP 匹配列名
 */
export function detectColumns(sheet: WpsWorksheet, headerRow: number): EnrichColumnMapping {
  const mapping: EnrichColumnMapping = { nameCol: 0 }

  const maxCols = 50
  for (let col = 1; col <= maxCols; col += 1) {
    const headerValue = getCellValue(sheet, headerRow, col).trim()
    if (!headerValue) continue

    const normalizedHeader = headerValue.toLowerCase()
    for (const [keyword, field] of Object.entries(KNOWN_COLUMN_MAP)) {
      if (normalizedHeader.includes(keyword.toLowerCase())) {
        if (field === 'nameCol' && mapping.nameCol === 0) {
          mapping.nameCol = col
        } else if (field !== 'nameCol' && mapping[field] === undefined) {
          mapping[field] = col
        }
        break
      }
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[detectColumns] 列映射: name=${String(mapping.nameCol)}, tags=${String(mapping.tagsCol ?? 'N/A')}, ` +
      `premiere=${String(mapping.premiereCol ?? 'N/A')}, episodes=${String(mapping.episodesCol ?? 'N/A')}, ` +
      `weekday=${String(mapping.weekdayCol ?? 'N/A')}, platform=${String(mapping.platformCol ?? 'N/A')}, ` +
      `exclusive=${String(mapping.exclusiveCol ?? 'N/A')}, special=${String(mapping.specialCol ?? 'N/A')}`,
  )

  return mapping
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
  const data: Record<string, string> = {}
  data['名称'] = getCellValue(sheet, row, mapping.nameCol) || ''
  if (mapping.tagsCol) data.TAGS = getCellValue(sheet, row, mapping.tagsCol) || ''
  if (mapping.premiereCol) data['首播'] = getCellValue(sheet, row, mapping.premiereCol) || ''
  if (mapping.episodesCol) data['集数'] = getCellValue(sheet, row, mapping.episodesCol) || ''
  if (mapping.weekdayCol) data['周更时间'] = getCellValue(sheet, row, mapping.weekdayCol) || ''
  if (mapping.platformCol) data['播放平台'] = getCellValue(sheet, row, mapping.platformCol) || ''
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

  const nameCol = columnMap.get('名称') || 0
  if (nameCol === 0) {
    bgmLog(LOG_LEVELS.WARN, '[buildBangumiIndexes] Bangumi表中未找到名称列')
    return [nameIndex, aliasIndex, rowNames]
  }

  const aliasCol = findAliasColumn(bangumiSheet)
  const lastRow = getLastRow(bangumiSheet)

  for (let row = 2; row <= lastRow; row += 1) {
    const name = getCellValue(bangumiSheet, row, nameCol).trim()
    if (!name) continue

    const normalizedName = normalizeName(name)
    nameIndex.set(normalizedName, row)
    rowNames.set(row, name)

    if (aliasCol > 0) {
      const aliasString = getCellValue(bangumiSheet, row, aliasCol).trim()
      if (aliasString) {
        const aliases = splitAliases(aliasString)
        for (const alias of aliases) {
          const normalizedAlias = normalizeName(alias)
          if (!aliasIndex.has(normalizedAlias)) {
            aliasIndex.set(normalizedAlias, [])
          }
          const rows = aliasIndex.get(normalizedAlias)
          if (rows) {
            if (!rows.includes(row)) {
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
 * 匹配新番表与 Bangumi 追踪表条目
 */
export function matchEntries(
  newAnimeSheet: WpsWorksheet,
  bangumiSheet: WpsWorksheet,
  config: EnrichConfig,
): MatchResult[] {
  const results: MatchResult[] = []

  try {
    const bangumiColMap = getBangumiColumnMap(bangumiSheet)
    const [nameIndex, aliasIndex, rowNames] = buildBangumiIndexes(bangumiSheet, bangumiColMap)

    const lastRow = getLastRow(newAnimeSheet)
    const { dataStartRow } = config

    const { nameCol } = config.columnMapping
    if (nameCol === 0) {
      bgmLog(LOG_LEVELS.ERROR, '[matchEntries] 新番表未找到名称列，无法匹配')
      return results
    }

    for (let row = dataStartRow; row <= lastRow; row += 1) {
      const rawName = getCellValue(newAnimeSheet, row, nameCol).trim()
      if (!rawName) continue

      const normalizedName = normalizeName(rawName)
      let matchResult: MatchResult = {
        newAnimeRow: row,
        newAnimeName: rawName,
        matchType: 'unmatched',
      }

      try {
        // 精确匹配
        if (nameIndex.has(normalizedName)) {
          const bangumiRow = nameIndex.get(normalizedName)
          if (bangumiRow !== undefined) {
            const matchedName = rowNames.get(bangumiRow)
            matchResult = {
              newAnimeRow: row,
              newAnimeName: rawName,
              matchType: 'exact',
              bangumiRow,
              ...(matchedName !== undefined ? { bangumiName: matchedName } : {}),
            }
          }
        }

        // 别名匹配
        if (matchResult.matchType === 'unmatched') {
          const aliasRows = aliasIndex.get(normalizedName)
          if (aliasRows && aliasRows.length > 0) {
            const bangumiRow = aliasRows[0]
            if (bangumiRow === undefined) continue
            const aliases: string[] = []
            for (const [alias, rows] of aliasIndex) {
              if (rows.includes(bangumiRow)) {
                aliases.push(alias)
              }
            }
            const matchedName = rowNames.get(bangumiRow)
            matchResult = {
              newAnimeRow: row,
              newAnimeName: rawName,
              matchType: 'alias',
              bangumiRow,
              ...(matchedName !== undefined ? { bangumiName: matchedName } : {}),
              aliases,
            }
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        matchResult = {
          newAnimeRow: row,
          newAnimeName: rawName,
          matchType: 'error',
          errorMessage,
        }
        bgmLog(LOG_LEVELS.ERROR, `[matchEntries] 匹配 "${rawName}" 时出错: ${errorMessage}`)
      }

      results.push(matchResult)
    }

    const unmatchedCount = results.filter((r) => r.matchType === 'unmatched').length
    const errorCount = results.filter((r) => r.matchType === 'error').length
    bgmLog(
      LOG_LEVELS.INFO,
      `[matchEntries] 匹配完成：精确 ${String(results.filter((r) => r.matchType === 'exact').length)} 条, ` +
        `别名 ${String(results.filter((r) => r.matchType === 'alias').length)} 条, ` +
        `未匹配 ${String(unmatchedCount)} 条, 错误 ${String(errorCount)} 条, 共 ${String(results.length)} 条`,
    )
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'matchEntries', showAlert: false })
  }

  return results
}

/**
 * 富化标签
 * 追加模式（现有 + TAG_SEPARATOR + 新标签，去重），空值时填充
 */
export function enrichTags(
  sheet: WpsWorksheet,
  row: number,
  newData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiTagsCol = colMap.get('标签/分级') || colMap.get('标签')
  if (!bangumiTagsCol) return

  const newTags = newData.TAGS ?? ''
  if (isEmptyValue(newTags)) return

  const oldTags = getCellValue(sheet, row, bangumiTagsCol)
  if (isEmptyValue(oldTags)) {
    setCellValue(sheet, row, bangumiTagsCol, newTags)
    enriched.push({
      fieldName: '标签/分级',
      bangumiColumn: bangumiTagsCol,
      oldValue: null,
      newValue: newTags,
      action: 'fill',
    })
  } else {
    const merged = mergeTags(oldTags, newTags)
    if (merged !== oldTags) {
      setCellValue(sheet, row, bangumiTagsCol, merged)
      enriched.push({
        fieldName: '标签/分级',
        bangumiColumn: bangumiTagsCol,
        oldValue: oldTags,
        newValue: merged,
        action: 'append',
      })
    } else {
      enriched.push({
        fieldName: '标签/分级',
        bangumiColumn: bangumiTagsCol,
        oldValue: oldTags,
        newValue: merged,
        action: 'skip',
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
  newData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiDateCol = colMap.get('开播日期')
  if (!bangumiDateCol) return

  const newDate = newData['首播'] ?? ''
  if (isEmptyValue(newDate)) return

  const oldDate = getCellValue(sheet, row, bangumiDateCol)
  if (isEmptyValue(oldDate)) {
    setCellValue(sheet, row, bangumiDateCol, newDate)
    enriched.push({
      fieldName: '开播日期',
      bangumiColumn: bangumiDateCol,
      oldValue: null,
      newValue: newDate,
      action: 'fill',
    })
  } else {
    enriched.push({
      fieldName: '开播日期',
      bangumiColumn: bangumiDateCol,
      oldValue: oldDate,
      newValue: newDate,
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
  newData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiEpisodesCol = colMap.get('集数')
  if (!bangumiEpisodesCol) return

  const newEpisodes = newData['集数'] ?? ''
  if (isEmptyValue(newEpisodes)) return

  const oldEpisodes = getCellValue(sheet, row, bangumiEpisodesCol)
  if (isEmptyValue(oldEpisodes)) {
    setCellValue(sheet, row, bangumiEpisodesCol, newEpisodes)
    enriched.push({
      fieldName: '集数',
      bangumiColumn: bangumiEpisodesCol,
      oldValue: null,
      newValue: newEpisodes,
      action: 'fill',
    })
  } else {
    enriched.push({
      fieldName: '集数',
      bangumiColumn: bangumiEpisodesCol,
      oldValue: oldEpisodes,
      newValue: newEpisodes,
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
  newData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiFeatureCol = colMap.get('特点/印象')
  if (!bangumiFeatureCol) return

  const featureParts: string[] = []

  const weekday = newData['周更时间'] ?? ''
  if (!isEmptyValue(weekday)) {
    featureParts.push(`周更:${weekday}`)
  }

  const platform = newData['播放平台'] ?? ''
  if (!isEmptyValue(platform)) {
    featureParts.push(`平台:${platform}`)
  }

  const exclusive = newData['独播'] ?? ''
  if (!isEmptyValue(exclusive)) {
    featureParts.push(`独播:${exclusive}`)
  }

  const special = newData['特殊'] ?? ''
  if (!isEmptyValue(special)) {
    featureParts.push(`特殊:${special}`)
  }

  if (featureParts.length === 0) return

  const newFeatures = featureParts.join(FEATURE_SEPARATOR)
  const oldFeature = getCellValue(sheet, row, bangumiFeatureCol)

  if (isEmptyValue(oldFeature)) {
    setCellValue(sheet, row, bangumiFeatureCol, newFeatures)
    enriched.push({
      fieldName: '特点/印象',
      bangumiColumn: bangumiFeatureCol,
      oldValue: null,
      newValue: newFeatures,
      action: 'fill',
    })
  } else {
    const merged = appendFeatures(oldFeature, newFeatures)
    if (merged !== oldFeature) {
      setCellValue(sheet, row, bangumiFeatureCol, merged)
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        newValue: merged,
        action: 'append',
      })
    } else {
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        newValue: merged,
        action: 'skip',
      })
    }
  }
}

/**
 * 执行富化操作
 * 对每个匹配结果执行富化，写入富化记录，调用进度回调
 */
export function enrichEntries(
  newAnimeSheet: WpsWorksheet,
  bangumiSheet: WpsWorksheet,
  matches: MatchResult[],
  config: EnrichConfig,
  progressCallback?: ProgressCallback,
): EnrichResultItem[] {
  const results: EnrichResultItem[] = []
  const stats = { matched: 0, enriched: 0, skipped: 0, failed: 0 }
  const total = matches.length
  const startTime = Date.now()

  if (total === 0) {
    bgmLog(LOG_LEVELS.INFO, '[enrichEntries] 无匹配结果，跳过富化')
    return results
  }

  let bangumiColMap = getBangumiColumnMap(bangumiSheet)

  if (isIntroSheet(config.columnMapping)) {
    bangumiColMap = ensureBangumiColumns(
      bangumiSheet,
      bangumiColMap,
      INTRO_FIELD_TO_BANGUMI,
      config.headerRow,
    )
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    if (!match) continue
    const current = index + 1

    if (match.matchType === 'unmatched') {
      results.push({
        kind: 'unmatched',
        newAnimeRow: match.newAnimeRow,
        name: match.newAnimeName,
        matchType: 'unmatched',
        enrichedFields: [],
      })
      stats.skipped++
      continue
    }

    if (match.matchType === 'error') {
      results.push({
        kind: 'error',
        newAnimeRow: match.newAnimeRow,
        name: match.newAnimeName,
        matchType: 'error',
        enrichedFields: [],
        ...(match.errorMessage !== undefined ? { errorMessage: match.errorMessage } : {}),
      })
      stats.failed++
      continue
    }

    const { bangumiRow } = match
    if (bangumiRow === undefined) {
      results.push({
        kind: 'error',
        newAnimeRow: match.newAnimeRow,
        name: match.newAnimeName,
        matchType: 'error',
        enrichedFields: [],
        errorMessage: '匹配行号缺失',
      })
      stats.failed++
      continue
    }

    stats.matched++

    const isIntro = isIntroSheet(config.columnMapping)
    const newData = isIntro
      ? readIntroSheetRow(newAnimeSheet, match.newAnimeRow, config.columnMapping)
      : readNewAnimeRow(newAnimeSheet, match.newAnimeRow, config.columnMapping)
    const enrichedFields: EnrichedField[] = []
    const fieldConflicts: ConflictInfo[] = []

    try {
      if (isIntro) {
        enrichIntroData(
          bangumiSheet,
          bangumiRow,
          newData,
          bangumiColMap,
          enrichedFields,
          fieldConflicts,
          match.newAnimeRow,
          match.newAnimeName,
        )
        enrichOpEdPv(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
      } else {
        enrichTags(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
        enrichDate(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
        enrichEpisodes(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
        enrichFeatures(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
      }

      // 别名富化：新番表名称与 Bangumi 追踪表不一致时补全
      enrichAlias(
        bangumiSheet,
        bangumiRow,
        match.newAnimeName,
        match.bangumiName,
        bangumiColMap,
        enrichedFields,
      )

      const hasEnrichment = enrichedFields.some((f) => f.action !== 'skip')
      if (hasEnrichment) {
        stats.enriched++
      } else {
        stats.skipped++
      }

      for (const field of enrichedFields) {
        const record: AddEnrichRecordParameters = {
          timestamp: new Date().toISOString(),
          matchType: match.matchType === 'exact' ? '精确' : '别名',
          name: match.newAnimeName,
          row: bangumiRow,
          enrichedField: field.fieldName,
          oldValue: field.oldValue ?? '',
          newValue: field.newValue,
          action: field.action,
          ...(field.action === 'skip' ? { note: '已有值，跳过' } : {}),
        }
        addEnrichRecord(record)
      }

      results.push({
        kind: 'matched',
        newAnimeRow: match.newAnimeRow,
        name: match.newAnimeName,
        matchType: match.matchType,
        enrichedFields,
        conflicts: fieldConflicts.length > 0 ? fieldConflicts : undefined,
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      stats.failed++
      bgmLog(
        LOG_LEVELS.ERROR,
        `[enrichEntries] 富化 "${match.newAnimeName}" (行${String(bangumiRow)}) 失败: ${errorMessage}`,
      )
      results.push({
        kind: 'error',
        newAnimeRow: match.newAnimeRow,
        name: match.newAnimeName,
        matchType: match.matchType,
        enrichedFields: [],
        errorMessage,
      })
    }

    if (progressCallback) {
      const elapsed = Date.now() - startTime
      const etaMs = total > 0 ? Math.round((elapsed / current) * (total - current)) : 0
      progressCallback({
        current,
        total,
        currentName: match.newAnimeName,
        stats: { ...stats },
        etaMs,
      })
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrichEntries] 富化完成：匹配 ${String(stats.matched)}, 富化 ${String(stats.enriched)}, ` +
      `跳过 ${String(stats.skipped)}, 失败 ${String(stats.failed)}, 耗时 ${String(Date.now() - startTime)}ms`,
  )

  return results
}

// ========== 导出类型 ==========

export type { EnrichRecord } from './enrichRecord.js'

/**
 * 富化记录参数（内部使用）
 */
interface AddEnrichRecordParameters {
  timestamp: string
  matchType: '精确' | '别名' | '未匹配'
  name: string
  row: number
  enrichedField: string
  oldValue: string
  newValue: string
  action: 'fill' | 'append' | 'skip' | 'error'
  note?: string
}

// ========== 简介工作表富化函数 ==========

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
  const { fieldName, bangumiColumn, bangumiRow, oldValue, newValue, resolution } = conflict

  if (resolution === 'keep') {
    enriched.push({
      fieldName,
      bangumiColumn,
      oldValue,
      newValue,
      action: 'skip',
    })
    return
  }

  if (resolution === 'overwrite') {
    setCellValue(sheet, bangumiRow, bangumiColumn, newValue)
    enriched.push({
      fieldName,
      bangumiColumn,
      oldValue,
      newValue,
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
    if (!parts.includes(newValue)) {
      const merged = parts.join(TAG_SEPARATOR) + TAG_SEPARATOR + newValue
      setCellValue(sheet, bangumiRow, bangumiColumn, merged)
      enriched.push({
        fieldName,
        bangumiColumn,
        oldValue,
        newValue: merged,
        action: 'append',
      })
    } else {
      enriched.push({
        fieldName,
        bangumiColumn,
        oldValue,
        newValue,
        action: 'skip',
      })
    }
  } else {
    const merged = oldValue + TAG_SEPARATOR + newValue
    setCellValue(sheet, bangumiRow, bangumiColumn, merged)
    enriched.push({
      fieldName,
      bangumiColumn,
      oldValue,
      newValue: merged,
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
 * 返回更新后的列映射
 */
export function ensureBangumiColumns(
  sheet: WpsWorksheet,
  colMap: Map<string, number>,
  requiredFields: Record<string, string>,
  headerRow: number,
): Map<string, number> {
  const updatedMap = new Map(colMap)
  let maxCol = 0

  for (const col of Array.from(updatedMap.values())) {
    if (col > maxCol) maxCol = col
  }

  const missing: { field: string; sourceKey: string }[] = []
  for (const [sourceKey, targetName] of Object.entries(requiredFields)) {
    if (!updatedMap.has(targetName)) {
      missing.push({ field: targetName, sourceKey })
    }
  }

  if (missing.length === 0) return updatedMap

  try {
    // 复制现有表头样式
    const existingStyleCol = maxCol > 0 ? 1 : maxCol + 1
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
      `${WpsCellReference(headerRow, maxCol + 1)}:${WpsCellReference(headerRow, maxCol + missing.length)}`,
    )
    const headers: string[][] = Array.from(missing, (m) => [m.field])
    headerRange.Value = headers

    // 应用样式到新列
    try {
      if (templateFont) {
        const newFont = headerRange.Font
        if (newFont) {
          newFont.Name = templateFont.Name
          newFont.Size = templateFont.Size
          newFont.Bold = templateFont.Bold
          newFont.Color = templateFont.Color
        }
      }
      if (templateInterior) {
        const newInterior = headerRange.Interior
        if (newInterior) {
          newInterior.Color = templateInterior.Color
        }
      }
    } catch {
      bgmLog(LOG_LEVELS.WARN, '[ensureBangumiColumns] 复制样式失败，使用默认样式')
    }

    for (let index = 0; index < missing.length; index += 1) {
      const newCol = maxCol + 1 + index
      const field = missing[index]?.field
      if (field) {
        updatedMap.set(field, newCol)
        bgmLog(
          LOG_LEVELS.INFO,
          `[ensureBangumiColumns] 新增列: ${field} → 第 ${String(newCol)} 列 (样式已跟随现有列)`,
        )
      }
    }
  } catch (error) {
    bgmLog(
      LOG_LEVELS.ERROR,
      `[ensureBangumiColumns] 添加列失败: ${error instanceof Error ? error.message : String(error)}`,
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
    c--
    colString = String.fromCharCode(65 + (c % 26)) + colString
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
  newData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
  conflicts: ConflictInfo[],
  newAnimeRow: number,
  newAnimeName: string,
): void {
  const bangumiFeatureCol = colMap.get('特点/印象')

  for (const [sourceKey, targetColName] of Object.entries(INTRO_FIELD_TO_BANGUMI)) {
    const rawValue = newData[sourceKey] ?? ''
    if (isEmptyValue(rawValue)) continue

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
          newValue: annotatedValue,
          action: 'fill',
          ...(sourceKey !== targetColName
            ? { note: `字段名差异: ${sourceKey} → ${targetColName}` }
            : {}),
        })
      } else {
        conflicts.push({
          fieldName: targetColName,
          bangumiColumn: targetCol,
          bangumiRow: row,
          oldValue,
          newValue: annotatedValue,
          newAnimeRow,
          newAnimeName,
          resolution: 'append',
          ...(sourceKey !== targetColName
            ? { note: `字段名差异: ${sourceKey} → ${targetColName}` }
            : {}),
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
          newValue: featureEntry,
          action: 'fill',
        })
      } else {
        const merged = appendFeatures(oldFeature, featureEntry)
        if (merged !== oldFeature) {
          setCellValue(sheet, row, bangumiFeatureCol, merged)
          enriched.push({
            fieldName: `特点/印象(${sourceKey})`,
            bangumiColumn: bangumiFeatureCol,
            oldValue: oldFeature,
            newValue: merged,
            action: 'append',
          })
        } else {
          enriched.push({
            fieldName: `特点/印象(${sourceKey})`,
            bangumiColumn: bangumiFeatureCol,
            oldValue: oldFeature,
            newValue: merged,
            action: 'skip',
          })
        }
      }
    }
  }

  if (bangumiFeatureCol !== undefined) {
    const featureParts: string[] = []
    for (const key of INTRO_FEATURE_FIELDS) {
      const value = newData[key] ?? ''
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
          newValue: merged,
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
            newValue: combined,
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
  newData: Record<string, string>,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const bangumiFeatureCol = colMap.get('特点/印象')
  if (!bangumiFeatureCol) return

  const parts: string[] = []

  const op = newData.OP ?? ''
  if (!isEmptyValue(op)) {
    parts.push(`OP:${op}`)
  }

  const ed = newData.ED ?? ''
  if (!isEmptyValue(ed)) {
    parts.push(`ED:${ed}`)
  }

  const pv = newData.PV ?? ''
  if (!isEmptyValue(pv)) {
    parts.push(`PV:${pv}`)
  }

  if (parts.length === 0) return

  const newFeatureText = parts.join(FEATURE_SEPARATOR)
  const oldFeature = getCellValue(sheet, row, bangumiFeatureCol)

  if (isEmptyValue(oldFeature)) {
    setCellValue(sheet, row, bangumiFeatureCol, newFeatureText)
    enriched.push({
      fieldName: '特点/印象',
      bangumiColumn: bangumiFeatureCol,
      oldValue: null,
      newValue: newFeatureText,
      action: 'fill',
    })
  } else {
    const merged = appendFeatures(oldFeature, newFeatureText)
    if (merged !== oldFeature) {
      setCellValue(sheet, row, bangumiFeatureCol, merged)
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        newValue: merged,
        action: 'append',
      })
    } else {
      enriched.push({
        fieldName: '特点/印象',
        bangumiColumn: bangumiFeatureCol,
        oldValue: oldFeature,
        newValue: merged,
        action: 'skip',
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
  const data: Record<string, string> = {}
  data['名称'] = getCellValue(sheet, row, mapping.nameCol) || ''
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

/**
 * 富化别名
 * 当新番表名称与 Bangumi 追踪表名称/别名不一致时，
 * 将新番表名称补充到 Bangumi 追踪表的别名列
 */
export function enrichAlias(
  sheet: WpsWorksheet,
  row: number,
  newAnimeName: string,
  bangumiName: string | undefined,
  colMap: Map<string, number>,
  enriched: EnrichedField[],
): void {
  const nameCol = colMap.get('名称')
  if (!nameCol) return

  if (newAnimeName === bangumiName) {
    enriched.push({
      fieldName: '别名',
      bangumiColumn: nameCol,
      oldValue: '',
      newValue: newAnimeName,
      action: 'skip',
    })
    return
  }

  const aliasCol = findAliasColumn(sheet)
  if (aliasCol === 0) return

  const existingAliases = getCellValue(sheet, row, aliasCol)
  const aliasList = splitAliases(existingAliases)

  const normalizedNew = normalizeName(newAnimeName)
  const isAlreadyExists = aliasList.some((a) => normalizeName(a) === normalizedNew)

  if (isAlreadyExists) {
    enriched.push({
      fieldName: '别名',
      bangumiColumn: aliasCol,
      oldValue: existingAliases,
      newValue: newAnimeName,
      action: 'skip',
    })
    return
  }

  const merged = existingAliases ? existingAliases + TAG_SEPARATOR + newAnimeName : newAnimeName

  setCellValue(sheet, row, aliasCol, merged)
  enriched.push({
    fieldName: '别名',
    bangumiColumn: aliasCol,
    oldValue: existingAliases || null,
    newValue: merged,
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
  const nameCol = colMap.get('名称') || colMap.get('动漫名称') || colMap.get('番组名') || 0

  if (nameCol === 0) return results

  const lastRow = getLastRow(sheet)
  if (lastRow < dataStartRow) return results

  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const nameValue = getCellValue(sheet, row, nameCol)
    if (!nameValue) continue

    const normalizedName = normalizeName(nameValue)
    if (normalizedName.includes(normalizedKeyword)) {
      const fieldMatches: SearchResult['fieldMatches'] = [{ column: '名称', value: nameValue }]

      const aliasCol = colMap.get('别名')
      if (aliasCol) {
        const aliasValue = getCellValue(sheet, row, aliasCol)
        if (aliasValue) {
          const aliases = splitAliases(aliasValue)
          const matchedAliases = aliases.filter((a) => normalizeName(a).includes(normalizedKeyword))
          for (const alias of matchedAliases) {
            fieldMatches.push({ column: '别名', value: alias })
          }
        }
      }

      results.push({ row, name: nameValue, fieldMatches })
    }
  }

  bgmLog(LOG_LEVELS.INFO, `[searchSheet] 搜索 "${keyword}" 找到 ${String(results.length)} 条结果`)
  return results
}

// ========== 远程仓库下载 ==========

/**
 * 远程仓库配置
 */
export interface RemoteRepoConfig {
  url: string
  branch: string
  filePath: string
  localPath: string
}

/**
 * 从远程仓库获取文件内容（以 base64 方式）
 * 绕过中间列影响，直接下载原始数据
 */
export async function fetchRemoteFile(config: RemoteRepoConfig): Promise<string | null> {
  try {
    const { url, branch, filePath } = config
    const rawUrl = `${url}/raw/${branch}/${filePath}`

    bgmLog(LOG_LEVELS.INFO, `[fetchRemoteFile] 正在获取: ${rawUrl}`)

    const response = await fetch(rawUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`)
    }

    const content = await response.text()
    bgmLog(LOG_LEVELS.INFO, `[fetchRemoteFile] 下载成功: ${String(content.length)} 字节`)
    return content
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[fetchRemoteFile] 下载失败: ${errorMessage}`)
    return null
  }
}

/**
 * 解析远程文件内容为 Excel 可导入格式
 * 支持 CSV/TSV 纯文本格式，不受中间列干扰
 */
export function parseRemoteContent(content: string): Record<string, string>[] {
  const records: Record<string, string>[] = []
  if (!content) return records
  const lines = content.split(/\r?\n/).filter((line) => line.trim())

  if (lines.length === 0) return records

  const firstLine = lines[0]
  if (firstLine === undefined) return records

  const delimiter = firstLine.includes('\t') ? '\t' : ','
  const headers = firstLine.split(delimiter).map((h) => h.trim())

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    const values = line.split(delimiter)
    const record: Record<string, string> = {}
    for (let index = 0; index < headers.length; index += 1) {
      const key = headers[index]
      const value = values[index]
      if (key !== undefined) {
        record[key] = value !== undefined ? value : ''
      }
    }
    records.push(record)
  }

  bgmLog(LOG_LEVELS.INFO, `[parseRemoteContent] 解析 ${String(records.length)} 条记录`)
  return records
}

/**
 * 将远程获取的数据写入工作表
 * 支持指定列映射，避免中间列影响
 */
export function writeRemoteDataToSheet(
  sheet: WpsWorksheet,
  data: Record<string, string>[],
  colMap: Map<string, number>,
  startRow: number,
): number {
  let row = startRow
  let written = 0

  for (const record of data) {
    for (const [field, value] of Object.entries(record)) {
      const col = colMap.get(field)
      if (col !== undefined && value) {
        setCellValue(sheet, row, col, value)
      }
    }
    row++
    written++
  }

  bgmLog(LOG_LEVELS.INFO, `[writeRemoteDataToSheet] 写入 ${String(written)} 行数据`)
  return written
}
