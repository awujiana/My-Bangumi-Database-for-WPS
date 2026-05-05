/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

import { loadBgToken } from '../util.js';
import { BGM } from '../util.js';

// ========== 全局对话框容器 ==========
// 在 WPS/Office 环境中，document.readyState 可能不是标准值
// 所以使用 setTimeout 确保对话框在 DOM 准备好后创建
let dialogInitialized = false;

function ensureDialogs() {
    if (dialogInitialized) return;
    dialogInitialized = true;
    createDialogs();
}

// 尝试在脚本加载时创建对话框
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureDialogs);
    } else {
        // 使用 setTimeout 确保 DOM 操作在下一个事件循环中执行
        setTimeout(ensureDialogs, 0);
    }
}

function createDialogs() {
    // 避免重复创建
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
    
    // 绑定事件
    bindDialogEvents();
}

function bindDialogEvents() {
    // Alert 确定按钮
    document.getElementById('bgmAlertOk')?.addEventListener('click', () => {
        document.getElementById('bgmAlertDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    // Confirm 按钮
    document.getElementById('bgmConfirmOk')?.addEventListener('click', () => {
        document.getElementById('bgmConfirmDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    document.getElementById('bgmConfirmCancel')?.addEventListener('click', () => {
        document.getElementById('bgmConfirmDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onCancel) window._bgmDialogCallback.onCancel();
    });
    
    // Error 确定按钮
    document.getElementById('bgmErrorOk')?.addEventListener('click', () => {
        document.getElementById('bgmErrorDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    // Warning 确定按钮
    document.getElementById('bgmWarningOk')?.addEventListener('click', () => {
        document.getElementById('bgmWarningDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    // Success 确定按钮
    document.getElementById('bgmSuccessOk')?.addEventListener('click', () => {
        document.getElementById('bgmSuccessDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk();
    });
    
    // Input 按钮
    document.getElementById('bgmInputOk')?.addEventListener('click', () => {
        const value = document.getElementById('bgmInputField')?.value?.trim();
        document.getElementById('bgmInputDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onOk) window._bgmDialogCallback.onOk(value);
    });
    document.getElementById('bgmInputCancel')?.addEventListener('click', () => {
        document.getElementById('bgmInputDialog').style.display = 'none';
        if (window._bgmDialogCallback?.onCancel) window._bgmDialogCallback.onCancel();
    });
    
    // 回车键确认 Input 对话框
    document.getElementById('bgmInputField')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('bgmInputOk')?.click();
        }
    });
}

// ========== 对话框显示函数 ==========

/**
 * 显示 Alert 对话框
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
 * 显示 Confirm 对话框
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
 * 显示 Error 对话框
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
 * 显示 Warning 对话框
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
 * 显示 Success 对话框
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
 */
export function showInput(title, prompt, defaultValue, onOk, onCancel) {
    ensureDialogs();  // 确保对话框容器已创建
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

// ========== 旧的对话框函数（保持兼容）==========

/**
 * 显示输入对话框
 */
export function showInputDialog(title, placeholder, onSubmit) {
    showInput(title, placeholder, '', onSubmit);
}

/**
 * 关闭输入对话框
 */
export function closeInputDialog() {
    const dialog = document.getElementById('bgmInputDialog');
    if (dialog) {
        dialog.style.display = 'none';
    }
}

/**
 * 显示确认对话框（兼容旧接口）
 */
export function showConfirmDialog(message, onConfirm) {
    showConfirm(message, '确认', onConfirm);
}

/**
 * 关闭确认对话框
 */
export function closeConfirmDialog() {
    const dialog = document.getElementById('bgmConfirmDialog');
    if (dialog) {
        dialog.style.display = 'none';
    }
}

// ========== Toast 通知 ==========
/**
 * 显示 Toast 通知
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

// ========== Token 状态更新 ==========
/**
 * 更新 Token 状态显示
 */
export function updateTokenStatus() {
    let tokenStatus = document.getElementById("tokenStatus");
    if (!tokenStatus) return;
    
    let token = loadBgToken();
    if (token && token.length > 10) {
        tokenStatus.style.color = "#4CAF50";
        tokenStatus.textContent = "已设置 (" + token.substring(0, 4) + "...)";
        
        if (typeof _fetchBgmUserInfo === 'function') {
            _fetchBgmUserInfo(function(userInfo) {
                if (userInfo && userInfo.username) {
                    tokenStatus.textContent = "已设置: " + userInfo.username;
                    if (typeof updateUserIdStatus === 'function') {
                        updateUserIdStatus();
                    }
                }
            });
        }
    } else {
        tokenStatus.textContent = "未设置";
        tokenStatus.style.color = "#f44336";
        BGM.cache.userId = null;
        BGM.cache.username = null;
    }
}

/**
 * 更新用户ID状态显示
 */
export function updateUserIdStatus() {
    let userIdStatus = document.getElementById("userIdStatus");
    if (!userIdStatus) return;
    
    if (typeof _getBgmUserId === 'function') {
        let userId = _getBgmUserId();
        if (userId) {
            let display = BGM.cache.username ? BGM.cache.username + " (" + userId + ")" : userId;
            userIdStatus.textContent = "已设置: " + display;
            userIdStatus.style.color = "#4CAF50";
        } else {
            userIdStatus.textContent = "未设置";
            userIdStatus.style.color = "#f44336";
        }
    }
}

/**
 * 显示 Token 设置对话框
 */

/**
 * 显示消息对话框（自定义模态框）
 */
export function showDialog(title, message) {
    const dialog = document.getElementById('bgmAlertDialog');
    if (!dialog) {
        window.alert(message);
        return;
    }
    document.getElementById('bgmAlertTitle').textContent = title || '提示';
    document.getElementById('bgmAlertMessage').textContent = message;
    dialog.style.display = 'flex';
}

/**
 * 发送消息到任务窗格
 */
export function sendToTaskpane(data) {
    return BGM.postMessage(data);
}

export function showTokenDialog() {
    ensureDialogs();  // 确保对话框容器已创建
    showInput("设置 Bangumi Access Token", "请输入 Access Token", "", (value) => {
        if (value) {
            if (typeof storeBgToken === 'function') {
                storeBgToken(value);
            }
            updateTokenStatus();
            showToast("Token 已保存", "success");
            BGM.postMessage({ type: "tokenUpdated" });
        }
    });
}

/**
 * 显示用户ID设置对话框
 */
export function showUserIdDialog() {
    ensureDialogs();  // 确保对话框容器已创建
    if (typeof _getBgmUserId !== 'function') return;
    
    let currentId = _getBgmUserId() || "";
    showInput("设置 Bangumi 用户ID", "请输入用户ID（数字）", currentId, (value) => {
        if (value && value.trim() !== "") {
            if (typeof _setBgmUserId === 'function') {
                _setBgmUserId(value.trim());
            }
            updateUserIdStatus();
            showToast("用户ID 已保存", "success");
            BGM.postMessage({ type: "userIdUpdated" });
        }
    });
}

// ========== 向后兼容（挂载到 window）==========
window.showInputDialog = showInputDialog;
window.closeInputDialog = closeInputDialog;
window.showConfirmDialog = showConfirmDialog;
window.closeConfirmDialog = closeConfirmDialog;
window.showToast = showToast;
window.updateTokenStatus = updateTokenStatus;
window.updateUserIdStatus = updateUserIdStatus;
window.showTokenDialog = showTokenDialog;
window.showUserIdDialog = showUserIdDialog;

// 新增通用对话框函数
window.BGMAlert = showAlert;
window.BGMConfirm = showConfirm;
window.BGMError = showError;
window.BGMWarning = showWarning;
window.BGMSuccess = showSuccess;
window.BGMInput = showInput;
