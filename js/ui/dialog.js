// ========== UI 对话框模块 ==========
// 功能：自定义对话框、确认对话框、Toast 通知
// 依赖：无独立依赖

// ========== 输入对话框 ==========
/**
 * 显示输入对话框
 * @param {string} title - 对话框标题
 * @param {string} placeholder - 输入框占位文本
 * @param {function} onSubmit - 提交回调
 */
function showInputDialog(title, placeholder, onSubmit) {
    let overlay = document.getElementById("inputOverlay");
    let titleEl = document.getElementById("inputTitle");
    let input = document.getElementById("inputField");

    if (!overlay || !titleEl || !input) return;

    titleEl.textContent = title || "输入";
    input.placeholder = placeholder || "";
    input.value = "";
    overlay.style.display = "flex";

    // 绑定确认按钮
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
function closeInputDialog() {
    let overlay = document.getElementById("inputOverlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

// ========== 确认对话框 ==========
/**
 * 显示确认对话框
 * @param {string} message - 确认消息
 * @param {function} onConfirm - 确认回调
 */
function showConfirmDialog(message, onConfirm) {
    let overlay = document.getElementById("confirmOverlay");
    let messageEl = document.getElementById("confirmMessage");

    if (!overlay || !messageEl) {
        // 兜底：使用原生 confirm
        if (confirm(message)) {
            if (onConfirm) onConfirm();
        }
        return;
    }

    messageEl.textContent = message || "确定要执行此操作吗？";
    overlay.style.display = "flex";

    // 绑定按钮
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
function closeConfirmDialog() {
    let overlay = document.getElementById("confirmOverlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

// ========== Toast 通知 ==========
/**
 * 显示 Toast 通知
 * @param {string} message - 通知消息
 * @param {string} type - 类型 (success, error, info)
 */
function showToast(message, type) {
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
function updateTokenStatus() {
    let tokenStatus = document.getElementById("tokenStatus");
    if (!tokenStatus) return;

    let token = loadBgToken();
    if (token && token.length > 10) {
        tokenStatus.textContent = "已设置 (" + token.substring(0, 4) + "...)";
        tokenStatus.style.color = "#4CAF50";
    } else {
        tokenStatus.textContent = "未设置";
        tokenStatus.style.color = "#f44336";
    }
}

/**
 * 更新用户ID状态显示
 */
function updateUserIdStatus() {
    let userIdStatus = document.getElementById("userIdStatus");
    if (!userIdStatus) return;

    let userId = _getBgmUserId();
    if (userId) {
        userIdStatus.textContent = "已设置: " + userId;
        userIdStatus.style.color = "#4CAF50";
    } else {
        userIdStatus.textContent = "未设置";
        userIdStatus.style.color = "#f44336";
    }
}

// ========== Token 设置对话框 ==========
/**
 * 显示 Token 设置对话框
 * @param {string} currentToken - 当前 Token
 */
function showTokenDialog(currentToken) {
    showInputDialog("设置 Bangumi Access Token", "请输入 Access Token", (value) => {
        if (value) {
            storeBgToken(value);
            updateTokenStatus();
            showToast("Token 已保存", "success");
            BGM.postMessage({ type: "tokenUpdated" });
        }
    });
}

// ========== 用户ID 设置对话框 ==========
/**
 * 显示用户ID设置对话框
 * @param {string} currentUserId - 当前用户ID
 */
function showUserIdDialog() {
    showInputDialog("设置 Bangumi 用户ID", "请输入用户ID（数字）", (value) => {
        if (value) {
            _setBgmUserId(value);
            updateUserIdStatus();
            showToast("用户ID 已保存", "success");
            BGM.postMessage({ type: "userIdUpdated" });
        }
    });
}
