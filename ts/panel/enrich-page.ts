/**
 * @fileoverview 富化页面的 UI 控制器
 * @module panel/enrichPage
 * @description 负责文件选择、表头识别、列映射编辑、匹配预览、富化执行与进度、富化记录查看。
 */

import { LOG_LEVELS } from '../core/constants.js'
import {
  detectColumns,
  matchEntries,
  enrichEntries,
  resolveConflictField,
} from '../sync/enrich-engine.js'
import type {
  EnrichColumnMapping,
  EnrichConfig,
  MatchResult,
  EnrichResultItem,
  EnrichProgress,
  ProgressCallback,
  ConflictInfo,
  EnrichedField,
} from '../sync/enrich-engine.js'
import {
  refreshEnrichWorkbooks,
  refreshEnrichSheets,
  toggleEnrichWorkbookLock,
  updateEnrichLockButton,
  getLockedEnrichSheet,
  initEnrichLock,
} from '../sync/enrich-lock.js'
import {
  getAllEnrichRecords,
  getOrCreateEnrichRecordSheet,
  clearEnrichRecords,
} from '../sync/enrich-record.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { escapeHtml } from '../tools/string-utilities.js'
import {
  getCellValue,
  getLastRow,
  findHeaderRow,
  getDataSheet,
  bgmLog,
  BGM,
  getApp,
} from '../tools/util/index.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'

// ========== 类型定义 ==========

interface BatchFileResult {
  filePath: string
  fileName: string
  matched: number
  addedEntries: number
  updatedEntries: number
  unmatched: number
  success: boolean
  error?: string
}

interface EnrichPageState {
  filePath: string
  animeSourceSheet: WpsWorksheet | null
  bangumiSheet: WpsWorksheet | null
  columnMapping: EnrichColumnMapping | null
  headerRow: number
  dataStartRow: number
  matches: MatchResult[]
  isEnriching: boolean
  cancelRequested: boolean
  pendingConflicts: ConflictInfo[]
  currentConflictIndex: number

  // 批量字段
  batchFiles: string[]
  batchResults: BatchFileResult[]
  batchIndex: number
  isBatchEnriching: boolean
  batchCancelRequested: boolean
}

// ========== 状态 ==========

const state: EnrichPageState = {
  filePath: '',
  animeSourceSheet: null,
  bangumiSheet: null,
  columnMapping: null,
  headerRow: 0,
  dataStartRow: 0,
  matches: [],
  isEnriching: false,
  cancelRequested: false,
  pendingConflicts: [],
  currentConflictIndex: 0,

  batchFiles: [],
  batchResults: [],
  batchIndex: 0,
  isBatchEnriching: false,
  batchCancelRequested: false,
}

// ========== 列映射字段元数据 ==========

const COLUMN_MAPPING_FIELDS: {
  key: keyof EnrichColumnMapping
  label: string
  required: boolean
}[] = [
  { key: 'nameCol', label: '名称', required: true },
  { key: 'tagsCol', label: 'TAGS/标签', required: false },
  { key: 'premiereCol', label: '首播', required: false },
  { key: 'episodesCol', label: '集数', required: false },
  { key: 'weekdayCol', label: '周更时间', required: false },
  { key: 'platformCol', label: '播放平台', required: false },
  { key: 'exclusiveCol', label: '独播', required: false },
  { key: 'specialCol', label: '特殊/备注', required: false },
]

// ========== 工具函数 ==========

