/**
 * @fileoverview Excel到Bangumi同步模块
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */

import {
    HEADER_KEYWORDS,
    FIELD_NAME_MAP,
    URL_PATTERNS,
    TYPE_TEXT_MAP,
    PANEL_CONFIG,
    BGM_CONFIG,
    BGM_COLOR,
    LOG_LEVELS,
    SYNC_STATUS,
    BGMCache,
    BGMSync,
    WpsApplication,
    WpsWorksheet,
    WpsRange,
    httpRequest,
    Result,
    BgmError,
    bgmLog,
    getApp,
    readCell,
    getCell,
    setCellValue,
    trim,
    getColumnMap,
    getLastRow,
    findHeaderRow,
    colNumToLetter,
    getCellValue,
    cacheGet,
    escapeHtml,
    loadBgToken,
    storeBgToken,
    _getBgmUserId,
    _setBgmUserId,
    BGM,
    wpsMsgBox,
    _getUserApiPath,
    isEmptyValue,
    IMPORTANT_COLS,
    readRangeValues,
    delay,
    calcFingerprint,
    getAllSyncRecords,
    isWpsWorksheet,
    WpsAreas
} from '../index.js';

import { getOrCreateSyncRecordSheet, addSyncRecord } from './syncRecord.js';

/**
 * 同步进度回调接口
 *
 * @interface SyncProgressCallback
 */
interface SyncProgressCallback {
    (current: number, total: number, message: string): void;
}

/**
 * 同步选项接口
 *
 * @interface SyncOptions
 */
interface SyncOptions {
    onProgress?: (current: number, total: number, message: string) => void;
    onItemComplete?: (row: number, success: boolean, result: { code: number; message: string }) => void;
    skipSids?: Set<string>;                  // 冲突跳过
    incremental?: boolean;                   // 增量同步开关
}
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
function getPanelFunction(name: string): Function | undefined {
    return (window as any)[name];
}


/**
 * 打开Bangumi Token申请页面
 *
 * @function openBangumiTokenPage
 */
export function openBangumiTokenPage(): void {
    window.open('https://bgm.tv/dev/app', '_blank');
}

/**
 * 测试Token有效性（Ribbon版本）
 *
 * @function testTokenValidityForRibbon
 * @param {string} [token] - 要测试的Token，不提供则自动加载
 */
