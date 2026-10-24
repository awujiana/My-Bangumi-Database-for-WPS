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

import { bgmLog, getApp } from './util/index.js'
import { LOG_LEVELS } from '../core/constants.js'
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

/**
 * 枚举已打开工作簿的全部工作表（Count 提循环外，守 com-in-loop）
 *
 * **COM 防护**（2026-10-24 真机缺陷修复）：宿主初始化窗口内（或 JSAPI 桥未就绪 /
 * 被调速器限速时）同步跨进程 COM 会抛错。此前的实现对 `Workbooks.Count/Item` 零防护，
 * 一抛就顺着调用链把页面初始化炸掉——条件格式页的下拉因此永远绑不上事件
 * （「不能点击不能选中」）。现在整段兜底：抛错时返回**已枚举到的部分**并记 WARN，
 * 调用方渲染部分列表 + 刷新按钮，用户点一下就能恢复。
 */
export function collectSheets(): SheetEntry[] {
  const entries: SheetEntry[] = []
  try {
    const app = getApp() as {
      Workbooks?: { Count: number; Item(index: number): unknown }
    } | null
    const workbooks = app?.Workbooks
    if (!workbooks) return entries

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.WARN, `[sheetList] 工作簿枚举中断（已拿到 ${String(entries.length)} 张表）：${message}`)
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
