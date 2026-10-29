/**
 * 任务面板 - 工作表生命周期与预览渲染
 * @module panel/panelLifecycle
 * @description 工作表锁定/解锁、表头检测、筛选状态、预览渲染等核心 UI 逻辑。
 *              从原 panel 模块拆分而来，保持函数签名与行为不变。
 */

import type { WpsFilters, WpsWorksheet, WpsWorkbook } from '../index.js'
import {
  PANEL_CONFIG,
  LOG_LEVELS,
  getApp,
  bgmLog,
  BGM,
  escapeHtml,
  getCellValue,
  readRangeValues,
  columnNumberToLetter,
  HEADER_KEYWORDS,
  IMPORTANT_COLUMNS,
  showToast,
  getFilterStatus,
  getLastRow,
  clearSheetCache,
} from '../index.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { renderStatCards } from '../ui/stat-cards.js'
import {
  applyLockedSheet,
  isLockedAt,
  renderSheetLockUi,
  resolveCachedTarget,
  saveLockedSheet,
  findWorkbookByName,
  findBangumiTargetSheets,
  getOpenWorkbooks,
} from '../tools/locked-sheet.js'
import {
  loadTargetCache,
  readWorkbookSignature,
  saveTargetCache,
} from '../tools/target-detect-cache.js'
import type { LockedSheetInfo } from '../tools/locked-sheet.js'

interface CandidateHeader {
  row: number
  matchCount: number
  columnCount: number
}

interface HeaderMeta {
  headerRow: number
  headerNames: string[]
  isImportant: boolean[]
  dataStartRow: number
  lastColumn: number
  firstDataColumn: number
  // 切片后的数组起始索引（0）
  previewColumnStart: number
  // 切片后的列数
  previewColumnEnd: number
  // 新增：预览第一列的实际列号（1‑based）
  previewColStartAbsolute: number
  headerMatchCount: number
}

interface PreviewRow {
  row: number
  columns: string[] | { text: string; important: boolean }[]
  isHeader: boolean
  aligned: boolean
  isImportant?: boolean[]
}

/**
 * 一次预览的完整数据快照
 *
 * 放大预览**必须**用它重新渲染，而不是从 `#previewBox` 里偷 `innerHTML`：
 * 克隆 DOM 会连带复制面板里的布局约束（`max-height: 300px`、窄窗格宽度），
 * 于是「放大」只放大了外框、表格还是按面板的列宽排版；而且克隆出来的节点
 * 不经过 {@link renderPreviewTable}，两份 HTML 迟早不一致。
 */
export interface PreviewSnapshot {
  rows: PreviewRow[]
  sheetIndex: number
  sheetName: string
  headerRow: number
}

// ========== 工作表锁定功能 ==========

export function toggleSheetLock(): void {
  const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
  if (!select) return

  const sheetIndex = Number(select.value)
  if (Number.isNaN(sheetIndex) || sheetIndex <= 0) {
    showToast('请先选择一个有效的工作表', 'warn')
    return
  }

  if (isLockedAt(sheetIndex)) {
    // §5.6 C4：状态清位走共享实现；持久化显式调用（便于测试观察）
    applyLockedSheet(null)
    saveLockedSheet(null, 'panel')
    showToast('已解锁工作表', 'info')
  } else {
    const sheetName = select.options[select.selectedIndex]?.text ?? ''
    // 获取选中的工作簿名称
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement | null
    const wbName = wbSelect?.value ?? ''
    const sheetInfo: LockedSheetInfo = { index: sheetIndex, name: sheetName }
    if (wbName) {
      sheetInfo.workbookName = wbName
    }
    applyLockedSheet(sheetInfo)
    saveLockedSheet(sheetInfo, 'panel')
    showToast(`已锁定工作表: ${sheetName}${wbName ? `（工作簿: ${wbName}）` : ''}`, 'info')
  }
  updateLockButton()
  refreshData()
}

export function updateLockButton(): void {
  // §5.6 C4：与富化页共用渲染实现（inline 模式 = 主面板的状态区显隐方式）
  renderSheetLockUi('lockSheetBtn', 'lockStatus')
}

export function refreshSheets(options?: { autoSelectActive?: boolean }): void {
  const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
  if (!select) return

  const app = getApp()
  if (!app?.ActiveWorkbook) {
    bgmLog(LOG_LEVELS.WARN, 'refreshSheets: 无法获取 ActiveWorkbook')
    return
  }

  // 获取选中的工作簿：统一检查 Workbooks、Windows 和 ActiveWorkbook 可见的工作簿。
  const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement | null
  const workbook = wbSelect?.value
    ? (findWorkbookByName(wbSelect.value) ?? app.ActiveWorkbook)
    : app.ActiveWorkbook
  const sheets = workbook.Worksheets
  // 工作表总数只读一次：写在循环条件里每轮都会多一次跨进程 COM 往返。
  // ⚠️ 必须在探测 try **之外**读：探测活动工作表失败时不能把总数也一起清零，
  // 否则下面的下拉框会只剩占位项（既有用例「探测抛错 → 记录但不中断渲染」锁的就是这条）。
  const sheetCount = sheets.Count

  // 探测当前活动工作表索引（autoSelectActive 时用于自动选中）
  let activeSheetIndex = 0
  try {
    const activeSheet = workbook.ActiveSheet
    for (let index = 1; index <= sheetCount; index += 1) {
      if (sheets.Item(index) === activeSheet) {
        activeSheetIndex = index
        break
      }
    }
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'refreshSheets.getActiveSheet',
    })
  }

  // 使用 DOM API 创建默认 option，避免 innerHTML 拼接（XSS 防护）
  select.textContent = ''
  const defaultOption = document.createElement('option')
  defaultOption.value = ''
  defaultOption.textContent = '-- 请选择 --'
  select.appendChild(defaultOption)

  const isAutoSelectActive = options?.autoSelectActive === true
  let selectedIndex = 0
  for (let index = 1; index <= sheetCount; index += 1) {
    const option = document.createElement('option')
    option.value = String(index)
    option.text = sheets.Item(index).Name

    // 合并两个「选中」分支为单一条件（原 else-if 与 if 分支体完全相同）
    if (
      (BGM.sheet.isLocked && BGM.sheet.lockedIndex === index) ||
      (isAutoSelectActive && index === activeSheetIndex && !BGM.sheet.isLocked)
    ) {
      option.selected = true
      selectedIndex = index
    }

    select.appendChild(option)
  }

  // 同步 select.value，selectedIndex 已通过 option.selected 设置
  if (selectedIndex > 0) {
    select.value = String(selectedIndex)
    bgmLog(
      LOG_LEVELS.INFO,
      `[refreshSheets] ${isAutoSelectActive ? '自动选中' : '已锁定'} 工作表索引: ${String(selectedIndex)}`,
    )
  } else if (isAutoSelectActive && activeSheetIndex > 0) {
    select.value = String(activeSheetIndex)
    bgmLog(LOG_LEVELS.INFO, `[refreshSheets] 自动选中当前活动工作表: ${String(activeSheetIndex)}`)
  } else {
    select.value = ''
  }

  updateLockButton()
}

