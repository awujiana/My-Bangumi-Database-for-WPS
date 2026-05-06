/**
 * UI 对话框模块（纯 UI 组件，无业务依赖）
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

// ========== 全局对话框容器 ==========
let dialogInitialized = false;

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

    // 通过 DOM API 创建对话框（避免 WPS WebView innerHTML 编码问题）
    function makeDialog(id, modalClass, iconClass, iconChar, titleId, titleText, bodyId, footerId, buttons) {
        const modal = document.createElement('div');
        modal.id = id;
        modal.className = 'bgm-modal';
        modal.style.display = 'none';
        const content = document.createElement('div');
        content.className = 'bgm-modal-content ' + modalClass;
        const header = document.createElement('div');
        header.className = 'bgm-dialog-header';
        const icon = document.createElement('span');
        icon.className = 'bgm-dialog-icon ' + iconClass;
        icon.innerHTML = iconChar;
        const title = document.createElement('span');
        title.id = titleId;
        title.className = 'bgm-dialog-title';
        title.textContent = titleText;
        header.appendChild(icon);
        header.appendChild(title);
        content.appendChild(header);
        const body = document.createElement('div');
        body.className = 'bgm-dialog-body';
        const msg = document.createElement('p');
        msg.id = bodyId;
        msg.className = 'bgm-dialog-message';
        body.appendChild(msg);
        content.appendChild(body);
        const footer = document.createElement('div');
        footer.className = 'bgm-dialog-footer';
        footer.id = footerId;
        buttons.forEach(function(btn) {
            const b = document.createElement('button');
            b.id = btn.id;
            b.className = 'bgm-btn ' + btn.cls;
            b.textContent = btn.text;
            footer.appendChild(b);
        });
        content.appendChild(footer);
        modal.appendChild(content);
        return modal;
    }

    // Alert
    container.appendChild(makeDialog('bgmAlertDialog', 'bgm-alert-content', 'bgm-icon-info', '&#9432;', 'bgmAlertTitle', '\u63D0\u793A', 'bgmAlertMessage', null, [
        { id: 'bgmAlertOk', cls: 'bgm-btn-primary', text: '\u786E\u5B9A' }
    ]));
    // Confirm
    container.appendChild(makeDialog('bgmConfirmDialog', 'bgm-confirm-content', 'bgm-icon-question', '&#63;', 'bgmConfirmTitle', '\u786E\u8BA4', 'bgmConfirmMessage', null, [
        { id: 'bgmConfirmCancel', cls: 'bgm-btn-default', text: '\u53D6\u6D88' },
        { id: 'bgmConfirmOk', cls: 'bgm-btn-primary', text: '\u786E\u5B9A' }
    ]));
    // Error
    container.appendChild(makeDialog('bgmErrorDialog', 'bgm-error-content', 'bgm-icon-error', '&#10006;', 'bgmErrorTitle', '\u9519\u8BEF', 'bgmErrorMessage', null, [
        { id: 'bgmErrorOk', cls: 'bgm-btn-danger', text: '\u786E\u5B9A' }
    ]));
    // Warning
    container.appendChild(makeDialog('bgmWarningDialog', 'bgm-warning-content', 'bgm-icon-warning', '&#9888;', 'bgmWarningTitle', '\u8B66\u544A', 'bgmWarningMessage', null, [
        { id: 'bgmWarningOk', cls: 'bgm-btn-warning', text: '\u786E\u5B9A' }
    ]));
    // Success
    container.appendChild(makeDialog('bgmSuccessDialog', 'bgm-success-content', 'bgm-icon-success', '&#10004;', 'bgmSuccessTitle', '\u6210\u529F', 'bgmSuccessMessage', null, [
        { id: 'bgmSuccessOk', cls: 'bgm-btn-success', text: '\u786E\u5B9A' }
    ]));
    // Input
    container.appendChild(makeDialog('bgmInputDialog', 'bgm-input-content', 'bgm-icon-info', '&#9432;', 'bgmInputTitle', '\u8F93\u5165', 'bgmInputPrompt', null, [
        { id: 'bgmInputCancel', cls: 'bgm-btn-default', text: '\u53D6\u6D88' },
        { id: 'bgmInputOk', cls: 'bgm-btn-primary', text: '\u786E\u5B9A' }
    ]));
    // 为 Input 对话框添加输入框
    const inputBody = document.querySelector('#bgmInputDialog .bgm-dialog-body');
    const inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.id = 'bgmInputField';
    inputField.className = 'bgm-input-field';
    inputField.placeholder = '';
    inputBody.appendChild(inputField);
    // Toast
    const toast = document.createElement('div');
    toast.id = 'bgmToast';
    toast.className = 'bgm-toast';
    container.appendChild(toast);

    bindDialogEvents();
}

function bindDialogEvents() {
    document.getElementById('bgmAlertOk')?.addEventListener('click', () => {
        document.getElementById('bgmAlertDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    document.getElementById('bgmConfirmOk')?.addEventListener('click', () => {
        document.getElementById('bgmConfirmDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    document.getElementById('bgmConfirmCancel')?.addEventListener('click', () => {
        document.getElementById('bgmConfirmDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onCancel) window._bgmDialogCallback.onCancel();
    });
    
    document.getElementById('bgmErrorOk')?.addEventListener('click', () => {
        document.getElementById('bgmErrorDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    document.getElementById('bgmWarningOk')?.addEventListener('click', () => {
        document.getElementById('bgmWarningDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    document.getElementById('bgmSuccessOk')?.addEventListener('click', () => {
        document.getElementById('bgmSuccessDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    document.getElementById('bgmInputOk')?.addEventListener('click', () => {
        const value = document.getElementById('bgmInputField')?.value?.trim();
        document.getElementById('bgmInputDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk(value);
    });
    document.getElementById('bgmInputCancel')?.addEventListener('click', () => {
        document.getElementById('bgmInputDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onCancel) window._bgmDialogCallback.onCancel();
    });
    
    document.getElementById('bgmInputField')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('bgmInputOk')?.click();
        }
    });
}

// ========== 对话框显示函数 ==========

/**
 * 显示 Alert 对话框
 * @param {string} message - 提示内容
 * @param {string} [title] - 标题
 * @param {Function} [onOk] - 确定回调
 */
