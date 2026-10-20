/**
 * @fileoverview 番剧高亮页 UI 控制器
 * @module panel/highlightPage
 * @description 「按季度起点高亮最新番剧」的独立页面：日期源自选、自动/手动季目标、
 *   高亮列多选（默认值缓存）、面板内实时预览（不动表）、应用/清除。
 *
 * 三个设计约束：
 * 1. **预览不动表**：只有点「应用高亮」才写工作表（用户选定的 A 口径）；
 * 2. **地址串长度不是瓶颈**：2026-10-20 真机探针实测单次 `Range` 可接受约 524287 字符
 *    （VBA 那个 255 是 Excel 2003 时代的说法）。仍按 8000 字符 greedy 装车 + 连续行合并，
 *    且块失败会对半拆分重试——不赌平台上限，也不像宏那样整批静默失败；
 * 3. **清除只抹本插件加的绿**：上次应用的地址记录在 PluginStorage，清除精确重放，
 *    不整列 ColorIndex 乱扫（那会抹掉用户手工填的色）。
 *
 * 序列号列刻意不进高亮列列表：它的绿色是「已上传」判定色（isUploadedByColor），
 * 高亮它会让「看起来传过」与「本季新番」混淆。
 */

import { BGM_COLOR, LOG_LEVELS } from '../core/constants.js'
import { showToast } from '../ui/dialog.js'
import { escapeHtml } from '../tools/string-utilities.js'
import {
  bgmLog,
  findHeaderRow,
  getApp,
  getColumnMap,
  getDataSheet,
  getLastRow,
  markHighlightPaneLoaded,
  readRangeValues,
} from '../tools/util/index.js'
import { getConfig, setConfig } from '../tools/config.js'
import {
  currentSeason,
  formatSeasonKey,
  formatSeasonLabel,
  rowsToRangeAddresses,
  runRangeGroupsWithSplit,
  selectSeasonRows,
  splitRangeAddresses,
} from './highlight-season.js'
import type { SeasonSelectResult, YearMonth } from './highlight-season.js'
import { registerSheetChangeAutoRefresh } from './panel-auto-refresh.js'
import { initShellNav } from './shell-nav.js'
import { notifyModulesReady } from './action-buttons-gate.js'
import { initTheme, startThemeSync } from '../tools/theme.js'
import type { WpsRange, WpsWorksheet } from '../tools/wps.js'

// ===== 配置键（PluginStorage，跨会话缓存）=====

const KEY_SOURCE = 'highlight.source'
const KEY_COLUMNS = 'highlight.columns'
const KEY_MODE = 'highlight.mode'
const KEY_MANUAL = 'highlight.manual'
const KEY_AUTO_WATCH = 'highlight.autoWatch'
const KEY_LAST_APPLIED = 'highlight.lastApplied'

/** 日期源候选（规范列名，按自动模式的优先级排列） */
const SOURCE_CANDIDATES = ['开播季度', '开播日期', '完播日'] as const

/** 公式列（值已被数据页公式归一到季文本，匹配时直接比、不再归一路） */
const FORMULA_SOURCE = '开播季度'

/** 高亮填充色：与宏的 RGB(0,176,80) 一致（BGM_COLOR.DARK_GREEN = 0x00b050） */
const HIGHLIGHT_COLOR = BGM_COLOR.DARK_GREEN

/** 清除填充：xlNone；清除字体色：xlAutomatic */
const COLOR_INDEX_NONE = -4142
const COLOR_INDEX_AUTOMATIC = -4105

/** 预览行号切片最多展示几个 */
const PREVIEW_CHIP_LIMIT = 8

// ===== 页面状态 =====

interface HighlightColumn {
  /** 规范列名 */
  name: string
  /** 列号（1-based） */
  col: number
  /** 列字母 */
  letter: string
  /** 是否勾选；日期源列恒为 true 且不可取消 */
  selected: boolean
}

interface LastApplied {
  sheet: string
  addresses: string[]
}

