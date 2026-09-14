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
  colNumberToLetter,
  HEADER_KEYWORDS,
  IMPORTANT_COLS,
  showToast,
  getFilterStatus,
  getLastRow,
  clearSheetCache,
} from '../index.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { renderStatCards } from '../ui/stat-cards.js'
import {
  saveLockedSheet,
  findWorkbookByName,
  findBangumiTargetSheets,
  getOpenWorkbooks,
} from '../tools/locked-sheet.js'

// ========== 类型定义 ==========
interface LockedSheetInfo {
  index: number
  name: string
  workbookName?: string
}

interface CandidateHeader {
  row: number
  matchCount: number
  colCount: number
}

interface HeaderMeta {
  headerRow: number
  headerNames: string[]
  isImportant: boolean[]
  dataStartRow: number
  lastCol: number
  firstDataCol: number
  // 切片后的数组起始索引（0）
  previewColStart: number
  // 切片后的列数
  previewColEnd: number
  // 新增：预览第一列的实际列号（1‑based）
  previewColStartAbsolute: number
  headerMatchCount: number
}

interface PreviewRow {
  row: number
  cols: string[] | { text: string; important: boolean }[]
  isHeader: boolean
  aligned: boolean
  isImportant?: boolean[]
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

  if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === sheetIndex) {
    BGM.sheet.lockedIndex = null
    BGM.sheet.lockedName = null
    BGM.sheet.isLocked = false
    BGM.sheet.lockedWorkbookName = null
    saveLockedSheet(null)
    showToast('已解锁工作表', 'info')
  } else {
    const sheetName = select.options[select.selectedIndex]?.text ?? ''
    // 获取选中的工作簿名称
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement | null
    const wbName = wbSelect?.value ?? ''
    BGM.sheet.lockedIndex = sheetIndex
    BGM.sheet.lockedName = sheetName
    BGM.sheet.lockedWorkbookName = wbName || null
    BGM.sheet.isLocked = true
    const sheetInfo: LockedSheetInfo = { index: sheetIndex, name: sheetName }
    if (wbName) {
      sheetInfo.workbookName = wbName
    }
    saveLockedSheet(sheetInfo)
    showToast(`已锁定工作表: ${sheetName}${wbName ? `（工作簿: ${wbName}）` : ''}`, 'info')
  }
  updateLockButton()
  refreshData()
}

