/**
 * 工具模块 - 工作表读取与缓存
 * @module tools/util/sheet
 * @description 批量读取范围值、表头定位、列映射、最后行检测、缓存管理。
 *              本模块对 index.js 存在循环依赖（调用 BGM/bgmLog/getApp），仅在函数体内引用，运行时安全。
 */
import {
  LOG_LEVELS,
  PANEL_CONFIG,
  HEADER_KEYWORDS,
  COLUMN_RULES,
  STANDARD_HEADERS,
} from '../../core/constants.js'
import { colNumToLetter, trim } from '../stringUtils.js'
import type { WpsWorksheet, WpsCellValue } from '../wps.js'

// 循环依赖：仅在函数体内使用 BGM/bgmLog/getApp，运行时安全
import { getCellValue } from './cell.js'

import { BGM, bgmLog, getApp } from './index.js'
// 同目录子模块：getCellValue

/**
 * 批量读取工作表中指定范围的所有值，返回字符串二维数组 [行][列]
 * 如果读取失败则返回空数组，调用方应处理空数组情况
 * @param ws 工作表对象
 * @param startRow 起始行
 * @param endRow 结束行
 * @param startCol 起始列
 * @param endCol 结束列
 * @returns 字符串二维数组
 */
function isNativeCode(val: unknown): boolean {
  if (typeof val === 'function') {
    const str = val.toString()
    return str.includes('[native code]') || str.includes('function Value()')
  }
  if (val && typeof val === 'object') {
    const obj = val as { toString?: () => string }
    if (typeof obj.toString === 'function') {
      const str = obj.toString()
      return str.includes('[native code]') || str.includes('function Value()')
    }
  }
  return false
}

function safeCellValue(cell: unknown): string {
  if (cell == null) return ''
  if (isNativeCode(cell)) return ''
  if (typeof cell === 'function') {
    try {
      const result = (cell as () => unknown)()
      if (isNativeCode(result)) return ''
      return result == null ? '' : String(result)
    } catch {
      return ''
    }
  }
  if (cell && typeof cell === 'object') {
    const obj = cell as { toString?: () => string }
    if (obj.toString) {
      const str = obj.toString()
      if (isNativeCode(str) || isNativeCode(cell)) return ''
      return str
    }
  }
  return String(cell)
}

export function readRangeValues(
  ws: WpsWorksheet | null | undefined,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): string[][] {
  if (!ws) return []
  try {
    const range = ws.Range(
      `${colNumToLetter(startCol)}${startRow}:${colNumToLetter(endCol)}${endRow}`,
    )
    // 复用 cell.ts 中的 tryGetProperty（未导出），此处通过 range 直接访问 Value2
    const raw = (range as unknown as { Value2?: unknown }).Value2
    if (!raw) return []
    // 处理单个值的情况
    if (!Array.isArray(raw)) {
      return [[safeCellValue(raw)]]
    }
    const result: string[][] = []
    for (const row of raw) {
      if (!Array.isArray(row)) {
        result.push([safeCellValue(row)])
      } else {
        result.push(row.map((cell: unknown) => safeCellValue(cell)))
      }
    }
    return result
  } catch {
    return []
  }
}

// 缓存相关（模块级 Map）
const sheetCache = new Map<string, unknown>()

/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export function cacheGet<T>(key: string, factory: () => T): T {
  if (sheetCache.has(key)) {
    return sheetCache.get(key) as T
  }
  const value = factory()
  sheetCache.set(key, value)
  return value
}

export function findHeaderRow(ws: WpsWorksheet | null | undefined, startRow?: number): number {
  const sheetName = ws?.Name || ''
  const cacheKey = `${sheetName}:headerRow:${startRow || 1}`
  return cacheGet(cacheKey, () => {
    const sRow = startRow || 1
    for (let row = sRow; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row++) {
      let matchCount = 0
      for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col++) {
        try {
          const cellVal = String(getCellValue(ws, row, col)).toLowerCase()
          if (!cellVal) continue
          for (const header of HEADER_KEYWORDS) {
            if (cellVal.indexOf(header.toLowerCase()) >= 0) {
              matchCount++
              break
            }
          }
          if (matchCount >= 3) break
        } catch {
          // 忽略：此处无需处理错误
        }
      }
      if (matchCount >= 3) return row
    }
    return 0
  })
}