export function testTokenValidityForRibbon(token?: string): void {
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
            } catch (e) {
                alert('✗ Token有效，但解析响应失败');
            }
        } else if (xhr.status === 401) {
            alert('✗ Token无效或已过期，请重新获取');
        } else {
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
export function openUserCollection(): void {
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
export function extractSubjectId(input: string): string {
    if (!input) return '';

    const trimmed = trim(input);
    if (!trimmed) return '';

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
export function mapWatchStatus(status: string): number {
    if (!status) return 0;

    const normalized = trim(status).toLowerCase();

    // 直接查找
    if (watchStatusMap.has(normalized)) {
        return watchStatusMap.get(normalized)!;
    }

    // 模糊匹配
    for (const [key, value] of watchStatusMap.entries()) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }

    // 布尔值转换
    if (normalized === 'true') return 3;
    if (normalized === 'false') return 0;

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
export function addTagsFromStr(tagSet: Set<string>, tagsRaw: string): void {
    if (!tagsRaw) return;

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
export function buildTagsArray(tagsRaw: string): string[] {
    const tagSet = new Set<string>();
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
export function getFilterStatus(lastRow?: number): {
    hasFilter: boolean;
    visibleRows: number[];
    hiddenRows: number[];
} {
    const result = {
        hasFilter: false,
        visibleRows: [] as number[],
        hiddenRows: [] as number[],
    };

    try {
        const app = getApp() as WpsApplication | null;
        if (!app?.ActiveWorkbook) return result;

        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!isWpsWorksheet(ws)) return result;

        // 检查是否启用了自动筛选
        let autoFilterMode = false;
        try { autoFilterMode = !!ws.AutoFilterMode; } catch { }
        if (!autoFilterMode) return result;
        result.hasFilter = true;

        // 1. 优先使用 AutoFilter.Range（最精确）
        let filterRange: WpsRange | null = null;
        try {
            if (ws.AutoFilter?.Range) {
                filterRange = ws.AutoFilter.Range;
            }
        } catch {
            // 个别版本可能抛异常，忽略
        }

        let visibleCells: WpsRange | null = null;

        // 2. 获取可见单元格集合
        if (filterRange) {
            visibleCells = filterRange.SpecialCells(12) as WpsRange;
            bgmLog(LOG_LEVELS.INFO, '使用 AutoFilter.Range.SpecialCells 获取可见单元格');
        } else {
            // 回退方案：用 End(xlUp) 获取有数据的最后行，构造范围
            const maxRow = lastRow && lastRow > 0 ? lastRow : ws.Rows.Count;
            try {
                const lastUsedRow = getLastRow(ws, true);
                const scanEnd = Math.min(lastUsedRow, maxRow);   // 取较小值
                const rng = ws.Range(`A1:A${scanEnd}`);
                visibleCells = rng.SpecialCells(12) as WpsRange;
                bgmLog(LOG_LEVELS.INFO, `使用 End(xlUp) 范围 A1:A${scanEnd} 做 SpecialCells`);
            } catch {
                // 仍失败则回退整列（但这正是造成多行误判的根源，所以放在最后）
                visibleCells = ws.Range(`A1:A${maxRow}`).SpecialCells(12) as WpsRange;
                bgmLog(LOG_LEVELS.INFO, '回退到整列 SpecialCells (可能包含空白行)');
            }
        }

        // 3. 提取所有可见行号（去重）
        const rawRows = new Set<number>();
        if (visibleCells?.Areas) {
            const areas: WpsAreas = visibleCells.Areas;
            for (let a = 1; a <= areas.Count; a++) {
                const area = areas.Item(a);
                const areaRows = area.Rows;
                for (let r = 1; r <= areaRows.Count; r++) {
                    const rowObj = areaRows.Item(r);
                    rawRows.add(rowObj.Row);
                }
            }
        }

        // 4. 确定表头行（筛选区域的第一行，或默认第1行）
        const headerRow = filterRange ? filterRange.Row : 1;

        // 5. 过滤空白行和表头行
        for (const r of rawRows) {
            if (r === headerRow) continue; // 跳过表头
            // 快速非空检测（取前两列）避免误加空白行
            const valA = ws.Range(`A${r}`).Value2;
            const valB = ws.Range(`B${r}`).Value2;
            const isEmpty = (valA === null || valA === undefined || valA === '') &&
                            (valB === null || valB === undefined || valB === '');
            if (!isEmpty) {
                result.visibleRows.push(r);
            }
        }
        result.visibleRows.sort((a, b) => a - b);

        bgmLog(LOG_LEVELS.INFO, `有效可见数据行: ${result.visibleRows.length} 行`);

    } catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'getFilterStatus' });
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
export function getSequentialRowsBySeqCol(startRow: number, endRow: number): { validRows: number[]; seqMap: Map<string, number> } {
    const result = {
        validRows: [] as number[],
        seqMap: new Map<string, number>()
    };

    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) return result;

        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws) return result;

        for (let r = startRow; r <= endRow; r++) {
            try {
                const cell = ws.Range(`D${r}`);
                const value = cell?.Value2;

                if (value !== null && value !== undefined && value !== '') {
                    const seqNum = String(value).trim();
                    if (/^\d+$/.test(seqNum)) {
                        result.validRows.push(r);
                        result.seqMap.set(seqNum, r);
                    }
                }
            } catch (_) {}
        }
    } catch (e) {
         BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'getSequentialRowsBySeqCol' });
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
export function buildJsonPayload(
    ws: any,
    rowNum: number,
    colMap: Map<string, number>,
    finishedDate: string
): string {
    try {
        const payload: Record<string, any> = {};

        // 观看状态
        if (colMap.has('是否看完')) {
            const statusVal = trim(readCell(ws, rowNum, colMap.get('是否看完')!));
            if (statusVal) {
                payload.type = mapWatchStatus(statusVal);
            }
        }

        // 评分
        if (colMap.has('打分')) {
            const rateVal = trim(readCell(ws, rowNum, colMap.get('打分')!));
            if (rateVal && rateVal !== 'true' && rateVal !== 'True') {
                const rate = parseFloat(rateVal);
                if (!isNaN(rate) && rate >= 0 && rate <= 10) {
                    payload.rate = rate;
                }
            }
        }

        // 标签
        if (colMap.has('标签/分级')) {
            const tagsVal = trim(readCell(ws, rowNum, colMap.get('标签/分级')!));
            if (tagsVal) {
                payload.tags = buildTagsArray(tagsVal);
            }
        }

        // 感言
        if (colMap.has('剧透/感言') || colMap.has('感言')) {
            const commentKey = colMap.has('剧透/感言') ? '剧透/感言' : '感言';
            const commentVal = trim(readCell(ws, rowNum, colMap.get(commentKey)!));
            if (commentVal) {
                payload.comment = commentVal;
            }
        }

        // 集数
        if (colMap.has('集数') || colMap.has('集号')) {
            const epKey = colMap.has('集数') ? '集数' : '集号';
            const epVal = trim(readCell(ws, rowNum, colMap.get(epKey)!));
            if (epVal) {
                const ep = parseInt(epVal, 10);
                if (!isNaN(ep) && ep > 0) {
                    payload.ep = ep;
                }
            }
        }

        // 私密收藏（仅当明确标记为“是”或“1”时才添加）
        if (colMap.has('私密收藏')) {
            const privateVal = trim(readCell(ws, rowNum, colMap.get('私密收藏')!)).toLowerCase();
            if (privateVal === '是' || privateVal === '1' || privateVal === 'true') {
                payload.private = true;
            }
        }

        return JSON.stringify(payload);
    } catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'buildJsonPayload' });
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
export function bgmRequestSync(
    method: string,
    endpoint: string,
    jsonBody: string,
    token: string
): { code: number; message: string } {
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
                } catch (_) {}
            }
        } else if (xhr.status === 429) {
            result.message = 'Rate limited, please slow down';
        } else {
            try {
                const errData = JSON.parse(xhr.responseText);
                result.message = errData.error || errData.description || `HTTP ${xhr.status}`;
            } catch (_) {
                result.message = xhr.statusText || `HTTP ${xhr.status}`;
            }
        }
    } catch (e: any) {
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
export function  setBangumiToken(token: string): boolean {
    if (!token) return false;

    try {
        storeBgToken(token);
        bgmLog(LOG_LEVELS.INFO, 'Token已保存');
        return true;
    } catch (e) {
         BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'setBangumiToken' });
        return false;
    }
}
/**
 * 清除当前活动工作表的 D 列颜色标记（与 clearSheetMarksInSheet 相同，但作用于活动工作表）清除所有行的颜色标记
 */
