// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/enrich-page.ts`（富化页主控制器）单元测试。
 *
 * 该文件是「依赖一堆兄弟模块」的编排层，但所有兄弟依赖都收敛为可 mock 的
 * 单一函数；`enrich-page-context`（state 单例 + safeGet* 取元素）与
 * `enrich-file-name`（纯函数）使用真实现。断言的是真实 DOM 绑定路由、
 * 真实 state 变迁、真实批量结果聚合，而非 mock 行为本身。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WpsWorksheet, WpsWorkbook } from '../ts/index.js'

// ========== 假宿主形状 ==========

interface FakeDialog {
  AllowMultiSelect: boolean
  Title: string
  Filters: {
    Clear: () => void
    Add: (description: string, extensions: string, position?: number) => void
  }
  Show: () => number
  SelectedItems: { Count: number; Item: (index: number) => string }
}

const sheetState = vi.hoisted(() => ({
  isLocked: false,
  lockedIndex: null as number | null,
  lockedName: null as string | null,
  lockedWorkbookName: null as string | null,
}))

const m = vi.hoisted(() => ({
  handleError: vi.fn(),
  dialogAlert: vi.fn(),
  dialogError: vi.fn(),
  /** 默认同步回调 true；各用例可用 mockImplementation 覆写 */
  dialogConfirm: vi.fn((_message: string, callback: (isOk: boolean) => void, _title?: string) => {
    callback(true)
  }),
  getApp: vi.fn((): unknown => null),
  bgmLog: vi.fn(),
  findHeaderRow: vi.fn(() => 0),
  showToast: vi.fn(),
  // enrich-engine
  detectColumns: vi.fn(),
  detectAnimeSourceLayout: vi.fn(),
  matchEntries: vi.fn(),
  enrichEntries: vi.fn(),
  findIntroSheetInWorkbook: vi.fn(),
  buildIntroSheetContext: vi.fn(),
  // enrich-lock
  refreshEnrichWorkbooks: vi.fn(),
  refreshEnrichSheets: vi.fn(),
  toggleEnrichWorkbookLock: vi.fn(),
  updateEnrichLockButton: vi.fn(),
  getLockedEnrichSheet: vi.fn(),
  initializeEnrichLock: vi.fn(),
  autoSelectEnrichTarget: vi.fn(() => 'none'),
  // enrich-record
  getOrCreateEnrichRecordSheet: vi.fn(),
  // workbook-auto-detect
  collectDetectedWorkbookPaths: vi.fn(),
  describeOpenWorkbooks: vi.fn(() => ''),
  mergeDetectedPathsIntoStorage: vi.fn(),
  // locked-sheet
  findWorkbookByName: vi.fn(),
  // shell-nav
  recomputeScrollspy: vi.fn(),
  // enrich-source-workbook
  openSourceWorkbook: vi.fn(),
  closeWorkbook: vi.fn(),
  closeOpenedSourceWorkbook: vi.fn(),
  closeSourceWorkbookOnly: vi.fn(),
  ensureSourceSheet: vi.fn(),
  // enrich-source-detail / result-view / record-view
  showSourceDetail: vi.fn(),
  hideSourceDetail: vi.fn(),
  maybeAutoCleanAfterEnrich: vi.fn(),
  showEnrichDetailButton: vi.fn(),
  showEnrichDetail: vi.fn(),
  hideEnrichDetail: vi.fn(),
  openEnrichRecordSheet: vi.fn(),
  clearRecords: vi.fn(),
  loadRecentRecords: vi.fn(),
  // enrich-progress-hosts
  createInlineProgress: vi.fn(),
  // enrich-conflict-dialog
  collectAllConflicts: vi.fn(),
  bindConflictDialogButtons: vi.fn(),
  showConflictDialog: vi.fn(),
  // enrich-preview-flow
  detectHeaderOnSheet: vi.fn(),
  previewMatch: vi.fn(),
  hideMatchDetail: vi.fn(),
  // enrich-preview-tab
  setPreviewTab: vi.fn(),
  applyPreviewTabVisibility: vi.fn(),
  resetMatchResults: vi.fn(),
  refreshMatchHintText: vi.fn(),
}))

vi.mock('../ts/tools/util/index.js', async () => {
  const constants = await import('../ts/core/constants.js')
  return {
    LOG_LEVELS: constants.LOG_LEVELS,
    findHeaderRow: m.findHeaderRow,
    bgmLog: m.bgmLog,
    BGM: {
      sheet: sheetState,
      ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
      handleError: m.handleError,
      Dialog: { alert: m.dialogAlert, confirm: m.dialogConfirm, error: m.dialogError },
    },
    getApp: m.getApp,
  }
})
vi.mock('../ts/tools/sanitize.js', () => ({ sanitizeHtml: (html: string) => html }))
vi.mock('../ts/ui/dialog.js', () => ({ showToast: m.showToast }))
vi.mock('../ts/tools/locked-sheet.js', () => ({ findWorkbookByName: m.findWorkbookByName }))
vi.mock('../ts/sync/enrich-layout.js', () => ({
  detectColumns: m.detectColumns,
  detectAnimeSourceLayout: m.detectAnimeSourceLayout,
}))
vi.mock('../ts/sync/enrich-matching.js', () => ({
  matchEntries: m.matchEntries,
}))
vi.mock('../ts/sync/enrich-intro.js', () => ({
  findIntroSheetInWorkbook: m.findIntroSheetInWorkbook,
  buildIntroSheetContext: m.buildIntroSheetContext,
}))
vi.mock('../ts/sync/enrich-engine.js', () => ({
  enrichEntries: m.enrichEntries,
}))
vi.mock('../ts/sync/enrich-lock.js', () => ({
  refreshEnrichWorkbooks: m.refreshEnrichWorkbooks,
  refreshEnrichSheets: m.refreshEnrichSheets,
  toggleEnrichWorkbookLock: m.toggleEnrichWorkbookLock,
  updateEnrichLockButton: m.updateEnrichLockButton,
  getLockedEnrichSheet: m.getLockedEnrichSheet,
  initializeEnrichLock: m.initializeEnrichLock,
  autoSelectEnrichTarget: m.autoSelectEnrichTarget,
}))
vi.mock('../ts/sync/enrich-record.js', () => ({
  getOrCreateEnrichRecordSheet: m.getOrCreateEnrichRecordSheet,
}))
vi.mock('../ts/sync/workbook-auto-detect.js', () => ({
  ANIME_SOURCE_DETECTOR: { name: 'anime' },
  BANGUMI_TARGET_DETECTOR: { name: 'bangumi' },
  collectDetectedWorkbookPaths: m.collectDetectedWorkbookPaths,
  describeOpenWorkbooks: m.describeOpenWorkbooks,
  mergeDetectedPathsIntoStorage: m.mergeDetectedPathsIntoStorage,
}))
vi.mock('../ts/panel/shell-nav.js', () => ({ recomputeScrollspy: m.recomputeScrollspy }))
vi.mock('../ts/panel/enrich-source-workbook.js', () => ({
  openSourceWorkbook: m.openSourceWorkbook,
  closeWorkbook: m.closeWorkbook,
  closeOpenedSourceWorkbook: m.closeOpenedSourceWorkbook,
  closeSourceWorkbookOnly: m.closeSourceWorkbookOnly,
  ensureSourceSheet: m.ensureSourceSheet,
}))
vi.mock('../ts/panel/enrich-source-detail.js', () => ({
  showSourceDetail: m.showSourceDetail,
  hideSourceDetail: m.hideSourceDetail,
}))
vi.mock('../ts/panel/enrich-result-view.js', () => ({
  maybeAutoCleanAfterEnrich: m.maybeAutoCleanAfterEnrich,
  showEnrichDetailButton: m.showEnrichDetailButton,
  showEnrichDetail: m.showEnrichDetail,
  hideEnrichDetail: m.hideEnrichDetail,
}))
vi.mock('../ts/panel/enrich-record-view.js', () => ({
  openEnrichRecordSheet: m.openEnrichRecordSheet,
  clearRecords: m.clearRecords,
  loadRecentRecords: m.loadRecentRecords,
}))
vi.mock('../ts/panel/enrich-progress-hosts.js', () => ({
  progressHosts: { enrich: null, batch: null },
  createInlineProgress: m.createInlineProgress,
}))
vi.mock('../ts/panel/enrich-conflict-dialog.js', () => ({
  collectAllConflicts: m.collectAllConflicts,
  bindConflictDialogButtons: m.bindConflictDialogButtons,
  showConflictDialog: m.showConflictDialog,
}))
vi.mock('../ts/panel/enrich-preview-flow.js', () => ({
  detectHeaderOnSheet: m.detectHeaderOnSheet,
  previewMatch: m.previewMatch,
  hideMatchDetail: m.hideMatchDetail,
}))
vi.mock('../ts/panel/enrich-preview-tab.js', () => ({
  setPreviewTab: m.setPreviewTab,
  applyPreviewTabVisibility: m.applyPreviewTabVisibility,
  resetMatchResults: m.resetMatchResults,
  refreshMatchHintText: m.refreshMatchHintText,
}))