interface PageState {
  worksheet: WpsWorksheet | null | undefined
  headerRow: number
  colMap: Map<string, number>
  /** 日期源规范列名 */
  sourceKey: string
  sourceCol: number
  /** 可选高亮列（含源列，源列恒选且不可取消） */
  columns: HighlightColumn[]
  mode: 'auto' | 'manual'
  manual: YearMonth
  lastSelect: SeasonSelectResult
  lastTarget: YearMonth | null
}

const state: PageState = {
  worksheet: null,
  headerRow: 1,
  colMap: new Map(),
  sourceKey: '',
  sourceCol: 0,
  columns: [],
  mode: 'auto',
  manual: { year: new Date().getFullYear(), month: 1 },
  lastSelect: { matchedRows: [], emptyCount: 0, invalidCount: 0 },
  lastTarget: null,
}

/** 自动跟随（SheetChange 常驻监听）的清理函数；开关关闭时为 null */
let disposeAutoWatch: (() => void) | null = null

// ===== DOM 辅助 =====

function byId(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function selectById(id: string): HTMLSelectElement | null {
  return document.getElementById(id) as HTMLSelectElement | null
}

function inputById(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null
}

function setText(id: string, text: string): void {
  const element = byId(id)
  if (element) element.textContent = text
}

// ===== 数据源与列 =====

function colLetter(col: number): string {
  let letter = ''
  let n = col
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCodePoint(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

/**
 * 解析日期源：配置指定 > 自动（开播季度 > 开播日期 > 完播日）
 * @returns 规范列名与列号；都识别不到返回 null
 */
function resolveSource(): { key: string; col: number } | null {
  const configured = getConfig(KEY_SOURCE, '', true)
  if (configured) {
    const col = state.colMap.get(configured)
    if (col !== undefined) return { key: configured, col }
  }
  for (const candidate of SOURCE_CANDIDATES) {
    const col = state.colMap.get(candidate)
    if (col !== undefined) return { key: candidate, col }
  }
  return null
}

/** 当前匹配口径：公式列的值已归一，直接比；原始日期列先归一再比 */
function isFormulaSource(): boolean {
  return state.sourceKey === FORMULA_SOURCE
}

/**
 * 重建高亮列列表：**列出全部可选列**（源列恒选置顶，序列号列刻意排除）
 *
 * 曾经只列缓存里已有的列，导致首次使用只有「源列 + 名称」，且**没有任何 UI 能把
 * 别的列加进来**——勾选框只能取消、不能新增（真机反馈：高亮列不能选择更多的）。
 */
function rebuildColumns(): void {
  const cached = new Set<string>()
  try {
    const raw = getConfig(KEY_COLUMNS, '', true)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') cached.add(item)
        }
      }
    }
  } catch {
    bgmLog(LOG_LEVELS.WARN, '[highlight] 高亮列缓存解析失败，按默认处理')
  }

  const columns: HighlightColumn[] = []
  for (const [name, col] of state.colMap) {
    // 序列号列的绿色是「已上传」判定色，高亮它会混淆两种语义，故不进列表
    const isSequenceColumn = name === '序列号'
    const isSource = name === state.sourceKey
    // 首次使用（无缓存）默认带「名称」作视觉锚点
    const isFirstRunDefault = cached.size === 0 && name === '名称'
    if (!isSequenceColumn) {
      columns.push({
        name,
        col,
        letter: colLetter(col),
        selected: isSource || isFirstRunDefault || cached.has(name),
      })
    }
  }

  // 源列恒选置顶：列映射变化等边缘情况下也要在，且不让用户取消
  columns.sort((a, b) => Number(b.name === state.sourceKey) - Number(a.name === state.sourceKey))

  state.columns = columns
}

function renderSourceSelect(): void {
  const select = selectById('highlightSource')
  if (!select) return
  const configured = getConfig(KEY_SOURCE, '', true)
  const options: string[] = ['__auto__']
  for (const candidate of SOURCE_CANDIDATES) {
    if (state.colMap.has(candidate)) options.push(candidate)
  }
  select.innerHTML = options
    .map((value) => {
      const label = value === '__auto__' ? '自动（公式列优先）' : value
      const isSelected = configured === value || (configured === '' && value === '__auto__')
      return `<option value="${escapeHtml(value)}"${isSelected ? ' selected' : ''}>${escapeHtml(label)}</option>`
    })
    .join('')
}