function safeGetElement(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function safeGetButton(id: string): HTMLButtonElement | null {
  const element = document.getElementById(id)
  return element instanceof HTMLButtonElement ? element : null
}

function safeGetSelect(id: string): HTMLSelectElement | null {
  const element = document.getElementById(id)
  return element instanceof HTMLSelectElement ? element : null
}

function formatEta(etaMs: number): string {
  if (etaMs <= 0) return '-'
  const seconds = Math.ceil(etaMs / 1000)
  if (seconds < 60) return `${String(seconds)}秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${String(minutes)}分${String(remainingSeconds)}秒`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${String(hours)}时${String(remainingMinutes)}分`
}

// ========== 初始化 ==========

export function initEnrichPage(): void {
  bgmLog(LOG_LEVELS.INFO, '[enrich] initEnrichPage 开始')

  // 初始化富化工作簿锁定模块（恢复持久化的锁定状态）
  initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')

  bindFileSelector()
  bindDetectHeaderButton()
  bindTargetSheetControls()
  bindTabSwitches()
  bindStartEnrichButton()
  bindRecordControls()
  bindBatchControls()
  loadRecentRecords()

  // 如果有锁定的工作表，自动填充到 state
  if (BGM.enrich.isLocked && BGM.enrich.lockedSheetIndex) {
    const locked = getLockedEnrichSheet()
    if (locked) {
      state.bangumiSheet = locked[1]
      bgmLog(LOG_LEVELS.INFO, `[enrich] 已恢复锁定的目标工作表: ${locked[1].Name}`)
    }
  }

  // 通知模块就绪，启用按钮（与 panelPage.initPanelCore / settings-entry.startSettings 对齐）
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'))
    bgmLog(LOG_LEVELS.INFO, '[enrich] initEnrichPage 完成，bgm:modulesReady 已触发')
  }
}

function bindFileSelector(): void {
  const button = safeGetButton('selectFileBtn')
  if (button) {
    button.addEventListener('click', () => {
      selectNewAnimeFile()
    })
  }
}

function bindDetectHeaderButton(): void {
  const button = safeGetButton('detectHeaderBtn')
  if (button) {
    button.addEventListener('click', () => {
      autoDetectHeader()
    })
  }
}

function bindTargetSheetControls(): void {
  const wbSelect = safeGetSelect('workbookSelect')
  if (wbSelect) {
    wbSelect.addEventListener('change', () => {
      refreshSheetList()
      // 切换工作簿时同步锁定状态显示
      updateEnrichLockButton('lockSheetBtn', 'lockStatus')
    })
  }

  const sheetSelect = safeGetSelect('sheetSelect')
  if (sheetSelect) {
    sheetSelect.addEventListener('change', () => {
      selectTargetSheet()
      // 切换工作表时同步锁定状态显示
      updateEnrichLockButton('lockSheetBtn', 'lockStatus')
    })
  }

  const refreshButton = document.querySelector('[data-action="refreshSheets"]')
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      refreshWorkbookList()
      refreshSheetList()
      updateEnrichLockButton('lockSheetBtn', 'lockStatus')
    })
  }

  const lockButton = safeGetButton('lockSheetBtn')
  if (lockButton) {
    lockButton.addEventListener('click', () => {
      toggleSheetLock()
    })
  }

  refreshWorkbookList()
  refreshSheetList()
}

function bindTabSwitches(): void {
  const tabs = document.querySelectorAll('.preview-tab')
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab')
      if (!tabName) return

      tabs.forEach((t) => {
        t.classList.remove('active')
      })
      tab.classList.add('active')

      const sourceTable = safeGetElement('sourcePreviewTable')
      const matchTable = safeGetElement('matchPreviewTable')
      if (tabName === 'source') {
        if (sourceTable) sourceTable.style.display = ''
        if (matchTable) matchTable.style.display = 'none'
      } else if (tabName === 'match') {
        if (sourceTable) sourceTable.style.display = 'none'
        if (matchTable) matchTable.style.display = ''
      }
    })
  })
}

function bindStartEnrichButton(): void {
  const button = safeGetButton('startEnrichBtn')
  if (button) {
    button.addEventListener('click', () => {
      startEnrichment()
    })
  }
}

function bindRecordControls(): void {
  const openRecordButton = document.querySelector('[data-action="openRecordSheet"]')
  if (openRecordButton) {
    openRecordButton.addEventListener('click', () => {
      openEnrichRecordSheet()
    })
  }

  const clearRecordButton = document.querySelector('[data-action="clearRecords"]')
  if (clearRecordButton) {
    clearRecordButton.addEventListener('click', () => {
      clearRecords()
    })
  }
}

// ========== 文件选择（单/多选统一入口） ==========
//
// WPS 不支持原生多选文件对话框，这里采用"循环单选 + 询问是否继续"的模式：
//   1. 首次进入循环：弹出 GetOpenFilename 让用户选一个文件
//   2. 选中后：自动加入 state.batchFiles
//   3. 弹 confirm"继续添加？"，确定 → 回到步骤 1，取消 → 退出循环
//   4. 第一次选中的文件同时作为 state.filePath（单文件"开始富化"的目标）
// 这样不管是单文件富化还是批量富化，都只走这一个入口。
//
// state.batchFiles 与 state.filePath 的关系：
//   - state.batchFiles = []              → 还没选过文件
//   - state.batchFiles = [f1]            → 只选了 f1（单文件）
//   - state.batchFiles = [f1, f2, ...]   → 批量（f1 = state.filePath 是首个）

export function selectNewAnimeFile(): void {
  try {
    const app = getApp() as {
      GetOpenFilename?: (fileFilter: string, title: string) => unknown
    } | null

    if (!app || typeof app.GetOpenFilename !== 'function') {
      BGM.Dialog.alert('提示', 'WPS 文件对话框不可用，请直接在 WPS 中打开文件')
      return
    }

    const fileFilter =
      'Excel 文件 (*.xlsx),*.xlsx,Excel 97-2003 文件 (*.xls),*.xls,CSV 文件 (*.csv),*.csv,所有文件 (*.*),*.*'

    for (;;) {
      const titleSuffix =
        state.batchFiles.length > 0
          ? `（已选 ${String(state.batchFiles.length)} 个，继续添加按"取消"结束）`
          : ''
      const selected = app.GetOpenFilename(fileFilter, `选择新番表文件${titleSuffix}`)

      // 用户取消
      if (typeof selected === 'boolean' || selected === false) {
        bgmLog(LOG_LEVELS.INFO, '[enrich] 用户取消文件选择')
        break
      }

      const filePath = String(selected)
      const fileName = extractFileName(filePath)

      // 重复文件跳过
      if (state.batchFiles.includes(filePath)) {
        BGM.Dialog.alert('提示', `文件已在列表中：\n${fileName}`)
      } else {
        state.batchFiles.push(filePath)
        // 首个文件同时作为单文件富化目标
        if (state.batchFiles.length === 1) {
          state.filePath = filePath
        }
        bgmLog(
          LOG_LEVELS.INFO,
          `[enrich] 已选择文件: ${fileName}（共 ${String(state.batchFiles.length)} 个）`,
        )

        // 每次选完后同步刷新 UI（让用户看到当前已选列表）
        renderBatchFileList()

        // 询问是否继续添加（WPS 同步阻塞式 confirm：回调里改 shouldContinue，随后立即读取）
        // `false as boolean`：避免 TS 将闭包赋值忽略后把变量静态收窄为 false 字面量
        let shouldContinue = false as boolean
        BGM.Dialog.confirm(
          `已添加 ${fileName}\n当前共 ${String(state.batchFiles.length)} 个文件\n点击【确定】继续添加，点击【取消】完成选择`,
          (isConfirmed: boolean) => {
            shouldContinue = isConfirmed
          },
          '继续添加？',
        )
        if (!shouldContinue) break
      }
    }
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: true,
      level: BGM.ErrorLevel.ERROR,
      context: 'selectNewAnimeFile',
    })
  }
}

/** 渲染文件选择区 UI：路径展示、文件列表、批量按钮可见性 */
function renderBatchFileList(): void {
  const pathElement = safeGetElement('filePathDisplay')
  const listElement = safeGetElement('batchFileList')
  const startButton = safeGetButton('batchStartBtn')
  const clearButton = safeGetButton('batchClearBtn')
  const progressElement = safeGetElement('batchProgress')
  const summaryElement = safeGetElement('batchSummary')
  const singleEnrichButton = safeGetButton('startEnrichBtn')

  const n = state.batchFiles.length

  // 1) 路径展示
  if (pathElement) {
    if (n === 0) {
      pathElement.textContent = ''
      pathElement.setAttribute('placeholder', '未选择文件...')
      pathElement.removeAttribute('title')
    } else if (n === 1) {
      pathElement.textContent = state.batchFiles[0]!
      pathElement.setAttribute('title', state.batchFiles[0]!)
    } else {
      const firstName = extractFileName(state.batchFiles[0]!)
      pathElement.textContent = `已选 ${String(n)} 个文件（首个：${firstName}）`
      pathElement.setAttribute('title', state.batchFiles.join('\n'))
    }
  }

  // 2) 单文件"开始富化"按钮的启用状态
  if (singleEnrichButton) {
    singleEnrichButton.disabled = n === 0
  }

  // 3) 文件列表（只在 N≥1 时显示）
  if (listElement) {
    if (n === 0) {
      listElement.style.display = 'none'
      listElement.replaceChildren()
    } else {
      const rows = state.batchFiles.map((filePath, index) => {
        const fileName = extractFileName(filePath)
        return `
          <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid #2a2a2a;font-size:12px;">
            <span style="color:#888;flex-shrink:0;">#${String(index + 1)}</span>
            <span style="flex:1;color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(filePath)}">${escapeHtml(fileName)}</span>
            <button class="bgm-btn small" data-batch-remove="${String(index)}" style="flex-shrink:0;padding:2px 6px;font-size:11px;">✕</button>
          </div>
        `
      })
      listElement.innerHTML = sanitizeHtml(rows.join(''))
      listElement.style.display = ''

      listElement.querySelectorAll('[data-batch-remove]').forEach((button) => {
        button.addEventListener('click', () => {
          const index = parseInt((button as HTMLElement).dataset.batchRemove || '-1', 10)
          if (index >= 0) batchRemoveFile(index)
        })
      })
    }
  }

  // 4) 批量按钮可见性
  //    - 批量富化：N≥2 才显示（单文件走"开始富化"）
  //    - 清空列表：N≥1 才显示
  if (startButton) startButton.style.display = n >= 2 ? '' : 'none'
  if (clearButton) clearButton.style.display = n >= 1 ? '' : 'none'

  // 5) 进行中/汇总进度区域重置（清空时一并隐藏）
  if (n === 0) {
    if (progressElement) progressElement.style.display = 'none'
    if (summaryElement) summaryElement.style.display = 'none'
    state.batchResults = []
    state.filePath = ''
  }
}

// ========== 表头自动识别 ==========

export function autoDetectHeader(): void {
  const app = getApp()
  if (!app?.ActiveWorkbook) {
    BGM.Dialog.alert('提示', '未连接到 Excel，请先打开包含新番表的工作簿')
    return
  }

  const sheetSelect = safeGetSelect('sheetSelect')
  let ws: WpsWorksheet | null = null

  if (sheetSelect?.value) {
    const sheetIndex = parseInt(sheetSelect.value, 10)
    const wb = getSelectedWorkbook()
    if (wb && sheetIndex > 0) {
      try {
        ws = wb.Worksheets.Item(sheetIndex)
      } catch (error: unknown) {
        BGM.handleError(error, {
          showAlert: false,
          level: BGM.ErrorLevel.INFO,
          context: 'autoDetectHeader',
        })
      }
    }
  }

  if (!ws) {
    const dataSheet = getDataSheet()
    if (dataSheet) {
      ws = dataSheet
    } else {
      BGM.Dialog.alert('提示', '请先选择新番表所在的工作表')
      return
    }
  }

  state.animeSourceSheet = ws

  try {
    const headerRow = findHeaderRow(ws)
    if (headerRow === 0) {
      BGM.Dialog.alert('提示', '未检测到有效的表头行，请检查表头是否在前 10 行内')
      return
    }

    state.headerRow = headerRow
    state.dataStartRow = headerRow + 1

    const mapping = detectColumns(ws, headerRow)
    state.columnMapping = mapping

    renderDetectResult(ws, mapping)
    renderColumnMappingEditor(ws, mapping)

    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich] 表头识别完成: headerRow=${String(headerRow)}, nameCol=${String(mapping.nameCol)}`,
    )

    renderSourcePreview(ws, mapping)
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'autoDetectHeader',
    })
    BGM.Dialog.error(
      '错误',
      `识别表头失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function renderDetectResult(ws: WpsWorksheet, _mapping: EnrichColumnMapping): void {
  const resultArea = safeGetElement('detectResult')
  if (!resultArea) return

  const sheetName = ws.Name || '未知'
  const sheetNameElement = safeGetElement('detectSheetName')
  if (sheetNameElement) sheetNameElement.textContent = sheetName

  const headerRowElement = safeGetElement('detectHeaderRow')
  if (headerRowElement) headerRowElement.textContent = String(state.headerRow)

  const dataRowElement = safeGetElement('detectDataRow')
  if (dataRowElement) dataRowElement.textContent = String(state.dataStartRow)

  resultArea.style.display = ''
}

function renderColumnMappingEditor(ws: WpsWorksheet, mapping: EnrichColumnMapping): void {
  const mappingList = safeGetElement('mappingList')
  if (!mappingList) return

  const maxCols = 50
  const { headerRow } = state
  const colOptions: { col: number; header: string }[] = []

  for (let col = 1; col <= maxCols; col += 1) {
    const header = getCellValue(ws, headerRow, col).trim()
    if (header) {
      colOptions.push({ col, header })
    }
  }

  let html = ''

  for (const field of COLUMN_MAPPING_FIELDS) {
    const currentCol = mapping[field.key]
    const selectedValue = currentCol ? String(currentCol) : ''

    const optionsHtml = `<option value="">-- 未映射 --</option>${colOptions
      .map(
        (o) =>
          `<option value="${String(o.col)}" ${String(o.col) === selectedValue ? 'selected' : ''}>${escapeHtml(o.header)} (列${String(o.col)})</option>`,
      )
      .join('')}`

    const requiredMark = field.required ? ' <span style="color:#ff6b6b;">*</span>' : ''

    html += `
      <div class="mapping-item" data-field="${field.key}">
        <label class="mapping-label">${escapeHtml(field.label)}${requiredMark}</label>
        <select class="mapping-select" data-field="${field.key}">
          ${optionsHtml}
        </select>
      </div>
    `
  }

  mappingList.innerHTML = sanitizeHtml(html)

  const selects = mappingList.querySelectorAll<HTMLSelectElement>('.mapping-select')
  selects.forEach((select) => {
    const fieldKey = select.getAttribute('data-field') as keyof EnrichColumnMapping | null
    if (!fieldKey) return

    select.addEventListener('change', () => {
      const value = parseInt(select.value, 10)
      if (state.columnMapping) {
        updateColumnMapping(fieldKey, isNaN(value) ? 0 : value)
      }
    })
  })
}

function updateColumnMapping(field: keyof EnrichColumnMapping, value: number): void {
  if (!state.columnMapping) return

  if (value === 0) {
    state.columnMapping[field] = undefined as never
  } else {
    state.columnMapping[field] = value
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrich] 列映射更新: ${field} → ${value > 0 ? `列${String(value)}` : '未映射'}`,
  )
}