import { progressHosts } from '../ts/panel/enrich-progress-hosts.js'
import { state } from '../ts/panel/enrich-page-context.js'
import {
  autoDetectHeader,
  batchSelectFiles,
  batchStartEnrichment,
  initializeEnrichPage,
  selectNewAnimeFile,
  startEnrichment,
} from '../ts/panel/enrich-page.js'

// ========== helpers（模块级：unicorn/consistent-function-scoping） ==========

function mountButton(id: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.id = id
  document.body.append(button)
  return button
}

function mountDiv(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.id = id
  document.body.append(element)
  return element
}

function mountInput(id: string, type: string): HTMLInputElement {
  const element = document.createElement('input')
  element.id = id
  element.type = type
  document.body.append(element)
  return element
}

/** 带选项的下拉框（jsdom：select.value 只有存在匹配 option 才能落住） */
function mountSelect(id: string, optionValues: string[]): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  for (const value of optionValues) {
    const option = document.createElement('option')
    option.value = value
    option.text = `表${value}`
    select.append(option)
  }
  document.body.append(select)
  return select
}

function makeWorksheet(name: string): WpsWorksheet {
  return { Name: name } as unknown as WpsWorksheet
}

/** 批量挂载富化页全部控件（initializeEnrichPage 的绑定面） */
function mountEnrichControls(): void {
  for (const id of [
    'selectFileBtn',
    'detectHeaderBtn',
    'lockSheetBtn',
    'startEnrichBtn',
    'viewEnrichDetailBtn',
    'enrichDetailCloseBtn',
    'enrichDetailDoneBtn',
    'previewMatchBtn',
    'viewSourceDetailBtn',
    'sourceDetailCloseBtn',
    'sourceDetailDoneBtn',
    'matchDetailCloseBtn',
    'matchDetailDoneBtn',
    'batchStartBtn',
    'batchClearBtn',
  ]) {
    mountButton(id)
  }
  mountSelect('workbookSelect', ['BGM.xlsx'])
  mountSelect('sheetSelect', ['1', '2'])
  mountInput('closeSourceAfterDetectChk', 'checkbox')
  for (const id of [
    'filePathDisplay',
    'batchFileList',
    'batchProgress',
    'batchSummary',
    'batchSummaryContent',
    'autoDetectNotice',
    'sec-file',
    'enrichProgress',
    'enrichProgressHost',
    'batchProgressHost',
    'enrichedCount',
    'skippedCount',
    'failedCount',
  ]) {
    mountDiv(id)
  }
  for (const action of ['refreshSheets', 'openRecordSheet', 'clearRecords']) {
    const button = mountButton(`data-action-${action}`)
    button.dataset.action = action
  }
  for (const tab of ['source', 'match']) {
    const element = document.createElement('div')
    element.className = 'preview-tab'
    element.dataset.tab = tab
    document.body.append(element)
  }
}

/** 把 state 单例重置为初始形状（数组换新引用，避免用例间串扰） */
function resetState(): void {
  state.filePath = ''
  state.animeSourceSheet = null
  state.bangumiSheet = null
  state.columnMapping = null
  state.headerRow = 0
  state.dataStartRow = 0
  state.matches = []
  state.activePreviewTab = 'source'
  state.hasSourcePreview = false
  state.isEnriching = false
  state.cancelRequested = false
  state.pendingConflicts = []
  state.currentConflictIndex = 0
  state.batchFiles = []
  state.batchResults = []
  state.batchIndex = 0
  state.isBatchEnriching = false
  state.batchCancelRequested = false
  state.enrichDetailGroups = []
  state.sourceWorkbook = null
  state.isSourceWorkbookOpenedByUs = false
  state.introContext = null
  state.closeSourceAfterDetect = false
}

/** 默认宿主：Workbooks/ActiveWorkbook 均可被个别用例覆写 */
function stubApp(app: unknown): void {
  m.getApp.mockReturnValue(app)
}

function click(element: Element): void {
  element.dispatchEvent(new Event('click'))
}

