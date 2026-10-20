/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.1.0
 */

import {
  LOG_LEVELS,
  SYNC_STATUS,
  BGM_COLOR,
  SYNC_RECORD_COLUMNS,
  SYNC_RECORD_SHEET_NAME,
  SYNC_RECORD_COL,
  SYNC_RECORD_TYPE_COLOR,
} from '../core/constants.js'
import { isSyncRecordEnabled } from '../tools/config.js'
import {
  bgmLog,
  getApp,
  BGM,
  getLastRow,
  columnNumberToLetter,
  getCellValue,
  setCellValue,
  readRangeValues,
  readRangeCellValues,
} from '../tools/util/index.js'
import type { WpsCellValue, WpsWorksheet } from '../tools/wps.js'

export interface SyncRecord {
  seq?: number | string
  id?: number
  time?: string
  name?: string
  url?: string
  sid?: string
  type?: string
  source?: string | undefined
  count?: number
  content?: string
  status?: string
  message?: string
  fingerprint?: string
  collType?: string
  row?: number
}

export interface UpdateRecordParameters {
  name?: string
  url?: string
  sid?: string
  type?: string
  source?: string | undefined
  content?: string
  status?: string
  message?: string
  count?: number
  fingerprint?: string
  collType?: string
  row?: number
}

// ========== 内存缓存 ==========
const _syncRecordSidCache = new Map<string, number>()
let _syncRecordListCache: SyncRecord[] = []
let _isSyncRecordCacheValid = false
let _isFormattingInProgress = false

/**
 * 根据同步次数获取颜色
 */
function getCountColor(count: number): number {
  if (count === 1) return BGM_COLOR.BGM_SYNC
  if (count === 2) return BGM_COLOR.LIGHT_GREEN
  return BGM_COLOR.DARK_GREEN
}

/**
 * 根据状态获取颜色
 */
function getStatusColor(status: string): number {
  switch (status) {
    case SYNC_STATUS.FAIL: {
      return BGM_COLOR.FAIL
    }
    case SYNC_STATUS.SKIP: {
      return BGM_COLOR.SKIP
    }
    default: {
      return BGM_COLOR.SUCCESS
    }
  }
}

/**
 * 获取或创建同步记录工作表
 */
export function getOrCreateSyncRecordSheet(): WpsWorksheet {
  const app = getApp()
  if (!app?.ActiveWorkbook) throw new Error('无法获取工作簿')

  const wb = app.ActiveWorkbook
  let syncSheet: WpsWorksheet | null = null

  // 查找现有工作表
  try {
    const sheets = wb.Sheets
    // 工作表总数只读一次：写在循环条件里每轮都会多一次跨进程 COM 往返
    const sheetCount = sheets.Count
    for (let index = 1; index <= sheetCount; index += 1) {
      const sheet = sheets.Item(index)
      if (sheet.Name === SYNC_RECORD_SHEET_NAME) {
        syncSheet = sheet
        break
      }
    }
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getOrCreateSyncRecordSheet', showAlert: false })
  }

  if (syncSheet) {
    // 检测并迁移旧 schema（旧版无"来源"列 → 当前 12 列结构）
    try {
      const firstHeader = String(syncSheet.Range('A1').Value2 ?? '').trim()
      const sourceHeader = String(syncSheet.Range('F1').Value2 ?? '').trim()
      if (firstHeader === '序号' || (firstHeader === 'SID' && sourceHeader !== '来源')) {
        bgmLog(LOG_LEVELS.INFO, '检测到旧版本同步记录表，开始迁移...')
        migrateSyncRecordSchema(syncSheet)
        bgmLog(LOG_LEVELS.INFO, '同步记录表迁移完成')
        invalidateCache()
      }
    } catch (error: unknown) {
      // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
      const errorMessage = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.WARN, `同步记录表迁移失败: ${errorMessage}`)
    }

    // 已有工作表，检查并补齐表头
    const existingCols = SYNC_RECORD_COLUMNS.length
    for (let index = 0; index < existingCols; index += 1) {
      const columnLetter = columnNumberToLetter(index + 1)
      const cell = syncSheet.Range(`${columnLetter}1`)
      const currentHeader = String(cell.Value2 ?? '').trim()
      const expectedHeader = SYNC_RECORD_COLUMNS[index] ?? ''
      if (currentHeader !== expectedHeader) {
        cell.Value2 = expectedHeader
        bgmLog(
          LOG_LEVELS.INFO,
          `修复表头: ${columnLetter}1 从 "${currentHeader}" → "${expectedHeader}"`,
        )
      }
    }
  } else {
    syncSheet = wb.Sheets.Add()
    syncSheet.Name = SYNC_RECORD_SHEET_NAME

    // 写入表头（一次矩形写，替代逐格写）
    writeSheetHeaderRow(syncSheet, SYNC_RECORD_COLUMNS)

    // 移到末尾
    try {
      syncSheet.Move(null, wb.Sheets.Item(wb.Sheets.Count))
    } catch (moveError: unknown) {
      BGM.handleError(moveError, { context: 'getOrCreateSyncRecordSheet', showAlert: false })
    }

    bgmLog(LOG_LEVELS.INFO, '已创建同步记录工作表')

    // 新表设置格式（列宽、行高、字体、居中、边框等）
    formatSyncRecordSheet(syncSheet)
  }

  invalidateCache()
  return syncSheet
}

