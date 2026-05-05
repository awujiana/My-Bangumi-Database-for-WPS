/**
 * Bangumi API 同步模块
 * @module bangumi
 * @description 从 Excel 读取条目并批量同步到 Bangumi 收藏
 */

import { XL, BGM_CONFIG, LOG_LEVELS, BGM } from './util.js';
import { getApp, bgmLog, getCell, getCellValue, sleep, loadBgToken, 
         _setBgmUserId, _getBgmUserId } from './util.js';
import { showDialog, sendToTaskpane, showTokenDialog, showUserIdDialog } from './ui/dialog.js';
import { httpRequest, SyncProgressCallback } from './http.js';
import { Result } from './types/result.js';

// ========== 常量定义 ==========
// Excel 列常量
const COLUMNS = {
    SEQUENCE: 4,      // D列 - 序号
    DEFAULT_START: 1   // 默认起始列
};

// 同步状态颜色常量
const SYNC_STATUS_COLOR = {
    SUCCESS: 10,       // 绿色 - 成功
    FAILURE: 3,        // 红色 - 失败
    WARNING: 6,         // 黄色 - 警告
    INFO: 5,           // 蓝色 - 信息
    SKIP: 16           // 灰色 - 跳过
};

// 状态映射常量
const WATCH_STATUS_MAP = {
    "看过": 3, "看完": 3, "已看": 3, "completed": 3, "3": 3,
    "在看": 2, "在看动画": 2, "watching": 2, "2": 2,
    "想看": 1, "想看动画": 1, "wish": 1, "1": 1,
    "搁置": 4, "on_hold": 4, "4": 4,
    "抛弃": 5, "drop": 5, "dropped": 5, "5": 5
};

// 收藏类型文本映射
const TYPE_TEXT_MAP = {1:"想看", 2:"在看", 3:"看过", 4:"搁置", 5:"抛弃"};

// URL 解析正则
const URL_PATTERNS = [
    /bgm\.tv\/subject\/(\d+)/i,
    /bangumi\.tv\/subject\/(\d+)/i,
    /chii\.in\/subject\/(\d+)/i,
    /(\d{6,})/
];

// 表头识别关键词
const HEADER_KEYWORDS = ["条目id", "bangumi url", "url", "sid", "名称", "name", "状态", "status", "评分", "rate"];

// 表头字段映射
const FIELD_NAME_MAP = {
    "名称": "name", "name": "name", "作品名": "name", "条目": "name", "标题": "name",
    "条目id": "subjectId", "sid": "subjectId", "subject_id": "subjectId", "id": "subjectId",
    "bangumi url": "url", "url": "url", "链接": "url", "地址": "url",
    "状态": "type", "type": "type", "观看状态": "type", "收藏类型": "type",
    "评分": "rate", "rate": "rate", "分数": "rate", "rating": "rate",
    "标签": "tags", "tags": "tags", "tag": "tags",
    "评价": "comment", "comment": "comment", "备注": "comment", "notes": "comment",
    "看完日期": "finishedDate", "finished": "finishedDate", "日期": "finishedDate",
    "章节状态": "epStatus", "ep_status": "epStatus", "集数": "epStatus",
    "同步状态": "syncStatus", "sync_status": "syncStatus"
};

// ========== 工具函数 ==========
/**
 * 解析 JSON 请求体为可读描述
 */
export function parseJsonBodySummary(jsonStr) {
    if (!jsonStr) return "(空)";
    try {
        let obj = JSON.parse(jsonStr);
        let parts = [];
        if (obj.type !== undefined) parts.push("状态:" + (TYPE_TEXT_MAP[obj.type] || obj.type));
        if (obj.rate !== undefined && obj.rate > 0) parts.push("评分:" + obj.rate);
        if (obj.tags && obj.tags.length > 0) parts.push("标签:[" + obj.tags.join(",") + "]");
        if (obj.comment) {
            let comment = obj.comment.length > 30 ? obj.comment.substring(0, 30) + "..." : obj.comment;
            parts.push("评价:" + comment);
        }
        return parts.length > 0 ? parts.join(" | ") : "(仅标记状态)";
    } catch (e) {
        return jsonStr;
    }
}

