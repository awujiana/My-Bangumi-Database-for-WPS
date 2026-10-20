// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/enrich-preview-flow.ts`（富化页预览流程）单元测试。
 *
 * 依赖形状：16 个 import **全部来自叶子模块**（`sync/enrich-engine`、`sync/workbook-auto-detect`、
 * `tools/util/index`、`tools/sanitize`、`tools/string-utilities`、`ui/stat-cards`、
 * `tools/locked-sheet`，以及四个同目录兄弟模块 `enrich-page-state` / `enrich-preview-cell` /
 * `enrich-preview-tab` / `enrich-source-workbook`），**不回引 `ts/index.js` barrel**
 * → 不存在 barrel 循环死锁，逐模块 `vi.mock` 即可接管。
 *
 * `enrich-page-context` 用**真实模块**：它的 `state` 单例就是被断言的对象，
 * `safeGetElement` 走真实 `document.getElementById`，所以「元素缺失 → 早退」这类分支
 * 是**真删 DOM** 驱动的，不是 mock 出来的。
 *
 * 因为 `state` 是模块级单例，每个用例前都要 `resetState()` 重锚全部字段，
 * 否则上一条用例残留的 `columnMapping` / `introContext` 会让早退断言静默失效。
 *
 * `sanitizeHtml` / `sanitizeTableRows` 刻意 mock 成恒等：DOMPurify 会重排属性顺序，
 * 逐字断言模板会变脆；净化本身由 `tests/xss.test.ts` 覆盖。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MatchResult } from '../ts/sync/enrich-types.js'
import type { EnrichColumnMapping } from '../ts/sync/enrich-layout.js'
import type { IntroSheetContext } from '../ts/sync/enrich-intro.js'
import type { WpsWorkbook, WpsWorksheet } from '../ts/tools/wps.js'

// ========== 依赖替身 ==========

const m = vi.hoisted(() => ({
  // sync/enrich-engine.js
  detectColumns: vi.fn<(worksheet?: unknown, headerRow?: number) => unknown>(),
  detectAnimeSourceLayout: vi.fn<(worksheet?: unknown) => unknown>(),
  matchEntries: vi.fn<(source?: unknown, target?: unknown, config?: unknown) => MatchResult[]>(),
  readPlatformValues: vi.fn<(worksheet?: unknown, row?: number, mapping?: unknown) => string[]>(),
  findIntroSheetInWorkbook: vi.fn<(workbook?: unknown, sourceName?: string) => unknown>(),
  buildIntroSheetContext: vi.fn<(sheet?: unknown) => unknown>(),
  normalizeName: vi.fn<(name: string) => string>(),
  // sync/workbook-auto-detect.js
  monthLabelFromWorkbookName: vi.fn<(name: string) => string>(),
  scanMatchingWorkbooks: vi.fn<(detector?: unknown) => unknown[]>(),
  findAnimeSourceSheetInWorkbook: vi.fn<(workbook?: unknown) => unknown>(),
  // tools/sanitize.js
  sanitizeHtml: vi.fn<(html: string) => string>(),
  sanitizeTableRows: vi.fn<(html: string) => string>(),
  // ui/stat-cards.js
  renderStatCards: vi.fn<(container?: unknown, cards?: unknown) => void>(),
  // tools/string-utilities.js
  escapeHtml: vi.fn<(value: string) => string>(),
  // tools/util/index.js
  getCellValue: vi.fn<(worksheet?: unknown, row?: number, column?: number) => string>(),
  getLastRow: vi.fn<(worksheet?: unknown) => number>(),
  findHeaderRow: vi.fn<(worksheet?: unknown) => number>(),
  getColumnMap: vi.fn<(worksheet?: unknown, headerRow?: number) => Map<string, number>>(),
  bgmLog: vi.fn<(level: number, message: string) => void>(),
  dialogAlert: vi.fn<(title: string, message: string) => void>(),
  dialogError: vi.fn<(title: string, message: string) => void>(),
  handleError: vi.fn<(error: unknown, options?: unknown) => void>(),
  // tools/locked-sheet.js
  getOpenWorkbooks: vi.fn<() => unknown[]>(),
  // panel/enrich-page-state.js
  resetEnrichPreviewConfig: vi.fn<() => void>(),
  // panel/enrich-preview-cell.js
  renderPlatformChipsCell: vi.fn<(platforms: string[]) => string>(),
  renderPreviewCell: vi.fn<(key: string, value: string) => string>(),
  // panel/enrich-preview-tab.js
  setPreviewTab: vi.fn<(tab: string) => void>(),
  applyPreviewTabVisibility: vi.fn<() => void>(),
  resetMatchResults: vi.fn<() => void>(),
  refreshMatchHintText: vi.fn<() => void>(),
  // panel/enrich-source-workbook.js
  closeOpenedSourceWorkbook: vi.fn<() => void>(),
  closeSourceWorkbookOnly: vi.fn<() => void>(),
  ensureSourceSheet: vi.fn<() => unknown>(),
}))

vi.mock('../ts/sync/enrich-layout.js', () => ({
  detectColumns: m.detectColumns,
  detectAnimeSourceLayout: m.detectAnimeSourceLayout,
  readPlatformValues: m.readPlatformValues,
}))
vi.mock('../ts/sync/enrich-normalize.js', () => ({
  normalizeName: m.normalizeName,
}))
vi.mock('../ts/sync/enrich-matching.js', () => ({
  matchEntries: m.matchEntries,
}))
vi.mock('../ts/sync/enrich-intro.js', () => ({
  findIntroSheetInWorkbook: m.findIntroSheetInWorkbook,
  buildIntroSheetContext: m.buildIntroSheetContext,
}))

vi.mock('../ts/sync/workbook-auto-detect.js', () => ({
  ANIME_SOURCE_DETECTOR: { id: 'anime-source' },
  monthLabelFromWorkbookName: m.monthLabelFromWorkbookName,
  scanMatchingWorkbooks: m.scanMatchingWorkbooks,
  findAnimeSourceSheetInWorkbook: m.findAnimeSourceSheetInWorkbook,
}))

vi.mock('../ts/tools/sanitize.js', () => ({
  sanitizeHtml: m.sanitizeHtml,
  sanitizeTableRows: m.sanitizeTableRows,
}))

vi.mock('../ts/ui/stat-cards.js', () => ({ renderStatCards: m.renderStatCards }))

vi.mock('../ts/tools/string-utilities.js', () => ({ escapeHtml: m.escapeHtml }))

vi.mock('../ts/tools/util/index.js', () => ({
  getCellValue: m.getCellValue,
  getLastRow: m.getLastRow,
  findHeaderRow: m.findHeaderRow,
  getColumnMap: m.getColumnMap,
  bgmLog: m.bgmLog,
  BGM: {
    Dialog: { alert: m.dialogAlert, error: m.dialogError },
    handleError: m.handleError,
    ErrorLevel: { ERROR: 4 },
  },
}))

vi.mock('../ts/tools/locked-sheet.js', () => ({ getOpenWorkbooks: m.getOpenWorkbooks }))

vi.mock('../ts/panel/enrich-page-state.js', () => ({
  COLUMN_MAPPING_FIELDS: [
    { key: 'nameColumn', label: '名称', required: true },
    { key: 'tagsColumn', label: 'TAGS/标签', required: false },
    { key: 'premiereCol', label: '首播', required: false },
    { key: 'episodesColumn', label: '集数', required: false },
    { key: 'weekdayCol', label: '周更时间', required: false },
    { key: 'platformCol', label: '播放平台', required: false },
    { key: 'exclusiveCol', label: '独播', required: false },
    { key: 'specialCol', label: '特殊/备注', required: false },
  ],
  resetEnrichPreviewConfig: m.resetEnrichPreviewConfig,
}))

