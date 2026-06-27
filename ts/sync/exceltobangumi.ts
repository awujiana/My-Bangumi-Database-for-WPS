/**
 * @fileoverview Excel到Bangumi同步模块
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版，保留原注释和日志)
 */

import {
    HEADER_KEYWORDS,
    FIELD_NAME_MAP,
    URL_PATTERNS,
    WATCH_STATUS_MAP,
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
    _setBgmUsername,
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
    clearSheetCache,
    WpsAreas
} from '../index.js';

import { getOrCreateSyncRecordSheet, addSyncRecord } from './syncRecord.js';
import { showAlert, showSuccess, showError } from '../ui/dialog.js';

// ========== 常量定义 (优化点：集中管理) ==========
/** 批量读取时需要获取的列名 */
const BATCH_READ_COLUMNS = [
    'Bangumi_URL', '名称', '是否看完', '状态', '观看状态', '打分',
    '标签/分级', '完播日', '类别', '剧透/感言', '集号', '集数', '特点/印象'
] as const;

/** 观看状态类型名称映射 (优化点：提取常量) */
const TYPE_NAMES: Record<number, string> = {
    1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃'
};

/** 默认并发请求数 */
const DEFAULT_CONCURRENCY = 5;
/** 请求最小间隔（毫秒） */
const MIN_REQUEST_INTERVAL = 100;
/** 序列号列默认索引 */
const DEFAULT_SEQ_COL = 4;

// ========== 辅助函数 (优化点：拆分复用) ==========



/**
 * 获取序列号列索引（支持 colMap 或默认列号）
 */
function getSeqColIndex(colMap: Map<string, number> | undefined): number {
    return colMap?.get('序列号') || DEFAULT_SEQ_COL;
}

/**
 * 检查单元格是否已标记为同步成功（颜色判断）
 * @param ws 工作表
 * @param row 行号
 * @param seqCol 序列号列索引（可选，默认4）
 */
function isCellMarkedSuccess(ws: any, row: number, seqCol?: number): boolean {
    try {
        const col = seqCol || DEFAULT_SEQ_COL;
        const cell = getCell(ws, row, col) as WpsRange | null;
        if (!cell?.Interior) return false;
        const color = cell.Interior.Color;
        return color === BGM_COLOR.SUCCESS ||
               color === BGM_COLOR.LIGHT_GREEN ||
               color === BGM_COLOR.DARK_GREEN;
    } catch {
        return false;
    }
}

/**
 * 标记单元格同步结果颜色
 * @param ws 工作表
 * @param row 行号
 * @param isSuccess 是否成功
 * @param seqCol 序列号列索引（可选，默认4）
 */
function markSyncResultColor(ws: any, row: number, isSuccess: boolean, seqCol?: number): void {
    const col = seqCol || DEFAULT_SEQ_COL;
    const cell = getCell(ws, row, col) as WpsRange | null;
    if (cell?.Interior) {
        cell.Interior.Color = isSuccess ? BGM_COLOR.SUCCESS : BGM_COLOR.FAIL;
    }
}

/**
 * 提取HTTP请求结果消息
 */
function extractResponseMessage(data: any): string {
    return data?.msg || data?.message || data?.error || data?.description || 'success';
}

/**
 * 处理请求错误响应
 */
function parseErrorResponse(xhr: XMLHttpRequest): string {
    try {
        const errData = JSON.parse(xhr.responseText);
        return errData.error || errData.description || `HTTP ${xhr.status}`;
    } catch {
        return xhr.statusText || `HTTP ${xhr.status}`;
    }
}

/**
 * 批量读取数据并创建字段快速访问器
 * 优化点：集中批量读取，减少 COM 调用
 */
function createFieldGetter(
    ws: any,
    colMap: Map<string, number>,
    startRow: number,
    lastRow: number
): (row: number, key: string) => string {
    // 批量读取所有需要的数据列
    let maxCol = 1;
    for (const key of BATCH_READ_COLUMNS) {
        if (colMap.has(key)) maxCol = Math.max(maxCol, colMap.get(key)!);
    }
    const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol);

    return (row: number, key: string): string => {
        const col = colMap.get(key);
        if (!col) return '';
        const rowIdx = row - startRow;
        if (allData && rowIdx >= 0 && rowIdx < allData.length) {
            const rowData = allData[rowIdx];
            if (Array.isArray(rowData) && col - 1 < rowData.length) {
                return trim(rowData[col - 1]);
            }
        }
        // 回退到逐单元格读取
        return colMap.has(key) ? trim(getCellValue(ws, row, colMap.get(key)!)) : '';
    };
}

/**
 * 打开Bangumi Token申请页面
 *
 * @function openBangumiTokenPage
 */