// ========== 目标工作表选择 ==========

function getSelectedWorkbook(): WpsWorkbook | null {
  const app = getApp()
  if (!app?.ActiveWorkbook) return null

  const wbSelect = safeGetSelect('workbookSelect')
  const wbName = wbSelect?.value ?? ''

  if (!wbName) return app.ActiveWorkbook

  const wbs = app.Workbooks
  if (!wbs) return app.ActiveWorkbook

  for (let index = 1; index <= wbs.Count; index += 1) {
    const wb = wbs.Item(index)
    if (wb.Name === wbName) {
      return wb
    }
  }
  return app.ActiveWorkbook
}

function refreshWorkbookList(): void {
  refreshEnrichWorkbooks('workbookSelect')

  // 如果已锁定，选中锁定的工作簿
  if (BGM.enrich.isLocked && BGM.enrich.lockedWorkbookName) {
    const wbSelect = safeGetSelect('workbookSelect')
    if (wbSelect) wbSelect.value = BGM.enrich.lockedWorkbookName
  }
}

function refreshSheetList(): void {
  const wbSelect = safeGetSelect('workbookSelect')
  const wbName = wbSelect?.value || undefined

  refreshEnrichSheets(wbName, 'sheetSelect', 'workbookSelect')

  // 如果已锁定，选中锁定的工作表
  if (BGM.enrich.isLocked && BGM.enrich.lockedSheetIndex) {
    const sheetSelect = safeGetSelect('sheetSelect')
    if (sheetSelect) sheetSelect.value = String(BGM.enrich.lockedSheetIndex)
  }
}

