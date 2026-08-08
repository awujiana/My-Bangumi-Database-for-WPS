/**
 * UI 消息通信模块（TypeScript 版）
 * @module ui/message
 * @description 消息监听、消息处理、状态设置
 */
import { BGM, showAlert, showConfirm, updateTokenStatus, updateUserIdStatus, refreshSheets, refreshData, bgmLog, LOG_LEVELS, } from '../index.js';
// ========== 消息监听 ==========
let _messageHandler = null;
export function initMessageListener() {
    bgmLog(LOG_LEVELS.INFO, `[message] initMessageListener 开始执行`);
    // 先移除已有监听器，避免重复注册
    if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
    }
    _messageHandler = (event) => {
        // 校验消息来源，防止跨站消息伪造
        const ALLOWED_ORIGINS = ['https://bgm.tv', window.location.origin];
        if (!ALLOWED_ORIGINS.includes(event.origin))
            return;
        const data = event.data;
        if (!data?.type)
            return;
        bgmLog(LOG_LEVELS.INFO, `[message] 收到消息: ${data.type}`);
        switch (data.type) {
            case 'showAlert':
                showAlert(data.message || '', data.title);
                break;
            case 'showConfirm':
                showConfirm(data.message || '', (confirmed) => {
                    if (confirmed)
                        BGM.sync.startSync();
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
            default:
                bgmLog(LOG_LEVELS.WARN, `[message] 未知消息类型: ${data.type}`);
        }
    };
    window.addEventListener('message', _messageHandler);
    bgmLog(LOG_LEVELS.INFO, `[message] initMessageListener 执行完成，监听器已注册`);
}
// ========== 状态显示 ==========
export function setStatus(message, type) {
    const statusEl = document.getElementById('statusBox') || document.getElementById('statusDisplay');
    if (!statusEl)
        return;
    statusEl.textContent = message;
    statusEl.className = 'status ' + (type || 'info');
}
//# sourceMappingURL=message.js.map