/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

import type { GithubSyncDetailItem } from '../sync/githubSyncDiff.js'
import { sanitizeHtml } from '../tools/sanitize.js'

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

/** 同步配置摘要，显示在进度弹窗顶部 */
export interface SyncConfigSummary {
  /** 同步源标签（如 "远程仓库" / "本地文件"） */
  sourceLabel?: string
  /** 同步策略标签 */
  strategyLabel?: string
  /** 时间筛选描述 */
  timeFilterLabel?: string
  /** 是否仅同步选中行 */
  selectedRowsOnly?: boolean
  /** 同步方向描述（如 "远程仓库 → Excel"） */
  directionLabel?: string
  /** 额外的自定义配置行（key-value） */
  extra?: { label: string; value: string }[]
}

/** 构建同步配置摘要的上下文 */
export interface BuildSyncConfigContext {
  /** 数据源标签 */
  source?: string
  /** 策略标签 */
  strategy?: string
  /** 方向标签 */
  direction?: string
  /** 是否选中行 */
  selectedRowsOnly?: boolean
  /** 时间筛选 */
  timeFilter?: {
    range: 'year' | 'quarter' | 'month' | 'future'
    year: number
    quarter?: number
    month?: number
  }
  /** 额外的 key-value 对 */
  extra?: { label: string; value: string }[]
}

/**
 * 构造同步配置摘要的工厂函数，统一各入口的配置构造逻辑。
 * @param ctx 配置上下文
 * @returns SyncConfigSummary 对象
 */
export function buildSyncConfig(ctx: BuildSyncConfigContext): SyncConfigSummary {
  const config: SyncConfigSummary = {}
  if (ctx.source) config.sourceLabel = ctx.source
  if (ctx.strategy) config.strategyLabel = ctx.strategy
  if (ctx.direction) config.directionLabel = ctx.direction
  if (ctx.selectedRowsOnly) config.selectedRowsOnly = true
  if (ctx.timeFilter) {
    const tf = ctx.timeFilter
    config.timeFilterLabel =
      tf.range === 'future'
        ? '预告/未来动漫'
        : tf.range === 'year'
          ? `${String(tf.year)}年全年`
          : tf.range === 'quarter'
            ? `${String(tf.year)}年${String(tf.quarter)}月新番`
            : `${String(tf.year)}年${String(tf.month)}月`
  }
  if (ctx.extra && ctx.extra.length > 0) config.extra = ctx.extra
  return config
}

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
    config.buttons.forEach((button_: DialogButton) => {
      const button = document.createElement('button')
      button.id = button_.id
      button.className = `bgm-dialog-btn ${button_.cls}`
      button.textContent = button_.text
      button.dataset.event = button_.event
      footer.appendChild(button)
    })
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
  for (const type in DIALOG_TYPES) {
    const config = DIALOG_TYPES[type]
    if (config) {
      dom[config.id] = document.getElementById(config.id)
      dom[config.titleId] = document.getElementById(config.titleId)
      dom[config.msgId] = document.getElementById(config.msgId)
      config.buttons.forEach((button) => {
        dom[button.id] = document.getElementById(button.id)
      })
    }
  }
  dom.bgmToast = document.getElementById('bgmToast')
  dom.bgmInputField = document.getElementById('bgmInputField')

  const container = document.getElementById('bgmDialogContainer')
  if (!container) return

  container.addEventListener('click', (e: Event) => {
    const button = (e.target as HTMLElement).closest('button')
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
        console.error('[dialog] 回调执行失败:', error)
      }
      _dialogCallback = null
    }
  })

  dom.bgmInputField?.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') dom.bgmInputOk?.click()
  })
}

function _showDialog(type: string, options: DialogOptions = {}): void {
  const config = DIALOG_TYPES[type]
  if (!config) return
  const dialog = dom[config.id]
  if (!dialog) {
    if (type === 'confirm') {
      if (window.confirm(options.message ?? '')) options.onOk?.()
      else options.onCancel?.()
    } else if (type === 'input') {
      const result = window.prompt(
        (options.prompt || options.message) ?? '',
        options.defaultValue ?? '',
      )
      if (result !== null) options.onOk?.(result)
      else options.onCancel?.()
    } else {
      window.alert(options.message)
      options.onOk?.()
    }
    return
  }

  const titleElement = dom[config.titleId]
  const messageElement = dom[config.msgId]
  if (titleElement) titleElement.textContent = options.title ?? ''
  if (messageElement) messageElement.textContent = (options.prompt || options.message) ?? ''

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

  const detailsElement = modal.querySelector<HTMLElement>('#bgmSyncDetails')!
  const toggleButton = modal.querySelector<HTMLElement>('#bgmSyncToggleDetails')!

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
  const summaryElement = modal.querySelector<HTMLElement>('#bgmSyncSummary')!
  const detailsElement = modal.querySelector<HTMLElement>('#bgmSyncDetails')!
  const toggleButton = modal.querySelector<HTMLElement>('#bgmSyncToggleDetails')!

  summaryElement.textContent = summary
  detailsElement.textContent = details.length > 0 ? details.join('\n') : '无详情'

  // 重置为收起状态
  detailsElement.style.display = 'none'
  toggleButton.textContent = '显示详情'
  toggleButton.style.display = details.length > 0 ? '' : 'none'

  modal.style.display = 'flex'
}