/**
 * 刷新工作簿列表（所有打开的 Excel 工作簿）
 */
export function refreshWorkbooks(): void {
  const select = document.getElementById('workbookSelect') as HTMLSelectElement | null
  if (!select) return

  const app = getApp()
  if (!app?.Workbooks) {
    bgmLog(LOG_LEVELS.WARN, 'refreshWorkbooks: 无法获取 Workbooks')
    return
  }

  const workbooks = getOpenWorkbooks()

  // 保存当前选中值
  const currentValue = select.value

  // 使用 DOM API 创建选项
  select.textContent = ''
  const defaultOption = document.createElement('option')
  defaultOption.value = ''
  defaultOption.textContent = '-- 当前活动工作簿 --'
  select.appendChild(defaultOption)

  let hasActiveWorkbook = false
  const activeWbName = app.ActiveWorkbook?.Name ?? ''

  for (const wb of workbooks) {
    const name = (() => {
      try {
        return wb.Name
      } catch {
        return ''
      }
    })()
    if (name) {
      const option = document.createElement('option')
      option.value = name
      option.text = name

      // 恢复之前选中值，或默认选中当前活动工作簿
      if (currentValue && currentValue === name) {
        option.selected = true
      } else if (!currentValue && name === activeWbName) {
        option.selected = true
        hasActiveWorkbook = true
      }

      select.appendChild(option)
    }
  }

  if (!currentValue && !hasActiveWorkbook) {
    select.value = ''
  }

  bgmLog(LOG_LEVELS.INFO, `[refreshWorkbooks] 刷新工作簿列表: ${String(workbooks.length)} 个`)
}

export function activateSheetIfNeeded(worksheet: WpsWorksheet): (() => void) | false {
  const app = getApp()
  // 确保工作簿存在
  if (!app?.ActiveWorkbook) return false

  try {
    const active = app.ActiveWorkbook.ActiveSheet

    const activeName = active.Name || ''
    if (activeName !== (worksheet.Name || '')) {
      worksheet.Activate()
      return function restore() {
        try {
          active.Activate()
        } catch (error: unknown) {
          BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'activateSheetIfNeeded',
          })
        }
      }
    }
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'activateSheetIfNeeded',
    })
  }
  return false
}

// ========== 表头检测 ==========