function renderColumnList(): void {
  const container = byId('highlightColList')
  if (!container) return
  container.innerHTML = state.columns
    .map((c) => {
      const isLocked = c.name === state.sourceKey
      return `
      <label class="highlight-row">
        <input type="checkbox" data-col="${escapeHtml(c.name)}"${c.selected ? ' checked' : ''}${
          isLocked ? ' disabled' : ''
        } />
        <span class="highlight-col-name">${escapeHtml(c.name)}${isLocked ? '（日期源，必选）' : ''}</span>
        <span class="highlight-col-letter">${escapeHtml(c.letter)} 列</span>
      </label>`
    })
    .join('')
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const name = box.dataset.col ?? ''
      const column = state.columns.find((c) => c.name === name)
      if (column) column.selected = box.checked
      persistColumns()
      refreshPreview()
    })
  })
}

/** 列集合变化时才重渲列表（避免每次预览刷新都重建 DOM） */
function renderColumnListIfChanged(): void {
  const container = byId('highlightColList')
  if (!container) return
  const rendered = new Set(
    [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
      (box) => box.dataset.col ?? '',
    ),
  )
  const current = new Set(state.columns.map((c) => c.name))
  const isSame = rendered.size === current.size && [...current].every((name) => rendered.has(name))
  if (!isSame) renderColumnList()
}

function persistColumns(): void {
  const checked = state.columns.filter((c) => c.selected).map((c) => c.name)
  // 源列必须留在缓存里：换表后源列可能变（公式列 → 原始日期列），届时它仍要默认勾上
  const withSource =
    state.sourceKey && !checked.includes(state.sourceKey) ? [state.sourceKey, ...checked] : checked
  setConfig(KEY_COLUMNS, JSON.stringify(withSource))
}

// ===== 预览 =====

function currentTarget(): YearMonth {
  if (state.mode === 'manual') return state.manual
  return currentSeason(new Date())
}

function refreshPreview(): void {
  const { worksheet } = state
  if (!worksheet) return

  const source = resolveSource()
  if (!source) {
    state.lastSelect = { matchedRows: [], emptyCount: 0, invalidCount: 0 }
    state.lastTarget = null
    renderPreviewEmpty('未识别到日期列（开播季度 / 开播日期 / 完播日），请检查表头')
    return
  }
  state.sourceKey = source.key
  state.sourceCol = source.col
  rebuildColumns()
  renderColumnListIfChanged()

  const headerRow = findHeaderRow(worksheet)
  state.headerRow = headerRow
  const lastRow = getLastRow(worksheet, true, headerRow)
  const firstRow = headerRow + 1
  if (lastRow < firstRow) {
    state.lastSelect = { matchedRows: [], emptyCount: 0, invalidCount: 0 }
    renderPreviewEmpty('表里没有数据行')
    return
  }

  // 一次矩形读：日期源列 + 名称列（名称仅用于预览展示）
  const nameCol = state.colMap.get('名称')
  const readCols = new Set<number>([source.col])
  if (nameCol !== undefined) readCols.add(nameCol)
  let minCol = Infinity
  let maxCol = 0
  for (const col of readCols) {
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
  }

  const block = readRangeValues(worksheet, firstRow, lastRow, minCol, maxCol)
  if (block.length === 0) {
    state.lastSelect = { matchedRows: [], emptyCount: 0, invalidCount: 0 }
    renderPreviewEmpty('读取工作表失败，请重试')
    return
  }

  const names = new Map<number, string>()
  const rows: { row: number; value: string }[] = []
  for (const [index, line] of block.entries()) {
    const rowNo = firstRow + index
    const cells = line
    const value = cells[source.col - minCol] ?? ''
    rows.push({ row: rowNo, value })
    if (nameCol !== undefined) names.set(rowNo, cells[nameCol - minCol] ?? '')
  }

  const target = currentTarget()
  state.lastTarget = target
  state.lastSelect = selectSeasonRows(rows, target, { mapAirMonthToSeason: !isFormulaSource() })
  renderPreview(names)
}