/**
 * 查找现有的同步记录工作表（不创建新表）
 * @returns 现有的同步记录工作表，若不存在则返回 null
 */
export function getSyncRecordSheetIfExists(): WpsWorksheet | null {
  const app = getApp()
  if (!app?.ActiveWorkbook) return null
  try {
    const sheets = app.ActiveWorkbook.Sheets
    // 工作表总数只读一次：写在循环条件里每轮都会多一次跨进程 COM 往返
    const sheetCount = sheets.Count
    for (let index = 1; index <= sheetCount; index += 1) {
      const sheet = sheets.Item(index)
      if (sheet.Name === SYNC_RECORD_SHEET_NAME) return sheet
    }
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getSyncRecordSheetIfExists', showAlert: false })
  }
  return null
}

function invalidateCache(): void {
  _isSyncRecordCacheValid = false
}

/**
 * 一次 `Range.Value2` 批量写入若干整行（P1-C）
 *
 * 同步记录表的所有写入（新增行 / 表头 / 迁移回写）都应走本函数：WPS 是跨进程 COM，
 * 逐单元格 `setCellValue` 会让一次写入放大成 12×N 次调用。
 *
 * @param sheet 工作表
 * @param startRow 起始行号（1-based）
 * @param rows 每行一个数组，按列顺序排列；列数须等于 `SYNC_RECORD_COLUMNS.length`
 */
function writeSheetRows(sheet: WpsWorksheet, startRow: number, rows: WpsCellValue[][]): void {
  if (rows.length === 0) return
  const endRow = startRow + rows.length - 1
  const endCol = columnNumberToLetter(SYNC_RECORD_COLUMNS.length)
  const range = sheet.Range(`A${String(startRow)}:${endCol}${String(endRow)}`)
  range.Value2 = rows
}

/**
 * 迁移旧版同步记录表数据到当前 12 列结构
 * 当前列序：SID(1) 同步时间(2) 名称(3) URL(4) 条目类型(5) 来源(6)
 *          → 次数(7) 内容(8) 状态(9) 收藏状态(10) 备注(11) 数据指纹(12)
 *
 * 支持两种旧结构：
 * - 旧 12 列（序号第一列）：序号(1) 同步时间(2) 名称(3) URL(4) SID(5) 条目类型(6) 次数(7) 内容(8) 状态(9) 备注(10) 数据指纹(11) 收藏状态(12)
 * - 旧 11 列（SID第一列无来源）：SID(1) 同步时间(2) 名称(3) URL(4) 条目类型(5) 次数(6) 内容(7) 状态(8) 收藏状态(9) 备注(10) 数据指纹(11)
 */
function migrateSyncRecordSchema(sheet: WpsWorksheet): void {
  const firstHeader = String(sheet.Range('A1').Value2 ?? '').trim()
  const isLegacyWithSeq = firstHeader === '序号'
  const lastRow = getLastRow(sheet)
  if (lastRow <= 1) return

  // 性能（P1-C）：整片一次矩形读取，替代逐行 11 次 getCellValue
  const allData = readRangeValues(sheet, 2, lastRow, 1, SYNC_RECORD_COLUMNS.length)
  const rows: string[][] = []

  for (const source of allData) {
    /** 按 1-based 列号取该行的原始文本 */
    const cell = (column: number): string => source[column - 1] ?? ''
    const oldSid = cell(isLegacyWithSeq ? 5 : 1).trim()
    const oldUrl = cell(4).trim()
    const oldType = cell(isLegacyWithSeq ? 6 : 5)
    const oldCount = cell(isLegacyWithSeq ? 7 : 6)
    const oldContent = cell(isLegacyWithSeq ? 8 : 7)
    const oldStatus = cell(isLegacyWithSeq ? 9 : 8)
    const oldCollType = cell(isLegacyWithSeq ? 12 : 9)

    if (oldUrl || oldSid) {
      rows.push([
        oldSid,
        cell(2),
        cell(3),
        oldUrl,
        oldType,
        // 来源：旧数据无此字段，默认空
        '',
        oldCount,
        oldContent,
        oldStatus,
        oldCollType,
        cell(10),
        cell(11),
      ])
    }
  }

  if (lastRow > 1) {
    sheet.Range(`2:${String(lastRow)}`).Delete()
  }

  // 表头：一次写入列名 + 一次设置底色
  writeSheetHeaderRow(sheet, SYNC_RECORD_COLUMNS, { gray: true })

  // 数据行：一次 Range.Value2 写入全部重组后的记录（P1-C）
  writeSheetRows(sheet, 2, rows)

  bgmLog(LOG_LEVELS.INFO, `数据迁移完成：${String(rows.length)} 条记录已重组到 12 列结构`)
}

