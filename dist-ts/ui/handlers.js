/**
 * UI 事件处理模块
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、业务对话框
 */
import { LOG_LEVELS, bgmLog, BGM, loadBgToken, storeBgToken, clearBgToken, _getBgmUserId, _setBgmUserId, _getBgmUsername, _setBgmUsername, getApp, getCell, trim, getCellValue, setCellValue, fetchBgmUserInfo, BGM_COLOR, showAlert, showConfirm, showError, showSuccess, showInput, showToast, setStatus, verifyToken, fetchAllUserCollections, findHeaderRow, getColumnMap, getLastRow, extractSubjectId, getDataSheet, SyncToBangumiAsync, testSingleUpdate, getOrCreateSyncRecordSheet, getAllSyncRecords, addSyncRecord, openSyncRecordSheet, deduplicateSyncRecords, formatSyncRecordSheet, previewSyncContent, refreshData, refreshSheets, toggleSheetLock, clearSyncRecords, closeDetailModal, getIncrementalSync, setIncrementalSync, getSkipConflicts, setSkipConflicts, COLLECTION_TYPE_NAMES, } from '../index.js';
import { BGM_EVENTS, eventBus } from '../tools/events.js';
//  
import { getSyncPreview, detectConflicts } from '../services/ribbonService.js';
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
            BGM.Message.send({ type: 'tokenUpdated' });
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
            BGM.Message.send({ type: 'userIdUpdated' });
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
        // 如果已经有用户名缓存，直接显示
        if (BGM.cache.username) {
            tokenStatus.textContent = _T.set + ': ' + BGM.cache.username;
        }
        else {
            tokenStatus.textContent = _T.set + ' (' + token.substring(0, 4) + '...)';
            // 尝试获取用户信息（但不阻塞 UI 更新）
            // 注意：这里可能会因为 CORS 失败，但不影响 Token 状态显示
            fetchBgmUserInfo()
                .then((userInfo) => {
                if (userInfo?.username) {
                    tokenStatus.textContent = _T.set + ': ' + userInfo.username;
                    updateUserIdStatus();
                }
            })
                .catch(() => {
                // CORS 错误或其他错误，静默处理
                bgmLog(LOG_LEVELS.INFO, '获取用户名失败（CORS或网络错误）');
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
    bgmLog(LOG_LEVELS.INFO, `[updateUserIdStatus] userIdStatus 元素: ${userIdStatus ? '存在' : '不存在'}`);
    // 如果元素不存在，直接返回，不要发送消息（避免和 taskpane 的监听器造成死循环）
    if (!userIdStatus) {
        bgmLog(LOG_LEVELS.INFO, `[updateUserIdStatus] 元素不存在，返回（避免循环）`);
        return;
    }
    doUpdateUserIdStatus(userIdStatus);
}
function doUpdateUserIdStatus(userIdStatus) {
    const userId = _getBgmUserId();
    const username = _getBgmUsername();
    bgmLog(LOG_LEVELS.INFO, `[updateUserIdStatus] 当前 userId: ${userId}, username: ${username}`);
    if (userId) {
        const display = username ? username + ' (' + userId + ')' : userId;
        userIdStatus.textContent = _T.set + ': ' + display;
        userIdStatus.style.color = '#4CAF50';
        bgmLog(LOG_LEVELS.INFO, `[updateUserIdStatus] UI 已更新为: ${_T.set}: ${display}`);
    }
    else {
        userIdStatus.textContent = _T.notSet;
        userIdStatus.style.color = '#f44336';
        bgmLog(LOG_LEVELS.INFO, `[updateUserIdStatus] UI 已更新为: ${_T.notSet}`);
    }
}
export function openUserCollection() {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[openUserCollection] ========== 打开用户收藏页面 ==========');
    const userId = _getBgmUserId();
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 获取用户ID: ${userId || '(未设置)'}`);
    if (!userId) {
        bgmLog(LOG_LEVELS.ERROR, '[openUserCollection] 用户ID未设置，无法打开收藏页面');
        showAlert(_T.pleaseSetUserIdFirst);
        return;
    }
    const collectionUrl = `https://bgm.tv/user/${userId}/collection`;
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 生成收藏页面URL: ${collectionUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 正在打开收藏页面...`);
    window.open(collectionUrl, '_blank');
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 收藏页面已在新标签页打开，耗时: ${Date.now() - startTime}ms`);
}
export function testTokenValidity() {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetTokenFirst);
        return;
    }
    const apiUrl = 'https://api.bgm.tv/v0/me';
    const requestStartTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] ========== 开始测试 Token ==========`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] API 路由: ${apiUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求方法: GET`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求头: Authorization: Bearer ${token.substring(0, 8)}...`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求头: Content-Type: application/json`);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
        const requestEndTime = Date.now();
        const duration = requestEndTime - requestStartTime;
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] ========== 请求完成 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] HTTP 状态码: ${xhr.status} (${xhr.statusText})`);
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求耗时: ${duration}ms`);
        if (xhr.getAllResponseHeaders()) {
            bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 响应头: ${xhr.getAllResponseHeaders()}`);
        }
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                bgmLog(LOG_LEVELS.INFO, '[testTokenValidity] 响应数据: ' + JSON.stringify(data));
                const nickname = data.nickname || data.username || _T.unknownUser;
                const userId = String(data.id || '');
                bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] Token 验证成功！用户名: ${nickname}, 用户ID: ${userId}`);
                showSuccess(_T.tokenValid, _T.user + nickname);
                _setBgmUserId(userId);
                _setBgmUsername(nickname);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] 解析响应失败: ${e.message}`);
                showError(_T.parseFailed, _T.cannotParseResponse);
                BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'testTokenValidity' });
            }
        }
        else if (xhr.status === 401) {
            bgmLog(LOG_LEVELS.WARN, '[testTokenValidity] Token 无效或已过期');
            showError(_T.tokenInvalid, _T.tokenExpired);
        }
        else {
            bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] Token 验证失败，HTTP 状态码: ${xhr.status}`);
            bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 响应内容: ${xhr.responseText}`);
            showError('错误', `Token验证失败 (HTTP ${xhr.status})`);
        }
    };
    xhr.onerror = () => {
        const requestEndTime = Date.now();
        const duration = requestEndTime - requestStartTime;
        bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] 请求发生网络错误，耗时: ${duration}ms`);
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] XHR 状态: ${xhr.readyState}`);
        showError(_T.networkError, _T.cannotConnectBgm);
    };
    xhr.ontimeout = () => {
        bgmLog(LOG_LEVELS.WARN, '[testTokenValidity] 请求超时');
    };
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 正在发送请求...`);
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
            showConfirm(_T.confirmClearMarks, (confirmed) => {
                if (confirmed) {
                    if (typeof refreshData === 'function')
                        refreshData();
                }
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
            showConfirm(_T.confirmClearMarks, (confirmed) => {
                if (confirmed) {
                    if (typeof refreshData === 'function')
                        refreshData();
                }
            });
            break;
        case 'tokenUpdated':
            updateTokenStatus();
            break;
        case 'userIdUpdated':
            updateUserIdStatus();
            break;
        case 'requestStopSync':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求停止同步');
            BGM.sync.requestStop();
            break;
    }
}
// ========== 从面板同步（异步，带进度条） ==========
export async function syncFromPanel() {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] ========== 开始执行同步操作 ==========');
    // 1. 检查必要函数是否加载
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤1: 检查必要函数是否加载');
    if (typeof findHeaderRow !== 'function' || typeof getColumnMap !== 'function' || typeof getLastRow !== 'function') {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 必要函数未加载完成');
        showAlert(_T.loadingWait);
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（函数未加载），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    // 2. 检查 Token
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤2: 检查 Token');
    const token = loadBgToken();
    if (!token) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] Token 未设置');
        showAlert(_T.pleaseSetBgmToken);
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（Token未设置），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] Token 已设置（长度: ${token.length}）`);
    // 3. 获取应用和工作表对象
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤3: 获取应用和工作表对象');
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.ERROR, '[syncFromPanel] 无法获取 Application 对象');
        showAlert('无法获取 Application 对象！');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（无法获取Application），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] Application 对象获取成功');
    // 3.1 记住用户当前活动的工作表
    let originalActiveSheet = null;
    try {
        originalActiveSheet = app.ActiveWorkbook.ActiveSheet;
        if (originalActiveSheet) {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 记住用户当前工作表: ${originalActiveSheet.Name}`);
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 获取当前工作表失败: ${e.message}`);
    }
    // 3.2 确保同步记录工作表存在（不激活）
    let syncSheet = null;
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤3.2: 确保同步记录工作表存在');
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 同步记录工作表已创建/获取（暂不激活）');
        }
    }
    // 4. 获取数据工作表并激活（确保筛选检测正确）
    const ws = getDataSheet();
    if (!ws) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到数据工作表');
        showAlert('未找到数据工作表，请先锁定工作表。');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（未找到数据工作表），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 数据工作表获取成功');
    try {
        ws.Activate();
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已激活数据工作表: ${ws.Name}（用于筛选检测）`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 激活数据工作表失败: ${e.message}`);
    }
    // 5. 解析表头和列映射
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤5: 解析表头和列映射');
    const headerRow = findHeaderRow(ws);
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 表头行: ${headerRow}`);
    const lastRow = getLastRow(ws);
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 最后一行: ${lastRow}`);
    const colMap = getColumnMap(ws, headerRow);
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 列映射完成，共 ${colMap.size} 列`);
    if (!colMap.has("Bangumi_URL")) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到 Bangumi_URL 列');
        showAlert('未找到 "Bangumi URL" 列！');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（缺少Bangumi_URL列），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    // 6. 增量同步开关（提前读取）
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤6: 检查增量同步设置');
    const incremental = document.getElementById('chkIncremental')?.checked ?? false;
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 增量同步: ${incremental ? '开启' : '关闭'}`);
    // 构建增量同步的指纹映射
    let fingerprintMap;
    if (incremental) {
        const allRecords = getAllSyncRecords ? getAllSyncRecords() : [];
        fingerprintMap = new Map();
        for (const r of allRecords) {
            if (r.sid && r.fingerprint) {
                fingerprintMap.set(r.sid, r.fingerprint);
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 增量同步模式：已加载 ${fingerprintMap.size} 条历史指纹`);
    }
    // 7. 获取同步预览统计（传入增量同步选项）
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤7: 获取同步预览统计');
    const preview = getSyncPreview(ws, colMap, lastRow, headerRow, { incremental, fingerprintMap });
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 数据预览 - 总行数: ${preview.total}, 有效: ${preview.valid}, 已上传: ${preview.alreadyUploaded}, 待同步: ${preview.willSync}, 跳过: ${preview.willSkip}, 无URL: ${preview.noUrl}, 空状态: ${preview.emptyStatus}, 增量跳过: ${preview.incrementalSkipped}`);
    // 8. 冲突检测与策略
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤8: 冲突检测');
    const conflictSelect = document.getElementById('conflictStrategy');
    const conflictStrategy = conflictSelect?.value || 'skip';
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突策略: ${conflictStrategy}`);
    let conflictSids = undefined;
    let conflictMsg = '';
    try {
        bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 开始检测冲突...');
        const { conflicts, conflictCount } = await detectConflicts(ws, colMap, lastRow, headerRow, token);
        if (conflictCount > 0) {
            bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 检测到 ${conflictCount} 条冲突`);
            if (conflictStrategy === 'skip') {
                conflictSids = new Set(conflicts.map(c => c.sid));
                conflictMsg = `检测到 ${conflictCount} 条冲突，已选择【跳过冲突】。\n\n`;
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突处理策略: 跳过 ${conflictCount} 条冲突条目`);
            }
            else {
                conflictMsg = `检测到 ${conflictCount} 条冲突，将使用【Excel数据覆盖】。\n\n`;
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突处理策略: 使用Excel数据覆盖 ${conflictCount} 条冲突`);
            }
        }
        else {
            bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 未检测到冲突');
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 冲突检测失败: ${e.message}`);
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'syncFromPanel' });
    }
    // 9. 确认对话框
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤9: 显示确认对话框');
    const msg = `数据预览：
            总行数：${preview.total}
            有效条目：${preview.valid}
            已上传（跳过）：${preview.alreadyUploaded}
            待同步：${preview.willSync}
            不上传（状态跳过）：${preview.willSkip}
            无URL：${preview.noUrl}
            空状态：${preview.emptyStatus}
            ${incremental ? `增量跳过：${preview.incrementalSkipped}\n` : ''}${conflictMsg}是否继续同步？\n\n同步开始后将切换到同步记录工作表查看进度。`;
    const confirmed = await new Promise(resolve => {
        showConfirm(msg, (confirmed) => resolve(confirmed));
    });
    if (!confirmed) {
        bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 用户取消同步');
        // 恢复用户之前的工作表
        if (originalActiveSheet) {
            try {
                originalActiveSheet.Activate();
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已恢复用户之前的工作表: ${originalActiveSheet.Name}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 恢复工作表失败: ${e.message}`);
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（用户取消），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    // 10. 切换到同步记录工作表，让用户看到实时写入
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤10: 切换到同步记录工作表');
    if (syncSheet) {
        try {
            syncSheet.Activate();
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已激活同步记录工作表: ${syncSheet.Name}`);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 激活同步记录工作表失败: ${e.message}`);
        }
    }
    // 11. 执行同步
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤11: 开始执行同步');
    showStopButton(); // 显示停止按钮
    try {
        bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 调用 SyncToBangumiAsync...');
        const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
            skipSids: conflictSids,
            incremental,
            onProgress: (current, total, message) => {
                updateProgressBar(current, total, message);
                if (app.StatusBar !== undefined) {
                    app.StatusBar = `[${current}/${total}] ${message}`;
                }
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步进度: ${current}/${total} - ${message}`);
            }
        });
        resetProgressBar();
        hideStopButton(); // 隐藏停止按钮
        if (app.StatusBar !== undefined)
            app.StatusBar = false;
        // 检查是否被用户停止
        if (result.stopped) {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步已被用户停止！成功: ${result.success}, 失败: ${result.fail}, 跳过: ${result.skip}`);
            showAlert(`同步已停止！成功 ${result.success} 条，失败 ${result.fail} 条，跳过 ${result.skip} 条\n\n注意：已同步的数据不会回滚。`);
        }
        else {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步完成！成功: ${result.success}, 失败: ${result.fail}, 跳过: ${result.skip}`);
            showAlert(`同步完成！成功 ${result.success} 条，失败 ${result.fail} 条，跳过 ${result.skip} 条`);
        }
    }
    catch (err) {
        resetProgressBar();
        hideStopButton(); // 隐藏停止按钮
        if (app.StatusBar !== undefined)
            app.StatusBar = false;
        bgmLog(LOG_LEVELS.ERROR, `[syncFromPanel] 同步失败: ${err.message}`);
        BGM.handleError(err, { context: 'syncFromPanel', showAlert: true });
    }
    finally {
        // 无论成功失败，最后都尝试恢复用户之前的工作表
        if (originalActiveSheet) {
            try {
                originalActiveSheet.Activate();
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已恢复用户之前的工作表: ${originalActiveSheet.Name}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 恢复工作表失败: ${e.message}`);
            }
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] ========== 同步操作结束，总耗时: ${Date.now() - startTime}ms ==========`);
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
// 显示/隐藏停止按钮
export function showStopButton() {
    const syncBtn = document.getElementById('syncBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (syncBtn)
        syncBtn.style.display = 'none';
    if (stopBtn)
        stopBtn.style.display = 'inline-block';
    bgmLog(LOG_LEVELS.INFO, '[handlers] 停止按钮已显示，同步按钮已隐藏');
}
export function hideStopButton() {
    const syncBtn = document.getElementById('syncBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (syncBtn)
        syncBtn.style.display = 'inline-block';
    if (stopBtn)
        stopBtn.style.display = 'none';
    bgmLog(LOG_LEVELS.INFO, '[handlers] 停止按钮已隐藏，同步按钮已显示');
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
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncCollectionFromBgm] ========== 开始从 BGM 同步收藏标记 ==========');
    const select = document.getElementById('sheetSelect');
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value || '') || 1;
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 目标工作表索引: ${sheetIndex}`);
    const token = loadBgToken();
    if (!token) {
        bgmLog(LOG_LEVELS.WARN, '[syncCollectionFromBgm] Token 未设置');
        showAlert(_T.pleaseSetBgmToken);
        bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 操作终止（Token未设置），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] Token 已设置（长度: ${token.length}）`);
    try {
        bgmLog(LOG_LEVELS.INFO, '[syncCollectionFromBgm] 调用 syncFromBgmByAPI...');
        await syncFromBgmByAPI(sheetIndex);
        bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 同步完成，耗时: ${Date.now() - startTime}ms`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, `[syncCollectionFromBgm] 同步失败: ${e.message}`);
        BGM.handleError(e, { context: 'syncCollectionFromBgm', showAlert: true });
    }
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] ========== 操作结束，总耗时: ${Date.now() - startTime}ms ==========`);
}
export async function syncFromBgmByAPI(sheetIndex) {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        showTokenDialog('');
        return;
    }
    showConfirm('将 从 BGM API 获取你的收藏列表，并在 D 列标记已收藏的条目，同时写入同步记录表。\n\n是否继续？', async (confirmed) => {
        if (confirmed) {
            await _doAPISync(sheetIndex, token);
        }
    });
}
async function _doAPISync(sheetIndex, token) {
    setStatus('正在获取收藏列表...', 'info');
    // 记住原始活动工作表
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        showAlert('无法获取 Application');
        return;
    }
    let originalActiveSheet = null;
    try {
        originalActiveSheet = app.ActiveWorkbook.ActiveSheet;
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 记住原始工作表: ${originalActiveSheet?.Name}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 获取原始工作表失败: ${e.message}`);
    }
    // 获取同步记录工作表
    let syncSheet = null;
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncSheet = getOrCreateSyncRecordSheet();
        if (!syncSheet) {
            showAlert('创建同步记录表失败');
            return;
        }
    }
    try {
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
        const headerRow = typeof findHeaderRow === 'function' ? findHeaderRow(ws) : 1;
        const colMap = typeof getColumnMap === 'function' ? getColumnMap(ws, headerRow) : new Map();
        if (!colMap.has('Bangumi_URL')) {
            showAlert('未找到 Bangumi URL 列！');
            return;
        }
        const lastRow = typeof getLastRow === 'function' ? getLastRow(ws) : 200;
        const rowsToProcess = [];
        for (let r = headerRow + 1; r <= lastRow; r++)
            rowsToProcess.push(r);
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
        _setBgmUserId(verifyResult.userId || '');
        setStatus('正在获取收藏列表...', 'info');
        const userCollections = await fetchAllUserCollections(token);
        const collectionMap = new Map();
        userCollections.forEach(c => collectionMap.set(String(c.subject_id), c));
        // 切换到同步记录工作表，让用户能看到实时写入
        if (syncSheet) {
            try {
                syncSheet.Activate();
                bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 已激活同步记录工作表: ${syncSheet.Name}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 激活同步记录工作表失败: ${e.message}`);
            }
        }
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
                    count: 1,
                    collType: COLLECTION_TYPE_NAMES[item.type] || ''
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
                const seqCol = colMap.get('序列号') || 9;
                const seqCell = getCell(ws, row, seqCol);
                if (seqCell && seqCell.Interior) {
                    const syncCount = syncCountMap.get(sid) || 0;
                    seqCell.Interior.Color = syncCount === 1 ? BGM_COLOR.BGM_SYNC :
                        syncCount === 2 ? BGM_COLOR.LIGHT_GREEN : BGM_COLOR.DARK_GREEN;
                }
                matchedCount++;
            }
        }
        // 输出同步统计
        const totalCollections = userCollections.length;
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] ========== 同步统计 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] BGM 收藏总数: ${totalCollections}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 数据表总行数: ${rowsToProcess.length}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 匹配标记数: ${matchedCount}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 同步记录条数: ${syncRecords.length}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] ================================`);
        // 恢复原始工作表
        if (originalActiveSheet) {
            try {
                originalActiveSheet.Activate();
                bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 已恢复原始工作表: ${originalActiveSheet.Name}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 恢复原始工作表失败: ${e.message}`);
            }
        }
        showAlert(`同步完成！\n\n已匹配 ${matchedCount} 条`, _T.syncComplete);
    }
    catch (e) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: '_doAPISync' });
        showAlert(_T.syncFailed + e.message, _T.syncFailed);
        setStatus(_T.syncFailed, 'error');
    }
    finally {
        // 确保即使发生异常也尝试恢复原始工作表
        if (originalActiveSheet) {
            try {
                originalActiveSheet.Activate();
            }
            catch (e) {
                // 静默处理恢复失败
            }
        }
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
    // 解析可能的参数（如：<button data-action="markUploadedItems" data-args='["动画"]'>）
    let args = [];
    if (target.dataset.args) {
        try {
            args = JSON.parse(target.dataset.args);
        }
        catch (e) {
            BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'handleActionClick' });
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] ========== 按钮点击事件 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 操作类型: ${action}`);
    if (args.length > 0) {
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 参数: ${JSON.stringify(args)}`);
    }
    const startTime = Date.now();
    switch (action) {
        // 核心操作
        case 'sync':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行同步操作');
            syncFromPanel();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步操作已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'test':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行单条测试更新');
            if (typeof testSingleUpdate === 'function') {
                testSingleUpdate();
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 单条测试更新已触发，耗时: ${Date.now() - startTime}ms`);
            }
            else {
                bgmLog(LOG_LEVELS.WARN, '[handleActionClick] testSingleUpdate 函数未定义');
            }
            break;
        case 'clear':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据');
            showConfirm(_T.confirmClearMarks, (confirmed) => {
                if (confirmed) {
                    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户确认刷新数据');
                    if (typeof refreshData === 'function')
                        refreshData();
                    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 刷新数据完成，耗时: ${Date.now() - startTime}ms`);
                }
                else {
                    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消刷新数据');
                }
            });
            break;
        case 'previewSyncContent':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行预览同步内容');
            if (typeof previewSyncContent === 'function') {
                previewSyncContent();
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 预览同步内容已触发，耗时: ${Date.now() - startTime}ms`);
            }
            else {
                bgmLog(LOG_LEVELS.WARN, '[handleActionClick] previewSyncContent 函数未定义');
            }
            break;
        case 'setToken':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开 Token 设置对话框');
            showTokenDialog(loadBgToken() || '');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 设置对话框已打开，耗时: ${Date.now() - startTime}ms`);
            break;
        // 快捷按钮
        case 'showTokenDialog':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示 Token 设置对话框');
            showTokenDialog(loadBgToken() || '');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 设置对话框已显示，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'clearToken':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清除 Token 设置');
            try {
                clearBgToken();
                BGM.cache.userId = null;
                BGM.cache.username = null;
                const app = getApp();
                if (app?.PluginStorage) {
                    app.PluginStorage.setItem('bgm_user_id', '');
                    app.PluginStorage.setItem('bgm_username', '');
                }
                updateTokenStatus();
                updateUserIdStatus();
                showToast('Token 已清除', 'info');
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] Token 已清除');
            }
            catch (e) {
                BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.WARN, context: 'clearToken' });
            }
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 清除 Token 操作完成，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'testToken':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始测试 Token 有效性');
            testTokenValidity();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 测试已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'showUserIdDialog':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示用户ID设置对话框');
            showUserIdDialog();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 用户ID设置对话框已显示，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'openUserCollection':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 尝试打开收藏页面');
            openUserCollection();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 收藏页面打开操作已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'syncCollectionFromBgm':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始从 BGM 同步收藏');
            syncCollectionFromBgm();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 收藏同步已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'refreshSheets':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新工作表');
            refreshSheets();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 工作表刷新已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'refreshData':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据');
            refreshData();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 数据刷新已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'toggleSheetLock':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 切换工作表锁定状态');
            toggleSheetLock();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 工作表锁定状态已切换，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'clearSyncRecords':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清除同步记录');
            clearSyncRecords();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录清除已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'deduplicateSyncRecords':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始去重同步记录');
            deduplicateSyncRecords();
            showToast('去重完成', 'success');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录去重已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'formatSyncRecordSheet':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始设置同步记录表格式');
            formatSyncRecordSheet();
            showToast('格式设置完成', 'success');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录表格式设置已触发，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'cleanLockedDataSheet':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清洗锁定数据表');
            cleanLockedDataSheet();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 数据清洗完成，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'markUploadedItems':
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 标记已上传项目，类型: ${args[0] || '全部'}`);
            markUploadedItems(args[0]);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 已上传项目标记完成，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'openSyncRecordSheet':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开同步记录工作表');
            openSyncRecordSheet();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录工作表已打开，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'testDebugConnection':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 测试调试连接');
            testDebugConnection();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 调试连接测试已完成，耗时: ${Date.now() - startTime}ms`);
            break;
        // 模态框操作
        case 'closeDetailModal':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭详情模态框');
            closeDetailModal();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 详情模态框已关闭，耗时: ${Date.now() - startTime}ms`);
            break;
        // 弹窗快捷调用（参数形式）
        case 'showToast':
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示 Toast 消息: ${args[0] || ''}`);
            showToast(args[0], args[1]);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Toast 已显示，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'showAlert':
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示警告框: ${args[0] || ''}`);
            showAlert(args[0], args[1]);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 警告框已显示，耗时: ${Date.now() - startTime}ms`);
            break;
        case 'requestStopSync':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求停止同步');
            BGM.sync.requestStop();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 停止同步请求已发送，耗时: ${Date.now() - startTime}ms`);
            break;
        default:
            bgmLog(LOG_LEVELS.WARN, `[handleActionClick] 未知操作类型: ${action}`);
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(setupButtonListeners, 0));
}
else {
    setTimeout(setupButtonListeners, 0);
}
function isTaskpaneContext() {
    return typeof window !== 'undefined' && window.location.pathname.includes('taskpane.html');
}
// ========== 消息监听 ==========
function setupMessageListener() {
    if (typeof window !== 'undefined') {
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object')
                return;
            bgmLog(LOG_LEVELS.INFO, '[handlers] 收到消息: ' + JSON.stringify(data));
            switch (data.type) {
                case 'BGM:tokenUpdated':
                    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Token 更新通知');
                    updateTokenStatus();
                    updateUserIdStatus();
                    break;
                case 'BGM:userIdUpdated':
                    bgmLog(LOG_LEVELS.INFO, `[handlers] 收到用户ID更新通知: ${data.userId}`);
                    if (data.userId) {
                        BGM.cache.userId = data.userId;
                        _setBgmUserId(data.userId);
                        bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.userId: ${BGM.cache.userId}`);
                    }
                    updateUserIdStatus();
                    break;
                case 'BGM:userInfoUpdated':
                    bgmLog(LOG_LEVELS.INFO, `[handlers] 收到用户信息更新通知: 用户名=${data.username}, 用户ID=${data.userId}`);
                    if (data.username) {
                        BGM.cache.username = data.username;
                        _setBgmUsername(data.username);
                        bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.username: ${BGM.cache.username}`);
                    }
                    if (data.userId) {
                        BGM.cache.userId = data.userId;
                        _setBgmUserId(data.userId);
                        bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.userId 和用户ID配置: ${BGM.cache.userId}`);
                    }
                    updateUserIdStatus();
                    break;
                case 'tokenUpdated':
                case 'userIdUpdated':
                    // 兼容旧格式
                    if (data.type === 'tokenUpdated') {
                        updateTokenStatus();
                    }
                    else if (data.type === 'userIdUpdated') {
                        updateUserIdStatus();
                    }
                    break;
            }
        });
        bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已注册');
    }
}
// ========== 事件监听（用于接收事件总线通知）==========
function setupEventListeners() {
    eventBus.on(BGM_EVENTS.TOKEN_UPDATED, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 TOKEN_UPDATED 事件');
        updateTokenStatus();
        updateUserIdStatus();
    });
    eventBus.on(BGM_EVENTS.USER_ID_UPDATED, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_ID_UPDATED 事件');
        updateUserIdStatus();
    });
    eventBus.on(BGM_EVENTS.USER_NAME_UPDATED, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_NAME_UPDATED 事件');
        updateUserIdStatus();
    });
    // 配置更新事件（用于同步增量同步和跳过冲突状态）
    eventBus.on(BGM_EVENTS.CONFIG_UPDATED, (data) => {
        if (!isTaskpaneContext())
            return;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 收到 CONFIG_UPDATED 事件: key=${data.key}, value=${data.value}`);
        if (data.key === 'bgm_incremental_sync') {
            bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新增量同步复选框 ==========`);
            tryUpdateIncrementalCheckbox(data.value === 'true');
        }
        else if (data.key === 'bgm_skip_conflicts') {
            bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新跳过冲突 UI ==========`);
            tryUpdateSkipConflictsUI(data.value === 'true');
        }
    });
    // 同步进度事件（全局进度条）
    eventBus.on(BGM_EVENTS.SYNC_PROGRESS, (data) => {
        updateProgressBar(data.current, data.total, data.message);
    });
}
// 尝试更新增量同步复选框（带重试机制）
function tryUpdateIncrementalCheckbox(checked, attempts = 0) {
    if (!isTaskpaneContext())
        return;
    let chkIncremental = document.getElementById('chkIncremental');
    if (chkIncremental) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkIncremental 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkIncremental.checked ? '开启' : '关闭'}`);
        chkIncremental.checked = checked;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步复选框已更新: ${checked ? '开启' : '关闭'}`);
    }
    else if (attempts < 3) { // 最多重试3次
        bgmLog(LOG_LEVELS.WARN, `[handlers] 未找到 chkIncremental 元素，延迟重试 (${attempts + 1}/3)...`);
        setTimeout(() => tryUpdateIncrementalCheckbox(checked, attempts + 1), 100);
    }
    else {
        bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 chkIncremental 元素，放弃更新`);
    }
}
// 尝试更新跳过冲突 UI（带重试机制）
function tryUpdateSkipConflictsUI(skipConflicts, attempts = 0) {
    if (!isTaskpaneContext())
        return;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 目标状态: ${skipConflicts ? '跳过冲突' : 'Excel覆盖'}`);
    let conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 conflictStrategy select 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${conflictStrategySelect.value}`);
        conflictStrategySelect.value = skipConflicts ? 'skip' : 'excel';
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 select 已更新: ${conflictStrategySelect.value}`);
        return;
    }
    else if (attempts < 3) { // 最多重试3次
        bgmLog(LOG_LEVELS.WARN, `[handlers] 未找到 conflictStrategy select 元素，延迟重试 (${attempts + 1}/3)...`);
        setTimeout(() => tryUpdateSkipConflictsUI(skipConflicts, attempts + 1), 100);
        return;
    }
    bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 conflictStrategy select 元素，尝试查找其他控件`);
    // 如果找不到，尝试查找其他类型的控件
    // 备用：查找 radio 按钮
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (skipRadio && overwriteRadio) {
        skipRadio.checked = skipConflicts;
        overwriteRadio.checked = !skipConflicts;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 radio 已更新`);
        return;
    }
    // 备用：如果是 checkbox
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (chkSkipConflicts) {
        chkSkipConflicts.checked = skipConflicts;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突复选框已更新`);
    }
}
// 确保在 DOM 加载完成且模块初始化后执行
function initializeListeners() {
    // 延迟执行，确保 BGM 等对象已初始化
    setTimeout(() => {
        setupMessageListener();
        setupEventListeners();
        initIncrementalSyncFromRibbon();
        bgmLog(LOG_LEVELS.INFO, '[handlers] 所有监听器初始化完成');
    }, 100);
}
// 从配置读取增量同步状态并初始化 checkbox
function initIncrementalSyncFromRibbon() {
    if (!isTaskpaneContext())
        return;
    const chkIncremental = document.getElementById('chkIncremental');
    if (!chkIncremental)
        return;
    try {
        const isIncremental = getIncrementalSync();
        chkIncremental.checked = isIncremental;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取增量同步状态: ${isIncremental ? '开启' : '关闭'}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 读取增量同步状态失败: ${e.message}`);
    }
    // 监听 checkbox 变化，同步到配置
    chkIncremental.addEventListener('change', () => {
        const checked = chkIncremental.checked;
        bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 增量同步状态变更 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 新状态: ${checked ? '开启' : '关闭'}`);
        try {
            const result = setIncrementalSync(checked);
            if (result) {
                bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步状态已成功同步到配置和 Ribbon`);
            }
            else {
                bgmLog(LOG_LEVELS.WARN, `[handlers] 增量同步状态同步失败`);
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[handlers] 更新增量同步状态失败: ${e.message}`);
        }
    });
    // 同时初始化跳过冲突选项
    initSkipConflictsFromRibbon();
}
// 从配置读取跳过冲突状态并初始化 UI
function initSkipConflictsFromRibbon() {
    if (!isTaskpaneContext())
        return;
    try {
        const skipConflicts = getSkipConflicts();
        tryUpdateSkipConflictsUI(skipConflicts);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取跳过冲突状态: ${skipConflicts ? '跳过冲突' : 'Excel覆盖'}`);
    }
    catch (e) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'initSkipConflictsFromRibbon' });
    }
    // 监听冲突策略 select 的变化（侧边栏使用的是 select 下拉框）
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        conflictStrategySelect.addEventListener('change', () => {
            const selectedValue = conflictStrategySelect.value;
            const isSkip = selectedValue === 'skip';
            bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 冲突策略变更 ==========`);
            bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${selectedValue}`);
            bgmLog(LOG_LEVELS.INFO, `[handlers] 策略类型: ${isSkip ? '跳过冲突（保留Bangumi数据）' : 'Excel覆盖（用Excel数据覆盖）'}`);
            const result = setSkipConflicts(isSkip);
            if (result) {
                bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已成功同步到配置和 Ribbon`);
            }
            else {
                bgmLog(LOG_LEVELS.WARN, `[handlers] 冲突策略同步失败`);
            }
        });
        bgmLog(LOG_LEVELS.INFO, `[handlers] 已注册冲突策略 select 变化监听器`);
        return;
    }
    // 备用：查找并监听 radio 按钮
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (skipRadio && overwriteRadio) {
        skipRadio.addEventListener('change', () => {
            if (skipRadio.checked) {
                setSkipConflicts(true);
                bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: 跳过冲突`);
            }
        });
        overwriteRadio.addEventListener('change', () => {
            if (overwriteRadio.checked) {
                setSkipConflicts(false);
                bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: Excel覆盖`);
            }
        });
        return;
    }
    // 备用：如果是 checkbox
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (chkSkipConflicts) {
        chkSkipConflicts.addEventListener('change', () => {
            const checked = chkSkipConflicts.checked;
            try {
                setSkipConflicts(checked);
                bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突状态已更新: ${checked ? '跳过冲突' : 'Excel覆盖'}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[handlers] 更新跳过冲突状态失败: ${e.message}`);
            }
        });
    }
}
function cleanLockedDataSheet() {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[cleanLockedDataSheet] ======== 开始清洗锁定数据表 ========');
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 无法获取工作簿，终止');
        showToast('无法获取工作簿', 'error');
        return;
    }
    if (!BGM.sheet.isLocked || !BGM.sheet.lockedIndex) {
        bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 未锁定数据表，终止');
        showToast('请先锁定数据表', 'warn');
        return;
    }
    const wb = app.ActiveWorkbook;
    const ws = wb.Sheets.Item(BGM.sheet.lockedIndex);
    const sheetName = ws.Name || '未知';
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 锁定工作表: "${sheetName}" (索引: ${BGM.sheet.lockedIndex})`);
    const headerRow = findHeaderRow(ws);
    if (!headerRow) {
        bgmLog(LOG_LEVELS.ERROR, '[cleanLockedDataSheet] 未找到表头行，终止');
        showToast('未找到表头行', 'error');
        return;
    }
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 表头行检测完成: headerRow=${headerRow}`);
    const colMap = getColumnMap(ws, headerRow);
    const nameCol = colMap.get('名称');
    const urlCol = colMap.get('Bangumi_URL');
    const tagsCol = colMap.get('标签/分级');
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 列映射: 名称列=${nameCol}, Bangumi_URL列=${urlCol}, 标签/分级列=${tagsCol}`);
    if (!nameCol) {
        bgmLog(LOG_LEVELS.ERROR, '[cleanLockedDataSheet] 未找到"名称"列，终止');
        showToast('未找到"名称"列', 'error');
        return;
    }
    if (!urlCol) {
        bgmLog(LOG_LEVELS.ERROR, '[cleanLockedDataSheet] 未找到"Bangumi_URL"列，终止');
        showToast('未找到"Bangumi_URL"列', 'error');
        return;
    }
    const lastRow = getLastRow(ws);
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 数据区间: headerRow=${headerRow}, lastRow=${lastRow}, 数据行数=${lastRow - headerRow}`);
    const nameRows = new Map();
    let emptyNameCount = 0;
    for (let row = headerRow + 1; row <= lastRow; row++) {
        const name = String(getCellValue(ws, row, nameCol) || '').trim();
        if (!name) {
            emptyNameCount++;
            continue;
        }
        const rows = nameRows.get(name) || [];
        rows.push(row);
        nameRows.set(name, rows);
    }
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 名称扫描完成: 有效名称=${nameRows.size}个, 空名称行=${emptyNameCount}行`);
    const toDelete = [];
    let mergedTagsCount = 0;
    let duplicateNameCount = 0;
    for (const [name, rows] of nameRows) {
        if (rows.length <= 1)
            continue;
        duplicateNameCount++;
        bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 发现重复名称 "${name}": 位于行 ${rows.join(', ')}`);
        const withUrl = [];
        const withoutUrl = [];
        for (const row of rows) {
            const url = String(getCellValue(ws, row, urlCol) || '').trim();
            (url ? withUrl : withoutUrl).push(row);
        }
        if (withUrl.length === 0) {
            bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet]   名称 "${name}" 的所有行均无 Bangumi_URL，跳过`);
            continue;
        }
        const keepRow = withUrl[0];
        bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet]   保留行: ${keepRow} (有URL), 删除行: ${withoutUrl.join(', ')} (无URL)`);
        if (withUrl.length > 1) {
            bgmLog(LOG_LEVELS.WARN, `[cleanLockedDataSheet]   名称 "${name}" 有 ${withUrl.length} 条含URL的行，仅保留第1条(行${keepRow})`);
        }
        for (const delRow of withoutUrl) {
            if (tagsCol) {
                const delTags = String(getCellValue(ws, delRow, tagsCol) || '').trim();
                if (delTags) {
                    const existingTags = String(getCellValue(ws, keepRow, tagsCol) || '').trim();
                    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet]   合并标签: 行${delRow} -> 行${keepRow}，标签: "${delTags}"`);
                    const tagSet = new Set();
                    for (const t of existingTags.split(/\s*\|\s*/)) {
                        const trimmed = t.trim();
                        if (trimmed)
                            tagSet.add(trimmed);
                    }
                    for (const t of delTags.split(/\s*\|\s*/)) {
                        const trimmed = t.trim();
                        if (trimmed)
                            tagSet.add(trimmed);
                    }
                    const mergedTags = [...tagSet].join(' | ');
                    setCellValue(ws, keepRow, tagsCol, mergedTags);
                    mergedTagsCount++;
                    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet]   合并后标签: "${mergedTags}"`);
                }
            }
            toDelete.push(delRow);
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 统计: 重复名称=${duplicateNameCount}个, 待删除行=${toDelete.length}, 合并标签行=${mergedTagsCount}`);
    if (toDelete.length === 0) {
        bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 未发现需清洗的重复数据，耗时: ${Date.now() - startTime}ms`);
        showToast('未发现需清洗的重复数据', 'info');
        return;
    }
    toDelete.sort((a, b) => b - a);
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 开始删除行 (从后往前): ${toDelete.join(', ')}`);
    for (const row of toDelete) {
        ws.Range(`${row}:${row}`).Delete();
    }
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] ======== 清洗完成: 删除 ${toDelete.length} 行${tagsCol ? `，合并 ${mergedTagsCount} 行标签` : ''}，耗时: ${Date.now() - startTime}ms ========`);
    showToast(`清洗完成：删除 ${toDelete.length} 行${tagsCol ? `，合并 ${mergedTagsCount} 行标签` : ''}`, 'success');
}
// 监听模块初始化完成事件
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeListeners);
    }
    else {
        initializeListeners();
    }
}
