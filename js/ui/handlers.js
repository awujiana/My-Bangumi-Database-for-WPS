/**
 * UI 事件处理模块
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、业务对话框
 */

import { bgmLog, BGM, LOG_LEVELS, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId } from '../util.js';
import { showAlert, showConfirm, showError, showSuccess, showInput, showConfirmDialog, showToast } from './dialog.js';
import { setSyncRunning, setStatus } from './message.js';
import { handleError } from '../core/unified.js';

// ========== 业务对话框函数 ==========

/**
 * 显示 Token 设置对话框
 */
export function showTokenDialog(currentToken) {
    let defaultVal = currentToken || loadBgToken() || "";
    showInput("设置 Bangumi Access Token", "请输入 Access Token", defaultVal, (value) => {
        if (value) {
            storeBgToken(value);
            updateTokenStatus();
            showToast("Token 已保存", "success");
            BGM.postMessage({ type: "tokenUpdated" });
        }
    });
}

/**
 * 显示用户ID设置对话框
 */
export function showUserIdDialog() {
    let currentId = _getBgmUserId() || "";
    showInput("设置 Bangumi 用户ID", "请输入用户ID（数字）", currentId, (value) => {
        if (value && value.trim() !== "") {
            _setBgmUserId(value.trim());
            updateUserIdStatus();
            showToast("用户ID 已保存", "success");
            BGM.postMessage({ type: "userIdUpdated" });
        }
    });
}

/**
 * 更新 Token 状态显示
 */
export function updateTokenStatus() {
    let tokenStatus = document.getElementById("tokenStatus");
    if (!tokenStatus) return;
    
    let token = loadBgToken();
    if (token && token.length > 10) {
        tokenStatus.style.color = "#4CAF50";
        tokenStatus.textContent = "已设置 (" + token.substring(0, 4) + "...)";
        
        if (typeof _fetchBgmUserInfo === 'function') {
            _fetchBgmUserInfo(function(userInfo) {
                if (userInfo && userInfo.username) {
                    tokenStatus.textContent = "已设置: " + userInfo.username;
                    updateUserIdStatus();
                }
            });
        }
    } else {
        tokenStatus.textContent = "未设置";
        tokenStatus.style.color = "#f44336";
        BGM.cache.userId = null;
        BGM.cache.username = null;
    }
}

/**
 * 更新用户ID状态显示
 */
export function updateUserIdStatus() {
    let userIdStatus = document.getElementById("userIdStatus");
    if (!userIdStatus) return;
    
    let userId = _getBgmUserId();
    if (userId) {
        let display = BGM.cache.username ? BGM.cache.username + " (" + userId + ")" : userId;
        userIdStatus.textContent = "已设置: " + display;
        userIdStatus.style.color = "#4CAF50";
    } else {
        userIdStatus.textContent = "未设置";
        userIdStatus.style.color = "#f44336";
    }
}

/**
 * 打开用户收藏页面
 */
export function openUserCollection() {
    var userId = _getBgmUserId();
    if (!userId) {
        showAlert("请先设置用户ID");
        return;
    }
    window.open('https://bgm.tv/user/' + userId + '/collection', '_blank');
}

/**
 * 测试 Token 有效性
 */
export function testTokenValidity() {
    var token = loadBgToken();
    if (!token) {
        showAlert("请先设置 Token");
        return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.bgm.tv/v0/me', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var data = JSON.parse(xhr.responseText);
                var username = data.username || data.nickname || '未知用户';
                showSuccess('Token 有效', '用户: ' + username);
            } catch (e) {
                showError("解析失败", "无法解析响应数据");
            }
        } else if (xhr.status === 401) {
            showError("Token 无效", "Access Token 已过期或无效");
        }
    };
    xhr.onerror = function() {
        showError("网络错误", "无法连接到 Bangumi API");
    };
    xhr.send();
}

/**
 * 测试调试连接
 */
export function testDebugConnection() {
    if (typeof window.Application !== 'undefined') {
        showToast('调试连接正常', 'success');
    } else {
        showToast('调试连接失败', 'error');
    }
}

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
            showConfirmDialog("确定要清除所有标记吗？", () => {
                if (typeof clearRowColors === 'function') {
                    clearRowColors();
                }
                if (typeof refreshData === 'function') {
                    refreshData();
                }
            });
            break;
        case "setToken":
            showTokenDialog(loadBgToken() || "");
            break;
        case "preview":
            if (typeof previewSyncContent === 'function') {
                previewSyncContent();
            }
            break;
        case "showUserIdDialog":
            showUserIdDialog();
            break;
        case "showClearConfirm":
            showConfirmDialog("确定要清除所有标记吗？", () => {
                if (typeof clearRowColors === 'function') {
                    clearRowColors();
                }
                if (typeof refreshData === 'function') {
                    refreshData();
                }
            });
            break;
        case "tokenUpdated":
            updateTokenStatus();
            break;
        case "userIdUpdated":
            updateUserIdStatus();
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
        showAlert("正在加载脚本，请稍后重试...");
        return;
    }
    
    bgmLog(LOG_LEVELS.INFO, "syncFromPanel - 必需函数已加载，开始同步...");

    let token = loadBgToken();
    if (!token) {
        showAlert("请先设置 Bangumi Token！");
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
            showAlert(e.message, "执行出错");
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
        showAlert("请先设置 Bangumi Token！");
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
            showAlert("请先设置 Bangumi Token！");
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
        showAlert("请先设置 Token！");
        return;
    }

    let userId = _getBgmUserId();
    if (!userId) {
        showAlert("请先设置用户ID！");
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
                showAlert("未获取到收藏数据，请检查 Token 和用户ID！");
            }
            setSyncRunning(false);
            setStatus("同步完成", "success");
        }, (error) => {
            showAlert(error, "获取收藏失败");
            setSyncRunning(false);
            setStatus("同步失败", "error");
        });
    }
}