export function openBangumiTokenPage(): void {
    const app = (window as any).Application;
    if (app?.OAAssist?.ShellExecute) {
        app.OAAssist.ShellExecute('https://next.bgm.tv/demo/access-token');
    } else {
        window.open('https://next.bgm.tv/demo/access-token', '_blank');
    }
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
        showAlert('请先设置 Token！', '提示');
        return;
    }

    const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`;
    const startTime = Date.now();
    
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] ========== 开始测试 Token ==========`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] API 路由: ${apiUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求方法: GET`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求头: Authorization: Bearer ${testToken.substring(0, 8)}...`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求头: Content-Type: application/json`);

    const xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.timeout = 30000;
    xhr.setRequestHeader('Authorization', 'Bearer ' + testToken);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = () => {
        const duration = Date.now() - startTime;
        
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] ========== 请求完成 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] HTTP 状态码: ${xhr.status} (${xhr.statusText})`);
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求耗时: ${duration}ms`);
        
        if (xhr.getAllResponseHeaders()) {
            bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 响应头: ${xhr.getAllResponseHeaders()}`);
        }
        
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 响应数据: ${JSON.stringify(data).length > 300 ? JSON.stringify(data).substring(0, 300) + '...' : JSON.stringify(data)}`);
                
                const nickname = data.nickname || data.username || '未知用户';
                const userId = String(data.id || '未知ID');
                
                bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] Token 验证成功！用户名: ${nickname}, 用户ID: ${userId}`);
                showSuccess(`Token有效！\n\n用户名: ${nickname}\n用户ID: ${userId}`, '验证成功');
                
                notifyUserInfoUpdated(nickname, userId);
                
            } catch (e: any) {
                bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] 解析响应失败: ${e.message}`);
                BGM.handleError(e, { context: 'testTokenValidityForRibbon', showAlert: false });
                showError('Token有效，但解析响应失败', '错误');
            }
        } else if (xhr.status === 401) {
            bgmLog(LOG_LEVELS.WARN, `[exceltobangumi/testTokenValidityForRibbon] Token 无效或已过期`);
            showError('Token无效或已过期，请重新获取', '验证失败');
        } else {
            bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] Token验证失败，HTTP 状态码: ${xhr.status}`);
            bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 响应内容: ${xhr.responseText}`);
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
    
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 正在发送请求...`);
    xhr.send();
}

/**
 * 通知面板用户信息已更新
 */
function notifyUserInfoUpdated(username: string, userId: string): void {
    try {
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 开始通知用户信息更新:`);
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated]   用户名: ${username}`);
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated]   用户ID: ${userId}`);
        
        // 更新内存缓存 + 持久化到 PluginStorage
        _setBgmUserId(userId);
        _setBgmUsername(username);
        BGM.cache.username = username;
        BGM.cache.userId = userId;
        
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 用户信息已持久化到 PluginStorage`);
        
        // 尝试通过 GetTaskPane 直接通知 Taskpane 刷新 UI
        // 如果 GetTaskPane.contentWindow 不可用（不同 WPS 版本或安全限制），
        // Taskpane 的轮询机制会在 1-2 秒内检测到变更
        try {
            const app = getApp();
            const tsId = (app as any)?.PluginStorage?.getItem('taskpane_id');
            if (tsId) {
                const pane = (app as any)?.GetTaskPane?.(tsId);
                if (pane?.contentWindow?.refreshTaskpaneUI) {
                    pane.contentWindow.refreshTaskpaneUI();
                    bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 已通过 GetTaskPane 通知 Taskpane 刷新`);
                }
            }
        } catch (e: any) {
            bgmLog(LOG_LEVELS.WARN, `[notifyUserInfoUpdated] GetTaskPane 通知失败（轮询兜底）: ${e.message}`);
        }
        
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 通知完成`);
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, '通知用户信息更新失败: ' + (e as Error).message);
    }
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
 * @function mapWatchStatus
 * @param {string} status - 观看状态文本
 * @returns {number} API数值：1=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
 *
 * @description
 * 支持的状态文本映射：
 * - 想看/想看动画/否/wish → 1
 * - 在看/在看动画/在追/追/watching → 2
 * - 看过/看完/已看/完/completed → 3
 * - 搁置/暂停/on_hold → 4
 * - 抛弃/弃/弃番/drop/dropped → 5
 *
 * @example
 * mapWatchStatus('看完'); // 返回 3
 * mapWatchStatus('在看'); // 返回 2
 */