function selectTargetSheet(): void {
  const sheetSelect = safeGetSelect('sheetSelect')
  if (!sheetSelect?.value) {
    state.bangumiSheet = null
    return
  }

  const sheetIndex = parseInt(sheetSelect.value, 10)
  const wb = getSelectedWorkbook()
  if (!wb || sheetIndex <= 0) {
    state.bangumiSheet = null
    return
  }

  try {
    const ws = wb.Worksheets.Item(sheetIndex)
    state.bangumiSheet = ws
    bgmLog(LOG_LEVELS.INFO, `[enrich] 已选择目标工作表: ${ws.Name} (索引: ${String(sheetIndex)})`)

    // 同步到 BGM.enrich 状态（未锁定时自动更新）
    if (!BGM.enrich.isLocked) {
      BGM.enrich.lockedWorkbookName = wb.Name
      BGM.enrich.lockedSheetName = ws.Name
      BGM.enrich.lockedSheetIndex = sheetIndex
    }
  } catch (error: unknown) {
    state.bangumiSheet = null
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'selectTargetSheet',
    })
  }
}

function toggleSheetLock(): void {
  toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus')

  const sheetSelect = safeGetSelect('sheetSelect')
  if (!sheetSelect) return
  sheetSelect.disabled = BGM.enrich.isLocked

  if (!BGM.enrich.isLocked) {
    state.bangumiSheet = null
  }
}

// ========== 源数据预览 ==========

function renderSourcePreview(ws: WpsWorksheet, _mapping: EnrichColumnMapping): void {
  const tableContainer = safeGetElement('sourceTable')
  if (!tableContainer) return

  const maxRows = 20
  const maxCols = 50
  const { headerRow } = state
  const { dataStartRow } = state

  const headerCells: string[] = []
  for (let col = 1; col <= maxCols; col += 1) {
    const value = getCellValue(ws, headerRow, col).trim()
    if (value) {
      headerCells.push(escapeHtml(value))
    }
  }

  const thead = tableContainer.querySelector('thead')
  if (thead) {
    thead.innerHTML = sanitizeHtml(`<tr>${headerCells.map((h) => `<th>${h}</th>`).join('')}</tr>`)
  }

  const tbody = tableContainer.querySelector('tbody')
  if (!tbody) return

  const rowsHtml: string[] = []
  const lastRow = Math.min(getLastRow(ws), dataStartRow + maxRows - 1)

  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const rowCells: string[] = []
    let hasData = false
    for (let col = 1; col <= headerCells.length; col += 1) {
      const value = getCellValue(ws, row, col).trim()
      if (value) hasData = true
      rowCells.push(escapeHtml(value))
    }
    if (hasData) {
      rowsHtml.push(
        `<tr data-row="${String(row)}">${rowCells.map((c) => `<td>${c}</td>`).join('')}</tr>`,
      )
    }
  }

  tbody.innerHTML = sanitizeHtml(rowsHtml.join(''))

  bgmLog(LOG_LEVELS.INFO, `[enrich] 源数据预览已渲染: ${String(rowsHtml.length)} 行`)
}

// ========== 匹配预览 ==========

