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
import { colNumToLetter as colNumberToLetter, trim } from '../stringUtils.js'
import type { WpsWorksheet } from '../wps.js'

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
    const string_ = val.toString()
    return string_.includes('[native code]') || string_.includes('function Value()')
  }
  if (val && typeof val === 'object') {
    const object = val as { toString?: () => string }
    if (typeof object.toString === 'function') {
      const string_ = object.toString()
      return string_.includes('[native code]') || string_.includes('function Value()')
    }
  }
  return false
}

/**
 * 将 WPS 桥接层返回的未知值安全转换为字符串：
 * - null/undefined 返回空串
 * - 原生代码对象（WPS 内部 Proxy）返回空串
 * - 对象仅当其自带可调用 toString 时才序列化，否则返回空串
 * - 其余基本类型（string/number/boolean/symbol/bigint/function）按 String() 语义转换
 */
function safeStringify(value: unknown): string {
  if (value == null) return ''
  if (isNativeCode(value)) return ''
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol' ||
    typeof value === 'function'
  ) {
    return String(value)
  }
  // 对象类型：仅当自带可调用 toString 时才序列化，否则返回空串
  const object = value as { toString?: () => string }
  if (typeof object.toString === 'function') {
    const string_ = object.toString()
    if (isNativeCode(string_)) return ''
    return string_
  }
  return ''
}

