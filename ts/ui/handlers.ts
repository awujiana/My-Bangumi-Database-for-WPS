/**
 * UI 事件处理模块
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、业务对话框
 */

import {
    type BGMUserInfo, type SyncRecord, LOG_LEVELS, bgmLog, BGM,
    loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId, getApp,
    getCell, trim, fetchBgmUserInfo, BGM_COLOR, showAlert, showConfirm,
    showError, showSuccess, showInput, showToast, setStatus,
    verifyToken, fetchAllUserCollections, findHeaderRow, getColumnMap,
    getLastRow, extractSubjectId, getDataSheet, getFilterStatus,
    getSequentialRowsBySeqCol, SyncToBangumiAsync, clearRowColors,
    testSingleUpdate, getOrCreateSyncRecordSheet, getAllSyncRecords,
    addSyncRecord, openSyncRecordSheet, clearSheetMarksInSheet,
    previewSyncContent, refreshData,refreshSheets,toggleSheetLock ,clearSyncRecords,
    closeDetailModal, 
} from '../index.js';5
import{BGM_EVENTS, eventBus} from '../tools/events.js';

//  
import { getSyncPreview, detectConflicts } from '../services/ribbonService.js';
// 本地类型定义
interface FilterStatus {
    hasFilter: boolean;
    visibleRows: number[];
    hiddenRows: number[];
}

interface BangumiCollectionItem {
    subject_id: number;
    subject_type?: number;
    subject?: {
        name_cn?: string;
        name?: string;
    };
}

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
} as const;

// ========== 业务对话框 ==========

export function showTokenDialog(currentToken?: string): void {
    const defaultVal = currentToken || loadBgToken() || '';
    showInput(_T.setBgmToken, _T.inputToken, defaultVal, (value?: string) => {
        if (value) {
            storeBgToken(value);
            updateTokenStatus();
            showToast(_T.tokenSaved, 'success');
           BGM.Message.send({ type: 'tokenUpdated' });
        }
    });
}

export function showUserIdDialog(): void {
    const currentId = _getBgmUserId() || '';
    showInput(_T.setBgmUserId, _T.inputUserId, currentId, (value?: string) => {
        if (value && value.trim() !== '') {
            _setBgmUserId(value.trim());
            updateUserIdStatus();
            showToast(_T.userIdSaved, 'success');
            BGM.Message.send({ type: 'userIdUpdated' });
        }
    });
}

export function updateTokenStatus(): void {
    const tokenStatus = document.getElementById('tokenStatus');
    if (!tokenStatus) return;
    
    const token = loadBgToken();
    if (token && token.length > 10) {
        tokenStatus.style.color = '#4CAF50';
        
        // 如果已经有用户名缓存，直接显示
        if (BGM.cache.username) {
            tokenStatus.textContent = _T.set + ': ' + BGM.cache.username;
        } else {
            tokenStatus.textContent = _T.set + ' (' + token.substring(0, 4) + '...)';
            
            // 尝试获取用户信息（但不阻塞 UI 更新）
            // 注意：这里可能会因为 CORS 失败，但不影响 Token 状态显示
            fetchBgmUserInfo()
                .then((userInfo: BGMUserInfo | null) => {
                    if (userInfo?.username) {
                        tokenStatus.textContent = _T.set + ': ' + userInfo.username;
                        updateUserIdStatus();
                    }
                })
                .catch(() => {
                    // CORS 错误或其他错误，静默处理
                    bgmLog(LOG_LEVELS.DEBUG, '获取用户名失败（CORS或网络错误）');
                });
        }
    } else {
        tokenStatus.textContent = _T.notSet;
        tokenStatus.style.color = '#f44336';
        BGM.cache.userId = null;
        BGM.cache.username = null;
    }
}

export function updateUserIdStatus(): void {
    const userIdStatus = document.getElementById('userIdStatus');
    if (!userIdStatus) return;
    const userId = _getBgmUserId();
    if (userId) {
        const display = BGM.cache.username ? BGM.cache.username + ' (' + userId + ')' : userId;
        userIdStatus.textContent = _T.set + ': ' + display;
        userIdStatus.style.color = '#4CAF50';
    } else {
        userIdStatus.textContent = _T.notSet;
        userIdStatus.style.color = '#f44336';
    }
}

