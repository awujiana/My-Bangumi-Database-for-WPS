/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

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

// ========== 常量与配置 ==========
const DIALOG_TYPES: Record<string, DialogConfig> = {
  alert: {
    id: 'bgmAlertDialog',
    titleId: 'bgmAlertTitle',
    msgId: 'bgmAlertMessage',
    buttons: [{ id: 'bgmAlertOk', cls: 'bgm-btn-primary', text: '确定', event: 'ok' }],
  },
  confirm: {
    id: 'bgmConfirmDialog',
    titleId: 'bgmConfirmTitle',
    msgId: 'bgmConfirmMessage',
    buttons: [
      { id: 'bgmConfirmOk', cls: 'bgm-btn-primary', text: '确定', event: 'ok' },
      { id: 'bgmConfirmCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' },
    ],
  },
  error: {
    id: 'bgmErrorDialog',
    titleId: 'bgmErrorTitle',
    msgId: 'bgmErrorMessage',
    buttons: [{ id: 'bgmErrorOk', cls: 'bgm-btn-danger', text: '确定', event: 'ok' }],
  },
  warning: {
    id: 'bgmWarningDialog',
    titleId: 'bgmWarningTitle',
    msgId: 'bgmWarningMessage',
    buttons: [{ id: 'bgmWarningOk', cls: 'bgm-btn-warning', text: '确定', event: 'ok' }],
  },
  success: {
    id: 'bgmSuccessDialog',
    titleId: 'bgmSuccessTitle',
    msgId: 'bgmSuccessMessage',
    buttons: [{ id: 'bgmSuccessOk', cls: 'bgm-btn-success', text: '确定', event: 'ok' }],
  },
  input: {
    id: 'bgmInputDialog',
    titleId: 'bgmInputTitle',
    msgId: 'bgmInputPrompt',
    buttons: [
      { id: 'bgmInputOk', cls: 'bgm-btn-primary', text: '确定', event: 'ok' },
      { id: 'bgmInputCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' },
    ],
  },
}

// ========== 模块内部状态 ==========
let dialogInitialized = false
let _dialogCallback: DialogCallback | null = null
let _toastTimer: number | null = null
const dom: Record<string, HTMLElement | null> = {}

// ========== 初始化 ==========
function ensureDialogs(): void {
  if (dialogInitialized) return
  dialogInitialized = true
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
    const cfg = DIALOG_TYPES[type]
    if (!cfg) return document.createElement('div')
    const modal = document.createElement('div')
    modal.id = cfg.id
    modal.className = 'bgm-modal'
    modal.style.display = 'none'
    // 可访问性：声明对话框角色
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', cfg.titleId)

    const content = document.createElement('div')
    content.className = 'bgm-modal-content ' + type

    const header = document.createElement('div')
    header.className = 'bgm-dialog-header'
    const icon = document.createElement('span')
    icon.className = 'bgm-dialog-icon ' + iconClass
    icon.innerHTML = sanitizeHtml(iconChar)
    const title = document.createElement('span')
    title.id = cfg.titleId
    title.className = 'bgm-dialog-title'
    title.textContent = defaultTitle
    header.appendChild(icon)
    header.appendChild(title)
    content.appendChild(header)

    const body = document.createElement('div')
    body.className = 'bgm-dialog-body'
    const msg = document.createElement('p')
    msg.id = cfg.msgId
    msg.className = 'bgm-dialog-message'
    body.appendChild(msg)
    content.appendChild(body)

    const footer = document.createElement('div')
    footer.className = 'bgm-dialog-footer'
    cfg.buttons.forEach((btn: DialogButton) => {
      const button = document.createElement('button')
      button.id = btn.id
      button.className = 'bgm-btn ' + btn.cls
      button.textContent = btn.text
      button.dataset.event = btn.event
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
    const cfg = DIALOG_TYPES[type]
    if (!cfg) continue
    dom[cfg.id] = document.getElementById(cfg.id)
    dom[cfg.titleId] = document.getElementById(cfg.titleId)
    dom[cfg.msgId] = document.getElementById(cfg.msgId)
    cfg.buttons.forEach((btn) => {
      dom[btn.id] = document.getElementById(btn.id)
    })
  }
  dom.bgmToast = document.getElementById('bgmToast')
  dom.bgmInputField = document.getElementById('bgmInputField')

  const container = document.getElementById('bgmDialogContainer')
  if (!container) return

  container.addEventListener('click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest('button')
    if (!btn) return
    const eventType = (btn as HTMLButtonElement).dataset.event
    if (!eventType) return
    const modal = btn.closest('.bgm-modal') as HTMLElement
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
      } catch (e) {
        console.error('[dialog] 回调执行失败:', e)
      }
      _dialogCallback = null
    }
  })

  dom.bgmInputField?.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') dom.bgmInputOk?.click()
  })
}