/** 造一个假的 WPS FileDialog（Show 返回值决定用户选择/取消） */
function makeDialog(showResult: number, items: string[]): FakeDialog {
  return {
    AllowMultiSelect: false,
    Title: '',
    Filters: { Clear: vi.fn(), Add: vi.fn() },
    Show: vi.fn(() => showResult),
    SelectedItems: { Count: items.length, Item: (index: number) => items[index - 1] ?? '' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  sheetState.isLocked = false
  sheetState.lockedIndex = null
  sheetState.lockedName = null
  sheetState.lockedWorkbookName = null
  resetState()
  // clearAllMocks 不清实现，会被个别用例覆写的默认行为须在此重新锚定
  m.dialogConfirm.mockImplementation((_message: string, callback: (isOk: boolean) => void) => {
    callback(true)
  })
  m.createInlineProgress.mockImplementation(() => ({ update: vi.fn(), hide: vi.fn() }))
  m.getLockedEnrichSheet.mockReturnValue(null)
  m.collectDetectedWorkbookPaths.mockReturnValue([])
  m.autoSelectEnrichTarget.mockReturnValue('none')
  m.detectHeaderOnSheet.mockReturnValue({ nameColumn: 1 })
  m.ensureSourceSheet.mockReturnValue(null)
  m.enrichEntries.mockReturnValue([])
  m.matchEntries.mockReturnValue([])
  m.collectAllConflicts.mockReturnValue([])
  m.findIntroSheetInWorkbook.mockReturnValue(null)
  m.findWorkbookByName.mockReturnValue(null)
  // 工作簿监听：拦截 setInterval，避免真实轮询跨用例串扰
  vi.spyOn(window, 'setInterval').mockReturnValue(1234)
  stubApp({ Workbooks: { Count: 0 }, ActiveWorkbook: null })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

// ========== initializeEnrichPage ==========

describe('enrich-page · initializeEnrichPage', () => {
  it('完成全部绑定：锁定初始化、记录加载、冲突按钮绑定、列表刷新、页签可见性', () => {
    mountEnrichControls()

    initializeEnrichPage()

    expect(m.initializeEnrichLock).toHaveBeenCalledWith(
      'workbookSelect',
      'sheetSelect',
      'lockSheetBtn',
      'lockStatus',
    )
    expect(m.loadRecentRecords).toHaveBeenCalled()
    expect(m.bindConflictDialogButtons).toHaveBeenCalled()
    expect(m.refreshEnrichWorkbooks).toHaveBeenCalledWith('workbookSelect')
    // workbookSelect 带选项时 jsdom 默认选中首个 option → 值为 'BGM.xlsx'
    expect(m.refreshEnrichSheets).toHaveBeenCalledWith('BGM.xlsx', 'sheetSelect', 'workbookSelect')
    expect(m.refreshMatchHintText).toHaveBeenCalled()
    expect(m.applyPreviewTabVisibility).toHaveBeenCalled()
    // 工作簿监听已启动（拦截到的 setInterval 以 2s 间隔轮询；
    // enrichWatchTimer 是模块级单例，页面加载期间仅启动一次，故只在首个 init 用例断言）
    expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 2000)
  })

  it('广播 bgm:modulesReady 事件', () => {
    mountEnrichControls()
    const readyListener = vi.fn()
    document.addEventListener('bgm:modulesReady', readyListener)

    initializeEnrichPage()

    expect(readyListener).toHaveBeenCalledTimes(1)
  })

  it('已锁定时从 getLockedEnrichSheet 恢复目标工作表到 state', () => {
    mountEnrichControls()
    sheetState.isLocked = true
    sheetState.lockedIndex = 2
    const lockedSheet = makeWorksheet('追踪')
    m.getLockedEnrichSheet.mockReturnValue([makeWorksheet('BGM.xlsx'), lockedSheet])

    initializeEnrichPage()

    expect(state.bangumiSheet).toBe(lockedSheet)
  })

  it('页面打开检查：未检测到已打开新番表与 Bangumi 表 → 仅记录、不弹提示', () => {
    mountEnrichControls()

    expect(() => initializeEnrichPage()).not.toThrow()
    expect(m.dialogAlert).not.toHaveBeenCalled()
    // Bangumi 检测仍会并入持久化记录并尝试自动选择
    expect(m.mergeDetectedPathsIntoStorage).toHaveBeenCalled()
    expect(m.autoSelectEnrichTarget).toHaveBeenCalled()
  })

  it('Bangumi 检测到已打开表且未锁定 → 自动选择目标表', () => {
    mountEnrichControls()
    m.collectDetectedWorkbookPaths.mockImplementation((detector: { name: string }) =>
      detector.name === 'bangumi' ? ['D:/追踪.xlsx'] : [],
    )
    m.autoSelectEnrichTarget.mockReturnValue('matched')

    initializeEnrichPage()

    expect(m.autoSelectEnrichTarget).toHaveBeenCalledWith(
      'workbookSelect',
      'sheetSelect',
      'lockSheetBtn',
      'lockStatus',
    )
    // selectTargetSheet：sheetSelect 默认选中首个 option → applyTargetSheet 分支
    expect(m.refreshMatchHintText).toHaveBeenCalled()
  })
})

// ========== 绑定路由（点击 → 分发） ==========

describe('enrich-page · 绑定路由', () => {
  beforeEach(() => {
    mountEnrichControls()
    initializeEnrichPage()
    vi.clearAllMocks()
    m.detectHeaderOnSheet.mockReturnValue({ nameColumn: 1 })
    m.ensureSourceSheet.mockReturnValue(null)
    m.autoSelectEnrichTarget.mockReturnValue('none')
    m.collectDetectedWorkbookPaths.mockReturnValue([])
    m.getLockedEnrichSheet.mockReturnValue(null)
    m.enrichEntries.mockReturnValue([])
    m.matchEntries.mockReturnValue([])
    m.collectAllConflicts.mockReturnValue([])
  })

  it('selectFileBtn → 无 FileDialog 且无 GetOpenFilename → 弹出不可用提示', () => {
    click(document.getElementById('selectFileBtn') as HTMLButtonElement)
    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('不可用'))
  })

  it('detectHeaderBtn → 未选文件且未连接 → 提示先打开工作簿', () => {
    click(document.getElementById('detectHeaderBtn') as HTMLButtonElement)
    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('未连接到 Excel'))
  })

  it('closeSourceAfterDetectChk → 开关同步进 state', () => {
    const checkbox = document.getElementById('closeSourceAfterDetectChk') as HTMLInputElement
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    expect(state.closeSourceAfterDetect).toBe(true)
  })

  it('sheetSelect change → selectTargetSheet 写入 state.bangumiSheet 并清空旧匹配结果', () => {
    const worksheet2 = makeWorksheet('追踪')
    stubApp({
      Workbooks: { Count: 1 },
      ActiveWorkbook: {
        Name: 'BGM.xlsx',
        Worksheets: {
          Count: 2,
          Item: (index: number) => (index === 2 ? worksheet2 : makeWorksheet('动画')),
        },
      },
    })
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.value = '2'

    sheetSelect.dispatchEvent(new Event('change'))

    expect(state.bangumiSheet).toBe(worksheet2)
    expect(m.resetMatchResults).toHaveBeenCalled()
    expect(m.updateEnrichLockButton).toHaveBeenCalledWith('lockSheetBtn', 'lockStatus')
  })

  it('refreshSheets → 未锁定时走自动选择并刷新列表', () => {
    const refreshButton = document.querySelector('[data-action="refreshSheets"]')!

    click(refreshButton)

    expect(m.refreshEnrichWorkbooks).toHaveBeenCalledWith('workbookSelect')
    expect(m.autoSelectEnrichTarget).toHaveBeenCalled()
    expect(m.refreshEnrichSheets).toHaveBeenCalled()
  })

  it('refreshSheets → 已锁定时仅同步列表，不触发自动选择', () => {
    sheetState.isLocked = true
    const refreshButton = document.querySelector('[data-action="refreshSheets"]')!

    click(refreshButton)

    expect(m.autoSelectEnrichTarget).not.toHaveBeenCalled()
    expect(m.refreshEnrichSheets).toHaveBeenCalled()
  })

  it('lockSheetBtn → 锁定成功后禁用下拉框并同步目标表', () => {
    m.toggleEnrichWorkbookLock.mockImplementation(() => {
      sheetState.isLocked = true
      sheetState.lockedIndex = 2
    })
    const worksheet2 = makeWorksheet('追踪')
    stubApp({
      Workbooks: { Count: 1 },
      ActiveWorkbook: {
        Name: 'BGM.xlsx',
        Worksheets: {
          Count: 2,
          Item: (index: number) => (index === 2 ? worksheet2 : makeWorksheet('动画')),
        },
      },
    })
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.value = '2'

    click(document.getElementById('lockSheetBtn') as HTMLButtonElement)

    expect(m.toggleEnrichWorkbookLock).toHaveBeenCalledWith(
      'sheetSelect',
      'workbookSelect',
      'lockSheetBtn',
      'lockStatus',
    )
    expect(sheetSelect.disabled).toBe(true)
    expect(state.bangumiSheet).toBe(worksheet2)
  })

  it('lockSheetBtn → 解锁后清空目标表、恢复下拉框并取消兜底重试', () => {
    // toggleEnrichWorkbookLock 是 mock：必须让它真的把 isLocked 翻成 false，
    // 否则点完按钮 isLocked 仍为 true，走的其实是「锁定」分支而非「解锁」分支。
    sheetState.isLocked = true
    state.bangumiSheet = makeWorksheet('追踪')
    m.toggleEnrichWorkbookLock.mockImplementation(() => {
      sheetState.isLocked = false
    })

    click(document.getElementById('lockSheetBtn') as HTMLButtonElement)

    expect(state.bangumiSheet).toBeNull()
    expect((document.getElementById('sheetSelect') as HTMLSelectElement).disabled).toBe(false)
    expect(m.toggleEnrichWorkbookLock).toHaveBeenCalled()
  })

  it('startEnrichBtn → 无源表 → 提示先选择文件并识别表头', () => {
    click(document.getElementById('startEnrichBtn') as HTMLButtonElement)
    expect(m.dialogAlert).toHaveBeenCalledWith(
      '提示',
      expect.stringContaining('请先选择新番表文件'),
    )
  })

  it('previewMatchBtn / viewSourceDetailBtn / 关闭按钮 / 记录按钮 → 各自分发', () => {
    click(document.getElementById('previewMatchBtn') as HTMLButtonElement)
    expect(m.previewMatch).toHaveBeenCalled()

    click(document.getElementById('viewSourceDetailBtn') as HTMLButtonElement)
    expect(m.showSourceDetail).toHaveBeenCalled()

    click(document.getElementById('enrichDetailCloseBtn') as HTMLButtonElement)
    expect(m.hideEnrichDetail).toHaveBeenCalled()

    click(document.getElementById('sourceDetailCloseBtn') as HTMLButtonElement)
    expect(m.hideSourceDetail).toHaveBeenCalled()

    click(document.getElementById('matchDetailCloseBtn') as HTMLButtonElement)
    expect(m.hideMatchDetail).toHaveBeenCalled()

    click(document.querySelector('[data-action="openRecordSheet"]')!)
    expect(m.openEnrichRecordSheet).toHaveBeenCalled()

    click(document.querySelector('[data-action="clearRecords"]')!)
    expect(m.clearRecords).toHaveBeenCalled()
  })

  it('页签点击 → setPreviewTab；未知页签忽略', () => {
    const tabs = document.querySelectorAll<HTMLElement>('.preview-tab')
    tabs[1]?.dispatchEvent(new Event('click'))
    expect(m.setPreviewTab).toHaveBeenCalledWith('match')

    m.setPreviewTab.mockClear()
    const unknown = document.createElement('div')
    unknown.className = 'preview-tab'
    unknown.dataset.tab = 'other'
    document.body.append(unknown)
    unknown.dispatchEvent(new Event('click'))
    expect(m.setPreviewTab).not.toHaveBeenCalled()
  })

  it('batchClearBtn → 清空批量状态并回收源工作簿', () => {
    state.batchFiles = ['D:/a.xlsx', 'D:/b.xlsx']

    click(document.getElementById('batchClearBtn') as HTMLButtonElement)

    expect(state.batchFiles).toEqual([])
    expect(state.filePath).toBe('')
    expect(m.closeOpenedSourceWorkbook).toHaveBeenCalled()
    expect(m.recomputeScrollspy).toHaveBeenCalled()
  })

  it('batchStartBtn → 无文件 → 提示先选择文件', () => {
    click(document.getElementById('batchStartBtn') as HTMLButtonElement)
    expect(m.dialogAlert).toHaveBeenCalledWith(
      '提示',
      expect.stringContaining('请先选择至少一个新番表文件'),
    )
  })
})