vi.mock('../ts/panel/enrich-preview-cell.js', () => ({
  renderPlatformChipsCell: m.renderPlatformChipsCell,
  renderPreviewCell: m.renderPreviewCell,
}))

vi.mock('../ts/panel/enrich-preview-tab.js', () => ({
  setPreviewTab: m.setPreviewTab,
  applyPreviewTabVisibility: m.applyPreviewTabVisibility,
  resetMatchResults: m.resetMatchResults,
  refreshMatchHintText: m.refreshMatchHintText,
}))

vi.mock('../ts/panel/enrich-source-workbook.js', () => ({
  closeOpenedSourceWorkbook: m.closeOpenedSourceWorkbook,
  closeSourceWorkbookOnly: m.closeSourceWorkbookOnly,
  ensureSourceSheet: m.ensureSourceSheet,
}))

import { state } from '../ts/panel/enrich-page-context.js'
import {
  detectHeaderOnSheet,
  hideMatchDetail,
  previewMatch,
} from '../ts/panel/enrich-preview-flow.js'

// ========== 测试夹具 ==========

/** 预览表格的固定 DOM 骨架；「元素缺失 → 早退」的用例按需 `removeElement` 删掉对应节点 */
const FIXTURE_HTML = `
  <div id="detectResult" style="display:none">
    <span id="detectSheetName"></span>
    <span id="detectHeaderRow"></span>
    <span id="detectDataRow"></span>
  </div>
  <div id="mappingList"></div>
  <table id="sourceTable"><thead></thead><tbody></tbody></table>
  <div id="sourcePreviewHint" style="display:none"></div>
  <div id="sourceStats"></div>
  <div id="workbookTabs" style="display:none"></div>
  <div id="matchStats"></div>
  <span id="exactMatchCount"></span>
  <span id="aliasMatchCount"></span>
  <span id="unmatchedCount"></span>
  <table id="matchTable">
    <thead><tr><th>源数据</th><th>匹配方式</th><th>目标数据</th><th>详情</th></tr></thead>
    <tbody></tbody>
  </table>
  <div id="matchDetailModal" style="display:none"><div id="matchDetailBody"></div></div>
`

interface FakeSheetSpec {
  name?: string
  throwsOnName?: boolean
  parent?: unknown
}

interface FakeWorkbookSpec {
  name?: string
  fullName?: string
  throwsOnName?: boolean
  throwsOnFullName?: boolean
}

interface MatchSpec {
  animeRow?: number
  matchedAnimeName?: string
  matchType?: MatchResult['matchType']
  hasBangumiRow?: boolean
  bangumiRow?: number
  bangumiName?: string
  aliases?: string[]
  errorMessage?: string
}

/** 假工作表：只暴露本模块真正读到的 `Name` / `Parent` */
function makeSheet(spec: FakeSheetSpec = {}): WpsWorksheet {
  const sheet: Record<string, unknown> = {}
  if (spec.throwsOnName === true) {
    Object.defineProperty(sheet, 'Name', {
      get: () => {
        throw new Error('sheet closed')
      },
    })
  } else {
    sheet.Name = spec.name ?? '新番表'
  }
  if (spec.parent !== undefined) sheet.Parent = spec.parent
  return sheet as unknown as WpsWorksheet
}

/** 假工作簿：只暴露 `Name` / `FullName`，可按需让读取抛错（模拟工作簿已被关闭） */
function makeWorkbook(spec: FakeWorkbookSpec = {}): WpsWorkbook {
  const workbook: Record<string, unknown> = {}
  if (spec.throwsOnName === true) {
    Object.defineProperty(workbook, 'Name', {
      get: () => {
        throw new Error('workbook closed')
      },
    })
  } else {
    workbook.Name = spec.name ?? '26年4月新番'
  }
  if (spec.throwsOnFullName === true) {
    Object.defineProperty(workbook, 'FullName', {
      get: () => {
        throw new Error('workbook closed')
      },
    })
  } else {
    workbook.FullName = spec.fullName ?? 'C:/anime/26年4月新番.xlsx'
  }
  return workbook as unknown as WpsWorkbook
}

/** 列映射：`nameColumn` 是唯一必填项 */
function makeMapping(overrides: Partial<EnrichColumnMapping> = {}): EnrichColumnMapping {
  const mapping: EnrichColumnMapping = { nameColumn: 3 }
  for (const [key, value] of Object.entries(overrides)) {
    Reflect.set(mapping, key, value)
  }
  return mapping
}

/** 匹配结果：默认一条精确命中，`hasBangumiRow: false` 用于构造「未匹配到目标行」 */
function makeMatch(spec: MatchSpec = {}): MatchResult {
  const match: MatchResult = {
    animeRow: spec.animeRow ?? 5,
    matchedAnimeName: spec.matchedAnimeName ?? '某番',
    matchType: spec.matchType ?? 'exact',
  }
  if (spec.hasBangumiRow !== false) match.bangumiRow = spec.bangumiRow ?? 20
  if (spec.bangumiName !== undefined) match.bangumiName = spec.bangumiName
  if (spec.aliases !== undefined) match.aliases = spec.aliases
  if (spec.errorMessage !== undefined) match.errorMessage = spec.errorMessage
  return match
}

/** 简介表上下文：`nameIndex` 的键是 `normalizeName` 的结果（本测试里为恒等） */
function makeIntroContext(
  sheet: WpsWorksheet,
  mapping: EnrichColumnMapping,
  entries: [string, number][],
): IntroSheetContext {
  return { sheet, headerRow: 1, dataStartRow: 2, mapping, nameIndex: new Map(entries) }
}

/** 连续行号，避免在用例里写 `Array.from` 的占位参数 */
function rowNumbers(start: number, count: number): number[] {
  const rows: number[] = []
  for (let row = start; row < start + count; row += 1) rows.push(row)
  return rows
}

function elementById(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`fixture element missing: ${id}`)
  return element
}

function removeElement(id: string): void {
  document.getElementById(id)?.remove()
}

/** 取到才继续，取不到直接抛 —— 避免用例里散落非空断言 */
function required<T extends Element>(found: T | null, label: string): T {
  if (!found) throw new Error(`element not found: ${label}`)
  return found
}

function mappingList(): HTMLElement {
  return elementById('mappingList')
}

/** 按下拉框的 `data-field` 取到具体那个 select */
function mappingSelect(field: string): HTMLSelectElement {
  const selects = [...mappingList().querySelectorAll<HTMLSelectElement>(':scope .mapping-select')]
  const found = selects.find((select) => select.dataset.field === field)
  if (!found) throw new Error(`mapping select not found: ${field}`)
  return found
}

function matchTableBody(): HTMLElement {
  return required(
    elementById('matchTable').querySelector<HTMLElement>(':scope > tbody'),
    'matchTable tbody',
  )
}

function matchedTableRows(): HTMLTableRowElement[] {
  return [...matchTableBody().querySelectorAll<HTMLTableRowElement>(':scope > tr')]
}

/** 表头里的「📋 查看全部」按钮 */
function allDetailButton(): HTMLButtonElement {
  return required(
    elementById('matchTable').querySelector<HTMLButtonElement>(':scope > thead button'),
    'all-detail button',
  )
}

/** 当前源工作簿：经函数读取，避免 TS 收窄属性后再报「多余的可选链」 */
function currentSourceWorkbook(): WpsWorkbook | null {
  return state.sourceWorkbook
}

