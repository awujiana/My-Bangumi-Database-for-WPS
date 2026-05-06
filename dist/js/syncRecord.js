/**
 * 同步记录模块
 * @module syncRecord
 * @description 管理同步记录工作表，记录同步历史
 */

import { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, BGM } from './util.js';
import { getApp, bgmLog, colNumToLetter, getCell } from './util.js';

// ========== 向后兼容别名 ==========
export function sendToTaskpaneSR(data) {
    return BGM.postMessage(data);
}

export function showDialogSR(title, message) {
    BGM.showDialog(title, message);
}

// ========== 常量定义 ==========
export const BGM_SUBJECT_TYPES = {
    1: "\u60F3\u770B",
    2: "\u5728\u770B",
    3: "\u5DF2\u770B",
    4: "\u6401\u7F6E",
    5: "\u629B\u5F03"
};

// 同步记录工作表列常量
const SYNC_RECORD_COLUMNS = {
    INDEX: 1,       // A列 - 序号
    TIME: 2,        // B列 - 同步时间
    NAME: 3,        // C列 - 名称
    URL: 4,         // D列 - URL
    SID: 5,         // E列 - SID
    TYPE: 6,        // F列 - 条目类型
    COUNT: 7,       // G列 - 次数
    CONTENT: 8,     // H列 - 内容
    STATUS: 9,      // I列 - 状态
    COMMENT: 10     // J列 - 备注
};

// ========== 表头设置 ==========
/**
 * 设置同步记录工作表的表头
 */
export function setSyncRecordHeaders(sheet) {
    let headers = ["\u5E8F\u53F7", "\u540C\u6B65\u65F6\u95F4", "\u540D\u79F0", "URL", "SID", "\u6761\u76EE\u7C7B\u578B", "\u6B21\u6570", "\u5185\u5BB9", "\u72B6\u6001", "\u5907\u6CE8"];

    // 只在调试模式下记录工作表信息
    bgmLog(LOG_LEVELS.DEBUG, "setSyncRecordHeaders \u5F00\u59CB - \u5DE5\u4F5C\u8868: " + (sheet ? sheet.Name : "null"));

    for (let i = 0; i < headers.length; i++) {
        let colLetter = colNumToLetter(i + 1);
        let cellAddr = colLetter + "1";

        try {
            let cell = sheet.Range(cellAddr);
            if (cell) {
                cell.Value2 = headers[i];
                if (cell.Font) {
                    cell.Font.Bold = true;
                }
                if (cell.Interior) {
                    cell.Interior.Color = BGM_COLOR.GRAY;
                }
            }
        } catch (e) {
            bgmLog(LOG_LEVELS.ERROR, "\u8BBE\u7F6E\u8868\u5934\u5931\u8D25 - \u5217: " + cellAddr + " \u9519\u8BEF: " + e.message);
        }
    }

    // 设置第二行为颜色说明
    try {
        let noteCell = sheet.Range("I2");
        if (noteCell) {
            noteCell.Value2 = "\u72B6\u6001\u989C\u8272：\u7EFF=\u6210\u529F | \u7EA2=\u5931\u8D25 | \u9EC4=\u8DF3\u8FC7 | \u7D2B=\u5DF2\u6536\u85CF(1\u6B21) | \u6D45\u7EFF=\u5DF2\u6536\u85CF(2\u6B21) | \u6DF1\u7EFF=\u5DF2\u6536\u85CF(3\u6B21+)";
            if (noteCell.Font) {
                noteCell.Font.Size = 9;
                noteCell.Font.Color = 0x404040;
            }
            if (noteCell.Interior) noteCell.Interior.Color = XL.NONE;
        }

        // 冻结首行
        try {
            if (sheet && sheet.Application && sheet.Application.ActiveWindow) {
                sheet.Range("A2").Select();
                sheet.Application.ActiveWindow.FreezePanes = true;
            }
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "\u51BB\u7ED3\u9996\u884C\u5931\u8D25: " + e.message);
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "\u8BBE\u7F6E\u8BF4\u660E\u884C\u5931\u8D25: " + e.message);
    }

    bgmLog(LOG_LEVELS.INFO, "setSyncRecordHeaders \u5B8C\u6210");
}

