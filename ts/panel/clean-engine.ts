/**
 * @fileoverview 通用清理功能 · 执行引擎（扫描 / 预览 / 执行）
 * @module panel/cleanEngine
 * @description
 * 引擎不认识任何「具体清理项」，只做三件事：
 *  1. 按 {@link CLEAN_TARGETS} / {@link CLEAN_EXCLUDES} 解析出待清理目标（工作簿 × 工作表）；
 *  2. 对每个目标 × 每条勾选规则调用对应扫描器，产出**只读**计划（待删除行 / 待写入变更）；
 *  3. 执行阶段：先写单元格变更 → 再批量删行，逐目标异常隔离并回传进度。
 *
 * 规则与展示分离：页面只消费引擎产出的统计与计划，具体清理项全部来自 clean-rules.ts。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { getOpenWorkbooks } from '../tools/locked-sheet.js'
import {
  bgmLog,
  findHeaderRow,
  getCellValue,
  getColumnMap,
  getLastRow,
  readRangeValues,
  setCellValue,
} from '../tools/util/index.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'
import {
  CLEAN_EXCLUDES,
  CLEAN_TARGETS,
  findCleanRule,
  ROW_BYTES_FALLBACK,
  ROW_BYTES_SAMPLE_LIMIT,
  XINFAN_HEADER,
} from './clean-rules.js'
import type { CleanRule } from './clean-rules.js'
import { estimateUtf8Bytes, transformCellValue } from './clean-transforms.js'
import {
  applyRowPlan,
  planDuplicateRows,
  planDuplicateUrlRows,
  planEmptyNameRows,
} from '../sync/sheet-cleaning.js'
import type { RowChange, RowPlan } from '../sync/sheet-cleaning.js'

// ========== 类型 ==========

/** 一个待清理目标（工作簿中的一张工作表） */
export interface CleanTargetInfo {
  /** 唯一键：`工作簿全路径::表名` */
  key: string
  /** 工作簿名 */
  workbookName: string
  /** 工作簿全路径（预览与日志展示用） */
  workbookPath: string
  /** 工作表名 */
  sheetName: string
  /** 显示用标签：`工作簿名 / 表名` */
  label: string
  /** 表头行号 */
  headerRow: number
  /** 最后数据行号 */
  lastRow: number
  /** 列名 → 列号 */
  colMap: Map<string, number>
  /** 工作表对象（执行阶段使用） */
  ws: WpsWorksheet
}

/** 单元格变更（含新旧值，供预览与日志使用） */
export interface CellChange {
  /** Excel 行号 */
  row: number
  /** 列号 */
  col: number
  /** 列名（用于日志展示） */
  columnName: string
  /** 原值 */
  oldValue: string
  /** 变更后的值 */
  nextValue: string
}

/** 单条规则 × 单个目标的清理计划 */
export interface RulePlan {
  /** 规则 ID */
  ruleId: string
  /** 规则名 */
  ruleName: string
  /** 目标键 */
  targetKey: string
  /** 目标显示标签 */
  targetLabel: string
  /** 待删除行号（升序） */
  deleteRows: number[]
  /** 待写入的单元格变更 */
  changes: CellChange[]
  /** 预计释放字节数 */
  estimatedBytes: number
  /** 跳过原因（无计划时） */
  skipped?: string
}

/** 计划的基础字段（构建具体计划时复用） */
type RulePlanBase = Pick<RulePlan, 'ruleId' | 'ruleName' | 'targetKey' | 'targetLabel'>

/** 空计划（附跳过原因） */
function skippedPlan(base: RulePlanBase, skipped: string): RulePlan {
  return { ...base, deleteRows: [], changes: [], estimatedBytes: 0, skipped }
}

/** 扫描结果（执行前预览的数据源） */
export interface CleanScanResult {
  /** 命中的目标（工作簿 × 工作表）列表 */
  targets: CleanTargetInfo[]
  /** 全部计划（含跳过项，便于日志说明） */
  plans: RulePlan[]
  /** 涉及文件数（= 不同工作簿数量） */
  fileCount: number
  /** 涉及目标表数量 */
  targetCount: number
  /** 待清理条目数（删除行 + 单元格变更） */
  itemCount: number
  /** 预计释放空间（字节，估算值） */
  estimatedBytes: number
  /** 扫描过程中的提示（目标过滤原因、跳过原因等） */
  notes: string[]
}

/** 单个目标的执行结果 */
export interface TargetRunResult {
  targetKey: string
  targetLabel: string
  /** 实际删除行数 */
  deletedRows: number
  /** 实际写入单元格数 */
  changedCells: number
  /** 失败信息（成功时为 undefined） */
  error?: string
}

