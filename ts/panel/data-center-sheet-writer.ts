/**
 * @fileoverview 搜索结果写入工作表的 COM 薄封装（找/建同名表 → 清空 → 矩形写）
 * @module panel/dataCenterSheetWriter
 * @description 行数据构造在 services/data-center-export.ts（纯函数、可单测）；
 *              本模块只做 WPS COM 往返，遵循两个项目约束：
 *                1. 覆盖语义 = 找到同名表后清空数据区再写，不删表（删表会移位/触发确认框）；
 *                2. 一次 Range.Value2 矩形写表头与数据，避免逐格写放大成 N 次跨进程调用。
 *              WPS 任务窗格启动期不能碰 COM，本模块的函数只在按钮回调里调用。
 */

import type { WpsWorksheet, WpsCellValue, WpsWorkbook } from '../tools/wps.js'
import { columnNumberToLetter, getApp } from '../tools/util/index.js'
import { getLastRow } from '../tools/util/sheet.js'
import { SEARCH_RESULT_SHEET_NAME, resultColumnCount } from '../services/data-center-export.js'

/** 写入结果 */
export interface WriteResult {
  ok: boolean
  /** 写入的数据行数（不含表头） */
  written: number
  /** 失败原因（成功时为空） */
  error: string
}

/** 从工作簿里按名字找表（Sheets.Item 只收数字索引，故遍历比较 Name） */
function findSheetByName(workbook: WpsWorkbook, name: string): WpsWorksheet | null {
  // COM 约束：集合本身与 Count 都提到循环外，条件里只读局部变量
  const sheets = workbook.Sheets
  const sheetCount = sheets.Count
  for (let index = 1; index <= sheetCount; index += 1) {
    const sheet = sheets.Item(index)
    if (sheet.Name === name) return sheet
  }
  return null
}

/**
 * 把行数据写入当前工作簿的「搜索结果」表（同名则覆盖数据区）。
 * @param rows 二维数组，第 0 行为表头，其余为数据行
 */
export function writeRowsToResultSheet(rows: readonly (readonly WpsCellValue[])[]): WriteResult {
  const app = getApp() as { ActiveWorkbook?: WpsWorkbook | null } | null
  const workbook = app?.ActiveWorkbook ?? null
  if (workbook === null) {
    return { ok: false, written: 0, error: '未连接到 Excel，请先打开工作簿' }
  }
  if (rows.length === 0) {
    return { ok: false, written: 0, error: '没有可写入的搜索结果' }
  }

  let sheet: WpsWorksheet
  try {
    const existing = findSheetByName(workbook, SEARCH_RESULT_SHEET_NAME)
    if (existing === null) {
      sheet = workbook.Sheets.Add()
      sheet.Name = SEARCH_RESULT_SHEET_NAME
      // 移到末尾，不打乱用户原有的表顺序
      try {
        sheet.Move(null, workbook.Sheets.Item(workbook.Sheets.Count))
      } catch {
        // 移动失败不影响写入，忽略
      }
    } else {
      sheet = existing
      // 覆盖：删掉旧数据行（保留表头行），与 sync-record.ts 的清空范式一致
      const lastRow = getLastRow(sheet)
      if (lastRow > 1) {
        sheet.Range(`2:${String(lastRow)}`).Delete()
      }
    }

    const columnCount = Math.max(resultColumnCount(), ...rows.map((row) => row.length))
    const endColumn = columnNumberToLetter(columnCount)
    const endRow = rows.length
    sheet.Range(`A1:${endColumn}${String(endRow)}`).Value2 = rows.map((row) => [...row])

    // 表头加底色 + 列宽自适应（失败不影响数据）
    try {
      const headerRange = sheet.Range(`A1:${endColumn}1`)
      if (headerRange.Interior) headerRange.Interior.Color = 0x00f0f0f0
      headerRange.EntireColumn.AutoFit()
    } catch {
      // 格式设置失败忽略
    }

    return { ok: true, written: rows.length - 1, error: '' }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, written: 0, error: message }
  }
}