// ========== 获取数据工作表 ==========
/**
 * 获取数据工作表
 */
export function getDataSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        return null;
    }

    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        try {
            return app.ActiveWorkbook.Worksheets(BGM.sheet.lockedIndex);
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "getDataSheet 锁定工作表失败: " + e.message);
        }
    }

    return app.ActiveWorkbook.ActiveSheet;
}

/**
 * 获取 Bangumi Token
 */
export function getBgmtoken() {
    return loadBgToken();
}

// ========== 获取D列最后一行 ==========
/**
 * 获取 D 列最后一行
 */
export function getLastRow(ws) {
    try {
        let cell = getCell(ws, ws.Rows.Count, COLUMNS.SEQUENCE);
        if (cell && cell.Value) {
            return cell.End(XL.UP).Row;
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "getLastRow 失败: " + e.message);
    }
    
    return 1000;
}

// ========== 主入口：批量同步 ==========
/**
 * 批量同步 Excel 数据到 Bangumi
 */
export function SyncToBangumi() {
    let app = getApp();
    if (!app) {
        showDialog("错误", "无法获取 WPS Application 对象！");
        return;
    }
    let ws = getDataSheet();
    if (!ws) {
        showDialog("提示", "未找到数据工作表！请在工作表选择器中选择一个工作表。");
        return;
    }

    let token = getBgmtoken();
    if (!token) {
        showDialog("提示", "未设置 Bangumi Token，无法同步！");
        return;
    }

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) {
        showDialog("提示", "未找到表头行！请确保工作表第一行包含列名。");
        return;
    }

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.subjectId && !colMap.url) {
        showDialog("提示", "未找到【条目ID】或【Bangumi URL】列！请检查表头名称。");
        return;
    }

    let lastRow = getLastRow(ws);
    if (lastRow <= headerRow) {
        showDialog("提示", "没有可同步的数据！");
        return;
    }

    let dataCount = lastRow - headerRow;
    let confirmMsg = "即将同步第 " + (headerRow + 1) + " 到 " + lastRow + " 行，共 " + dataCount + " 条数据。\n\n是否继续？";
    
    // 使用自定义确认对话框
    if (typeof window.BGMConfirm === 'function') {
        window.BGMConfirm(confirmMsg, "确认同步", () => {
            _doSyncBangumi(ws, colMap, token, lastRow, headerRow);
        });
        return;
    }
    
    // 备用原生确认
    if (!confirm(confirmMsg)) {
        return;
    }
    
    _doSyncBangumi(ws, colMap, token, lastRow, headerRow);
}

/**
 * 执行 Bangumi 同步（内部函数）
 */