/**
 * 写入表头行（一次 `Range.Value2` 矩形写）。
 *
 * 同步记录表与富化记录表（`sync/enrich-record.ts`）共用：逐格写表头会让一次建表
 * 放大成 `headers.length` 次跨进程 COM 往返，矩形写只花 1 次。
 *
 * @param sheet 工作表
 * @param headers 表头列名（按列顺序）
 * @param options.gray 是否把表头底色设为 `BGM_COLOR.GRAY`
 */
export function writeSheetHeaderRow(
  sheet: WpsWorksheet,
  headers: readonly string[],
  options?: { gray?: boolean },
): void {
  const headerRange = sheet.Range(`A1:${columnNumberToLetter(headers.length)}1`)
  // 展开成可变数组：headers 声明为 readonly string[]（泛化后可接受任意列清单），
  // 而 Range.Value2 需要可变二维数组 —— 不展开会触发 TS 类型错误（readonly 不可赋值）。
  headerRange.Value2 = [[...headers]]
  if (options?.gray === true && headerRange.Interior) {
    headerRange.Interior.Color = BGM_COLOR.GRAY
  }
}

function buildCache(sheet: WpsWorksheet): void {
  if (_isSyncRecordCacheValid) return
  _syncRecordSidCache.clear()
  _syncRecordListCache.length = 0

  const lastRow = getLastRow(sheet)
  if (lastRow < 2) {
    _isSyncRecordCacheValid = true
    return
  }

  const allData = readRangeValues(sheet, 2, lastRow, 1, SYNC_RECORD_COLUMNS.length)
  if (allData.length === 0) {
    _isSyncRecordCacheValid = true
    return
  }

  for (const [index, rowData] of allData.entries()) {
    try {
      cacheRecordRow(rowData, index + 2)
    } catch (error: unknown) {
      BGM.handleError(error, { context: 'buildCache', showAlert: false })
    }
  }
  _isSyncRecordCacheValid = true
}

/**
 * 设置同步记录的颜色标记
 * @param sheet 工作表对象
 * @param row 行号
 * @param status 同步状态 (SUCCESS/FAIL/SKIP)
 * @param count 同步次数
 */