export function detectHeaderAndColumns(
  worksheet: WpsWorksheet | null | undefined,
  options: { visibleRowSet?: Set<number> | null; isFiltered?: boolean } = {},
): HeaderMeta {
  const { visibleRowSet = null, isFiltered = false } = options

  // 判断某行是否可见
  function isRowVisible(r: number, headerRow: number): boolean {
    if (r === headerRow) return true
    return !isFiltered || (visibleRowSet?.has(r) ?? false)
  }

  // 性能：一次矩形读覆盖「扫描区 + 数据采样区」× MAX_SCAN_COLUMNS 列。
  // 原先仅第 1 步就是 10 行 × 60 列 = 600 次逐格读，连同表头名、续行、数据列采样合计约 2000 次/次刷新；矩形读不完整时回退逐格（行为不变）。采样区额外多读 22 行（数据列采样最多再向下看 20 行，留 2 行余量）。
  const SCAN_ROWS_EXTRA = 22
  const scanEndRow = PANEL_CONFIG.MAX_SCAN_ROWS + SCAN_ROWS_EXTRA
  const block = readRangeValues(worksheet, 1, scanEndRow, 1, PANEL_CONFIG.MAX_SCAN_COLUMNS)
  const canBatch = block.length === scanEndRow
  const cellAt = (row: number, column: number): string =>
    canBatch ? (block[row - 1]?.[column - 1] ?? '') : getCellValue(worksheet, row, column)

  // 1. 扫描前 MAX_SCAN_ROWS 行，找出所有候选表头行
  const candidates: CandidateHeader[] = []
  for (let r = 1; r <= PANEL_CONFIG.MAX_SCAN_ROWS; r += 1) {
    const shouldScanRow = !isFiltered || !visibleRowSet || visibleRowSet.has(r)
    if (shouldScanRow) {
      let matchCount = 0
      let columnCount = 0
      for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
        try {
          const v = cellAt(r, c).trim()
          if (v) {
            columnCount += 1
            const cv = v.toLowerCase()
            if (HEADER_KEYWORDS.some((kw) => cv === kw || cv.includes(kw))) {
              matchCount += 1
            }
          }
        } catch (cellError) {
          BGM.handleError(cellError, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'detectHeaderAndColumns',
          })
          // 单个单元格读取失败，不影响该行其他列。
          // 此处原为 continue，但 try/catch 已构成整个内层循环体，
          // catch 结束后本就进入下一列，continue 属冗余控制流，直接移除。
        }
      }
      if (matchCount >= 3) {
        candidates.push({ row: r, matchCount, columnCount })
      }
    }
  }

  if (candidates.length === 0) {
    return {
      headerRow: 0,
      headerNames: [],
      isImportant: [],
      dataStartRow: 0,
      lastColumn: 0,
      firstDataColumn: 0,
      previewColumnStart: 0,
      previewColumnEnd: 0,
      previewColStartAbsolute: 0,
      headerMatchCount: 0,
    }
  }

  // 选列数最多、行号最小的行作为锚点
  candidates.sort((a, b) => b.columnCount - a.columnCount || a.row - b.row)
  const candidateRows = new Set(candidates.map((candidate) => candidate.row))
  // 锚点未必是表头首行：多行表头里「补齐行」可能比主表头行更宽（columnCount 更大），
  // 直接把它当表头会整行丢掉主表头的列名。向上回溯到紧邻的连续候选块首行。
  let headerRow = candidates[0]?.row ?? 0
  while (candidateRows.has(headerRow - 1)) {
    headerRow -= 1
  }
  const headerMatchCount =
    candidates.find((candidate) => candidate.row === headerRow)?.matchCount ?? 0

  // 2. 读取表头名称
  const headerNames: string[] = []
  const headerIsImportant: boolean[] = []
  for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
    const v = cellAt(headerRow, c).trim()
    headerNames.push(v)
    headerIsImportant.push(IMPORTANT_COLUMNS[v.toLowerCase()] ?? false)
  }

  // headerNames 是定长稠密数组：未写的列 push 的是 ''，MAX_SCAN_COLUMNS 个位置全部存在。
  // 因此「这一列有没有表头名」只能看值是否为空，不能用 Object.hasOwn —— 后者在稠密数组上恒真。
  const hasHeaderName = (index: number): boolean => (headerNames[index] ?? '') !== ''

  // 3. 检测多行表头：续行补上了当前表头为空的列（第 1 行写主列名、第 2 行补剩余列名）。
  // 前提：续行仍在扫描范围内，否则不读它的值。
  let dataStartRow = headerRow + 1
  if (headerRow + 1 <= PANEL_CONFIG.MAX_SCAN_ROWS) {
    // 锚点行自身最右有值列：多行表头的续行应当「向右延伸」补在锚点最右列之外，
    // 而非填补锚点内部的空隙列。后者（宽而稀疏的表头行被下方数据行补满空隙）是误判，
    // 会把数据行当成表头吃掉（风险 A），必须排除。
    let anchorLastColumn = 0
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
      if (hasHeaderName(c - 1) && c > anchorLastColumn) anchorLastColumn = c
    }
    // 续行在锚点最右列右侧补上的列数（合法的向右延伸）
    let filledRight = 0
    // 续行填补锚点内部空隙列的列数（应视为数据，不能并入表头）
    let filledGap = 0
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
      const nv = cellAt(headerRow + 1, c).trim()
      const isHeader = hasHeaderName(c - 1)
      if (nv && !isHeader) {
        if (c > anchorLastColumn) filledRight += 1
        else filledGap += 1
      }
    }
    // 仅当续行「向右延伸 ≥3 列」且「不填补任何内部空隙」时才认作多行表头。
    // 若续行主要填补锚点内部空隙（风险 A：下方数据行补满宽表头的空隙列），
    // 则按普通数据行处理，dataStartRow 保持 headerRow+1，避免吞掉首行数据。
    if (filledGap === 0 && filledRight >= 3) {
      dataStartRow = headerRow + 2
      for (let c = anchorLastColumn + 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
        const nv = cellAt(headerRow + 1, c).trim()
        if (nv) {
          headerNames[c - 1] = nv
          headerIsImportant[c - 1] = IMPORTANT_COLUMNS[nv.toLowerCase()] ?? false
        }
      }
    }
  }

  // 4. 计算实际使用的列范围（数据列）
  let firstDataColumn = -1
  let lastDataColumn = 0
  let samples = 0
  for (let dr = dataStartRow; dr <= dataStartRow + 20 && samples < 5; dr += 1) {
    const isDataRowVisible = isRowVisible(dr, headerRow)
    if (isDataRowVisible) {
      samples += 1
      for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
        const v = cellAt(dr, c).trim()
        if (v) {
          if (firstDataColumn < 0) firstDataColumn = c
          if (c > lastDataColumn) lastDataColumn = c
        }
      }
    }
  }
  if (firstDataColumn < 0) firstDataColumn = 1

  // 表头结束列
  let headerLastColumn = 0
  for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
    if (hasHeaderName(c - 1)) headerLastColumn = c
  }

  const actualLastColumn = Math.max(lastDataColumn, headerLastColumn)

  // 预览显示的列范围：从第一个数据列左扩找到最左非空表头，但不能超过表头范围
  let previewColumnStart = Math.max(1, firstDataColumn - 5)
  for (let c = previewColumnStart; c <= firstDataColumn; c += 1) {
    if (hasHeaderName(c - 1)) {
      previewColumnStart = c
      break
    }
  }
  // 预览结束列为表头最大列，若实际数据超出表头范围则以表头为准
  const previewColumnEnd = Math.min(actualLastColumn, headerLastColumn)

  return {
    headerRow,
    headerNames: headerNames.slice(previewColumnStart - 1, previewColumnEnd),
    isImportant: headerIsImportant.slice(previewColumnStart - 1, previewColumnEnd),
    dataStartRow,
    lastColumn: actualLastColumn,
    firstDataColumn,
    // 保留，但不用于数据读取
    previewColumnStart: 0,
    previewColumnEnd: previewColumnEnd - previewColumnStart + 1,
    // 新增，实际列号
    previewColStartAbsolute: previewColumnStart,
    headerMatchCount,
  }
}