/**
 * 获取列名到列号的映射（优化版：正则规则数组 + 缓存）
 * @param ws 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列名 -> 列号
 */
export function getColumnMap(
  ws: WpsWorksheet | null | undefined,
  headerRow: number,
): Map<string, number> {
  const sheetName = ws?.Name || ''
  const cacheKey = `${sheetName}:columnMap:${headerRow}`
  return cacheGet(cacheKey, () => {
    const colMap = new Map<string, number>()
    let firstNonEmptyCol: number | undefined

    const lastCol = 50
    for (let i = 1; i <= lastCol; i++) {
      const colName = trim(String(getCellValue(ws, headerRow, i)))
      // 记录第一个非空列作为序列号列候选
      if (!firstNonEmptyCol && colName) {
        firstNonEmptyCol = i
      }
      if (!colName) continue
      for (const [pattern, key] of COLUMN_RULES) {
        if (pattern.test(colName)) {
          if (!colMap.has(key)) {
            colMap.set(key, i)
            break // 匹配到未映射的key，处理下一列
          }
          // 该key已被前面的列匹配，继续尝试其他规则
        }
      }
    }

    // 如果没有通过规则匹配到序列号列，尝试找一个未被其他 key 占用的列
    // 修复：避免将"序列号"映射到已被"是否看完"等字段占用的列，导致两个字段读取同一列
    if (!colMap.has('序列号')) {
      const mappedCols = new Set(colMap.values())
      let seqCol: number | undefined
      if (firstNonEmptyCol && !mappedCols.has(firstNonEmptyCol)) {
        // 第一个非空列未被占用，使用它
        seqCol = firstNonEmptyCol
      } else {
        // 第一个非空列已被占用，向后查找第一个未被占用的非空列
        for (let i = 1; i <= lastCol; i++) {
          if (!mappedCols.has(i)) {
            const v = trim(String(getCellValue(ws, headerRow, i)))
            if (v) {
              seqCol = i
              break
            }
          }
        }
      }
      if (seqCol) {
        colMap.set('序列号', seqCol)
        bgmLog(
          LOG_LEVELS.INFO,
          `[getColumnMap] 序列号列未匹配到表头，使用列 ${seqCol} 作为序列号列`,
        )
      }
    }

    return colMap
  })
}

/** 清除指定工作表的所有缓存 */
export function clearSheetCache(ws: WpsWorksheet | null | undefined): void {
  const prefix = ws?.Name || ''
  for (const key of sheetCache.keys()) {
    if (key.startsWith(prefix)) sheetCache.delete(key)
  }
}

/**
 * 在表头行中查找第一个匹配「序列号 / Bangumi URL / 名称 / 别名」的列索引
 * @param ws           工作表
 * @param headerRow 表头行号
 * @returns 列索引（1‑based），若未找到返回 undefined
 */
function findAnchorColumn(ws: WpsWorksheet, headerRow: number): number | undefined {
  const keywords = [
    // 序列号
    '序号',
    '编号',
    '序列号',
    '整理序号',
    'id',
    'no',
    'number',
    // Bangumi URL
    'bangumi',
    'url',
    '链接',
    '地址',
    'bgm',
    // 名称
    '名称',
    '标题',
    '作品名',
    'title',
    'name',
    // 别名
    '别名',
    '又名',
    'alias',
    'othername',
  ]
  const maxCols = 50

  for (let c = 1; c <= maxCols; c++) {
    const val = ws.Range(`${colNumToLetter(c)}${headerRow}`).Value2
    if (val == null) continue
    const text = String(val).trim().toLowerCase()
    if (keywords.some((kw) => text === kw || text.includes(kw))) {
      return c
    }
  }
  return undefined
}