// ========== 同步进度弹窗 ==========
let _syncProgressDialog: HTMLElement | null = null
let _syncProgressLogCount = 0
const _SYNC_PROGRESS_LOG_MAX = 500

/** 全局同步开始时间戳（ms），用于计算整体 ETA */
let _syncGlobalStart = 0
/** 全局累计暂停时长（ms），用于在暂停时扣除时间 */
let _syncPausedDuration = 0
/** 暂停开始时间戳（ms） */
let _syncPauseStart = 0

/** 暂停/恢复/停止按钮回调 */
let _syncPauseHandler: (() => void) | null = null
let _syncResumeHandler: (() => void) | null = null
let _syncStopHandler: (() => void) | null = null
/** 下一步按钮回调（点击后打开同步完成详情弹窗） */
let _syncNextHandler: (() => void) | null = null

/** 当前是否处于暂停状态（统一监听器据此决定调用 pause 还是 resume） */
let _isSyncPaused = false

/** 触发同步弹窗的元素（关闭后恢复焦点） */
let _syncProgressTrigger: HTMLElement | null = null

/** ESC 键监听器引用（仅在完成状态下注册） */
let _syncProgressEscHandler: ((e: KeyboardEvent) => void) | null = null

/** 内部：根据暂停状态更新按钮文本/样式/aria-label，并追踪暂停时间用于全局 ETA */
function _setSyncPausedState(paused: boolean): void {
  // 追踪暂停时间，用于全局 ETA 扣除
  if (paused) {
    _syncPauseStart = Date.now()
  } else if (_syncPauseStart > 0) {
    _syncPausedDuration += Date.now() - _syncPauseStart
    _syncPauseStart = 0
  }
  _isSyncPaused = paused
  const pauseButton = _syncProgressDialog?.querySelector(
    '#bgmSyncProgressPauseBtn',
  ) as HTMLButtonElement | null
  if (!pauseButton) return
  pauseButton.textContent = paused ? '▶️ 继续' : '⏸️ 暂停'
  pauseButton.setAttribute('aria-label', paused ? '继续同步' : '暂停同步')
  if (paused) {
    pauseButton.classList.remove('bgm-dialog-btn-default')
    pauseButton.classList.add('bgm-dialog-btn-success')
  } else {
    pauseButton.classList.add('bgm-dialog-btn-default')
    pauseButton.classList.remove('bgm-dialog-btn-success')
  }
}

/** 内部：清理所有回调与状态（complete/hide 时调用） */
function _clearSyncProgressHandlers(): void {
  _syncPauseHandler = null
  _syncResumeHandler = null
  _syncStopHandler = null
  _syncNextHandler = null
  _isSyncPaused = false
  // 移除 ESC 监听器，避免泄漏
  if (_syncProgressEscHandler) {
    document.removeEventListener('keydown', _syncProgressEscHandler)
    _syncProgressEscHandler = null
  }
}

