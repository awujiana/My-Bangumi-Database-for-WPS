/**
 * @fileoverview 通用清理页面的 UI 控制器
 * @module panel/cleanPage
 * @description
 * 页面**不含任何硬编码路径 / 表名 / 清理算法**：
 * - 可清理项：由 `clean-rules.ts` 的 CLEAN_RULES 渲染（新增项只改配置）；
 * - 清理范围：由 `clean-engine.ts` 的 describeCleanScope() 读取配置后展示；
 * - 预览 / 执行：全部委托引擎，页面只负责渲染与交互。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { showToast } from '../ui/dialog.js'
import { BGM, bgmLog, getApp, markCleanPaneLoaded } from '../tools/util/index.js'
import { CLEAN_EXCLUDES, CLEAN_RULES, CLEAN_TARGETS, RISK_LABELS } from './clean-rules.js'
import type { CleanRule } from './clean-rules.js'
import { formatBytes, inspectWorksheet, runCleanPlans, scanCleanRules } from './clean-engine.js'
import type { CleanScanResult } from './clean-engine.js'
import { escapeHtml } from '../tools/string-utilities.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import type { WpsWorksheet } from '../tools/wps.js'
import { initShellNav } from './shell-nav.js'
import { initTheme, startThemeSync } from '../tools/theme.js'
import { createProgress } from '../ui/components/progress.js'
import type { ProgressController } from '../ui/components/progress.js'

// ========== 状态 ==========

/** 清理执行期的进度组件实例（inline 模式，挂载在 #cleanProgressHost） */
let cleanProgress: ProgressController | null = null

// ========== 选择清理的表格 ==========

/** 配置项勾选状态持久化前缀（PluginStorage） */
const CHECK_KEY_PREFIX = 'bgm_clean_on_'

/** 工作表勾选状态持久化键前缀（按工作簿全路径区分） */
const SHEET_KEY_PREFIX = 'bgm_clean_sheets:'

/** 当前加载的工作表清单（来自用户加载后的缓存） */
interface SheetCandidate {
  /** 工作簿唯一标识：`FullName || Name` */
  workbookKey: string
  /** 工作簿名（仅展示用） */
  workbookName: string
  /** 工作簿全路径（仅展示用） */
  workbookPath: string
  /** 工作表名 */
  sheetName: string
  /** 是否满足清理条件（引擎判定：有名称列 + 数据行数在护栏内） */
  eligible: boolean
  /** 未满足条件的原因（达标时为空串） */
  reason: string
  /** 是否为月历式新番表（无「名称」表头，按专属签名识别） */
  isXinFan: boolean
  /** 命中的表头列表（仅前 8 项） */
  headers: string[]
  /** 数据行数（引擎实测） */
  dataRows: number
}

let sheetCandidates: SheetCandidate[] = []

/** 已折叠的工作簿键（仅内存，不持久化） */
const collapsedWorkbooks = new Set<string>()

/** 读取某工作簿已勾选的工作表名集合（持久化） */
function loadSelectedSheetNames(workbookKey: string): Set<string> {
  const raw = getApp()?.PluginStorage?.getItem(SHEET_KEY_PREFIX + workbookKey) ?? ''
  if (raw === '') return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value): value is string => typeof value === 'string'))
    }
  } catch {
    // 忽略损坏的持久化数据
  }
  return new Set()
}

/** 写入某工作簿已勾选的工作表名集合 */
function saveSelectedSheetNames(workbookKey: string, names: ReadonlySet<string>): void {
  getApp()?.PluginStorage?.setItem(SHEET_KEY_PREFIX + workbookKey, JSON.stringify([...names]))
}

/** 该工作簿是否已有持久化的勾选记录（用于区分「从未选过」与「显式清空」） */
function hasPersistedSelection(workbookKey: string): boolean {
  return (getApp()?.PluginStorage?.getItem(SHEET_KEY_PREFIX + workbookKey) ?? '') !== ''
}

