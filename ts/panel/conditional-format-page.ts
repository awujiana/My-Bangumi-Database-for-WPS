/**
 * @fileoverview 条件格式管理页 UI 控制器
 * @module panel/conditionalFormatPage
 * @description 「条件格式管理」独立页：任意工作表可选、规则搜索/分组/隐藏/排序/
 *   复制粘贴/编辑、默认规则集生成、双策略应用（应用前读手工规则快照，弹模态框
 *   列出范围+公式，用户选「清掉后应用」或「保留手工规则」）。
 *
 * 本页面只做渲染与编排，判断逻辑全在纯函数引擎（conditional-format-rules.ts），宿主交互全在
 * conditional-format-apply.ts——单测覆盖在那一层，页面保持薄。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { showInput, showToast } from '../ui/dialog.js'
import { escapeHtml, columnNumberToLetter } from '../tools/string-utilities.js'
import {
  bgmLog,
  findHeaderRow,
  getApp,
  getColumnMap,
  markConditionalFormatPaneLoaded,
} from '../tools/util/index.js'
import { getConfig, setConfig } from '../tools/config.js'
import {
  CONDITIONAL_FORMAT_GROUP_HIGHLIGHT,
  CONDITIONAL_FORMAT_STRATEGY_FALLBACK,
  CONDITIONAL_FORMAT_STORE_KEY,
  CONDITIONAL_FORMAT_STRATEGY_KEY,
  IMPORTED_RULE_GROUP,
  buildDefaultRules,
  filterRules,
  firstRowOfRange,
  foreignSnapshotToRule,
  groupRules,
  parseRules,
  planApply,
  serializeRules,
  shiftFormulaRows,
} from './conditional-format-rules.js'
import type {
  ApplyStrategy,
  ConditionalFormatRule,
  ForeignRuleSnapshot,
} from './conditional-format-rules.js'
import {
  FOREIGN_RULE_PAGE_SIZE,
  buildForeignRuleHeadHtml,
  buildForeignRuleRowHtml,
  filterForeignRuleRows,
  filterRowsByScope,
  fcTypeLabel,
  paginate,
  selectionSummary,
  toForeignRuleRows,
  toggleSelection,
} from './conditional-format-table.js'
import { enterSoloMode } from '../tools/module-state.js'
import {
  applyConditionalFormatPlan,
  checkFormatConditionsReadable,
  deleteForeignRule,
  isFormatConditionsSupported,
  moveForeignRule,
  readForeignRules,
  setForeignStopIfTrue,
} from './conditional-format-apply.js'
import { initializeShellNav } from './shell-nav.js'
import { notifyModulesReady } from './action-buttons-gate.js'
import { initializeTheme, startThemeSync } from '../tools/theme.js'
import { activeWorksheet, collectSheets } from '../tools/sheet-list.js'
import type { SheetEntry } from '../tools/sheet-list.js'
import { mountDataContextNotice, registerTargetSheetApplier } from '../tools/data-context.js'

// ===== 常量 =====

/** 选中工作表持久化键 */
const KEY_SHEET = 'conditionalFormat.sheet.v1'
/**
 * 目标表锁定开关（`1` = 锁定）。
 *
 * 语义**不是** locked-sheet 那种索引锁，而是「兜底策略」：选中键失效时
 * （目标簿被关 / 目标表被删）不静默跳到活动表，改为提示重新选择 ——
 * 条件格式是**写操作**，应用到错表的代价比选不到表更高。
 */
const KEY_SHEET_LOCK = 'conditionalFormat.sheetLock'

/** 从工作表导入的既有规则所在分组（与 rules.ts 的 IMPORTED_RULE_GROUP 同源） */
const IMPORTED_GROUP = IMPORTED_RULE_GROUP

// ===== 页面状态 =====

interface PageState {
  rules: ConditionalFormatRule[]
  sheets: SheetEntry[]
  selectedKey: string
  /**
   * 锁定态下「原选中键已失效」时记录的键（正常为空串）。
   * 非空表示当前没有有效选中，且**不该**自动跳到活动表。
   */
  selectionMissing: string
  /** 复制粘贴的剪贴板（规则 id，会话内有效） */
  clipboard: string[]
  /** 正在编辑的规则 id；null = 编辑器收起 */
  editingId: string | null
  /** 编辑器是否为「新建」模式 */
  editingIsNew: boolean
  searchQuery: string
  /** 模态框里待定的策略选择（打开模态框时置位） */
  pendingStrategy: ApplyStrategy
  /** 目标工作表既有规则快照（只读展示，不参与规则库） */
  existing: ForeignRuleSnapshot[]
  /** 读取既有规则的失败原因；null = 正常读到（可能为空表） */
  existingError: string | null
  /** 既有规则表格的搜索词 */
  existingQuery: string
  /** 既有规则表格的当前页码（1 基） */
  existingPage: number
  /**
   * 既有规则表格的选中集合（1 基序号）
   *
   * 跨筛选 / 翻页保持：用户在第 2 页勾的规则，翻回第 1 页仍然勾着。
   * 换工作表或重新读取时清空（序号是「那张表」的序号，换了表就失效）。
   */
  existingSelection: Set<number>
  /**
   * 「显示其格式规则」范围：整表 / 当前选择（对齐 WPS 原生下拉）
   *
   * 当前选择 = 只列 AppliesTo 与选区相交的规则。选区取不到时退化为整表
   * 并在表格上方提示（不静默显示全部，否则用户以为「选择里没规则」）。
   */
  existingScope: 'all' | 'selection'
}

const state: PageState = {
  rules: [],
  sheets: [],
  selectedKey: '',
  selectionMissing: '',
  clipboard: [],
  editingId: null,
  editingIsNew: false,
  searchQuery: '',
  pendingStrategy: CONDITIONAL_FORMAT_STRATEGY_FALLBACK,
  existing: [],
  existingError: null,
  existingQuery: '',
  existingPage: 1,
  existingSelection: new Set<number>(),
  existingScope: 'all',
}

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

// ===== 工作表枚举（collectSheets / activeWorksheet 见 ../tools/sheet-list.js）=====

/**
 * 工作簿下拉显示名：去掉文件扩展名。
 * WPS 的 Workbook.Name 对已保存文件带扩展名（如「快递取件记录.xlsx」），未保存簿是
 * 「工作簿N」。下拉显示统一去扩展名，简洁一致；option 的 value / SheetEntry.key 仍用
 * 原名，持久化与跨页键不受影响。
 */
function workbookDisplayName(name: string): string {
  return name.replace(/\.(xlsx|xls|xlsm|xlsb|et)$/i, '')
}

/** 当前选中的工作簿名（工作簿下拉的值；从选中表反推，选中为空时读下拉兜底） */
function currentWorkbookName(): string {
  const bySelected = selectedSheet()?.workbook
  if (bySelected) return bySelected
  const select = selectById('conditionalFormatWorkbook')
  return select?.value ?? ''
}