function renderPreview(names: Map<number, string>): void {
  const { matchedRows, emptyCount, invalidCount } = state.lastSelect
  const target = state.lastTarget

  setText('highlightPreviewCount', `命中 ${String(matchedRows.length)} 行`)
  setText(
    'highlightPreviewTarget',
    target
      ? `目标：${formatSeasonLabel(target)}（${formatSeasonKey(target)}）${
          isFormulaSource() ? ' · 公式列口径' : ' · 原始日期口径'
        }`
      : '',
  )

  const chips = byId('highlightPreviewChips')
  if (chips) {
    chips.innerHTML =
      matchedRows.length === 0
        ? '<span class="highlight-chip highlight-chip-empty">无匹配行</span>'
        : matchedRows
            .slice(0, PREVIEW_CHIP_LIMIT)
            .map((row) => `<span class="highlight-chip">行 ${String(row)}</span>`)
            .join('') +
          (matchedRows.length > PREVIEW_CHIP_LIMIT
            ? `<span class="highlight-chip">…共 ${String(matchedRows.length)} 行</span>`
            : '')
  }

  const firstNames = matchedRows
    .slice(0, 3)
    .map((row) => names.get(row) ?? '')
    .filter((name) => name.trim() !== '')
  setText('highlightPreviewNames', firstNames.length > 0 ? `如：${firstNames.join('、')}` : '')
  setText(
    'highlightPreviewSkip',
    `空 ${String(emptyCount)} 格 · 非日期文本 ${String(invalidCount)} 条（已跳过）`,
  )
}

function renderPreviewEmpty(message: string): void {
  setText('highlightPreviewCount', '命中 0 行')
  setText('highlightPreviewTarget', message)
  const chips = byId('highlightPreviewChips')
  chips?.replaceChildren()
  setText('highlightPreviewNames', '')
  setText('highlightPreviewSkip', '')
}

// ===== 应用 / 清除 =====

function isLastApplied(value: unknown): value is LastApplied {
  if (value === null || typeof value !== 'object') return false
  const sheet: unknown = Reflect.get(value, 'sheet')
  const addresses: unknown = Reflect.get(value, 'addresses')
  return typeof sheet === 'string' && Array.isArray(addresses)
}

function readLastApplied(): LastApplied | null {
  const raw = getConfig(KEY_LAST_APPLIED, '', true)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isLastApplied(parsed)) {
      return {
        sheet: parsed.sheet,
        addresses: parsed.addresses.filter((a): a is string => typeof a === 'string'),
      }
    }
  } catch {
    bgmLog(LOG_LEVELS.WARN, '[highlight] 上次高亮记录解析失败')
  }
  return null
}

/** 一次性写入的样式：属性名与 WPS Range 成员一一对应，不做抽象层 */
interface RangeStyle {
  /** `Interior.Color`（ARGB） */
  fillColor?: number
  /** `Interior.ColorIndex`（`-4142` = 无填充） */
  fillColorIndex?: number
  /** `Font.Color`（ARGB） */
  fontColor?: number
  /** `Font.ColorIndex`（`-4105` = 自动） */
  fontColorIndex?: number
}

/** 写样式。Interior / Font 先取到局部量，避免把 COM 属性读两遍 */
function applyRangeStyle(range: WpsRange, style: RangeStyle): void {
  const interior = range.Interior
  if (interior) {
    if (style.fillColor !== undefined) interior.Color = style.fillColor
    if (style.fillColorIndex !== undefined) interior.ColorIndex = style.fillColorIndex
  }
  const font = range.Font
  if (font) {
    if (style.fontColor !== undefined) font.Color = style.fontColor
    if (style.fontColorIndex !== undefined) font.ColorIndex = style.fontColorIndex
  }
}

/**
 * 给一个工作表刷样式：分组装车 + 失败自动对半拆分（拆分逻辑在引擎里，可单测）。
 *
 * @returns 写入成功的组数（0 表示全部失败）
 */