/**
 * 缓存单行同步记录（自 buildCache 的 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function cacheRecordRow(rowData: string[], row: number): void {
  const sid = (rowData[SYNC_RECORD_COL.SID - 1] ?? '').trim()
  const url = (rowData[SYNC_RECORD_COL.URL - 1] ?? '').trim()
  if (url || sid) {
    _syncRecordSidCache.set(sid, row)
    _syncRecordListCache.push({
      time: rowData[SYNC_RECORD_COL.TIME - 1] ?? '',
      name: rowData[SYNC_RECORD_COL.NAME - 1] ?? '',
      url,
      sid,
      type: rowData[SYNC_RECORD_COL.TYPE - 1] ?? '',
      source: rowData[SYNC_RECORD_COL.SOURCE - 1] ?? '',
      count: Math.trunc(Number(rowData[SYNC_RECORD_COL.COUNT - 1] ?? '')) || 1,
      content: rowData[SYNC_RECORD_COL.CONTENT - 1] ?? '',
      status: (rowData[SYNC_RECORD_COL.STATUS - 1] ?? '') || SYNC_STATUS.SUCCESS,
      message: rowData[SYNC_RECORD_COL.MESSAGE - 1] ?? '',
      fingerprint: rowData[SYNC_RECORD_COL.FINGERPRINT - 1] ?? '',
      collType: rowData[SYNC_RECORD_COL.COLL_TYPE - 1] ?? '',
      row,
    })
  }
}

function setSyncRecordColors(
  sheet: WpsWorksheet,
  row: number,
  status: string,
  count: number,
): void {
  const setColor = (columnIndex: number, color: number): void => {
    const cell = sheet.Range(`${columnNumberToLetter(columnIndex)}${String(row)}`)
    if (cell.Interior) cell.Interior.Color = color
  }

  // SID列（A列）- 根据同步次数或状态设置颜色（if/else 替代嵌套三元，消除 no-nested-ternary）
  let sidColor: number
  if (status === SYNC_STATUS.FAIL) {
    sidColor = BGM_COLOR.FAIL
  } else if (status === SYNC_STATUS.SKIP) {
    sidColor = BGM_COLOR.SKIP
  } else {
    sidColor = getCountColor(count)
  }
  setColor(SYNC_RECORD_COL.SID, sidColor)

  // 状态列（I列）- 根据状态设置颜色
  setColor(SYNC_RECORD_COL.STATUS, getStatusColor(status))

  // 类型列（F列）- 根据类型设置颜色
  const typeCell = sheet.Range(`${columnNumberToLetter(SYNC_RECORD_COL.TYPE)}${String(row)}`)
  if (typeCell.Interior) {
    const typeName = getCellValue(sheet, row, SYNC_RECORD_COL.TYPE) || ''
    typeCell.Interior.Color = SYNC_RECORD_TYPE_COLOR[typeName] ?? BGM_COLOR.GRAY
  }
}

export function addSyncRecord(parameters: UpdateRecordParameters): boolean {
  if (!isSyncRecordEnabled()) {
    bgmLog(LOG_LEVELS.INFO, '[addSyncRecord] 同步记录功能未启用，跳过')
    return false
  }
  try {
    return appendOrUpdateSyncRecord(parameters)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'addSyncRecord', showAlert: false })
    return false
  }
}

/**
 * 批量写入同步记录
 *
 * 性能优化入口：相比逐条调用 addSyncRecord，本函数一次性计算所有新行的起始位置，
 * 并通过 Range.Value2 批量写入二维数组，显著减少 WPS COM 调用次数。
 * 对于已存在的 SID，仍按单条更新（合并次数）。
 *
 * @param records 待写入的记录数组
 * @returns 是否全部成功
 */
export function addSyncRecords(records: UpdateRecordParameters[]): boolean {
  if (!isSyncRecordEnabled()) {
    bgmLog(LOG_LEVELS.INFO, '[addSyncRecords] 同步记录功能未启用，跳过')
    return false
  }
  if (records.length === 0) return true

  try {
    return appendOrUpdateSyncRecords(records)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'addSyncRecords', showAlert: false })
    return false
  }
}

/**
 * 写入汇总同步记录
 *
 * 用于记录一次批量同步的整体结果（如 GitHub 仓库同步结束后新增/更新/删除统计）。
 * 汇总行以 SID 为空标识，不参与按 SID 合并次数。
 *
 * @param parameters 汇总记录参数，建议 content 写"仓库同步汇总"，message 写统计信息
 * @returns 是否成功
 */
export function addSyncRecordSummary(parameters: UpdateRecordParameters): boolean {
  return addSyncRecord({
    ...parameters,
    sid: '',
    count: 1,
  })
}

export function getAllSyncRecords(): SyncRecord[] {
  try {
    const sheet = getSyncRecordSheetIfExists()
    if (!sheet) {
      bgmLog(LOG_LEVELS.WARN, '[getAllSyncRecords] 同步记录表不存在，请先启用同步记录功能')
      return []
    }
    if (!_isSyncRecordCacheValid) buildCache(sheet)
    return [..._syncRecordListCache]
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getAllSyncRecords', showAlert: false })
    return []
  }
}

/**
 * 按 SID 对数据行分组（row 从 2 起跳过表头）
 *
 * 性能（P1-C）：整列**一次**矩形读取（`Range.Value2`）而非逐行 `getCellValue`。
 * 本函数由 `deduplicateSyncRecords()` 在每次写入前调用，逐行读会让写入放大成
 * O(n²) 次跨进程 COM 调用。读取失败时的降级口径与 `buildCache` 一致：
 * 返回空分组（本次不做去重，下次写入时重试）。
 */
function groupRowsBySid(sheet: WpsWorksheet, lastRow: number): Map<string, number[]> {
  const sidRows = new Map<string, number[]>()
  const sidColumn = readRangeValues(sheet, 2, lastRow, SYNC_RECORD_COL.SID, SYNC_RECORD_COL.SID)

  for (const [index, rowData] of sidColumn.entries()) {
    const sid = (rowData[0] ?? '').trim()
    if (sid) {
      const row = index + 2
      const rows = sidRows.get(sid) ?? []
      rows.push(row)
      sidRows.set(sid, rows)
    }
  }
  return sidRows
}

