/**
 * @fileoverview 富化页面的 UI 控制器
 * @module panel/enrichPage
 * @description 负责文件选择、表头识别、列映射编辑、匹配预览、富化执行与进度、富化记录查看。
 */

import { LOG_LEVELS } from '../core/constants.js'
import {
  detectColumns,
  detectAnimeSourceLayout,
  matchEntries,
  enrichEntries,
  resolveConflictField,
  isBangumiSheetEmpty,
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
  autoSelectEnrichTarget,
} from '../sync/enrich-lock.js'
import {
  getAllEnrichRecords,
  getOrCreateEnrichRecordSheet,
  clearEnrichRecords,
} from '../sync/enrich-record.js'
import {
  ANIME_SOURCE_DETECTOR,
  BANGUMI_TARGET_DETECTOR,
  collectDetectedWorkbookPaths,
} from '../sync/enrich-auto-detect.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { escapeHtml } from '../tools/string-utilities.js'
import {
  getCellValue,
  getLastRow,
  findHeaderRow,
  getColumnMap,
  bgmLog,
  BGM,
  getApp,
} from '../tools/util/index.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'

// ========== 类型定义 ==========

interface BatchFileResult {
  filePath: string
  fileName: string
  /** 识别到的表头行；0 表示未识别成功 */
  headerRow: number
  matched: number
  addedEntries: number
  updatedEntries: number
  unmatched: number
  success: boolean
  error?: string
}

/** 详情弹窗中的一个文件分组（含该文件全部富化条目） */
interface EnrichDetailGroup {
  fileName: string
  items: EnrichResultItem[]
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

  // 详情弹窗数据（最近一次富化各文件的条目明细，单文件为 1 组）
  enrichDetailGroups: EnrichDetailGroup[]

  // 单文件自动识别表头时打开的源工作簿（重新选择文件/清空列表时安全回收）
  sourceWorkbook: WpsWorkbook | null
  isSourceWorkbookOpenedByUs: boolean

  // 可选开关：单文件识别成功后即关闭源工作簿，开始富化时自动重开
  closeSourceAfterDetect: boolean
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

  enrichDetailGroups: [],

  sourceWorkbook: null,
  isSourceWorkbookOpenedByUs: false,

  closeSourceAfterDetect: false,
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

function safeGetCheckbox(id: string): HTMLInputElement | null {
  const element = document.getElementById(id)
  return element instanceof HTMLInputElement ? element : null
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
  bindEnrichDetailControls()
  bindPreviewDetailControls()
  bindBatchControls()
  bindConflictDialogButtons()
  loadRecentRecords()

  // 如果有锁定的工作表，自动填充到 state
  if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
    const locked = getLockedEnrichSheet()
    if (locked) {
      const [, lockedSheet] = locked
      state.bangumiSheet = lockedSheet
      bgmLog(LOG_LEVELS.INFO, `[enrich] 已恢复锁定的目标工作表: ${lockedSheet.Name}`)
    }
  }

  // 检查方式 B：打开富化工具页面时，自动添加并识别已打开的新番表工作簿
  autoAddOpenAnimeWorkbooks()
  // 页面打开时：若已识别到打开的 Bangumi 数据表且目标表未锁定，自动选择/锁定目标表
  checkBangumiAutoDetectRecords()

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