function paintSheet(
  worksheet: WpsWorksheet,
  addresses: readonly string[],
  style: RangeStyle,
): number {
  return runRangeGroupsWithSplit(
    splitRangeAddresses(addresses),
    (group) => {
      applyRangeStyle(worksheet.Range(group.join(',')), style)
    },
    (group, error) => {
      bgmLog(
        LOG_LEVELS.WARN,
        `[highlight] 区域写入失败: ${(error as Error).message}（${group.join(',')}）`,
      )
    },
  )
}

function applyHighlight(isSilent = false): void {
  const { worksheet } = state
  if (!worksheet) {
    if (!isSilent) showToast('请先打开一个数据工作表', 'warn')
    return
  }
  const rows = state.lastSelect.matchedRows
  if (rows.length === 0) {
    if (!isSilent) showToast('没有可高亮的匹配行', 'warn')
    return
  }

  // 连续行合并 + 按 8000 字符装车：块失败自动对半拆（见 paintSheet）
  const addresses: string[] = []
  const selected = state.columns.filter((c) => c.selected)
  for (const column of selected) {
    addresses.push(...rowsToRangeAddresses(rows, column.letter))
  }
  const selectedColumns = state.columns.filter((c) => c.selected).length
  const painted = paintSheet(worksheet, addresses, { fillColor: HIGHLIGHT_COLOR, fontColor: 0 })
  if (painted === 0) {
    if (!isSilent) showToast('高亮写入失败，请查看日志', 'error')
    return
  }

  const record: LastApplied = { sheet: worksheet.Name, addresses }
  setConfig(KEY_LAST_APPLIED, JSON.stringify(record))
  bgmLog(
    LOG_LEVELS.INFO,
    `[highlight] 已高亮 ${String(rows.length)} 行 × ${String(selectedColumns)} 列（${String(painted)} 个区域块）`,
  )
  if (!isSilent) {
    showToast(`已高亮 ${String(rows.length)} 行 × ${String(selectedColumns)} 列`, 'success')
  }
}

function clearHighlight(isSilent = false): void {
  const record = readLastApplied()
  if (!record) {
    if (!isSilent) showToast('没有本插件施加的高亮记录', 'info')
    return
  }
  const { worksheet } = state
  if (worksheet?.Name !== record.sheet) {
    if (!isSilent) showToast(`请先切换到工作表「${record.sheet}」再清除`, 'warn')
    return
  }

  paintSheet(worksheet, record.addresses, {
    fillColorIndex: COLOR_INDEX_NONE,
    fontColorIndex: COLOR_INDEX_AUTOMATIC,
  })
  setConfig(KEY_LAST_APPLIED, '')
  bgmLog(LOG_LEVELS.INFO, '[highlight] 已清除上次高亮')
  if (!isSilent) showToast('已清除高亮', 'success')
}

// ===== 自动跟随（C 口径：默认关的可选开关）=====

function setAutoWatch(isEnabled: boolean): void {
  setConfig(KEY_AUTO_WATCH, isEnabled ? '1' : '0')
  if (isEnabled) {
    if (disposeAutoWatch) return
    const app = getApp()
    disposeAutoWatch = registerSheetChangeAutoRefresh(
      app,
      () => {
        const { worksheet } = state
        if (!worksheet) return
        refreshPreview()
        // 之前应用过且仍在同一张表 → 清旧 + 应用新，保持「表格变了高亮跟着变」
        const record = readLastApplied()
        if (record?.sheet === worksheet.Name) {
          clearHighlight(true)
          applyHighlight(true)
        }
      },
      { debounceMs: 300 },
    )
    bgmLog(LOG_LEVELS.INFO, '[highlight] 自动跟随已开启（SheetChange → 重算高亮）')
  } else {
    disposeAutoWatch?.()
    disposeAutoWatch = null
    bgmLog(LOG_LEVELS.INFO, '[highlight] 自动跟随已关闭')
  }
}

// ===== 手动年月选择器 =====