function _showDialog(type: string, opts: DialogOptions = {}): void {
  const cfg = DIALOG_TYPES[type]
  if (!cfg) return
  const dialog = dom[cfg.id]
  if (!dialog) {
    if (type === 'confirm') {
      if (window.confirm(opts.message || '')) opts.onOk?.()
      else opts.onCancel?.()
    } else if (type === 'input') {
      const result = window.prompt(opts.prompt || opts.message || '', opts.defaultValue || '')
      if (result !== null) opts.onOk?.(result)
      else opts.onCancel?.()
    } else {
      window.alert(opts.message)
      opts.onOk?.()
    }
    return
  }

  const titleEl = dom[cfg.titleId]
  const msgEl = dom[cfg.msgId]
  if (titleEl) titleEl.textContent = opts.title || ''
  if (msgEl) msgEl.textContent = opts.prompt || opts.message || ''

  if (type === 'input' && dom.bgmInputField) {
    ;(dom.bgmInputField as HTMLInputElement).value = opts.defaultValue || ''
    dom.bgmInputField.focus()
  }

  const callback: DialogCallback = {}
  if (opts.onOk) callback.onOk = opts.onOk
  if (opts.onCancel) callback.onCancel = opts.onCancel
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
            <div class="bgm-dialog-body" style="max-height: 60vh; overflow-y: auto;">
                <div id="bgmSyncSummary" class="bgm-dialog-message" style="white-space: pre-line;"></div>
                <div id="bgmSyncDetails" style="display:none; margin-top: 8px; max-height: 300px; overflow-y: auto; font-size: 12px; line-height: 1.6; white-space: pre; font-family: monospace;"></div>
            </div>
            <div class="bgm-dialog-footer">
                <button id="bgmSyncToggleDetails" class="bgm-btn bgm-btn-default">显示详情</button>
                <button id="bgmSyncResultOk" class="bgm-btn bgm-btn-success">确定</button>
            </div>
        </div>
    `)

  document.body.appendChild(modal)

  const detailsEl = modal.querySelector('#bgmSyncDetails') as HTMLElement
  const toggleBtn = modal.querySelector('#bgmSyncToggleDetails') as HTMLElement

  toggleBtn.addEventListener('click', () => {
    const expanded = detailsEl.style.display !== 'none'
    detailsEl.style.display = expanded ? 'none' : 'block'
    toggleBtn.textContent = expanded ? '显示详情' : '收起详情'
  })

  modal.querySelector('#bgmSyncResultOk')?.addEventListener('click', () => {
    modal.style.display = 'none'
  })

  _syncResultDialog = modal
  return modal
}

export function showSyncResult(summary: string, details: string[]): void {
  const modal = ensureSyncResultDialog()
  const summaryEl = modal.querySelector('#bgmSyncSummary') as HTMLElement
  const detailsEl = modal.querySelector('#bgmSyncDetails') as HTMLElement
  const toggleBtn = modal.querySelector('#bgmSyncToggleDetails') as HTMLElement

  summaryEl.textContent = summary
  detailsEl.textContent = details.length > 0 ? details.join('\n') : '无详情'

  // 重置为收起状态
  detailsEl.style.display = 'none'
  toggleBtn.textContent = '显示详情'
  toggleBtn.style.display = details.length > 0 ? '' : 'none'

  modal.style.display = 'flex'
}

// ========== 同步进度弹窗 ==========
let _syncProgressDialog: HTMLElement | null = null
let _syncProgressLogCount = 0
const _SYNC_PROGRESS_LOG_MAX = 500

/** 暂停/恢复/停止按钮回调 */
let _syncPauseHandler: (() => void) | null = null
let _syncResumeHandler: (() => void) | null = null
let _syncStopHandler: (() => void) | null = null
/** 下一步按钮回调（点击后打开同步完成详情弹窗） */
let _syncNextHandler: (() => void) | null = null

/** 当前是否处于暂停状态（统一监听器据此决定调用 pause 还是 resume） */
let _syncPaused = false

/** 触发同步弹窗的元素（关闭后恢复焦点） */
let _syncProgressTrigger: HTMLElement | null = null

/** ESC 键监听器引用（仅在完成状态下注册） */
let _syncProgressEscHandler: ((e: KeyboardEvent) => void) | null = null

/** 内部：根据暂停状态更新按钮文本/样式/aria-label */
function _setSyncPausedState(paused: boolean): void {
  _syncPaused = paused
  const pauseBtn = _syncProgressDialog?.querySelector(
    '#bgmSyncProgressPauseBtn',
  ) as HTMLButtonElement | null
  if (!pauseBtn) return
  pauseBtn.textContent = paused ? '▶️ 继续' : '⏸️ 暂停'
  pauseBtn.setAttribute('aria-label', paused ? '继续同步' : '暂停同步')
  if (paused) {
    pauseBtn.classList.remove('bgm-btn-default')
    pauseBtn.classList.add('bgm-btn-success')
  } else {
    pauseBtn.classList.add('bgm-btn-default')
    pauseBtn.classList.remove('bgm-btn-success')
  }
}

/** 内部：清理所有回调与状态（complete/hide 时调用） */
function _clearSyncProgressHandlers(): void {
  _syncPauseHandler = null
  _syncResumeHandler = null
  _syncStopHandler = null
  _syncNextHandler = null
  _syncPaused = false
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
                <span class="bgm-dialog-icon" id="bgmSyncProgressIcon">🔄</span>
                <span class="bgm-dialog-title" id="bgmSyncProgressTitle">正在同步...</span>
            </div>
            <div class="bgm-dialog-body bgm-sync-progress__body">
                <!-- 进度区 -->
                <div id="bgmSyncProgressSection">
                    <div class="bgm-sync-progress__meta" aria-live="polite" aria-atomic="true">
                        <span id="bgmSyncProgressLabel">进度: 0/0</span>
                        <span id="bgmSyncProgressPercent">0%</span>
                        <span id="bgmSyncProgressEta" class="bgm-sync-progress__eta" style="display:none;"></span>
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
                    <button id="bgmSyncProgressPauseBtn" type="button" class="bgm-btn bgm-btn-default" aria-label="暂停同步">⏸️ 暂停</button>
                    <button id="bgmSyncProgressStop" type="button" class="bgm-btn bgm-btn-danger" aria-label="停止同步">⏹️ 停止</button>
                </div>
                <!-- 完成按钮（默认隐藏） -->
                <div id="bgmSyncProgressDoneBtns" class="bgm-sync-progress__done-btns" style="display: none;">
                    <button id="bgmSyncProgressToggleDetails" type="button" class="bgm-btn bgm-btn-default" aria-label="显示详情">显示详情</button>
                    <button id="bgmSyncProgressClose" type="button" class="bgm-btn bgm-btn-default" aria-label="关闭弹窗">关闭</button>
                    <button id="bgmSyncProgressNext" type="button" class="bgm-btn bgm-btn-primary" aria-label="下一步">下一步 →</button>
                </div>
            </div>
        </div>
    `)

  document.body.appendChild(modal)

  // 绑定按钮事件：统一使用 addEventListener，禁止 onclick 重绑定
  const pauseBtn = modal.querySelector('#bgmSyncProgressPauseBtn') as HTMLButtonElement | null
  const stopBtn = modal.querySelector('#bgmSyncProgressStop') as HTMLButtonElement | null
  const closeBtn = modal.querySelector('#bgmSyncProgressClose') as HTMLButtonElement | null
  const nextBtn = modal.querySelector('#bgmSyncProgressNext') as HTMLButtonElement | null
  const toggleDetailsBtn = modal.querySelector(
    '#bgmSyncProgressToggleDetails',
  ) as HTMLButtonElement | null

  // 暂停/继续按钮：根据 _syncPaused 标志自行决定调用哪个处理器，并自行更新按钮文本
  if (pauseBtn) {
    pauseBtn.addEventListener('click', (): void => {
      if (!_syncProgressDialog || _syncProgressDialog.style.display === 'none') return
      if (_syncPaused) {
        _syncResumeHandler?.()
        _setSyncPausedState(false)
      } else {
        _syncPauseHandler?.()
        _setSyncPausedState(true)
      }
    })
  }
  // 停止按钮
  if (stopBtn) {
    stopBtn.addEventListener('click', (): void => {
      if (!_syncProgressDialog || _syncProgressDialog.style.display === 'none') return
      _syncStopHandler?.()
    })
  }
  // 关闭按钮
  if (closeBtn) {
    closeBtn.addEventListener('click', (): void => {
      hideSyncProgressDialog()
    })
  }
  // 下一步按钮
  if (nextBtn) {
    nextBtn.addEventListener('click', (): void => {
      hideSyncProgressDialog()
      _syncNextHandler?.()
    })
  }
  // 详情切换按钮
  if (toggleDetailsBtn) {
    toggleDetailsBtn.addEventListener('click', (): void => {
      const detailsEl = modal.querySelector('#bgmSyncProgressDetails') as HTMLElement | null
      if (!detailsEl) return
      const expanded = detailsEl.style.display !== 'none'
      detailsEl.style.display = expanded ? 'none' : 'block'
      toggleDetailsBtn.textContent = expanded ? '显示详情' : '收起详情'
      toggleDetailsBtn.setAttribute('aria-label', expanded ? '显示详情' : '收起详情')
    })
  }

  _syncProgressDialog = modal
  return modal
}

