/**
 * UI 消息通信模块（TypeScript 版）
 * @module ui/message
 * @description 消息监听、消息处理、状态设置
 */

import { BGM } from '../tools/util.js';

// ========== 类型定义 ==========
interface MessageEventData {
    type: string;
    title?: string;
    message?: string;
}

// ========== 消息监听 ==========

export function initMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent<MessageEventData>) => {
        const data = event.data;
        if (!data?.type) return;

        switch (data.type) {
            case 'showDialog':
                if (typeof (window as any).showDialog === 'function') {
                    (window as any).showDialog(data.title || '\u63D0\u793A', data.message || '');
                }
                break;
            case 'showConfirm':
                if (typeof (window as any).showConfirmDialog === 'function') {
                    (window as any).showConfirmDialog(data.message || '', () => {
                        const callback = (window as any)._bgmConfirmCallback;
                        if (callback?.confirm) callback.confirm();
                    });
                }
                break;
            case 'updateToken':
                if (typeof (window as any).updateTokenStatus === 'function') {
                    (window as any).updateTokenStatus();
                }
                break;
            case 'refreshSheets':
                if (typeof (window as any).refreshSheets === 'function') {
                    (window as any).refreshSheets();
                }
                break;
            case 'refreshData':
                if (typeof (window as any).refreshData === 'function') {
                    (window as any).refreshData();
                }
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

