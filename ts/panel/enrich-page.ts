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
  readPlatformValues,
  findIntroSheetInWorkbook,
  buildIntroSheetContext,
  normalizeName,
} from '../sync/enrich-engine.js'
import type {
  EnrichColumnMapping,
  EnrichConfig,
  MatchResult,
  EnrichResultItem,
  EnrichProgress,
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
import { getOrCreateEnrichRecordSheet } from '../sync/enrich-record.js'
import {
  ANIME_SOURCE_DETECTOR,
  BANGUMI_TARGET_DETECTOR,
  collectDetectedWorkbookPaths,
  describeOpenWorkbooks,
  findAnimeSourceSheetInWorkbook,
  mergeDetectedPathsIntoStorage,
  monthLabelFromWorkbookName,
  scanMatchingWorkbooks,
} from '../sync/workbook-auto-detect.js'
import { sanitizeHtml, sanitizeTableRows } from '../tools/sanitize.js'
import { createProgress } from '../ui/components/progress.js'
import type { ProgressController, ProgressShowOptions } from '../ui/components/progress.js'
import { escapeHtml } from '../tools/string-utilities.js'
import { showToast } from '../ui/dialog.js'
import {
  getCellValue,
  getLastRow,
  findHeaderRow,
  getColumnMap,
  bgmLog,
  BGM,
  getApp,
} from '../tools/util/index.js'
import { findWorkbookByName, getOpenWorkbooks } from '../tools/locked-sheet.js'
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js'
import { recomputeScrollspy } from './shell-nav.js'
import { COLUMN_MAPPING_FIELDS, resetEnrichPreviewConfig } from './enrich-page-state.js'
import type { ScalarMappingKey } from './enrich-page-state.js'
import { renderPlatformChipsCell, renderPreviewCell } from './enrich-preview-cell.js'
import { extractFileName } from './enrich-file-name.js'
import {
  state,
  safeGetElement,
  safeGetButton,
  safeGetSelect,
  safeGetCheckbox,
} from './enrich-page-context.js'
import type { BatchFileResult } from './enrich-page-context.js'
import { showSourceDetail, hideSourceDetail } from './enrich-source-detail.js'
import {
  maybeAutoCleanAfterEnrich,
  showEnrichDetailButton,
  showEnrichDetail,
  hideEnrichDetail,
} from './enrich-result-view.js'
import { openEnrichRecordSheet, clearRecords, loadRecentRecords } from './enrich-record-view.js'

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

  // 初始化「数据预览」页签可见性（默认新番表数据页签，隐藏匹配相关按钮/统计）
  refreshMatchHintText()
  applyPreviewTabVisibility()
  startEnrichWorkbookWatch()

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
      // 用户已手动选择：取消自动识别的兜底重试，避免覆盖用户选择
      cancelEnrichWatchRetries()
      refreshSheetList()
      // 切换工作簿时同步锁定状态显示
      updateEnrichLockButton('lockSheetBtn', 'lockStatus')
    })
  }

  const sheetSelect = safeGetSelect('sheetSelect')
  if (sheetSelect) {
    sheetSelect.addEventListener('change', () => {
      // 用户已手动选择：取消自动识别的兜底重试，避免覆盖用户选择
      cancelEnrichWatchRetries()
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
      // 刷新后若已锁定目标工作表，自动跑一次预览匹配（用户无需再点一次「预览匹配」即可看到匹配结果）
      if (state.animeSourceSheet && state.bangumiSheet && state.columnMapping) {
        queueMicrotask(() => {
          previewMatch()
        })
      }
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
      if (tabName !== 'source' && tabName !== 'match') return

      tabs.forEach((t) => {
        t.classList.remove('active')
      })
      tab.classList.add('active')

      setPreviewTab(tabName)
    })
  })
}

/** 切换「数据预览」页签（统一入口：同步 active 样式 + 各区块可见性） */
function setPreviewTab(tab: 'source' | 'match'): void {
  state.activePreviewTab = tab

  const tabs = document.querySelectorAll<HTMLElement>('.preview-tab')
  tabs.forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab)
  })

  // 切到匹配结果页时刷新空态提示文案（可能尚未预览 / 目标表未选）
  refreshMatchHintText()
  applyPreviewTabVisibility()
}

/**
 * 按当前页签统一设置「数据预览」各区块可见性。
 *
 * 目的：修复切换页签后残留上一个页签的提示/按钮（如新番表页签仍显示匹配统计卡片，
 * 或匹配结果页签仍显示「查看详细数据表格」），以及未预览时展示空白/仅表头表格的问题。
 */
function applyPreviewTabVisibility(): void {
  const isMatchTab = state.activePreviewTab === 'match'
  const hasMatches = state.matches.length > 0

  setPreviewElementVisible('sourcePreviewTable', !isMatchTab)
  setPreviewElementVisible('sourceDetailAction', !isMatchTab && state.hasSourcePreview)

  // 提示类元素：仅在有文案时才显示，避免空白占位
  setPreviewElementVisible('sourcePreviewHint', !isMatchTab, true)
  setPreviewElementVisible('matchEmptyHint', isMatchTab, true)

  // 「预览匹配」按钮仅在「匹配结果」页签显示
  setPreviewElementVisible('matchPreviewAction', isMatchTab)

  // 统计卡片与匹配表格：仅匹配结果页签且已有匹配结果时显示（未预览前不展示空表格）
  setPreviewElementVisible('matchStats', isMatchTab && hasMatches)
  setPreviewElementVisible('matchPreviewTable', isMatchTab && hasMatches)
}

