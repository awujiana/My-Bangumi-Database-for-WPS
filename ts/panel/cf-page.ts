/**
 * @fileoverview 条件格式管理页 UI 控制器
 * @module panel/cfPage
 * @description 「条件格式管理」独立页：任意工作表可选、规则搜索/分组/隐藏/排序/
 *   复制粘贴/编辑、默认规则集生成、双策略应用（应用前读手工规则快照，弹模态框
 *   列出范围+公式，用户选「清掉后应用」或「保留手工规则」）。
 *
 * 本页面只做渲染与编排，判断逻辑全在纯函数引擎（cf-rules.ts），宿主交互全在
 * cf-apply.ts——单测覆盖在那一层，页面保持薄。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { showInput, showToast } from '../ui/dialog.js'
import { escapeHtml, colNumberToLetter } from '../tools/string-utilities.js'
import {
  bgmLog,
  findHeaderRow,
  getApp,
  getColumnMap,
  markCfPaneLoaded,
} from '../tools/util/index.js'
import { getConfig, setConfig } from '../tools/config.js'
import {
  CF_GROUP_HIGHLIGHT,
  CF_STRATEGY_FALLBACK,
  CF_STORE_KEY,
  CF_STRATEGY_KEY,
  buildDefaultRules,
  filterRules,
  firstRowOfRange,
  groupRules,
  parseRules,
  planApply,
  serializeRules,
  shiftFormulaRows,
} from './cf-rules.js'
import type { ApplyStrategy, CfRule, ForeignRuleSnapshot } from './cf-rules.js'
import { applyCfPlan, isFormatConditionsSupported, readForeignRules } from './cf-apply.js'
import { initShellNav } from './shell-nav.js'
import { notifyModulesReady } from './action-buttons-gate.js'
import { initTheme, startThemeSync } from '../tools/theme.js'
import type { WpsWorksheet } from '../tools/wps.js'

// ===== 常量 =====

/** 选中工作表持久化键 */
const KEY_SHEET = 'cf.sheet.v1'

/** 导入的手工规则所在分组 */
const IMPORTED_GROUP = '导入的规则'

// ===== 页面状态 =====

interface SheetEntry {
  /** 稳定键：工作簿名::工作表名 */
  key: string
  workbook: string
  sheet: string
  ws: WpsWorksheet
}

interface PageState {
  rules: CfRule[]
  sheets: SheetEntry[]
  selectedKey: string
  /** 复制粘贴的剪贴板（规则 id，会话内有效） */
  clipboard: string[]
  /** 正在编辑的规则 id；null = 编辑器收起 */
  editingId: string | null
  /** 编辑器是否为「新建」模式 */
  editingIsNew: boolean
  searchQuery: string
  /** 模态框里待定的策略选择（打开模态框时置位） */
  pendingStrategy: ApplyStrategy
}