  // 可选开关：识别后关闭源文件，开始富化时再重开
  const closeChk = safeGetCheckbox('closeSourceAfterDetectChk')
  if (closeChk) {
    closeChk.addEventListener('change', () => {
      state.closeSourceAfterDetect = closeChk.checked
      bgmLog(LOG_LEVELS.INFO, `[enrich] 源文件识别后关闭开关: ${closeChk.checked ? '开' : '关'}`)
    })
    state.closeSourceAfterDetect = closeChk.checked
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
      if (BGM.sheet.isLocked) {
        refreshSheetList()
      } else {
        // 未锁定时重新尝试自动选择目标工作表
        autoSelectEnrichTarget('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')
        refreshSheetList()
        selectTargetSheet()
      }
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
  const tabs = document.querySelectorAll<HTMLElement>('.preview-tab')
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab
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
        if (matchTable) {
          // 尚无匹配结果时保持隐藏，避免展示只有表头的空表格
          matchTable.style.display = state.matches.length > 0 ? '' : 'none'
        }
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

function bindEnrichDetailControls(): void {
  const viewButton = safeGetButton('viewEnrichDetailBtn')
  if (viewButton) {
    viewButton.addEventListener('click', () => {
      showEnrichDetail()
    })
  }

  const closeButtons = [
    safeGetButton('enrichDetailCloseBtn'),
    safeGetButton('enrichDetailDoneBtn'),
  ].filter((button): button is HTMLButtonElement => button !== null)
  for (const button of closeButtons) {
    button.addEventListener('click', () => {
      hideEnrichDetail()
    })
  }
}

function bindPreviewDetailControls(): void {
  const previewMatchButton = safeGetButton('previewMatchBtn')
  if (previewMatchButton) {
    previewMatchButton.addEventListener('click', () => {
      previewMatch()
    })
  }

  const viewSourceButton = safeGetButton('viewSourceDetailBtn')
  if (viewSourceButton) {
    viewSourceButton.addEventListener('click', () => {
      showSourceDetail()
    })
  }

  const sourceCloseButtons = [
    safeGetButton('sourceDetailCloseBtn'),
    safeGetButton('sourceDetailDoneBtn'),
  ].filter((button): button is HTMLButtonElement => button !== null)
  for (const button of sourceCloseButtons) {
    button.addEventListener('click', () => {
      hideSourceDetail()
    })
  }

  const matchCloseButtons = [
    safeGetButton('matchDetailCloseBtn'),
    safeGetButton('matchDetailDoneBtn'),
  ].filter((button): button is HTMLButtonElement => button !== null)
  for (const button of matchCloseButtons) {
    button.addEventListener('click', () => {
      hideMatchDetail()
    })
  }
}

// ========== 文件选择（单/多选统一入口） ==========
//
// 优先使用 WPS Application.FileDialog(msoFileDialogFilePicker) + AllowMultiSelect=true
// 实现真正的多选文件对话框；该 API 调用的是 Windows 系统原生文件管理器（支持 Ctrl/Shift
// 多选），而非 GetOpenFilename 的单选包装。运行时若 FileDialog 不可用，自动回退到
// "循环单选 + 询问是否继续"的兼容方案。
//
// state.batchFiles 与 state.filePath 的关系：
//   - state.batchFiles = []              → 还没选过文件
//   - state.batchFiles = [f1]            → 只选了 f1（单文件）
//   - state.batchFiles = [f1, f2, ...]   → 批量（f1 = state.filePath 是首个）

/** WPS FileDialog 对象的能力子集（仅用到的成员） */
interface WpsFileDialog {
  AllowMultiSelect: boolean
  Title: string
  Filters: {
    Clear(): void
    Add(description: string, extensions: string, position?: number): unknown
  }
  Show(): number
  SelectedItems: {
    Count: number
    Item(index: number): string
  }
}

/**
 * 调用 WPS 原生多选文件对话框
 * @returns 选中的文件路径数组（用户取消返回空数组）；FileDialog 不可用或异常时返回 null（触发回退）
 */
function pickFilesWithMultiSelect(): string[] | null {
  // 整个调用包在大 try 里：WPS 部分版本可能声明了 FileDialog 但实际抛错，
  // 任何环节出错都安全回退到 GetOpenFilename 循环
  try {
    const app = getApp() as {
      FileDialog?: (dialogType: number) => WpsFileDialog | null
      msoFileDialogFilePicker?: number
    } | null
    if (!app || typeof app.FileDialog !== 'function') return null

    // msoFileDialogFilePicker = 3；优先用 Application 上的常量，缺失则用字面量
    const dialogType =
      typeof app.msoFileDialogFilePicker === 'number' ? app.msoFileDialogFilePicker : 3

    const dialog = app.FileDialog(dialogType)
    if (!dialog) return null

    dialog.AllowMultiSelect = true
    dialog.Title = '选择新番表文件（可多选，按住 Ctrl/Shift 批量选择）'
    try {
      dialog.Filters.Clear()
    } catch {
      // 部分实现不支持 Clear，直接 Add 即可（Add 会追加）
    }
    dialog.Filters.Add('Excel 文件 (*.xlsx)', '*.xlsx', 1)
    dialog.Filters.Add('Excel 97-2003 文件 (*.xls)', '*.xls', 2)
    dialog.Filters.Add('CSV 文件 (*.csv)', '*.csv', 3)
    dialog.Filters.Add('所有文件 (*.*)', '*.*', 4)

    // Show() 返回 -1 = 确定，0 = 取消
    const result = dialog.Show()
    if (result !== -1) return []

    const paths: string[] = []
    const count = dialog.SelectedItems.Count
    for (let index = 1; index <= count; index += 1) {
      const item = dialog.SelectedItems.Item(index)
      if (item) paths.push(item)
    }
    return paths
  } catch {
    return null
  }
}

/**
 * 将一批路径合并入 state.batchFiles，跳过重复项，刷新 UI。
 * 返回本次新增数量。
 */
function mergeSelectedPaths(paths: string[]): number {
  let added = 0
  for (const filePath of paths) {
    if (state.batchFiles.includes(filePath)) {
      bgmLog(LOG_LEVELS.INFO, `[enrich] 跳过重复文件: ${extractFileName(filePath)}`)
    } else {
      state.batchFiles.push(filePath)
      // 首个文件同时作为单文件富化目标
      if (state.batchFiles.length === 1) {
        state.filePath = filePath
      }
      added += 1
    }
  }
  if (added > 0) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich] 批量选择: 新增 ${String(added)} 个，累计 ${String(state.batchFiles.length)} 个`,
    )
    renderBatchFileList()
  }
  return added
}

/**
 * 回退方案：GetOpenFilename 循环单选 + 询问是否继续
 * 用于 FileDialog 在当前 WPS 版本不可用时
 */
function selectNewAnimeFileLoop(): void {
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
}

export function selectNewAnimeFile(): void {
  try {
    // 1) 优先尝试 FileDialog（真正的多选）
    const multiResult = pickFilesWithMultiSelect()
    if (multiResult !== null) {
      // FileDialog 可用；空数组代表用户取消
      if (multiResult.length > 0) {
        mergeSelectedPaths(multiResult)
        // 单文件：选完立即自动识别表头（多文件由批量流程逐文件识别）
        maybeAutoDetectSingleFile()
      } else {
        bgmLog(LOG_LEVELS.INFO, '[enrich] 用户取消文件选择')
      }
      return
    }

    // 2) 回退：GetOpenFilename 循环
    bgmLog(LOG_LEVELS.INFO, '[enrich] FileDialog 不可用，回退到 GetOpenFilename 循环单选')
    selectNewAnimeFileLoop()
    // 回退路径同样支持单文件自动识别
    maybeAutoDetectSingleFile()
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

  // 0) 单文件自动识别接管的源工作簿仅在 N===1 时保持打开
  if (n !== 1) {
    closeOpenedSourceWorkbook()
  }

  // 1) 路径展示
  if (pathElement) {
    if (n === 0) {
      pathElement.textContent = ''
      pathElement.setAttribute('placeholder', '未选择文件...')
      pathElement.removeAttribute('title')
    } else {
      const firstFile = state.batchFiles[0]
      if (n === 1 && firstFile !== undefined) {
        pathElement.textContent = firstFile
        pathElement.setAttribute('title', firstFile)
      } else if (firstFile !== undefined) {
        const firstName = extractFileName(firstFile)
        pathElement.textContent = `已选 ${String(n)} 个文件（首个：${firstName}）`
        pathElement.setAttribute('title', state.batchFiles.join('\n'))
      }
    }
  }

  // 2) 单文件"开始富化"按钮的启用状态
  //    N>=2 时源表归批量流程所有（单文件源工作簿已被回收），必须禁用，
  //    否则会拿着失效/错误的源表跑单文件富化。
  if (singleEnrichButton) {
    singleEnrichButton.disabled = n !== 1
    if (n >= 2) {
      singleEnrichButton.title = '已选多个文件，请使用「🚀 批量富化」'
    } else if (n === 0) {
      singleEnrichButton.title = '请先选择新番表文件'
    } else {
      singleEnrichButton.title = ''
    }
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
          const index = Number((button as HTMLElement).dataset.batchRemove || '-1') // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- dataset 属性为空时须回退到哨兵值
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
    // 列表清空时同步隐藏自动识别提示
    const notice = safeGetElement('autoDetectNotice')
    if (notice) notice.style.display = 'none'
  }
}

// ========== 表头自动识别 ==========

/**
 * 在指定工作表上识别表头并写入 state（不负责工作簿的打开/关闭）。
 * @returns 识别成功返回列映射；失败返回 null
 */
function detectHeaderOnSheet(ws: WpsWorksheet, label: string): EnrichColumnMapping | null {
  try {
    const sourceLayout = detectAnimeSourceLayout(ws)
    const headerRow = sourceLayout?.headerRow ?? findHeaderRow(ws)
    if (headerRow === 0) {
      BGM.Dialog.alert('提示', '未检测到有效的表头行，请检查表头是否在前 10 行内')
      bgmLog(LOG_LEVELS.ERROR, `[enrich] 表头识别失败: ${label} 未检测到有效的表头行`)
      return null
    }

    const mapping = sourceLayout?.columnMapping ?? detectColumns(ws, headerRow)

    state.animeSourceSheet = ws
    state.headerRow = headerRow
    state.dataStartRow = sourceLayout?.dataStartRow ?? headerRow + 1
    state.columnMapping = mapping

    renderDetectResult(ws, mapping)
    renderColumnMappingEditor(ws, mapping)
    renderSourcePreview(ws, mapping)

    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich] 表头识别成功: ${label} / 工作表=${ws.Name || '未知'} / 表头行=${String(headerRow)} / 名称列=${String(mapping.nameCol)}`,
    )
    return mapping
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'detectHeaderOnSheet',
    })
    BGM.Dialog.error(
      '错误',
      `识别表头失败: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/**
 * 打开新番表文件并在其首个工作表上识别表头。
 * - 文件已在 WPS 中打开时直接复用，避免重复打开、更避免误关用户文件
 * - 识别成功后工作簿保持打开供富化使用，由 closeOpenedSourceWorkbook() 统一回收
 * @returns 是否识别成功
 */
function autoDetectHeaderFromFile(filePath: string): boolean {
  const fileName = extractFileName(filePath)

  try {
    const opened = openSourceWorkbook(filePath)
    if (!opened) {
      throw new Error('WPS 应用不可用，无法打开新番表文件')
    }

    const { wb, isOpenedByUs } = opened

    // 先回收上一个源工作簿再识别：回收会清空源表状态，必须早于写入新状态
    if (state.sourceWorkbook && state.sourceWorkbook !== wb) {
      closeOpenedSourceWorkbook()
    }

    const ws = wb.Worksheets.Item(1) as WpsWorksheet | null
    if (!ws) {
      if (isOpenedByUs) closeWorkbook(wb)
      throw new Error('文件中没有工作表')
    }

    const mapping = detectHeaderOnSheet(ws, fileName)
    if (!mapping) {
      // 识别失败：本次为识别而打开的工作簿立即回收，不接管到 state
      if (isOpenedByUs) closeWorkbook(wb)
      return false
    }

    // 识别成功：接管当前工作簿
    state.sourceWorkbook = wb
    state.isSourceWorkbookOpenedByUs = isOpenedByUs

    // 可选开关：识别后关闭源工作簿，开始富化时再重开（避免文件长期占用）
    if (state.closeSourceAfterDetect) {
      closeSourceWorkbookOnly()
      bgmLog(LOG_LEVELS.INFO, '[enrich] 识别成功，按开关关闭源工作簿（开始富化时自动重开）')
    }
    return true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[enrich] 自动识别表头失败: ${fileName} - ${message}`)
    BGM.Dialog.alert('提示', `自动识别表头失败：${message}\n可手动点击「🔍 自动识别表头」重试`)
    return false
  }
}

