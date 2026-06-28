/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */
// ========== 常量与配置 ==========
const DIALOG_TYPES = {
    alert: { id: 'bgmAlertDialog', titleId: 'bgmAlertTitle', msgId: 'bgmAlertMessage', buttons: [{ id: 'bgmAlertOk', cls: 'bgm-btn-primary', text: '确定', event: 'ok' }] },
    confirm: { id: 'bgmConfirmDialog', titleId: 'bgmConfirmTitle', msgId: 'bgmConfirmMessage', buttons: [{ id: 'bgmConfirmOk', cls: 'bgm-btn-primary', text: '确定', event: 'ok' }, { id: 'bgmConfirmCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' }] },
    error: { id: 'bgmErrorDialog', titleId: 'bgmErrorTitle', msgId: 'bgmErrorMessage', buttons: [{ id: 'bgmErrorOk', cls: 'bgm-btn-danger', text: '确定', event: 'ok' }] },
    warning: { id: 'bgmWarningDialog', titleId: 'bgmWarningTitle', msgId: 'bgmWarningMessage', buttons: [{ id: 'bgmWarningOk', cls: 'bgm-btn-warning', text: '确定', event: 'ok' }] },
    success: { id: 'bgmSuccessDialog', titleId: 'bgmSuccessTitle', msgId: 'bgmSuccessMessage', buttons: [{ id: 'bgmSuccessOk', cls: 'bgm-btn-success', text: '确定', event: 'ok' }] },
    input: { id: 'bgmInputDialog', titleId: 'bgmInputTitle', msgId: 'bgmInputPrompt', buttons: [{ id: 'bgmInputOk', cls: 'bgm-btn-primary', text: '确定', event: 'ok' }, { id: 'bgmInputCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' }] }
};
// ========== 模块内部状态 ==========
let dialogInitialized = false;
let _dialogCallback = null;
let _toastTimer = null;
const dom = {};
// ========== 初始化 ==========
function ensureDialogs() {
    if (dialogInitialized)
        return;
    dialogInitialized = true;
    createDialogs();
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureDialogs);
    }
    else {
        setTimeout(ensureDialogs, 0);
    }
}
function createDialogs() {
    if (document.getElementById('bgmDialogContainer'))
        return;
    const container = document.createElement('div');
    container.id = 'bgmDialogContainer';
    document.body.appendChild(container);
    function createDialogElement(type, iconClass, iconChar, defaultTitle) {
        const cfg = DIALOG_TYPES[type];
        const modal = document.createElement('div');
        modal.id = cfg.id;
        modal.className = 'bgm-modal';
        modal.style.display = 'none';
        const content = document.createElement('div');
        content.className = 'bgm-modal-content ' + type;
        const header = document.createElement('div');
        header.className = 'bgm-dialog-header';
        const icon = document.createElement('span');
        icon.className = 'bgm-dialog-icon ' + iconClass;
        icon.innerHTML = iconChar;
        const title = document.createElement('span');
        title.id = cfg.titleId;
        title.className = 'bgm-dialog-title';
        title.textContent = defaultTitle;
        header.appendChild(icon);
        header.appendChild(title);
        content.appendChild(header);
        const body = document.createElement('div');
        body.className = 'bgm-dialog-body';
        const msg = document.createElement('p');
        msg.id = cfg.msgId;
        msg.className = 'bgm-dialog-message';
        body.appendChild(msg);
        content.appendChild(body);
        const footer = document.createElement('div');
        footer.className = 'bgm-dialog-footer';
        cfg.buttons.forEach((btn) => {
            const button = document.createElement('button');
            button.id = btn.id;
            button.className = 'bgm-btn ' + btn.cls;
            button.textContent = btn.text;
            button.dataset.event = btn.event;
            footer.appendChild(button);
        });
        content.appendChild(footer);
        modal.appendChild(content);
        return modal;
    }
    container.appendChild(createDialogElement('alert', 'bgm-icon-info', '&#9432;', '提示'));
    container.appendChild(createDialogElement('confirm', 'bgm-icon-question', '&#63;', '确认'));
    container.appendChild(createDialogElement('error', 'bgm-icon-error', '&#10006;', '错误'));
    container.appendChild(createDialogElement('warning', 'bgm-icon-warning', '&#9888;', '警告'));
    container.appendChild(createDialogElement('success', 'bgm-icon-success', '&#10004;', '成功'));
    container.appendChild(createDialogElement('input', 'bgm-icon-info', '&#9432;', '输入'));
    const inputBody = document.querySelector('#bgmInputDialog .bgm-dialog-body');
    if (inputBody) {
        const inputField = document.createElement('input');
        inputField.type = 'text';
        inputField.id = 'bgmInputField';
        inputField.className = 'bgm-input-field';
        inputBody.appendChild(inputField);
    }
    const toast = document.createElement('div');
    toast.id = 'bgmToast';
    toast.className = 'bgm-toast';
    container.appendChild(toast);
    bindAllEvents();
}
function bindAllEvents() {
    for (const type in DIALOG_TYPES) {
        const cfg = DIALOG_TYPES[type];
        dom[cfg.id] = document.getElementById(cfg.id);
        dom[cfg.titleId] = document.getElementById(cfg.titleId);
        dom[cfg.msgId] = document.getElementById(cfg.msgId);
        cfg.buttons.forEach(btn => { dom[btn.id] = document.getElementById(btn.id); });
    }
    dom.bgmToast = document.getElementById('bgmToast');
    dom.bgmInputField = document.getElementById('bgmInputField');
    const container = document.getElementById('bgmDialogContainer');
    if (!container)
        return;
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn)
            return;
        const eventType = btn.dataset.event;
        if (!eventType)
            return;
        const modal = btn.closest('.bgm-modal');
        if (!modal)
            return;
        modal.style.display = 'none';
        if (_dialogCallback) {
            try {
                if (eventType === 'ok' && _dialogCallback.onOk) {
                    if (modal.id === 'bgmInputDialog') {
                        const inputValue = dom.bgmInputField ? dom.bgmInputField.value.trim() : '';
                        _dialogCallback.onOk(inputValue);
                    }
                    else {
                        _dialogCallback.onOk();
                    }
                }
                else if (eventType === 'cancel' && _dialogCallback.onCancel) {
                    _dialogCallback.onCancel();
                }
            }
            catch (e) {
                console.error('[dialog] 回调执行失败:', e);
            }
            _dialogCallback = null;
        }
    });
    dom.bgmInputField?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter')
            dom.bgmInputOk?.click();
    });
}
function _showDialog(type, opts = {}) {
    const cfg = DIALOG_TYPES[type];
    const dialog = dom[cfg.id];
    if (!dialog) {
        if (type === 'confirm') {
            if (window.confirm(opts.message || ''))
                opts.onOk?.();
            else
                opts.onCancel?.();
        }
        else if (type === 'input') {
            const result = window.prompt(opts.prompt || opts.message || '', opts.defaultValue || '');
            if (result !== null)
                opts.onOk?.(result);
            else
                opts.onCancel?.();
        }
        else {
            window.alert(opts.message);
            opts.onOk?.();
        }
        return;
    }
    const titleEl = dom[cfg.titleId];
    const msgEl = dom[cfg.msgId];
    if (titleEl)
        titleEl.textContent = opts.title || '';
    if (msgEl)
        msgEl.textContent = opts.prompt || opts.message || '';
    if (type === 'input' && dom.bgmInputField) {
        dom.bgmInputField.value = opts.defaultValue || '';
        dom.bgmInputField.focus();
    }
    _dialogCallback = { onOk: opts.onOk, onCancel: opts.onCancel };
    dialog.style.display = 'flex';
}
// ========== 同步结果对话框 ==========
let _syncResultDialog = null;
function ensureSyncResultDialog() {
    if (_syncResultDialog)
        return _syncResultDialog;
    const modal = document.createElement('div');
    modal.id = 'bgmSyncResultDialog';
    modal.className = 'bgm-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
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
    `;
    document.body.appendChild(modal);
    const detailsEl = modal.querySelector('#bgmSyncDetails');
    const toggleBtn = modal.querySelector('#bgmSyncToggleDetails');
    toggleBtn.addEventListener('click', () => {
        const expanded = detailsEl.style.display !== 'none';
        detailsEl.style.display = expanded ? 'none' : 'block';
        toggleBtn.textContent = expanded ? '显示详情' : '收起详情';
    });
    modal.querySelector('#bgmSyncResultOk')?.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    _syncResultDialog = modal;
    return modal;
}
export function showSyncResult(summary, details) {
    const modal = ensureSyncResultDialog();
    const summaryEl = modal.querySelector('#bgmSyncSummary');
    const detailsEl = modal.querySelector('#bgmSyncDetails');
    const toggleBtn = modal.querySelector('#bgmSyncToggleDetails');
    summaryEl.textContent = summary;
    detailsEl.textContent = details.length > 0 ? details.join('\n') : '无详情';
    // 重置为收起状态
    detailsEl.style.display = 'none';
    toggleBtn.textContent = '显示详情';
    toggleBtn.style.display = details.length > 0 ? '' : 'none';
    modal.style.display = 'flex';
}
// ========== 同步进度弹窗 ==========
let _syncProgressDialog = null;
let _syncProgressLogCount = 0;
const _SYNC_PROGRESS_LOG_MAX = 500;
/** 暂停/恢复/停止按钮回调 */
let _syncPauseHandler = null;
let _syncResumeHandler = null;
let _syncStopHandler = null;
/** 当前是否处于暂停状态（统一监听器据此决定调用 pause 还是 resume） */
let _syncPaused = false;
/** 触发同步弹窗的元素（关闭后恢复焦点） */
let _syncProgressTrigger = null;
/** ESC 键监听器引用（仅在完成状态下注册） */
let _syncProgressEscHandler = null;
/** 内部：根据暂停状态更新按钮文本/样式/aria-label */
function _setSyncPausedState(paused) {
    _syncPaused = paused;
    const pauseBtn = _syncProgressDialog?.querySelector('#bgmSyncProgressPauseBtn');
    if (!pauseBtn)
        return;
    pauseBtn.textContent = paused ? '▶️ 继续' : '⏸️ 暂停';
    pauseBtn.setAttribute('aria-label', paused ? '继续同步' : '暂停同步');
    if (paused) {
        pauseBtn.classList.remove('bgm-btn-default');
        pauseBtn.classList.add('bgm-btn-success');
    }
    else {
        pauseBtn.classList.add('bgm-btn-default');
        pauseBtn.classList.remove('bgm-btn-success');
    }
}
/** 内部：清理所有回调与状态（complete/hide 时调用） */
function _clearSyncProgressHandlers() {
    _syncPauseHandler = null;
    _syncResumeHandler = null;
    _syncStopHandler = null;
    _syncPaused = false;
    // 移除 ESC 监听器，避免泄漏
    if (_syncProgressEscHandler) {
        document.removeEventListener('keydown', _syncProgressEscHandler);
        _syncProgressEscHandler = null;
    }
}
function ensureSyncProgressDialog() {
    if (_syncProgressDialog)
        return _syncProgressDialog;
    const modal = document.createElement('div');
    modal.id = 'bgmSyncProgressDialog';
    modal.className = 'bgm-modal';
    modal.style.display = 'none';
    // 可访问性：声明对话框角色
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'bgmSyncProgressTitle');
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="bgm-modal-content bgm-sync-progress__content">
            <div class="bgm-dialog-header bgm-sync-progress__header" id="bgmSyncProgressHeader">
                <span class="bgm-dialog-icon" id="bgmSyncProgressIcon">🔄</span>
                <span class="bgm-dialog-title" id="bgmSyncProgressTitle">正在同步...</span>
            </div>
            <div class="bgm-dialog-body bgm-sync-progress__body">
                <!-- 进度区 -->
                <div id="bgmSyncProgressSection">
                    <div class="bgm-sync-progress__meta">
                        <span id="bgmSyncProgressLabel">进度: 0/0</span>
                        <span id="bgmSyncProgressPercent">0%</span>
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
                    <button id="bgmSyncProgressClose" type="button" class="bgm-btn bgm-btn-success" aria-label="关闭弹窗">确定</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    // 绑定按钮事件：统一使用 addEventListener，禁止 onclick 重绑定
    const pauseBtn = modal.querySelector('#bgmSyncProgressPauseBtn');
    const stopBtn = modal.querySelector('#bgmSyncProgressStop');
    const closeBtn = modal.querySelector('#bgmSyncProgressClose');
    const toggleDetailsBtn = modal.querySelector('#bgmSyncProgressToggleDetails');
    // 暂停/继续按钮：根据 _syncPaused 标志自行决定调用哪个处理器，并自行更新按钮文本
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            if (!_syncProgressDialog || _syncProgressDialog.style.display === 'none')
                return;
            if (_syncPaused) {
                _syncResumeHandler?.();
                _setSyncPausedState(false);
            }
            else {
                _syncPauseHandler?.();
                _setSyncPausedState(true);
            }
        });
    }
    // 停止按钮
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (!_syncProgressDialog || _syncProgressDialog.style.display === 'none')
                return;
            _syncStopHandler?.();
        });
    }
    // 关闭按钮
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            hideSyncProgressDialog();
        });
    }
    // 详情切换按钮
    if (toggleDetailsBtn) {
        toggleDetailsBtn.addEventListener('click', () => {
            const detailsEl = modal.querySelector('#bgmSyncProgressDetails');
            if (!detailsEl)
                return;
            const expanded = detailsEl.style.display !== 'none';
            detailsEl.style.display = expanded ? 'none' : 'block';
            toggleDetailsBtn.textContent = expanded ? '显示详情' : '收起详情';
            toggleDetailsBtn.setAttribute('aria-label', expanded ? '显示详情' : '收起详情');
        });
    }
    _syncProgressDialog = modal;
    return modal;
}
/**
 * 显示同步进度弹窗（运行中状态）
 * @param title 弹窗标题（如"正在同步 - 选中行同步"）
 * @param handlers 暂停/恢复/停止回调集合
 */
export function showSyncProgressDialog(title, handlers) {
    const modal = ensureSyncProgressDialog();
    // 保存触发元素，用于关闭后恢复焦点
    _syncProgressTrigger = document.activeElement;
    // 重置回调与状态（必须在重置 UI 前完成，避免上次同步残留）
    _clearSyncProgressHandlers();
    _syncPauseHandler = handlers.onPause;
    _syncResumeHandler = handlers.onResume;
    _syncStopHandler = handlers.onStop;
    _syncPaused = false;
    _syncProgressLogCount = 0;
    // 重置为运行中状态
    const titleEl = modal.querySelector('#bgmSyncProgressTitle');
    const iconEl = modal.querySelector('#bgmSyncProgressIcon');
    const progressSection = modal.querySelector('#bgmSyncProgressSection');
    const resultSection = modal.querySelector('#bgmSyncProgressResult');
    const runningBtns = modal.querySelector('#bgmSyncProgressRunningBtns');
    const doneBtns = modal.querySelector('#bgmSyncProgressDoneBtns');
    const pauseBtn = modal.querySelector('#bgmSyncProgressPauseBtn');
    if (titleEl)
        titleEl.textContent = title;
    if (iconEl)
        iconEl.textContent = '🔄';
    if (progressSection)
        progressSection.style.display = '';
    if (resultSection)
        resultSection.style.display = 'none';
    if (runningBtns)
        runningBtns.style.display = 'flex';
    if (doneBtns)
        doneBtns.style.display = 'none';
    // 重置暂停按钮（文本/样式/aria-label），避免上次同步残留的 resume 状态
    if (pauseBtn) {
        pauseBtn.textContent = '⏸️ 暂停';
        pauseBtn.setAttribute('aria-label', '暂停同步');
        pauseBtn.classList.remove('bgm-btn-success');
        pauseBtn.classList.add('bgm-btn-default');
    }
    // 重置进度
    const bar = modal.querySelector('#bgmSyncProgressBar');
    const label = modal.querySelector('#bgmSyncProgressLabel');
    const percent = modal.querySelector('#bgmSyncProgressPercent');
    const current = modal.querySelector('#bgmSyncProgressCurrent');
    const log = modal.querySelector('#bgmSyncProgressLog');
    if (bar) {
        bar.style.width = '0%';
        bar.textContent = '';
        bar.setAttribute('aria-valuenow', '0');
    }
    if (label)
        label.textContent = '进度: 0/0';
    if (percent)
        percent.textContent = '0%';
    if (current)
        current.textContent = '';
    if (log)
        log.textContent = '';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    // 焦点管理：将焦点移至暂停按钮，便于键盘操作
    pauseBtn?.focus();
}
/**
 * 更新进度条
 * @param current 当前完成数
 * @param total 总数
 * @param message 当前任务描述（显示在进度条下方）
 * @param logLine 可选的实时日志行（追加到日志区）
 */
export function updateSyncProgressDialog(current, total, message, logLine) {
    const modal = _syncProgressDialog;
    // 弹窗未显示时快速返回，避免无效 DOM 写入
    if (!modal || modal.style.display === 'none')
        return;
    const bar = modal.querySelector('#bgmSyncProgressBar');
    const label = modal.querySelector('#bgmSyncProgressLabel');
    const percent = modal.querySelector('#bgmSyncProgressPercent');
    const currentEl = modal.querySelector('#bgmSyncProgressCurrent');
    const log = modal.querySelector('#bgmSyncProgressLog');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    if (bar) {
        bar.style.width = pct + '%';
        bar.textContent = pct + '%';
        bar.setAttribute('aria-valuenow', String(pct));
    }
    if (label)
        label.textContent = `进度: ${current}/${total}`;
    if (percent)
        percent.textContent = pct + '%';
    if (currentEl && message)
        currentEl.textContent = message;
    if (logLine && log) {
        // 智能滚动：仅当用户已接近底部时才自动滚动，避免打断阅读
        const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
        log.appendChild(document.createTextNode(logLine + '\n'));
        _syncProgressLogCount++;
        // 限制日志条数，避免过多 DOM 节点
        while (_syncProgressLogCount > _SYNC_PROGRESS_LOG_MAX) {
            if (log.firstChild) {
                log.removeChild(log.firstChild);
                _syncProgressLogCount--;
            }
            else {
                break;
            }
        }
        if (nearBottom) {
            log.scrollTop = log.scrollHeight;
        }
    }
}
/**
 * 切换弹窗为完成状态，显示统计结果
 * @param summary 统计摘要文本
 * @param details 详情数组
 * @param stopped 是否被用户停止
 */
export function completeSyncProgressDialog(summary, details, stopped = false) {
    const modal = ensureSyncProgressDialog();
    const titleEl = modal.querySelector('#bgmSyncProgressTitle');
    const iconEl = modal.querySelector('#bgmSyncProgressIcon');
    const progressSection = modal.querySelector('#bgmSyncProgressSection');
    const resultSection = modal.querySelector('#bgmSyncProgressResult');
    const summaryEl = modal.querySelector('#bgmSyncProgressSummary');
    const detailsEl = modal.querySelector('#bgmSyncProgressDetails');
    const toggleBtn = modal.querySelector('#bgmSyncProgressToggleDetails');
    const runningBtns = modal.querySelector('#bgmSyncProgressRunningBtns');
    const doneBtns = modal.querySelector('#bgmSyncProgressDoneBtns');
    if (titleEl)
        titleEl.textContent = stopped ? '同步已停止' : '同步完成';
    if (iconEl)
        iconEl.textContent = stopped ? '⏹️' : '✅';
    if (progressSection)
        progressSection.style.display = 'none';
    if (resultSection)
        resultSection.style.display = '';
    if (runningBtns)
        runningBtns.style.display = 'none';
    if (doneBtns)
        doneBtns.style.display = 'flex';
    if (summaryEl)
        summaryEl.textContent = summary;
    if (detailsEl) {
        detailsEl.textContent = details.length > 0 ? details.join('\n') : '无详情';
        detailsEl.style.display = 'none';
    }
    if (toggleBtn) {
        toggleBtn.textContent = '显示详情';
        toggleBtn.setAttribute('aria-label', '显示详情');
        toggleBtn.style.display = details.length > 0 ? '' : 'none';
    }
    // 清理运行态回调（保留弹窗可见，供用户查看结果）
    _clearSyncProgressHandlers();
    // 完成状态下支持 ESC 关闭
    _syncProgressEscHandler = (e) => {
        if (e.key === 'Escape') {
            hideSyncProgressDialog();
        }
    };
    document.addEventListener('keydown', _syncProgressEscHandler);
    // 焦点切换到关闭按钮，便于键盘用户立即操作
    const closeBtn = modal.querySelector('#bgmSyncProgressClose');
    closeBtn?.focus();
}
/** 隐藏同步进度弹窗 */
export function hideSyncProgressDialog() {
    const modal = _syncProgressDialog;
    if (!modal)
        return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    _clearSyncProgressHandlers();
    // 焦点返回到触发元素
    _syncProgressTrigger?.focus();
    _syncProgressTrigger = null;
}
// ========== 公共 API ==========
export function showAlert(message, title, onOk) {
    _showDialog('alert', { message, title: title || '提示', onOk });
}
/*
 * 显示确认对话框（新签名）
 * @param message  提示内容
 * @param callback 回调函数，参数 confirmed 为 true 表示用户点击了确定
 * @param title    可选标题
 */
export function showConfirm(message, callback, title) {
    _showDialog('confirm', {
        message,
        title: title || '确认',
        onOk: () => callback(true),
        onCancel: () => callback(false),
    });
}
export function showError(message, title, onOk) {
    _showDialog('error', { message, title: title || '错误', onOk });
}
export function showWarning(message, title, onOk) {
    _showDialog('warning', { message, title: title || '警告', onOk });
}
export function showSuccess(message, title, onOk) {
    _showDialog('success', { message, title: title || '成功', onOk });
}
export function showInput(title, prompt, defaultValue, onOk, onCancel) {
    _showDialog('input', { title, message: prompt, onOk, onCancel, defaultValue });
}
// ========== Toast 通知 ==========
export function showToast(message, type) {
    const toast = dom.bgmToast;
    if (!toast)
        return;
    if (_toastTimer !== null) {
        clearTimeout(_toastTimer);
        _toastTimer = null;
    }
    toast.textContent = message;
    toast.className = 'bgm-toast bgm-toast-show';
    if (type)
        toast.classList.add('bgm-toast-' + type);
    _toastTimer = window.setTimeout(() => {
        toast.className = 'bgm-toast';
        _toastTimer = null;
    }, 3000);
}