export function openUserCollection(): void {
    const userId = _getBgmUserId();
    if (!userId) {
        showAlert(_T.pleaseSetUserIdFirst);
        return;
    }
    window.open('https://bgm.tv/user/' + userId + '/collection', '_blank');
}

export function testTokenValidity(): void {
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
    bgmLog(LOG_LEVELS.DEBUG, `[testTokenValidity] 请求头: Authorization: Bearer ${token.substring(0, 8)}...`);
    bgmLog(LOG_LEVELS.DEBUG, `[testTokenValidity] 请求头: Content-Type: application/json`);
    
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
            bgmLog(LOG_LEVELS.DEBUG, `[testTokenValidity] 响应头: ${xhr.getAllResponseHeaders()}`);
        }
        
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                bgmLog(LOG_LEVELS.DEBUG, '[testTokenValidity] 响应数据: ' + JSON.stringify(data));
                
                const nickname = data.nickname || data.username || _T.unknownUser;
                const userId = String(data.id || '');
                
                bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] Token 验证成功！用户名: ${nickname}, 用户ID: ${userId}`);
                showSuccess(_T.tokenValid, _T.user + nickname);
                
                _setBgmUserId(userId);
                BGM.cache.username = nickname;
                BGM.setUsername(nickname);
                
            } catch (e: any) {
                bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] 解析响应失败: ${e.message}`);
                showError(_T.parseFailed, _T.cannotParseResponse);
                BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'testTokenValidity' });
            }
        } else if (xhr.status === 401) {
            bgmLog(LOG_LEVELS.WARN, '[testTokenValidity] Token 无效或已过期');
            showError(_T.tokenInvalid, _T.tokenExpired);
        } else {
            bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] Token 验证失败，HTTP 状态码: ${xhr.status}`);
            bgmLog(LOG_LEVELS.DEBUG, `[testTokenValidity] 响应内容: ${xhr.responseText}`);
            showError('错误', `Token验证失败 (HTTP ${xhr.status})`);
        }
    };
    
    xhr.onerror = () => {
        const requestEndTime = Date.now();
        const duration = requestEndTime - requestStartTime;
        
        bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] 请求发生网络错误，耗时: ${duration}ms`);
        bgmLog(LOG_LEVELS.DEBUG, `[testTokenValidity] XHR 状态: ${xhr.readyState}`);
        showError(_T.networkError, _T.cannotConnectBgm);
    };
    
    xhr.ontimeout = () => {
        bgmLog(LOG_LEVELS.WARN, '[testTokenValidity] 请求超时');
    };
    
    bgmLog(LOG_LEVELS.DEBUG, `[testTokenValidity] 正在发送请求...`);
    xhr.send();
}

export function testDebugConnection(): void {
    if (typeof (window as any).Application !== 'undefined') {
        showToast(_T.debugConnOk, 'success');
    } else {
        showToast(_T.debugConnFail, 'error');
    }
}

// ========== 面板操作分发 ==========