/** 打开新番表文件；已在 WPS 中打开时直接复用，返回是否由本函数打开 */
function openSourceWorkbook(filePath: string): { wb: WpsWorkbook; isOpenedByUs: boolean } | null {
  const app = getApp()
  if (!app?.Workbooks) return null

  const fileName = extractFileName(filePath)

  // 已打开则复用：优先按 FullName 精确匹配，回落按文件名匹配
  const wbs = app.Workbooks
  for (let index = 1; index <= wbs.Count; index += 1) {
    const existing = wbs.Item(index) as WpsWorkbook | null
    // 运行时可能返回 null，先判空再取属性
    if (existing && (existing.FullName === filePath || existing.Name === fileName)) {
      bgmLog(LOG_LEVELS.INFO, `[enrich] 复用已打开的工作簿: ${existing.Name}`)
      return { wb: existing, isOpenedByUs: false }
    }
  }

  // WPS Workbooks.Open 是运行时扩展，不在类型定义中
  const workbooks = wbs as unknown as { Open?: (path: string) => WpsWorkbook | null }
  if (typeof workbooks.Open !== 'function') return null

  const wb = workbooks.Open(filePath)
  if (!wb) return null

  bgmLog(LOG_LEVELS.INFO, `[enrich] 已打开新番表文件: ${fileName}`)
  return { wb, isOpenedByUs: true }
}

/** 关闭工作簿且不保存修改 */
function closeWorkbook(wb: WpsWorkbook): void {
  try {
    const wbWithClose = wb as unknown as { Close?: (shouldSaveChanges?: boolean) => unknown }
    if (typeof wbWithClose.Close === 'function') {
      wbWithClose.Close(false)
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrich] 关闭工作簿警告: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** 回收单文件自动识别时接管的源工作簿（仅关闭本插件打开的，用户已打开的保持不动） */
function closeOpenedSourceWorkbook(): void {
  const wb = state.sourceWorkbook
  if (!wb) return

  if (state.isSourceWorkbookOpenedByUs) {
    closeWorkbook(wb)
    bgmLog(LOG_LEVELS.INFO, `[enrich] 已关闭自动打开的源工作簿: ${wb.Name}`)
    // 工作簿已关闭：清空源表相关状态，避免「开始富化」引用失效的工作表
    state.animeSourceSheet = null
    state.columnMapping = null
    state.headerRow = 0
    state.dataStartRow = 0
    state.matches = []
  }

  state.sourceWorkbook = null
  state.isSourceWorkbookOpenedByUs = false
}

/** 仅关闭源工作簿并断开引用，保留已识别的表头行/列映射（closeSourceAfterDetect 模式用） */
function closeSourceWorkbookOnly(): void {
  const wb = state.sourceWorkbook
  if (!wb) return

  if (state.isSourceWorkbookOpenedByUs) {
    closeWorkbook(wb)
    bgmLog(LOG_LEVELS.INFO, `[enrich] 已关闭源工作簿: ${wb.Name}`)
  }

  // 仅断开引用；保留 headerRow / dataStartRow / columnMapping / matches，供重开时复用
  state.animeSourceSheet = null
  state.sourceWorkbook = null
  state.isSourceWorkbookOpenedByUs = false
}

/**
 * 确保开始富化/预览时的源表可用。
 * closeSourceAfterDetect 模式下识别后工作簿已关闭，此处按需重开并恢复源表引用。
 * @returns 可用的源工作表；不可用返回 null
 */
function ensureSourceSheet(): WpsWorksheet | null {
  if (state.animeSourceSheet) return state.animeSourceSheet

  // 未持有活动源表引用：若已识别过（有 filePath + 表头），则重开文件恢复
  if (!state.filePath || state.headerRow === 0 || !state.columnMapping) return null

  const opened = openSourceWorkbook(state.filePath)
  if (!opened) {
    bgmLog(LOG_LEVELS.ERROR, `[enrich] 重开源工作簿失败: ${extractFileName(state.filePath)}`)
    return null
  }

  const ws = opened.wb.Worksheets.Item(1) as WpsWorksheet | null
  if (!ws) {
    if (opened.isOpenedByUs) closeWorkbook(opened.wb)
    bgmLog(
      LOG_LEVELS.ERROR,
      `[enrich] 重开源工作簿失败: ${extractFileName(state.filePath)} 中没有工作表`,
    )
    return null
  }

  state.animeSourceSheet = ws
  state.sourceWorkbook = opened.wb
  state.isSourceWorkbookOpenedByUs = opened.isOpenedByUs
  bgmLog(LOG_LEVELS.INFO, `[enrich] 已重开源工作簿: ${opened.wb.Name}`)
  return ws
}

/** 单文件场景下选完文件立即自动识别表头（多文件由 processSingleBatchFile 逐文件识别） */
function maybeAutoDetectSingleFile(): void {
  if (state.batchFiles.length !== 1) return

  const filePath = state.batchFiles[0]
  if (filePath === undefined) return

  bgmLog(LOG_LEVELS.INFO, '[enrich] 单文件选择完成，自动识别表头')
  autoDetectHeaderFromFile(filePath)
}

// ========== 已打开工作簿自动识别（检查方式 B：打开页面时） ==========

/** 在页面打开时自动检查：把 WPS 中已打开的新番表工作簿加入列表并识别表头 */
function autoAddOpenAnimeWorkbooks(): void {
  try {
    const paths = collectDetectedWorkbookPaths(ANIME_SOURCE_DETECTOR)
    if (paths.length === 0) {
      bgmLog(LOG_LEVELS.INFO, '[enrich] 页面打开检查：未检测到已打开的新番表工作簿')
      return
    }

    const added = mergeSelectedPaths(paths)
    if (added === 0) return

    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich] 页面打开检查：自动添加 ${String(added)} 个已打开的新番表工作簿`,
    )
    showAutoDetectNotice(paths)
    // 单文件：自动添加后立即识别表头（多文件由批量流程逐文件识别）
    maybeAutoDetectSingleFile()
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'autoAddOpenAnimeWorkbooks',
    })
  }
}

/** 页面打开时检查 Bangumi 数据表识别记录：未锁定时交由 autoSelectEnrichTarget 自动选择/锁定目标表 */
function checkBangumiAutoDetectRecords(): void {
  try {
    const paths = collectDetectedWorkbookPaths(BANGUMI_TARGET_DETECTOR)
    if (paths.length === 0) {
      bgmLog(LOG_LEVELS.INFO, '[enrich] 页面打开检查：未检测到已打开的 Bangumi 数据表')
      return
    }
    const names = paths.map((path) => extractFileName(path)).join('、')
    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich] 页面打开检查：检测到 ${String(paths.length)} 个已打开的 Bangumi 数据表（${names}）`,
    )
    if (!BGM.sheet.isLocked) {
      autoSelectEnrichTarget('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')
    }
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'checkBangumiAutoDetectRecords',
    })
  }
}

/** 显示自动识别提示（列出已添加的文件名） */
function showAutoDetectNotice(paths: string[]): void {
  const notice = safeGetElement('autoDetectNotice')
  if (!notice) return
  const names = paths.map((path) => extractFileName(path)).join('、')
  notice.textContent = `🔄 已自动识别已打开的新番表工作簿（${String(paths.length)} 个）：${names}`
  notice.style.display = ''
}

