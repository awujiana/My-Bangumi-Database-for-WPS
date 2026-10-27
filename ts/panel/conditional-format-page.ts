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
import { showToast } from '../ui/dialog.js'
import { escapeHtml, columnNumberToLetter } from '../tools/string-utilities.js'
import {
  BGM,
  bgmLog,
  findHeaderRow,
  getApp,
  getColumnMap,
  markConditionalFormatPaneLoaded,
} from '../tools/util/index.js'
import {
  CLUSTER_MODE_LABELS,
  getClusterMode,
  getMergeMode,
  getConfig,
  getExportPath,
  getModalButtonsPosition,
  setConfig,
  setExportPath,
} from '../tools/config.js'
import {
  CONDITIONAL_FORMAT_GROUP_HIGHLIGHT,
  CONDITIONAL_FORMAT_STRATEGY_FALLBACK,
  CONDITIONAL_FORMAT_STORE_KEY,
  CONDITIONAL_FORMAT_STRATEGY_KEY,
  EXISTING_GROUPS_STORE_KEY,
  EXISTING_ANCHORS_STORE_KEY,
  anchorKeyOf,
  parseAnchors,
  planAnchorRepair,
  serializeAnchors,
  toAbsoluteCell,
  toFullColumnRange,
  toFullRowRange,
  IMPORTED_RULE_GROUP,
  autoClusterGroups,
  buildDefaultRules,
  dissolveGroupMapping,
  filterRules,
  firstRowOfRange,
  foreignSnapshotToRule,
  groupRules,
  mergeDuplicateRules,
  moveGroupNear,
  moveItemNear,
  normalizeHexColor,
  parseExistingGroups,
  parseRules,
  planApply,
  renameGroupMapping,
  reorderGroups,
  serializeExistingGroups,
  serializeRules,
  shiftFormulaRows,
  snapshotGroupKey,
  UNGROUPED_LABEL,
} from './conditional-format-rules.js'
import type {
  ApplyStrategy,
  ConditionalFormatRule,
  ForeignRuleSnapshot,
} from './conditional-format-rules.js'
import {
  FOREIGN_RULE_PAGE_SIZE,
  buildForeignRuleGroupsHtml,
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
import { directoryNameOf, saveTextFileWithDialog } from '../tools/save-file.js'
import {
  bindModalCollapse,
  bindModalDrag,
  bringModalIntoView,
  resetModalPosition,
} from '../ui/components/modal-drag.js'
import { bindModalMaximize, bindModalResize } from '../ui/components/window-chrome.js'
import { attachDelegatedContextMenu } from '../ui/components/context-menu.js'
import { createSortable } from '../ui/components/sortable-list.js'
import type { SortableHandle } from '../ui/components/sortable-list.js'
import {
  applyConditionalFormatPlan,
  checkFormatConditionsReadable,
  deleteForeignRule,
  isFormatConditionsSupported,
  moveForeignRule,
  readForeignRules,
  setForeignAppliesTo,
  setForeignFormula,
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
  /** 搜索词（规则库） */
  searchQuery: string
  /**
   * 被收起的分组名集合（会话态，不持久化）
   *
   * 收起是「视图」不是「配置」：写进持久化会让换机器/重装后的规则库
   * 带着一堆看不见的分组，用户以为规则丢了。与模块 hidden 同思路。
   * 搜索时自动全部展开（折叠组里的命中也该可见）。
   */
  collapsedGroups: Set<string>
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
  /**
   * 既有规则的本地分组映射（snapshotGroupKey → 组名）
   *
   * 视图层功能：只影响表格的聚合展示与「导入时带组名进规则库」，
   * **不写工作表**（COM 没有分组概念）。key 用公式@范围而非序号——
   * 序号会因规则增删漂移。持久化到 PluginStorage：归好组的会话之间保留。
   */
  existingGroups: Record<string, string>
  /** 既有规则表格里被收起的分组名（会话态，同规则库 collapsedGroups） */
  existingGroupCollapsed: Set<string>
  /**
   * 组名弹窗的「重命名模式」：非 null = 正在把该分组的全部规则换组名
   * （从组标题 ✎ 进入）；null = 常规「勾选行归入分组」模式（批量条进入）。
   * 两个模式共用同一个弹窗，靠这个字段在 confirmGroupName 里分流。
   */
  renamingGroup: string | null
  /**
   * 导入弹框打开时的快照副本（确认导入直接用它，不走可能已过期的 state.existing）
   *
   * 弹框里的勾选**不单独存 state**：与表格共用 {@link existingSelection}
   * （momo：规则管理器勾选与「选择要导入的规则」弹框要联动——两处勾的是
   * 同一批工作表规则，各存一套必然「没联动」）。
   */
  importForeignRules: ForeignRuleSnapshot[]
  /**
   * 导入弹框里被收起的分组名（会话态）
   *
   * 弹框与既有规则表格展示同一批规则的同一套分组（existingGroups），
   * 但折叠状态独立——弹框开着时用户往往想全部看全，表格收了不该连坐。
   */
  importGroupCollapsed: Set<string>
  /**
   * 规则库列表的勾选集（rule id）
   *
   * 与行的「👁 可见性复选框」是两回事：那个控制「隐藏/应用」，这个控制
   * 「批量删除 / 导出」（momo：规则管理也要有全选之类的批量功能）。
   * 跨搜索保留（与 existingSelection 同口径）。
   */
  ruleSelection: Set<string>
  /** 规则库列表的拖拽排序句柄（renderRuleList 后 refresh） */
  ruleSortable: SortableHandle | null
  /** 规则库列表「组标题」的拖拽排序句柄（拖组标题 = 整组调整次序） */
  groupSortable: SortableHandle | null
  /** 既有规则表格的拖拽排序句柄（renderExistingRules 后 refresh） */
  existingSortable: SortableHandle | null
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
  ruleSelection: new Set<string>(),
  existingScope: 'all',
  existingGroups: {},
  existingGroupCollapsed: new Set<string>(),
  renamingGroup: null,
  importForeignRules: [],
  importGroupCollapsed: new Set<string>(),
  collapsedGroups: new Set<string>(),
  ruleSortable: null,
  groupSortable: null,
  existingSortable: null,
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
        `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(name)}</option>`,
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
  try {
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
        const matched = active
          ? state.sheets.find((entry) => entry.worksheet === active)
          : undefined
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
  } catch (error: unknown) {
    // 宿主读取失败（JSAPI 桥未就绪 / 被调速器限速）：绝不让异常冒泡到事件
    // 监听或初始化，否则整页「不能点击」。降级为「可重试」空态 + 提示。
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[conditionalFormat] 枚举工作表失败：${message}`)
    showToast('读取工作簿列表失败，请点「🔄 刷新列表」重试', 'error')
    state.sheets = []
    renderWorkbookSelect()
    renderSheetSelect()
  }
}

/**
 * 目标表锁定开关（`1` = 锁定）。
 *
 * 语义**不是** locked-sheet 那种索引锁，而是「兜底策略」：见 reloadSheets 注释。
 * 默认不锁，保持既有「失效即兜底到活动表」的行为。
 */
function isSheetLocked(): boolean {
  try {
    return getConfig(KEY_SHEET_LOCK, '0') === '1'
  } catch {
    // PluginStorage 读取抛错（桥未就绪）时按「未锁定」兜底：
    // 锁定是兜底策略，读不到时用默认行为比让绑定段崩掉好
    return false
  }
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
    // 锚定自动修复：删过行 / 列后宿主会把范围收缩或平移，这里按锚定改回原范围
    if (repairAnchors(true) > 0) state.existing = readForeignRules(entry.worksheet)
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
  // 有本地分组时不分页：组标题跨页断裂比不分页更难读（一表 38 条一页装得下）。
  // 分页器此时 pageCount=1 自动隐藏。
  const hasGroups = Object.keys(state.existingGroups).length > 0
  const page = hasGroups
    ? { page: 1, pageCount: 1, items: scoped }
    : paginate(scoped, state.existingPage, FOREIGN_RULE_PAGE_SIZE)
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
  const rowsHtml = hasGroups
    ? buildForeignRuleGroupsHtml(page.items, state.existingGroups, state.existingGroupCollapsed)
    : page.items.map((row) => buildForeignRuleRowHtml(row)).join('')
  container.innerHTML = `${buildForeignRuleHeadHtml(summary.isAllSelected)}${rowsHtml}`

  // 全选复选框的三态：HTML 属性表达不了「部分选中」，必须走 DOM property。
  // 漏了这一步，半选时全选框显示未勾选，用户会以为「什么都没选」。
  const selectAll = container.querySelector<HTMLInputElement>('input[data-action="select-all"]')
  if (selectAll) selectAll.indeterminate = summary.isSomeSelected

  renderExistingBatchBar()
  renderExistingPagination(page.page, page.pageCount)
  // 浮动窗口顶栏的 ↑↓ / 删除要跟随选中数放开 / 禁用：
  // 按钮在 DOM 搬家范围之外，只能在这里统一同步（渲染的终点）。
  syncFloatToolbarState()
  // 拖拽排序：DOM 换了新节点，重新扫描补 tabindex / aria（键盘排序的前提）
  state.existingSortable?.refresh()
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
    <button type="button" class="bgm-btn small" data-batch-action="group" title="把所选规则归入一个分组（本地视图分组，可收起展开；导入时组名会带进规则库）">🏷 归入分组</button>
    <button type="button" class="bgm-btn small" data-batch-action="import" ${
      rebuildableCount === 0 ? 'disabled' : ''
    } title="${rebuildableCount === 0 ? '所选规则里没有可导入的公式类规则' : `导入 ${String(rebuildableCount)} 条到规则库`}">⤵ 导入规则库</button>
    <button type="button" class="bgm-btn small" data-batch-action="export" title="把所选规则导出为 JSON 文件（另存为对话框选保存位置）">📤 导出所选</button>
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

  // 分组的收起/展开（标题上的 ▾/▸）：只改视图折叠状态，不碰规则本身
  const groupToggle = target.closest<HTMLElement>('[data-action="toggle-existing-group"]')
  if (groupToggle) {
    const group = groupToggle.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
    if (group !== '') {
      const next = new Set(state.existingGroupCollapsed)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      state.existingGroupCollapsed = next
      renderExistingRules()
    }
    return
  }

  // 组标题 ✎：重命名整组（弹窗预填旧组名，确认后组内全部规则换组名）
  const renameGroupButton = target.closest<HTMLElement>('[data-action="rename-existing-group"]')
  if (renameGroupButton) {
    const group = renameGroupButton.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
    if (group !== '') openRenameGroupModal(group)
    return
  }

  // 组标题 ✕：解散整组（规则回「未分组」，不从工作表删除）
  const dissolveGroupButton = target.closest<HTMLElement>('[data-action="dissolve-existing-group"]')
  if (dissolveGroupButton) {
    const group = dissolveGroupButton.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
    if (group !== '') dissolveExistingGroupLocal(group)
    return
  }

  // 组标题 ☑：全选 / 取消本组（momo：组内也要能全选）
  const pickGroupButton = target.closest<HTMLElement>('[data-action="pick-existing-group"]')
  if (pickGroupButton) {
    const group = pickGroupButton.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
    if (group !== '') toggleExistingGroupSelection(group)
    return
  }

  // 组标题 📤：导出本组规则（选保存位置）
  const exportGroupButton = target.closest<HTMLElement>('[data-action="export-existing-group"]')
  if (exportGroupButton) {
    const group = exportGroupButton.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
    if (group !== '') exportExistingGroup(group)
    return
  }

  // 组标题「列 / 行」：把本组规则的应用范围钉成整列 / 整行（删除行列后自动恢复）
  const anchorGroupButton = target.closest<HTMLElement>(
    '[data-action="anchor-existing-group"], [data-action="anchor-existing-group-rows"]',
  )
  if (anchorGroupButton) {
    const group = anchorGroupButton.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
    const axis = anchorGroupButton.dataset.action === 'anchor-existing-group-rows' ? 'row' : 'column'
    if (group !== '') anchorExistingGroup(group, axis)
    return
  }

  // 组标题 🗑：从工作表删除本组全部规则
  const groupDeleteButton = target.closest<HTMLElement>('[data-action="delete-existing-group"]')
  if (groupDeleteButton) {
    const group = groupDeleteButton.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
    if (group !== '') deleteExistingGroup(group)
    return
  }

  // 行内编辑：点「应用于 / 公式」单元格原地变输入框（momo：要能直接改）。
  // 放在 button 分支之前：这两个单元格不是 button，走 button 分支会直接 return。
  const editable = target.closest<HTMLElement>('.conditional-format-cell-editable')
  if (editable) {
    const editRow = editable.closest<HTMLElement>('[data-row-index]')
    const editIndex = Number(editRow?.dataset.rowIndex ?? '0')
    if (!Number.isSafeInteger(editIndex) || editIndex < 1) return
    const { action } = editable.dataset
    if (action === 'edit-range') startCellEdit(editable, editIndex, 'range')
    else if (action === 'edit-formula') startCellEdit(editable, editIndex, 'formula')
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

/** 批量操作条的分流（归入分组 / 导入 / 导出 / 删除 / 取消选择） */
function handleBatchAction(action: string): void {
  switch (action) {
    case 'group': {
      openGroupNameModal()
      break
    }
    case 'import': {
      batchImportForeignRules()
      break
    }
    case 'export': {
      batchExportForeignRules()
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
 * 批量导出所选既有规则为 JSON（选保存位置）
 *
 * 快照转规则与「导入」同一套判据（foreignSnapshotToRule）：不可重建的类型
 * 逐条跳过并在结果里报数——不静默丢。id 用 nextId 现生成（导出文件只是
 * 快照，导入时会再生成新 id，不与库内既有规则撞）。
 */
function batchExportForeignRules(): void {
  const indices = [...state.existingSelection].sort((a, b) => a - b)
  const rules: ConditionalFormatRule[] = []
  let skipped = 0
  for (const index of indices) {
    const snapshot = state.existing[index - 1]
    if (snapshot) {
      const rule = foreignSnapshotToRule(snapshot, nextId, groupOfSnapshot(snapshot))
      if (rule) rules.push(rule)
      else skipped += 1
    }
  }
  if (rules.length === 0) {
    showToast('所选规则里没有可导出的公式类规则', 'warn')
    return
  }
  saveRulesJson(rules, '所选规则')
  if (skipped > 0) {
    showToast(`${String(skipped)} 条类型不支持，未包含在导出文件里`, 'info')
  }
}

/**
 * 取一个分组下所有行的 1 基序号（从 DOM 读：分组是视图层概念，
 * state 里只有 existingGroups 的 key→组名映射，行属于哪组看渲染结果）
 */
function existingGroupIndices(group: string): number[] {
  const container = document.querySelector<HTMLElement>(`[data-group="${CSS.escape(group)}"]`)
  if (!container) return []
  const indices: number[] = []
  for (const row of container.querySelectorAll<HTMLElement>('[data-row-index]')) {
    const index = Number(row.dataset.rowIndex ?? '0')
    if (Number.isSafeInteger(index) && index >= 1) indices.push(index)
  }
  return indices.sort((a, b) => a - b)
}

/** 组标题 ☑：组内已全勾 → 取消本组；否则补全本组 */
function toggleExistingGroupSelection(group: string): void {
  const indices = existingGroupIndices(group)
  if (indices.length === 0) {
    showToast('本组没有可勾选的规则', 'warn')
    return
  }
  const next = new Set(state.existingSelection)
  const isAllPicked = indices.every((index) => next.has(index))
  for (const index of indices) {
    if (isAllPicked) next.delete(index)
    else next.add(index)
  }
  state.existingSelection = next
  renderExistingRules()
}

/** 组标题 📤：导出本组快照转规则（与批量条导出所选同一通道） */
function exportExistingGroup(group: string): void {
  const indices = existingGroupIndices(group)
  const rules: ConditionalFormatRule[] = []
  let skipped = 0
  for (const index of indices) {
    const snapshot = state.existing[index - 1]
    if (snapshot) {
      const rule = foreignSnapshotToRule(snapshot, nextId, groupOfSnapshot(snapshot))
      if (rule) rules.push(rule)
      else skipped += 1
    }
  }
  if (rules.length === 0) {
    showToast('本组没有可导出的公式类规则', 'warn')
    return
  }
  saveRulesJson(rules, `「${group}」分组`)
  if (skipped > 0) {
    showToast(`${String(skipped)} 条类型不支持，未包含在导出文件里`, 'info')
  }
}

/**
 * 组标题 🗑：从工作表删除本组全部规则
 *
 * 与 batchDeleteForeignRules 同口径：**逆序删**（删前面的行会让后面的
 * FormatConditions.Item 下标漂移）。删除的是工作表规则，组的本地映射
 * （existingGroups）保留——组里没规则了自然不再显示。
 */
function deleteExistingGroup(group: string): void {
  const entry = selectedSheet()
  if (!entry) return
  const indices = existingGroupIndices(group)
  if (indices.length === 0) {
    showToast('本组没有可删除的规则', 'warn')
    return
  }
  // BGM.Dialog.confirm（项目范式，非 window.confirm）：不可撤销操作必须确认
  BGM.Dialog.confirm(
    `将从工作表删除「${group}」分组的全部 ${String(indices.length)} 条规则，且不可撤销。确定？`,
    (isConfirmed: boolean) => {
      if (!isConfirmed) return
      // 逆序删：删前面的行会让后面的 FormatConditions.Item 下标漂移
      const descending = [...indices].sort((a, b) => b - a)
      let succeeded = 0
      const failures: string[] = []
      for (const index of descending) {
        const result = deleteForeignRule(entry.worksheet, index)
        if (result.ok) succeeded += 1
        else failures.push(`第 ${String(index)} 条：${result.error}`)
      }
      const removed = new Set(indices)
      state.existingSelection = new Set(
        [...state.existingSelection].filter((index) => !removed.has(index)),
      )
      if (failures.length > 0) {
        showToast(
          `已删除 ${String(succeeded)} 条，${String(failures.length)} 条失败（${failures[0] ?? '未知原因'}）`,
          'error',
        )
      } else {
        showToast(`已删除「${group}」分组 ${String(succeeded)} 条规则`, 'success')
      }
      loadExistingRules()
    },
    '删除整组规则？',
  )
}

/**
 * 打开「归入分组」组名输入弹窗（批量条入口：作用于勾选的行）
 *
 * 预填：所选规则已全部属于同一组时，把该组名填进去（改名场景直接改）；
 * 跨组多选时留空（用户要输新名）。
 */
function openGroupNameModal(): void {
  const indices = [...state.existingSelection].sort((a, b) => a - b)
  if (indices.length === 0) return
  const names = new Set<string>()
  for (const index of indices) {
    const snapshot = state.existing[index - 1]
    if (snapshot) {
      const group = state.existingGroups[snapshotGroupKey(snapshot)]
      if (group !== undefined) names.add(group)
    }
  }
  state.renamingGroup = null
  const input = inputById('conditionalFormatGroupName')
  if (input) {
    const onlyName = names.size === 1 ? names.values().next().value : undefined
    input.value = typeof onlyName === 'string' ? onlyName : ''
  }
  setText('conditionalFormatGroupTitle', '归入分组')
  setText(
    'conditionalFormatGroupHint',
    `把所选的 ${String(indices.length)} 条规则归入同一分组。分组只影响本页展示（可收起展开），并会在导入规则库时作为组名带过去。`,
  )
  showGroupNameMask()
  input?.focus()
}

/**
 * 打开「重命名分组」弹窗（组标题 ✎ 入口：作用于组内全部规则）
 *
 * 与「归入分组」共用弹窗 DOM，靠 state.renamingGroup 分流；预填旧组名，
 * 计数给**整组**规则数（不是当前可见行数——搜索过滤不改变分组全集）。
 */
function openRenameGroupModal(group: string): void {
  const count = Object.values(state.existingGroups).filter((value) => value === group).length
  if (count === 0) {
    showToast('分组不存在，可能已被解散', 'warn')
    return
  }
  state.renamingGroup = group
  const input = inputById('conditionalFormatGroupName')
  if (input) input.value = group
  setText('conditionalFormatGroupTitle', '重命名分组')
  setText(
    'conditionalFormatGroupHint',
    `分组「${group}」下有 ${String(count)} 条规则，将全部改用新组名。分组只影响本页展示，不会改写工作表。`,
  )
  showGroupNameMask()
  input?.focus()
}

/** 显示组名弹窗（锚定 + 锁定背景滚动 + 拉回可见区，三个模态框同口径） */
function showGroupNameMask(): void {
  const mask = byId('conditionalFormatGroupMask')
  const modal = mask?.querySelector<HTMLElement>('.conditional-format-modal')
  if (mask) {
    if (modal) {
      resetModalPosition(modal)
      applyModalButtonsPosition(modal)
    }
    anchorModalMask(mask)
    mask.style.display = 'flex'
    if (modal) bringModalIntoView(mask, modal)
  }
  lockModalScroll()
}

function closeGroupNameModal(): void {
  const mask = byId('conditionalFormatGroupMask')
  // 没开 = no-op：Esc 块连调五个 close，没开的弹窗不能动共享的滚动锁计数
  // （modalScrollLockCount 是计数式；空关一次就把别的弹窗的锁解掉了）
  if (mask?.style.display === 'none') return
  if (mask) {
    mask.style.display = 'none'
  }
  state.renamingGroup = null
  unlockModalScroll()
}

/**
 * 确定归组 / 重命名：写映射 → 持久化 → 重渲染（组名会随导入带进规则库）
 *
 * 两条路径由 state.renamingGroup 分流：
 * - 重命名模式：renameGroupMapping 按**组名**换掉组内全部规则的组名；
 * - 归组模式：把勾选的序号写进映射（原行为）。
 */
function confirmGroupName(): void {
  const name = inputById('conditionalFormatGroupName')?.value.trim() ?? ''
  if (name === '') {
    showToast('分组名不能为空', 'warn')
    return
  }

  if (state.renamingGroup !== null) {
    // 先取局部常量：state.renamingGroup 是可变属性，TS 的窄化不会传进下面的
    // 闭包（filter 回调里又变成 string | null）；closeGroupNameModal 也会把它清空
    const oldName = state.renamingGroup
    const renamed = renameGroupMapping(state.existingGroups, oldName, name)
    if (renamed === null) {
      closeGroupNameModal()
      showToast('分组不存在，可能已被解散', 'warn')
      return
    }
    state.existingGroups = renamed
    persistExistingGroups()
    // 折叠集合里的旧名作废（新组默认展开）：不清的话下次渲染旧名永远
    // 匹配不上，用户点展开也没反应
    state.existingGroupCollapsed = new Set(
      [...state.existingGroupCollapsed].filter((group) => group !== oldName),
    )
    closeGroupNameModal()
    renderExistingRules()
    showToast(`分组已重命名为「${name}」`, 'success')
    return
  }

  const indices = [...state.existingSelection].sort((a, b) => a - b)
  const groups = { ...state.existingGroups }
  let count = 0
  for (const index of indices) {
    const snapshot = state.existing[index - 1]
    if (snapshot) {
      groups[snapshotGroupKey(snapshot)] = name
      count += 1
    }
  }
  state.existingGroups = groups
  persistExistingGroups()
  closeGroupNameModal()
  renderExistingRules()
  showToast(`已把 ${String(count)} 条规则归入「${name}」`, 'success')
}

/**
 * 解散一个分组（组标题 ✕ 入口）
 *
 * 只清视图层映射：组内规则回「未分组」桶，**不从工作表删除任何规则**
 * （dissolveGroupMapping 的语义，弹窗标题/按钮文案都要说清）。
 */
function dissolveExistingGroupLocal(group: string): void {
  const next = dissolveGroupMapping(state.existingGroups, group)
  if (next === null) {
    showToast('分组不存在，可能已被解散', 'warn')
    return
  }
  state.existingGroups = next
  persistExistingGroups()
  state.existingGroupCollapsed = new Set(
    [...state.existingGroupCollapsed].filter((collapsed) => collapsed !== group),
  )
  renderExistingRules()
  showToast(`已解散分组「${group}」，规则回「未分组」`, 'success')
}

/**
 * 自动聚类：按设置页选定的口径重算所有分组
 *
 * 覆盖现有映射（含手动归的组）——自动聚类是「重来一遍」的语义，
 * 在 toast 里明说口径与覆盖了几组，避免用户以为手动分组被合并。
 * 口径本身在设置页「条件格式」里配置（按公式 / 按范围+公式 / 按列 / 按行），
 * 本页每次点击现读，改完口径不必重启插件。
 */
function autoClusterExistingGroups(): void {
  if (state.existing.length === 0) {
    showToast('当前表没有既有规则', 'info')
    return
  }
  const mode = getClusterMode(true)
  state.existingGroups = autoClusterGroups(state.existing, mode)
  persistExistingGroups()
  state.existingGroupCollapsed = new Set<string>()
  renderExistingRules()
  const groupCount = new Set(Object.values(state.existingGroups)).size
  showToast(
    `已按「${CLUSTER_MODE_LABELS[mode]}」聚成 ${String(groupCount)} 组（覆盖了原分组）`,
    'success',
  )
}

/**
 * 合并重复项：把「同公式 + 同列」的多条单行既有规则并成一条
 *
 * 只做两件事：算出合并结果 + 把结果**写进规则库**（store），不直接改工作表。
 * 原因：写工作表要走「应用与修复」那套双策略（清空重建 / 保留手工规则），
 * 在这里另写一份会绕过它的确认与降级逻辑，容易悄悄丢规则。
 * 用户点一次「应用与修复」后，工作表上的重复单行规则就被合并后的规则取代。
 *
 * 口径由设置页「条件格式 → 合并重复项口径」决定（仅连续行 / 强行并成一块）。
 */
function mergeExistingDuplicates(): void {
  if (state.existing.length === 0) {
    showToast('当前表没有既有规则', 'info')
    return
  }
  const mode = getMergeMode(true)
  const result = mergeDuplicateRules(state.existing, mode)
  if (result.removedCount === 0) {
    showToast('没有可合并的单行重复规则（需要同公式、同列且为单行范围）', 'info')
    return
  }
  // 快照 → 规则库条目：沿用「导入既有规则」同一条转换路径，避免两套映射
  const stamp = Date.now()
  const imported: ConditionalFormatRule[] = []
  for (const [index, snapshot] of result.rules.entries()) {
    const rule = foreignSnapshotToRule(snapshot, () => `merge-${String(stamp)}-${String(index)}`)
    if (rule !== null) imported.push(rule)
  }
  state.rules = [...state.rules, ...imported]
  persistRules()
  renderRuleList()
  showToast(
    `已把 ${String(state.existing.length)} 条合并为 ${String(result.rules.length)} 条并加入规则库（口径：${
      mode === 'union' ? '强行并成一块' : '仅连续行'
    }）；点「应用与修复」写回工作表`,
    'success',
  )
  bgmLog(
    LOG_LEVELS.INFO,
    `[conditionalFormat] 合并重复项: ${String(result.removedCount)} 条 → ${String(result.rules.length)} 条（${mode}）`,
  )
}

/** 读锚定表（坏数据当空） */
function readAnchors(): Record<string, string> {
  return parseAnchors(getConfig(EXISTING_ANCHORS_STORE_KEY, '', true))
}

/** 锚定轴向：整列（对增删行免疫）或整行（对增删列免疫） */
type AnchorAxis = 'column' | 'row'

/**
 * 锚定一个分组的全部规则
 *
 * 锚定的是「应用范围」：把这些规则当前的 range 记下来，之后删行 / 删列导致宿主
 * 收缩或平移范围时，{@link repairAnchors} 会把范围改回锚定值 —— 这就是用户要的
 * 「锚定后删除行列不影响条件格式」。
 *
 * @param axis `column` = 整列（`$J:$J`，增删行免疫）；`row` = 整行（`$5:$5`，增删列免疫）
 */
function anchorExistingGroup(group: string, axis: AnchorAxis = 'column'): void {
  const entry = selectedSheet()
  const anchors = readAnchors()
  const toWholeAxis = axis === 'row' ? toFullRowRange : toFullColumnRange
  const axisLabel = axis === 'row' ? '整行' : '整列'
  const immuneLabel = axis === 'row' ? '列' : '行'
  let count = 0
  for (const [index, snapshot] of state.existing.entries()) {
    const isInGroup = state.existingGroups[snapshotGroupKey(snapshot)] === group
    const wholeAxisRange =
      isInGroup && snapshot.formula !== '' && snapshot.range !== ''
        ? toWholeAxis(snapshot.range)
        : null
    if (wholeAxisRange !== null) {
      // 锚定 = 把应用范围改写为整列（$J:$J）/ 整行（$5:$5），公式不动
      anchors[anchorKeyOf(snapshot)] = wholeAxisRange
      count += 1
      // 立刻写回工作表：用户要的是「现在就不受行列增删影响」，不是等下次
      if (entry !== null) setForeignAppliesTo(entry.worksheet, index + 1, wholeAxisRange)
    }
  }
  if (count === 0) {
    showToast('本组没有可锚定的规则（需要公式与范围都能读到）', 'info')
    return
  }
  if (!setConfig(EXISTING_ANCHORS_STORE_KEY, serializeAnchors(anchors))) {
    showToast('锚定保存失败', 'error')
    return
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[conditionalFormat] 已锚定分组「${group}」共 ${String(count)} 条规则（${axisLabel}）`,
  )
  loadExistingRules()
  showToast(
    `已锚定 ${String(count)} 条规则：应用范围改为${axisLabel}，${immuneLabel}增删不再影响`,
    'success',
  )
}

/**
 * 固定单元格：把选中的规则（没选就全部）的应用范围钉成**一个单元格**
 *
 * 与「锚定整列」的区别：整列范围怕删列，单元格范围怕删行 —— 固定就是把
 * 「只认这个单元格号」写死，之后删行删列都由 {@link repairAnchors} 改回该地址。
 * 地址由用户输入（`J5` / `$J$5` 都认），落盘统一成绝对引用。
 */
function fixRulesToCell(): void {
  const entry = selectedSheet()
  if (entry === null || state.existing.length === 0) {
    showToast('当前表没有既有规则', 'info')
    return
  }
  // eslint-disable-next-line no-alert -- 只有一个单元格地址要填，用原生 prompt 比再搭一个模态框更轻
  const input = window.prompt('要固定到哪个单元格？（例如 J5）', '')
  if (input === null) return
  const cell = toAbsoluteCell(input)
  if (cell === null) {
    showToast('单元格地址无法识别，请输入类似 J5 的形式', 'warn')
    return
  }
  const targets =
    state.existingSelection.size > 0
      ? [...state.existingSelection].map((index) => index - 1)
      : state.existing.map((_snapshot, index) => index)
  const anchors = readAnchors()
  let count = 0
  for (const index of targets) {
    const snapshot = state.existing[index]
    if (snapshot !== undefined && snapshot.formula !== '') {
      anchors[anchorKeyOf(snapshot)] = cell
      if (setForeignAppliesTo(entry.worksheet, index + 1, cell).ok) count += 1
    }
  }
  if (count === 0) {
    showToast('固定失败：没有可写入的规则', 'error')
    return
  }
  setConfig(EXISTING_ANCHORS_STORE_KEY, serializeAnchors(anchors))
  bgmLog(LOG_LEVELS.INFO, `[conditionalFormat] 已把 ${String(count)} 条规则固定到 ${cell}`)
  loadExistingRules()
  showToast(`已固定 ${String(count)} 条规则到 ${cell}：删行删列后仍只作用于该单元格`, 'success')
}

/**
 * 按锚定表修复范围
 * @param isAuto - 自动修复（读取后触发）时不弹成功 toast，避免每次换表都吵
 * @returns 实际写回的条数
 */
function repairAnchors(isAuto: boolean): number {
  const entry = selectedSheet()
  const anchors = readAnchors()
  if (!entry || Object.keys(anchors).length === 0) {
    if (!isAuto) showToast('还没有锚定任何规则', 'info')
    return 0
  }
  const plan = planAnchorRepair(state.existing, anchors)
  if (plan.repairs.length === 0) {
    if (!isAuto) showToast('所有锚定规则的范围都正确，无需修复', 'info')
    return 0
  }
  let repaired = 0
  for (const repair of plan.repairs) {
    const result = setForeignAppliesTo(entry.worksheet, repair.index + 1, repair.range)
    if (result.ok) repaired += 1
    else bgmLog(LOG_LEVELS.WARN, `[conditionalFormat] 锚定修复失败（第 ${String(repair.index + 1)} 条）：${result.error}`)
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[conditionalFormat] 按锚定恢复 ${String(repaired)} 条规则范围（自动=${String(isAuto)}）`,
  )
  if (repaired > 0) {
    showToast(`已按锚定恢复 ${String(repaired)} 条规则的应用范围`, isAuto ? 'info' : 'success')
  } else if (!isAuto) {
    showToast('锚定恢复失败：当前 WPS 版本不支持改应用范围', 'error')
  }
  return repaired
}

/** 清除所有分组：回到平铺分页视图 */
function clearExistingGroups(): void {
  if (Object.keys(state.existingGroups).length === 0) {
    showToast('当前没有分组', 'info')
    return
  }
  state.existingGroups = {}
  persistExistingGroups()
  state.existingGroupCollapsed = new Set<string>()
  renderExistingRules()
  showToast('已清除全部分组', 'success')
}

/** 快照在既有规则表格里的归组（没归过 → 默认「导入的规则」） */
function groupOfSnapshot(snapshot: ForeignRuleSnapshot): string {
  return state.existingGroups[snapshotGroupKey(snapshot)] ?? IMPORTED_RULE_GROUP
}

/**
 * 行内编辑改了公式/范围后，把分组映射的 key 迁到新 key
 *
 * key 由「公式 + 范围」组成，字段一改旧 key 就失配——不迁移的话规则会
 * 突然掉进「未分组」。迁移后组名跟着规则走。
 */
function migrateExistingGroupKey(oldKey: string, nextKey: string): void {
  const group = state.existingGroups[oldKey]
  if (group === undefined || oldKey === nextKey) return
  // 不用 delete：no-dynamic-delete 禁动态键删除。filter 重建一份更直白
  const groups = Object.fromEntries(
    Object.entries(state.existingGroups).filter(([key]) => key !== oldKey),
  )
  groups[nextKey] = group
  state.existingGroups = groups
  persistExistingGroups()
}

/**
 * 批量导入所选既有规则到规则库（表格勾选入口）
 *
 * 与导入弹框共用 {@link importSnapshots}：两条入口一套导入逻辑，
 * 不各写一份（否则跳过计数 / 持久化 / 提示必然漂移）。
 */
function batchImportForeignRules(): void {
  importSnapshots(
    state.existing,
    [...state.existingSelection].sort((a, b) => a - b),
  )
  state.existingSelection = new Set<number>()
  renderExistingRules()
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
 * moveForeignRule 现在是真正的「相邻交换一格」，倒序逐条调 = 每条各自上/下移
 * 一格（多条同时穿越同一位置的精确排序需要反复重排，代价高且易错，先不做）。
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

/**
 * 行内编辑「应用于 / 公式」：单元格原地变成输入框
 *
 * Enter / blur 保存，Esc 取消（重渲染即还原）。保存走 COM 写工作表
 * （ModifyAppliesToRange / Formula1），成功后按公式匹配联动规则库里
 * 已导入的副本。
 */
function startCellEdit(cell: HTMLElement, index: number, kind: 'range' | 'formula'): void {
  // 同一单元格已在编辑中（里面已有 input）不重复开
  if (cell.querySelector('input')) return
  const snapshot = state.existing[index - 1]
  if (!snapshot) return
  const original = kind === 'range' ? snapshot.range : snapshot.formula

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'conditional-format-cell-input'
  input.value = original
  input.spellcheck = false
  input.setAttribute('aria-label', kind === 'range' ? '修改应用范围' : '修改公式')
  // replaceChildren 一次完成「清空 + 插入」：拆成 textContent='' + append 会踩
  // no-param-reassign（禁给参数属性赋值，方法调用不管）
  cell.replaceChildren(input)
  input.focus()
  input.select()

  let isFinished = false
  const finish = (shouldCommit: boolean): void => {
    if (isFinished) return
    isFinished = true
    const next = input.value.trim()
    // 取消 / 空值 / 没改动：重渲染还原，不写 COM
    if (!shouldCommit || next === '' || next === original) {
      renderExistingRules()
      return
    }
    commitCellEdit(index, kind, original, next)
  }

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // 拦住传播：document 上还有关弹窗的 Esc 监听，不该被行内编辑触发
      event.stopPropagation()
      finish(false)
    }
  })
  input.addEventListener('blur', () => {
    finish(true)
  })
}

/** 提交行内编辑：写工作表 → 联动规则库副本 → 刷新表格与规则库 */
function commitCellEdit(
  index: number,
  kind: 'range' | 'formula',
  oldFormula: string,
  next: string,
): void {
  const entry = selectedSheet()
  if (!entry) return
  // 快照在写 COM 前取：key 迁移要用「改之前」的公式/范围（state.existing 在
  // 成功后会被 loadExistingRules 刷新）
  const snapshot = state.existing[index - 1]
  const result =
    kind === 'range'
      ? setForeignAppliesTo(entry.worksheet, index, next)
      : setForeignFormula(entry.worksheet, index, next)
  if (!result.ok) {
    // 写不进去要还原输入并明说：否则用户以为改了，实际没有（与 stopIfTrue 同口径）
    showToast(`修改失败：${result.error}`, 'error')
    renderExistingRules()
    return
  }
  // 分组 key 由公式+范围组成，改了哪个就迁哪个（否则规则掉进「未分组」）
  if (snapshot) {
    const oldKey = snapshotGroupKey(snapshot)
    // 只换被改的字段，另一个沿用原值（三元提到对象构造里，prefer-minimal-ternary）
    const patched = kind === 'range' ? { ...snapshot, range: next } : { ...snapshot, formula: next }
    migrateExistingGroupKey(oldKey, snapshotGroupKey(patched))
  }
  const synced = syncImportedRulesInStore(
    oldFormula,
    kind === 'range' ? { appliesTo: next } : { formula: next },
  )
  showToast(
    kind === 'range'
      ? `第 ${String(index)} 条范围已改为 ${next}`
      : `第 ${String(index)} 条公式已更新`,
    'success',
  )
  if (synced > 0) {
    showToast(`已同步规则库里 ${String(synced)} 条导入的规则`, 'info')
  }
  loadExistingRules()
  renderRuleList()
}

/**
 * 表格改了范围/公式后，同步规则库里已导入的副本（按公式匹配）
 *
 * 只动「导入的规则」分组：手工写的插件规则与工作表规则是两套东西，
 * 不该被表格操作波及。多条同公式时全部同步（同一公式的范围通常一致）。
 *
 * @returns 同步了几条（0 = 库里没有对应副本，toast 不提示联动）
 */
function syncImportedRulesInStore(
  oldFormula: string,
  patch: { appliesTo?: string; formula?: string },
): number {
  if (oldFormula === '') return 0
  let synced = 0
  state.rules = state.rules.map((rule) => {
    if (rule.group !== IMPORTED_RULE_GROUP || rule.formula !== oldFormula) return rule
    synced += 1
    return {
      ...rule,
      ...(patch.appliesTo !== undefined && { appliesTo: patch.appliesTo }),
      ...(patch.formula !== undefined && { formula: patch.formula }),
    }
  })
  if (synced > 0) persistRules()
  return synced
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

function loadExistingGroups(): void {
  state.existingGroups = parseExistingGroups(getConfig(EXISTING_GROUPS_STORE_KEY, '', true))
}

function persistExistingGroups(): void {
  setConfig(EXISTING_GROUPS_STORE_KEY, serializeExistingGroups(state.existingGroups))
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
  // 自有模态框而非通用 showInput：momo 要「可拖动的浮动窗口 + 可收起 +
  // 按钮小一点离输入框远点」。通用弹窗是桥接的实现，不为单个场景改行为。
  openPasteModal(sources)
}

/** 粘贴来源的会话态（弹窗开着期间的数据源；关闭即清） */
let pasteSources: ConditionalFormatRule[] = []

/** 打开「粘贴规则」弹窗：预填原范围，定位三件套与其它模态框一致 */
function openPasteModal(sources: readonly ConditionalFormatRule[]): void {
  pasteSources = [...sources]
  const firstRange = sources[0]?.appliesTo ?? ''
  const hint = byId('conditionalFormatPasteHint')
  if (hint) {
    hint.textContent = `将粘贴 ${String(sources.length)} 条规则。目标范围（留空保持原范围）：`
  }
  const input = inputById('conditionalFormatPasteRange')
  if (input) input.value = firstRange

  const mask = byId('conditionalFormatPasteMask')
  const modal = mask?.querySelector<HTMLElement>('.conditional-format-modal')
  if (mask) {
    if (modal) {
      resetModalPosition(modal)
      applyModalButtonsPosition(modal)
    }
    anchorModalMask(mask)
    mask.style.display = 'flex'
    if (modal) bringModalIntoView(mask, modal)
  }
  lockModalScroll()
  // 打开即聚焦：用户可以直接改范围回车确认，不用先点一下输入框
  input?.focus()
  input?.select()
}

/** 关闭「粘贴规则」弹窗（没开时 no-op：Esc 块连调五个 close，别乱解滚动锁） */
function closePasteModal(): void {
  const mask = byId('conditionalFormatPasteMask')
  // 没开 = no-op：Esc 块连调五个 close，没开的不能解别人的滚动锁
  if (mask?.style.display === 'none') return
  if (mask) {
    mask.style.display = 'none'
    pasteSources = []
    unlockModalScroll()
  }
}

/** 确认粘贴：按弹窗里的目标范围生成副本（公式行号引用跟着平移） */
function confirmPaste(): void {
  const sources = pasteSources
  if (sources.length === 0) {
    closePasteModal()
    return
  }
  const firstRange = sources[0]?.appliesTo ?? ''
  const typedRange = (inputById('conditionalFormatPasteRange')?.value ?? '').trim()
  // 留空 = 保持原范围（空串与 nullish 都要回退，故不用 ??）
  const targetRange = typedRange === '' ? firstRange : typedRange
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
  closePasteModal()
  renderRuleList()
  showToast(`已粘贴 ${String(copies.length)} 条规则到 ${targetRange}`, 'success')
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
      // 搜索时忽略折叠态：折叠组里的命中也该可见，否则用户以为搜不到
      const isCollapsed = state.searchQuery === '' && state.collapsedGroups.has(group)
      const rows = rules
        .map((rule) => {
          const isHidden = rule.hidden === true
          return `
        <div class="conditional-format-rule${isHidden ? ' conditional-format-rule-hidden' : ''}" data-rule-id="${escapeHtml(rule.id)}" title="拖拽调整优先级 · 右键打开操作菜单">
          <span class="conditional-format-rule-handle" title="拖拽调整优先级（也可用键盘：Space 拾起、↑↓ 移动）" aria-hidden="true">⋮⋮</span>
          <label class="conditional-format-rule-pick" title="勾选以批量删除 / 导出">
            <input type="checkbox" data-action="pick" ${state.ruleSelection.has(rule.id) ? 'checked' : ''} aria-label="勾选 ${escapeHtml(rule.name)}" />
          </label>
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
      <div class="conditional-format-group${isCollapsed ? ' is-collapsed' : ''}" data-group="${escapeHtml(group)}">
        <div class="conditional-format-group-title" title="拖动调整分组顺序（整组一起动）">
          <button type="button" class="conditional-format-group-toggle" data-action="toggle-group" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${isCollapsed ? '展开分组' : '收起分组'}">${isCollapsed ? '▸' : '▾'}</button>
          <span class="conditional-format-group-name">${escapeHtml(group)}</span>
          <span class="conditional-format-group-count">${String(rules.length)}</span>
          <span class="conditional-format-group-actions">
            <button type="button" class="conditional-format-group-action" data-action="pick-group" data-group="${escapeHtml(group)}" title="全选 / 取消本组">☑</button>
            <button type="button" class="conditional-format-group-action" data-action="delete-group" data-group="${escapeHtml(group)}" title="删除本组全部规则">🗑</button>
            <button type="button" class="conditional-format-group-action" data-action="export-group" data-group="${escapeHtml(group)}" title="导出本组所选规则">📤</button>
            <button type="button" class="conditional-format-group-action" data-action="anchor-existing-group" data-group="${escapeHtml(group)}" title="锚定本组为整列（$J:$J）：公式不变，增删行不再影响">列</button>
            <button type="button" class="conditional-format-group-action" data-action="anchor-existing-group-rows" data-group="${escapeHtml(group)}" title="锚定本组为整行（$5:$5）：公式不变，增删列不再影响">行</button>
          </span>
        </div>
        ${rows}
      </div>`
    })
    .join('')

  container
    .querySelectorAll<HTMLButtonElement>('button[data-action="toggle-group"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const group = button.closest<HTMLElement>('[data-group]')?.dataset.group ?? ''
        if (group === '') return
        // 不可变更新：与 existingSelection 同口径，避免旧行模型与新 state 共享同一 Set
        const next = new Set(state.collapsedGroups)
        if (next.has(group)) next.delete(group)
        else next.add(group)
        state.collapsedGroups = next
        renderRuleList()
      })
    })

  // 组标题三件套：组内全选 / 组内删除 / 组内导出（momo：分组内也要能批量）
  container
    .querySelectorAll<HTMLButtonElement>('button[data-action="pick-group"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const group = button.dataset.group ?? ''
        if (group === '') return
        const ids = state.rules.filter((rule) => rule.group === group).map((rule) => rule.id)
        const next = new Set(state.ruleSelection)
        // 组内已全勾 → 取消本组；否则补全本组（与「全选」按钮同语义）
        const isAllPicked = ids.length > 0 && ids.every((id) => next.has(id))
        for (const id of ids) {
          if (isAllPicked) next.delete(id)
          else next.add(id)
        }
        state.ruleSelection = next
        renderRuleList()
      })
    })
  container
    .querySelectorAll<HTMLButtonElement>('button[data-action="delete-group"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const group = button.dataset.group ?? ''
        if (group === '') return
        deleteSelectedRules(state.rules.filter((rule) => rule.group === group).map((r) => r.id))
      })
    })
  container
    .querySelectorAll<HTMLButtonElement>('button[data-action="export-group"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const group = button.dataset.group ?? ''
        if (group === '') return
        exportSelectedRules(
          state.rules.filter((rule) => rule.group === group),
          `「${group}」分组`,
        )
      })
    })

  container.querySelectorAll<HTMLElement>('.conditional-format-rule').forEach((row) => {
    const id = row.dataset.ruleId ?? ''
    // 勾选（批量删除/导出语义，与可见性 toggle 分开）
    row.querySelectorAll<HTMLInputElement>('input[data-action="pick"]').forEach((box) => {
      box.addEventListener('change', () => {
        const next = new Set(state.ruleSelection)
        if (box.checked) next.add(id)
        else next.delete(id)
        state.ruleSelection = next
        // 只刷批量条，不重渲列表（保住焦点：连勾十几条不用每次重新点）
        renderRuleBatchBar()
      })
    })
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
  // 拖拽排序：DOM 换了新节点，重新扫描补 tabindex / aria（键盘排序的前提）
  state.ruleSortable?.refresh()
  state.groupSortable?.refresh()
  // 顶部批量条跟随勾选数显隐
  renderRuleBatchBar()
}

/**
 * 顶部批量操作条（规则管理）：全选 / 删除所选 / 导出所选
 *
 * 选中 0 条时整条隐藏——平时屏幕上只留「全选」一个入口，不添乱
 * （与既有规则表格的批量条同范式）。
 */
function renderRuleBatchBar(): void {
  const bar = byId('conditionalFormatRuleBatchBar')
  if (!bar) return
  const count = state.ruleSelection.size
  if (count === 0) {
    bar.replaceChildren()
    bar.classList.remove('is-visible')
    return
  }
  bar.classList.add('is-visible')
  bar.innerHTML = `
    <span class="conditional-format-batch-count">已选 ${String(count)} 条</span>
    <button type="button" class="bgm-btn small" data-rule-batch="delete" title="删除所选规则">🗑 删除所选</button>
    <button type="button" class="bgm-btn small" data-rule-batch="export" title="导出所选规则为 JSON（选保存位置）">📤 导出所选</button>
    <button type="button" class="bgm-btn small" data-rule-batch="clear" title="取消选择">取消选择</button>`
}

/** 批量删除所选规则（全选 / 组内 / 顶部批量条共用） */
function deleteSelectedRules(ids: readonly string[]): void {
  if (ids.length === 0) {
    showToast('没有选中的规则', 'warn')
    return
  }
  const removed = new Set(ids)
  state.rules = state.rules.filter((rule) => !removed.has(rule.id))
  // filter + has 而非 Set#difference：ES2022 无其类型（规则已在 eslint.config 排除）
  state.ruleSelection = new Set([...state.ruleSelection].filter((id) => !removed.has(id)))
  persistRules()
  renderRuleList()
  showToast(`已删除 ${String(ids.length)} 条规则`, 'success')
}

// ===== 颜色字段（选择器 + 十六进制手输）=====
//
// 吸管取色已移除（momo：当前环境不支持 EyeDropper，点了「就退出」——
// WPS 内嵌 CEF 的 open() 直接抛错被静默 catch 吞掉）。不留个点了没反应的
// 图标，统一走 color 选择器 + 十六进制输入。

/** 一个颜色字段的两件套 id（填充 / 字体各一套） */
interface ColorFieldIds {
  /** 原生 color 选择器 */
  picker: string
  /** 十六进制文本输入（权威值：用户可直接输码） */
  text: string
}

const COLOR_FIELD_FILL: ColorFieldIds = {
  picker: 'conditionalFormatEditFill',
  text: 'conditionalFormatEditFillText',
}

const COLOR_FIELD_FONT: ColorFieldIds = {
  picker: 'conditionalFormatEditFont',
  text: 'conditionalFormatEditFontText',
}

const COLOR_FIELDS: readonly ColorFieldIds[] = [COLOR_FIELD_FILL, COLOR_FIELD_FONT]

/** 把颜色写进字段两件套（选择器 + 文本），保持两边永远一致 */
function setColorField(field: ColorFieldIds, hex: string): void {
  const picker = inputById(field.picker)
  const text = inputById(field.text)
  if (picker) picker.value = hex
  if (text) text.value = hex
}

/** 读颜色字段的权威值（文本优先）；文本非法时回落选择器值，再不行给 fallback */
function readColorField(field: ColorFieldIds, fallback: string): string {
  const fromText = normalizeHexColor(inputById(field.text)?.value ?? '')
  if (fromText !== null) return fromText
  const fromPicker = normalizeHexColor(inputById(field.picker)?.value ?? '')
  return fromPicker ?? fallback
}

/**
 * 装配一个颜色字段：选择器 / 文本两边联动
 *
 * - 选择器 change → 同步文本；
 * - 文本 input → 合法 hex 实时同步选择器（用户看着色块确认输对）；
 * - 文本 blur → 规范化成 `#RRGGBB` 大写；非法则还原成选择器当前值
 *   （不清空：清空像字段坏了，还原至少保住一个有效色）。
 */
function bindColorField(field: ColorFieldIds): void {
  const picker = inputById(field.picker)
  const text = inputById(field.text)
  if (!picker || !text) return

  picker.addEventListener('change', () => {
    setColorField(field, picker.value)
  })

  text.addEventListener('input', () => {
    const normalized = normalizeHexColor(text.value)
    if (normalized !== null) picker.value = normalized
  })

  text.addEventListener('blur', () => {
    const normalized = normalizeHexColor(text.value)
    text.value = normalized ?? picker.value
  })
}

/** 弹窗遮罩计数锁：多个弹窗同时开时，不能有一个关闭就解锁背景滚动 */
let modalScrollLockCount = 0

/**
 * 把弹窗遮罩锚定到「当前可见区顶部」
 *
 * WPS 任务窗格里 iframe 视口常常等于**内容全高**（长页面不产生窗格内滚动条，
 * 而是 iframe 被内容撑高）：fixed + flex-center 会把弹窗放到文档中部、落在
 * 任务窗格可见区外（momo 实测：弹窗出现在页面上方、窗口外）。
 * absolute 遮罩 + top=scrollY 补偿滚动，在「iframe=可见区」与「iframe=内容高」
 * 两种宿主模型下都落在可见区内。顺带打一条诊断日志确认宿主模型。
 */
function anchorModalMask(mask: HTMLElement): void {
  // setProperty 而非 mask.style.top = ...：后者踩 no-param-reassign（禁给参数属性赋值）
  mask.style.setProperty('top', `${String(window.scrollY)}px`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[conditionalFormat] 弹窗定位: innerHeight=${String(window.innerHeight)} scrollY=${String(
      window.scrollY,
    )} clientHeight=${String(document.documentElement.clientHeight)} scrollHeight=${String(
      document.documentElement.scrollHeight,
    )}`,
  )
}

/**
 * 按配置套「模态框按钮外置」类（momo：按钮可放到模态框之外）
 *
 * 每次打开弹窗时读一次配置（设置页改完，下次打开即生效）——跨窗格不做即时
 * 同步，与「高亮模式 / 自动关注上移设置页」同策略：读的时候重算，不推。
 * 类名只切显隐与定位，不动 DOM 结构（按钮组始终在 modal 里，CSS 决定它
 * 坐在底部还是标题栏那一行）。
 */
function applyModalButtonsPosition(modal: HTMLElement): void {
  const isOutside = getModalButtonsPosition(true) === 'outside'
  modal.classList.toggle('conditional-format-modal--buttons-outside', isOutside)
}

/** 锁背景滚动（弹窗打开期间；计数式，多弹窗叠加不会早解） */
function lockModalScroll(): void {
  modalScrollLockCount += 1
  document.body.style.overflow = 'hidden'
}

/** 解背景滚动（计数归零才真解） */
function unlockModalScroll(): void {
  modalScrollLockCount = Math.max(0, modalScrollLockCount - 1)
  if (modalScrollLockCount === 0) document.body.style.overflow = ''
}

// ===== 规则编辑器（浮动弹窗）=====

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
  const boldInput = inputById('conditionalFormatEditBold')
  if (nameInput) nameInput.value = rule.name
  if (groupInput) groupInput.value = rule.group
  if (rangeInput) rangeInput.value = rule.appliesTo
  if (formulaInput) formulaInput.value = rule.formula
  // 颜色两件套一起写：只写一边会让文本与色块不一致（用户看到的是旧色）
  setColorField(COLOR_FIELD_FILL, normalizeHexColor(rule.interior) ?? '#00B050')
  setColorField(COLOR_FIELD_FONT, normalizeHexColor(rule.fontColor ?? '') ?? '#000000')
  if (boldInput) boldInput.checked = rule.fontBold === true
  const mask = byId('conditionalFormatEditorMask')
  const modal = mask?.querySelector<HTMLElement>('.conditional-format-modal')
  if (mask) {
    // 每次打开都回到遮罩居中位：不记住上次拖动的位置——模态框是一次性交互，
    // 记住旧位置只会让用户在老地方找一个刚打开的框
    if (modal) {
      resetModalPosition(modal)
      applyModalButtonsPosition(modal)
    }
    anchorModalMask(mask)
    mask.style.display = 'flex'
    // 打开后拉回可见区：页面滚动后模态框会落在可见区外（实测标题栏被切半个），
    // 量一次、越界就滚回来并重锚遮罩（见 modal-drag.ts 注释）
    if (modal) bringModalIntoView(mask, modal)
  }
  lockModalScroll()
  setText('conditionalFormatEditorTitle', isNew ? '新建规则' : `编辑：${rule.name || '未命名'}`)
}

function closeEditor(): void {
  state.editingId = null
  state.editingIsNew = false
  const mask = byId('conditionalFormatEditorMask')
  // 没开 = no-op：Esc 块连调五个 close，没开的弹窗不能动共享的滚动锁计数
  // （modalScrollLockCount 是计数式；空关一次就把别的弹窗的锁解掉了）
  if (mask?.style.display === 'none') return
  if (mask) {
    mask.style.display = 'none'
  }
  unlockModalScroll()
}

function saveEditor(): void {
  const nameInput = inputById('conditionalFormatEditName')
  const groupInput = inputById('conditionalFormatEditGroup')
  const rangeInput = inputById('conditionalFormatEditRange')
  const formulaInput = byId('conditionalFormatEditFormula') as HTMLTextAreaElement | null
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
  // 颜色走 readColorField：文本（可手输 hex）权威，非法时回落选择器值
  const fillColor = readColorField(COLOR_FIELD_FILL, '#00B050')
  const fontColor = readColorField(COLOR_FIELD_FONT, '#000000')
  const isBold = boldInput?.checked === true
  const rule: ConditionalFormatRule = {
    id: existing?.id ?? nextId(),
    name,
    group: groupText === '' ? CONDITIONAL_FORMAT_GROUP_HIGHLIGHT : groupText,
    appliesTo,
    formula,
    interior: fillColor,
    fontColor,
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
  // mask 在函数入口已判非 null（!mask || !body 早退），直接用
  const modal = mask.querySelector<HTMLElement>('.conditional-format-modal')
  if (modal) {
    resetModalPosition(modal)
    applyModalButtonsPosition(modal)
  }
  anchorModalMask(mask)
  mask.style.display = 'flex'
  if (modal) bringModalIntoView(mask, modal)
  lockModalScroll()
  clearButton?.focus()
}

function closeConfirmModal(): void {
  const mask = byId('conditionalFormatConfirmMask')
  // 没开 = no-op：Esc 块连调五个 close，没开的弹窗不能动共享的滚动锁计数
  // （modalScrollLockCount 是计数式；空关一次就把别的弹窗的锁解掉了）
  if (mask?.style.display === 'none') return
  if (mask) {
    mask.style.display = 'none'
  }
  unlockModalScroll()
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
  if (foreign.length === 0) {
    showToast('这张表没有条件格式规则（可在「既有规则」卡片确认）', 'info')
    loadExistingRules()
    return
  }
  // 不再一键全导：弹选择框让用户挑（momo：#conditionalFormatImportBtn 直接导了全部）
  openImportModal(foreign, entry.sheet)
}

/** 快照是否可导入（与 foreignSnapshotToRule 的判据一致：公式类且有公式） */
function isSnapshotImportable(snapshot: ForeignRuleSnapshot): boolean {
  return snapshot.kind === 'expression' && snapshot.formula !== ''
}

/**
 * 导入弹框与表格的勾选联动：一处改动，三处视图同步
 *
 * 弹框列表 / 既有规则表格 / 批量操作条都读同一份 {@link existingSelection}，
 * 改它之后必须把三处都重渲染，否则用户在一处勾了、另一处不亮——那就是
 * momo 报的「没有联动」。
 */
function syncImportSelectionViews(): void {
  renderImportList()
  renderExistingRules()
  setText('conditionalFormatImportConfirm', `导入所选（${String(state.existingSelection.size)}）`)
}

/** 弹框里可导入项的 1 基序号（全选用） */
function selectableImportIndices(): number[] {
  return state.importForeignRules
    .map((snapshot, position) => (isSnapshotImportable(snapshot) ? position + 1 : 0))
    .filter((index) => index > 0)
}

/**
 * 打开「选择要导入的规则」弹框
 *
 * 可导入的（公式类）默认全选——一表里通常大多数规则就是要导的；
 * 不可导入的禁用勾选并标注类型，不静默丢。
 */
function openImportModal(snapshots: readonly ForeignRuleSnapshot[], sheetName: string): void {
  state.importForeignRules = [...snapshots]
  // 联动：弹框勾选 = 表格勾选（同一 Set）。表格已勾了就带着进弹框；
  // 什么都没勾时默认全选可导入项，并回写表格（两边同时亮起，不再「没联动」）。
  if (state.existingSelection.size === 0) {
    state.existingSelection = new Set(selectableImportIndices())
  }
  setText('conditionalFormatImportSheet', sheetName)
  syncImportSelectionViews()
  renderImportList()
  const mask = byId('conditionalFormatImportMask')
  const modal = mask?.querySelector<HTMLElement>('.conditional-format-modal')
  if (mask) {
    if (modal) {
      resetModalPosition(modal)
      applyModalButtonsPosition(modal)
    }
    anchorModalMask(mask)
    mask.style.display = 'flex'
    if (modal) bringModalIntoView(mask, modal)
  }
  lockModalScroll()
}

function closeImportModal(): void {
  const mask = byId('conditionalFormatImportMask')
  // 没开 = no-op：Esc 块连调五个 close，没开的弹窗不能动共享的滚动锁计数
  // （modalScrollLockCount 是计数式；空关一次就把别的弹窗的锁解掉了）
  if (mask?.style.display === 'none') return
  if (mask) {
    mask.style.display = 'none'
  }
  // 不清 existingSelection：弹框与表格共享它，清了就是「联动只做一半」
  unlockModalScroll()
}

/**
 * 导入弹框列表的分组聚合（momo：要按照分组导入）
 *
 * 与既有规则表格同一套映射（existingGroups，key = snapshotGroupKey），
 * 组序 = 组内首条出现顺序，「未分组」恒排最后——两个视图口径一致，
 * 用户在表格里归好的组在弹框里原样呈现。返回 [组名, [序号, 快照]] 有序对。
 */
function groupImportSnapshots(): [string, [number, ForeignRuleSnapshot][]][] {
  const buckets = new Map<string, [number, ForeignRuleSnapshot][]>()
  for (const [position, snapshot] of state.importForeignRules.entries()) {
    const group = state.existingGroups[snapshotGroupKey(snapshot)] ?? UNGROUPED_LABEL
    const bucket = buckets.get(group)
    if (bucket) bucket.push([position + 1, snapshot])
    else buckets.set(group, [[position + 1, snapshot]])
  }
  const ungrouped = buckets.get(UNGROUPED_LABEL)
  if (ungrouped !== undefined) {
    buckets.delete(UNGROUPED_LABEL)
    buckets.set(UNGROUPED_LABEL, ungrouped)
  }
  return [...buckets]
}

/** 弹框分组内可导入项的序号（组内全选用：不可导入的禁用项不混进来） */
function importableIndicesOfGroup(entries: readonly [number, ForeignRuleSnapshot][]): number[] {
  return entries.filter(([, snapshot]) => isSnapshotImportable(snapshot)).map(([index]) => index)
}

function renderImportList(): void {
  const container = byId('conditionalFormatImportList')
  if (!container) return
  const selection = state.existingSelection
  container.innerHTML = groupImportSnapshots()
    .map(([group, entries]) => {
      const isCollapsed = state.importGroupCollapsed.has(group)
      const rows = entries
        .map(([index, snapshot]) => {
          const canImport = isSnapshotImportable(snapshot)
          const formulaPreview =
            snapshot.formula.length > 40 ? `${snapshot.formula.slice(0, 40)}…` : snapshot.formula
          return `
      <label class="conditional-format-import-row${canImport ? '' : ' is-disabled'}" data-import-index="${String(index)}">
        <input type="checkbox" data-import-check="${String(index)}" ${selection.has(index) ? 'checked' : ''} ${canImport ? '' : 'disabled'} aria-label="选择第 ${String(index)} 条规则" />
        <span class="conditional-format-import-index">${String(index)}</span>
        <span class="conditional-format-import-range" title="${escapeHtml(snapshot.range)}">${escapeHtml(snapshot.range || '（未读到范围）')}</span>
        <code class="conditional-format-import-formula" title="${escapeHtml(snapshot.formula)}">${escapeHtml(formulaPreview)}</code>
        ${canImport ? '' : '<em class="conditional-format-tag-warn">类型不支持</em>'}
      </label>`
        })
        .join('')
      return `
      <div class="conditional-format-group conditional-format-existing-group${isCollapsed ? ' is-collapsed' : ''}" data-import-group="${escapeHtml(group)}">
        <div class="conditional-format-group-title">
          <button type="button" class="conditional-format-group-toggle" data-action="toggle-import-group" data-import-group="${escapeHtml(group)}" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${isCollapsed ? '展开分组' : '收起分组'}">${isCollapsed ? '▸' : '▾'}</button>
          <span class="conditional-format-group-name">${escapeHtml(group)}</span>
          <span class="conditional-format-group-count">${String(entries.length)}</span>
          <button type="button" class="conditional-format-group-pick" data-action="pick-import-group" data-import-group="${escapeHtml(group)}" title="全选 / 取消本组可导入的规则">☑</button>
        </div>
        ${rows}
      </div>`
    })
    .join('')
  setText('conditionalFormatImportConfirm', `导入所选（${String(selection.size)}）`)
}

/**
 * 导入弹框的组标题按钮（点击委托）：收起 / 展开分组、组内全选 / 取消
 *
 * 组内全选是「切换」语义：组内可导入项已全勾 → 全部取消；否则补全。
 * 只勾可导入项——类型不支持的本来就禁着，混进选中集只会虚增计数。
 */
function handleImportListClick(event: Event): void {
  const target = event.target as HTMLElement | null
  const group = target?.closest<HTMLElement>('[data-import-group]')?.dataset.importGroup
  if (group === undefined || group === '') return
  if (target?.closest('[data-action="toggle-import-group"]') !== null) {
    const next = new Set(state.importGroupCollapsed)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    state.importGroupCollapsed = next
    renderImportList()
    return
  }
  // （能走到这里说明上面 closest 命中了 data-import-group，target 必非空）
  if (target.closest('[data-action="pick-import-group"]') !== null) {
    const found = groupImportSnapshots().find(([name]) => name === group)
    const entries = found === undefined ? [] : found[1]
    const groupIndices = importableIndicesOfGroup(entries)
    const isGroupFullySelected =
      groupIndices.length > 0 && groupIndices.every((index) => state.existingSelection.has(index))
    const next = new Set(state.existingSelection)
    for (const index of groupIndices) {
      if (isGroupFullySelected) next.delete(index)
      else next.add(index)
    }
    state.existingSelection = next
    syncImportSelectionViews()
  }
}

/**
 * 把指定快照导入规则库（导入弹框与表格勾选批量导入共用）
 *
 * 不可导入的逐条跳过并在结果里报数——不静默丢，否则用户以为 10 条全导进来了，
 * 实际只进了 3 条。
 */
function importSnapshots(
  snapshots: readonly ForeignRuleSnapshot[],
  indices: readonly number[],
): void {
  const imported: ConditionalFormatRule[] = []
  let skipped = 0
  for (const index of indices) {
    const snapshot = snapshots[index - 1]
    // 用条件包裹而非 continue（项目禁 continue）：snapshot 缺失说明序号越界，
    // 跳过这条继续处理其余选中项
    if (snapshot) {
      // 组名随导入带进规则库：表格里归好的组不丢结构
      const rule = foreignSnapshotToRule(snapshot, nextId, groupOfSnapshot(snapshot))
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
  showToast(
    `已导入 ${String(imported.length)} 条规则${skipped > 0 ? `（${String(skipped)} 条类型不支持，已跳过）` : ''}`,
    skipped > 0 ? 'info' : 'success',
  )
}

// ===== 导出规则 =====

/**
 * 规则导出的统一出口：选位置 → 写文件 →（FSO 不可用）回退下载
 *
 * momo：所有导出都要能选择保存的位置。通道见 tools/save-file：
 * WPS 原生另存为对话框（预填默认导出位置）+ FSO 直写，失败才回退 Blob 下载。
 *
 * 「最近一次即默认」：用户这次选的目录若与记忆的不同，顺手写回
 * 默认导出位置（设置页「默认导出位置」读同一配置键，即时同步）——
 * 不用为了改默认再跑一趟设置页。
 *
 * @returns 是否成功保存（用户取消也是 false，调用方静默返回即可）
 */
function saveRulesJson(rules: readonly ConditionalFormatRule[], label: string): boolean {
  const today = new Date().toISOString().slice(0, 10)
  const payload = {
    format: 'bgm-conditional-format-rules',
    version: 1,
    exportedAt: new Date().toISOString(),
    rules,
  }
  const result = saveTextFileWithDialog({
    title: `导出${label}（选择保存位置）`,
    defaultDir: getExportPath(true),
    fileName: `bgm-${label}-${today}.json`,
    content: JSON.stringify(payload, null, 2),
    filterDescription: '规则文件 (*.json)',
    filterExtensions: '*.json',
  })
  // 用户取消（null）：不提示、不动默认位置、返回 false
  const isCancelled = result === null
  if (isCancelled) return false

  // 降级通道（FSO 不可用）：落浏览器下载目录，toast 明示落点
  const isDownloadFallback = result.path === ''
  if (isDownloadFallback) {
    showToast(`已导出 ${String(rules.length)} 条${label}到浏览器下载目录`, 'success')
    return true
  }

  const chosenDirectory = directoryNameOf(result.path)
  // 「最近一次即默认」：这次选的目录与记忆不同 → 写回默认导出位置
  // （设置页「默认导出位置」读同一配置键，即时同步）
  const hasChosenDirectory = chosenDirectory !== ''
  const isNewDefaultDirectory = hasChosenDirectory && chosenDirectory !== getExportPath(true)
  if (isNewDefaultDirectory) {
    setExportPath(chosenDirectory)
    showToast(`已记住为默认导出位置: ${chosenDirectory}`, 'info')
  }
  showToast(`已导出 ${String(rules.length)} 条${label}到 ${result.path}`, 'success')
  return true
}

/** 导出整个规则库（备份 / 迁移 / 分享） */
function exportRules(): void {
  if (state.rules.length === 0) {
    showToast('规则库是空的，先新建或导入几条', 'warn')
    return
  }
  saveRulesJson(state.rules, '规则库')
}

/** 导出所选规则（规则管理勾选 / 分组内勾选 / 规则管理器批量条共用） */
function exportSelectedRules(rules: readonly ConditionalFormatRule[], label: string): void {
  if (rules.length === 0) {
    showToast('没有选中的规则', 'warn')
    return
  }
  saveRulesJson(rules, label)
}

// ===== 初始化 =====

export function initializeConditionalFormatPage(): void {
  markConditionalFormatPaneLoaded()
  initializeShellNav()
  initializeTheme()
  startThemeSync()

  // ⚠️ 宿主读取（loadRules / reloadSheets 等 COM）**不在这里做**，挪到本函数
  // 末尾的 populateFromHost()——2026-10-24 真机缺陷：桥未就绪时 collectSheets
  // 抛错会连坐整个初始化，后面全部事件绑定都装不上，下拉成了「不能点击不能
  // 选中」的死件。先装绑定（纯 DOM 不可能抛），再读宿主，读失败页面仍可用。

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
  // 两个列表的拖拽排序 + 行右键菜单（通用组件接入，只建一次）
  setupSortablesAndMenus()

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
  byId('conditionalFormatExportBtn')?.addEventListener('click', () => {
    exportRules()
  })
  // 全选 / 取消全部：作用于当前**搜索后的可见集**（与既有规则表格的
  // 全选同口径——跨搜索全选再一键删，搜不到想撤回来的项最危险）。
  // 已全选时再点 = 取消，不用另找「取消选择」。
  byId('conditionalFormatPickAllBtn')?.addEventListener('click', () => {
    const visible = filterRules(state.rules, state.searchQuery)
    if (visible.length === 0) {
      showToast('没有可全选的规则', 'warn')
      return
    }
    const visibleIds = visible.map((rule) => rule.id)
    const isAllPicked = visibleIds.every((id) => state.ruleSelection.has(id))
    const next = new Set(state.ruleSelection)
    for (const id of visibleIds) {
      if (isAllPicked) next.delete(id)
      else next.add(id)
    }
    state.ruleSelection = next
    renderRuleList()
  })
  // 批量条（勾选后才出现）：删除所选 / 导出所选 / 取消选择
  byId('conditionalFormatRuleBatchBar')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const button = target?.closest<HTMLButtonElement>('[data-rule-batch]')
    if (!button) return
    switch (button.dataset.ruleBatch) {
      case 'delete': {
        deleteSelectedRules([...state.ruleSelection])
        break
      }
      case 'export': {
        const picked = state.rules.filter((rule) => state.ruleSelection.has(rule.id))
        exportSelectedRules(picked, '所选规则')
        break
      }
      case 'clear': {
        state.ruleSelection = new Set<string>()
        renderRuleList()
        break
      }
      default: {
        break
      }
    }
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

  // 编辑器浮层：点遮罩空白处关闭（与确认模态框同口径，点内容不关）
  byId('conditionalFormatEditorMask')?.addEventListener('click', (event) => {
    if (event.target === byId('conditionalFormatEditorMask')) closeEditor()
  })

  // 五个模态框统一补「窗口三件套」：拖标题栏移动 + ⛶ 最大化/还原 + ▾ 收起 +
  // 右下角缩放把手——能力原语在 window-chrome（与浮动窗共用的窗口能力层）。
  // 窄任务窗格里遮罩居中的模态框又小又挡内容，此前只能看不能调（momo：加上
  // 浮动窗口模块的收起和放大等功能）。
  // [遮罩 id, 标题栏 id, 收起按钮 id, 最大化按钮 id, 缩放把手 id]
  const MODAL_SPECS: readonly (readonly [string, string, string, string, string])[] = [
    [
      'conditionalFormatEditorMask',
      'conditionalFormatEditorTitle',
      'conditionalFormatEditorCollapse',
      'conditionalFormatEditorMax',
      'conditionalFormatEditorResize',
    ],
    [
      'conditionalFormatImportMask',
      'conditionalFormatImportTitle',
      'conditionalFormatImportCollapse',
      'conditionalFormatImportMax',
      'conditionalFormatImportResize',
    ],
    [
      'conditionalFormatGroupMask',
      'conditionalFormatGroupTitle',
      'conditionalFormatGroupCollapse',
      'conditionalFormatGroupMax',
      'conditionalFormatGroupResize',
    ],
    [
      'conditionalFormatConfirmMask',
      'conditionalFormatConfirmTitle',
      'conditionalFormatConfirmCollapse',
      'conditionalFormatConfirmMax',
      'conditionalFormatConfirmResize',
    ],
    [
      'conditionalFormatPasteMask',
      'conditionalFormatPasteTitle',
      'conditionalFormatPasteCollapse',
      'conditionalFormatPasteMax',
      'conditionalFormatPasteResize',
    ],
  ]
  for (const [maskId, titleId, collapseId, maximizeId, resizeId] of MODAL_SPECS) {
    const mask = byId(maskId)
    const modal = mask?.querySelector<HTMLElement>('.conditional-format-modal')
    const grip = byId(titleId)
    if (modal && grip) bindModalDrag({ modal, grip })
    const collapseButton = byId(collapseId)
    if (modal && collapseButton) bindModalCollapse({ modal, button: collapseButton })
    const maximizeButton = byId(maximizeId)
    if (modal && maximizeButton) bindModalMaximize({ modal, button: maximizeButton })
    const resizeHandle = byId(resizeId)
    if (modal && resizeHandle) bindModalResize({ modal, handle: resizeHandle })
  }

  // 粘贴规则弹窗：确定 / 取消 / 遮罩关闭（三件套已在上面统一绑）
  const pasteMask = byId('conditionalFormatPasteMask')
  byId('conditionalFormatPasteOk')?.addEventListener('click', () => {
    confirmPaste()
  })
  byId('conditionalFormatPasteCancel')?.addEventListener('click', () => {
    closePasteModal()
  })
  pasteMask?.addEventListener('click', (event) => {
    if (event.target === pasteMask) closePasteModal()
  })

  // 颜色字段：选择器 / 十六进制手输 / 吸管三边联动（吸管按钮不支持时保持隐藏）
  for (const field of COLOR_FIELDS) {
    bindColorField(field)
  }

  // 既有规则分组：自动聚类 / 清除 / 归组弹窗
  byId('conditionalFormatClusterBtn')?.addEventListener('click', () => {
    autoClusterExistingGroups()
  })
  byId('conditionalFormatMergeBtn')?.addEventListener('click', () => {
    mergeExistingDuplicates()
  })
  byId('conditionalFormatRepairAnchorBtn')?.addEventListener('click', () => {
    repairAnchors(false)
  })
  byId('conditionalFormatFixCellBtn')?.addEventListener('click', () => {
    fixRulesToCell()
  })
  byId('conditionalFormatClearGroupsBtn')?.addEventListener('click', () => {
    clearExistingGroups()
  })
  byId('conditionalFormatGroupConfirm')?.addEventListener('click', () => {
    confirmGroupName()
  })
  byId('conditionalFormatGroupCancel')?.addEventListener('click', () => {
    closeGroupNameModal()
  })
  byId('conditionalFormatGroupMask')?.addEventListener('click', (event) => {
    if (event.target === byId('conditionalFormatGroupMask')) closeGroupNameModal()
  })

  // 导入手工规则：选择弹框（全选 / 全不选 / 确认 / 取消 / 遮罩）
  byId('conditionalFormatImportConfirm')?.addEventListener('click', () => {
    const indices = [...state.existingSelection].sort((a, b) => a - b)
    closeImportModal()
    importSnapshots(state.importForeignRules, indices)
  })
  byId('conditionalFormatImportCancel')?.addEventListener('click', () => {
    closeImportModal()
  })
  byId('conditionalFormatImportMask')?.addEventListener('click', (event) => {
    if (event.target === byId('conditionalFormatImportMask')) closeImportModal()
  })
  byId('conditionalFormatImportAll')?.addEventListener('click', () => {
    state.existingSelection = new Set(selectableImportIndices())
    syncImportSelectionViews()
  })
  byId('conditionalFormatImportNone')?.addEventListener('click', () => {
    state.existingSelection = new Set<number>()
    syncImportSelectionViews()
  })
  // 组标题按钮（收起 / 展开分组、组内全选）走 click 委托
  byId('conditionalFormatImportList')?.addEventListener('click', (event) => {
    handleImportListClick(event)
  })
  // 列表勾选走 change 委托；勾选只更新确认按钮计数，不重建列表（保住焦点，
  // 用户连勾十几条时不用每次重新点）
  byId('conditionalFormatImportList')?.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | null
    const rawIndex = target?.dataset.importCheck
    if (rawIndex === undefined) return
    const index = Number(rawIndex)
    if (!Number.isSafeInteger(index) || index < 1) return
    const next = new Set(state.existingSelection)
    if (target?.checked === true) next.add(index)
    else next.delete(index)
    state.existingSelection = next
    // 联动：弹框里勾一条，表格与批量条同步亮起（不重建弹框列表——保住焦点，
    // 用户连勾十几条时不用每次重新点）
    renderExistingRules()
    setText('conditionalFormatImportConfirm', `导入所选（${String(next.size)}）`)
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
    if (event.key !== 'Escape') return
    closeConfirmModal()
    // 其余弹窗也关：各 close 幂等（没开时 no-op），一次 Esc 全收
    closeEditor()
    closeImportModal()
    closeGroupNameModal()
    closePasteModal()
  })

  // ---- 宿主读取放在全部绑定之后：抛错也只损失首屏数据，不损失交互 ----
  populateFromHost()

  renderRuleList()

  // 启用 data-action 按钮：漏了这一步，页面按钮会灰 5 秒直到门禁超时兜底
  notifyModulesReady()
}

/**
 * 首屏宿主读取（COM 集中在这里；抛错时绑定已装完，页面仍可用）
 *
 * 典型失败场景：宿主初始化窗口内同步跨进程 COM 抛错（JSAPI 桥未就绪，或被
 * JsApiDevTool 调速器限速拖慢看门狗）。此时只报告「首屏数据没读到」并给恢复
 * 路径——下拉显示「（无已打开的工作簿）」，「🔄 刷新列表」按钮是绑好的，点一
 * 下重新枚举即可。绝不让异常把初始化连坐掉（那才是真机「组件不能点击」的本因）。
 */
function populateFromHost(): void {
  try {
    loadRules()
    loadExistingGroups()
    state.selectedKey = getConfig(KEY_SHEET, '', true)
    // 进入时重放：其它页获取的工作簿/表/列/行一次性显示（读一次存储，零轮询）
    mountDataContextNotice('conditional-format')
    reloadSheets()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[conditionalFormat] 首屏宿主读取失败：${message}`)
    showToast('读取工作簿列表失败，请点「🔄 刷新列表」重试', 'error')
    // 下拉渲染成明确的空态（有刷新按钮可点），不是静默的空下拉
    renderWorkbookSelect()
    renderSheetSelect()
  }
}

// ===== 「既有规则」拖出为浮动「规则管理器」窗口 =====

/**
 * 绑定「规则管理器」工具条（显示其格式规则 + ↑↓ 调序 + 删除）
 *
 * 工具条常显在「既有规则」区内（任务窗格与专注模式共用同一份 DOM）。
 * 进入专注模式的入口在模块标题的「⛶ 只显示此模块」按钮（module-state
 * 运行时注入）——工具栏原先那个「🔍 规则管理器」按钮与之完全同一件事
 * （同调 enterSoloMode('conditional-format', 'sec-existing')），momo：
 * 按钮功能重复，已删。
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
 * 「规则管理器」的专注模式入口：模块标题的「⛶ 只显示此模块」按钮
 * （module-state 运行时注入，本文件不再装配任何入口）。
 *
 * 历史备注：这里曾有 setupRuleManagerEntry 给工具栏按钮
 * （conditionalFormatFloatBtn）绑 enterSoloMode，与 ⛶ 按钮完全同一件事，
 * 2026-10-25 momo 指出功能重复，已删——专注入口只留 ⛶ 一处。
 *
 * 为什么不再是原生独立窗口：原生 WebDialog（Application.CreateWebDialog /
 * ShowDialog）即使 `IsModal=false` 也会置顶、抢焦点，挡住用户在表格上框选区 ——
 * 这是 WPS 宿主级限制，插件侧绕不过（代码已尽力传非模态）。边看表格边管规则
 * 恰恰是它的核心场景，被挡反而本末倒置，故弃用原生。
 *
 * 页面内专注模式：本页只剩「既有规则」（配合专注模式隐藏顶栏占满任务窗格），
 * 底部控制条可 ↑↓ 切换 / 退出。任务窗格在侧边不挡表格主区。
 */

// ===== 拖拽排序 + 行右键菜单（sortable-list / context-menu 两个通用组件接入）=====

/**
 * 装配两个列表的拖拽排序与行右键菜单
 *
 * - 规则库列表：重排 = 本地 moveItemNear + 持久化（零 COM，即时生效）；
 * - 既有规则表格：重排 = 按「相邻交换」逐格调 COM 优先级（|Δ| 次
 *   moveForeignRule），完成后重读整表。WPS 没有「移动一格」原语，逐格交换
 *   是唯一不丢非公式规则（数据条 / 图标集）的办法——见 moveForeignRule 注释。
 *
 * 两个容器都是「子节点反复重渲染、容器本身不动」的形态，故 sortable 与委托
 * 菜单都只建一次；渲染函数末尾调 handle.refresh() 重新扫描项即可。
 */
function setupSortablesAndMenus(): void {
  // ---- 规则库列表 ----
  const ruleList = byId('conditionalFormatRuleList')
  if (ruleList) {
    state.ruleSortable = createSortable({
      container: ruleList,
      itemSelector: '.conditional-format-rule[data-rule-id]',
      getItemId: (item) => item.dataset.ruleId ?? '',
      // 把手启动：行内有勾选 / 可见性 / ↑↓⧉✎✕ 一堆交互元素，整行可拖
      // 会和它们抢手势（momo：现在都是可拖动的——误触排序）。从 ⋮⋮ 把手
      // 起拖，其余位置该点的点、该选的选。
      handleSelector: '.conditional-format-rule-handle',
      onReorder: (event) => {
        const next = moveItemNear(state.rules, event.fromId, event.overId, event.placeAfter)
        // 顺序没变（放到原位的邻居上）→ 不持久化不重渲染
        const hasChanged = next.some((rule, index) => rule.id !== state.rules[index]?.id)
        if (!hasChanged) return
        state.rules = next
        persistRules()
        renderRuleList()
      },
    })
    // 组标题也可拖：整组调整次序（组序 = 组内首条规则的位置，落成规则序即可）
    state.groupSortable = createSortable({
      container: ruleList,
      itemSelector: '.conditional-format-group-title',
      getItemId: (item) => item.closest<HTMLElement>('[data-group]')?.dataset.group ?? '',
      onReorder: (event) => {
        // 当前组序取**全量**规则（不是搜索后的可见序）：overId 可能只出现在
        // 可见序里，但搬迁必须落在全量序上，否则未可见的组会被挤到队尾
        const currentOrder = groupRules(state.rules).map(([group]) => group)
        const nextOrder = moveGroupNear(currentOrder, event.fromId, event.overId, event.placeAfter)
        const next = reorderGroups(state.rules, nextOrder)
        const hasChanged = next.some((rule, index) => rule.id !== state.rules[index]?.id)
        if (!hasChanged) return
        state.rules = next
        persistRules()
        renderRuleList()
      },
    })
    attachDelegatedContextMenu(ruleList, '.conditional-format-rule[data-rule-id]', (item) => {
      const id = item.dataset.ruleId ?? ''
      const rule = state.rules.find((candidate) => candidate.id === id)
      if (!rule) return []
      const index = state.rules.indexOf(rule)
      const isHidden = rule.hidden === true
      return [
        {
          id: 'edit',
          label: '✎ 编辑',
          onSelect: () => {
            openEditor(id, false)
          },
        },
        {
          id: 'copy',
          label: '⧉ 复制',
          onSelect: () => {
            copyRules([id])
          },
        },
        { id: 'sep1', separator: true },
        {
          id: 'up',
          label: '↑ 上移（提高优先级）',
          disabled: index <= 0,
          disabledReason: '已经是最高优先级',
          onSelect: () => {
            moveRule(id, -1)
          },
        },
        {
          id: 'down',
          label: '↓ 下移（降低优先级）',
          disabled: index >= state.rules.length - 1,
          disabledReason: '已经是最低优先级',
          onSelect: () => {
            moveRule(id, 1)
          },
        },
        { id: 'sep2', separator: true },
        {
          id: 'hide',
          label: isHidden ? '👁 取消隐藏' : '👁 隐藏（留在库内不应用）',
          onSelect: () => {
            toggleHidden(id, !isHidden)
          },
        },
        { id: 'sep3', separator: true },
        {
          id: 'delete',
          label: '✕ 删除',
          danger: true,
          onSelect: () => {
            deleteRule(id)
          },
        },
      ]
    })
  }

  // ---- 既有规则表格 ----
  const existingPanel = byId('conditionalFormatExistingPanel')
  if (existingPanel) {
    state.existingSortable = createSortable({
      container: existingPanel,
      itemSelector: '.conditional-format-row[data-row-index]',
      getItemId: (item) => item.dataset.rowIndex ?? '',
      // 提交后整表重读、行号整体漂移：按旧行号找不到「移动后的项」，
      // 落位动画会飞错位置——关掉，直接撤浮层（toast 已告知结果）
      animateDrop: false,
      onReorder: (event) => {
        reorderForeignRules(event.fromId, event.overId, event.placeAfter)
      },
    })
    attachDelegatedContextMenu(existingPanel, '.conditional-format-row[data-row-index]', (item) => {
      const index = Number(item.dataset.rowIndex ?? '0')
      const snapshot = state.existing[index - 1]
      if (!snapshot) return []
      const canImport = snapshot.kind === 'expression' && snapshot.formula !== ''
      const isStopKnown = snapshot.stopIfTrue !== undefined
      return [
        {
          id: 'import',
          label: '⤵ 导入规则库',
          disabled: !canImport,
          disabledReason: '该类型插件无法重建，不能导入',
          onSelect: () => {
            importForeignRule(index)
          },
        },
        {
          id: 'group',
          label: '🏷 归入分组',
          onSelect: () => {
            state.existingSelection = new Set<number>([index])
            renderExistingRules()
            openGroupNameModal()
          },
        },
        {
          id: 'stop',
          label: snapshot.stopIfTrue === true ? '🚦 取消「如果为真则停」' : '🚦 如果为真则停',
          disabled: !isStopKnown,
          disabledReason: '当前 WPS 未暴露该属性',
          onSelect: () => {
            const entry = selectedSheet()
            if (!entry) return
            const result = setForeignStopIfTrue(
              entry.worksheet,
              index,
              snapshot.stopIfTrue !== true,
            )
            if (result.ok) loadExistingRules()
            else showToast(`设置失败：${result.error}`, 'error')
          },
        },
        { id: 'sep1', separator: true },
        {
          id: 'up',
          label: '↑ 上移（提高优先级）',
          disabled: index <= 1,
          disabledReason: '已经是最高优先级',
          onSelect: () => {
            moveForeignRuleRow(index, -1)
          },
        },
        {
          id: 'down',
          label: '↓ 下移（降低优先级）',
          disabled: index >= state.existing.length,
          disabledReason: '已经是最低优先级',
          onSelect: () => {
            moveForeignRuleRow(index, 1)
          },
        },
        { id: 'sep2', separator: true },
        {
          id: 'delete',
          label: '✕ 从工作表删除',
          danger: true,
          onSelect: () => {
            deleteForeignRuleRow(index)
          },
        },
      ]
    })
  }
}

/**
 * 既有规则拖拽提交：从 from 逐格交换到目标位（COM 无「移动一格」原语）
 *
 * 目标位由落点推算：placeAfter ? over : over - 1；over 为 null = 移到最后。
 * 逐步调用 moveForeignRule（每次一格、写后回读校验），中途失败即停并 toast
 * 说明已完成步数——不假装成功，也不丢弃已完成的步骤。
 */
function reorderForeignRules(fromId: string, overId: string | null, isPlaceAfter: boolean): void {
  const entry = selectedSheet()
  if (!entry) return
  const from = Number(fromId)
  if (!Number.isSafeInteger(from) || from < 1 || from > state.existing.length) return
  let target = state.existing.length
  if (overId !== null) {
    const over = Number(overId)
    if (!Number.isSafeInteger(over) || over < 1 || over > state.existing.length) return
    target = isPlaceAfter ? over : over - 1
  }
  if (target === from || target < 1 || target > state.existing.length) return
  const direction: -1 | 1 = target < from ? -1 : 1
  let position = from
  let failure: string | null = null
  while (position !== target) {
    const result = moveForeignRule(entry.worksheet, position, direction)
    if (!result.ok) {
      failure = result.error
      break
    }
    position += direction
  }
  const done = Math.abs(position - from)
  if (failure !== null) {
    showToast(`调整中断：${failure}（已完成 ${String(done)} 步）`, 'error')
  } else if (done > 0) {
    showToast(`已移动 ${String(done)} 格`, 'success')
  }
  loadExistingRules()
}