function sourceHeaderLabels(): (string | null)[] {
  return [...elementById('sourceTable').querySelectorAll(':scope > thead th')].map(
    (cell) => cell.textContent,
  )
}

/** 单元格坐标 → 值；未设置的坐标返回空串（与真实空单元格一致） */
let cellMap = new Map<string, string>()

function setCell(row: number, column: number, value: string): void {
  cellMap.set(`${String(row)}:${String(column)}`, value)
}

/** 给某一列的若干行填同一个值 */
function fillRows(rows: number[], column: number, value: string): void {
  for (const row of rows) setCell(row, column, value)
}

function loggedMessages(): string[] {
  return m.bgmLog.mock.calls.map((call) => call[1])
}

/** 把 `state` 全部字段重锚成初始值（模块级单例，必须在每个用例前复位） */
function resetState(): void {
  Object.assign(state, {
    filePath: '',
    animeSourceSheet: null,
    bangumiSheet: null,
    columnMapping: null,
    headerRow: 0,
    dataStartRow: 0,
    matches: [],
    activePreviewTab: 'source',
    hasSourcePreview: false,
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
    introContext: null,
    closeSourceAfterDetect: false,
  })
}

/** 顶层默认实现：`clearAllMocks` 只清调用记录、不清实现，故每轮都要重新锚定 */
function anchorDefaults(): void {
  m.detectAnimeSourceLayout.mockReturnValue(null)
  m.detectColumns.mockReturnValue(makeMapping())
  m.matchEntries.mockReturnValue([])
  m.readPlatformValues.mockReturnValue([])
  m.findIntroSheetInWorkbook.mockReturnValue(null)
  m.buildIntroSheetContext.mockReturnValue(null)
  m.normalizeName.mockImplementation((name) => name)
  m.monthLabelFromWorkbookName.mockImplementation((name) => name)
  m.scanMatchingWorkbooks.mockReturnValue([])
  m.findAnimeSourceSheetInWorkbook.mockReturnValue(null)
  m.sanitizeHtml.mockImplementation((html) => html)
  m.sanitizeTableRows.mockImplementation((html) => html)
  m.renderStatCards.mockReturnValue(undefined)
  m.escapeHtml.mockImplementation((value) => value)
  m.getCellValue.mockImplementation((_worksheet, row, column) => {
    if (row === undefined || column === undefined) return ''
    return cellMap.get(`${String(row)}:${String(column)}`) ?? ''
  })
  m.getLastRow.mockReturnValue(0)
  m.findHeaderRow.mockReturnValue(1)
  m.getColumnMap.mockReturnValue(new Map())
  m.dialogAlert.mockReturnValue(undefined)
  m.dialogError.mockReturnValue(undefined)
  m.handleError.mockReturnValue(undefined)
  m.getOpenWorkbooks.mockReturnValue([])
  m.resetEnrichPreviewConfig.mockReturnValue(undefined)
  m.renderPlatformChipsCell.mockImplementation(
    (platforms) => `<td class="chips">[chips:${platforms.join('|')}]</td>`,
  )
  m.renderPreviewCell.mockImplementation(
    (key, value) => `<td class="cell">[cell:${key}=${value}]</td>`,
  )
  m.setPreviewTab.mockReturnValue(undefined)
  m.applyPreviewTabVisibility.mockReturnValue(undefined)
  m.resetMatchResults.mockReturnValue(undefined)
  m.refreshMatchHintText.mockReturnValue(undefined)
  m.closeOpenedSourceWorkbook.mockReturnValue(undefined)
  m.closeSourceWorkbookOnly.mockReturnValue(undefined)
  m.ensureSourceSheet.mockReturnValue(makeSheet())
}

/** 让 `detectHeaderOnSheet` 走「命中源表布局」这条路，并在真实 DOM 上跑完渲染链 */
function detectWithMapping(mapping: EnrichColumnMapping): void {
  m.detectAnimeSourceLayout.mockReturnValue({
    headerRow: 1,
    dataStartRow: 2,
    columnMapping: mapping,
  })
  detectHeaderOnSheet(makeSheet({ name: '新番表' }), '文件')
}

/** 让 `previewMatch` 拿到完整可用的上下文 */
function primeReadyState(mapping: EnrichColumnMapping = makeMapping({ nameColumn: 3 })): void {
  state.animeSourceSheet = makeSheet({ name: '新番表' })
  state.bangumiSheet = makeSheet({ name: 'BGM' })
  state.columnMapping = mapping
  state.headerRow = 1
  state.dataStartRow = 2
  state.filePath = 'C:/anime/新番表.xlsx'
  m.ensureSourceSheet.mockReturnValue(state.animeSourceSheet)
}

/** 直接跑一次匹配预览渲染（匹配结果表 / 详情弹窗相关用例的入口） */
function runMatchPreview(
  matches: MatchResult[],
  mapping: EnrichColumnMapping = makeMapping({ nameColumn: 3 }),
): void {
  primeReadyState(mapping)
  m.matchEntries.mockReturnValue(matches)
  previewMatch()
}

/** 构造多个候选工作簿并刷新按钮条 */
function renderWorkbookTabButtons(workbooks: WpsWorkbook[]): void {
  m.scanMatchingWorkbooks.mockReturnValue(workbooks)
  detectWithMapping(makeMapping())
}

function workbookTabButtons(): HTMLButtonElement[] {
  return [...elementById('workbookTabs').querySelectorAll<HTMLButtonElement>(':scope > button')]
}

beforeEach(() => {
  vi.clearAllMocks()
  cellMap = new Map()
  document.body.innerHTML = FIXTURE_HTML
  resetState()
  anchorDefaults()
})

// ========== 表头识别 ==========

