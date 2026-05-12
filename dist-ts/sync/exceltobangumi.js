/**
 * @fileoverview Excel到Bangumi同步模块 (优化版)
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 * @author BGM Development Team
 * @version 1.1.0
 */
import { URL_PATTERNS, WATCH_STATUS_MAP, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, SYNC_STATUS, bgmLog, getApp, readCell, getCell, trim, getColumnMap, getLastRow, findHeaderRow, getCellValue, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId, BGM, wpsMsgBox, _getUserApiPath, readRangeValues, delay, calcFingerprint, getAllSyncRecords, isWpsWorksheet } from '../index.js';
import { getOrCreateSyncRecordSheet, addSyncRecord } from './syncRecord.js';
import { showAlert, showSuccess, showError } from '../ui/dialog.js';
// ========== 常量定义 ==========
/** 需要批量读取的列名（用于性能优化） */
const BATCH_READ_COLUMNS = [
    'Bangumi_URL', '名称', '是否看完', '状态', '观看状态', '打分',
    '标签/分级', '完播日', '类别', '剧透/感言', '集号', '集数'
];
/** 观看状态类型名称映射 */
const TYPE_NAMES = {
    1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃'
};
/** 默认并发请求数 */
const DEFAULT_CONCURRENCY = 5;
/** 请求最小间隔（毫秒） */
const MIN_REQUEST_INTERVAL = 100;
// ========== 辅助函数 ==========
/**
 * 获取单元格的字符串值（兼容原始 readCell，但增加空值处理）
 */
function getCellString(ws, row, col, fallback = '') {
    const val = readCell(ws, row, col);
    return val !== null && val !== undefined ? String(val).trim() : fallback;
}
/**
 * 从批量读取的数据缓存中快速获取字段值
 */
function createFieldGetter(allData, colMap, startRow, ws) {
    return (row, key) => {
        const col = colMap.get(key);
        if (!col)
            return '';
        const rowIdx = row - startRow;
        if (allData && rowIdx >= 0 && rowIdx < allData.length) {
            const rowData = allData[rowIdx];
            if (Array.isArray(rowData) && col - 1 < rowData.length) {
                return trim(rowData[col - 1]);
            }
        }
        // 回退到逐单元格读取
        return colMap.has(key) ? trim(getCellValue(ws, row, colMap.get(key))) : '';
    };
}
/**
 * 检查单元格是否已标记为成功（颜色判断）
 */
function isCellMarkedSuccess(ws, row, colMap) {
    try {
        const seqCol = colMap.get('序列号') || 9;
        const cell = getCell(ws, row, seqCol);
        if (!cell?.Interior)
            return false;
        const color = cell.Interior.Color;
        return color === BGM_COLOR.SUCCESS ||
            color === BGM_COLOR.LIGHT_GREEN ||
            color === BGM_COLOR.DARK_GREEN;
    }
    catch {
        return false;
    }
}
/**
 * 标记单元格同步结果颜色
 */
function markCellColor(ws, row, status, colMap) {
    const seqCol = colMap.get('序列号') || 9;
    const cell = getCell(ws, row, seqCol);
    if (cell?.Interior) {
        cell.Interior.Color = status === 'success' ? BGM_COLOR.SUCCESS : BGM_COLOR.FAIL;
    }
}
// ========== 公开函数 ==========
/**
 * 打开Bangumi Token申请页面
 */
export function openBangumiTokenPage() {
    window.open('https://bgm.tv/dev/app', '_blank');
}
/**
 * 测试Token有效性（Ribbon版本）
 */