export function previewMatch(): void {
  if (!state.animeSourceSheet) {
    BGM.Dialog.alert('提示', '请先选择新番表文件并识别表头')
    return
  }
  if (!state.bangumiSheet) {
    BGM.Dialog.alert('提示', '请先选择目标 Bangumi 工作表')
    return
  }
  if (!state.columnMapping || state.columnMapping.nameCol === 0) {
    BGM.Dialog.alert('提示', '列映射未正确识别，缺少名称列')
    return
  }

  try {
    const config: EnrichConfig = {
      filePath: state.filePath,
      sheetName: state.animeSourceSheet.Name || '',
      headerRow: state.headerRow,
      dataStartRow: state.dataStartRow,
      columnMapping: state.columnMapping,
      targetSheetName: state.bangumiSheet.Name || '',
    }

    state.matches = matchEntries(state.animeSourceSheet, state.bangumiSheet, config)

    renderMatchStats(state.matches)
    renderMatchResultsToTable(state.matches)

    bgmLog(LOG_LEVELS.INFO, `[enrich] 匹配预览完成: ${String(state.matches.length)} 条结果`)
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'previewMatch',
    })
    BGM.Dialog.error(
      '错误',
      `匹配预览失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function renderMatchStats(matches: MatchResult[]): void {
  const statsArea = safeGetElement('matchStats')
  if (!statsArea) return

  const exactCount = matches.filter((m) => m.matchType === 'exact').length
  const aliasCount = matches.filter((m) => m.matchType === 'alias').length
  const unmatchedCount = matches.filter((m) => m.matchType === 'unmatched').length

  const exactElement = safeGetElement('exactMatchCount')
  if (exactElement) exactElement.textContent = String(exactCount)

  const aliasElement = safeGetElement('aliasMatchCount')
  if (aliasElement) aliasElement.textContent = String(aliasCount)

  const unmatchedElement = safeGetElement('unmatchedCount')
  if (unmatchedElement) unmatchedElement.textContent = String(unmatchedCount)

  statsArea.style.display = ''
}

function renderMatchResultsToTable(matches: MatchResult[]): void {
  const tbodyElement = safeGetElement('matchTable')?.querySelector('tbody')
  if (!tbodyElement) return

  const maxDisplay = 20
  const displayMatches = matches.slice(0, maxDisplay)

  const rowsHtml = displayMatches.map((m) => {
    let statusClass = 'match-status'
    let statusText = ''
    switch (m.matchType) {
      case 'exact': {
        statusClass += ' status-exact'
        statusText = '✅ 精确'
        break
      }
      case 'alias': {
        statusClass += ' status-alias'
        statusText = '🔄 别名'
        break
      }
      case 'unmatched': {
        statusClass += ' status-unmatched'
        statusText = '❌ 未匹配'
        break
      }
      case 'error': {
        statusClass += ' status-error'
        statusText = '⚠️ 错误'
        break
      }
    }

    const bangumiRow = m.bangumiRow ? String(m.bangumiRow) : '-'
    const name = escapeHtml(m.matchedAnimeName)
    const bangumiName = m.bangumiName ? escapeHtml(m.bangumiName) : '-'

    return `
      <tr class="match-row match-${m.matchType}">
        <td>${name}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
        <td>${bangumiRow}</td>
        <td>${bangumiName}</td>
      </tr>
    `
  })

  tbodyElement.innerHTML = sanitizeHtml(rowsHtml.join(''))

  const matchTableContainer = safeGetElement('matchPreviewTable')
  if (matchTableContainer) {
    matchTableContainer.style.display = ''
  }
}

// ========== 富化执行 ==========

export function startEnrichment(): void {
  if (state.isEnriching) {
    bgmLog(LOG_LEVELS.WARN, '[enrich] 富化正在进行中，忽略重复请求')
    return
  }

  if (!state.animeSourceSheet) {
    BGM.Dialog.alert('提示', '请先选择新番表文件并识别表头')
    return
  }

  // 如果 state 中没有 bangumiSheet，尝试从锁定状态获取
  if (!state.bangumiSheet) {
    const locked = getLockedEnrichSheet()
    if (locked) {
      state.bangumiSheet = locked[1]
      bgmLog(LOG_LEVELS.INFO, `[enrich] 使用锁定的目标工作表: ${locked[1].Name}`)
    }
  }

  if (!state.bangumiSheet) {
    BGM.Dialog.alert('提示', '请先选择目标 Bangumi 工作表')
    return
  }
  if (!state.columnMapping || state.columnMapping.nameCol === 0) {
    BGM.Dialog.alert('提示', '列映射未正确识别')
    return
  }

  if (state.matches.length === 0) {
    previewMatch()
    // 重新读取（previewMatch 可能已更新 state.matches）
    const recheckedMatches = state.matches
    if (recheckedMatches.length === 0) {
      BGM.Dialog.alert('提示', '未匹配到任何条目，无法开始富化')
      return
    }
  }

  state.isEnriching = true
  state.cancelRequested = false

  showProgressUI(true)

  const config: EnrichConfig = {
    filePath: state.filePath,
    sheetName: state.animeSourceSheet.Name || '',
    headerRow: state.headerRow,
    dataStartRow: state.dataStartRow,
    columnMapping: state.columnMapping,
    targetSheetName: state.bangumiSheet.Name || '',
  }

  const progressCallback: ProgressCallback = (progress: EnrichProgress) => {
    if (state.cancelRequested) return
    updateProgressUI(progress)
  }

  try {
    bgmLog(LOG_LEVELS.INFO, `[enrich] 开始富化，共 ${String(state.matches.length)} 条匹配`)

    const results = enrichEntries(
      state.animeSourceSheet,
      state.bangumiSheet,
      state.matches,
      config,
      progressCallback,
    )

    showProgressUI(false)

    const allConflicts = collectAllConflicts(results)
    if (allConflicts.length > 0) {
      state.pendingConflicts = allConflicts
      state.currentConflictIndex = 0
      showConflictDialog()
    } else {
      renderEnrichSummary(results)
    }

    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich] 富化完成: ${String(results.length)} 条结果, 冲突 ${String(allConflicts.length)} 条`,
    )
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'startEnrichment',
    })
    BGM.Dialog.error(
      '错误',
      `富化执行失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    state.isEnriching = false
    state.cancelRequested = false
  }
}

function cancelEnrichment(): void {
  if (!state.isEnriching) return
  state.cancelRequested = true
  bgmLog(LOG_LEVELS.INFO, '[enrich] 用户请求取消富化')
}

function showProgressUI(isVisible: boolean): void {
  const progressArea = safeGetElement('enrichProgress')
  if (progressArea) {
    progressArea.style.display = isVisible ? '' : 'none'
  }

  const startButton = safeGetButton('startEnrichBtn')
  if (startButton) {
    startButton.disabled = isVisible
    startButton.textContent = isVisible ? '⏳ 富化中...' : '🚀 开始富化'
  }
}

function updateProgressUI(progress: EnrichProgress): void {
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  const fillElement = safeGetElement('progressBarFill')
  if (fillElement) {
    fillElement.style.width = `${String(percent)}%`
    fillElement.textContent = `${String(percent)}%`
  }

  const currentElement = safeGetElement('currentItem')
  if (currentElement) {
    currentElement.textContent = progress.currentName || '-'
  }

  const enrichedElement = safeGetElement('enrichedCount')
  if (enrichedElement) enrichedElement.textContent = String(progress.stats.enriched)

  const skippedElement = safeGetElement('skippedCount')
  if (skippedElement) skippedElement.textContent = String(progress.stats.skipped)

  const failedElement = safeGetElement('failedCount')
  if (failedElement) failedElement.textContent = String(progress.stats.failed)

  const etaElement = safeGetElement('etaTime')
  if (etaElement) etaElement.textContent = formatEta(progress.etaMs)
}

function renderEnrichSummary(results: EnrichResultItem[]): void {
  const enriched = results.filter((r) => r.kind === 'matched').length
  const unmatched = results.filter((r) => r.kind === 'unmatched').length
  const errors = results.filter((r) => r.kind === 'error').length

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrich] 富化摘要: 匹配 ${String(enriched)}, 未匹配 ${String(unmatched)}, 错误 ${String(errors)}`,
  )

  try {
    getOrCreateEnrichRecordSheet()
    loadRecentRecords()
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'renderEnrichSummary',
    })
  }
}

// ========== 富化记录 ==========

export function openEnrichRecordSheet(): void {
  try {
    const sheet = getOrCreateEnrichRecordSheet()
    const app = getApp()
    if (app?.ActiveWorkbook) {
      sheet.Activate()
      bgmLog(LOG_LEVELS.INFO, `[enrich] 已打开富化记录工作表: ${sheet.Name}`)
    }
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'openEnrichRecordSheet',
    })
    BGM.Dialog.error('错误', '无法打开富化记录工作表')
  }
}

export function clearRecords(): void {
  BGM.Dialog.confirm('确定要清除所有富化记录吗？此操作不可撤销。', (isConfirmed: boolean) => {
    if (!isConfirmed) return
    try {
      clearEnrichRecords()
      loadRecentRecords()
      bgmLog(LOG_LEVELS.INFO, '[enrich] 富化记录已清除')
    } catch (error: unknown) {
      BGM.handleError(error, {
        showAlert: false,
        level: BGM.ErrorLevel.ERROR,
        context: 'clearRecords',
      })
    }
  })
}

