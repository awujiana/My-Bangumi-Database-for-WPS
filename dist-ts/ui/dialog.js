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
                opts.onConfirm?.();
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
            opts.onConfirm?.();
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
// ========== 公开 API ==========
export function showAlert(message, title, onOk) {
    _showDialog('alert', { message, title: title || '提示', onOk });
}
export function showConfirm(message, title, onOk, onCancel) {
    _showDialog('confirm', { message, title: title || '确认', onOk, onCancel });
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
