/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

import { registerNotifyApi, registerSyncProgressApi } from '../core/ui-bridge.js'
import type { SyncProgressStats } from '../core/types.js'
import type { SyncProgressHandlers } from '../core/sync-progress-handlers.js'
import type { GithubSyncDetailItem } from '../sync/github-sync-diff.js'
import type { SyncConfigSummary } from '../sync/sync-config-summary.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { createProgress, formatDuration } from './components/progress.js'
import { renderSyncStatsChart } from './sync-stats-chart.js'
import type { ProgressController } from './components/progress.js'

// ========== 类型定义 ==========
export interface DialogOptions {
  title?: string
  message?: string
  prompt?: string
  onOk?: (value?: string) => void
  onCancel?: () => void
  defaultValue?: string
}

export interface DialogButton {
  id: string
  cls: string
  text: string
  event: string
}

export interface DialogConfig {
  id: string
  titleId: string
  msgId: string
  buttons: DialogButton[]
}

export interface DialogCallback {
  onOk?: (value?: string) => void
  onCancel?: () => void
}

// 同步配置摘要是纯数据构造（零 UI 依赖），已下沉到 sync 层，以消除
// `sync/exceltobangumi → ui/dialog` 的反向依赖（见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）。
// 此处 re-export 保持既有调用点（`buildSyncConfig` / `SyncConfigSummary`）不变。
export { buildSyncConfig } from '../sync/sync-config-summary.js'
export type { BuildSyncConfigContext, SyncConfigSummary } from '../sync/sync-config-summary.js'

// ========== 常量与配置 ==========
const DIALOG_TYPES: Record<string, DialogConfig> = {
  alert: {
    id: 'bgmAlertDialog',
    titleId: 'bgmAlertTitle',
    msgId: 'bgmAlertMessage',
    buttons: [{ id: 'bgmAlertOk', cls: 'bgm-dialog-btn-primary', text: '确定', event: 'ok' }],
  },
  confirm: {
    id: 'bgmConfirmDialog',
    titleId: 'bgmConfirmTitle',
    msgId: 'bgmConfirmMessage',
    buttons: [
      { id: 'bgmConfirmOk', cls: 'bgm-dialog-btn-primary', text: '确定', event: 'ok' },
      { id: 'bgmConfirmCancel', cls: 'bgm-dialog-btn-default', text: '取消', event: 'cancel' },
    ],
  },
  error: {
    id: 'bgmErrorDialog',
    titleId: 'bgmErrorTitle',
    msgId: 'bgmErrorMessage',
    buttons: [{ id: 'bgmErrorOk', cls: 'bgm-dialog-btn-danger', text: '确定', event: 'ok' }],
  },
  warning: {
    id: 'bgmWarningDialog',
    titleId: 'bgmWarningTitle',
    msgId: 'bgmWarningMessage',
    buttons: [{ id: 'bgmWarningOk', cls: 'bgm-dialog-btn-warning', text: '确定', event: 'ok' }],
  },
  success: {
    id: 'bgmSuccessDialog',
    titleId: 'bgmSuccessTitle',
    msgId: 'bgmSuccessMessage',
    buttons: [{ id: 'bgmSuccessOk', cls: 'bgm-dialog-btn-success', text: '确定', event: 'ok' }],
  },
  input: {
    id: 'bgmInputDialog',
    titleId: 'bgmInputTitle',
    msgId: 'bgmInputPrompt',
    buttons: [
      { id: 'bgmInputOk', cls: 'bgm-dialog-btn-primary', text: '确定', event: 'ok' },
      { id: 'bgmInputCancel', cls: 'bgm-dialog-btn-default', text: '取消', event: 'cancel' },
    ],
  },
}

// ========== 模块内部状态 ==========
let isDialogInitialized = false
let _dialogCallback: DialogCallback | null = null
let _toastTimer: number | null = null
const dom: Record<string, HTMLElement | null> = {}

// ========== 初始化 ==========
function ensureDialogs(): void {
  if (isDialogInitialized) return
  isDialogInitialized = true
  createDialogs()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureDialogs)
  } else {
    setTimeout(ensureDialogs, 0)
  }
}