function loadRecentRecords(): void {
  try {
    const records = getAllEnrichRecords()

    const totalElement = safeGetElement('totalRecordCount')
    if (totalElement) totalElement.textContent = String(records.length)

    const successCount = records.filter((r) => r.action === 'fill' || r.action === 'append').length
    const skipCount = records.filter((r) => r.action === 'skip').length
    const errorCount = records.filter((r) => r.action === 'error').length

    const successElement = safeGetElement('successRecordCount')
    if (successElement) successElement.textContent = String(successCount)

    const skipElement = safeGetElement('skipRecordCount')
    if (skipElement) skipElement.textContent = String(skipCount)

    const errorElement = safeGetElement('errorRecordCount')
    if (errorElement) errorElement.textContent = String(errorCount)

    const recordsContainer = safeGetElement('recentRecords')
    if (!recordsContainer) return

    const recentRecords = records.slice(-10).reverse()
    if (recentRecords.length === 0) {
      recordsContainer.innerHTML = sanitizeHtml('<div class="record-empty">暂无记录</div>')
      return
    }

    const recordsHtml = recentRecords
      .map((r) => {
        const actionClass = `record-action-${r.action}`
        const actionText =
          r.action === 'fill'
            ? '填充'
            : r.action === 'append'
              ? '追加'
              : r.action === 'skip'
                ? '跳过'
                : '错误'
        const name = escapeHtml(r.name)
        const field = escapeHtml(r.enrichedField)
        const updatedValue = escapeHtml(r.updatedValue)
        const time = escapeHtml(r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN') : '')

        return `
          <div class="record-item">
            <div class="record-header">
              <span class="record-name">${name}</span>
              <span class="record-action ${actionClass}">${actionText}</span>
            </div>
            <div class="record-detail">
              <span class="record-field">${field}</span>
              <span class="record-value">${updatedValue}</span>
            </div>
            <div class="record-time">${time}</div>
          </div>
        `
      })
      .join('')

    recordsContainer.innerHTML = sanitizeHtml(recordsHtml)

    bgmLog(LOG_LEVELS.INFO, `[enrich] 最近记录已加载: ${String(records.length)} 条`)
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'loadRecentRecords',
    })
  }
}

// ========== 预览表格渲染（导出函数） ==========

export function renderPreviewTable(
  container: HTMLElement | null,
  sheet: WpsWorksheet,
  _mapping: EnrichColumnMapping,
  maxRows = 20,
): void {
  if (!container) return

  const { headerRow } = state
  if (headerRow === 0) return

  const maxCols = 50
  const headerCells: string[] = []
  for (let col = 1; col <= maxCols; col += 1) {
    const value = getCellValue(sheet, headerRow, col).trim()
    if (value) headerCells.push(escapeHtml(value))
  }

  const { dataStartRow } = state
  const lastRow = Math.min(getLastRow(sheet), dataStartRow + maxRows - 1)

  const bodyRows: string[] = []
  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const cells: string[] = []
    let hasData = false
    for (let col = 1; col <= headerCells.length; col += 1) {
      const value = getCellValue(sheet, row, col).trim()
      if (value) hasData = true
      cells.push(escapeHtml(value))
    }
    if (hasData) {
      bodyRows.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    }
  }

  const html = `
    <table class="preview-table">
      <thead><tr>${headerCells.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows.join('')}</tbody>
    </table>
  `

  container.innerHTML = sanitizeHtml(html)
}

export function renderMatchResults(container: HTMLElement | null, matches: MatchResult[]): void {
  if (!container) return

  const maxDisplay = 20
  const displayMatches = matches.slice(0, maxDisplay)

  const rowsHtml = displayMatches.map((m) => {
    let statusClass = ''
    let statusText = ''
    switch (m.matchType) {
      case 'exact': {
        statusClass = 'status-exact'
        statusText = '✅ 精确'
        break
      }
      case 'alias': {
        statusClass = 'status-alias'
        statusText = '🔄 别名'
        break
      }
      case 'unmatched': {
        statusClass = 'status-unmatched'
        statusText = '❌ 未匹配'
        break
      }
      case 'error': {
        statusClass = 'status-error'
        statusText = '⚠️ 错误'
        break
      }
    }

    const name = escapeHtml(m.matchedAnimeName)
    const bangumiRow = m.bangumiRow ? String(m.bangumiRow) : '-'
    const bangumiName = m.bangumiName ? escapeHtml(m.bangumiName) : '-'

    return `
      <tr class="match-${m.matchType}">
        <td>${name}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
        <td>${bangumiRow}</td>
        <td>${bangumiName}</td>
      </tr>
    `
  })

  const html = `
    <table class="preview-table">
      <thead><tr><th>动漫名</th><th>匹配方式</th><th>Bangumi行号</th><th> Bangumi名称</th></tr></thead>
      <tbody>${rowsHtml.join('')}</tbody>
    </table>
  `

  container.innerHTML = sanitizeHtml(html)
}

export function renderProgress(progress: EnrichProgress): void {
  updateProgressUI(progress)
}

// ========== 冲突对话框 ==========

function collectAllConflicts(results: EnrichResultItem[]): ConflictInfo[] {
  const all: ConflictInfo[] = []
  for (const r of results) {
    if (r.conflicts && r.conflicts.length > 0) {
      all.push(...r.conflicts)
    }
  }
  return all
}

function showConflictDialog(): void {
  const dialogElement = safeGetElement('conflictDialog')
  if (!dialogElement) return

  const conflict = state.pendingConflicts[state.currentConflictIndex]
  if (!conflict) {
    hideConflictDialog()
    return
  }

  const total = state.pendingConflicts.length
  const current = state.currentConflictIndex + 1
  const percent = Math.round((current / total) * 100)

  const html = `
    <div class="conflict-header">
      <span class="conflict-title">⚡ 字段冲突确认 (${String(current)}/${String(total)})</span>
      <div class="conflict-progress">
        <div style="width:${String(percent)}%;height:4px;background:#4a90d9;border-radius:2px;"></div>
      </div>
    </div>
    <div class="conflict-body">
      <div class="conflict-item">
        <div class="conflict-row">
          <span class="conflict-label">条目：</span>
          <span class="conflict-name">${escapeHtml(conflict.matchedAnimeName)}</span>
        </div>
        <div class="conflict-row">
          <span class="conflict-label">字段：</span>
          <span class="conflict-field">${escapeHtml(conflict.fieldName)}</span>
        </div>
        <div class="conflict-row">
          <span class="conflict-label">现有值：</span>
          <span class="conflict-old">${escapeHtml(conflict.oldValue)}</span>
        </div>
        <div class="conflict-row">
          <span class="conflict-label">新番表值：</span>
          <span class="conflict-new">${escapeHtml(conflict.updatedValue)}</span>
        </div>
      </div>
      <div class="conflict-hint">💡 选择如何处理此冲突</div>
    </div>
    <div class="conflict-footer">
      <button class="btn conflict-btn-btn" id="conflictAppend" data-resolution="append">
        🔗 全部增量更新
      </button>
      <button class="btn conflict-btn-keep" id="conflictKeep" data-resolution="keep">
        📋 保留原名
      </button>
      <button class="btn conflict-btn-overwrite" id="conflictOverwrite" data-resolution="overwrite">
        ✏️ 使用新番表名
      </button>
    </div>
  `

  dialogElement.innerHTML = sanitizeHtml(html)
  dialogElement.style.display = 'block'

  dialogElement.querySelectorAll('[data-resolution]').forEach((button) => {
    button.addEventListener('click', () => {
      const resolution = (button as HTMLElement).dataset.resolution as ConflictInfo['resolution']
      handleConflictResolution(resolution)
    })
  })
}

