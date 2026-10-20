/**
 * @fileoverview 富化引擎 · 新番「简介工作表」识别与关联富化
 * @module sync/enrichIntro
 * @description 从 enrich-engine.ts（2194 行）拆出的「简介组」，是那次拆分里最大的
 *              一组：简介工作表的识别（表头关键字扫描、工作簿内查找）、按名称关联
 *              的行索引、以及导演/编剧/人设/OP·ED·PV 等字段的写入。
 *
 *              依赖方向（**无反向环**）：
 *              ```
 *              enrich-layout.js  （叶子：列映射 / 布局探测）
 *                    ↑
 *              enrich-intro.js   ← 本模块
 *                    ↑
 *              enrich-engine.js  （编排；re-export 本模块以保持对外 API 不变）
 *              ```
 *              本模块因此**不能** import enrich-engine.js——需要它的东西请上移到
 *              enrich-layout / enrich-cells，或反过来由 enrich-engine 传入。
 *
 * @author BGM Development Team
 */

import { LOG_LEVELS, PANEL_CONFIG } from '../core/constants.js'
import { bgmLog, getCellValue, getLastRow, isEmptyValue } from '../tools/util/index.js'
import type { SheetCellCache } from '../tools/util/sheet.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'

import { detectAnimeSourceLayout, detectColumns, readScanBlock } from './enrich-layout.js'
import type { EnrichColumnMapping } from './enrich-layout.js'
import { getAnnotatedValue, readTargetCell, writeTargetCell } from './enrich-cells.js'
import { appendFeatures, FEATURE_SEPARATOR, normalizeName } from './enrich-normalize.js'
import type { ConflictInfo, EnrichedField } from './enrich-types.js'

// ========== 常量定义 ==========

/**
 * 简介字段 → Bangumi追踪表列名映射
 * 键：新番表中的字段名；值：Bangumi追踪表中的列名
 */
