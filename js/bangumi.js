/**
 * Bangumi API 同步模块
 * @module bangumi
 * @description 从 Excel 读取条目并批量同步到 Bangumi 收藏
 */

import { XL, BGM_CONFIG, LOG_LEVELS, BGM } from './util.js';
import { getApp, bgmLog, getCell, getCellValue, sleep, loadBgToken, 
         _setBgmUserId, _getBgmUserId } from './util.js';
import { showDialog } from './ui/dialog.js';
import { sendToTaskpane } from './core/unified.js';
import { showTokenDialog, showUserIdDialog } from './ui/handlers.js';
import { httpRequest } from './http.js';
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
    "\u770B\u8FC7": 3, "\u770B\u5B8C": 3, "\u5DF2\u770B": 3, "completed": 3, "3": 3,
    "\u5728\u770B": 2, "\u5728\u770B\u52A8\u753B": 2, "watching": 2, "2": 2,
    "\u60F3\u770B": 1, "\u60F3\u770B\u52A8\u753B": 1, "wish": 1, "1": 1,
    "\u6401\u7F6E": 4, "on_hold": 4, "4": 4,
    "\u629B\u5F03": 5, "drop": 5, "dropped": 5, "5": 5
};

// 收藏类型文本映射
const TYPE_TEXT_MAP = {1:"\u60F3\u770B", 2:"\u5728\u770B", 3:"\u770B\u8FC7", 4:"\u6401\u7F6E", 5:"\u629B\u5F03"};

// URL 解析正则
const URL_PATTERNS = [
    /bgm\.tv\/subject\/(\d+)/i,
    /bangumi\.tv\/subject\/(\d+)/i,
    /chii\.in\/subject\/(\d+)/i,
    /(\d{6,})/
];

// 表头识别关键词
const HEADER_KEYWORDS = ["\u6761\u76EEid", "bangumi url", "url", "sid", "\u540D\u79F0", "name", "\u72B6\u6001", "status", "\u8BC4\u5206", "rate"];

// 表头字段映射
const FIELD_NAME_MAP = {
    "\u540D\u79F0": "name", "name": "name", "\u4F5C\u54C1\u540D": "name", "\u6761\u76EE": "name", "\u6807\u9898": "name",
    "\u6761\u76EEid": "subjectId", "sid": "subjectId", "subject_id": "subjectId", "id": "subjectId",
    "bangumi url": "url", "url": "url", "\u94FE\u63A5": "url", "\u5730\u5740": "url",
    "\u72B6\u6001": "type", "type": "type", "\u89C2\u770B\u72B6\u6001": "type", "\u6536\u85CF\u7C7B\u578B": "type",
    "\u8BC4\u5206": "rate", "rate": "rate", "\u5206\u6570": "rate", "rating": "rate",
    "\u6807\u7B7E": "tags", "tags": "tags", "tag": "tags",
    "\u8BC4\u4EF7": "comment", "comment": "comment", "\u5907\u6CE8": "comment", "notes": "comment",
    "\u770B\u5B8C\u65E5\u671F": "finishedDate", "finished": "finishedDate", "\u65E5\u671F": "finishedDate",
    "\u7AE0\u8282\u72B6\u6001": "epStatus", "ep_status": "epStatus", "\u96C6\u6570": "epStatus",
    "\u540C\u6B65\u72B6\u6001": "syncStatus", "sync_status": "syncStatus"
};

// ========== 工具函数 ==========
/**
 * 解析 JSON 请求体为可读描述
 */