function createDialogs(): void {
  if (document.getElementById('bgmDialogContainer')) return

  const container = document.createElement('div')
  container.id = 'bgmDialogContainer'
  document.body.appendChild(container)

  function createDialogElement(
    type: string,
    iconClass: string,
    iconChar: string,
    defaultTitle: string,
  ): HTMLElement {
    const config = DIALOG_TYPES[type]
    if (!config) return document.createElement('div')
    const modal = document.createElement('div')
    modal.id = config.id
    modal.className = 'bgm-modal'
    modal.style.display = 'none'
    // 可访问性：声明对话框角色
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', config.titleId)

    const content = document.createElement('div')
    content.className = `bgm-modal-content ${type}`

    const header = document.createElement('div')
    header.className = 'bgm-dialog-header'
    const icon = document.createElement('span')
    icon.className = `bgm-dialog-icon ${iconClass}`
    icon.innerHTML = sanitizeHtml(iconChar)
    const title = document.createElement('span')
    title.id = config.titleId
    title.className = 'bgm-dialog-title'
    title.textContent = defaultTitle
    header.appendChild(icon)
    header.appendChild(title)
    content.appendChild(header)

    const body = document.createElement('div')
    body.className = 'bgm-dialog-body'
    const message = document.createElement('p')
    message.id = config.msgId
    message.className = 'bgm-dialog-message'
    body.appendChild(message)
    content.appendChild(body)

    const footer = document.createElement('div')
    footer.className = 'bgm-dialog-footer'
    for (const button_ of config.buttons) {
      const button = document.createElement('button')
      button.id = button_.id
      button.className = `bgm-dialog-btn ${button_.cls}`
      button.textContent = button_.text
      button.dataset.event = button_.event
      footer.appendChild(button)
    }
    content.appendChild(footer)
    modal.appendChild(content)
    return modal
  }

  container.appendChild(createDialogElement('alert', 'bgm-icon-info', '&#9432;', '提示'))
  container.appendChild(createDialogElement('confirm', 'bgm-icon-question', '&#63;', '确认'))
  container.appendChild(createDialogElement('error', 'bgm-icon-error', '&#10006;', '错误'))
  container.appendChild(createDialogElement('warning', 'bgm-icon-warning', '&#9888;', '警告'))
  container.appendChild(createDialogElement('success', 'bgm-icon-success', '&#10004;', '成功'))
  container.appendChild(createDialogElement('input', 'bgm-icon-info', '&#9432;', '输入'))

  const inputBody = document.querySelector('#bgmInputDialog .bgm-dialog-body')
  if (inputBody) {
    const inputField = document.createElement('input')
    inputField.type = 'text'
    inputField.id = 'bgmInputField'
    inputField.className = 'bgm-input-field'
    inputBody.appendChild(inputField)
  }

  const toast = document.createElement('div')
  toast.id = 'bgmToast'
  toast.className = 'bgm-toast'
  container.appendChild(toast)

  bindAllEvents()
}

function bindAllEvents(): void {
  for (const config of Object.values(DIALOG_TYPES)) {
    dom[config.id] = document.getElementById(config.id)
    dom[config.titleId] = document.getElementById(config.titleId)
    dom[config.msgId] = document.getElementById(config.msgId)
    for (const button of config.buttons) {
      dom[button.id] = document.getElementById(button.id)
    }
  }
  dom.bgmToast = document.getElementById('bgmToast')
  dom.bgmInputField = document.getElementById('bgmInputField')

  const container = document.getElementById('bgmDialogContainer')
  if (!container) return

  container.addEventListener('click', (event: Event) => {
    const button = (event.target as HTMLElement).closest('button')
    if (!button) return
    const eventType = button.dataset.event
    if (!eventType) return
    const modal = button.closest<HTMLElement>('.bgm-modal')
    if (!modal) return

    modal.style.display = 'none'

    if (_dialogCallback) {
      try {
        if (eventType === 'ok' && _dialogCallback.onOk) {
          if (modal.id === 'bgmInputDialog') {
            const inputValue = dom.bgmInputField
              ? (dom.bgmInputField as HTMLInputElement).value.trim()
              : ''
            _dialogCallback.onOk(inputValue)
          } else {
            _dialogCallback.onOk()
          }
        } else if (eventType === 'cancel' && _dialogCallback.onCancel) {
          _dialogCallback.onCancel()
        }
      } catch (error) {
        // eslint-disable-next-line no-console -- console 是日志后端/启动兜底的唯一输出通道（回调异常兜底日志）
        console.error('[dialog] 回调执行失败:', error)
      }
      _dialogCallback = null
    }
  })

  dom.bgmInputField?.addEventListener('keypress', (event: KeyboardEvent) => {
    if (event.key === 'Enter') dom.bgmInputOk?.click()
  })
}

