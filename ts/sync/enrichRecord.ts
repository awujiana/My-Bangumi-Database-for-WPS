/**
 * @fileoverview 富化记录管理模块
 * @module sync/enrichRecord
 * @description 管理「富化记录」工作表，记录所有新番表富化操作的详细信息。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */

import { LOG_LEVELS, BGM_COLOR } from '../core/constants.js'
import {
  bgmLog,
  getApp,
  getLastRow,
  colNumToLetter as colNumberToLetter,
  setCellValue,
  readRangeValues,
  BGM,
} from '../tools/util/index.js'
import type { WpsWorksheet } from '../tools/wps.js'

export const ENRICH_RECORD_SHEET_NAME = '富化记录'

export const ENRICH_RECORD_COLUMNS = [
  '时间戳',
  '匹配方式',
  '动漫名称',
  '行号',
  '富化字段',
  '原字段',
  '新字段',
  '操作类型',
  '备注',
] as const

export const ENRICH_RECORD_COL = {
  TIMESTAMP: 1,
  MATCH_TYPE: 2,
  NAME: 3,
  ROW: 4,
  ENRICHED_FIELD: 5,
  OLD_VALUE: 6,
  NEW_VALUE: 7,
  ACTION: 8,
  NOTE: 9,
} as const

export interface EnrichRecord {
  timestamp: string
  matchType: '精确' | '别名' | '未匹配'
  name: string
  row: number
  enrichedField: string
  oldValue: string
  updatedValue: string
  action: 'fill' | 'append' | 'skip' | 'error'
  note?: string
}

export interface AddEnrichRecordParams {
  timestamp: string
  matchType: '精确' | '别名' | '未匹配'
  name: string
  row: number
  enrichedField: string
  oldValue: string
  updatedValue: string
  action: 'fill' | 'append' | 'skip' | 'error'
  note?: string
}

export function getActionColor(action: string): number {
  switch (action) {
    case 'fill': {
      return BGM_COLOR.SUCCESS
    }
    case 'append': {
      return 0xffff80
    }
    case 'skip': {
      return BGM_COLOR.SKIP
    }
    case 'error': {
      return BGM_COLOR.FAIL
    }
    default: {
      return BGM_COLOR.GRAY
    }
  }
}

export function getOrCreateEnrichRecordSheet(): WpsWorksheet {
  const app = getApp()
  if (!app?.ActiveWorkbook) throw new Error('无法获取工作簿')

  const wb = app.ActiveWorkbook
  let enrichSheet: WpsWorksheet | null = null

  try {
    const sheets = wb.Sheets
    for (let index = 1; index <= sheets.Count; index += 1) {
      const sheet = sheets.Item(index)
      if (sheet.Name === ENRICH_RECORD_SHEET_NAME) {
        enrichSheet = sheet
        break
      }
    }
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getOrCreateEnrichRecordSheet', showAlert: false })
  }

  if (!enrichSheet) {
    enrichSheet = wb.Sheets.Add()
    enrichSheet.Name = ENRICH_RECORD_SHEET_NAME

    for (let index = 0; index < ENRICH_RECORD_COLUMNS.length; index += 1) {
      const colLetter = colNumberToLetter(index + 1)
      const cell = enrichSheet.Range(`${colLetter}1`)
      cell.Value2 = ENRICH_RECORD_COLUMNS[index] ?? ''
      if (cell.Interior) {
        cell.Interior.Color = BGM_COLOR.GRAY
      }
    }

    try {
      enrichSheet.Move(null, wb.Sheets.Item(wb.Sheets.Count))
    } catch (moveError: unknown) {
      BGM.handleError(moveError, { context: 'getOrCreateEnrichRecordSheet', showAlert: false })
    }

    const lastColLetter = colNumberToLetter(ENRICH_RECORD_COLUMNS.length)
    const fullRange = enrichSheet.Range(`A1:${lastColLetter}1`)
    try {
      if (fullRange.Font) fullRange.Font.Name = 'Maple Mono NF CN Medium'
    } catch {
      // 忽略字体设置失败
    }
    try {
      fullRange.EntireColumn.AutoFit()
    } catch {
      // 忽略列宽自适应失败
    }

    bgmLog(LOG_LEVELS.INFO, '已创建富化记录工作表')
  } else {
    const existingCols = ENRICH_RECORD_COLUMNS.length
    for (let index = 0; index < existingCols; index += 1) {
      const colLetter = colNumberToLetter(index + 1)
      const cell = enrichSheet.Range(`${colLetter}1`)
      const currentHeader = String(cell.Value2 ?? '').trim()
      const expectedHeader = ENRICH_RECORD_COLUMNS[index] ?? ''
      if (currentHeader !== expectedHeader) {
        cell.Value2 = expectedHeader
        bgmLog(
          LOG_LEVELS.INFO,
          `修复表头: ${colLetter}1 从 "${currentHeader}" → "${expectedHeader}"`,
        )
      }
    }
  }

  return enrichSheet
}