export function autoDetectSheet(options: { force?: boolean } = {}): {
  workbookName: string
  sheetIndex: number
  sheetName: string
  headerRow: number
  matchCount: number
  columnCount: number
} | null {
  const signature = readWorkbookSignature(getApp())

  // 识别结果缓存（§ 性能）：签名未变时只做「簿/表存在性 + 表头」复核（约 3–5 次 COM），
  // 不扫其它工作簿的其它工作表；手动刷新传 force 跳过并回写。
  if (options.force !== true) {
    const cached = loadTargetCache('panel', signature)
    const resolved = cached ? resolveCachedTarget(cached) : null
    if (resolved) {
      bgmLog(
        LOG_LEVELS.INFO,
        `autoDetectSheet: 命中识别缓存 "${resolved.workbookName} → ${resolved.sheetName}"（表头行 ${String(
          resolved.headerRow,
        )}）`,
      )
      return {
        workbookName: resolved.workbookName,
        sheetIndex: resolved.sheetIndex,
        sheetName: resolved.sheetName,
        headerRow: resolved.headerRow,
        matchCount: resolved.matchCount ?? 0,
        columnCount: resolved.columnCount ?? 0,
      }
    }
  }

  // 跨所有已打开工作簿扫描（表头 + 数据行数 + 名称关键词，优先活动工作簿/工作表）
  const scanStart = performance.now()
  const candidates = findBangumiTargetSheets()
  const scanMs = Math.round(performance.now() - scanStart)
  bgmLog(
    LOG_LEVELS.INFO,
    `[perf] autoDetectSheet: 跨簿全量扫描 ${String(scanMs)}ms，候选 ${String(candidates.length)} 个`,
  )
  const best = candidates[0]
  if (!best) {
    bgmLog(
      LOG_LEVELS.WARN,
      'autoDetectSheet: 未在任何工作簿中找到有效追踪表（可在切换工作簿/工作表后手动选择）',
    )
    return null
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `autoDetectSheet: 最终选中 "${best.workbookName} → ${best.sheetName}" (表头行 ${String(
      best.headerRow,
    )}, 关键词 ${String(best.headerMatchCount)}, 数据行 ${String(best.dataRowCount)})`,
  )
  const result = {
    workbookName: best.workbookName,
    sheetIndex: best.sheetIndex,
    sheetName: best.sheetName,
    headerRow: best.headerRow,
    matchCount: best.headerMatchCount,
    columnCount: best.headerMatchCount,
  }
  saveTargetCache('panel', signature, result)
  return result
}
// ========== 筛选状态 ==========

/**
 * 收集活动筛选列描述（"列名(criteria)" 形式）；单列读取失败仅记录不中断。
 * （从 updateFilterStatus 的 try 块抽出，降低 try-complexity）
 */
function collectActiveFilterColumns(worksheet: WpsWorksheet, filters: WpsFilters): string[] {
  const activeColumns: string[] = []
  // 筛选列数只读一次（COM 属性，写在循环条件里每轮都会多一次跨进程往返）
  const filterCount = filters.Count
  for (let index = 1; index <= filterCount; index += 1) {
    try {
      const f = filters.Item(index)
      if (f.On) {
        let columnName = ''
        try {
          const headerCell = worksheet.Range(`${columnNumberToLetter(index)}1`)
          columnName = String(headerCell.Value2 || '').substring(0, 12)
        } catch (error: unknown) {
          BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'updateFilterStatus',
          })
        }
        let criteria = f.Criteria1 ?? ''
        if (f.Criteria2) {
          const op = f.Operator
          if (op === 1) {
            criteria += ` 且 ${f.Criteria2}`
          } else if (op === 2) {
            criteria += ` 或 ${f.Criteria2}`
          } else {
            criteria += ` / ${f.Criteria2}`
          }
        }
        activeColumns.push(columnName ? `${columnName}(${criteria})` : `列${String(index)}`)
      }
    } catch (error: unknown) {
      BGM.handleError(error, {
        showAlert: false,
        level: BGM.ErrorLevel.INFO,
        context: 'updateFilterStatus',
      })
    }
  }
  return activeColumns
}

export function updateFilterStatus(targetWorksheet?: WpsWorksheet): void {
  const element = document.getElementById('filterStatus')
  if (!element) return

  const app = getApp()
  const sheet = targetWorksheet ?? app?.ActiveWorkbook?.ActiveSheet
  if (!sheet) {
    // 处理：显示提示、返回等
    return
  }
  // 现在 sheet 被收窄为 WpsWorksheet
  const worksheet: WpsWorksheet = sheet

  let isAutoFilterMode = false
  try {
    isAutoFilterMode = !!worksheet.AutoFilterMode
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'updateFilterStatus',
    })
  }
  try {
    if (!isAutoFilterMode && worksheet.AutoFilter) isAutoFilterMode = !!worksheet.AutoFilter.Mode
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'updateFilterStatus',
    })
  }

  if (!isAutoFilterMode) {
    element.textContent = '未开启筛选，同步全部数据'
    element.removeAttribute('title')
    return
  }

  try {
    const autoFilter = worksheet.AutoFilter
    if (!autoFilter) {
      element.textContent = '筛选已开启但无活动筛选'
      return
    }
    const filters = autoFilter.Filters
    if (!filters?.Count) {
      element.textContent = '筛选已开启但无活动筛选，同步全部数据'
      return
    }

    const activeColumns: string[] = collectActiveFilterColumns(worksheet, filters)

    if (activeColumns.length > 0) {
      const text = `✔ 筛选已开启（${String(activeColumns.length)} 列），将同步筛选后的可见数据\n${activeColumns.join('、')}`
      element.textContent = text
      element.setAttribute('title', text)
    } else {
      element.textContent = '筛选已开启但无活动筛选，同步全部数据'
      element.removeAttribute('title')
    }
  } catch (error: unknown) {
    element.textContent = `检测筛选状态失败: ${(error as Error).message}`
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'updateFilterStatus',
    })
  }
}