describe('detectHeaderOnSheet', () => {
  it('命中源表布局时写入状态并渲染识别结果、映射编辑与源数据预览', () => {
    const sheet = makeSheet({ name: '新番表' })
    const mapping = makeMapping({ nameColumn: 3, weekdayCol: 4 })
    m.detectAnimeSourceLayout.mockReturnValue({
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: mapping,
    })
    setCell(1, 3, '名称')

    const result = detectHeaderOnSheet(sheet, '26年4月新番')

    expect(result).toBe(mapping)
    expect(m.detectColumns).not.toHaveBeenCalled()
    expect(state.animeSourceSheet).toBe(sheet)
    expect(state.headerRow).toBe(1)
    expect(state.dataStartRow).toBe(2)
    expect(state.columnMapping).toBe(mapping)
    expect(elementById('detectResult').style.display).toBe('')
    expect(elementById('detectSheetName').textContent).toBe('新番表')
    expect(elementById('detectHeaderRow').textContent).toBe('1')
    expect(elementById('detectDataRow').textContent).toBe('2')
    expect(loggedMessages().some((text) => text.includes('表头识别成功'))).toBe(true)
  })

  it('没有源表布局时回退到 findHeaderRow 与 detectColumns', () => {
    const sheet = makeSheet({ name: '普通表' })
    const mapping = makeMapping({ nameColumn: 7 })
    m.findHeaderRow.mockReturnValue(3)
    m.detectColumns.mockReturnValue(mapping)

    const result = detectHeaderOnSheet(sheet, '普通表文件')

    expect(result).toBe(mapping)
    expect(m.findHeaderRow).toHaveBeenCalledWith(sheet)
    expect(m.detectColumns).toHaveBeenCalledWith(sheet, 3)
    expect(state.headerRow).toBe(3)
    expect(state.dataStartRow).toBe(4)
  })

  it('未检测到表头行时提示并返回 null，且不写入状态', () => {
    m.findHeaderRow.mockReturnValue(0)

    const result = detectHeaderOnSheet(makeSheet(), '无表头文件')

    expect(result).toBeNull()
    expect(m.dialogAlert).toHaveBeenCalledWith(
      '提示',
      '未检测到有效的表头行，请检查表头是否在前 10 行内',
    )
    expect(loggedMessages().some((text) => text.includes('表头识别失败'))).toBe(true)
    expect(state.columnMapping).toBeNull()
    expect(state.headerRow).toBe(0)
  })

  it('识别抛错时走 handleError 并把 Error 文案交给错误弹窗', () => {
    m.detectAnimeSourceLayout.mockImplementation(() => {
      throw new Error('COM 炸了')
    })

    const result = detectHeaderOnSheet(makeSheet(), '坏文件')

    expect(result).toBeNull()
    expect(m.handleError).toHaveBeenCalledTimes(1)
    const options = m.handleError.mock.calls[0]?.[1] as {
      context?: string
      showAlert?: boolean
      level?: number
    }
    expect(options.context).toBe('detectHeaderOnSheet')
    expect(options.showAlert).toBe(false)
    // 4 = 替身 BGM.ErrorLevel.ERROR
    expect(options.level).toBe(4)
    expect(m.dialogError).toHaveBeenCalledWith('错误', '识别表头失败: COM 炸了')
  })

  it('抛出非 Error 值时用 String(error) 兜底文案', () => {
    m.detectAnimeSourceLayout.mockImplementation(() => {
      throw '字符串异常'
    })

    const result = detectHeaderOnSheet(makeSheet(), '坏文件')

    expect(result).toBeNull()
    expect(m.dialogError).toHaveBeenCalledWith('错误', '识别表头失败: 字符串异常')
  })

  it('识别结果容器缺失时提前返回，但仍给出列映射', () => {
    const mapping = makeMapping()
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, columnMapping: mapping })
    removeElement('detectResult')

    const result = detectHeaderOnSheet(makeSheet(), '文件')

    expect(result).toBe(mapping)
    expect(state.columnMapping).toBe(mapping)
  })

  it('识别结果子元素缺失时不崩且不写入', () => {
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, columnMapping: makeMapping() })
    removeElement('detectSheetName')
    removeElement('detectHeaderRow')
    removeElement('detectDataRow')

    expect(() => {
      detectHeaderOnSheet(makeSheet(), '文件')
    }).not.toThrow()
  })

  it('工作表名为空时日志里回退成「未知」', () => {
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, columnMapping: makeMapping() })

    detectHeaderOnSheet(makeSheet({ name: '' }), '文件')

    expect(loggedMessages().some((text) => text.includes('工作表=未知'))).toBe(true)
  })
})

// ========== 列映射编辑 ==========

describe('列映射下拉与 updateColumnMapping', () => {
  it('映射容器缺失时跳过渲染', () => {
    removeElement('mappingList')

    expect(() => {
      detectWithMapping(makeMapping())
    }).not.toThrow()
  })

  it('为每个映射字段渲染 50 个列选项、必填星号与当前列选中态', () => {
    setCell(1, 3, '名称')

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    const selects = mappingList().querySelectorAll<HTMLSelectElement>(':scope .mapping-select')
    expect(selects).toHaveLength(8)
    expect(selects[0]?.value).toBe('3')
    const options = selects[0]?.querySelectorAll(':scope > option') ?? []
    expect(options).toHaveLength(51)
    expect(options[3]?.textContent).toBe('名称 (列3)')
    expect(mappingList().textContent).toContain('*')
  })

  it('表头为空的列在选项里标注「无表头」', () => {
    detectWithMapping(makeMapping())

    const options = mappingSelect('nameColumn').querySelectorAll(':scope > option')
    expect(options[1]?.textContent).toBe('(列1，无表头)')
  })

  it('改选新列时写入列映射并记录日志', () => {
    const mapping = makeMapping({ nameColumn: 3 })

    detectWithMapping(mapping)
    const select = mappingSelect('nameColumn')
    select.value = '8'
    select.dispatchEvent(new Event('change'))

    expect(mapping.nameColumn).toBe(8)
    expect(loggedMessages().some((text) => text.includes('列映射更新: nameColumn → 列8'))).toBe(
      true,
    )
  })

  it('选到「未映射」时把该字段置为 undefined', () => {
    const mapping = makeMapping({ nameColumn: 3 })

    detectWithMapping(mapping)
    const select = mappingSelect('nameColumn')
    select.value = ''
    select.dispatchEvent(new Event('change'))

    expect(mapping.nameColumn).toBeUndefined()
    expect(loggedMessages().some((text) => text.includes('列映射更新: nameColumn → 未映射'))).toBe(
      true,
    )
  })

  it('选项值为非数字时按 0 处理', () => {
    const mapping = makeMapping({ nameColumn: 3 })

    detectWithMapping(mapping)
    const select = mappingSelect('nameColumn')
    Object.defineProperty(select, 'value', { configurable: true, get: () => '不是数字' })
    select.dispatchEvent(new Event('change'))

    expect(mapping.nameColumn).toBeUndefined()
  })

  it('列映射已被清空时改选不写入', () => {
    detectWithMapping(makeMapping())

    state.columnMapping = null
    const select = mappingSelect('nameColumn')
    select.value = '8'
    select.dispatchEvent(new Event('change'))

    expect(state.columnMapping).toBeNull()
  })
})

// ========== 源数据预览 ==========