/**
 * 检查表头是否存在
 */
export function checkHeaderExists(sheet) {
    try {
        let firstCell = sheet.Range("A1");
        return firstCell && firstCell.Value === "\u5E8F\u53F7";
    } catch (e) {
        return false;
    }
}

// ========== 获取或创建同步记录工作表 ==========
/**
 * 获取或创建同步记录工作表
 */
export function getOrCreateSyncRecordSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.ERROR, "getOrCreateSyncRecordSheet - \u65E0\u6CD5\u83B7\u53D6 ActiveWorkbook");
        return null;
    }

    let wb = app.ActiveWorkbook;
    let sheetName = "\u540C\u6B65\u8BB0\u5F55";

    // 查找是否已存在
    try {
        for (let i = 1; i <= wb.Worksheets.Count; i++) {
            if (wb.Worksheets.Item(i).Name === sheetName) {
                bgmLog(LOG_LEVELS.INFO, "\u627E\u5230\u73B0\u6709\u540C\u6B65\u8BB0\u5F55\u5DE5\u4F5C\u8868");
                let sheet = wb.Worksheets.Item(sheetName);
                
                if (!checkHeaderExists(sheet)) {
                    setSyncRecordHeaders(sheet);
                }
                
                return sheet;
            }
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u67E5\u627E\u5DE5\u4F5C\u8868\u5931\u8D25: " + e.message);
    }

    // 创建新工作表
    bgmLog(LOG_LEVELS.INFO, "\u521B\u5EFA\u65B0\u7684\u540C\u6B65\u8BB0\u5F55\u5DE5\u4F5C\u8868");
    try {
        let newSheet = wb.Worksheets.Add();
        newSheet.Name = sheetName;
        setSyncRecordHeaders(newSheet);
        bgmLog(LOG_LEVELS.INFO, "\u65B0\u5DE5\u4F5C\u8868\u5DF2\u521B\u5EFA: " + sheetName);
        return newSheet;
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u521B\u5EFA\u5DE5\u4F5C\u8868\u5931\u8D25: " + e.message);
        return null;
    }
}

// ========== 缓存管理 ==========
let _syncRecordSidCache = new Map();
let _syncRecordListCache = [];
let _syncRecordCacheValid = false;

export function _invalidateSyncRecordCache() {
    _syncRecordCacheValid = false;
}

function _buildSyncRecordCache(sheet) {
    if (!sheet) return;

    _syncRecordSidCache.clear();
    _syncRecordListCache = [];

    try {
        let lastRowCell = sheet.Range("A" + sheet.Rows.Count).End(XL.UP);
        let lastRow = lastRowCell.Row;

        for (let row = 2; row <= lastRow; row++) {
            try {
                let sid = sheet.Cells(row, SYNC_RECORD_COLUMNS.SID).Value;
                let index = sheet.Cells(row, SYNC_RECORD_COLUMNS.INDEX).Value;

                if (sid) {
                    _syncRecordSidCache.set(String(sid), row);
                }

                _syncRecordListCache.push({
                    row: row,
                    index: index,
                    time: sheet.Cells(row, SYNC_RECORD_COLUMNS.TIME).Value,
                    name: sheet.Cells(row, SYNC_RECORD_COLUMNS.NAME).Value,
                    url: sheet.Cells(row, SYNC_RECORD_COLUMNS.URL).Value,
                    sid: sid,
                    type: sheet.Cells(row, SYNC_RECORD_COLUMNS.TYPE).Value,
                    count: sheet.Cells(row, SYNC_RECORD_COLUMNS.COUNT).Value,
                    content: sheet.Cells(row, SYNC_RECORD_COLUMNS.CONTENT).Value,
                    status: sheet.Cells(row, SYNC_RECORD_COLUMNS.STATUS).Value,
                    comment: sheet.Cells(row, SYNC_RECORD_COLUMNS.COMMENT).Value
                });
            } catch (e) {
                bgmLog(LOG_LEVELS.WARN, "loadSyncRecords \u8BFB\u53D6\u7B2C" + row + "\u884C\u5931\u8D25: " + e.message);
            }
        }

        _syncRecordCacheValid = true;
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u6784\u5EFA\u7F13\u5B58\u5931\u8D25: " + e.message);
    }
}