export function showAlert(message, title, onOk) {
    const dialog = document.getElementById('bgmAlertDialog');
    if (!dialog) {
        window.alert(message);
        return;
    }
    
    document.getElementById('bgmAlertTitle').textContent = title || '\u63D0\u793A';
    document.getElementById('bgmAlertMessage').textContent = message;
    window._bgmDialogCallback = { onOk };
    dialog.style.display = 'flex';
}

/**
 * 显示 Confirm 确认对话框
 * @param {string} message - 确认内容
 * @param {string} [title] - 标题
 * @param {Function} [onOk] - 确定回调
 * @param {Function} [onCancel] - 取消回调
 */
export function showConfirm(message, title, onOk, onCancel) {
    const dialog = document.getElementById('bgmConfirmDialog');
    if (!dialog) {
        if (window.confirm(message)) {
            if (onOk) onOk();
        } else {
            if (onCancel) onCancel();
        }
        return;
    }
    
    document.getElementById('bgmConfirmTitle').textContent = title || '\u786E\u8BA4';
    document.getElementById('bgmConfirmMessage').textContent = message;
    window._bgmDialogCallback = { onOk, onCancel };
    dialog.style.display = 'flex';
}

/**
 * 显示 Error 错误对话框
 */
export function showError(message, title, onOk) {
    const dialog = document.getElementById('bgmErrorDialog');
    if (!dialog) {
        window.alert('[\u9519\u8BEF] ' + message);
        return;
    }
    
    document.getElementById('bgmErrorTitle').textContent = title || '\u9519\u8BEF';
    document.getElementById('bgmErrorMessage').textContent = message;
    window._bgmDialogCallback = { onOk };
    dialog.style.display = 'flex';
}

/**
 * 显示 Warning 警告对话框
 */
