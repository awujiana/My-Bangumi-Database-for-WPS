/**
 * UI 消息通信模块（TypeScript 版）
 * @module ui/message
 * @description 消息监听、消息处理、状态设置
 */
import { BGM } from '../index.js';
// ========== 消息监听 ==========
export function initMessageListener() {
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data?.type)
            return;
        switch (data.type) {
            case 'showDialog':
                if (typeof window.showDialog === 'function') {
                    window.showDialog(data.title || '\u63D0\u793A', data.message || '');
                }
                break;
            case 'showConfirm':
                if (typeof window.showConfirmDialog === 'function') {
                    window.showConfirmDialog(data.message || '', () => {
                        const callback = window._bgmConfirmCallback;
                        if (callback?.confirm)
                            callback.confirm();
                    });
                }
                break;
            case 'updateToken':
                if (typeof window.updateTokenStatus === 'function') {
                    window.updateTokenStatus();
                }
                break;
            case 'refreshSheets':
                if (typeof window.refreshSheets === 'function') {
                    window.refreshSheets();
                }
                break;
            case 'refreshData':
                if (typeof window.refreshData === 'function') {
                    window.refreshData();
                }
                break;
        }
    });
}
// ========== 状态显示 ==========
export function setStatus(message, type) {
    const statusEl = document.getElementById('statusBox') || document.getElementById('statusDisplay');
    if (!statusEl)
        return;
    statusEl.textContent = message;
    statusEl.className = 'status ' + (type || 'info');
}
export function setSyncRunning(isRunning) {
    BGM.sync.isRunning = isRunning;
    BGM.sync.lastSyncTime = isRunning ? null : new Date().toISOString();
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
        syncBtn.disabled = isRunning;
        syncBtn.textContent = isRunning ? '\u540C\u6B65\u4E2D...' : '\u{1F680} \u540C\u6B65\u5230 Bangumi';
    }
}