function ensureSyncProgressDialog(): HTMLElement {
  if (_syncProgressDialog) return _syncProgressDialog

  const modal = document.createElement('div')
  modal.id = 'bgmSyncProgressDialog'
  modal.className = 'bgm-modal'
  modal.style.display = 'none'
  // 可访问性：声明对话框角色
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'bgmSyncProgressTitle')
  modal.setAttribute('aria-hidden', 'true')

  modal.innerHTML = sanitizeHtml(`
        <div class="bgm-modal-content bgm-sync-progress__content">
            <div class="bgm-dialog-header bgm-sync-progress__header" id="bgmSyncProgressHeader">
                <div class="bgm-dialog-header-left">
                    <span class="bgm-dialog-icon" id="bgmSyncProgressIcon">🔄</span>
                    <span class="bgm-dialog-title" id="bgmSyncProgressTitle">正在同步...</span>
                </div>
                <button id="bgmSyncProgressCloseTop" type="button" class="bgm-dialog-close-btn" aria-label="关闭弹窗" title="关闭">✕</button>
            </div>
            <div class="bgm-dialog-body bgm-sync-progress__body">
                <!-- 配置摘要区（默认隐藏，由 showSyncProgressDialog 填充） -->
                <div id="bgmSyncProgressConfig" class="bgm-sync-progress__config" style="display:none;"></div>
                <!-- 进度区 -->
                <div id="bgmSyncProgressSection">
                    <div class="bgm-sync-progress__meta" aria-live="polite" aria-atomic="true">
                        <span id="bgmSyncProgressLabel">进度: 0/0</span>
                        <span id="bgmSyncProgressPercent">0%</span>
                        <span id="bgmSyncProgressEta" class="bgm-sync-progress__eta" style="display:none;"></span>
                        <span id="bgmSyncProgressGlobalEta" class="bgm-sync-progress__global-eta" style="display:none;"></span>
                    </div>
                    <div class="bgm-sync-progress__track">
                        <div id="bgmSyncProgressBar" class="bgm-sync-progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
                    </div>
                    <div id="bgmSyncProgressCurrent" class="bgm-sync-progress__current"></div>
                    <div class="bgm-sync-progress__log-wrap">
                        <div class="bgm-sync-progress__log-label">实时日志:</div>
                        <div id="bgmSyncProgressLog" class="bgm-sync-progress__log" role="log" aria-live="polite"></div>
                    </div>
                </div>
                <!-- 完成结果区（默认隐藏） -->
                <div id="bgmSyncProgressResult" style="display: none;">
                    <div id="bgmSyncProgressSummary" class="bgm-dialog-message bgm-sync-progress__result-summary"></div>
                    <div id="bgmSyncProgressChart" class="bgm-sync-progress__chart"></div>
                    <div id="bgmSyncProgressDetails" class="bgm-sync-progress__result-details"></div>
                </div>
            </div>
            <div class="bgm-dialog-footer" id="bgmSyncProgressFooter">
                <!-- 运行中按钮 -->
                <div id="bgmSyncProgressRunningBtns" class="bgm-sync-progress__running-btns">
                    <button id="bgmSyncProgressPauseBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-default" aria-label="暂停同步">⏸️ 暂停</button>
                    <button id="bgmSyncProgressStop" type="button" class="bgm-dialog-btn bgm-dialog-btn-danger" aria-label="停止同步">⏹️ 停止</button>
                </div>
                <!-- 完成按钮（默认隐藏） -->
                <div id="bgmSyncProgressDoneBtns" class="bgm-sync-progress__done-btns" style="display: none;">
                    <button id="bgmSyncProgressToggleDetails" type="button" class="bgm-dialog-btn bgm-dialog-btn-default" aria-label="显示详情">显示详情</button>
                    <button id="bgmSyncProgressClose" type="button" class="bgm-dialog-btn bgm-dialog-btn-default" aria-label="关闭弹窗">关闭</button>
                    <button id="bgmSyncProgressNext" type="button" class="bgm-dialog-btn bgm-dialog-btn-primary" aria-label="下一步">下一步 →</button>
                </div>
            </div>
        </div>
    `)

  document.body.appendChild(modal)

  // 绑定按钮事件：统一使用 addEventListener，禁止 onclick 重绑定
  const pauseButton = modal.querySelector<HTMLElement>('#bgmSyncProgressPauseBtn')
  const stopButton = modal.querySelector<HTMLElement>('#bgmSyncProgressStop')
  const closeButton = modal.querySelector<HTMLElement>('#bgmSyncProgressClose')
  const closeTopButton = modal.querySelector<HTMLElement>('#bgmSyncProgressCloseTop')
  const nextButton = modal.querySelector<HTMLElement>('#bgmSyncProgressNext')
  const toggleDetailsButton = modal.querySelector<HTMLElement>('#bgmSyncProgressToggleDetails')

  // 暂停/继续按钮：根据 _syncPaused 标志自行决定调用哪个处理器，并自行更新按钮文本
  if (pauseButton) {
    pauseButton.addEventListener('click', (): void => {
      if (!_syncProgressDialog || _syncProgressDialog.style.display === 'none') return
      if (_isSyncPaused) {
        _syncResumeHandler?.()
        _setSyncPausedState(false)
      } else {
        _syncPauseHandler?.()
        _setSyncPausedState(true)
      }
    })
  }
  // 停止按钮
  if (stopButton) {
    stopButton.addEventListener('click', (): void => {
      if (!_syncProgressDialog || _syncProgressDialog.style.display === 'none') return
      _syncStopHandler?.()
    })
  }
  // 关闭按钮
  if (closeButton) {
    closeButton.addEventListener('click', (): void => {
      hideSyncProgressDialog()
    })
  }
  // 右上角关闭按钮（始终可见）
  if (closeTopButton) {
    closeTopButton.addEventListener('click', (): void => {
      hideSyncProgressDialog()
    })
  }
  // 下一步按钮
  if (nextButton) {
    nextButton.addEventListener('click', (): void => {
      const handler = _syncNextHandler
      hideSyncProgressDialog()
      handler?.()
    })
  }
  // 详情切换按钮
  if (toggleDetailsButton) {
    toggleDetailsButton.addEventListener('click', (): void => {
      const detailsElement = modal.querySelector<HTMLElement>('#bgmSyncProgressDetails')
      if (!detailsElement) return
      const isExpanded = detailsElement.style.display !== 'none'
      detailsElement.style.display = isExpanded ? 'none' : 'block'
      toggleDetailsButton.textContent = isExpanded ? '显示详情' : '收起详情'
      toggleDetailsButton.setAttribute('aria-label', isExpanded ? '显示详情' : '收起详情')
    })
  }

  _syncProgressDialog = modal
  return modal
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
  handlers: { onPause: () => void; onResume: () => void; onStop: () => void },
  config?: SyncConfigSummary,
): void {
  const modal = ensureSyncProgressDialog()

  // 保存触发元素，用于关闭后恢复焦点
  _syncProgressTrigger = document.activeElement as HTMLElement | null

  // 重置回调与状态（必须在重置 UI 前完成，避免上次同步残留）
  _clearSyncProgressHandlers()
  _syncPauseHandler = handlers.onPause
  _syncResumeHandler = handlers.onResume
  _syncStopHandler = handlers.onStop
  _isSyncPaused = false
  _syncProgressLogCount = 0

  // 初始化全局 ETA 追踪
  _syncGlobalStart = Date.now()
  _syncPausedDuration = 0
  _syncPauseStart = 0

  // 重置为运行中状态
  const titleElement = modal.querySelector<HTMLElement>('#bgmSyncProgressTitle')
  const iconElement = modal.querySelector<HTMLElement>('#bgmSyncProgressIcon')
  const progressSection = modal.querySelector<HTMLElement>('#bgmSyncProgressSection')
  const resultSection = modal.querySelector<HTMLElement>('#bgmSyncProgressResult')
  const runningBtns = modal.querySelector<HTMLElement>('#bgmSyncProgressRunningBtns')
  const doneBtns = modal.querySelector<HTMLElement>('#bgmSyncProgressDoneBtns')
  const pauseButton = modal.querySelector<HTMLElement>('#bgmSyncProgressPauseBtn')

  if (titleElement) titleElement.textContent = title
  if (iconElement) iconElement.textContent = '🔄'
  if (progressSection) progressSection.style.display = ''
  if (resultSection) resultSection.style.display = 'none'
  if (runningBtns) runningBtns.style.display = 'flex'
  if (doneBtns) doneBtns.style.display = 'none'
  // 重置暂停按钮（文本/样式/aria-label），避免上次同步残留的 resume 状态
  if (pauseButton) {
    pauseButton.textContent = '⏸️ 暂停'
    pauseButton.setAttribute('aria-label', '暂停同步')
    pauseButton.classList.remove('bgm-dialog-btn-success')
    pauseButton.classList.add('bgm-dialog-btn-default')
  }

  // 渲染配置摘要
  const configElement = modal.querySelector<HTMLElement>('#bgmSyncProgressConfig')
  if (configElement) {
    if (config) {
      configElement.innerHTML = renderConfigSummary(config)
      configElement.style.display = ''
    } else {
      configElement.replaceChildren()
      configElement.style.display = 'none'
    }
  }

  // 重置进度
  const bar = modal.querySelector<HTMLElement>('#bgmSyncProgressBar')
  const label = modal.querySelector<HTMLElement>('#bgmSyncProgressLabel')
  const percent = modal.querySelector<HTMLElement>('#bgmSyncProgressPercent')
  const current = modal.querySelector<HTMLElement>('#bgmSyncProgressCurrent')
  const log = modal.querySelector<HTMLElement>('#bgmSyncProgressLog')
  const etaElement = modal.querySelector<HTMLElement>('#bgmSyncProgressEta')
  const globalEtaElement = modal.querySelector<HTMLElement>('#bgmSyncProgressGlobalEta')
  if (bar) {
    bar.style.width = '0%'
    bar.textContent = ''
    bar.setAttribute('aria-valuenow', '0')
  }
  if (label) label.textContent = '进度: 准备中...'
  if (percent) percent.textContent = '--%'
  if (current) current.textContent = ''
  if (log) log.textContent = ''
  if (etaElement) {
    etaElement.textContent = ''
    etaElement.style.display = 'none'
  }
  if (globalEtaElement) {
    globalEtaElement.textContent = ''
    globalEtaElement.style.display = 'none'
  }

  modal.style.display = 'flex'
  modal.setAttribute('aria-hidden', 'false')

  // 焦点管理：将焦点移至暂停按钮，便于键盘操作
  pauseButton?.focus()
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
  const modal = _syncProgressDialog
  // 弹窗未显示时快速返回，避免无效 DOM 写入
  if (!modal || modal.style.display === 'none') return

  const bar = modal.querySelector<HTMLElement>('#bgmSyncProgressBar')
  const label = modal.querySelector<HTMLElement>('#bgmSyncProgressLabel')
  const percent = modal.querySelector<HTMLElement>('#bgmSyncProgressPercent')
  const currentElement = modal.querySelector<HTMLElement>('#bgmSyncProgressCurrent')
  const log = modal.querySelector<HTMLElement>('#bgmSyncProgressLog')
  const etaElement = modal.querySelector<HTMLElement>('#bgmSyncProgressEta')
  const globalEtaElement = modal.querySelector<HTMLElement>('#bgmSyncProgressGlobalEta')

  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  if (bar) {
    bar.style.width = `${String(pct)}%`
    bar.textContent = `${String(pct)}%`
    bar.setAttribute('aria-valuenow', String(pct))
  }
  if (label) label.textContent = `进度: ${String(current)}/${String(total)}`
  if (percent) percent.textContent = `${String(pct)}%`
  if (currentElement && message) currentElement.textContent = message

  // 显示阶段 ETA：优先使用独立的 eta 参数，兼容旧版 logLine 以"预计剩余"/"剩余:"开头的情况
  const etaText =
    eta ??
    (logLine &&
      (logLine.startsWith('预计剩余') || logLine.startsWith('剩余:') ? logLine : undefined))
  if (etaElement && etaText) {
    etaElement.textContent = etaText
    etaElement.style.display = ''
  } else if (etaElement) {
    etaElement.style.display = 'none'
  }

  // 计算全局 ETA（基于整体进度和已用时间）
  if (globalEtaElement && _syncGlobalStart > 0 && total > 0) {
    const now = Date.now()
    // 扣除暂停时间
    const effectiveElapsed = now - _syncGlobalStart - _syncPausedDuration
    if (effectiveElapsed > 0 && current > 0) {
      // 处理的项数 / 有效耗时 = 速率
      const rate = current / effectiveElapsed
      // 剩余项数 / 速率 = 剩余时间
      const remaining = total - current
      const remainingMs = remaining / rate
      const elapsedString = formatDuration(effectiveElapsed)
      const remainingString = formatDuration(remainingMs)
      const totalString = formatDuration(effectiveElapsed + remainingMs)
      globalEtaElement.textContent = `⏱ 已用${elapsedString} · 预计剩余${remainingString} · 总计${totalString}`
      globalEtaElement.style.display = ''
    } else if (current === 0) {
      // 尚未开始，只显示已用时间
      const elapsedString = formatDuration(now - _syncGlobalStart)
      globalEtaElement.textContent = `⏱ 已用${elapsedString} · 计算中...`
      globalEtaElement.style.display = ''
    } else {
      globalEtaElement.style.display = 'none'
    }
  }

  // 将日志行追加到日志区（ETA 类型的 logLine 已在上方处理，不再重复追加）
  if (logLine && log && logLine !== etaText) {
    const isNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30
    log.appendChild(document.createTextNode(`${logLine}\n`))
    _syncProgressLogCount += 1
    while (_syncProgressLogCount > _SYNC_PROGRESS_LOG_MAX) {
      if (log.firstChild) {
        log.removeChild(log.firstChild)
        _syncProgressLogCount -= 1
      } else {
        break
      }
    }
    if (isNearBottom) {
      log.scrollTop = log.scrollHeight
    }
  }
}