describe('源数据预览', () => {
  it('预览表格容器缺失时提前返回，不读末行', () => {
    removeElement('sourceTable')

    detectWithMapping(makeMapping())

    expect(m.getLastRow).not.toHaveBeenCalled()
  })

  it('没有任何映射列时清空表头表体、关掉预览标记并重置匹配结果', () => {
    detectWithMapping({ nameColumn: 0 })

    const table = elementById('sourceTable')
    expect(table.querySelector(':scope > thead')?.childElementCount).toBe(0)
    expect(table.querySelector(':scope > tbody')?.childElementCount).toBe(0)
    expect(state.hasSourcePreview).toBe(false)
    expect(elementById('sourcePreviewHint').textContent).toBe(
      '尚未识别到映射列，请先在「新番表文件」中识别表头',
    )
    expect(m.resetMatchResults).toHaveBeenCalledTimes(1)
  })

  it('没有映射列且表头表体缺失时不崩', () => {
    const table = elementById('sourceTable')
    table.querySelector(':scope > thead')?.remove()
    table.querySelector(':scope > tbody')?.remove()

    expect(() => {
      detectWithMapping({ nameColumn: 0 })
    }).not.toThrow()
    expect(state.hasSourcePreview).toBe(false)
  })

  it('只列已映射字段，且平台列聚合时独播列并入平台', () => {
    m.getLastRow.mockReturnValue(3)
    setCell(2, 3, '番剧甲')
    setCell(2, 4, '周一')
    setCell(2, 6, '独播')
    m.readPlatformValues.mockReturnValue(['B站', '爱奇艺'])

    detectWithMapping(
      makeMapping({ nameColumn: 3, weekdayCol: 4, platformCol: 5, exclusiveCol: 6 }),
    )

    expect(sourceHeaderLabels()).toEqual(['', '名称', '周更时间', '播放平台'])
    expect(elementById('sourceTable').querySelector(':scope > tbody')?.innerHTML).toContain(
      '[chips:B站|爱奇艺]',
    )
    expect(m.renderPreviewCell).toHaveBeenCalledWith('weekdayCol', '周一')
  })

  it('没有平台列时独播列单独成列', () => {
    m.getLastRow.mockReturnValue(2)
    setCell(2, 3, '番剧甲')
    setCell(2, 6, '独播')

    detectWithMapping(makeMapping({ nameColumn: 3, exclusiveCol: 6 }))

    expect(sourceHeaderLabels()).toEqual(['', '名称', '独播'])
    expect(elementById('sourceTable').querySelector(':scope > tbody')?.innerHTML).toContain('独播')
  })

  it('关联简介表时按名称补出简介列', () => {
    const introSheet = makeSheet({ name: '简介' })
    const introMapping = makeMapping({ nameColumn: 2, directorCol: 4, screenplayCol: 5 })
    m.findIntroSheetInWorkbook.mockReturnValue(introSheet)
    m.buildIntroSheetContext.mockReturnValue(
      makeIntroContext(introSheet, introMapping, [['番剧甲', 7]]),
    )
    m.getLastRow.mockReturnValue(2)
    setCell(2, 3, '番剧甲')
    setCell(7, 4, '某导演')
    setCell(7, 5, '某编剧')
    state.sourceWorkbook = makeWorkbook({ name: '源工作簿' })

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    expect(sourceHeaderLabels()).toEqual(['', '名称', '导演', '编剧'])
    expect(elementById('sourceTable').querySelector(':scope > tbody')?.innerHTML).toContain(
      '某导演',
    )
  })

  it('简介表里没有同名行时简介列留空但行仍渲染', () => {
    const introSheet = makeSheet({ name: '简介' })
    m.findIntroSheetInWorkbook.mockReturnValue(introSheet)
    m.buildIntroSheetContext.mockReturnValue(
      makeIntroContext(introSheet, makeMapping({ nameColumn: 2, directorCol: 4 }), [['别的番', 9]]),
    )
    m.getLastRow.mockReturnValue(2)
    setCell(2, 3, '番剧甲')
    state.sourceWorkbook = makeWorkbook({ name: '源工作簿' })

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    const rows = elementById('sourceTable').querySelectorAll(':scope > tbody > tr')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.querySelectorAll(':scope > td')[2]?.textContent).toBe('')
  })

  it('整行没有数据时跳过该行', () => {
    m.getLastRow.mockReturnValue(4)
    setCell(3, 3, '只有这一行有数据')

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    const rows =
      elementById('sourceTable').querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.dataset.row).toBe('3')
  })

  it('表体缺失时渲染完表头即返回，不写统计卡', () => {
    elementById('sourceTable').querySelector(':scope > tbody')?.remove()

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    expect(m.renderStatCards).not.toHaveBeenCalled()
  })

  it('预览满 20 行时提示只显示前 20 行', () => {
    m.getLastRow.mockReturnValue(100)
    fillRows(rowNumbers(2, 20), 3, '番剧')

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    expect(elementById('sourceTable').querySelectorAll(':scope > tbody > tr')).toHaveLength(20)
    expect(elementById('sourcePreviewHint').textContent).toBe(
      '仅显示前 20 行，可点击「查看详细数据表格」查看完整数据',
    )
  })

  it('预览不足 20 行时不显示截断提示', () => {
    m.getLastRow.mockReturnValue(3)
    fillRows([2, 3], 3, '番剧')

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    expect(elementById('sourcePreviewHint').textContent).toBe('')
  })

  it('末行不足 20 行时以末行为准', () => {
    m.getLastRow.mockReturnValue(2)
    fillRows([2, 3, 4], 3, '番剧')

    detectWithMapping(makeMapping({ nameColumn: 3 }))

    expect(elementById('sourceTable').querySelectorAll(':scope > tbody > tr')).toHaveLength(1)
  })

  it('统计卡给出总行数、已映射字段、本次预览行数与起始行', () => {
    m.getLastRow.mockReturnValue(11)
    fillRows([2, 3, 4], 3, '番剧')

    detectWithMapping(makeMapping({ nameColumn: 3, weekdayCol: 4 }))

    const cards = m.renderStatCards.mock.calls[0]?.[1]
    expect(cards).toEqual([
      { label: '数据总行', value: 10 },
      { label: '已映射字段', value: 2 },
      { label: '本次预览', value: 3 },
      { label: '数据起始行', value: 2 },
    ])
    expect(m.applyPreviewTabVisibility).toHaveBeenCalledTimes(1)
    expect(m.resetEnrichPreviewConfig).toHaveBeenCalledTimes(1)
  })
})

// ========== 简介表发现 ==========

describe('简介表发现', () => {
  it('优先在源工作簿内查找简介表，命中即返回', () => {
    const workbook = makeWorkbook({ name: '源工作簿' })
    const introSheet = makeSheet({ name: '简介' })
    const context = makeIntroContext(introSheet, makeMapping({ nameColumn: 2 }), [])
    state.sourceWorkbook = workbook
    m.findIntroSheetInWorkbook.mockReturnValue(introSheet)
    m.buildIntroSheetContext.mockReturnValue(context)

    detectWithMapping(makeMapping())

    expect(m.findIntroSheetInWorkbook).toHaveBeenCalledWith(workbook, '新番表')
    expect(state.introContext).toBe(context)
    expect(m.getOpenWorkbooks).not.toHaveBeenCalled()
  })

  it('源工作簿未知时退回工作表的 Parent 工作簿', () => {
    const workbook = makeWorkbook({ name: '父工作簿' })
    const sheet = makeSheet({ name: '新番表', parent: workbook })
    const context = makeIntroContext(
      makeSheet({ name: '简介' }),
      makeMapping({ nameColumn: 2 }),
      [],
    )
    m.detectAnimeSourceLayout.mockReturnValue({
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping(),
    })
    m.findIntroSheetInWorkbook.mockReturnValue(makeSheet({ name: '简介' }))
    m.buildIntroSheetContext.mockReturnValue(context)

    detectHeaderOnSheet(sheet, '文件')

    expect(m.findIntroSheetInWorkbook).toHaveBeenCalledWith(workbook, '新番表')
    expect(state.introContext).toBe(context)
  })

  it('源工作簿内没找到时扫描其它已打开工作簿，命中后记日志', () => {
    const sourceWorkbook = makeWorkbook({ name: '源工作簿' })
    const otherWorkbook = makeWorkbook({ name: '2026年4月新番简介' })
    const introSheet = makeSheet({ name: '简介' })
    const context = makeIntroContext(introSheet, makeMapping({ nameColumn: 2 }), [])
    state.sourceWorkbook = sourceWorkbook
    m.getOpenWorkbooks.mockReturnValue([sourceWorkbook, otherWorkbook])
    m.findIntroSheetInWorkbook.mockImplementation((workbook) =>
      workbook === otherWorkbook ? introSheet : null,
    )
    m.buildIntroSheetContext.mockReturnValue(context)

    detectWithMapping(makeMapping())

    expect(state.introContext).toBe(context)
    expect(loggedMessages().some((text) => text.includes('找到关联简介表'))).toBe(true)
  })

  it('工作簿内找到表但构建上下文失败时继续往后找', () => {
    state.sourceWorkbook = makeWorkbook({ name: '源工作簿' })
    m.findIntroSheetInWorkbook.mockReturnValue(makeSheet({ name: '简介' }))
    m.buildIntroSheetContext.mockReturnValue(null)

    detectWithMapping(makeMapping())

    expect(state.introContext).toBeNull()
  })

  it('工作簿名称读取抛错时跳过该工作簿', () => {
    m.getOpenWorkbooks.mockReturnValue([makeWorkbook({ throwsOnName: true })])

    expect(() => {
      detectWithMapping(makeMapping())
    }).not.toThrow()
    expect(state.introContext).toBeNull()
  })

  it('其它工作簿与源工作簿同名时跳过，不重复查找', () => {
    state.sourceWorkbook = makeWorkbook({ name: '源工作簿' })
    m.getOpenWorkbooks.mockReturnValue([makeWorkbook({ name: '源工作簿' })])

    detectWithMapping(makeMapping())

    expect(m.findIntroSheetInWorkbook).toHaveBeenCalledTimes(1)
  })

  it('全部未命中时清空简介上下文', () => {
    state.introContext = makeIntroContext(makeSheet(), makeMapping(), [])

    detectWithMapping(makeMapping())

    expect(state.introContext).toBeNull()
  })
})