/** 执行结果 */
export interface CleanRunResult {
  /** 逐目标结果 */
  targets: TargetRunResult[]
  /** 删除行合计 */
  deletedRows: number
  /** 写入单元格合计 */
  changedCells: number
  /** 涉及文件数 */
  fileCount: number
  /** 耗时（毫秒） */
  elapsedMs: number
}

/** 进度回调：(已完成目标数, 总目标数, 当前描述) */
export type CleanProgressCallback = (done: number, total: number, message: string) => void

// ========== 目标解析 ==========

/** 路径是否命中任一关键词（大小写不敏感；空关键词表视为不限制 / 不排除） */
function hasAnyKeyword(value: string, keywords: readonly string[]): boolean {
  if (keywords.length === 0) return false
  const lower = value.toLowerCase()
  return keywords.some((keyword) => keyword !== '' && lower.includes(keyword.toLowerCase()))
}

/** 读取工作簿全路径（FullName 优先，异常时回退 Name） */
function readWorkbookPath(wb: WpsWorkbook): string {
  try {
    return wb.FullName || wb.Name
  } catch {
    return ''
  }
}

/** 工作簿是否允许清理（排除规则优先于包含规则；供 clean-page 复用，保证 UI 候选与引擎口径一致） */
export function isWorkbookAllowed(path: string): boolean {
  if (hasAnyKeyword(path, CLEAN_TARGETS.excludeWorkbookPath)) return false
  if (CLEAN_TARGETS.includeWorkbookPath.length === 0) return true
  return hasAnyKeyword(path, CLEAN_TARGETS.includeWorkbookPath)
}

/** 工作表是否允许清理 */
function isSheetAllowed(sheetName: string): boolean {
  if (hasAnyKeyword(sheetName, CLEAN_EXCLUDES.sheetName)) return false
  if (CLEAN_TARGETS.includeSheetName.length === 0) return true
  return hasAnyKeyword(sheetName, CLEAN_TARGETS.includeSheetName)
}

/* ========== 新番表（月历式）表头识别 ========== */
// 新番表无「名称」表头（番剧名列表头为空），不能走标准特征列判定，改用专属签名识别并构造「名称 + 标签/分级」最小列映射以复用现有标签规则。

/** 列映射是否命中任一「Bangumi 数据表特征列」（配置驱动：见 CLEAN_TARGETS.identityColumns） */
function hasIdentityColumn(colMap: ReadonlyMap<string, number>): boolean {
  return CLEAN_TARGETS.identityColumns.some((key) => colMap.has(key))
}

/** 新番表表头扫描区：前 30 行 × 前 50 列 */
const XINFAN_SCAN_ROWS = 30
const XINFAN_SCAN_COLS = 50

/** 一行单元格命中了多少个新番表表头关键字 */
function countXinFanHeaderHits(cells: string[], keywords: string[]): number {
  let hits = 0
  for (const value of cells) {
    if (value && keywords.some((keyword) => value.toLowerCase().includes(keyword))) hits += 1
  }
  return hits
}

/** 扫描前若干行，返回首个命中新番表专属表头签名的行号（0 表示未识别） */
function scanXinFanHeaderRow(ws: WpsWorksheet): number {
  const keywords = XINFAN_HEADER.headerKeywords.map((keyword) => keyword.toLowerCase())
  // 快路径：一次矩形读扫描区（原先 30 行 × 50 列 = 1500 次逐格 COM 往返）。
  // 读回行数不足（宿主/桩未返回完整矩形）时回退逐格读，行为与改造前完全一致。
  const block = readRangeValues(ws, 1, XINFAN_SCAN_ROWS, 1, XINFAN_SCAN_COLS)
  if (block.length === XINFAN_SCAN_ROWS) {
    for (const [index, cells] of block.entries()) {
      if (countXinFanHeaderHits(cells, keywords) >= XINFAN_HEADER.minHeaderHits) {
        return index + 1
      }
    }
    return 0
  }
  for (let row = 1; row <= XINFAN_SCAN_ROWS; row += 1) {
    const cells: string[] = []
    for (let col = 1; col <= XINFAN_SCAN_COLS; col += 1) {
      cells.push(getCellValue(ws, row, col))
    }
    if (countXinFanHeaderHits(cells, keywords) >= XINFAN_HEADER.minHeaderHits) return row
  }
  return 0
}

/** 查找锚点列（表头含 nameAnchorKeyword，默认「周更时间」）；找不到返回 0 */
function findXinFanAnchorCol(ws: WpsWorksheet, headerRow: number): number {
  const anchor = XINFAN_HEADER.nameAnchorKeyword.toLowerCase()
  for (let col = 1; col <= 50; col += 1) {
    const value = getCellValue(ws, headerRow, col).toLowerCase()
    if (value.includes(anchor)) return col
  }
  return 0
}