function safeCellValue(cell: unknown): string {
  if (cell == null) return ''
  // 原生代码对象/函数（WPS 内部 Proxy、mock 的 native 函数）直接返回空串，不调用
  if (isNativeCode(cell)) return ''
  if (typeof cell === 'function') {
    try {
      return safeStringify((cell as () => unknown)())
    } catch {
      return ''
    }
  }
  return safeStringify(cell)
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
      `${colNumberToLetter(startCol)}${String(startRow)}:${colNumberToLetter(endCol)}${String(endRow)}`,
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
  const cacheKey = `${sheetName}:headerRow:${String(startRow || 1)}`
  return cacheGet(cacheKey, () => {
    const sRow = startRow || 1
    for (let row = sRow; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
      let matchCount = 0
      for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col += 1) {
        try {
          const cellValue = getCellValue(ws, row, col).toLowerCase()
          if (!cellValue) continue
          for (const header of HEADER_KEYWORDS) {
            if (cellValue.includes(header.toLowerCase())) {
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
  const cacheKey = `${sheetName}:columnMap:${String(headerRow)}`
  return cacheGet(cacheKey, () => {
    const colMap = new Map<string, number>()
    let firstNonEmptyCol: number | undefined

    const lastCol = 50
    for (let index = 1; index <= lastCol; index += 1) {
      const colName = trim(getCellValue(ws, headerRow, index))
      // 记录第一个非空列作为序列号列候选
      if (!firstNonEmptyCol && colName) {
        firstNonEmptyCol = index
      }
      if (!colName) continue
      for (const [pattern, key] of COLUMN_RULES) {
        if (pattern.test(colName)) {
          if (!colMap.has(key)) {
            colMap.set(key, index)
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
        for (let index = 1; index <= lastCol; index += 1) {
          if (!mappedCols.has(index)) {
            const v = trim(getCellValue(ws, headerRow, index))
            if (v) {
              seqCol = index
              break
            }
          }
        }
      }
      if (seqCol) {
        colMap.set('序列号', seqCol)
        bgmLog(
          LOG_LEVELS.INFO,
          `[getColumnMap] 序列号列未匹配到表头，使用列 ${String(seqCol)} 作为序列号列`,
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

  for (let c = 1; c <= maxCols; c += 1) {
    const value = ws.Range(`${colNumberToLetter(c)}${String(headerRow)}`).Value2
    if (value == null) continue
    const text = String(value).trim().toLowerCase()
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
  forceRefresh = false,
  headerRow?: number,
): number {
  if (!ws) {
    bgmLog(LOG_LEVELS.WARN, 'getLastRow: 工作表对象无效，返回默认值 50000')
    return 50_000
  }

  const sheetName = ws.Name || ''
  const cacheKey = `${sheetName}:lastRow${headerRow ? `:hr${String(headerRow)}` : ''}`

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
          const colLetter = colNumberToLetter(col)
          const cell = ws.Range(`${colLetter}${String(ws.Rows.Count)}`)
          const endCell = cell.End(-4162)
          if (endCell.Row > 0) {
            bgmLog(
              LOG_LEVELS.INFO,
              `根据表头找到锚定列 ${String(col)}(${colLetter})，最后行: ${String(endCell.Row)}`,
            )
            return endCell.Row
          }
        } catch (error) {
          bgmLog(
            LOG_LEVELS.WARN,
            `锚定列 ${String(col)} 定位失败: ${(error as Error).message}，回退到原有逻辑`,
          )
        }
      }
    }

    // 2. 优先 D 列（常见序号列）
    try {
      const cell = ws.Range(`D${String(ws.Rows.Count)}`)
      const endCell = cell.End(-4162)
      if (endCell.Row > 0) {
        bgmLog(LOG_LEVELS.INFO, `D列向上定位成功，最后行: ${String(endCell.Row)}`)
        return endCell.Row
      }
    } catch (error) {
      bgmLog(LOG_LEVELS.WARN, `D列定位失败: ${(error as Error).message}`)
    }

    // 3. 尝试 A 列
    try {
      const cell = ws.Range(`A${String(ws.Rows.Count)}`)
      const endCell = cell.End(-4162)
      if (endCell.Row > 0) {
        bgmLog(LOG_LEVELS.INFO, `A列向上定位成功，最后行: ${String(endCell.Row)}`)
        return endCell.Row
      }
    } catch (error) {
      bgmLog(LOG_LEVELS.WARN, `A列定位失败: ${(error as Error).message}`)
    }

    // 4. UsedRange 兜底
    try {
      const usedRange = ws.UsedRange
      if (usedRange) {
        const last = usedRange.Row + usedRange.Rows.Count - 1
        if (last > 0) {
          bgmLog(LOG_LEVELS.INFO, `UsedRange 估算最后行: ${String(last)}`)
          return last
        }
      }
    } catch (error) {
      bgmLog(LOG_LEVELS.WARN, `UsedRange 失败: ${(error as Error).message}`)
    }

    // 5. 最终默认值
    bgmLog(LOG_LEVELS.WARN, `无法确定工作表 "${sheetName}" 的最后行，使用默认值 50000`)
    return 50_000
  })

  bgmLog(
    LOG_LEVELS.INFO,
    `工作表 "${sheetName}" 最后数据行: ${String(cached)}${sheetCache.has(cacheKey) ? ' (来自缓存)' : ' (首次计算)'}`,
  )
  return cached
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    value === 'null' ||
    value === 'NULL' ||
    value === 'Null' ||
    value === 'undefined'
  )
}

// ========== 获取数据工作表 ==========
export function getDataSheet(): WpsWorksheet | null | undefined {
  const app = getApp()
  if (!app?.ActiveWorkbook) return null

  if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
    try {
      // 如果锁定的是特定工作簿，先尝试查找该工作簿
      let targetWb = app.ActiveWorkbook
      if (BGM.sheet.lockedWorkbookName) {
        const wbs = app.Workbooks
        if (wbs) {
          for (let index = 1; index <= wbs.Count; index += 1) {
            const wb = wbs.Item(index)
            if (wb.Name === BGM.sheet.lockedWorkbookName) {
              targetWb = wb
              break
            }
          }
        }
      }

      const ws = targetWb.Worksheets.Item(BGM.sheet.lockedIndex)
      return ws
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.WARN, `getDataSheet 锁定工作表失败: ${(error as Error).message}`)
    }
  }

  const ws = app.ActiveWorkbook.ActiveSheet
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
    bgmLog(LOG_LEVELS.INFO, `[ensureSheetHeaders] 已有表头行 ${String(headerRow)}，无需填充`)
    return false
  }

  bgmLog(LOG_LEVELS.INFO, '[ensureSheetHeaders] 工作表为空，开始写入标准表头（39 列）')

  // 逐列写入表头
  let writeCount = 0
  let failCount = 0
  const failCols: number[] = []
  for (let index = 0; index < STANDARD_HEADERS.length; index += 1) {
    const header = STANDARD_HEADERS[index]
    if (header !== undefined) {
      const ok = setCellValueDirect(ws, 1, index + 1, header)
      if (ok) {
        writeCount++
      } else {
        failCount++
        failCols.push(index + 1)
      }
    }
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[ensureSheetHeaders] 写入完成：成功 ${String(writeCount)} 列，失败 ${String(failCount)} 列`,
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
  const verifyValue = getCellValue(ws, 1, 25)
  bgmLog(LOG_LEVELS.INFO, `[ensureSheetHeaders] 验证第25列读回: "${verifyValue}"`)
  if (!verifyValue) {
    bgmLog(LOG_LEVELS.ERROR, '[ensureSheetHeaders] 表头写入验证失败，第25列为空')
  }

  // 清除缓存，确保后续读取能拿到新表头
  clearSheetCache(ws)
  // 验证 findHeaderRow 是否能识别新表头
  const newHeaderRow = findHeaderRow(ws)
  bgmLog(
    LOG_LEVELS.INFO,
    `[ensureSheetHeaders] 缓存已清除，findHeaderRow 重新检测: ${String(newHeaderRow)}`,
  )
  if (newHeaderRow !== 1) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[ensureSheetHeaders] findHeaderRow 返回 ${String(newHeaderRow)}（预期 1），表头关键字匹配可能失败`,
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
  const address = colNumberToLetter(col) + String(row)

  // 方案 1: Cells.Item(row, col) + FormulaR1C1
  // 完全不同的 COM 路径（Cells.Item 而非 Range）+ 不同属性（FormulaR1C1 而非 Formula/Value/Value2），
  // 最大概率绕过 WPS COM 桥接层 Proxy 拦截。
  try {
    const cell = ws.Cells.Item(row, col)
    cell.FormulaR1C1 = value
    return true
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Cells.FormulaR1C1 (${String(row)},${String(col)}) 失败: ${(error as Error).message}`,
    )
  }

  // 方案 2: Range + Formula（不同属性路径，不受 Value/Value2 拦截影响）
  try {
    const cell = ws.Range(address)
    cell.Formula = value
    return true
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.Formula (${String(row)},${String(col)}) 失败: ${(error as Error).message}`,
    )
  }

  // 方案 3: Range + FormulaR1C1（不同属性路径）
  try {
    const cell = ws.Range(address)
    cell.FormulaR1C1 = value
    return true
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.FormulaR1C1 (${String(row)},${String(col)}) 失败: ${(error as Error).message}`,
    )
  }

  // 方案 4: Range + Value2（回退）
  try {
    const cell = ws.Range(address)
    cell.Value2 = value
    return true
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.Value2 (${String(row)},${String(col)}) 失败: ${(error as Error).message}`,
    )
  }

  // 方案 5: Range + Value（最终回退）
  try {
    const cell = ws.Range(address)
    cell.Value = value
    return true
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[setCellValueDirect] Range.Value (${String(row)},${String(col)}) 失败: ${(error as Error).message}`,
    )
  }

  bgmLog(
    LOG_LEVELS.ERROR,
    `[setCellValueDirect] 所有写入方式均失败 (${String(row)},${String(col)})`,
  )
  return false
}
