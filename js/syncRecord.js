/**
 * 同步记录模块
 * @module syncRecord
 * @description 管理同步记录工作表，记录同步历史
 */

import { XL, BGM_COLOR, LOG_LEVELS, BGM } from './util.js';
import { getApp, bgmLog, colNumToLetter, getCell } from './util.js';

// ========== 向后兼容别名 ==========
export function sendToTaskpaneSR(data) {
    return BGM.postMessage(data);
}

export function showDialogSR(title, message) {
    BGM.showDialog(title, message);
}

// ========== 常量定义 ==========
/**
 * BGM 条目类型映射
 * 注意：这是条目类型（书籍/动画/音乐/游戏/真人剧），不是收藏状态
 */
export const BGM_SUBJECT_TYPES = {
    1: "\u4e66\u7c4d",
    2: "\u52a8\u753b",
    3: "\u97f3\u4e50",
    4: "\u6e38\u620f",
    6: "\u771f\u4eba\u5267"
};

// ========== 表头设置 ==========
/**
 * 设置同步记录工作表的表头
 * @param {object} sheet - 工作表对象
 */
export function setSyncRecordHeaders(sheet) {
    let headers = ["\u5e8f\u53f7", "\u540c\u6b65\u65f6\u95f4", "\u540d\u79f0", "URL", "SID", "\u6761\u76ee\u7c7b\u578b", "\u6b21\u6570", "\u5185\u5bb9", "\u72b6\u6001", "\u5907\u6ce8"];

    bgmLog(LOG_LEVELS.DEBUG, "setSyncRecordHeaders \u5f00\u59cb - \u5de5\u4f5c\u8868: " + (sheet ? sheet.Name : "null"));

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
            bgmLog(LOG_LEVELS.ERROR, "\u8bbe\u7f6e\u8868\u5934\u5931\u8d25 - \u5217: " + cellAddr + " \u9519\u8bef: " + e.message);
        }
    }

    // 设置第二行为颜色说明
    try {
        let noteCell = sheet.Range("I2");
        if (noteCell) {
            noteCell.Value2 = "\u72b6\u6001\u989c\u8272\uff1a\u7eff=\u6210\u529f | \u7ea2=\u5931\u8d25 | \u9ec4=\u8df3\u8fc7 | \u7d2b=\u5df2\u6536\u85cf(1\u6b21) | \u6d45\u7eff=\u5df2\u6536\u85cf(2\u6b21) | \u6df1\u7eff=\u5df2\u6536\u85cf(3\u6b21+)";
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
            bgmLog(LOG_LEVELS.WARN, "\u51bb\u7ed3\u9996\u884c\u5931\u8d25: " + e.message);
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "\u8bbe\u7f6e\u8bf4\u660e\u884c\u5931\u8d25: " + e.message);
    }

    bgmLog(LOG_LEVELS.INFO, "setSyncRecordHeaders \u5b8c\u6210");
}

/**
 * 检查表头是否存在
 * @param {object} sheet - 工作表对象
 * @returns {boolean}
 */
export function checkHeaderExists(sheet) {
    try {
        let firstCell = sheet.Range("A1");
        if (!firstCell) return false;
        let val = firstCell.Value2;
        if (val === null || val === undefined || val === "") return false;
        let headerText = String(val).toString().trim();
        return headerText === "\u5e8f\u53f7";
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "checkHeaderExists error: " + e.message);
        return false;
    }
}

// ========== 获取或创建同步记录工作表 ==========
/**
 * 获取或创建同步记录工作表
 * @returns {object|null}
 */
export function getOrCreateSyncRecordSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.ERROR, "getOrCreateSyncRecordSheet - \u65e0\u6cd5\u83b7\u53d6 ActiveWorkbook");
        return null;
    }

    let sheets = app.ActiveWorkbook.Sheets;
    let sheetName = "\u540c\u6b65\u8bb0\u5f55";

    // 查找是否已存在
    for (let i = 1; i <= sheets.Count; i++) {
        if (sheets.Item(i).Name === sheetName) {
            bgmLog(LOG_LEVELS.INFO, "\u627e\u5230\u73b0\u6709\u540c\u6b65\u8bb0\u5f55\u5de5\u4f5c\u8868");
            let existingSheet = sheets.Item(i);
            if (!checkHeaderExists(existingSheet)) {
                setSyncRecordHeaders(existingSheet);
            }
            return existingSheet;
        }
    }

    // 创建新工作表
    bgmLog(LOG_LEVELS.INFO, "\u521b\u5efa\u65b0\u7684\u540c\u6b65\u8bb0\u5f55\u5de5\u4f5c\u8868");
    try {
        let newSheet = sheets.Add();
        newSheet.Name = sheetName;
        setSyncRecordHeaders(newSheet);
        bgmLog(LOG_LEVELS.INFO, "\u65b0\u5de5\u4f5c\u8868\u5df2\u521b\u5efa: " + sheetName);
        return newSheet;
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u521b\u5efa\u5de5\u4f5c\u8868\u5931\u8d25: " + e.message);
        return null;
    }
}

// ========== 同步记录缓存 ==========
let _syncRecordSidCache = new Map();
let _syncRecordListCache = [];
let _syncRecordCacheValid = false;

function _invalidateSyncRecordCache() {
    _syncRecordSidCache.clear();
    _syncRecordListCache = [];
    _syncRecordCacheValid = false;
}

function _buildSyncRecordCache(sheet) {
    if (_syncRecordCacheValid) return;
    _syncRecordSidCache.clear();
    _syncRecordListCache = [];

    let lastRow = 1;
    try {
        let lastCell = sheet.Range("A" + sheet.Rows.Count);
        if (lastCell && lastCell.Value2) {
            let endCell = lastCell.End(-4162); // xlUp
            lastRow = endCell.Row > 0 ? endCell.Row : 1;
        }
    } catch (e) {}

    for (let row = 2; row <= lastRow; row++) {
        try {
            let sid = sheet.Range("E" + row).Value2 || "";
            sid = String(sid).trim();
            let url = sheet.Range("D" + row).Value2 || "";
            url = String(url).trim();
            if (!url && !sid) continue;

            _syncRecordSidCache.set(sid, row);
            _syncRecordListCache.push({
                seq: sheet.Range("A" + row).Value2,
                time: sheet.Range("B" + row).Value2,
                name: sheet.Range("C" + row).Value2,
                url: url,
                sid: sid,
                type: sheet.Range("F" + row).Value2,
                count: sheet.Range("G" + row).Value2,
                content: sheet.Range("H" + row).Value2,
                status: sheet.Range("I" + row).Value2,
                message: sheet.Range("J" + row).Value2,
                row: row
            });
        } catch (e) {}
    }
    _syncRecordCacheValid = true;
}

/**
 * 根据 SID 获取行号
 * @param {string} sid
 * @returns {number} 行号，0 表示未找到
 */
export function _getRecordRowBySid(sheet, sid) {
    if (!sid) return 0;
    _buildSyncRecordCache(sheet);
    return _syncRecordSidCache.get(sid) || 0;
}

// ========== 添加同步记录 ==========
/**
 * 添加同步记录
 * 支持两种调用方式：
 *   addSyncRecord(options) - 自动获取工作表（兼容旧接口）
 *   addSyncRecord(sheet, record) - 传入工作表（新接口）
 */
