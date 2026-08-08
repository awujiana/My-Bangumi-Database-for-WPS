/**
 * 任务面板 - 用户信息轮询
 * @module taskpane/userInfoPolling
 * @description 从 PluginStorage 恢复用户信息、定时轮询 Token/用户信息/配置变更。
 *              从原 taskpane.ts 拆分而来，保持函数签名与行为不变。
 */
import { LOG_LEVELS, getApp, bgmLog, BGM, loadBgToken, _getBgmUserId, _getBgmUsername, updateTokenStatus, updateUserIdStatus, getIncrementalSync, getSkipConflicts, getSyncRecordEnabled, } from '../index.js';
import { refreshSheets, refreshData } from './panelLifecycle.js';
/**
 * 从 PluginStorage 恢复用户信息到内存缓存
 * Ribbon 设置的用户信息通过 PluginStorage 在 Ribbon 和 Taskpane 之间共享
 */
export function restoreUserInfoFromStorage() {
    try {
        const app = getApp();
        if (!app?.PluginStorage) {
            bgmLog(LOG_LEVELS.INFO, '[restoreUserInfoFromStorage] PluginStorage 不可用');
            return;
        }
        const storedUserId = app.PluginStorage.getItem('bgm_user_id');
        const storedUsername = app.PluginStorage.getItem('bgm_username');
        if (storedUserId) {
            BGM.cache.userId = storedUserId;
            bgmLog(LOG_LEVELS.INFO, `[restoreUserInfoFromStorage] 恢复 userId: ${storedUserId}`);
        }
        if (storedUsername) {
            BGM.cache.username = storedUsername;
            bgmLog(LOG_LEVELS.INFO, `[restoreUserInfoFromStorage] 恢复 username: ${storedUsername}`);
        }
        if (storedUserId || storedUsername) {
            updateUserIdStatus();
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[restoreUserInfoFromStorage] 恢复失败: ${e.message}`);
    }
}
/**
 * 定时轮询 PluginStorage 检查用户信息和 Token 变更
 * 由于 WPS 中 Ribbon 和 Taskpane 是独立 iframe，postMessage 无法跨上下文通信，
 * 因此 Taskpane 需要定期从 PluginStorage 读取最新数据并更新 UI。
 */
export function startUserInfoPolling() {
    let lastUserId = BGM.cache.userId || null;
    let lastUsername = BGM.cache.username || null;
    let lastToken = loadBgToken();
    let lastIncrementalSync = null;
    let lastSkipConflicts = null;
    let lastEnableSyncRecord = null;
    let lastPanelShownAt = null;
    const pollingInterval = setInterval(() => {
        try {
            const currentUserId = _getBgmUserId();
            const currentUsername = _getBgmUsername();
            const currentToken = loadBgToken();
            const userInfoChanged = currentUserId !== lastUserId || currentUsername !== lastUsername;
            const tokenChanged = currentToken !== lastToken;
            if (userInfoChanged) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到用户信息变更: userId=${currentUserId || '(无)'}, username=${currentUsername || '(无)'}`);
                lastUserId = currentUserId;
                lastUsername = currentUsername;
                if (currentUserId)
                    BGM.cache.userId = currentUserId;
                if (currentUsername)
                    BGM.cache.username = currentUsername;
                updateUserIdStatus();
            }
            if (tokenChanged) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到 Token 变更: ${currentToken ? '已设置' : '已清除'}`);
                lastToken = currentToken;
                if (!currentToken) {
                    BGM.cache.userId = null;
                    BGM.cache.username = null;
                }
                updateTokenStatus();
                updateUserIdStatus();
            }
            // 同步 Ribbon 的配置变更到 Taskpane UI（增量同步 + 跳过冲突，静默读取避免日志刷屏）
            const currentIncrementalSync = getIncrementalSync(true);
            const currentSkipConflicts = getSkipConflicts(true);
            if (currentIncrementalSync !== lastIncrementalSync) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到增量同步配置变更: ${currentIncrementalSync ? '开启' : '关闭'}`);
                lastIncrementalSync = currentIncrementalSync;
                const chkIncremental = document.getElementById('chkIncremental');
                if (chkIncremental) {
                    chkIncremental.checked = currentIncrementalSync;
                    bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 增量同步复选框已同步: ${currentIncrementalSync ? '开启' : '关闭'}`);
                }
            }
            if (currentSkipConflicts !== lastSkipConflicts) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到跳过冲突配置变更: ${currentSkipConflicts ? '跳过' : 'Excel覆盖'}`);
                lastSkipConflicts = currentSkipConflicts;
                const conflictStrategySelect = document.getElementById('conflictStrategy');
                if (conflictStrategySelect) {
                    conflictStrategySelect.value = currentSkipConflicts ? 'skip' : 'excel';
                    bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 冲突策略 select 已同步: ${conflictStrategySelect.value}`);
                }
            }
            const currentEnableSyncRecord = getSyncRecordEnabled(true);
            if (currentEnableSyncRecord !== lastEnableSyncRecord) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到同步记录开关变更: ${currentEnableSyncRecord ? '开启' : '关闭'}`);
                lastEnableSyncRecord = currentEnableSyncRecord;
                const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord');
                if (chkEnableSyncRecord) {
                    chkEnableSyncRecord.checked = currentEnableSyncRecord;
                    bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 启用同步记录 checkbox 已同步: ${currentEnableSyncRecord ? '开启' : '关闭'}`);
                }
            }
            // 检测面板显示信号：Ribbon 点击"打开同步面板"时会写入 bgm_panel_shown_at 时间戳
            const app = getApp();
            const currentPanelShownAt = app?.PluginStorage?.getItem('bgm_panel_shown_at') || null;
            if (currentPanelShownAt && currentPanelShownAt !== lastPanelShownAt) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到面板显示信号: ${currentPanelShownAt}`);
                lastPanelShownAt = currentPanelShownAt;
                // 自动刷新工作表（匹配当前活动工作表）+ 刷新数据预览
                refreshSheets({ autoSelectActive: true });
                refreshData();
            }
        }
        catch {
            // 静默处理轮询错误
        }
    }, 2000); // 每2秒轮询一次
    // 面板关闭时清理定时器
    window.addEventListener('beforeunload', () => {
        clearInterval(pollingInterval);
        // 取消所有关联到全局 AbortController 的 HTTP 请求，防止状态更新到已卸载组件
        BGM.abortController.abort();
    });
}
//# sourceMappingURL=userInfoPolling.js.map