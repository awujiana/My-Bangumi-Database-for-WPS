/**
 * 任务面板 - 工作表生命周期与预览渲染
 * @module panel/panelLifecycle
 * @description 工作表锁定/解锁、表头检测、筛选状态、预览渲染等核心 UI 逻辑。
 *              从原 panel 模块拆分而来，保持函数签名与行为不变。
 */

import type { WpsFilters, WpsWorksheet } from '../index.js'
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

  const sheetIndex = parseInt(select.value, 10)
  if (isNaN(sheetIndex) || sheetIndex <= 0) {
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

export function saveLockedSheet(info: LockedSheetInfo | null): void {
  const app = getApp()
  if (app?.PluginStorage) {
    app.PluginStorage.setItem('bgm_locked_sheet', info ? JSON.stringify(info) : '')
  }
}

export function restoreLockedSheet(): boolean {
  const app = getApp()
  if (app?.PluginStorage) {
    const raw = app.PluginStorage.getItem('bgm_locked_sheet')
    if (raw) {
      try {
        const info = JSON.parse(raw) as Partial<LockedSheetInfo>
        BGM.sheet.lockedIndex = info.index ?? null
        BGM.sheet.lockedName = info.name ?? null
        BGM.sheet.lockedWorkbookName = info.workbookName ?? null
        BGM.sheet.isLocked = !!(info.index != null && info.name)

        // 验证锁定的工作簿是否仍然存在
        if (BGM.sheet.isLocked && info.workbookName && app.Workbooks) {
          let isWorkbookFound = false
          for (let index = 1; index <= app.Workbooks.Count; index += 1) {
            if (app.Workbooks.Item(index).Name === info.workbookName) {
              isWorkbookFound = true
              break
            }
          }
          if (!isWorkbookFound) {
            bgmLog(
              LOG_LEVELS.WARN,
              `[restoreLockedSheet] 锁定的工作簿 "${info.workbookName}" 已不存在，清除锁信息`,
            )
            BGM.sheet.lockedIndex = null
            BGM.sheet.lockedName = null
            BGM.sheet.lockedWorkbookName = null
            BGM.sheet.isLocked = false
            saveLockedSheet(null)
            return false
          }
        }

        return true
      } catch (error: unknown) {
        BGM.handleError(error, {
          showAlert: false,
          level: BGM.ErrorLevel.INFO,
          context: 'restoreLockedSheet',
        })
        saveLockedSheet(null)
      }
    }
  }
  return false
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

  // 获取选中的工作簿
  const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement | null
  let workbook = app.ActiveWorkbook
  if (wbSelect?.value) {
    const wbs = app.Workbooks
    if (wbs) {
      for (let index = 1; index <= wbs.Count; index += 1) {
        if (wbs.Item(index).Name === wbSelect.value) {
          workbook = wbs.Item(index)
          break
        }
      }
    }
  }

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

    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === index) {
      option.selected = true
      selectedIndex = index
    } else if (isAutoSelectActive && !BGM.sheet.isLocked && index === activeSheetIndex) {
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

  const wbs = app.Workbooks

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

  for (let index = 1; index <= wbs.Count; index += 1) {
    const option = document.createElement('option')
    const wb = wbs.Item(index)
    option.value = wb.Name
    option.text = wb.Name

    // 恢复之前选中值，或默认选中当前活动工作簿
    if (currentValue && currentValue === wb.Name) {
      option.selected = true
    } else if (!currentValue && wb.Name === activeWbName) {
      option.selected = true
      hasActiveWorkbook = true
    }

    select.appendChild(option)
  }

  if (!currentValue && !hasActiveWorkbook) {
    select.value = ''
  }

  bgmLog(LOG_LEVELS.INFO, `[refreshWorkbooks] 刷新工作簿列表: ${String(wbs.Count)} 个`)
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
    return !isFiltered || (visibleRowSet !== null && visibleRowSet.has(r))
  }

  // 1. 扫描前 MAX_SCAN_ROWS 行，找出所有候选表头行
  const candidates: CandidateHeader[] = []
  for (let r = 1; r <= PANEL_CONFIG.MAX_SCAN_ROWS; r += 1) {
    if (!isFiltered || !visibleRowSet || visibleRowSet.has(r)) {
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
        if (!headerNames[c - 1]) filled += 1
      }
    }
    if (filled >= 3 && total >= 3) {
      dataStartRow = headerRow + 2
      for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
        if (!headerNames[c - 1]) {
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
    if (isRowVisible(dr, headerRow)) {
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
    if (headerNames[c - 1]) headerLastCol = c
  }

  const actualLastCol = Math.max(lastDataCol, headerLastCol)

  // 预览显示的列范围：从第一个数据列左扩找到最左非空表头，但不能超过表头范围
  let previewColStart = Math.max(1, firstDataCol - 5)
  for (let c = previewColStart; c <= firstDataCol; c += 1) {
    if (headerNames[c - 1]) {
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
  sheetIndex: number
  sheetName: string
  headerRow: number
  matchCount: number
  colCount: number
} | null {
  const app = getApp()
  if (!app?.ActiveWorkbook) {
    BGM.handleError(new Error('Application 不可用'), {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'autoDetectSheet',
    })
    return null
  }

  const sheets = app.ActiveWorkbook.Worksheets
  let bestMatch: {
    sheetIndex: number
    sheetName: string
    headerRow: number
    matchCount: number
    colCount: number
  } | null = null

  bgmLog(LOG_LEVELS.INFO, `autoDetectSheet: 开始扫描 ${String(sheets.Count)} 个工作表...`)

  for (let si = 1; si <= sheets.Count; si += 1) {
    let needRestore: (() => void) | false = false
    const analyzeSheetCandidate = (
      current: {
        sheetIndex: number
        sheetName: string
        headerRow: number
        matchCount: number
        colCount: number
      } | null,
    ):
      | {
          sheetIndex: number
          sheetName: string
          headerRow: number
          matchCount: number
          colCount: number
        }
      | null
      | undefined => {
      const ws: WpsWorksheet = sheets.Item(si)
      if (typeof ws.Activate === 'function') {
        const sheetName = ws.Name || ''
        // 跳过特定系统表（例如同步记录等）
        if (/^(同步记录|SyncRecord|模糊|搜索|SEARCH)/i.test(sheetName)) {
          BGM.handleError(new Error(`autoDetectSheet: 跳过系统工作表 "${sheetName}"`), {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'autoDetectSheet',
          })
        } else {
          bgmLog(LOG_LEVELS.INFO, `autoDetectSheet: 正在分析工作表 "${sheetName}"`)

          needRestore = activateSheetIfNeeded(ws)
          const meta = detectHeaderAndColumns(ws)

          if (meta.headerRow === 0) {
            bgmLog(
              LOG_LEVELS.INFO,
              `  => 工作表 "${sheetName}" 未检测到有效表头 (headerRow=0), 已跳过`,
            )
          } else {
            let dataRowCount = 0
            let firstDataRow = -1
            for (let dr = meta.dataStartRow; dr <= meta.dataStartRow + 10; dr += 1) {
              let hasAny = false
              for (let c = 1; c <= meta.lastCol; c += 1) {
                if (getCellValue(ws, dr, c).trim()) {
                  hasAny = true
                  break
                }
              }
              if (hasAny) {
                dataRowCount += 1
                if (firstDataRow < 0) firstDataRow = dr
              }
            }

            BGM.handleError(
              new Error(
                `  => 工作表 "${sheetName}" 表头行 ${String(meta.headerRow)}, 匹配关键词数 ${String(meta.headerMatchCount)}, ` +
                  `数据列数 ${String(meta.lastCol)}, 前10行含数据行数 ${String(dataRowCount)}`,
              ),
              { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' },
            )

            if (dataRowCount < 2) {
              BGM.handleError(
                new Error(`  => 数据行不足 (${String(dataRowCount)} 行)，不视为有效数据表`),
                {
                  showAlert: false,
                  level: BGM.ErrorLevel.INFO,
                  context: 'autoDetectSheet',
                },
              )
            } else {
              const isBetter =
                !current ||
                meta.lastCol > current.colCount ||
                (meta.lastCol === current.colCount && meta.headerMatchCount > current.matchCount)

              BGM.handleError(
                new Error(
                  `  => 是否为当前最优: ${isBetter ? '是' : '否'} (现有最优: ${current ? `${current.sheetName}(列${String(current.colCount)})` : '无'})`,
                ),
                { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' },
              )

              if (isBetter) {
                return {
                  sheetIndex: si,
                  sheetName,
                  headerRow: meta.headerRow,
                  matchCount: meta.headerMatchCount,
                  colCount: meta.lastCol,
                }
              }
            }
          }
        }
      } else {
        BGM.handleError(
          new Error(`autoDetectSheet: 工作表索引 ${String(si)} 为 null 或无法访问，已跳过`),
          {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'autoDetectSheet',
          },
        )
      }
      return current
    }
    try {
      bestMatch = analyzeSheetCandidate(bestMatch) ?? bestMatch
    } catch (error: unknown) {
      BGM.handleError(error, {
        showAlert: false,
        level: BGM.ErrorLevel.INFO,
        context: 'autoDetectSheet',
      })
    } finally {
      const restoreFn = needRestore as (() => void) | false
      if (typeof restoreFn === 'function') restoreFn()
    }
  }

  if (bestMatch) {
    bgmLog(
      LOG_LEVELS.INFO,
      `autoDetectSheet: 最终选中工作表 "${bestMatch.sheetName}" (列${String(bestMatch.colCount)}, 行${String(bestMatch.headerRow)})`,
    )
  } else {
    bgmLog(
      LOG_LEVELS.WARN,
      'autoDetectSheet: 未在任何工作表中找到有效数据表头（可在切换工作表后手动选择）',
    )
  }
  return bestMatch
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
          criteria +=
            op === 1 ? ` 且 ${f.Criteria2}` : op === 2 ? ` 或 ${f.Criteria2}` : ` / ${f.Criteria2}`
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
function readPreviewSegmentBatch(
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
    if (!(dr === undefined)) {
      const rowCols: string[] = []
      let hasAny = false
      for (let ci = 0; ci < displayColCount; ci += 1) {
        let v: string
        if (is2D && Array.isArray(raw)) {
          const cell = raw[r]?.[ci]
          v = cell == null ? '' : String(cell).trim()
        } else {
          v =
            segLength === 1 && displayColCount === 1
              ? raw == null
                ? ''
                : String(raw).trim()
              : getCellValue(ws, dr, meta.previewColStartAbsolute + ci).trim()
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
  rows.forEach((item) => {
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
          if (item.isImportant?.[index]) cls += ' preview-important-header'
        }
        html += `<td class="${cls}">${escapeHtml(text)}</td>`
      }
    }
    html += '</tr>'
  })
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
  const parsedSheetIndex = BGM.sheet.lockedIndex ?? parseInt(select?.value ?? '')
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

  let ws: WpsWorksheet | null | undefined = null
  try {
    ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex)
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
  try {
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
      visibleRows: filterStatus.visibleRows,
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
      const dataRows = Array.from(
        new Set(
          filterStatus.visibleRows.filter((r) => r !== meta.headerRow && r >= meta.dataStartRow),
        ),
      ).sort((a, b) => a - b)
      const maxPreview = Math.min(dataRows.length, PANEL_CONFIG.PREVIEW_LIMIT)

      // 批量读取：按连续行段一次性读取 Range.Value2，减少 COM 调用次数
      let index = 0
      while (index < maxPreview) {
        // 找到连续行段
        let index_ = index
        while (index_ + 1 < maxPreview) {
          const next = dataRows[index_ + 1]
          const current = dataRows[index_]
          if (next === undefined || current === undefined || next !== current + 1) break
          index_ += 1
        }
        const segStart = dataRows[index]
        if (segStart === undefined) break
        const segLength = index_ - index + 1

        try {
          const batchHasData = readPreviewSegmentBatch(
            ws,
            meta,
            segStart,
            segLength,
            dataRows,
            index,
            displayColCount,
            previewRows,
          )
          if (batchHasData) hasData = true
        } catch {
          // 批量读取失败，回退到逐单元格
          for (let r = 0; r < segLength; r += 1) {
            const dr = dataRows[index + r]
            if (!(dr === undefined)) {
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
        if (!(isFiltered && visibleRowSet && !visibleRowSet.has(r))) {
          const cols: { text: string; important: boolean }[] = []
          let hasAny = false
          for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c += 1) {
            const v = getCellValue(ws, r, c).trim()
            if (v) {
              cols.push({ text: v, important: false })
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
    updateFilterStatus(ws)
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
  if (!content?.includes('<table')) {
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
    <div class="bgm-modal-content" style="max-width: 95vw; max-height: 95vh; display: flex; flex-direction: column; background: #2d2d2d; border-radius: 12px; width: 95vw;">
      <div class="bgm-dialog-header" style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid #444;">
        <span class="bgm-dialog-title" style="color:#fff;font-size:16px;font-weight:600;">🔍 数据预览（放大）</span>
        <button class="bgm-close-btn enlarge-close-btn" aria-label="关闭放大预览" style="background:none;border:none;color:#888;font-size:28px;cursor:pointer;padding:0;line-height:1;">×</button>
      </div>
      <div class="enlarged-preview-body" style="flex:1;overflow:auto;padding:16px;">
        <div class="preview-box enlarged-preview-box" style="max-height:none;overflow:auto;font-size:14px;transform-origin:top left;transform:scale(1.3);">
          ${content}
        </div>
      </div>
      <div class="bgm-dialog-footer" style="padding:10px 20px;border-top:1px solid #444;display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn enlarge-close-btn" type="button">关闭</button>
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
 * 在当前活动工作簿中自动检测表头，找到后锁定该工作表并刷新预览
 * 返回 true 表示成功检测并锁定，false 表示未找到有效表头
 */
export function autoDetectAndLockSheet(): boolean {
  const app = getApp()
  const detected = autoDetectSheet()
  if (detected) {
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
    if (select) select.value = String(detected.sheetIndex)
    BGM.sheet.lockedIndex = detected.sheetIndex
    BGM.sheet.lockedName = detected.sheetName
    BGM.sheet.isLocked = true
    const activeWbName = app?.ActiveWorkbook?.Name ?? ''
    if (activeWbName) {
      BGM.sheet.lockedWorkbookName = activeWbName
    }
    saveLockedSheet({
      index: detected.sheetIndex,
      name: detected.sheetName,
      ...(activeWbName ? { workbookName: activeWbName } : {}),
    })
    updateLockButton()
    refreshData()
    showToast(`已自动检测表头: ${detected.sheetName}`, 'info')
    return true
  }
  return false
}