export function addEnrichRecord(parameters: AddEnrichRecordParams): void {
  try {
    const sheet = getOrCreateEnrichRecordSheet()

    let nextRow = 1
    const usedRange = sheet.UsedRange
    if (usedRange) {
      const lastUsedRow = usedRange.Row + usedRange.Rows.Count - 1
      nextRow = lastUsedRow + 1
    } else {
      nextRow = sheet.Rows.Count > 1 ? 2 : 1
    }

    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.TIMESTAMP, parameters.timestamp)
    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.MATCH_TYPE, parameters.matchType)
    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.NAME, parameters.name)
    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.ROW, parameters.row)
    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.ENRICHED_FIELD, parameters.enrichedField)
    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.OLD_VALUE, parameters.oldValue)
    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.NEW_VALUE, parameters.updatedValue)
    setCellValue(sheet, nextRow, ENRICH_RECORD_COL.ACTION, parameters.action)
    if (parameters.note !== undefined) {
      setCellValue(sheet, nextRow, ENRICH_RECORD_COL.NOTE, parameters.note)
    }

    const actionColor = getActionColor(parameters.action)
    const actionColLetter = colNumberToLetter(ENRICH_RECORD_COL.ACTION)
    const actionCell = sheet.Range(`${actionColLetter}${String(nextRow)}`)
    if (actionCell.Interior) {
      actionCell.Interior.Color = actionColor
    }

    bgmLog(
      LOG_LEVELS.INFO,
      `[addEnrichRecord] ${parameters.name} (${parameters.enrichedField}): ${parameters.action}`,
    )
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'addEnrichRecord', showAlert: false })
  }
}

export function addEnrichRecords(records: AddEnrichRecordParams[]): void {
  if (records.length === 0) return

  try {
    const sheet = getOrCreateEnrichRecordSheet()

    let startRow = 2
    const usedRange = sheet.UsedRange
    if (usedRange) {
      startRow = usedRange.Row + usedRange.Rows.Count
    }

    const rows: string[][] = records.map((r) => [
      r.timestamp,
      r.matchType,
      r.name,
      String(r.row),
      r.enrichedField,
      r.oldValue,
      r.updatedValue,
      r.action,
      r.note ?? '',
    ])

    const endRow = startRow + rows.length - 1
    const startColLetter = colNumberToLetter(1)
    const endColLetter = colNumberToLetter(ENRICH_RECORD_COLUMNS.length)
    const range = sheet.Range(
      `${startColLetter}${String(startRow)}:${endColLetter}${String(endRow)}`,
    )
    range.Value2 = rows

    for (let index = 0; index < rows.length; index += 1) {
      const row = startRow + index
      const action = rows[index]?.[ENRICH_RECORD_COL.ACTION - 1] ?? ''
      const color = getActionColor(action)
      const actionColLetter = colNumberToLetter(ENRICH_RECORD_COL.ACTION)
      const cell = sheet.Range(`${actionColLetter}${String(row)}`)
      if (cell.Interior) {
        cell.Interior.Color = color
      }
    }

    bgmLog(LOG_LEVELS.INFO, `[addEnrichRecords] 批量写入完成：${String(records.length)} 条记录`)
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'addEnrichRecords', showAlert: false })
  }
}

export function clearEnrichRecords(): void {
  try {
    const sheet = getOrCreateEnrichRecordSheet()
    const lastRow = sheet.UsedRange
      ? sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
      : sheet.Rows.Count
    if (lastRow > 1) {
      sheet.Range(`2:${String(lastRow)}`).Delete()
    }
    bgmLog(LOG_LEVELS.INFO, '已清除所有富化记录')
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'clearEnrichRecords', showAlert: false })
  }
}