export function updateLockButton(): void {
  const button = document.getElementById('lockSheetBtn') as HTMLButtonElement | null
  const status = document.getElementById('lockStatus')

  if (button) {
    if (BGM.sheet.isLocked) {
      button.textContent = '🔓 解锁'
      button.classList.add('locked')
    } else {
      button.textContent = '🔒 锁定'
      button.classList.remove('locked')
    }
  }

  if (status) {
    if (BGM.sheet.isLocked) {
      status.style.display = 'inline'
      status.textContent = `已锁定: ${String(BGM.sheet.lockedName)}`
    } else {
      status.style.display = 'none'
    }
  }
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

  // 探测当前活动工作表索引（autoSelectActive 时用于自动选中）
  let activeSheetIndex = 0
  try {
    const activeSheet = workbook.ActiveSheet
    for (let index = 1; index <= sheets.Count; index += 1) {
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
  for (let index = 1; index <= sheets.Count; index += 1) {
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

export function activateSheetIfNeeded(ws: WpsWorksheet): (() => void) | false {
  const app = getApp()
  // 确保工作簿存在
  if (!app?.ActiveWorkbook) return false

  try {
    const active = app.ActiveWorkbook.ActiveSheet

    const activeName = active.Name || ''
    if (activeName !== (ws.Name || '')) {
      ws.Activate()
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
  ws: WpsWorksheet | null | undefined,
  options: { visibleRowSet?: Set<number> | null; isFiltered?: boolean } = {},
): HeaderMeta {
  const { visibleRowSet = null, isFiltered = false } = options

  // 判断某行是否可见
  function isRowVisible(r: number, headerRow: number): boolean {
    if (r === headerRow) return true
    return !isFiltered || (visibleRowSet?.has(r) ?? false)
  }

  // 1. 扫描前 MAX_SCAN_ROWS 行，找出所有候选表头行
  const candidates: CandidateHeader[] = []
  for (let r = 1; r <= PANEL_CONFIG.MAX_SCAN_ROWS; r += 1) {
    const shouldScanRow = !isFiltered || !visibleRowSet || visibleRowSet.has(r)
    if (shouldScanRow) {
      let matchCount = 0
      let colCount = 0
      for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
        try {
          const v = getCellValue(ws, r, c).trim()
          if (v) {
            colCount += 1
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
        candidates.push({ row: r, matchCount, colCount })
      }
    }
  }

  if (candidates.length === 0) {
    return {
      headerRow: 0,
      headerNames: [],
      isImportant: [],
      dataStartRow: 0,
      lastCol: 0,
      firstDataCol: 0,
      previewColStart: 0,
      previewColEnd: 0,
      previewColStartAbsolute: 0,
      headerMatchCount: 0,
    }
  }

  // 选列数最多、行号最小的作为表头
  candidates.sort((a, b) => b.colCount - a.colCount || a.row - b.row)
  const bestCandidate = candidates[0]
  const headerRow = bestCandidate?.row ?? 0
  const headerMatchCount = bestCandidate?.matchCount ?? 0

  // 2. 读取表头名称
  const headerNames: string[] = []
  const headerIsImportant: boolean[] = []
  for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
    const v = getCellValue(ws, headerRow, c).trim()
    headerNames.push(v)
    headerIsImportant.push(IMPORTANT_COLS[v.toLowerCase()] ?? false)
  }

  // 3. 检测多行表头（下一行是否填充了当前表头的空列）
  let dataStartRow = headerRow + 1
  const secondHeaderRowLimit = Math.min(headerRow + 1, PANEL_CONFIG.MAX_SCAN_ROWS)
  if (headerRow + 1 <= secondHeaderRowLimit) {
    let filled = 0
    let total = 0
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
      const nv = getCellValue(ws, headerRow + 1, c).trim()
      if (nv) {
        total += 1
        if (!Object.hasOwn(headerNames, c - 1)) filled += 1
      }
    }
    if (filled >= 3 && total >= 3) {
      dataStartRow = headerRow + 2
      for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
        const isExistingHeader = Object.hasOwn(headerNames, c - 1)
        if (!isExistingHeader) {
          const nv = getCellValue(ws, headerRow + 1, c).trim()
          if (nv) {
            headerNames[c - 1] = nv
            headerIsImportant[c - 1] = IMPORTANT_COLS[nv.toLowerCase()] ?? false
          }
        }
      }
    }
  }

  // 4. 计算实际使用的列范围（数据列）
  let firstDataCol = -1
  let lastDataCol = 0
  let samples = 0
  for (let dr = dataStartRow; dr <= dataStartRow + 20 && samples < 5; dr += 1) {
    const isDataRowVisible = isRowVisible(dr, headerRow)
    if (isDataRowVisible) {
      samples += 1
      for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
        const v = getCellValue(ws, dr, c).trim()
        if (v) {
          if (firstDataCol < 0) firstDataCol = c
          if (c > lastDataCol) lastDataCol = c
        }
      }
    }
  }
  if (firstDataCol < 0) firstDataCol = 1

  // 表头结束列
  let headerLastCol = 0
  for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
    if (Object.hasOwn(headerNames, c - 1)) headerLastCol = c
  }

  const actualLastCol = Math.max(lastDataCol, headerLastCol)

  // 预览显示的列范围：从第一个数据列左扩找到最左非空表头，但不能超过表头范围
  let previewColStart = Math.max(1, firstDataCol - 5)
  for (let c = previewColStart; c <= firstDataCol; c += 1) {
    if (Object.hasOwn(headerNames, c - 1)) {
      previewColStart = c
      break
    }
  }
  // 预览结束列为表头最大列，若实际数据超出表头范围则以表头为准
  const previewColEnd = Math.min(actualLastCol, headerLastCol)

  return {
    headerRow,
    headerNames: headerNames.slice(previewColStart - 1, previewColEnd),
    isImportant: headerIsImportant.slice(previewColStart - 1, previewColEnd),
    dataStartRow,
    lastCol: actualLastCol,
    firstDataCol,
    // 保留，但不用于数据读取
    previewColStart: 0,
    previewColEnd: previewColEnd - previewColStart + 1,
    // 新增，实际列号
    previewColStartAbsolute: previewColStart,
    headerMatchCount,
  }
}

export function autoDetectSheet(): {
  workbookName: string
  sheetIndex: number
  sheetName: string
  headerRow: number
  matchCount: number
  colCount: number
} | null {
  // 跨所有已打开工作簿扫描（表头 + 数据行数 + 名称关键词，优先活动工作簿/工作表）
  const candidates = findBangumiTargetSheets()
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
  return {
    workbookName: best.workbookName,
    sheetIndex: best.sheetIndex,
    sheetName: best.sheetName,
    headerRow: best.headerRow,
    matchCount: best.headerMatchCount,
    colCount: best.headerMatchCount,
  }
}
// ========== 筛选状态 ==========

/**
 * 收集活动筛选列描述（"列名(criteria)" 形式）；单列读取失败仅记录不中断。
 * （从 updateFilterStatus 的 try 块抽出，降低 try-complexity）
 */
function collectActiveFilterCols(ws: WpsWorksheet, filters: WpsFilters): string[] {
  const activeCols: string[] = []
  for (let index = 1; index <= filters.Count; index += 1) {
    try {
      const f = filters.Item(index)
      if (f.On) {
        let colName = ''
        try {
          const headerCell = ws.Range(`${colNumberToLetter(index)}1`)
          colName = String(headerCell.Value2 || '').substring(0, 12) // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- WPS 单元格值域不可控（空串/0/NaN），空值须回退
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
        activeCols.push(colName ? `${colName}(${criteria})` : `列${String(index)}`)
      }
    } catch (error: unknown) {
      BGM.handleError(error, {
        showAlert: false,
        level: BGM.ErrorLevel.INFO,
        context: 'updateFilterStatus',
      })
    }
  }
  return activeCols
}

export function updateFilterStatus(targetWs?: WpsWorksheet): void {
  const element = document.getElementById('filterStatus')
  if (!element) return

  const app = getApp()
  const sheet = targetWs ?? app?.ActiveWorkbook?.ActiveSheet
  if (!sheet) {
    // 处理：显示提示、返回等
    return
  }
  // 现在 sheet 被收窄为 WpsWorksheet
  const ws: WpsWorksheet = sheet

  let isAutoFilterMode = false
  try {
    isAutoFilterMode = !!ws.AutoFilterMode
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'updateFilterStatus',
    })
  }
  try {
    if (!isAutoFilterMode && ws.AutoFilter) isAutoFilterMode = !!ws.AutoFilter.Mode
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
    const autoFilter = ws.AutoFilter
    if (!autoFilter) {
      element.textContent = '筛选已开启但无活动筛选'
      return
    }
    const filters = autoFilter.Filters
    if (!filters?.Count) {
      element.textContent = '筛选已开启但无活动筛选，同步全部数据'
      return
    }

    const activeCols: string[] = collectActiveFilterCols(ws, filters)

    if (activeCols.length > 0) {
      const text = `✔ 筛选已开启（${String(activeCols.length)} 列），将同步筛选后的可见数据\n${activeCols.join('、')}`
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
  ws: WpsWorksheet,
  meta: HeaderMeta,
  segStart: number,
  segLength: number,
  dataRows: number[],
  index: number,
  displayColCount: number,
  previewRows: PreviewRow[],
): boolean {
  // 一次性读取整个矩形区域
  const startColLetter = colNumberToLetter(meta.previewColStartAbsolute)
  const endColLetter = colNumberToLetter(meta.previewColStartAbsolute + displayColCount - 1)
  const rangeAddr = ws.Range(
    `${startColLetter}${String(segStart)}:${endColLetter}${String(segStart + segLength - 1)}`,
  )
  const raw = rangeAddr.Value2
  // WPS JS API 返回 0-based 二维数组（raw[0][0] 为第一行第一列）
  const is2D = Array.isArray(raw)
  let hasData = false
  for (let r = 0; r < segLength; r += 1) {
    const dr = dataRows[index + r]
    if (dr !== undefined) {
      const rowCols: string[] = []
      let hasAny = false
      for (let ci = 0; ci < displayColCount; ci += 1) {
        let v: string
        if (is2D && Array.isArray(raw)) {
          const cell = raw[r]?.[ci]
          v = cell == null ? '' : String(cell).trim()
        } else if (segLength === 1 && displayColCount === 1) {
          v = raw == null ? '' : String(raw).trim()
        } else {
          v = getCellValue(ws, dr, meta.previewColStartAbsolute + ci).trim()
        }
        if (v) hasAny = true
        rowCols.push(v)
      }
      if (hasAny) {
        previewRows.push({ row: dr, cols: rowCols, isHeader: false, aligned: true })
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

function renderPreviewTable(
  rows: PreviewRow[],
  sheetIndex: number,
  sheetName: string,
  headerRow: number,
): string {
  let html = '<table class="preview-table"><tbody>'
  // 以表头行列数作为统一列数，避免不同行列数不同导致错位
  const headerItem = rows.find((r) => r.isHeader)
  const fixedColCount = headerItem?.aligned ? (headerItem.cols as string[]).length : 0
  for (const item of rows) {
    const rowClass = item.isHeader ? 'preview-header-row' : ''
    html += `<tr class="${rowClass}">`
    html += `<td class="preview-row-num">${String(item.isHeader ? 'H' : item.row)}</td>`
    if (item.aligned) {
      const cols = item.cols as string[]
      // 使用统一列数，确保所有行列对齐
      const colLimit = fixedColCount > 0 ? fixedColCount : cols.length
      for (let index = 0; index < colLimit; index += 1) {
        const text = cols[index] ?? ''
        let cls = ''
        if (item.isHeader) {
          cls = 'preview-header'
          if (item.isImportant?.[index] === true) cls += ' preview-important-header'
        }
        html += `<td class="${cls}">${escapeHtml(text)}</td>`
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
    if (previewBox) previewBox.innerHTML = sanitizeHtml('<p class="hint">请先选择工作表</p>')
    updateFilterStatus()
    return
  }

  const app = getApp()
  if (!app?.ActiveWorkbook) {
    if (previewBox) previewBox.innerHTML = sanitizeHtml('<p class="hint">未连接到 Excel</p>')
    updateFilterStatus()
    return
  }

  // 解析目标工作簿：锁定到特定工作簿时跨所有已打开工作簿定位，否则使用活动工作簿
  let workbook: WpsWorkbook = app.ActiveWorkbook
  if (BGM.sheet.lockedWorkbookName) {
    const lockedWorkbook = findWorkbookByName(BGM.sheet.lockedWorkbookName)
    if (lockedWorkbook) workbook = lockedWorkbook
  }

  let ws: WpsWorksheet | null | undefined = null
  try {
    ws = workbook.Worksheets.Item(sheetIndex)
  } catch (error: unknown) {
    if (previewBox)
      previewBox.innerHTML = sanitizeHtml(
        `<p class="hint">无法获取工作表: ${String(sheetIndex)}</p>`,
      )
    BGM.handleError(error, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'refreshData' })
    updateFilterStatus()
    return
  }
  // 检查工作表可访问性（WPS 桥接层可能返回不可用的代理对象）
  if (typeof ws.Activate !== 'function') {
    if (previewBox)
      previewBox.innerHTML = sanitizeHtml(
        `<p class="hint">无法访问工作表 ${String(sheetIndex)}</p>`,
      )
    BGM.handleError(new Error(`无法访问工作表 ${String(sheetIndex)}`), {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'refreshData',
    })
    updateFilterStatus()
    return
  }

  const sheetName = ws.Name || ''
  // 清除该工作表所有缓存，确保获取到最新数据
  if (typeof clearSheetCache === 'function') {
    clearSheetCache(ws)
  }
  const needRestore = activateSheetIfNeeded(ws)
  const refreshDataCore = (): void => {
    // 获取最后数据行（强制刷新，不使用缓存）
    const lastRow = getLastRow(ws, true)
    bgmLog(LOG_LEVELS.INFO, `工作表最后数据行: ${String(lastRow)}`)

    // 使用统一的筛选状态检测
    const filterStatus = getFilterStatus(ws, lastRow)
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

    const meta = detectHeaderAndColumns(ws, { visibleRowSet, isFiltered })
    // ✅ 保存供 previewSyncContent 使用
    BGM.dataPreview = {
      // 工作表引用
      ws,
      // 筛选后可见行（含表头）
      visibleRows,
      headerRow: meta.headerRow,
      dataStartRow: meta.dataStartRow,
      // 实际起始列号
      previewColStart: meta.previewColStartAbsolute,
      previewColEnd: meta.previewColStartAbsolute + (meta.previewColEnd - meta.previewColStart) - 1,
      columnCount: meta.previewColEnd - meta.previewColStart,
      headerNames: meta.headerNames.slice(meta.previewColStart, meta.previewColEnd),
      isImportant: meta.isImportant.slice(meta.previewColStart, meta.previewColEnd),
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `表头检测: headerRow=${String(meta.headerRow)}, dataStartRow=${String(meta.dataStartRow)}, 列数=${String(meta.previewColEnd - meta.previewColStart)}`,
    )

    const previewRows: PreviewRow[] = []
    let hasData = false

    if (meta.headerRow > 0) {
      previewRows.push({
        row: -1,
        cols: meta.headerNames.slice(meta.previewColStart, meta.previewColEnd),
        isHeader: true,
        aligned: true,
        isImportant: meta.isImportant.slice(meta.previewColStart, meta.previewColEnd),
      })

      const displayColCount = meta.previewColEnd - meta.previewColStart
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
            ws,
            meta,
            segStart,
            segLength,
            dataRows,
            index,
            displayColCount,
            previewRows,
          )
          if (isBatchHasData) hasData = true
        } catch {
          // 批量读取失败，回退到逐单元格
          for (let r = 0; r < segLength; r += 1) {
            const dr = dataRows[index + r]
            if (dr !== undefined) {
              const rowCols: string[] = []
              let hasAny = false
              for (let ci = 0; ci < displayColCount; ci += 1) {
                const col = meta.previewColStartAbsolute + ci
                const v = getCellValue(ws, dr, col).trim()
                if (v) hasAny = true
                rowCols.push(v)
              }
              if (hasAny) {
                previewRows.push({ row: dr, cols: rowCols, isHeader: false, aligned: true })
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
          // 与表头分支一致：cols 必须是字符串数组（aligned 路径的 renderPreviewTable
          // 按 string[] 渲染；此前 push {text,important} 对象会显示成 [object Object]）
          const cols: string[] = []
          let hasAny = false
          for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
            const v = getCellValue(ws, r, c).trim()
            if (v) {
              cols.push(v)
              hasAny = true
            }
          }
          if (hasAny) {
            previewRows.push({ row: r, cols, isHeader: false, aligned: true })
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
      saveLockedSheet({ index: sheetIndex, name: sheetName })
      updateLockButton()
      if (select) select.value = String(sheetIndex)
      showToast(`已自动锁定工作表: ${sheetName}`, 'info')
    }

    if (previewBox) {
      // 渲染前统一经 sanitizeHtml 清洗，剥离可能的事件处理器/危险脚本
      previewBox.innerHTML = sanitizeHtml(
        previewRows.length > 0
          ? renderPreviewTable(previewRows, sheetIndex, sheetName, meta.headerRow)
          : `<p class="hint">已选择工作表索引: ${String(sheetIndex)} (${escapeHtml(sheetName)})<br>未检测到数据</p>`,
      )
    }
    renderPreviewStats({
      headerRow: meta.headerRow,
      columnCount: meta.previewColEnd - meta.previewColStart,
      dataRowCount: previewRows.filter((row) => !row.isHeader).length,
      isFiltered,
    })
    updateFilterStatus(ws)
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

export function enlargePreview(): void {
  const previewBox = document.getElementById('previewBox')
  if (!previewBox) {
    showToast('没有可放大的预览内容', 'info')
    return
  }

  const content = previewBox.innerHTML.trim()
  if (!content.includes('<table')) {
    showToast('请先刷新数据加载预览', 'info')
    return
  }

  if (_enlargeModal) {
    _enlargeModal.remove()
    _enlargeModal = null
  }

  const modal = document.createElement('div')
  modal.className = 'bgm-modal enlarge-preview-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')

  modal.innerHTML = sanitizeHtml(`
    <div class="bgm-modal-content enlarge-preview-modal-content" style="max-width: 96vw; max-height: 96vh; display: flex; flex-direction: column; background: #1e1e1e; border-radius: 12px; width: 96vw;">
      <div class="bgm-dialog-header" style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid #444;">
        <span class="bgm-dialog-title" style="color:#fff;font-size:16px;font-weight:600;">🔍 数据预览（放大）</span>
        <button class="bgm-close-btn enlarge-close-btn" aria-label="关闭放大预览" style="background:none;border:none;color:#888;font-size:28px;cursor:pointer;padding:0;line-height:1;">×</button>
      </div>
      <div class="enlarged-preview-body" style="flex:1;overflow:auto;padding:18px;">
        <div class="preview-box enlarged-preview-box" style="max-height:none;overflow:auto;font-size:15px;">${content}</div>
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
export function autoDetectAndLockSheet(): boolean {
  const detected = autoDetectSheet()
  if (detected) {
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement | null
    if (wbSelect && detected.workbookName) wbSelect.value = detected.workbookName
    BGM.sheet.lockedIndex = detected.sheetIndex
    BGM.sheet.lockedName = detected.sheetName
    BGM.sheet.isLocked = true
    BGM.sheet.lockedWorkbookName = detected.workbookName || null
    saveLockedSheet({
      index: detected.sheetIndex,
      name: detected.sheetName,
      ...(detected.workbookName && { workbookName: detected.workbookName }),
    })
    refreshSheets()
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
    if (select) select.value = String(detected.sheetIndex)
    updateLockButton()
    refreshData()
    showToast(`已自动检测表头: ${detected.sheetName}`, 'info')
    return true
  }
  return false
}
