/**
 * @fileoverview Excel到Bangumi同步模块
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { HEADER_KEYWORDS, URL_PATTERNS, TYPE_TEXT_MAP, PANEL_CONFIG, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, SYNC_STATUS, bgmLog, getApp, readCell, getCell, trim, getColumnMap, findHeaderRow, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId, wpsMsgBox, _getUserApiPath, IMPORTANT_COLS } from '../index.js';
import { getOrCreateSyncRecordSheet, addSyncRecord } from './syncRecord.js';
/**
 * 表头关键字集合（用于快速查找）
 *
 * @constant
 * @type {Set<string>}
 */
const headerKeywordSet = new Set(HEADER_KEYWORDS.map(k => k.toLowerCase()));
/**
 * 重要列集合（用于快速查找）
 *
 * @constant
 * @type {Set<string>}
 */
const importantColSet = new Set(Object.keys(IMPORTANT_COLS || {}).map(k => k.toLowerCase()));
/**
 * 观看状态文本映射（用于快速查找）
 *
 * @constant
 * @type {Map<string, number>}
 */
const watchStatusMap = new Map(Object.entries(TYPE_TEXT_MAP));
/**
 * 获取BgmWindow上缓存的函数引用
 * 用于在面板函数就绪前延迟执行
 *
 * @function getPanelFunction
 * @param {string} name - 函数名
 * @returns {Function | undefined} 函数引用
 */
function getPanelFunction(name) {
    return window[name];
}
/**
 * 打开Bangumi Token申请页面
 *
 * @function openBangumiTokenPage
 */
export function openBangumiTokenPage() {
    window.open('https://bgm.tv/dev/app', '_blank');
}
/**
 * 测试Token有效性（Ribbon版本）
 *
 * @function testTokenValidityForRibbon
 * @param {string} [token] - 要测试的Token，不提供则自动加载
 */
export function testTokenValidityForRibbon(token) {
    const testToken = token || loadBgToken();
    if (!testToken) {
        alert('请先设置 Token！');
        return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.bgm.tv/v0/me', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + testToken);
    xhr.onload = () => {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                const username = data.username || data.nickname || '未知用户';
                const userId = data.id || '未知ID';
                alert(`✓ Token有效！\n\n用户名: ${username}\n用户ID: ${userId}`);
                _setBgmUserId(String(userId));
            }
            catch (e) {
                alert('✗ Token有效，但解析响应失败');
            }
        }
        else if (xhr.status === 401) {
            alert('✗ Token无效或已过期，请重新获取');
        }
        else {
            alert(`✗ Token验证失败 (HTTP ${xhr.status})`);
        }
    };
    xhr.onerror = () => {
        alert('✗ 网络错误，无法验证Token');
    };
    xhr.send();
}
/**
 * 打开用户收藏页面
 *
 * @function openUserCollection
 */
export function openUserCollection() {
    const userId = _getBgmUserId();
    if (!userId) {
        wpsMsgBox('请先设置用户ID！', 0, 48);
        return;
    }
    window.open('https://bgm.tv/user/' + userId + '/collection', '_blank');
}
/**
 * 从URL或文本中提取Bangumi Subject ID
 *
 * @function extractSubjectId
 * @param {string} input - URL或包含ID的文本
 * @returns {string} 提取的Subject ID，失败返回空字符串
 *
 * @description
 * 支持的URL格式：
 * - https://bgm.tv/subject/123456
 * - https://bangumi.tv/subject/123456
 * - https://chii.in/subject/123456
 * - 直接输入数字ID
 *
 * @example
 * extractSubjectId('https://bgm.tv/subject/123456'); // 返回 '123456'
 * extractSubjectId('123456'); // 返回 '123456'
 */
export function extractSubjectId(input) {
    if (!input)
        return '';
    const trimmed = trim(input);
    if (!trimmed)
        return '';
    // 如果是纯数字，直接返回
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }
    // 尝试匹配URL模式
    for (const pattern of URL_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    // 尝试从文本中提取数字
    const numMatch = trimmed.match(/\d+/);
    if (numMatch) {
        return numMatch[0];
    }
    return '';
}
/**
 * 将观看状态文本转换为Bangumi API数值
 *
 * @function mapWatchStatus
 * @param {string} status - 观看状态文本
 * @returns {number} API数值：0=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
 *
 * @description
 * 支持的状态文本映射：
 * - 看过/看完/已看/完/completed → 3
 * - 在看/在看动画/在追/追/watching → 2
 * - 想看/想看动画/否/wish → 0
 * - 搁置/暂停/on_hold → 4
 * - 抛弃/弃/弃番/drop/dropped → 5
 *
 * @example
 * mapWatchStatus('看完'); // 返回 3
 * mapWatchStatus('在看'); // 返回 2
 */
