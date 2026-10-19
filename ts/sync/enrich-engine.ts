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
import { getNotifyApi } from '../core/ui-bridge.js'
import {
  bgmLog,
  getCellValue,
  setCellValue,
  getLastRow,
  isEmptyValue,
  findHeaderRow,
  readRangeValues,
  BGM,
} from '../tools/util/index.js'
// cacheGet 直连子模块（先例：本 import 的 readRowsCache 等）：它与 clearSheetCache
// 共用 sheet.ts 内的同一份 sheetCache，经 barrel 导入在整体 mock 的测试里会拿到 undefined。
import { createSheetCellCache, readRowsCache } from '../tools/util/sheet.js'
import type { SheetCellCache } from '../tools/util/sheet.js'
import type { WpsWorksheet } from '../tools/wps.js'

import { addEnrichRecords } from './enrich-record.js'
import type { AddEnrichRecordParameters } from './enrich-record.js'

import {
  TAG_SEPARATOR,
  FEATURE_SEPARATOR,
  normalizeName,
  splitAliases,
  mergeTags,
  appendFeatures,
} from './enrich-normalize.js'

/**
 * 拆分出去的子模块（原文件 2194 行，按职责切成三个模块，依赖单向）：
 *
 * enrich-layout.js（叶子） ← enrich-intro.js ← enrich-engine.js
 * enrich-cells.js （叶子） ↙                   ↙
 *
 * 本文件**导入**它们供内部使用，再 **re-export** 保持既有对外 API 完全不变
 * （ts/index.ts 与 panel/* 仍从 enrich-engine.js 取这些符号）。
 */

import {
  findAliasColumn,
  getBangumiColumnMap,
  mappingMaxCol,
  readPlatformValues,
} from './enrich-layout.js'
import type { EnrichColumnMapping } from './enrich-layout.js'
import { readTargetCell, writeTargetCell } from './enrich-cells.js'
import {
  INTRO_FIELD_TO_BANGUMI,
  enrichIntroData,
  enrichIntroFromContext,
  enrichOpEdPv,
  isIntroSheet,
  readIntroSheetRow,
} from './enrich-intro.js'
import type { IntroSheetContext } from './enrich-intro.js'

export {
  detectColumns,
  detectAnimeSourceLayout,
  findAliasColumn,
  getBangumiColumnMap,
  readPlatformValues,
} from './enrich-layout.js'
export type { AnimeSourceLayout, EnrichColumnMapping } from './enrich-layout.js'
export {
  INTRO_FIELD_TO_BANGUMI,
  buildIntroSheetContext,
  enrichIntroData,
  enrichIntroFromContext,
  enrichOpEdPv,
  findIntroSheetInWorkbook,
  isIntroSheet,
  readIntroSheetRow,
} from './enrich-intro.js'
export type { IntroSheetContext } from './enrich-intro.js'
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

// ========== 类型定义 ==========

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
 * 读取新番表一行数据
 */
export function readNewAnimeRow(
  sheet: WpsWorksheet,
  row: number,
  mapping: EnrichColumnMapping,
  rowCells?: readonly string[],
): Record<string, string> {
  const cell = (col: number): string => rowCells?.[col - 1] ?? getCellValue(sheet, row, col)
  const data: Record<string, string> = { 名称: cell(mapping.nameCol) || '' }
  if (mapping.tagsCol) data.TAGS = cell(mapping.tagsCol) || ''
  if (mapping.premiereCol) data['首播'] = cell(mapping.premiereCol) || ''
  if (mapping.episodesCol) data['集数'] = cell(mapping.episodesCol) || ''
  if (mapping.weekdayCol) data['周更时间'] = cell(mapping.weekdayCol) || ''
  // 播放平台聚合：platformCol + platformExtraCols + exclusiveCol 去空去重（富化与预览共用口径）
  data['播放平台'] = readPlatformValues(sheet, row, mapping, rowCells).join(TAG_SEPARATOR)
  if (mapping.exclusiveCol) data['独播'] = cell(mapping.exclusiveCol) || ''
  if (mapping.specialCol) data['特殊'] = cell(mapping.specialCol) || ''
  return data
}

/**
 * 构建 Bangumi 追踪表的索引
 * 返回 [名称索引, 别名索引]
 */
