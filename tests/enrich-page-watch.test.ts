// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/enrich-page.ts` 的**工作簿变化监听**分支单元测试。
 *
 * 为什么单独一个文件（而不是并入 `enrich-page.test.ts`）：
 *   `enrichWatchTimer` 与 `enrichWatchRetriesLeft` 是 enrich-page.ts 的**模块级**
 *   状态 —— 前者让 `startEnrichWorkbookWatch` 幂等（第二次调用直接 return），
 *   后者是「页面刚打开时 WPS 集合可能尚未就绪」的兜底重试计数，**只递减、永不回补**。
 *   同一个文件里跑多条用例时，先跑的用例会把重试次数耗尽（触发 select 的 change
 *   就会清零），后面的用例再也走不到「重试扫描」分支。
 *   这里每条用例都先 `vi.resetModules()` 取一份全新的模块注册表，模块级状态天然
 *   回到初值；`state` 也一并从新注册表里取（不能用顶层静态 import，否则拿到的是
 *   被重置掉的那个旧单例）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WpsWorksheet } from '../ts/index.js'
import type { EnrichPageState } from '../ts/panel/enrich-page-context.js'

// ========== 假宿主形状 ==========

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
  dialogConfirm: vi.fn((_message: string, callback: (isOk: boolean) => void, _title?: string) => {
    callback(true)
  }),
  getApp: vi.fn((): unknown => null),
  bgmLog: vi.fn(),
  findHeaderRow: vi.fn(() => 0),
  showToast: vi.fn(),
  detectColumns: vi.fn(),
  detectAnimeSourceLayout: vi.fn(),
  matchEntries: vi.fn(),
  enrichEntries: vi.fn(),
  findIntroSheetInWorkbook: vi.fn(),
  buildIntroSheetContext: vi.fn(),
  refreshEnrichWorkbooks: vi.fn(),
  refreshEnrichSheets: vi.fn(),
  toggleEnrichWorkbookLock: vi.fn(),
  updateEnrichLockButton: vi.fn(),
  getLockedEnrichSheet: vi.fn(),
  initEnrichLock: vi.fn(),
  autoSelectEnrichTarget: vi.fn(() => 'none'),
  getOrCreateEnrichRecordSheet: vi.fn(),
  collectDetectedWorkbookPaths: vi.fn(),
  describeOpenWorkbooks: vi.fn(() => ''),
  mergeDetectedPathsIntoStorage: vi.fn(),
  findWorkbookByName: vi.fn(),
  recomputeScrollspy: vi.fn(),
  openSourceWorkbook: vi.fn(),
  closeWorkbook: vi.fn(),
  closeOpenedSourceWorkbook: vi.fn(),
  closeSourceWorkbookOnly: vi.fn(),
  ensureSourceSheet: vi.fn(),
  showSourceDetail: vi.fn(),
  hideSourceDetail: vi.fn(),
  maybeAutoCleanAfterEnrich: vi.fn(),
  showEnrichDetailButton: vi.fn(),
  showEnrichDetail: vi.fn(),
  hideEnrichDetail: vi.fn(),
  openEnrichRecordSheet: vi.fn(),
  clearRecords: vi.fn(),
  loadRecentRecords: vi.fn(),
  createInlineProgress: vi.fn(),
  collectAllConflicts: vi.fn(),
  bindConflictDialogButtons: vi.fn(),
  showConflictDialog: vi.fn(),
  detectHeaderOnSheet: vi.fn(),
  previewMatch: vi.fn(),
  hideMatchDetail: vi.fn(),
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
vi.mock('../ts/sync/enrich-engine.js', () => ({
  detectColumns: m.detectColumns,
  detectAnimeSourceLayout: m.detectAnimeSourceLayout,
  matchEntries: m.matchEntries,
  enrichEntries: m.enrichEntries,
  findIntroSheetInWorkbook: m.findIntroSheetInWorkbook,
  buildIntroSheetContext: m.buildIntroSheetContext,
}))
vi.mock('../ts/sync/enrich-lock.js', () => ({
  refreshEnrichWorkbooks: m.refreshEnrichWorkbooks,
  refreshEnrichSheets: m.refreshEnrichSheets,
  toggleEnrichWorkbookLock: m.toggleEnrichWorkbookLock,
  updateEnrichLockButton: m.updateEnrichLockButton,
  getLockedEnrichSheet: m.getLockedEnrichSheet,
  initEnrichLock: m.initEnrichLock,
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

// ========== helpers ==========

function makeWs(name: string): WpsWorksheet {
  return { Name: name } as unknown as WpsWorksheet
}

function mountButton(id: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.id = id
  document.body.append(button)
  return button
}

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

function mountDiv(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.id = id
  document.body.append(element)
  return element
}

/** 批量挂载富化页全部控件（initEnrichPage 的绑定面） */
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
  const checkbox = document.createElement('input')
  checkbox.id = 'closeSourceAfterDetectChk'
  checkbox.type = 'checkbox'
  document.body.append(checkbox)
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

/** 一次「启动富化页并捕获轮询回调」的会话 */
interface WatchSession {
  /** 手动触发一次轮询（即 setInterval 回调） */
  poll: () => void
  /** 模拟页面卸载 */
  stop: () => void
  /** 本次会话所属注册表里的 state 单例 */
  state: EnrichPageState
}

/** 轮询定时器被替换成这个假句柄，便于断言 clearInterval 收到的是什么 */
const FAKE_TIMER_ID = 1234

/**
 * 取一份全新的模块注册表 → 挂载 DOM → 初始化富化页 → 捕获轮询回调。
 * `app` 是注册时的宿主快照（`startEnrichWorkbookWatch` 用它取基线）。
 */
async function bootWatch(app: unknown): Promise<WatchSession> {
  vi.resetModules()
  const context = await import('../ts/panel/enrich-page-context.js')
  const page = await import('../ts/panel/enrich-page.js')

  vi.clearAllMocks()
  m.detectHeaderOnSheet.mockReturnValue({ nameCol: 1 })
  m.ensureSourceSheet.mockReturnValue(null)
  m.autoSelectEnrichTarget.mockReturnValue('none')
  m.collectDetectedWorkbookPaths.mockReturnValue([])
  m.getLockedEnrichSheet.mockReturnValue(null)
  m.enrichEntries.mockReturnValue([])
  m.matchEntries.mockReturnValue([])
  m.collectAllConflicts.mockReturnValue([])
  m.createInlineProgress.mockImplementation(() => ({ update: vi.fn(), hide: vi.fn() }))

  let poll: (() => void) | null = null
  vi.spyOn(window, 'setInterval').mockImplementation((handler: TimerHandler) => {
    poll = handler as () => void
    return FAKE_TIMER_ID
  })

  document.body.replaceChildren()
  mountEnrichControls()
  m.getApp.mockReturnValue(app)
  page.initEnrichPage()

  return {
    poll: () => {
      poll?.()
    },
    stop: () => {
      window.dispatchEvent(new Event('beforeunload'))
    },
    state: context.state,
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  sheetState.isLocked = false
  sheetState.lockedIndex = null
  sheetState.lockedName = null
  sheetState.lockedWorkbookName = null
  // 个别用例会把这两个改成抛错实现；mockReset 保证下一条用例回到干净状态
  m.refreshEnrichWorkbooks.mockReset()
  m.getApp.mockReset()
  m.getApp.mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

// ========== 工作簿变化监听 ==========

describe('enrich-page · 工作簿变化监听', () => {
  it('工作簿数量变化 → 刷新列表并重新识别目标表', async () => {
    const session = await bootWatch({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    vi.clearAllMocks()

    m.getApp.mockReturnValue({ Workbooks: { Count: 3 }, ActiveWorkbook: null })
    session.poll()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('检测到工作簿数量变化'),
    )
    expect(m.refreshEnrichWorkbooks).toHaveBeenCalledWith('workbookSelect')
    expect(m.refreshEnrichSheets).toHaveBeenCalled()
    expect(m.autoSelectEnrichTarget).toHaveBeenCalled()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('目标表自动识别结果'),
    )
  })

  it('目标表已锁定 → 仅同步列表与引用，不触发自动选择', async () => {
    const session = await bootWatch({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    vi.clearAllMocks()
    sheetState.isLocked = true

    m.getApp.mockReturnValue({ Workbooks: { Count: 2 }, ActiveWorkbook: null })
    session.poll()

    expect(m.refreshEnrichSheets).toHaveBeenCalled()
    expect(m.autoSelectEnrichTarget).not.toHaveBeenCalled()
    expect(m.bgmLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('目标表自动识别结果'),
    )
  })

  it('活动工作簿切换（数量不变）→ 同样重新识别', async () => {
    const session = await bootWatch({
      Workbooks: { Count: 1 },
      ActiveWorkbook: { Name: 'A.xlsx' },
    })
    vi.clearAllMocks()

    m.getApp.mockReturnValue({ Workbooks: { Count: 1 }, ActiveWorkbook: { Name: 'B.xlsx' } })
    session.poll()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('检测到活动工作簿切换'),
    )
    expect(m.refreshEnrichWorkbooks).toHaveBeenCalled()
  })

  it('未锁定且尚未识别到目标表 → 兜底重试 3 次后不再处理', async () => {
    const session = await bootWatch({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    vi.clearAllMocks()
    // 数量与活动工作簿都没变、state 里也没有目标表 → 每轮都命中「重试扫描」
    m.getApp.mockReturnValue({ Workbooks: { Count: 1 }, ActiveWorkbook: null })

    session.poll()
    session.poll()
    session.poll()

    expect(m.refreshEnrichWorkbooks).toHaveBeenCalledTimes(3)
    expect(m.bgmLog).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('剩余 2 次'))
    expect(m.bgmLog).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('剩余 1 次'))
    expect(m.bgmLog).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('剩余 0 次'))

    // 重试次数用尽 → 本轮无事可做
    vi.clearAllMocks()
    session.poll()
    expect(m.refreshEnrichWorkbooks).not.toHaveBeenCalled()
  })

  it('轮询时取宿主抛错 → 记警告且不冒泡', async () => {
    const session = await bootWatch({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    vi.clearAllMocks()
    m.getApp.mockImplementation(() => {
      throw new Error('COM 已断开')
    })

    expect(() => {
      session.poll()
    }).not.toThrow()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('工作簿监听轮询失败'),
    )
  })

  it('重新识别目标表时抛错 → 记警告且不冒泡', async () => {
    const session = await bootWatch({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    vi.clearAllMocks()
    m.refreshEnrichWorkbooks.mockImplementation(() => {
      throw new Error('刷新失败')
    })

    m.getApp.mockReturnValue({ Workbooks: { Count: 5 }, ActiveWorkbook: null })
    expect(() => {
      session.poll()
    }).not.toThrow()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('工作簿监听轮询失败'),
    )
  })

  it('页面卸载 → 清掉轮询定时器', async () => {
    const session = await bootWatch({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

    session.stop()

    expect(clearIntervalSpy).toHaveBeenCalledWith(FAKE_TIMER_ID)
  })

  it('未识别到目标表时不会把锁定的目标表冲掉（锁定后重试计数清零）', async () => {
    const session = await bootWatch({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    const targetSheet = makeWs('追踪')
    session.state.bangumiSheet = targetSheet
    vi.clearAllMocks()

    // 已有目标表 → 不进入兜底重试；数量与活动工作簿也没变 → 本轮不处理
    m.getApp.mockReturnValue({ Workbooks: { Count: 1 }, ActiveWorkbook: null })
    session.poll()

    expect(session.state.bangumiSheet).toBe(targetSheet)
    expect(m.refreshEnrichWorkbooks).not.toHaveBeenCalled()
  })
})