/** 渲染目标工作簿下拉（去重的工作簿名，保持枚举顺序） */
function renderWorkbookSelect(): void {
  const select = selectById('conditionalFormatWorkbook')
  if (!select) return
  const workbookNames: string[] = []
  for (const entry of state.sheets) {
    if (!workbookNames.includes(entry.workbook)) workbookNames.push(entry.workbook)
  }
  if (workbookNames.length === 0) {
    select.innerHTML = '<option value="">（无已打开的工作簿）</option>'
    return
  }
  const current = currentWorkbookName()
  select.innerHTML = workbookNames
    .map(
      (name) =>
        `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(workbookDisplayName(name))}</option>`,
    )
    .join('')
}

function renderSheetSelect(): void {
  const select = selectById('conditionalFormatSheet')
  if (!select) return
  // 二级菜单只显示**当前工作簿下**的工作表（第一级选簿、第二级选表）
  const workbook = currentWorkbookName()
  const visible = state.sheets.filter((entry) => entry.workbook === workbook)
  // 锁定态下选中键失效：不静默跳到别的表，放一条说明让用户自己重选
  if (state.selectionMissing) {
    const options = visible.map(
      (entry) => `<option value="${escapeHtml(entry.key)}">${escapeHtml(entry.sheet)}</option>`,
    )
    const notice = `<option value="">⚠️ 原目标表 ${escapeHtml(state.selectionMissing)} 已不存在，请重新选择</option>`
    select.innerHTML = notice + options.join('')
    return
  }
  if (visible.length === 0) {
    select.innerHTML = '<option value="">（该工作簿下没有可显示的工作表）</option>'
    return
  }
  select.innerHTML = visible
    .map(
      (entry) =>
        `<option value="${escapeHtml(entry.key)}"${entry.key === state.selectedKey ? ' selected' : ''}>${escapeHtml(entry.sheet)}</option>`,
    )
    .join('')
}

function selectedSheet(): SheetEntry | null {
  return state.sheets.find((entry) => entry.key === state.selectedKey) ?? null
}

/**
 * 重新枚举并定位选中表（无历史选择时默认选中**活动工作表**）。
 *
 * 「目标表锁定」勾选时，选中键失效（目标簿被关 / 目标表被删）**不静默跳**到
 * 活动表或第一张 —— 那会让用户没注意就把条件格式应用到另一张表上。改为
 * 记录 `selectionMissing`，由 renderSheetSelect 提示重新选择。
 */
function reloadSheets(): void {
  state.sheets = collectSheets()
  const isSelectionValid = state.sheets.some((entry) => entry.key === state.selectedKey)
  if (!isSelectionValid && state.sheets.length > 0) {
    if (isSheetLocked()) {
      // 锁定：记住失效前选的是哪张表，供下拉里提示「原目标表 X 已不存在」
      state.selectionMissing = state.selectedKey || getConfig(KEY_SHEET, '', true) || '（未知）'
      state.selectedKey = ''
    } else {
      // 默认选中活动表：用户是在活动表上点开面板的，第一张往往是别的表，
      // 于是「既有规则」区显示空、而用户明明看到活动表上有规则（真机反馈）。
      // 活动表匹配不到（未打开 / 取不到）才退回首张。
      const active = activeWorksheet()
      const matched = active ? state.sheets.find((entry) => entry.worksheet === active) : undefined
      const fallback = state.sheets[0]
      state.selectedKey = (matched ?? fallback)?.key ?? ''
      state.selectionMissing = ''
    }
  } else if (isSelectionValid) {
    state.selectionMissing = ''
  }
  renderWorkbookSelect()
  renderSheetSelect()
  // 工作表列表（或选中项）变了，既有规则快照必须跟着重读——
  // 用户要在这页上直接看到「这张表现在有什么条件格式」（真机反馈：看不到）
  loadExistingRules()
}

/**
 * 目标表锁定开关（`1` = 锁定）。
 *
 * 语义**不是** locked-sheet 那种索引锁，而是「兜底策略」：见 reloadSheets 注释。
 * 默认不锁，保持既有「失效即兜底到活动表」的行为。
 */
function isSheetLocked(): boolean {
  return getConfig(KEY_SHEET_LOCK, '0') === '1'
}

/** 设置目标表锁定开关；解锁时若正处于缺失态，立刻补一次兜底定位 */
function setSheetLock(isLocked: boolean): void {
  setConfig(KEY_SHEET_LOCK, isLocked ? '1' : '0')
  if (!isLocked && state.selectionMissing) {
    reloadSheets()
    return
  }
  renderSheetSelect()
}

// ===== 工作表既有规则（只读）=====

/** 读目标工作表既有规则并渲染（表格呈现，可管理） */
function loadExistingRules(): void {
  const entry = selectedSheet()
  if (!entry) {
    state.existing = []
    state.existingError = '尚未选择目标工作表'
    renderExistingRules()
    return
  }
  const unreadable = checkFormatConditionsReadable(entry.worksheet)
  if (unreadable !== null) {
    state.existing = []
    state.existingError = `${unreadable}（既有规则读不到）`
    renderExistingRules()
    return
  }
  try {
    state.existing = readForeignRules(entry.worksheet)
    state.existingError = null
    // 读了多少条必须留痕：真机出现过「界面显示没有规则、用户坚称表上有 38 条」
    // 的争议，没有这行日志时双方都无法判断是 COM 没读到还是渲染丢了。
    bgmLog(
      LOG_LEVELS.INFO,
      `[conditionalFormat] 工作表「${entry.sheet}」读到 ${String(state.existing.length)} 条既有规则`,
    )
  } catch (error: unknown) {
    state.existing = []
    state.existingError = `读取失败：${(error as Error).message}`
  }
  // 换表 / 重读后：选中集合作废（序号是「那张表」的序号，换表即失效），
  // 不停留在越界页码（否则看到空列表，用户会以为规则没了）
  state.existingSelection = new Set<number>()
  state.existingPage = 1
  renderExistingRules()
}

/**
 * 渲染既有规则表格（分页 + 搜索 + 行内管理）
 *
 * ⚠️ 整个函数体包在 try 里：`setText(count)` 在 `container.innerHTML` **之前**执行，
 * 渲染中途抛异常会留下「计数已更新、列表还是上一次内容」的半截状态 ——
 * 表现为「显示 38 条却同时显示没有规则」这种自相矛盾的界面，
 * 而异常被上层调用栈吞掉，控制台之外看不出来（真机踩过）。
 * 故失败时显式渲染错误行，绝不静默保留旧内容。
 */
function renderExistingRules(): void {
  const container = byId('conditionalFormatExistingList')
  if (!container) return

  try {
    renderExistingRulesInner(container)
  } catch (error: unknown) {
    container.innerHTML = `<p class="conditional-format-empty">既有规则渲染失败：${escapeHtml(
      (error as Error).message,
    )}<br>请点「重新读取」重试；持续失败请把此信息反馈给开发者。</p>`
    setText('conditionalFormatExistingCount', '—')
    renderExistingPagination(1, 1)
  }
}