export function mapWatchStatus(status: string): number {
    if (!status) return 1;

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
    if (normalized === 'true') return 3;
    if (normalized === 'false') return 0;

    // 数字字符串转换
    const num = parseInt(normalized, 10);
    if (!isNaN(num) && num >= 0 && num <= 5) {
        return num;
    }

    // 无法识别的状态，记录警告日志
    bgmLog(LOG_LEVELS.WARN, `[mapWatchStatus] 无法识别的状态值: "${status}"，返回 0（无效）`);
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
export function addTagsFromStr(tagSet: Set<string>, raw: string) {
    if (!raw) return;
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
export function buildTagsArray(tagsRaw: string): string[] {
    const tagSet = new Set<string>();
    addTagsFromStr(tagSet, tagsRaw);
    return Array.from(tagSet);
}

/**
 * 获取筛选状态（可见行）
 * @param wsOrLastRow 工作表对象或最后行号（兼容旧用法）
 * @param lastRow 最后行号（当 wsOrLastRow 为工作表时）
 * @param headerRow 表头行号，用于排除
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export function getFilterStatus(
    wsOrLastRow?: WpsWorksheet | number,
    lastRow?: number,
    headerRow?: number,
    deepCheck?: boolean  // true: 也检测非 AutoFilter 的隐藏行（性能开销）
): {
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

        let ws: WpsWorksheet | null = null;
        let effectiveLastRow: number | undefined;
        let effectiveHeaderRow: number | undefined;

        if (typeof wsOrLastRow === 'number') {
            effectiveLastRow = wsOrLastRow;
            effectiveHeaderRow = lastRow;
            ws = app.ActiveWorkbook.ActiveSheet;
            bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（兼容模式）`);
        } else if (wsOrLastRow) {
            ws = wsOrLastRow;
            effectiveLastRow = lastRow;
            effectiveHeaderRow = headerRow;
            bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用传入的工作表: ${ws.Name}`);
        } else {
            ws = app.ActiveWorkbook.ActiveSheet;
            bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（无参数）`);
        }

        if (!isWpsWorksheet(ws)) return result;

        let autoFilterMode = false;
        try { autoFilterMode = !!ws.AutoFilterMode; } catch (e: any) {
            BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
        }
        bgmLog(LOG_LEVELS.INFO, `getFilterStatus: AutoFilterMode=${autoFilterMode}, ws.Name=${ws.Name}, deepCheck=${deepCheck}`);

        // 2. 快速检测：仅在 deepCheck 时才扫描全范围
        //    旧用法（无 deepCheck）只查 AutoFilter，这是兼容的快速路径
        if (!autoFilterMode && !deepCheck) {
            bgmLog(LOG_LEVELS.INFO, 'getFilterStatus: 快速路径：无 AutoFilter');
            return result;
        }

        // 3. 确定扫描范围（非 AutoFilter 模式需要全范围扫描隐藏行）
        const maxRow = effectiveLastRow && effectiveLastRow > 0 ? effectiveLastRow : ws.Rows.Count;
        const scanRange = ws.Range(`A1:A${maxRow}`);
        bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 扫描范围 A1:A${maxRow}`);

        // 4. 获取可见单元格来检测筛选/隐藏行
        let visibleCells: WpsRange | null = null;
        if (autoFilterMode) {
            try {
                if (ws.AutoFilter?.Range) {
                    visibleCells = ws.AutoFilter.Range.SpecialCells(12) as WpsRange;
                    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: AutoFilter 模式`);
                }
            } catch (e: any) {
                BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
            }
        } else {
            // deepCheck 模式：用全范围检测手动隐藏行
            try {
                visibleCells = scanRange.SpecialCells(12) as WpsRange;
            } catch (e: any) { /* 所有行可见时抛出异常，忽略 */ }
        }

        if (!visibleCells) {
            bgmLog(LOG_LEVELS.INFO, 'getFilterStatus: 无筛选');
            return result;
        }

        // 5. 快速判断：可见行数 ≈ 总行数 → 无隐藏行（仅对非 AutoFilter 的 deepCheck 模式）
        if (!autoFilterMode) {
            try {
                const totalCount = scanRange.Count;
                const visibleCount = visibleCells.Count;
                if (visibleCount >= totalCount) {
                    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 所有 ${maxRow} 行均可见，无筛选`);
                    return result;
                }
            } catch (e: any) { /* Count 异常则继续走完整检测 */ }
        }

        result.hasFilter = true;

        // 6. 提取所有可见行号（去重）
        const rawRows = new Set<number>();
        if (visibleCells) {
            const areas: WpsRange[] = [];
            try {
                if (visibleCells.Areas) {
                    for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                        areas.push(visibleCells.Areas.Item(a));
                    }
                } else {
                    areas.push(visibleCells);
                }
            } catch (e: any) {
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
            const rowList = Array.from(rawRows).sort((a, b) => a - b);
            const previewCount = Math.min(rowList.length, 15);
            for (let i = 0; i < previewCount; i++) {
                const r = rowList[i];
                const vals: string[] = [];
                for (let c = 1; c <= 3; c++) {
                    vals.push(getCellValue(ws, r, c));
                }
                bgmLog(LOG_LEVELS.INFO, `  行 ${r}: ${vals.join(' | ')}`);
            }
            if (rowList.length > previewCount) {
                bgmLog(LOG_LEVELS.INFO, `  ... 剩余 ${rowList.length - previewCount} 行省略`);
            }
        }

        // 6. 生成最终可见行列表（排除表头行）
        for (const r of rawRows) {
            if (effectiveHeaderRow != null && r === effectiveHeaderRow) continue;
            result.visibleRows.push(r);
        }
        result.visibleRows.sort((a, b) => a - b);

        bgmLog(LOG_LEVELS.INFO, `有效可见数据行: ${result.visibleRows.length} 行`);
        if (result.visibleRows.length > 0) {
            bgmLog(LOG_LEVELS.INFO, `可见行前10: ${result.visibleRows.slice(0, 10).join(',')}`);
        }

    } catch (e: any) {
        BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });   
    }

    return result;
}

/**
 * 根据序列号列获取连续的有效行
 *
 * @function getSequentialRowsBySeqCol
 * @param {number} startRow - 起始行
 * @param {number} endRow - 结束行
 * @param {Map<string, number>} [colMap] - 列映射（可选）
 * @returns {{ validRows: number[]; seqMap: Map<string, number> }} 有效行和序列号映射
 *
 * @description
 * 扫描序列号列，找出有序列号的数据行。
 * 序列号格式应为数字，用于标记同步进度。
 */
export function getSequentialRowsBySeqCol(
    startRow: number,
    endRow: number,
    colMap?: Map<string, number>
): { validRows: number[]; seqMap: Map<string, number> } {
    const result = {
        validRows: [] as number[],
        seqMap: new Map<string, number>()
    };

    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) return result;

        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws) return result;

        const seqCol = getSeqColIndex(colMap);
        for (let r = startRow; r <= endRow; r++) {
            try {
                const val = getCellValue(ws, r, seqCol);
                if (val !== null && val !== undefined && val !== '') {
                    const seqNum = String(val).trim();
                    if (/^\d+$/.test(seqNum)) {
                        result.validRows.push(r);
                        result.seqMap.set(seqNum, r);
                    }
                }
            } catch (e: any) {
                BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
            }
        }
    } catch (e: any) {
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
 * comment（感言）、private（是否私有）
 */
export function buildJsonPayload(
    getField: (key: string) => string,
    finishedDate: string
): string {
    try {
        const payload: Record<string, any> = {};

        // 观看状态 - 支持多种列名
        const statusKeys = ['是否看完', '状态', '观看状态', '收藏类型', 'type'];
        let statusFound = false;
        let rawStatusValue = '';
        for (const key of statusKeys) {
            const statusVal = trim(getField(key));
            if (statusVal) {
                rawStatusValue = statusVal;
                const mappedStatus = mapWatchStatus(statusVal);
                if (mappedStatus !== undefined && mappedStatus > 0) {
                    payload.type = mappedStatus;
                    statusFound = true;
                    bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusVal}" -> ${mappedStatus}`);
                    break;
                } else {
                    bgmLog(LOG_LEVELS.WARN, `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusVal}" -> ${mappedStatus} (无效)`);
                }
            }
        }
          if (!statusFound) {
            bgmLog(LOG_LEVELS.ERROR, `[buildJsonPayload] 未找到有效的观看状态，返回空对象，原始值: "${rawStatusValue}"`);
            return '{}';
        }

        // 评分
        const rateVal = trim(getField('打分'));
        if (rateVal && rateVal !== 'true' && rateVal !== 'True') {
            const rate = parseFloat(rateVal);
            if (!isNaN(rate) && rate >= 0 && rate <= 10) {
                payload.rate = rate;
            }
        }

        // 标签
        const tagsVal = trim(getField('标签/分级'));
        if (tagsVal) {
            payload.tags = buildTagsArray(tagsVal);
        }

        // 感言
        let commentVal = trim(getField('剧透/感言') || getField('感言'));
        const nVal = trim(getField('特点/印象'));
        bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 剧透/感言="${commentVal}", 特点/印象="${nVal}"`);
        if (nVal) {
            commentVal = commentVal ? `${commentVal}\n${nVal}` : nVal;
        }
        if (commentVal) {
            payload.comment = commentVal;
        }

        // 隐私收藏
        const privateVal = trim(getField('私密收藏')).toLowerCase();
        if (privateVal === '是' || privateVal === '1' || privateVal === 'true') {
            payload.private = true;
        }

        return JSON.stringify(payload);
    } catch (e: any) {
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
export async function bgmRequestSync(
    method: string,
    endpoint: string,
    jsonBody: string,
    token: string
): Promise<{ code: number; message: string }> {
    const fullUrl = `${BGM_CONFIG.API_BASE}${endpoint}`;
    bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] ${method} ${fullUrl} 请求体长度: ${jsonBody.length}`);

    try {
        return await new Promise<{ code: number; message: string }>((resolve) => {
            const result = { code: 0, message: '' };
            const xhr = new XMLHttpRequest();
            xhr.open(method.toUpperCase(), fullUrl, true);
            xhr.timeout = 30000;
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.setRequestHeader('Content-Type', 'application/json');

            xhr.onload = function () {
                result.code = xhr.status;
                if (xhr.status >= 200 && xhr.status < 300) {
                    result.message = 'success';
                    if (xhr.responseText) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            result.message = extractResponseMessage(data);
                        } catch (_) {}
                    }
                } else if (xhr.status === 429) {
                    result.message = 'Rate limited';
                } else {
                    result.message = parseErrorResponse(xhr);
                }
                resolve(result);
            };

            xhr.onerror = function () {
                result.code = 0;
                result.message = 'Network error';
                resolve(result);
            };

            xhr.ontimeout = function () {
                result.code = 0;
                result.message = 'Request timeout';
                resolve(result);
            };

            xhr.send(jsonBody);
        });
    } catch (e: any) {
        bgmLog(LOG_LEVELS.ERROR, `[bgmRequestSync] 异常: ${e.message}`);
        return { code: 0, message: e.message || 'Network error' };
    }
}