function _doSyncBangumi(ws, colMap, token, lastRow, headerRow) {
    BGM.sync.isRunning = true;
    BGM.sync.lastSyncTime = null;

    // 获取同步记录工作表
    let syncRecordSheet = null;
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncRecordSheet = getOrCreateSyncRecordSheet();
    }

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let totalCount = lastRow - headerRow;

    showDialog("同步进度", "开始同步...\n已处理: 0 / " + totalCount);

    for (let i = headerRow + 1; i <= lastRow; i++) {
        try {
            let sidVal = getCellValue(ws, i, colMap.subjectId);
            let sid = sidVal;
            
            if (!sid && colMap.url) {
                let urlVal = getCellValue(ws, i, colMap.url);
                sid = extractSubjectId(urlVal);
            }

            if (!sid) {
                if (colMap.syncStatus) {
                    getCell(ws, i, colMap.syncStatus).Value = "跳过(无SID)";
                    getCell(ws, i, colMap.syncStatus).Interior.ColorIndex = XL.NONE;
                }
                skipCount++;
                continue;
            }

            let jsonBody = buildJsonPayload(ws, i, colMap);
            let result = bgmRequestSync("POST", "/subject/" + sid + "/update", jsonBody, token);
            
            if (result.code === 204 || result.code === 200 || result.code === 201) {
                successCount++;
                
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "成功";
                    cell.Interior.ColorIndex = SYNC_STATUS_COLOR.SUCCESS;
                }

                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: colMap.url ? getCellValue(ws, i, colMap.url) : "",
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "成功"
                    });
                }
            } else {
                failCount++;
                
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "失败:" + result.code;
                    cell.Interior.ColorIndex = SYNC_STATUS_COLOR.FAILURE;
                }

                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: colMap.url ? getCellValue(ws, i, colMap.url) : "",
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "失败:" + result.code
                    });
                }
            }

            sleep(BGM_CONFIG.REQUEST_DELAY);
        } catch (err) {
            failCount++;
            bgmLog(LOG_LEVELS.ERROR, "同步第 " + i + " 行出错: " + err.message);
            
            if (colMap.syncStatus) {
                let cell = getCell(ws, i, colMap.syncStatus);
                cell.Value = "错误:" + err.message;
                cell.Interior.ColorIndex = SYNC_STATUS_COLOR.FAILURE;
            }
        }
    }

    BGM.sync.isRunning = false;
    BGM.sync.lastSyncTime = new Date().toISOString();

    let summary = "同步完成！\n\n成功: " + successCount + "\n失败: " + failCount + "\n跳过: " + skipCount + "\n总计: " + totalCount;
    showDialog("同步完成", summary);
    
    return { success: successCount, fail: failCount, skip: skipCount };
}

// ========== 异步批量同步（推荐使用）==========
/**
 * 异步批量同步 Excel 数据到 Bangumi
 * @param {Function} onProgress - 进度回调 (current, total, message)
 * @param {Function} onItemComplete - 单项完成回调 (row, success, result)
 */
export async function syncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options = {}) {
    const { onProgress, onItemComplete } = options;

    BGM.sync.isRunning = true;
    BGM.sync.lastSyncTime = null;

    let syncRecordSheet = null;
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncRecordSheet = getOrCreateSyncRecordSheet();
    }

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let totalCount = lastRow - headerRow;

    for (let i = headerRow + 1; i <= lastRow; i++) {
        // 进度回调
        if (onProgress) {
            onProgress(i - headerRow, totalCount, `正在处理第 ${i} 行...`);
        }

        try {
            let sidVal = getCellValue(ws, i, colMap.subjectId);
            let sid = sidVal;

            if (!sid && colMap.url) {
                let urlVal = getCellValue(ws, i, colMap.url);
                sid = extractSubjectId(urlVal);
            }

            if (!sid) {
                if (colMap.syncStatus) {
                    getCell(ws, i, colMap.syncStatus).Value = "跳过(无SID)";
                    getCell(ws, i, colMap.syncStatus).Interior.ColorIndex = XL.NONE;
                }
                skipCount++;
                if (onItemComplete) onItemComplete(i, false, { code: 0, message: '无SID' });
                continue;
            }

            let jsonBody = buildJsonPayload(ws, i, colMap);
            const result = await httpRequest(`/subject/${sid}/update`, {
                method: 'POST',
                body: jsonBody,
                token: token
            });

            const syncSuccess = result.isOk() && (result.data?.status === 204 || result.data?.status === 200 || result.data?.status === 201);

            if (syncSuccess) {
                successCount++;
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "成功";
                    cell.Interior.ColorIndex = SYNC_STATUS_COLOR.SUCCESS;
                }
                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: colMap.url ? getCellValue(ws, i, colMap.url) : "",
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "成功"
                    });
                }
            } else {
                failCount++;
                const errorMsg = result.isFail() ? result.error.message : `HTTP ${result.data?.status}`;
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "失败:" + errorMsg;
                    cell.Interior.ColorIndex = SYNC_STATUS_COLOR.FAILURE;
                }
                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: colMap.url ? getCellValue(ws, i, colMap.url) : "",
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "失败:" + errorMsg
                    });
                }
            }

            if (onItemComplete) {
                onItemComplete(i, syncSuccess, { code: result.data?.status, message: result.error?.message });
            }

            // 延迟避免限流
            await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY));

        } catch (err) {
            failCount++;
            bgmLog(LOG_LEVELS.ERROR, "同步第 " + i + " 行出错: " + err.message);

            if (colMap.syncStatus) {
                let cell = getCell(ws, i, colMap.syncStatus);
                cell.Value = "错误:" + err.message;
                cell.Interior.ColorIndex = SYNC_STATUS_COLOR.FAILURE;
            }

            if (onItemComplete) {
                onItemComplete(i, false, { code: 0, message: err.message });
            }
        }
    }

    BGM.sync.isRunning = false;
    BGM.sync.lastSyncTime = new Date().toISOString();

    return { success: successCount, fail: failCount, skip: skipCount };
}

