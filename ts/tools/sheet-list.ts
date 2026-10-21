/**
 * @fileoverview 工作簿 / 工作表枚举（多页共用的轻量 COM 只读工具）
 * @module tools/sheetList
 * @description 枚举已打开工作簿的全部工作表，并取当前活动工作表。
 *   抽自条件格式页与高亮页各自重复的实现，统一为单点。
 *
 * 注意：这些是**轻量 COM**——只读工作簿/工作表名，不读单元格数据，
 * 落在宿主初始化窗口里也只是秒级（实测条件格式页秒开）。真正的重活
 * （读整表数据 / Range 大读）不在此处，由各页面显式触发。
 */

import { getApp } from './util/index.js'
import type { WpsWorksheet } from './wps.js'

/** 工作表枚举项：稳定键 = 工作簿名::工作表名 */
export interface SheetEntry {
  /** 稳定键：工作簿名::工作表名 */
  key: string
  workbook: string
  sheet: string
  worksheet: WpsWorksheet
}

interface WorkbookLike {
  Name: string
  Worksheets?: { Count: number; Item(index: number): unknown }
}

function readSheetName(worksheet: unknown): string {
  try {
    return (worksheet as { Name?: string }).Name ?? ''
  } catch {
    return ''
  }
}

/** 枚举已打开工作簿的全部工作表（Count 提循环外，守 com-in-loop） */
export function collectSheets(): SheetEntry[] {
  const app = getApp() as {
    Workbooks?: { Count: number; Item(index: number): unknown }
  } | null
  const workbooks = app?.Workbooks
  if (!workbooks) return []

  const entries: SheetEntry[] = []
  const wbCount = workbooks.Count
  for (let wbIndex = 1; wbIndex <= wbCount; wbIndex += 1) {
    const wb = workbooks.Item(wbIndex) as WorkbookLike
    const sheets = wb.Worksheets
    if (sheets) {
      const sheetCount = sheets.Count
      for (let sheetIndex = 1; sheetIndex <= sheetCount; sheetIndex += 1) {
        const worksheet = sheets.Item(sheetIndex) as WpsWorksheet
        const sheet = readSheetName(worksheet)
        if (sheet) {
          entries.push({ key: `${wb.Name}::${sheet}`, workbook: wb.Name, sheet, worksheet })
        }
      }
    }
  }
  return entries
}

/**
 * 取当前活动工作表对象（用于「默认选中活动表」）
 *
 * 走 `Application.ActiveSheet`；部分版本只暴露 `ActiveWorkbook.ActiveSheet`，
 * 两条都试。取不到返回 null（调用方退回首张表，不报错）。
 */
export function activeWorksheet(): WpsWorksheet | null {
  const app = getApp() as {
    ActiveSheet?: WpsWorksheet
    ActiveWorkbook?: { ActiveSheet?: WpsWorksheet }
  } | null
  try {
    return app?.ActiveSheet ?? app?.ActiveWorkbook?.ActiveSheet ?? null
  } catch {
    return null
  }
}