/** 名称列候选（表头为空）在数据区前 nameProbeRows 行是否有非空值 */
function hasNameProbeValue(ws: WpsWorksheet, headerRow: number, col: number): boolean {
  const rows = readRangeValues(ws, headerRow + 1, headerRow + XINFAN_HEADER.nameProbeRows, col, col)
  return rows.some((row) => (row[0] ?? '').trim() !== '')
}

/**
 * 为新番表构造最小 colMap：
 * - 名称列：锚点列（周更时间）左侧最近一个「表头为空 + 数据区有值」的列
 *   （新番表布局中该列紧邻周更时间左侧，可稳定绕开同为空的播放时间列）；
 * - 标签列：表头命中 tagHeaderKeywords 时映射为「标签/分级」，复用 tag-format / noise-tags 规则。
 */
function buildXinFanColumnMap(ws: WpsWorksheet, headerRow: number): Map<string, number> {
  const colMap = new Map<string, number>()

  const anchorCol = findXinFanAnchorCol(ws, headerRow)
  let nameCol: number | undefined
  if (anchorCol > 1) {
    for (let col = anchorCol - 1; col >= 1; col -= 1) {
      if (getCellValue(ws, headerRow, col).trim() !== '') break
      if (hasNameProbeValue(ws, headerRow, col)) {
        nameCol = col
        break
      }
    }
  }
  if (nameCol) colMap.set('名称', nameCol)

  for (let col = 1; col <= 50; col += 1) {
    const value = getCellValue(ws, headerRow, col).trim()
    if (
      value &&
      XINFAN_HEADER.tagHeaderKeywords.some((keyword) =>
        value.toLowerCase().includes(keyword.toLowerCase()),
      )
    ) {
      colMap.set('标签/分级', col)
      break
    }
  }

  return colMap
}

/**
 * 工作表探测结果（页面「选择清理的表格」与引擎共用同一套识别逻辑，
 * 避免页面显示与实际清理范围不一致）。
 */
export interface SheetInspection {
  /** 表头行号（0 = 未识别到任何表头） */
  headerRow: number
  /** 最后一行行号（UsedRange 末行） */
  lastRow: number
  /** 数据行数（lastRow - headerRow，最小 0） */
  dataRows: number
  /** 表头文本（前 8 个非空值，仅展示用） */
  headers: string[]
  /** 是否识别为月历式新番表（无「名称」表头） */
  isXinFan: boolean
  /** 是否具备「名称」列（含新番表锚点列推导；仅作展示信息，不再作为入选门槛） */
  hasNameColumn: boolean
  /** 是否识别为 Bangumi 数据表（命中特征列，或命中月历式新番表签名） */
  isBangumiSheet: boolean
  /** 是否满足清理条件（识别为 Bangumi 数据表 / 新番表 + 数据行数在护栏内） */
  eligible: boolean
  /** 未满足清理条件的原因（达标时为空串，页面据此展示提示） */
  reason: string
}

/** 读取工作表末行（UsedRange 优先，异常回退 getLastRow） */
function readLastRow(ws: WpsWorksheet): number {
  try {
    const used = ws.UsedRange
    if (used) {
      const startRow = used.Row
      const rowCount = used.Rows.Count
      if (Number.isFinite(startRow) && Number.isFinite(rowCount) && rowCount > 0) {
        return startRow + rowCount - 1
      }
    }
  } catch {
    // 回落到 getLastRow
  }
  try {
    return getLastRow(ws)
  } catch {
    return 0
  }
}

/** 读取表头文本（前 8 个非空值，仅用于页面展示） */
function readHeaderLabels(ws: WpsWorksheet, headerRow: number): string[] {
  const labels: string[] = []
  if (!headerRow) return labels
  for (let col = 1; col <= 40 && labels.length < 8; col += 1) {
    const text = getCellValue(ws, headerRow, col).trim()
    if (text) labels.push(text)
  }
  return labels
}

/** 工作表结构解析结果（表头行 / 列映射 / 是否新番表） */
interface SheetLayoutInfo {
  headerRow: number
  colMap: Map<string, number>
  isXinFan: boolean
}

/** 安全读取表头行（异常时返回 0） */
function safeFindHeaderRow(ws: WpsWorksheet): number {
  try {
    return findHeaderRow(ws)
  } catch {
    return 0
  }
}

/**
 * 解析工作表结构（只读）：标准路径优先，失败后尝试新番表签名路径。
 * 页面探测与目标构造共用本函数，保证「页面显示」与「实际清理范围」一致。
 */