function hideConflictDialog(): void {
  const dialogElement = safeGetElement('conflictDialog')
  if (dialogElement) {
    dialogElement.style.display = 'none'
    dialogElement.replaceChildren()
  }
}

function handleConflictResolution(resolution: ConflictInfo['resolution']): void {
  const conflict = state.pendingConflicts[state.currentConflictIndex]
  if (!conflict) return

  conflict.resolution = resolution

  try {
    const enriched: EnrichedField[] = []
    if (state.bangumiSheet) {
      resolveConflictField(state.bangumiSheet, conflict, enriched)
    }

    bgmLog(
      LOG_LEVELS.INFO,
      `[conflict] 字段 "${conflict.fieldName}" (${conflict.matchedAnimeName}): ${resolution}`,
    )
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.ERROR,
      `[conflict] 解析冲突失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  state.currentConflictIndex += 1

  if (state.currentConflictIndex < state.pendingConflicts.length) {
    showConflictDialog()
  } else {
    hideConflictDialog()
    bgmLog(LOG_LEVELS.INFO, '[conflict] 所有冲突已解决')
    BGM.Dialog.alert('冲突解决完成', `共处理 ${String(state.currentConflictIndex)} 个字段冲突`)
  }
}

// ========== 批量富化 ==========

/** 从文件路径提取文件名 */
function extractFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath
}

/** 绑定批量控件事件（单/多选统一入口后，只剩开始富化 + 清空列表两个按钮） */
function bindBatchControls(): void {
  const batchStartButton = safeGetButton('batchStartBtn')
  if (batchStartButton) {
    batchStartButton.addEventListener('click', batchStartEnrichment)
  }

  const batchClearButton = safeGetButton('batchClearBtn')
  if (batchClearButton) {
    batchClearButton.addEventListener('click', () => {
      state.batchFiles = []
      state.batchResults = []
      state.filePath = ''
      renderBatchFileList()
    })
  }
}

/**
 * 批量文件选择入口（已废弃）
 * @deprecated 自 2026-08-30 起，"选择文件"按钮已合并为单/多选统一入口。
 *   该函数仅作向后兼容保留，不再被任何 UI 触发；新逻辑在 selectNewAnimeFile() 中。
 */
export function batchSelectFiles(): void {
  // 兼容旧引用：直接走新的统一入口
  selectNewAnimeFile()
}

/** 从列表中移除某个文件 */
function batchRemoveFile(index: number): void {
  if (index < 0 || index >= state.batchFiles.length) return
  const removed = state.batchFiles[index]!
  state.batchFiles.splice(index, 1)
  // 单/多选统一入口：移除后保持 state.filePath 始终指向 batchFiles 的首位
  state.filePath = state.batchFiles[0] ?? ''
  bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 移除文件: ${extractFileName(removed)}`)
  renderBatchFileList()
}

/** 展示/更新批量进度 UI */
function showBatchProgress(isVisible: boolean): void {
  const progressElement = safeGetElement('batchProgress')
  if (progressElement) progressElement.style.display = isVisible ? '' : 'none'
}

/** 更新批量进度条 */
function updateBatchProgressUI(current: number, total: number, currentFileName: string): void {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0

  const fillElement = safeGetElement('batchProgressFill')
  if (fillElement) fillElement.style.width = `${String(percent)}%`

  const percentElement = safeGetElement('batchPercent')
  if (percentElement) percentElement.textContent = `${String(percent)}%`

  const currentElement = safeGetElement('batchCurrentFile')
  if (currentElement) {
    currentElement.textContent = `[${String(current)}/${String(total)}] ${extractFileName(currentFileName)}`
  }
}

/**
 * 对单个文件执行表头识别 + 匹配 + 富化
 * @returns 包含 matched/newEntries/updatedEntries/unmatched 的统计对象
 */
function processSingleBatchFile(filePath: string, bangumiSheet: WpsWorksheet): BatchFileResult {
  const fileName = extractFileName(filePath)
  const result: BatchFileResult = {
    filePath,
    fileName,
    matched: 0,
    addedEntries: 0,
    updatedEntries: 0,
    unmatched: 0,
    success: false,
  }

  let wb: WpsWorkbook | null = null
  try {
    const app = getApp()
    if (!app?.Workbooks) {
      throw new Error('WPS 应用不可用')
    }

    // WPS Workbooks.Open 是运行时扩展，不在类型定义中
    const workbooks = app.Workbooks as unknown as {
      Open?: (path: string) => WpsWorkbook | null
    }

    bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 打开文件: ${fileName}`)
    if (typeof workbooks.Open !== 'function') {
      throw new Error('WPS Workbooks.Open 不可用')
    }
    wb = workbooks.Open(filePath)
    if (!wb) {
      throw new Error('无法打开文件：WPS 返回了 null')
    }

    // 获取第一个工作表（WPS 运行时可能返回 null，但类型定义未包含）
    const ws = wb.Worksheets.Item(1) as WpsWorksheet | null
    if (!ws) {
      throw new Error('文件中没有工作表')
    }

    // 自动识别表头
    const headerRow = findHeaderRow(ws)
    if (headerRow === 0) {
      result.error = '未检测到有效的表头行'
      return result
    }

    const dataStartRow = headerRow + 1
    const columnMapping = detectColumns(ws, headerRow)

    // 匹配
    const config: EnrichConfig = {
      filePath,
      sheetName: ws.Name || '',
      headerRow,
      dataStartRow,
      columnMapping,
      targetSheetName: bangumiSheet.Name || '',
    }

    const matches = matchEntries(ws, bangumiSheet, config)
    const matched = matches.filter(
      (m) => m.matchType !== 'unmatched' && m.matchType !== 'error',
    ).length
    const unmatched = matches.length - matched

    // 富化
    const enrichResults = enrichEntries(
      ws,
      bangumiSheet,
      matches,
      config,
      // 批量模式不回调进度（已由外层控制）
      () => {},
    )

    // EnrichResultItem 没有 stats，通过 enrichedFields 判断
    const updatedEntries = enrichResults.filter((r) => r.kind === 'matched').length
    const entries = enrichResults.filter(
      (r) => r.kind === 'matched' && r.enrichedFields.length > 0,
    ).length

    result.matched = matched
    result.addedEntries = entries
    result.updatedEntries = updatedEntries
    result.unmatched = unmatched
    result.success = true

    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich-batch] ${fileName}: 匹配 ${String(matched)}，未匹配 ${String(unmatched)}，处理 ${String(updatedEntries)}`,
    )
  } catch (error: unknown) {
    result.error = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[enrich-batch] ${fileName} 处理失败: ${result.error}`)
  } finally {
    // 关闭源文件，不保存
    if (wb) {
      try {
        const wbWithClose = wb as unknown as { Close?: (shouldSaveChanges?: boolean) => unknown }
        if (typeof wbWithClose.Close === 'function') {
          const closeResult = wbWithClose.Close(false)
          void closeResult
        }
        bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 已关闭文件: ${fileName}`)
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[enrich-batch] 关闭文件时警告: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  return result
}