export function addSyncRecord(sheetOrOptions, record) {
    let sheet, options;

    // 判断调用方式：如果第一个参数是对象且没有 Name 属性，则为 options
    if (sheetOrOptions && typeof sheetOrOptions === 'object' && !sheetOrOptions.Name && !sheetOrOptions.Range) {
        options = sheetOrOptions;
        record = options;
    } else {
        sheet = sheetOrOptions;
        options = record;
    }

    try {
        if (!sheet) {
            sheet = getOrCreateSyncRecordSheet();
        }
        if (!sheet || !options) return false;

        // 找到最后一行
        let lastRow = 1;
        try {
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell && lastCell.Value2) {
                let endCell = lastCell.End(-4162);
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}

        if (lastRow === 1) {
            try {
                for (let i = 2; i <= 10000; i++) {
                    let cell = sheet.Range("A" + i);
                    if (!cell || !cell.Value2) break;
                    lastRow = i;
                }
            } catch (e) {}
        }

        // 构建缓存
        _buildSyncRecordCache(sheet);

        // 检查是否已存在相同 SID 的记录
        let sid = String(options.sid || "");
        let existingRow = _syncRecordSidCache.get(sid) || 0;
        let currentCount = 1;
        if (existingRow > 0) {
            let countCell = sheet.Range("G" + existingRow);
            currentCount = countCell ? (parseInt(countCell.Value2) || 0) + 1 : 1;
        }

        let newRow = existingRow > 0 ? existingRow : lastRow + 1;
        let seqNum = existingRow > 0 ? existingRow - 1 : lastRow;

        // 同步时间
        let now = new Date();
        let timeStr = now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, '0') + "-" +
            String(now.getDate()).padStart(2, '0') + " " +
            String(now.getHours()).padStart(2, '0') + ":" +
            String(now.getMinutes()).padStart(2, '0') + ":" +
            String(now.getSeconds()).padStart(2, '0');

        // 写入数据
        let writeSuccess = false;
        try {
            if (existingRow === 0) {
                let cellA = sheet.Range("A" + newRow);
                if (cellA) cellA.Value2 = seqNum;
            }
            let cellB = sheet.Range("B" + newRow);
            if (cellB) cellB.Value2 = timeStr;
            let cellC = sheet.Range("C" + newRow);
            if (cellC) cellC.Value2 = options.name || "";
            let cellD = sheet.Range("D" + newRow);
            if (cellD) cellD.Value2 = options.url || "";
            let cellE = sheet.Range("E" + newRow);
            if (cellE) cellE.Value2 = sid;
            let cellF = sheet.Range("F" + newRow);
            if (cellF) cellF.Value2 = options.type || "";
            let cellG = sheet.Range("G" + newRow);
            if (cellG) cellG.Value2 = currentCount;
            let cellH = sheet.Range("H" + newRow);
            if (cellH) cellH.Value2 = options.content || "";
            let cellI = sheet.Range("I" + newRow);
            if (cellI) cellI.Value2 = options.status || "\u6210\u529f";
            let cellJ = sheet.Range("J" + newRow);
            if (cellJ) cellJ.Value2 = options.message || options.comment || "";

            // 验证写入
            let verifyA = sheet.Range("A" + newRow);
            let verifyVal = verifyA ? verifyA.Value2 : null;
            writeSuccess = (verifyVal !== null && verifyVal !== undefined && verifyVal !== "");
        } catch (writeErr) {
            bgmLog(LOG_LEVELS.ERROR, "addSyncRecord \u5199\u5165\u5931\u8d25: " + writeErr.message);
        }

        // 写入失败时尝试激活后重写
        if (!writeSuccess) {
            bgmLog(LOG_LEVELS.WARN, "addSyncRecord \u9996\u6b21\u5199\u5165\u9a8c\u8bc1\u5931\u8d25\uff0c\u5c1d\u8bd5\u6fc0\u6d3b\u540e\u91cd\u65b0\u5199\u5165");
            try {
                sheet.Activate();
                if (existingRow === 0) {
                    let cellA = sheet.Range("A" + newRow);
                    if (cellA) cellA.Value2 = seqNum;
                }
                let cellB = sheet.Range("B" + newRow);
                if (cellB) cellB.Value2 = timeStr;
                let cellC = sheet.Range("C" + newRow);
                if (cellC) cellC.Value2 = options.name || "";
                let cellD = sheet.Range("D" + newRow);
                if (cellD) cellD.Value2 = options.url || "";
                let cellE = sheet.Range("E" + newRow);
                if (cellE) cellE.Value2 = sid;
                let cellF = sheet.Range("F" + newRow);
                if (cellF) cellF.Value2 = options.type || "";
                let cellG = sheet.Range("G" + newRow);
                if (cellG) cellG.Value2 = currentCount;
                let cellH = sheet.Range("H" + newRow);
                if (cellH) cellH.Value2 = options.content || "";
                let cellI = sheet.Range("I" + newRow);
                if (cellI) cellI.Value2 = options.status || "\u6210\u529f";
                let cellJ = sheet.Range("J" + newRow);
                if (cellJ) cellJ.Value2 = options.message || options.comment || "";
                let verifyA2 = sheet.Range("A" + newRow);
                writeSuccess = verifyA2 && (verifyA2.Value2 !== null && verifyA2.Value2 !== undefined && verifyA2.Value2 !== "");
            } catch (retryErr) {
                bgmLog(LOG_LEVELS.ERROR, "addSyncRecord \u91cd\u5199\u4e5f\u5931\u8d25: " + retryErr.message);
            }
        }

        // 更新缓存
        if (existingRow === 0) {
            _syncRecordListCache.push({
                seq: seqNum, time: timeStr, name: options.name || "",
                url: options.url || "", sid: sid, type: options.type || "",
                count: currentCount, content: options.content || "",
                status: options.status || "\u6210\u529f",
                message: options.message || options.comment || "",
                row: newRow
            });
        } else {
            for (let i = 0; i < _syncRecordListCache.length; i++) {
                if (String(_syncRecordListCache[i].sid) === sid) {
                    _syncRecordListCache[i].time = timeStr;
                    _syncRecordListCache[i].name = options.name || _syncRecordListCache[i].name;
                    _syncRecordListCache[i].url = options.url || _syncRecordListCache[i].url;
                    _syncRecordListCache[i].type = options.type || _syncRecordListCache[i].type;
                    _syncRecordListCache[i].count = currentCount;
                    _syncRecordListCache[i].content = options.content || _syncRecordListCache[i].content;
                    _syncRecordListCache[i].status = options.status || _syncRecordListCache[i].status;
                    _syncRecordListCache[i].message = options.message || options.comment || _syncRecordListCache[i].message;
                    break;
                }
            }
        }
        _syncRecordSidCache.set(sid, newRow);

        // 设置状态颜色（I 列）
        let statusCell = sheet.Range("I" + newRow);
        if (statusCell && statusCell.Interior) {
            let status = options.status || "\u6210\u529f";
            if (status === "\u6210\u529f") {
                statusCell.Interior.Color = BGM_COLOR.SUCCESS;
            } else if (status === "\u5931\u8d25") {
                statusCell.Interior.Color = BGM_COLOR.FAIL;
            } else if (status === "\u8df3\u8fc7") {
                statusCell.Interior.Color = BGM_COLOR.SKIP;
            }
        }

        bgmLog(LOG_LEVELS.INFO, "addSyncRecord " + (existingRow > 0 ? "\u66f4\u65b0" : "\u65b0\u589e") + " - \u884c: " + newRow + " \u72b6\u6001: " + (options.status || "\u6210\u529f"));
        return true;
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "addSyncRecord error: " + e.message);
        return false;
    }
}