function resolveSheetLayout(ws: WpsWorksheet): SheetLayoutInfo {
  const headerRow = safeFindHeaderRow(ws)

  if (headerRow) {
    try {
      return { headerRow, colMap: getColumnMap(ws, headerRow), isXinFan: false }
    } catch {
      return { headerRow, colMap: new Map(), isXinFan: false }
    }
  }

  try {
    const xinFanHeaderRow = scanXinFanHeaderRow(ws)
    if (xinFanHeaderRow) {
      return {
        headerRow: xinFanHeaderRow,
        colMap: buildXinFanColumnMap(ws, xinFanHeaderRow),
        isXinFan: true,
      }
    }
  } catch {
    // 忽略新番表探测异常
  }
  return { headerRow: 0, colMap: new Map(), isXinFan: false }
}

/**
 * 探测单张工作表的表头与数据规模（只读，不修改任何数据）。
 *
 * 识别路径与目标构造完全一致：
 *  1. 标准路径：表头行可识别（`getColumnMap` 归一化），且命中任一
 *     {@link CLEAN_TARGETS.identityColumns} 特征列（名称 / Bangumi_URL）；
 *  2. 新番表路径：表头无特征列，但命中 {@link XINFAN_HEADER} 专属签名（月历式新番表）。
 */
export function inspectWorksheet(ws: WpsWorksheet): SheetInspection {
  const { headerRow, colMap, isXinFan } = resolveSheetLayout(ws)

  const lastRow = readLastRow(ws)
  const dataRows = headerRow > 0 ? Math.max(0, lastRow - headerRow) : Math.max(0, lastRow - 1)
  const hasNameColumn = colMap.has('名称')
  // 身份判定：命中特征列（名称 / Bangumi_URL），或命中月历式新番表专属签名
  const isBangumiSheet = hasIdentityColumn(colMap) || isXinFan

  let reason = ''
  if (!headerRow) {
    reason = '未识别到表头行'
  } else if (!isBangumiSheet) {
    reason = `未识别到 Bangumi 数据表特征列（${CLEAN_TARGETS.identityColumns.join(' / ')}）`
  } else if (dataRows < CLEAN_EXCLUDES.minDataRows) {
    reason = '无数据行'
  } else if (dataRows > CLEAN_TARGETS.maxDataRows) {
    reason = `数据行超过护栏（${String(CLEAN_TARGETS.maxDataRows)} 行）`
  }

  return {
    headerRow,
    lastRow,
    dataRows,
    headers: readHeaderLabels(ws, headerRow),
    isXinFan,
    hasNameColumn,
    isBangumiSheet,
    eligible: reason === '',
    reason,
  }
}