function buildManualSelectors(): void {
  const yearSelect = selectById('highlightManualYear')
  if (yearSelect) {
    const thisYear = new Date().getFullYear()
    const years = [thisYear - 3, thisYear - 2, thisYear - 1, thisYear, thisYear + 1]
    yearSelect.innerHTML = years
      .map((y) => `<option value="${String(y)}">${String(y)} 年</option>`)
      .join('')
    yearSelect.value = String(state.manual.year)
    yearSelect.addEventListener('change', () => {
      state.manual = { ...state.manual, year: Number(yearSelect.value) }
      persistMode()
      refreshPreview()
    })
  }
  const monthSelect = selectById('highlightManualMonth')
  if (monthSelect) {
    monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => index + 1)
      .map((m) => `<option value="${String(m)}">${String(m)} 月</option>`)
      .join('')
    monthSelect.value = String(state.manual.month)
    monthSelect.addEventListener('change', () => {
      state.manual = { ...state.manual, month: Number(monthSelect.value) }
      persistMode()
      refreshPreview()
    })
  }
}

function persistMode(): void {
  setConfig(KEY_MODE, state.mode)
  setConfig(
    KEY_MANUAL,
    `${String(state.manual.year)}-${String(state.manual.month).padStart(2, '0')}`,
  )
}

function setMode(mode: 'auto' | 'manual'): void {
  state.mode = mode
  persistMode()
  const autoButton = byId('highlightModeAuto')
  const manualButton = byId('highlightModeManual')
  const manualBox = byId('highlightManualBox')
  autoButton?.classList.toggle('active', mode === 'auto')
  manualButton?.classList.toggle('active', mode === 'manual')
  if (manualBox) manualBox.style.display = mode === 'manual' ? 'flex' : 'none'
  refreshPreview()
}

// ===== 初始化 =====

/** 重新绑定工作表与列映射（init 与「刷新预览」按钮共用） */
function reloadSheet(): void {
  state.worksheet = getDataSheet()
  if (!state.worksheet) {
    setText('highlightSheetName', '未识别到数据工作表')
    renderPreviewEmpty('请先打开包含番剧数据的工作表，然后点「刷新预览」')
    return
  }
  state.headerRow = findHeaderRow(state.worksheet)
  state.colMap = getColumnMap(state.worksheet, state.headerRow)
  setText('highlightSheetName', state.worksheet.Name)
  renderSourceSelect()
  rebuildColumns()
  renderColumnList()
}

export function initHighlightPage(): void {
  markHighlightPaneLoaded()
  initShellNav()
  initTheme()
  startThemeSync()

  // 恢复缓存配置
  const mode = getConfig(KEY_MODE, 'auto', true)
  state.mode = mode === 'manual' ? 'manual' : 'auto'
  const manual = getConfig(KEY_MANUAL, '', true)
  const manualMatch = /^(\d{4})-(\d{1,2})$/.exec(manual)
  if (manualMatch) {
    state.manual = { year: Number(manualMatch[1]), month: Number(manualMatch[2]) }
  }

  buildManualSelectors()
  reloadSheet()

  // 事件接线（直接用元素引用，不绕 event.target）
  const sourceSelect = selectById('highlightSource')
  sourceSelect?.addEventListener('change', () => {
    const { value } = sourceSelect
    setConfig(KEY_SOURCE, value === '__auto__' ? '' : value)
    refreshPreview()
    renderColumnListIfChanged()
  })
  byId('highlightModeAuto')?.addEventListener('click', () => {
    setMode('auto')
  })
  byId('highlightModeManual')?.addEventListener('click', () => {
    setMode('manual')
  })
  byId('highlightRefreshBtn')?.addEventListener('click', () => {
    reloadSheet()
    refreshPreview()
  })
  byId('highlightApplyBtn')?.addEventListener('click', () => {
    applyHighlight()
  })
  byId('highlightClearBtn')?.addEventListener('click', () => {
    clearHighlight()
  })

  // 恢复开关状态（默认关；打开时才注册 SheetChange，不常驻）
  const watchBox = inputById('highlightAutoWatch')
  if (watchBox) {
    watchBox.checked = getConfig(KEY_AUTO_WATCH, '0', true) === '1'
    watchBox.addEventListener('change', () => {
      setAutoWatch(watchBox.checked)
    })
    if (watchBox.checked) setAutoWatch(true)
  }

  refreshPreview()

  // 启用 data-action 按钮：漏了这一步，页面按钮会灰 5 秒直到门禁超时兜底
  notifyModulesReady()
}