/**
 * 显示同步进度弹窗（运行中状态）
 * @param title 弹窗标题（如"正在同步 - 选中行同步"）
 * @param handlers 暂停/恢复/停止回调集合
 */
export function showSyncProgressDialog(
  title: string,
  handlers: { onPause: () => void; onResume: () => void; onStop: () => void },
): void {
  const modal = ensureSyncProgressDialog()

  // 保存触发元素，用于关闭后恢复焦点
  _syncProgressTrigger = document.activeElement as HTMLElement | null

  // 重置回调与状态（必须在重置 UI 前完成，避免上次同步残留）
  _clearSyncProgressHandlers()
  _syncPauseHandler = handlers.onPause
  _syncResumeHandler = handlers.onResume
  _syncStopHandler = handlers.onStop
  _syncPaused = false
  _syncProgressLogCount = 0

  // 重置为运行中状态
  const titleEl = modal.querySelector('#bgmSyncProgressTitle') as HTMLElement | null
  const iconEl = modal.querySelector('#bgmSyncProgressIcon') as HTMLElement | null
  const progressSection = modal.querySelector('#bgmSyncProgressSection') as HTMLElement | null
  const resultSection = modal.querySelector('#bgmSyncProgressResult') as HTMLElement | null
  const runningBtns = modal.querySelector('#bgmSyncProgressRunningBtns') as HTMLElement | null
  const doneBtns = modal.querySelector('#bgmSyncProgressDoneBtns') as HTMLElement | null
  const pauseBtn = modal.querySelector('#bgmSyncProgressPauseBtn') as HTMLButtonElement | null

  if (titleEl) titleEl.textContent = title
  if (iconEl) iconEl.textContent = '🔄'
  if (progressSection) progressSection.style.display = ''
  if (resultSection) resultSection.style.display = 'none'
  if (runningBtns) runningBtns.style.display = 'flex'
  if (doneBtns) doneBtns.style.display = 'none'
  // 重置暂停按钮（文本/样式/aria-label），避免上次同步残留的 resume 状态
  if (pauseBtn) {
    pauseBtn.textContent = '⏸️ 暂停'
    pauseBtn.setAttribute('aria-label', '暂停同步')
    pauseBtn.classList.remove('bgm-btn-success')
    pauseBtn.classList.add('bgm-btn-default')
  }

  // 重置进度
  const bar = modal.querySelector('#bgmSyncProgressBar') as HTMLElement | null
  const label = modal.querySelector('#bgmSyncProgressLabel') as HTMLElement | null
  const percent = modal.querySelector('#bgmSyncProgressPercent') as HTMLElement | null
  const current = modal.querySelector('#bgmSyncProgressCurrent') as HTMLElement | null
  const log = modal.querySelector('#bgmSyncProgressLog') as HTMLElement | null
  const etaEl = modal.querySelector('#bgmSyncProgressEta') as HTMLElement | null
  if (bar) {
    bar.style.width = '0%'
    bar.textContent = ''
    bar.setAttribute('aria-valuenow', '0')
  }
  if (label) label.textContent = '进度: 准备中...'
  if (percent) percent.textContent = '--%'
  if (current) current.textContent = ''
  if (log) log.textContent = ''
  if (etaEl) {
    etaEl.textContent = ''
    etaEl.style.display = 'none'
  }

  modal.style.display = 'flex'
  modal.setAttribute('aria-hidden', 'false')

  // 焦点管理：将焦点移至暂停按钮，便于键盘操作
  pauseBtn?.focus()
}

