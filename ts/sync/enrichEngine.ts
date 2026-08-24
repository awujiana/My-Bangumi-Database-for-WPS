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
}

/** 标签分隔符 */
const TAG_SEPARATOR = ' / '

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
 * 富化结果条目
 */
export interface EnrichResultItem {
  kind: 'matched' | 'unmatched' | 'error'
  newAnimeRow: number
  name: string
  matchType?: 'exact' | 'alias' | 'unmatched' | 'error'
  enrichedFields: EnrichedField[]
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
export function splitAliases(aliasesStr: string): string[] {
  if (!aliasesStr) return []
  return aliasesStr
    .split(/[|/;，、]/)
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
    .split(/\s*[/,、|;]\s*|\s*TAG_SEPARATOR\s*/)
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
  for (let col = 1; col <= maxCols; col++) {
    const headerVal = getCellValue(sheet, headerRow, col).trim()
    if (!headerVal) continue

    const normalizedHeader = headerVal.toLowerCase()
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
    `[detectColumns] 列映射: name=${mapping.nameCol}, tags=${mapping.tagsCol ?? 'N/A'}, ` +
      `premiere=${mapping.premiereCol ?? 'N/A'}, episodes=${mapping.episodesCol ?? 'N/A'}, ` +
      `weekday=${mapping.weekdayCol ?? 'N/A'}, platform=${mapping.platformCol ?? 'N/A'}, ` +
      `exclusive=${mapping.exclusiveCol ?? 'N/A'}, special=${mapping.specialCol ?? 'N/A'}`,
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
  for (let col = 1; col <= maxCols; col++) {
    const headerVal = getCellValue(sheet, headerRow, col).trim().toLowerCase()
    if (headerVal.includes('别名') || headerVal.includes('alias') || headerVal.includes('原名')) {
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
  if (mapping.tagsCol) data['TAGS'] = getCellValue(sheet, row, mapping.tagsCol) || ''
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

  for (let row = 2; row <= lastRow; row++) {
    const name = getCellValue(bangumiSheet, row, nameCol).trim()
    if (!name) continue

    const normalizedName = normalizeName(name)
    nameIndex.set(normalizedName, row)
    rowNames.set(row, name)

    if (aliasCol > 0) {
      const aliasStr = getCellValue(bangumiSheet, row, aliasCol).trim()
      if (aliasStr) {
        const aliases = splitAliases(aliasStr)
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
    `[buildBangumiIndexes] 名称索引: ${nameIndex.size} 条, 别名索引: ${aliasIndex.size} 条`,
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
    const dataStartRow = config.dataStartRow

    const nameCol = config.columnMapping.nameCol
    if (nameCol === 0) {
      bgmLog(LOG_LEVELS.ERROR, '[matchEntries] 新番表未找到名称列，无法匹配')
      return results
    }

    for (let row = dataStartRow; row <= lastRow; row++) {
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
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e)
        matchResult = {
          newAnimeRow: row,
          newAnimeName: rawName,
          matchType: 'error',
          errorMessage: errMsg,
        }
        bgmLog(LOG_LEVELS.ERROR, `[matchEntries] 匹配 "${rawName}" 时出错: ${errMsg}`)
      }

      results.push(matchResult)
    }

    const unmatchedCount = results.filter((r) => r.matchType === 'unmatched').length
    const errorCount = results.filter((r) => r.matchType === 'error').length
    bgmLog(
      LOG_LEVELS.INFO,
      `[matchEntries] 匹配完成：精确 ${results.filter((r) => r.matchType === 'exact').length} 条, ` +
        `别名 ${results.filter((r) => r.matchType === 'alias').length} 条, ` +
        `未匹配 ${unmatchedCount} 条, 错误 ${errorCount} 条, 共 ${results.length} 条`,
    )
  } catch (e: unknown) {
    BGM.handleError(e, { context: 'matchEntries', showAlert: false })
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

  const newTags = newData['TAGS'] || ''
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

  const newDate = newData['首播'] || ''
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

  const newEpisodes = newData['集数'] || ''
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

  const weekday = newData['周更时间'] || ''
  if (!isEmptyValue(weekday)) {
    featureParts.push(`周更:${weekday}`)
  }

  const platform = newData['播放平台'] || ''
  if (!isEmptyValue(platform)) {
    featureParts.push(`平台:${platform}`)
  }

  const exclusive = newData['独播'] || ''
  if (!isEmptyValue(exclusive)) {
    featureParts.push(`独播:${exclusive}`)
  }

  const special = newData['特殊'] || ''
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

  const bangumiColMap = getBangumiColumnMap(bangumiSheet)

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (!match) continue
    const current = i + 1

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

    const bangumiRow = match.bangumiRow
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

    const newData = readNewAnimeRow(newAnimeSheet, match.newAnimeRow, config.columnMapping)
    const enrichedFields: EnrichedField[] = []

    try {
      enrichTags(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
      enrichDate(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
      enrichEpisodes(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)
      enrichFeatures(bangumiSheet, bangumiRow, newData, bangumiColMap, enrichedFields)

      const hasEnrichment = enrichedFields.some((f) => f.action !== 'skip')
      if (hasEnrichment) {
        stats.enriched++
      } else {
        stats.skipped++
      }

      for (const field of enrichedFields) {
        const record: AddEnrichRecordParams = {
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
      })
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e)
      stats.failed++
      bgmLog(
        LOG_LEVELS.ERROR,
        `[enrichEntries] 富化 "${match.newAnimeName}" (行${bangumiRow}) 失败: ${errMsg}`,
      )
      results.push({
        kind: 'error',
        newAnimeRow: match.newAnimeRow,
        name: match.newAnimeName,
        matchType: match.matchType,
        enrichedFields: [],
        errorMessage: errMsg,
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
    `[enrichEntries] 富化完成：匹配 ${stats.matched}, 富化 ${stats.enriched}, ` +
      `跳过 ${stats.skipped}, 失败 ${stats.failed}, 耗时 ${Date.now() - startTime}ms`,
  )

  return results
}

// ========== 导出类型 ==========

export type { EnrichRecord } from './enrichRecord.js'

/**
 * 富化记录参数（内部使用）
 */
interface AddEnrichRecordParams {
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
