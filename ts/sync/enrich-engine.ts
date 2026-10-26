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
  findHeaderRow,
  readRangeValues,
} from '../tools/util/index.js'
// cacheGet 直连子模块（先例：本 import 的 readRowsCache 等）：它与 clearSheetCache
// 共用 sheet.ts 内的同一份 sheetCache，经 barrel 导入在整体 mock 的测试里会拿到 undefined。
import { createSheetCellCache, readRowsCache } from '../tools/util/sheet.js'
import type { SheetCellCache } from '../tools/util/sheet.js'
import type { WpsWorksheet } from '../tools/wps.js'

import { addEnrichRecords } from './enrich-record.js'
import type { AddEnrichRecordParameters } from './enrich-record.js'

import { TAG_SEPARATOR, normalizeName, splitAliases } from './enrich-normalize.js'

/**
 * 拆分出去的子模块（原文件 2194 行，按职责切成三个模块，依赖单向）：
 *
 * enrich-layout.js（叶子） ← enrich-intro.js ← enrich-engine.js
 * enrich-cells.js （叶子） ↙                   ↙
 *
 * 调用方（ts/index.ts 与 panel/*）已**直连**各新模块，本文件不再为兼容保留
 * re-export——只在下面 import 供自身编排使用。
 */

import { findAliasColumn, getBangumiColumnMap, mappingMaxColumn } from './enrich-layout.js'
import { readTargetCell, writeTargetCell } from './enrich-cells.js'

import {
  enrichPlatform,
  enrichTags,
  enrichDate,
  enrichEpisodes,
  enrichFeatures,
} from './enrich-fields.js'
import { readNewAnimeRow } from './enrich-matching.js'
import type {
  ConflictInfo,
  EnrichConfig,
  EnrichedField,
  EnrichResultItem,
  MatchResult,
  ProgressCallback,
} from './enrich-types.js'
import {
  INTRO_FIELD_TO_BANGUMI,
  enrichIntroData,
  enrichIntroFromContext,
  enrichOpEdPv,
  isIntroSheet,
  readIntroSheetRow,
} from './enrich-intro.js'
import type { IntroSheetContext } from './enrich-intro.js'

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

// ========== 类型定义 ==========

/**
 * 单行富化结果（供 enrichEntries 累计统计）
 */
type EnrichRowOutcome = 'enriched' | 'skipped' | 'error'

