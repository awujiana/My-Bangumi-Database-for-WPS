/**
 * 工具模块 - 单元格操作
 * @module tools/util/cell
 * @description 单元格读取、设置、属性探测等底层操作。
 *              本模块对 index.js 存在循环依赖（setCellValue 调用 BGM.handleError），
 *              但仅在函数体内引用，运行时安全。
 */
import { LOG_LEVELS } from '../../core/constants.js'
import { colNumToLetter } from '../stringUtils.js'
import type { WpsWorksheet, WpsRange, WpsCellValue } from '../wps.js'

// 循环依赖：仅在函数体内使用 BGM.handleError / bgmLog / getApp，运行时安全
import { BGM, bgmLog, getApp } from './index.js'

// ========== 单元格操作 ==========
export function getCell(
  ws: WpsWorksheet | null | undefined,
  row: number,
  col: number,
): WpsRange | null {
  if (!ws) return null
  const address = colNumToLetter(col) + String(row)
  return ws.Range(address)
}

// 内部辅助函数，不导出
/**
 * 安全地获取对象属性值，处理属性值为函数的情况
 * @param cell - 要获取属性的对象
 * @param prop - 属性名称
 * @returns 属性的值；如果属性不存在或访问失败，则返回 undefined
 */
function tryGetProperty(cell: unknown, prop: string): unknown {
  if (cell == null || typeof cell !== 'object') return undefined
  const obj = cell as Record<string, unknown>
  if (!(prop in obj)) return undefined
  try {
    const val = obj[prop]
    if (typeof val === 'function') {
      try {
        const result = (val as () => unknown)()
        if (typeof result === 'function' && result.toString().includes('[native code]')) {
          return undefined
        }
        return result
      } catch {
        return undefined
      }
    }
    if (val && typeof val === 'object') {
      const valObj = val as { toString?: () => string }
      if (typeof valObj.toString === 'function') {
        const str = valObj.toString()
        if (str.includes('function') || str.includes('[native code]')) {
          return undefined
        }
      }
    }
    return val
  } catch {
    return undefined
  }
}

// 内部辅助函数，不导出
/**
 * 获取单元格的原始值，按优先级尝试 Value2、Value 和 Text 属性
 * @param cell - 单元格对象
 * @returns 单元格的原始值；如果单元格无效或没有值，则返回 null
 */
function getCellRawValue(cell: WpsRange | null | undefined): unknown {
  if (!cell) return null
  const val2 = tryGetProperty(cell, 'Value2')
  if (val2 !== undefined && val2 !== null) return val2
  const val = tryGetProperty(cell, 'Value')
  if (val !== undefined && val !== null) return val
  const text = tryGetProperty(cell, 'Text')
  if (text !== undefined && text !== null) return text
  return null
}

/**
 * 获取单元格的值
 * @param ws - 工作表对象，可能为 null 或 undefined
 * @param row - 行号
 * @param col - 列号
 * @returns 单元格的字符串值；如果工作表无效或单元格不存在，则返回空字符串
 */
export function getCellValue(
  ws: WpsWorksheet | null | undefined,
  row: number,
  col: number,
): string {
  if (!ws) return ''
  try {
    const address = colNumToLetter(col) + String(row)
    const cell = ws.Range(address)
    const raw = getCellRawValue(cell)
    if (raw == null) return ''
    // 单元格原始值通常为 string/number/boolean；罕见对象值沿用 String() 的默认转换语义
    const rawText = raw as string | number | boolean
    return String(rawText)
  } catch {
    return ''
  }
}

/**
 * 设置单元格值
 */
export function setCellValue(
  ws: WpsWorksheet | null | undefined,
  row: number,
  col: number,
  value: unknown,
): boolean {
  try {
    const cell = getCell(ws, row, col)
    if (!cell) {
      bgmLog(LOG_LEVELS.ERROR, `setCellValue - 无法获取单元格: (${String(row)}, ${String(col)})`)
      return false
    }
    cell.Value2 = value as WpsCellValue
    return true
  } catch (e) {
    BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'setCellValue' })
  }
  return false
}

/**
 * 获取工作表对象
 */
export function getSheetByIndex(sheetIndex: number): unknown {
  const appObj = getApp() as
    | {
        ActiveWorkbook?: { Sheets?: { Count: number; Item: (i: number) => unknown } }
      }
    | null
    | undefined
  if (!appObj?.ActiveWorkbook?.Sheets) return null
  const sheets = appObj.ActiveWorkbook.Sheets
  if (sheets.Count === 0) return null
  try {
    return sheets.Item(sheetIndex)
  } catch {
    return undefined
  }
}
