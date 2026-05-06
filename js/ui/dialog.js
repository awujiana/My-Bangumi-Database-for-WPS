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
    container.innerHTML = `
        <!-- Alert 对话框 -->
        <div id="bgmAlertDialog" class="bgm-modal" style="display:none;">
            <div class="bgm-modal-content bgm-alert-content">
                <div class="bgm-dialog-header">
                    <span class="bgm-dialog-icon bgm-icon-info">&#9432;</span>
                    <span id="bgmAlertTitle" class="bgm-dialog-title">提示</span>
                </div>
                <div class="bgm-dialog-body">
                    <p id="bgmAlertMessage" class="bgm-dialog-message"></p>
                </div>
                <div class="bgm-dialog-footer">
                    <button id="bgmAlertOk" class="bgm-btn bgm-btn-primary">确定</button>
                </div>
            </div>
        </div>
        
        <!-- Confirm 对话框 -->
        <div id="bgmConfirmDialog" class="bgm-modal" style="display:none;">
            <div class="bgm-modal-content bgm-confirm-content">
                <div class="bgm-dialog-header">
                    <span class="bgm-dialog-icon bgm-icon-question">&#63;</span>
                    <span id="bgmConfirmTitle" class="bgm-dialog-title">确认</span>
                </div>
                <div class="bgm-dialog-body">
                    <p id="bgmConfirmMessage" class="bgm-dialog-message"></p>
                </div>
                <div class="bgm-dialog-footer">
                    <button id="bgmConfirmCancel" class="bgm-btn bgm-btn-default">取消</button>
                    <button id="bgmConfirmOk" class="bgm-btn bgm-btn-primary">确定</button>
                </div>
            </div>
        </div>
        
        <!-- Error 对话框 -->
        <div id="bgmErrorDialog" class="bgm-modal" style="display:none;">
            <div class="bgm-modal-content bgm-error-content">
                <div class="bgm-dialog-header">
                    <span class="bgm-dialog-icon bgm-icon-error">&#10006;</span>
                    <span id="bgmErrorTitle" class="bgm-dialog-title">错误</span>
                </div>
                <div class="bgm-dialog-body">
                    <p id="bgmErrorMessage" class="bgm-dialog-message"></p>
                </div>
                <div class="bgm-dialog-footer">
                    <button id="bgmErrorOk" class="bgm-btn bgm-btn-danger">确定</button>
                </div>
            </div>
        </div>
        
        <!-- Warning 对话框 -->
        <div id="bgmWarningDialog" class="bgm-modal" style="display:none;">
            <div class="bgm-modal-content bgm-warning-content">
                <div class="bgm-dialog-header">
                    <span class="bgm-dialog-icon bgm-icon-warning">&#9888;</span>
                    <span id="bgmWarningTitle" class="bgm-dialog-title">警告</span>
                </div>
                <div class="bgm-dialog-body">
                    <p id="bgmWarningMessage" class="bgm-dialog-message"></p>
                </div>
                <div class="bgm-dialog-footer">
                    <button id="bgmWarningOk" class="bgm-btn bgm-btn-warning">确定</button>
                </div>
            </div>
        </div>
        
        <!-- Success 对话框 -->
        <div id="bgmSuccessDialog" class="bgm-modal" style="display:none;">
            <div class="bgm-modal-content bgm-success-content">
                <div class="bgm-dialog-header">
                    <span class="bgm-dialog-icon bgm-icon-success">&#10004;</span>
                    <span id="bgmSuccessTitle" class="bgm-dialog-title">成功</span>
                </div>
                <div class="bgm-dialog-body">
                    <p id="bgmSuccessMessage" class="bgm-dialog-message"></p>
                </div>
                <div class="bgm-dialog-footer">
                    <button id="bgmSuccessOk" class="bgm-btn bgm-btn-success">确定</button>
                </div>
            </div>
        </div>
        
        <!-- Input 对话框 -->
        <div id="bgmInputDialog" class="bgm-modal" style="display:none;">
            <div class="bgm-modal-content bgm-input-content">
                <div class="bgm-dialog-header">
                    <span class="bgm-dialog-icon bgm-icon-info">&#9432;</span>
                    <span id="bgmInputTitle" class="bgm-dialog-title">输入</span>
                </div>
                <div class="bgm-dialog-body">
                    <p id="bgmInputPrompt" class="bgm-dialog-message"></p>
                    <input type="text" id="bgmInputField" class="bgm-input-field" placeholder="">
                </div>
                <div class="bgm-dialog-footer">
                    <button id="bgmInputCancel" class="bgm-btn bgm-btn-default">取消</button>
                    <button id="bgmInputOk" class="bgm-btn bgm-btn-primary">确定</button>
                </div>
            </div>
        </div>
        
        <!-- Toast 通知 -->
        <div id="bgmToast" class="bgm-toast"></div>
    `;
    document.body.appendChild(container);
    
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
    
    document.getElementById('bgmAlertTitle').textContent = title || '提示';
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
    
    document.getElementById('bgmConfirmTitle').textContent = title || '确认';
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
        window.alert('[错误] ' + message);
        return;
    }
    
    document.getElementById('bgmErrorTitle').textContent = title || '错误';
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
        window.alert('[警告] ' + message);
        return;
    }
    
    document.getElementById('bgmWarningTitle').textContent = title || '警告';
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
        window.alert('[成功] ' + message);
        return;
    }
    
    document.getElementById('bgmSuccessTitle').textContent = title || '成功';
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
    
    document.getElementById('bgmInputTitle').textContent = title || '输入';
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
    showConfirm(message, '确认', onConfirm);
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