function _showDialog(type: string, options: DialogOptions = {}): void {
  const config = DIALOG_TYPES[type]
  if (!config) return
  const dialog = dom[config.id]
  if (!dialog) {
    if (type === 'confirm') {
      // eslint-disable-next-line no-alert -- 对话框 DOM 未初始化时的原生 confirm 兜底；改用 BGM.Dialog 会在此无限递归
      if (window.confirm(options.message ?? '')) options.onOk?.()
      else options.onCancel?.()
    } else if (type === 'input') {
      // eslint-disable-next-line no-alert -- 对话框 DOM 未初始化时的原生 prompt 兜底；改用 BGM.Dialog 会在此无限递归
      const result = window.prompt(
        (options.prompt || options.message) ?? '', // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空值须显示占位文案（`??` 会显示空串）
        options.defaultValue ?? '',
      )
      if (result === null) options.onCancel?.()
      else options.onOk?.(result)
    } else {
      // eslint-disable-next-line no-alert -- 对话框 DOM 未初始化时的原生 alert 兜底；改用 BGM.Dialog 会在此无限递归
      window.alert(options.message)
      options.onOk?.()
    }
    return
  }

  const titleElement = dom[config.titleId]
  const messageElement = dom[config.msgId]
  if (titleElement) titleElement.textContent = options.title ?? ''
  if (messageElement) messageElement.textContent = (options.prompt || options.message) ?? '' // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空值须显示占位文案（`??` 会显示空串）

  if (type === 'input' && dom.bgmInputField) {
    ;(dom.bgmInputField as HTMLInputElement).value = options.defaultValue ?? ''
    dom.bgmInputField.focus()
  }

  const callback: DialogCallback = {}
  if (options.onOk) callback.onOk = options.onOk
  if (options.onCancel) callback.onCancel = options.onCancel
  _dialogCallback = callback
  dialog.style.display = 'flex'
}

// ========== 同步结果对话框 ==========
let _syncResultDialog: HTMLElement | null = null

/**
 * 从弹窗根节点查询必需元素（模板保证存在，缺失时快速失败并给出明确错误）
 */
function queryRequiredElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`弹窗缺少必需元素: ${selector}`)
  return element
}

function ensureSyncResultDialog(): HTMLElement {
  if (_syncResultDialog) return _syncResultDialog

  const modal = document.createElement('div')
  modal.id = 'bgmSyncResultDialog'
  modal.className = 'bgm-modal'
  modal.style.display = 'none'
  // 可访问性：声明对话框角色
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'bgmSyncResultTitle')

  modal.innerHTML = sanitizeHtml(`
        <div class="bgm-modal-content success" style="max-width: 520px;">
            <div class="bgm-dialog-header">
                <span class="bgm-dialog-icon bgm-icon-success">&#10004;</span>
                <span class="bgm-dialog-title">同步结果</span>
            </div>
            <div class="bgm-dialog-body">
                <div id="bgmSyncSummary" class="bgm-dialog-message" style="white-space: pre-line;"></div>
                <div id="bgmSyncDetails" style="display:none; margin-top: 8px; max-height: 300px; overflow-y: auto; font-size: 12px; line-height: 1.6; white-space: pre; font-family: monospace;"></div>
            </div>
            <div class="bgm-dialog-footer">
                <button id="bgmSyncToggleDetails" class="bgm-dialog-btn bgm-dialog-btn-default">显示详情</button>
                <button id="bgmSyncResultOk" class="bgm-dialog-btn bgm-dialog-btn-success">确定</button>
            </div>
        </div>
    `)

  document.body.appendChild(modal)

  const detailsElement = queryRequiredElement(modal, '#bgmSyncDetails')
  const toggleButton = queryRequiredElement(modal, '#bgmSyncToggleDetails')

  toggleButton.addEventListener('click', () => {
    const isExpanded = detailsElement.style.display !== 'none'
    detailsElement.style.display = isExpanded ? 'none' : 'block'
    toggleButton.textContent = isExpanded ? '显示详情' : '收起详情'
  })

  modal.querySelector<HTMLElement>('#bgmSyncResultOk')?.addEventListener('click', () => {
    modal.style.display = 'none'
  })

  _syncResultDialog = modal
  return modal
}

