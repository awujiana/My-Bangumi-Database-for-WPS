/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

import { loadBgToken } from '../util.js';
import { BGM } from '../util.js';

// ========== 输入对话框 ==========
/**
 * 显示输入对话框
 */
export function showInputDialog(title, placeholder, onSubmit) {
    let overlay = document.getElementById("inputOverlay");
    let titleEl = document.getElementById("inputTitle");
    let input = document.getElementById("inputField");

    if (!overlay || !titleEl || !input) return;

    titleEl.textContent = title || "输入";
    input.placeholder = placeholder || "";
    input.value = "";
    overlay.style.display = "flex";

    let confirmBtn = document.getElementById("inputConfirmBtn");
    if (confirmBtn) {
        confirmBtn.onclick = () => {
            let value = input.value.trim();
            closeInputDialog();
            if (onSubmit && value) {
                onSubmit(value);
            }
        };
    }
}

/**
 * 关闭输入对话框
 */
export function closeInputDialog() {
    let overlay = document.getElementById("inputOverlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

// ========== 确认对话框 ==========
/**
 * 显示确认对话框
 */
export function showConfirmDialog(message, onConfirm) {
    let overlay = document.getElementById("confirmOverlay");
    let messageEl = document.getElementById("confirmMessage");

    if (!overlay || !messageEl) {
        if (confirm(message)) {
            if (onConfirm) onConfirm();
        }
        return;
    }

    messageEl.textContent = message || "确定要执行此操作吗？";
    overlay.style.display = "flex";

    let confirmBtn = document.getElementById("confirmBtn");
    let cancelBtn = document.getElementById("cancelBtn");

    if (confirmBtn) {
        confirmBtn.onclick = () => {
            closeConfirmDialog();
            if (onConfirm) onConfirm();
        };
    }
    if (cancelBtn) {
        cancelBtn.onclick = closeConfirmDialog;
    }
}

/**
 * 关闭确认对话框
 */
export function closeConfirmDialog() {
    let overlay = document.getElementById("confirmOverlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

// ========== Toast 通知 ==========
/**
 * 显示 Toast 通知
 */
export function showToast(message, type) {
    let toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.className = "toast show " + (type || "info");

    setTimeout(() => {
        toast.className = toast.className.replace("show", "");
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

// ========== Token 设置对话框 ==========
/**
 * 显示 Token 设置对话框
 */
export function showTokenDialog(currentToken) {
    showInputDialog("设置 Bangumi Access Token", "请输入 Access Token", (value) => {
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

// ========== 用户ID 设置对话框 ==========
/**
 * 显示用户ID设置对话框
 */
export function showUserIdDialog() {
    if (typeof _getBgmUserId !== 'function') return;
    
    let currentId = _getBgmUserId() || "";
    let userId = prompt("请输入 Bangumi 用户ID（数字）:", currentId);
    
    if (userId !== null && userId.trim() !== "") {
        if (typeof _setBgmUserId === 'function') {
            _setBgmUserId(userId.trim());
        }
        updateUserIdStatus();
        showToast("用户ID 已保存", "success");
        BGM.postMessage({ type: "userIdUpdated" });
    }
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