export const INTRO_FIELD_TO_BANGUMI: Record<string, string> = {
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

/** 简介表头扫描的列跨度（与原逐格扫描一致：1..50 列） */
const INTRO_SCAN_COLUMNS = 50

const INTRO_FEATURE_FIELDS = new Set(['简介', 'OP', 'ED', 'PV'])

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
  columnMap: Map<string, number>,
  enriched: EnrichedField[],
  conflicts: ConflictInfo[],
  animeRow: number,
  matchedAnimeName: string,
  cache?: SheetCellCache,
): void {
  const bangumiFeatureCol = columnMap.get('特点/印象')

  for (const [sourceKey, targetColName] of Object.entries(INTRO_FIELD_TO_BANGUMI)) {
    const rawValue = incomingData[sourceKey] ?? ''
    if (!isEmptyValue(rawValue)) {
      const annotatedValue = getAnnotatedValue(sourceKey, targetColName, rawValue)
      const targetCol = columnMap.get(targetColName)
      if (targetCol !== undefined) {
        const oldValue = readTargetCell(sheet, cache, row, targetCol)
        if (isEmptyValue(oldValue)) {
          writeTargetCell(sheet, cache, row, targetCol, annotatedValue)
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
        const oldFeature = readTargetCell(sheet, cache, row, bangumiFeatureCol)
        const featureEntry = `${sourceKey}:${annotatedValue}`
        if (isEmptyValue(oldFeature)) {
          writeTargetCell(sheet, cache, row, bangumiFeatureCol, featureEntry)
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
            writeTargetCell(sheet, cache, row, bangumiFeatureCol, merged)
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
        const display = key === '简介' && value.length > 80 ? `${value.substring(0, 80)}...` : value
        featureParts.push(`${key}:${display}`)
      }
    }
    if (featureParts.length > 0) {
      const oldFeature = readTargetCell(sheet, cache, row, bangumiFeatureCol)
      const merged = featureParts.join(FEATURE_SEPARATOR)
      if (isEmptyValue(oldFeature)) {
        writeTargetCell(sheet, cache, row, bangumiFeatureCol, merged)
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
          writeTargetCell(sheet, cache, row, bangumiFeatureCol, combined)
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
  columnMap: Map<string, number>,
  enriched: EnrichedField[],
  cache?: SheetCellCache,
): void {
  const bangumiFeatureCol = columnMap.get('特点/印象')
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
  const oldFeature = readTargetCell(sheet, cache, row, bangumiFeatureCol)

  if (isEmptyValue(oldFeature)) {
    writeTargetCell(sheet, cache, row, bangumiFeatureCol, featureText)
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
 * 读取简介工作表一行数据
 * 支持简介专有字段：编剧/人设/CG导演/系列构成/分镜/原作/语言/制片国家 等
 */
export function readIntroSheetRow(
  sheet: WpsWorksheet,
  row: number,
  mapping: EnrichColumnMapping,
  rowCells?: readonly string[],
): Record<string, string> {
  const cell = (column: number): string =>
    rowCells?.[column - 1] ?? getCellValue(sheet, row, column)
  const data: Record<string, string> = { 名称: cell(mapping.nameCol) || '' }
  if (mapping.introCol) data['简介'] = cell(mapping.introCol) || ''
  if (mapping.studioCol) data['动画制作'] = cell(mapping.studioCol) || ''
  if (mapping.directorCol) data['导演'] = cell(mapping.directorCol) || ''
  if (mapping.musicCol) data['音乐'] = cell(mapping.musicCol) || ''
  if (mapping.voiceCol) data['声优'] = cell(mapping.voiceCol) || ''
  if (mapping.opCol) data.OP = cell(mapping.opCol) || ''
  if (mapping.edCol) data.ED = cell(mapping.edCol) || ''
  if (mapping.pvCol) data.PV = cell(mapping.pvCol) || ''
  if (mapping.screenplayCol) data['编剧'] = cell(mapping.screenplayCol) || ''
  if (mapping.characterDesignCol) data['人设'] = cell(mapping.characterDesignCol) || ''
  if (mapping.cgDirectorCol) data['CG导演'] = cell(mapping.cgDirectorCol) || ''
  if (mapping.seriesCompositionCol) data['系列构成'] = cell(mapping.seriesCompositionCol) || ''
  if (mapping.storyboardCol) data['分镜'] = cell(mapping.storyboardCol) || ''
  if (mapping.originalWorkCol) data['原作'] = cell(mapping.originalWorkCol) || ''
  if (mapping.languageCol) data['语言'] = cell(mapping.languageCol) || ''
  if (mapping.productionCountryCol) data['制片国家'] = cell(mapping.productionCountryCol) || ''
  if (mapping.typeCol) data['类型'] = cell(mapping.typeCol) || ''
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
 * 简介表头扫描块（§5.6 B1）：一次矩形读覆盖 `1..MAX_SCAN_ROWS` 行 ×
 * {@link INTRO_SCAN_COLUMNS} 列，替代原先「每行 50 次逐格读」——每张候选表
 * 最坏 `MAX_SCAN_ROWS × 50` 次跨进程往返 → 1 次。
 */
function readIntroScanBlock(sheet: WpsWorksheet): readonly string[][] | null {
  return readScanBlock(sheet, 1, PANEL_CONFIG.MAX_SCAN_ROWS, INTRO_SCAN_COLUMNS)
}

/**
 * 统计某行命中简介表头关键字的次数。
 * @param scanBlock {@link readIntroScanBlock} 的结果；为 null（区域读不可用）时
 *   逐格读回退，与改造前逐字一致。
 */
function countIntroHeaderHits(
  sheet: WpsWorksheet,
  row: number,
  scanBlock?: readonly string[][] | null,
): number {
  let hits = 0
  for (let column = 1; column <= INTRO_SCAN_COLUMNS; column += 1) {
    const raw = scanBlock
      ? (scanBlock[row - 1]?.[column - 1] ?? '')
      : getCellValue(sheet, row, column)
    const value = raw.trim()
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
 *
 * **不做跨调用缓存**（§5.6 A2 的取舍记录）：其结果取决于整个工作簿的表集合，
 * 而「增删工作表」没有可挂失效的事件——工作簿级键一旦写入，用户新增一张简介表后
 * 缓存不会失效，静默漏富化字段。单表级 `detectAnimeSourceLayout` 已有缓存
 * （同族键 + `clearSheetCache` 失效），简介行的逐格读也按 §5.6 B1 收敛为矩形读，
 * 全簿重扫的剩余成本已降至「每张候选表至多 1 次矩形读」，不值得为之引入
 * 无失效协议的缓存。
 */
export function findIntroSheetInWorkbook(
  wb: WpsWorkbook,
  excludeSheetName?: string,
): WpsWorksheet | null {
  const sheetCount = wb.Worksheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    let worksheet: WpsWorksheet | null = null
    try {
      worksheet = wb.Worksheets.Item(index)
    } catch {
      worksheet = null
    }
    if (worksheet) {
      const name = (() => {
        try {
          return worksheet.Name
        } catch {
          return ''
        }
      })()
      // 排除当前主源表与主新番表布局的工作表，其余表头命中简介关键字的才算候选
      if ((!name || name !== excludeSheetName) && !detectAnimeSourceLayout(worksheet)) {
        // §5.6 B1：候选表的表头扫描一次矩形读完成（原为每行 50 次逐格读）
        const scanBlock = readIntroScanBlock(worksheet)
        for (let row = 1; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
          if (countIntroHeaderHits(worksheet, row, scanBlock) >= 2) return worksheet
        }
      }
    }
  }
  return null
}

/** 构建简介工作表上下文（表头识别 + 名称行索引）；非简介表返回 null */
export function buildIntroSheetContext(sheet: WpsWorksheet): IntroSheetContext | null {
  let headerRow = 0
  // §5.6 B1：表头扫描一次矩形读完成（原为每行 50 次逐格读）
  const scanBlock = readIntroScanBlock(sheet)
  for (let row = 1; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
    if (countIntroHeaderHits(sheet, row, scanBlock) >= 2) {
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
  cache?: SheetCellCache,
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
    cache,
  )
}