function renderExistingRulesInner(container: HTMLElement): void {
  if (state.existingError !== null) {
    container.innerHTML = `<p class="conditional-format-empty">${escapeHtml(state.existingError)}</p>`
    setText('conditionalFormatExistingCount', '—')
    renderExistingPagination(1, 1)
    return
  }
  if (state.existing.length === 0) {
    // 带上工作表名：默认选中漂移时（选中了另一张表）用户能立刻看出选错了表，
    // 而不是以为「我的规则丢了」
    const selected = selectedSheet()
    const sheetLabel = selected ? `「${selected.sheet}」` : '当前选中的工作表'
    container.innerHTML = `<p class="conditional-format-empty">${escapeHtml(
      sheetLabel,
    )}上没有条件格式规则。<br>若你正在看的表上有规则，请在上方「目标工作表」里切换到它。</p>`
    setText('conditionalFormatExistingCount', '0 条')
    renderExistingPagination(1, 1)
    return
  }

  const rows = toForeignRuleRows(state.existing, state.existingSelection)
  const searched = filterForeignRuleRows(rows, state.existingQuery)
  // 「显示其格式规则」= 当前选择时，还要按选区再筛一层。
  // 选区地址读不到（没选区 / 宿主不暴露）时退化为整表，并在计数里说明 ——
  // 不静默显示全部，否则用户会以为「我框的这条列上真没有规则」。
  const selectionRange = state.existingScope === 'selection' ? currentSelectionRange() : ''
  const scoped = filterRowsByScope(searched, state.existingScope, selectionRange)
  const page = paginate(scoped, state.existingPage, FOREIGN_RULE_PAGE_SIZE)
  // 分页后页码可能被收敛（删掉一页里的全部规则后），回写 state 让翻页按钮用同一页
  state.existingPage = page.page

  const hiddenByFilter = state.existing.length - scoped.length
  setText(
    'conditionalFormatExistingCount',
    `${String(state.existing.length)} 条${
      hiddenByFilter > 0
        ? `（筛出 ${String(scoped.length)} 条${
            selectionRange === '' && state.existingScope === 'selection'
              ? '，未读到选区，已按整表显示'
              : ''
          }）`
        : ''
    }`,
  )

  // 一次 innerHTML 写入（表头 + 本页行）；行内事件在容器上委托，见 handleExistingTableClick
  const summary = selectionSummary(page.items)
  container.innerHTML = `${buildForeignRuleHeadHtml(summary.isAllSelected)}${page.items
    .map((row) => buildForeignRuleRowHtml(row))
    .join('')}`

  // 全选复选框的三态：HTML 属性表达不了「部分选中」，必须走 DOM property。
  // 漏了这一步，半选时全选框显示未勾选，用户会以为「什么都没选」。
  const selectAll = container.querySelector<HTMLInputElement>('input[data-action="select-all"]')
  if (selectAll) selectAll.indeterminate = summary.isSomeSelected

  renderExistingBatchBar()
  renderExistingPagination(page.page, page.pageCount)
  // 浮动窗口顶栏的 ↑↓ / 删除要跟随选中数放开 / 禁用：
  // 按钮在 DOM 搬家范围之外，只能在这里统一同步（渲染的终点）。
  syncFloatToolbarState()
}

/** 浮动窗口顶栏按钮的可用性（选中数为 0 时 ↑↓ / 删除禁用） */
function syncFloatToolbarState(): void {
  const hasSelection = state.existingSelection.size > 0
  const setDisabled = (id: string): void => {
    const button = byId(id)
    if (button instanceof HTMLButtonElement) button.disabled = !hasSelection
  }
  setDisabled('conditionalFormatFloatUp')
  setDisabled('conditionalFormatFloatDown')
  setDisabled('conditionalFormatFloatDelete')
}

/**
 * 渲染批量操作条（选中 N 条时才出现）
 *
 * 没有选中时整条隐藏：平时屏幕上只留「全选」一个入口，不添乱。
 * 按钮全部 `data-batch-action`，与表格行内按钮一样走容器事件委托。
 */
function renderExistingBatchBar(): void {
  const bar = byId('conditionalFormatExistingBatchBar')
  if (!bar) return
  const selectedCount = state.existingSelection.size
  if (selectedCount === 0) {
    bar.replaceChildren()
    bar.classList.remove('is-visible')
    return
  }
  bar.classList.add('is-visible')
  const selectedIndices = [...state.existingSelection].sort((a, b) => a - b)
  const rebuildableCount = selectedIndices.filter((index) => {
    const snapshot = state.existing[index - 1]
    return snapshot?.kind === 'expression' && snapshot.formula !== ''
  }).length
  bar.innerHTML = `
    <span class="conditional-format-batch-count">已选 ${String(selectedCount)} 条</span>
    <button type="button" class="bgm-btn small" data-batch-action="import" ${
      rebuildableCount === 0 ? 'disabled' : ''
    } title="${rebuildableCount === 0 ? '所选规则里没有可导入的公式类规则' : `导入 ${String(rebuildableCount)} 条到规则库`}">⤵ 导入规则库</button>
    <button type="button" class="bgm-btn small danger" data-batch-action="delete" title="从工作表删除所选规则">✕ 批量删除</button>
    <button type="button" class="bgm-btn small" data-batch-action="clear" title="取消选择">取消选择</button>`
}

/** 渲染既有规则表格的分页条（页码 + 上下页） */
function renderExistingPagination(current: number, pageCount: number): void {
  const container = byId('conditionalFormatExistingPager')
  if (!container) return
  if (pageCount <= 1) {
    container.replaceChildren()
    return
  }
  container.innerHTML = `
    <button type="button" class="bgm-btn small" data-page-action="prev" ${
      current <= 1 ? 'disabled' : ''
    }>‹ 上一页</button>
    <span class="conditional-format-pager-label">第 ${String(current)} / ${String(pageCount)} 页</span>
    <button type="button" class="bgm-btn small" data-page-action="next" ${
      current >= pageCount ? 'disabled' : ''
    }>下一页 ›</button>`
}

// ===== 既有规则的行内操作与批量操作 =====

/**
 * 既有规则表格的事件委托
 *
 * **不给每行绑监听器**：实测用户的表有 347 条既有规则，逐行绑就是 347×N 个
 * 监听器 + 347 次 querySelectorAll，翻页时还要手动解绑。容器上代理一次即可。
 * 行的 1 基序号从 `data-row-index` 取（与 FormatConditions.Item 下标一致）。
 */
function handleExistingTableClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target) return
  const pageButton = target.closest<HTMLElement>('[data-page-action]')
  if (pageButton) {
    const direction = pageButton.dataset.pageAction === 'prev' ? -1 : 1
    state.existingPage = Math.max(1, state.existingPage + direction)
    renderExistingRules()
    return
  }

  // 批量操作条（在表格容器外，但同属这个浮动面板，故一并在这里分流）
  const batchButton = target.closest<HTMLButtonElement>('[data-batch-action]')
  if (batchButton) {
    handleBatchAction(batchButton.dataset.batchAction ?? '')
    return
  }

  const button = target.closest<HTMLButtonElement>('button[data-action]')
  if (!button) return
  const row = button.closest<HTMLElement>('[data-row-index]')
  const index = Number(row?.dataset.rowIndex ?? '0')
  if (!Number.isSafeInteger(index) || index < 1) return

  switch (button.dataset.action) {
    case 'import': {
      importForeignRule(index)
      break
    }
    case 'delete': {
      deleteForeignRuleRow(index)
      break
    }
    case 'up': {
      moveForeignRuleRow(index, -1)
      break
    }
    case 'down': {
      moveForeignRuleRow(index, 1)
      break
    }
    default: {
      break
    }
  }
}

/** 批量操作条的分流（导入 / 删除 / 取消选择） */
function handleBatchAction(action: string): void {
  switch (action) {
    case 'import': {
      batchImportForeignRules()
      break
    }
    case 'delete': {
      batchDeleteForeignRules()
      break
    }
    case 'clear': {
      state.existingSelection = new Set<number>()
      renderExistingRules()
      break
    }
    default: {
      break
    }
  }
}

/**
 * 批量导入所选既有规则到规则库
 *
 * 不可导入的（数据条 / 色阶等）逐条跳过并在结果里报数——不静默丢，
 * 否则用户以为 10 条全导进来了，实际只进了 3 条。
 */
function batchImportForeignRules(): void {
  const indices = [...state.existingSelection].sort((a, b) => a - b)
  const imported: ConditionalFormatRule[] = []
  let skipped = 0
  for (const index of indices) {
    const snapshot = state.existing[index - 1]
    // 用条件包裹而非 continue（项目禁 continue）：snapshot 缺失说明序号越界，
    // 跳过这条继续处理其余选中项
    if (snapshot) {
      const rule = foreignSnapshotToRule(snapshot, nextId)
      if (rule) imported.push(rule)
      else skipped += 1
    }
  }
  if (imported.length === 0) {
    showToast('所选规则里没有可导入的公式类规则', 'warn')
    return
  }
  state.rules = [...state.rules, ...imported]
  persistRules()
  renderRuleList()
  state.existingSelection = new Set<number>()
  renderExistingRules()
  showToast(
    `已导入 ${String(imported.length)} 条规则${skipped > 0 ? `（${String(skipped)} 条类型不支持，已跳过）` : ''}`,
    skipped > 0 ? 'info' : 'success',
  )
}

/**
 * 批量删除所选既有规则
 *
 * ⚠️ **必须倒序删**：删除单条会让后续规则的序号整体前移（`Item(i)` 变成 `Item(i-1)`）。
 * 正序删会「删着删着就错位」——第 3 条删掉后，原来的第 5 条变成第 4 条，
 * 而循环手里的 i 已经走到 5，于是删错了对象（真机踩过这个坑）。
 * 倒序（从大下标往小下标）则被删项后面的序号不受影响。
 */
function batchDeleteForeignRules(): void {
  const entry = selectedSheet()
  if (!entry) return
  const indices = [...state.existingSelection].sort((a, b) => b - a)
  let succeeded = 0
  const failures: string[] = []
  for (const index of indices) {
    const result = deleteForeignRule(entry.worksheet, index)
    if (result.ok) succeeded += 1
    else failures.push(`第 ${String(index)} 条：${result.error}`)
  }
  state.existingSelection = new Set<number>()
  if (failures.length > 0) {
    showToast(
      `已删除 ${String(succeeded)} 条，${String(failures.length)} 条失败（${failures[0] ?? '未知原因'}）`,
      'error',
    )
  } else {
    showToast(`已删除 ${String(succeeded)} 条规则`, 'success')
  }
  loadExistingRules()
}

/**
 * 取当前选区的 A1 地址（「显示其格式规则 = 当前选择」用）
 *
 * 读不到返回空串：调用方据此退化为整表并在计数上说明，不静默显示全部。
 */
function currentSelectionRange(): string {
  const entry = selectedSheet()
  if (!entry) return ''
  try {
    const app = getApp() as { Selection?: { Address?: string } } | null
    const address = app?.Selection?.Address
    return typeof address === 'string' ? address : ''
  } catch {
    return ''
  }
}

/**
 * 批量调整所选规则优先级
 *
 * ⚠️ **必须倒序**（与批量删除同理）：移动会改变其余规则的下标，正序走着就错位。
 * 每次只移动一格：`-1` = 把所选规则逐条顶到最高优先级，`+1` = 逐条压到最低。
 * 跨多条的精确排序需要反复重排，代价高且易错，先不做。
 */
function batchMoveForeignRules(direction: -1 | 1): void {
  const entry = selectedSheet()
  if (!entry) return
  const indices = [...state.existingSelection].sort((a, b) => b - a)
  let succeeded = 0
  let failed = 0
  for (const index of indices) {
    const result = moveForeignRule(entry.worksheet, index, direction)
    if (result.ok) succeeded += 1
    else failed += 1
  }
  if (failed > 0) {
    showToast(`已调整 ${String(succeeded)} 条，${String(failed)} 条失败`, 'error')
  } else if (succeeded > 0) {
    showToast(
      `已把 ${String(succeeded)} 条规则${direction === -1 ? '提前' : '置后'}（每次一格）`,
      'success',
    )
  }
  loadExistingRules()
}

/**
 * 既有规则表格里的 checkbox 变化（三处：选中单行 / 全选 / 如果为真则停止）
 *
 * 同一容器上按 `data-action` 分流，避免给每种 checkbox 各绑一个监听器。
 */
