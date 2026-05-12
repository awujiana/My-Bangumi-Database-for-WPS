/**
 * @fileoverview Excel到Bangumi同步模块
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { URL_PATTERNS, WATCH_STATUS_MAP, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, SYNC_STATUS, bgmLog, getApp, readCell, getCell, trim, getColumnMap, getLastRow, findHeaderRow, getCellValue, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId, BGM, wpsMsgBox, _getUserApiPath, readRangeValues, delay, calcFingerprint, getAllSyncRecords, isWpsWorksheet } from '../index.js';
import { getOrCreateSyncRecordSheet, addSyncRecord } from './syncRecord.js';
import { showAlert, showSuccess, showError } from '../ui/dialog.js';
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
        showAlert('请先设置 Token！', '提示');
        return;
    }
    const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`;
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] ========== 开始测试 Token ==========`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] API 路由: ${apiUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求方法: GET`);
    bgmLog(LOG_LEVELS.DEBUG, `[exceltobangumi/testTokenValidityForRibbon] 请求头: Authorization: Bearer ${testToken.substring(0, 8)}...`);
    bgmLog(LOG_LEVELS.DEBUG, `[exceltobangumi/testTokenValidityForRibbon] 请求头: Content-Type: application/json`);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + testToken);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
        const duration = Date.now() - startTime;
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] ========== 请求完成 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] HTTP 状态码: ${xhr.status} (${xhr.statusText})`);
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求耗时: ${duration}ms`);
        if (xhr.getAllResponseHeaders()) {
            bgmLog(LOG_LEVELS.DEBUG, `[exceltobangumi/testTokenValidityForRibbon] 响应头: ${xhr.getAllResponseHeaders()}`);
        }
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                bgmLog(LOG_LEVELS.DEBUG, `[exceltobangumi/testTokenValidityForRibbon] 响应数据: ${JSON.stringify(data).length > 300 ? JSON.stringify(data).substring(0, 300) + '...' : JSON.stringify(data)}`);
                const nickname = data.nickname || data.username || '未知用户';
                const userId = String(data.id || '未知ID');
                bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] Token 验证成功！用户名: ${nickname}, 用户ID: ${userId}`);
                showSuccess(`Token有效！\n\n用户名: ${nickname}\n用户ID: ${userId}`, '验证成功');
                _setBgmUserId(userId);
                BGM.cache.username = nickname;
                notifyUserInfoUpdated(nickname, userId);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] 解析响应失败: ${e.message}`);
                BGM.handleError(e, { context: 'testTokenValidityForRibbon', showAlert: false });
                showError('Token有效，但解析响应失败', '错误');
            }
        }
        else if (xhr.status === 401) {
            bgmLog(LOG_LEVELS.WARN, `[exceltobangumi/testTokenValidityForRibbon] Token 无效或已过期`);
            showError('Token无效或已过期，请重新获取', '验证失败');
        }
        else {
            bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] Token验证失败，HTTP 状态码: ${xhr.status}`);
            bgmLog(LOG_LEVELS.DEBUG, `[exceltobangumi/testTokenValidityForRibbon] 响应内容: ${xhr.responseText}`);
            showError(`Token验证失败 (HTTP ${xhr.status})`, '错误');
        }
    };
    xhr.onerror = () => {
        const duration = Date.now() - startTime;
        bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] 网络错误，耗时: ${duration}ms`);
        showError('网络错误，无法验证Token', '错误');
    };
    xhr.ontimeout = () => {
        const duration = Date.now() - startTime;
        bgmLog(LOG_LEVELS.WARN, `[exceltobangumi/testTokenValidityForRibbon] 请求超时，耗时: ${duration}ms`);
        showError('请求超时', '错误');
    };
    bgmLog(LOG_LEVELS.DEBUG, `[exceltobangumi/testTokenValidityForRibbon] 正在发送请求...`);
    xhr.send();
}
/**
 * 通知面板用户信息已更新
 */