export function onAction(action: string): void {
    switch (action) {
        case 'sync':
            syncFromPanel();
            break;
        case 'test':
            if (typeof testSingleUpdate === 'function') testSingleUpdate();
            break;
        case 'clear':
           case 'clear':
                     showConfirm(_T.confirmClearMarks, (confirmed) => {
                         if (confirmed) {
                             if (typeof clearRowColors === 'function') clearRowColors();
                             if (typeof refreshData === 'function') refreshData();
                         }
                     });
                    break;
        case 'setToken':
            showTokenDialog(loadBgToken() || '');
            break;
        case 'preview':
            if (typeof previewSyncContent === 'function') previewSyncContent();
            break;
        case 'showUserIdDialog':
            showUserIdDialog();
            break;
        case 'showClearConfirm':
            showConfirm(_T.confirmClearMarks, (confirmed) => {
                if (confirmed) {
                    if (typeof clearRowColors === 'function') clearRowColors();
                    if (typeof refreshData === 'function') refreshData();
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

export async function syncFromPanel(): Promise<void> {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] ========== 开始执行同步操作 ==========');

    // 1. 检查必要函数是否加载
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤1: 检查必要函数是否加载');
    if (typeof findHeaderRow !== 'function' || typeof getColumnMap !== 'function' || typeof getLastRow !== 'function') {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 必要函数未加载完成');
        showAlert(_T.loadingWait);
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（函数未加载），耗时: ${Date.now() - startTime}ms`);
        return;
    }

    // 2. 检查 Token
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤2: 检查 Token');
    const token = loadBgToken();
    if (!token) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] Token 未设置');
        showAlert(_T.pleaseSetBgmToken);
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（Token未设置），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    bgmLog(LOG_LEVELS.DEBUG, `[syncFromPanel] Token 已设置（长度: ${token.length}）`);

    // 3. 确保同步记录工作表存在并激活
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤3: 确保同步记录工作表存在');
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        const syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 同步记录工作表已创建/获取');
            try { 
                (syncSheet as any).Activate(); 
                bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 同步记录工作表已激活');
            } catch (e: any) {
                bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 激活同步记录工作表失败: ${e.message}`);
                BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'syncFromPanel' });
            }
        }
    }

    // 4. 获取应用和工作表对象
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤4: 获取应用和工作表对象');
    const app = getApp();
    if (!app?.ActiveWorkbook) { 
        bgmLog(LOG_LEVELS.ERROR, '[syncFromPanel] 无法获取 Application 对象');
        showAlert('无法获取 Application 对象！'); 
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（无法获取Application），耗时: ${Date.now() - startTime}ms`);
        return; 
    }
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] Application 对象获取成功');

    const ws = getDataSheet();
    if (!ws) { 
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到数据工作表');
        showAlert('未找到数据工作表，请先锁定工作表。'); 
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（未找到数据工作表），耗时: ${Date.now() - startTime}ms`);
        return; 
    }
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 数据工作表获取成功');

    // 5. 解析表头和列映射
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤5: 解析表头和列映射');
    const headerRow = findHeaderRow(ws);
    bgmLog(LOG_LEVELS.DEBUG, `[syncFromPanel] 表头行: ${headerRow}`);
    
    const lastRow = getLastRow(ws);
    bgmLog(LOG_LEVELS.DEBUG, `[syncFromPanel] 最后一行: ${lastRow}`);
    
    const colMap = getColumnMap(ws, headerRow);
    bgmLog(LOG_LEVELS.DEBUG, `[syncFromPanel] 列映射完成，共 ${colMap.size} 列`);
    
    if (!colMap.has("Bangumi_URL")) { 
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到 Bangumi_URL 列');
        showAlert('未找到 "Bangumi URL" 列！'); 
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（缺少Bangumi_URL列），耗时: ${Date.now() - startTime}ms`);
        return; 
    }

    // 6. 增量同步开关（提前读取）
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤6: 检查增量同步设置');
    const incremental = (document.getElementById('chkIncremental') as HTMLInputElement)?.checked ?? false;
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 增量同步: ${incremental ? '开启' : '关闭'}`);

    // 构建增量同步的指纹映射
    let fingerprintMap: Map<string, string> | undefined;
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
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤7: 获取同步预览统计');
    const preview = getSyncPreview(ws, colMap, lastRow, headerRow, { incremental, fingerprintMap });
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 数据预览 - 总行数: ${preview.total}, 有效: ${preview.valid}, 已上传: ${preview.alreadyUploaded}, 待同步: ${preview.willSync}, 跳过: ${preview.willSkip}, 无URL: ${preview.noUrl}, 空状态: ${preview.emptyStatus}, 增量跳过: ${preview.incrementalSkipped}`);

    // 8. 冲突检测与策略
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤8: 冲突检测');
    const conflictSelect = document.getElementById('conflictStrategy') as HTMLSelectElement;
    const conflictStrategy = conflictSelect?.value || 'skip';
    bgmLog(LOG_LEVELS.DEBUG, `[syncFromPanel] 冲突策略: ${conflictStrategy}`);

    let conflictSids: Set<string> | undefined = undefined;
    let conflictMsg = '';
    try {
        bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 开始检测冲突...');
        const { conflicts, conflictCount } = await detectConflicts(ws, colMap, lastRow, headerRow, token);
        if (conflictCount > 0) {
            bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 检测到 ${conflictCount} 条冲突`);
            if (conflictStrategy === 'skip') {
                conflictSids = new Set(conflicts.map(c => c.sid));
                conflictMsg = `检测到 ${conflictCount} 条冲突，已选择【跳过冲突】。\n\n`;
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突处理策略: 跳过 ${conflictCount} 条冲突条目`);
            } else {
                conflictMsg = `检测到 ${conflictCount} 条冲突，将使用【Excel数据覆盖】。\n\n`;
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突处理策略: 使用Excel数据覆盖 ${conflictCount} 条冲突`);
            }
        } else {
            bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 未检测到冲突');
        }
    } catch (e: any) {
        bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 冲突检测失败: ${e.message}`);
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'syncFromPanel' });
    }

    // 9. 确认对话框
    bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 步骤9: 显示确认对话框');
    const msg = `数据预览：
            总行数：${preview.total}
            有效条目：${preview.valid}
            已上传（跳过）：${preview.alreadyUploaded}
            待同步：${preview.willSync}
            不上传（状态跳过）：${preview.willSkip}
            无URL：${preview.noUrl}
            空状态：${preview.emptyStatus}
            ${incremental ? `增量跳过：${preview.incrementalSkipped}\n` : ''}${conflictMsg}是否继续同步？`;

    const confirmed = await new Promise<boolean>(resolve => {
        showConfirm(msg, (confirmed) => resolve(confirmed));
    });
    if (!confirmed) {
        bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 用户取消同步');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（用户取消），耗时: ${Date.now() - startTime}ms`);
        return;
    }

    // 10. 执行同步
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤10: 开始执行同步');
    showStopButton(); // 显示停止按钮
    try {
        bgmLog(LOG_LEVELS.DEBUG, '[syncFromPanel] 调用 SyncToBangumiAsync...');
        const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
            skipSids: conflictSids,
            incremental,
            onProgress: (current: number, total: number, message: string) => {
                updateProgressBar(current, total, message);
                if (app.StatusBar !== undefined) {
                    app.StatusBar = `[${current}/${total}] ${message}`;
                }
                bgmLog(LOG_LEVELS.DEBUG, `[syncFromPanel] 同步进度: ${current}/${total} - ${message}`);
            }
        });
        resetProgressBar();
        hideStopButton(); // 隐藏停止按钮
        if (app.StatusBar !== undefined) app.StatusBar = false;
        
        // 检查是否被用户停止
        if (result.stopped) {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步已被用户停止！成功: ${result.success}, 失败: ${result.fail}, 跳过: ${result.skip}`);
            showAlert(`同步已停止！成功 ${result.success} 条，失败 ${result.fail} 条，跳过 ${result.skip} 条\n\n注意：已同步的数据不会回滚。`);
        } else {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步完成！成功: ${result.success}, 失败: ${result.fail}, 跳过: ${result.skip}`);
            showAlert(`同步完成！成功 ${result.success} 条，失败 ${result.fail} 条，跳过 ${result.skip} 条`);
        }
    } catch (err: any) {
        resetProgressBar();
        hideStopButton(); // 隐藏停止按钮
        if (app.StatusBar !== undefined) app.StatusBar = false;
        bgmLog(LOG_LEVELS.ERROR, `[syncFromPanel] 同步失败: ${err.message}`);
        BGM.handleError(err, { context: 'syncFromPanel', showAlert: true });
    }
    
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] ========== 同步操作结束，总耗时: ${Date.now() - startTime}ms ==========`);
}

// 进度条辅助函数
function updateProgressBar(current: number, total: number, message: string): void {
    const container = document.getElementById('syncProgress');
    const bar = document.getElementById('progressBar');
    const text = document.getElementById('progressText');
    if (container) container.style.display = 'block';
    if (bar) {
        const percent = Math.round((current / total) * 100);
        bar.style.width = percent + '%';
        bar.textContent = percent + '%';
    }
    if (text) text.textContent = message;
}

function resetProgressBar(): void {
    const container = document.getElementById('syncProgress');
    const bar = document.getElementById('progressBar');
    if (container) container.style.display = 'none';
    if (bar) { bar.style.width = '0%'; bar.textContent = ''; }
    const text = document.getElementById('progressText');
    if (text) text.textContent = '';
}

// 显示/隐藏停止按钮
export function showStopButton(): void {
    const syncBtn = document.getElementById('syncBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (syncBtn) syncBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';
    bgmLog(LOG_LEVELS.DEBUG, '[handlers] 停止按钮已显示，同步按钮已隐藏');
}

export function hideStopButton(): void {
    const syncBtn = document.getElementById('syncBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (syncBtn) syncBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
    bgmLog(LOG_LEVELS.DEBUG, '[handlers] 停止按钮已隐藏，同步按钮已显示');
}

export function testSingleUpdateFromPanel(): void {
    if (typeof findHeaderRow !== 'function') {
        setTimeout(testSingleUpdateFromPanel, 500);
        return;
    }
    const token = loadBgToken();
    if (!token) { showAlert(_T.pleaseSetBgmToken); return; }
    if (typeof testSingleUpdate === 'function') testSingleUpdate();
}

// ========== 从BGM同步收藏标记 ==========

export async function syncCollectionFromBgm(): Promise<void> {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncCollectionFromBgm] ========== 开始从 BGM 同步收藏标记 ==========');
    
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null;
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value || '') || 1;
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 目标工作表索引: ${sheetIndex}`);
    
    const token = loadBgToken();
    if (!token) { 
        bgmLog(LOG_LEVELS.WARN, '[syncCollectionFromBgm] Token 未设置');
        showAlert(_T.pleaseSetBgmToken); 
        bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 操作终止（Token未设置），耗时: ${Date.now() - startTime}ms`);
        return; 
    }
    bgmLog(LOG_LEVELS.DEBUG, `[syncCollectionFromBgm] Token 已设置（长度: ${token.length}）`);
    
    try {
        bgmLog(LOG_LEVELS.DEBUG, '[syncCollectionFromBgm] 调用 syncFromBgmByAPI...');
        await syncFromBgmByAPI(sheetIndex);
        bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 同步完成，耗时: ${Date.now() - startTime}ms`);
    } catch (e: any) {
        bgmLog(LOG_LEVELS.ERROR, `[syncCollectionFromBgm] 同步失败: ${e.message}`);
        BGM.handleError(e, { context: 'syncCollectionFromBgm', showAlert: true });
    }
    
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] ========== 操作结束，总耗时: ${Date.now() - startTime}ms ==========`);
}

export async function syncFromBgmByAPI(sheetIndex: number): Promise<void> {
    const token = loadBgToken();
    if (!token) { showAlert(_T.pleaseSetBgmToken); showTokenDialog(''); return; }
    showConfirm(
        '将 从 BGM API 获取你的收藏列表，并在 D 列标记已收藏的条目，同时写入同步记录表。\n\n是否继续？',
        async (confirmed) => {
            if (confirmed) {
                await _doAPISync(sheetIndex, token);
            }
        }
    );
}

async function _doAPISync(sheetIndex: number, token: string): Promise<void> {
    setStatus('正在获取收藏列表...', 'info');
    try {
        if (typeof getOrCreateSyncRecordSheet === 'function') {
            const syncSheet = getOrCreateSyncRecordSheet();
            if (!syncSheet) { showAlert('创建同步记录表失败'); return; }
        }

        const app = getApp();
        if (!app?.ActiveWorkbook) { showAlert('无法获取 Application'); return; }
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);

        const headerRow = typeof findHeaderRow === 'function' ? findHeaderRow(ws) : 1;
        const colMap = typeof getColumnMap === 'function' ? getColumnMap(ws, headerRow) : new Map<string, number>();
        if (!colMap.has('Bangumi_URL')) { showAlert('未找到 Bangumi URL 列！'); return; }

        const lastRow = typeof getLastRow === 'function' ? getLastRow(ws) : 200;
        let rowsToProcess: number[] = [];
        if (typeof getFilterStatus === 'function') {
            const filterStatus = getFilterStatus(lastRow);
            rowsToProcess = filterStatus?.visibleRows ?? [];
        }
        if (rowsToProcess.length === 0) {
            for (let r = headerRow + 1; r <= lastRow; r++) rowsToProcess.push(r);
        }

        if (rowsToProcess.length === 0) { showAlert('没有需要处理的数据行！'); return; }

        setStatus('正在验证 Token...', 'info');
        const verifyResult = await verifyToken(token);
        if (!verifyResult.valid) { showAlert('✘ ' + verifyResult.message); return; }
        _setBgmUserId(verifyResult.userId || '');

        setStatus('正在获取收藏列表...', 'info');
        const userCollections = await fetchAllUserCollections(token) ;

        const collectionMap = new Map<string, BangumiCollectionItem>();
        userCollections.forEach(c => collectionMap.set(String(c.subject_id), c));

        let syncRecords: SyncRecord[] = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
        const syncCountMap = new Map<string, number>();
        syncRecords.forEach(r => syncCountMap.set(String(r.sid || ''), (syncCountMap.get(String(r.sid || '')) || 0) + 1));

        const BGM_SUBJECT_TYPES: Record<number, string> = (window as any).BGM_SUBJECT_TYPES || { 1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '真人剧' };

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
            const bgmUrlCell = colMap.has('Bangumi_URL') ? getCell(ws, row, colMap.get('Bangumi_URL')!) : null;
            const bgmUrl = bgmUrlCell ? trim(String((bgmUrlCell as any).Value() || '')) : '';
            const sid = typeof extractSubjectId === 'function' ? extractSubjectId(bgmUrl) : '';
            if (sid && collectionMap.has(sid)) {
                const seqCol = colMap.get('序列号') || 9;
                const seqCell = getCell(ws, row, seqCol);
                if (seqCell && (seqCell as any).Interior) {
                    const syncCount = syncCountMap.get(sid) || 0;
                    (seqCell as any).Interior.Color = syncCount === 1 ? BGM_COLOR.BGM_SYNC :
                        syncCount === 2 ? BGM_COLOR.LIGHT_GREEN : BGM_COLOR.DARK_GREEN;
                }
                matchedCount++;
            }
        }
        showAlert(`同步完成！\n\n已匹配 ${matchedCount} 条`, _T.syncComplete);
    } catch (e: any) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: '_doAPISync' });
        showAlert(_T.syncFailed + (e as Error).message, _T.syncFailed);
        setStatus(_T.syncFailed, 'error');
    }
}

export async function markUploadedItems(sheetIndexOrName: number | string, collections?: unknown[]): Promise<void> {
    if (typeof sheetIndexOrName === 'string' && collections === undefined) {
        const sheetName = sheetIndexOrName;
        const token = loadBgToken(); if (!token) { showAlert(_T.pleaseSetTokenFirst); return; }
        const userId = _getBgmUserId(); if (!userId) { showAlert(_T.pleaseSetUserIdFirst + '！'); return; }
        const app = getApp();
        let targetIndex: number | null = null;
        if (app?.ActiveWorkbook) {
            for (let i = 1; i <= app.ActiveWorkbook.Worksheets.Count; i++) {
                if (app.ActiveWorkbook.Worksheets.Item(i).Name === sheetName) { targetIndex = i; break; }
            }
        }
        if (targetIndex === null) { showAlert(_T.sheetNotFound + sheetName); return; }
        const cols = await fetchAllUserCollections(token, userId);
        if (cols?.length) {
            showToast(_T.marksToSheet + cols.length + _T.marksToSheetSuffix + sheetName, 'success');
        }
        return;
    }
    // 无操作
}

export function clearSheetMarks(sheetIndexOrName: number | string): void {
    if (typeof clearSheetMarksInSheet !== 'function') {
        bgmLog(LOG_LEVELS.ERROR, '[clearSheetMarks] clearSheetMarksInSheet 函数不可用');
        return;
    }
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.ERROR, '[clearSheetMarks] 无法获取活动工作簿');
        return;
    }

    // 处理 "当前" 工作表
    if (sheetIndexOrName === '当前') {
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (ws) {
            // 遍历查找当前工作表的索引
            let sheetIndex = -1;
            for (let i = 1; i <= app.ActiveWorkbook.Worksheets.Count; i++) {
                const currentWs = app.ActiveWorkbook.Worksheets.Item(i);
                if (currentWs.Name === ws.Name) {
                    sheetIndex = i;
                    break;
                }
            }
            if (sheetIndex > 0) {
                bgmLog(LOG_LEVELS.INFO, `[clearSheetMarks] 使用当前活动工作表: "${ws.Name}" (索引: ${sheetIndex})`);
                clearSheetMarksInSheet(sheetIndex);
                return;
            } else {
                bgmLog(LOG_LEVELS.ERROR, `[clearSheetMarks] 无法找到当前工作表 "${ws.Name}" 的索引`);
                return;
            }
        } else {
            bgmLog(LOG_LEVELS.ERROR, '[clearSheetMarks] 无法获取当前活动工作表');
            return;
        }
    }

    if (typeof sheetIndexOrName === 'string') {
        bgmLog(LOG_LEVELS.INFO, `[clearSheetMarks] 查找工作表名称: "${sheetIndexOrName}"`);
        for (let i = 1; i <= app.ActiveWorkbook.Worksheets.Count; i++) {
            const ws = app.ActiveWorkbook.Worksheets.Item(i);
            const wsName = ws?.Name || `Sheet${i}`;
            bgmLog(LOG_LEVELS.DEBUG, `[clearSheetMarks] 检查工作表 ${i}: "${wsName}"`);
            if (ws && ws.Name === sheetIndexOrName) {
                bgmLog(LOG_LEVELS.INFO, `[clearSheetMarks] 找到匹配的工作表: "${wsName}" (索引: ${i})`);
                clearSheetMarksInSheet(i);
                return;
            }
        }
        bgmLog(LOG_LEVELS.WARN, `[clearSheetMarks] 未找到工作表: "${sheetIndexOrName}"`);
    } else {
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndexOrName);
        const wsName = ws?.Name || `Sheet${sheetIndexOrName}`;
        bgmLog(LOG_LEVELS.INFO, `[clearSheetMarks] 使用工作表索引: ${sheetIndexOrName} (名称: "${wsName}")`);
        clearSheetMarksInSheet(sheetIndexOrName);
    }
}

// ========== 事件监听 ==========

function setupButtonListeners(): void {
    document.querySelectorAll('[data-action]').forEach(button => {
        button.removeEventListener('click', handleActionClick);
        button.addEventListener('click', handleActionClick);
    });
}

function handleActionClick(event: Event): void {
    const target = event.currentTarget as HTMLElement;
    const action = target.dataset.action;
    if (!action) return;

    // 解析可能的参数（如：<button data-action="markUploadedItems" data-args='["动画"]'>）
    let args: string[] = [];
    if (target.dataset.args) {
        try { args = JSON.parse(target.dataset.args); } catch (e: any) {
            BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'handleActionClick' });
        }
    }

    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] ========== 按钮点击事件 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 操作类型: ${action}`);
    if (args.length > 0) {
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 参数: ${JSON.stringify(args)}`);
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
            } else {
                bgmLog(LOG_LEVELS.WARN, '[handleActionClick] testSingleUpdate 函数未定义');
            }
            break;
            
        case 'clear':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行清除标记');
            showConfirm(_T.confirmClearMarks, (confirmed) => {
                if (confirmed) {
                    bgmLog(LOG_LEVELS.DEBUG, '[handleActionClick] 用户确认清除标记');
                    if (typeof clearRowColors === 'function') clearRowColors();
                    if (typeof refreshData === 'function') refreshData();
                    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 清除标记完成，耗时: ${Date.now() - startTime}ms`);
                } else {
                    bgmLog(LOG_LEVELS.DEBUG, '[handleActionClick] 用户取消清除标记');
                }
            });
            break;
            
        case 'previewSyncContent':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行预览同步内容');
            if (typeof previewSyncContent === 'function') {
                previewSyncContent();
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 预览同步内容已触发，耗时: ${Date.now() - startTime}ms`);
            } else {
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
            
        case 'markUploadedItems':
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 标记已上传项目，类型: ${args[0] || '全部'}`);
            markUploadedItems(args[0]);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 已上传项目标记完成，耗时: ${Date.now() - startTime}ms`);
            break;
            
        case 'clearSheetMarks':
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 清除工作表标记，工作表: ${args[0] || '当前'}`);
            clearSheetMarks(args[0]);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 工作表标记清除完成，耗时: ${Date.now() - startTime}ms`);
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
} else {
    setTimeout(setupButtonListeners, 0);
}

// ========== 消息监听（用于接收来自 Ribbon 的通知）==========
function setupMessageListener(): void {
    if (typeof window !== 'undefined') {
        window.addEventListener('message', (event: MessageEvent) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            
            bgmLog(LOG_LEVELS.DEBUG, '[handlers] 收到消息: ' + JSON.stringify(data));
            
            switch (data.type) {
                case 'BGM:tokenUpdated':
                    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Token 更新通知');
                    updateTokenStatus();
                    updateUserIdStatus();
                    break;
                case 'BGM:userIdUpdated':
                    updateUserIdStatus();
                    break;
                case 'BGM:userInfoUpdated':
                    updateUserIdStatus();
                    break;
                case 'tokenUpdated':
                case 'userIdUpdated':
                    // 兼容旧格式
                    if (data.type === 'tokenUpdated') {
                        updateTokenStatus();
                    } else if (data.type === 'userIdUpdated') {
                        updateUserIdStatus();
                    }
                    break;
            }
        });
        
        bgmLog(LOG_LEVELS.DEBUG, '[handlers] 消息监听器已注册');
    }
}

// ========== 事件监听（用于接收事件总线通知）==========
function setupEventListeners(): void {
    eventBus.on(BGM_EVENTS.TOKEN_UPDATED, () => {
        bgmLog(LOG_LEVELS.DEBUG, '[handlers] 收到 TOKEN_UPDATED 事件');
        updateTokenStatus();
        updateUserIdStatus();
    });
    
    eventBus.on(BGM_EVENTS.USER_ID_UPDATED, () => {
        bgmLog(LOG_LEVELS.DEBUG, '[handlers] 收到 USER_ID_UPDATED 事件');
        updateUserIdStatus();
    });
    
    eventBus.on(BGM_EVENTS.USER_NAME_UPDATED, () => {
        bgmLog(LOG_LEVELS.DEBUG, '[handlers] 收到 USER_NAME_UPDATED 事件');
        updateUserIdStatus();
    });
    
    // 同步进度事件（全局进度条）
    eventBus.on(BGM_EVENTS.SYNC_PROGRESS, (data: { current: number; total: number; message: string }) => {
        updateProgressBar(data.current, data.total, data.message);
    });
}

// 确保在 DOM 加载完成且模块初始化后执行
function initializeListeners(): void {
    // 延迟执行，确保 BGM 等对象已初始化
    setTimeout(() => {
        setupMessageListener();
        setupEventListeners();
        initIncrementalSyncFromRibbon();
        bgmLog(LOG_LEVELS.DEBUG, '[handlers] 所有监听器初始化完成');
    }, 100);
}

// 从 Ribbon 读取增量同步状态并初始化 checkbox
function initIncrementalSyncFromRibbon(): void {
    const app = (window as any).Application;
    const chkIncremental = document.getElementById('chkIncremental') as HTMLInputElement;
    if (!chkIncremental) return;

    try {
        const isIncremental = app?.PluginStorage?.getItem('bgm_incremental_sync') === 'true';
        chkIncremental.checked = isIncremental;
        bgmLog(LOG_LEVELS.DEBUG, `[handlers] 从 Ribbon 读取增量同步状态: ${isIncremental ? '开启' : '关闭'}`);
    } catch (e: any) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 读取增量同步状态失败: ${e.message}`);
    }

    // 监听 checkbox 变化，同步到 PluginStorage
    chkIncremental.addEventListener('change', () => {
        const checked = chkIncremental.checked;
        try {
            app?.PluginStorage?.setItem('bgm_incremental_sync', checked ? 'true' : 'false');
            bgmLog(LOG_LEVELS.DEBUG, `[handlers] 增量同步状态已同步到 Ribbon: ${checked ? '开启' : '关闭'}`);
        } catch (e: any) {
            bgmLog(LOG_LEVELS.WARN, `[handlers] 同步增量同步状态失败: ${e.message}`);
        }
    });
}

// 监听模块初始化完成事件
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeListeners);
    } else {
        initializeListeners();
    }
}