export function showSyncResult(summary: string, details: string[]): void {
  const modal = ensureSyncResultDialog()
  const summaryElement = queryRequiredElement(modal, '#bgmSyncSummary')
  const detailsElement = queryRequiredElement(modal, '#bgmSyncDetails')
  const toggleButton = queryRequiredElement(modal, '#bgmSyncToggleDetails')

  summaryElement.textContent = summary
  detailsElement.textContent = details.length > 0 ? details.join('\n') : '无详情'

  // 重置为收起状态
  detailsElement.style.display = 'none'
  toggleButton.textContent = '显示详情'
  toggleButton.style.display = details.length > 0 ? '' : 'none'

  modal.style.display = 'flex'
}

// ========== 同步进度弹窗 ==========
/**
 * 实现已收敛到通用进度组件（ui/components/progress.ts）的 modal 模式；
 * 本模块只保留同步专有的配置摘要、统计图表与对外 API 兼容层。
 */

/** 当前同步进度组件实例（modal 模式） */
let _syncProgress: ProgressController | null = null

/** 全局同步开始时间戳（ms），0 表示未计时 */
let _syncGlobalStart = 0
/** 全局累计暂停时长（ms），计算耗时时扣除 */
let _syncPausedDuration = 0
/** 暂停开始时间戳（ms），0 表示未处于暂停 */
let _syncPauseStart = 0

/** 重置全局计时（每次开始同步时调用） */
function _resetSyncTimer(): void {
  _syncGlobalStart = Date.now()
  _syncPausedDuration = 0
  _syncPauseStart = 0
}

/** 取扣除暂停时长后的净耗时（ms）；未开始计时返回 0 */
function _syncElapsed(): number {
  if (_syncGlobalStart === 0) return 0
  const pausedNow = _syncPauseStart > 0 ? Date.now() - _syncPauseStart : 0
  return Date.now() - _syncGlobalStart - _syncPausedDuration - pausedNow
}

/**
 * 渲染配置摘要为 HTML 字符串
 */
export function renderConfigSummary(config: SyncConfigSummary): string {
  const items: string[] = []
  if (config.sourceLabel) items.push(`<span class="cfg-item">📁 ${config.sourceLabel}</span>`)
  if (config.strategyLabel) items.push(`<span class="cfg-item">🔧 ${config.strategyLabel}</span>`)
  if (config.directionLabel) items.push(`<span class="cfg-item">📡 ${config.directionLabel}</span>`)
  if (config.timeFilterLabel)
    items.push(`<span class="cfg-item">📅 ${config.timeFilterLabel}</span>`)
  if (config.selectedRowsOnly) items.push(`<span class="cfg-item warn">⚠️ 仅选中行</span>`)
  if (config.extra) {
    for (const ex of config.extra) {
      items.push(`<span class="cfg-item">${ex.label}: ${ex.value}</span>`)
    }
  }
  return items.length > 0 ? `<div class="cfg-summary">${items.join('')}</div>` : ''
}

/**
 * 显示同步进度弹窗（运行中状态）
 * @param title 弹窗标题（如"正在同步 - 选中行同步"）
 * @param handlers 暂停/恢复/停止回调集合
 * @param config 可选的同步配置摘要，显示在进度区上方
 */
export function showSyncProgressDialog(
  title: string,
  handlers: SyncProgressHandlers,
  config?: SyncConfigSummary,
  phaseNames?: readonly string[],
): void {
  _syncProgress?.hide()
  _resetSyncTimer()
  _syncProgress = createProgress({
    mode: 'modal',
    title,
    icon: '🔄',
    showHeader: true,
    enableLogs: true,
    enablePause: true,
    enableStop: true,
    ...(config && { configHtml: renderConfigSummary(config) }),
    ...(phaseNames && phaseNames.length > 0 && { phases: phaseNames }),
    onPause: (): void => {
      _syncPauseStart = Date.now()
      handlers.onPause()
    },
    onResume: (): void => {
      _syncPausedDuration += _syncPauseStart > 0 ? Date.now() - _syncPauseStart : 0
      _syncPauseStart = 0
      handlers.onResume()
    },
    onStop: (): void => {
      handlers.onStop()
    },
  })
}

/**
 * 更新进度条
 * @param current 当前完成数
 * @param total 总数
 * @param message 当前任务描述（显示在进度条下方）
 * @param logLine 可选的实时日志行（追加到日志区）
 * @param eta 可选的 ETA 字符串（显示在 ETA 区域，独立于 logLine）
 */
