/**
 * UI 消息通信模块（TypeScript 版）
 * @module ui/message
 * @description 消息监听、消息处理、状态设置
 */

import { BGM,showAlert,showConfirm ,updateTokenStatus,updateUserIdStatus,refreshSheets,refreshData, bgmLog, LOG_LEVELS} from '../index.js';

// ========== 类型定义 ==========
interface MessageEventData {
    type: string;
    title?: string;
    message?: string;
    username?: string;
    userId?: string;
}

// ========== 消息监听 ==========

export function initMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent<MessageEventData>) => {
        const data = event.data;
        if (!data?.type) return;
        
        bgmLog(LOG_LEVELS.INFO, `[message] 收到消息: ${data.type}`);
        
        switch (data.type) {
            case 'showAlert':
                showAlert(data.message || '', data.title);
                break;
            case 'showConfirm':
                showConfirm(data.message || '', (confirmed) => {
                    if (confirmed) BGM.sync.startSync();
                });
                break;
            case 'updateToken':
                updateTokenStatus();
                break;
            case 'refreshSheets':
                refreshSheets();
                break;
            case 'refreshData':
                refreshData();
                break;
            case 'BGM:userInfoUpdated':
                bgmLog(LOG_LEVELS.INFO, `[message] 收到用户信息更新: username=${data.username}, userId=${data.userId}`);
                updateUserIdStatus();
                break;
        }
    });
}

// ========== 状态显示 ==========

export function setStatus(message: string, type?: string): void {
    const statusEl = document.getElementById('statusBox') || document.getElementById('statusDisplay');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = 'status ' + (type || 'info');
}

export function setSyncRunning(isRunning: boolean): void {
    BGM.sync.isRunning = isRunning;
    BGM.sync.lastSyncTime = isRunning ? null : new Date().toISOString();

    const syncBtn = document.getElementById('syncBtn') as HTMLButtonElement | null;
    if (syncBtn) {
        syncBtn.disabled = isRunning;
        syncBtn.textContent = isRunning ? '\u540C\u6B65\u4E2D...' : '\u{1F680} \u540C\u6B65\u5230 Bangumi';
    }
}