/**
 * 获取工作表的最后有效数据行
 * @param ws            工作表对象（WpsWorksheet）
 * @param forceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export function getLastRow(
  ws: WpsWorksheet | null | undefined,
  forceRefresh: boolean = false,
  headerRow?: number,
): number {
  if (!ws) {
    bgmLog(LOG_LEVELS.WARN, 'getLastRow: 工作表对象无效，返回默认值 50000')
    return 50000
  }

  const sheetName = ws.Name || ''
  const cacheKey = `${sheetName}:lastRow${headerRow ? `:hr${headerRow}` : ''}`

  if (forceRefresh) {
    clearSheetCache(ws)
    bgmLog(LOG_LEVELS.INFO, '缓存已清除，重新计算最后行')
  }

  const cached = cacheGet<number>(cacheKey, () => {
    bgmLog(
      LOG_LEVELS.INFO,
      `正在计算工作表 "${sheetName}" 的最后数据行（${headerRow ? '根据表头自动选择列' : '多列回退'}）...`,
    )

    // 1. 如果提供了表头行，尝试自动选择锚定列
    if (headerRow != null && headerRow >= 1) {
      const col = findAnchorColumn(ws, headerRow)
      if (col) {
        try {
          // ✅ 修复点：使用 col 拼地址，而不是硬编码 D
          const colLetter = colNumToLetter(col)
          const cell = ws.Range(`${colLetter}${ws.Rows.Count}`)
          const endCell = cell.End(-4162)
          if (endCell && endCell.Row > 0) {
            bgmLog(
              LOG_LEVELS.INFO,
              `根据表头找到锚定列 ${col}(${colLetter})，最后行: ${endCell.Row}`,
            )
            return endCell.Row
          }
        } catch (e) {
          bgmLog(LOG_LEVELS.WARN, `锚定列 ${col} 定位失败: ${(e as Error).message}，回退到原有逻辑`)
        }
      }
    }

    // 2. 优先 D 列（常见序号列）
    try {
      const cell = ws.Range(`D${ws.Rows.Count}`)
      const endCell = cell.End(-4162)
      if (endCell && endCell.Row > 0) {
        bgmLog(LOG_LEVELS.INFO, `D列向上定位成功，最后行: ${endCell.Row}`)
        return endCell.Row
      }
    } catch (e) {
      bgmLog(LOG_LEVELS.WARN, `D列定位失败: ${(e as Error).message}`)
    }

    // 3. 尝试 A 列
    try {
      const cell = ws.Range(`A${ws.Rows.Count}`)
      const endCell = cell.End(-4162)
      if (endCell && endCell.Row > 0) {
        bgmLog(LOG_LEVELS.INFO, `A列向上定位成功，最后行: ${endCell.Row}`)
        return endCell.Row
      }
    } catch (e) {
      bgmLog(LOG_LEVELS.WARN, `A列定位失败: ${(e as Error).message}`)
    }

    // 4. UsedRange 兜底
    try {
      const usedRange = ws.UsedRange
      if (usedRange) {
        const last = usedRange.Row + usedRange.Rows.Count - 1
        if (last > 0) {
          bgmLog(LOG_LEVELS.INFO, `UsedRange 估算最后行: ${last}`)
          return last
        }
      }
    } catch (e) {
      bgmLog(LOG_LEVELS.WARN, `UsedRange 失败: ${(e as Error).message}`)
    }

    // 5. 最终默认值
    bgmLog(LOG_LEVELS.WARN, `无法确定工作表 "${sheetName}" 的最后行，使用默认值 50000`)
    return 50000
  })

  bgmLog(
    LOG_LEVELS.INFO,
    `工作表 "${sheetName}" 最后数据行: ${cached}${sheetCache.has(cacheKey) ? ' (来自缓存)' : ' (首次计算)'}`,
  )
  return cached
}

export function isEmptyValue(val: unknown): boolean {
  return (
    val === null ||
    val === undefined ||
    val === '' ||
    val === 'null' ||
    val === 'NULL' ||
    val === 'Null' ||
    val === 'undefined'
  )
}

// ========== 获取数据工作表 ==========
export function getDataSheet(): WpsWorksheet | null | undefined {
  const app = getApp()
  if (!app || !app.ActiveWorkbook) return null

  bgmLog(
    LOG_LEVELS.INFO,
    `getDataSheet: isLocked=${BGM.sheet.isLocked}, lockedIndex=${BGM.sheet.lockedIndex}, lockedWorkbook=${BGM.sheet.lockedWorkbookName}`,
  )

  if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
    try {
      // 如果锁定的是特定工作簿，先尝试查找该工作簿
      let targetWb = app.ActiveWorkbook
      if (BGM.sheet.lockedWorkbookName) {
        const wbs = app.Workbooks
        if (wbs) {
          for (let i = 1; i <= wbs.Count; i++) {
            const wb = wbs.Item(i)
            if (wb.Name === BGM.sheet.lockedWorkbookName) {
              targetWb = wb
              break
            }
          }
        }
      }

      const ws = targetWb.Worksheets.Item(BGM.sheet.lockedIndex)
      bgmLog(
        LOG_LEVELS.INFO,
        `getDataSheet: 返回锁定的工作表: ${ws.Name}（工作簿: ${targetWb.Name}）`,
      )
      return ws
    } catch (e: unknown) {
      bgmLog(LOG_LEVELS.WARN, 'getDataSheet 锁定工作表失败: ' + (e as Error).message)
    }
  }

  const ws = app.ActiveWorkbook.ActiveSheet
  bgmLog(LOG_LEVELS.INFO, `getDataSheet: 返回当前活动工作表: ${ws.Name}`)
  return ws
}

export function safeActivate(ws: WpsWorksheet | null | undefined): void {
  if (ws && typeof ws.Activate === 'function') {
    ws.Activate()
  } else {
    bgmLog(LOG_LEVELS.WARN, 'safeActivate: 无法激活工作表')
  }
}

/**
 * 检查工作表是否为空（无表头行），若是则写入标准表头
 *
 * 判定逻辑：findHeaderRow() 返回 0（前 10 行未匹配到 ≥3 个关键字）。
 * 写入位置：第 1 行，按 STANDARD_HEADERS 顺序逐列写入。
 * 写入后清除缓存，确保后续 getColumnMap / findHeaderRow 能读到新表头。
 *
 * @param ws 工作表对象
 * @returns true 表示已填充表头（原为空表），false 表示已有表头无需填充
 */
