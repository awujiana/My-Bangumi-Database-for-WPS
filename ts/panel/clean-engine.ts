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

/** 工作簿是否允许清理（排除规则优先于包含规则） */
function isWorkbookAllowed(path: string): boolean {
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

/** 表头是否命中全部必备关键词 */
function hasRequiredHeaders(colMap: Map<string, number>): boolean {
  return CLEAN_TARGETS.requireHeaderKeywords.every((keyword) => hasAnyKeywordIn(colMap, keyword))
}

/** 列名集合中是否存在包含指定关键词的列 */
function hasAnyKeywordIn(colMap: Map<string, number>, keyword: string): boolean {
  for (const key of colMap.keys()) {
    if (key.includes(keyword)) return true
  }
  return false
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

/** 按配置校验并构造单个清理目标；不满足条件时返回 null */
function buildTarget(wb: WpsWorkbook, ws: WpsWorksheet, path: string): CleanTargetInfo | null {
  const sheetName = ws.Name
  if (!sheetName || !isSheetAllowed(sheetName)) return null

  const headerRow = findHeaderRow(ws)
  if (!headerRow) return null

  const colMap = getColumnMap(ws, headerRow)
  if (!hasRequiredHeaders(colMap)) return null

  const lastRow = getLastRow(ws)
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

/**
 * 解析全部待清理目标：遍历已打开工作簿 → 按配置过滤 → 校验表头与数据行数。
 * 无任何可用目标时返回空数组（调用方据此提示）。
 */
export function listCleanTargets(): CleanTargetInfo[] {
  const targets: CleanTargetInfo[] = []
  for (const wb of getOpenWorkbooks()) {
    const path = readWorkbookPath(wb)
    if (isWorkbookAllowed(path)) {
      for (const ws of readWorksheets(wb)) {
        const target = buildTarget(wb, ws, path)
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
        estimatedBytes += Math.max(0, estimateUtf8Bytes(oldValue) - estimateUtf8Bytes(outcome.value))
      }
    }
  }

  return { ...base, deleteRows: [], changes, estimatedBytes }
}

/** 扫描行级规则（删除行） */
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
 */
export function scanCleanRules(ruleIds: readonly string[]): CleanScanResult {
  const notes: string[] = []
  const targets = listCleanTargets()
  if (targets.length === 0) {
    notes.push('未找到符合目标配置的工作表（需含「名称」表头且未被排除规则命中）')
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
  /** 必备表头关键词 */
  requireHeaderKeywords: string[]
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
    requireHeaderKeywords: [...CLEAN_TARGETS.requireHeaderKeywords],
    excludeSheetName: [...CLEAN_EXCLUDES.sheetName],
    excludeRowText: [...CLEAN_EXCLUDES.rowText],
    maxDataRows: CLEAN_TARGETS.maxDataRows,
  }
}

/** 当前可被清理的目标表数量 */
export function countCleanTargets(): number {
  return listCleanTargets().length
}