/**
 * 更新进度条
 * @param current 当前完成数
 * @param total 总数
 * @param message 当前任务描述（显示在进度条下方）
 * @param logLine 可选的实时日志行（追加到日志区）或 ETA 字符串
 */
export function updateSyncProgressDialog(
  current: number,
  total: number,
  message?: string,
  logLine?: string,
): void {
  const modal = _syncProgressDialog
  // 弹窗未显示时快速返回，避免无效 DOM 写入
  if (!modal || modal.style.display === 'none') return

  const bar = modal.querySelector('#bgmSyncProgressBar') as HTMLElement | null
  const label = modal.querySelector('#bgmSyncProgressLabel') as HTMLElement | null
  const percent = modal.querySelector('#bgmSyncProgressPercent') as HTMLElement | null
  const currentEl = modal.querySelector('#bgmSyncProgressCurrent') as HTMLElement | null
  const log = modal.querySelector('#bgmSyncProgressLog') as HTMLElement | null
  const etaEl = modal.querySelector('#bgmSyncProgressEta') as HTMLElement | null

  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  if (bar) {
    bar.style.width = pct + '%'
    bar.textContent = pct + '%'
    bar.setAttribute('aria-valuenow', String(pct))
  }
  if (label) label.textContent = `进度: ${current}/${total}`
  if (percent) percent.textContent = pct + '%'
  if (currentEl && message) currentEl.textContent = message

  // 显示 ETA（当 logLine 以"预计剩余"或"剩余:"开头时，视为 ETA 信息）
  if (etaEl && logLine && (logLine.startsWith('预计剩余') || logLine.startsWith('剩余:'))) {
    etaEl.textContent = logLine
    etaEl.style.display = ''
  } else if (etaEl && !logLine) {
    etaEl.style.display = 'none'
  }

  // 仅将非 ETA 的日志行追加到日志区（ETA 已单独显示在 ETA 元素中，避免重复）
  if (logLine && log && !logLine.startsWith('预计剩余') && !logLine.startsWith('剩余:')) {
    // 智能滚动：仅当用户已接近底部时才自动滚动，避免打断阅读
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30
    log.appendChild(document.createTextNode(logLine + '\n'))
    _syncProgressLogCount++
    // 限制日志条数，避免过多 DOM 节点
    while (_syncProgressLogCount > _SYNC_PROGRESS_LOG_MAX) {
      if (log.firstChild) {
        log.removeChild(log.firstChild)
        _syncProgressLogCount--
      } else {
        break
      }
    }
    if (nearBottom) {
      log.scrollTop = log.scrollHeight
    }
  }
}