// ========== 工作簿切换按钮条 ==========

describe('工作簿切换按钮条', () => {
  it('按钮条容器缺失时跳过渲染', () => {
    removeElement('workbookTabs')

    expect(() => {
      renderWorkbookTabButtons([makeWorkbook({ name: '甲' }), makeWorkbook({ name: '乙' })])
    }).not.toThrow()
  })

  it('只有一个候选工作簿时隐藏按钮条并清空', () => {
    renderWorkbookTabButtons([makeWorkbook({ name: '甲' })])

    expect(elementById('workbookTabs').style.display).toBe('none')
    expect(elementById('workbookTabs').childElementCount).toBe(0)
  })

  it('多个候选时生成按钮，当前源工作簿带 active 类', () => {
    state.sourceWorkbook = makeWorkbook({ name: '甲' })
    m.monthLabelFromWorkbookName.mockImplementation((name) => `${name}·标签`)

    renderWorkbookTabButtons([makeWorkbook({ name: '乙' })])

    const buttons = workbookTabButtons()
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.className).toBe('workbook-tab active')
    expect(buttons[0]?.textContent).toBe('甲·标签')
    expect(buttons[0]?.title).toBe('甲')
    expect(buttons[1]?.className).toBe('workbook-tab')
  })

  it('没有活动源工作簿时所有按钮都不带 active', () => {
    renderWorkbookTabButtons([makeWorkbook({ name: '甲' }), makeWorkbook({ name: '乙' })])

    expect(workbookTabButtons().every((button) => button.className === 'workbook-tab')).toBe(true)
  })

  it('源工作簿已关闭（读名抛错）时表头识别整链仍渲染', () => {
    // 回归：读名抛错原先会冒泡到 detectHeaderOnSheet 的 catch，使渲染链静默中断
    state.sourceWorkbook = makeWorkbook({ throwsOnName: true })
    m.monthLabelFromWorkbookName.mockImplementation((name) => `[${name}]`)

    // 抛错的工作簿会被 collectWorkbookTabs() 跳过，需另给两个候选才会走到 activeWorkbookName()
    renderWorkbookTabButtons([makeWorkbook({ name: '甲' }), makeWorkbook({ name: '乙' })])

    expect(m.dialogError).not.toHaveBeenCalled()
    expect(mappingList().querySelectorAll('.mapping-select').length).toBeGreaterThan(0)
    expect(elementById('workbookTabs').style.display).toBe('')
    expect(workbookTabButtons()).toHaveLength(2)
  })

  it('点击当前源工作簿不触发切换', () => {
    state.sourceWorkbook = makeWorkbook({ name: '甲' })

    renderWorkbookTabButtons([makeWorkbook({ name: '乙' })])
    workbookTabButtons()[0]?.click()

    expect(m.findAnimeSourceSheetInWorkbook).not.toHaveBeenCalled()
  })

  it('切换到没有新番表布局的工作簿时给出提示', () => {
    renderWorkbookTabButtons([makeWorkbook({ name: '甲' }), makeWorkbook({ name: '乙' })])
    m.findAnimeSourceSheetInWorkbook.mockReturnValue(null)

    workbookTabButtons()[0]?.click()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', '工作簿「甲」中未识别到新番表布局')
  })

  it('切换成功时更新源工作簿与文件路径，并自动刷新匹配结果', () => {
    const target = makeWorkbook({ name: '甲', fullName: 'C:/anime/甲.xlsx' })
    renderWorkbookTabButtons([target, makeWorkbook({ name: '乙' })])
    m.findAnimeSourceSheetInWorkbook.mockReturnValue(makeSheet({ name: '甲表' }))
    state.bangumiSheet = makeSheet({ name: 'BGM' })
    state.columnMapping = makeMapping({ nameColumn: 3 })

    workbookTabButtons()[0]?.click()

    expect(state.sourceWorkbook).toBe(target)
    expect(state.isSourceWorkbookOpenedByUs).toBe(false)
    expect(state.filePath).toBe('C:/anime/甲.xlsx')
    expect(m.setPreviewTab).toHaveBeenCalledWith('match')
  })

  it('切换时回收本插件自动打开且名字不同的旧工作簿', () => {
    state.sourceWorkbook = makeWorkbook({ name: '旧工作簿' })
    state.isSourceWorkbookOpenedByUs = true
    renderWorkbookTabButtons([makeWorkbook({ name: '甲' }), makeWorkbook({ name: '乙' })])
    m.findAnimeSourceSheetInWorkbook.mockReturnValue(makeSheet({ name: '甲表' }))

    workbookTabButtons()[1]?.click()

    expect(m.closeOpenedSourceWorkbook).toHaveBeenCalledTimes(1)
  })

  it('回收旧工作簿抛错时不影响切换', () => {
    renderWorkbookTabButtons([makeWorkbook({ name: '甲' }), makeWorkbook({ name: '乙' })])
    const target = makeSheet({ name: '甲表' })
    m.findAnimeSourceSheetInWorkbook.mockReturnValue(target)
    state.sourceWorkbook = makeWorkbook({ name: '旧工作簿' })
    state.isSourceWorkbookOpenedByUs = true
    m.closeOpenedSourceWorkbook.mockImplementation(() => {
      throw new Error('旧工作簿已关闭')
    })

    expect(() => {
      workbookTabButtons()[0]?.click()
    }).not.toThrow()
    expect(m.closeOpenedSourceWorkbook).toHaveBeenCalledTimes(1)
    expect(state.animeSourceSheet).toBe(target)
    expect(currentSourceWorkbook()?.Name).toBe('甲')
    expect(state.isSourceWorkbookOpenedByUs).toBe(false)
  })

  it('目标工作簿路径读取抛错时保留原文件路径', () => {
    state.filePath = 'C:/旧路径.xlsx'
    renderWorkbookTabButtons([
      makeWorkbook({ name: '甲', throwsOnFullName: true }),
      makeWorkbook({ name: '乙' }),
    ])
    m.findAnimeSourceSheetInWorkbook.mockReturnValue(makeSheet({ name: '甲表' }))

    workbookTabButtons()[0]?.click()

    expect(state.filePath).toBe('C:/旧路径.xlsx')
  })

  it('切换后识别表头失败时不更新源工作簿', () => {
    renderWorkbookTabButtons([makeWorkbook({ name: '甲' }), makeWorkbook({ name: '乙' })])
    m.findAnimeSourceSheetInWorkbook.mockReturnValue(makeSheet({ name: '甲表' }))
    m.detectAnimeSourceLayout.mockReturnValue(null)
    m.findHeaderRow.mockReturnValue(0)

    workbookTabButtons()[0]?.click()

    expect(state.sourceWorkbook).toBeNull()
  })
})

// ========== 匹配预览 ==========