function notifyUserInfoUpdated(username, userId) {
    try {
        // 触发事件总线
        BGM.setUserId(userId);
        BGM.setUsername(username);
        // 尝试通知 taskpane
        if (typeof window !== 'undefined' && window.parent) {
            window.parent.postMessage({
                type: 'BGM:userInfoUpdated',
                username: username,
                userId: userId,
                timestamp: Date.now()
            }, '*');
        }
        bgmLog(LOG_LEVELS.DEBUG, `notifyUserInfoUpdated: 用户名=${username}, ID=${userId}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, '通知用户信息更新失败: ' + e.message);
    }
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
    if (WATCH_STATUS_MAP[normalized] !== undefined) {
        return WATCH_STATUS_MAP[normalized];
    }
    // 模糊匹配
    for (const [key, value] of Object.entries(WATCH_STATUS_MAP)) {
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
export function addTagsFromStr(tagSet, raw) {
    if (!raw)
        return;
    // 按 | 或 , 或 ; 分割，并过滤掉纯符号和空白
    const parts = raw.split(/[|,;，；]/);
    parts.forEach(part => {
        const tag = part.trim();
        if (tag && !['|', ',', ';', '，', '；'].includes(tag)) {
            tagSet.add(tag);
        }
    });
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
/**
 * 获取筛选状态（可见行列表）
 * @param lastRow  可选扫描上限，默认取工作表最大行数
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export function getFilterStatus(lastRow, headerRow) {
    const result = {
        hasFilter: false,
        visibleRows: [],
        hiddenRows: [],
    };
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return result;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!isWpsWorksheet(ws))
            return result;
        // 1. 检查是否启用了筛选
        let autoFilterMode = false;
        try {
            autoFilterMode = !!ws.AutoFilterMode;
        }
        catch (e) {
            BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
        }
        if (!autoFilterMode)
            return result;
        result.hasFilter = true;
        // 2. 获取自动筛选区域
        let filterRange = null;
        try {
            if (ws.AutoFilter?.Range) {
                filterRange = ws.AutoFilter.Range;
            }
        }
        catch (e) {
            BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
        }
        // 3. 确定扫描范围
        let scanRange;
        if (filterRange) {
            scanRange = filterRange;
            bgmLog(LOG_LEVELS.INFO, '使用 AutoFilter.Range 做 SpecialCells');
        }
        else {
            // 回退：用 A 列最后非空行
            const maxRow = lastRow && lastRow > 0 ? lastRow : ws.Rows.Count;
            let lastUsedRow = maxRow;
            try {
                const bottomCell = ws.Range(`A${maxRow}`);
                const endCell = bottomCell.End(-4162);
                if (endCell && endCell.Row > 0)
                    lastUsedRow = endCell.Row;
            }
            catch (e) {
                BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
            }
            scanRange = ws.Range(`A1:A${lastUsedRow}`);
            bgmLog(LOG_LEVELS.INFO, `无 AutoFilter.Range，使用回退范围 A1:A${lastUsedRow}`);
        }
        // 4. 获取可见单元格
        let visibleCells = null;
        try {
            visibleCells = scanRange.SpecialCells(12);
        }
        catch (e) {
            BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
        }
        // 5. 提取所有可见行号（去重）
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
            catch (e) {
                BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
                areas.push(visibleCells);
            }
            for (const area of areas) {
                const rows = area.Rows;
                for (let r = 1; r <= rows.Count; r++) {
                    rawRows.add(rows.Item(r).Row);
                }
            }
            bgmLog(LOG_LEVELS.INFO, `SpecialCells 收集到 ${rawRows.size} 个原始行号`);
            // 在 getFilterStatus 中输出每个可见行及其前3 列数据
            const rowList = Array.from(rawRows).sort((a, b) => a - b);
            const previewCount = Math.min(rowList.length, 15);
            for (let i = 0; i < previewCount; i++) {
                const r = rowList[i];
                const vals = [];
                for (let c = 1; c <= 3; c++) {
                    vals.push(readCell(ws, r, c)); // 直接复用统一函数
                }
                bgmLog(LOG_LEVELS.INFO, `  行 ${r}: ${vals.join(' | ')}`);
            }
            if (rowList.length > previewCount) {
                bgmLog(LOG_LEVELS.INFO, `  ... 剩余 ${rowList.length - previewCount} 行省略`);
            }
        }
        // 6. 生成最终可见行列表（排除表头行）
        for (const r of rawRows) {
            if (headerRow != null && r === headerRow)
                continue;
            result.visibleRows.push(r);
        }
        result.visibleRows.sort((a, b) => a - b);
        bgmLog(LOG_LEVELS.INFO, `有效可见数据行: ${result.visibleRows.length} 行`);
        if (result.visibleRows.length > 0) {
            bgmLog(LOG_LEVELS.INFO, `可见行前10: ${result.visibleRows.slice(0, 10).join(',')}`);
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
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
                const cell = ws.Range(`D${r}`);
                let val;
                try {
                    val = readCell(ws, r, 4); // 复用统一的 readCell 函数
                }
                catch (e) {
                    BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
                    try {
                        val = readCell(ws, r, 4); // 复用统一的 readCell 函数
                    }
                    catch (e) {
                        BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
                        val = '';
                    }
                }
                if (val !== null && val !== undefined && val !== '') {
                    const seqNum = String(val).trim();
                    if (/^\d+$/.test(seqNum)) {
                        result.validRows.push(r);
                        result.seqMap.set(seqNum, r);
                    }
                }
            }
            catch (e) {
                BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
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
        // 观看状态 - 支持多种列名
        const statusKeys = ['是否看完', '状态', '观看状态', '收藏类型', 'type'];
        let statusFound = false;
        for (const key of statusKeys) {
            if (colMap.has(key)) {
                const statusVal = trim(readCell(ws, rowNum, colMap.get(key)));
                if (statusVal) {
                    const mappedStatus = mapWatchStatus(statusVal);
                    if (mappedStatus !== undefined) {
                        payload.type = mappedStatus;
                        statusFound = true;
                        bgmLog(LOG_LEVELS.DEBUG, `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusVal}" -> ${mappedStatus}`);
                        break;
                    }
                }
            }
        }
        // 如果没有找到有效的状态，默认设置为"想看"(0)
        if (!statusFound) {
            payload.type = 0;
            bgmLog(LOG_LEVELS.WARN, `[buildJsonPayload] 未找到有效的观看状态，默认设置为"想看"(0)`);
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
        // 私密收藏（仅当明确标记为“是”或“1”时才添加）
        if (colMap.has('私密收藏')) {
            const privateVal = trim(readCell(ws, rowNum, colMap.get('私密收藏'))).toLowerCase();
            if (privateVal === '是' || privateVal === '1' || privateVal === 'true') {
                payload.private = true;
            }
        }
        return JSON.stringify(payload);
    }
    catch (e) {
        BGM.handleError(e, { context: 'buildJsonPayload', showAlert: false });
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
    const startTime = Date.now();
    const fullUrl = `${BGM_CONFIG.API_BASE}${endpoint}`;
    bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] ========== 开始同步请求 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] URL: ${fullUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] 方法: ${method.toUpperCase()}`);
    bgmLog(LOG_LEVELS.DEBUG, `[bgmRequestSync] 请求头: Authorization: Bearer ${token.substring(0, 8)}...`);
    bgmLog(LOG_LEVELS.DEBUG, `[bgmRequestSync] 请求体: ${jsonBody.length > 200 ? jsonBody.substring(0, 200) + '...' : jsonBody}`);
    try {
        const xhr = new XMLHttpRequest();
        xhr.open(method.toUpperCase(), fullUrl, false);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        bgmLog(LOG_LEVELS.DEBUG, `[bgmRequestSync] 正在发送请求...`);
        xhr.send(jsonBody);
        const duration = Date.now() - startTime;
        bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] ========== 请求完成 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] HTTP 状态码: ${xhr.status} (${xhr.statusText})`);
        bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] 请求耗时: ${duration}ms`);
        result.code = xhr.status;
        if (xhr.status >= 200 && xhr.status < 300) {
            result.message = 'success';
            bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] 请求成功`);
            if (xhr.responseText) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    result.message = data.msg || data.message || 'success';
                    bgmLog(LOG_LEVELS.DEBUG, `[bgmRequestSync] 响应数据: ${JSON.stringify(data).length > 300 ? JSON.stringify(data).substring(0, 300) + '...' : JSON.stringify(data)}`);
                }
                catch (e) {
                    BGM.handleError(e, { context: 'bgmRequestSync', showAlert: false });
                }
            }
        }
        else if (xhr.status === 429) {
            result.message = 'Rate limited, please slow down';
            bgmLog(LOG_LEVELS.WARN, `[bgmRequestSync] 请求被限流 (429)`);
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[bgmRequestSync] 请求失败，状态码: ${xhr.status}`);
            try {
                const errData = JSON.parse(xhr.responseText);
                result.message = errData.error || errData.description || `HTTP ${xhr.status}`;
                bgmLog(LOG_LEVELS.DEBUG, `[bgmRequestSync] 错误响应: ${JSON.stringify(errData)}`);
            }
            catch (e) {
                BGM.handleError(e, { context: 'bgmRequestSync', showAlert: false });
                result.message = xhr.statusText || `HTTP ${xhr.status}`;
                bgmLog(LOG_LEVELS.DEBUG, `[bgmRequestSync] 响应内容: ${xhr.responseText}`);
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'bgmRequestSync', showAlert: false });
        result.code = 0;
        result.message = e.message || 'Network error';
        bgmLog(LOG_LEVELS.ERROR, `[bgmRequestSync] 网络错误: ${e.message}`);
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
        BGM.handleError(e, { context: 'setBangumiToken', showAlert: false });
        return false;
    }
}
/**
 * 清除当前活动工作表的 D 列颜色标记（与 clearSheetMarksInSheet 相同，但作用于活动工作表）清除所有行的颜色标记
 */
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
            try {
                const cell = ws.Range(`D${r}`);
                if (cell?.Interior)
                    cell.Interior.ColorIndex = -4142;
            }
            catch (e) {
                BGM.handleError(e, { context: 'clearRowColors', showAlert: false });
            }
        }
        bgmLog(LOG_LEVELS.INFO, '已清除所有颜色标记');
    }
    catch (e) {
        BGM.handleError(e, { context: 'clearRowColors', showAlert: false });
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
/**
 * 异步批量同步 Excel 数据到 Bangumi
 * - 支持筛选状态下仅处理可见行
 * - 批量读取单元格数据，提高性能
 * - 动态请求间隔，避免限制的同时提升速度
 * - 支持跳过冲突条目（通过 skipSids 集合）
 * - 跳过已上传条目（D列颜色）
 * - 统一错误处理，带详细日志
 *
 * @param ws 工作表对象
 * @param colMap 列名到列号的映射 Map
 * @param token Bangumi API 访问令牌
 * @param lastRow 数据区域最后一行
 * @param headerRow 表头行号
 * @param options 可选项（onProgress, onItemComplete, skipSids 回调）
 * @returns 同步结果统计 { success, fail, skip }
 */
/**
 * 异步批量同步 Excel 数据到 Bangumi（优化版）
 * - 支持筛选状态下仅处理可见行
 * - 批量读取单元格数据，提高性能
 * - 动态请求间隔，避免限制的同时提升速度
 * - 支持跳过冲突条目（通过 skipSids 集合）
 * - 支持增量同步：根据历史指纹自动跳过无变化条目，并在成功后更新指纹
 * - 统一错误处理，带详细日志
 *
 * @param ws 工作表对象
 * @param colMap 列名到列号的映射 Map
 * @param token Bangumi API 访问令牌
 * @param lastRow 数据区域最后一行
 * @param headerRow 表头行号
 * @param options 可选项（onProgress, onItemComplete, skipSids, incremental 回调）
 * @returns 同步结果统计 { success, fail, skip }
 */
export async function SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options) {
    const result = { success: 0, fail: 0, skip: 0 };
    const startRow = headerRow + 1;
    // ========== 1. 获取可见行（筛选状态） ==========
    const filterStatus = getFilterStatus(lastRow);
    let rowsToProcess = [];
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        rowsToProcess = filterStatus.visibleRows.filter(r => r >= startRow);
        bgmLog(LOG_LEVELS.INFO, `筛选模式：处理 ${rowsToProcess.length} 个可见行`);
    }
    else {
        for (let r = startRow; r <= lastRow; r++)
            rowsToProcess.push(r);
    }
    const total = rowsToProcess.length;
    // ========== 2. 批量读取数据缓存（性能关键） ==========
    const neededKeys = ['Bangumi_URL', '名称', '是否看完', '打分', '标签/分级', '完播日', '类别', '剧透/感言', '集号'];
    let maxCol = 1;
    for (const key of neededKeys) {
        if (colMap.has(key))
            maxCol = Math.max(maxCol, colMap.get(key));
    }
    const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol);
    /** 从缓存数组中获取字段值，失败时回退到逐单元格读取 */
    const getField = (row, key) => {
        if (allData && Array.isArray(allData)) {
            const col = colMap.get(key);
            if (!col)
                return '';
            const rowIdx = row - startRow;
            if (rowIdx >= 0 && rowIdx < allData.length) {
                const rowData = allData[rowIdx];
                if (Array.isArray(rowData) && col - 1 < rowData.length) {
                    return trim(rowData[col - 1]);
                }
            }
        }
        return colMap.has(key) ? trim(getCellValue(ws, row, colMap.get(key))) : '';
    };
    // ========== 3. 增量同步：构建历史指纹映射 ==========
    let fingerprintMap;
    if (options?.incremental) {
        const allRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
        fingerprintMap = new Map();
        // 保留每个 SID 最新记录的指纹
        for (const r of allRecords) {
            if (r.sid && r.fingerprint) {
                fingerprintMap.set(r.sid, r.fingerprint);
            }
        }
        bgmLog(LOG_LEVELS.INFO, `增量同步模式：已加载 ${fingerprintMap.size} 条历史指纹`);
    }
    // ========== 4. 进度与错误处理 ==========
    const reportProgress = (current, message) => {
        if (options?.onProgress)
            options.onProgress(current, total, message);
    };
    // 尝试创建同步记录表（忽略失败）
    try {
        getOrCreateSyncRecordSheet();
    }
    catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.WARN, context: 'SyncToBangumiAsync:createSheet' });
    }
    const userIdPath = _getUserApiPath();
    let lastRequestTime = 0;
    const MIN_INTERVAL = 200; // 最小间隔 200ms
    const skipSids = options?.skipSids;
    // ========== 5. 遍历可见行 ==========
    for (let idx = 0; idx < rowsToProcess.length; idx++) {
        const rowNum = rowsToProcess[idx];
        reportProgress(idx + 1, `处理行 ${rowNum}...`);
        BGM.setSyncProgress(idx + 1, total, `处理行 ${rowNum}...`);
        try {
            const bgmUrl = getField(rowNum, 'Bangumi_URL');
            if (!bgmUrl) {
                result.skip++;
                reportProgress(idx + 1, `行 ${rowNum}：跳过（无URL）`);
                continue;
            }
            const sid = extractSubjectId(bgmUrl);
            if (!sid) {
                result.skip++;
                reportProgress(idx + 1, `行 ${rowNum}：跳过（无有效SID）`);
                continue;
            }
            // 冲突跳过
            if (skipSids && skipSids.has(sid)) {
                result.skip++;
                reportProgress(idx + 1, `行 ${rowNum}：跳过（冲突保护）`);
                continue;
            }
            // 增量同步指纹检查
            let currentFingerprint;
            if (fingerprintMap) {
                // 计算当前指纹
                currentFingerprint = calcFingerprint([
                    getField(rowNum, '名称'),
                    mapWatchStatus(getField(rowNum, '是否看完')).toString(),
                    getField(rowNum, '打分'),
                    getField(rowNum, '标签/分级'),
                    getField(rowNum, '剧透/感言'),
                    getField(rowNum, '集数'),
                    getField(rowNum, '集号')
                ]);
                // 如果指纹与历史一致，跳过（无变化）
                if (fingerprintMap.get(sid) === currentFingerprint) {
                    result.skip++;
                    reportProgress(idx + 1, `行 ${rowNum}：跳过（无变更）`);
                    continue;
                }
            }
            // 非增量模式下才检查已上传颜色（增量模式下即使已上传，如果指纹变了也要重新同步）
            if (!fingerprintMap) {
                const seqCell = getCell(ws, rowNum, 4);
                const isUploaded = seqCell?.Interior && (seqCell.Interior.Color === BGM_COLOR.SUCCESS ||
                    seqCell.Interior.Color === BGM_COLOR.LIGHT_GREEN ||
                    seqCell.Interior.Color === BGM_COLOR.DARK_GREEN);
                if (isUploaded) {
                    result.skip++;
                    reportProgress(idx + 1, `行 ${rowNum}：跳过（已上传）`);
                    continue;
                }
            }
            const finishedDate = getField(rowNum, '完播日');
            const jsonBody = buildJsonPayload(ws, rowNum, colMap, finishedDate);
            const name = getField(rowNum, '名称');
            // 动态请求间隔
            const now = Date.now();
            const elapsed = now - lastRequestTime;
            if (elapsed < MIN_INTERVAL) {
                await delay(MIN_INTERVAL - elapsed);
            }
            const apiResult = bgmRequestSync('POST', `/v0/users${userIdPath}/collections/${sid}`, jsonBody, token);
            lastRequestTime = Date.now();
            const success = apiResult.code >= 200 && apiResult.code < 300;
            // 标记颜色
            const seqCell = getCell(ws, rowNum, 4);
            if (seqCell?.Interior) {
                seqCell.Interior.Color = success ? BGM_COLOR.SUCCESS : BGM_COLOR.FAIL;
            }
            // 记录同步日志，成功时写入指纹
            if (typeof addSyncRecord === 'function') {
                addSyncRecord({
                    name: name || `SID:${sid}`,
                    url: bgmUrl,
                    sid: sid,
                    type: '',
                    content: jsonBody,
                    status: success ? SYNC_STATUS.SUCCESS : SYNC_STATUS.FAIL,
                    message: apiResult.message || `HTTP ${apiResult.code}`,
                    count: 1,
                    fingerprint: success ? currentFingerprint : undefined
                });
            }
            if (success) {
                result.success++;
                reportProgress(idx + 1, `行 ${rowNum}：✓ 成功`);
            }
            else {
                result.fail++;
                reportProgress(idx + 1, `行 ${rowNum}：✗ 失败 (${apiResult.message || apiResult.code})`);
            }
        }
        catch (e) {
            result.fail++;
            reportProgress(idx + 1, `行 ${rowNum}：✗ 异常 (${e.message})`);
            BGM.setSyncError(e);
            BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'SyncToBangumiAsync' });
        }
    }
    reportProgress(total, '同步完成');
    BGM.setSyncComplete(result);
    bgmLog(LOG_LEVELS.INFO, `SyncToBangumi 完成: 成功=${result.success}, 失败=${result.fail}, 跳过=${result.skip}`);
    return result;
}
/**
 * 清除指定工作表的 D 列颜色标记
 * @param sheetIndex 工作表索引
 */
export function clearSheetMarksInSheet(sheetIndex) {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return;
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
        if (!ws)
            return;
        const lastRow = getLastRow(ws); // 精确获取最后数据行
        for (let r = 1; r <= lastRow; r++) {
            try {
                const cell = ws.Range(`D${r}`);
                if (cell?.Interior)
                    cell.Interior.ColorIndex = -4142;
            }
            catch (e) {
                BGM.handleError(e, { context: 'clearSheetMarksInSheet', showAlert: false });
            }
        }
        bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的颜色标记`);
    }
    catch (e) {
        BGM.handleError(e, { context: 'clearSheetMarksInSheet', showAlert: false });
    }
}
/**
 * 测试单个条目更新
 *
 * @function testSingleUpdate
 */