/**
 * 同步统计数据接口
 */
export interface SyncProgressStats {
  added: number
  updated: number
  deleted: number
  unchanged: number
  failed: number
  elapsedMs: number
  avgSpeed: number
}

/**
 * 渲染同步统计图表（SVG 实现，无需外部依赖）
 * @param container 图表容器元素
 * @param stats 同步统计数据
 */
function renderSyncStatsChart(container: HTMLElement, stats: SyncProgressStats): void {
  const total = stats.added + stats.updated + stats.deleted + stats.unchanged + stats.failed
  const elapsedSec =
    stats.elapsedMs < 1000 ? `${stats.elapsedMs}ms` : `${(stats.elapsedMs / 1000).toFixed(1)}s`

  // 百分比计算（以 total 为基数，避免为 0）
  const denom = Math.max(total, 1)
  const pct = (n: number): string => ((n / denom) * 100).toFixed(1)

  // 统计卡片 HTML（带颜色条）
  const statCards: Array<{ label: string; value: number; color: string; icon: string }> = [
    { label: '新增', value: stats.added, color: '#22c55e', icon: '➕' },
    { label: '更新', value: stats.updated, color: '#3b82f6', icon: '✏️' },
    { label: '删除', value: stats.deleted, color: '#f59e0b', icon: '🗑️' },
    { label: '无变更', value: stats.unchanged, color: '#6b7280', icon: '⏭️' },
  ]

  const failedPct = pct(stats.failed)
  const barMax = Math.max(stats.added, stats.updated, stats.deleted, stats.unchanged, 1)

  // 构建 SVG 柱状图
  const barWidth = 36
  const barGap = 16
  const chartHeight = 120
  const chartPadding = 20
  const barsTotalWidth = statCards.length * (barWidth + barGap) - barGap
  const chartWidth = Math.max(barsTotalWidth + chartPadding * 2, 320)

  const barsSvg = statCards
    .map((s, i) => {
      const barH = Math.max(
        s.value > 0 ? (s.value / barMax) * (chartHeight - chartPadding * 2) : 2,
        2,
      )
      const x = chartPadding + i * (barWidth + barGap)
      const y = chartHeight - chartPadding - barH
      const displayVal = s.value >= 10000 ? `${(s.value / 1000).toFixed(1)}k` : String(s.value)
      return `
        <g>
          <rect x="${x}" y="${chartHeight - chartPadding}" width="${barWidth}" height="${chartPadding}" fill="rgba(255,255,255,0.03)" rx="3"/>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${s.color}" rx="4" opacity="0.9">
            <animate attributeName="height" from="0" to="${barH}" dur="0.5s" fill="freeze"/>
            <animate attributeName="y" from="${chartHeight - chartPadding}" to="${y}" dur="0.5s" fill="freeze"/>
          </rect>
          <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" fill="#e2e8f0" font-size="13" font-weight="600">${displayVal}</text>
          <text x="${x + barWidth / 2}" y="${chartHeight - 4}" text-anchor="middle" fill="#94a3b8" font-size="11">${s.label}</text>
        </g>
      `
    })
    .join('')

  // 统计卡片
  const statCardsHtml = statCards
    .map(
      (s) => `
      <div class="bgm-stat-card" style="--accent:${s.color}">
        <div class="bgm-stat-card__icon">${s.icon}</div>
        <div class="bgm-stat-card__info">
          <div class="bgm-stat-card__value">${s.value.toLocaleString()}</div>
          <div class="bgm-stat-card__label">${s.label}</div>
        </div>
        <div class="bgm-stat-card__bar" style="width:${pct(s.value)}%;background:${s.color}"></div>
      </div>
    `,
    )
    .join('')

  const failedBadge =
    stats.failed > 0
      ? `<div class="bgm-stat-badge bgm-stat-badge--error">❌ 失败 ${stats.failed} (${failedPct}%)</div>`
      : ''

  container.innerHTML = `
    <div class="bgm-stats-header">
      <div class="bgm-stats-title">📊 同步统计</div>
      <div class="bgm-stats-meta">
        <span class="bgm-stats-chip">⏱️ ${elapsedSec}</span>
        <span class="bgm-stats-chip">⚡ ${stats.avgSpeed > 0 ? stats.avgSpeed + ' 行/秒' : '--'}</span>
        <span class="bgm-stats-chip">📈 共处理 ${total.toLocaleString()} 条</span>
      </div>
    </div>
    <div class="bgm-stat-cards">${statCardsHtml}</div>
    ${failedBadge}
    <div class="bgm-stats-chart-wrap">
      <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="bgm-stats-chart" preserveAspectRatio="xMidYMid meet">
        <line x1="${chartPadding}" y1="${chartHeight - chartPadding}" x2="${chartWidth - chartPadding}" y2="${chartHeight - chartPadding}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        ${barsSvg}
      </svg>
    </div>
  `
}