export function mapWatchStatus(status) {
    if (!status)
        return 0;
    const normalized = trim(status).toLowerCase();
    // 直接查找
    if (watchStatusMap.has(normalized)) {
        return watchStatusMap.get(normalized);
    }
    // 模糊匹配
    for (const [key, value] of watchStatusMap.entries()) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    // 布尔值转换
    if (normalized === 'true')
        return 3;
    if (normalized === 'false')
        return 0;
    // 数字字符串转换
    const num = parseInt(normalized, 10);
    if (!isNaN(num) && num >= 0 && num <= 5) {
        return num;
    }
    return 0;
}
/**
 * 从字符串解析标签数组
 *
 * @function addTagsFromStr
 * @param {Set<string>} tagSet - 标签集合（输出参数）
 * @param {string} tagsRaw - 原始标签字符串
 *
 * @description
 * 标签分隔符支持：英文逗号、中文逗号、空格、分号、顿号、换行
 * 标签会被trim后加入集合，空白标签会被忽略
 *
 * @example
 * const tags = new Set<string>();
 * addTagsFromStr(tags, '治愈,日常,萌系');
 * // tags = {'治愈', '日常', '萌系'}
 */
export function addTagsFromStr(tagSet, tagsRaw) {
    if (!tagsRaw)
        return;
    const separators = /[,，、；;\s\n]+/;
    const parts = tagsRaw.split(separators);
    for (const part of parts) {
        const trimmed = trim(part);
        if (trimmed) {
            tagSet.add(trimmed);
        }
    }
}
/**
 * 构建标签数组
 *
 * @function buildTagsArray
 * @param {string} tagsRaw - 原始标签字符串
 * @returns {string[]} 标签数组
 *
 * @example
 * buildTagsArray('治愈,日常 萌系'); // 返回 ['治愈', '日常', '萌系']
 */
export function buildTagsArray(tagsRaw) {
    const tagSet = new Set();
    addTagsFromStr(tagSet, tagsRaw);
    return Array.from(tagSet);
}
/**
 * 获取筛选状态
 *
 * @function getFilterStatus
 * @param {number} [lastRow] - 最后一行行号
 * @returns {{ hasFilter: boolean; visibleRows: number[]; hiddenRows: number[] }} 筛选状态
 *
 * @description
 * 检测工作表是否启用了筛选，并返回可见行和隐藏行的行号数组
 */
export function getFilterStatus(lastRow) {
    const result = {
        hasFilter: false,
        visibleRows: [],
        hiddenRows: []
    };
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return result;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws)
            return result;
        // 检查是否启用筛选
        let autoFilterMode = false;
        try {
            autoFilterMode = !!ws.AutoFilterMode;
        }
        catch (_) { }
        if (!autoFilterMode)
            return result;
        result.hasFilter = true;
        // 使用SpecialCells获取可见单元格
        const maxRow = lastRow || Math.min(ws.Rows.Count, PANEL_CONFIG.MAX_FILTER_SCAN_ROWS);
        const visibleSet = new Set();
        try {
            const range = ws.Range(`A1:A${maxRow}`);
            const visibleCells = range.SpecialCells(12); // xlCellTypeVisible
            if (visibleCells) {
                for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                    const area = visibleCells.Areas.Item(a);
                    for (let r = 1; r <= area.Rows.Count; r++) {
                        visibleSet.add(area.Rows.Item(r).Row);
                    }
                }
            }
        }
        catch (_) { }
        // 回退：逐行检查
        if (visibleSet.size < 3) {
            visibleSet.clear();
            for (let r = 1; r <= maxRow; r++) {
                try {
                    if (!ws.Rows(r).Hidden) {
                        visibleSet.add(r);
                    }
                }
                catch (_) {
                    visibleSet.add(r);
                }
            }
        }
        result.visibleRows = Array.from(visibleSet).sort((a, b) => a - b);
        // 计算隐藏行
        for (let r = 1; r <= maxRow; r++) {
            if (!visibleSet.has(r)) {
                result.hiddenRows.push(r);
            }
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'getFilterStatus error:', e);
    }
    return result;
}
/**
 * 根据D列序列号获取连续的有效行
 *
 * @function getSequentialRowsBySeqCol
 * @param {number} startRow - 起始行
 * @param {number} endRow - 结束行
 * @returns {{ validRows: number[]; seqMap: Map<string, number> }} 有效行和序列号映射
 *
 * @description
 * 扫描D列（序列号列），找出有序列号的数据行。
 * 序列号格式应为数字，用于标记同步进度。
 */
