/**
 * 任务面板主模块 - 聚合入口
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑。
 *
 * 拆分结构（从原 taskpane.ts 拆分而来）：
 *   - taskpane/panelLifecycle.ts：工作表锁定/解锁、表头检测、筛选状态、预览渲染（toggleSheetLock、refreshSheets、refreshData、autoDetectSheet、updateFilterStatus 等）
 *   - taskpane/userInfoPolling.ts：用户信息恢复与轮询（restoreUserInfoFromStorage、startUserInfoPolling）
 *   - taskpane/index.ts：initPanel 初始化入口、window 全局挂载、自动初始化逻辑、re-export
 *
 * 备注：原计划中的 tokenDisplay.ts 未创建。原因：本文件中并无独立的 Token 显示逻辑，
 *       updateTokenStatus/updateUserIdStatus 等函数均来自 `../index.js`（实现在 handlers/token.ts），
 *       无可拆分内容。遵循"保守策略"，不为对齐文件清单而创建空模块。
 */
import { WPS_ENUM, LOG_LEVELS, getApp, bgmLog, BGM, updateTokenStatus, updateUserIdStatus, closeDetailModal, removeMessageListener, clearAllPendingTimeouts, } from '../index.js';
import { toggleSheetLock, saveLockedSheet, restoreLockedSheet, updateLockButton, refreshSheets, refreshWorkbooks, autoDetectSheet, updateFilterStatus, refreshData, onSelectModeChange, enlargePreview, autoDetectAndLockSheet, } from './panelLifecycle.js';
import { restoreUserInfoFromStorage, startUserInfoPolling } from './userInfoPolling.js';
// ========== 初始化 ==========
function initPanel() {
    bgmLog(LOG_LEVELS.INFO, 'initPanel 开始');
    // 初始化 WPS 枚举（如果未设置）
    const app = getApp();
    if (app && typeof app.Enum !== 'object') {
        app.Enum = WPS_ENUM;
    }
    bgmLog(LOG_LEVELS.INFO, '[taskpane] 锁定按钮监听器设置完成');
    // 初始化事件监听
    restoreUserInfoFromStorage();
    // 定时轮询 PluginStorage，确保在 Ribbon 设置 Token 后 Taskpane 能自动更新 UI
    startUserInfoPolling();
    // 恢复上次锁定的工作表
    const restored = restoreLockedSheet();
    refreshSheets();
    refreshWorkbooks();
    // 自动检测最佳工作表并锁定
    const detected = autoDetectSheet();
    if (detected) {
        const select = document.getElementById('sheetSelect');
        if (select)
            select.value = String(detected.sheetIndex);
        BGM.sheet.lockedIndex = detected.sheetIndex;
        BGM.sheet.lockedName = detected.sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: detected.sheetIndex, name: detected.sheetName });
        updateLockButton();
        refreshData(); // 立即刷新一次预览
    }
    else if (restored && BGM.sheet.isLocked) {
        const select = document.getElementById('sheetSelect');
        if (select)
            select.value = String(BGM.sheet.lockedIndex);
        refreshData();
    }
    // 更新 Token 和用户 ID 状态显示
    updateTokenStatus();
    updateUserIdStatus();
    // 工作表选择器变更事件
    const sheetSelect = document.getElementById('sheetSelect');
    if (sheetSelect) {
        sheetSelect.addEventListener('change', () => {
            BGM.sheet.lockedIndex = null;
            BGM.sheet.lockedName = null;
            BGM.sheet.isLocked = false;
            saveLockedSheet(null);
            updateLockButton();
            refreshData(); // 切换工作表时刷新预览
        });
    }
    // 工作簿选择器变更事件：切换工作簿时刷新工作表列表并自动检测表头
    const wbSelect = document.getElementById('workbookSelect');
    if (wbSelect) {
        wbSelect.addEventListener('change', () => {
            refreshSheets();
            // 自动检测新工作簿的表头
            autoDetectAndLockSheet();
        });
    }
    // 模式切换（自动/手动）
    document.querySelectorAll('input[name="selectMode"]').forEach((radio) => {
        radio.addEventListener('change', onSelectModeChange);
    });
    // 在 initPanel 中添加
    document.getElementById('closeSyncPreview')?.addEventListener('click', () => {
        const modal = document.getElementById('syncPreviewModal');
        if (modal)
            modal.style.display = 'none';
    });
    // 按 Escape 键关闭详情模态框
    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            closeDetailModal();
        }
    };
    document.addEventListener('keydown', handleKeydown);
    // 面板关闭时移除键盘监听
    window.addEventListener('beforeunload', () => {
        document.removeEventListener('keydown', handleKeydown);
        // 兜底：再次调用 abort，确保任何后续监听器也能触发取消
        BGM.abortController.abort();
    });
    // 面板关闭时清理消息监听器和待执行的 setTimeout，防止内存泄漏
    window.addEventListener('beforeunload', () => {
        removeMessageListener();
        clearAllPendingTimeouts();
    });
    // 通知模块就绪
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    bgmLog(LOG_LEVELS.INFO, 'initPanel 完成');
}
// ========== 导出 ==========
export { initPanel, refreshSheets, refreshWorkbooks, refreshData, toggleSheetLock, onSelectModeChange, enlargePreview, autoDetectSheet, autoDetectAndLockSheet, updateFilterStatus, };
window.initPanel = initPanel;
window.refreshTaskpaneUI = function () {
    try {
        restoreUserInfoFromStorage();
        bgmLog(LOG_LEVELS.INFO, '[refreshTaskpaneUI] UI 已刷新');
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, '[refreshTaskpaneUI] 刷新失败: ' + e.message);
    }
};
function safeInitPanel() {
    try {
        initPanel();
    }
    catch (e) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'initPanel' });
        document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    }
}
/**
 * 初始化任务面板。
 *
 * 显式入口函数，由 `ts/entry/taskpane-entry.ts` 调用。
 * 不在模块加载时自动执行，避免在测试或非 taskpane 上下文下意外触发副作用。
 *
 * 行为：
 *  - 若文档已加载完成（readyState === 'complete'），立即执行 safeInitPanel()
 *  - 否则推迟到 window load 事件后执行
 */
export function initTaskpane() {
    if (typeof document === 'undefined') {
        // 无 DOM 环境（如 Node 测试环境），直接同步初始化
        safeInitPanel();
        return;
    }
    if (document.readyState === 'complete') {
        safeInitPanel();
    }
    else {
        window.addEventListener('load', safeInitPanel);
    }
}