// ========== 预览渲染 ==========

/**
 * 批量读取一个连续行段（矩形 Range.Value2）并追加预览行；
 * 返回是否有非空数据。（从预览构建的 try 块抽出，降低 try-complexity）
 */
function isReadPreviewSegmentBatch(
  worksheet: WpsWorksheet,
  meta: HeaderMeta,
  segStart: number,
  segLength: number,
  dataRows: number[],
  index: number,
  displayColumnCount: number,
  previewRows: PreviewRow[],
): boolean {
  // 一次性读取整个矩形区域
  const startColumnLetter = columnNumberToLetter(meta.previewColStartAbsolute)
  const endColumnLetter = columnNumberToLetter(
    meta.previewColStartAbsolute + displayColumnCount - 1,
  )
  const rangeAddr = worksheet.Range(
    `${startColumnLetter}${String(segStart)}:${endColumnLetter}${String(segStart + segLength - 1)}`,
  )
  const raw = rangeAddr.Value2
  // WPS JS API 返回 0-based 二维数组（raw[0][0] 为第一行第一列）
  const is2D = Array.isArray(raw)
  let hasData = false
  for (let r = 0; r < segLength; r += 1) {
    const dr = dataRows[index + r]
    if (dr !== undefined) {
      const rowColumns: string[] = []
      let hasAny = false
      for (let ci = 0; ci < displayColumnCount; ci += 1) {
        let v: string
        if (is2D && Array.isArray(raw)) {
          const cell = raw[r]?.[ci]
          v = cell == null ? '' : String(cell).trim()
        } else if (segLength === 1 && displayColumnCount === 1) {
          v = raw == null ? '' : String(raw).trim()
        } else {
          v = getCellValue(worksheet, dr, meta.previewColStartAbsolute + ci).trim()
        }
        if (v) hasAny = true
        rowColumns.push(v)
      }
      if (hasAny) {
        previewRows.push({ row: dr, columns: rowColumns, isHeader: false, aligned: true })
        hasData = true
      }
    }
  }
  return hasData
}

/** 预览统计所需的元数据 */
interface PreviewStatsInput {
  headerRow: number
  columnCount: number
  dataRowCount: number
  isFiltered: boolean
}

/**
 * 渲染预览统计（共用统计卡片组件）。
 *
 * 「表头行」与「筛选」是同步前最该确认的两件事：表头识别错了会整列错位，
 * 忘了还开着筛选会只同步可见行。这里把它们显式暴露出来，而不是让用户
 * 去翻日志。
 */
function renderPreviewStats(stats: PreviewStatsInput): void {
  const hasHeader = stats.headerRow > 0
  renderStatCards(document.getElementById('previewStats'), [
    { label: '预览数据行', value: stats.dataRowCount },
    { label: '列数', value: stats.columnCount },
    {
      label: '表头行',
      value: hasHeader ? stats.headerRow : '未识别',
      tone: hasHeader ? 'default' : 'warning',
    },
    {
      label: '筛选状态',
      value: stats.isFiltered ? '仅可见行' : '全部行',
      tone: stats.isFiltered ? 'accent' : 'default',
    },
  ])
}

/**
 * 上一次真正写进预览容器的 HTML（数据指纹）。
 *
 * 自动刷新（SheetChange / 面板重新获得焦点）会让 `refreshData` 频繁入口，而整表
 * 重建 = DOMPurify 清洗一遍 + 整表重排。数据没变时这是纯浪费，故按指纹跳过。
 */
let lastPreviewHtml: string | null = null

/**
 * 上一次渲染进 `#previewBox` 的数据快照（放大预览的唯一数据源）
 *
 * 与 {@link lastPreviewHtml} 同步维护：渲染成功时写入，渲染「无数据 / 未选择」
 * 这类提示时清空。放大预览只读它，所以不会出现「面板里是 A 表、放大后是 B 表」
 * 这种 DOM 与数据脱节的情况。
 */
let lastPreviewSnapshot: PreviewSnapshot | null = null

/**
 * 渲染一条「没有预览」的提示，并让快照失效
 *
 * 提示与数据必须同生同灭：留着旧快照会让放大预览在「未选择工作表」之后
 * 还能放大出上一张表的表格，用户以为是缓存没清。
 */
function renderPreviewHint(previewBox: HTMLElement | null, text: string): void {
  lastPreviewSnapshot = null
  lastPreviewHtml = null
  // 取别名再写：no-param-reassign 禁的是「给参数的属性赋值」，别名是本地绑定
  const box = previewBox
  if (box) box.innerHTML = sanitizeHtml(`<p class="hint">${escapeHtml(text)}</p>`)
}

/**
 * 预览表格的**唯一**渲染出口
 *
 * 面板内预览与放大预览都调它，两条路径的 HTML 必然一致。改表格结构（加列、
 * 换样式、加 title）只改这里一处，不会出现「放大了才看到 bug」。
 */