export function showWarning(message, title, onOk) {
    const dialog = document.getElementById('bgmWarningDialog');
    if (!dialog) {
        window.alert('[\u8B66\u544A] ' + message);
        return;
    }
    
    document.getElementById('bgmWarningTitle').textContent = title || '\u8B66\u544A';
    document.getElementById('bgmWarningMessage').textContent = message;
    window._bgmDialogCallback = { onOk };
    dialog.style.display = 'flex';
}

/**
 * 显示 Success 成功对话框
 */
export function showSuccess(message, title, onOk) {
    const dialog = document.getElementById('bgmSuccessDialog');
    if (!dialog) {
        window.alert('[\u6210\u529F] ' + message);
        return;
    }
    
    document.getElementById('bgmSuccessTitle').textContent = title || '\u6210\u529F';
    document.getElementById('bgmSuccessMessage').textContent = message;
    window._bgmDialogCallback = { onOk };
    dialog.style.display = 'flex';
}

/**
 * 显示 Input 输入对话框
 * @param {string} title - 标题
 * @param {string} prompt - 提示文本
 * @param {string} defaultValue - 默认值
 * @param {Function} onOk - 确定回调（参数为输入值）
 * @param {Function} [onCancel] - 取消回调
 */
export function showInput(title, prompt, defaultValue, onOk, onCancel) {
    ensureDialogs();
    const dialog = document.getElementById('bgmInputDialog');
    if (!dialog) {
        const result = window.prompt(prompt, defaultValue);
        if (result !== null) {
            if (onOk) onOk(result);
        } else {
            if (onCancel) onCancel();
        }
        return;
    }
    
    document.getElementById('bgmInputTitle').textContent = title || '\u8F93\u5165';
    document.getElementById('bgmInputPrompt').textContent = prompt || '';
    const inputField = document.getElementById('bgmInputField');
    inputField.value = defaultValue || '';
    inputField.placeholder = '';
    window._bgmDialogCallback = { onOk, onCancel };
    dialog.style.display = 'flex';
    inputField.focus();
}

// ========== 兼容快捷函数 ==========

/** 显示输入对话框（旧接口） */
export function showInputDialog(title, placeholder, onSubmit) {
    showInput(title, placeholder, '', onSubmit);
}

/** 关闭输入对话框 */
export function closeInputDialog() {
    const dialog = document.getElementById('bgmInputDialog');
    if (dialog) dialog.style.display = 'none';
}

/** 显示确认对话框（旧接口） */
export function showConfirmDialog(message, onConfirm) {
    showConfirm(message, '\u786E\u8BA4', onConfirm);
}

/** 关闭确认对话框 */
export function closeConfirmDialog() {
    const dialog = document.getElementById('bgmConfirmDialog');
    if (dialog) dialog.style.display = 'none';
}

/** 关闭所有对话框（兼容 HTML onclick） */
export function closeDialog(result) {
    var dialogs = ['inputDialog', 'confirmDialog', 'alertDialog'];
    for (var i = 0; i < dialogs.length; i++) {
        var d = document.getElementById(dialogs[i]);
        if (d) { d.style.display = 'none'; }
    }
    if (window._dialogCallback) {
        window._dialogCallback(result);
        window._dialogCallback = null;
    }
}

/** 关闭提示对话框 */
export function closeAlertDialog() {
    const dialog = document.getElementById('bgmAlertDialog');
    if (dialog) dialog.style.display = 'none';
    const oldDialog = document.getElementById('alertDialog');
    if (oldDialog) oldDialog.style.display = 'none';
}

/** 通用对话框（兼容旧接口） */
export function showDialog(title, message) {
    showAlert(message, title);
}

// ========== Toast 通知 ==========

/**
 * 显示 Toast 通知
 * @param {string} message - 通知内容
 * @param {string} [type] - 类型：success/error/warning/info
 */
export function showToast(message, type) {
    const toast = document.getElementById('bgmToast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = 'bgm-toast bgm-toast-show';
    if (type) {
        toast.classList.add('bgm-toast-' + type);
    }
    
    setTimeout(() => {
        toast.className = 'bgm-toast';
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
try { window.alert = showAlert; } catch(e) { /* alert 是只读属性，忽略 */ }