/** 设置预览区元素的显示/隐藏；hasTextOnly=true 时文本为空则强制隐藏 */
function setPreviewElementVisible(id: string, isVisible: boolean, hasTextOnly = false): void {
  const element = safeGetElement(id)
  if (!element) return
  const hasText = element.textContent.trim().length > 0
  element.style.display = isVisible && (!hasTextOnly || hasText) ? '' : 'none'
}

/** 清空匹配结果（切换源表/重新识别表头时调用，避免展示过期结果） */
function resetMatchResults(): void {
  state.matches = []
  const tbody = safeGetElement('matchTable')?.querySelector('tbody')
  if (tbody) tbody.replaceChildren()
  refreshMatchHintText()
  applyPreviewTabVisibility()
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

  // 6) 文件已选后折叠 sec-file 内的「选择文件 / 自动识别」按钮组（CSS 控制）
  //    使 sec-file 收缩，让 sec-target 自然上移到主区域顶部，与侧栏第 2 项高亮对齐，
  //    避免 scrollspy 在 sec-file 与 sec-target 之间跳动造成「导航高亮与首个可见模块错位」。
  const secFile = document.getElementById('sec-file')
  if (secFile) secFile.classList.toggle('has-file-selected', n > 0)
  // 7) 主动触发 scrollspy 重算：sec-file 高度变化后立刻刷新「当前主导区块」
  recomputeScrollspy()
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

    // 关联简介表 + 刷新工作簿切换按钮条
    discoverIntroContext()
    renderWorkbookTabs()

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

  // 已打开则复用：统一检查 Workbooks、Windows 和 ActiveWorkbook 可见的工作簿。
  for (const existing of getOpenWorkbooks()) {
    if (existing.FullName === filePath || existing.Name === fileName) {
      bgmLog(LOG_LEVELS.INFO, `[enrich] 复用已打开的工作簿: ${existing.Name}`)
      return { wb: existing, isOpenedByUs: false }
    }
  }

  // WPS Workbooks.Open 是运行时扩展，不在类型定义中
  const workbooks = app.Workbooks as unknown as { Open?: (path: string) => WpsWorkbook | null }
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
    state.hasSourcePreview = false
    resetMatchResults()
  }

  state.sourceWorkbook = null
  state.isSourceWorkbookOpenedByUs = false
  state.introContext = null
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

/**
 * 页面打开时检查 Bangumi 数据表识别情况：未锁定时交由 autoSelectEnrichTarget 自动选择/锁定目标表。
 *
 * 注意：不能因为「检测器结果为 0」就跳过自动选择。
 * 检测器（BANGUMI_TARGET_DETECTOR）带名称预筛，工作表名不含 bangumi/追踪/动画 等关键词时会返回 0；
 * 而 autoSelectEnrichTarget 内部使用的 findBangumiTargetSheets 具备「无名称命中时回退扫描全部工作表」
 * 的兜底能力。二者判定口径不一致，跳过会导致明明可识别的目标表被漏掉。
 */
function checkBangumiAutoDetectRecords(): void {
  try {
    const paths = collectDetectedWorkbookPaths(BANGUMI_TARGET_DETECTOR)
    const names = paths.length > 0 ? paths.map((path) => extractFileName(path)).join('、') : '无'
    bgmLog(
      LOG_LEVELS.INFO,
      `[enrich] 页面打开检查：Bangumi 数据表识别记录 ${String(paths.length)} 个（${names}）；当前打开工作簿 ${describeOpenWorkbooks()}`,
    )

    // 把本次实时扫描结果并入持久化记录（不覆盖历史记录），便于 Ribbon / 其他页面共享
    mergeDetectedPathsIntoStorage()

    if (BGM.sheet.isLocked) return

    const result = autoSelectEnrichTarget(
      'workbookSelect',
      'sheetSelect',
      'lockSheetBtn',
      'lockStatus',
    )
    if (result !== 'none') {
      // 自动选择/锁定不会触发 select 的 change 事件，需同步 state.bangumiSheet
      selectTargetSheet()
    }
    bgmLog(LOG_LEVELS.INFO, `[enrich] 页面打开检查：目标表自动识别结果=${result}`)
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.ERROR,
      context: 'checkBangumiAutoDetectRecords',
    })
  }
}

// ========== 工作簿变化监听（自动识别目标工作簿） ==========
//
// 背景：页面打开时 WPS 的 Workbooks 集合可能尚未就绪，或目标工作簿在页面打开之后才被打开/激活，
// 导致首轮扫描漏掉目标表（现象：工作簿下拉只列出部分工作簿、自动识别 0 个候选，必须手动点刷新或
// 先切换到目标工作簿才找得到）。这里沿用主面板 userInfoPolling 的思路做低频轮询：
//   1. 工作簿数量变化（打开/关闭工作簿）；
//   2. 活动工作簿切换（用户在 WPS 中切换窗口）；
//   3. 页面打开后若干次兜底重试（应对首轮扫描时集合未就绪）。
// 命中任一项即刷新工作簿列表并重新识别目标表，无需用户手动点击「刷新」。

const ENRICH_WATCH_INTERVAL_MS = 2000
const ENRICH_WATCH_MAX_RETRY = 3

let enrichWatchTimer: number | null = null
/** 剩余兜底重试次数（用户手动选择/解锁后置 0，避免覆盖用户意图） */
let enrichWatchRetriesLeft = ENRICH_WATCH_MAX_RETRY