function renderPreviewTable(
  rows: PreviewRow[],
  sheetIndex: number,
  sheetName: string,
  headerRow: number,
): string {
  let html = '<table class="preview-table"><tbody>'
  // 以表头行列数作为统一列数，避免不同行列数不同导致错位
  const headerItem = rows.find((r) => r.isHeader)
  const fixedColumnCount = headerItem?.aligned ? (headerItem.columns as string[]).length : 0
  for (const item of rows) {
    const rowClass = item.isHeader ? 'preview-header-row' : ''
    html += `<tr class="${rowClass}">`
    html += `<td class="preview-row-num">${String(item.isHeader ? 'H' : item.row)}</td>`
    if (item.aligned) {
      const columns = item.columns as string[]
      // 使用统一列数，确保所有行列对齐
      const columnLimit = fixedColumnCount > 0 ? fixedColumnCount : columns.length
      for (let index = 0; index < columnLimit; index += 1) {
        const text = columns[index] ?? ''
        let cssClass = ''
        if (item.isHeader) {
          cssClass = 'preview-header'
          if (item.isImportant?.[index] === true) cssClass += ' preview-important-header'
        }
        const safeText = escapeHtml(text)
        // 单元格有 max-width + 省略号，截断后靠 title 悬浮看全文
        const title = text ? ` title="${safeText}"` : ''
        html += `<td class="${cssClass}"${title}>${safeText}</td>`
      }
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  html += `<p class="hint">已选择工作表索引: ${String(sheetIndex)} (${escapeHtml(sheetName)})`
  if (headerRow) html += ` | 表头行: ${String(headerRow)}`
  html += '</p>'
  return html
}

export function refreshData(): void {
  bgmLog(LOG_LEVELS.INFO, 'refreshData 开始执行')
  const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
  const previewBox = document.getElementById('previewBox')
  // parseInt 失败返回 NaN（非 nullish），`??` 兜不住，须显式 isFinite 兜底
  const parsedSheetIndex = BGM.sheet.lockedIndex ?? Math.trunc(Number(select?.value ?? ''))
  const sheetIndex = Number.isFinite(parsedSheetIndex) ? parsedSheetIndex : 0

  if (!sheetIndex) {
    renderPreviewHint(previewBox, '请先选择工作表')
    updateFilterStatus()
    return
  }

  const app = getApp()
  if (!app?.ActiveWorkbook) {
    renderPreviewHint(previewBox, '未连接到 Excel')
    updateFilterStatus()
    return
  }

  // 解析目标工作簿：锁定到特定工作簿时跨所有已打开工作簿定位，否则使用活动工作簿
  let workbook: WpsWorkbook = app.ActiveWorkbook
  if (BGM.sheet.lockedWorkbookName) {
    const lockedWorkbook = findWorkbookByName(BGM.sheet.lockedWorkbookName)
    if (lockedWorkbook) workbook = lockedWorkbook
  }

  let worksheet: WpsWorksheet | null | undefined = null
  try {
    worksheet = workbook.Worksheets.Item(sheetIndex)
  } catch (error: unknown) {
    renderPreviewHint(previewBox, `无法获取工作表: ${String(sheetIndex)}`)
    BGM.handleError(error, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'refreshData' })
    updateFilterStatus()
    return
  }
  // 检查工作表可访问性（WPS 桥接层可能返回不可用的代理对象）
  if (typeof worksheet.Activate !== 'function') {
    renderPreviewHint(previewBox, `无法访问工作表 ${String(sheetIndex)}`)
    BGM.handleError(new Error(`无法访问工作表 ${String(sheetIndex)}`), {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'refreshData',
    })
    updateFilterStatus()
    return
  }

  const sheetName = worksheet.Name || ''
  // 清除该工作表所有缓存，确保获取到最新数据（§5.6 C3：barrel 已统一，去掉死守卫）
  clearSheetCache(worksheet)
  const needRestore = activateSheetIfNeeded(worksheet)
  const refreshDataCore = (): void => {
    // 获取最后数据行（强制刷新，不使用缓存）
    const lastRow = getLastRow(worksheet, true)
    bgmLog(LOG_LEVELS.INFO, `工作表最后数据行: ${String(lastRow)}`)

    // 使用统一的筛选状态检测
    const filterStatus = getFilterStatus(worksheet, lastRow)
    const isFiltered = filterStatus.hasFilter
    const { visibleRows } = filterStatus
    const visibleRowSet = isFiltered ? new Set<number>(visibleRows) : null

    // 记录筛选状态详情
    bgmLog(
      LOG_LEVELS.INFO,
      `筛选状态: isFiltered=${String(isFiltered)}, 可见行数=${String(visibleRows.length)}`,
    )
    if (isFiltered && visibleRows.length > 0) {
      bgmLog(LOG_LEVELS.INFO, `可见行列表(前10): ${visibleRows.slice(0, 10).join(',')}`)
    }

    const meta = detectHeaderAndColumns(worksheet, { visibleRowSet, isFiltered })
    // ✅ 保存供 previewSyncContent 使用
    BGM.dataPreview = {
      // 工作表引用
      worksheet,
      // 筛选后可见行（含表头）
      visibleRows,
      headerRow: meta.headerRow,
      dataStartRow: meta.dataStartRow,
      // 实际起始列号
      previewColumnStart: meta.previewColStartAbsolute,
      previewColumnEnd:
        meta.previewColStartAbsolute + (meta.previewColumnEnd - meta.previewColumnStart) - 1,
      columnCount: meta.previewColumnEnd - meta.previewColumnStart,
      headerNames: meta.headerNames.slice(meta.previewColumnStart, meta.previewColumnEnd),
      isImportant: meta.isImportant.slice(meta.previewColumnStart, meta.previewColumnEnd),
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `表头检测: headerRow=${String(meta.headerRow)}, dataStartRow=${String(meta.dataStartRow)}, 列数=${String(meta.previewColumnEnd - meta.previewColumnStart)}`,
    )

    const previewRows: PreviewRow[] = []
    let hasData = false

    if (meta.headerRow > 0) {
      previewRows.push({
        row: -1,
        columns: meta.headerNames.slice(meta.previewColumnStart, meta.previewColumnEnd),
        isHeader: true,
        aligned: true,
        isImportant: meta.isImportant.slice(meta.previewColumnStart, meta.previewColumnEnd),
      })

      const displayColumnCount = meta.previewColumnEnd - meta.previewColumnStart
      // 使用 visibleRows 过滤，而不是遍历整个范围
      // 防御性排序 + 去重：确保行号严格升序且无重复（修复"190-201后跳到3"问题）
      const dataRows = [
        ...new Set(visibleRows.filter((r) => r !== meta.headerRow && r >= meta.dataStartRow)),
      ].sort((a, b) => a - b)
      const maxPreview = Math.min(dataRows.length, PANEL_CONFIG.PREVIEW_LIMIT)

      // 找到从 start 开始的连续行段终点（从内层循环抽出，用 return 替代内层 break）
      const findSegmentEnd = (start: number, max: number): number => {
        let end = start
        while (end + 1 < max) {
          const next = dataRows[end + 1]
          const current = dataRows[end]
          if (next === undefined || current === undefined || next !== current + 1) break
          end += 1
        }
        return end
      }

      // 批量读取：按连续行段一次性读取 Range.Value2，减少 COM 调用次数
      let index = 0
      while (index < maxPreview) {
        const index_ = findSegmentEnd(index, maxPreview)
        const segStart = dataRows[index]
        if (segStart === undefined) break
        const segLength = index_ - index + 1

        try {
          const isBatchHasData = isReadPreviewSegmentBatch(
            worksheet,
            meta,
            segStart,
            segLength,
            dataRows,
            index,
            displayColumnCount,
            previewRows,
          )
          if (isBatchHasData) hasData = true
        } catch {
          // 批量读取失败，回退到逐单元格
          for (let r = 0; r < segLength; r += 1) {
            const dr = dataRows[index + r]
            if (dr !== undefined) {
              const rowColumns: string[] = []
              let hasAny = false
              for (let ci = 0; ci < displayColumnCount; ci += 1) {
                const column = meta.previewColStartAbsolute + ci
                const v = getCellValue(worksheet, dr, column).trim()
                if (v) hasAny = true
                rowColumns.push(v)
              }
              if (hasAny) {
                previewRows.push({ row: dr, columns: rowColumns, isHeader: false, aligned: true })
                hasData = true
              }
            }
          }
        }
        index = index_ + 1
      }
    } else {
      // 无表头时的回退逻辑
      let count = 0
      for (let r = 1; r <= Math.min(lastRow, 100) && count < 5; r += 1) {
        const isRowIncluded = !isFiltered || !visibleRowSet || visibleRowSet.has(r)
        if (isRowIncluded) {
          // 与表头分支一致：columns 必须是字符串数组（aligned 路径的 renderPreviewTable
          // 按 string[] 渲染；此前 push {text,important} 对象会显示成 [object Object]）
          const columns: string[] = []
          let hasAny = false
          for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
            const v = getCellValue(worksheet, r, c).trim()
            if (v) {
              columns.push(v)
              hasAny = true
            }
          }
          if (hasAny) {
            previewRows.push({ row: r, columns, isHeader: false, aligned: true })
            hasData = true
            count += 1
          }
        }
      }
    }

    bgmLog(
      LOG_LEVELS.INFO,
      `生成预览行数: ${String(previewRows.length)}, 其中数据行: ${String(previewRows.filter((p) => !p.isHeader).length)}`,
    )

    if (hasData && !BGM.sheet.isLocked) {
      BGM.sheet.lockedIndex = sheetIndex
      BGM.sheet.lockedName = sheetName
      BGM.sheet.isLocked = true
      saveLockedSheet({ index: sheetIndex, name: sheetName }, 'panel')
      updateLockButton()
      if (select) select.value = String(sheetIndex)
      showToast(`已自动锁定工作表: ${sheetName}`, 'info')
    }

    if (previewBox) {
      // 快照先落定，再渲染：放大预览读的是快照，所以「面板里是什么，放大就是什么」。
      // 空状态：这一支是唯一可达的「无预览行」路径（renderPreviewTable 恒有表头行，
      // 不需要在里面再兜一层空数组分支）
      lastPreviewSnapshot =
        previewRows.length > 0
          ? { rows: previewRows, sheetIndex, sheetName, headerRow: meta.headerRow }
          : null
      const html =
        previewRows.length > 0
          ? renderPreviewTable(previewRows, sheetIndex, sheetName, meta.headerRow)
          : `<div class="preview-empty">已选择工作表索引: ${String(sheetIndex)} (${escapeHtml(sheetName)})<br>未检测到数据<br><span class="preview-empty-hint">确认数据区非空，或取消筛选后重试</span></div>`
      // 指纹未变 **且** 容器里仍是我们上次渲染的结果 → 跳过重建。
      // 第二个条件不能省：上一次渲染的是「请先选择工作表」这类提示时，
      // 新 HTML 与指纹恰好相同也会被误判成「已经渲染过了」而跳过，提示就永远刷不掉。
      const root = previewBox.firstElementChild
      const isAlreadyRendered =
        root?.classList.contains('preview-table') === true ||
        root?.classList.contains('preview-empty') === true
      if (!(isAlreadyRendered && html === lastPreviewHtml)) {
        // 渲染前统一经 sanitizeHtml 清洗，剥离可能的事件处理器/危险脚本
        previewBox.innerHTML = sanitizeHtml(html)
        lastPreviewHtml = html
      }
    }
    renderPreviewStats({
      headerRow: meta.headerRow,
      columnCount: meta.previewColumnEnd - meta.previewColumnStart,
      dataRowCount: previewRows.filter((row) => !row.isHeader).length,
      isFiltered,
    })
    updateFilterStatus(worksheet)
  }
  try {
    refreshDataCore()
  } finally {
    if (needRestore) needRestore()
  }
  bgmLog(LOG_LEVELS.INFO, `refreshData 完成, hasData=${String(previewBox != null)}`)
}

