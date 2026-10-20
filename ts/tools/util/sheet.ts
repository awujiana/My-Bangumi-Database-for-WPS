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
import { colNumberToLetter, trim } from '../string-utilities.js'
import type { WpsCellValue, WpsWorksheet } from '../wps.js'

// 循环依赖：仅在函数体内使用 BGM/bgmLog/getApp，运行时安全
import { getCellValue, setCellValue } from './cell.js'

import { BGM, bgmLog, getApp } from './index.js'
// 同目录子模块：getCellValue

/**
 * 批量读取工作表中指定范围的所有值，返回字符串二维数组 [行][列]
 * 如果读取失败则返回空数组，调用方应处理空数组情况
 * @param worksheet 工作表对象
 * @param startRow 起始行
 * @param endRow 结束行
 * @param startCol 起始列
 * @param endCol 结束列
 * @returns 字符串二维数组
 */
function isNativeCode(value: unknown): boolean {
  if (typeof value === 'function') {
    const string_ = value.toString()
    return string_.includes('[native code]') || string_.includes('function Value()')
  }
  if (value && typeof value === 'object') {
    const object = value as { toString?: () => string }
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

/**
 * 将 WPS 桥接层返回的未知值按**原始类型**保留为 `WpsCellValue`：
 * - null/undefined / 原生代码对象（WPS 内部 Proxy）/ 函数 → `null`
 *   （返回 `null` 而非 `''`，避免读-改-写整行时把数字列覆盖成文本列）
 * - string / number / boolean / Date → 原样保留
 * 与 `safeCellValue`（一律 `String()` 化）形成对照：本函数用于需要保持
 * 单元格原始类型的场景（如「已存在 SID 的逐字段更新」整行读-改-写）。
 */
function preserveCellValue(cell: unknown): WpsCellValue {
  if (cell == null) return null
  if (isNativeCode(cell)) return null
  if (typeof cell === 'function') return null
  if (
    typeof cell === 'string' ||
    typeof cell === 'number' ||
    typeof cell === 'boolean' ||
    cell instanceof Date
  ) {
    return cell
  }
  return null
}

/**
 * 把 COM `Value2` 的返回值按「**请求的矩形形状**」归一成二维数组 [行][列]
 *
 * ⚠️ WPS / Excel 的 `Range.Value2` 形状随范围变化，且**不保证是二维**：
 *   - 单单元格   → 标量
 *   - 单行多列   → **一维**数组（该行的全部单元格）
 *   - 多行多列   → 二维数组
 *
 * 旧实现遇到一维数组时逐标量 `push([v])`，把「1 行 N 列」读成「N 行 1 列」——
 * 单行读-改-写场景下只拿得到第 1 个单元格，写回时 2..N 列被空值填满，
 * **静默清空用户数据**（同步记录整行更新、新列写回校验等均走这条路径）。
 *
 * 判据用**请求形状**而非「数组第 0 项是否也是数组」：
 *   - 请求单行 → 一维即该行
 *   - 请求单列 → 一维即该列（列向量）
 *   - 请求多行多列却拿到一维 → 形状不可信，返回 `null`（调用方必须放弃写入）
 *
 * @param raw `Range.Value2` 的返回值
 * @param rowCount 请求的行数（endRow - startRow + 1）
 * @param colCount 请求的列数（endCol - startCol + 1）
 * @returns 二维数组；形状不可信时返回 `null`
 */
function normalizeValue2Shape(
  raw: unknown,
  rowCount: number,
  colCount: number,
): unknown[][] | null {
  // 单单元格：宿主返回标量
  if (!Array.isArray(raw)) return [[raw]]
  if (raw.length === 0) return []
  if (Array.isArray(raw[0])) return raw as unknown[][]
  // 一维数组：按请求形状决定它是「一行」还是「一列」
  if (rowCount === 1) return [raw as unknown[]]
  if (colCount === 1) return (raw as unknown[]).map((cell) => [cell])
  // 请求多行多列却拿回一维：无法判定归属，宁可判为读取失败
  return null
}

/**
 * 矩形读的唯一实现：取 `Range.Value2` → 按请求形状归一 → 逐格转换。
 *
 * `readRangeValues`（一律 String 化）与 `readRangeCellValues`（保留原始类型）共用本函数，
 * 只差最后的 `convert`，避免两份 90% 相同的实现各自漂移。
 *
 * 形状守卫（行数/列宽对不上、请求多行多列却读回一维）一律按**读取失败**返回 `null`：
 * 宁可让调用方回退或放弃写入，也不猜形状——猜错就是静默清数据。
 *
 * @returns 二维数组 [行][列]；读取失败时 `null`
 */
function readRect<T>(
  worksheet: WpsWorksheet | null | undefined,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
  convert: (cell: unknown) => T,
): T[][] | null {
  if (!worksheet) return null
  try {
    const range = worksheet.Range(
      `${colNumberToLetter(startCol)}${String(startRow)}:${colNumberToLetter(endCol)}${String(endRow)}`,
    )
    // WpsRange 已声明 Value2?: WpsCellValue | WpsCellValue[][]，不需要 as unknown as
    // 双重强转——那会丢掉声明类型、迫使下游全量 unknown 防御。
    const raw: unknown = range.Value2
    if (!raw) return null
    const rowCount = endRow - startRow + 1
    const colCount = endCol - startCol + 1
    const rows = normalizeValue2Shape(raw, rowCount, colCount)
    // 形状不可信（请求多行多列却读回一维）：按读取失败处理，绝不猜形状
    if (!rows) return null
    // 单行读回宽度不足 ⇒ 后续「读-改-写」会把缺失列写成空值，等于静默清数据；
    // 按读取失败处理（与 githubSync 的不变式一致）。
    if (rowCount === 1 && (rows[0]?.length ?? 0) < colCount) return null
    return rows.map((row) => row.map((cell) => convert(cell)))
  } catch {
    return null
  }
}

/**
 * 批量读取工作表中指定范围的值（一律 `String()` 化），返回二维数组 [行][列]。
 *
 * 读取失败返回空数组——调用方**必须**据此放弃写入，绝不能拿空数组覆盖整行。
 */
export function readRangeValues(
  worksheet: WpsWorksheet | null | undefined,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): string[][] {
  return readRect(worksheet, startRow, endRow, startCol, endCol, safeCellValue) ?? []
}

/**
 * 离散行矩形读缓存允许的最大行跨度。
 *
 * 超过此跨度就不做整段矩形读：极端情况下（首尾行相隔几万行）一次拉回的数组
 * 既占内存又无必要，回退逐格读更稳。
 */
const ROWS_CACHE_MAX_SPAN = 20_000

/**
 * 工作表单元格会话缓存（**写穿透**）。
 *
 * 面向「同一单元格在一次任务里被多次读、且读之间夹着写」的 COM 热点：
 * 典型如富化链——`enrichIntroData` 写「特点」列后 `enrichOpEdPv` 会再读同一格。
 * 只读缓存在这里会拿到**写前旧值**导致合并出错，因此写必须同步更新缓存。
 */
export interface SheetCellCache {
  /**
   * 读单元格：命中缓存直接返回（写后读拿到的是新值）；
   * 未命中回落 `getCellValue` 并回填缓存。
   */
  read(row: number, col: number): string
  /**
   * 写单元格：**先写 COM**，成功后才更新缓存。
   * 写抛错时不更新缓存——缓存保持与工作表一致（旧值仍是表里的真实值）。
   */
  write(row: number, col: number, value: string): void
}

/**
 * 缓存的后备单元格 IO。
 *
 * 默认用真实 COM 封装；**可注入**是为了让调用方把自身依赖路径上的读写函数
 * 传进来（典型：调用方从 barrel 导入、测试对 barrel 做 mock）——
 * 本模块内部的 cell.js 导入是测试 mock 不到的，直接用会让测试里的读写
 * 打到无宿主的真实封装上（写变 no-op）。
 */
export interface SheetCellIo {
  read(worksheet: WpsWorksheet, row: number, col: number): string
  write(worksheet: WpsWorksheet, row: number, col: number, value: string): void
}

const realCellIo: SheetCellIo = {
  read: (worksheet, row, col) => getCellValue(worksheet, row, col),
  write: (worksheet, row, col, value) => {
    setCellValue(worksheet, row, col, value)
  },
}

/**
 * 建一个写穿透单元格缓存：先用 `readRowsCache` 做一次矩形读播种
 * （O(行×列) 次跨进程往返 → 1 次），之后读命中缓存、写穿透更新。
 *
 * 适用条件与 `readRowsCache` 相同：任务期间这些行不发生插入/删除位移。
 * 播种失败（跨度过大 / 宿主返回形状不符）时不播种——读写全部回落逐格路径，
 * 行为与不建缓存一致（只是没有加速）。
 *
 * @param worksheet 工作表
 * @param rows 预计会访问的行号（可离散；循环中动态新增的行不在此列也能用——
 *   未播种的行首次读回落 `getCellValue` 并回填）
 * @param maxCol 预计会访问的最大列号（超出列的访问同样回落逐格读）
 * @param io 后备单元格 IO（默认真实 COM 封装；见 {@link SheetCellIo}）
 */
export function createSheetCellCache(
  worksheet: WpsWorksheet,
  rows: readonly number[],
  maxCol: number,
  io: SheetCellIo = realCellIo,
): SheetCellCache {
  const cells = new Map<string, string>()
  const seeded = readRowsCache(worksheet, rows, maxCol)
  if (seeded) {
    for (const [row, line] of seeded) {
      for (let col = 1; col <= maxCol; col += 1) {
        cells.set(`${String(row)}:${String(col)}`, line[col - 1] ?? '')
      }
    }
  }
  return {
    read(row: number, col: number): string {
      const key = `${String(row)}:${String(col)}`
      const hit = cells.get(key)
      if (hit !== undefined) return hit
      const value = io.read(worksheet, row, col)
      cells.set(key, value)
      return value
    },
    write(row: number, col: number, value: string): void {
      io.write(worksheet, row, col, value)
      cells.set(`${String(row)}:${String(col)}`, value)
    },
  }
}

/**
 * 为「一批离散行号」做一次矩形读，返回 行号 → 该行 1..maxCol 的文本。
 *
 * 面向「循环里对每个条目逐格读 N 列」的 COM 热点：把 O(条目数 × 列数) 次跨进程往返
 * 压成 1 次。典型用法是循环外先建缓存、循环内命中即用、未命中回退逐格读。
 *
 * ⚠️ 传入的行号必须是**尚未发生插入/删除**的原始行号；一旦期间发生行位移，缓存即失效。
 *
 * 形状守卫沿用本项目不变式：行数/列宽对不上就返回 `null`，调用方回退逐格读，绝不猜形状。
 *
 * @param worksheet 工作表
 * @param rows 需要的行号（可离散、可无序、允许重复）
 * @param maxCol 需要的最大列号（读取范围恒为 1..maxCol）
 * @returns 行号 → 该行文本数组；`null` 表示批量读不可用，调用方须回退逐格读
 */
export function readRowsCache(
  worksheet: WpsWorksheet | null | undefined,
  rows: readonly number[],
  maxCol: number,
): Map<number, readonly string[]> | null {
  if (rows.length === 0 || maxCol < 1) return new Map()
  let minRow = rows[0] ?? 0
  let maxRow = minRow
  for (const row of rows) {
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  const span = maxRow - minRow + 1
  if (span > ROWS_CACHE_MAX_SPAN) return null
  const block = readRangeValues(worksheet, minRow, maxRow, 1, maxCol)
  // 行数不足 ⇒ 宿主返回了非预期形状，宁可判为读取失败（回退逐格读），绝不猜形状
  if (block.length !== span) return null
  const cache = new Map<number, readonly string[]>()
  for (const row of rows) {
    const line = block[row - minRow]
    if (!line || line.length < maxCol) return null
    cache.set(row, line)
  }
  return cache
}

/**
 * 批量读取工作表中指定范围的值，**保留单元格原始类型**，返回 `WpsCellValue` 二维数组 [行][列]。
 * 与 `readRangeValues`（一律 `String()` 化）不同，本函数用于「读-改-写整行」场景：
 * 读回的 number/Date 不会被强转成字符串，从而避免整行写回时把数字列变成文本列。
 * 如果读取失败则返回空数组，调用方**必须**据此放弃写入（绝不能拿空数组覆盖整行，否则会清空用户数据）。
 * @param worksheet 工作表对象
 * @param startRow 起始行
 * @param endRow 结束行
 * @param startCol 起始列
 * @param endCol 结束列
 * @returns `WpsCellValue` 二维数组（失败时为空数组）
 */
export function readRangeCellValues(
  worksheet: WpsWorksheet | null | undefined,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): WpsCellValue[][] {
  return readRect(worksheet, startRow, endRow, startCol, endCol, preserveCellValue) ?? []
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

export function findHeaderRow(
  worksheet: WpsWorksheet | null | undefined,
  startRow?: number,
): number {
  const sheetName = worksheet?.Name ?? ''
  const cacheKey = `${sheetName}:headerRow:${String(startRow ?? 1)}`
  return cacheGet(cacheKey, () => {
    const sRow = startRow ?? 1
    const endRow = Math.max(sRow, PANEL_CONFIG.MAX_SCAN_ROWS)
    // 快路径：一次矩形读整块扫描区（原先 10 行 × 60 列 = 最多 600 次逐格 COM 往返）。
    // 读回行数不足（宿主未返回完整矩形 / 桩未实现区域读）时回退逐格扫描，
    // 保证行为与改造前完全一致。
    const block = readRangeValues(worksheet, sRow, endRow, 1, PANEL_CONFIG.MAX_SCAN_COLUMNS)
    if (block.length === endRow - sRow + 1) {
      for (const [index, rowCells] of block.entries()) {
        if (isRowHeaderMatch(rowCells)) return sRow + index
      }
      return 0
    }
    for (let row = sRow; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row += 1) {
      if (isRowHeaderMatch(readRowCellsByCell(worksheet, row))) return row
    }
    return 0
  })
}

/**
 * 逐格读一行的前 MAX_SCAN_COLUMNS 列（矩形读不可用时的回退路径）
 *
 * 单格读取失败按空串处理：表头识别是「尽力而为」，不该因个别列抛错整行判否。
 */
function readRowCellsByCell(worksheet: WpsWorksheet | null | undefined, row: number): string[] {
  const cells: string[] = []
  for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col += 1) {
    try {
      // 取值即转小写（与改造前一致）：取不到或不是字符串会抛错，
      // 由下面的 catch 按空串处理，不因此把整行判为「非表头行」。
      cells.push(getCellValue(worksheet, row, col).toLowerCase())
    } catch {
      cells.push('')
    }
  }
  return cells
}

/** 扫描一行是否命中 ≥3 个表头关键字（提取自 findHeaderRow，用 return 代替嵌套 break） */
function isRowHeaderMatch(rowCells: string[]): boolean {
  let matchCount = 0
  for (const raw of rowCells) {
    const cellValue = raw.toLowerCase()
    if (cellValue) {
      const isMatched = HEADER_KEYWORDS.some((header) => cellValue.includes(header.toLowerCase()))
      if (isMatched) matchCount += 1
      if (matchCount >= 3) return true
    }
  }
  return false
}

/**
 * 按 COLUMN_RULES 规则将表头列名匹配为列映射 key
 * 首个命中的未占用 key 优先，已占用则继续尝试后续规则
 */
function applyColumnRules(colMap: Map<string, number>, colName: string, index: number): void {
  for (const [pattern, key] of COLUMN_RULES) {
    if (pattern.test(colName) && !colMap.has(key)) {
      colMap.set(key, index)
      // 匹配到未映射的 key，处理下一列
      break
    }
  }
}

/**
 * 获取列名到列号的映射（优化版：正则规则数组 + 缓存）
 * @param worksheet 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列名 -> 列号
 */
export function getColumnMap(
  worksheet: WpsWorksheet | null | undefined,
  headerRow: number,
): Map<string, number> {
  const sheetName = worksheet?.Name ?? ''
  const cacheKey = `${sheetName}:columnMap:${String(headerRow)}`
  return cacheGet(cacheKey, () => {
    const colMap = new Map<string, number>()
    let firstNonEmptyCol: number | undefined

    const lastCol = 50
    // 快路径：一次矩形读表头行（原先两轮循环共 100 次逐格读）。
    // 读回为空（宿主/桩未返回该行）时 readColName 自动回退逐格读，行为不变。
    const headerCells = readRangeValues(worksheet, headerRow, headerRow, 1, lastCol)[0]
    const readColName = (index: number): string =>
      trim(headerCells ? (headerCells[index - 1] ?? '') : getCellValue(worksheet, headerRow, index))

    for (let index = 1; index <= lastCol; index += 1) {
      const colName = readColName(index)
      // 记录第一个非空列作为序列号列候选
      if (!firstNonEmptyCol && colName) {
        firstNonEmptyCol = index
      }
      if (colName) {
        applyColumnRules(colMap, colName, index)
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
          const v = mappedCols.has(index) ? '' : readColName(index)
          if (v) {
            seqCol = index
            break
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
export function clearSheetCache(worksheet: WpsWorksheet | null | undefined): void {
  const prefix = worksheet?.Name ?? ''
  for (const key of sheetCache.keys()) {
    if (key.startsWith(prefix)) sheetCache.delete(key)
  }
}

/**
 * 在表头行中查找第一个匹配「序列号 / Bangumi URL / 名称 / 别名」的列索引
 * @param worksheet           工作表
 * @param headerRow 表头行号
 * @returns 列索引（1‑based），若未找到返回 undefined
 */
function findAnchorColumn(worksheet: WpsWorksheet, headerRow: number): number | undefined {
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
    const value = worksheet.Range(`${colNumberToLetter(c)}${String(headerRow)}`).Value2
    if (value != null) {
      const text = String(value).trim().toLowerCase()
      if (keywords.some((kw) => text === kw || text.includes(kw))) {
        return c
      }
    }
  }
  return undefined
}

/**
 * 获取工作表的最后有效数据行
 * @param worksheet            工作表对象（WpsWorksheet）
 * @param shouldForceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export function getLastRow(
  worksheet: WpsWorksheet | null | undefined,
  shouldForceRefresh = false,
  headerRow?: number,
): number {
  if (!worksheet) {
    bgmLog(LOG_LEVELS.WARN, 'getLastRow: 工作表对象无效，返回默认值 50000')
    return 50_000
  }

  const sheetName = worksheet.Name || ''
  const cacheKey = `${sheetName}:lastRow${headerRow ? `:hr${String(headerRow)}` : ''}`

  if (shouldForceRefresh) {
    clearSheetCache(worksheet)
    bgmLog(LOG_LEVELS.INFO, '缓存已清除，重新计算最后行')
  }

  // 必须在 cacheGet **之前**取样：cacheGet 内部会把计算结果写回 sheetCache，
  // 之后再看 has() 恒为 true，日志将永远显示「来自缓存」，把排查引向错误方向。
  const isCached = sheetCache.has(cacheKey)
  const cached = cacheGet<number>(cacheKey, () => {
    bgmLog(
      LOG_LEVELS.INFO,
      `正在计算工作表 "${sheetName}" 的最后数据行（${headerRow ? '根据表头自动选择列' : '多列回退'}）...`,
    )

    // 1. 如果提供了表头行，尝试自动选择锚定列
    if (headerRow != null && headerRow >= 1) {
      const col = findAnchorColumn(worksheet, headerRow)
      if (col) {
        try {
          // ✅ 修复点：使用 col 拼地址，而不是硬编码 D
          const colLetter = colNumberToLetter(col)
          const cell = worksheet.Range(`${colLetter}${String(worksheet.Rows.Count)}`)
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
      const cell = worksheet.Range(`D${String(worksheet.Rows.Count)}`)
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
      const cell = worksheet.Range(`A${String(worksheet.Rows.Count)}`)
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
      const usedRange = worksheet.UsedRange
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
    `工作表 "${sheetName}" 最后数据行: ${String(cached)}${isCached ? ' (来自缓存)' : ' (首次计算)'}`,
  )
  return cached
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  // 先收窄为 string 再比对，保持与原来 value === '...' 全等比较一致的语义
  return typeof value === 'string' && ['', 'null', 'NULL', 'Null', 'undefined'].includes(value)
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
          // 工作簿总数只读一次：写在循环条件里每轮都会多一次跨进程 COM 往返
          const workbookCount = wbs.Count
          for (let index = 1; index <= workbookCount; index += 1) {
            const wb = wbs.Item(index)
            if (wb.Name === BGM.sheet.lockedWorkbookName) {
              targetWb = wb
              break
            }
          }
        }
      }

      const worksheet = targetWb.Worksheets.Item(BGM.sheet.lockedIndex)
      return worksheet
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.WARN, `getDataSheet 锁定工作表失败: ${(error as Error).message}`)
    }
  }

  const worksheet = app.ActiveWorkbook.ActiveSheet
  return worksheet
}

export function safeActivate(worksheet: WpsWorksheet | null | undefined): void {
  if (worksheet && typeof worksheet.Activate === 'function') {
    worksheet.Activate()
  } else {
    bgmLog(LOG_LEVELS.WARN, 'safeActivate: 无法激活工作表')
  }
}

/**
 * 判断「表为空」时扫描第 1 行的列数上限
 *
 * 取 64 而非 STANDARD_HEADERS.length(39)：用户内容可能落在第 39 列之后，
 * 扫宽一点才能在拒绝填充时不漏判（漏判的代价是覆盖用户数据）。
 */
const HEADER_SCAN_COLUMNS = 64

/**
 * 检查工作表是否为空（无表头行），若是则写入标准表头
 *
 * 判定逻辑：findHeaderRow() 返回 0（前 10 行未匹配到 ≥3 个关键字），
 * **且第 1 行无任何内容**（后者用于区分「真空表」与「有数据但表头不规范」）。
 * 写入位置：第 1 行，按 STANDARD_HEADERS 顺序逐列写入。
 * 写入后清除缓存，确保后续 getColumnMap / findHeaderRow 能读到新表头。
 *
 * @param worksheet 工作表对象
 * @returns true 表示已填充表头（原为空表），false 表示已有表头 / 拒绝填充
 */
export function ensureSheetHeaders(worksheet: WpsWorksheet | null | undefined): boolean {
  if (!worksheet) {
    bgmLog(LOG_LEVELS.WARN, '[ensureSheetHeaders] 工作表无效')
    return false
  }

  const headerRow = findHeaderRow(worksheet)
  if (headerRow > 0) {
    bgmLog(LOG_LEVELS.INFO, `[ensureSheetHeaders] 已有表头行 ${String(headerRow)}，无需填充`)
    return false
  }

  // 守卫：「未识别到表头」≠「工作表为空」。
  // 若第 1 行已有内容（例如用户数据从第 1 行开始、表头写法不规范导致
  // findHeaderRow 认不出来），往下写 39 个标准表头会**覆盖用户第 1 行数据**。
  // 此时拒绝填充并告警，交由用户自行补表头。
  const firstRowCells = readRangeValues(worksheet, 1, 1, 1, HEADER_SCAN_COLUMNS)
  const hasFirstRowContent = firstRowCells.some((cells) => cells.some((cell) => cell.trim() !== ''))
  if (hasFirstRowContent) {
    bgmLog(
      LOG_LEVELS.WARN,
      '[ensureSheetHeaders] 未识别到表头，但第 1 行已有内容；拒绝写入标准表头（避免覆盖用户数据）',
    )
    return false
  }

  bgmLog(LOG_LEVELS.INFO, '[ensureSheetHeaders] 工作表为空，开始写入标准表头（39 列）')

  // 逐列写入表头
  let writeCount = 0
  let failCount = 0
  const failCols: number[] = []
  for (const [index, header] of STANDARD_HEADERS.entries()) {
    const isOk = setCellValueDirect(worksheet, 1, index + 1, header)
    if (isOk) {
      writeCount += 1
    } else {
      failCount += 1
      failCols.push(index + 1)
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
  const verifyValue = getCellValue(worksheet, 1, 25)
  bgmLog(LOG_LEVELS.INFO, `[ensureSheetHeaders] 验证第25列读回: "${verifyValue}"`)
  if (!verifyValue) {
    bgmLog(LOG_LEVELS.ERROR, '[ensureSheetHeaders] 表头写入验证失败，第25列为空')
  }

  // 清除缓存，确保后续读取能拿到新表头
  clearSheetCache(worksheet)
  // 验证 findHeaderRow 是否能识别新表头
  const detectedHeaderRow = findHeaderRow(worksheet)
  bgmLog(
    LOG_LEVELS.INFO,
    `[ensureSheetHeaders] 缓存已清除，findHeaderRow 重新检测: ${String(detectedHeaderRow)}`,
  )
  if (detectedHeaderRow !== 1) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[ensureSheetHeaders] findHeaderRow 返回 ${String(detectedHeaderRow)}（预期 1），表头关键字匹配可能失败`,
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
function setCellValueDirect(
  worksheet: WpsWorksheet,
  row: number,
  col: number,
  value: string,
): boolean {
  const address = colNumberToLetter(col) + String(row)

  // 方案 1: Cells.Item(row, col) + FormulaR1C1
  // 完全不同的 COM 路径（Cells.Item 而非 Range）+ 不同属性（FormulaR1C1 而非 Formula/Value/Value2），
  // 最大概率绕过 WPS COM 桥接层 Proxy 拦截。
  try {
    const cell = worksheet.Cells.Item(row, col)
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
    const cell = worksheet.Range(address)
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
    const cell = worksheet.Range(address)
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
    const cell = worksheet.Range(address)
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
    const cell = worksheet.Range(address)
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