// ========== selectNewAnimeFile ==========

describe('enrich-page · selectNewAnimeFile', () => {
  beforeEach(() => {
    mountEnrichControls()
    vi.clearAllMocks()
    m.detectHeaderOnSheet.mockReturnValue({ nameColumn: 1 })
    m.ensureSourceSheet.mockReturnValue(null)
    m.autoSelectEnrichTarget.mockReturnValue('none')
    m.collectDetectedWorkbookPaths.mockReturnValue([])
    m.getLockedEnrichSheet.mockReturnValue(null)
    m.enrichEntries.mockReturnValue([])
    m.matchEntries.mockReturnValue([])
    m.collectAllConflicts.mockReturnValue([])
  })

  it('FileDialog 多选成功 → 合并路径、刷新列表、N≥2 禁用单文件富化', () => {
    const dialog = makeDialog(-1, ['D:/动画A.xlsx', 'D:/动画B.xlsx'])
    stubApp({ FileDialog: () => dialog, msoFileDialogFilePicker: 3 })

    selectNewAnimeFile()

    expect(state.batchFiles).toEqual(['D:/动画A.xlsx', 'D:/动画B.xlsx'])
    expect(state.filePath).toBe('D:/动画A.xlsx')
    expect(dialog.AllowMultiSelect).toBe(true)
    expect(dialog.Filters.Add).toHaveBeenCalledTimes(4)
    const startButton = document.getElementById('startEnrichBtn') as HTMLButtonElement
    expect(startButton.disabled).toBe(true)
    expect(startButton.title).toContain('批量富化')
    const listElement = document.getElementById('batchFileList')!
    expect(listElement.innerHTML).toContain('动画A.xlsx')
    expect(document.getElementById('sec-file')?.classList.contains('has-file-selected')).toBe(true)
    // N≥2：不做单文件自动识别，源工作簿被回收
    expect(m.openSourceWorkbook).not.toHaveBeenCalled()
    expect(m.closeOpenedSourceWorkbook).toHaveBeenCalled()
  })

  it('FileDialog 用户取消（Show 返回 0）→ 不合并任何路径', () => {
    const dialog = makeDialog(0, [])
    stubApp({ FileDialog: () => dialog })

    selectNewAnimeFile()

    expect(state.batchFiles).toEqual([])
    expect(m.recomputeScrollspy).not.toHaveBeenCalled()
  })

  it('单文件选择成功 → 自动识别表头并接管源工作簿', () => {
    const dialog = makeDialog(-1, ['D:/动画A.xlsx'])
    stubApp({ FileDialog: () => dialog })
    const wb = { Worksheets: { Count: 1, Item: () => makeWorksheet('动画') } }
    m.openSourceWorkbook.mockReturnValue({ wb, isOpenedByUs: true })

    selectNewAnimeFile()

    expect(state.batchFiles).toEqual(['D:/动画A.xlsx'])
    expect(state.sourceWorkbook).toBe(wb)
    expect(state.isSourceWorkbookOpenedByUs).toBe(true)
    expect(m.detectHeaderOnSheet).toHaveBeenCalledWith(expect.anything(), '动画A.xlsx')
  })

  it('FileDialog 抛错 → 回退 GetOpenFilename 循环；确认一次后取消结束', () => {
    const dialog: FakeDialog = makeDialog(-1, [])
    stubApp({
      FileDialog: () => {
        throw new Error('桥接失效')
      },
      GetOpenFilename: vi.fn().mockReturnValueOnce('D:/动画A.xlsx').mockReturnValueOnce(false),
    })
    // 第一次确认继续、第二次取消（由 dialogConfirm 逐次回调控制）
    let confirmCount = 0
    m.dialogConfirm.mockImplementation((_message: string, callback: (isOk: boolean) => void) => {
      confirmCount += 1
      callback(confirmCount === 1)
    })

    selectNewAnimeFile()

    expect(state.batchFiles).toEqual(['D:/动画A.xlsx'])
    expect(confirmCount).toBe(1)
    expect(dialog.Show).not.toHaveBeenCalled()
  })

  it('回退路径选择重复文件 → 提示已在列表中', () => {
    state.batchFiles = ['D:/动画A.xlsx']
    // 第二次返回 false 模拟用户取消，否则生产 for(;;) 循环永远拿不到终止信号
    stubApp({
      GetOpenFilename: vi.fn().mockReturnValueOnce('D:/动画A.xlsx').mockReturnValueOnce(false),
    })

    selectNewAnimeFile()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('已在列表中'))
    expect(state.batchFiles).toEqual(['D:/动画A.xlsx'])
  })

  it('无宿主 → 弹出 WPS 对话框不可用提示', () => {
    stubApp(null)

    selectNewAnimeFile()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('不可用'))
  })

  it('batchSelectFiles 兼容入口 → 与统一入口等价', () => {
    stubApp(null)
    m.dialogAlert.mockClear()

    // 刻意覆盖：验证 deprecated 兼容入口仍可调用（生产已无 UI 触发）
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    batchSelectFiles()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('不可用'))
  })
})