export function testSingleUpdate() {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[testSingleUpdate] ========== 开始单条测试更新 ==========');
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) {
            bgmLog(LOG_LEVELS.ERROR, '[testSingleUpdate] 无法获取 Application');
            wpsMsgBox('无法获取 Application', 0, 48);
            return;
        }
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws) {
            bgmLog(LOG_LEVELS.ERROR, '[testSingleUpdate] 无法获取工作表');
            wpsMsgBox('无法获取工作表', 0, 48);
            return;
        }
        bgmLog(LOG_LEVELS.DEBUG, '[testSingleUpdate] 工作表获取成功');
        // 获取当前单元格或默认第2行
        let targetRow = 2;
        try {
            const activeCell = app.Selection;
            if (activeCell?.Row) {
                targetRow = activeCell.Row;
            }
            bgmLog(LOG_LEVELS.DEBUG, `[testSingleUpdate] 目标行: ${targetRow}`);
        }
        catch (e) {
            BGM.handleError(e, { context: 'testSingleUpdate', showAlert: false });
            return;
        }
        // 查找URL列
        const headerRow = findHeaderRow(ws) || 1;
        bgmLog(LOG_LEVELS.DEBUG, `[testSingleUpdate] 表头行: ${headerRow}`);
        const colMap = getColumnMap(ws, headerRow);
        bgmLog(LOG_LEVELS.DEBUG, `[testSingleUpdate] 列映射完成，共 ${colMap.size} 列`);
        if (!colMap.has('Bangumi_URL')) {
            bgmLog(LOG_LEVELS.WARN, '[testSingleUpdate] 未找到 Bangumi_URL 列');
            wpsMsgBox('未找到 Bangumi URL 列', 0, 48);
            return;
        }
        const urlCol = colMap.get('Bangumi_URL');
        const bgmUrl = trim(readCell(ws, targetRow, urlCol) || '');
        bgmLog(LOG_LEVELS.DEBUG, `[testSingleUpdate] Bangumi URL: ${bgmUrl}`);
        if (!bgmUrl) {
            bgmLog(LOG_LEVELS.WARN, `[testSingleUpdate] 第 ${targetRow} 行URL为空`);
            wpsMsgBox(`第 ${targetRow} 行URL为空`, 0, 48);
            return;
        }
        const sid = extractSubjectId(bgmUrl);
        if (!sid) {
            bgmLog(LOG_LEVELS.WARN, `[testSingleUpdate] 无法从URL提取 Subject ID: ${bgmUrl}`);
            wpsMsgBox('无法从URL提取 Subject ID', 0, 48);
            return;
        }
        bgmLog(LOG_LEVELS.INFO, `[testSingleUpdate] 提取到 Subject ID: ${sid}`);
        const token = loadBgToken();
        if (!token) {
            bgmLog(LOG_LEVELS.WARN, '[testSingleUpdate] Token 未设置');
            wpsMsgBox('请先设置 Token', 0, 48);
            return;
        }
        bgmLog(LOG_LEVELS.DEBUG, `[testSingleUpdate] Token 已设置（长度: ${token.length}）`);
        // 构建测试请求体
        const finishedDate = colMap.has('完播日')
            ? trim(readCell(ws, targetRow, colMap.get('完播日')) || '')
            : '';
        const jsonBody = buildJsonPayload(ws, targetRow, colMap, finishedDate);
        bgmLog(LOG_LEVELS.DEBUG, `[testSingleUpdate] 请求体构建完成: ${jsonBody.length > 200 ? jsonBody.substring(0, 200) + '...' : jsonBody}`);
        // 获取用户路径
        const userPath = _getUserApiPath();
        bgmLog(LOG_LEVELS.INFO, `[testSingleUpdate] 用户路径: ${userPath}`);
        // 发送请求
        const endpoint = `/v0/users${userPath}/collections/${sid}`;
        bgmLog(LOG_LEVELS.INFO, `[testSingleUpdate] 完整端点: ${endpoint}`);
        const result = bgmRequestSync('POST', endpoint, jsonBody, token);
        if (result.code >= 200 && result.code < 300) {
            bgmLog(LOG_LEVELS.INFO, `[testSingleUpdate] 测试成功！SID: ${sid}, HTTP: ${result.code}`);
            wpsMsgBox(`✓ 测试成功！\n\nSID: ${sid}\nHTTP: ${result.code}\n消息: ${result.message}`, 0, 64);
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[testSingleUpdate] 测试失败！SID: ${sid}, HTTP: ${result.code}, 消息: ${result.message}`);
            wpsMsgBox(`✗ 测试失败\n\nSID: ${sid}\nHTTP: ${result.code}\n消息: ${result.message}`, 0, 16);
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'testSingleUpdate', showAlert: false });
        bgmLog(LOG_LEVELS.ERROR, `[testSingleUpdate] 测试异常: ${e.message}`);
        wpsMsgBox(`测试异常: ${e.message}`, 0, 16);
    }
    bgmLog(LOG_LEVELS.INFO, `[testSingleUpdate] ========== 测试结束，总耗时: ${Date.now() - startTime}ms ==========`);
}