export function ensureSheetHeaders(ws: WpsWorksheet | null | undefined): boolean {
  if (!ws) {
    bgmLog(LOG_LEVELS.WARN, '[ensureSheetHeaders] 工作表无效')
    return false
  }

  const headerRow = findHeaderRow(ws)
  if (headerRow > 0) {
    bgmLog(LOG_LEVELS.INFO, `[ensureSheetHeaders] 已有表头行 ${headerRow}，无需填充`)
    return false
  }

  bgmLog(LOG_LEVELS.INFO, '[ensureSheetHeaders] 工作表为空，开始写入标准表头（39 列）')

  // 逐列写入表头
  let writeCount = 0
  let failCount = 0
  const failCols: number[] = []
  for (let i = 0; i < STANDARD_HEADERS.length; i++) {
    const header = STANDARD_HEADERS[i]
    if (header !== undefined) {
      const ok = setCellValueDirect(ws, 1, i + 1, header)
      if (ok) {
        writeCount++
      } else {
        failCount++
        failCols.push(i + 1)
      }
    }
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[ensureSheetHeaders] 写入完成：成功 ${writeCount} 列，失败 ${failCount} 列`,
  )

  if (failCount > 0) {
    bgmLog(
      LOG_LEVELS.ERROR,
      `[ensureSheetHeaders] 表头写入失败列：${failCols.join(',')}，前 5 列失败无法继续`,
    )
    // 前 5 列（序列号/是否看完/看完时间/开播季度/开播日期）是后续同步的关键字段，
    // 如果这些列写入失败，整个同步流程无法继续，直接返回 false
    if (failCols.some((c) => c <= 5)) {
      bgmLog(LOG_LEVELS.ERROR, '[ensureSheetHeaders] 关键列写入失败，返回 false')
      return false
    }
  }

  // 验证写入：读回第 25 列（Bangumi URL）确认写入成功
  const verifyVal = getCellValue(ws, 1, 25)
  bgmLog(LOG_LEVELS.INFO, `[ensureSheetHeaders] 验证第25列读回: "${verifyVal}"`)
  if (!verifyVal) {
    bgmLog(LOG_LEVELS.ERROR, '[ensureSheetHeaders] 表头写入验证失败，第25列为空')
  }

  // 设置表头行样式：灰色背景 + 加粗
  try {
    const lastColLetter = colNumToLetter(STANDARD_HEADERS.length)
    const headerRange = ws.Range(`A1:${lastColLetter}1`)
    if (headerRange?.Font) {
      headerRange.Font.Bold = true
    }
    if (headerRange?.Interior) {
      headerRange.Interior.Color = 0xd3d3d3 // GRAY
    }
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[ensureSheetHeaders] 设置表头样式失败: ${(e as Error).message}`)
  }

  // 清除缓存，确保后续读取能拿到新表头
  clearSheetCache(ws)
  // 验证 findHeaderRow 是否能识别新表头
  const newHeaderRow = findHeaderRow(ws)
  bgmLog(
    LOG_LEVELS.INFO,
    `[ensureSheetHeaders] 缓存已清除，findHeaderRow 重新检测: ${newHeaderRow}`,
  )
  if (newHeaderRow !== 1) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[ensureSheetHeaders] findHeaderRow 返回 ${newHeaderRow}（预期 1），表头关键字匹配可能失败`,
    )
  }
  bgmLog(LOG_LEVELS.INFO, '[ensureSheetHeaders] 标准表头写入完成')
  return true
}

/**
 * 直接写入单元格值（绕过 undo 记录，仅供表头初始化使用）
 *
 * 使用 Formula 而非 Value/Value2，因为 WPS 的 COM 桥接层对 Range 对象的
 * Value/Value2 setter 设置了不可配置属性拦截，会抛出 "Cannot redefine property: Value"。
 * Formula 是 WPS/Excel 的原生内容属性，走不同的内部路径，不受此限制。
 *
 * 多重回退策略：
 *   1. Formula（首选，不同属性路径）
 *   2. Value2（回退，与 setCellValue 保持一致）
 *   3. Value（最终回退）
 *
 * @returns true 写入成功，false 写入失败
 */
function setCellValueDirect(ws: WpsWorksheet, row: number, col: number, value: string): boolean {
  const address = colNumToLetter(col) + row

  // 方案 1: Cells.Item(row, col) + FormulaR1C1
  // 完全不同的 COM 路径（Cells.Item 而非 Range）+ 不同属性（FormulaR1C1 而非 Formula/Value/Value2），
  // 最大概率绕过 WPS COM 桥接层 Proxy 拦截。
  try {
    const cell = ws.Cells.Item(row, col)
    if (cell) {
      cell.FormulaR1C1 = value
      return true
    }
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Cells.FormulaR1C1 (${row},${col}) 失败: ${(e as Error).message}`,
    )
  }

  // 方案 2: Range + Formula（不同属性路径，不受 Value/Value2 拦截影响）
  try {
    const cell = ws.Range(address)
    if (cell) {
      cell.Formula = value
      return true
    }
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.Formula (${row},${col}) 失败: ${(e as Error).message}`,
    )
  }

  // 方案 3: Range + FormulaR1C1（不同属性路径）
  try {
    const cell = ws.Range(address)
    if (cell) {
      cell.FormulaR1C1 = value
      return true
    }
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.FormulaR1C1 (${row},${col}) 失败: ${(e as Error).message}`,
    )
  }

  // 方案 4: Range + Value2（回退）
  try {
    const cell = ws.Range(address)
    if (cell) {
      cell.Value2 = value as WpsCellValue
      return true
    }
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.Value2 (${row},${col}) 失败: ${(e as Error).message}`,
    )
  }

  // 方案 5: Range + Value（最终回退）
  try {
    const cell = ws.Range(address)
    if (cell) {
      cell.Value = value as WpsCellValue
      return true
    }
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.Value (${row},${col}) 失败: ${(e as Error).message}`,
    )
  }

  bgmLog(LOG_LEVELS.ERROR, `[setCellValueDirect] 所有写入方式均失败 (${row},${col})`)
  return false
}