const state: PageState = {
  rules: [],
  sheets: [],
  selectedKey: '',
  clipboard: [],
  editingId: null,
  editingIsNew: false,
  searchQuery: '',
  pendingStrategy: CF_STRATEGY_FALLBACK,
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

// ===== 工作表枚举 =====

interface WorkbookLike {
  Name: string
  Worksheets?: { Count: number; Item(index: number): unknown }
}

function readSheetName(ws: unknown): string {
  try {
    return (ws as { Name?: string }).Name ?? ''
  } catch {
    return ''
  }
}

/** 枚举已打开工作簿的全部工作表（Count 提循环外，守 com-in-loop） */
function collectSheets(): SheetEntry[] {
  const app = getApp() as {
    Workbooks?: { Count: number; Item(index: number): unknown }
  } | null
  const workbooks = app?.Workbooks
  if (!workbooks) return []

  const entries: SheetEntry[] = []
  const wbCount = workbooks.Count
  for (let wbIndex = 1; wbIndex <= wbCount; wbIndex += 1) {
    const wb = workbooks.Item(wbIndex) as WorkbookLike
    const sheets = wb.Worksheets
    if (sheets) {
      const sheetCount = sheets.Count
      for (let sheetIndex = 1; sheetIndex <= sheetCount; sheetIndex += 1) {
        const ws = sheets.Item(sheetIndex) as WpsWorksheet
        const sheet = readSheetName(ws)
        if (sheet) {
          entries.push({ key: `${wb.Name}::${sheet}`, workbook: wb.Name, sheet, ws })
        }
      }
    }
  }
  return entries
}

function renderSheetSelect(): void {
  const select = selectById('cfSheet')
  if (!select) return
  if (state.sheets.length === 0) {
    select.innerHTML = '<option value="">（未找到已打开的工作表）</option>'
    return
  }
  select.innerHTML = state.sheets
    .map(
      (entry) =>
        `<option value="${escapeHtml(entry.key)}"${entry.key === state.selectedKey ? ' selected' : ''}>${escapeHtml(
          `${entry.workbook} · ${entry.sheet}`,
        )}</option>`,
    )
    .join('')
}

function selectedSheet(): SheetEntry | null {
  return state.sheets.find((entry) => entry.key === state.selectedKey) ?? null
}

/** 重新枚举并定位选中表（选中失效时回退第一张） */
function reloadSheets(): void {
  state.sheets = collectSheets()
  const isSelectionValid = state.sheets.some((entry) => entry.key === state.selectedKey)
  if (!isSelectionValid && state.sheets.length > 0) {
    const first = state.sheets[0]
    state.selectedKey = first ? first.key : ''
  }
  renderSheetSelect()
}

// ===== Store 读写 =====

function loadRules(): void {
  const { rules, dropped } = parseRules(getConfig(CF_STORE_KEY, '', true))
  state.rules = rules
  if (dropped > 0) {
    bgmLog(LOG_LEVELS.WARN, `[cf] 规则库有 ${String(dropped)} 条损坏记录已忽略`)
  }
}

function persistRules(): void {
  setConfig(CF_STORE_KEY, serializeRules(state.rules))
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
  const container = byId('cfRuleList')
  if (!container) return
  const visible = filterRules(state.rules, state.searchQuery)

  if (state.rules.length === 0) {
    container.innerHTML =
      '<p class="cf-empty">规则库是空的。到「默认规则集」生成一套，或点「新建规则」手写。</p>'
    setText('cfRuleCount', '0 条规则')
    return
  }
  if (visible.length === 0) {
    container.innerHTML = '<p class="cf-empty">没有匹配当前搜索词的规则。</p>'
    setText('cfRuleCount', `0 / ${String(state.rules.length)} 条规则`)
    return
  }

  const hiddenCount = state.rules.filter((rule) => rule.hidden === true).length
  setText(
    'cfRuleCount',
    `${String(state.rules.length)} 条规则${hiddenCount > 0 ? `（${String(hiddenCount)} 条已隐藏）` : ''}`,
  )

  const groups = groupRules(visible)
  container.innerHTML = groups
    .map(([group, rules]) => {
      const rows = rules
        .map((rule) => {
          const isHidden = rule.hidden === true
          return `
        <div class="cf-rule${isHidden ? ' cf-rule-hidden' : ''}" data-rule-id="${escapeHtml(rule.id)}">
          <label class="cf-rule-vis" title="${isHidden ? '已隐藏：留在规则库但不应用' : '应用中'}">
            <input type="checkbox" data-action="toggle" ${isHidden ? '' : 'checked'} />
          </label>
          <span class="cf-swatch" style="background:${escapeHtml(rule.interior)}" title="填充 ${escapeHtml(rule.interior)}"></span>
          <div class="cf-rule-main">
            <div class="cf-rule-name">${escapeHtml(rule.name)}</div>
            <div class="cf-rule-meta">${escapeHtml(rule.appliesTo)} · <code title="${escapeHtml(rule.formula)}">${escapeHtml(
              rule.formula.length > 60 ? `${rule.formula.slice(0, 60)}…` : rule.formula,
            )}</code></div>
          </div>
          <div class="cf-rule-actions">
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
      <div class="cf-group">
        <div class="cf-group-title">${escapeHtml(group)}<span class="cf-group-count">${String(rules.length)}</span></div>
        ${rows}
      </div>`
    })
    .join('')

  container.querySelectorAll<HTMLElement>('.cf-rule').forEach((row) => {
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

function blankRule(): CfRule {
  return {
    id: nextId(),
    name: '',
    group: CF_GROUP_HIGHLIGHT,
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
  const nameInput = inputById('cfEditName')
  const groupInput = inputById('cfEditGroup')
  const rangeInput = inputById('cfEditRange')
  const formulaInput = byId('cfEditFormula') as HTMLTextAreaElement | null
  const fillInput = inputById('cfEditFill')
  const fontInput = inputById('cfEditFont')
  const boldInput = inputById('cfEditBold')
  if (nameInput) nameInput.value = rule.name
  if (groupInput) groupInput.value = rule.group
  if (rangeInput) rangeInput.value = rule.appliesTo
  if (formulaInput) formulaInput.value = rule.formula
  if (fillInput) fillInput.value = rule.interior
  if (fontInput) fontInput.value = rule.fontColor ?? '#000000'
  if (boldInput) boldInput.checked = rule.fontBold === true
  const editor = byId('cfEditor')
  if (editor) editor.style.display = 'block'
  setText('cfEditorTitle', isNew ? '新建规则' : `编辑：${rule.name || '未命名'}`)
}

function closeEditor(): void {
  state.editingId = null
  state.editingIsNew = false
  const editor = byId('cfEditor')
  if (editor) editor.style.display = 'none'
}

function saveEditor(): void {
  const nameInput = inputById('cfEditName')
  const groupInput = inputById('cfEditGroup')
  const rangeInput = inputById('cfEditRange')
  const formulaInput = byId('cfEditFormula') as HTMLTextAreaElement | null
  const fillInput = inputById('cfEditFill')
  const fontInput = inputById('cfEditFont')
  const boldInput = inputById('cfEditBold')

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
  const rule: CfRule = {
    id: existing?.id ?? nextId(),
    name,
    group: groupText === '' ? CF_GROUP_HIGHLIGHT : groupText,
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

function detectColumns(): { seasonCol: string; nameCol: string; firstRow: number } | null {
  const entry = selectedSheet()
  if (!entry) return null
  const headerRow = findHeaderRow(entry.ws)
  const colMap = getColumnMap(entry.ws, headerRow)
  const seasonColNumber = colMap.get('开播季度')
  const nameColNumber = colMap.get('名称')
  if (seasonColNumber === undefined || nameColNumber === undefined) return null
  return {
    seasonCol: colNumberToLetter(seasonColNumber),
    nameCol: colNumberToLetter(nameColNumber),
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
    `已追加 ${String(defaults.length)} 条默认规则（季列 ${detected.seasonCol} · 名称列 ${detected.nameCol}）`,
    'success',
  )
}

// ===== 应用流程（双策略）=====

function lastStrategy(): ApplyStrategy {
  const stored = getConfig(CF_STRATEGY_KEY, CF_STRATEGY_FALLBACK, true)
  return stored === 'append-after' ? 'append-after' : 'clear-all'
}

function runApply(strategy: ApplyStrategy): void {
  const entry = selectedSheet()
  if (!entry) {
    showToast('请先选择目标工作表', 'warn')
    return
  }
  if (!isFormatConditionsSupported(entry.ws)) {
    showToast('当前 WPS 版本不支持条件格式 API，该功能不可用', 'error')
    return
  }
  const visibleCount = state.rules.filter((rule) => rule.hidden !== true).length
  if (visibleCount === 0) {
    showToast('没有可应用的规则（全部隐藏了？）', 'warn')
    return
  }

  const foreign = readForeignRules(entry.ws)
  setConfig(CF_STRATEGY_KEY, strategy)
  const plan = planApply(state.rules, foreign, strategy)
  const result = applyCfPlan(entry.ws, plan)
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
    'cfApplyStatus',
    `上次应用：${entry.sheet} · ${String(result.added)} 条（失败 ${String(result.failed)}）${discardedNote}`,
  )
}

function openConfirmModal(foreign: readonly ForeignRuleSnapshot[]): void {
  const mask = byId('cfConfirmMask')
  const body = byId('cfConfirmBody')
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
    <p class="cf-modal-label">将被处理的规则：</p>
    <ul class="cf-modal-list">${rows}</ul>
    <p class="cf-modal-label">怎么处理它们？</p>`
  const clearButton = byId('cfConfirmClear')
  const keepButton = byId('cfConfirmKeep')
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
  const mask = byId('cfConfirmMask')
  if (mask) mask.style.display = 'none'
}

function applyFlow(): void {
  const entry = selectedSheet()
  if (!entry) {
    showToast('请先选择目标工作表', 'warn')
    return
  }
  if (!isFormatConditionsSupported(entry.ws)) {
    showToast('当前 WPS 版本不支持条件格式 API，该功能不可用', 'error')
    return
  }
  const visibleCount = state.rules.filter((rule) => rule.hidden !== true).length
  if (visibleCount === 0) {
    showToast('没有可应用的规则（全部隐藏了？）', 'warn')
    return
  }

  const foreign = readForeignRules(entry.ws)
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
  if (!isFormatConditionsSupported(entry.ws)) {
    showToast('当前 WPS 版本不支持条件格式 API', 'error')
    return
  }
  const foreign = readForeignRules(entry.ws)
  const expressible = foreign.filter((rule) => rule.kind === 'expression' && rule.formula)
  if (expressible.length === 0) {
    showToast('没有可导入的公式类规则', 'info')
    return
  }
  const imported: CfRule[] = expressible.map((rule) => ({
    id: nextId(),
    name: `导入 ${rule.range}`,
    group: IMPORTED_GROUP,
    appliesTo: rule.range,
    formula: rule.formula,
    interior: rule.interior ?? '#CCCCCC',
    ...(rule.fontColor !== undefined && { fontColor: rule.fontColor }),
  }))
  state.rules = [...state.rules, ...imported]
  persistRules()
  renderRuleList()
  const skipped = foreign.length - expressible.length
  showToast(
    `已导入 ${String(imported.length)} 条规则${skipped > 0 ? `（${String(skipped)} 条非公式类无法导入）` : ''}`,
    'success',
  )
}

// ===== 初始化 =====

export function initCfPage(): void {
  markCfPaneLoaded()
  initShellNav()
  initTheme()
  startThemeSync()

  loadRules()
  state.selectedKey = getConfig(KEY_SHEET, '', true)
  reloadSheets()

  // 搜索
  inputById('cfSearch')?.addEventListener('input', (event) => {
    state.searchQuery = (event.target as HTMLInputElement).value
    renderRuleList()
  })

  // 工作表选择
  selectById('cfSheet')?.addEventListener('change', (event) => {
    state.selectedKey = (event.target as HTMLSelectElement).value
    setConfig(KEY_SHEET, state.selectedKey)
  })
  byId('cfReloadSheetsBtn')?.addEventListener('click', () => {
    reloadSheets()
  })

  // 规则操作
  byId('cfNewRuleBtn')?.addEventListener('click', () => {
    openEditor(null, true)
  })
  byId('cfPasteBtn')?.addEventListener('click', () => {
    pasteRules()
  })
  byId('cfImportBtn')?.addEventListener('click', () => {
    importForeign()
  })
  byId('cfDefaultsBtn')?.addEventListener('click', () => {
    generateDefaults()
  })
  byId('cfApplyBtn')?.addEventListener('click', () => {
    applyFlow()
  })

  // 编辑器
  byId('cfEditorSave')?.addEventListener('click', () => {
    saveEditor()
  })
  byId('cfEditorCancel')?.addEventListener('click', () => {
    closeEditor()
  })

  // 确认模态框（双策略）
  byId('cfConfirmClear')?.addEventListener('click', () => {
    closeConfirmModal()
    runApply('clear-all')
  })
  byId('cfConfirmKeep')?.addEventListener('click', () => {
    closeConfirmModal()
    runApply('append-after')
  })
  byId('cfConfirmCancel')?.addEventListener('click', () => {
    closeConfirmModal()
  })
  byId('cfConfirmMask')?.addEventListener('click', (event) => {
    if (event.target === byId('cfConfirmMask')) closeConfirmModal()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeConfirmModal()
  })

  renderRuleList()

  // 启用 data-action 按钮：漏了这一步，页面按钮会灰 5 秒直到门禁超时兜底
  notifyModulesReady()
}
