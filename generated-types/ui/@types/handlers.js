/**
 * UI 事件处理模块（TypeScript 版）
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、业务对话框
 */
import { bgmLog, BGM, LOG_LEVELS, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId, getApp, getCell, trim, fetchBgmUserInfo } from '../../../generated-types/types/util.js';
import { BGM_COLOR } from '../../core/constants.js';
import { showAlert, showError, showSuccess, showInput, showConfirmDialog, showToast } from './dialog.js';
import { setStatus } from './message.js';
import { handleError } from '../core/unified.js';
import { verifyToken, fetchAllUserCollections } from '../sync/scraping.js';
// ========== 中文文本常量 ==========
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
export function showTokenDialog(currentToken) {
    const defaultVal = currentToken || loadBgToken() || '';
    showInput(_T.setBgmToken, _T.inputToken, defaultVal, (value) => {
        if (value) {
            storeBgToken(value);
            updateTokenStatus();
            showToast(_T.tokenSaved, 'success');
            BGM.postMessage({ type: 'tokenUpdated' });
        }
    });
}
export function showUserIdDialog() {
    const currentId = _getBgmUserId() || '';
    showInput(_T.setBgmUserId, _T.inputUserId, currentId, (value) => {
        if (value && value.trim() !== '') {
            _setBgmUserId(value.trim());
            updateUserIdStatus();
            showToast(_T.userIdSaved, 'success');
            BGM.postMessage({ type: 'userIdUpdated' });
        }
    });
}
export function updateTokenStatus() {
    const tokenStatus = document.getElementById('tokenStatus');
    if (!tokenStatus)
        return;
    const token = loadBgToken();
    if (token && token.length > 10) {
        tokenStatus.style.color = '#4CAF50';
        tokenStatus.textContent = _T.set + ' (' + token.substring(0, 4) + '...)';
        if (typeof fetchBgmUserInfo === 'function') {
            fetchBgmUserInfo().then((userInfo) => {
                if (userInfo?.username) {
                    tokenStatus.textContent = _T.set + ': ' + userInfo.username;
                    updateUserIdStatus();
                }
            });
        }
    }
    else {
        tokenStatus.textContent = _T.notSet;
        tokenStatus.style.color = '#f44336';
        BGM.cache.userId = null;
        BGM.cache.username = null;
    }
}
export function updateUserIdStatus() {
    const userIdStatus = document.getElementById('userIdStatus');
    if (!userIdStatus)
        return;
    const userId = _getBgmUserId();
    if (userId) {
        const display = BGM.cache.username ? BGM.cache.username + ' (' + userId + ')' : userId;
        userIdStatus.textContent = _T.set + ': ' + display;
        userIdStatus.style.color = '#4CAF50';
    }
    else {
        userIdStatus.textContent = _T.notSet;
        userIdStatus.style.color = '#f44336';
    }
}
export function openUserCollection() {
    const userId = _getBgmUserId();
    if (!userId) {
        showAlert(_T.pleaseSetUserIdFirst);
        return;
    }
    window.open('https://bgm.tv/user/' + userId + '/collection', '_blank');
}
export function testTokenValidity() {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetTokenFirst);
        return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.bgm.tv/v0/me', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.onload = () => {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                const username = data.username || data.nickname || _T.unknownUser;
                showSuccess(_T.tokenValid, _T.user + username);
            }
            catch (e) {
                showError(_T.parseFailed, _T.cannotParseResponse);
            }
        }
        else if (xhr.status === 401) {
            showError(_T.tokenInvalid, _T.tokenExpired);
        }
    };
    xhr.onerror = () => {
        showError(_T.networkError, _T.cannotConnectBgm);
    };
    xhr.send();
}
export function testDebugConnection() {
    if (typeof window.Application !== 'undefined') {
        showToast(_T.debugConnOk, 'success');
    }
    else {
        showToast(_T.debugConnFail, 'error');
    }
}
// ========== 面板操作处理 ==========
export function onAction(action) {
    switch (action) {
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
                if (typeof clearRowColors === 'function')
                    clearRowColors();
                if (typeof refreshData === 'function')
                    refreshData();
            });
            break;
        case 'setToken':
            showTokenDialog(loadBgToken() || '');
            break;
        case 'preview':
            if (typeof previewSyncContent === 'function')
                previewSyncContent();
            break;
        case 'showUserIdDialog':
            showUserIdDialog();
            break;
        case 'showClearConfirm':
            showConfirmDialog(_T.confirmClearMarks, () => {
                if (typeof clearRowColors === 'function')
                    clearRowColors();
                if (typeof refreshData === 'function')
                    refreshData();
            });
            break;
        case 'tokenUpdated':
            updateTokenStatus();
            break;
        case 'userIdUpdated':
            updateUserIdStatus();
            break;
    }
}
// ========== 从面板同步 ==========
export function syncFromPanel() {
    bgmLog(LOG_LEVELS.INFO, 'syncFromPanel 开始执行');
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined' || typeof getLastRow === 'undefined') {
        bgmLog(LOG_LEVELS.ERROR, 'syncFromPanel - 必需函数未加载');
        showAlert(_T.loadingWait);
        return;
    }
    bgmLog(LOG_LEVELS.INFO, 'syncFromPanel - 必需函数已加载，开始同步...');
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        return;
    }
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        const syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            try {
                syncSheet.Activate();
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, _T.cannotActivateSyncSheet + e.message);
            }
        }
    }
    if (typeof SyncToBangumi === 'function') {
        try {
            SyncToBangumi();
        }
        catch (e) {
            const err = e;
            bgmLog(LOG_LEVELS.ERROR, _T.syncToBgmError + err.message);
            showAlert(err.message, _T.execError);
        }
    }
}
export function testSingleUpdateFromPanel() {
    if (typeof findHeaderRow === 'undefined') {
        setTimeout(testSingleUpdateFromPanel, 500);
        return;
    }
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        return;
    }
    if (typeof testSingleUpdateBangumi === 'function') {
        testSingleUpdateBangumi();
    }
}
// ========== 从BGM同步收藏标记 ==========
export function syncCollectionFromBgm() {
    try {
        const select = document.getElementById('sheetSelect');
        const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value || '') || 1;
        bgmLog(LOG_LEVELS.INFO, _T.syncBgmMarksStart + sheetIndex);
        const token = loadBgToken();
        if (!token) {
            showAlert(_T.pleaseSetBgmToken);
            return;
        }
        syncFromBgmByAPI(sheetIndex);
    }
    catch (e) {
        handleError(e, { context: 'syncCollectionFromBgm', showDialog: true });
    }
}
export function syncFromBgmByAPI(sheetIndex) {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        showTokenDialog('');
        return;
    }
    showConfirmDialog('\u5C06\u4ECE BGM API \u83B7\u53D6\u4F60\u7684\u6536\u85CF\u5217\u8868\uFF0C\u5E76\u5728 D \u5217\u6807\u8BB0\u5DF2\u6536\u85CF\u7684\u6761\u76EE\uFF0C\u540C\u65F6\u5199\u5165\u540C\u6B65\u8BB0\u5F55\u8868\u3002\n\n\u662F\u5426\u7EE7\u7EED\uFF1F', () => { _doAPISync(sheetIndex, token); });
}
function _doAPISync(sheetIndex, token) {
    setStatus('\u6B63\u5728\u83B7\u53D6\u6536\u85CF\u5217\u8868...', 'info');
    try {
        if (typeof getOrCreateSyncRecordSheet === 'function') {
            const syncSheet = getOrCreateSyncRecordSheet();
            if (!syncSheet) {
                showAlert('\u521B\u5EFA\u540C\u6B65\u8BB0\u5F55\u8868\u5931\u8D25');
                setStatus('\u521B\u5EFA\u540C\u6B65\u8BB0\u5F55\u8868\u5931\u8D25', 'error');
                return;
            }
        }
        const app = getApp();
        if (!app?.ActiveWorkbook) {
            showAlert('\u65E0\u6CD5\u83B7\u53D6 Application');
            return;
        }
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
        let headerRow = typeof findHeaderRow === 'function' ? findHeaderRow(ws) : 0;
        if (headerRow === 0)
            headerRow = 1;
        const colMap = typeof getColumnMap === 'function' ? getColumnMap(ws, headerRow) : new Map();
        if (!colMap.has('Bangumi_URL')) {
            showAlert('\u672A\u627E\u5230 Bangumi URL \u5217\uFF01');
            return;
        }
        const seqCol = 4;
        const dataStartRow = headerRow + 1;
        const lastRow = typeof getLastRow === 'function' ? getLastRow(ws) : 200;
        let rowsToProcess = [];
        if (typeof getFilterStatus === 'function') {
            const filterStatus = getFilterStatus(lastRow);
            if (filterStatus?.hasFilter && filterStatus.visibleRows.length > 0) {
                rowsToProcess = filterStatus.visibleRows;
            }
            else if (typeof getSequentialRowsBySeqCol === 'function') {
                const seqResult = getSequentialRowsBySeqCol(dataStartRow, lastRow);
                rowsToProcess = seqResult.validRows || [];
                if (rowsToProcess.length === 0) {
                    for (let r = dataStartRow; r <= lastRow; r++)
                        rowsToProcess.push(r);
                }
            }
            else {
                for (let r = dataStartRow; r <= lastRow; r++)
                    rowsToProcess.push(r);
            }
        }
        else {
            for (let r = dataStartRow; r <= lastRow; r++)
                rowsToProcess.push(r);
        }
        if (rowsToProcess.length === 0) {
            showAlert('\u6CA1\u6709\u9700\u8981\u5904\u7406\u7684\u6570\u636E\u884C\uFF01');
            return;
        }
        // 验证 Token
        setStatus('\u6B63\u5728\u9A8C\u8BC1 Token...', 'info');
        const verifyResult = verifyToken(token);
        if (!verifyResult.valid) {
            showAlert('\u274C ' + verifyResult.message);
            setStatus('Token \u65E0\u6548', 'error');
            return;
        }
        _setBgmUserId(verifyResult.userId);
        // 获取收藏列表
        setStatus('\u6B63\u5728\u83B7\u53D6\u6536\u85CF\u5217\u8868...', 'info');
        const userCollections = fetchAllUserCollections(token);
        if (fetchAllUserCollections.lastError) {
            const err = fetchAllUserCollections.lastError;
            showAlert('\u274C ' + (err.message || '\u83B7\u53D6\u6536\u85CF\u5217\u8868\u5931\u8D25'));
            setStatus('\u83B7\u53D6\u6536\u85CF\u5931\u8D25', 'error');
            return;
        }
        if (userCollections.length === 0) {
            showAlert(_T.noCollectionData);
            setStatus('\u65E0\u6536\u85CF\u6570\u636E', 'info');
            return;
        }
        setStatus(`\u6B63\u5728\u5339\u914D ${userCollections.length} \u6761\u6536\u85CF...`, 'info');
        const collectionMap = new Map();
        for (let i = 0; i < userCollections.length; i++) {
            collectionMap.set(String(userCollections[i].subject_id), userCollections[i]);
        }
        let syncRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
        const syncCountMap = new Map();
        for (let i = 0; i < syncRecords.length; i++) {
            syncCountMap.set(String(syncRecords[i].sid), (syncCountMap.get(String(syncRecords[i].sid)) || 0) + 1);
        }
        setStatus(`\u6B63\u5728\u5199\u5165 ${userCollections.length} \u6761\u6536\u85CF\u5230\u540C\u6B65\u8BB0\u5F55\u8868...`, 'info');
        let writtenToRecord = 0;
        let prevActiveSheet = null;
        try {
            prevActiveSheet = app.ActiveSheet;
        }
        catch (e) { }
        const BGM_SUBJECT_TYPES = window.BGM_SUBJECT_TYPES || { 1: '\u4E66\u7C4D', 2: '\u52A8\u753B', 3: '\u97F3\u4E50', 4: '\u6E38\u620F', 6: '\u771F\u4EBA\u5267' };
        for (let ci = 0; ci < userCollections.length; ci++) {
            const item = userCollections[ci];
            const sid = item.subject_id;
            const url = 'https://bgm.tv/subject/' + sid;
            const name = item.subject?.name_cn || item.subject?.name || '(\u65E0\u540D\u79F0)';
            const typeId = item.subject_type || 2;
            const typeName = BGM_SUBJECT_TYPES[typeId] || '\u672A\u77E5';
            if (typeof addSyncRecord === 'function') {
                addSyncRecord({
                    name, url, sid: String(sid), type: typeName,
                    content: '\u6807\u8BB0\u540C\u6B65\uFF1A' + typeName + '\u6536\u85CF',
                    status: '\u6210\u529F', message: typeName + '\u6536\u85CF\u540C\u6B65', count: 1
                });
            }
            writtenToRecord++;
        }
        if (prevActiveSheet) {
            try {
                prevActiveSheet.Activate();
            }
            catch (e) { }
        }
        syncRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
        syncCountMap.clear();
        for (let i = 0; i < syncRecords.length; i++) {
            syncCountMap.set(String(syncRecords[i].sid), (syncCountMap.get(String(syncRecords[i].sid)) || 0) + 1);
        }
        let matchedCount = 0;
        let totalCount = 0;
        for (let idx = 0; idx < rowsToProcess.length; idx++) {
            const row = rowsToProcess[idx];
            const bgmUrlCell = colMap.has('Bangumi_URL') ? getCell(ws, row, colMap.get('Bangumi_URL')) : null;
            const bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || '')) : '';
            const sid = typeof extractSubjectId === 'function' ? extractSubjectId(bgmUrl) : '';
            if (sid && collectionMap.has(sid)) {
                const seqCell = getCell(ws, row, seqCol);
                if (seqCell && seqCell.Interior) {
                    const syncCount = syncCountMap.get(sid) || 0;
                    if (syncCount === 1)
                        seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
                    else if (syncCount === 2)
                        seqCell.Interior.Color = BGM_COLOR.LIGHT_GREEN;
                    else
                        seqCell.Interior.Color = BGM_COLOR.DARK_GREEN;
                }
                matchedCount++;
            }
            totalCount++;
            if (idx % 100 === 0)
                setStatus(`\u5DF2\u5904\u7406 ${idx + 1}/${rowsToProcess.length} \u884C...`, 'info');
        }
        setStatus(_T.syncComplete, 'success');
        showAlert(`\u540C\u6B65\u5B8C\u6210\uFF01\n\n\u5DF2\u5C06 ${writtenToRecord} \u6761BGM\u6536\u85CF\u5199\u5165\u540C\u6B65\u8BB0\u5F55\u8868\n\u626B\u63CF ${totalCount} \u884C\u53EF\u89C1\u6570\u636E\n\u5339\u914D\u5230 ${matchedCount} \u6761\n\nD \u5217\u989C\u8272\u8BF4\u660E\uFF1A\n\u{1F7E3} \u7D2B\u8272 - \u672C\u6B21\u4ECEBGM\u540C\u6B65\n\u{1F7E2} \u6D45\u7EFF\u8272 - \u5DF2\u540C\u6B652\u6B21\n\u{1F332} \u6DF1\u7EFF\u8272 - \u5DF2\u540C\u6B65\u591A\u6B21`, _T.syncComplete);
    }
    catch (e) {
        const err = e;
        showAlert('\u540C\u6B65\u5931\u8D25: ' + err.message, _T.syncFailed);
        setStatus(_T.syncFailed, 'error');
    }
}
export function markUploadedItems(sheetIndexOrName, collections) {
    if (typeof sheetIndexOrName === 'string' && collections === undefined) {
        const sheetName = sheetIndexOrName;
        const token = loadBgToken();
        if (!token) {
            showAlert(_T.pleaseSetTokenFirst);
            return;
        }
        const userId = _getBgmUserId();
        if (!userId) {
            showAlert(_T.pleaseSetUserIdFirst + '\uFF01');
            return;
        }
        const getAppFn = typeof window.getApp === 'function' ? window.getApp : null;
        const app = getAppFn ? getAppFn() : null;
        let targetIndex = null;
        if (app?.ActiveWorkbook) {
            const sheets = app.ActiveWorkbook.Worksheets;
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
export function clearSheetMarks(sheetIndexOrName) {
    if (typeof clearSheetMarksInSheet !== 'function')
        return;
    if (typeof sheetIndexOrName === 'string') {
        const getAppFn = typeof window.getApp === 'function' ? window.getApp : null;
        const app = getAppFn ? getAppFn() : null;
        if (app?.ActiveWorkbook) {
            const sheets = app.ActiveWorkbook.Worksheets;
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
// ========== 事件监听器 ==========
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
    if (!action)
        return;
    bgmLog(LOG_LEVELS.DEBUG, 'Button action: ' + action);
    switch (action) {
        case 'showTokenDialog':
            showTokenDialog(loadBgToken() || '');
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
            if (typeof testSingleUpdate === 'function')
                testSingleUpdate();
            break;
        case 'clear':
            showConfirmDialog(_T.confirmClearMarks, () => {
                if (typeof clearRowColors === 'function')
                    clearRowColors();
            });
            break;
        case 'preview':
            if (typeof previewSyncContent === 'function')
                previewSyncContent();
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
    }
    else {
        setTimeout(setupButtonListeners, 0);
    }
}
initEventListeners();
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