/** 收集全部已勾选的工作表（用于引擎的 include 列表） */
function getSelectedSheetKeys(): { workbookKey: string; sheetName: string }[] {
  const result: { workbookKey: string; sheetName: string }[] = []
  for (const candidate of sheetCandidates) {
    const selected = loadSelectedSheetNames(candidate.workbookKey)
    if (selected.has(candidate.sheetName)) {
      result.push({ workbookKey: candidate.workbookKey, sheetName: candidate.sheetName })
    }
  }
  return result
}

/**
 * 渲染「选择清理的表格」区块。
 *
 * 设计要点（工作簿/工作表数量多时的可读性）：
 * - 顶部统计行：工作簿数 / 工作表数 / 已勾选数；
 * - 列表固定高度内滚动，工作簿按组分块；
 * - 每个工作簿标题可点击折叠，并提供「本簿全选 / 本簿清空」；
 * - 未识别到名称列的表**不再禁用**，仅显示 ⚠️ 原因（用户仍可勾选，规则会按列缺失自行跳过）。
 */
function renderSheetList(): void {
  const container = document.getElementById('cleanSheetList')
  if (!container) return
  const summary = document.getElementById('cleanSheetSummary')

  if (sheetCandidates.length === 0) {
    container.innerHTML = sanitizeHtml(
      '<div class="hint">点击「📋 加载工作表」枚举已打开工作簿。</div>',
    )
    if (summary) summary.textContent = ''
    return
  }

  // 按工作簿分组（保持首次出现顺序）
  const groups: { workbookKey: string; workbookName: string; items: SheetCandidate[] }[] = []
  const groupIndex = new Map<string, number>()
  for (const candidate of sheetCandidates) {
    let index = groupIndex.get(candidate.workbookKey)
    if (index === undefined) {
      index = groups.length
      groupIndex.set(candidate.workbookKey, index)
      groups.push({
        workbookKey: candidate.workbookKey,
        workbookName: candidate.workbookName,
        items: [],
      })
    }
    const group = groups[index]
    if (group) group.items.push(candidate)
  }

  let selectedCount = 0
  for (const candidate of sheetCandidates) {
    if (loadSelectedSheetNames(candidate.workbookKey).has(candidate.sheetName)) selectedCount += 1
  }
  if (summary) {
    summary.textContent = `共 ${String(groups.length)} 个工作簿 · ${String(sheetCandidates.length)} 张工作表 · 已选 ${String(selectedCount)} 张`
  }

  const blocks = groups
    .map((group) => {
      const selected = loadSelectedSheetNames(group.workbookKey)
      const isCollapsed = collapsedWorkbooks.has(group.workbookKey)
      const pickedInGroup = group.items.filter((item) => selected.has(item.sheetName)).length
      const eligibleInGroup = group.items.filter((item) => item.eligible).length

      const items = isCollapsed
        ? ''
        : group.items
            .map((candidate) => {
              const isChecked = selected.has(candidate.sheetName)
              const id = `clean-sheet-${escapeHtml(group.workbookKey)}-${escapeHtml(candidate.sheetName)}`
              const metaParts: string[] = [`${String(candidate.dataRows)} 行数据`]
              if (candidate.isXinFan) metaParts.push('🗓️ 新番表')
              if (candidate.headers.length > 0) {
                metaParts.push(`表头：${candidate.headers.join(' / ')}`)
              }
              if (!candidate.eligible && candidate.reason) {
                metaParts.push(`⚠️ ${candidate.reason}（仍可勾选，规则会按列缺失跳过）`)
              }
              const metaText = metaParts.join(' · ')
              return `
            <label class="clean-sheet-item">
              <input type="checkbox" id="${id}" data-workbook-key="${escapeHtml(group.workbookKey)}" data-sheet-name="${escapeHtml(candidate.sheetName)}" ${isChecked ? 'checked' : ''} />
              <span class="clean-sheet-item-body">
                <span class="clean-sheet-item-title">
                  <span class="clean-sheet-item-name">${escapeHtml(candidate.sheetName)}</span>
                  ${candidate.eligible ? '' : '<span class="clean-sheet-tag-warn">未识别</span>'}
                </span>
                <span class="clean-sheet-item-meta">${escapeHtml(metaText)}</span>
              </span>
            </label>`
            })
            .join('')

      return `
        <div class="clean-sheet-group">
          <div class="clean-sheet-group-head">
            <button class="clean-sheet-group-toggle" data-group-toggle="${escapeHtml(group.workbookKey)}" title="展开/折叠">
              <span class="clean-sheet-caret">${isCollapsed ? '▸' : '▾'}</span>
              <span class="clean-sheet-group-title-name">${escapeHtml(group.workbookName)}</span>
            </button>
            <span class="clean-sheet-item-meta">${String(group.items.length)} 张 · 识别 ${String(eligibleInGroup)} · 已选 ${String(pickedInGroup)}</span>
            <button class="bgm-btn small" data-group-all="${escapeHtml(group.workbookKey)}">本簿全选</button>
            <button class="bgm-btn small" data-group-none="${escapeHtml(group.workbookKey)}">清空</button>
          </div>
          ${items}
        </div>`
    })
    .join('')

  container.innerHTML = sanitizeHtml(blocks)

  // 勾选变化：写入持久化 + 让预览失效 + 刷新统计
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const workbookKey = box.dataset.workbookKey ?? ''
      const sheetName = box.dataset.sheetName ?? ''
      if (!workbookKey || !sheetName) return
      const selected = loadSelectedSheetNames(workbookKey)
      if (box.checked) {
        selected.add(sheetName)
      } else {
        selected.delete(sheetName)
      }
      saveSelectedSheetNames(workbookKey, selected)
      invalidatePreview()
      refreshSheetSummary()
    })
  })

  // 折叠 / 展开
  container.querySelectorAll<HTMLButtonElement>('[data-group-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.groupToggle ?? ''
      if (!key) return
      if (collapsedWorkbooks.has(key)) {
        collapsedWorkbooks.delete(key)
      } else {
        collapsedWorkbooks.add(key)
      }
      renderSheetList()
    })
  })

  // 本簿全选 / 清空
  container.querySelectorAll<HTMLButtonElement>('[data-group-all]').forEach((button) => {
    button.addEventListener('click', () => {
      setGroupSelection(button.dataset.groupAll ?? '', true)
    })
  })
  container.querySelectorAll<HTMLButtonElement>('[data-group-none]').forEach((button) => {
    button.addEventListener('click', () => {
      setGroupSelection(button.dataset.groupNone ?? '', false)
    })
  })
}