/** 取消自动识别的兜底重试（用户已手动选择目标或主动解锁时调用） */
function cancelEnrichWatchRetries(): void {
  enrichWatchRetriesLeft = 0
}

/** 刷新工作簿列表并重新自动识别目标表（已锁定时仅同步列表与引用） */
function recheckEnrichTarget(reason: string): void {
  bgmLog(LOG_LEVELS.INFO, `[enrich] ${reason}：刷新工作簿列表并重新识别目标表`)
  refreshWorkbookList()

  if (BGM.sheet.isLocked) {
    refreshSheetList()
    selectTargetSheet()
    return
  }

  const result = autoSelectEnrichTarget(
    'workbookSelect',
    'sheetSelect',
    'lockSheetBtn',
    'lockStatus',
  )
  refreshSheetList()
  selectTargetSheet()
  bgmLog(
    LOG_LEVELS.INFO,
    `[enrich] ${reason}：目标表自动识别结果=${result}（${describeOpenWorkbooks()}）`,
  )
}

/** 启动富化页面的工作簿变化监听（幂等，页面卸载时自动停止） */
function startEnrichWorkbookWatch(): void {
  if (typeof window === 'undefined') return
  if (enrichWatchTimer !== null) return

  const app = getApp()
  let lastWorkbookCount = app?.Workbooks?.Count ?? 0
  let lastActiveWorkbookName = app?.ActiveWorkbook?.Name ?? null

  /**
   * 判断本轮是否需要重新识别，返回用于日志的原因；无需处理返回 null。
   * 会顺带更新基线（count / 活动工作簿名 / 剩余重试次数）。
   */
  const takeRecheckReason = (count: number, activeName: string | null): string | null => {
    if (count !== lastWorkbookCount) {
      lastWorkbookCount = count
      lastActiveWorkbookName = activeName
      return `检测到工作簿数量变化（${String(count)} 个）`
    }

    if (activeName !== lastActiveWorkbookName) {
      lastActiveWorkbookName = activeName
      return `检测到活动工作簿切换（${activeName ?? '无'}）`
    }

    // 兜底重试：页面刚打开时集合可能未就绪，未锁定且尚未识别到目标表时再扫几次
    if (enrichWatchRetriesLeft > 0 && !BGM.sheet.isLocked && !state.bangumiSheet) {
      enrichWatchRetriesLeft -= 1
      return `目标表尚未识别，重试扫描（剩余 ${String(enrichWatchRetriesLeft)} 次）`
    }

    return null
  }

  const pollOnce = (): void => {
    try {
      const currentApp = getApp()
      const reason = takeRecheckReason(
        currentApp?.Workbooks?.Count ?? 0,
        currentApp?.ActiveWorkbook?.Name ?? null,
      )
      if (reason) recheckEnrichTarget(reason)
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[enrich] 工作簿监听轮询失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  enrichWatchTimer = window.setInterval(pollOnce, ENRICH_WATCH_INTERVAL_MS)
  window.addEventListener('beforeunload', stopEnrichWorkbookWatch)
}

/** 停止富化页面的工作簿变化监听 */
function stopEnrichWorkbookWatch(): void {
  if (enrichWatchTimer === null) return
  window.clearInterval(enrichWatchTimer)
  enrichWatchTimer = null
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
    const fieldKey = select.dataset.field as ScalarMappingKey | null
    if (!fieldKey) return

    select.addEventListener('change', () => {
      const value = Number(select.value)
      if (state.columnMapping) {
        updateColumnMapping(fieldKey, Number.isNaN(value) ? 0 : value)
      }
    })
  })
}

function updateColumnMapping(field: ScalarMappingKey, value: number): void {
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
  if (!app) return null

  const wbSelect = safeGetSelect('workbookSelect')
  const wbName = wbSelect?.value ?? ''

  if (!wbName) return app.ActiveWorkbook ?? null

  const selected = findWorkbookByName(wbName)
  return selected ?? app.ActiveWorkbook ?? null
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
    applyTargetSheet(null)
    return
  }

  const sheetIndex = Number(sheetSelect.value)
  const wb = getSelectedWorkbook()
  if (!wb || sheetIndex <= 0) {
    applyTargetSheet(null)
    return
  }

  try {
    const ws = wb.Worksheets.Item(sheetIndex)
    applyTargetSheet(ws)
    bgmLog(LOG_LEVELS.INFO, `[enrich] 已选择目标工作表: ${ws.Name} (索引: ${String(sheetIndex)})`)
  } catch (error: unknown) {
    applyTargetSheet(null)
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'selectTargetSheet',
    })
  }
}

/**
 * 更新目标工作表引用：目标表变化时清空已有的匹配结果（结果依赖目标表，失效结果不可继续展示）。
 */
function applyTargetSheet(ws: WpsWorksheet | null): void {
  const previousName = state.bangumiSheet?.Name ?? null
  state.bangumiSheet = ws

  if ((ws?.Name ?? null) === previousName) {
    refreshMatchHintText()
    applyPreviewTabVisibility()
    return
  }
  resetMatchResults()
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
    // 用户主动解锁：取消自动识别的兜底重试，避免立刻又被自动锁定回去
    cancelEnrichWatchRetries()
    state.bangumiSheet = null
  }
}

// ========== 源数据预览 ==========

/**
 * 数据预览的「一栏一行」列顺序：按已映射字段渲染，避免 50 列全部挤压成文本流
 */