function handleExistingTableChange(event: Event): void {
  const target = event.target as HTMLInputElement | null
  if (!target) return

  if (target.dataset.action === 'select') {
    const row = target.closest<HTMLElement>('[data-row-index]')
    const index = Number(row?.dataset.rowIndex ?? '0')
    if (!Number.isSafeInteger(index) || index < 1) return
    // 不可变更新：改原 Set 会让「上一次渲染的旧行模型」与当前 state 指向同一对象
    state.existingSelection = toggleSelection(state.existingSelection, index, target.checked)
    renderExistingRules()
    return
  }

  if (target.dataset.action === 'select-all') {
    // 全选只作用于**当前可见页**（翻页不跨页全选）：347 条规则里「全选」通常
    // 指「这一屏我都不要了」，跨页全选反而危险（一删就是 347 条）。
    const rows = toForeignRuleRows(state.existing, state.existingSelection)
    const visible = filterForeignRuleRows(rows, state.existingQuery)
    const page = paginate(visible, state.existingPage, FOREIGN_RULE_PAGE_SIZE)
    const next = new Set(state.existingSelection)
    if (target.checked) for (const row of page.items) next.add(row.index)
    else for (const row of page.items) next.delete(row.index)
    state.existingSelection = next
    renderExistingRules()
    return
  }

  if (target.dataset.action !== 'stop') return
  const row = target.closest<HTMLElement>('[data-row-index]')
  const index = Number(row?.dataset.rowIndex ?? '0')
  if (!Number.isSafeInteger(index) || index < 1) return
  const entry = selectedSheet()
  if (!entry) return
  const result = setForeignStopIfTrue(entry.worksheet, index, target.checked)
  if (result.ok) {
    showToast(
      `第 ${String(index)} 条规则已设为${target.checked ? '命中即停' : '继续评估后续'}`,
      'success',
    )
    loadExistingRules()
  } else {
    // 写不进去要把复选框还原：否则用户以为生效了，实际没有
    target.checked = !target.checked
    showToast(`设置失败：${result.error}`, 'error')
  }
}

/** 单条既有规则导入规则库 */
function importForeignRule(index: number): void {
  const entry = selectedSheet()
  if (!entry) return
  const snapshot = state.existing[index - 1]
  if (!snapshot) {
    showToast('规则已不存在，请重新读取', 'warn')
    return
  }
  const rule = foreignSnapshotToRule(snapshot, nextId)
  if (!rule) {
    showToast(
      `第 ${String(index)} 条是${fcTypeLabel(snapshot.type, snapshot.kind)}，插件无法重建该类型，不能导入`,
      'warn',
    )
    return
  }
  state.rules = [...state.rules, rule]
  persistRules()
  renderRuleList()
  showToast(`已导入第 ${String(index)} 条规则到「${IMPORTED_GROUP}」`, 'success')
}

/** 从工作表删除单条既有规则 */
function deleteForeignRuleRow(index: number): void {
  const entry = selectedSheet()
  if (!entry) return
  const snapshot = state.existing[index - 1]
  if (!snapshot) {
    showToast('规则已不存在，请重新读取', 'warn')
    return
  }
  const label = snapshot.range || `第 ${String(index)} 条`
  const result = deleteForeignRule(entry.worksheet, index)
  if (!result.ok) {
    showToast(`删除失败：${result.error}`, 'error')
    return
  }
  showToast(`已删除 ${label} 上的规则`, 'success')
  loadExistingRules()
}

/** 调整既有规则优先级 */
function moveForeignRuleRow(index: number, direction: -1 | 1): void {
  const entry = selectedSheet()
  if (!entry) return
  const total = state.existing.length
  if (index < 1 || index > total) return
  const target = index + direction
  if (target < 1 || target > total) return
  const result = moveForeignRule(entry.worksheet, index, direction)
  if (!result.ok) {
    showToast(`调整失败：${result.error}`, 'error')
    return
  }
  loadExistingRules()
}

// ===== Store 读写 =====

function loadRules(): void {
  const { rules, dropped } = parseRules(getConfig(CONDITIONAL_FORMAT_STORE_KEY, '', true))
  state.rules = rules
  if (dropped > 0) {
    bgmLog(LOG_LEVELS.WARN, `[conditionalFormat] 规则库有 ${String(dropped)} 条损坏记录已忽略`)
  }
}

function persistRules(): void {
  setConfig(CONDITIONAL_FORMAT_STORE_KEY, serializeRules(state.rules))
}