export function getSequentialRowsBySeqCol(startRow, endRow) {
    const result = {
        validRows: [],
        seqMap: new Map()
    };
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return result;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws)
            return result;
        for (let r = startRow; r <= endRow; r++) {
            try {
                const cell = ws.Cells(r, 4); // D列
                const value = cell?.Value2;
                if (value !== null && value !== undefined && value !== '') {
                    const seqNum = String(value).trim();
                    if (/^\d+$/.test(seqNum)) {
                        result.validRows.push(r);
                        result.seqMap.set(seqNum, r);
                    }
                }
            }
            catch (_) { }
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'getSequentialRowsBySeqCol error:', e);
    }
    return result;
}
/**
 * 构建API请求的JSON Payload
 *
 * @function buildJsonPayload
 * @param {any} ws - 工作表对象
 * @param {number} rowNum - 数据行号
 * @param {Map<string, number>} colMap - 列映射
 * @param {string} finishedDate - 完播日期
 * @returns {string} JSON格式的请求体
 *
 * @description
 * 根据工作表中的数据构建Bangumi API所需的JSON格式。
 * 包含字段：type（状态）、rate（评分）、tags（标签）、
 * comment（感言）、ep（集数）、private（是否私有）
 */
export function buildJsonPayload(ws, rowNum, colMap, finishedDate) {
    try {
        const payload = {};
        // 观看状态
        if (colMap.has('是否看完')) {
            const statusVal = trim(readCell(ws, rowNum, colMap.get('是否看完')));
            if (statusVal) {
                payload.type = mapWatchStatus(statusVal);
            }
        }
        // 评分
        if (colMap.has('打分')) {
            const rateVal = trim(readCell(ws, rowNum, colMap.get('打分')));
            if (rateVal && rateVal !== 'true' && rateVal !== 'True') {
                const rate = parseFloat(rateVal);
                if (!isNaN(rate) && rate >= 0 && rate <= 10) {
                    payload.rate = rate;
                }
            }
        }
        // 标签
        if (colMap.has('标签/分级')) {
            const tagsVal = trim(readCell(ws, rowNum, colMap.get('标签/分级')));
            if (tagsVal) {
                payload.tags = buildTagsArray(tagsVal);
            }
        }
        // 感言
        if (colMap.has('剧透/感言') || colMap.has('感言')) {
            const commentKey = colMap.has('剧透/感言') ? '剧透/感言' : '感言';
            const commentVal = trim(readCell(ws, rowNum, colMap.get(commentKey)));
            if (commentVal) {
                payload.comment = commentVal;
            }
        }
        // 集数
        if (colMap.has('集数') || colMap.has('集号')) {
            const epKey = colMap.has('集数') ? '集数' : '集号';
            const epVal = trim(readCell(ws, rowNum, colMap.get(epKey)));
            if (epVal) {
                const ep = parseInt(epVal, 10);
                if (!isNaN(ep) && ep > 0) {
                    payload.ep = ep;
                }
            }
        }
        // 是否私有（默认为false）
        payload.private = 0;
        return JSON.stringify(payload);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'buildJsonPayload error:', e);
        return '{}';
    }
}
/**
 * 发送Bangumi同步请求
 *
 * @function bgmRequestSync
 * @param {string} method - HTTP方法（POST/PUT/DELETE）
 * @param {string} endpoint - API端点
 * @param {string} jsonBody - JSON请求体
 * @param {string} token - API Token
 * @returns {{ code: number; message: string }} 请求结果
 */
