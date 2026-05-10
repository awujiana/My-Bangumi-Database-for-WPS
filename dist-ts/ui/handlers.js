/**
 * UI 事件处理模块
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、业务对话框
 */
import { LOG_LEVELS, bgmLog, BGM, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId, getApp, getCell, trim, fetchBgmUserInfo, BGM_COLOR, showAlert, showConfirm, showError, showSuccess, showInput, showToast, setStatus, verifyToken, fetchAllUserCollections, findHeaderRow, getColumnMap, getLastRow, extractSubjectId, getDataSheet, getFilterStatus, SyncToBangumiAsync, clearRowColors, testSingleUpdate, getOrCreateSyncRecordSheet, getAllSyncRecords, addSyncRecord, openSyncRecordSheet, clearSheetMarksInSheet, previewSyncContent, refreshData, refreshSheets, toggleSheetLock, fetchBgCollectionRecords, clearSyncRecords, closeDetailModal, } from '../index.js';
// ========== 中文常量 ==========
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
    syncToBgmError: 'SyncToBangumiAsync \u51FA\u9519: ',
    execError: '\u6267\u884C\u51FA\u9519',
    syncBgmMarksStart: '\u5F00\u59CB\u4ECEBGM\u540C\u6B65\u6536\u85CF\u6807\u8BB0\uFF0C\u5DE5\u4F5C\u8868\u7D22\u5F15: ',
    noCollectionData: '\u672A\u83B7\u53D6\u5230\u6536\u85CF\u6570\u636E\uFF0C\u8BF7\u68C0\u67E5 Token \u548C\u7528\u6237ID\uFF01',
    syncComplete: '\u540C\u6B65\u5B8C\u6210',
    fetchCollectionFailed: '\u83B7\u53D6\u6536\u85CF\u5931\u8D25',
    syncFailed: '\u540C\u6B65\u5931\u8D25',
    sheetNotFound: '\u672A\u627E\u5230\u5DE5\u4F5C\u8868: ',
    marksToSheet: '\u5DF2\u6807\u8BB0 ',
    marksToSheetSuffix: ' \u6761\u6536\u85CF\u5230 ',
};
// ========== 业务对话框 ==========
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
        fetchBgmUserInfo().then((userInfo) => {
            if (userInfo?.username) {
                tokenStatus.textContent = _T.set + ': ' + userInfo.username;
                updateUserIdStatus();
            }
        });
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
    xhr.onerror = () => showError(_T.networkError, _T.cannotConnectBgm);
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
// ========== 面板操作分发 ==========
export function onAction(action) {
    switch (action) {
        case 'sync':
            syncFromPanel();
            break;
        case 'test':
            if (typeof testSingleUpdate === 'function')
                testSingleUpdate();
            break;
        case 'clear':
            showConfirm(_T.confirmClearMarks, '确认', () => {
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
            showConfirm(_T.confirmClearMarks, '确认', () => {
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
// ========== 从面板同步（异步，带进度条） ==========
export async function syncFromPanel() {
    bgmLog(LOG_LEVELS.INFO, 'syncFromPanel 开始执行');
    if (typeof findHeaderRow !== 'function' || typeof getColumnMap !== 'function' || typeof getLastRow !== 'function') {
        showAlert(_T.loadingWait);
        return;
    }
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
            catch (e) { /* 忽略 */ }
        }
    }
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        showAlert('无法获取 Application 对象！');
        return;
    }
    const ws = getDataSheet();
    if (!ws) {
        showAlert('未找到数据工作表');
        return;
    }
    const headerRow = findHeaderRow(ws);
    const lastRow = getLastRow(ws);
    const rowCount = lastRow - headerRow;
    if (rowCount <= 0) {
        showAlert('没有可同步的数据行');
        return;
    }
    // 同步前确认
    const confirmed = await new Promise(resolve => {
        showConfirm(`即将同步 ${rowCount} 行数据到 Bangumi，是否继续？`, '确认', () => resolve(true), () => resolve(false));
    });
    if (!confirmed)
        return;
    // 获取列映射
    const colMap = getColumnMap(ws, headerRow);
    if (!colMap.has("Bangumi_URL")) {
        showAlert('未找到 Bangumi URL 列');
        return;
    }
    try {
        const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
            onProgress: (current, total, message) => {
                updateProgressBar(current, total, message);
                if (app.StatusBar !== undefined) {
                    app.StatusBar = `[${current}/${total}] ${message}`;
                }
            }
        });
        resetProgressBar();
        if (app.StatusBar !== undefined)
            app.StatusBar = false;
        showAlert(`同步完成！成功 ${result.success} 条，失败 ${result.fail} 条，跳过 ${result.skip} 条`);
    }
    catch (err) {
        resetProgressBar();
        if (app.StatusBar !== undefined)
            app.StatusBar = false;
        BGM.handleError(err, { context: 'syncFromPanel', showAlert: true });
    }
}
// 进度条辅助函数
function updateProgressBar(current, total, message) {
    const container = document.getElementById('syncProgress');
    const bar = document.getElementById('progressBar');
    const text = document.getElementById('progressText');
    if (container)
        container.style.display = 'block';
    if (bar) {
        const percent = Math.round((current / total) * 100);
        bar.style.width = percent + '%';
        bar.textContent = percent + '%';
    }
    if (text)
        text.textContent = message;
}
function resetProgressBar() {
    const container = document.getElementById('syncProgress');
    const bar = document.getElementById('progressBar');
    if (container)
        container.style.display = 'none';
    if (bar) {
        bar.style.width = '0%';
        bar.textContent = '';
    }
    const text = document.getElementById('progressText');
    if (text)
        text.textContent = '';
}
export function testSingleUpdateFromPanel() {
    if (typeof findHeaderRow !== 'function') {
        setTimeout(testSingleUpdateFromPanel, 500);
        return;
    }
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        return;
    }
    if (typeof testSingleUpdate === 'function')
        testSingleUpdate();
}
// ========== 从BGM同步收藏标记 ==========
export async function syncCollectionFromBgm() {
    const select = document.getElementById('sheetSelect');
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value || '') || 1;
    bgmLog(LOG_LEVELS.INFO, _T.syncBgmMarksStart + sheetIndex);
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        return;
    }
    try {
        await syncFromBgmByAPI(sheetIndex);
    }
    catch (e) {
        BGM.handleError(e, { context: 'syncCollectionFromBgm', showAlert: true });
    }
}
export async function syncFromBgmByAPI(sheetIndex) {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        showTokenDialog('');
        return;
    }
    showConfirm('将 从 BGM API 获取你的收藏列表，并在 D 列标记已收藏的条目，同时写入同步记录表。\n\n是否继续？', '确认', async () => { await _doAPISync(sheetIndex, token); });
}
async function _doAPISync(sheetIndex, token) {
    setStatus('正在获取收藏列表...', 'info');
    try {
        if (typeof getOrCreateSyncRecordSheet === 'function') {
            const syncSheet = getOrCreateSyncRecordSheet();
            if (!syncSheet) {
                showAlert('创建同步记录表失败');
                return;
            }
        }
        const app = getApp();
        if (!app?.ActiveWorkbook) {
            showAlert('无法获取 Application');
            return;
        }
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
        const headerRow = typeof findHeaderRow === 'function' ? findHeaderRow(ws) : 1;
        const colMap = typeof getColumnMap === 'function' ? getColumnMap(ws, headerRow) : new Map();
        if (!colMap.has('Bangumi_URL')) {
            showAlert('未找到 Bangumi URL 列！');
            return;
        }
        const lastRow = typeof getLastRow === 'function' ? getLastRow(ws) : 200;
        let rowsToProcess = [];
        if (typeof getFilterStatus === 'function') {
            const filterStatus = getFilterStatus(lastRow);
            rowsToProcess = filterStatus?.visibleRows ?? [];
        }
        if (rowsToProcess.length === 0) {
            for (let r = headerRow + 1; r <= lastRow; r++)
                rowsToProcess.push(r);
        }
        if (rowsToProcess.length === 0) {
            showAlert('没有需要处理的数据行！');
            return;
        }
        setStatus('正在验证 Token...', 'info');
        const verifyResult = await verifyToken(token);
        if (!verifyResult.valid) {
            showAlert('✘ ' + verifyResult.message);
            return;
        }
        _setBgmUserId(verifyResult.userId);
        setStatus('正在获取收藏列表...', 'info');
        const userCollections = await fetchAllUserCollections(token);
        const collectionMap = new Map();
        userCollections.forEach(c => collectionMap.set(String(c.subject_id), c));
        let syncRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
        const syncCountMap = new Map();
        syncRecords.forEach(r => syncCountMap.set(String(r.sid || ''), (syncCountMap.get(String(r.sid || '')) || 0) + 1));
        const BGM_SUBJECT_TYPES = window.BGM_SUBJECT_TYPES || { 1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '真人剧' };
        for (const item of userCollections) {
            if (typeof addSyncRecord === 'function') {
                addSyncRecord({
                    name: item.subject?.name_cn || item.subject?.name || '(无名称)',
                    url: 'https://bgm.tv/subject/' + item.subject_id,
                    sid: String(item.subject_id),
                    type: BGM_SUBJECT_TYPES[item.subject_type || 2],
                    content: '标记同步',
                    status: '成功',
                    count: 1
                });
            }
        }
        syncRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
        syncCountMap.clear();
        syncRecords.forEach(r => syncCountMap.set(String(r.sid || ''), (syncCountMap.get(String(r.sid || '')) || 0) + 1));
        let matchedCount = 0;
        for (const row of rowsToProcess) {
            const bgmUrlCell = colMap.has('Bangumi_URL') ? getCell(ws, row, colMap.get('Bangumi_URL')) : null;
            const bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || '')) : '';
            const sid = typeof extractSubjectId === 'function' ? extractSubjectId(bgmUrl) : '';
            if (sid && collectionMap.has(sid)) {
                const seqCell = getCell(ws, row, 4);
                if (seqCell && seqCell.Interior) {
                    const syncCount = syncCountMap.get(sid) || 0;
                    seqCell.Interior.Color = syncCount === 1 ? BGM_COLOR.BGM_SYNC :
                        syncCount === 2 ? BGM_COLOR.LIGHT_GREEN : BGM_COLOR.DARK_GREEN;
                }
                matchedCount++;
            }
        }
        showAlert(`同步完成！\n\n已匹配 ${matchedCount} 条`, _T.syncComplete);
    }
    catch (e) {
        showAlert(_T.syncFailed + e.message, _T.syncFailed);
        setStatus(_T.syncFailed, 'error');
    }
}
export async function markUploadedItems(sheetIndexOrName, collections) {
    if (typeof sheetIndexOrName === 'string' && collections === undefined) {
        const sheetName = sheetIndexOrName;
        const token = loadBgToken();
        if (!token) {
            showAlert(_T.pleaseSetTokenFirst);
            return;
        }
        const userId = _getBgmUserId();
        if (!userId) {
            showAlert(_T.pleaseSetUserIdFirst + '！');
            return;
        }
        const app = getApp();
        let targetIndex = null;
        if (app?.ActiveWorkbook) {
            for (let i = 1; i <= app.ActiveWorkbook.Worksheets.Count; i++) {
                if (app.ActiveWorkbook.Worksheets.Item(i).Name === sheetName) {
                    targetIndex = i;
                    break;
                }
            }
        }
        if (targetIndex === null) {
            showAlert(_T.sheetNotFound + sheetName);
            return;
        }
        const cols = await fetchAllUserCollections(token, userId);
        if (cols?.length) {
            showToast(_T.marksToSheet + cols.length + _T.marksToSheetSuffix + sheetName, 'success');
        }
        return;
    }
    // 无操作
}
export function clearSheetMarks(sheetIndexOrName) {
    if (typeof clearSheetMarksInSheet !== 'function')
        return;
    if (typeof sheetIndexOrName === 'string') {
        const app = getApp();
        if (app?.ActiveWorkbook) {
            for (let i = 1; i <= app.ActiveWorkbook.Worksheets.Count; i++) {
                if (app.ActiveWorkbook.Worksheets.Item(i).Name === sheetIndexOrName) {
                    clearSheetMarksInSheet(i);
                    return;
                }
            }
        }
    }
    else {
        clearSheetMarksInSheet(sheetIndexOrName);
    }
}
// ========== 事件监听 ==========
function setupButtonListeners() {
    document.querySelectorAll('[data-action]').forEach(button => {
        button.removeEventListener('click', handleActionClick);
        button.addEventListener('click', handleActionClick);
    });
}
function handleActionClick(event) {
    const target = event.currentTarget;
    const action = target.dataset.action;
    if (!action)
        return;
    // 解析参数（data-args 传递 JSON 数组）
    let args = [];
    if (target.dataset.args) {
        try {
            args = JSON.parse(target.dataset.args);
        }
        catch { /* ignore */ }
    }
    switch (action) {
        case 'sync':
            syncFromPanel();
            break;
        case 'test':
            if (typeof testSingleUpdate === 'function')
                testSingleUpdate();
            break;
        case 'clear':
            showConfirm(_T.confirmClearMarks, '确认', () => {
                if (typeof clearRowColors === 'function')
                    clearRowColors();
                if (typeof refreshData === 'function')
                    refreshData();
            });
            break;
        case 'preview':
            if (typeof previewSyncContent === 'function')
                previewSyncContent();
            break;
        case 'setToken':
            showTokenDialog(loadBgToken() || '');
            break;
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
        case 'syncCollectionFromBgm':
            syncCollectionFromBgm();
            break;
        case 'refreshSheets':
            refreshSheets();
            break;
        case 'refreshData':
            refreshData();
            break;
        case 'toggleSheetLock':
            toggleSheetLock();
            break;
        case 'fetchBgCollectionRecords':
            fetchBgCollectionRecords();
            break;
        case 'clearSyncRecords':
            clearSyncRecords();
            break;
        case 'markUploadedItems':
            markUploadedItems(args[0]);
            break;
        case 'clearSheetMarks':
            clearSheetMarks(args[0]);
            break;
        case 'openSyncRecordSheet':
            openSyncRecordSheet();
            break;
        case 'testDebugConnection':
            testDebugConnection();
            break;
        case 'closeDetailModal':
            closeDetailModal();
            break;
        case 'showToast':
            showToast(args[0], args[1]);
            break;
        case 'showAlert':
            showAlert(args[0], args[1]);
            break;
        default: bgmLog(LOG_LEVELS.WARN, 'Unknown action: ' + action);
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(setupButtonListeners, 0));
}
else {
    setTimeout(setupButtonListeners, 0);
}