// ========== 更新同步记录 ==========
/**
 * 更新同步记录
 * @param {string} sid - 要更新的记录的 SID
 * @param {object} updates - 要更新的字段 {count, time, status, message}
 * @returns {boolean}
 */
export function updateSyncRecord(sid, updates) {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return false;

        let lastRow = 1;
        try {
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell) {
                let endCell = lastCell.End(-4162);
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}

        for (let row = 2; row <= lastRow; row++) {
            try {
                let recordSid = sheet.Range("E" + row).Value2;
                if (String(recordSid) === String(sid)) {
                    if (updates.count !== undefined) {
                        let currentCount = parseInt(sheet.Range("G" + row).Value2) || 0;
                        sheet.Range("G" + row).Value2 = currentCount + updates.count;
                    }
                    if (updates.time) {
                        sheet.Range("B" + row).Value2 = updates.time;
                    }
                    if (updates.status) {
                        sheet.Range("I" + row).Value2 = updates.status;
                        let statusCell = sheet.Range("I" + row);
                        if (statusCell && statusCell.Interior) {
                            if (updates.status === "\u6210\u529f") statusCell.Interior.Color = BGM_COLOR.SUCCESS;
                            else if (updates.status === "\u5931\u8d25") statusCell.Interior.Color = BGM_COLOR.FAIL;
                        }
                    }
                    if (updates.message) {
                        let currentMsg = sheet.Range("J" + row).Value2 || "";
                        let newMsg = currentMsg ? currentMsg + "; " + updates.message : updates.message;
                        sheet.Range("J" + row).Value2 = newMsg;
                    }
                    _invalidateSyncRecordCache();
                    return true;
                }
            } catch (e) {}
        }
        return false;
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "updateSyncRecord error: " + e.message);
        return false;
    }
}