// ========== 核心函数 ==========

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
  const sourceCells = readRowsCache(animeSheet, sourceRows, mappingMaxColumn(config.columnMapping))

  let bangumiColumnMap = getBangumiColumnMap(bangumiSheet)

  if (intro || isIntroSheet(config.columnMapping)) {
    bangumiColumnMap = ensureBangumiColumns(
      bangumiSheet,
      bangumiColumnMap,
      INTRO_FIELD_TO_BANGUMI,
      config.headerRow,
    )
  }

  // 空目标表检测：表空时未匹配条目无行可匹配，改为作为新行追加写入
  const bangumiHeaderRow = findHeaderRow(bangumiSheet)
  const bangumiLastRow = bangumiHeaderRow > 0 ? getLastRow(bangumiSheet, true, bangumiHeaderRow) : 0
  const isBangumiEmpty = bangumiHeaderRow > 0 && bangumiLastRow <= bangumiHeaderRow
  let nextAppendRow = bangumiLastRow + 1
  const bangumiNameColumn = bangumiColumnMap.get('名称') ?? 0
  // 别名列在循环外算一次（ensureBangumiColumns 之后，避免漏掉它新加的列）
  const bangumiAliasColumn = findAliasColumn(bangumiSheet)

  // 目标表（Bangumi 追踪表）写穿透缓存：每条 ~8-9 次目标表读压成 1 次矩形读。
  // 与源表不同，目标表在富化过程中会被写——enrichIntroData 写「特点」列后
  // enrichOpEdPv 会再读同一格，只读缓存会拿到写前旧值导致 appendFeatures 合并出错，
  // 因此用写穿透缓存（写同步更新缓存，见 createSheetCellCache）。
  // 追加行（nextAppendRow）不在预读集合——首次读回落逐格读并回填，写后读仍正确。
  const targetRows = matches
    .map((match) => match.bangumiRow)
    .filter((row): row is number => row !== undefined)
  const targetMaxColumn = Math.max(
    0,
    ...bangumiColumnMap.values(),
    bangumiAliasColumn,
    bangumiNameColumn,
  )
  // 后备 IO 传 barrel 级函数：与各 enrich 函数同一条依赖路径（测试对 barrel 的 mock 生效）
  const targetCache =
    targetMaxColumn > 0
      ? createSheetCellCache(bangumiSheet, targetRows, targetMaxColumn, {
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

    if (isBangumiEmpty && bangumiNameColumn > 0 && match.matchType === 'unmatched') {
      // 空目标表：将新番表条目作为新行追加（先写名称，再走常规富化）
      const bangumiRow = nextAppendRow
      nextAppendRow += 1
      writeTargetCell(
        bangumiSheet,
        targetCache,
        bangumiRow,
        bangumiNameColumn,
        match.matchedAnimeName,
      )
      outcome = enrichIntoRow(
        animeSheet,
        bangumiSheet,
        bangumiRow,
        match,
        match.matchedAnimeName,
        '新增',
        config,
        bangumiColumnMap,
        results,
        enrichRecords,
        intro,
        bangumiAliasColumn,
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
          bangumiColumnMap,
          results,
          enrichRecords,
          intro,
          bangumiAliasColumn,
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
  bangumiColumnMap: Map<string, number>,
  results: EnrichResultItem[],
  records: AddEnrichRecordParameters[],
  intro?: IntroSheetContext,
  aliasColumn?: number,
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
        bangumiColumnMap,
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
        bangumiColumnMap,
        enrichedFields,
        targetCache,
      )
    } else {
      enrichTags(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColumnMap,
        enrichedFields,
        targetCache,
      )
      enrichDate(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColumnMap,
        enrichedFields,
        targetCache,
      )
      enrichEpisodes(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColumnMap,
        enrichedFields,
        targetCache,
      )
      enrichPlatform(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColumnMap,
        enrichedFields,
        targetCache,
      )
      enrichFeatures(
        bangumiSheet,
        bangumiRow,
        incomingData,
        bangumiColumnMap,
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
        bangumiColumnMap,
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
      bangumiColumnMap,
      enrichedFields,
      aliasColumn,
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
  columnMap: Map<string, number>,
  requiredFields: Record<string, string>,
  headerRow: number,
): Map<string, number> {
  const updatedMap = new Map(columnMap)
  let maxColumn = 0

  for (const column of updatedMap.values()) {
    if (column > maxColumn) maxColumn = column
  }

  const missing: { field: string; sourceKey: string }[] = []
  for (const [sourceKey, targetName] of Object.entries(requiredFields)) {
    if (!updatedMap.has(targetName)) {
      missing.push({ field: targetName, sourceKey })
    }
  }

  if (missing.length === 0) return updatedMap

  const firstNewColumn = maxColumn + 1
  const lastNewColumn = maxColumn + missing.length
  // 新增列的映射增量：**校验通过后**才合并进 updatedMap（不在 try 内提前 set）。
  // 原实现在 try 内逐个 set 并在 catch 里静默返回，等于把"可能没写成表头"的列
  // 当成已存在 → 下游按映射往空列写值，用户看到表头缺失 + 数据错位（P2-6）。
  const additions: [string, number][] = []

  try {
    // 复制现有表头样式
    const existingStyleColumn = maxColumn > 0 ? 1 : firstNewColumn
    const styleSourceRange = sheet.Range(
      `${WpsCellReference(headerRow, existingStyleColumn)}:${WpsCellReference(headerRow, existingStyleColumn)}`,
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
      `${WpsCellReference(headerRow, firstNewColumn)}:${WpsCellReference(headerRow, lastNewColumn)}`,
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
    const readBack = readRangeValues(sheet, headerRow, headerRow, firstNewColumn, lastNewColumn)
    const readBackRow = readBack[0]
    if (readBackRow) {
      // 按 missing 逐个比对（而非遍历读回结果）：读回列数不足时同样判为失败
      const hasMismatch = missing.some((m, index) => readBackRow[index]?.trim() !== m.field)
      if (hasMismatch) {
        throw new Error('新列表头写入后读回校验不通过')
      }
    }

    for (const [index, missingField] of missing.entries()) {
      additions.push([missingField.field, firstNewColumn + index])
    }
  } catch (error) {
    // 不做部分提交：写入失败的列一律不写进 columnMap，下游会按既有回退列处理。
    // 也**不清理**已写下的表头：读回可能因 COM 异常拿到空值，据不可靠信号去清空
    // 会擦掉正确表头（数据丢失代价远高于残留一个空列）。
    const errorMessage = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[ensureBangumiColumns] 添加列失败: ${errorMessage}`)
    getNotifyApi().toast(`自动添加缺失列失败：${errorMessage}。相关字段将回退到原有列。`, 'error')
    return updatedMap
  }

  for (const [field, column] of additions) {
    updatedMap.set(field, column)
    bgmLog(
      LOG_LEVELS.INFO,
      `[ensureBangumiColumns] 新增列: ${field} → 第 ${String(column)} 列 (样式已跟随现有列)`,
    )
  }

  return updatedMap
}

/**
 * WpsCellRef 辅助函数：生成单元格引用
 */
function WpsCellReference(row: number, column: number): string {
  let columnString = ''
  let c = column
  while (c > 0) {
    c -= 1
    columnString = String.fromCodePoint(65 + (c % 26)) + columnString
    c = Math.floor(c / 26)
  }
  return `${columnString}${String(row)}`
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
  columnMap: Map<string, number>,
  enriched: EnrichedField[],
  aliasColumn?: number,
  cache?: SheetCellCache,
): void {
  const nameColumn = columnMap.get('名称')
  if (!nameColumn) return

  if (animeName === bangumiName) {
    enriched.push({
      fieldName: '别名',
      bangumiColumn: nameColumn,
      oldValue: '',
      updatedValue: animeName,
      action: 'skip',
    })
    return
  }

  // aliasColumn 由 enrichEntries 在循环外算一次传入：findAliasColumn 内部要
  // findHeaderRow + 最多 50 次逐格读，逐条重算是纯浪费（500 条 ≈ 3 万次 IPC）。
  const resolvedAliasColumn = aliasColumn ?? findAliasColumn(sheet)
  if (resolvedAliasColumn === 0) return

  const existingAliases = readTargetCell(sheet, cache, row, resolvedAliasColumn)
  const aliasList = splitAliases(existingAliases)

  const normalizedNew = normalizeName(animeName)
  const isAlreadyExists = aliasList.some((a) => normalizeName(a) === normalizedNew)

  if (isAlreadyExists) {
    enriched.push({
      fieldName: '别名',
      bangumiColumn: resolvedAliasColumn,
      oldValue: existingAliases,
      updatedValue: animeName,
      action: 'skip',
    })
    return
  }

  const merged = existingAliases ? existingAliases + TAG_SEPARATOR + animeName : animeName

  writeTargetCell(sheet, cache, row, resolvedAliasColumn, merged)
  enriched.push({
    fieldName: '别名',
    bangumiColumn: resolvedAliasColumn,
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
  columnMap: Map<string, number>,
  dataStartRow: number,
): SearchResult[] {
  if (!keyword.trim()) return []

  const results: SearchResult[] = []
  const normalizedKeyword = normalizeName(keyword)
  const nameColumn =
    columnMap.get('名称') ?? columnMap.get('动漫名称') ?? columnMap.get('番组名') ?? 0

  if (nameColumn === 0) return results

  const lastRow = getLastRow(sheet)
  if (lastRow < dataStartRow) return results

  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const nameValue = getCellValue(sheet, row, nameColumn)
    if (nameValue) {
      const normalizedName = normalizeName(nameValue)
      if (normalizedName.includes(normalizedKeyword)) {
        const fieldMatches: SearchResult['fieldMatches'] = [{ column: '名称', value: nameValue }]

        const aliasColumn = columnMap.get('别名')
        if (aliasColumn) {
          const aliasValue = getCellValue(sheet, row, aliasColumn)
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