// ========== autoDetectHeader ==========

describe('enrich-page · autoDetectHeader', () => {
  beforeEach(() => {
    mountEnrichControls()
    vi.clearAllMocks()
    m.detectHeaderOnSheet.mockReturnValue({ nameColumn: 1 })
    m.ensureSourceSheet.mockReturnValue(null)
    m.autoSelectEnrichTarget.mockReturnValue('none')
    m.collectDetectedWorkbookPaths.mockReturnValue([])
    m.getLockedEnrichSheet.mockReturnValue(null)
    m.enrichEntries.mockReturnValue([])
    m.matchEntries.mockReturnValue([])
    m.collectAllConflicts.mockReturnValue([])
  })

  it('已选文件 → 打开文件识别；打开失败 → 弹出失败提示', () => {
    state.filePath = 'D:/动画A.xlsx'
    m.openSourceWorkbook.mockReturnValue(null)

    autoDetectHeader()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('自动识别表头失败'))
  })

  it('识别失败且工作簿是本插件打开的 → 立即回收', () => {
    state.filePath = 'D:/动画A.xlsx'
    const wb = { Worksheets: { Count: 1, Item: () => makeWorksheet('动画') } }
    m.openSourceWorkbook.mockReturnValue({ wb, isOpenedByUs: true })
    m.detectHeaderOnSheet.mockReturnValue(null)

    autoDetectHeader()

    expect(m.closeWorkbook).toHaveBeenCalledWith(wb)
    expect(state.sourceWorkbook).toBeNull()
  })

  it('closeSourceAfterDetect 开关打开 → 识别成功后关闭源工作簿', () => {
    state.filePath = 'D:/动画A.xlsx'
    state.closeSourceAfterDetect = true
    const wb = { Worksheets: { Count: 1, Item: () => makeWorksheet('动画') } }
    m.openSourceWorkbook.mockReturnValue({ wb, isOpenedByUs: true })

    autoDetectHeader()

    expect(m.closeSourceWorkbookOnly).toHaveBeenCalled()
    expect(state.sourceWorkbook).toBe(wb)
  })

  it('未选文件 → 回落到当前活动工作表识别', () => {
    const worksheet = makeWorksheet('动画')
    stubApp({
      Workbooks: { Count: 1 },
      ActiveWorkbook: { Name: 'BGM.xlsx', ActiveSheet: worksheet },
    })

    autoDetectHeader()

    expect(m.detectHeaderOnSheet).toHaveBeenCalledWith(worksheet, '活动工作表')
  })

  it('未选文件且活动表为空 → 提示先打开文件', () => {
    stubApp({ Workbooks: { Count: 1 }, ActiveWorkbook: { Name: 'BGM.xlsx', ActiveSheet: null } })

    autoDetectHeader()

    expect(m.dialogAlert).toHaveBeenCalledWith(
      '提示',
      expect.stringContaining('请先打开新番表文件'),
    )
  })
})

// ========== startEnrichment ==========

describe('enrich-page · startEnrichment', () => {
  const animeSheet = makeWorksheet('动画')
  const targetSheet = makeWorksheet('追踪')

  function primeHappyPath(): void {
    mountEnrichControls()
    vi.clearAllMocks()
    m.detectHeaderOnSheet.mockReturnValue({ nameColumn: 1 })
    m.autoSelectEnrichTarget.mockReturnValue('none')
    m.collectDetectedWorkbookPaths.mockReturnValue([])
    m.getLockedEnrichSheet.mockReturnValue(null)
    m.collectAllConflicts.mockReturnValue([])
    m.ensureSourceSheet.mockReturnValue(animeSheet)
    state.animeSourceSheet = animeSheet
    state.bangumiSheet = targetSheet
    state.columnMapping = { nameColumn: 1 }
    state.matches = [{ matchType: 'exact' }] as unknown as typeof state.matches
    state.filePath = 'D:/动画A.xlsx'
    m.enrichEntries.mockReturnValue([
      { kind: 'matched', enrichedFields: ['名称'] },
      { kind: 'unmatched', enrichedFields: [] },
    ])
  }

  it('正常路径 → 调 enrichEntries、显示详细按钮、渲染摘要与进度', () => {
    primeHappyPath()
    m.enrichEntries.mockImplementation(
      (
        _worksheet: unknown,
        _target: unknown,
        _matches: unknown,
        _config: unknown,
        onProgress: (p: unknown) => void,
      ) => {
        onProgress({
          current: 1,
          total: 2,
          currentName: '动画A',
          stats: { enriched: 1, skipped: 0, failed: 0 },
        })
        return [
          { kind: 'matched', enrichedFields: ['名称'] },
          { kind: 'unmatched', enrichedFields: [] },
        ]
      },
    )

    startEnrichment()

    expect(m.enrichEntries).toHaveBeenCalledTimes(1)
    expect(m.showEnrichDetailButton).toHaveBeenCalled()
    expect(m.getOrCreateEnrichRecordSheet).toHaveBeenCalled()
    expect(m.loadRecentRecords).toHaveBeenCalled()
    expect(progressHosts.enrich).toBeNull()
    const startButton = document.getElementById('startEnrichBtn') as HTMLButtonElement
    expect(startButton.textContent).toBe('🚀 开始富化')
    expect(state.isEnriching).toBe(false)
    expect(document.getElementById('enrichedCount')!.textContent).toBe('1')
  })

  it('用户取消 → 保留结果并提示，不弹冲突对话框', () => {
    primeHappyPath()
    m.collectAllConflicts.mockReturnValue([{ kind: 'conflict' }])
    let isCancelRequested = false
    m.enrichEntries.mockImplementation(
      (
        _worksheet: unknown,
        _target: unknown,
        _matches: unknown,
        _config: unknown,
        _onProgress: unknown,
        _intro: unknown,
        _isCancelled: () => boolean,
      ) => {
        isCancelRequested = true
        return [{ kind: 'matched', enrichedFields: [] }]
      },
    )
    m.createInlineProgress.mockImplementation(
      (_host: string, _title: string, _icon: string, onCancel: () => void) => {
        // 富化期间模拟用户点击「停止」
        onCancel()
        return { update: vi.fn(), hide: vi.fn() }
      },
    )

    startEnrichment()

    expect(isCancelRequested).toBe(true)
    // 注意：finally 会把 cancelRequested 复位，取消标记只能在 enrichEntries 执行期间观测
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('已停止富化'), 'warning')
    expect(m.showConflictDialog).not.toHaveBeenCalled()
  })

  it('存在未解决冲突 → 弹出冲突对话框', () => {
    primeHappyPath()
    m.collectAllConflicts.mockReturnValue([{ kind: 'conflict' }])

    startEnrichment()

    expect(state.pendingConflicts).toHaveLength(1)
    expect(m.showConflictDialog).toHaveBeenCalled()
  })

  it('富化中重复请求 → 忽略', () => {
    primeHappyPath()
    state.isEnriching = true

    startEnrichment()

    expect(m.ensureSourceSheet).not.toHaveBeenCalled()
  })

  it('多文件场景 → 引导走批量富化', () => {
    primeHappyPath()
    state.batchFiles = ['D:/a.xlsx', 'D:/b.xlsx']

    startEnrichment()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('批量富化'))
  })

  it('无源表 / 无目标表 → 分别提示', () => {
    primeHappyPath()
    // 生产顺序：ensureSourceSheet() 先于目标表检查
    m.ensureSourceSheet.mockReturnValue(null)
    state.animeSourceSheet = null
    state.bangumiSheet = null

    startEnrichment()
    expect(m.dialogAlert).toHaveBeenCalledWith(
      '提示',
      expect.stringContaining('请先选择新番表文件'),
    )

    primeHappyPath()
    m.ensureSourceSheet.mockReturnValue(animeSheet)
    state.bangumiSheet = null
    m.getLockedEnrichSheet.mockReturnValue(null)
    startEnrichment()
    expect(m.dialogAlert).toHaveBeenCalledWith(
      '提示',
      expect.stringContaining('目标 Bangumi 工作表'),
    )
  })

  it('state 无目标表时 → 从锁定状态恢复', () => {
    primeHappyPath()
    state.bangumiSheet = null
    m.getLockedEnrichSheet.mockReturnValue([makeWorksheet('BGM.xlsx'), targetSheet])

    startEnrichment()

    expect(state.bangumiSheet).toBe(targetSheet)
    expect(m.enrichEntries).toHaveBeenCalled()
  })

  it('列映射缺失或 nameColumn 为 0 → 提示列映射未识别', () => {
    primeHappyPath()
    state.columnMapping = null
    startEnrichment()
    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('列映射'))

    primeHappyPath()
    state.columnMapping = { nameColumn: 0 }
    startEnrichment()
    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('列映射'))
  })

  it('无匹配 → 先跑一次预览匹配，仍无匹配则提示', () => {
    primeHappyPath()
    state.matches = []

    startEnrichment()

    expect(m.previewMatch).toHaveBeenCalledWith({ keepSourceOpen: true })
    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('未匹配到任何条目'))
    expect(state.isEnriching).toBe(false)
  })

  it('enrichEntries 抛错 → handleError + Dialog.error，状态复位', () => {
    primeHappyPath()
    m.enrichEntries.mockImplementation(() => {
      throw new Error('写入失败')
    })

    startEnrichment()

    expect(m.handleError).toHaveBeenCalled()
    expect(m.dialogError).toHaveBeenCalledWith('错误', expect.stringContaining('写入失败'))
    expect(state.isEnriching).toBe(false)
  })

  it('closeSourceAfterDetect 开关 → 富化结束回收源工作簿', () => {
    primeHappyPath()
    state.closeSourceAfterDetect = true
    state.isSourceWorkbookOpenedByUs = true

    startEnrichment()

    expect(m.closeSourceWorkbookOnly).toHaveBeenCalled()
  })
})