export function updateSyncProgressDialog(
  current: number,
  total: number,
  message?: string,
  logLine?: string,
  eta?: string,
): void {
  if (_syncProgress === null) return
  // 兼容旧调用：logLine 以「预计剩余」/「剩余:」开头时视为 ETA 文本
  const isEtaLine =
    logLine !== undefined && (logLine.startsWith('预计剩余') || logLine.startsWith('剩余:'))
  const etaText = eta ?? (isEtaLine ? logLine : undefined)
  _syncProgress.update(current, total, message, etaText)
  if (logLine !== undefined && logLine !== etaText) _syncProgress.log(logLine)
}

/**
 * 同步统计数据接口（增强版，支持完整仪表盘渲染）。
 *
 * 形状本身与 UI 无关，已下沉到 `core/types.ts`，供 `sync/`、`ui/handlers/` 与
 * 进度桥（`core/ui-bridge.ts`）共同引用，避免下层为了拿一个数据形状而反向依赖 UI。
 */
export type { SyncProgressStats } from '../core/types.js'

/**
 * 将同步明细数据渲染为可折叠的 HTML 表格
 * @param items 同步明细条目数组
 * @returns 已做 HTML 转义的表格 HTML 字符串
 */
export function renderSyncDetailTable(items: GithubSyncDetailItem[]): string {
  if (items.length === 0) return '<p>无明细数据</p>'

  const kindLabels: Record<GithubSyncDetailItem['kind'], string> = {
    add: '➕ 新增',
    update: '🔄 更新',
    delete: '🗑️ 删除',
    fail: '❌ 失败',
  }
  const kindClasses: Record<GithubSyncDetailItem['kind'], string> = {
    add: 'bgm-detail-kind--add',
    update: 'bgm-detail-kind--update',
    delete: 'bgm-detail-kind--delete',
    fail: 'bgm-detail-kind--fail',
  }

  const rows = items
    .map((item) => {
      const { kind } = item
      const name = item.name ?? '--'
      const { sid } = item
      const row = item.row === undefined ? '--' : String(item.row)
      const fields = item.fields && item.fields.length > 0 ? item.fields.join(', ') : '--'
      const message = item.message ?? ''
      return `
        <tr>
          <td><span class="bgm-detail-kind ${kindClasses[kind]}">${sanitizeHtml(kindLabels[kind])}</span></td>
          <td>${sanitizeHtml(sid)}</td>
          <td>${sanitizeHtml(name)}</td>
          <td>${sanitizeHtml(row)}</td>
          <td>${sanitizeHtml(fields)}</td>
          <td>${sanitizeHtml(message)}</td>
        </tr>
      `
    })
    .join('')

  return `
    <div class="bgm-detail-table-wrap">
      <table class="bgm-detail-table">
        <thead>
          <tr>
            <th>操作</th>
            <th>SID</th>
            <th>名称</th>
            <th>行号</th>
            <th>变更字段</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <div class="bgm-detail-table-footer">共 ${String(items.length)} 条明细</div>
  `
}

/**
 * 切换弹窗为完成状态，显示统计结果
 * @param summary 统计摘要文本
 * @param details 详情文本数组（无明细对象时的兼容显示）
 * @param isStopped 是否被用户停止
 * @param onNext 点击"下一步"时的回调（用于打开同步完成详情弹窗）
 * @param stats 同步统计数据（用于渲染图表）
 * @param detailItems 同步明细数据（用于渲染详情表格）
 */
export function completeSyncProgressDialog(
  summary: string,
  details: string[],
  isStopped = false,
  onNext?: () => void,
  stats?: SyncProgressStats,
  detailItems?: GithubSyncDetailItem[],
): void {
  const tableItems = detailItems ?? []
  const hasTable = tableItems.length > 0
  const elapsed = _syncElapsed()
  const finalSummary = elapsed > 0 ? `${summary} 用时 ${formatDuration(elapsed)}` : summary
  _syncProgress?.complete({
    summary: finalSummary,
    ok: !isStopped,
    ...(stats !== undefined && { resultHtml: renderSyncStatsChart(stats) }),
    ...(hasTable ? { detailsHtml: renderSyncDetailTable(tableItems) } : { details }),
    ...(onNext && { onNext }),
  })
  _syncGlobalStart = 0
  _syncPausedDuration = 0
  _syncPauseStart = 0
}