export function clearRowColors(): void {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) return;

        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws) return;

        const lastRow = getLastRow(ws);
        for (let r = 1; r <= lastRow; r++) {
            try {
                const cell = ws.Range(`D${r}`) as WpsRange | null;
                if (cell?.Interior) cell.Interior.ColorIndex = -4142;
            } catch (_) {}
        }
        bgmLog(LOG_LEVELS.INFO, '已清除所有颜色标记');
    } catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'clearRowColors' });
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
export async function SyncToBangumiAsync(
    ws: any,
    colMap: Map<string, number>,
    token: string,
    lastRow: number,
    headerRow: number,
    options?: SyncOptions
): Promise<{ success: number; fail: number; skip: number }> {
    const result = { success: 0, fail: 0, skip: 0 };
    const startRow = headerRow + 1;

    // ========== 1. 获取可见行（筛选状态） ==========
    const filterStatus = getFilterStatus(lastRow);
    let rowsToProcess: number[] = [];
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        rowsToProcess = filterStatus.visibleRows.filter(r => r >= startRow);
        bgmLog(LOG_LEVELS.INFO, `筛选模式：处理 ${rowsToProcess.length} 个可见行`);
    } else {
        for (let r = startRow; r <= lastRow; r++) rowsToProcess.push(r);
    }
    const total = rowsToProcess.length;

    // ========== 2. 批量读取数据缓存（性能关键） ==========
    const neededKeys = ['Bangumi_URL', '名称', '是否看完', '打分', '标签/分级', '完播日', '类别', '剧透/感言', '集号'];
    let maxCol = 1;
    for (const key of neededKeys) {
        if (colMap.has(key)) maxCol = Math.max(maxCol, colMap.get(key)!);
    }
    const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol);

    /** 从缓存数组中获取字段值，失败时回退到逐单元格读取 */
    const getField = (row: number, key: string): string => {
        if (allData && Array.isArray(allData)) {
            const col = colMap.get(key);
            if (!col) return '';
            const rowIdx = row - startRow;
            if (rowIdx >= 0 && rowIdx < allData.length) {
                const rowData = allData[rowIdx];
                if (Array.isArray(rowData) && col - 1 < rowData.length) {
                    return trim(rowData[col - 1]);
                }
            }
        }
        return colMap.has(key) ? trim(getCellValue(ws, row, colMap.get(key)!)) : '';
    };

    // ========== 3. 增量同步：构建历史指纹映射 ==========
    let fingerprintMap: Map<string, string> | undefined;
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
    const reportProgress = (current: number, message: string) => {
        if (options?.onProgress) options.onProgress(current, total, message);
    };

    // 尝试创建同步记录表（忽略失败）
    try { getOrCreateSyncRecordSheet(); } catch (e) {
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
            if (!bgmUrl) { result.skip++; reportProgress(idx + 1, `行 ${rowNum}：跳过（无URL）`); continue; }

            const sid = extractSubjectId(bgmUrl);
            if (!sid) { result.skip++; reportProgress(idx + 1, `行 ${rowNum}：跳过（无有效SID）`); continue; }

            // 冲突跳过
            if (skipSids && skipSids.has(sid)) {
                result.skip++;
                reportProgress(idx + 1, `行 ${rowNum}：跳过（冲突保护）`);
                continue;
            }

            // 增量同步指纹检查
            let currentFingerprint: string | undefined;
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
                const seqCell = getCell(ws, rowNum, 4) as WpsRange | null;
                const isUploaded = seqCell?.Interior && (
                    seqCell.Interior.Color === BGM_COLOR.SUCCESS ||
                    seqCell.Interior.Color === BGM_COLOR.LIGHT_GREEN ||
                    seqCell.Interior.Color === BGM_COLOR.DARK_GREEN
                );
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
            const seqCell = getCell(ws, rowNum, 4) as WpsRange | null;
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
            } else {
                result.fail++;
                reportProgress(idx + 1, `行 ${rowNum}：✗ 失败 (${apiResult.message || apiResult.code})`);
            }

        } catch (e: any) {
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
export function clearSheetMarksInSheet(sheetIndex: number): void {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) return;

        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
        if (!ws) return;

        const lastRow = getLastRow(ws);  // 精确获取最后数据行
        for (let r = 1; r <= lastRow; r++) {
            try {
                const cell = ws.Range(`D${r}`) as WpsRange | null;
                if (cell?.Interior) cell.Interior.ColorIndex = -4142;
            } catch (_) {}
        }
        bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的颜色标记`);
    } catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'clearSheetMarksInSheet' });
    }
}


/**
 * 测试单个条目更新
 *
 * @function testSingleUpdate
 */
export function testSingleUpdate(): void {
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
        } catch (_) {}

        // 查找URL列
        const headerRow = findHeaderRow(ws) || 1;
        const colMap = getColumnMap(ws, headerRow);

        if (!colMap.has('Bangumi_URL')) {
            wpsMsgBox('未找到 Bangumi URL 列', 0, 48);
            return;
        }

        const urlCol = colMap.get('Bangumi_URL')!;
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
            ? trim(readCell(ws, targetRow, colMap.get('完播日')!) || '')
            : '';
        const jsonBody = buildJsonPayload(ws, targetRow, colMap, finishedDate);

        // 发送请求
        const result = bgmRequestSync('POST', `/v0/users${_getUserApiPath()}/collections/${sid}`, jsonBody, token);

        if (result.code >= 200 && result.code < 300) {
            wpsMsgBox(`✓ 测试成功！\n\nSID: ${sid}\nHTTP: ${result.code}\n消息: ${result.message}`, 0, 64);
        } else {
            wpsMsgBox(`✗ 测试失败\n\nSID: ${sid}\nHTTP: ${result.code}\n消息: ${result.message}`, 0, 16);
        }

    } catch (e: any) {
        wpsMsgBox(`测试异常: ${e.message}`, 0, 16);
    }
}


