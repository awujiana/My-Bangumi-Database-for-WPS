// ========== UI 消息通信模块 ==========
// 功能：消息监听、消息处理、状态设置
// 依赖：util.js (BGM.postMessage)

// ========== 消息监听（由 taskpane.js 初始化时调用）==========
/**
 * 初始化消息监听
 * @description 监听来自 ribbon 的消息
 */
function initMessageListener() {
    window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || !data.type) return;

        switch (data.type) {
            case "showDialog":
                // 显示自定义对话框
                showDialog(data.title || "提示", data.message || "");
                break;
            case "showConfirm":
                // 显示确认对话框
                showConfirmDialog(data.message || "", () => {
                    if (window._bgmConfirmCallback && window._bgmConfirmCallback.confirm) {
                        window._bgmConfirmCallback.confirm();
                    }
                });
                break;
            case "updateToken":
                // 更新 Token 显示
                updateTokenStatus();
                break;
            case "refreshSheets":
                // 刷新工作表列表
                if (typeof refreshSheets === 'function') {
                    refreshSheets();
                }
                break;
            case "refreshData":
                // 刷新数据预览
                if (typeof refreshData === 'function') {
                    refreshData();
                }
                break;
        }
    });
}

/**
 * 设置状态显示
 * @param {string} message - 状态消息
 * @param {string} type - 类型 (info, success, error)
 */
function setStatus(message, type) {
    let statusEl = document.getElementById("statusDisplay");
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = "status " + (type || "info");
}

/**
 * 设置同步运行状态
 * @param {boolean} isRunning - 是否正在运行
 */
function setSyncRunning(isRunning) {
    BGM.sync.isRunning = isRunning;
    BGM.sync.lastSyncTime = isRunning ? null : new Date().toISOString();

    // 更新按钮状态
    let syncBtn = document.getElementById("syncBtn");
    if (syncBtn) {
        syncBtn.disabled = isRunning;
        syncBtn.textContent = isRunning ? "同步中..." : "🚀 同步到 Bangumi";
    }
}
