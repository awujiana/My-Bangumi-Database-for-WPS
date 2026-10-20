/**
 * @fileoverview 富化引擎 · 新番表列映射与布局探测（叶子模块）
 * @module sync/enrichLayout
 * @description 从 enrich-engine.ts（2194 行）拆出的「布局探测组」，是富化引擎的
 *              最底层：只依赖 `tools/util` 与 `enrich-normalize`，**不反向依赖**
 *              enrich-engine，因此简介组（enrich-intro.js）可以直接依赖它而
 *              不产生环。
 *
 *              承载内容：
 *              - 表头关键字表与列映射类型（KNOWN_COLUMN_MAP / EnrichColumnMapping）
 *              - 列映射识别（detectColumns / findKeywordField / mappingMaxCol）
 *              - 平台值聚合（readPlatformValues）
 *              - Hazx 新番表布局识别（detectAnimeSourceLayout，带缓存）
 *              - Bangumi 追踪表辅助（findAliasColumn / getBangumiColumnMap）
 *              - 矩形读扫描块（readScanBlock，别名列与简介表共用）
 *
 * @author BGM Development Team
 */

import { LOG_LEVELS, PANEL_CONFIG } from '../core/constants.js'
import {
  bgmLog,
  findHeaderRow,
  getCellValue,
  getColumnMap,
  readRangeValues,
} from '../tools/util/index.js'
// cacheGet 直连子模块（与 enrich-engine.ts 同口径）：它与 clearSheetCache 共用
// sheet.ts 内的同一份 sheetCache，经 barrel 导入在整体 mock 的测试里会拿到 undefined。
import { cacheGet } from '../tools/util/sheet.js'
import type { WpsWorksheet } from '../tools/wps.js'
import { shouldFilterNoise } from './enrich-normalize.js'

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
 * 匹配表头对应的首个字段名（独立辅助函数，用 return 替代嵌套循环内 break，且不改写参数避免 no-parameter-reassign）
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
  for (let column = 1; column <= maxCols; column += 1) {
    const headerValue = getCellValue(sheet, headerRow, column).trim()
    if (headerValue) {
      const normalizedHeader = headerValue.toLowerCase()
      const field = findKeywordField(normalizedHeader)
      if (field === 'nameCol' && mapping.nameCol === 0) {
        mapping.nameCol = column
      } else if (field === 'platformCol' && mapping.platformCol !== undefined) {
        // 重复的「播放平台」表头：横向多列平台，追加进额外平台列
        mapping.platformExtraCols = [...(mapping.platformExtraCols ?? []), column]
      } else if (
        field !== null &&
        field !== 'nameCol' &&
        field !== 'platformExtraCols' &&
        mapping[field] === undefined
      ) {
        mapping[field] = column
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
    for (let column = mapping.platformCol + 1; column < mapping.exclusiveCol; column += 1) {
      if (getCellValue(sheet, headerRow, column).trim() === '') {
        mapping.platformExtraCols = [...(mapping.platformExtraCols ?? []), column]
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
 * 计算列映射中用到的最大列号（含 `platformExtraCols`）
 *
 * 用于「一次矩形读覆盖所有需要的列」——矩形读的范围恒为 1..maxCol，
 * 因此必须取到映射里出现过的最大列号，否则靠后的列会读不到而静默取空。
 */
export function mappingMaxCol(mapping: EnrichColumnMapping): number {
  let max = mapping.nameCol
  const values = Object.values(mapping)
  for (const value of values) {
    if (typeof value === 'number' && value > max) max = value
  }
  const extraCols = mapping.platformExtraCols
  if (extraCols) {
    for (const column of extraCols) {
      if (column > max) max = column
    }
  }
  return max
}

/**
 * 聚合一行全部播放平台值：platformCol + platformExtraCols + exclusiveCol，去空去重保序。
 * 署名/标注示例等噪声同时过滤（预览与富化写入共用口径）。
 */
export function readPlatformValues(
  sheet: WpsWorksheet,
  row: number,
  mapping: EnrichColumnMapping,
  rowCells?: readonly string[],
): string[] {
  // 缺省列用 0 占位，先过滤掉：循环里再判空会让整段被 if 包住（unicorn/prefer-continue
  // 与 no-continue 互相打架），过滤后循环体是平的
  const columns = [
    mapping.platformCol ?? 0,
    ...(mapping.platformExtraCols ?? []),
    mapping.exclusiveCol ?? 0,
  ].filter((column) => column > 0)
  const values: string[] = []
  for (const column of columns) {
    const raw = rowCells?.[column - 1] ?? getCellValue(sheet, row, column)
    for (const part of raw.split(/[,，、/|]/)) {
      const value = part.trim()
      if (value && !shouldFilterNoise(value) && !values.includes(value)) values.push(value)
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
 * 识别 Hazx 新番表这类「标题/分组行 + 横向字段行 + 数据」布局（**带跨调用缓存**）。
 *
 * 缓存（§5.6 A2）：布局探测是单表最重的扫描（矩形读 10 行 × 50 列 + `detectColumns`），
 * 而反复切换源工作表 / 重扫工作簿列表时会重复探测同一张表。缓存键与
 * `findHeaderRow` / `getLastRow` 同族（表名前缀），**失效复用同一入口**
 * `clearSheetCache(worksheet)`（`refreshData` 等刷新点即清，见 `panel-lifecycle.ts`）——
 * 与既有缓存同等的失效窗口，不引入新的失效协议。负结果（null）同样缓存，
 * 与 `findHeaderRow` 缓存 0 一致。
 *
 * ⚠️ 与 `findHeaderRow` 同等暴露：表头在「不清缓存的事件」里被改时会读到旧布局
 * （§5.4 取舍③ 明确的既有约定）。表名读取异常（坏代理）时退化为不缓存，
 * 绝不让缓存逻辑把异常吞掉。
 */
export function detectAnimeSourceLayout(sheet: WpsWorksheet): AnimeSourceLayout | null {
  let sheetName: string
  try {
    sheetName = sheet.Name || ''
  } catch {
    return detectAnimeSourceLayoutUncached(sheet)
  }
  if (!sheetName) return detectAnimeSourceLayoutUncached(sheet)
  return cacheGet(`${sheetName}:animeSourceLayout`, () => detectAnimeSourceLayoutUncached(sheet))
}

/**
 * 布局探测实现（无缓存）。对外一律走 {@link detectAnimeSourceLayout}；
 * 本函数仅服务于缓存工厂内部。
 */
function detectAnimeSourceLayoutUncached(sheet: WpsWorksheet): AnimeSourceLayout | null {
  let headerRow = 0
  let firstFieldCol = 0

  // 「矩形读 + 逐格读回退」统一改法（见 文档/TECH_KNOWLEDGE_COM_DATA_SAFETY.md §5.1）：
  // 循环外一次矩形读覆盖下面两轮扫描（表头行 1..MAX_SCAN_ROWS × 50 列，以及随后的
  // 数据起始行扫描 headerRow+1..MAX_SCAN_ROWS+10 的名称列），结果只读一次、两轮共用
  // （原先每表约 500 次逐格读，且每次 SheetActivate 全簿重跑）。
  // 读回行数 / 列宽与请求不一致 ⇒ 宿主或桩不支持区域读 ⇒ isRectReadUsable 为 false，
  // 全部取值回退到原逐格路径（getCellValue），行为与改造前逐字一致。
  const scanCols = 50
  const scanEndRow = PANEL_CONFIG.MAX_SCAN_ROWS + 10
  const scanBlock = readRangeValues(sheet, 1, scanEndRow, 1, scanCols)
  const isRectReadUsable =
    scanBlock.length === scanEndRow && scanBlock.every((line) => line.length >= scanCols)
  const cellAt = (row: number, column: number): string =>
    isRectReadUsable ? (scanBlock[row - 1]?.[column - 1] ?? '') : getCellValue(sheet, row, column)

  for (let row = 1; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
    let matchedFields = 0
    let rowFirstFieldCol = 0
    for (let column = 1; column <= scanCols; column += 1) {
      const value = cellAt(row, column).trim().toLowerCase()
      if (
        value &&
        ANIME_SOURCE_HEADER_KEYWORDS.some((keyword) => value === keyword.toLowerCase())
      ) {
        matchedFields += 1
        if (rowFirstFieldCol === 0) rowFirstFieldCol = column
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
  for (let row = headerRow + 1; row <= scanEndRow; row += 1) {
    const name = cellAt(row, columnMapping.nameCol).trim()
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

/** 别名列识别的表头扫描列跨度（与原逐格扫描一致：1..50 列） */
const ALIAS_SCAN_COLUMNS = 50

/**
 * 查找 Bangumi 追踪表的别名列
 *
 * §5.6 B2：表头行一次矩形读覆盖 1..50 列（原 50 次逐格读，每次调用都付一遍）；
 * 形状不符（宿主 / 桩不支持区域读）时逐格读回退，行为与改造前逐字一致。
 */
export function findAliasColumn(sheet: WpsWorksheet): number {
  const headerRow = findHeaderRow(sheet)
  if (headerRow === 0) return 0

  const headerBlock = readScanBlock(sheet, headerRow, headerRow, ALIAS_SCAN_COLUMNS)
  const headerAt = (column: number): string =>
    (headerBlock ? (headerBlock[0]?.[column - 1] ?? '') : getCellValue(sheet, headerRow, column))
      .trim()
      .toLowerCase()

  for (let column = 1; column <= ALIAS_SCAN_COLUMNS; column += 1) {
    const headerValue = headerAt(column)
    if (
      headerValue.includes('别名') ||
      headerValue.includes('alias') ||
      headerValue.includes('原名')
    ) {
      return column
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
 * 扫描块一次矩形读（§5.6 B1/B2）：替代「逐格循环读」——`行数 × 列数` 次跨进程
 * 往返压成 1 次。
 *
 * 「矩形读 + 逐格读回退」统一改法（§5 引言）：读回行数 / 列宽与请求不一致
 * （宿主或桩不支持区域读）时返回 null，调用方逐格读回退，行为与改造前逐字一致。
 */
export function readScanBlock(
  sheet: WpsWorksheet,
  startRow: number,
  endRow: number,
  columnCount: number,
): readonly string[][] | null {
  const block = readRangeValues(sheet, startRow, endRow, 1, columnCount)
  const rowCount = endRow - startRow + 1
  const isShapeOk = block.length === rowCount && block.every((line) => line.length >= columnCount)
  return isShapeOk ? block : null
}