// ========== URL 解析 ==========
/**
 * 从 Bangumi URL 提取 subject_id
 */
export function extractSubjectId(url) {
    if (!url) return null;
    for (let pattern of URL_PATTERNS) {
        let match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// ========== 表头识别 ==========
/**
 * 查找表头行
 */
export function findHeaderRow(ws, startRow) {
    startRow = startRow || 1;
    
    for (let row = startRow; row <= Math.min(startRow + 5, 10); row++) {
        try {
            let cell = getCell(ws, row, 1);
            if (!cell || !cell.Value) continue;
            
            let cellText = String(cell.Value).toLowerCase();
            
            for (let keyword of HEADER_KEYWORDS) {
                if (cellText.includes(keyword)) {
                    return row;
                }
            }
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "findHeaderRow 行扫描失败: " + e.message);
        }
    }
    
    return startRow;
}

// ========== 列映射 ==========
/**
 * 获取列名到列号的映射
 */
export function getColumnMap(ws, headerRow) {
    let colMap = {
        name: null,
        subjectId: null,
        url: null,
        type: null,
        rate: null,
        tags: null,
        comment: null,
        finishedDate: null,
        epStatus: null,
        syncStatus: null
    };

    try {
        // 使用 Range.End 代替 Cells 来获取最后一个有内容的列
        let lastCell = ws.Range(ws.Cells(headerRow, 1), ws.Cells(headerRow, ws.Columns.Count)).End(XL.TO_LEFT);
        let lastCol = lastCell.Column;
        
        for (let col = 1; col <= lastCol; col++) {
            let cellValue = getCellValue(ws, headerRow, col);
            if (!cellValue) continue;
            
            let normalized = String(cellValue).toLowerCase().trim();
            
            if (FIELD_NAME_MAP[normalized]) {
                colMap[FIELD_NAME_MAP[normalized]] = col;
                continue;
            }
            
            for (let [key, field] of Object.entries(FIELD_NAME_MAP)) {
                if (normalized.includes(key) || key.includes(normalized)) {
                    if (!colMap[field]) {
                        colMap[field] = col;
                    }
                }
            }
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "获取列映射失败: " + e.message);
    }

    return colMap;
}

// ========== 构建 JSON 请求体 ==========
/**
 * 构建 Bangumi API 请求体
 */
export function buildJsonPayload(ws, row, colMap, finishedDate) {
    let payload = {};

    if (colMap.type) {
        let statusVal = getCellValue(ws, row, colMap.type);
        let mappedType = mapWatchStatus(statusVal);
        if (mappedType !== null) {
            payload.type = mappedType;
        }
    }

    if (colMap.rate) {
        let rateVal = getCellValue(ws, row, colMap.rate);
        let rate = Math.max(0, Math.min(10, parseInt(rateVal)));
        if (rate > 0) {
            payload.rate = rate;
        }
    }

    if (colMap.tags) {
        let tagsVal = getCellValue(ws, row, colMap.tags);
        let tags = buildTagsArray(tagsVal);
        if (tags.length > 0) {
            payload.tags = tags;
        }
    }

    if (colMap.comment) {
        let commentVal = getCellValue(ws, row, colMap.comment);
        if (commentVal && !isEmptyValue(commentVal)) {
            payload.comment = String(commentVal);
        }
    }

    if (finishedDate) {
        payload.finished = finishedDate;
    } else if (colMap.finishedDate) {
        let dateVal = getCellValue(ws, row, colMap.finishedDate);
        if (dateVal) {
            payload.finished = dateVal;
        }
    }

    return JSON.stringify(payload);
}

/**
 * 检查是否为空值
 */
export function isEmptyValue(val) {
    return val === null || val === undefined || val === "" || 
           val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}

/**
 * 映射观看状态
 */
export function mapWatchStatus(status) {
    if (!status) return null;
    let s = String(status).toLowerCase().trim();
    return WATCH_STATUS_MAP[s] !== undefined ? WATCH_STATUS_MAP[s] : null;
}

/**
 * 构建标签数组
 */
export function buildTagsArray(tagsStr) {
    if (!tagsStr) return [];
    
    let tags = [];
    let parts = String(tagsStr).split(/[,，;；、\s]+/);
    
    for (let part of parts) {
        part = part.trim();
        if (part && part.length > 0 && part.length <= 20) {
            tags.push(part);
        }
    }
    
    return tags.slice(0, 5);
}

// ========== BGM API 请求 ==========
/**
 * 发送 BGM API 请求
 */
export async function bgmRequest(method, endpoint, body, token) {
    return bgmRequestSync(method, endpoint, body, token);
}

/**
 * 同步发送 BGM API 请求（含 429 自动重试）
 * @param {string} method - HTTP 方法 (GET, POST, PUT, DELETE)
 * @param {string} endpoint - API 端点（必须是有效的路径）
 * @param {string} body - 请求体（JSON 字符串）
 * @param {string} token - 认证 Token
 * @returns {object} { code: number, message: string }
 */
export function bgmRequestSync(method, endpoint, body, token) {
    const { MAX_RETRIES, RETRY_DELAY_BASE } = BGM_CONFIG;
    let retries = 0;
    
    // 输入验证：防止注入攻击
    // 1. 验证 HTTP 方法
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (!validMethods.includes(method.toUpperCase())) {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: 无效的 HTTP 方法: " + method);
        return { code: 0, message: "Invalid HTTP method" };
    }
    
    // 2. 验证 endpoint：必须是有效的 API 路径，不允许绝对 URL 和协议
    if (!endpoint || typeof endpoint !== 'string') {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: endpoint 无效");
        return { code: 0, message: "Invalid endpoint" };
    }
    
    // 防止路径遍历和注入
    if (endpoint.includes('..') || endpoint.includes('//') || endpoint.startsWith('http')) {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: endpoint 包含非法字符: " + endpoint);
        return { code: 0, message: "Invalid endpoint path" };
    }
    
    // 3. 验证 body：必须是有效的 JSON 字符串
    if (body && typeof body === 'string' && body.trim().startsWith('{')) {
        try {
            JSON.parse(body);
        } catch (e) {
            bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: 无效的 JSON body");
            return { code: 0, message: "Invalid JSON body" };
        }
    }
    
    while (retries <= MAX_RETRIES) {
        let xhr = new XMLHttpRequest();
        xhr.open(method, BGM_CONFIG.API_BASE + endpoint, false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");

        try {
            xhr.send(body);
            let statusCode = xhr.status;
            let responseText = xhr.responseText;
            
            if (statusCode === 204) {
                return { code: statusCode, message: "OK" };
            }
            if (statusCode === 200 || statusCode === 201 || statusCode === 202) {
                return { code: statusCode, message: responseText };
            }
            if (statusCode === 429 && retries < MAX_RETRIES) {
                retries++;
                let retryDelay = RETRY_DELAY_BASE * Math.pow(2, retries - 1);
                bgmLog(LOG_LEVELS.WARN, `API 限流(429)，第 ${retries}/${MAX_RETRIES} 次重试，等待 ${retryDelay}ms`);
                sleep(retryDelay);
                continue;
            }
            return { code: statusCode, message: responseText || "Error" };
        } catch (err) {
            return { code: 0, message: "Error: " + err.message };
        }
    }
    
    return { code: 429, message: `超过最大重试次数(${MAX_RETRIES}次)` };
}

// ========== 清除行颜色标记 ==========
/**
 * 清除所有行的颜色标记
 */
export function clearRowColors() {
    let ws = getDataSheet();
    if (!ws) return;

    let lastRow = getLastRow(ws);
    let headerRow = findHeaderRow(ws);
    let colMap = getColumnMap(ws, headerRow);

    if (!colMap.syncStatus) {
        showDialog("提示", "未找到【同步状态】列");
        return;
    }

    for (let i = headerRow + 1; i <= lastRow; i++) {
        try {
            let cell = getCell(ws, i, colMap.syncStatus);
            if (cell) {
                cell.Value = "";
                if (cell.Interior) {
                    cell.Interior.ColorIndex = XL.NONE;
                }
            }
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "clearRowColors 清除第" + i + "行失败: " + e.message);
        }
    }

    showDialog("完成", "已清除所有颜色标记");
}

// ========== 测试单个条目 ==========
/**
 * 测试单个条目更新
 */
export function testSingleUpdate() {
    let ws = getDataSheet();
    if (!ws) {
        showDialog("错误", "未找到数据工作表！");
        return;
    }

    let token = getBgmtoken();
    if (!token) {
        showDialog("提示", "请先设置 Token！");
        return;
    }

    let app = getApp();
    if (!app || !app.ActiveCell) {
        showDialog("提示", "请先选中一个单元格");
        return;
    }

    let row = app.ActiveCell.Row;
    let headerRow = findHeaderRow(ws);
    let colMap = getColumnMap(ws, headerRow);

    if (!colMap.subjectId && !colMap.url) {
        showDialog("提示", "未找到【条目ID】或【Bangumi URL】列");
        return;
    }

    let sidVal = getCellValue(ws, row, colMap.subjectId);
    let sid = sidVal;

    if (!sid && colMap.url) {
        let urlVal = getCellValue(ws, row, colMap.url);
        sid = extractSubjectId(urlVal);
    }

    if (!sid) {
        showDialog("提示", "当前行没有条目ID或URL");
        return;
    }

    let jsonBody = buildJsonPayload(ws, row, colMap);
    let result = bgmRequestSync("POST", "/subject/" + sid + "/update", jsonBody, token);

    if (result.code === 204 || result.code === 200 || result.code === 201) {
        showDialog("测试成功", "条目 " + sid + " 更新成功！\n\n请求体: " + parseJsonBodySummary(jsonBody));
    } else {
        showDialog("测试失败", "条目 " + sid + " 更新失败！\n\n状态码: " + result.code + "\n响应: " + result.message);
    }
}

// ========== 筛选状态检测 ==========
/**
 * 获取筛选状态
 */
export function getFilterStatus() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        return { isFiltered: false, filterMode: "none" };
    }

    let ws = app.ActiveWorkbook.ActiveSheet;
    if (!ws) {
        return { isFiltered: false, filterMode: "none" };
    }

    try {
        if (ws.AutoFilterMode) {
            let filterRange = ws.AutoFilter.Range;
            if (filterRange) {
                let filterColumns = ws.AutoFilter.Filters;
                if (filterColumns) {
                    for (let i = 1; i <= filterColumns.Count; i++) {
                        if (filterColumns(i).On) {
                            return {
                                isFiltered: true,
                                filterMode: "autofilter",
                                filterColumn: i
                            };
                        }
                    }
                }
            }
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "检查筛选状态失败: " + e.message);
    }

    return { isFiltered: false, filterMode: "none" };
}

