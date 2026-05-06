/**
 * UI 对话框模块（优化版）
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

// ========== 常量与配置 ==========
const DIALOG_TYPES = {
    alert:    { id: 'bgmAlertDialog',    titleId: 'bgmAlertTitle',    msgId: 'bgmAlertMessage',    buttons: [{ id: 'bgmAlertOk',    cls: 'bgm-btn-primary', text: '确定', event: 'ok' }] },
    confirm:  { id: 'bgmConfirmDialog',  titleId: 'bgmConfirmTitle',  msgId: 'bgmConfirmMessage',  buttons: [{ id: 'bgmConfirmOk',   cls: 'bgm-btn-primary', text: '确定', event: 'ok' }, { id: 'bgmConfirmCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' }] },
    error:    { id: 'bgmErrorDialog',    titleId: 'bgmErrorTitle',    msgId: 'bgmErrorMessage',    buttons: [{ id: 'bgmErrorOk',    cls: 'bgm-btn-danger',  text: '确定', event: 'ok' }] },
    warning:  { id: 'bgmWarningDialog',  titleId: 'bgmWarningTitle',  msgId: 'bgmWarningMessage',  buttons: [{ id: 'bgmWarningOk',  cls: 'bgm-btn-warning', text: '确定', event: 'ok' }] },
    success:  { id: 'bgmSuccessDialog',  titleId: 'bgmSuccessTitle',  msgId: 'bgmSuccessMessage',  buttons: [{ id: 'bgmSuccessOk',  cls: 'bgm-btn-success', text: '确定', event: 'ok' }] },
    input:    { id: 'bgmInputDialog',    titleId: 'bgmInputTitle',    msgId: 'bgmInputPrompt',     buttons: [{ id: 'bgmInputOk',     cls: 'bgm-btn-primary', text: '确定', event: 'ok' }, { id: 'bgmInputCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' }] }
};

// ========== 模块内部状态 ==========
let dialogInitialized = false;
let _dialogCallback = null;        // 当前激活对话框的回调函数
let _toastTimer = null;           // Toast 定时器 ID

// 缓存 DOM 引用（初始化后填充）
const dom = {};

// ========== 初始化 ==========
function ensureDialogs() {
    if (dialogInitialized) return;
    dialogInitialized = true;
    createDialogs();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureDialogs);
    } else {
        setTimeout(ensureDialogs, 0);
    }
}

function createDialogs() {
    if (document.getElementById('bgmDialogContainer')) return;

    const container = document.createElement('div');
    container.id = 'bgmDialogContainer';
    document.body.appendChild(container);

    // 通用对话框创建函数
    function createDialogElement(type, iconClass, iconChar, defaultTitle) {
        const cfg = DIALOG_TYPES[type];
        const modal = document.createElement('div');
        modal.id = cfg.id;
        modal.className = 'bgm-modal';
        modal.style.display = 'none';

        const content = document.createElement('div');
        content.className = 'bgm-modal-content ' + type;

        // Header
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

        // Body
        const body = document.createElement('div');
        body.className = 'bgm-dialog-body';
        const msg = document.createElement('p');
        msg.id = cfg.msgId;
        msg.className = 'bgm-dialog-message';
        body.appendChild(msg);
        content.appendChild(body);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'bgm-dialog-footer';
        cfg.buttons.forEach(btn => {
            const button = document.createElement('button');
            button.id = btn.id;
            button.className = 'bgm-btn ' + btn.cls;
            button.textContent = btn.text;
            button.dataset.event = btn.event;   // 标记事件类型
            footer.appendChild(button);
        });
        content.appendChild(footer);
        modal.appendChild(content);
        return modal;
    }

    // 创建各种对话框
    container.appendChild(createDialogElement('alert', 'bgm-icon-info', '&#9432;', '提示'));
    container.appendChild(createDialogElement('confirm', 'bgm-icon-question', '&#63;', '确认'));
    container.appendChild(createDialogElement('error', 'bgm-icon-error', '&#10006;', '错误'));
    container.appendChild(createDialogElement('warning', 'bgm-icon-warning', '&#9888;', '警告'));
    container.appendChild(createDialogElement('success', 'bgm-icon-success', '&#10004;', '成功'));
    container.appendChild(createDialogElement('input', 'bgm-icon-info', '&#9432;', '输入'));

    // 为 Input 对话框添加输入框
    const inputBody = document.querySelector('#bgmInputDialog .bgm-dialog-body');
    const inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.id = 'bgmInputField';
    inputField.className = 'bgm-input-field';
    inputBody.appendChild(inputField);

    // Toast 容器
    const toast = document.createElement('div');
    toast.id = 'bgmToast';
    toast.className = 'bgm-toast';
    container.appendChild(toast);

    // 绑定事件并缓存 DOM
    bindAllEvents();
}

function bindAllEvents() {
    // 缓存对话框元素
    for (const type in DIALOG_TYPES) {
        const cfg = DIALOG_TYPES[type];
        dom[cfg.id] = document.getElementById(cfg.id);
        dom[cfg.titleId] = document.getElementById(cfg.titleId);
        dom[cfg.msgId] = document.getElementById(cfg.msgId);
        cfg.buttons.forEach(btn => {
            dom[btn.id] = document.getElementById(btn.id);
        });
    }
    // Toast
    dom.bgmToast = document.getElementById('bgmToast');
    dom.bgmInputField = document.getElementById('bgmInputField');

    // 通用事件处理：使用事件委托，放在 bgmDialogContainer 上
    const container = document.getElementById('bgmDialogContainer');
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const eventType = btn.dataset.event;
        if (!eventType) return;

        const modal = btn.closest('.bgm-modal');
        if (!modal) return;

        // 关闭对话框
        modal.style.display = 'none';

        // 获取当前回调并调用
        if (_dialogCallback) {
            if (eventType === 'ok' && _dialogCallback.onOk) {
                if (modal.id === 'bgmInputDialog') {
                    const inputValue = dom.bgmInputField ? dom.bgmInputField.value.trim() : '';
                    _dialogCallback.onOk(inputValue);
                } else {
                    _dialogCallback.onOk();
                }
            } else if (eventType === 'cancel' && _dialogCallback.onCancel) {
                _dialogCallback.onCancel();
            }
            // 执行后清理回调
            _dialogCallback = null;
        }
    });

    // Input 框 Enter 键支持
    dom.bgmInputField?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            dom.bgmInputOk?.click();
        }
    });
}

/**
 * 通用对话框显示函数（内部使用）
 * @param {string} type - 对话框类型
 * @param {object} opts - { message, title, onOk, onCancel, defaultValue }
 */