export function autoDetectHeader(): void {
  // 已选择新番表文件时：以「所选文件」为源表识别。
  // 注意：不可取「🎯 目标工作表」的 sheetSelect —— 那是目标 Bangumi 表，会导致源表=目标表。
  if (state.filePath) {
    autoDetectHeaderFromFile(state.filePath)
    return
  }

  // 未选择文件时：回落到当前活动工作表
  const app = getApp()
  if (!app?.ActiveWorkbook) {
    BGM.Dialog.alert('提示', '未连接到 Excel，请先打开包含新番表的工作簿')
    return
  }

  const ws = app.ActiveWorkbook.ActiveSheet as WpsWorksheet | null
  if (!ws) {
    BGM.Dialog.alert('提示', '请先打开新番表文件并激活其工作表')
    return
  }

  detectHeaderOnSheet(ws, '活动工作表')
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

  // 覆盖全部列（含表头为空的列）：Hazx 模板的名称列 C 没有表头，
  // 若只列有表头的列，自动识别的名称列将无法在下拉中回显
  for (let col = 1; col <= maxCols; col += 1) {
    const header = getCellValue(ws, headerRow, col).trim()
    colOptions.push({ col, header })
  }

  let html = ''

  for (const field of COLUMN_MAPPING_FIELDS) {
    const currentCol = mapping[field.key]
    const selectedValue = currentCol ? String(currentCol) : ''

    const optionsHtml = `<option value="">-- 未映射 --</option>${colOptions
      .map((o) => {
        const optionLabel = o.header
          ? `${escapeHtml(o.header)} (列${String(o.col)})`
          : `(列${String(o.col)}，无表头)`
        return `<option value="${String(o.col)}" ${String(o.col) === selectedValue ? 'selected' : ''}>${optionLabel}</option>`
      })
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
    const fieldKey = select.dataset.field as keyof EnrichColumnMapping | null
    if (!fieldKey) return

    select.addEventListener('change', () => {
      const value = Number(select.value)
      if (state.columnMapping) {
        updateColumnMapping(fieldKey, Number.isNaN(value) ? 0 : value)
      }
    })
  })
}

function updateColumnMapping(field: keyof EnrichColumnMapping, value: number): void {
  if (!state.columnMapping) return

  state.columnMapping[field] = value === 0 ? (undefined as never) : value

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
  if (BGM.sheet.isLocked && BGM.sheet.lockedWorkbookName) {
    const wbSelect = safeGetSelect('workbookSelect')
    if (wbSelect) wbSelect.value = BGM.sheet.lockedWorkbookName
  }
}

function refreshSheetList(): void {
  const wbSelect = safeGetSelect('workbookSelect')
  const wbName = wbSelect?.value || undefined // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）

  refreshEnrichSheets(wbName, 'sheetSelect', 'workbookSelect')

  // 如果已锁定，选中锁定的工作表
  if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
    const sheetSelect = safeGetSelect('sheetSelect')
    if (sheetSelect) sheetSelect.value = String(BGM.sheet.lockedIndex)
  }
}

function selectTargetSheet(): void {
  const sheetSelect = safeGetSelect('sheetSelect')
  if (!sheetSelect?.value) {
    state.bangumiSheet = null
    return
  }

  const sheetIndex = Number(sheetSelect.value)
  const wb = getSelectedWorkbook()
  if (!wb || sheetIndex <= 0) {
    state.bangumiSheet = null
    return
  }

  try {
    const ws = wb.Worksheets.Item(sheetIndex)
    state.bangumiSheet = ws
    bgmLog(LOG_LEVELS.INFO, `[enrich] 已选择目标工作表: ${ws.Name} (索引: ${String(sheetIndex)})`)
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

  const isNowLocked = BGM.sheet.isLocked
  sheetSelect.disabled = isNowLocked

  if (isNowLocked) {
    // 锁定成功后同步目标工作表引用（自动预选场景下不触发 change 事件）
    selectTargetSheet()
  } else {
    state.bangumiSheet = null
  }
}

// ========== 源数据预览 ==========

/**
 * 数据预览的「一栏一行」列顺序：按已映射字段渲染，避免 50 列全部挤压成文本流
 */
const PREVIEW_FIELD_COLS: { key: keyof EnrichColumnMapping; label: string }[] = [
  { key: 'nameCol', label: '名称' },
  { key: 'weekdayCol', label: '周更时间' },
  { key: 'premiereCol', label: '首播' },
  { key: 'episodesCol', label: '集数' },
  { key: 'platformCol', label: '播放平台' },
  { key: 'exclusiveCol', label: '独播' },
  { key: 'specialCol', label: '特殊/备注' },
  { key: 'tagsCol', label: 'TAGS/标签' },
]

/** 匹配结果对比表格：新番表源侧展示的字段（名称列单独展示） */
const SOURCE_CMP_FIELDS: { key: keyof EnrichColumnMapping; label: string }[] = [
  { key: 'weekdayCol', label: '周更' },
  { key: 'premiereCol', label: '首播' },
  { key: 'episodesCol', label: '集数' },
  { key: 'platformCol', label: '平台' },
  { key: 'exclusiveCol', label: '独播' },
  { key: 'specialCol', label: '特殊' },
  { key: 'tagsCol', label: '标签' },
]

/** 匹配结果对比表格：目标表侧展示的字段（按目标表表头动态读取） */
const TARGET_CMP_FIELDS: { colKey: string; label: string; fallbackColKey?: string }[] = [
  { colKey: '周更时间', label: '周更' },
  { colKey: '开播日期', label: '首播' },
  { colKey: '集数', label: '集数' },
  { colKey: '在线播放平台', label: '平台' },
  { colKey: '标签/分级', label: '标签', fallbackColKey: '标签' },
  { colKey: '特点/印象', label: '特点' },
  { colKey: '别名', label: '别名' },
]

/** 数据预览单元格渲染：名称加粗、周更/播放平台以徽章形式展示 */
function renderPreviewCell(fieldKey: keyof EnrichColumnMapping, rawValue: string): string {
  const value = rawValue.trim()
  if (!value) return '<td></td>'
  const escaped = escapeHtml(value)
  if (fieldKey === 'nameCol') {
    return `<td class="col-name" title="${escaped}"><span class="preview-name">${escaped}</span></td>`
  }
  if (fieldKey === 'platformCol' || fieldKey === 'exclusiveCol') {
    const parts = value
      .split(/[,，、/|]/)
      .map((part) => part.trim())
      .filter((part) => part !== '')
    const chips = parts
      .map(
        (part) =>
          `<span class="platform-chip" title="${escapeHtml(part)}">${escapeHtml(part)}</span>`,
      )
      .join('')
    return `<td class="col-platform" title="${escaped}">${chips}</td>`
  }
  if (fieldKey === 'weekdayCol' && /^周[一二三四五六日天]$/.test(value)) {
    return `<td title="${escaped}"><span class="weekday-chip">${escaped}</span></td>`
  }
  return `<td title="${escaped}">${escaped}</td>`
}

function renderSourcePreview(ws: WpsWorksheet, mapping: EnrichColumnMapping): void {
  const tableContainer = safeGetElement('sourceTable')
  if (!tableContainer) return

  const { dataStartRow } = state

  // 只取已映射的字段列，形成「一栏一行」的简洁预览
  const fieldCols = PREVIEW_FIELD_COLS.filter((f) => (mapping[f.key] ?? 0) > 0)
  if (fieldCols.length === 0) {
    const emptyThead = tableContainer.querySelector('thead')
    if (emptyThead) emptyThead.replaceChildren()
    const emptyTbody = tableContainer.querySelector('tbody')
    if (emptyTbody) emptyTbody.replaceChildren()
    const hintElement = safeGetElement('sourcePreviewHint')
    if (hintElement) {
      hintElement.textContent = '尚未识别到映射列，请先在「新番表文件」中识别表头'
      hintElement.style.display = ''
    }
    return
  }

  const thead = tableContainer.querySelector('thead')
  if (thead) {
    thead.innerHTML = sanitizeHtml(
      `<tr><th></th>${fieldCols.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('')}</tr>`,
    )
  }

  const tbody = tableContainer.querySelector('tbody')
  if (!tbody) return

  // 仅在通过 tbody 校验后才需要 maxRows，故在 early exit 之后声明
  const maxRows = 20
  const rowsHtml: string[] = []
  const lastRow = Math.min(getLastRow(ws), dataStartRow + maxRows - 1)

  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const rowCells: string[] = []
    let hasData = false
    for (const f of fieldCols) {
      const col = mapping[f.key] ?? 0
      const value = getCellValue(ws, row, col)
      if (value.trim()) hasData = true
      rowCells.push(renderPreviewCell(f.key, value))
    }
    if (hasData) {
      rowsHtml.push(
        `<tr data-row="${String(row)}"><td class="row-num">${String(row)}</td>${rowCells.join('')}</tr>`,
      )
    }
  }

  tbody.innerHTML = sanitizeHtml(rowsHtml.join(''))

  // 预览提示：仅展示前 maxRows 行
  const hintElement = safeGetElement('sourcePreviewHint')
  if (hintElement) {
    if (rowsHtml.length >= maxRows) {
      hintElement.textContent = `仅显示前 ${String(maxRows)} 行，可点击「查看详细数据表格」查看完整数据`
      hintElement.style.display = ''
    } else {
      hintElement.textContent = ''
      hintElement.style.display = 'none'
    }
  }

  // 显示「查看详细数据表格」按钮
  const detailAction = safeGetElement('sourceDetailAction')
  if (detailAction) {
    detailAction.style.display = ''
  }

  bgmLog(LOG_LEVELS.INFO, `[enrich] 源数据预览已渲染: ${String(rowsHtml.length)} 行`)
}

// ========== 源数据完整表格弹窗 ==========

function showSourceDetail(): void {
  const modalElement = safeGetElement('sourceDetailModal')
  const bodyElement = safeGetElement('sourceDetailBody')
  const ws = state.animeSourceSheet
  if (!modalElement || !bodyElement || !ws) return

  bodyElement.innerHTML = renderSourceDetailTable(ws)
  modalElement.style.display = 'flex'
}

function hideSourceDetail(): void {
  const modalElement = safeGetElement('sourceDetailModal')
  if (modalElement) {
    modalElement.style.display = 'none'
  }
}

/** 渲染源表完整表格（全部非空表头列 × 前 maxRows 行），供弹窗展示 */
function renderSourceDetailTable(ws: WpsWorksheet): string {
  const maxCols = 50
  const { headerRow, dataStartRow } = state

  const headerCells: { col: number; header: string }[] = []
  for (let col = 1; col <= maxCols; col += 1) {
    const value = getCellValue(ws, headerRow, col).trim()
    if (value) {
      headerCells.push({ col, header: escapeHtml(value) })
    }
  }

  if (headerCells.length === 0) {
    return '<div class="preview-hint">未找到表头列，无法展示完整表格</div>'
  }

  const maxRows = 100
  const lastRow = Math.min(getLastRow(ws), dataStartRow + maxRows - 1)

  const bodyRows: string[] = []
  for (let row = dataStartRow; row <= lastRow; row += 1) {
    const rowCells: string[] = []
    let hasData = false
    for (const h of headerCells) {
      const value = getCellValue(ws, row, h.col).trim()
      if (value) hasData = true
      rowCells.push(`<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`)
    }
    if (hasData) {
      bodyRows.push(
        `<tr data-row="${String(row)}"><td class="row-num">${String(row)}</td>${rowCells.join('')}</tr>`,
      )
    }
  }

  return sanitizeHtml(
    `<div class="preview-table"><table><thead><tr><th></th>${headerCells
      .map((h) => `<th>${h.header}</th>`)
      .join('')}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></div>`,
  )
}

// ========== 匹配预览 ==========

/**
 * 匹配预览。
 * @param options.keepSourceOpen 为 true 时预览结束不回收源工作簿
 *   （富化流程内部调用时使用：调用方还持有工作表引用，关闭会使其失效）
 */
export function previewMatch(options?: { keepSourceOpen?: boolean }): void {
  const animeSourceSheet = ensureSourceSheet()
  if (!animeSourceSheet) {
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
      sheetName: animeSourceSheet.Name || '',
      headerRow: state.headerRow,
      dataStartRow: state.dataStartRow,
      columnMapping: state.columnMapping,
      targetSheetName: state.bangumiSheet.Name || '',
    }

    state.matches = matchEntries(animeSourceSheet, state.bangumiSheet, config)

    renderMatchStats(state.matches)
    renderMatchResultsToTable(state.matches)
    updateMatchEmptyHint()

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
  } finally {
    // 可选开关：预览时重开了源工作簿，预览结束同样回收（仅关闭本插件打开的）
    if (
      !options?.keepSourceOpen &&
      state.closeSourceAfterDetect &&
      state.isSourceWorkbookOpenedByUs
    ) {
      closeSourceWorkbookOnly()
    }
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

/**
 * 目标表为空时提示：富化将把未匹配条目作为新行追加写入
 */
function updateMatchEmptyHint(): void {
  const hintElement = safeGetElement('matchEmptyHint')
  if (!hintElement || !state.bangumiSheet) return

  const pendingCount = state.matches.filter((m) => m.matchType === 'unmatched').length
  if (isBangumiSheetEmpty(state.bangumiSheet) && pendingCount > 0) {
    hintElement.textContent = `目标表暂无数据，富化时将新增 ${String(pendingCount)} 行`
    hintElement.style.display = ''
  } else {
    hintElement.textContent = ''
    hintElement.style.display = 'none'
  }
}

/** 匹配方式的徽标 class（与 .preview-table .match-status 配套） */
function matchStatusClass(matchType: MatchResult['matchType']): string {
  switch (matchType) {
    case 'exact': {
      return 'status-exact'
    }
    case 'alias': {
      return 'status-alias'
    }
    case 'error': {
      return 'status-error'
    }
    default: {
      return 'status-unmatched'
    }
  }
}

/** 匹配方式的徽标文案 */
function matchStatusText(matchType: MatchResult['matchType']): string {
  switch (matchType) {
    case 'exact': {
      return '✅ 精确'
    }
    case 'alias': {
      return '🔄 别名'
    }
    case 'error': {
      return '⚠️ 错误'
    }
    default: {
      return '❌ 未匹配'
    }
  }
}

/** 渲染「标签 值」对比标签列表 */
function renderCmpTags(items: { label: string; value: string }[]): string {
  if (items.length === 0) return '<div class="cmp-empty">—</div>'
  const tagsHtml = items
    .map(
      (item) =>
        `<span class="cmp-tag" title="${escapeHtml(`${item.label}：${item.value}`)}"><i>${escapeHtml(item.label)}</i>${escapeHtml(item.value)}</span>`,
    )
    .join('')
  return `<div class="cmp-tags">${tagsHtml}</div>`
}

/** 读取新番表源行的对比字段（按列映射读取已识别列） */
function buildSourceCmpTags(sourceSheet: WpsWorksheet | null, match: MatchResult): string {
  const mapping = state.columnMapping
  if (!sourceSheet || !mapping) return renderCmpTags([])
  const items: { label: string; value: string }[] = []
  for (const field of SOURCE_CMP_FIELDS) {
    const col = mapping[field.key] ?? 0
    if (col > 0) {
      const value = getCellValue(sourceSheet, match.animeRow, col).trim()
      if (value) items.push({ label: field.label, value })
    }
  }
  return renderCmpTags(items)
}

/** 读取 Bangumi 目标行对比字段（按目标表表头动态读取） */
function buildTargetCmpTags(
  targetSheet: WpsWorksheet | null,
  targetColMap: Map<string, number> | null,
  match: MatchResult,
): string {
  if (!targetSheet || !targetColMap || match.bangumiRow === undefined) {
    return '<div class="cmp-empty">未匹配到目标行</div>'
  }
  const items: { label: string; value: string }[] = []
  for (const field of TARGET_CMP_FIELDS) {
    const col =
      targetColMap.get(field.colKey) ??
      (field.fallbackColKey ? targetColMap.get(field.fallbackColKey) : undefined)
    if (col && col > 0) {
      const value = getCellValue(targetSheet, match.bangumiRow, col).trim()
      if (value) items.push({ label: field.label, value })
    }
  }
  if (items.length === 0) return '<div class="cmp-empty">目标行无对比数据</div>'
  return renderCmpTags(items)
}

/** 渲染匹配结果对比表格：源数据 / 匹配方式 / 目标数据 三栏对照 */
function renderMatchResultsToTable(matches: MatchResult[]): void {
  const tbodyElement = safeGetElement('matchTable')?.querySelector('tbody')
  if (!tbodyElement) return

  // 目标表列映射：按目标表表头动态读取对比字段
  const sourceSheet = state.animeSourceSheet
  const targetSheet = state.bangumiSheet
  const targetHeaderRow = targetSheet ? findHeaderRow(targetSheet) : 0
  const targetColMap =
    targetSheet && targetHeaderRow > 0 ? getColumnMap(targetSheet, targetHeaderRow) : null

  const rowsHtml = matches.map((match) => {
    const statusClass = matchStatusClass(match.matchType)
    const statusText = matchStatusText(match.matchType)

    const sourceTags = buildSourceCmpTags(sourceSheet, match)
    const targetNameHtml = match.bangumiName
      ? `<div class="cmp-name">${escapeHtml(match.bangumiName)}</div>`
      : ''
    const targetMetaHtml =
      match.bangumiRow === undefined
        ? ''
        : `<div class="cmp-meta">目标行 ${String(match.bangumiRow)}</div>`
    const targetTags = buildTargetCmpTags(targetSheet, targetColMap, match)

    return `
      <tr class="match-row match-${match.matchType}">
        <td class="cmp-cell cmp-source">
          <div class="cmp-name">${escapeHtml(match.matchedAnimeName)}</div>
          <div class="cmp-meta">源表行 ${String(match.animeRow)}</div>
          ${sourceTags}
        </td>
        <td class="cmp-status-cell">
          <span class="match-status ${statusClass}">${statusText}</span>
        </td>
        <td class="cmp-cell cmp-target">
          ${targetNameHtml}
          ${targetMetaHtml}
          ${targetTags}
        </td>
        <td class="cmp-action">
          <button class="bgm-btn small match-detail-btn">🔍 详情</button>
        </td>
      </tr>
    `
  })

  tbodyElement.innerHTML = sanitizeHtml(rowsHtml.join(''))

  // 绑定每行详情按钮（行内按钮由预览刷新时重建，需按次绑定；
  // 闭包按索引取值，避免依赖会被 sanitize 剥离的 data-* 属性）
  const detailButtons = tbodyElement.querySelectorAll<HTMLButtonElement>('.match-detail-btn')
  detailButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      const match = matches[index]
      if (match) showMatchDetail(match)
    })
  })

  const matchTableContainer = safeGetElement('matchPreviewTable')
  if (matchTableContainer) {
    matchTableContainer.style.display = ''
  }
}

// ========== 匹配详情弹窗 ==========

function showMatchDetail(match: MatchResult): void {
  const modalElement = safeGetElement('matchDetailModal')
  const bodyElement = safeGetElement('matchDetailBody')
  if (!modalElement || !bodyElement) return

  bodyElement.innerHTML = sanitizeHtml(renderMatchDetail(match))
  modalElement.style.display = 'flex'
}

function hideMatchDetail(): void {
  const modalElement = safeGetElement('matchDetailModal')
  if (modalElement) {
    modalElement.style.display = 'none'
  }
}

/** 匹配详情的键值对列表渲染 */
function renderMatchDetail(match: MatchResult): string {
  let statusClass = 'match-status'
  let statusText: string
  switch (match.matchType) {
    case 'exact': {
      statusClass += ' status-exact'
      statusText = '✅ 精确匹配'
      break
    }
    case 'alias': {
      statusClass += ' status-alias'
      statusText = '🔄 别名匹配'
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
    default: {
      statusClass += ' status-unmatched'
      statusText = '未知'
      break
    }
  }

  const items: { label: string; valueHtml: string }[] = [
    { label: '新番名称', valueHtml: escapeHtml(match.matchedAnimeName) },
    { label: '源表行号', valueHtml: String(match.animeRow) },
    { label: '匹配方式', valueHtml: `<span class="${statusClass}">${statusText}</span>` },
  ]

  if (match.bangumiRow !== undefined) {
    items.push({ label: 'Bangumi行号', valueHtml: String(match.bangumiRow) })
  }
  if (match.bangumiName !== undefined) {
    items.push({ label: 'Bangumi名称', valueHtml: escapeHtml(match.bangumiName) })
  }
  if (match.aliases && match.aliases.length > 0) {
    const aliasHtml = match.aliases
      .map((a) => `<span class="match-detail-alias">${escapeHtml(a)}</span>`)
      .join('')
    items.push({ label: '别名', valueHtml: `<div class="match-detail-aliases">${aliasHtml}</div>` })
  }
  if (match.errorMessage) {
    items.push({ label: '错误信息', valueHtml: escapeHtml(match.errorMessage) })
  }

  const listHtml = items
    .map(
      (item) => `
        <div class="match-detail-item">
          <span class="match-detail-label">${escapeHtml(item.label)}</span>
          <span class="match-detail-value">${item.valueHtml}</span>
        </div>
      `,
    )
    .join('')

  return `<div class="match-detail-list">${listHtml}</div>`
}

// ========== 富化执行 ==========

export function startEnrichment(): void {
  if (state.isEnriching) {
    bgmLog(LOG_LEVELS.WARN, '[enrich] 富化正在进行中，忽略重复请求')
    return
  }

  // 多文件场景的源表归批量流程所有，单文件富化不可用
  if (state.batchFiles.length >= 2) {
    BGM.Dialog.alert('提示', '已选择多个文件，请使用「🚀 批量富化」')
    return
  }

  const animeSourceSheet = ensureSourceSheet()
  if (!animeSourceSheet) {
    BGM.Dialog.alert('提示', '请先选择新番表文件并识别表头')
    return
  }

  // 如果 state 中没有 bangumiSheet，尝试从锁定状态获取
  if (!state.bangumiSheet) {
    const locked = getLockedEnrichSheet()
    if (locked) {
      const [, lockedSheet] = locked
      state.bangumiSheet = lockedSheet
      bgmLog(LOG_LEVELS.INFO, `[enrich] 使用锁定的目标工作表: ${lockedSheet.Name}`)
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
    // keepSourceOpen: 调用方仍持有 animeSourceSheet，预览结束时不能回收工作簿
    previewMatch({ keepSourceOpen: true })
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
    sheetName: animeSourceSheet.Name || '',
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
      animeSourceSheet,
      state.bangumiSheet,
      state.matches,
      config,
      progressCallback,
    )

    showProgressUI(false)

    // 保存本次富化详细条目并显示「查看详细结果」按钮（有无冲突均可查看）
    state.enrichDetailGroups = [{ fileName: extractFileName(state.filePath), items: results }]
    showEnrichDetailButton()

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
    // 可选开关：识别后已关闭源工作簿，富化结束再回收一次（仅关闭本插件打开的）
    if (state.closeSourceAfterDetect && state.isSourceWorkbookOpenedByUs) {
      closeSourceWorkbookOnly()
    }
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
    // 富化结束恢复时也要尊重"仅 N===1 可用"的约束（N>=2 走批量富化）
    startButton.disabled = isVisible || state.batchFiles.length !== 1
    startButton.textContent = isVisible ? '⏳️ 富化中...' : '🚀 开始富化'
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

  // 详细条目已在 startEnrichment 统一保存并显示「查看详细结果」按钮
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

// ========== 富化详细结果 ==========

function showEnrichDetailButton(): void {
  const actionElement = safeGetElement('enrichDetailAction')
  if (actionElement) {
    actionElement.style.display = ''
  }
}

function showEnrichDetail(): void {
  const modalElement = safeGetElement('enrichDetailModal')
  const bodyElement = safeGetElement('enrichDetailBody')
  if (!modalElement || !bodyElement) return

  bodyElement.innerHTML = renderEnrichDetailHtml(state.enrichDetailGroups)
  modalElement.style.display = 'flex'
}

function hideEnrichDetail(): void {
  const modalElement = safeGetElement('enrichDetailModal')
  if (modalElement) {
    modalElement.style.display = 'none'
  }
}

/** 把匹配方式枚举映射为用户可读的中文标记 */
function matchTypeLabel(matchType: MatchResult['matchType']): { text: string; badge: string } {
  switch (matchType) {
    case 'exact': {
      return { text: '精确命中', badge: 'exact' }
    }
    case 'alias': {
      return { text: '别名匹配', badge: 'alias' }
    }
    case 'error': {
      return { text: '错误', badge: 'error' }
    }
    default: {
      return { text: '新增/未匹配', badge: 'unmatched' }
    }
  }
}

/** 把富化操作枚举映射为中文标记 */
function fieldActionLabel(action: EnrichedField['action']): { text: string; cls: string } {
  switch (action) {
    case 'fill': {
      return { text: '填充', cls: 'fill' }
    }
    case 'append': {
      return { text: '追加', cls: 'append' }
    }
    default: {
      return { text: '跳过', cls: 'skip' }
    }
  }
}

function renderEnrichDetailHtml(groups: EnrichDetailGroup[]): string {
  if (groups.length === 0) {
    return '暂无富化数据，请先执行富化'
  }

  const totalMatched = groups.reduce(
    (sum, group) => sum + group.items.filter((r) => r.kind === 'matched').length,
    0,
  )
  const totalUnmatched = groups.reduce(
    (sum, group) => sum + group.items.filter((r) => r.kind === 'unmatched').length,
    0,
  )
  const totalErrors = groups.reduce(
    (sum, group) => sum + group.items.filter((r) => r.kind === 'error').length,
    0,
  )
  const totalFields = groups.reduce(
    (sum, group) =>
      sum +
      group.items.reduce(
        (s, item) => s + item.enrichedFields.filter((f) => f.action !== 'skip').length,
        0,
      ),
    0,
  )

  const summaryHtml = `
    <div class="enrich-detail-summary">
      <div class="enrich-detail-stat matched">
        <div class="enrich-detail-stat-num">${String(totalMatched)}</div>
        <div class="enrich-detail-stat-label">已匹配</div>
      </div>
      <div class="enrich-detail-stat unmatched">
        <div class="enrich-detail-stat-num">${String(totalUnmatched)}</div>
        <div class="enrich-detail-stat-label">未匹配</div>
      </div>
      <div class="enrich-detail-stat error">
        <div class="enrich-detail-stat-num">${String(totalErrors)}</div>
        <div class="enrich-detail-stat-label">错误</div>
      </div>
      <div class="enrich-detail-stat field">
        <div class="enrich-detail-stat-num">${String(totalFields)}</div>
        <div class="enrich-detail-stat-label">字段更新</div>
      </div>
    </div>
  `

  const entriesHtml = groups.map((group) => renderEnrichDetailGroup(group)).join('')

  return sanitizeHtml(`${summaryHtml}${entriesHtml}`)
}

function renderEnrichDetailGroup(group: EnrichDetailGroup): string {
  if (group.items.length === 0) {
    return `<div class="enrich-detail-group empty">${escapeHtml(group.fileName)}：无条目</div>`
  }

  const entries = group.items.map((item) => renderEnrichDetailEntry(item)).join('')
  return `
    <div class="enrich-detail-group">
      <div class="enrich-detail-group-title">📄 ${escapeHtml(group.fileName)}</div>
      <div class="enrich-detail-entries">${entries}</div>
    </div>
  `
}

function renderEnrichDetailEntry(item: EnrichResultItem): string {
  const name = escapeHtml(item.name)
  const headBadge = item.matchType ? matchTypeLabel(item.matchType) : null

  if (item.kind === 'error') {
    const badge = headBadge ?? matchTypeLabel('error')
    const errorMessage = escapeHtml(item.errorMessage ?? '未知错误')
    return `
      <div class="enrich-detail-entry">
        <div class="enrich-detail-entry-head">
          <span class="enrich-detail-entry-name">${name}</span>
          <span class="enrich-detail-entry-badge ${badge.badge}">${badge.text}</span>
        </div>
        <div class="enrich-detail-entry-error">${errorMessage}</div>
      </div>
    `
  }

  if (item.kind === 'unmatched') {
    const badge = headBadge ?? matchTypeLabel('unmatched')
    return `
      <div class="enrich-detail-entry">
        <div class="enrich-detail-entry-head">
          <span class="enrich-detail-entry-name">${name}</span>
          <span class="enrich-detail-entry-badge ${badge.badge}">${badge.text}</span>
        </div>
      </div>
    `
  }

  const badge = headBadge ?? matchTypeLabel('exact')
  const hasFields = item.enrichedFields.length > 0
  const fieldsHtml = hasFields
    ? `
      <table class="enrich-detail-fields">
        <thead>
          <tr>
            <th>字段</th>
            <th>原值</th>
            <th></th>
            <th>新值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${item.enrichedFields.map((field) => renderEnrichDetailField(field)).join('')}
        </tbody>
      </table>
    `
    : `<div class="enrich-detail-entry-error enrich-detail-empty">该条目无字段变更</div>`

  return `
    <div class="enrich-detail-entry">
      <div class="enrich-detail-entry-head">
        <span class="enrich-detail-entry-name">${name}</span>
        <span class="enrich-detail-entry-badge ${badge.badge}">${badge.text}</span>
      </div>
      ${fieldsHtml}
    </div>
  `
}

function renderEnrichDetailField(field: EnrichedField): string {
  const fieldName = escapeHtml(field.fieldName)
  const oldValue = escapeHtml(field.oldValue ?? '（空）')
  const updatedValue = escapeHtml(field.updatedValue || '（空）')
  const action = fieldActionLabel(field.action)
  return `
    <tr>
      <td class="field-name">${fieldName}</td>
      <td class="field-old">${oldValue}</td>
      <td class="field-arrow">→</td>
      <td class="field-new">${updatedValue}</td>
      <td class="field-action ${action.cls}">${action.text}</td>
    </tr>
  `
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
        let actionText: string
        switch (r.action) {
          case 'fill': {
            actionText = '填充'
            break
          }
          case 'append': {
            actionText = '追加'
            break
          }
          case 'skip': {
            actionText = '跳过'
            break
          }
          default: {
            actionText = '错误'
            break
          }
        }
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
      default: {
        // 未知匹配类型：保持默认样式，不额外处理
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

/** 静态对话框按钮只需绑定一次（不再随每次展示重建 DOM） */
function bindConflictDialogButtons(): void {
  const dialogElement = safeGetElement('conflictDialog')
  if (!dialogElement) return
  dialogElement.querySelectorAll('[data-resolution]').forEach((button) => {
    button.addEventListener('click', () => {
      const resolution = (button as HTMLElement).dataset.resolution as ConflictInfo['resolution']
      handleConflictResolution(resolution)
    })
  })
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

  // 静态模板只更新文本值，避免运行时拼接 HTML
  const titleElement = safeGetElement('conflictTitle')
  if (titleElement)
    titleElement.textContent = `⚡️ 字段冲突确认 (${String(current)}/${String(total)})`

  const fillElement = safeGetElement('conflictProgressFill')
  if (fillElement) fillElement.style.width = `${String(percent)}%`

  const nameElement = safeGetElement('conflictName')
  if (nameElement) nameElement.textContent = conflict.matchedAnimeName

  const fieldElement = safeGetElement('conflictField')
  if (fieldElement) fieldElement.textContent = conflict.fieldName

  const oldElement = safeGetElement('conflictOld')
  if (oldElement) oldElement.textContent = conflict.oldValue

  const updatedElement = safeGetElement('conflictNew')
  if (updatedElement) updatedElement.textContent = conflict.updatedValue

  dialogElement.style.display = 'block'
}

function hideConflictDialog(): void {
  const dialogElement = safeGetElement('conflictDialog')
  if (dialogElement) {
    dialogElement.style.display = 'none'
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
  const removed = state.batchFiles[index]
  if (removed === undefined) return
  state.batchFiles.splice(index, 1)
  // 单/多选统一入口：移除后保持 state.filePath 始终指向 batchFiles 的首位
  state.filePath = state.batchFiles[0] ?? ''
  bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 移除文件: ${extractFileName(removed)}`)
  renderBatchFileList()

  // 由多文件回到单文件时，源表状态在 renderBatchFileList() 中已被回收清空，
  // 这里补一次自动识别，避免用户还要手动点「识别表头」。
  if (state.batchFiles.length === 1 && state.headerRow === 0) {
    maybeAutoDetectSingleFile()
  }
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

/** 打开批量源文件并取得首个工作表。失败时抛出，由调用方统一记录结果。 */
function openBatchSourceWorkbook(
  filePath: string,
  fileName: string,
): { wb: WpsWorkbook; ws: WpsWorksheet } {
  const app = getApp()
  if (!app?.Workbooks) throw new Error('WPS 应用不可用')

  const workbooks = app.Workbooks as unknown as {
    Open?: (path: string) => WpsWorkbook | null
  }
  bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 打开文件: ${fileName}`)
  if (typeof workbooks.Open !== 'function') throw new TypeError('WPS Workbooks.Open 不可用')

  const wb = workbooks.Open(filePath)
  if (!wb) throw new Error('无法打开文件：WPS 返回了 null')

  const ws = wb.Worksheets.Item(1) as WpsWorksheet | null
  if (!ws) throw new Error('文件中没有工作表')
  return { wb, ws }
}

/** 对已打开的批量源表执行布局识别、匹配和富化。 */
function enrichSingleBatchSource(
  filePath: string,
  fileName: string,
  ws: WpsWorksheet,
  bangumiSheet: WpsWorksheet,
  result: BatchFileResult,
): void {
  const sourceLayout = detectAnimeSourceLayout(ws)
  const headerRow = sourceLayout?.headerRow ?? findHeaderRow(ws)
  if (headerRow === 0) {
    result.error = '未检测到有效的表头行'
    bgmLog(
      LOG_LEVELS.ERROR,
      `[enrich-batch] ${fileName}: 表头识别失败 - 未检测到有效的表头行（请确认表头在前 10 行内）`,
    )
    return
  }

  const dataStartRow = sourceLayout?.dataStartRow ?? headerRow + 1
  const columnMapping = sourceLayout?.columnMapping ?? detectColumns(ws, headerRow)
  if (columnMapping.nameCol === 0) {
    result.error = '已找到字段行，但未找到名称列'
    bgmLog(LOG_LEVELS.ERROR, `[enrich-batch] ${fileName}: 表头识别失败 - 未找到名称列`)
    return
  }
  result.headerRow = headerRow

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrich-batch] ${fileName}: 表头识别成功 - 工作表=${ws.Name || '未知'} / 表头行=${String(headerRow)} / 名称列=${String(columnMapping.nameCol)}`,
  )

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
  const enrichResults = enrichEntries(ws, bangumiSheet, matches, config, () => {
    /* 批量模式不回调进度（已由外层控制） */
  })
  const updatedEntries = enrichResults.filter((r) => r.kind === 'matched').length
  const entries = enrichResults.filter(
    (r) => r.kind === 'matched' && r.enrichedFields.length > 0,
  ).length

  result.matched = matched
  result.addedEntries = entries
  result.updatedEntries = updatedEntries
  result.unmatched = unmatched
  result.success = true

  // 累积到详情弹窗数据（批量结束时统一显示「查看详细结果」按钮）
  state.enrichDetailGroups.push({ fileName, items: enrichResults })

  bgmLog(
    LOG_LEVELS.INFO,
    `[enrich-batch] ${fileName}: 匹配 ${String(matched)}，未匹配 ${String(unmatched)}，处理 ${String(updatedEntries)}`,
  )
}