export function testTokenValidityForRibbon(token) {
    const testToken = token || loadBgToken();
    if (!testToken) {
        showAlert('请先设置 Token！', '提示');
        return;
    }
    const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`;
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 开始测试 Token`);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.setRequestHeader('Authorization', `Bearer ${testToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
        const duration = Date.now() - startTime;
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                const nickname = data.nickname || data.username || '未知用户';
                const userId = String(data.id || '未知ID');
                showSuccess(`Token有效！\n\n用户名: ${nickname}\n用户ID: ${userId}`, '验证成功');
                _setBgmUserId(userId);
                BGM.cache.username = nickname;
                notifyUserInfoUpdated(nickname, userId);
            }
            catch (e) {
                showError('Token有效，但解析响应失败', '错误');
            }
        }
        else if (xhr.status === 401) {
            showError('Token无效或已过期，请重新获取', '验证失败');
        }
        else {
            showError(`Token验证失败 (HTTP ${xhr.status})`, '错误');
        }
    };
    xhr.onerror = () => showError('网络错误，无法验证Token', '错误');
    xhr.ontimeout = () => showError('请求超时', '错误');
    xhr.send();
}
function notifyUserInfoUpdated(username, userId) {
    try {
        BGM.setUserId(userId);
        BGM.setUsername(username);
        if (typeof window !== 'undefined' && window.parent) {
            window.parent.postMessage({
                type: 'BGM:userInfoUpdated',
                username, userId, timestamp: Date.now()
            }, '*');
        }
    }
    catch (e) { /* ignore */ }
}
export function openUserCollection() {
    const userId = _getBgmUserId();
    if (!userId) {
        wpsMsgBox('请先设置用户ID！', 0, 48);
        return;
    }
    window.open(`https://bgm.tv/user/${userId}/collection`, '_blank');
}
export function extractSubjectId(input) {
    if (!input)
        return '';
    const trimmed = trim(input);
    if (/^\d+$/.test(trimmed))
        return trimmed;
    for (const pattern of URL_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match?.[1])
            return match[1];
    }
    const numMatch = trimmed.match(/\d+/);
    return numMatch ? numMatch[0] : '';
}
export function mapWatchStatus(status) {
    if (!status)
        return 1;
    const normalized = trim(status).toLowerCase();
    if (WATCH_STATUS_MAP[normalized] !== undefined)
        return WATCH_STATUS_MAP[normalized];
    for (const [key, value] of Object.entries(WATCH_STATUS_MAP)) {
        if (normalized.includes(key) || key.includes(normalized))
            return value;
    }
    if (normalized === 'true')
        return 3;
    if (normalized === 'false')
        return 0;
    const num = parseInt(normalized, 10);
    if (!isNaN(num) && num >= 0 && num <= 5)
        return num;
    bgmLog(LOG_LEVELS.WARN, `[mapWatchStatus] 无法识别的状态值: "${status}"，返回 0`);
    return 0;
}
export function addTagsFromStr(tagSet, raw) {
    if (!raw)
        return;
    raw.split(/[|,;，；]/).forEach(part => {
        const tag = part.trim();
        if (tag && !['|', ',', ';', '，', '；'].includes(tag)) {
            tagSet.add(tag);
        }
    });
}
export function buildTagsArray(tagsRaw) {
    const tagSet = new Set();
    addTagsFromStr(tagSet, tagsRaw);
    return Array.from(tagSet);
}
export function getFilterStatus(lastRow, headerRow) {
    const result = { hasFilter: false, visibleRows: [], hiddenRows: [] };
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return result;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!isWpsWorksheet(ws))
            return result;
        let autoFilterMode = false;
        try {
            autoFilterMode = !!ws.AutoFilterMode;
        }
        catch { /* ignore */ }
        if (!autoFilterMode)
            return result;
        result.hasFilter = true;
        let filterRange = null;
        try {
            if (ws.AutoFilter?.Range)
                filterRange = ws.AutoFilter.Range;
        }
        catch { /* ignore */ }
        let scanRange;
        if (filterRange) {
            scanRange = filterRange;
        }
        else {
            const maxRow = (lastRow && lastRow > 0) ? lastRow : ws.Rows.Count;
            let lastUsedRow = maxRow;
            try {
                const bottomCell = ws.Range(`A${maxRow}`);
                const endCell = bottomCell.End(-4162);
                if (endCell && endCell.Row > 0)
                    lastUsedRow = endCell.Row;
            }
            catch { /* ignore */ }
            scanRange = ws.Range(`A1:A${lastUsedRow}`);
        }
        let visibleCells = null;
        try {
            visibleCells = scanRange.SpecialCells(12);
        }
        catch { /* ignore */ }
        const rawRows = new Set();
        if (visibleCells) {
            const areas = [];
            try {
                if (visibleCells.Areas) {
                    for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                        areas.push(visibleCells.Areas.Item(a));
                    }
                }
                else {
                    areas.push(visibleCells);
                }
            }
            catch {
                areas.push(visibleCells);
            }
            for (const area of areas) {
                const rows = area.Rows;
                for (let r = 1; r <= rows.Count; r++) {
                    rawRows.add(rows.Item(r).Row);
                }
            }
        }
        for (const r of rawRows) {
            if (headerRow != null && r === headerRow)
                continue;
            result.visibleRows.push(r);
        }
        result.visibleRows.sort((a, b) => a - b);
    }
    catch (e) {
        BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
    }
    return result;
}
export function getSequentialRowsBySeqCol(startRow, endRow) {
    const result = { validRows: [], seqMap: new Map() };
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return result;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws)
            return result;
        for (let r = startRow; r <= endRow; r++) {
            const val = readCell(ws, r, 4);
            if (val && val !== undefined && val !== '') {
                const seqNum = String(val).trim();
                if (/^\d+$/.test(seqNum)) {
                    result.validRows.push(r);
                    result.seqMap.set(seqNum, r);
                }
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
    }
    return result;
}
export function buildJsonPayload(ws, rowNum, colMap, finishedDate) {
    const payload = {};
    try {
        // 观看状态
        const statusKeys = ['是否看完', '状态', '观看状态', '收藏类型', 'type'];
        let statusFound = false;
        for (const key of statusKeys) {
            if (colMap.has(key)) {
                const rawVal = trim(readCell(ws, rowNum, colMap.get(key)));
                if (rawVal) {
                    const mapped = mapWatchStatus(rawVal);
                    if (mapped > 0) {
                        payload.type = mapped;
                        statusFound = true;
                        break;
                    }
                }
            }
        }
        if (!statusFound)
            payload.type = 1;
        // 评分
        if (colMap.has('打分')) {
            const rateVal = trim(readCell(ws, rowNum, colMap.get('打分')));
            if (rateVal && rateVal !== 'true' && rateVal !== 'True') {
                const rate = parseFloat(rateVal);
                if (!isNaN(rate) && rate >= 0 && rate <= 10)
                    payload.rate = rate;
            }
        }
        // 标签
        if (colMap.has('标签/分级')) {
            const tagsVal = trim(readCell(ws, rowNum, colMap.get('标签/分级')));
            if (tagsVal)
                payload.tags = buildTagsArray(tagsVal);
        }
        // 感言
        const commentKey = colMap.has('剧透/感言') ? '剧透/感言' : '感言';
        if (colMap.has(commentKey)) {
            const commentVal = trim(readCell(ws, rowNum, colMap.get(commentKey)));
            if (commentVal)
                payload.comment = commentVal;
        }
        // 集数
        const epKey = colMap.has('集数') ? '集数' : '集号';
        if (colMap.has(epKey)) {
            const epVal = trim(readCell(ws, rowNum, colMap.get(epKey)));
            if (epVal) {
                const ep = parseInt(epVal, 10);
                if (!isNaN(ep) && ep > 0)
                    payload.ep = ep;
            }
        }
        // 私密收藏
        if (colMap.has('私密收藏')) {
            const privateVal = trim(readCell(ws, rowNum, colMap.get('私密收藏'))).toLowerCase();
            if (privateVal === '是' || privateVal === '1' || privateVal === 'true') {
                payload.private = true;
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'buildJsonPayload', showAlert: false });
    }
    return JSON.stringify(payload);
}
export function bgmRequestSync(method, endpoint, jsonBody, token) {
    const result = { code: 0, message: '' };
    const fullUrl = `${BGM_CONFIG.API_BASE}${endpoint}`;
    try {
        const xhr = new XMLHttpRequest();
        xhr.open(method.toUpperCase(), fullUrl, false); // 同步请求
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(jsonBody);
        result.code = xhr.status;
        if (xhr.status >= 200 && xhr.status < 300) {
            result.message = 'success';
            try {
                const data = JSON.parse(xhr.responseText);
                result.message = data.msg || data.message || 'success';
            }
            catch { /* ignore */ }
        }
        else if (xhr.status === 429) {
            result.message = 'Rate limited, please slow down';
        }
        else {
            try {
                const errData = JSON.parse(xhr.responseText);
                result.message = errData.error || errData.description || `HTTP ${xhr.status}`;
            }
            catch {
                result.message = xhr.statusText || `HTTP ${xhr.status}`;
            }
        }
    }
    catch (e) {
        result.code = 0;
        result.message = e.message || 'Network error';
    }
    return result;
}
export function setBangumiToken(token) {
    if (!token)
        return false;
    try {
        storeBgToken(token);
        bgmLog(LOG_LEVELS.INFO, 'Token已保存');
        return true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'setBangumiToken', showAlert: false });
        return false;
    }
}
export function clearRowColors() {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws)
            return;
        const lastRow = getLastRow(ws);
        for (let r = 1; r <= lastRow; r++) {
            const cell = ws.Range(`D${r}`);
            if (cell?.Interior)
                cell.Interior.ColorIndex = -4142;
        }
        bgmLog(LOG_LEVELS.INFO, '已清除所有颜色标记');
    }
    catch (e) {
        BGM.handleError(e, { context: 'clearRowColors', showAlert: false });
    }
}
/**
 * 批量执行同步请求（并发控制）
 */