function _showDialog(type, opts = {}) {
    const cfg = DIALOG_TYPES[type];
    const dialog = dom[cfg.id];
    if (!dialog) {
        // 回退到原生弹窗
        if (type === 'confirm') {
            if (window.confirm(opts.message)) {
                opts.onOk && opts.onOk();
            } else {
                opts.onCancel && opts.onCancel();
            }
        } else if (type === 'input') {
            const result = window.prompt(opts.prompt || '', opts.defaultValue || '');
            if (result !== null) {
                opts.onOk && opts.onOk(result);
            } else {
                opts.onCancel && opts.onCancel();
            }
        } else {
            window.alert(opts.message);
            opts.onOk && opts.onOk();
        }
        return;
    }

    // 设置标题与消息
    dom[cfg.titleId].textContent = opts.title || '';
    dom[cfg.msgId].textContent = opts.message || '';

    // 如果是输入框，设置默认值
    if (type === 'input') {
        dom.bgmInputField.value = opts.defaultValue || '';
        dom.bgmInputField.focus();
    }

    // 存储回调
    _dialogCallback = { onOk: opts.onOk, onCancel: opts.onCancel };

    dialog.style.display = 'flex';
}

// ========== 公开 API ==========

/** Alert 对话框 */
export function showAlert(message, title, onOk) {
    _showDialog('alert', { message, title: title || '提示', onOk });
}

/** Confirm 确认对话框 */
export function showConfirm(message, title, onOk, onCancel) {
    _showDialog('confirm', { message, title: title || '确认', onOk, onCancel });
}

/** Error 错误对话框 */
export function showError(message, title, onOk) {
    _showDialog('error', { message, title: title || '错误', onOk });
}

/** Warning 警告对话框 */
export function showWarning(message, title, onOk) {
    _showDialog('warning', { message, title: title || '警告', onOk });
}

/** Success 成功对话框 */
export function showSuccess(message, title, onOk) {
    _showDialog('success', { message, title: title || '成功', onOk });
}

/** Input 输入对话框 */
export function showInput(title, prompt, defaultValue, onOk, onCancel) {
    _showDialog('input', { title, message: prompt, onOk, onCancel, defaultValue });
}

// ========== 快捷兼容函数 ==========

export function showInputDialog(title, placeholder, onSubmit) {
    showInput(title, placeholder, '', onSubmit);
}

export function closeInputDialog() {
    const dialog = dom.bgmInputDialog;
    if (dialog) dialog.style.display = 'none';
}

export function showConfirmDialog(message, onConfirm) {
    showConfirm(message, '确认', onConfirm);
}

export function closeConfirmDialog() {
    const dialog = dom.bgmConfirmDialog;
    if (dialog) dialog.style.display = 'none';
}

/** 关闭所有对话框（兼容旧接口） */
export function closeDialog(result) {
    // 关闭所有模态框并调用可能遗留的回调
    for (const id in dom) {
        if (id.startsWith('bgm') && dom[id]?.classList?.contains('bgm-modal')) {
            dom[id].style.display = 'none';
        }
    }
    // 调用旧式回调（如果存在）
    if (window._dialogCallback) {
        window._dialogCallback(result);
        window._dialogCallback = null;
    }
}

export function closeAlertDialog() {
    const dialog = dom.bgmAlertDialog;
    if (dialog) dialog.style.display = 'none';
}

export function showDialog(title, message) {
    showAlert(message, title);
}

// ========== Toast 通知 ==========

export function showToast(message, type) {
    const toast = dom.bgmToast;
    if (!toast) return;

    // 清除之前的定时器（避免叠加）
    if (_toastTimer) {
        clearTimeout(_toastTimer);
        _toastTimer = null;
    }

    toast.textContent = message;
    toast.className = 'bgm-toast bgm-toast-show';
    if (type) {
        toast.classList.add('bgm-toast-' + type);
    }

    _toastTimer = setTimeout(() => {
        toast.className = 'bgm-toast';
        _toastTimer = null;
    }, 3000);
}

// ========== 挂载到 window（向后兼容）==========
window.showInputDialog = showInputDialog;
window.closeInputDialog = closeInputDialog;
window.showConfirmDialog = showConfirmDialog;
window.closeConfirmDialog = closeConfirmDialog;
window.closeDialog = closeDialog;
window.closeAlertDialog = closeAlertDialog;
window.showAlertDialog = showAlert;
window.showAlert = showAlert;
window.BGMAlert = showAlert;
window.BGMConfirm = showConfirm;
window.BGMError = showError;
window.BGMWarning = showWarning;
window.BGMSuccess = showSuccess;
window.BGMInput = showInput;
try { window.alert = showAlert; } catch(e) { /* alert 只读属性 */ }