export function getAllEnrichRecords(): EnrichRecord[] {
  try {
    const app = getApp()
    if (!app?.ActiveWorkbook) return []

    const wb = app.ActiveWorkbook
    let sheet: WpsWorksheet | null = null

    try {
      const sheets = wb.Sheets
      for (let index = 1; index <= sheets.Count; index += 1) {
        const s = sheets.Item(index)
        if (s.Name === ENRICH_RECORD_SHEET_NAME) {
          sheet = s
          break
        }
      }
    } catch (error: unknown) {
      BGM.handleError(error, { context: 'getAllEnrichRecords', showAlert: false })
      return []
    }

    if (!sheet) return []

    const lastRow = getLastRow(sheet)
    if (lastRow < 2) return []

    const allData = readRangeValues(sheet, 2, lastRow, 1, ENRICH_RECORD_COLUMNS.length)
    if (allData.length === 0) return []

    const records: EnrichRecord[] = []
    for (const rowData of allData) {
      const record: EnrichRecord = {
        timestamp: rowData[ENRICH_RECORD_COL.TIMESTAMP - 1] ?? '',
        matchType: (rowData[ENRICH_RECORD_COL.MATCH_TYPE - 1] ??
          '未匹配') as EnrichRecord['matchType'],
        name: rowData[ENRICH_RECORD_COL.NAME - 1] ?? '',
        row: parseInt(rowData[ENRICH_RECORD_COL.ROW - 1] ?? '0') || 0,
        enrichedField: rowData[ENRICH_RECORD_COL.ENRICHED_FIELD - 1] ?? '',
        oldValue: rowData[ENRICH_RECORD_COL.OLD_VALUE - 1] ?? '',
        updatedValue: rowData[ENRICH_RECORD_COL.NEW_VALUE - 1] ?? '',
        action: (rowData[ENRICH_RECORD_COL.ACTION - 1] ?? 'skip') as EnrichRecord['action'],
        note: rowData[ENRICH_RECORD_COL.NOTE - 1] ?? '',
      }
      records.push(record)
    }

    return records
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'getAllEnrichRecords', showAlert: false })
    return []
  }
}

/**
 * 获取富化记录表（如果存在）
 * @returns 工作表或 null
 */
export function getEnrichRecordSheetIfExists(): WpsWorksheet | null {
  try {
    const app = getApp()
    if (!app) return null
    const wb = app.ActiveWorkbook
    if (!wb) return null
    const sheets = wb.Worksheets
    const count = sheets.Count
    for (let index = 1; index <= count; index += 1) {
      const sheet = sheets.Item(index)
      if (sheet.Name === ENRICH_RECORD_SHEET_NAME) {
        return sheet
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 打开富化记录表（激活工作表）
 */
export function openEnrichRecordSheet(): void {
  try {
    const sheet = getOrCreateEnrichRecordSheet()
    sheet.Activate()
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'openEnrichRecordSheet', showAlert: true })
  }
}

/**
 * 格式化富化记录表样式
 */
export function formatEnrichRecordSheet(): void {
  try {
    const sheet = getOrCreateEnrichRecordSheet()

    const lastCol = ENRICH_RECORD_COLUMNS.length
    const lastRow = getLastRow(sheet)

    for (let c = 1; c <= lastCol; c += 1) {
      setCellValue(sheet, 1, c, ENRICH_RECORD_COLUMNS[c - 1])
    }

    const headerRange = sheet.Range('1:1')
    if (headerRange.Font) {
      headerRange.Font.Bold = true
    }
    if (headerRange.Interior) {
      headerRange.Interior.Color = BGM_COLOR.GRAY
    }
    headerRange.HorizontalAlignment = -4108

    if (lastRow >= 2) {
      const dataRange = sheet.Range(`A${String(2)}:${colNumberToLetter(lastCol)}${String(lastRow)}`)
      dataRange.Borders.LineStyle = 1
    }

    for (let c = 1; c <= lastCol; c += 1) {
      const colLetter = colNumberToLetter(c)
      const colRange = sheet.Range(`${colLetter}:${colLetter}`)
      colRange.ColumnWidth = 15
    }

    const nameCol = sheet.Range('C:C')
    nameCol.ColumnWidth = 25
    const oldValueCol = sheet.Range('F:F')
    oldValueCol.ColumnWidth = 20
    const valueCol = sheet.Range('G:G')
    valueCol.ColumnWidth = 40
    const noteCol = sheet.Range('I:I')
    noteCol.ColumnWidth = 20
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'formatEnrichRecordSheet', showAlert: false })
  }
}