const PREVIEW_FIELD_COLS: { key: ScalarMappingKey; label: string }[] = [
  { key: 'nameCol', label: '名称' },
  { key: 'weekdayCol', label: '周更时间' },
  { key: 'premiereCol', label: '首播' },
  { key: 'episodesCol', label: '集数' },
  { key: 'platformCol', label: '播放平台' },
  { key: 'exclusiveCol', label: '独播' },
  { key: 'specialCol', label: '特殊/备注' },
  { key: 'tagsCol', label: 'TAGS/标签' },
]

/**
 * 简介（2026年4月新番简介）字段在预览/匹配结果中的展示顺序与标签。
 * 仅展示简介表映射命中的列；目标列名与源列名不同（编剧→脚本等）由富化引擎处理。
 */
const INTRO_PREVIEW_FIELDS: { key: ScalarMappingKey; label: string }[] = [
  { key: 'directorCol', label: '导演' },
  { key: 'screenplayCol', label: '编剧' },
  { key: 'characterDesignCol', label: '人设' },
  { key: 'cgDirectorCol', label: 'CG导演' },
  { key: 'musicCol', label: '音乐' },
  { key: 'studioCol', label: '动画制作' },
  { key: 'seriesCompositionCol', label: '系列构成' },
  { key: 'storyboardCol', label: '分镜' },
  { key: 'originalWorkCol', label: '原作' },
]

// ========== 简介工作表关联 ==========

/**
 * 发现并缓存与当前源表关联的「新番简介」工作表：
 * 1. 源工作簿内查找（表头命中 ≥2 个简介关键字且非主新番表布局）；
 * 2. 兜底：其他已打开工作簿（如单独的「2026年4月新番简介」工作簿）。
 * 找不到时清空缓存（源表切换后旧简介表失效）。
 */
function discoverIntroContext(): void {
  state.introContext = null
  const sourceName = state.animeSourceSheet?.Name ?? ''
  const sourceWb =
    state.sourceWorkbook ??
    (state.animeSourceSheet as unknown as { Parent?: WpsWorkbook } | null)?.Parent ??
    null

  if (sourceWb) {
    const sheet = findIntroSheetInWorkbook(sourceWb, sourceName)
    if (sheet) {
      state.introContext = buildIntroSheetContext(sheet)
      if (state.introContext) return
    }
  }

  for (const wb of getOpenWorkbooks()) {
    const name = (() => {
      try {
        return wb.Name
      } catch {
        return ''
      }
    })()
    if (sourceWb?.Name === name) {
      // 源工作簿已在上方优先查找，跳过
    } else {
      const sheet = findIntroSheetInWorkbook(wb, sourceName)
      if (sheet) {
        state.introContext = buildIntroSheetContext(sheet)
        if (state.introContext) {
          bgmLog(LOG_LEVELS.INFO, `[enrich] 在工作簿 ${name} 中找到关联简介表`)
          return
        }
      }
    }
  }
}

// ========== 多新番表工作簿切换（yy年m月按钮） ==========

/** 收集可切换的新番表工作簿（当前源表优先，其次全部自动识别命中的已打开工作簿） */
function collectWorkbookTabs(): WpsWorkbook[] {
  const seen = new Set<string>()
  const items: WpsWorkbook[] = []
  const push = (wb: WpsWorkbook): void => {
    try {
      const name = wb.Name
      if (name && !seen.has(name)) {
        seen.add(name)
        items.push(wb)
      }
    } catch {
      // 工作簿切换中，跳过
    }
  }
  if (state.sourceWorkbook) push(state.sourceWorkbook)
  for (const wb of scanMatchingWorkbooks(ANIME_SOURCE_DETECTOR)) push(wb)
  return items
}

/** 当前活动源工作簿名（无则空串） */
function activeWorkbookName(): string {
  return state.animeSourceSheet
    ? (state.sourceWorkbook?.Name ??
        (state.animeSourceSheet as unknown as { Parent?: WpsWorkbook } | null)?.Parent?.Name ??
        '')
    : ''
}

/** 渲染「26年4月」式切换按钮条；仅一个候选时隐藏 */
function renderWorkbookTabs(): void {
  const container = safeGetElement('workbookTabs')
  if (!container) return

  const items = collectWorkbookTabs()
  if (items.length <= 1) {
    container.style.display = 'none'
    container.replaceChildren()
    return
  }

  container.style.display = ''
  container.replaceChildren()
  const activeName = activeWorkbookName()
  for (const wb of items) {
    const button = document.createElement('button')
    button.type = 'button'
    const name = (() => {
      try {
        return wb.Name
      } catch {
        return ''
      }
    })()
    button.className = `workbook-tab${name === activeName ? ' active' : ''}`
    button.textContent = monthLabelFromWorkbookName(name)
    button.title = name
    button.addEventListener('click', () => {
      if (name !== activeName) switchSourceWorkbook(wb)
    })
    container.appendChild(button)
  }
}

/** 切换源工作簿：识别新番表布局并刷新预览与匹配结果 */
function switchSourceWorkbook(wb: WpsWorkbook): void {
  const sheet = findAnimeSourceSheetInWorkbook(wb)
  if (!sheet) {
    BGM.Dialog.alert('提示', `工作簿「${wb.Name}」中未识别到新番表布局`)
    return
  }

  // 释放旧源工作簿（仅回收本插件自动打开的；closeOpenedSourceWorkbook 会清空源表状态）
  if (state.sourceWorkbook && state.isSourceWorkbookOpenedByUs) {
    try {
      if (state.sourceWorkbook.Name !== wb.Name) closeOpenedSourceWorkbook()
    } catch {
      // 旧工作簿已关闭
    }
  }

  state.filePath = (() => {
    try {
      return wb.FullName
    } catch {
      return state.filePath
    }
  })()

  const mapping = detectHeaderOnSheet(sheet, wb.Name)
  if (!mapping) return

  state.sourceWorkbook = wb
  state.isSourceWorkbookOpenedByUs = false

  renderWorkbookTabs()
  // 切换后自动刷新匹配结果（无需再点「预览匹配」）
  if (state.bangumiSheet) previewMatch()
}

