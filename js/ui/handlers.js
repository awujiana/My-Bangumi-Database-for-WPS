/**
 * UI 事件处理模块
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、业务对话框
 */

import { bgmLog, BGM, LOG_LEVELS, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId } from '../util.js';
import { showAlert, showConfirm, showError, showSuccess, showInput, showConfirmDialog, showToast } from './dialog.js';
import { setSyncRunning, setStatus } from './message.js';
import { handleError } from '../core/unified.js';

// ========== 中文文本常量（Unicode 转义，避免 WPS WebView 编码问题）==========
const _T = {
    setBgmToken: '\u8BBE\u7F6E Bangumi Access Token',
    inputToken: '\u8BF7\u8F93\u5165 Access Token',
    tokenSaved: 'Token \u5DF2\u4FDD\u5B58',
    setBgmUserId: '\u8BBE\u7F6E Bangumi \u7528\u6237ID',
    inputUserId: '\u8BF7\u8F93\u5165\u7528\u6237ID\uFF08\u6570\u5B57\uFF09',
    userIdSaved: '\u7528\u6237ID \u5DF2\u4FDD\u5B58',
    set: '\u5DF2\u8BBE\u7F6E',
    notSet: '\u672A\u8BBE\u7F6E',
    pleaseSetUserIdFirst: '\u8BF7\u5148\u8BBE\u7F6E\u7528\u6237ID',
    pleaseSetTokenFirst: '\u8BF7\u5148\u8BBE\u7F6E Token',
    tokenValid: 'Token \u6709\u6548',
    user: '\u7528\u6237: ',
    unknownUser: '\u672A\u77E5\u7528\u6237',
    parseFailed: '\u89E3\u6790\u5931\u8D25',
    cannotParseResponse: '\u65E0\u6CD5\u89E3\u6790\u54CD\u5E94\u6570\u636E',
    tokenInvalid: 'Token \u65E0\u6548',
    tokenExpired: 'Access Token \u5DF2\u8FC7\u671F\u6216\u65E0\u6548',
    networkError: '\u7F51\u7EDC\u9519\u8BEF',
    cannotConnectBgm: '\u65E0\u6CD5\u8FDE\u63A5\u5230 Bangumi API',
    debugConnOk: '\u8C03\u8BD5\u8FDE\u63A5\u6B63\u5E38',
    debugConnFail: '\u8C03\u8BD5\u8FDE\u63A5\u5931\u8D25',
    confirmClearMarks: '\u786E\u5B9A\u8981\u6E05\u9664\u6240\u6709\u6807\u8BB0\u5417\uFF1F',
    loadingWait: '\u6B63\u5728\u52A0\u8F7D\u811A\u672C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5...',
    pleaseSetBgmToken: '\u8BF7\u5148\u8BBE\u7F6E Bangumi Token\uFF01',
    cannotActivateSyncSheet: '\u65E0\u6CD5\u6FC0\u6D3B\u540C\u6B65\u8BB0\u5F55\u8868: ',
    syncToBgmError: 'SyncToBangumi \u51FA\u9519: ',
    execError: '\u6267\u884C\u51FA\u9519',
    syncBgmMarksStart: '\u5F00\u59CB\u4ECEBGM\u540C\u6B65\u6536\u85CF\u6807\u8BB0\uFF0C\u5DE5\u4F5C\u8868\u7D22\u5F15: ',
    fetchingCollections: '\u6B63\u5728\u83B7\u53D6\u6536\u85CF\u5217\u8868...',
    noCollectionData: '\u672A\u83B7\u53D6\u5230\u6536\u85CF\u6570\u636E\uFF0C\u8BF7\u68C0\u67E5 Token \u548C\u7528\u6237ID\uFF01',
    syncComplete: '\u540C\u6B65\u5B8C\u6210',
    fetchCollectionFailed: '\u83B7\u53D6\u6536\u85CF\u5931\u8D25',
    syncFailed: '\u540C\u6B65\u5931\u8D25',
    sheetNotFound: '\u672A\u627E\u5230\u5DE5\u4F5C\u8868: ',
    marksToSheet: '\u5DF2\u6807\u8BB0 ',
    marksToSheetSuffix: ' \u6761\u6536\u85CF\u5230 ',
};

// ========== 业务对话框函数 ==========

/**
 * 显示 Token 设置对话框
 */
export function showTokenDialog(currentToken) {
    let defaultVal = currentToken || loadBgToken() || "";
    showInput(_T.setBgmToken, _T.inputToken, defaultVal, (value) => {
        if (value) {
            storeBgToken(value);
            updateTokenStatus();
            showToast(_T.tokenSaved, "success");
            BGM.postMessage({ type: "tokenUpdated" });
        }
    });
}

/**
 * 显示用户ID设置对话框
 */
