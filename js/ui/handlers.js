/**
 * UI 事件处理模块
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、事件处理
 */

import { bgmLog, BGM, LOG_LEVELS } from '../util.js';
import { 
    showAlertDialog, showTokenDialog, showUserIdDialog, loadBgToken, 
    _getBgmUserId 
} from '../util.js';
import { setSyncRunning, setStatus } from './message.js';
import { handleError } from '../core/unified.js';

// ========== 面板操作处理 ==========
/**
 * 处理面板操作
 */
export function onAction(action) {
    switch (action) {
        case "sync":
            syncFromPanel();
            break;
        case "test":
            if (typeof testSingleUpdate === 'function') {
                testSingleUpdate();
            }
            break;
        case "clear":
            if (typeof showConfirmDialog === 'function') {
                showConfirmDialog("确定要清除所有标记吗？", () => {
                    if (typeof clearRowColors === 'function') {
                        clearRowColors();
                    }
                    if (typeof refreshData === 'function') {
                        refreshData();
                    }
                });
            }
            break;
        case "setToken":
            if (typeof showTokenDialog === 'function') {
                showTokenDialog(loadBgToken() || "");
            }
            break;
        case "preview":
            if (typeof previewSyncContent === 'function') {
                previewSyncContent();
            }
            break;
        case "showUserIdDialog":
            if (typeof showUserIdDialog === 'function') {
                showUserIdDialog();
            }
            break;
        case "showClearConfirm":
            if (typeof showConfirmDialog === 'function') {
                showConfirmDialog("确定要清除所有标记吗？", () => {
                    if (typeof clearRowColors === 'function') {
                        clearRowColors();
                    }
                    if (typeof refreshData === 'function') {
                        refreshData();
                    }
                });
            }
            break;
        case "tokenUpdated":
            if (typeof updateTokenStatus === 'function') {
                updateTokenStatus();
            }
            break;
        case "userIdUpdated":
            if (typeof updateUserIdStatus === 'function') {
                updateUserIdStatus();
            }
            break;
    }
}

// ========== 从面板同步 ==========
/**
 * 从面板执行同步
 */
export function syncFromPanel() {
    bgmLog(LOG_LEVELS.INFO, "syncFromPanel 开始执行");
    
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined' || typeof getLastRow === 'undefined') {
        bgmLog(LOG_LEVELS.ERROR, "syncFromPanel - 必需函数未加载");
        showAlertDialog("提示", "正在加载脚本，请稍后重试...");
        return;
    }
    
    bgmLog(LOG_LEVELS.INFO, "syncFromPanel - 必需函数已加载，开始同步...");

    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Bangumi Token！");
        showTokenDialog("");
        return;
    }

    if (typeof getOrCreateSyncRecordSheet === 'function') {
        let syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            try {
                syncSheet.Activate();
            } catch (e) {
                bgmLog(LOG_LEVELS.WARN, "无法激活同步记录表: " + e.message);
            }
        }
    }

    if (typeof SyncToBangumi === 'function') {
        try {
            SyncToBangumi();
        } catch (e) {
            bgmLog(LOG_LEVELS.ERROR, "SyncToBangumi 出错: " + e.message);
            showAlertDialog("执行出错", e.message);
        }
    }
}

/**
 * 测试单个条目更新
 */
export function testSingleUpdateFromPanel() {
    if (typeof findHeaderRow === 'undefined') {
        setTimeout(testSingleUpdateFromPanel, 500);
        return;
    }
    
    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Bangumi Token！");
        return;
    }
    
    if (typeof testSingleUpdateBangumi === 'function') {
        testSingleUpdateBangumi();
    }
}

// ========== 从BGM同步收藏标记 ==========
/**
 * 从BGM同步收藏标记
 */
export function syncCollectionFromBgm() {
    try {
        let select = document.getElementById("sheetSelect");
        let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;
        
        bgmLog(LOG_LEVELS.INFO, "开始从BGM同步收藏标记，工作表索引: " + sheetIndex);

        let token = loadBgToken();
        if (!token) {
            showAlertDialog("提示", "请先设置 Bangumi Token！");
            return;
        }

        syncFromBgmByAPI(sheetIndex);
    } catch (e) {
        handleError(e, { context: 'syncCollectionFromBgm', showDialog: true });
    }
}