/**
 * 同步统计数据接口（增强版，支持完整仪表盘渲染）
 */
export interface SyncProgressStats {
  added: number
  updated: number
  deleted: number
  unchanged: number
  failed: number
  skipped: number
  remoteTotal: number
  elapsedMs: number
  avgSpeed: number
  strategyLabel: string
}

/**
 * 格式化耗时为可读字符串
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    const seconds = Math.max(0, ms / 1000)
    return `${seconds.toFixed(2)}秒`
  }
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${String(seconds)}秒`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0
    ? `${String(minutes)}分${secs.toString().padStart(2, '0')}秒`
    : `${String(minutes)}分`
}

/**
 * 渲染同步统计图表（完整仪表盘布局，与 syncResultDialog 风格一致）
 *
 * 布局：
 * ┌─ 概览条（进度环 + 关键指标） ──────────────────────────┐
 * │  总条目  │  完成进度环  │  处理效率  │  耗时  │  速度   │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 图表区 ──────────────────────────────────────────────┐
 * │  ┌─ 环形分布图 ─┐  ┌─ 水平柱状图 ──────────────┐      │
 * │  │   🍩 SVG     │  │  ✅ 新增 ████████         │      │
 * │  │   图例       │  │  🔄 更新 ████            │      │
 * │  └──────────────┘  │  ❌ 删除 ██             │      │
 * │                    │  ⏭️ 无变更 ██████████     │      │
 * │                    │  ⚠️ 失败  █              │      │
 * │                    │  🔍 跳过  ███            │      │
 * │                    └──────────────────────────┘      │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 性能仪表盘 ────────────────────────────────────────┐
 * │  ⏱ 1分30秒  │  ⚡ 15/s  │  📈 44%  │  🔮 预计剩余  │
 * └──────────────────────────────────────────────────────┘
 * ┌─ 元信息栏 ──────────────────────────────────────────┐
 * │  🎯 策略  📥 远程  ✅ 完成  🔍 跳过  ⚠️ 失败        │
 * └──────────────────────────────────────────────────────┘
 */