// ========== 批量富化 ==========

describe('enrich-page · batchStartEnrichment', () => {
  const targetSheet = makeWorksheet('追踪')

  function primeBatch(files: string[]): void {
    mountEnrichControls()
    vi.clearAllMocks()
    m.detectHeaderOnSheet.mockReturnValue({ nameColumn: 1 })
    m.autoSelectEnrichTarget.mockReturnValue('none')
    m.collectDetectedWorkbookPaths.mockReturnValue([])
    m.getLockedEnrichSheet.mockReturnValue(null)
    m.collectAllConflicts.mockReturnValue([])
    state.batchFiles = [...files]
    state.bangumiSheet = targetSheet
    stubApp({
      Workbooks: {
        Count: 0,
        Open: vi.fn(() => {
          const worksheet = makeWorksheet('动画')
          const wb = {
            Name: '源.xlsx',
            Worksheets: { Count: 1, Item: () => worksheet },
            Close: vi.fn(),
          }
          return Object.assign(wb, { parent: null })
        }),
      },
      ActiveWorkbook: null,
    })
    m.detectAnimeSourceLayout.mockReturnValue({
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: { nameColumn: 1 },
    })
    m.matchEntries.mockReturnValue([{ matchType: 'exact' }, { matchType: 'unmatched' }])
    m.enrichEntries.mockReturnValue([{ kind: 'matched', enrichedFields: ['名称'] }])
  }

  it('批量进行中重复请求 → 忽略', async () => {
    primeBatch(['D:/a.xlsx'])
    state.isBatchEnriching = true

    batchStartEnrichment()

    expect(m.dialogAlert).not.toHaveBeenCalled()
    expect(m.getApp).not.toHaveBeenCalled()
  })

  it('确认取消 → 复位状态并恢复按钮', () => {
    primeBatch(['D:/a.xlsx'])
    m.dialogConfirm.mockImplementation((_message: string, callback: (isOk: boolean) => void) =>
      callback(false),
    )
    const startButton = document.getElementById('batchStartBtn') as HTMLButtonElement

    batchStartEnrichment()

    expect(state.isBatchEnriching).toBe(false)
    expect(startButton.disabled).toBe(false)
    expect(m.maybeAutoCleanAfterEnrich).not.toHaveBeenCalled()
  })

  it('两个文件依次富化成功 → 汇总渲染 + 自动去重 + 记录刷新', async () => {
    primeBatch(['D:/动画A.xlsx', 'D:/动画B.xlsx'])

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults).toHaveLength(2)
    expect(state.batchResults[0]?.success).toBe(true)
    expect(state.batchResults[0]?.matched).toBe(1)
    expect(state.batchResults[0]?.unmatched).toBe(1)
    expect(state.batchResults[0]?.updatedEntries).toBe(1)
    expect(state.batchResults[1]?.filePath).toBe('D:/动画B.xlsx')
    expect(m.maybeAutoCleanAfterEnrich).toHaveBeenCalledTimes(1)
    expect(m.getOrCreateEnrichRecordSheet).toHaveBeenCalled()
    expect(m.showEnrichDetailButton).toHaveBeenCalled()
    expect(state.enrichDetailGroups).toHaveLength(2)
    const summaryElement = document.getElementById('batchSummary')!
    expect(summaryElement.style.display).toBe('')
    expect(document.getElementById('batchSummaryContent')!.innerHTML).toContain('动画A.xlsx')
    expect(state.enrichDetailGroups[0]?.fileName).toBe('动画A.xlsx')
  })

  it('单文件打开失败 → 结果标记失败但不中断后续', async () => {
    primeBatch(['D:/坏.xlsx'])
    stubApp({
      Workbooks: {
        Count: 0,
        Open: vi.fn(() => {
          throw new Error('文件被占用')
        }),
      },
      ActiveWorkbook: null,
    })

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults).toHaveLength(1)
    expect(state.batchResults[0]?.success).toBe(false)
    expect(state.batchResults[0]?.error).toBe('文件被占用')
    expect(m.maybeAutoCleanAfterEnrich).toHaveBeenCalledTimes(1)
  })

  it('目标表未锁定 → 从锁定状态恢复后再执行', async () => {
    primeBatch(['D:/动画A.xlsx'])
    state.bangumiSheet = null
    m.getLockedEnrichSheet.mockReturnValue([makeWorksheet('BGM.xlsx'), targetSheet])

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults[0]?.success).toBe(true)
  })

  it('无目标表且未锁定 → 提示先锁定目标表', () => {
    primeBatch(['D:/动画A.xlsx'])
    state.bangumiSheet = null
    m.getLockedEnrichSheet.mockReturnValue(null)

    batchStartEnrichment()

    expect(m.dialogAlert).toHaveBeenCalledWith(
      '提示',
      expect.stringContaining('目标 Bangumi 工作表'),
    )
    expect(state.isBatchEnriching).toBe(false)
  })

  it('用户在处理第一个文件后请求停止 → 只完成当前文件并提示', async () => {
    primeBatch(['D:/动画A.xlsx', 'D:/动画B.xlsx'])
    // 第一个文件的 enrichEntries 执行期间置位取消标记（文件边界生效）
    m.enrichEntries.mockImplementation(() => {
      state.batchCancelRequested = true
      return [{ kind: 'matched', enrichedFields: [] }]
    })

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults).toHaveLength(1)
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('已停止批量富化'), 'warning')
  })

  it('检测到布局缺失表头行 → 回退 findHeaderRow；名称列缺失 → 标记错误', async () => {
    primeBatch(['D:/无表头.xlsx'])
    m.detectAnimeSourceLayout.mockReturnValue(null)
    m.findHeaderRow.mockReturnValue(0)

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults[0]?.success).toBe(false)
    expect(state.batchResults[0]?.error).toBe('未检测到有效的表头行')
  })

  it('布局命中但名称列为 0 → 标记错误且不进入匹配', async () => {
    primeBatch(['D:/无名称列.xlsx'])
    m.detectAnimeSourceLayout.mockReturnValue({
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: { nameColumn: 0 },
    })

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults[0]?.success).toBe(false)
    expect(state.batchResults[0]?.error).toBe('已找到字段行，但未找到名称列')
    expect(m.matchEntries).not.toHaveBeenCalled()
  })

  it('关闭源文件抛错 → 记警告但不影响该文件的结果', async () => {
    primeBatch(['D:/a.xlsx'])
    // primeBatch 里 Close 是正常 vi.fn()；这里换成抛错版本，走 closeBatchSourceWorkbook 的 catch
    stubApp({
      Workbooks: {
        Count: 0,
        Open: () => {
          const wb = {
            Name: '源.xlsx',
            Worksheets: { Count: 1, Item: () => makeWorksheet('动画') },
            Close: () => {
              throw new Error('文件被占用')
            },
          }
          return Object.assign(wb, { parent: null })
        },
      },
      ActiveWorkbook: null,
    })

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults[0]?.success).toBe(true)
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('关闭文件时警告'),
    )
  })

  it('批量模式刻意不回调进度 → 进度函数被调用也不影响结果统计', async () => {
    primeBatch(['D:/a.xlsx'])
    m.enrichEntries.mockImplementation(
      (
        _worksheet: unknown,
        _target: unknown,
        _matches: unknown,
        _config: unknown,
        onProgress?: (progress: unknown) => void,
      ) => {
        // 生产在批量分支传的是空函数；这里主动调一次，确认它是无害的 no-op
        onProgress?.({ current: 1, total: 1, currentName: 'x', stats: {} })
        return [{ kind: 'matched', enrichedFields: ['名称'] }]
      },
    )

    batchStartEnrichment()

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(state.batchResults[0]?.success).toBe(true)
    expect(state.batchResults[0]?.matched).toBe(1)
  })

  it('批量进度「停止」按钮 → 置位批量取消标记并按停止收尾', async () => {
    const cancelHandlers: (() => void)[] = []
    primeBatch(['D:/a.xlsx'])
    m.createInlineProgress.mockImplementation(
      (_host: string, _title: string, _icon: string, onCancel?: () => void) => {
        if (onCancel) cancelHandlers.push(onCancel)
        return { update: vi.fn(), hide: vi.fn() }
      },
    )

    batchStartEnrichment()

    // showBatchProgress(true) 在 runBatchEnrichment 的首个 await 之前同步执行
    expect(cancelHandlers).toHaveLength(1)
    cancelHandlers[0]?.()
    expect(state.batchCancelRequested).toBe(true)

    await vi.waitFor(() => {
      expect(state.isBatchEnriching).toBe(false)
    })
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('已停止批量富化'), 'warning')
  })
})