/** 切换单个工作簿内全部工作表的勾选状态 */
function setGroupSelection(workbookKey: string, isChecked: boolean): void {
  if (!workbookKey) return
  const selected = loadSelectedSheetNames(workbookKey)
  const targets = sheetCandidates.filter((candidate) => candidate.workbookKey === workbookKey)
  for (const candidate of targets) {
    if (isChecked) {
      selected.add(candidate.sheetName)
    } else {
      selected.delete(candidate.sheetName)
    }
  }
  saveSelectedSheetNames(workbookKey, selected)
  renderSheetList()
  invalidatePreview()
}

/** 仅刷新顶部统计（避免每次勾选都重绘整个列表） */
function refreshSheetSummary(): void {
  const summary = document.getElementById('cleanSheetSummary')
  if (!summary || sheetCandidates.length === 0) return
  const workbookKeys = new Set(sheetCandidates.map((candidate) => candidate.workbookKey))
  let selectedCount = 0
  for (const candidate of sheetCandidates) {
    if (loadSelectedSheetNames(candidate.workbookKey).has(candidate.sheetName)) selectedCount += 1
  }
  summary.textContent = `共 ${String(workbookKeys.size)} 个工作簿 · ${String(sheetCandidates.length)} 张工作表 · 已选 ${String(selectedCount)} 张`
}