/** 匹配结果对比表格：新番表源侧展示的字段（名称列单独展示） */
const SOURCE_CMP_FIELDS: { key: ScalarMappingKey; label: string }[] = [
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

// 着色工具（TAGS / 首播 / 平台按内容稳定配色）已抽至 ./enrich-preview-cell.ts（renderPreviewCell / renderPlatformChipsCell）

function renderSourcePreview(ws: WpsWorksheet, mapping: EnrichColumnMapping): void {
  const tableContainer = safeGetElement('sourceTable')
  if (!tableContainer) return
  // 预览配置按页加载缓存（避免逐单元格读 PluginStorage）。此处是「每次预览只跑一次」
  // 的入口，重读一次配置即可让设置页的改动在本页立即生效，无需重开富化页。
  resetEnrichPreviewConfig()

  const { dataStartRow } = state

  // 只取已映射的字段列，形成「一栏一行」的简洁预览。
  // 平台列聚合：有播放平台列时独播列并入「播放平台」一栏展示（F/G/H/I/J 聚合去重）。
  const hasPlatformCol = (mapping.platformCol ?? 0) > 0
  const fieldCols = PREVIEW_FIELD_COLS.filter(
    (f) => (mapping[f.key] ?? 0) > 0 && (f.key !== 'exclusiveCol' || !hasPlatformCol),
  )
  // 简介表字段列（关联到「新番简介」工作表时展示）
  const introSheet = state.introContext?.sheet ?? null
  const introFields = state.introContext
    ? INTRO_PREVIEW_FIELDS.filter((f) => (state.introContext?.mapping[f.key] ?? 0) > 0)
    : []
  if (fieldCols.length === 0) {
    const emptyThead = tableContainer.querySelector('thead')
    if (emptyThead) emptyThead.replaceChildren()
    const emptyTbody = tableContainer.querySelector('tbody')
    if (emptyTbody) emptyTbody.replaceChildren()
    state.hasSourcePreview = false
    const hintElement = safeGetElement('sourcePreviewHint')
    if (hintElement) {
      hintElement.textContent = '尚未识别到映射列，请先在「新番表文件」中识别表头'
      hintElement.style.display = ''
    }
    // 源表不可用：旧的匹配结果已失效
    resetMatchResults()
    return
  }

  state.hasSourcePreview = true

  const thead = tableContainer.querySelector('thead')
  if (thead) {
    thead.innerHTML = sanitizeTableRows(
      `<tr><th></th>${fieldCols.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('')}${introFields
        .map((f) => `<th class="col-intro">${escapeHtml(f.label)}</th>`)
        .join('')}</tr>`,
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

    // 简介表按名称关联本行（无关联行时简介列留空）
    const introRow = state.introContext
      ? state.introContext.nameIndex.get(
          normalizeName(getCellValue(ws, row, mapping.nameCol).trim()),
        )
      : undefined

    for (const f of fieldCols) {
      if (hasPlatformCol && f.key === 'platformCol') {
        // 播放平台聚合展示：platformCol + platformExtraCols + exclusiveCol 去重
        const platforms = readPlatformValues(ws, row, mapping)
        if (platforms.length > 0) hasData = true
        rowCells.push(renderPlatformChipsCell(platforms))
      } else {
        const col = mapping[f.key] ?? 0
        const value = getCellValue(ws, row, col)
        if (value.trim()) hasData = true
        rowCells.push(renderPreviewCell(f.key, value))
      }
    }
    for (const f of introFields) {
      const col = state.introContext?.mapping[f.key] ?? 0
      const value = introRow !== undefined && col > 0 ? getCellValue(introSheet, introRow, col) : ''
      if (value.trim()) hasData = true
      rowCells.push(
        `<td class="col-intro" title="${escapeHtml(value.trim())}">${escapeHtml(value.trim())}</td>`,
      )
    }
    if (hasData) {
      rowsHtml.push(
        `<tr data-row="${String(row)}"><td class="row-num">${String(row)}</td>${rowCells.join('')}</tr>`,
      )
    }
  }

  tbody.innerHTML = sanitizeTableRows(rowsHtml.join(''))

  // 预览提示：仅展示前 maxRows 行
  const hintElement = safeGetElement('sourcePreviewHint')
  if (hintElement) {
    hintElement.textContent =
      rowsHtml.length >= maxRows
        ? `仅显示前 ${String(maxRows)} 行，可点击「查看详细数据表格」查看完整数据`
        : ''
  }

  // 「查看详细数据表格」按钮与提示的显示由 applyPreviewTabVisibility 统一控制
  applyPreviewTabVisibility()

  bgmLog(LOG_LEVELS.INFO, `[enrich] 源数据预览已渲染: ${String(rowsHtml.length)} 行`)
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
    refreshMatchHintText()
    // 预览完成后确保停留在「匹配结果」页签并展示统计/表格
    setPreviewTab('match')

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
}

/**
 * 刷新匹配结果页签的提示文案（只写文案，显示与否由 applyPreviewTabVisibility 决定）。
 *
 * 三种状态：
 *   1. 尚未预览：给出「点击预览匹配」的引导，避免页签空白；
 *   2. 目标表为空且有未匹配条目：提示富化时将新增行数；
 *   3. 其余：清空文案（自动隐藏）。
 */
function refreshMatchHintText(): void {
  const hintElement = safeGetElement('matchEmptyHint')
  if (!hintElement) return

  if (state.matches.length === 0) {
    hintElement.textContent = state.bangumiSheet
      ? '尚未预览匹配，点击「预览匹配」查看新番表与目标表的匹配结果'
      : '请先选择目标 Bangumi 工作表，再点击「预览匹配」'
    return
  }

  const pendingCount = state.matches.filter((m) => m.matchType === 'unmatched').length
  hintElement.textContent =
    state.bangumiSheet && isBangumiSheetEmpty(state.bangumiSheet) && pendingCount > 0
      ? `目标表暂无数据，富化时将新增 ${String(pendingCount)} 行`
      : ''
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

/** 读取新番表源行的对比字段（按列映射读取已识别列；平台聚合 + 关联简介表字段） */
function buildSourceCmpTags(sourceSheet: WpsWorksheet | null, match: MatchResult): string {
  const mapping = state.columnMapping
  if (!sourceSheet || !mapping) return renderCmpTags([])
  const items: { label: string; value: string }[] = []
  const hasPlatformCol = (mapping.platformCol ?? 0) > 0
  for (const field of SOURCE_CMP_FIELDS) {
    // 平台聚合时独播已并入平台项，不重复展示
    const isMergedExclusive = hasPlatformCol && field.key === 'exclusiveCol'
    if (!isMergedExclusive) {
      const col = mapping[field.key] ?? 0
      if (col > 0) {
        const value =
          hasPlatformCol && field.key === 'platformCol'
            ? readPlatformValues(sourceSheet, match.animeRow, mapping).join(' | ')
            : getCellValue(sourceSheet, match.animeRow, col).trim()
        if (value) items.push({ label: field.label, value })
      }
    }
  }

  // 关联简介表：按名称读取导演/编剧/人设等字段
  const intro = state.introContext
  if (intro) {
    const introRow = intro.nameIndex.get(normalizeName(match.matchedAnimeName))
    if (introRow !== undefined) {
      for (const field of INTRO_PREVIEW_FIELDS) {
        const col = intro.mapping[field.key] ?? 0
        if (col > 0) {
          const value = getCellValue(intro.sheet, introRow, col).trim()
          if (value) items.push({ label: field.label, value })
        }
      }
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

/**
 * 渲染匹配结果对比表格：源数据 / 匹配方式 / 目标数据 三栏对照
 * 表头增加「📋 查看所有详情」按钮，点击打开全部匹配的汇总弹窗（不用逐个点 🔍 详情）
 */
function renderMatchResultsToTable(matches: MatchResult[]): void {
  const tbodyElement = safeGetElement('matchTable')?.querySelector('tbody')
  if (!tbodyElement) return
  // 同 renderSourcePreview：每次匹配预览重读一次富化预览配置
  resetEnrichPreviewConfig()

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

  tbodyElement.innerHTML = sanitizeTableRows(rowsHtml.join(''))

  // 绑定每行详情按钮（行内按钮由预览刷新时重建，需按次绑定；
  // 闭包按索引取值，避免依赖会被 sanitize 剥离的 data-* 属性）
  const detailButtons = tbodyElement.querySelectorAll<HTMLButtonElement>('.match-detail-btn')
  detailButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      const match = matches[index]
      if (match) showMatchDetail(match)
    })
  })

  // 「📋 查看所有详情」按钮同步写入表头（避免内联按钮跟随 tbody 重建）
  injectAllMatchesDetailButton(matches)
  // 表格的显示由 applyPreviewTabVisibility 统一控制（未预览 / 非匹配页签时保持隐藏）
}

/** 把「📋 查看所有详情」按钮塞进 matchTable 的表头（th 详情列）。只在表头尚未注入时写入。 */
function injectAllMatchesDetailButton(matches: MatchResult[]): void {
  const table = safeGetElement('matchTable')
  if (!table) return
  const thead = table.querySelector(':scope > thead > tr')
  if (!thead) return
  let detailTh = thead.querySelector<HTMLElement>(':scope > th.all-detail-cell')
  if (detailTh) {
    // 已有按钮则跳过
    if (detailTh.querySelector('button')) return
  } else {
    // 最后一列（详情）表头加一个全详情按钮
    detailTh = document.createElement('th')
    detailTh.className = 'all-detail-cell'
    detailTh.textContent = '详情'
    thead.appendChild(detailTh)
  }
  const cell = detailTh
  cell.replaceChildren()
  const button = document.createElement('button')
  button.className = 'bgm-btn small primary'
  button.type = 'button'
  button.textContent = `📋 查看全部 (${String(matches.length)})`
  button.addEventListener('click', () => {
    showAllMatchesDetail(matches)
  })
  cell.appendChild(button)
}

/** 渲染全部匹配汇总（按匹配方式分组），用于一屏看清所有匹配项 */
function showAllMatchesDetail(matches: MatchResult[]): void {
  const modalElement = safeGetElement('matchDetailModal')
  const bodyElement = safeGetElement('matchDetailBody')
  if (!modalElement || !bodyElement) return
  if (matches.length === 0) {
    bodyElement.innerHTML = sanitizeHtml('<p class="hint">暂无匹配结果</p>')
    modalElement.style.display = 'flex'
    return
  }
  const groups: Record<string, MatchResult[]> = {
    exact: [],
    alias: [],
    unmatched: [],
    error: [],
  }
  for (const m of matches) {
    const bucket = groups[m.matchType] ?? groups.unmatched
    if (bucket) bucket.push(m)
  }
  const groupHtml: string[] = []
  const labels: [keyof typeof groups, string, string][] = [
    ['exact', '✅ 精确匹配', 'status-exact'],
    ['alias', '🔄 别名匹配', 'status-alias'],
    ['error', '⚠️ 错误', 'status-error'],
    ['unmatched', '❌ 未匹配', 'status-unmatched'],
  ]
  for (const label of labels) {
    const [key, title, cls] = label
    const items = groups[key]
    if (items && items.length > 0) {
      const listHtml = items
        .map((m, index) => {
          const bangumi = m.bangumiRow === undefined ? '—' : `目标行 ${String(m.bangumiRow)}`
          const bangumiName = m.bangumiName ? ` · ${escapeHtml(m.bangumiName)}` : ''
          const error = m.errorMessage
            ? `<div class="match-detail-error">${escapeHtml(m.errorMessage)}</div>`
            : ''
          const index_ = matches.indexOf(m)
          return `
            <div class="match-all-item">
              <span class="match-all-idx">#${String(index + 1)}</span>
              <span class="match-all-name">${escapeHtml(m.matchedAnimeName)}</span>
              <span class="match-all-meta">源表行 ${String(m.animeRow)} → ${bangumi}${bangumiName}</span>
              <button class="bgm-btn xsmall match-all-jump" data-match-index="${String(index_)}">🔍</button>
              ${error}
            </div>
          `
        })
        .join('')
      groupHtml.push(`
        <div class="match-all-group">
          <div class="match-all-title"><span class="match-status ${cls}">${title}</span> <span class="match-all-count">${String(items.length)} 条</span></div>
          <div class="match-all-list">${listHtml}</div>
        </div>
      `)
    }
  }
  bodyElement.innerHTML = sanitizeHtml(groupHtml.join(''))
  // 绑定每项「🔍」按钮：跳到该条的单条详情弹窗
  bodyElement.querySelectorAll<HTMLButtonElement>('.match-all-jump').forEach((button) => {
    button.addEventListener('click', () => {
      const indexAttribute = button.dataset.matchIndex
      if (!indexAttribute) return
      const index = Number(indexAttribute)
      const m = matches[index]
      if (m) showMatchDetail(m)
    })
  })
  modalElement.style.display = 'flex'
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

  // 详情弹窗额外展示源/目标对比字段（与内联表格同源数据），方便用户在不滚动小表格的情况下看清
  const sourceSheet = state.animeSourceSheet
  const targetSheet = state.bangumiSheet
  const targetHeaderRow = targetSheet ? findHeaderRow(targetSheet) : 0
  const targetColMap =
    targetSheet && targetHeaderRow > 0 ? getColumnMap(targetSheet, targetHeaderRow) : null
  if (sourceSheet && state.columnMapping) {
    items.push({
      label: '源表对比字段',
      valueHtml: buildSourceCmpTags(sourceSheet, match),
    })
  }
  if (targetSheet && targetColMap && match.bangumiRow !== undefined) {
    items.push({
      label: '目标表对比字段',
      valueHtml: buildTargetCmpTags(targetSheet, targetColMap, match),
    })
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

  try {
    bgmLog(LOG_LEVELS.INFO, `[enrich] 开始富化，共 ${String(state.matches.length)} 条匹配`)

    const results = enrichEntries(
      animeSourceSheet,
      state.bangumiSheet,
      state.matches,
      config,
      updateProgressUI,
      state.introContext ?? undefined,
      isEnrichCancelled,
    )

    const wasCancelled = isEnrichCancelled()
    showProgressUI(false)

    // 保存本次富化详细条目并显示「查看详细结果」按钮（有无冲突均可查看）
    state.enrichDetailGroups = [{ fileName: extractFileName(state.filePath), items: results }]
    showEnrichDetailButton()

    const allConflicts = collectAllConflicts(results)
    if (wasCancelled) {
      // 用户主动停止：不再弹出冲突确认（避免在"停止"之后继续要求交互），只给摘要
      bgmLog(
        LOG_LEVELS.WARN,
        `[enrich] 已按用户请求停止，保留 ${String(results.length)} 条已完成结果`,
      )
      showToast(`已停止富化，保留已完成（含未解决冲突）的部分结果`, 'warning')
      renderEnrichSummary(results)
    } else if (allConflicts.length > 0) {
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

/** 单文件富化进度实例 */
let enrichProgressCtrl: ProgressController | null = null
/** 批量富化进度实例 */
let batchProgressCtrl: ProgressController | null = null
/** 冲突解决进度实例 */
let conflictProgressCtrl: ProgressController | null = null

/**
 * 创建内嵌（inline）进度实例。
 * 走 `createProgress` 而非全局单例 `showProgress`，使三处进度各自独立、互不干扰。
 * @param hostId 宿主容器 ID（由页面静态模板提供）
 * @param title 标题（inline 模式默认不渲染标题栏，仅作语义信息）
 * @param icon 图标
 * @param onStop 提供时渲染「停止」按钮并接管点击
 */
function createInlineProgress(
  hostId: string,
  title: string,
  icon: string,
  onStop?: () => void,
): ProgressController | null {
  const options: ProgressShowOptions = { mode: 'inline', hostId, title, icon }
  if (onStop !== undefined) {
    options.enableStop = true
    options.onStop = onStop
  }
  return createProgress(options)
}

/**
 * 富化是否已被用户请求取消。
 * 经函数读取是刻意的：直接读 `state.cancelRequested` 会被 TS 的控制流分析收窄为
 * `false` 字面量（`state` 初始化时该字段为 false 且中间赋值发生在别的函数里），
 * 从而把 `if (wasCancelled)` 判成恒假。
 */
function isEnrichCancelled(): boolean {
  return state.cancelRequested
}

/**
 * 请求取消当前富化。
 * 仅置位标记，真正停止由 `enrichEntries` 在条目循环边界检查后返回；已写入的部分保留（不回滚）。
 */
function cancelEnrichment(): void {
  if (!state.isEnriching) return
  state.cancelRequested = true
  bgmLog(LOG_LEVELS.WARN, '[enrich] 用户请求取消富化，将在当前条目处理完成后停止')
}

function showProgressUI(isVisible: boolean): void {
  const progressArea = safeGetElement('enrichProgress')

  if (isVisible) {
    enrichProgressCtrl = createInlineProgress(
      'enrichProgressHost',
      '富化进度',
      '✨',
      cancelEnrichment,
    )
    if (progressArea) progressArea.style.display = ''
  } else {
    enrichProgressCtrl?.hide()
    enrichProgressCtrl = null
    if (progressArea) progressArea.style.display = 'none'
  }

  const startButton = safeGetButton('startEnrichBtn')
  if (startButton) {
    // 富化结束恢复时也要尊重"仅 N===1 可用"的约束（N>=2 走批量富化）
    startButton.disabled = isVisible || state.batchFiles.length !== 1
    startButton.textContent = isVisible ? '⏳️ 富化中...' : '🚀 开始富化'
  }
}

function updateProgressUI(progress: EnrichProgress): void {
  // 百分比、当前条目与 ETA 统一由通用进度组件渲染（页面只维护富化专有统计）
  enrichProgressCtrl?.update(progress.current, progress.total, progress.currentName || '-')

  const enrichedElement = safeGetElement('enrichedCount')
  if (enrichedElement) enrichedElement.textContent = String(progress.stats.enriched)

  const skippedElement = safeGetElement('skippedCount')
  if (skippedElement) skippedElement.textContent = String(progress.stats.skipped)

  const failedElement = safeGetElement('failedCount')
  if (failedElement) failedElement.textContent = String(progress.stats.failed)
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

  // 静态模板只更新文本值，避免运行时拼接 HTML
  const titleElement = safeGetElement('conflictTitle')
  if (titleElement)
    titleElement.textContent = `⚡️ 字段冲突确认 (${String(current)}/${String(total)})`

  // 冲突进度：本函数每个冲突都会调用一次，故实例首次创建后复用
  conflictProgressCtrl ??= createInlineProgress('conflictProgressHost', '冲突进度', '⚡️')
  conflictProgressCtrl?.update(current, total)

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
  conflictProgressCtrl?.hide()
  conflictProgressCtrl = null
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

  if (isVisible) {
    // 「停止」按钮把此前不可达的批量取消路径接上（state.batchCancelRequested 原先无人置位）
    batchProgressCtrl = createInlineProgress('batchProgressHost', '批量富化进度', '📦', () => {
      state.batchCancelRequested = true
      bgmLog(LOG_LEVELS.WARN, '[enrich-batch] 用户请求取消批量富化，将在当前文件处理完成后停止')
    })
    if (progressElement) progressElement.style.display = ''
  } else {
    batchProgressCtrl?.hide()
    batchProgressCtrl = null
    if (progressElement) progressElement.style.display = 'none'
  }
}

/** 更新批量进度条（百分比与计数由通用进度组件渲染） */
function updateBatchProgressUI(current: number, total: number, currentFileName: string): void {
  batchProgressCtrl?.update(current, total, extractFileName(currentFileName))
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

  // 批量模式同样关联简介工作表：在源工作簿内查找
  const parentWb = (ws as unknown as { Parent?: WpsWorkbook } | null)?.Parent ?? null
  const introSheet = parentWb ? findIntroSheetInWorkbook(parentWb, ws.Name) : null
  const introContext = introSheet ? buildIntroSheetContext(introSheet) : undefined

  const enrichResults = enrichEntries(
    ws,
    bangumiSheet,
    matches,
    config,
    () => {
      /* 批量模式不回调进度（已由外层控制） */
    },
    introContext ?? undefined,
  )
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
    // 取消在文件边界生效：当前文件已处理完的部分保留（统一在循环后提示）
    if (state.batchCancelRequested) break

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

  if (state.batchCancelRequested) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[enrich-batch] 已按用户请求停止：完成 ${String(state.batchResults.length)}/${String(total)} 个文件`,
    )
    showToast(
      `已停止批量富化，完成 ${String(state.batchResults.length)}/${String(total)} 个文件`,
      'warning',
    )
  }

  // 恢复 UI
  showBatchProgress(false)
  const startButton = safeGetButton('batchStartBtn')
  if (startButton) startButton.disabled = false

  // 全部文件富化完成后统一执行一次合并去重（避免逐文件清洗时行号漂移）
  maybeAutoCleanAfterEnrich()

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

export { state } from './enrich-page-context.js'
export { cancelEnrichment }
export { openEnrichRecordSheet, clearRecords } from './enrich-record-view.js'