function renderSyncStatsChart(container: HTMLElement, stats: SyncProgressStats): void {
  const totalProcessed = stats.added + stats.updated + stats.deleted
  const totalActive = totalProcessed + stats.unchanged + stats.failed
  const totalAll = totalActive + stats.skipped

  // 各部分占比（基于 totalAll，包含 skipped）
  const pctOf = (v: number): number => (totalAll > 0 ? (v / totalAll) * 100 : 0)
  const addedPct = pctOf(stats.added)
  const updatedPct = pctOf(stats.updated)
  const deletedPct = pctOf(stats.deleted)
  const unchangedPct = pctOf(stats.unchanged)
  const failedPct = pctOf(stats.failed)
  const skippedPct = pctOf(stats.skipped)

  // 完成度（已处理/总计，不含跳过）
  const completionPct = totalActive > 0 ? Math.round((totalProcessed / totalActive) * 100) : 0

  // 效率（处理数/活跃总数）
  const efficiencyPct = totalActive > 0 ? Math.round((totalProcessed / totalActive) * 100) : 0

  // 环形图 SVG 参数
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const seg = (pct: number): number => (pct / 100) * circumference

  // 耗时格式化
  const elapsedString = formatDuration(stats.elapsedMs)
  const speedString = stats.avgSpeed > 0 ? stats.avgSpeed.toFixed(1) : '--'

  // 预计剩余
  const remaining = totalActive - totalProcessed
  const etaMs =
    stats.avgSpeed > 0 && remaining > 0 ? Math.round((remaining / stats.avgSpeed) * 1000) : 0

  // 概览卡片数据
  const overviewCards = [
    {
      label: '远程总条目',
      value: stats.remoteTotal,
      sub: `本地 ${String(totalAll)} 条`,
      icon: '📥',
      cls: 'bgm-overview-card-primary',
    },
    {
      label: '本次处理',
      value: totalProcessed,
      sub: '新增+更新+删除',
      icon: '🔧',
      cls: 'bgm-overview-card-success',
    },
    {
      label: '失败',
      value: stats.failed,
      sub: stats.failed > 0 ? '需关注' : '无异常',
      icon: stats.failed > 0 ? '⚠️' : '✅',
      cls: stats.failed > 0 ? 'bgm-overview-card-warning' : 'bgm-overview-card-muted',
    },
  ]

  container.innerHTML = `
    <!-- ===== 顶部概览条 ===== -->
    <div class="bgm-overview-bar">
      <div class="bgm-overview-cards">
        ${overviewCards
          .map(
            (c) => `
          <div class="bgm-overview-card ${c.cls}">
            <div class="bgm-overview-card-header">
              <span class="bgm-overview-icon">${c.icon}</span>
              <span class="bgm-overview-label">${c.label}</span>
            </div>
            <div class="bgm-overview-value">${String(c.value)}</div>
            <div class="bgm-overview-sub">${c.sub}</div>
          </div>
        `,
          )
          .join('')}
      </div>
      <div class="bgm-completion-ring">
        <svg viewBox="0 0 120 120" class="bgm-progress-svg">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface0, #313244)" stroke-width="10" />
          <circle cx="60" cy="60" r="50" fill="none"
            stroke="${completionPct >= 90 ? 'var(--green, #a6e3a1)' : completionPct >= 50 ? 'var(--yellow, #f9e2af)' : 'var(--red, #f38ba8)'}"
            stroke-width="10"
            stroke-dasharray="${String((completionPct / 100) * 2 * Math.PI * 50)} ${String(2 * Math.PI * 50)}"
            stroke-dashoffset="${String(2 * Math.PI * 50 * 0.25)}"
            stroke-linecap="round"
            transform="rotate(-90 60 60)"
            class="bgm-progress-ring" />
        </svg>
        <div class="bgm-progress-center">
          <div class="bgm-progress-value">${String(completionPct)}%</div>
          <div class="bgm-progress-label">完成度</div>
        </div>
      </div>
    </div>

    <!-- ===== 图表区 ===== -->
    <div class="bgm-chart-container">
      <div class="bgm-chart-left">
        <div class="bgm-donut-chart">
          <svg viewBox="0 0 140 140" class="bgm-donut-svg">
            <circle cx="70" cy="70" r="${String(radius)}" fill="none" stroke="var(--surface0, #313244)" stroke-width="14" />
            ${
              totalAll > 0
                ? `
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--green, #a6e3a1)" stroke-width="14"
                stroke-dasharray="${String(seg(addedPct))} ${String(circumference)}"
                stroke-dashoffset="0"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--yellow, #f9e2af)" stroke-width="14"
                stroke-dasharray="${String(seg(updatedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-seg(addedPct))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--red, #f38ba8)" stroke-width="14"
                stroke-dasharray="${String(seg(deletedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--overlay1, #7f849c)" stroke-width="14"
                stroke-dasharray="${String(seg(unchangedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct) + seg(deletedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />
              ${
                stats.failed > 0
                  ? `
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--peach, #fab387)" stroke-width="14"
                stroke-dasharray="${String(seg(failedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct) + seg(deletedPct) + seg(unchangedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />`
                  : ''
              }
              ${
                stats.skipped > 0
                  ? `
              <circle cx="70" cy="70" r="${String(radius)}" fill="none"
                stroke="var(--lavender, #b4befe)" stroke-width="14"
                stroke-dasharray="${String(seg(skippedPct))} ${String(circumference)}"
                stroke-dashoffset="${String(-(seg(addedPct) + seg(updatedPct) + seg(deletedPct) + seg(unchangedPct) + seg(failedPct)))}"
                transform="rotate(-90 70 70)" stroke-linecap="butt" />`
                  : ''
              }
            `
                : ''
            }
          </svg>
          <div class="bgm-donut-center">
            <div class="bgm-donut-center-value">${String(totalProcessed)}</div>
            <div class="bgm-donut-center-label">已处理</div>
          </div>
        </div>
        <div class="bgm-chart-legend">
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--green, #a6e3a1)"></span>新增 ${String(stats.added)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--yellow, #f9e2af)"></span>更新 ${String(stats.updated)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--red, #f38ba8)"></span>删除 ${String(stats.deleted)}</div>
          <div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--overlay1, #7f849c)"></span>无变更 ${String(stats.unchanged)}</div>
          ${stats.failed > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--peach, #fab387)"></span>失败 ${String(stats.failed)}</div>` : ''}
          ${stats.skipped > 0 ? `<div class="bgm-legend-item"><span class="bgm-legend-dot" style="background:var(--lavender, #b4befe)"></span>跳过 ${String(stats.skipped)}</div>` : ''}
        </div>
      </div>

      <div class="bgm-chart-right">
        <div class="bgm-bar-chart">
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">✅ 新增</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-add" style="width:${String(addedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.added)}<span class="bgm-bar-pct">(${addedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔄 更新</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-update" style="width:${String(updatedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.updated)}<span class="bgm-bar-pct">(${updatedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">❌ 删除</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-delete" style="width:${String(deletedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.deleted)}<span class="bgm-bar-pct">(${deletedPct.toFixed(0)}%)</span></span>
          </div>
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⏭️ 无变更</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-unchanged" style="width:${String(unchangedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.unchanged)}<span class="bgm-bar-pct">(${unchangedPct.toFixed(0)}%)</span></span>
          </div>
          ${
            stats.failed > 0
              ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">⚠️ 失败</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-fail" style="width:${String(failedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.failed)}<span class="bgm-bar-pct">(${failedPct.toFixed(0)}%)</span></span>
          </div>`
              : ''
          }
          ${
            stats.skipped > 0
              ? `
          <div class="bgm-bar-row">
            <span class="bgm-bar-label">🔍 跳过</span>
            <div class="bgm-bar-track"><div class="bgm-bar-fill bgm-bar-skip" style="width:${String(skippedPct)}%"></div></div>
            <span class="bgm-bar-value">${String(stats.skipped)}<span class="bgm-bar-pct">(${skippedPct.toFixed(0)}%)</span></span>
          </div>`
              : ''
          }
        </div>
      </div>
    </div>

    <!-- ===== 性能仪表盘 ===== -->
    <div class="bgm-perf-dashboard">
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--blue, #89b4fa)" stroke-width="6"
              stroke-dasharray="${String((completionPct / 100) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>⏱</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${elapsedString}</div>
          <div class="bgm-perg-label">总耗时</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--green, #a6e3a1)" stroke-width="6"
              stroke-dasharray="${String(Math.min(stats.avgSpeed / 50, 1) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>⚡</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${speedString}</div>
          <div class="bgm-perg-label">行/秒</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--peach, #fab387)" stroke-width="6"
              stroke-dasharray="${String((efficiencyPct / 100) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>📈</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${String(efficiencyPct)}%</div>
          <div class="bgm-perg-label">处理效率</div>
        </div>
      </div>
      <div class="bgm-perg-item">
        <div class="bgm-perg-ring">
          <svg viewBox="0 0 80 80" class="bgm-perg-svg">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--surface0, #313244)" stroke-width="6" />
            <circle cx="40" cy="40" r="32" fill="none"
              stroke="var(--sapphire, #74c7ec)" stroke-width="6"
              stroke-dasharray="${String(Math.min(totalProcessed / Math.max(stats.elapsedMs / 1000, 1) / 50, 1) * 2 * Math.PI * 32)} ${String(2 * Math.PI * 32)}"
              stroke-dashoffset="${String(2 * Math.PI * 32 * 0.25)}"
              stroke-linecap="round"
              transform="rotate(-90 40 40)" />
          </svg>
          <div class="bgm-perg-center"><span>🔮</span></div>
        </div>
        <div class="bgm-perg-info">
          <div class="bgm-perg-value">${etaMs > 0 ? formatDuration(etaMs) : '完成'}</div>
          <div class="bgm-perg-label">预计剩余</div>
        </div>
      </div>
    </div>

    <!-- ===== 元信息栏 ===== -->
    <div class="bgm-meta-bar">
      <span class="bgm-meta-tag">🎯 ${stats.strategyLabel}</span>
      <span class="bgm-meta-tag">📥 远程 ${String(stats.remoteTotal)}</span>
      <span class="bgm-meta-tag">✅ 完成 ${String(completionPct)}%</span>
      ${stats.skipped > 0 ? `<span class="bgm-meta-tag">🔍 跳过 ${String(stats.skipped)}</span>` : ''}
      ${stats.failed > 0 ? `<span class="bgm-meta-tag bgm-meta-tag-warn">⚠️ 失败 ${String(stats.failed)}</span>` : ''}
    </div>
  `
}

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
      const row = item.row !== undefined ? String(item.row) : '--'
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
 * @param stopped 是否被用户停止
 * @param onNext 点击"下一步"时的回调（用于打开同步完成详情弹窗）
 * @param stats 同步统计数据（用于渲染图表）
 * @param detailItems 同步明细数据（用于渲染详情表格）
 */