/**
 * 标记已上传条目到工作表
 * 支持两种调用方式：
 *   markUploadedItems(sheetIndex, collections) - 直接传索引和数据
 *   markUploadedItems(sheetName) - 传工作表名称，自动获取收藏数据后标记
 */
export function markUploadedItems(sheetIndexOrName, collections) {
    if (typeof sheetIndexOrName === 'string' && collections === undefined) {
        let sheetName = sheetIndexOrName;
        let token = loadBgToken();
        if (!token) {
            showAlert("请先设置 Token！");
            return;
        }
        let userId = _getBgmUserId();
        if (!userId) {
            showAlert("请先设置用户ID！");
            return;
        }
        let getApp = (typeof window.getApp === 'function') ? window.getApp : null;
        let app = getApp ? getApp() : null;
        let targetIndex = null;
        if (app && app.ActiveWorkbook) {
            let sheets = app.ActiveWorkbook.Worksheets;
            for (let i = 1; i <= sheets.Count; i++) {
                if (sheets.Item(i).Name === sheetName) {
                    targetIndex = i;
                    break;
                }
            }
        }
        if (targetIndex === null) {
            showAlert('未找到工作表: ' + sheetName);
            return;
        }
        if (typeof fetchAllUserCollections === 'function') {
            fetchAllUserCollections(token, userId, (cols) => {
                if (cols && cols.length > 0) {
                    if (typeof markUploadedItemsInSheet === 'function') {
                        markUploadedItemsInSheet(targetIndex, cols);
                        showToast('已标记 ' + cols.length + ' 条收藏到 ' + sheetName, 'success');
                    }
                }
            });
        }
        return;
    }
    if (typeof markUploadedItemsInSheet === 'function') {
        markUploadedItemsInSheet(sheetIndexOrName, collections);
    }
}

/**
 * 清除工作表标记
 */
export function clearSheetMarks(sheetIndexOrName) {
    if (typeof clearSheetMarksInSheet !== 'function') return;

    if (typeof sheetIndexOrName === 'string') {
        let getApp = (typeof window.getApp === 'function') ? window.getApp : null;
        let app = getApp ? getApp() : null;
        if (app && app.ActiveWorkbook) {
            let sheets = app.ActiveWorkbook.Worksheets;
            for (let i = 1; i <= sheets.Count; i++) {
                if (sheets.Item(i).Name === sheetIndexOrName) {
                    clearSheetMarksInSheet(i);
                    return;
                }
            }
        }
        return;
    }
    clearSheetMarksInSheet(sheetIndexOrName);
}

// ========== 向后兼容（挂载到 window）==========
window.onAction = onAction;
window.syncFromPanel = syncFromPanel;
window.syncCollectionFromBgm = syncCollectionFromBgm;
window.syncFromBgmByAPI = syncFromBgmByAPI;
window.markUploadedItems = markUploadedItems;
window.clearSheetMarks = clearSheetMarks;
window.testSingleUpdateFromPanel = testSingleUpdateFromPanel;
window.showTokenDialog = showTokenDialog;
window.showUserIdDialog = showUserIdDialog;
window.updateTokenStatus = updateTokenStatus;
window.updateUserIdStatus = updateUserIdStatus;
window.openUserCollection = openUserCollection;
window.testTokenValidity = testTokenValidity;
window.testDebugConnection = testDebugConnection;

// ========== 事件监听器（替代内联 onclick）==========
function setupButtonListeners() {
    const buttons = document.querySelectorAll('[data-action]');
    buttons.forEach(button => {
        button.removeEventListener('click', handleActionClick);
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
            showTokenDialog(loadBgToken() || "");
            break;
        case 'testToken':
            testTokenValidity();
            break;
        case 'showUserIdDialog':
            showUserIdDialog();
            break;
        case 'openUserCollection':
            openUserCollection();
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
            showConfirmDialog("确定要清除所有标记吗？", () => {
                if (typeof clearRowColors === 'function') {
                    clearRowColors();
                }
            });
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

function initEventListeners() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(setupButtonListeners, 0);
        });
    } else {
        setTimeout(setupButtonListeners, 0);
    }
}

initEventListeners();