// ========== 兜底分支与边界补测 ==========
//
// 本块只补「行已覆盖、但某条分支从未走到」的边角：早退守卫、catch 兜底、
// 可选开关的另一侧、以及多文件与单文件之间的状态回退。
//
// 注意：`enrichWatchTimer` / `enrichWatchRetriesLeft` 是 enrich-page.ts 的
// **模块级**状态，一旦被本文件里任何一条用例改动（例如触发 select 的 change
// 就会把剩余重试次数清零），后续用例再也拿不回初值。因此工作簿轮询那几条
// 分支无法在本文件内稳定复现，单独放在 `enrich-page-watch.test.ts`（独立
// 模块注册表 → 模块级状态天然是干净的）。

describe('enrich-page · 兜底分支与边界补测', () => {
  beforeEach(() => {
    mountEnrichControls()
    initializeEnrichPage()
    vi.clearAllMocks()
    m.detectHeaderOnSheet.mockReturnValue({ nameColumn: 1 })
    m.ensureSourceSheet.mockReturnValue(null)
    m.autoSelectEnrichTarget.mockReturnValue('none')
    m.collectDetectedWorkbookPaths.mockReturnValue([])
    m.getLockedEnrichSheet.mockReturnValue(null)
    m.enrichEntries.mockReturnValue([])
    m.matchEntries.mockReturnValue([])
    m.collectAllConflicts.mockReturnValue([])
    m.openSourceWorkbook.mockReturnValue(null)
  })

  it('workbookSelect change → 刷新工作表列表并同步锁定按钮', () => {
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement

    wbSelect.dispatchEvent(new Event('change'))

    expect(m.refreshEnrichSheets).toHaveBeenCalled()
    expect(m.updateEnrichLockButton).toHaveBeenCalledWith('lockSheetBtn', 'lockStatus')
  })

  it('refreshSheets 且源表/目标表/列映射齐备 → 微任务里自动跑一次预览匹配', async () => {
    // 刷新按钮会先跑 selectTargetSheet()：它读「工作簿下拉 + 活动工作簿」，
    // 两者都拿不到时会把 state.bangumiSheet 清空，后面的守卫就不成立了。
    const targetSheet = makeWorksheet('追踪')
    stubApp({
      Workbooks: { Count: 1 },
      ActiveWorkbook: {
        Name: 'BGM.xlsx',
        Worksheets: { Count: 1, Item: () => targetSheet },
      },
    })
    state.animeSourceSheet = makeWorksheet('动画')
    state.bangumiSheet = targetSheet
    state.columnMapping = { nameColumn: 1 }

    click(document.querySelector('[data-action="refreshSheets"]')!)

    // queueMicrotask 里调度，必须让出一次微任务才能观察到
    await vi.waitFor(() => {
      expect(m.previewMatch).toHaveBeenCalled()
    })
  })

  it('viewEnrichDetailBtn → 打开富化详情弹窗', () => {
    click(document.getElementById('viewEnrichDetailBtn') as HTMLButtonElement)

    expect(m.showEnrichDetail).toHaveBeenCalled()
  })

  it('sheetSelect 未选中任何工作表 → 清空目标表引用', () => {
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    // jsdom：select.value 只有存在匹配 option 才能落住，空值必须显式造一个空 option
    const emptyOption = document.createElement('option')
    emptyOption.value = ''
    sheetSelect.append(emptyOption)
    sheetSelect.value = ''
    state.bangumiSheet = makeWorksheet('追踪')

    sheetSelect.dispatchEvent(new Event('change'))

    expect(state.bangumiSheet).toBeNull()
    expect(m.resetMatchResults).toHaveBeenCalled()
  })

  it('读取目标工作表抛错 → 清空引用并记 INFO 级错误', () => {
    stubApp({
      Workbooks: { Count: 1 },
      ActiveWorkbook: {
        Name: 'BGM.xlsx',
        Worksheets: {
          Count: 2,
          Item: () => {
            throw new Error('索引越界')
          },
        },
      },
    })
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement
    sheetSelect.value = '2'

    sheetSelect.dispatchEvent(new Event('change'))

    expect(state.bangumiSheet).toBeNull()
    expect(m.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'selectTargetSheet' }),
    )
  })

  it('已锁定工作簿时刷新列表 → 回填锁定的工作簿', () => {
    document.body.replaceChildren()
    mountEnrichControls()
    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement
    const otherOption = document.createElement('option')
    otherOption.value = '其他.xlsx'
    wbSelect.prepend(otherOption)
    wbSelect.value = '其他.xlsx'
    sheetState.isLocked = true
    sheetState.lockedWorkbookName = 'BGM.xlsx'

    initializeEnrichPage()

    expect(wbSelect.value).toBe('BGM.xlsx')
  })

  it('识别新文件时先回收上一个源工作簿', () => {
    state.filePath = 'D:/动画B.xlsx'
    state.sourceWorkbook = { Name: '旧.xlsx' } as unknown as WpsWorkbook
    const wb = {
      Name: '新.xlsx',
      Worksheets: { Count: 1, Item: () => makeWorksheet('动画') },
    } as unknown as WpsWorkbook
    m.openSourceWorkbook.mockReturnValue({ wb, isOpenedByUs: false })

    autoDetectHeader()

    expect(m.closeOpenedSourceWorkbook).toHaveBeenCalled()
    expect(state.sourceWorkbook).toBe(wb)
    expect(state.isSourceWorkbookOpenedByUs).toBe(false)
  })

  it('文件无工作表且由本插件打开 → 立即回收并提示失败', () => {
    state.filePath = 'D:/空.xlsx'
    const wb = {
      Name: '空.xlsx',
      Worksheets: { Count: 0, Item: () => null },
    } as unknown as WpsWorkbook
    m.openSourceWorkbook.mockReturnValue({ wb, isOpenedByUs: true })

    autoDetectHeader()

    expect(m.closeWorkbook).toHaveBeenCalledWith(wb)
    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('文件中没有工作表'))
  })

  it('多选结果含已选文件 → 跳过重复项、只追加新文件', () => {
    state.batchFiles = ['D:/动画A.xlsx']
    stubApp({ FileDialog: () => makeDialog(-1, ['D:/动画A.xlsx', 'D:/动画B.xlsx']) })

    selectNewAnimeFile()

    expect(state.batchFiles).toEqual(['D:/动画A.xlsx', 'D:/动画B.xlsx'])
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('跳过重复文件'),
    )
  })

  it('宿主桥接整体抛错 → 交给 BGM.handleError 兜底', () => {
    // getApp 在 pickFilesWithMultiSelect 内部被自己的 try 吞掉（→ null 触发回退），
    // 回退路径里的第二次 getApp 才会冒到 selectNewAnimeFile 的外层 catch
    m.getApp.mockImplementation(() => {
      throw new Error('桥接失效')
    })

    selectNewAnimeFile()

    expect(m.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'selectNewAnimeFile' }),
    )
  })

  it('富化摘要刷新记录表失败 → 记 INFO 级错误但不影响富化结果', () => {
    m.ensureSourceSheet.mockReturnValue(makeWorksheet('动画'))
    state.bangumiSheet = makeWorksheet('追踪')
    state.columnMapping = { nameColumn: 1 }
    state.matches = [{ matchType: 'exact' }] as unknown as typeof state.matches
    state.filePath = 'D:/动画A.xlsx'
    m.enrichEntries.mockReturnValue([{ kind: 'matched', enrichedFields: [] }])
    m.collectAllConflicts.mockReturnValue([])
    m.getOrCreateEnrichRecordSheet.mockImplementation(() => {
      throw new Error('无权限')
    })

    startEnrichment()

    expect(m.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'renderEnrichSummary' }),
    )
    expect(state.isEnriching).toBe(false)
  })

  it('页面打开检查：检测到已打开的新番表 → 自动加入、弹提示并识别表头', () => {
    document.body.replaceChildren()
    mountEnrichControls()
    m.collectDetectedWorkbookPaths.mockImplementation((detector: { name?: string }) =>
      detector.name === 'anime' ? ['D:/动画A.xlsx'] : [],
    )
    const wb = {
      Name: '动画A.xlsx',
      Worksheets: { Count: 1, Item: () => makeWorksheet('动画') },
    } as unknown as WpsWorkbook
    m.openSourceWorkbook.mockReturnValue({ wb, isOpenedByUs: false })

    initializeEnrichPage()

    expect(state.batchFiles).toEqual(['D:/动画A.xlsx'])
    expect(document.getElementById('autoDetectNotice')?.textContent).toContain(
      '已自动识别已打开的新番表工作簿',
    )
    expect(m.openSourceWorkbook).toHaveBeenCalledWith('D:/动画A.xlsx')
  })

  it('页面打开检查：检测到的文件都已在列表中 → 不重复添加、不弹提示', () => {
    document.body.replaceChildren()
    mountEnrichControls()
    state.batchFiles = ['D:/动画A.xlsx']
    m.collectDetectedWorkbookPaths.mockImplementation((detector: { name?: string }) =>
      detector.name === 'anime' ? ['D:/动画A.xlsx'] : [],
    )

    initializeEnrichPage()

    expect(state.batchFiles).toEqual(['D:/动画A.xlsx'])
    expect(document.getElementById('autoDetectNotice')?.textContent).toBe('')
  })

  it('页面打开检查抛错 → 两个检查点各自兜底，且不阻断初始化', () => {
    m.collectDetectedWorkbookPaths.mockImplementation(() => {
      throw new Error('COM 不可用')
    })

    expect(() => {
      initializeEnrichPage()
    }).not.toThrow()

    expect(m.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'autoAddOpenAnimeWorkbooks' }),
    )
    expect(m.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'checkBangumiAutoDetectRecords' }),
    )
  })

  it('批量列表移除按钮 → 删除该文件并让 filePath 跟随首位', () => {
    stubApp({ FileDialog: () => makeDialog(-1, ['D:/a.xlsx', 'D:/b.xlsx', 'D:/c.xlsx']) })

    selectNewAnimeFile()

    const batchRemoveNodeList = document.querySelectorAll('#batchFileList [data-batch-remove]')
    expect(batchRemoveNodeList).toHaveLength(3)

    click(batchRemoveNodeList[0]!)

    expect(state.batchFiles).toEqual(['D:/b.xlsx', 'D:/c.xlsx'])
    expect(state.filePath).toBe('D:/b.xlsx')
    expect(m.bgmLog).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('移除文件'))
  })

  it('由多文件移除到只剩一个 → 补跑一次自动识别表头', () => {
    stubApp({ FileDialog: () => makeDialog(-1, ['D:/a.xlsx', 'D:/b.xlsx']) })

    selectNewAnimeFile()
    expect(state.batchFiles).toHaveLength(2)

    const wb = {
      Name: 'a.xlsx',
      Worksheets: { Count: 1, Item: () => makeWorksheet('动画') },
    } as unknown as WpsWorkbook
    m.openSourceWorkbook.mockReturnValue({ wb, isOpenedByUs: false })

    click(document.querySelectorAll('#batchFileList [data-batch-remove]')[1]!)

    expect(state.batchFiles).toEqual(['D:/a.xlsx'])
    expect(state.filePath).toBe('D:/a.xlsx')
    expect(m.openSourceWorkbook).toHaveBeenCalledWith('D:/a.xlsx')
  })
})