/**
 * 根据 SID 获取行号
 */
export function _getRecordRowBySid(sid) {
    if (!_syncRecordCacheValid) {
        let sheet = getOrCreateSyncRecordSheet();
        if (sheet) _buildSyncRecordCache(sheet);
    }
    return _syncRecordSidCache.get(String(sid)) || null;
}

// ========== 添加同步记录 ==========
/**
 * 添加同步记录
 */
export function addSyncRecord(sheet, record) {
    if (!sheet || !record) return false;

    let existingRow = _getRecordRowBySid(record.sid);

    try {
        let targetRow;

        if (existingRow) {
            targetRow = existingRow;
            record.count = (parseInt(sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.COUNT).Value) || 0) + 1;
        } else {
            let lastRowCell = sheet.Range("A" + sheet.Rows.Count).End(XL.UP);
            targetRow = lastRowCell.Row + 1;
        }

        // 写入数据
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.INDEX).Value = existingRow ? sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.INDEX).Value : (targetRow - 1);
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.TIME).Value = formatCurrentTime();
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.NAME).Value = record.name || "";
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.URL).Value = record.url || "";
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.SID).Value = record.sid || "";
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.TYPE).Value = record.type || "1";
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.COUNT).Value = record.count || 1;
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.CONTENT).Value = record.content || "";
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.STATUS).Value = record.status || "";
        sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.COMMENT).Value = record.comment || "";

        // 设置状态颜色
        let statusCell = sheet.Cells(targetRow, SYNC_RECORD_COLUMNS.STATUS);
        if (statusCell.Interior) {
            if (record.status && record.status.includes("\u6210\u529F")) {
                statusCell.Interior.ColorIndex = 10;
            } else if (record.status && record.status.includes("\u5931\u8D25")) {
                statusCell.Interior.ColorIndex = 3;
            } else if (record.status && record.status.includes("\u8DF3\u8FC7")) {
                statusCell.Interior.ColorIndex = 6;
            }
        }

        _invalidateSyncRecordCache();
        return true;
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u6DFB\u52A0\u540C\u6B65\u8BB0\u5F55\u5931\u8D25: " + e.message);
        return false;
    }
}

/**
 * 获取所有同步记录
 */
export function getAllSyncRecords() {
    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return [];

    if (_syncRecordCacheValid) {
        return _syncRecordListCache;
    }

    _buildSyncRecordCache(sheet);
    return _syncRecordListCache;
}

/**
 * 清除所有同步记录
 */
export function clearSyncRecords(confirmPrompt) {
    if (confirmPrompt !== false) {
        // 使用自定义确认对话框
        if (typeof window.BGMConfirm === 'function') {
            window.BGMConfirm(
                "\u786E\u5B9A\u8981\u6E05\u9664\u6240\u6709\u540C\u6B65\u8BB0\u5F55\u5417？\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500。",
                "\u786E\u8BA4\u6E05\u9664",
                () => {
                    _doClearSyncRecords();
                }
            );
            return;
        }
        // 备用原生确认
        if (!confirm("\u786E\u5B9A\u8981\u6E05\u9664\u6240\u6709\u540C\u6B65\u8BB0\u5F55\u5417？\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500。")) {
            return;
        }
        _doClearSyncRecords();
    } else {
        _doClearSyncRecords();
    }
}

/**
 * 执行清除同步记录的内部函数
 */
function _doClearSyncRecords() {
    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return;

    try {
        let lastRowCell = sheet.Range("A" + sheet.Rows.Count).End(XL.UP);
        let lastRow = lastRowCell.Row;

        if (lastRow > 1) {
            sheet.Range("A2:A" + lastRow).EntireRow.Delete();
        }

        sheet.Range("A1").Value = "\u5E8F\u53F7";
        _invalidateSyncRecordCache();
        bgmLog(LOG_LEVELS.INFO, "\u540C\u6B65\u8BB0\u5F55\u5DF2\u6E05\u9664");
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u6E05\u9664\u540C\u6B65\u8BB0\u5F55\u5931\u8D25: " + e.message);
    }
}