/**
 * 切换弹窗为完成状态，显示统计结果
 * @param summary 统计摘要文本
 * @param details 详情数组
 * @param stopped 是否被用户停止
 * @param onNext 点击"下一步"时的回调（用于打开同步完成详情弹窗）
 * @param stats 同步统计数据（用于渲染图表）
 */
export function completeSyncProgressDialog(
  summary: string,
  details: string[],
  stopped: boolean = false,
  onNext?: () => void,
  stats?: SyncProgressStats,
): void {
  const modal = ensureSyncProgressDialog()
  const titleEl = modal.querySelector('#bgmSyncProgressTitle') as HTMLElement | null
  const iconEl = modal.querySelector('#bgmSyncProgressIcon') as HTMLElement | null
  const progressSection = modal.querySelector('#bgmSyncProgressSection') as HTMLElement | null
  const resultSection = modal.querySelector('#bgmSyncProgressResult') as HTMLElement | null
  const summaryEl = modal.querySelector('#bgmSyncProgressSummary') as HTMLElement | null
  const chartEl = modal.querySelector('#bgmSyncProgressChart') as HTMLElement | null
  const detailsEl = modal.querySelector('#bgmSyncProgressDetails') as HTMLElement | null
  const toggleBtn = modal.querySelector('#bgmSyncProgressToggleDetails') as HTMLButtonElement | null
  const nextBtn = modal.querySelector('#bgmSyncProgressNext') as HTMLButtonElement | null
  const runningBtns = modal.querySelector('#bgmSyncProgressRunningBtns') as HTMLElement | null
  const doneBtns = modal.querySelector('#bgmSyncProgressDoneBtns') as HTMLElement | null

  if (titleEl) titleEl.textContent = stopped ? '同步已停止' : '同步完成'
  if (iconEl) iconEl.textContent = stopped ? '⏹️' : '✅'
  if (progressSection) progressSection.style.display = 'none'
  if (resultSection) resultSection.style.display = ''
  if (runningBtns) runningBtns.style.display = 'none'
  if (doneBtns) doneBtns.style.display = 'flex'

  if (summaryEl) summaryEl.textContent = summary

  // 渲染统计图表
  if (chartEl && stats && !stopped) {
    chartEl.style.display = ''
    renderSyncStatsChart(chartEl, stats)
  } else if (chartEl) {
    chartEl.style.display = 'none'
  }

  if (detailsEl) {
    detailsEl.textContent = details.length > 0 ? details.join('\n') : '无详情'
    detailsEl.style.display = 'none'
  }
  if (toggleBtn) {
    toggleBtn.textContent = '显示详情'
    toggleBtn.setAttribute('aria-label', '显示详情')
    toggleBtn.style.display = details.length > 0 ? '' : 'none'
  }

  // 下一步按钮：仅当提供 onNext 回调时显示
  if (nextBtn) {
    if (onNext) {
      nextBtn.style.display = ''
      _syncNextHandler = onNext
    } else {
      nextBtn.style.display = 'none'
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
    ? (modal.querySelector('#bgmSyncProgressNext') as HTMLButtonElement | null)
    : (modal.querySelector('#bgmSyncProgressClose') as HTMLButtonElement | null)
  focusTarget?.focus()
}

/** 隐藏同步进度弹窗 */
export function hideSyncProgressDialog(): void {
  const modal = _syncProgressDialog
  if (!modal) return
  modal.style.display = 'none'
  modal.setAttribute('aria-hidden', 'true')
  _clearSyncProgressHandlers()
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
    onOk: () => callback(true),
    onCancel: () => callback(false),
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
  if (type) toast.classList.add('bgm-toast-' + type)

  _toastTimer = window.setTimeout(() => {
    toast.className = 'bgm-toast'
    _toastTimer = null
  }, 3000)
}