/** 读取路径是否命中任一关键词（大小写不敏感） */
function hasAnyKeyword(value: string, keywords: readonly string[]): boolean {
  if (keywords.length === 0) return false
  const lower = value.toLowerCase()
  return keywords.some((keyword) => keyword !== '' && lower.includes(keyword.toLowerCase()))
}

/** 读取工作簿全路径 */
function readWorkbookPath(wb: { FullName?: string; Name: string }): string {
  try {
    return wb.FullName ?? wb.Name
  } catch {
    return ''
  }
}

/** 是否允许处理该工作簿（沿用 CLEAN_TARGETS.excludeWorkbookPath） */
function isWorkbookAllowed(path: string): boolean {
  return !hasAnyKeyword(path, CLEAN_TARGETS.excludeWorkbookPath)
}

interface WpsWorkbookLike {
  Name: string
  FullName?: string
  Worksheets?: { Count: number; Item(index: number): unknown }
}

/** 构造勾选候选：识别结果全部来自引擎（inspectWorksheet），页面不再自行探测 */
function buildSheetCandidate(
  wb: WpsWorkbookLike,
  path: string,
  ws: unknown,
): SheetCandidate | null {
  const sheetName = (() => {
    try {
      return (ws as { Name?: string }).Name ?? ''
    } catch {
      return ''
    }
  })()
  if (!sheetName || hasAnyKeyword(sheetName, CLEAN_EXCLUDES.sheetName)) return null

  const info = inspectWorksheet(ws as WpsWorksheet)
  return {
    workbookKey: path || wb.Name,
    workbookName: wb.Name,
    workbookPath: path,
    sheetName,
    eligible: info.eligible,
    reason: info.reason,
    isXinFan: info.isXinFan,
    headers: info.headers,
    dataRows: info.dataRows,
  }
}

/** 枚举已打开工作簿中的全部可选工作表（异常由调用方 try 包裹） */
function collectSheetCandidates(workbooks: {
  Count: number
  Item(index: number): unknown
}): SheetCandidate[] {
  const candidates: SheetCandidate[] = []
  const count = workbooks.Count
  for (let wbIndex = 1; wbIndex <= count; wbIndex += 1) {
    const wb = workbooks.Item(wbIndex) as WpsWorkbookLike
    const path = readWorkbookPath(wb)
    if (isWorkbookAllowed(path)) {
      const sheets = wb.Worksheets
      if (sheets) {
        const sheetCount = sheets.Count
        for (let sheetIndex = 1; sheetIndex <= sheetCount; sheetIndex += 1) {
          const candidate = buildSheetCandidate(wb, path, sheets.Item(sheetIndex))
          if (candidate) candidates.push(candidate)
        }
      }
    }
  }
  return candidates
}