// ========== 列值统计 ==========
/**
 * 获取列的唯一值计数
 */
export function getColumnValueCounts(ws, headerRow, col) {
    let counts = {};
    
    try {
        let lastRow = getLastRow(ws);
        
        for (let row = headerRow + 1; row <= lastRow; row++) {
            let value = getCellValue(ws, row, col);
            if (!value) value = "(空)";
            
            if (counts[value]) {
                counts[value]++;
            } else {
                counts[value] = 1;
            }
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "获取列值统计失败: " + e.message);
    }
    
    return counts;
}

// ========== 可见行获取 ==========
/**
 * 根据序列号获取连续的有效行
 */
export function getSequentialRowsBySeqCol(startRow, endRow) {
    let ws = getDataSheet();
    if (!ws) {
        return { validRows: [], skippedRows: [] };
    }

    let validRows = [];
    let skippedRows = [];

    for (let row = startRow; row <= endRow; row++) {
        try {
            let cell = getCell(ws, row, COLUMNS.SEQUENCE);
            if (cell && cell.Value !== null && cell.Value !== "") {
                validRows.push(row);
            } else {
                skippedRows.push(row);
            }
        } catch (e) {
            skippedRows.push(row);
        }
    }

    return { validRows: validRows, skippedRows: skippedRows };
}