/** 批量富化主入口 */
export function batchStartEnrichment(): void {
  if (state.isBatchEnriching) {
    bgmLog(LOG_LEVELS.WARN, '[enrich-batch] 批量富化正在进行中，忽略重复请求')
    return
  }

  if (state.batchFiles.length === 0) {
    BGM.Dialog.alert('提示', '请先选择至少一个新番表文件')
    return
  }

  // 前置检查：目标 Bangumi 工作表已锁定
  let { bangumiSheet } = state
  if (!bangumiSheet) {
    const locked = getLockedEnrichSheet()
    if (locked) {
      bangumiSheet = locked[1]
      state.bangumiSheet = locked[1]
      bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 使用锁定的目标工作表: ${locked[1].Name}`)
    }
  }

  if (!bangumiSheet) {
    BGM.Dialog.alert('提示', '请先选择并锁定目标 Bangumi 工作表（在上方"🎯 目标工作表"区域）')
    return
  }

  // 清空之前的结果
  state.batchResults = []
  state.batchIndex = 0
  state.isBatchEnriching = true
  state.batchCancelRequested = false

  // 隐藏批量汇总
  const summaryElement = safeGetElement('batchSummary')
  if (summaryElement) summaryElement.style.display = 'none'

  // 禁用开始按钮
  const startButton = safeGetButton('batchStartBtn')
  if (startButton) startButton.disabled = true

  // 确认
  // `false as boolean`：避免 TS 将闭包赋值忽略后把变量静态收窄为 false 字面量
  let isConfirmed = false as boolean
  BGM.Dialog.confirm(
    `将依次对 ${String(state.batchFiles.length)} 个文件执行富化。\n目标工作表：${bangumiSheet.Name}\n是否继续？`,
    (isOk: boolean) => {
      isConfirmed = isOk
    },
    '开始批量富化',
  )
  if (isConfirmed) {
    void runBatchEnrichment(bangumiSheet)
  } else {
    state.isBatchEnriching = false
    if (startButton) startButton.disabled = false
  }
}

/** 实际执行批量富化（避免阻塞 UI，循环中通过 await 让出主线程） */
async function runBatchEnrichment(bangumiSheet: WpsWorksheet): Promise<void> {
  showBatchProgress(true)

  const total = state.batchFiles.length

  for (let index = 0; index < total; index += 1) {
    if (state.batchCancelRequested) {
      bgmLog(LOG_LEVELS.WARN, '[enrich-batch] 用户取消批量富化')
      break
    }

    state.batchIndex = index + 1
    const filePath = state.batchFiles[index]!
    const fileName = extractFileName(filePath)

    updateBatchProgressUI(state.batchIndex, total, fileName)

    // 让出主线程，给 UI 更新机会
    await new Promise<void>((resolve) => setTimeout(resolve, 30))

    const result = processSingleBatchFile(filePath, bangumiSheet)
    state.batchResults.push(result)

    // 让出主线程，给 WPS 资源释放机会
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }

  state.isBatchEnriching = false

  // 恢复 UI
  showBatchProgress(false)
  const startButton = safeGetButton('batchStartBtn')
  if (startButton) startButton.disabled = false

  // 显示汇总
  renderBatchSummary()

  // 刷新富化记录
  try {
    getOrCreateEnrichRecordSheet()
    loadRecentRecords()
  } catch {
    // 忽略
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrich-batch] 批量富化结束: ${String(state.batchResults.filter((r) => r.success).length)}/${String(total)} 成功`,
  )
}

/** 渲染批量富化最终汇总 */
function renderBatchSummary(): void {
  const summaryElement = safeGetElement('batchSummary')
  const contentElement = safeGetElement('batchSummaryContent')
  if (!summaryElement || !contentElement) return

  const total = state.batchResults.length
  const successCount = state.batchResults.filter((r) => r.success).length
  const failCount = total - successCount
  const totalMatched = state.batchResults.reduce((s, r) => s + r.matched, 0)
  const totalUpdated = state.batchResults.reduce((s, r) => s + r.updatedEntries, 0)
  const totalUnmatched = state.batchResults.reduce((s, r) => s + r.unmatched, 0)

  const fileRows = state.batchResults
    .map((r, index) => {
      const statusIcon = r.success ? '✅' : '❌'
      const detail = r.success
        ? `匹配 ${String(r.matched)} / 更新 ${String(r.updatedEntries)} / 未匹配 ${String(r.unmatched)}`
        : `失败：${escapeHtml(r.error || '未知错误')}`
      return `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px dashed #333;">
          <span style="color:#ddd;">${statusIcon} #${String(index + 1)} ${escapeHtml(r.fileName)}</span>
          <span style="color:${r.success ? '#a6e3a1' : '#f38ba8'};">${detail}</span>
        </div>
      `
    })
    .join('')

  const html = `
    <div style="display:flex;gap:16px;margin-bottom:8px;font-size:13px;">
      <span>📄 <b>${String(total)}</b> 个文件</span>
      <span style="color:#a6e3a1;">✅ ${String(successCount)} 成功</span>
      ${failCount > 0 ? `<span style="color:#f38ba8;">❌ ${String(failCount)} 失败</span>` : ''}
    </div>
    <div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;color:#bac2de;">
      <span>匹配总数 <b style="color:#a6e3a1;">${String(totalMatched)}</b></span>
      <span>已更新 <b style="color:#89b4fa;">${String(totalUpdated)}</b></span>
      <span>未匹配 <b style="color:#f9e2af;">${String(totalUnmatched)}</b></span>
    </div>
    <div style="max-height:200px;overflow-y:auto;">${fileRows}</div>
  `

  contentElement.innerHTML = sanitizeHtml(html)
  summaryElement.style.display = ''
}

// ========== 导出 ==========

export { state, cancelEnrichment, COLUMN_MAPPING_FIELDS }