export function parseJsonBodySummary(jsonStr) {
    if (!jsonStr) return "(\u7A7A)";
    try {
        let obj = JSON.parse(jsonStr);
        let parts = [];
        if (obj.type !== undefined) parts.push("\u72B6\u6001:" + (TYPE_TEXT_MAP[obj.type] || obj.type));
        if (obj.rate !== undefined && obj.rate > 0) parts.push("\u8BC4\u5206:" + obj.rate);
        if (obj.tags && obj.tags.length > 0) parts.push("\u6807\u7B7E:[" + obj.tags.join(",") + "]");
        if (obj.comment) {
            let comment = obj.comment.length > 30 ? obj.comment.substring(0, 30) + "..." : obj.comment;
            parts.push("\u8BC4\u4EF7:" + comment);
        }
        return parts.length > 0 ? parts.join(" | ") : "(\u4EC5\u6807\u8BB0\u72B6\u6001)";
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
            return app.ActiveWorkbook.Worksheets.Item(BGM.sheet.lockedIndex);
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "getDataSheet \u9501\u5B9A\u5DE5\u4F5C\u8868\u5931\u8D25: " + e.message);
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
        bgmLog(LOG_LEVELS.WARN, "getLastRow \u5931\u8D25: " + e.message);
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
        showDialog("\u9519\u8BEF", "\u65E0\u6CD5\u83B7\u53D6 WPS Application \u5BF9\u8C61！");
        return;
    }
    let ws = getDataSheet();
    if (!ws) {
        showDialog("\u63D0\u793A", "\u672A\u627E\u5230\u6570\u636E\u5DE5\u4F5C\u8868！\u8BF7\u5728\u5DE5\u4F5C\u8868\u9009\u62E9\u5668\u4E2D\u9009\u62E9\u4E00\u4E2A\u5DE5\u4F5C\u8868。");
        return;
    }

    let token = getBgmtoken();
    if (!token) {
        showDialog("\u63D0\u793A", "\u672A\u8BBE\u7F6E Bangumi Token，\u65E0\u6CD5\u540C\u6B65！");
        return;
    }

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) {
        showDialog("\u63D0\u793A", "\u672A\u627E\u5230\u8868\u5934\u884C！\u8BF7\u786E\u4FDD\u5DE5\u4F5C\u8868\u7B2C\u4E00\u884C\u5305\u542B\u5217\u540D。");
        return;
    }

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.subjectId && !colMap.url) {
        showDialog("\u63D0\u793A", "\u672A\u627E\u5230【\u6761\u76EEID】\u6216【Bangumi URL】\u5217！\u8BF7\u68C0\u67E5\u8868\u5934\u540D\u79F0。");
        return;
    }

    let lastRow = getLastRow(ws);
    if (lastRow <= headerRow) {
        showDialog("\u63D0\u793A", "\u6CA1\u6709\u53EF\u540C\u6B65\u7684\u6570\u636E！");
        return;
    }

    let dataCount = lastRow - headerRow;
    let confirmMsg = "\u5373\u5C06\u540C\u6B65\u7B2C " + (headerRow + 1) + " \u5230 " + lastRow + " \u884C，\u5171 " + dataCount + " \u6761\u6570\u636E。\n\n\u662F\u5426\u7EE7\u7EED？";
    
    // 使用自定义确认对话框
    if (typeof window.BGMConfirm === 'function') {
        window.BGMConfirm(confirmMsg, "\u786E\u8BA4\u540C\u6B65", () => {
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

    showDialog("\u540C\u6B65\u8FDB\u5EA6", "\u5F00\u59CB\u540C\u6B65...\n\u5DF2\u5904\u7406: 0 / " + totalCount);

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
                    getCell(ws, i, colMap.syncStatus).Value = "\u8DF3\u8FC7(\u65E0SID)";
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
                    cell.Value = "\u6210\u529F";
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
                        status: "\u6210\u529F"
                    });
                }
            } else {
                failCount++;
                
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "\u5931\u8D25:" + result.code;
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
                        status: "\u5931\u8D25:" + result.code
                    });
                }
            }

            sleep(BGM_CONFIG.REQUEST_DELAY);
        } catch (err) {
            failCount++;
            bgmLog(LOG_LEVELS.ERROR, "\u540C\u6B65\u7B2C " + i + " \u884C\u51FA\u9519: " + err.message);
            
            if (colMap.syncStatus) {
                let cell = getCell(ws, i, colMap.syncStatus);
                cell.Value = "\u9519\u8BEF:" + err.message;
                cell.Interior.ColorIndex = SYNC_STATUS_COLOR.FAILURE;
            }
        }
    }

    BGM.sync.isRunning = false;
    BGM.sync.lastSyncTime = new Date().toISOString();

    let summary = "\u540C\u6B65\u5B8C\u6210！\n\n\u6210\u529F: " + successCount + "\n\u5931\u8D25: " + failCount + "\n\u8DF3\u8FC7: " + skipCount + "\n\u603B\u8BA1: " + totalCount;
    showDialog("\u540C\u6B65\u5B8C\u6210", summary);
    
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
            onProgress(i - headerRow, totalCount, `\u6B63\u5728\u5904\u7406\u7B2C ${i} \u884C...`);
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
                    getCell(ws, i, colMap.syncStatus).Value = "\u8DF3\u8FC7(\u65E0SID)";
                    getCell(ws, i, colMap.syncStatus).Interior.ColorIndex = XL.NONE;
                }
                skipCount++;
                if (onItemComplete) onItemComplete(i, false, { code: 0, message: '\u65E0SID' });
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
                    cell.Value = "\u6210\u529F";
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
                        status: "\u6210\u529F"
                    });
                }
            } else {
                failCount++;
                const errorMsg = result.isFail() ? result.error.message : `HTTP ${result.data?.status}`;
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "\u5931\u8D25:" + errorMsg;
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
                        status: "\u5931\u8D25:" + errorMsg
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
            bgmLog(LOG_LEVELS.ERROR, "\u540C\u6B65\u7B2C " + i + " \u884C\u51FA\u9519: " + err.message);

            if (colMap.syncStatus) {
                let cell = getCell(ws, i, colMap.syncStatus);
                cell.Value = "\u9519\u8BEF:" + err.message;
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
            bgmLog(LOG_LEVELS.WARN, "findHeaderRow \u884C\u626B\u63CF\u5931\u8D25: " + e.message);
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
        bgmLog(LOG_LEVELS.ERROR, "\u83B7\u53D6\u5217\u6620\u5C04\u5931\u8D25: " + e.message);
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
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: \u65E0\u6548\u7684 HTTP \u65B9\u6CD5: " + method);
        return { code: 0, message: "Invalid HTTP method" };
    }
    
    // 2. 验证 endpoint：必须是有效的 API 路径，不允许绝对 URL 和协议
    if (!endpoint || typeof endpoint !== 'string') {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: endpoint \u65E0\u6548");
        return { code: 0, message: "Invalid endpoint" };
    }
    
    // 防止路径遍历和注入
    if (endpoint.includes('..') || endpoint.includes('//') || endpoint.startsWith('http')) {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: endpoint \u5305\u542B\u975E\u6CD5\u5B57\u7B26: " + endpoint);
        return { code: 0, message: "Invalid endpoint path" };
    }
    
    // 3. 验证 body：必须是有效的 JSON 字符串
    if (body && typeof body === 'string' && body.trim().startsWith('{')) {
        try {
            JSON.parse(body);
        } catch (e) {
            bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: \u65E0\u6548\u7684 JSON body");
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
                bgmLog(LOG_LEVELS.WARN, `API \u9650\u6D41(429)，\u7B2C ${retries}/${MAX_RETRIES} \u6B21\u91CD\u8BD5，\u7B49\u5F85 ${retryDelay}ms`);
                sleep(retryDelay);
                continue;
            }
            return { code: statusCode, message: responseText || "Error" };
        } catch (err) {
            return { code: 0, message: "Error: " + err.message };
        }
    }
    
    return { code: 429, message: `\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570(${MAX_RETRIES}\u6B21)` };
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
        showDialog("\u63D0\u793A", "\u672A\u627E\u5230【\u540C\u6B65\u72B6\u6001】\u5217");
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
            bgmLog(LOG_LEVELS.WARN, "clearRowColors \u6E05\u9664\u7B2C" + i + "\u884C\u5931\u8D25: " + e.message);
        }
    }

    showDialog("\u5B8C\u6210", "\u5DF2\u6E05\u9664\u6240\u6709\u989C\u8272\u6807\u8BB0");
}