/**
 * 通过 API 方式同步收藏
 */
export function syncFromBgmByAPI(sheetIndex) {
    bgmLog(LOG_LEVELS.INFO, "syncFromBgmByAPI 开始");

    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Token！");
        return;
    }

    let userId = _getBgmUserId();
    if (!userId) {
        showAlertDialog("提示", "请先设置用户ID！");
        showUserIdDialog();
        return;
    }

    setSyncRunning(true);
    setStatus("正在获取收藏列表...", "info");

    if (typeof fetchAllUserCollections === 'function') {
        fetchAllUserCollections(token, userId, (collections) => {
            if (collections && collections.length > 0) {
                if (typeof fetchAndRecordBgCollections === 'function') {
                    fetchAndRecordBgCollections(token, userId, collections);
                }
                markUploadedItems(sheetIndex, collections);
            } else {
                showAlertDialog("提示", "未获取到收藏数据，请检查 Token 和用户ID！");
            }
            setSyncRunning(false);
            setStatus("同步完成", "success");
        }, (error) => {
            showAlertDialog("获取收藏失败", error);
            setSyncRunning(false);
            setStatus("同步失败", "error");
        });
    }
}

/**
 * 标记已上传的条目到工作表
 */
export function markUploadedItems(sheetIndex, collections) {
    if (typeof markUploadedItemsInSheet === 'function') {
        markUploadedItemsInSheet(sheetIndex, collections);
    }
}

/**
 * 清除工作表标记
 */
export function clearSheetMarks(sheetIndex) {
    if (typeof clearSheetMarksInSheet === 'function') {
        clearSheetMarksInSheet(sheetIndex);
    }
}

// ========== 向后兼容（挂载到 window）==========
window.onAction = onAction;
window.syncFromPanel = syncFromPanel;
window.syncCollectionFromBgm = syncCollectionFromBgm;
window.syncFromBgmByAPI = syncFromBgmByAPI;
window.markUploadedItems = markUploadedItems;
window.clearSheetMarks = clearSheetMarks;
window.testSingleUpdateFromPanel = testSingleUpdateFromPanel;
window.testTokenValidity = testTokenValidity;

// ========== 事件监听器（替代内联 onclick）==========
function setupButtonListeners() {
    // 查找所有带 data-action 属性的按钮
    const buttons = document.querySelectorAll('[data-action]');
    buttons.forEach(button => {
        // 移除旧的事件监听器（防止重复绑定）
        button.removeEventListener('click', handleActionClick);
        // 添加新的事件监听器
        button.addEventListener('click', handleActionClick);
    });
}

function handleActionClick(event) {
    const button = event.currentTarget;
    const action = button.dataset.action;
    
    if (!action) return;
    
    bgmLog(LOG_LEVELS.DEBUG, 'Button action: ' + action);

    switch (action) {
        case 'showTokenDialog':
            if (typeof showTokenDialog === 'function') {
                showTokenDialog(loadBgToken() || "");
            }
            break;
        case 'testToken':
            if (typeof testTokenValidity === 'function') {
                testTokenValidity();
            }
            break;
        case 'showUserIdDialog':
            if (typeof showUserIdDialog === 'function') {
                showUserIdDialog();
            }
            break;
        case 'openUserCollection':
            if (typeof openUserCollection === 'function') {
                openUserCollection();
            }
            break;
        case 'sync':
            syncFromPanel();
            break;
        case 'test':
            if (typeof testSingleUpdate === 'function') {
                testSingleUpdate();
            }
            break;
        case 'clear':
            if (typeof showConfirmDialog === 'function') {
                showConfirmDialog("确定要清除所有标记吗？", () => {
                    if (typeof clearRowColors === 'function') {
                        clearRowColors();
                    }
                });
            }
            break;
        case 'preview':
            if (typeof previewSyncContent === 'function') {
                previewSyncContent();
            }
            break;
        default:
            bgmLog(LOG_LEVELS.WARN, 'Unknown action: ' + action);
    }
}

// 等待 DOM 加载完成后设置事件监听器
function initEventListeners() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(setupButtonListeners, 0);
        });
    } else {
        setTimeout(setupButtonListeners, 0);
    }
}

// 初始化
initEventListeners();