export function bgmRequestSync(method, endpoint, jsonBody, token) {
    const result = { code: 0, message: '' };
    try {
        const xhr = new XMLHttpRequest();
        xhr.open(method.toUpperCase(), `${BGM_CONFIG.API_BASE}${endpoint}`, false);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(jsonBody);
        result.code = xhr.status;
        if (xhr.status >= 200 && xhr.status < 300) {
            result.message = 'success';
            if (xhr.responseText) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    result.message = data.msg || data.message || 'success';
                }
                catch (_) { }
            }
        }
        else if (xhr.status === 429) {
            result.message = 'Rate limited, please slow down';
        }
        else {
            try {
                const errData = JSON.parse(xhr.responseText);
                result.message = errData.error || errData.description || `HTTP ${xhr.status}`;
            }
            catch (_) {
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
/**
 * 设置Bangumi Token
 *
 * @function setBangumiToken
 * @param {string} token - Token字符串
 * @returns {boolean} 是否保存成功
 */
export function setBangumiToken(token) {
    if (!token)
        return false;
    try {
        storeBgToken(token);
        bgmLog(LOG_LEVELS.INFO, 'Token已保存');
        return true;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'Token保存失败:', e);
        return false;
    }
}
/**
 * 清除所有行的颜色标记
 *
 * @function clearRowColors
 */
export function clearRowColors() {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws)
            return;
        const lastRow = ws.UsedRange?.Rows.Count || 1000;
        // 清除D列的颜色
        for (let r = 1; r <= lastRow; r++) {
            try {
                const cell = ws.Cells(r, 4);
                if (cell?.Interior) {
                    cell.Interior.ColorIndex = -4142; // xlColorIndexNone
                }
            }
            catch (_) { }
        }
        bgmLog(LOG_LEVELS.INFO, '已清除所有颜色标记');
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'clearRowColors error:', e);
    }
}
/**
 * 异步同步到Bangumi（主同步函数）
 *
 * @async
 * @function SyncToBangumiAsync
 * @param {any} ws - 工作表对象
 * @param {Map<string, number>} colMap - 列映射
 * @param {string} token - API Token
 * @param {number} lastRow - 最后一行行号
 * @param {number} headerRow - 表头行行号
 * @param {SyncOptions} [options] - 同步选项
 * @returns {Promise<{ success: number; fail: number; skip: number }>} 同步结果统计
 *
 * @description
 * 这是主要的同步入口函数。它会：
 * 1. 获取筛选状态（如果是筛选状态则只同步可见行）
 * 2. 遍历每一行数据
 * 3. 提取Subject ID和同步信息
 * 4. 调用Bangumi API进行同步
 * 5. 标记同步结果（颜色）
 * 6. 记录同步历史
 */