/**
 * 打开同步记录工作表
 */
export function openSyncRecordSheet() {
    let sheet = getOrCreateSyncRecordSheet();
    if (sheet) {
        try {
            sheet.Activate();
            sheet.Application.ActiveWindow.FreezePanes = false;
            sheet.Range("A2").Select();
            sheet.Application.ActiveWindow.FreezePanes = true;
        } catch (e) {
            bgmLog(LOG_LEVELS.ERROR, "\u6253\u5F00\u540C\u6B65\u8BB0\u5F55\u8868\u5931\u8D25: " + e.message);
        }
    }
}

/**
 * 获取并记录 Bangumi 收藏
 * @param {string} _token - Token（预留参数）
 * @param {string} _userId - 用户ID（预留参数）
 * @param {Array} collections - 收藏数据
 */
export function fetchAndRecordBgCollections(_token, _userId, collections) {
    if (!collections || collections.length === 0) {
        bgmLog(LOG_LEVELS.WARN, "\u6CA1\u6709\u6536\u85CF\u6570\u636E\u9700\u8981\u8BB0\u5F55");
        return;
    }

    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return;

    bgmLog(LOG_LEVELS.INFO, "\u5F00\u59CB\u8BB0\u5F55 " + collections.length + " \u6761\u6536\u85CF");

    let recordCount = 0;
    collections.forEach(item => {
        let record = {
            name: item.name || "",
            url: "https://bgm.tv/subject/" + item.sid,
            sid: String(item.sid),
            type: String(item.type || 3),
            count: 1,
            content: item.comment || (item.rate ? "\u8BC4\u5206: " + item.rate : ""),
            status: "\u5DF2\u6536\u85CF"
        };

        if (addSyncRecord(sheet, record)) {
            recordCount++;
        }
    });

    bgmLog(LOG_LEVELS.INFO, "\u8BB0\u5F55\u5B8C\u6210，\u5171\u6DFB\u52A0 " + recordCount + " \u6761");
}

/**
 * 获取指定类型的收藏
 */
export function fetchCollectionsByType(token, userId, type, callback) {
    let xhr = new XMLHttpRequest();
    let url = BGM_CONFIG.API_BASE + "/user/" + userId + "/collection?type=" + type + "&limit=30";

    xhr.open("GET", url, true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                let data = JSON.parse(xhr.responseText);
                if (callback) callback(data.data || []);
            } catch (e) {
                bgmLog(LOG_LEVELS.ERROR, "\u89E3\u6790\u6536\u85CF\u6570\u636E\u5931\u8D25: " + e.message);
                if (callback) callback([]);
            }
        } else {
            bgmLog(LOG_LEVELS.ERROR, "\u83B7\u53D6\u6536\u85CF\u5931\u8D25，\u72B6\u6001\u7801: " + xhr.status);
            if (callback) callback([]);
        }
    };

    xhr.onerror = function() {
        bgmLog(LOG_LEVELS.ERROR, "\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25");
        if (callback) callback([]);
    };

    xhr.send();
}

/**
 * 格式化当前时间
 */
export function formatCurrentTime() {
    let now = new Date();
    let year = now.getFullYear();
    let month = String(now.getMonth() + 1).padStart(2, "0");
    let day = String(now.getDate()).padStart(2, "0");
    let hour = String(now.getHours()).padStart(2, "0");
    let minute = String(now.getMinutes()).padStart(2, "0");
    let second = String(now.getSeconds()).padStart(2, "0");
    return year + "-" + month + "-" + day + " " + hour + ":" + minute + ":" + second;
}

/**
 * 标记已上传条目到工作表
 */