/** 合并重复 SID 组：COUNT 求和写入首行，其余行逆序删除；返回删除行数与是否发生重复 */
function mergeDuplicateSidGroups(
  sheet: WpsWorksheet,
  sidRows: Map<string, number[]>,
): { removedCount: number; hasDuplicates: boolean } {
  let removedCount = 0
  let hasDuplicates = false
  for (const [, rows] of sidRows) {
    const hasDuplicateRows = rows.length > 1
    if (hasDuplicateRows) {
      hasDuplicates = true

      const keepRow = rows[0]
      if (keepRow !== undefined) {
        let totalCount =
          Math.trunc(Number(getCellValue(sheet, keepRow, SYNC_RECORD_COL.COUNT))) || 1

        const rowsToDelete = rows.slice(1).sort((a, b) => b - a)
        for (const delRow of rowsToDelete) {
          const delCount =
            Math.trunc(Number(getCellValue(sheet, delRow, SYNC_RECORD_COL.COUNT))) || 1
          totalCount += delCount
          sheet.Range(`${String(delRow)}:${String(delRow)}`).Delete()
          removedCount += 1
        }

        setCellValue(sheet, keepRow, SYNC_RECORD_COL.COUNT, totalCount)
      }
    }
  }
  return { removedCount, hasDuplicates }
}

export function deduplicateSyncRecords(): boolean {
  try {
    const sheet = getSyncRecordSheetIfExists()
    if (!sheet) {
      bgmLog(LOG_LEVELS.WARN, '[deduplicateSyncRecords] 同步记录表不存在，请先启用同步记录功能')
      return false
    }
    const lastRow = getLastRow(sheet)
    if (lastRow <= 1) return true

    // 按 SID 分组，找出并合并重复 SID
    const sidRows = groupRowsBySid(sheet, lastRow)
    const { removedCount, hasDuplicates } = mergeDuplicateSidGroups(sheet, sidRows)

    if (hasDuplicates) {
      bgmLog(LOG_LEVELS.INFO, `去重完成：删除了 ${String(removedCount)} 条重复记录`)
      invalidateCache()
    }

    return true
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'deduplicateSyncRecords', showAlert: false })
    return false
  }
}

export function formatSyncRecordSheet(sheet?: WpsWorksheet): void {
  if (_isFormattingInProgress) return
  _isFormattingInProgress = true
  try {
    const target = sheet ?? getSyncRecordSheetIfExists()
    if (!target) {
      bgmLog(LOG_LEVELS.WARN, '[formatSyncRecordSheet] 同步记录表不存在，请先启用同步记录功能')
      _isFormattingInProgress = false
      return
    }
    const lastRow = getLastRow(target)
    if (lastRow < 1) {
      _isFormattingInProgress = false
      return
    }

    applySyncRecordFormatting(target, lastRow)
    _isFormattingInProgress = false
  } catch (error: unknown) {
    _isFormattingInProgress = false
    BGM.handleError(error, { context: 'formatSyncRecordSheet', showAlert: false })
  }
}

