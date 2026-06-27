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
const _SYNC_PROGRESS_LOG_MAX = 200;
/** 暂停/恢复/停止按钮回调 */
let _syncPauseHandler = null;
let _syncResumeHandler = null;
let _syncStopHandler = null;
function ensureSyncProgressDialog() {
    if (_syncProgressDialog)
        return _syncProgressDialog;
    const modal = document.createElement('div');
    modal.id = 'bgmSyncProgressDialog';
    modal.className = 'bgm-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="bgm-modal-content" style="max-width: 640px;">
            <div class="bgm-dialog-header" id="bgmSyncProgressHeader">
                <span class="bgm-dialog-icon" id="bgmSyncProgressIcon">🔄</span>
                <span class="bgm-dialog-title" id="bgmSyncProgressTitle">正在同步...</span>
            </div>
            <div class="bgm-dialog-body" style="max-height: 60vh; overflow-y: auto;">
                <!-- 进度区 -->
                <div id="bgmSyncProgressSection">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                        <span id="bgmSyncProgressLabel">进度: 0/0</span>
                        <span id="bgmSyncProgressPercent">0%</span>
                    </div>
                    <div style="background: #444; border-radius: 4px; height: 20px; overflow: hidden;">
                        <div id="bgmSyncProgressBar" style="width: 0%; height: 100%; background: #27ae60; text-align: center; line-height: 20px; color: white; font-size: 12px; transition: width 0.3s;"></div>
                    </div>
                    <div id="bgmSyncProgressCurrent" style="margin-top: 8px; font-size: 12px; color: #aaa; min-height: 18px;"></div>
                    <div style="margin-top: 8px;">
                        <div style="font-size: 12px; color: #888; margin-bottom: 4px;">实时日志:</div>
                        <div id="bgmSyncProgressLog" style="max-height: 180px; overflow-y: auto; font-size: 11px; line-height: 1.5; font-family: monospace; background: #1e1e1e; padding: 6px 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-all;"></div>
                    </div>
                </div>
                <!-- 完成结果区（默认隐藏） -->
                <div id="bgmSyncProgressResult" style="display: none;">
                    <div id="bgmSyncProgressSummary" class="bgm-dialog-message" style="white-space: pre-line;"></div>
                    <div id="bgmSyncProgressDetails" style="display:none; margin-top: 8px; max-height: 240px; overflow-y: auto; font-size: 12px; line-height: 1.6; white-space: pre; font-family: monospace;"></div>
                </div>
            </div>
            <div class="bgm-dialog-footer" id="bgmSyncProgressFooter">
                <!-- 运行中按钮 -->
                <div id="bgmSyncProgressRunningBtns" style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="bgmSyncProgressPause" class="bgm-btn bgm-btn-default">⏸️ 暂停</button>
                    <button id="bgmSyncProgressStop" class="bgm-btn bgm-btn-danger">⏹️ 停止</button>
                </div>
                <!-- 完成按钮（默认隐藏） -->
                <div id="bgmSyncProgressDoneBtns" style="display: none; gap: 8px; justify-content: flex-end;">
                    <button id="bgmSyncProgressToggleDetails" class="bgm-btn bgm-btn-default">显示详情</button>
                    <button id="bgmSyncProgressClose" class="bgm-btn bgm-btn-success">确定</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    // 绑定按钮事件
    const pauseBtn = modal.querySelector('#bgmSyncProgressPause');
    const stopBtn = modal.querySelector('#bgmSyncProgressStop');
    const closeBtn = modal.querySelector('#bgmSyncProgressClose');
    const toggleDetailsBtn = modal.querySelector('#bgmSyncProgressToggleDetails');
    pauseBtn.addEventListener('click', () => {
        if (_syncPauseHandler)
            _syncPauseHandler();
    });
    stopBtn.addEventListener('click', () => {
        if (_syncStopHandler)
            _syncStopHandler();
    });
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    toggleDetailsBtn.addEventListener('click', () => {
        const detailsEl = modal.querySelector('#bgmSyncProgressDetails');
        const expanded = detailsEl.style.display !== 'none';
        detailsEl.style.display = expanded ? 'none' : 'block';
        toggleDetailsBtn.textContent = expanded ? '显示详情' : '收起详情';
    });
    _syncProgressDialog = modal;
    return modal;
}
/**
 * 显示同步进度弹窗（运行中状态）
 * @param title 弹窗标题（如"正在同步 - 选中行同步"）
 * @param onPause 暂停回调
 * @param onResume 恢复回调
 * @param onStop 停止回调
 */