/** 关闭批量源文件，不保存。 */
function closeBatchSourceWorkbook(wb: WpsWorkbook, fileName: string): void {
  try {
    const wbWithClose = wb as unknown as { Close?: (shouldSaveChanges?: boolean) => unknown }
    if (typeof wbWithClose.Close === 'function') wbWithClose.Close(false)
    bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 已关闭文件: ${fileName}`)
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrich-batch] 关闭文件时警告: ${error instanceof Error ? error.message : String(error)}`,
    )
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
    headerRow: 0,
    matched: 0,
    addedEntries: 0,
    updatedEntries: 0,
    unmatched: 0,
    success: false,
  }

  let wb: WpsWorkbook | null = null
  try {
    const opened = openBatchSourceWorkbook(filePath, fileName)
    wb = opened.wb
    enrichSingleBatchSource(filePath, fileName, opened.ws, bangumiSheet, result)
  } catch (error: unknown) {
    result.error = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[enrich-batch] ${fileName} 处理失败: ${result.error}`)
  } finally {
    if (wb) closeBatchSourceWorkbook(wb, fileName)
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
      const [, lockedSheet] = locked
      bangumiSheet = lockedSheet
      state.bangumiSheet = lockedSheet
      bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 使用锁定的目标工作表: ${lockedSheet.Name}`)
    }
  }

  if (!bangumiSheet) {
    BGM.Dialog.alert('提示', '请先选择并锁定目标 Bangumi 工作表（在上方"🎯 目标工作表"区域）')
    return
  }

  // 清空之前的结果
  state.batchResults = []
  state.enrichDetailGroups = []
  state.batchIndex = 0
  state.isBatchEnriching = true
  state.batchCancelRequested = false

  // 隐藏批量汇总及上一轮详情按钮
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
    const filePath = state.batchFiles[index]
    if (filePath === undefined) break
    const fileName = extractFileName(filePath)

    updateBatchProgressUI(state.batchIndex, total, fileName)

    // 让出主线程，给 UI 更新机会
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30)
    })

    const result = processSingleBatchFile(filePath, bangumiSheet)
    state.batchResults.push(result)

    // 让出主线程，给 WPS 资源释放机会
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50)
    })
  }

  state.isBatchEnriching = false

  // 恢复 UI
  showBatchProgress(false)
  const startButton = safeGetButton('batchStartBtn')
  if (startButton) startButton.disabled = false

  // 显示汇总
  renderBatchSummary()
  // 批量富化完成后显示「查看详细结果」按钮（数据已累积到 enrichDetailGroups）
  if (state.enrichDetailGroups.length > 0) {
    showEnrichDetailButton()
  }

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
        ? `表头行 ${String(r.headerRow)} · 匹配 ${String(r.matched)} / 更新 ${String(r.updatedEntries)} / 未匹配 ${String(r.unmatched)}`
        : `失败：${escapeHtml(r.error || '未知错误')}` // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空值须显示占位文案（`??` 会显示空串）
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