/**
 * 格式化步骤 1-7（自 formatSyncRecordSheet 的 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function applySyncRecordFormatting(target: WpsWorksheet, lastRow: number): void {
  const columnCount = SYNC_RECORD_COLUMNS.length
  const lastColLetter = columnNumberToLetter(columnCount)
  const fullRange = target.Range(`A1:${lastColLetter}${String(lastRow)}`)
  const dataRange = lastRow >= 2 ? target.Range(`A2:${lastColLetter}${String(lastRow)}`) : null

  // 1. 字体
  try {
    if (fullRange.Font) fullRange.Font.Name = 'Maple Mono NF CN Medium'
  } catch {
    // 忽略：此处无需处理错误
  }

  // 2. 自动行高
  try {
    fullRange.EntireRow.AutoFit()
  } catch {
    // 忽略：此处无需处理错误
  }

  // 3. 水平居中
  if (dataRange) {
    try {
      dataRange.HorizontalAlignment = -4108
    } catch {
      // 忽略：此处无需处理错误
    }
  }

  // 4. 自动列宽（全列）
  try {
    fullRange.EntireColumn.AutoFit()
  } catch {
    // 忽略：此处无需处理错误
  }

  // 5. URL 列（D列）固定宽度，不撑宽也不撑高
  const urlColLetter = columnNumberToLetter(SYNC_RECORD_COL.URL)
  try {
    const urlRange = target.Range(`${urlColLetter}:${urlColLetter}`)
    urlRange.ColumnWidth = 42
  } catch {
    // 忽略：此处无需处理错误
  }

  // 6. 名称列边框（C列）
  const nameColLetter = columnNumberToLetter(SYNC_RECORD_COL.NAME)
  if (dataRange) {
    try {
      const nameRange = target.Range(`${nameColLetter}2:${nameColLetter}${String(lastRow)}`)
      nameRange.Borders.LineStyle = 1
    } catch {
      // 忽略：此处无需处理错误
    }
  }

  // 7. 收藏状态列边框
  const collTypeColLetter = columnNumberToLetter(SYNC_RECORD_COL.COLL_TYPE)
  if (dataRange) {
    try {
      const collRange = target.Range(`${collTypeColLetter}2:${collTypeColLetter}${String(lastRow)}`)
      collRange.Borders.LineStyle = 1
    } catch {
      // 忽略：此处无需处理错误
    }
  }

  bgmLog(LOG_LEVELS.INFO, '同步记录表格式已设置')
}

export function clearSyncRecords(): boolean {
  try {
    const sheet = getSyncRecordSheetIfExists()
    if (!sheet) {
      bgmLog(LOG_LEVELS.WARN, '[clearSyncRecords] 同步记录表不存在，请先启用同步记录功能')
      return false
    }
    // UsedRange 是跨进程 COM 属性，提为局部常量：原写法求值 3 次，
    // 每次含 Row + Rows + Count ≈ 8 次 IPC，这里白耗 16 次。
    const usedRange = sheet.UsedRange
    const lastRow = usedRange ? usedRange.Row + usedRange.Rows.Count - 1 : sheet.Rows.Count
    if (lastRow > 1) {
      sheet.Range(`2:${String(lastRow)}`).Delete()
    }
    _syncRecordSidCache.clear()
    _syncRecordListCache = []
    _isSyncRecordCacheValid = true
    bgmLog(LOG_LEVELS.INFO, '已清除所有同步记录')
    return true
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'clearSyncRecords', showAlert: false })
    return false
  }
}

export function openSyncRecordSheet(scrollToRow?: number): void {
  try {
    const sheet = getSyncRecordSheetIfExists()
    if (!sheet) {
      bgmLog(LOG_LEVELS.WARN, '[openSyncRecordSheet] 同步记录表不存在，请先启用同步记录功能')
      return
    }
    sheet.Activate()

    // 定位到目标行（默认滚动到最后一行数据）
    const targetRow = scrollToRow ?? getLastRow(sheet)
    if (targetRow > 1) {
      try {
        const range = sheet.Range(`${String(targetRow)}:${String(targetRow)}`)
        range.Select()
        bgmLog(LOG_LEVELS.INFO, `已切换到同步记录工作表，定位到第 ${String(targetRow)} 行`)
      } catch {
        bgmLog(LOG_LEVELS.INFO, '已切换到同步记录工作表')
      }
    } else {
      bgmLog(LOG_LEVELS.INFO, '已切换到同步记录工作表（暂无数据）')
    }
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'openSyncRecordSheet', showAlert: false })
  }
}

// For testing only: reset internal cache state
export function __resetSyncRecordCache(): void {
  _syncRecordSidCache.clear()
  _syncRecordListCache = []
  _isSyncRecordCacheValid = false
  _isFormattingInProgress = false
}

/**
 * 构造「已存在 SID」的整行更新值（整行读-改-写，替代逐单元格 setCellValue）。
 * 以读回的原始整行（保留类型）为底，仅覆盖本次显式提供的字段。
 * @param existing 读回的原始整行，长度不足时以 '' 补齐
 * @param parameters 本次提供的字段
 * @param now 当前时间戳字符串
 * @param updatedCount 累加后的次数
 * @param statusOverride 当非空时覆盖 STATUS 列（批量路径始终传入；单条路径仅在提供时传入）
 */
function buildUpdatedSyncRow(
  existing: WpsCellValue[],
  parameters: UpdateRecordParameters,
  now: string,
  updatedCount: number,
  statusOverride: string | undefined,
): WpsCellValue[] {
  const rowValues: WpsCellValue[] = Array.from(
    { length: SYNC_RECORD_COLUMNS.length },
    (_, index) => existing[index] ?? '',
  )
  rowValues[SYNC_RECORD_COL.TIME - 1] = now
  rowValues[SYNC_RECORD_COL.COUNT - 1] = updatedCount
  if (statusOverride !== undefined) rowValues[SYNC_RECORD_COL.STATUS - 1] = statusOverride
  if (parameters.message) rowValues[SYNC_RECORD_COL.MESSAGE - 1] = parameters.message
  if (parameters.fingerprint !== undefined)
    rowValues[SYNC_RECORD_COL.FINGERPRINT - 1] = parameters.fingerprint
  if (parameters.name) rowValues[SYNC_RECORD_COL.NAME - 1] = parameters.name
  if (parameters.url) rowValues[SYNC_RECORD_COL.URL - 1] = parameters.url
  if (parameters.type) rowValues[SYNC_RECORD_COL.TYPE - 1] = parameters.type
  if (parameters.source) rowValues[SYNC_RECORD_COL.SOURCE - 1] = parameters.source
  if (parameters.content) rowValues[SYNC_RECORD_COL.CONTENT - 1] = parameters.content
  if (parameters.collType) rowValues[SYNC_RECORD_COL.COLL_TYPE - 1] = parameters.collType
  return rowValues
}