/**
 * 设置Bangumi Token
 *
 * @function setBangumiToken
 * @param {string} token - Token字符串
 * @returns {boolean} 是否保存成功
 */
export function setBangumiToken(token: string): boolean {
    if (!token) return false;

    try {
        storeBgToken(token);
        bgmLog(LOG_LEVELS.INFO, 'Token已保存');
        return true;
    } catch (e: any) {
        BGM.handleError(e, { context: 'setBangumiToken', showAlert: false });
        return false;
    }
}



/**
 * 同步任务项接口
 */
interface SyncTask {
    rowNum: number;
    sid: string;
    bgmUrl: string;
    name: string;
    jsonBody: string;
    fingerprint?: string;
    type: number;           // 观看状态类型 1-5
    epCount?: number;       // 要标记为已完成的集数
}

/**
 * 批量执行同步请求（并发控制）
 * 优化点：提取独立函数，保留所有原有日志
 * @param tasks 同步任务列表
 * @param token API Token
 * @param userIdPath 用户路径
 * @param concurrency 并发数
 * @returns 成功和失败的任务列表以及是否停止
 */
async function batchSyncRequests(
    tasks: SyncTask[],
    token: string,
    userIdPath: string,
    concurrency: number = DEFAULT_CONCURRENCY
): Promise<{ success: SyncTask[]; fail: SyncTask[]; stopped: boolean }> {
    const success: SyncTask[] = [];
    const fail: SyncTask[] = [];
    let lastRequestTime = 0;
    let stopped = false;

    const queue = [...tasks];
    const executing: { promise: Promise<void>; task: SyncTask; done: boolean }[] = [];

    while (queue.length > 0 || executing.length > 0) {
        if (BGM.sync.checkShouldStop()) {
            bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 检测到停止请求，正在停止...');
            stopped = true;
            if (executing.length > 0) {
                await Promise.all(executing.map(e => e.promise));
            }
            break;
        }

        while (executing.length < concurrency && queue.length > 0) {
            const task = queue.shift()!;
            const entry = { promise: null as any, task, done: false };

            entry.promise = (async () => {
                try {
                    const now = Date.now();
                    const elapsed = now - lastRequestTime;
                    if (elapsed < MIN_REQUEST_INTERVAL) {
                        await delay(MIN_REQUEST_INTERVAL - elapsed);
                    }

                    const apiResult = await bgmRequestSync(
                        'POST',
                        `/v0/users${userIdPath}/collections/${task.sid}`,
                        task.jsonBody,
                        token
                    );
                    lastRequestTime = Date.now();

                    if (apiResult.code >= 200 && apiResult.code < 300) {
                        success.push(task);
                        bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 同步成功，HTTP ${apiResult.code}`);

                        // 标记章节为已完成（仅"看过"状态才需要标记）
                        if (task.type === 3 && task.epCount && task.epCount > 0) {
                            try {
                                bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 状态"看过"(type=3)，集数: ${task.epCount}，开始标记章节...`);
                                const epResult = await markEpisodesComplete(task.sid, task.epCount, token);
                                bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 章节标记结果: ${epResult.message}`);
                            } catch (epErr: any) {
                                bgmLog(LOG_LEVELS.WARN, `[batchSyncRequests] SID ${task.sid} 章节标记异常: ${epErr.message}`);
                            }
                        } else if (task.epCount && task.epCount > 0) {
                            bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 状态非"看过"(type=${task.type})，跳过章节标记`);
                        }
                    } else {
                        fail.push(task);
                        bgmLog(LOG_LEVELS.WARN, `[batchSyncRequests] SID ${task.sid} 同步失败，HTTP ${apiResult.code}，消息: ${apiResult.message}`);
                    }
                } catch (e: any) {
                    fail.push(task);
                    bgmLog(LOG_LEVELS.ERROR, `[batchSyncRequests] SID ${task.sid} 同步异常: ${e.message}`);
                } finally {
                    entry.done = true;
                }
            })();

            executing.push(entry);
        }

        if (executing.length > 0) {
            await Promise.race(executing.map(e => e.promise));
            for (let i = executing.length - 1; i >= 0; i--) {
                if (executing[i].done) executing.splice(i, 1);
            }
        }
    }

    return { success, fail, stopped };
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
 * @returns {Promise<{ success: number; fail: number; skip: number; stopped: boolean }>} 同步结果统计
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
 * 同步选项接口
 */