export function completeSyncProgressDialog(
  summary: string,
  details: string[],
  stopped = false,
  onNext?: () => void,
  stats?: SyncProgressStats,
  detailItems?: GithubSyncDetailItem[],
): void {
  const modal = ensureSyncProgressDialog()
  const titleElement = modal.querySelector<HTMLElement>('#bgmSyncProgressTitle')
  const iconElement = modal.querySelector<HTMLElement>('#bgmSyncProgressIcon')
  const progressSection = modal.querySelector<HTMLElement>('#bgmSyncProgressSection')
  const resultSection = modal.querySelector<HTMLElement>('#bgmSyncProgressResult')
  const summaryElement = modal.querySelector<HTMLElement>('#bgmSyncProgressSummary')
  const chartElement = modal.querySelector<HTMLElement>('#bgmSyncProgressChart')
  const detailsElement = modal.querySelector<HTMLElement>('#bgmSyncProgressDetails')
  const toggleButton = modal.querySelector<HTMLElement>('#bgmSyncProgressToggleDetails')
  const nextButton = modal.querySelector<HTMLElement>('#bgmSyncProgressNext')
  const runningBtns = modal.querySelector<HTMLElement>('#bgmSyncProgressRunningBtns')
  const doneBtns = modal.querySelector<HTMLElement>('#bgmSyncProgressDoneBtns')

  if (titleElement) titleElement.textContent = stopped ? '同步已停止' : '同步完成'
  if (iconElement) iconElement.textContent = stopped ? '⏹️' : '✅'
  if (progressSection) progressSection.style.display = 'none'
  if (resultSection) resultSection.style.display = ''
  if (runningBtns) runningBtns.style.display = 'none'
  if (doneBtns) doneBtns.style.display = 'flex'

  // 在 summary 中追加全局耗时
  let finalSummary = summary
  if (_syncGlobalStart > 0) {
    const totalElapsed = Date.now() - _syncGlobalStart - _syncPausedDuration
    const elapsedString = formatDuration(totalElapsed)
    finalSummary = `${summary} 用时 ${elapsedString}`
    // 重置全局 ETA 追踪
    _syncGlobalStart = 0
    _syncPausedDuration = 0
    _syncPauseStart = 0
  }
  if (summaryElement) summaryElement.textContent = finalSummary

  // 渲染统计图表（停止时也显示，展示已完成的部分统计）
  if (chartElement && stats) {
    chartElement.style.display = ''
    renderSyncStatsChart(chartElement, stats)
  } else if (chartElement) {
    chartElement.style.display = 'none'
  }

  if (detailsElement) {
    detailsElement.classList.remove('bgm-sync-progress__result-details--table')
    if (detailItems && detailItems.length > 0) {
      detailsElement.innerHTML = renderSyncDetailTable(detailItems)
      detailsElement.classList.add('bgm-sync-progress__result-details--table')
    } else {
      detailsElement.textContent = details.length > 0 ? details.join('\n') : '无详情'
    }
    detailsElement.style.display = 'none'
  }
  if (toggleButton) {
    toggleButton.textContent = '显示详情'
    toggleButton.setAttribute('aria-label', '显示详情')
    const hasDetails = details.length > 0 || (detailItems && detailItems.length > 0)
    toggleButton.style.display = hasDetails ? '' : 'none'
  }

  // 下一步按钮：仅当提供 onNext 回调时显示
  if (nextButton) {
    if (onNext) {
      nextButton.style.display = ''
      _syncNextHandler = onNext
    } else {
      nextButton.style.display = 'none'
    }
  }

  // 清理运行态回调（保留弹窗可见，供用户查看结果）
  _clearSyncProgressHandlers()
  // 恢复下一步回调（_clearSyncProgressHandlers 会清空，需重新设置）
  if (onNext) _syncNextHandler = onNext

  // 完成状态下支持 ESC 关闭
  _syncProgressEscHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      hideSyncProgressDialog()
    }
  }
  document.addEventListener('keydown', _syncProgressEscHandler)

  // 焦点切换到下一步按钮或关闭按钮，便于键盘用户立即操作
  const focusTarget = onNext
    ? modal.querySelector<HTMLElement>('#bgmSyncProgressNext')
    : modal.querySelector<HTMLElement>('#bgmSyncProgressClose')
  focusTarget?.focus()
}