export async function SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options) {
    const result = { success: 0, fail: 0, skip: 0 };
    const startRow = headerRow + 1;
    // 获取筛选状态
    const filterStatus = getFilterStatus(lastRow);
    let rowsToProcess = [];
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        // 筛选模式：只处理可见行
        rowsToProcess = filterStatus.visibleRows.filter(r => r >= startRow);
        bgmLog(LOG_LEVELS.INFO, `筛选模式：处理 ${rowsToProcess.length} 个可见行`);
    }
    else {
        // 全部模式：处理所有数据行
        for (let r = startRow; r <= lastRow; r++) {
            rowsToProcess.push(r);
        }
    }
    const total = rowsToProcess.length;
    const userId = _getUserApiPath();
    // 进度回调
    const reportProgress = (current, message) => {
        if (options?.onProgress) {
            options.onProgress(current, total, message);
        }
    };
    // 创建同步记录工作表
    try {
        getOrCreateSyncRecordSheet();
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, '无法创建同步记录表:', e);
    }
    // 逐行处理
    for (let i = 0; i < rowsToProcess.length; i++) {
        const rowNum = rowsToProcess[i];
        reportProgress(i + 1, `处理行 ${rowNum}...`);
        try {
            // 获取Bangumi URL列
            if (!colMap.has('Bangumi_URL')) {
                result.skip++;
                continue;
            }
            const urlCol = colMap.get('Bangumi_URL');
            const bgmUrl = trim(readCell(ws, rowNum, urlCol) || '');
            if (!bgmUrl) {
                result.skip++;
                reportProgress(i + 1, `行 ${rowNum}：跳过（无URL）`);
                continue;
            }
            // 提取Subject ID
            const sid = extractSubjectId(bgmUrl);
            if (!sid) {
                result.skip++;
                reportProgress(i + 1, `行 ${rowNum}：跳过（无有效SID）`);
                continue;
            }
            // 获取完播日期
            let finishedDate = '';
            if (colMap.has('完播日')) {
                finishedDate = trim(readCell(ws, rowNum, colMap.get('完播日')) || '');
            }
            // 构建请求体
            const jsonBody = buildJsonPayload(ws, rowNum, colMap, finishedDate);
            // 获取名称（用于记录）
            let name = '';
            if (colMap.has('名称')) {
                name = trim(readCell(ws, rowNum, colMap.get('名称')) || '');
            }
            // 获取当前观看状态
            let watchStatus = '';
            if (colMap.has('是否看完')) {
                watchStatus = trim(readCell(ws, rowNum, colMap.get('是否看完')) || '');
            }
            // 发送同步请求
            const apiResult = bgmRequestSync('POST', `/v0/users${userId}/collections/${sid}`, jsonBody, token);
            const seqCell = getCell(ws, rowNum, 4);
            if (apiResult.code >= 200 && apiResult.code < 300) {
                // 成功
                result.success++;
                // 标记颜色
                if (seqCell?.Interior) {
                    seqCell.Interior.Color = BGM_COLOR.SUCCESS;
                }
                // 添加同步记录
                addSyncRecord({
                    name: name || `SID:${sid}`,
                    url: bgmUrl,
                    sid: sid,
                    type: '',
                    content: jsonBody,
                    status: SYNC_STATUS.SUCCESS,
                    message: apiResult.message,
                    count: 1
                });
                reportProgress(i + 1, `行 ${rowNum}：✓ 成功`);
            }
            else {
                // 失败
                result.fail++;
                // 标记颜色
                if (seqCell?.Interior) {
                    seqCell.Interior.Color = BGM_COLOR.FAIL;
                }
                // 添加同步记录
                addSyncRecord({
                    name: name || `SID:${sid}`,
                    url: bgmUrl,
                    sid: sid,
                    type: '',
                    content: jsonBody,
                    status: SYNC_STATUS.FAIL,
                    message: apiResult.message || `HTTP ${apiResult.code}`,
                    count: 1
                });
                reportProgress(i + 1, `行 ${rowNum}：✗ 失败 (${apiResult.message})`);
            }
            // 请求间隔（防止限流）
            await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY));
        }
        catch (e) {
            result.fail++;
            reportProgress(i + 1, `行 ${rowNum}：✗ 异常 (${e.message})`);
            bgmLog(LOG_LEVELS.ERROR, `Sync row ${rowNum} error:`, e);
        }
    }
    reportProgress(total, '同步完成');
    bgmLog(LOG_LEVELS.INFO, `SyncToBangumi完成: 成功=${result.success}, 失败=${result.fail}, 跳过=${result.skip}`);
    return result;
}
/**
 * 测试单个条目更新
 *
 * @function testSingleUpdate
 */
export function testSingleUpdate() {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) {
            wpsMsgBox('无法获取 Application', 0, 48);
            return;
        }
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws) {
            wpsMsgBox('无法获取工作表', 0, 48);
            return;
        }
        // 获取当前单元格或默认第2行
        let targetRow = 2;
        try {
            const activeCell = app.Selection;
            if (activeCell?.Row) {
                targetRow = activeCell.Row;
            }
        }
        catch (_) { }
        // 查找URL列
        const headerRow = findHeaderRow(ws) || 1;
        const colMap = getColumnMap(ws, headerRow);
        if (!colMap.has('Bangumi_URL')) {
            wpsMsgBox('未找到 Bangumi URL 列', 0, 48);
            return;
        }
        const urlCol = colMap.get('Bangumi_URL');
        const bgmUrl = trim(readCell(ws, targetRow, urlCol) || '');
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
        // 构建测试请求体
        const finishedDate = colMap.has('完播日')
            ? trim(readCell(ws, targetRow, colMap.get('完播日')) || '')
            : '';
        const jsonBody = buildJsonPayload(ws, targetRow, colMap, finishedDate);
        // 发送请求
        const result = bgmRequestSync('POST', `/v0/users${_getUserApiPath()}/collections/${sid}`, jsonBody, token);
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
}
