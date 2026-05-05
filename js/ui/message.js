/**
 * UI 消息通信模块
 * @module ui/message
 * @description 消息监听、消息处理、状态设置
 */

import { BGM } from '../util.js';
import { Message, Dialog } from '../core/unified.js';

// ========== 消息监听 ==========
/**
 * 初始化消息监听
 */
export function initMessageListener() {
    window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || !data.type) return;

        switch (data.type) {
            case "showDialog":
                if (typeof showDialog === 'function') {
                    showDialog(data.title || "提示", data.message || "");
                }
                break;
            case "showConfirm":
                if (typeof showConfirmDialog === 'function') {
                    showConfirmDialog(data.message || "", () => {
                        if (window._bgmConfirmCallback && window._bgmConfirmCallback.confirm) {
                            window._bgmConfirmCallback.confirm();
                        }
                    });
                }
                break;
            case "updateToken":
                if (typeof updateTokenStatus === 'function') {
                    updateTokenStatus();
                }
                break;
            case "refreshSheets":
                if (typeof refreshSheets === 'function') {
                    refreshSheets();
                }
                break;
            case "refreshData":
                if (typeof refreshData === 'function') {
                    refreshData();
                }
                break;
        }
    });
}

/**
 * 设置状态显示
 */
export function setStatus(message, type) {
    let statusEl = document.getElementById("statusDisplay");
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = "status " + (type || "info");
}

/**
 * 设置同步运行状态
 */
export function setSyncRunning(isRunning) {
    BGM.sync.isRunning = isRunning;
    BGM.sync.lastSyncTime = isRunning ? null : new Date().toISOString();

    let syncBtn = document.getElementById("syncBtn");
    if (syncBtn) {
        syncBtn.disabled = isRunning;
        syncBtn.textContent = isRunning ? "同步中..." : "🚀 同步到 Bangumi";
    }
}

// ========== 向后兼容（挂载到 window）==========
window.initMessageListener = initMessageListener;
window.setStatus = setStatus;
window.setSyncRunning = setSyncRunning;