/**
 * appendOrUpdateSyncRecord（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function appendOrUpdateSyncRecord(parameters: UpdateRecordParameters) {
  const sheet = getOrCreateSyncRecordSheet()

  // 写入数据前先去重，确保缓存数据干净
  deduplicateSyncRecords()

  if (!_isSyncRecordCacheValid) buildCache(sheet)

  const sid = parameters.sid ?? ''
  const now = new Date().toLocaleString('zh-CN')

  const existingRow = sid ? _syncRecordSidCache.get(sid) : undefined
  if (existingRow === undefined) {
    // 两个分支均会赋值 nextRow，无需初始化为 1（消除 no-useless-assignment）
    let nextRow: number
    const usedRange = sheet.UsedRange
    if (usedRange) {
      const lastUsedRow = usedRange.Row + usedRange.Rows.Count - 1
      nextRow = lastUsedRow + 1
    } else {
      nextRow = sheet.Rows.Count > 1 ? 2 : 1
    }

    const finalStatus = parameters.status ?? SYNC_STATUS.SUCCESS
    const finalCount = parameters.count ?? 1

    // 性能（P1-C）：一次 Range.Value2 写入整行，替代 12 次 setCellValue（跨进程 COM 调用）
    const rowValues: WpsCellValue[] = Array.from({ length: SYNC_RECORD_COLUMNS.length }, () => '')
    rowValues[SYNC_RECORD_COL.TIME - 1] = now
    rowValues[SYNC_RECORD_COL.NAME - 1] = parameters.name ?? ''
    rowValues[SYNC_RECORD_COL.URL - 1] = parameters.url ?? ''
    rowValues[SYNC_RECORD_COL.SID - 1] = sid
    rowValues[SYNC_RECORD_COL.TYPE - 1] = parameters.type ?? ''
    rowValues[SYNC_RECORD_COL.SOURCE - 1] = parameters.source ?? ''
    rowValues[SYNC_RECORD_COL.COUNT - 1] = finalCount
    rowValues[SYNC_RECORD_COL.CONTENT - 1] = parameters.content ?? ''
    rowValues[SYNC_RECORD_COL.STATUS - 1] = finalStatus
    rowValues[SYNC_RECORD_COL.MESSAGE - 1] = parameters.message ?? ''
    if (parameters.fingerprint !== undefined)
      rowValues[SYNC_RECORD_COL.FINGERPRINT - 1] = parameters.fingerprint
    if (parameters.collType) rowValues[SYNC_RECORD_COL.COLL_TYPE - 1] = parameters.collType

    writeSheetRows(sheet, nextRow, [rowValues])

    setSyncRecordColors(sheet, nextRow, finalStatus, finalCount)

    _syncRecordSidCache.set(sid, nextRow)
    _syncRecordListCache.push({
      id: nextRow,
      time: now,
      sid,
      count: finalCount,
      status: finalStatus,
      message: parameters.message ?? '',
      ...(parameters.name && { name: parameters.name }),
      ...(parameters.url && { url: parameters.url }),
      ...(parameters.type && { type: parameters.type }),
      ...(parameters.source && { source: parameters.source }),
      ...(parameters.content && { content: parameters.content }),
      ...(parameters.fingerprint !== undefined && { fingerprint: parameters.fingerprint }),
      ...(parameters.collType && { collType: parameters.collType }),
    })
  } else {
    // 性能（P1-C 残留）：整行一次矩形读（保留原始类型），读-改-写整行，
    // 替代 11 次 setCellValue。读回失败（空数组）则放弃写入并返回 false，
    // 避免用空值覆盖整行、静默清空用户同步记录。
    const existingRows = readRangeCellValues(
      sheet,
      existingRow,
      existingRow,
      1,
      SYNC_RECORD_COLUMNS.length,
    )
    const existing = existingRows[0]
    if (!existing) return false
    const existingCount = Math.trunc(Number(existing[SYNC_RECORD_COL.COUNT - 1])) || 0
    const updatedCount = existingCount + (parameters.count ?? 1)
    const finalStatus = parameters.status ?? SYNC_STATUS.SUCCESS

    const rowValues = buildUpdatedSyncRow(
      existing,
      parameters,
      now,
      updatedCount,
      parameters.status,
    )
    writeSheetRows(sheet, existingRow, [rowValues])

    setSyncRecordColors(sheet, existingRow, finalStatus, updatedCount)

    // 更新缓存
    const cacheItem = _syncRecordListCache.find((item) => item.sid === sid)
    if (cacheItem) {
      cacheItem.time = now
      cacheItem.count = updatedCount
      if (parameters.status) cacheItem.status = parameters.status
      if (parameters.message) cacheItem.message = parameters.message
      if (parameters.fingerprint !== undefined) cacheItem.fingerprint = parameters.fingerprint
      if (parameters.name) cacheItem.name = parameters.name
      if (parameters.url) cacheItem.url = parameters.url
      if (parameters.type) cacheItem.type = parameters.type
      if (parameters.source) cacheItem.source = parameters.source
      if (parameters.content) cacheItem.content = parameters.content
      if (parameters.collType) cacheItem.collType = parameters.collType
    }
  }
  return true
}

/**
 * appendOrUpdateSyncRecords（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function appendOrUpdateSyncRecords(records: UpdateRecordParameters[]) {
  const sheet = getOrCreateSyncRecordSheet()
  deduplicateSyncRecords()
  if (!_isSyncRecordCacheValid) buildCache(sheet)

  const now = new Date().toLocaleString('zh-CN')
  const pendingRows: string[][] = []
  const sidToUpdate = new Map<
    string,
    { row: number; updatedCount: number; status: string; parameters: UpdateRecordParameters }
  >()

  for (const parameters of records) {
    const sid = parameters.sid ?? ''
    const existingRow = sid ? _syncRecordSidCache.get(sid) : undefined
    if (existingRow === undefined) {
      pendingRows.push([
        sid,
        now,
        parameters.name ?? '',
        parameters.url ?? '',
        parameters.type ?? '',
        parameters.source ?? '',
        String(parameters.count ?? 1),
        parameters.content ?? '',
        parameters.status ?? SYNC_STATUS.SUCCESS,
        parameters.collType ?? '',
        parameters.message ?? '',
        parameters.fingerprint ?? '',
      ])
    } else {
      const existingCount =
        Math.trunc(Number(getCellValue(sheet, existingRow, SYNC_RECORD_COL.COUNT))) || 0
      const existing = sidToUpdate.get(sid)
      const totalCount = (existing?.updatedCount ?? existingCount) + (parameters.count ?? 1)
      sidToUpdate.set(sid, {
        row: existingRow,
        updatedCount: totalCount,
        status: parameters.status ?? SYNC_STATUS.SUCCESS,
        parameters,
      })
    }
  }

  // 批量写入新行：通过 Range.Value2 一次性写入二维数组
  if (pendingRows.length > 0) {
    const usedRange = sheet.UsedRange
    const startRow = usedRange ? usedRange.Row + usedRange.Rows.Count : 2
    writeSheetRows(sheet, startRow, pendingRows)

    // 设置新增行的颜色
    for (const [index, data] of pendingRows.entries()) {
      const row = startRow + index
      const status = data[SYNC_RECORD_COL.STATUS - 1] ?? SYNC_STATUS.SUCCESS
      const count = Math.trunc(Number(data[SYNC_RECORD_COL.COUNT - 1] ?? '')) || 1
      setSyncRecordColors(sheet, row, status, count)
    }
  }

  // 更新已有 SID 的时间、次数、状态及其他字段（整行读-改-写，替代逐单元格 setCellValue）
  for (const [sid, { row, updatedCount, status, parameters }] of sidToUpdate) {
    const existingRows = readRangeCellValues(sheet, row, row, 1, SYNC_RECORD_COLUMNS.length)
    const existing = existingRows[0]
    // 读回失败（形状归一化失败）或读回宽度不足时放弃该行的更新并记录日志：
    // 单行区域的 Value2 可能是一维数组，existing 只剩首列时 buildUpdatedSyncRow 会用
    // '' 补齐其余 11 列并整行写回，等于静默清空该行的用户同步记录（文档 §2.1 / §2.3）。
    if (!existing || existing.length < SYNC_RECORD_COLUMNS.length) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[addSyncRecords] 第 ${String(row)} 行旧值读取失败或宽度不足，放弃更新（SID=${sid}）`,
      )
    } else {
      const rowValues = buildUpdatedSyncRow(existing, parameters, now, updatedCount, status)
      writeSheetRows(sheet, row, [rowValues])
      setSyncRecordColors(sheet, row, status, updatedCount)
      _syncRecordSidCache.set(sid, row)
    }
  }

  invalidateCache()
  bgmLog(
    LOG_LEVELS.INFO,
    `[addSyncRecords] 批量写入完成：新增 ${String(pendingRows.length)} 条，更新 ${String(sidToUpdate.size)} 条`,
  )
  return true
}