/** 枚举工作簿内的全部工作表（异常时返回空数组） */
function readWorksheets(wb: WpsWorkbook): WpsWorksheet[] {
  const sheets: WpsWorksheet[] = []
  try {
    const collection = wb.Worksheets
    const count = collection.Count
    for (let index = 1; index <= count; index += 1) {
      sheets.push(collection.Item(index))
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[cleanEngine] 枚举工作表失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return sheets
}

/**
 * 按配置校验并构造单个清理目标；不满足条件时返回 null。
 *
 * @param isForced 用户显式勾选该表时为 true：跳过「必须有特征列」的硬门槛，
 *   让用户勾选的表一定进入扫描（行级规则缺列时会返回跳过原因，在预览说明中展示），
 *   避免「页面能勾选、引擎却查无此表」的错位。
 */
function buildTarget(
  wb: WpsWorkbook,
  ws: WpsWorksheet,
  path: string,
  isForced = false,
): CleanTargetInfo | null {
  const sheetName = ws.Name
  if (!sheetName || !isSheetAllowed(sheetName)) return null

  const layout = resolveSheetLayout(ws)
  if (!isForced && !hasIdentityColumn(layout.colMap) && !layout.isXinFan) return null

  // 未识别到表头时退化为第 1 行表头 + 空列映射（规则按列缺失自行跳过）
  const headerRow = layout.headerRow > 0 ? layout.headerRow : 1
  const colMap = layout.headerRow > 0 ? layout.colMap : new Map<string, number>()

  const lastRow = readLastRow(ws)
  const dataRows = lastRow - headerRow
  if (dataRows < CLEAN_EXCLUDES.minDataRows) return null
  if (dataRows > CLEAN_TARGETS.maxDataRows) return null

  return {
    key: `${path}::${sheetName}`,
    workbookName: wb.Name,
    workbookPath: path,
    sheetName,
    label: `${wb.Name} / ${sheetName}`,
    headerRow,
    lastRow,
    colMap,
    ws,
  }
}

/** 安全读取工作表名（异常时返回空串） */
function safeSheetName(ws: WpsWorksheet): string {
  try {
    return ws.Name
  } catch {
    return ''
  }
}

/** 该工作表是否应被扫描（白名单为空 = 不限制；否则需命中用户勾选） */
function shouldScanSheet(whitelist: ReadonlySet<string>, path: string, sheetName: string): boolean {
  if (sheetName === '') return false
  if (whitelist.size === 0) return true
  return whitelist.has(`${path}\u{0000}${sheetName}`)
}

/**
 * 解析全部待清理目标：遍历已打开工作簿 → 按配置过滤 → 校验表头与数据行数。
 * 无任何可用目标时返回空数组（调用方据此提示）。
 *
 * @param selectedSheets 用户显式勾选的工作表（按 `工作簿全路径 :: 表名` 匹配）。
 *   非空时仅保留白名单命中，且命中项跳过「必须有名称列」的硬门槛（用户已确认要清理）。
 */
export function listCleanTargets(
  selectedSheets: readonly { workbookKey: string; sheetName: string }[] = [],
): CleanTargetInfo[] {
  const whitelist = new Set<string>(
    selectedSheets.map((entry) => `${entry.workbookKey}\u{0000}${entry.sheetName}`),
  )
  const targets: CleanTargetInfo[] = []
  for (const wb of getOpenWorkbooks()) {
    const path = readWorkbookPath(wb)
    if (isWorkbookAllowed(path)) {
      const picked = readWorksheets(wb)
        .map((ws) => ({ ws, sheetName: safeSheetName(ws) }))
        .filter((item) => shouldScanSheet(whitelist, path, item.sheetName))
      for (const item of picked) {
        const isPicked = whitelist.has(`${path}\u{0000}${item.sheetName}`)
        const target = buildTarget(wb, item.ws, path, isPicked)
        if (target) targets.push(target)
      }
    }
  }
  return targets
}

// ========== 排除行计算 ==========

/**
 * 计算单个目标中「不参与清理」的行号集合（汇总行 / 说明行等）。
 * 只扫描前 rowScanColumns 列，避免整表读取。
 */
export function collectExcludedRows(target: CleanTargetInfo): Set<number> {
  const excluded = new Set<number>()
  if (CLEAN_EXCLUDES.rowText.length === 0) return excluded
  const maxCol = Math.min(CLEAN_EXCLUDES.rowScanColumns, 50)
  const rows = readRangeValues(target.ws, target.headerRow + 1, target.lastRow, 1, maxCol)
  for (const [index, rowValues] of rows.entries()) {
    const joined = rowValues.join(' ')
    if (CLEAN_EXCLUDES.rowText.some((keyword) => joined.includes(keyword))) {
      excluded.add(target.headerRow + 1 + index)
    }
  }
  return excluded
}

// ========== 行字节数估算 ==========

/**
 * 估算单个目标的「每行平均字节数」：均匀采样至多 ROW_BYTES_SAMPLE_LIMIT 行读取整行，
 * 取平均；采样失败时回退到 ROW_BYTES_FALLBACK。
 */
export function estimateRowBytes(target: CleanTargetInfo): number {
  const dataRows = target.lastRow - target.headerRow
  if (dataRows <= 0) return 0
  const sampleCount = Math.min(ROW_BYTES_SAMPLE_LIMIT, dataRows)
  const step = Math.max(1, Math.floor(dataRows / sampleCount))
  const maxCol = Math.min(CLEAN_EXCLUDES.rowScanColumns, 50)

  let total = 0
  let sampled = 0
  let index = 0
  while (index < dataRows) {
    const row = target.headerRow + 1 + index
    const values = readRangeValues(target.ws, row, row, 1, maxCol)
    total += estimateUtf8Bytes((values[0] ?? []).join(''))
    sampled += 1
    index += step
  }
  if (sampled === 0) return ROW_BYTES_FALLBACK
  const average = total / sampled
  return average > 0 ? average : ROW_BYTES_FALLBACK
}

// ========== 扫描（执行前预览） ==========

/** 解析规则目标列：按配置的关键字顺序取首个命中的列 */
function resolveColumn(target: CleanTargetInfo, keywords: readonly string[]): number | undefined {
  for (const keyword of keywords) {
    const col = target.colMap.get(keyword)
    if (col) return col
    // 退化匹配：列键包含关键字（兼容「标签/分级」等组合表头）
    for (const [key, value] of target.colMap) {
      if (key.includes(keyword)) return value
    }
  }
  return undefined
}

/** 列号 → 列名（日志展示用） */
function columnName(target: CleanTargetInfo, col: number): string {
  for (const [key, value] of target.colMap) {
    if (value === col) return key
  }
  return `第${String(col)}列`
}

/** 扫描 cellTransform 类规则 */
function scanCellTransform(
  rule: CleanRule,
  target: CleanTargetInfo,
  excludedRows: ReadonlySet<number>,
): RulePlan {
  const base: RulePlanBase = {
    ruleId: rule.id,
    ruleName: rule.name,
    targetKey: target.key,
    targetLabel: target.label,
  }
  if (!rule.transform) return skippedPlan(base, '规则未配置变换函数')

  const keywords = rule.columns ?? []
  const col = resolveColumn(target, keywords)
  if (!col) return skippedPlan(base, `未找到目标列（${keywords.join(' / ')}）`)

  // 需要「名称」参照列的变换（别名去重）额外读取名称列
  const isNameRequired = rule.transform === 'dedupAliasAgainstName'
  const nameCol = isNameRequired ? target.colMap.get('名称') : undefined
  const values = readRangeValues(target.ws, target.headerRow + 1, target.lastRow, col, col)
  const names = nameCol
    ? readRangeValues(target.ws, target.headerRow + 1, target.lastRow, nameCol, nameCol)
    : null

  const changes: CellChange[] = []
  let estimatedBytes = 0
  for (const [index, rowValues] of values.entries()) {
    const row = target.headerRow + 1 + index
    const oldValue = rowValues[0] ?? ''
    if (!excludedRows.has(row) && oldValue.trim() !== '') {
      const outcome = transformCellValue(rule.transform, oldValue, {
        name: names?.[index]?.[0] ?? '',
      })
      if (outcome.changed) {
        changes.push({
          row,
          col,
          columnName: columnName(target, col),
          oldValue,
          nextValue: outcome.value,
        })
        estimatedBytes += Math.max(
          0,
          estimateUtf8Bytes(oldValue) - estimateUtf8Bytes(outcome.value),
        )
      }
    }
  }

  return { ...base, deleteRows: [], changes, estimatedBytes }
}

/** 扫描噪声行：按 {@link CLEAN_EXCLUDES.noiseRowText} 命中的行整行删除（不遵守 excludedRows） */
function planNoiseRows(ws: WpsWorksheet, headerRow: number, lastRow: number): RowPlan {
  const keywords = CLEAN_EXCLUDES.noiseRowText
  if (keywords.length === 0) {
    return {
      deleteRows: [],
      changes: [],
      groups: 0,
      mergedGroups: 0,
      skippedReason: '未配置噪声行词表',
    }
  }
  const maxCol = Math.min(CLEAN_EXCLUDES.rowScanColumns, 50)
  const rowsToDelete: number[] = []
  const rows = readRangeValues(ws, headerRow + 1, lastRow, 1, maxCol)
  for (const [index, rowValues] of rows.entries()) {
    const joined = rowValues.join(' ')
    if (keywords.some((keyword) => joined.includes(keyword))) {
      rowsToDelete.push(headerRow + 1 + index)
    }
  }
  if (rowsToDelete.length === 0) {
    return {
      deleteRows: [],
      changes: [],
      groups: 0,
      mergedGroups: 0,
      skippedReason: '未发现噪声行',
    }
  }
  return { deleteRows: rowsToDelete, changes: [], groups: rowsToDelete.length, mergedGroups: 0 }
}

function scanRowRule(
  rule: CleanRule,
  target: CleanTargetInfo,
  excludedRows: ReadonlySet<number>,
  rowBytes: number,
): RulePlan {
  const base: RulePlanBase = {
    ruleId: rule.id,
    ruleName: rule.name,
    targetKey: target.key,
    targetLabel: target.label,
  }

  let plan: RowPlan
  try {
    switch (rule.kind) {
      case 'duplicateNameRows': {
        plan = planDuplicateRows(target.ws, { excludedRows })
        break
      }
      case 'duplicateUrlRows': {
        plan = planDuplicateUrlRows(target.ws, { excludedRows })
        break
      }
      case 'emptyNameRows': {
        plan = planEmptyNameRows(target.ws, { excludedRows })
        break
      }
      case 'noiseRows': {
        // 噪声行刻意不遵守 excludedRows：否则这些行会被 rowText 保护语义先行排除，永远删不掉
        plan = planNoiseRows(target.ws, target.headerRow, target.lastRow)
        break
      }
      default: {
        return skippedPlan(base, '未知清理种类')
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return skippedPlan(base, `扫描失败：${message}`)
  }

  if (plan.deleteRows.length === 0) {
    return skippedPlan(base, plan.skippedReason ?? '未发现待清理数据')
  }

  const changes: CellChange[] = plan.changes.map((change: RowChange) => ({
    row: change.row,
    col: change.col,
    columnName: columnName(target, change.col),
    oldValue: '',
    nextValue: change.value,
  }))

  return {
    ...base,
    deleteRows: plan.deleteRows,
    changes,
    estimatedBytes: Math.round(plan.deleteRows.length * rowBytes),
  }
}

/** 扫描单条规则；无法产出计划时把原因写入 notes 并返回 null */
function scanOneRule(
  id: string,
  target: CleanTargetInfo,
  excludedRows: ReadonlySet<number>,
  rowBytes: number,
  notes: string[],
): RulePlan | null {
  const rule = findCleanRule(id)
  if (!rule) {
    notes.push(`未知清理项：${id}`)
    return null
  }
  const plan =
    rule.kind === 'cellTransform'
      ? scanCellTransform(rule, target, excludedRows)
      : scanRowRule(rule, target, excludedRows, rowBytes)
  if (plan.skipped) {
    notes.push(`${target.label} · ${rule.name}：${plan.skipped}`)
    return null
  }
  return plan
}

/** 扫描单个目标上的全部勾选规则 */
function scanTarget(
  target: CleanTargetInfo,
  ruleIds: readonly string[],
  notes: string[],
): RulePlan[] {
  const excludedRows = collectExcludedRows(target)
  if (excludedRows.size > 0) {
    notes.push(`${target.label}：排除 ${String(excludedRows.size)} 行（汇总/说明行）`)
  }
  const rowBytes = estimateRowBytes(target)

  const plans: RulePlan[] = []
  for (const id of ruleIds) {
    const plan = scanOneRule(id, target, excludedRows, rowBytes, notes)
    if (plan) plans.push(plan)
  }
  return plans
}

/**
 * 扫描全部勾选规则（只读，不修改任何单元格）。
 * @param ruleIds 勾选的规则 ID
 * @param options.selectedSheets 用户显式勾选的工作表白名单（按 `工作簿全路径 :: 表名` 形式）；
 *   传空数组表示不限制（保留旧行为，向后兼容）。
 *   命中时只清理白名单内的目标；未命中时整张表跳过。
 */
export function scanCleanRules(
  ruleIds: readonly string[],
  options: { selectedSheets?: readonly { workbookKey: string; sheetName: string }[] } = {},
): CleanScanResult {
  const notes: string[] = []
  const targets = listCleanTargets(options.selectedSheets)
  if (targets.length === 0) {
    if (options.selectedSheets && options.selectedSheets.length > 0) {
      notes.push('已勾选的工作表中没有可清理目标（表被排除规则命中，或数据行数不在护栏范围内）')
    } else {
      notes.push('未找到可清理目标（需在「选择清理的表格」中勾选工作表）')
    }
  }

  const plans: RulePlan[] = []
  let itemCount = 0
  let estimatedBytes = 0
  const files = new Set<string>()

  for (const target of targets) {
    files.add(target.workbookPath)
    for (const plan of scanTarget(target, ruleIds, notes)) {
      plans.push(plan)
      itemCount += plan.deleteRows.length + plan.changes.length
      estimatedBytes += plan.estimatedBytes
    }
  }

  return {
    targets,
    plans,
    fileCount: files.size,
    targetCount: targets.length,
    itemCount,
    estimatedBytes: Math.round(estimatedBytes),
    notes,
  }
}

// ========== 执行 ==========

/** 按目标聚合后的计划 */
interface AggregatedTargetPlan {
  target: CleanTargetInfo
  /** 待删除行号 */
  removedRows: Set<number>
  /** key = `${row}:${col}` */
  changes: Map<string, CellChange>
}

/** 合并同一单元格的多次变更：按 ` | ` 拆分后保序去重（标签合并场景安全） */
export function mergeChangeValues(base: string, extra: string): string {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of [...base.split(/\s*\|\s*/u), ...extra.split(/\s*\|\s*/u)]) {
    const trimmed = part.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result.join(' | ')
}

/** 把一个计划的单元格写入合并进 bucket（落在待删除行上的写入直接丢弃） */
function mergePlanChanges(bucket: AggregatedTargetPlan, plan: RulePlan): void {
  for (const change of plan.changes) {
    if (bucket.removedRows.has(change.row)) {
      // 行将被删除 → 写入无意义
    } else {
      const key = `${String(change.row)}:${String(change.col)}`
      const existing = bucket.changes.get(key)
      if (existing) {
        bucket.changes.set(key, {
          ...existing,
          nextValue: mergeChangeValues(existing.nextValue, change.nextValue),
        })
      } else {
        bucket.changes.set(key, { ...change })
      }
    }
  }
}

/** 把计划按目标聚合，并剔除「所在行将被删除」的变更 */
export function aggregatePlans(result: CleanScanResult): AggregatedTargetPlan[] {
  const byTarget = new Map<string, AggregatedTargetPlan>()
  for (const target of result.targets) {
    byTarget.set(target.key, { target, removedRows: new Set<number>(), changes: new Map() })
  }

  // 先汇总全部待删除行，确保后续能剔除落在待删除行上的写入
  for (const plan of result.plans) {
    const bucket = byTarget.get(plan.targetKey)
    if (bucket) {
      for (const row of plan.deleteRows) bucket.removedRows.add(row)
    }
  }

  for (const plan of result.plans) {
    const bucket = byTarget.get(plan.targetKey)
    if (bucket) mergePlanChanges(bucket, plan)
  }

  return [...byTarget.values()].filter(
    (bucket) => bucket.removedRows.size > 0 || bucket.changes.size > 0,
  )
}

/**
 * 执行清理：先写单元格变更，再批量删行。
 * 单个目标失败不影响其他目标，失败原因通过 TargetRunResult.error 返回。
 */
export async function runCleanPlans(
  result: CleanScanResult,
  onProgress?: CleanProgressCallback,
): Promise<CleanRunResult> {
  const startTime = Date.now()
  const buckets = aggregatePlans(result)
  const targets: TargetRunResult[] = []
  let deletedRows = 0
  let changedCells = 0
  const files = new Set<string>()

  let done = 0
  for (const bucket of buckets) {
    const { target } = bucket
    files.add(target.workbookPath)
    onProgress?.(done, buckets.length, `正在清理 ${target.label}`)
    try {
      // 让出一次事件循环，使进度条有机会重绘（WPS COM 调用为同步阻塞）
      await Promise.resolve()
      const changes = [...bucket.changes.values()].sort((a, b) => a.row - b.row || a.col - b.col)
      for (const change of changes) {
        setCellValue(target.ws, change.row, change.col, change.nextValue)
      }
      changedCells += changes.length

      const rowPlan: RowPlan = {
        deleteRows: [...bucket.removedRows].sort((a, b) => a - b),
        changes: [],
        groups: 0,
        mergedGroups: 0,
      }
      const removed = applyRowPlan(target.ws, rowPlan)
      deletedRows += removed
      targets.push({
        targetKey: target.key,
        targetLabel: target.label,
        deletedRows: removed,
        changedCells: changes.length,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.ERROR, `[cleanEngine] 清理失败 ${target.label}: ${message}`)
      targets.push({
        targetKey: target.key,
        targetLabel: target.label,
        deletedRows: 0,
        changedCells: 0,
        error: message,
      })
    }
    done += 1
    onProgress?.(done, buckets.length, `已完成 ${target.label}`)
  }

  return {
    targets,
    deletedRows,
    changedCells,
    fileCount: files.size,
    elapsedMs: Date.now() - startTime,
  }
}

// ========== 辅助：格式化 ==========

/** 字节数格式化为可读文本（B / KB / MB / GB） */
export function formatBytes(bytes: number): string {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let scaled = size
  let unitIndex = 0
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 || scaled >= 100 ? 0 : 1
  return `${scaled.toFixed(digits)} ${units[unitIndex] ?? 'B'}`
}

/** 目标摘要（页面「清理范围」区块展示，全部来自配置） */
export interface CleanScopeSummary {
  /** 工作簿路径包含规则（空 = 不限制） */
  includeWorkbookPath: string[]
  /** 工作簿路径排除规则 */
  excludeWorkbookPath: string[]
  /** 表名包含规则（空 = 自动识别） */
  includeSheetName: string[]
  /** 判定 Bangumi 数据表的特征列（命中任一即视为数据表） */
  identityColumns: string[]
  /** 排除表名关键词 */
  excludeSheetName: string[]
  /** 排除行文本关键词 */
  excludeRowText: string[]
  /** 单表最大扫描行数 */
  maxDataRows: number
}

/** 读取当前生效的清理范围配置（页面只读展示，不硬编码） */
export function describeCleanScope(): CleanScopeSummary {
  return {
    includeWorkbookPath: [...CLEAN_TARGETS.includeWorkbookPath],
    excludeWorkbookPath: [...CLEAN_TARGETS.excludeWorkbookPath],
    includeSheetName: [...CLEAN_TARGETS.includeSheetName],
    identityColumns: [...CLEAN_TARGETS.identityColumns],
    excludeSheetName: [...CLEAN_EXCLUDES.sheetName],
    excludeRowText: [...CLEAN_EXCLUDES.rowText],
    maxDataRows: CLEAN_TARGETS.maxDataRows,
  }
}

/** 当前可被清理的目标表数量 */
export function countCleanTargets(): number {
  return listCleanTargets().length
}