function buildBangumiIndexes(
  bangumiSheet: WpsWorksheet,
  columnMap: Map<string, number>,
): [Map<string, number>, Map<string, number[]>, Map<number, string>, Map<number, string[]>] {
  const nameIndex = new Map<string, number>()
  const aliasIndex = new Map<string, number[]>()
  const rowNames = new Map<number, string>()
  // 反向索引：行号 → 该行的全部别名。有它「按行取别名」才是 O(1)；
  // 否则 matchEntriesInner 每命中一条都要遍历整个 aliasIndex 做 rows.includes(row) —— O(n²)。
  const aliasByRow = new Map<number, string[]>()

  const nameCol = columnMap.get('名称') ?? 0
  if (nameCol === 0) {
    bgmLog(LOG_LEVELS.WARN, '[buildBangumiIndexes] Bangumi表中未找到名称列')
    return [nameIndex, aliasIndex, rowNames, aliasByRow]
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
              const rowAliases = aliasByRow.get(row)
              if (rowAliases) {
                rowAliases.push(alias)
              } else {
                aliasByRow.set(row, [alias])
              }
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

  return [nameIndex, aliasIndex, rowNames, aliasByRow]
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
  const [nameIndex, aliasIndex, rowNames, aliasByRow] = buildBangumiIndexes(
    bangumiSheet,
    bangumiColMap,
  )

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
              // 反向索引 O(1) 取该行别名（原先遍历整个 aliasIndex 做 includes，是 O(n²)）
              const aliases = aliasByRow.get(bangumiRow) ?? []
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
  cache?: SheetCellCache,
): void {
  const bangumiTagsCol = colMap.get('标签/分级') ?? colMap.get('标签')
  if (!bangumiTagsCol) return

  const incomingTags = incomingData.TAGS ?? ''
  if (isEmptyValue(incomingTags)) return

  const oldTags = readTargetCell(sheet, cache, row, bangumiTagsCol)
  if (isEmptyValue(oldTags)) {
    writeTargetCell(sheet, cache, row, bangumiTagsCol, incomingTags)
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
      writeTargetCell(sheet, cache, row, bangumiTagsCol, merged)
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
  cache?: SheetCellCache,
): void {
  const targetCol = colMap.get('在线播放平台') ?? colMap.get('播放平台')
  if (!targetCol) return

  const incomingPlatforms = incomingData['播放平台'] ?? ''
  if (isEmptyValue(incomingPlatforms)) return

  const oldPlatforms = readTargetCell(sheet, cache, row, targetCol)
  if (isEmptyValue(oldPlatforms)) {
    writeTargetCell(sheet, cache, row, targetCol, incomingPlatforms)
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
      writeTargetCell(sheet, cache, row, targetCol, merged)
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
  cache?: SheetCellCache,
): void {
  const bangumiDateCol = colMap.get('开播日期')
  if (!bangumiDateCol) return

  const date = incomingData['首播'] ?? ''
  if (isEmptyValue(date)) return

  const oldDate = readTargetCell(sheet, cache, row, bangumiDateCol)
  if (isEmptyValue(oldDate)) {
    writeTargetCell(sheet, cache, row, bangumiDateCol, date)
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
  cache?: SheetCellCache,
): void {
  const bangumiEpisodesCol = colMap.get('集数')
  if (!bangumiEpisodesCol) return

  const incomingEpisodes = incomingData['集数'] ?? ''
  if (isEmptyValue(incomingEpisodes)) return

  const oldEpisodes = readTargetCell(sheet, cache, row, bangumiEpisodesCol)
  if (isEmptyValue(oldEpisodes)) {
    writeTargetCell(sheet, cache, row, bangumiEpisodesCol, incomingEpisodes)
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
  cache?: SheetCellCache,
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
  const oldFeature = readTargetCell(sheet, cache, row, bangumiFeatureCol)

  if (isEmptyValue(oldFeature)) {
    writeTargetCell(sheet, cache, row, bangumiFeatureCol, features)
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
      writeTargetCell(sheet, cache, row, bangumiFeatureCol, merged)
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

  // 源表（新番表 / 简介表）在富化全程只读不写，可在循环外一次矩形读建缓存：
  // 逐行 8~19 次逐格读 → 1 次矩形读。缓存不可用时 readRowsCache 返回 null，调用方回退逐格读。
  const sourceRows = [...new Set(matches.map((m) => m.animeRow))]
  const sourceCells = readRowsCache(animeSheet, sourceRows, mappingMaxCol(config.columnMapping))

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
  // 别名列在循环外算一次（ensureBangumiColumns 之后，避免漏掉它新加的列）
  const bangumiAliasCol = findAliasColumn(bangumiSheet)

  // 目标表（Bangumi 追踪表）写穿透缓存：每条 ~8-9 次目标表读压成 1 次矩形读。
  // 与源表不同，目标表在富化过程中会被写——enrichIntroData 写「特点」列后
  // enrichOpEdPv 会再读同一格，只读缓存会拿到写前旧值导致 appendFeatures 合并出错，
  // 因此用写穿透缓存（写同步更新缓存，见 createSheetCellCache）。
  // 追加行（nextAppendRow）不在预读集合——首次读回落逐格读并回填，写后读仍正确。
  const targetRows = matches
    .map((match) => match.bangumiRow)
    .filter((row): row is number => row !== undefined)
  const targetMaxCol = Math.max(0, ...bangumiColMap.values(), bangumiAliasCol, bangumiNameCol)
  // 后备 IO 传 barrel 级函数：与各 enrich 函数同一条依赖路径（测试对 barrel 的 mock 生效）
  const targetCache =
    targetMaxCol > 0
      ? createSheetCellCache(bangumiSheet, targetRows, targetMaxCol, {
          read: getCellValue,
          write: setCellValue,
        })
      : undefined

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
      writeTargetCell(bangumiSheet, targetCache, bangumiRow, bangumiNameCol, match.matchedAnimeName)
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
        bangumiAliasCol,
        sourceCells?.get(match.animeRow),
        targetCache,
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
          bangumiAliasCol,
          sourceCells?.get(match.animeRow),
          targetCache,
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
  aliasCol?: number,
  sourceCells?: readonly string[],
  targetCache?: SheetCellCache,
): EnrichRowOutcome {
  const isIntro = isIntroSheet(config.columnMapping)
  const incomingData = isIntro
    ? readIntroSheetRow(animeSheet, match.animeRow, config.columnMapping, sourceCells)
    : readNewAnimeRow(animeSheet, match.animeRow, config.columnMapping, sourceCells)
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
        targetCache,
      )
      enrichOpEdPv(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColMap,
        enrichedFields,
        targetCache,
      )
    } else {
      enrichTags(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields, targetCache)
      enrichDate(bangumiSheet, bangumiRow, incomingData, bangumiColMap, enrichedFields, targetCache)
      enrichEpisodes(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColMap,
        enrichedFields,
        targetCache,
      )
      enrichPlatform(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColMap,
        enrichedFields,
        targetCache,
      )
      enrichFeatures(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColMap,
        enrichedFields,
        targetCache,
      )
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
        targetCache,
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
      aliasCol,
      targetCache,
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

// ========== 新番简介工作表识别与关联富化 ==========

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
  aliasCol?: number,
  cache?: SheetCellCache,
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

  // aliasCol 由 enrichEntries 在循环外算一次传入：findAliasColumn 内部要
  // findHeaderRow + 最多 50 次逐格读，逐条重算是纯浪费（500 条 ≈ 3 万次 IPC）。
  const resolvedAliasCol = aliasCol ?? findAliasColumn(sheet)
  if (resolvedAliasCol === 0) return

  const existingAliases = readTargetCell(sheet, cache, row, resolvedAliasCol)
  const aliasList = splitAliases(existingAliases)

  const normalizedNew = normalizeName(animeName)
  const isAlreadyExists = aliasList.some((a) => normalizeName(a) === normalizedNew)

  if (isAlreadyExists) {
    enriched.push({
      fieldName: '别名',
      bangumiColumn: resolvedAliasCol,
      oldValue: existingAliases,
      updatedValue: animeName,
      action: 'skip',
    })
    return
  }

  const merged = existingAliases ? existingAliases + TAG_SEPARATOR + animeName : animeName

  writeTargetCell(sheet, cache, row, resolvedAliasCol, merged)
  enriched.push({
    fieldName: '别名',
    bangumiColumn: resolvedAliasCol,
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