describe('previewMatch', () => {
  it('拿不到源工作表时提示先选择文件', () => {
    m.ensureSourceSheet.mockReturnValue(null)

    previewMatch()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', '请先选择新番表文件并识别表头')
    expect(m.matchEntries).not.toHaveBeenCalled()
  })

  it('没有目标工作表时提示先选择目标表', () => {
    state.animeSourceSheet = makeSheet()
    m.ensureSourceSheet.mockReturnValue(state.animeSourceSheet)

    previewMatch()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', '请先选择目标 Bangumi 工作表')
  })

  it('没有列映射时提示映射未识别', () => {
    state.animeSourceSheet = makeSheet()
    state.bangumiSheet = makeSheet()
    m.ensureSourceSheet.mockReturnValue(state.animeSourceSheet)

    previewMatch()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', '列映射未正确识别，缺少名称列')
  })

  it('名称列缺失时同样提示映射未识别', () => {
    primeReadyState(makeMapping({ nameColumn: 0 }))

    previewMatch()

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', '列映射未正确识别，缺少名称列')
  })

  it('正常预览时把配置交给引擎并刷新统计、表格与页签', () => {
    primeReadyState()
    const matches = [
      makeMatch({ matchType: 'exact' }),
      makeMatch({ animeRow: 6, matchType: 'unmatched', hasBangumiRow: false }),
    ]
    m.matchEntries.mockReturnValue(matches)
    m.getColumnMap.mockReturnValue(new Map([['周更时间', 5]]))

    previewMatch()

    expect(m.matchEntries).toHaveBeenCalledWith(state.animeSourceSheet, state.bangumiSheet, {
      filePath: 'C:/anime/新番表.xlsx',
      sheetName: '新番表',
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: state.columnMapping,
      targetSheetName: 'BGM',
    })
    expect(state.matches).toBe(matches)
    expect(elementById('exactMatchCount').textContent).toBe('1')
    expect(elementById('unmatchedCount').textContent).toBe('1')
    expect(elementById('aliasMatchCount').textContent).toBe('0')
    expect(m.refreshMatchHintText).toHaveBeenCalledTimes(1)
    expect(m.setPreviewTab).toHaveBeenCalledWith('match')
    expect(loggedMessages().some((text) => text.includes('匹配预览完成: 2 条结果'))).toBe(true)
  })

  it('引擎抛错时走 handleError 与错误弹窗', () => {
    primeReadyState()
    m.matchEntries.mockImplementation(() => {
      throw new Error('匹配崩了')
    })

    previewMatch()

    expect(m.handleError).toHaveBeenCalledTimes(1)
    const options = m.handleError.mock.calls[0]?.[1] as { context?: string; showAlert?: boolean }
    expect(options.context).toBe('previewMatch')
    expect(options.showAlert).toBe(false)
    expect(m.dialogError).toHaveBeenCalledWith('错误', '匹配预览失败: 匹配崩了')
    expect(m.setPreviewTab).not.toHaveBeenCalled()
  })

  it('引擎抛出非 Error 值时用 String 兜底', () => {
    primeReadyState()
    m.matchEntries.mockImplementation(() => {
      throw { code: 500 }
    })

    previewMatch()

    expect(m.dialogError).toHaveBeenCalledWith('错误', '匹配预览失败: [object Object]')
  })

  it('预览结束后按开关回收自动打开的源工作簿', () => {
    primeReadyState()
    state.closeSourceAfterDetect = true
    state.isSourceWorkbookOpenedByUs = true

    previewMatch()

    expect(m.closeSourceWorkbookOnly).toHaveBeenCalledTimes(1)
  })

  it('keepSourceOpen 为 true 时不回收源工作簿', () => {
    primeReadyState()
    state.closeSourceAfterDetect = true
    state.isSourceWorkbookOpenedByUs = true

    previewMatch({ keepSourceOpen: true })

    expect(m.closeSourceWorkbookOnly).not.toHaveBeenCalled()
  })

  it('统计区域缺失时跳过统计渲染', () => {
    primeReadyState()
    removeElement('matchStats')

    previewMatch()

    expect(m.renderStatCards).not.toHaveBeenCalled()
  })

  it('统计数字子元素缺失时不崩', () => {
    primeReadyState()
    removeElement('exactMatchCount')
    removeElement('aliasMatchCount')
    removeElement('unmatchedCount')

    expect(() => {
      previewMatch()
    }).not.toThrow()
  })
})

// ========== 匹配结果表 ==========