// ========== 获取同步记录 ==========
/**
 * 获取所有同步记录
 * @returns {Array}
 */
export function getAllSyncRecords() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return [];
        _buildSyncRecordCache(sheet);
        return _syncRecordListCache.slice(); // 返回副本
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "getAllSyncRecords error: " + e.message);
        return [];
    }
}

// ========== 清除同步记录 ==========
/**
 * 清除所有同步记录
 * @param {boolean} confirmPrompt - 是否显示确认对话框，默认 true
 */
export function clearSyncRecords(confirmPrompt) {
    if (confirmPrompt !== false) {
        if (typeof window.showConfirmDialog === 'function') {
            window.showConfirmDialog(
                "\u786e\u5b9a\u8981\u6e05\u9664\u6240\u6709\u540c\u6b65\u8bb0\u5f55\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002",
                () => { _doClearSyncRecords(); }
            );
            return;
        }
        if (typeof window.BGMConfirm === 'function') {
            window.BGMConfirm(
                "\u786e\u5b9a\u8981\u6e05\u9664\u6240\u6709\u540c\u6b65\u8bb0\u5f55\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002",
                "\u786e\u8ba4\u6e05\u9664",
                () => { _doClearSyncRecords(); }
            );
            return;
        }
        if (!confirm("\u786e\u5b9a\u8981\u6e05\u9664\u6240\u6709\u540c\u6b65\u8bb0\u5f55\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002")) {
            return;
        }
    }
    _doClearSyncRecords();
}

function _doClearSyncRecords() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return;

        // 激活此工作表后再删除（WPS COM 要求激活才能操作已用区域）
        try { sheet.Activate(); } catch (e) {}

        let lastRow = 1;
        try {
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell) {
                let endCell = lastCell.End(-4162);
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}

        if (lastRow < 2) {
            if (typeof window.showAlert === 'function') window.showAlert("\u6ca1\u6709\u540c\u6b65\u8bb0\u5f55\u53ef\u6e05\u9664");
            return;
        }

        // 删除数据行（保留表头）
        let range = sheet.Range("A2:J" + lastRow);
        range.Delete();

        _invalidateSyncRecordCache();
        if (typeof window.showAlert === 'function') window.showAlert("\u5df2\u6e05\u9664 " + (lastRow - 1) + " \u6761\u540c\u6b65\u8bb0\u5f55");
        bgmLog(LOG_LEVELS.INFO, "\u540c\u6b65\u8bb0\u5f55\u5df2\u6e05\u9664");
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u6e05\u9664\u540c\u6b65\u8bb0\u5f55\u5931\u8d25: " + e.message);
    }
}

// ========== 批量写入辅助 ==========
/**
 * 激活同步记录工作表（批量写入前调用）
 * @returns {object|null}
 */
export function activateSyncRecordSheet() {
    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return null;
    try { sheet.Activate(); } catch (e) {}
    return sheet;
}

/**
 * 完成批量写入后刷新同步记录工作表
 */
export function finalizeSyncRecordBatch() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (sheet) {
            try { sheet.Calculate(); } catch (e) {}
            _syncRecordCacheValid = true;
        }
    } catch (e) {}
}

// ========== 打开同步记录工作表 ==========
/**
 * 打开同步记录工作表
 */
export function openSyncRecordSheet() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) {
            if (typeof window.showAlert === 'function') window.showAlert("\u65e0\u6cd5\u6253\u5f00\u540c\u6b65\u8bb0\u5f55\u5de5\u4f5c\u8868");
            return;
        }
        sheet.Activate();
    } catch (e) {
        if (typeof window.showAlert === 'function') window.showAlert("\u6253\u5f00\u540c\u6b65\u8bb0\u5f55\u5de5\u4f5c\u8868\u5931\u8d25: " + e.message);
        bgmLog(LOG_LEVELS.ERROR, "\u6253\u5f00\u540c\u6b65\u8bb0\u5f55\u8868\u5931\u8d25: " + e.message);
    }
}

// ========== 格式化时间 ==========
/**
 * 格式化当前时间为字符串
 * @returns {string} YYYY-MM-DD HH:mm:ss
 */