/**
 * Ribbon 模式测试 Token
 */
export function testTokenValidityForRibbon(token) {
    if (!token) return;

    let xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/user/{id}", true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);

    xhr.onload = function() {
        if (xhr.status === 200) {
            showDialog("Token 有效", "Token 验证通过！");
        } else {
            showDialog("Token 无效", "Token 验证失败，请检查是否正确。");
        }
    };

    xhr.onerror = function() {
        showDialog("网络错误", "无法连接到 Bangumi API，请检查网络。");
    };

    xhr.send();
}

/**
 * 打开 Bangumi Token 创建页面
 */
export function openBangumiTokenPage() {
    let tokenUrl = "https://next.bgm.tv/demo/access-token/create";
    let app = getApp();

    try {
        if (app && app.OAAssist) {
            app.OAAssist.ShellExecute(tokenUrl);
        } else {
            window.open(tokenUrl, "_blank");
        }
    } catch (e) {
        window.open(tokenUrl, "_blank");
    }
}

/**
 * 打开用户收藏页
 */
export function openUserCollection() {
    let userId = _getBgmUserId();
    if (!userId) {
        showDialog("提示", "请先设置用户ID！");
        return;
    }
    window.open("https://bgm.tv/" + userId + "/collect", "_blank");
}

// ========== 向后兼容（挂载到 window）==========
window.SyncToBangumi = SyncToBangumi;
window.getDataSheet = getDataSheet;
window.getBgmtoken = getBgmtoken;
window.getLastRow = getLastRow;
window.findHeaderRow = findHeaderRow;
window.getColumnMap = getColumnMap;
window.buildJsonPayload = buildJsonPayload;
window.extractSubjectId = extractSubjectId;
window.clearRowColors = clearRowColors;
window.openUserCollection = openUserCollection;
window.openBangumiTokenPage = openBangumiTokenPage;
window.showTokenDialog = showTokenDialog;
window.showUserIdDialog = showUserIdDialog;
window.testTokenValidityForRibbon = testTokenValidityForRibbon;
window.bgmiRequestSync = bgmRequestSync;
window.bgmiRequest = bgmRequest;
window.sendToTaskpane = sendToTaskpane;
window.showDialog = showDialog;