/** 加载工作簿 → 工作表清单 */
function handleLoadSheets(): void {
  const app = getApp()
  if (!app) {
    BGM.Dialog.alert('提示', '未连接到 Excel / WPS，请打开工作簿后重试')
    return
  }
  try {
    const workbooks = (app as { Workbooks?: { Count: number; Item(index: number): unknown } })
      .Workbooks
    if (!workbooks) {
      sheetCandidates = []
      renderSheetList()
      appendLog('未找到已打开的工作簿', 'warn')
      return
    }
    sheetCandidates = collectSheetCandidates(workbooks)
    const autoPicked = preselectEligibleSheets()
    renderSheetList()

    const eligible = sheetCandidates.filter((candidate) => candidate.eligible).length
    appendLog(
      `已加载 ${String(sheetCandidates.length)} 张工作表（识别 ${String(eligible)} 张，自动勾选 ${String(autoPicked)} 张）`,
      'info',
    )
    if (eligible === 0 && sheetCandidates.length > 0) {
      appendLog(
        '未识别到「名称 / Bangumi_URL」列的数据表；可手动勾选任意工作表，规则会按列缺失自动跳过',
        'warn',
      )
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog(`加载工作表失败：${message}`, 'error')
    showToast(`加载工作表失败：${message}`, 'error')
  }
}

/** 为单个工作簿预勾选识别成功的工作表；返回勾选数量（已有持久化选择则不动） */
function preselectWorkbook(workbookKey: string): number {
  if (hasPersistedSelection(workbookKey)) return 0
  const eligible = sheetCandidates
    .filter((item) => item.workbookKey === workbookKey && item.eligible)
    .map((item) => item.sheetName)
  if (eligible.length === 0) return 0
  saveSelectedSheetNames(workbookKey, new Set(eligible))
  return eligible.length
}

/**
 * 首次加载时自动勾选「识别成功」的工作表（仅针对从未持久化过选择的工作簿），
 * 让用户不必逐张点选即可直接扫描；已有持久化选择的工作簿保持用户原选择不变。
 */
function preselectEligibleSheets(): number {
  const workbookKeys = [...new Set(sheetCandidates.map((candidate) => candidate.workbookKey))]
  let picked = 0
  for (const workbookKey of workbookKeys) {
    picked += preselectWorkbook(workbookKey)
  }
  return picked
}

/** 全选 / 全不选工作表（全部候选表均可勾选；未识别表会显示 ⚠️ 提示） */
function handleSelectAllSheets(isAll: boolean): void {
  const byWorkbook = new Map<string, Set<string>>()
  for (const candidate of sheetCandidates) {
    let selected = byWorkbook.get(candidate.workbookKey)
    if (!selected) {
      selected = isAll ? new Set<string>() : loadSelectedSheetNames(candidate.workbookKey)
      byWorkbook.set(candidate.workbookKey, selected)
    }
    if (isAll) {
      selected.add(candidate.sheetName)
    } else {
      selected.delete(candidate.sheetName)
    }
  }
  for (const [workbookKey, selected] of byWorkbook) {
    saveSelectedSheetNames(workbookKey, selected)
  }
  renderSheetList()
  invalidatePreview()
}

// ========== 勾选状态持久化（清理项） ==========

/** 当前扫描结果（执行按钮依赖它） */
let scanResult: CleanScanResult | null = null

/** 是否正在执行（防重入） */
let isRunning = false

// ========== 勾选状态持久化 ==========

/** 读取某清理项是否勾选（未持久化时用规则默认值） */
function isRuleChecked(rule: CleanRule): boolean {
  const app = getApp()
  const raw = app?.PluginStorage?.getItem(CHECK_KEY_PREFIX + rule.id) ?? ''
  // 未持久化（空串）时回退到规则配置的默认值
  if (raw === '') return rule.defaultOn
  return raw === 'true'
}

/** 写入某清理项的勾选状态 */
function setRuleChecked(ruleId: string, isChecked: boolean): void {
  getApp()?.PluginStorage?.setItem(CHECK_KEY_PREFIX + ruleId, isChecked ? 'true' : 'false')
}

/** 当前勾选的规则 ID 列表（按配置顺序） */
function getSelectedRuleIds(): string[] {
  return CLEAN_RULES.filter((rule) => {
    const box = document.getElementById(`clean-item-${rule.id}`) as HTMLInputElement | null
    return box?.checked === true
  }).map((rule) => rule.id)
}

// ========== 日志 ==========

/** 追加一行日志到日志区 */
function appendLog(message: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info'): void {
  const box = document.getElementById('cleanLog')
  if (!box) return
  const line = document.createElement('div')
  line.className = `clean-log-line clean-log-${level}`
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`
  box.appendChild(line)
  box.scrollTop = box.scrollHeight
  bgmLog(LOG_LEVELS.INFO, `[cleanPage] ${message}`)
}

/** 清空日志区 */
function clearLog(): void {
  const box = document.getElementById('cleanLog')
  if (box) box.replaceChildren()
}

// ========== 渲染：可清理项列表 ==========

/** 按 group 分组（保持配置中的首次出现顺序） */
function groupRules(rules: readonly CleanRule[]): { group: string; items: CleanRule[] }[] {
  const groups: { group: string; items: CleanRule[] }[] = []
  for (const rule of rules) {
    const existing = groups.find((entry) => entry.group === rule.group)
    if (existing) {
      existing.items.push(rule)
    } else {
      groups.push({ group: rule.group, items: [rule] })
    }
  }
  return groups
}

/** 渲染勾选列表（完全由 CLEAN_RULES 驱动） */
function renderCleanItems(): void {
  const container = document.getElementById('cleanItemList')
  if (!container) return

  const blocks = groupRules(CLEAN_RULES)
    .map((entry) => {
      const items = entry.items
        .map((rule) => {
          const isChecked = isRuleChecked(rule)
          return `
          <label class="clean-item">
            <input type="checkbox" id="clean-item-${escapeHtml(rule.id)}" ${isChecked ? 'checked' : ''} />
            <span class="clean-item-body">
              <span class="clean-item-title">
                <span class="clean-item-icon" aria-hidden="true">${escapeHtml(rule.icon)}</span>
                <span class="clean-item-name">${escapeHtml(rule.name)}</span>
                <span class="clean-risk clean-risk-${rule.risk}">${escapeHtml(RISK_LABELS[rule.risk])}</span>
              </span>
              <span class="clean-item-desc">${escapeHtml(rule.desc)}</span>
            </span>
          </label>`
        })
        .join('')
      return `<div class="clean-group"><div class="clean-group-title">${escapeHtml(entry.group)}</div>${items}</div>`
    })
    .join('')

  container.innerHTML = sanitizeHtml(blocks)

  // 勾选变化即时持久化，并让预览失效
  for (const rule of CLEAN_RULES) {
    const box = document.getElementById(`clean-item-${rule.id}`) as HTMLInputElement | null
    if (box) {
      box.addEventListener('change', () => {
        setRuleChecked(rule.id, box.checked)
        invalidatePreview()
      })
    }
  }
}

/** 预览失效：清空预览区并禁用执行按钮 */
function invalidatePreview(): void {
  scanResult = null
  const summary = document.getElementById('cleanPreviewSummary')
  if (summary) summary.innerHTML = '<p class="hint">勾选后点击「🔍 扫描预览」查看待清理条目。</p>'
  const detail = document.getElementById('cleanPreviewDetail')
  if (detail) detail.replaceChildren()
  const runButton = document.getElementById('cleanRunBtn') as HTMLButtonElement | null
  if (runButton) runButton.disabled = true
}

// ========== 预览 ==========

/** 渲染执行前预览 */
function renderPreview(result: CleanScanResult): void {
  const summary = document.getElementById('cleanPreviewSummary')
  if (summary) {
    summary.innerHTML = sanitizeHtml(`
      <div class="clean-stat-grid">
        <div class="clean-stat-card">
          <div class="clean-stat-value">${String(result.fileCount)}</div>
          <div class="clean-stat-label">涉及文件</div>
        </div>
        <div class="clean-stat-card">
          <div class="clean-stat-value">${String(result.targetCount)}</div>
          <div class="clean-stat-label">目标工作表</div>
        </div>
        <div class="clean-stat-card">
          <div class="clean-stat-value">${String(result.itemCount)}</div>
          <div class="clean-stat-label">待清理条目</div>
        </div>
        <div class="clean-stat-card accent">
          <div class="clean-stat-value">${escapeHtml(formatBytes(result.estimatedBytes))}</div>
          <div class="clean-stat-label">预计释放空间</div>
        </div>
      </div>
    `)
  }

  const detail = document.getElementById('cleanPreviewDetail')
  if (detail) {
    if (result.plans.length === 0) {
      detail.innerHTML = '<p class="hint">🎉 未发现需要清理的数据。</p>'
    } else {
      const rows = result.plans
        .map(
          (plan) => `
          <tr>
            <td>${escapeHtml(plan.ruleName)}</td>
            <td title="${escapeHtml(plan.targetLabel)}">${escapeHtml(plan.targetLabel)}</td>
            <td class="num">${String(plan.deleteRows.length)}</td>
            <td class="num">${String(plan.changes.length)}</td>
            <td class="num">${escapeHtml(formatBytes(plan.estimatedBytes))}</td>
          </tr>`,
        )
        .join('')
      detail.innerHTML = sanitizeHtml(`
        <div class="clean-table-wrap">
          <table class="clean-table">
            <thead>
              <tr><th>清理项</th><th>目标</th><th>删除行</th><th>单元格</th><th>预计释放</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `)
    }
  }

  const runButton = document.getElementById('cleanRunBtn') as HTMLButtonElement | null
  if (runButton) runButton.disabled = result.plans.length === 0
}

/** 扫描预览（只读，不修改任何数据） */
function handleScan(): void {
  const ruleIds = getSelectedRuleIds()
  if (ruleIds.length === 0) {
    showToast('请至少勾选一个清理项', 'warn')
    return
  }
  const selectedSheets = getSelectedSheetKeys()
  if (selectedSheets.length === 0) {
    showToast('请先在「🎯 选择清理的表格」中加载并勾选至少一张工作表', 'warn')
    return
  }
  if (!getApp()) {
    BGM.Dialog.alert('提示', '未连接到 Excel / WPS，请打开工作簿后重试')
    return
  }
  appendLog(
    `开始扫描，勾选 ${String(ruleIds.length)} 个清理项 · ${String(selectedSheets.length)} 张工作表…`,
  )
  try {
    const result = scanCleanRules(ruleIds, { selectedSheets })
    scanResult = result
    renderPreview(result)
    for (const note of result.notes) appendLog(note, 'warn')
    if (result.plans.length === 0) {
      appendLog('扫描完成：未发现需要清理的数据', 'ok')
      showToast('未发现需要清理的数据', 'info')
    } else {
      appendLog(
        `扫描完成：涉及 ${String(result.fileCount)} 个文件 / ${String(result.targetCount)} 张表，待清理 ${String(result.itemCount)} 条，预计释放 ${formatBytes(result.estimatedBytes)}`,
        'ok',
      )
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog(`扫描失败：${message}`, 'error')
    showToast(`扫描失败：${message}`, 'error')
  }
}

// ========== 执行 ==========

/**
 * 设置执行中 UI 状态
 * @remarks 进入运行态时创建 inline 进度组件；退出运行态时**保留完成态**供用户查看
 *   （由用户点「关闭」销毁），因此这里只恢复按钮可用性。
 */
function setRunningState(isRunning_: boolean): void {
  isRunning = isRunning_
  const runButton = document.getElementById('cleanRunBtn') as HTMLButtonElement | null
  const scanButton = document.getElementById('cleanScanBtn') as HTMLButtonElement | null
  if (runButton) runButton.disabled = isRunning_ || !scanResult || scanResult.plans.length === 0
  if (scanButton) scanButton.disabled = isRunning_
  if (!isRunning_) return
  cleanProgress?.hide()
  cleanProgress = createProgress({
    mode: 'inline',
    hostId: 'cleanProgressHost',
    title: '正在清理数据',
    icon: '🧹',
    enableLogs: true,
    showHeader: true,
  })
}

/** 更新进度条与实时日志 */
function updateProgress(done: number, total: number, message: string): void {
  const text = `${message}（${String(done)}/${String(total)}）`
  cleanProgress?.update(done, total, text)
  cleanProgress?.log(text)
}

/** 执行清理（二次确认 → 执行 → 结果日志） */
function handleRun(): void {
  if (isRunning) return
  if (!scanResult || scanResult.plans.length === 0) {
    showToast('请先执行扫描预览', 'warn')
    return
  }
  const result = scanResult
  BGM.Dialog.confirm(
    `即将清理 ${String(result.targetCount)} 张工作表、${String(result.itemCount)} 条数据，预计释放 ${formatBytes(result.estimatedBytes)}。\n\n删除行不可撤销，建议先备份工作簿。是否继续？`,
    (confirmed) => {
      if (!confirmed) {
        appendLog('已取消执行', 'warn')
        return
      }
      void executeClean()
    },
  )
}

/** 真正的执行流程（异步：让出事件循环以刷新进度） */
async function executeClean(): Promise<void> {
  if (!scanResult) return
  setRunningState(true)
  appendLog('开始执行清理…')
  try {
    const outcome = await runCleanPlans(scanResult, (done, total, message) => {
      updateProgress(done, total, message)
    })
    const details: string[] = []
    for (const item of outcome.targets) {
      const { error } = item
      const line =
        error === undefined
          ? `${item.targetLabel}：删除 ${String(item.deletedRows)} 行，更新 ${String(item.changedCells)} 个单元格`
          : `${item.targetLabel}：清理失败 - ${error}`
      appendLog(line, error === undefined ? 'ok' : 'error')
      details.push(line)
    }
    const finishLine = `清理完成：共删除 ${String(outcome.deletedRows)} 行、更新 ${String(outcome.changedCells)} 个单元格，涉及 ${String(outcome.fileCount)} 个文件，耗时 ${String(outcome.elapsedMs)}ms`
    appendLog(finishLine, 'ok')
    cleanProgress?.complete({ summary: finishLine, details })
    showToast(
      `清理完成：删除 ${String(outcome.deletedRows)} 行，更新 ${String(outcome.changedCells)} 个单元格`,
      'success',
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog(`执行失败：${message}`, 'error')
    cleanProgress?.complete({ summary: `执行失败：${message}`, ok: false, icon: '❌' })
    showToast(`执行失败：${message}`, 'error')
  } finally {
    setRunningState(false)
    // 执行后预览已失效，提示重新扫描
    scanResult = null
    const runButton = document.getElementById('cleanRunBtn') as HTMLButtonElement | null
    if (runButton) runButton.disabled = true
  }
}

// ========== 初始化 ==========

/** 绑定按钮（data-action 之外，本页面用显式 id 绑定，避免与全局 ACTION_HANDLERS 冲突） */
function bindButtons(): void {
  document.getElementById('cleanScanBtn')?.addEventListener('click', handleScan)
  document.getElementById('cleanRunBtn')?.addEventListener('click', handleRun)
  document.getElementById('cleanClearLogBtn')?.addEventListener('click', clearLog)
  document.getElementById('cleanLoadSheetsBtn')?.addEventListener('click', handleLoadSheets)
  document.getElementById('cleanSelectAllSheetsBtn')?.addEventListener('click', () => {
    handleSelectAllSheets(true)
  })
  document.getElementById('cleanSelectNoneSheetsBtn')?.addEventListener('click', () => {
    handleSelectAllSheets(false)
  })
  document.getElementById('cleanSelectAllBtn')?.addEventListener('click', () => {
    for (const rule of CLEAN_RULES) {
      const box = document.getElementById(`clean-item-${rule.id}`) as HTMLInputElement | null
      if (box) {
        box.checked = true
        setRuleChecked(rule.id, true)
      }
    }
    invalidatePreview()
  })
  document.getElementById('cleanSelectNoneBtn')?.addEventListener('click', () => {
    for (const rule of CLEAN_RULES) {
      const box = document.getElementById(`clean-item-${rule.id}`) as HTMLInputElement | null
      if (box) {
        box.checked = false
        setRuleChecked(rule.id, false)
      }
    }
    invalidatePreview()
  })
}

/**
 * 初始化清理页面。
 * 幂等：重复调用只会重复渲染（不重复绑定按钮），由 bootstrap 保证单次调用。
 */
export function initCleanPage(): void {
  if (typeof document === 'undefined') return
  // 记录页面已成功加载，供 showCleanPanel 判断缓存的面板 ID 是否有效
  markCleanPaneLoaded()
  initTheme()
  startThemeSync()
  initShellNav()
  renderSheetList()
  renderCleanItems()
  bindButtons()
  invalidatePreview()
  appendLog('清理页已就绪：点击「📋 加载工作表」选择要清理的表格')
}