export function showUserIdDialog() {
    let currentId = _getBgmUserId() || "";
    showInput(_T.setBgmUserId, _T.inputUserId, currentId, (value) => {
        if (value && value.trim() !== "") {
            _setBgmUserId(value.trim());
            updateUserIdStatus();
            showToast(_T.userIdSaved, "success");
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
        tokenStatus.textContent = _T.set + " (" + token.substring(0, 4) + "...)";
        
        if (typeof _fetchBgmUserInfo === 'function') {
            _fetchBgmUserInfo(function(userInfo) {
                if (userInfo && userInfo.username) {
                    tokenStatus.textContent = _T.set + ": " + userInfo.username;
                    updateUserIdStatus();
                }
            });
        }
    } else {
        tokenStatus.textContent = _T.notSet;
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
        userIdStatus.textContent = _T.set + ": " + display;
        userIdStatus.style.color = "#4CAF50";
    } else {
        userIdStatus.textContent = _T.notSet;
        userIdStatus.style.color = "#f44336";
    }
}

/**
 * 打开用户收藏页面
 */
export function openUserCollection() {
    var userId = _getBgmUserId();
    if (!userId) {
        showAlert(_T.pleaseSetUserIdFirst);
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
        showAlert(_T.pleaseSetTokenFirst);
        return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.bgm.tv/v0/me', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var data = JSON.parse(xhr.responseText);
                var username = data.username || data.nickname || _T.unknownUser;
                showSuccess(_T.tokenValid, _T.user + username);
            } catch (e) {
                showError(_T.parseFailed, _T.cannotParseResponse);
            }
        } else if (xhr.status === 401) {
            showError(_T.tokenInvalid, _T.tokenExpired);
        }
    };
    xhr.onerror = function() {
        showError(_T.networkError, _T.cannotConnectBgm);
    };
    xhr.send();
}

/**
 * 测试调试连接
 */
export function testDebugConnection() {
    if (typeof window.Application !== 'undefined') {
        showToast(_T.debugConnOk, 'success');
    } else {
        showToast(_T.debugConnFail, 'error');
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
            showConfirmDialog(_T.confirmClearMarks, () => {
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
            showConfirmDialog(_T.confirmClearMarks, () => {
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
    bgmLog(LOG_LEVELS.INFO, "syncFromPanel " + '\u5F00\u59CB\u6267\u884C');
    
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined' || typeof getLastRow === 'undefined') {
        bgmLog(LOG_LEVELS.ERROR, "syncFromPanel - " + '\u5FC5\u9700\u51FD\u6570\u672A\u52A0\u8F7D');
        showAlert(_T.loadingWait);
        return;
    }
    
    bgmLog(LOG_LEVELS.INFO, "syncFromPanel - " + '\u5FC5\u9700\u51FD\u6570\u5DF2\u52A0\u8F7D\uFF0C\u5F00\u59CB\u540C\u6B65...');

    let token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        return;
    }

    if (typeof getOrCreateSyncRecordSheet === 'function') {
        let syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            try {
                syncSheet.Activate();
            } catch (e) {
                bgmLog(LOG_LEVELS.WARN, _T.cannotActivateSyncSheet + e.message);
            }
        }
    }

    if (typeof SyncToBangumi === 'function') {
        try {
            SyncToBangumi();
        } catch (e) {
            bgmLog(LOG_LEVELS.ERROR, _T.syncToBgmError + e.message);
            showAlert(e.message, _T.execError);
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
        showAlert(_T.pleaseSetBgmToken);
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
        
        bgmLog(LOG_LEVELS.INFO, _T.syncBgmMarksStart + sheetIndex);

    let token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
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
        showAlert(_T.pleaseSetTokenFirst);
        return;
    }

    let userId = _getBgmUserId();
    if (!userId) {
        showAlert(_T.pleaseSetUserIdFirst + '\uFF01');
        showUserIdDialog();
        return;
    }

    setSyncRunning(true);
    setStatus(_T.fetchingCollections, "info");

    if (typeof fetchAllUserCollections === 'function') {
        fetchAllUserCollections(token, userId, (collections) => {
            if (collections && collections.length > 0) {
                if (typeof fetchAndRecordBgCollections === 'function') {
                    fetchAndRecordBgCollections(token, userId, collections);
                }
                markUploadedItems(sheetIndex, collections);
            } else {
                showAlert(_T.noCollectionData);
            }
            setSyncRunning(false);
            setStatus(_T.syncComplete, "success");
        }, (error) => {
            showAlert(error, _T.fetchCollectionFailed);
            setSyncRunning(false);
            setStatus(_T.syncFailed, "error");
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
            showAlert(_T.pleaseSetTokenFirst);
            return;
        }
        let userId = _getBgmUserId();
        if (!userId) {
            showAlert(_T.pleaseSetUserIdFirst + '\uFF01');
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
            showAlert(_T.sheetNotFound + sheetName);
            return;
        }
        if (typeof fetchAllUserCollections === 'function') {
            fetchAllUserCollections(token, userId, (cols) => {
                if (cols && cols.length > 0) {
                    if (typeof markUploadedItemsInSheet === 'function') {
                        markUploadedItemsInSheet(targetIndex, cols);
                        showToast(_T.marksToSheet + cols.length + _T.marksToSheetSuffix + sheetName, 'success');
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
            showConfirmDialog(_T.confirmClearMarks, () => {
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