// ========== 测试单个条目 ==========
/**
 * 测试单个条目更新
 */
export function testSingleUpdate() {
    let ws = getDataSheet();
    if (!ws) {
        showDialog("\u9519\u8BEF", "\u672A\u627E\u5230\u6570\u636E\u5DE5\u4F5C\u8868！");
        return;
    }

    let token = getBgmtoken();
    if (!token) {
        showDialog("\u63D0\u793A", "\u8BF7\u5148\u8BBE\u7F6E Token！");
        return;
    }

    let app = getApp();
    if (!app || !app.ActiveCell) {
        showDialog("\u63D0\u793A", "\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A\u5355\u5143\u683C");
        return;
    }

    let row = app.ActiveCell.Row;
    let headerRow = findHeaderRow(ws);
    let colMap = getColumnMap(ws, headerRow);

    if (!colMap.subjectId && !colMap.url) {
        showDialog("\u63D0\u793A", "\u672A\u627E\u5230【\u6761\u76EEID】\u6216【Bangumi URL】\u5217");
        return;
    }

    let sidVal = getCellValue(ws, row, colMap.subjectId);
    let sid = sidVal;

    if (!sid && colMap.url) {
        let urlVal = getCellValue(ws, row, colMap.url);
        sid = extractSubjectId(urlVal);
    }

    if (!sid) {
        showDialog("\u63D0\u793A", "\u5F53\u524D\u884C\u6CA1\u6709\u6761\u76EEID\u6216URL");
        return;
    }

    let jsonBody = buildJsonPayload(ws, row, colMap);
    let result = bgmRequestSync("POST", "/subject/" + sid + "/update", jsonBody, token);

    if (result.code === 204 || result.code === 200 || result.code === 201) {
        showDialog("\u6D4B\u8BD5\u6210\u529F", "\u6761\u76EE " + sid + " \u66F4\u65B0\u6210\u529F！\n\n\u8BF7\u6C42\u4F53: " + parseJsonBodySummary(jsonBody));
    } else {
        showDialog("\u6D4B\u8BD5\u5931\u8D25", "\u6761\u76EE " + sid + " \u66F4\u65B0\u5931\u8D25！\n\n\u72B6\u6001\u7801: " + result.code + "\n\u54CD\u5E94: " + result.message);
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
        bgmLog(LOG_LEVELS.WARN, "\u68C0\u67E5\u7B5B\u9009\u72B6\u6001\u5931\u8D25: " + e.message);
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
            if (!value) value = "(\u7A7A)";
            
            if (counts[value]) {
                counts[value]++;
            } else {
                counts[value] = 1;
            }
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u83B7\u53D6\u5217\u503C\u7EDF\u8BA1\u5931\u8D25: " + e.message);
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
            showDialog("Token \u6709\u6548", "Token \u9A8C\u8BC1\u901A\u8FC7！");
        } else {
            showDialog("Token \u65E0\u6548", "Token \u9A8C\u8BC1\u5931\u8D25，\u8BF7\u68C0\u67E5\u662F\u5426\u6B63\u786E。");
        }
    };

    xhr.onerror = function() {
        showDialog("\u7F51\u7EDC\u9519\u8BEF", "\u65E0\u6CD5\u8FDE\u63A5\u5230 Bangumi API，\u8BF7\u68C0\u67E5\u7F51\u7EDC。");
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
        showDialog("\u63D0\u793A", "\u8BF7\u5148\u8BBE\u7F6E\u7528\u6237ID！");
        return;
    }
    window.open("https://bgm.tv/user/" + userId + "/collection", "_blank");
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
window.testTokenValidityForRibbon = testTokenValidityForRibbon;
window.bgmRequestSync = bgmRequestSync;
window.bgmRequest = bgmRequest;
// 以下函数已在 dialog.js 中挂载，不再重复
// window.showTokenDialog, window.showUserIdDialog, window.sendToTaskpane, window.showDialog