export function markUploadedItemsInSheet(sheetIndex, collections) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.ERROR, "\u65E0\u6CD5\u83B7\u53D6 ActiveWorkbook");
        return;
    }

    let ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    if (!ws) {
        bgmLog(LOG_LEVELS.ERROR, "\u65E0\u6CD5\u83B7\u53D6\u5DE5\u4F5C\u8868");
        return;
    }

    let sidSet = new Set();
    collections.forEach(item => {
        sidSet.add(String(item.sid));
    });

    bgmLog(LOG_LEVELS.INFO, "\u5F00\u59CB\u6807\u8BB0 " + sidSet.size + " \u4E2A\u6761\u76EE");

    let headerRow = 1;
    let sidCol = 0;

    try {
        let lastCol = ws.Range("A" + headerRow).End(XL.TO_RIGHT).Column;
        let lastRow = ws.Range("A" + ws.Rows.Count).End(XL.UP).Row;

        for (let col = 1; col <= lastCol; col++) {
            let cell = getCell(ws, headerRow, col);
            let header = String(cell && cell.Value ? cell.Value : "").toLowerCase();
            if (header.includes("\u6761\u76EEid") || header === "sid" || header === "id") {
                sidCol = col;
            }
        }

        if (sidCol === 0) {
            bgmLog(LOG_LEVELS.WARN, "\u672A\u627E\u5230\u6761\u76EE ID \u5217");
            return;
        }

        let markedCount = 0;
        for (let row = headerRow + 1; row <= lastRow; row++) {
            try {
                let sidCell = getCell(ws, row, sidCol);
                let sid = String(sidCell && sidCell.Value ? sidCell.Value : "").trim();
                if (sidSet.has(sid)) {
                    let cell = getCell(ws, row, 4);
                    if (cell) {
                        cell.Value = "\u5DF2\u6536\u85CF";
                        cell.Interior.ColorIndex = 40;
                        markedCount++;
                    }
                }
            } catch (e) {
                bgmLog(LOG_LEVELS.WARN, "markCollectedItems \u6807\u8BB0\u7B2C" + row + "\u884C\u5931\u8D25: " + e.message);
            }
        }

        bgmLog(LOG_LEVELS.INFO, "\u6807\u8BB0\u5B8C\u6210，\u5171\u6807\u8BB0 " + markedCount + " \u4E2A\u6761\u76EE");
        BGM.showDialog("\u6807\u8BB0\u5B8C\u6210", "\u5DF2\u5728 D \u5217\u6807\u8BB0 " + markedCount + " \u4E2A\u5DF2\u6536\u85CF\u6761\u76EE");
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u6807\u8BB0\u6761\u76EE\u5931\u8D25: " + e.message);
    }
}

/**
 * 清除工作表标记
 */
export function clearSheetMarksInSheet(sheetIndex) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) return;

    let ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    if (!ws) return;

    try {
        let lastRow = ws.Range("A" + ws.Rows.Count).End(XL.UP).Row;
        
        for (let row = 2; row <= lastRow; row++) {
            try {
                let cell = getCell(ws, row, 4);
                if (cell) {
                    cell.Value = "";
                    if (cell.Interior) {
                        cell.Interior.ColorIndex = XL.NONE;
                    }
                }
            } catch (e) {
                bgmLog(LOG_LEVELS.WARN, "clearAllMarks \u6E05\u9664\u7B2C" + row + "\u884C\u5931\u8D25: " + e.message);
            }
        }

        BGM.showDialog("\u5B8C\u6210", "\u5DF2\u6E05\u9664\u6240\u6709\u6807\u8BB0");
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u6E05\u9664\u6807\u8BB0\u5931\u8D25: " + e.message);
    }
}

// ========== 向后兼容（挂载到 window）==========
window.setSyncRecordHeaders = setSyncRecordHeaders;
window.checkHeaderExists = checkHeaderExists;
window.getOrCreateSyncRecordSheet = getOrCreateSyncRecordSheet;
window.addSyncRecord = addSyncRecord;
window.getAllSyncRecords = getAllSyncRecords;
window.clearSyncRecords = clearSyncRecords;
window.openSyncRecordSheet = openSyncRecordSheet;
window.fetchAndRecordBgCollections = fetchAndRecordBgCollections;
window.fetchCollectionsByType = fetchCollectionsByType;
window.formatCurrentTime = formatCurrentTime;
window.markUploadedItemsInSheet = markUploadedItemsInSheet;
window.clearSheetMarksInSheet = clearSheetMarksInSheet;