function nextId(): string {
  return `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ===== 规则列表渲染 =====

function toggleHidden(id: string, isHidden: boolean): void {
  const rule = state.rules.find((r) => r.id === id)
  if (!rule) return
  rule.hidden = isHidden
  persistRules()
  renderRuleList()
}

function moveRule(id: string, direction: -1 | 1): void {
  const index = state.rules.findIndex((r) => r.id === id)
  const target = index + direction
  if (index === -1 || target < 0 || target >= state.rules.length) return
  const current = state.rules[index]
  const neighbor = state.rules[target]
  if (!current || !neighbor) return
  state.rules[index] = neighbor
  state.rules[target] = current
  persistRules()
  renderRuleList()
}

function deleteRule(id: string): void {
  state.rules = state.rules.filter((rule) => rule.id !== id)
  state.clipboard = state.clipboard.filter((cid) => cid !== id)
  persistRules()
  renderRuleList()
}

function copyRules(ids: readonly string[]): void {
  if (ids.length === 0) return
  state.clipboard = [...ids]
  showToast(`已复制 ${String(ids.length)} 条规则到剪贴板`, 'success')
}

function pasteRules(): void {
  if (state.clipboard.length === 0) {
    showToast('剪贴板是空的，先点规则的「复制」', 'warn')
    return
  }
  const sources = state.rules.filter((rule) => state.clipboard.includes(rule.id))
  if (sources.length === 0) {
    showToast('剪贴板里的规则已不存在', 'warn')
    return
  }
  const firstRange = sources[0]?.appliesTo ?? ''
  showInput(
    '粘贴规则',
    `将粘贴 ${String(sources.length)} 条规则。目标范围（留空保持原范围）：`,
    firstRange,
    (value) => {
      const targetRange = (value ?? '').trim() || firstRange
      // 目标范围首行与原范围不同时，公式里的行号引用跟着平移（$R3 → $R10）
      const rowDelta = firstRowOfRange(targetRange) - firstRowOfRange(firstRange)
      const copies = sources.map((rule) => ({
        ...rule,
        id: nextId(),
        name: `${rule.name} 副本`,
        appliesTo: targetRange,
        formula: shiftFormulaRows(rule.formula, rowDelta),
      }))
      state.rules = [...state.rules, ...copies]
      persistRules()
      renderRuleList()
      showToast(`已粘贴 ${String(copies.length)} 条规则到 ${targetRange}`, 'success')
    },
  )
}

function renderRuleList(): void {
  const container = byId('conditionalFormatRuleList')
  if (!container) return
  const visible = filterRules(state.rules, state.searchQuery)

  if (state.rules.length === 0) {
    container.innerHTML =
      '<p class="conditional-format-empty">规则库是空的。到「默认规则集」生成一套，或点「新建规则」手写。</p>'
    setText('conditionalFormatRuleCount', '0 条规则')
    return
  }
  if (visible.length === 0) {
    container.innerHTML = '<p class="conditional-format-empty">没有匹配当前搜索词的规则。</p>'
    setText('conditionalFormatRuleCount', `0 / ${String(state.rules.length)} 条规则`)
    return
  }

  const hiddenCount = state.rules.filter((rule) => rule.hidden === true).length
  setText(
    'conditionalFormatRuleCount',
    `${String(state.rules.length)} 条规则${hiddenCount > 0 ? `（${String(hiddenCount)} 条已隐藏）` : ''}`,
  )

  const groups = groupRules(visible)
  container.innerHTML = groups
    .map(([group, rules]) => {
      const rows = rules
        .map((rule) => {
          const isHidden = rule.hidden === true
          return `
        <div class="conditional-format-rule${isHidden ? ' conditional-format-rule-hidden' : ''}" data-rule-id="${escapeHtml(rule.id)}">
          <label class="conditional-format-rule-vis" title="${isHidden ? '已隐藏：留在规则库但不应用' : '应用中'}">
            <input type="checkbox" data-action="toggle" ${isHidden ? '' : 'checked'} />
          </label>
          <span class="conditional-format-swatch" style="background:${escapeHtml(rule.interior)}" title="填充 ${escapeHtml(rule.interior)}"></span>
          <div class="conditional-format-rule-main">
            <div class="conditional-format-rule-name">${escapeHtml(rule.name)}</div>
            <div class="conditional-format-rule-meta">${escapeHtml(rule.appliesTo)} · <code title="${escapeHtml(rule.formula)}">${escapeHtml(
              rule.formula.length > 60 ? `${rule.formula.slice(0, 60)}…` : rule.formula,
            )}</code></div>
          </div>
          <div class="conditional-format-rule-actions">
            <button type="button" data-action="up" title="上移（提高优先级）">↑</button>
            <button type="button" data-action="down" title="下移（降低优先级）">↓</button>
            <button type="button" data-action="copy" title="复制">⧉</button>
            <button type="button" data-action="edit" title="编辑">✎</button>
            <button type="button" data-action="delete" title="删除">✕</button>
          </div>
        </div>`
        })
        .join('')
      return `
      <div class="conditional-format-group">
        <div class="conditional-format-group-title">${escapeHtml(group)}<span class="conditional-format-group-count">${String(rules.length)}</span></div>
        ${rows}
      </div>`
    })
    .join('')

  container.querySelectorAll<HTMLElement>('.conditional-format-rule').forEach((row) => {
    const id = row.dataset.ruleId ?? ''
    row.querySelectorAll<HTMLInputElement>('input[data-action="toggle"]').forEach((box) => {
      box.addEventListener('change', () => {
        toggleHidden(id, !box.checked)
      })
    })
    row.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const { action } = button.dataset
        switch (action) {
          case 'up': {
            moveRule(id, -1)
            break
          }
          case 'down': {
            moveRule(id, 1)
            break
          }
          case 'copy': {
            copyRules([id])
            break
          }
          case 'edit': {
            openEditor(id, false)
            break
          }
          case 'delete': {
            deleteRule(id)
            break
          }
          default: {
            break
          }
        }
      })
    })
  })
}

// ===== 规则编辑器（行内）=====

function blankRule(): ConditionalFormatRule {
  return {
    id: nextId(),
    name: '',
    group: CONDITIONAL_FORMAT_GROUP_HIGHLIGHT,
    appliesTo: '',
    formula: '',
    interior: '#00B050',
  }
}

function openEditor(id: string | null, isNew: boolean): void {
  state.editingId = id
  state.editingIsNew = isNew
  const rule = id ? state.rules.find((r) => r.id === id) : blankRule()
  if (!rule) return
  const nameInput = inputById('conditionalFormatEditName')
  const groupInput = inputById('conditionalFormatEditGroup')
  const rangeInput = inputById('conditionalFormatEditRange')
  const formulaInput = byId('conditionalFormatEditFormula') as HTMLTextAreaElement | null
  const fillInput = inputById('conditionalFormatEditFill')
  const fontInput = inputById('conditionalFormatEditFont')
  const boldInput = inputById('conditionalFormatEditBold')
  if (nameInput) nameInput.value = rule.name
  if (groupInput) groupInput.value = rule.group
  if (rangeInput) rangeInput.value = rule.appliesTo
  if (formulaInput) formulaInput.value = rule.formula
  if (fillInput) fillInput.value = rule.interior
  if (fontInput) fontInput.value = rule.fontColor ?? '#000000'
  if (boldInput) boldInput.checked = rule.fontBold === true
  const editor = byId('conditionalFormatEditor')
  if (editor) editor.style.display = 'block'
  setText('conditionalFormatEditorTitle', isNew ? '新建规则' : `编辑：${rule.name || '未命名'}`)
}

function closeEditor(): void {
  state.editingId = null
  state.editingIsNew = false
  const editor = byId('conditionalFormatEditor')
  if (editor) editor.style.display = 'none'
}

function saveEditor(): void {
  const nameInput = inputById('conditionalFormatEditName')
  const groupInput = inputById('conditionalFormatEditGroup')
  const rangeInput = inputById('conditionalFormatEditRange')
  const formulaInput = byId('conditionalFormatEditFormula') as HTMLTextAreaElement | null
  const fillInput = inputById('conditionalFormatEditFill')
  const fontInput = inputById('conditionalFormatEditFont')
  const boldInput = inputById('conditionalFormatEditBold')

  const name = nameInput?.value.trim() ?? ''
  const appliesTo = rangeInput?.value.trim() ?? ''
  const formula = formulaInput?.value.trim() ?? ''
  if (!name || !appliesTo || !formula) {
    showToast('名称、范围、公式都不能为空', 'warn')
    return
  }

  const existing = state.editingId ? state.rules.find((r) => r.id === state.editingId) : undefined
  const groupText = groupInput?.value.trim() ?? ''
  const fillText = fillInput?.value ?? ''
  const fontText = fontInput?.value ?? ''
  const isBold = boldInput?.checked === true
  const rule: ConditionalFormatRule = {
    id: existing?.id ?? nextId(),
    name,
    group: groupText === '' ? CONDITIONAL_FORMAT_GROUP_HIGHLIGHT : groupText,
    appliesTo,
    formula,
    interior: fillText === '' ? '#00B050' : fillText,
    ...(fontText !== '' && { fontColor: fontText }),
    ...(isBold && { fontBold: true }),
    ...(existing?.hidden !== undefined && { hidden: existing.hidden }),
  }

  state.rules = existing
    ? state.rules.map((r) => (r.id === rule.id ? rule : r))
    : [...state.rules, rule]
  persistRules()
  closeEditor()
  renderRuleList()
}

// ===== 默认规则集 =====

function detectColumns(): { seasonColumn: string; nameColumn: string; firstRow: number } | null {
  const entry = selectedSheet()
  if (!entry) return null
  const headerRow = findHeaderRow(entry.worksheet)
  const columnMap = getColumnMap(entry.worksheet, headerRow)
  const seasonColumnNumber = columnMap.get('开播季度')
  const nameColumnNumber = columnMap.get('名称')
  if (seasonColumnNumber === undefined || nameColumnNumber === undefined) return null
  return {
    seasonColumn: columnNumberToLetter(seasonColumnNumber),
    nameColumn: columnNumberToLetter(nameColumnNumber),
    firstRow: headerRow + 1,
  }
}

function generateDefaults(): void {
  const detected = detectColumns()
  if (!detected) {
    showToast('未识别到「开播季度」或「名称」列，无法生成默认规则（公式依赖季列）', 'warn')
    return
  }
  const defaults = buildDefaultRules({ ...detected, makeId: nextId })
  state.rules = [...state.rules, ...defaults]
  persistRules()
  renderRuleList()
  showToast(
    `已追加 ${String(defaults.length)} 条默认规则（季列 ${detected.seasonColumn} · 名称列 ${detected.nameColumn}）`,
    'success',
  )
}

// ===== 应用流程（双策略）=====

function lastStrategy(): ApplyStrategy {
  const stored = getConfig(CONDITIONAL_FORMAT_STRATEGY_KEY, '', true)
  return stored === 'append-after' ? 'append-after' : 'clear-all'
}

function runApply(strategy: ApplyStrategy): void {
  const entry = selectedSheet()
  if (!entry) {
    showToast('请先选择目标工作表', 'warn')
    return
  }
  if (!isFormatConditionsSupported(entry.worksheet)) {
    showToast('当前 WPS 版本不支持条件格式 API，该功能不可用', 'error')
    return
  }
  const visibleCount = state.rules.filter((rule) => rule.hidden !== true).length
  if (visibleCount === 0) {
    showToast('没有可应用的规则（全部隐藏了？）', 'warn')
    return
  }

  const foreign = readForeignRules(entry.worksheet)
  setConfig(CONDITIONAL_FORMAT_STRATEGY_KEY, strategy)
  const plan = planApply(state.rules, foreign, strategy)
  const result = applyConditionalFormatPlan(entry.worksheet, plan)
  if (result.failed > 0) {
    showToast(
      `写入 ${String(result.added)} 条，失败 ${String(result.failed)} 条（详见日志）`,
      'warn',
    )
  } else {
    showToast(`已写入 ${String(result.added)} 条条件格式规则`, 'success')
  }
  const discardedNote =
    plan.discarded.length > 0 ? ` · 清理手工规则 ${String(plan.discarded.length)} 条` : ''
  setText(
    'conditionalFormatApplyStatus',
    `上次应用：${entry.sheet} · ${String(result.added)} 条（失败 ${String(result.failed)}）${discardedNote}`,
  )
}

function openConfirmModal(foreign: readonly ForeignRuleSnapshot[]): void {
  const mask = byId('conditionalFormatConfirmMask')
  const body = byId('conditionalFormatConfirmBody')
  if (!mask || !body) return
  const last = lastStrategy()
  const rows = foreign
    .map(
      (rule) =>
        `<li><code>${escapeHtml(rule.range)}</code> — ${escapeHtml(
          rule.formula ||
            `（${rule.kind === 'expression' ? '公式类' : '非公式类'}规则，公式未读到）`,
        )}</li>`,
    )
    .join('')
  body.innerHTML = `
    <p>目标工作表上检测到 <strong>${String(foreign.length)}</strong> 条既有条件格式规则（你手工建的或别的工具建的）。</p>
    <p class="conditional-format-modal-label">将被处理的规则：</p>
    <ul class="conditional-format-modal-list">${rows}</ul>
    <p class="conditional-format-modal-label">怎么处理它们？</p>`
  const clearButton = byId('conditionalFormatConfirmClear')
  const keepButton = byId('conditionalFormatConfirmKeep')
  if (clearButton) {
    clearButton.textContent = last === 'clear-all' ? '清掉后应用（上次选择）' : '清掉后应用'
  }
  if (keepButton) {
    keepButton.textContent = last === 'append-after' ? '保留手工规则（上次选择）' : '保留手工规则'
  }
  mask.style.display = 'flex'
  clearButton?.focus()
}

function closeConfirmModal(): void {
  const mask = byId('conditionalFormatConfirmMask')
  if (mask) mask.style.display = 'none'
}

function applyFlow(): void {
  const entry = selectedSheet()
  if (!entry) {
    showToast('请先选择目标工作表', 'warn')
    return
  }
  if (!isFormatConditionsSupported(entry.worksheet)) {
    showToast('当前 WPS 版本不支持条件格式 API，该功能不可用', 'error')
    return
  }
  const visibleCount = state.rules.filter((rule) => rule.hidden !== true).length
  if (visibleCount === 0) {
    showToast('没有可应用的规则（全部隐藏了？）', 'warn')
    return
  }

  const foreign = readForeignRules(entry.worksheet)
  if (foreign.length === 0) {
    runApply(lastStrategy())
    return
  }
  openConfirmModal(foreign)
}

// ===== 导入手工规则 =====

function importForeign(): void {
  const entry = selectedSheet()
  if (!entry) {
    showToast('请先选择目标工作表', 'warn')
    return
  }
  if (!isFormatConditionsSupported(entry.worksheet)) {
    showToast('当前 WPS 版本不支持条件格式 API', 'error')
    return
  }
  const foreign = readForeignRules(entry.worksheet)
  const expressible = foreign
    .map((rule) => foreignSnapshotToRule(rule, nextId))
    .filter((rule): rule is ConditionalFormatRule => rule !== null)
  if (expressible.length === 0) {
    showToast(
      foreign.length === 0
        ? '这张表没有条件格式规则（可在「既有规则」卡片确认）'
        : `读取到 ${String(foreign.length)} 条规则，但没有可导入的公式类规则`,
      'info',
    )
    loadExistingRules()
    return
  }
  state.rules = [...state.rules, ...expressible]
  persistRules()
  renderRuleList()
  const skipped = foreign.length - expressible.length
  showToast(
    `已导入 ${String(expressible.length)} 条规则${skipped > 0 ? `（${String(skipped)} 条非公式类无法导入）` : ''}`,
    'success',
  )
}

// ===== 初始化 =====

export function initializeConditionalFormatPage(): void {
  markConditionalFormatPaneLoaded()
  initializeShellNav()
  initializeTheme()
  startThemeSync()

  loadRules()
  state.selectedKey = getConfig(KEY_SHEET, '', true)
  // 进入时重放：其它页获取的工作簿/表/列/行一次性显示（读一次存储，零轮询）
  mountDataContextNotice('conditional-format')
  reloadSheets()

  // 搜索
  inputById('conditionalFormatSearch')?.addEventListener('input', (event) => {
    state.searchQuery = (event.target as HTMLInputElement).value
    renderRuleList()
  })

  // 目标工作簿（第一级）：切换后二级菜单只留该簿下的表；
  // 原选中表若属于新簿则保持，否则选中该簿第一张
  selectById('conditionalFormatWorkbook')?.addEventListener('change', (event) => {
    const workbook = (event.target as HTMLSelectElement).value
    const inWorkbook = state.sheets.filter((entry) => entry.workbook === workbook)
    const isStillValid = inWorkbook.some((entry) => entry.key === state.selectedKey)
    if (!isStillValid) {
      state.selectedKey = inWorkbook[0]?.key ?? ''
      setConfig(KEY_SHEET, state.selectedKey)
    }
    // 用户主动切了簿：退出「原表已不存在」状态（否则提示条会赖着不走）
    state.selectionMissing = ''
    renderSheetSelect()
    loadExistingRules()
  })

  // 工作表选择（第二级）
  selectById('conditionalFormatSheet')?.addEventListener('change', (event) => {
    state.selectedKey = (event.target as HTMLSelectElement).value
    state.selectionMissing = ''
    setConfig(KEY_SHEET, state.selectedKey)
    loadExistingRules()
  })
  byId('conditionalFormatReloadSheetsBtn')?.addEventListener('click', () => {
    reloadSheets()
  })
  byId('conditionalFormatRefreshExistingBtn')?.addEventListener('click', () => {
    loadExistingRules()
  })

  // 目标表锁定：默认不锁（选中键失效时兜底跳活动表，保持既有行为）。
  // 勾选后失效不跳 —— 条件格式是写操作，静默应用到错表的代价太高。
  const lockBox = inputById('conditionalFormatSheetLock')
  if (lockBox) {
    lockBox.checked = isSheetLocked()
    lockBox.addEventListener('change', () => {
      setSheetLock(lockBox.checked)
    })
  }

  // 「一键套用」：把别处选中的簿/表落到本页的 KEY_SHEET 上
  registerTargetSheetApplier('conditional-format', (snap) => {
    if (!snap.workbook || !snap.sheet) return false
    const key = `${snap.workbook}::${snap.sheet}`
    const isHit = state.sheets.some((entry) => entry.key === key)
    if (!isHit) return false
    state.selectedKey = key
    state.selectionMissing = ''
    setConfig(KEY_SHEET, key)
    renderWorkbookSelect()
    renderSheetSelect()
    loadExistingRules()
    return true
  })

  // 既有规则表格：搜索 + 事件委托（不给每行绑监听器，347 条规则下才不卡）
  inputById('conditionalFormatExistingSearch')?.addEventListener('input', (event) => {
    state.existingQuery = (event.target as HTMLInputElement).value
    state.existingPage = 1
    renderExistingRules()
  })
  // 委托绑在 **panel** 上而不是表格上：批量操作条在表格容器外，
  // 且表格节点会在「正文」与「浮动窗口」之间搬家（appendChild 不丢监听器，
  // 但绑在表格上就意味着批量条要另绑一份——绑父节点一次覆盖两者）。
  byId('conditionalFormatExistingPanel')?.addEventListener('click', handleExistingTableClick)
  byId('conditionalFormatExistingPanel')?.addEventListener('change', handleExistingTableChange)

  // 浮动「规则管理器」窗口：拖动 / 缩放 / 收起 + 开关与 DOM 搬家
  bindExistingToolbar()
  setupRuleManagerEntry()

  // 规则操作
  byId('conditionalFormatNewRuleBtn')?.addEventListener('click', () => {
    openEditor(null, true)
  })
  byId('conditionalFormatPasteBtn')?.addEventListener('click', () => {
    pasteRules()
  })
  byId('conditionalFormatImportBtn')?.addEventListener('click', () => {
    importForeign()
  })
  byId('conditionalFormatDefaultsBtn')?.addEventListener('click', () => {
    generateDefaults()
  })
  byId('conditionalFormatApplyBtn')?.addEventListener('click', () => {
    applyFlow()
  })

  // 编辑器
  byId('conditionalFormatEditorSave')?.addEventListener('click', () => {
    saveEditor()
  })
  byId('conditionalFormatEditorCancel')?.addEventListener('click', () => {
    closeEditor()
  })

  // 确认模态框（双策略）
  byId('conditionalFormatConfirmClear')?.addEventListener('click', () => {
    closeConfirmModal()
    runApply('clear-all')
  })
  byId('conditionalFormatConfirmKeep')?.addEventListener('click', () => {
    closeConfirmModal()
    runApply('append-after')
  })
  byId('conditionalFormatConfirmCancel')?.addEventListener('click', () => {
    closeConfirmModal()
  })
  byId('conditionalFormatConfirmMask')?.addEventListener('click', (event) => {
    if (event.target === byId('conditionalFormatConfirmMask')) closeConfirmModal()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeConfirmModal()
  })

  renderRuleList()

  // 启用 data-action 按钮：漏了这一步，页面按钮会灰 5 秒直到门禁超时兜底
  notifyModulesReady()
}

// ===== 「既有规则」拖出为浮动「规则管理器」窗口 =====

/**
 * 绑定「规则管理器」工具条（显示其格式规则 + ↑↓ 调序 + 删除）
 *
 * 工具条常显在「既有规则」区内（任务窗格与专注模式共用同一份 DOM），
 * 与入口装配（setupRuleManagerEntry）分开：入口只管「怎么进入只看此模块」。
 */
function bindExistingToolbar(): void {
  const scopeSelect = selectById('conditionalFormatFloatScope')

  // 「显示其格式规则」：整表 / 当前选择。
  // 当前选择 = 只显示 AppliesTo 与选区相交的规则 —— 用户框了一列想看
  // 「这条列上挂了哪些条件」时不用在 347 条里翻。
  scopeSelect?.addEventListener('change', () => {
    state.existingScope = scopeSelect.value === 'selection' ? 'selection' : 'all'
    state.existingPage = 1
    renderExistingRules()
  })

  // ↑↓ / 删除：与批量条同一套实现，只是入口不同（WPS 原生的按钮位）
  byId('conditionalFormatFloatUp')?.addEventListener('click', () => {
    batchMoveForeignRules(-1)
  })
  byId('conditionalFormatFloatDown')?.addEventListener('click', () => {
    batchMoveForeignRules(1)
  })
  byId('conditionalFormatFloatDelete')?.addEventListener('click', () => {
    batchDeleteForeignRules()
  })
}

/**
 * 「规则管理器」入口：点按钮进入**专注模式**，本页只显示「既有规则」模块。
 *
 * 为什么不再是原生独立窗口：原生 WebDialog（Application.CreateWebDialog /
 * ShowDialog）即使 `IsModal=false` 也会置顶、抢焦点，挡住用户在表格上框选区 ——
 * 这是 WPS 宿主级限制，插件侧绕不过（代码已尽力传非模态）。边看表格边管规则
 * 恰恰是它的核心场景，被挡反而本末倒置，故弃用原生。
 *
 * 改用页面内专注模式：点「🔍 规则管理器」→ 本页只剩「既有规则」（配合专注模式
 * 隐藏顶栏占满任务窗格），底部控制条可 ↑↓ 切换 / 退出。任务窗格在侧边不挡
 * 表格主区，用户可同时看到规则与表格。
 */
function setupRuleManagerEntry(): void {
  byId('conditionalFormatFloatBtn')?.addEventListener('click', () => {
    enterSoloMode('conditional-format', 'sec-existing')
  })
}