/** 隐藏同步进度弹窗 */
export function hideSyncProgressDialog(): void {
  const modal = _syncProgressDialog
  if (!modal) return
  modal.style.display = 'none'
  modal.setAttribute('aria-hidden', 'true')
  _clearSyncProgressHandlers()
  // 重置全局 ETA 追踪状态
  _syncGlobalStart = 0
  _syncPausedDuration = 0
  _syncPauseStart = 0
  // 焦点返回到触发元素
  _syncProgressTrigger?.focus()
  _syncProgressTrigger = null
}

// ========== 公共 API ==========
export function showAlert(message: string, title?: string, onOk?: () => void): void {
  _showDialog('alert', { message, title: title || '提示', ...(onOk ? { onOk } : {}) })
}

/*
 * 显示确认对话框（新签名）
 * @param message  提示内容
 * @param callback 回调函数，参数 confirmed 为 true 表示用户点击了确定
 * @param title    可选标题
 */
export function showConfirm(
  message: string,
  callback: (confirmed: boolean) => void,
  title?: string,
): void {
  _showDialog('confirm', {
    message,
    title: title || '确认',
    onOk: () => {
      callback(true)
    },
    onCancel: () => {
      callback(false)
    },
  })
}

export function showError(message: string, title?: string, onOk?: () => void): void {
  _showDialog('error', { message, title: title || '错误', ...(onOk ? { onOk } : {}) })
}

export function showWarning(message: string, title?: string, onOk?: () => void): void {
  _showDialog('warning', { message, title: title || '警告', ...(onOk ? { onOk } : {}) })
}

export function showSuccess(message: string, title?: string, onOk?: () => void): void {
  _showDialog('success', { message, title: title || '成功', ...(onOk ? { onOk } : {}) })
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
    ...(onOk ? { onOk } : {}),
    ...(onCancel ? { onCancel } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
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