export interface SyncOptions {
    /** 进度回调 */
    onProgress?: (current: number, total: number, message: string) => void;
    /** 单条完成回调 */
    onItemComplete?: (row: number, success: boolean, result: { code: number; message: string }) => void;
    /** 需要跳过的SID集合（冲突处理） */
    skipSids?: Set<string>;
    /** 是否启用增量同步（基于指纹） */
    incremental?: boolean;
}
export async function SyncToBangumiAsync(
    ws: any,
    colMap: Map<string, number>,
    token: string,
    lastRow: number,
    headerRow: number,
    options?: SyncOptions
): Promise<{ success: number; fail: number; skip: number; stopped: boolean }> {
    const result = { success: 0, fail: 0, skip: 0, stopped: false };
    const startRow = headerRow + 1;
    const startTime = Date.now();
    const seqCol = getSeqColIndex(colMap);

    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] ========== 开始批量同步 ==========');
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 配置参数：`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 增量同步模式: ${options?.incremental ? '开启' : '关闭'}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 跳过冲突数量: ${options?.skipSids?.size || 0}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 表头行: ${headerRow}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 最后一行: ${lastRow}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 序列号列: ${seqCol} (列${colNumToLetter(seqCol)})`);

    // ========== 1. 获取可见行（筛选状态） ==========
    const filterStatus = getFilterStatus(ws, lastRow, headerRow, true);
    let rowsToProcess: number[] = [];
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        rowsToProcess = filterStatus.visibleRows.filter(r => r >= startRow);
        bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 筛选模式：处理 ${rowsToProcess.length} 个可见行`);
    } else {
        for (let r = startRow; r <= lastRow; r++) rowsToProcess.push(r);
    }
    const total = rowsToProcess.length;
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 总行数: ${total}`);

    // ========== 2. 批量读取数据缓存（性能关键） ==========
    const getField = createFieldGetter(ws, colMap, startRow, lastRow);

    // ========== 3. 增量同步：构建历史指纹映射 ==========
    let fingerprintMap: Map<string, string> | undefined;
    if (options?.incremental) {
        bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 正在加载历史同步记录...');
        const allRecords = getAllSyncRecords();
        fingerprintMap = new Map();
        for (const r of allRecords) {
            if (r.sid && r.fingerprint) {
                fingerprintMap.set(r.sid, r.fingerprint);
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 增量同步模式：已加载 ${fingerprintMap.size} 条历史指纹`);
    }

    // ========== 4. 预处理：收集所有需要同步的任务 ==========
    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤4: 预处理收集同步任务');
    const syncTasks: SyncTask[] = [];
    const skipSids = options?.skipSids;
    const userIdPath = _getUserApiPath();

    for (let idx = 0; idx < rowsToProcess.length; idx++) {
        const rowNum = rowsToProcess[idx];

        try {
            const bgmUrl = getField(rowNum, 'Bangumi_URL');
            if (!bgmUrl) { result.skip++; continue; }

            const sid = extractSubjectId(bgmUrl);
            if (!sid) { result.skip++; continue; }

            // 冲突跳过
            if (skipSids && skipSids.has(sid)) {
                result.skip++;
                continue;
            }

            // 检查观看状态是否为空
            const watchStatusField = getField(rowNum, '是否看完') || getField(rowNum, '状态') || getField(rowNum, '观看状态');
            if (!watchStatusField) {
                result.skip++;
                continue;
            }

            // 获取观看状态类型
            const watchType = mapWatchStatus(watchStatusField);
            if (watchType === 0) {
                result.skip++;
                continue;
            }

            // 增量同步指纹检查
            let currentFingerprint: string | undefined;
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

                const storedFingerprint = fingerprintMap.get(sid);
                if (storedFingerprint === currentFingerprint) {
                    result.skip++;
                    continue;
                }
            }

            // 检查已上传颜色（非增量模式）
            if (!fingerprintMap && isCellMarkedSuccess(ws, rowNum, seqCol)) {
                result.skip++;
                continue;
            }

            const finishedDate = getField(rowNum, '完播日');
            const jsonBody = buildJsonPayload((key) => getField(rowNum, key), finishedDate);
            const name = getField(rowNum, '名称');

            syncTasks.push({
                rowNum,
                sid,
                bgmUrl,
                name,
                jsonBody,
                fingerprint: currentFingerprint,
                type: watchType,
                epCount: (() => {
                    const raw = trim(getField(rowNum, '集数') || getField(rowNum, '集号') || '');
                    const n = parseInt(raw, 10);
                    return (!isNaN(n) && n > 0) ? n : undefined;
                })()
            });

        } catch (e: any) {
            result.fail++;
            BGM.handleError(e, { level: BGM.ErrorLevel.WARN, context: 'SyncToBangumiAsync:preprocess' });
        }
    }

    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 预处理完成：${syncTasks.length} 条待同步，${result.skip} 条跳过（失败${result.fail}条）`);

    // ========== 5. 批量执行同步请求（并发控制） ==========
    const reportProgress = (current: number, message: string) => {
        if (options?.onProgress) options.onProgress(current, syncTasks.length, message);
    };

    // 尝试创建同步记录表
    try { getOrCreateSyncRecordSheet(); } catch (e: any) {
        BGM.handleError(e, { level: BGM.ErrorLevel.WARN, context: 'SyncToBangumiAsync:createSheet' });
    }

    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤5: 开始批量同步请求');
    const { success: successTasks, fail: failTasks, stopped } = await batchSyncRequests(
        syncTasks,
        token,
        userIdPath,
        DEFAULT_CONCURRENCY
    );

    // ========== 6. 批量更新 UI 和记录 ==========
    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤6: 批量更新 UI 和记录');

    // 批量更新成功项
    for (const task of successTasks) {
        // 标记颜色
        markSyncResultColor(ws, task.rowNum, true, seqCol);

        // 记录同步日志
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

    // 批量更新失败项
    for (const task of failTasks) {
        markSyncResultColor(ws, task.rowNum, false, seqCol);

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

    // 处理未执行的任务（如果停止了）
    if (stopped) {
        result.stopped = true;
        const executedCount = successTasks.length + failTasks.length;
        const remainingTasks = syncTasks.slice(executedCount);
        for (const task of remainingTasks) {
            result.skip++;
            bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 任务被跳过（停止）: SID=${task.sid}`);
        }
        bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 同步已停止，${remainingTasks.length} 条任务被跳过`);
    }

    const totalTime = Date.now() - startTime;
    reportProgress(syncTasks.length, stopped ? '同步已停止' : '同步完成');
    BGM.setSyncComplete(result);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 同步完成: 成功=${result.success}, 失败=${result.fail}, 跳过=${result.skip}, 已停止=${result.stopped}, 总耗时=${totalTime}ms`);
    return result;
}

/**
 * 获取条目的所有章节 ID（按集号排序）
 */
async function fetchEpisodeIds(sid: string | number, token: string): Promise<number[]> {
    const url = `${BGM_CONFIG.API_BASE}/v0/episodes?subject_id=${sid}&limit=1000`;
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 30000;
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const episodes: { id: number; sort: number }[] = data.data || [];
                    episodes.sort((a, b) => (a.sort || 0) - (b.sort || 0));
                    resolve(episodes.map(ep => ep.id));
                } catch {
                    reject(new Error('解析章节数据失败'));
                }
            } else {
                reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
            }
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send();
    });
}

/**
 * 标记前 N 集为已完成
 */
async function markEpisodesComplete(
    sid: string | number,
    epCount: number,
    token: string
): Promise<{ success: boolean; message: string }> {
    try {
        const allIds = await fetchEpisodeIds(sid, token);
        if (allIds.length === 0) {
            return { success: false, message: '该条目没有章节数据' };
        }
        const targetIds = allIds.slice(0, epCount);
        if (targetIds.length === 0) {
            return { success: false, message: '没有需要标记的章节' };
        }
        const body = JSON.stringify({ episode_id: targetIds, type: 2 });
        const result = await bgmRequestSync('PATCH', `/v0/users/-/collections/${sid}/episodes`, body, token);
        if (result.code >= 200 && result.code < 300) {
            return { success: true, message: `已标记前 ${targetIds.length} 集为已完成` };
        }
        return { success: false, message: result.message };
    } catch (e: any) {
        return { success: false, message: e.message || '未知错误' };
    }
}

/**
 * 选中行同步到 Bangumi（多行/单行）
 *
 * @function syncSelectedRows
 */
export async function syncSelectedRows(): Promise<void> {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] ========== 开始选中行同步 ==========');

    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) {
            bgmLog(LOG_LEVELS.ERROR, '[syncSelectedRows] 无法获取 Application');
            wpsMsgBox('无法获取 Application', 0, 48);
            return;
        }

        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws) {
            bgmLog(LOG_LEVELS.ERROR, '[syncSelectedRows] 无法获取工作表');
            wpsMsgBox('无法获取工作表', 0, 48);
            return;
        }
        bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 工作表获取成功');

        // 获取选中的行范围
        let rawRows: number[] = [];
        try {
            const sel = app.Selection;
            if (!sel) {
                bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 未选中任何区域');
                wpsMsgBox('请先在Excel中选中要同步的数据行', 0, 48);
                return;
            }
            const startRow = sel.Row;
            const rowCount = sel.Rows.Count;
            for (let r = startRow; r < startRow + rowCount; r++) {
                rawRows.push(r);
            }
            bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 选中区域: ${rowCount} 行，行号 ${startRow}-${startRow + rowCount - 1}`);
        }
        catch (e: any) {
            BGM.handleError(e, { context: 'syncSelectedRows', showAlert: false });
            wpsMsgBox('获取选中区域失败，请检查是否选中了有效区域', 0, 48);
            return;
        }

        if (rawRows.length === 0) {
            bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 没有选中任何行');
            wpsMsgBox('请先在Excel中选中要同步的数据行', 0, 48);
            return;
        }

        const headerRow = findHeaderRow(ws) || 1;
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 表头行: ${headerRow}`);

        // 排除表头行
        const rows = rawRows.filter(r => r > headerRow);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 排除表头后有效数据行: ${rows.length} 行（原始选中 ${rawRows.length} 行）`);

        if (rows.length === 0) {
            bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 排除表头后没有有效数据行');
            wpsMsgBox('当前选中区域只有表头行，没有数据行', 0, 48);
            return;
        }

        clearSheetCache(ws);
        const colMap = getColumnMap(ws, headerRow);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 列映射完成，共 ${colMap.size} 列`);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 集数列号: ${colMap.get('集数')}, 集号列号: ${colMap.get('集号')}, Bangumi_URL列号: ${colMap.get('Bangumi_URL')}`);

        if (!colMap.has('Bangumi_URL')) {
            bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 未找到 Bangumi_URL 列');
            wpsMsgBox('未找到 Bangumi URL 列', 0, 48);
            return;
        }

        const token = loadBgToken();
        if (!token) {
            bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] Token 未设置');
            wpsMsgBox('请先设置 Token', 0, 48);
            return;
        }
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] Token 已设置（长度: ${token.length}）`);

        const urlCol = colMap.get('Bangumi_URL')!;
        const nameCol = colMap.has('名称') ? colMap.get('名称')! : undefined;
        const userPath = _getUserApiPath();

        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;
        let episodeMarkCount = 0;
        const details: string[] = [];

        for (let idx = 0; idx < rows.length; idx++) {
            const rowNum = rows[idx];
            const rowProgress = `[${idx + 1}/${rows.length}]`;

            try {
                const bgmUrl = trim(getCellValue(ws, rowNum, urlCol) || '');
                const name = nameCol ? trim(getCellValue(ws, nameCol === urlCol ? rowNum : rowNum, nameCol) || '') : '';

                if (!bgmUrl) {
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} 行${rowNum} "${name || '无名'}" URL为空，跳过`);
                    skipCount++;
                    continue;
                }

                const sid = extractSubjectId(bgmUrl);
                if (!sid) {
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} 行${rowNum} "${name || '无名'}" 无法提取 Subject ID: ${bgmUrl}，跳过`);
                    skipCount++;
                    continue;
                }

                bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 开始同步: 名称="${name || '无名'}", SID=${sid}, URL=${bgmUrl}`);

                const finishedDate = colMap.has('完播日')
                    ? trim(getCellValue(ws, rowNum, colMap.get('完播日')!) || '')
                    : '';
                const jsonBody = buildJsonPayload((key) => colMap.has(key) ? trim(getCellValue(ws, rowNum, colMap.get(key)!)) : '', finishedDate);

                if (jsonBody === '{}') {
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} 行${rowNum} "${name || sid}" 请求体为空，跳过`);
                    skipCount++;
                    continue;
                }

                bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 请求体: ${jsonBody.length > 300 ? jsonBody.substring(0, 300) + '...' : jsonBody}`);

                const endpoint = `/v0/users${userPath}/collections/${sid}`;
                const result = await bgmRequestSync('POST', endpoint, jsonBody, token);

                if (result.code >= 200 && result.code < 300) {
                    successCount++;
                    details.push(`✓ 行${rowNum} ${name || sid} HTTP:${result.code}`);
                    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} "${name || sid}" 同步成功！HTTP: ${result.code}`);

                    // 标记章节为已完成（仅"看过"状态才需要标记）
                    const watchType = JSON.parse(jsonBody).type;
                    const epRaw = trim(getCellValue(ws, rowNum, colMap.has('集数') ? colMap.get('集数')! : colMap.get('集号')!));
                    const epCount = parseInt(epRaw, 10);
                    if (watchType === 3 && !isNaN(epCount) && epCount > 0) {
                        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 状态"看过"(type=3)，集数: ${epCount}，开始标记章节...`);
                        const epResult = await markEpisodesComplete(sid, epCount, token);
                        episodeMarkCount++;
                        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 章节标记结果: ${epResult.message}`);
                    }
                    else if (!isNaN(epCount) && epCount > 0) {
                        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 状态非"看过"(type=${watchType})，跳过章节标记`);
                    }
                }
                else {
                    failCount++;
                    details.push(`✗ 行${rowNum} ${name || sid} HTTP:${result.code}`);
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} 行${rowNum} "${name || sid}" 同步失败！HTTP: ${result.code}, 消息: ${result.message}`);
                }
            }
            catch (e: any) {
                failCount++;
                bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] ${rowProgress} 行${rowNum} 处理异常: ${e.message}`);
            }
        }

        // 输出最终汇总日志
        const elapsed = Date.now() - startTime;
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ========== 汇总 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 总行数: ${rows.length}  |  成功: ${successCount}  |  失败: ${failCount}  |  跳过: ${skipCount}  |  标记章节: ${episodeMarkCount}  |  耗时: ${elapsed}ms`);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 详情: ${details.join('  |  ')}`);

        // 弹出结果
        let summary = `📊 选中 ${rows.length} 行 | 耗时 ${(elapsed / 1000).toFixed(1)}s\n\n✅ 成功: ${successCount}\n❌ 失败: ${failCount}\n⏭️ 跳过: ${skipCount}\n📺 标记章节: ${episodeMarkCount}`;
        if (details.length > 0) {
            summary += `\n\n--- 详情 ---\n${details.slice(0, 30).join('\n')}`;
            if (details.length > 30) {
                summary += `\n... 还有 ${details.length - 30} 条`;
            }
        }
        wpsMsgBox(summary, 0, 64);
    }
    catch (e: any) {
        BGM.handleError(e, { context: 'syncSelectedRows', showAlert: false });
        bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] 同步异常: ${e.message}`);
        wpsMsgBox(`选中行同步异常: ${e.message}`, 0, 16);
    }

    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ========== 选中行同步结束，总耗时: ${Date.now() - startTime}ms ==========`);
}