export function onSelectModeChange(): void {
  const manualInputs = document.getElementById('manualRangeInputs')
  const autoInfo = document.getElementById('autoRangeInfo')
  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="selectMode"]')

  for (const radio of modeRadios) {
    if (radio.checked) {
      if (radio.value === 'manual') {
        if (manualInputs) manualInputs.style.display = 'block'
        if (autoInfo) autoInfo.style.display = 'none'
      } else {
        if (manualInputs) manualInputs.style.display = 'none'
        if (autoInfo) autoInfo.style.display = 'block'
      }
      break
    }
  }
}

let _enlargeModal: HTMLElement | null = null
let _enlargeEscHandler: ((event: KeyboardEvent) => void) | null = null

/**
 * 放大预览
 *
 * 数据源是 {@link lastPreviewSnapshot}，渲染走 {@link renderPreviewTable} ——
 * 和面板内预览是**同一个出口**。此前是 `previewBox.innerHTML` 直接克隆：
 * 克隆会把面板的布局约束（300px 高度、窄窗格列宽）一起搬进模态框，等于只放大了
 * 外框；而且克隆出来的 DOM 绕过了渲染函数，两处结构一旦改动就会静默分叉。
 *
 * @param snapshot 仅供测试注入；生产路径用模块内快照
 */