/** 隐藏同步进度弹窗 */
export function hideSyncProgressDialog(): void {
  _syncProgress?.hide()
  _syncProgress = null
  _syncGlobalStart = 0
  _syncPausedDuration = 0
  _syncPauseStart = 0
}

// ========== 公共 API ==========
export function showAlert(message: string, title?: string, onOk?: () => void): void {
  _showDialog('alert', { message, title: title ?? '提示', ...(onOk && { onOk }) })
}

/*
 * 显示确认对话框（新签名）
 * @param message  提示内容
 * @param callback 回调函数，参数 isConfirmed 为 true 表示用户点击了确定
 * @param title    可选标题
 */
export function showConfirm(
  message: string,
  // 允许 async 回调：返回的 Promise 由调用方消费（通常忽略），
  // onOk/onCancel 只触发不等待，语义与同步回调一致
  callback: (isConfirmed: boolean) => void | Promise<void>,
  title?: string,
): void {
  _showDialog('confirm', {
    message,
    title: title ?? '确认',
    onOk: () => {
      void callback(true)
    },
    onCancel: () => {
      void callback(false)
    },
  })
}

/**
 * 确认对话框的 Promise 版（异步流程里需要 `await` 用户决策时用）
 *
 * 同步流程用 {@link showConfirm} 的回调式即可；但 `syncFromPanel` / `_doAPISync`
 * 这类本身就是 `async` 的链路，用回调式要把后续逻辑整段塞进回调里（或手写
 * `new Promise` 包装）。此前两处**逐字重复**了同一段 `new Promise` 样板，
 * 收敛到这里。
 *
 * @param message 提示内容
 * @param title   可选标题
 * @returns 用户点了「确定」为 true，取消为 false
 */
export function confirmAsync(message: string, title?: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    showConfirm(
      message,
      (isConfirmed) => {
        resolve(isConfirmed)
      },
      title,
    )
  })
}

export function showError(message: string, title?: string, onOk?: () => void): void {
  _showDialog('error', { message, title: title ?? '错误', ...(onOk && { onOk }) })
}

export function showWarning(message: string, title?: string, onOk?: () => void): void {
  _showDialog('warning', { message, title: title ?? '警告', ...(onOk && { onOk }) })
}

export function showSuccess(message: string, title?: string, onOk?: () => void): void {
  _showDialog('success', { message, title: title ?? '成功', ...(onOk && { onOk }) })
}

export function showInput(
  title: string,
  prompt: string,
  defaultValue?: string,
  onOk?: (value?: string) => void,
  onCancel?: () => void,
): void {
  _showDialog('input', {
    title,
    message: prompt,
    ...(onOk && { onOk }),
    ...(onCancel && { onCancel }),
    ...(defaultValue !== undefined && { defaultValue }),
  })
}

// ========== Toast 通知 ==========
export function showToast(message: string, type?: string): void {
  const toast = dom.bgmToast
  if (!toast) return

  if (_toastTimer !== null) {
    clearTimeout(_toastTimer)
    _toastTimer = null
  }

  toast.textContent = message
  toast.className = 'bgm-toast bgm-toast-show'
  if (type) toast.classList.add(`bgm-toast-${type}`)

  _toastTimer = window.setTimeout(() => {
    toast.className = 'bgm-toast'
    _toastTimer = null
  }, 3000)
}

// ========== 注册 UI 实现到桥（依赖反转的收口点） ==========
// 底层（tools/ sync/）不再 import 本模块，而是调用 core/ui-bridge 的 getNotifyApi() /
// getSyncProgressApi()。本模块作为实现方，在模块求值时把函数注册进去。
// 加载时机：`ts/index.ts`（barrel）re-export 本模块，三个 entry 都经由它间接引入，
// 因此任何业务代码执行前注册都已完成；单测若不 import 本模块，桥会走降级实现（记日志 + 忽略）。
registerNotifyApi({
  alert: showAlert,
  confirm: showConfirm,
  error: showError,
  success: showSuccess,
  toast: showToast,
  input: showInput,
})

registerSyncProgressApi({
  show: showSyncProgressDialog,
  update: updateSyncProgressDialog,
  setPhase: (index: number): void => {
    _syncProgress?.setPhase(index)
  },
  complete: completeSyncProgressDialog,
  hide: hideSyncProgressDialog,
})