describe('匹配结果表与详情弹窗', () => {
  it('匹配表体缺失时跳过渲染', () => {
    elementById('matchTable').querySelector(':scope > tbody')?.remove()

    runMatchPreview([makeMatch()])

    expect(elementById('matchDetailModal').style.display).toBe('none')
    expect(m.setPreviewTab).toHaveBeenCalledWith('match')
  })

  it('四种匹配方式各自渲染对应样式与徽标', () => {
    runMatchPreview([
      makeMatch({ matchType: 'exact' }),
      makeMatch({ animeRow: 6, matchType: 'alias' }),
      makeMatch({ animeRow: 7, matchType: 'unmatched', hasBangumiRow: false }),
      makeMatch({ animeRow: 8, matchType: 'error', hasBangumiRow: false, errorMessage: '超时' }),
    ])

    const rows = matchedTableRows()
    expect(rows.map((row) => row.className)).toEqual([
      'match-row match-exact',
      'match-row match-alias',
      'match-row match-unmatched',
      'match-row match-error',
    ])
    expect(rows.map((row) => row.querySelector(':scope .match-status')?.className)).toEqual([
      'match-status status-exact',
      'match-status status-alias',
      'match-status status-unmatched',
      'match-status status-error',
    ])
    expect(rows[3]?.querySelector(':scope .match-status')?.textContent).toBe('⚠️ 错误')
  })

  it('未知匹配方式走默认分支', () => {
    runMatchPreview([
      {
        animeRow: 5,
        matchedAnimeName: '某番',
        matchType: 'unknown',
      } as unknown as MatchResult,
    ])

    expect(matchedTableRows()[0]?.querySelector(':scope .match-status')?.className).toBe(
      'match-status status-unmatched',
    )
    expect(matchedTableRows()[0]?.querySelector(':scope .match-status')?.textContent).toBe(
      '❌ 未匹配',
    )
  })

  it('目标表没有表头时提示未匹配到目标行', () => {
    m.findHeaderRow.mockReturnValue(0)

    runMatchPreview([makeMatch()])

    expect(matchedTableRows()[0]?.innerHTML).toContain('未匹配到目标行')
    expect(m.getColumnMap).not.toHaveBeenCalled()
  })

  it('目标行号缺失时提示未匹配到目标行', () => {
    m.getColumnMap.mockReturnValue(new Map([['周更时间', 5]]))

    runMatchPreview([makeMatch({ hasBangumiRow: false })])

    expect(matchedTableRows()[0]?.innerHTML).toContain('未匹配到目标行')
  })

  it('目标表按动态表头读取对比字段，并支持标签列的备用键', () => {
    m.getColumnMap.mockReturnValue(
      new Map([
        ['周更时间', 5],
        ['标签', 7],
      ]),
    )
    setCell(20, 5, '周五')
    setCell(20, 7, '奇幻')

    runMatchPreview([makeMatch()])

    expect(matchedTableRows()[0]?.innerHTML).toContain('周五')
    expect(matchedTableRows()[0]?.innerHTML).toContain('奇幻')
    expect(matchedTableRows()[0]?.innerHTML).toContain('目标行 20')
  })

  it('目标行有列但无值时提示无对比数据', () => {
    m.getColumnMap.mockReturnValue(new Map([['周更时间', 5]]))

    runMatchPreview([makeMatch()])

    expect(matchedTableRows()[0]?.innerHTML).toContain('目标行无对比数据')
  })

  it('源侧对比字段按列映射读取，平台聚合时独播并入', () => {
    setCell(5, 4, '周一')
    m.readPlatformValues.mockReturnValue(['B站'])

    runMatchPreview(
      [makeMatch()],
      makeMapping({ nameColumn: 3, weekdayCol: 4, platformCol: 5, exclusiveCol: 6 }),
    )

    expect(m.readPlatformValues).toHaveBeenCalled()
    expect(matchedTableRows()[0]?.innerHTML).toContain('周一')
    expect(matchedTableRows()[0]?.innerHTML).toContain('B站')
    expect(matchedTableRows()[0]?.innerHTML).toContain('周更')
    expect(matchedTableRows()[0]?.innerHTML).not.toContain('独播')
  })

  it('源工作表缺失时源侧渲染为空占位', () => {
    state.animeSourceSheet = null
    state.bangumiSheet = makeSheet({ name: 'BGM' })
    state.columnMapping = makeMapping({ nameColumn: 3 })
    m.ensureSourceSheet.mockReturnValue(makeSheet({ name: '新番表' }))
    m.matchEntries.mockReturnValue([makeMatch()])

    previewMatch()

    expect(matchedTableRows()[0]?.innerHTML).toContain('cmp-empty')
  })

  it('关联简介表时源侧补出导演等字段', () => {
    const introSheet = makeSheet({ name: '简介' })
    state.introContext = makeIntroContext(
      introSheet,
      makeMapping({ nameColumn: 2, directorCol: 4 }),
      [['某番', 7]],
    )
    setCell(7, 4, '名导演')

    runMatchPreview([makeMatch()])

    expect(matchedTableRows()[0]?.innerHTML).toContain('名导演')
  })

  it('点击行内详情按钮打开弹窗并展示别名与目标信息', () => {
    runMatchPreview([makeMatch({ aliases: ['别名甲', '别名乙'], bangumiName: '目标番' })])

    required(
      matchedTableRows()[0]?.querySelector<HTMLButtonElement>(':scope .match-detail-btn') ?? null,
      'detail button',
    ).click()

    expect(elementById('matchDetailModal').style.display).toBe('flex')
    const body = elementById('matchDetailBody').innerHTML
    expect(body).toContain('源表行号')
    expect(body).toContain('别名甲')
    expect(body).toContain('别名乙')
    expect(body).toContain('目标番')
  })

  it('详情弹窗挂载点缺失时静默跳过', () => {
    runMatchPreview([makeMatch()])
    const detailButton = required(
      matchedTableRows()[0]?.querySelector<HTMLButtonElement>(':scope .match-detail-btn') ?? null,
      'detail button',
    )
    removeElement('matchDetailModal')
    removeElement('matchDetailBody')

    expect(() => {
      detailButton.click()
    }).not.toThrow()
  })

  it('表头只注入一次「查看全部」按钮，重复预览不叠加', () => {
    runMatchPreview([makeMatch()])

    expect(elementById('matchTable').querySelectorAll(':scope > thead th')).toHaveLength(5)
    expect(elementById('matchTable').querySelector(':scope > thead')?.textContent).toContain(
      '📋 查看全部 (1)',
    )

    runMatchPreview([makeMatch(), makeMatch({ animeRow: 6 })])

    expect(elementById('matchTable').querySelectorAll(':scope > thead th')).toHaveLength(5)
  })

  it('点击「查看全部」按钮按匹配方式分组汇总', () => {
    runMatchPreview([
      makeMatch({ matchType: 'exact' }),
      makeMatch({ animeRow: 6, matchType: 'alias' }),
      makeMatch({
        animeRow: 7,
        matchType: 'error',
        hasBangumiRow: false,
        errorMessage: '网络错误',
      }),
    ])

    allDetailButton().click()

    const body = elementById('matchDetailBody').innerHTML
    expect(body).toContain('✅ 精确匹配')
    expect(body).toContain('🔄 别名匹配')
    expect(body).toContain('⚠️ 错误')
    expect(body).not.toContain('❌ 未匹配')
    expect(body).toContain('网络错误')
    expect(elementById('matchDetailModal').style.display).toBe('flex')
  })

  it('「查看全部」在结果为空时给出空态提示', () => {
    runMatchPreview([])

    allDetailButton().click()

    expect(elementById('matchDetailBody').innerHTML).toContain('暂无匹配结果')
  })

  it('汇总里的跳转按钮打开对应单条详情', () => {
    runMatchPreview([
      makeMatch({ matchType: 'exact' }),
      makeMatch({ animeRow: 6, matchType: 'unmatched', hasBangumiRow: false }),
    ])

    allDetailButton().click()
    const jump = required(
      elementById('matchDetailBody').querySelector<HTMLButtonElement>(':scope .match-all-jump'),
      'jump button',
    )
    expect(jump.dataset.matchIndex).toBe('0')
    jump.click()

    const body = elementById('matchDetailBody').innerHTML
    expect(body).toContain('源表行号')
    expect(body).toContain('某番')
  })

  it('跳转按钮缺少索引数据时不做任何事', () => {
    runMatchPreview([makeMatch()])
    allDetailButton().click()
    const jump = required(
      elementById('matchDetailBody').querySelector<HTMLButtonElement>(':scope .match-all-jump'),
      'jump button',
    )
    delete jump.dataset.matchIndex

    expect(() => {
      jump.click()
    }).not.toThrow()
    expect(elementById('matchDetailModal').style.display).toBe('flex')
  })

  it('hideMatchDetail 关闭弹窗，挂载点缺失时不崩', () => {
    runMatchPreview([makeMatch()])
    required(
      matchedTableRows()[0]?.querySelector<HTMLButtonElement>(':scope .match-detail-btn') ?? null,
      'detail button',
    ).click()
    expect(elementById('matchDetailModal').style.display).toBe('flex')

    hideMatchDetail()
    expect(elementById('matchDetailModal').style.display).toBe('none')

    removeElement('matchDetailModal')
    expect(() => {
      hideMatchDetail()
    }).not.toThrow()
  })

  it('详情弹窗按匹配方式渲染状态文案，并展示错误信息', () => {
    runMatchPreview([
      makeMatch({ matchType: 'exact' }),
      makeMatch({ animeRow: 6, matchType: 'alias' }),
      makeMatch({ animeRow: 7, matchType: 'unmatched', hasBangumiRow: false }),
      makeMatch({
        animeRow: 8,
        matchType: 'error',
        hasBangumiRow: false,
        errorMessage: '网络错误',
      }),
    ])

    const expectedTexts = ['✅ 精确匹配', '🔄 别名匹配', '❌ 未匹配', '⚠️ 错误']
    const buttons = [
      ...matchTableBody().querySelectorAll<HTMLButtonElement>(':scope .match-detail-btn'),
    ]
    let detailIndex = 0
    for (const button of buttons) {
      button.click()
      expect(elementById('matchDetailBody').innerHTML).toContain(String(expectedTexts[detailIndex]))
      detailIndex += 1
    }
    expect(elementById('matchDetailBody').innerHTML).toContain('错误信息')
    expect(elementById('matchDetailBody').innerHTML).toContain('网络错误')
  })

  it('详情弹窗对未知匹配方式回退到「未知」', () => {
    runMatchPreview([
      { animeRow: 5, matchedAnimeName: '某番', matchType: 'unknown' } as unknown as MatchResult,
    ])

    required(
      matchedTableRows()[0]?.querySelector<HTMLButtonElement>(':scope .match-detail-btn') ?? null,
      'detail button',
    ).click()

    expect(elementById('matchDetailBody').innerHTML).toContain('未知')
  })
})