async function batchSyncRequests(tasks, token, userIdPath, concurrency = DEFAULT_CONCURRENCY) {
    const success = [];
    const fail = [];
    let lastRequestTime = 0;
    let stopped = false;
    const queue = [...tasks];
    const executing = [];
    while (queue.length > 0 || executing.length > 0) {
        if (BGM.sync.checkShouldStop()) {
            bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 检测到停止请求');
            stopped = true;
            if (executing.length > 0) {
                await Promise.all(executing.map(e => e.promise));
            }
            break;
        }
        while (executing.length < concurrency && queue.length > 0) {
            const task = queue.shift();
            const entry = { promise: null, task, done: false };
            entry.promise = (async () => {
                try {
                    const now = Date.now();
                    const elapsed = now - lastRequestTime;
                    if (elapsed < MIN_REQUEST_INTERVAL) {
                        await delay(MIN_REQUEST_INTERVAL - elapsed);
                    }
                    const apiResult = bgmRequestSync('POST', `/v0/users${userIdPath}/collections/${task.sid}`, task.jsonBody, token);
                    lastRequestTime = Date.now();
                    if (apiResult.code >= 200 && apiResult.code < 300) {
                        success.push(task);
                    }
                    else {
                        fail.push(task);
                        bgmLog(LOG_LEVELS.WARN, `SID ${task.sid} 失败: ${apiResult.code} ${apiResult.message}`);
                    }
                }
                catch (e) {
                    fail.push(task);
                    bgmLog(LOG_LEVELS.ERROR, `SID ${task.sid} 异常: ${e.message}`);
                }
                finally {
                    entry.done = true;
                }
            })();
            executing.push(entry);
        }
        if (executing.length > 0) {
            await Promise.race(executing.map(e => e.promise));
            for (let i = executing.length - 1; i >= 0; i--) {
                if (executing[i].done)
                    executing.splice(i, 1);
            }
        }
    }
    return { success, fail, stopped };
}
export async function SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options) {
    const result = { success: 0, fail: 0, skip: 0, stopped: false };
    const startRow = headerRow + 1;
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 开始批量同步');
    // 1. 获取可见行
    const filterStatus = getFilterStatus(lastRow, headerRow);
    let rowsToProcess;
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        rowsToProcess = filterStatus.visibleRows.filter(r => r >= startRow);
    }
    else {
        rowsToProcess = [];
        for (let r = startRow; r <= lastRow; r++)
            rowsToProcess.push(r);
    }
    const total = rowsToProcess.length;
    bgmLog(LOG_LEVELS.INFO, `待处理行数: ${total}`);
    // 2. 批量读取数据
    let maxCol = 1;
    for (const key of BATCH_READ_COLUMNS) {
        if (colMap.has(key))
            maxCol = Math.max(maxCol, colMap.get(key));
    }
    const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol);
    const getField = createFieldGetter(allData, colMap, startRow, ws);
    // 3. 增量同步指纹映射
    let fingerprintMap;
    if (options?.incremental) {
        const allRecords = getAllSyncRecords();
        fingerprintMap = new Map();
        for (const r of allRecords) {
            if (r.sid && r.fingerprint)
                fingerprintMap.set(r.sid, r.fingerprint);
        }
        bgmLog(LOG_LEVELS.INFO, `增量同步模式，已加载 ${fingerprintMap.size} 条指纹`);
    }
    // 4. 构建同步任务列表
    const syncTasks = [];
    const skipSids = options?.skipSids;
    const userIdPath = _getUserApiPath();
    for (const rowNum of rowsToProcess) {
        const bgmUrl = getField(rowNum, 'Bangumi_URL');
        if (!bgmUrl) {
            result.skip++;
            continue;
        }
        const sid = extractSubjectId(bgmUrl);
        if (!sid) {
            result.skip++;
            continue;
        }
        if (skipSids?.has(sid)) {
            result.skip++;
            continue;
        }
        const watchStatusRaw = getField(rowNum, '是否看完') || getField(rowNum, '状态') || getField(rowNum, '观看状态');
        if (!watchStatusRaw) {
            result.skip++;
            continue;
        }
        const watchType = mapWatchStatus(watchStatusRaw);
        if (watchType === 0) {
            result.skip++;
            continue;
        }
        // 增量指纹检查
        let currentFingerprint;
        if (fingerprintMap) {
            currentFingerprint = calcFingerprint([
                getField(rowNum, '名称'),
                watchType.toString(),
                getField(rowNum, '打分'),
                getField(rowNum, '标签/分级'),
                getField(rowNum, '剧透/感言'),
                getField(rowNum, '集数'),
                getField(rowNum, '集号')
            ]);
            if (fingerprintMap.get(sid) === currentFingerprint) {
                result.skip++;
                continue;
            }
        }
        // 非增量模式下检查颜色标记
        if (!fingerprintMap && isCellMarkedSuccess(ws, rowNum, colMap)) {
            result.skip++;
            continue;
        }
        const finishedDate = getField(rowNum, '完播日');
        const jsonBody = buildJsonPayload(ws, rowNum, colMap, finishedDate);
        const name = getField(rowNum, '名称');
        syncTasks.push({
            rowNum, sid, bgmUrl, name, jsonBody,
            fingerprint: currentFingerprint,
            type: watchType
        });
    }
    bgmLog(LOG_LEVELS.INFO, `待同步: ${syncTasks.length}，跳过: ${result.skip}`);
    // 5. 执行批量请求
    try {
        getOrCreateSyncRecordSheet();
    }
    catch (e) { /* ignore */ }
    const { success: successTasks, fail: failTasks, stopped } = await batchSyncRequests(syncTasks, token, userIdPath, DEFAULT_CONCURRENCY);
    // 6. 更新 UI 和记录
    for (const task of successTasks) {
        markCellColor(ws, task.rowNum, 'success', colMap);
        addSyncRecord({
            name: task.name || `SID:${task.sid}`,
            url: task.bgmUrl,
            sid: task.sid,
            type: TYPE_NAMES[task.type] || `类型${task.type}`,
            content: task.jsonBody,
            status: SYNC_STATUS.SUCCESS,
            message: '批量同步成功',
            count: 1,
            fingerprint: task.fingerprint
        });
        result.success++;
    }
    for (const task of failTasks) {
        markCellColor(ws, task.rowNum, 'fail', colMap);
        addSyncRecord({
            name: task.name || `SID:${task.sid}`,
            url: task.bgmUrl,
            sid: task.sid,
            type: TYPE_NAMES[task.type] || `类型${task.type}`,
            content: task.jsonBody,
            status: SYNC_STATUS.FAIL,
            message: '批量同步失败',
            count: 1
        });
        result.fail++;
    }
    if (stopped) {
        result.stopped = true;
        const executed = successTasks.length + failTasks.length;
        result.skip += syncTasks.length - executed;
        bgmLog(LOG_LEVELS.INFO, `同步已停止，剩余${syncTasks.length - executed}条跳过`);
    }
    const totalTime = Date.now() - startTime;
    bgmLog(LOG_LEVELS.INFO, `同步完成: 成功=${result.success}, 失败=${result.fail}, 跳过=${result.skip}, 停止=${result.stopped}, 耗时=${totalTime}ms`);
    BGM.setSyncComplete(result);
    if (options?.onProgress)
        options.onProgress(syncTasks.length, syncTasks.length, stopped ? '同步已停止' : '同步完成');
    return result;
}
export function clearSheetMarksInSheet(sheetIndex) {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return;
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
        if (!ws)
            return;
        const lastRow = getLastRow(ws);
        for (let r = 1; r <= lastRow; r++) {
            const cell = ws.Range(`D${r}`);
            if (cell?.Interior)
                cell.Interior.ColorIndex = -4142;
        }
        bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的颜色标记`);
    }
    catch (e) {
        BGM.handleError(e, { context: 'clearSheetMarksInSheet', showAlert: false });
    }
}
export function testSingleUpdate() {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[testSingleUpdate] 开始单条测试');
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            throw new Error('无法获取 Application');
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws)
            throw new Error('无法获取工作表');
        let targetRow = 2;
        try {
            const activeCell = app.Selection;
            if (activeCell?.Row)
                targetRow = activeCell.Row;
        }
        catch { /* ignore */ }
        const headerRow = findHeaderRow(ws) || 1;
        const colMap = getColumnMap(ws, headerRow);
        if (!colMap.has('Bangumi_URL')) {
            wpsMsgBox('未找到 Bangumi URL 列', 0, 48);
            return;
        }
        const bgmUrl = trim(readCell(ws, targetRow, colMap.get('Bangumi_URL')));
        if (!bgmUrl) {
            wpsMsgBox(`第 ${targetRow} 行URL为空`, 0, 48);
            return;
        }
        const sid = extractSubjectId(bgmUrl);
        if (!sid) {
            wpsMsgBox('无法从URL提取 Subject ID', 0, 48);
            return;
        }
        const token = loadBgToken();
        if (!token) {
            wpsMsgBox('请先设置 Token', 0, 48);
            return;
        }
        const finishedDate = colMap.has('完播日') ? trim(readCell(ws, targetRow, colMap.get('完播日'))) : '';
        const jsonBody = buildJsonPayload(ws, targetRow, colMap, finishedDate);
        const userPath = _getUserApiPath();
        const endpoint = `/v0/users${userPath}/collections/${sid}`;
        const result = bgmRequestSync('POST', endpoint, jsonBody, token);
        if (result.code >= 200 && result.code < 300) {
            wpsMsgBox(`✓ 测试成功！\n\nSID: ${sid}\nHTTP: ${result.code}\n消息: ${result.message}`, 0, 64);
        }
        else {
            wpsMsgBox(`✗ 测试失败\n\nSID: ${sid}\nHTTP: ${result.code}\n消息: ${result.message}`, 0, 16);
        }
    }
    catch (e) {
        wpsMsgBox(`测试异常: ${e.message}`, 0, 16);
    }
    bgmLog(LOG_LEVELS.INFO, `[testSingleUpdate] 结束，耗时: ${Date.now() - startTime}ms`);
}
