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
import { CLEAN_RULES, RISK_LABELS } from './clean-rules.js'
import type { CleanRule } from './clean-rules.js'
import {
  describeCleanScope,
  formatBytes,
  runCleanPlans,
  scanCleanRules,
} from './clean-engine.js'
import type { CleanScanResult } from './clean-engine.js'
import { escapeHtml } from '../tools/string-utilities.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { initShellNav } from './shell-nav.js'
import { initTheme, startThemeSync } from '../tools/theme.js'

// ========== 状态 ==========

/** 配置项勾选状态持久化前缀（PluginStorage） */
const CHECK_KEY_PREFIX = 'bgm_clean_on_'

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

// ========== 渲染：清理范围（配置驱动） ==========

/** 把字符串数组渲染为徽章列表（空数组显示「不限制」） */
function renderKeywords(keywords: readonly string[], emptyText: string): string {
  if (keywords.length === 0) return `<span class="clean-chip muted">${escapeHtml(emptyText)}</span>`
  return keywords.map((word) => `<span class="clean-chip">${escapeHtml(word)}</span>`).join('')
}

/** 渲染清理范围（数据全部来自配置，页面不硬编码） */
function renderScope(): void {
  const box = document.getElementById('cleanScopeBody')
  if (!box) return
  const scope = describeCleanScope()
  box.innerHTML = sanitizeHtml(`
    <div class="clean-scope-row">
      <span class="clean-scope-label">工作簿包含</span>
      <span class="clean-scope-value">${renderKeywords(scope.includeWorkbookPath, '不限制')}</span>
    </div>
    <div class="clean-scope-row">
      <span class="clean-scope-label">工作簿排除</span>
      <span class="clean-scope-value">${renderKeywords(scope.excludeWorkbookPath, '无')}</span>
    </div>
    <div class="clean-scope-row">
      <span class="clean-scope-label">工作表包含</span>
      <span class="clean-scope-value">${renderKeywords(scope.includeSheetName, '按表头自动识别')}</span>
    </div>
    <div class="clean-scope-row">
      <span class="clean-scope-label">必备表头</span>
      <span class="clean-scope-value">${renderKeywords(scope.requireHeaderKeywords, '无')}</span>
    </div>
    <div class="clean-scope-row">
      <span class="clean-scope-label">排除工作表</span>
      <span class="clean-scope-value">${renderKeywords(scope.excludeSheetName, '无')}</span>
    </div>
    <div class="clean-scope-row">
      <span class="clean-scope-label">排除行文本</span>
      <span class="clean-scope-value">${renderKeywords(scope.excludeRowText, '无')}</span>
    </div>
    <div class="clean-scope-row">
      <span class="clean-scope-label">单表上限</span>
      <span class="clean-scope-value"><span class="clean-chip">${String(scope.maxDataRows)} 行</span></span>
    </div>
  `)
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
  if (!getApp()) {
    BGM.Dialog.alert('提示', '未连接到 Excel / WPS，请打开工作簿后重试')
    return
  }
  appendLog(`开始扫描，勾选 ${String(ruleIds.length)} 个清理项…`)
  try {
    const result = scanCleanRules(ruleIds)
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

/** 设置执行中 UI 状态 */
function setRunningState(isRunning_: boolean): void {
  isRunning = isRunning_
  const runButton = document.getElementById('cleanRunBtn') as HTMLButtonElement | null
  const scanButton = document.getElementById('cleanScanBtn') as HTMLButtonElement | null
  const progress = document.getElementById('cleanProgress')
  if (runButton) runButton.disabled = isRunning_ || !scanResult || scanResult.plans.length === 0
  if (scanButton) scanButton.disabled = isRunning_
  if (progress) progress.style.display = isRunning_ ? 'block' : 'none'
}

/** 更新进度条 */
function updateProgress(done: number, total: number, message: string): void {
  const bar = document.getElementById('cleanProgressFill')
  const text = document.getElementById('cleanProgressText')
  if (bar) bar.style.width = total > 0 ? `${String(Math.round((done / total) * 100))}%` : '0%'
  if (text) text.textContent = `${message}（${String(done)}/${String(total)}）`
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
    for (const item of outcome.targets) {
      if (item.error) {
        appendLog(`${item.targetLabel}：清理失败 - ${item.error}`, 'error')
      } else {
        appendLog(
          `${item.targetLabel}：删除 ${String(item.deletedRows)} 行，更新 ${String(item.changedCells)} 个单元格`,
          'ok',
        )
      }
    }
    appendLog(
      `清理完成：共删除 ${String(outcome.deletedRows)} 行、更新 ${String(outcome.changedCells)} 个单元格，涉及 ${String(outcome.fileCount)} 个文件，耗时 ${String(outcome.elapsedMs)}ms`,
      'ok',
    )
    showToast(
      `清理完成：删除 ${String(outcome.deletedRows)} 行，更新 ${String(outcome.changedCells)} 个单元格`,
      'success',
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog(`执行失败：${message}`, 'error')
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
  renderScope()
  renderCleanItems()
  bindButtons()
  invalidatePreview()
  appendLog('清理页已就绪：勾选清理项后点击「🔍 扫描预览」')
}