export function showSyncProgressDialog(title, onPause, onResume, onStop) {
    const modal = ensureSyncProgressDialog();
    _syncPauseHandler = onPause || null;
    _syncResumeHandler = onResume || null;
    _syncStopHandler = onStop || null;
    // 重置为运行中状态
    const titleEl = modal.querySelector('#bgmSyncProgressTitle');
    const iconEl = modal.querySelector('#bgmSyncProgressIcon');
    const progressSection = modal.querySelector('#bgmSyncProgressSection');
    const resultSection = modal.querySelector('#bgmSyncProgressResult');
    const runningBtns = modal.querySelector('#bgmSyncProgressRunningBtns');
    const doneBtns = modal.querySelector('#bgmSyncProgressDoneBtns');
    const pauseBtn = modal.querySelector('#bgmSyncProgressPause');
    titleEl.textContent = title;
    iconEl.textContent = '🔄';
    progressSection.style.display = '';
    resultSection.style.display = 'none';
    runningBtns.style.display = 'flex';
    doneBtns.style.display = 'none';
    pauseBtn.textContent = '⏸️ 暂停';
    pauseBtn.classList.remove('bgm-btn-success');
    pauseBtn.classList.add('bgm-btn-default');
    // 重置进度
    const bar = modal.querySelector('#bgmSyncProgressBar');
    const label = modal.querySelector('#bgmSyncProgressLabel');
    const percent = modal.querySelector('#bgmSyncProgressPercent');
    const current = modal.querySelector('#bgmSyncProgressCurrent');
    const log = modal.querySelector('#bgmSyncProgressLog');
    if (bar) {
        bar.style.width = '0%';
        bar.textContent = '';
    }
    if (label)
        label.textContent = '进度: 0/0';
    if (percent)
        percent.textContent = '0%';
    if (current)
        current.textContent = '';
    if (log)
        log.textContent = '';
    _syncProgressLogCount = 0;
    modal.style.display = 'flex';
}
/**
 * 更新进度条
 * @param current 当前完成数
 * @param total 总数
 * @param message 当前任务描述（显示在进度条下方）
 * @param logLine 可选的实时日志行（追加到日志区）
 */
export function updateSyncProgressDialog(current, total, message, logLine) {
    const modal = ensureSyncProgressDialog();
    const bar = modal.querySelector('#bgmSyncProgressBar');
    const label = modal.querySelector('#bgmSyncProgressLabel');
    const percent = modal.querySelector('#bgmSyncProgressPercent');
    const currentEl = modal.querySelector('#bgmSyncProgressCurrent');
    const log = modal.querySelector('#bgmSyncProgressLog');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    if (bar) {
        bar.style.width = pct + '%';
        bar.textContent = pct + '%';
    }
    if (label)
        label.textContent = `进度: ${current}/${total}`;
    if (percent)
        percent.textContent = pct + '%';
    if (currentEl && message)
        currentEl.textContent = message;
    if (logLine && log) {
        _syncProgressLogCount++;
        const line = `${logLine}\n`;
        log.appendChild(document.createTextNode(line));
        // 限制日志条数，避免过多 DOM 节点
        if (_syncProgressLogCount > _SYNC_PROGRESS_LOG_MAX && log.firstChild) {
            log.removeChild(log.firstChild);
            _syncProgressLogCount--;
        }
        // 自动滚动到底部
        log.scrollTop = log.scrollHeight;
    }
}
/** 切换暂停按钮为"继续"或"暂停" */
export function setSyncProgressPaused(paused) {
    const modal = ensureSyncProgressDialog();
    const pauseBtn = modal.querySelector('#bgmSyncProgressPause');
    if (!pauseBtn)
        return;
    if (paused) {
        pauseBtn.textContent = '▶️ 继续';
        pauseBtn.classList.remove('bgm-btn-default');
        pauseBtn.classList.add('bgm-btn-success');
        // 暂停时触发 resume 处理器
        pauseBtn.onclick = () => {
            if (_syncResumeHandler)
                _syncResumeHandler();
        };
    }
    else {
        pauseBtn.textContent = '⏸️ 暂停';
        pauseBtn.classList.add('bgm-btn-default');
        pauseBtn.classList.remove('bgm-btn-success');
        pauseBtn.onclick = () => {
            if (_syncPauseHandler)
                _syncPauseHandler();
        };
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
    titleEl.textContent = stopped ? '同步已停止' : '同步完成';
    iconEl.textContent = stopped ? '⏹️' : '✅';
    progressSection.style.display = 'none';
    resultSection.style.display = '';
    runningBtns.style.display = 'none';
    doneBtns.style.display = 'flex';
    summaryEl.textContent = summary;
    detailsEl.textContent = details.length > 0 ? details.join('\n') : '无详情';
    detailsEl.style.display = 'none';
    toggleBtn.textContent = '显示详情';
    toggleBtn.style.display = details.length > 0 ? '' : 'none';
}
/** 隐藏同步进度弹窗 */
export function hideSyncProgressDialog() {
    const modal = ensureSyncProgressDialog();
    modal.style.display = 'none';
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
//# sourceMappingURL=dialog.js.map