export function formatCurrentTime() {
    let now = new Date();
    return now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, '0') + "-" +
        String(now.getDate()).padStart(2, '0') + " " +
        String(now.getHours()).padStart(2, '0') + ":" +
        String(now.getMinutes()).padStart(2, '0') + ":" +
        String(now.getSeconds()).padStart(2, '0');
}

// ========== 向后兼容：获取并记录收藏（纯写入版）==========
/**
 * 获取并记录 Bangumi 收藏（旧接口兼容）
 * @param {string} _token - 预留
 * @param {string} _userId - 预留
 * @param {Array} collections - 收藏数据
 */
export function fetchAndRecordBgCollections(_token, _userId, collections) {
    if (!collections || collections.length === 0) {
        bgmLog(LOG_LEVELS.WARN, "\u6ca1\u6709\u6536\u85cf\u6570\u636e\u9700\u8981\u8bb0\u5f55");
        return;
    }

    bgmLog(LOG_LEVELS.INFO, "\u5f00\u59cb\u8bb0\u5f55 " + collections.length + " \u6761\u6536\u85cf");

    let recordCount = 0;
    collections.forEach(item => {
        if (addSyncRecord({
            name: item.name || "",
            url: "https://bgm.tv/subject/" + item.sid,
            sid: String(item.sid),
            type: String(item.type || "2"),
            count: 1,
            content: item.comment || (item.rate ? "\u8bc4\u5206: " + item.rate : ""),
            status: "\u5df2\u6536\u85cf"
        })) {
            recordCount++;
        }
    });

    bgmLog(LOG_LEVELS.INFO, "\u8bb0\u5f55\u5b8c\u6210\uff0c\u5171\u6dfb\u52a0 " + recordCount + " \u6761");
}

// ========== 清除工作表标记 ==========
/**
 * 清除工作表 D 列标记
 */
export function clearSheetMarksInSheet(sheetIndex) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) return;

    let ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    if (!ws) return;

    try {
        let lastRow = ws.Range("A" + ws.Rows.Count).End(-4162).Row;

        for (let row = 2; row <= lastRow; row++) {
            try {
                let cell = getCell(ws, row, 4);
                if (cell) {
                    cell.Value = "";
                    if (cell.Interior) cell.Interior.ColorIndex = XL.NONE;
                }
            } catch (e) {}
        }

        if (typeof BGM !== 'undefined' && BGM.showDialog) {
            BGM.showDialog("\u5b8c\u6210", "\u5df2\u6e05\u9664\u6240\u6709\u6807\u8bb0");
        }
        bgmLog(LOG_LEVELS.INFO, "\u6e05\u9664\u6807\u8bb0\u5b8c\u6210");
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "\u6e05\u9664\u6807\u8bb0\u5931\u8d25: " + e.message);
    }
}

// ========== 向后兼容（挂载到 window）==========
if (typeof window !== 'undefined') {
    window.setSyncRecordHeaders = setSyncRecordHeaders;
    window.checkHeaderExists = checkHeaderExists;
    window.getOrCreateSyncRecordSheet = getOrCreateSyncRecordSheet;
    window.addSyncRecord = addSyncRecord;
    window.updateSyncRecord = updateSyncRecord;
    window.getAllSyncRecords = getAllSyncRecords;
    window.clearSyncRecords = clearSyncRecords;
    window.openSyncRecordSheet = openSyncRecordSheet;
    window.activateSyncRecordSheet = activateSyncRecordSheet;
    window.finalizeSyncRecordBatch = finalizeSyncRecordBatch;
    window.fetchAndRecordBgCollections = fetchAndRecordBgCollections;
    window.formatCurrentTime = formatCurrentTime;
    window.markUploadedItemsInSheet = markUploadedItemsInSheet;
    window.clearSheetMarksInSheet = clearSheetMarksInSheet;
    window.BGM_SUBJECT_TYPES = BGM_SUBJECT_TYPES;
}

// 向后兼容：markUploadedItemsInSheet 需要的占位
function markUploadedItemsInSheet() {
    bgmLog(LOG_LEVELS.WARN, "markUploadedItemsInSheet \u5df2\u5e9f\u5f03\uff0c\u8bf7\u4f7f\u7528 handlers.js \u4e2d\u7684\u7248\u672c");
}