export function enlargePreview(snapshot: PreviewSnapshot | null = lastPreviewSnapshot): void {
  if (!snapshot || snapshot.rows.length === 0) {
    showToast('请先刷新数据加载预览', 'info')
    return
  }

  if (_enlargeModal) {
    _enlargeModal.remove()
    _enlargeModal = null
  }

  // 与面板内预览同一个渲染函数：改了表格结构，放大视图自动跟着改
  const content = sanitizeHtml(
    renderPreviewTable(snapshot.rows, snapshot.sheetIndex, snapshot.sheetName, snapshot.headerRow),
  )

  const modal = document.createElement('div')
  modal.className = 'bgm-modal enlarge-preview-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')

  modal.innerHTML = sanitizeHtml(`
    <div class="bgm-modal-content enlarge-preview-modal-content">
      <div class="bgm-dialog-header enlarge-preview-header">
        <span class="bgm-dialog-title">🔍 数据预览（放大）</span>
        <button class="bgm-close-btn enlarge-close-btn" aria-label="关闭放大预览">×</button>
      </div>
      <div class="enlarged-preview-body">
        <div class="preview-box enlarged-preview-box">${content}</div>
      </div>
    </div>
  `)

  document.body.appendChild(modal)
  _enlargeModal = modal

  const closeModal = (): void => {
    if (_enlargeModal) {
      _enlargeModal.remove()
      _enlargeModal = null
    }
    if (_enlargeEscHandler) {
      document.removeEventListener('keydown', _enlargeEscHandler)
      _enlargeEscHandler = null
    }
  }

  modal.querySelectorAll('.enlarge-close-btn').forEach((button) => {
    button.addEventListener('click', closeModal)
  })

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal()
  })

  _enlargeEscHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeModal()
  }
  document.addEventListener('keydown', _enlargeEscHandler)

  modal.style.display = 'flex'
}

// ========== 自动检测并锁定工作表 ==========

/**
 * 跨所有已打开工作簿自动检测追踪表，找到后锁定该工作表并刷新预览
 * 返回 true 表示成功检测并锁定，false 表示未找到有效追踪表
 */
export function autoDetectAndLockSheet(options: { force?: boolean } = {}): boolean {
  // 已锁定 + 非强制：整条跳过（momo：识别到锁定后，再打开/关闭工作簿不需要
  // 重新检测表头——锁定目标不会因别的簿开/关而变，检测 + refreshData 全链
  // 在关簿瞬间还会和 WPS 的销毁流程抢 COM，卡顿源）。手动入口（工作簿下拉
  // 切换 / 重新检测按钮）传 force 仍全量重扫。
  if (options.force !== true && BGM.sheet.isLocked) {
    bgmLog(
      LOG_LEVELS.INFO,
      `autoDetectAndLockSheet: 已锁定「${BGM.sheet.lockedName ?? ''}」，跳过自动检测（force 可强制重扫）`,
    )
    return false
  }
  const detectStart = performance.now()
  const detected = autoDetectSheet(options)
  if (detected) {
    const landStart = performance.now()
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement | null
    if (wbSelect && detected.workbookName) wbSelect.value = detected.workbookName
    BGM.sheet.lockedIndex = detected.sheetIndex
    BGM.sheet.lockedName = detected.sheetName
    BGM.sheet.isLocked = true
    BGM.sheet.lockedWorkbookName = detected.workbookName || null
    saveLockedSheet(
      {
        index: detected.sheetIndex,
        name: detected.sheetName,
        ...(detected.workbookName && { workbookName: detected.workbookName }),
      },
      'panel',
    )
    refreshSheets()
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
    if (select) select.value = String(detected.sheetIndex)
    updateLockButton()
    refreshData()
    showToast(`已自动检测表头: ${detected.sheetName}`, 'info')
    // 性能日志（momo：审查性能参数）：检测段 / 落地段（列表 + 预览 + toast）分段打
    const detectMs = Math.round(landStart - detectStart)
    const landMs = Math.round(performance.now() - landStart)
    const totalMs = Math.round(performance.now() - detectStart)
    bgmLog(
      LOG_LEVELS.INFO,
      `[perf] autoDetectAndLockSheet: 检测 ${String(detectMs)}ms + 落地（列表/预览）${String(
        landMs,
      )}ms = 总 ${String(totalMs)}ms`,
    )
    return true
  }
  return false
}
