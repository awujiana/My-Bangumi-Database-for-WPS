/**
 * 任务面板主模块
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑
 */

import { BGM, BGM_CONFIG } from './util.js';

// 列号转Excel列字母（1→A, 26→Z, 27→AA, 52→AZ, 53→BA）
function colToLetter(col) {
    let s = '';
    let c = col;
    while (c > 0) {
        c--;
        s = String.fromCharCode(65 + (c % 26)) + s;
        c = Math.floor(c / 26);
    }
    return s;
}

import { getApp, bgmLog, LOG_LEVELS, escapeHtml,
    loadBgToken, storeBgToken, clearBgToken,
    sleep, getCell, getCellValue, trim,
    _getUserApiPath, _setBgmUserId
} from './util.js';
import { initMessageListener, setSyncRunning, setStatus } from './ui/message.js';
import { 
    markUploadedItems, clearSheetMarks,
    updateTokenStatus, updateUserIdStatus,
    showTokenDialog, showUserIdDialog
} from './ui/handlers.js';
import { 
    showAlert, closeAlertDialog, closeInputDialog, closeConfirmDialog,
    showToast,
    showInputDialog, showConfirmDialog
} from './ui/dialog.js';
import { previewSyncContent, closeDetailModal, filterDetailItems } from './ui/preview.js';
import { clearSyncRecords as _clearSyncRecords,
    getOrCreateSyncRecordSheet, getAllSyncRecords, addSyncRecord,
    openSyncRecordSheet, BGM_SUBJECT_TYPES, formatCurrentTime,
    updateSyncRecord, activateSyncRecordSheet, finalizeSyncRecordBatch
} from './syncRecord.js';
import {
    findHeaderRow, getColumnMap, getLastRow, extractSubjectId,
    mapWatchStatus, buildJsonPayload, getSequentialRowsBySeqCol,
    getFilterStatus, clearRowColors, bgmRequestSync
} from './bangumi.js';

// ========== 工作表锁定功能 ==========
// 注意：工作表锁定状态已迁移到 BGM.sheet 命名空间
// - BGM.sheet.lockedIndex: 锁定的工作表索引
// - BGM.sheet.lockedName: 锁定的工作表名称
// - BGM.sheet.isLocked: 是否已锁定

/**
 * 切换工作表锁定状态，并缓存到 PluginStorage
 */
function toggleSheetLock() {
    let select = document.getElementById("sheetSelect");
    if (!select) return;

    let sheetIndex = parseInt(select.value);

    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === sheetIndex) {
        BGM.sheet.lockedIndex = null;
        BGM.sheet.lockedName = null;
        BGM.sheet.isLocked = false;
        saveLockedSheet(null);  // 清除缓存
        showToast("\u5DF2\u89E3\u9501\u5DE5\u4F5C\u8868", "info");
    } else {
        let sheetName = select.options[select.selectedIndex]?.text || "";
        BGM.sheet.lockedIndex = sheetIndex;
        BGM.sheet.lockedName = sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: sheetIndex, name: sheetName });  // 写入缓存
        showToast("\u5DF2\u9501\u5B9A\u5DE5\u4F5C\u8868: " + sheetName, "info");
    }
    updateLockButton();
    refreshData();
}

/**
 * 保存锁定的工作表到 PluginStorage
 */
function saveLockedSheet(info) {
    let app = getApp();
    if (app?.PluginStorage) {
        app.PluginStorage.setItem("bgm_locked_sheet", info ? JSON.stringify(info) : "");
    }
}

/**
 * 从 PluginStorage 恢复锁定的工作表
 */
function restoreLockedSheet() {
    let app = getApp();
    if (app?.PluginStorage) {
        let raw = app.PluginStorage.getItem("bgm_locked_sheet");
        if (raw) {
            try {
                let info = JSON.parse(raw);
                BGM.sheet.lockedIndex = info.index || null;
                BGM.sheet.lockedName = info.name || null;
                BGM.sheet.isLocked = !!(info.index && info.name);
                return true;
            } catch (e) {
                // 缓存数据损坏，清除
                saveLockedSheet(null);
            }
        }
    }
    return false;
}

/**
 * 更新锁定按钮状态
 */
function updateLockButton() {
    let btn = document.getElementById("lockSheetBtn");
    let status = document.getElementById("lockStatus");
    
    if (btn) {
        if (BGM.sheet.isLocked) {
            btn.textContent = "🔓 \u89E3\u9501";
            btn.classList.add("locked");
        } else {
            btn.textContent = "🔒 \u9501\u5B9A";
            btn.classList.remove("locked");
        }
    }
    
    if (status) {
        if (BGM.sheet.isLocked) {
            status.style.display = "inline";
            status.textContent = "\u5DF2\u9501\u5B9A: " + BGM.sheet.lockedName;
        } else {
            status.style.display = "none";
        }
    }
}

/**
 * 刷新工作表列表
 */
function refreshSheets() {
    let select = document.getElementById("sheetSelect");
    if (!select) return;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        console.warn("refreshSheets: \u65E0\u6CD5\u83B7\u53D6 ActiveWorkbook");
        return;
    }

    let sheets = app.ActiveWorkbook.Worksheets;
    select.innerHTML = '<option value="">-- \u8BF7\u9009\u62E9 --</option>';

    for (let i = 1; i <= sheets.Count; i++) {
        let option = document.createElement("option");
        option.value = i;
        option.text = sheets.Item(i).Name;
        
        if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === i) {
            option.selected = true;
        }
        
        select.appendChild(option);
    }

    updateLockButton();
}

/**
 * 自动检测包含数据表头的工作表并选中
 * 扫描所有工作表，找表头匹配度最高的，自动选中、锁定、预览
 * @returns {{ sheetIndex: number, sheetName: string, headerRow: number, matchCount: number }|null}
 */
function autoDetectSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.WARN, "autoDetectSheet: Application \u4E0D\u53EF\u7528");
        return null;
    }

    let sheets = app.ActiveWorkbook.Worksheets;
    let scanKeywords = [
        "\u5e8f\u5217\u53f7", "\u662f\u5426\u770b\u5b8c", "\u770b\u5b8c\u65f6\u95f4", "\u5f00\u64ad\u5b63\u5ea6",
        "\u540d\u79f0", "\u522b\u540d", "\u6253\u5206", "\u96c6\u53f7", "\u96c6\u6570",
        "\u5267\u900f/\u611f\u8a00", "\u611f\u8a00", "\u5907\u6ce8", "\u8bc4\u4ef7",
        "bangumi url", "url", "\u5236\u7247\u56fd\u5bb6", "\u8bed\u8a00", "\u7c7b\u578b",
        "\u5bfc\u6f14", "\u97f3\u4e50", "\u539f\u4f5c", "\u6807\u7b7e",
        "\u6761\u76eeid", "sid", "\u72b6\u6001", "status", "rate",
        "\u756a\u5267", "\u52a8\u753b", "\u4e66", "\u540d\u5b57", "\u94fe\u63a5",
        "\u89c2\u770b\u72b6\u6001", "\u6536\u85cf\u7c7b\u578b", "\u7ae0\u8282\u72b6\u6001", "\u540c\u6b65\u72b6\u6001",
        "\u5b8c\u64ad\u65e5", "\u7279\u70b9", "\u5370\u8c61", "\u5173\u8054\u7684\u52a8\u6f2b"
    ];

    let bestMatch = null;

    for (let si = 1; si <= sheets.Count; si++) {
        try {
            let ws = sheets.Item(si);
            if (!ws) continue;
            let sheetName = "";
            try { sheetName = ws.Name; } catch (_) {}

            bgmLog(LOG_LEVELS.INFO, "autoDetectSheet: \u626B\u63CF " + sheetName + " (index=" + si + ")");

            // 跳过同步记录表等特殊表
            if (sheetName === "\u540C\u6B65\u8BB0\u5F55" || sheetName === "SyncRecord") continue;
            // 跳过辅助查找表
            if (sheetName.includes("\u6A21\u7CCA") || sheetName.includes("\u641C\u7D22") || sheetName.includes("SEARCH")) continue;

            // 非活动表可能无法直接读取，临时激活
            let needRestore = false;
            let origActive = null;
            try {
                origActive = app.ActiveWorkbook.ActiveSheet;
                let origName = "";
                try { origName = origActive.Name; } catch (_) {}
                if (origName !== sheetName) {
                    ws.Activate();
                    needRestore = true;
                    bgmLog(LOG_LEVELS.INFO, "autoDetectSheet: \u4E34\u65F6\u6FC0\u6D3B " + sheetName);
                }
            } catch (e) {
                bgmLog(LOG_LEVELS.WARN, "autoDetectSheet: \u6FC0\u6D3B\u5DE5\u4F5C\u8868\u5931\u8D25: " + e.message);
            }

            // WPS 兼容读取单元格（优先使用 Range().Value2，实测最可靠）
            function readCell(ws, row, col) {
                let colLetter = colToLetter(col);
                // 方法1: Range("A1").Value2 — WPS 中最可靠的读取方式
                try {
                    let cell = ws.Range(colLetter + row);
                    if (cell) {
                        let v = cell.Value2;
                        if (v !== null && v !== undefined && v !== '') return String(v);
                    }
                } catch (_) {}
                // 方法2: Range("A1").Value
                try {
                    let cell = ws.Range(colLetter + row);
                    if (cell) {
                        let v = cell.Value;
                        if (typeof v === 'function') v = v();
                        if (v !== null && v !== undefined && v !== '') return String(v);
                    }
                } catch (_) {}
                // 方法3: Cells(row,col).Value2
                try {
                    let v = ws.Cells(row, col).Value2;
                    if (v !== null && v !== undefined && v !== '') return String(v);
                } catch (_) {}
                // 方法4: Cells.Item(row,col).Value
                try {
                    let cell = ws.Cells.Item(row, col);
                    if (cell) {
                        let v = cell.Value;
                        if (typeof v === 'function') v = v();
                        if (v !== null && v !== undefined && v !== '') return String(v);
                    }
                } catch (_) {}
                // 方法5: Cells(row,col).Value
                try {
                    let v = ws.Cells(row, col).Value;
                    if (typeof v === 'function') v = v();
                    if (v !== null && v !== undefined && v !== '') return String(v);
                } catch (_) {}
                return "";
            }

            // 扫描前10行找表头（选列数最多的匹配行）
            let candidates = [];

            for (let r = 1; r <= 10; r++) {
                let matchCount = 0;
                let colCount = 0;
                for (let c = 1; c <= 60; c++) {
                    let v = readCell(ws, r, c).trim();
                    if (v) {
                        colCount++;
                        let cellVal = v.toLowerCase();
                        if (scanKeywords.some(kw => cellVal === kw || cellVal.includes(kw))) {
                            matchCount++;
                        }
                    }
                }
                if (matchCount >= 3) {
                    candidates.push({ row: r, matchCount, colCount });
                }
            }

            // 选列数最多的作为表头
            let bestRowNum = 0;
            let bestMatchCount = 0;
            let bestColCount = 0;
            if (candidates.length > 0) {
                candidates.sort((a, b) => b.colCount - a.colCount || a.row - b.row);
                bestRowNum = candidates[0].row;
                bestMatchCount = candidates[0].matchCount;
                bestColCount = candidates[0].colCount;
            }

            // 诊断：输出前3个非空行的内容
            if (bestMatchCount < 3) {
                let diagRows = [];
                for (let r = 1; r <= 30 && diagRows.length < 3; r++) {
                    let vals = [];
                    for (let c = 1; c <= 20; c++) {
                        let v = readCell(ws, r, c).trim();
                        if (v) vals.push("C" + c + "='" + v + "'");
                    }
                    if (vals.length > 0) diagRows.push("R" + r + ": " + vals.join(", "));
                }
                bgmLog(LOG_LEVELS.INFO, "autoDetectSheet: " + sheetName + " \u5185\u5BB9: " +
                    (diagRows.length > 0 ? diagRows.join(" | ") : "(\u5168\u90E8\u4E3A\u7A7A)"));
            }

            if (bestMatchCount >= 3) {
                // 验证表头下方有数据行（至少2行有实际数据），区分数据表和公式/说明表
                let dataRowCount = 0;
                for (let dr = bestRowNum + 1; dr <= bestRowNum + 10; dr++) {
                    let rowHasData = false;
                    for (let c = 1; c <= bestColCount; c++) {
                        if (readCell(ws, dr, c).trim()) { rowHasData = true; break; }
                    }
                    if (rowHasData) dataRowCount++;
                }
                if (dataRowCount < 2) {
                    bgmLog(LOG_LEVELS.INFO, "autoDetectSheet: " + sheetName + " 表头行" + bestRowNum + "下方数据不足(" + dataRowCount + "行), 跳过");
                    // 不设置为 bestMatch，跳过此表
                } else if (!bestMatch || bestColCount > bestMatch.colCount ||
                    (bestColCount === bestMatch.colCount && bestMatchCount > bestMatch.matchCount)) {
                    bestMatch = {
                        sheetIndex: si,
                        sheetName: sheetName,
                        headerRow: bestRowNum,
                        matchCount: bestMatchCount,
                        colCount: bestColCount
                    };
                }
            }

            // 恢复原活动表
            if (needRestore && origActive) {
                try { origActive.Activate(); } catch (_) {}
            }
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "autoDetectSheet: \u626B\u63CF\u5DE5\u4F5C\u8868 " + si + " \u51FA\u9519: " + e.message);
        }
    }

    if (bestMatch) {
        bgmLog(LOG_LEVELS.INFO, "autoDetectSheet: \u627E\u5230\u6700\u4F73\u5339\u914D " + bestMatch.sheetName +
            " (index=" + bestMatch.sheetIndex + ", headerRow=" + bestMatch.headerRow + ", match=" + bestMatch.matchCount + ")");
    } else {
        bgmLog(LOG_LEVELS.INFO, "autoDetectSheet: \u672A\u627E\u5230\u5305\u542B\u6570\u636E\u8868\u5934\u7684\u5DE5\u4F5C\u8868");
    }

    return bestMatch;
}

/**
 * 更新筛选状态显示（增强版：显示筛选列名、条件、可见/隐藏行数）
 */
function updateFilterStatus(targetWs) {
    let filterStatusEl = document.getElementById("filterStatus");
    if (!filterStatusEl) return;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        filterStatusEl.textContent = "\u672A\u8FDE\u63A5\u5230 Excel\uFF08\u8C03\u8BD5\u6A21\u5F0F\u4E0B\u4E0D\u53EF\u7528\uFF09";
        bgmLog(LOG_LEVELS.WARN, "updateFilterStatus: Application \u4E0D\u53EF\u7528");
        return;
    }

    let ws = targetWs || app.ActiveWorkbook.ActiveSheet;
    if (!ws) {
        filterStatusEl.textContent = "\u672A\u627E\u5230\u5DE5\u4F5C\u8868";
        bgmLog(LOG_LEVELS.WARN, "updateFilterStatus: \u5DE5\u4F5C\u8868\u4E3A\u7A7A");
        return;
    }

    try {
        let autoFilterMode = false;
        try { autoFilterMode = !!ws.AutoFilterMode; } catch (_) {}
        try { if (!autoFilterMode && ws.AutoFilter) autoFilterMode = !!ws.AutoFilter.Mode; } catch (_) {}

        if (autoFilterMode) {
            let autoFilter = ws.AutoFilter;
            let filters = null;
            try { filters = autoFilter.Filters; } catch (_) {}

            if (filters && typeof filters.Count !== 'undefined') {
                let activeColumns = [];

                for (let i = 1; i <= filters.Count; i++) {
                    try {
                        let f = null;
                        try { f = filters.Item(i); } catch (_) { try { f = filters(i); } catch (_2) {} }
                        if (f && f.On) {
                            // 读取筛选列的表头名称
                            let colName = "";
                            try {
                                let colLetter = String.fromCharCode(64 + i);
                                let headerCell = ws.Range(colLetter + "1");
                                if (headerCell) {
                                    let hv = headerCell.Value2;
                                    if (hv !== null && hv !== undefined && hv !== '') {
                                        colName = String(hv).substring(0, 12);
                                    }
                                }
                            } catch (_) {
                                // 备用: Cells 方式
                                try {
                                    let headerCell = ws.Cells(1, i);
                                    if (headerCell) {
                                        let hv = headerCell.Value2;
                                        if (hv !== null && hv !== undefined && hv !== '') {
                                            colName = String(hv).substring(0, 12);
                                        }
                                    }
                                } catch (_2) {}
                            }

                            // 读取筛选条件
                            let criteria = "";
                            try {
                                criteria = f.Criteria1 || "";
                                if (f.Criteria2) {
                                    let op = f.Operator;
                                    if (op === 1) criteria += " \u4E14 " + f.Criteria2;
                                    else if (op === 2) criteria += " \u6216 " + f.Criteria2;
                                    else criteria += " / " + f.Criteria2;
                                }
                            } catch (_) {}

                            activeColumns.push(colName ? colName + "(" + criteria + ")" : "\u5217" + i);
                        }
                    } catch (_) {}
                }

                if (activeColumns.length > 0) {
                    let columnList = activeColumns.join("\u3001");
                    let text = "\u2714 \u7B5B\u9009\u5DF2\u5F00\u542F\uFF08" + activeColumns.length + " \u5217\uFF09\uFF0C\u5C06\u540C\u6B65\u7B5B\u9009\u540E\u7684\u53EF\u89C1\u6570\u636E\n" + columnList;
                    filterStatusEl.textContent = text;
                    filterStatusEl.setAttribute("title", text);
                    bgmLog(LOG_LEVELS.INFO, "updateFilterStatus: \u7B5B\u9009\u5DF2\u5F00\u542F, \u5217=" + activeColumns.length + ", \u8BE6\u60C5=" + columnList);
                    return;
                }
            }
            filterStatusEl.textContent = "\u7B5B\u9009\u5DF2\u5F00\u542F\u4F46\u65E0\u6D3B\u52A8\u7B5B\u9009\uFF0C\u540C\u6B65\u5168\u90E8\u6570\u636E";
            bgmLog(LOG_LEVELS.INFO, "updateFilterStatus: AutoFilter \u5DF2\u5F00\u542F\u4F46\u65E0\u6D3B\u52A8\u7B5B\u9009");
        } else {
            filterStatusEl.textContent = "\u672A\u5F00\u542F\u7B5B\u9009\uFF0C\u540C\u6B65\u5168\u90E8\u6570\u636E";
            filterStatusEl.removeAttribute("title");
            bgmLog(LOG_LEVELS.INFO, "updateFilterStatus: \u672A\u5F00\u542F\u7B5B\u9009");
        }
    } catch (e) {
        filterStatusEl.textContent = "\u68C0\u6D4B\u7B5B\u9009\u72B6\u6001\u5931\u8D25: " + e.message;
        bgmLog(LOG_LEVELS.ERROR, "updateFilterStatus \u51FA\u9519: " + e.message);
    }
}

/**
 * \u5237\u65B0\u6570\u636E\u9884\u89C8
 * - \u68C0\u6D4B\u5DE5\u4F5C\u8868\u662F\u5426\u5305\u542B\u6709\u6548\u6570\u636E
 * - \u5982\u679C\u627E\u5230\u6570\u636E\u4E14\u672A\u9501\u5B9A\uFF0C\u81EA\u52A8\u9501\u5B9A\u5F53\u524D\u5DE5\u4F5C\u8868
 * - \u663E\u793A\u524D\u51E0\u884C\u6570\u636E\u4F5C\u4E3A\u9884\u89C8
 */
function refreshData() {
    bgmLog(LOG_LEVELS.INFO, "refreshData \u5F00\u59CB\u6267\u884C");
    let select = document.getElementById("sheetSelect");
    let previewBox = document.getElementById("previewBox");

    let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 0;

    if (!sheetIndex) {
        if (previewBox) {
            previewBox.innerHTML = '<p class="hint">\u8BF7\u5148\u9009\u62E9\u5DE5\u4F5C\u8868</p>';
        }
        updateFilterStatus();
        bgmLog(LOG_LEVELS.INFO, "refreshData: \u672A\u9009\u62E9\u5DE5\u4F5C\u8868");
        return;
    }

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        if (previewBox) {
            previewBox.innerHTML = '<p class="hint">\u672A\u8FDE\u63A5\u5230 Excel</p>';
        }
        bgmLog(LOG_LEVELS.WARN, "refreshData: Application \u4E0D\u53EF\u7528");
        updateFilterStatus();
        return;
    }

    let wb = app.ActiveWorkbook;
    let ws;
    try {
        ws = wb.Worksheets.Item(sheetIndex);
    } catch (e) {
        if (previewBox) {
            previewBox.innerHTML = '<p class="hint">\u65E0\u6CD5\u83B7\u53D6\u5DE5\u4F5C\u8868: ' + sheetIndex + '</p>';
        }
        bgmLog(LOG_LEVELS.WARN, "refreshData: \u83B7\u53D6\u5DE5\u4F5C\u8868\u5931\u8D25: " + e.message);
        updateFilterStatus();
        return;
    }

    let sheetName = "";
    try { sheetName = ws.Name; } catch (_) {}

    // \u5C1D\u8BD5\u8BFB\u53D6\u524D\u51E0\u884C\u6570\u636E\u4F5C\u4E3A\u9884\u89C8
    let previewRows = [];
    let hasData = false;
    let PREVIEW_LIMIT = 8;
    let foundHeaderRow = 0;

    // \u8BFB\u53D6\u5355\u5143\u683C\u503C\uFF08WPS COM \u517C\u5BB9\uFF09
    function readCell(ws, row, col) {
        let colLetter = colToLetter(col);
        // 方法1: Range("A1").Value2 — WPS 中最可靠的读取方式
        try {
            let cell = ws.Range(colLetter + row);
            if (cell) {
                let v = cell.Value2;
                if (v !== null && v !== undefined && v !== '') return String(v);
            }
        } catch (_) {}
        // 方法2: Range("A1").Value
        try {
            let cell = ws.Range(colLetter + row);
            if (cell) {
                let v = cell.Value;
                if (typeof v === 'function') v = v();
                if (v !== null && v !== undefined && v !== '') return String(v);
            }
        } catch (_) {}
        // 方法3: Cells(row,col).Value2
        try {
            let v = ws.Cells(row, col).Value2;
            if (v !== null && v !== undefined && v !== '') return String(v);
        } catch (_) {}
        // 方法4: Cells.Item(row,col).Value
        try {
            let cell = ws.Cells.Item(row, col);
            if (cell) {
                let v = cell.Value;
                if (typeof v === 'function') v = v();
                if (v !== null && v !== undefined && v !== '') return String(v);
            }
        } catch (_) {}
        // 方法5: Cells(row,col).Value
        try {
            let v = ws.Cells(row, col).Value;
            if (typeof v === 'function') v = v();
            if (v !== null && v !== undefined && v !== '') return String(v);
        } catch (_) {}
        return "";
    }
    // \u5B9A\u4E49\u8868\u5934\u5173\u952E\u8BCD\uFF08\u8986\u76D6\u7528\u6237\u5B9E\u9645\u8868\u5934 + bangumi.js \u5173\u952E\u8BCD\uFF09
    let scanKeywords = [
        "\u5e8f\u5217\u53f7", "\u662f\u5426\u770b\u5b8c", "\u770b\u5b8c\u65f6\u95f4", "\u5f00\u64ad\u5b63\u5ea6",
        "\u540d\u79f0", "\u522b\u540d", "\u6253\u5206", "\u96c6\u53f7", "\u96c6\u6570",
        "\u5267\u900f/\u611f\u8a00", "\u611f\u8a00", "\u5907\u6ce8", "\u8bc4\u4ef7",
        "bangumi url", "url", "\u5236\u7247\u56fd\u5bb6", "\u8bed\u8a00", "\u7c7b\u578b",
        "\u5bfc\u6f14", "\u97f3\u4e50", "\u539f\u4f5c", "\u6807\u7b7e",
        "\u6761\u76eeid", "sid", "\u72b6\u6001", "status", "rate",
        "\u756a\u5267", "\u52a8\u753b", "\u4e66", "\u540d\u5b57", "\u94fe\u63a5",
        "\u89c2\u770b\u72b6\u6001", "\u6536\u85cf\u7c7b\u578b", "\u7ae0\u8282\u72b6\u6001", "\u540c\u6b65\u72b6\u6001",
        "\u5b8c\u64ad\u65e5", "\u7279\u70b9", "\u5370\u8c61", "\u5173\u8054\u7684\u52a8\u6f2b"
    ];

    // \u5B9A\u4E49\u5173\u952E\u5217\uFF08\u9884\u89C8\u65F6\u9AD8\u4EAE\u663E\u793A\uFF09
    let importantCols = {
        "\u540d\u79f0": true, "\u662f\u5426\u770b\u5b8c": true, "bangumi url": true,
        "url": true, "\u6253\u5206": true, "\u96c6\u6570": true, "\u611f\u8a00": true,
        "\u5267\u900f/\u611f\u8a00": true, "\u7c7b\u578b": true, "\u72b6\u6001": true,
        "status": true, "rate": true, "\u522b\u540d": true
    };

    // 诊断：测试 readCell 是否能读取数据，非活动表时临时激活
    let originalActiveSheet = null;
    let needRestore = false;
    try {
        let testVal = readCell(ws, 1, 1);
        bgmLog(LOG_LEVELS.INFO, "refreshData: ws.Name=" + sheetName + ", readCell(1,1)='" + testVal + "'");
        if (!testVal) {
            try {
                let activeWs = app.ActiveWorkbook.ActiveSheet;
                let activeName = "";
                try { activeName = activeWs.Name; } catch (_) {}
                originalActiveSheet = activeWs;
                bgmLog(LOG_LEVELS.INFO, "refreshData: 非活动表读取失败，临时激活 " + sheetName + " (current=" + activeName + ")");
                try { ws.Activate(); } catch (_) {}
                needRestore = true;
                testVal = readCell(ws, 1, 1);
                bgmLog(LOG_LEVELS.INFO, "refreshData: 激活后 readCell(1,1)='" + testVal + "'");
            } catch (e2) {
                bgmLog(LOG_LEVELS.WARN, "refreshData: 激活失败: " + e2.message);
            }
        }
    } catch (_) {}

    // 检测筛选状态，获取可见行集合（用于跳过隐藏行）
    let visibleRowSet = null;
    let isFiltered = false;
    try {
        // 兼容 WPS：使用 AutoFilterMode 属性检测（与 updateFilterStatus 一致）
        let autoFilterMode = false;
        try { autoFilterMode = !!ws.AutoFilterMode; } catch (_) {}
        try { if (!autoFilterMode && ws.AutoFilter) autoFilterMode = !!ws.AutoFilter.Mode; } catch (_) {}
        
        bgmLog(LOG_LEVELS.INFO, "refreshData: AutoFilterMode=" + autoFilterMode);
        
        if (autoFilterMode) {
            isFiltered = true;
            let filterStartRow = 1;
            let autoFilter = null;
            try {
                autoFilter = ws.AutoFilter;
                if (autoFilter && autoFilter.Range) filterStartRow = autoFilter.Range.Row;
            } catch (_) {}
            
            // 检测实际最后行
            let lastRow = 200;
            try { lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row; } catch (_) {}
            if (lastRow < 10) lastRow = 200;
            let scanEndRow = Math.min(filterStartRow + lastRow + 20, 5000);
            
            visibleRowSet = new Set();
            
            // 方法1：SpecialCells(12) = xlCellTypeVisible
            try {
                let filterRangeStr = "A" + filterStartRow + ":A" + scanEndRow;
                let visibleCells = ws.Range(filterRangeStr).SpecialCells(12);
                if (visibleCells) {
                    let areas = visibleCells.Areas;
                    for (let a = 1; a <= areas.Count; a++) {
                        let area = areas.Item(a);
                        for (let r = 1; r <= area.Rows.Count; r++) {
                            visibleRowSet.add(area.Rows.Item(r).Row);
                        }
                    }
                }
                bgmLog(LOG_LEVELS.INFO, "refreshData: SpecialCells 找到可见行=" + visibleRowSet.size);
            } catch (e) {
                bgmLog(LOG_LEVELS.WARN, "refreshData: SpecialCells 失败: " + e.message);
            }
            
            // 方法2：逐行检查 Hidden 属性
            if (visibleRowSet.size === 0) {
                let visibleCount = 0, hiddenCount = 0;
                for (let r = filterStartRow; r <= scanEndRow; r++) {
                    try {
                        let hidden = false;
                        try { hidden = ws.Rows(r).Hidden; } catch (_) {}
                        try { if (!hidden) hidden = ws.Rows.Item(r).Hidden; } catch (_) {}
                        if (hidden === true) {
                            hiddenCount++;
                        } else {
                            visibleRowSet.add(r);
                            visibleCount++;
                        }
                    } catch (_) {
                        visibleRowSet.add(r);
                        visibleCount++;
                    }
                }
                bgmLog(LOG_LEVELS.INFO, "refreshData: Hidden逐行扫描 visible=" + visibleCount + " hidden=" + hiddenCount);
            }
            
            bgmLog(LOG_LEVELS.INFO, "refreshData: 筛选已开启, 可见行数=" + visibleRowSet.size + ", scanRange=" + filterStartRow + "-" + scanEndRow);
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "refreshData: 筛选检测异常: " + e.message);
    }

    function isRowVisible(r) {
        return !isFiltered || (visibleRowSet && visibleRowSet.has(r));
    }

    function isRowVisible(r) {
        return !isFiltered || (visibleRowSet && visibleRowSet.has(r));
    }

    try {
        // 扫描前10行，每行扫全部列（列数无限制），找匹配关键词最多的行作为表头
        let headerCandidates = [];
        for (let r = 1; r <= 10; r++) {
            if (!isRowVisible(r)) continue;
            let matchCount = 0;
            let colCount = 0;
            for (let c = 1; c <= 60; c++) {
                let cellVal = readCell(ws, r, c).trim();
                if (cellVal) {
                    colCount++;
                    let cv = cellVal.toLowerCase();
                    if (scanKeywords.some(kw => cv === kw || cv.includes(kw))) {
                        matchCount++;
                    }
                }
            }
            if (matchCount >= 3) {
                headerCandidates.push({ row: r, matchCount, colCount });
            }
        }
        // 选列数最多的作为表头行；列数相同则选行号最小的（真正的表头在数据前面）
        if (headerCandidates.length > 0) {
            headerCandidates.sort((a, b) => b.colCount - a.colCount || a.row - b.row);
            foundHeaderRow = headerCandidates[0].row;
            bgmLog(LOG_LEVELS.INFO, "refreshData: 找到表头 行" + foundHeaderRow +
                ", 匹配" + headerCandidates[0].matchCount + "个关键词, " + headerCandidates[0].colCount + "列" +
                (headerCandidates.length > 1 ? " (其他候选: " + headerCandidates.slice(1).map(c => "行" + c.row + "(" + c.colCount + "列)").join(", ") + ")" : ""));
        }

        // 调试：如果未找到，输出前几个可见行的内容
        if (!foundHeaderRow) {
            let diagRows = [];
            let diagLimit = 0;
            for (let r = 1; r <= 50 && diagLimit < 5; r++) {
                if (!isRowVisible(r)) continue;
                diagLimit++;
                let vals = [];
                for (let c = 1; c <= 60; c++) {
                    let v = readCell(ws, r, c).trim();
                    if (v) vals.push("C" + c + "='" + v + "'");
                }
                diagRows.push("R" + r + ": {" + vals.join(", ") + "}");
            }
            bgmLog(LOG_LEVELS.WARN, "refreshData: 未找到表头, 可见行内容: " + diagRows.join(" | "));
        }

        if (foundHeaderRow > 0) {
            // 检测多行表头
            let headerNames = [];
            let headerIsImportant = [];
            let actualDataStartRow = foundHeaderRow + 1;

            for (let c = 1; c <= 60; c++) {
                let v = readCell(ws, foundHeaderRow, c).trim();
                headerNames.push(v);
                headerIsImportant.push(importantCols[v.toLowerCase()] || false);
            }

            // 检查下一行是否也是表头的一部分
            let nextRowFilledEmptyCol = 0;
            let nextRowTotalNonEmpty = 0;
            if (foundHeaderRow + 1 <= 100) {
                for (let c = 1; c <= 60; c++) {
                    let nv = readCell(ws, foundHeaderRow + 1, c).trim();
                    if (!nv) continue;
                    nextRowTotalNonEmpty++;
                    if (!headerNames[c - 1]) nextRowFilledEmptyCol++;
                }
            }

            if (nextRowFilledEmptyCol >= 3 && nextRowTotalNonEmpty >= 3) {
                actualDataStartRow = foundHeaderRow + 2;
                for (let c = 1; c <= 60; c++) {
                    if (!headerNames[c - 1]) {
                        let nv = readCell(ws, foundHeaderRow + 1, c).trim();
                        if (nv) {
                            headerNames[c - 1] = nv;
                            headerIsImportant[c - 1] = importantCols[nv.toLowerCase()] || false;
                        }
                    }
                }
                bgmLog(LOG_LEVELS.INFO, "refreshData: 检测到多行表头, dataStart=" + actualDataStartRow +
                    ", filledEmpty=" + nextRowFilledEmptyCol + " totalNonEmpty=" + nextRowTotalNonEmpty);
            }

            // 检测表头结束列
            let headerLastCol = 0;
            for (let c = 0; c < headerNames.length; c++) {
                if (headerNames[c]) headerLastCol = c + 1;
            }

            // 检测数据行的起始列和结束列
            let dataFirstCol = -1;
            let dataLastCol = 0;
            let sampleRows = 0;
            for (let dr = actualDataStartRow; dr <= actualDataStartRow + 20 && sampleRows < 5; dr++) {
                if (!isRowVisible(dr)) continue;
                sampleRows++;
                for (let c = 1; c <= 60; c++) {
                    let v = readCell(ws, dr, c).trim();
                    if (v) {
                        if (dataFirstCol < 0) dataFirstCol = c;
                        if (c > dataLastCol) dataLastCol = c;
                    }
                }
            }
            if (dataFirstCol < 0) dataFirstCol = 1;
            let displayFirstCol = Math.max(1, dataFirstCol - 5);
            for (let c = displayFirstCol; c <= Math.min(dataFirstCol, headerNames.length); c++) {
                if (headerNames[c - 1]) {
                    displayFirstCol = c - 1;
                    break;
                }
            }
            let realDataColCount = Math.max(dataLastCol, headerLastCol);
            if (realDataColCount > headerLastCol + 5) {
                realDataColCount = headerLastCol;
            }

            bgmLog(LOG_LEVELS.INFO, "refreshData: 数据列范围 " + dataFirstCol + "-" + dataLastCol +
                ", 显示范围 col" + (displayFirstCol + 1) + "-" + realDataColCount);

            // 添加表头行到预览
            previewRows.push({ row: -1, cols: headerNames.slice(displayFirstCol, realDataColCount), isHeader: true, aligned: true, isImportant: headerIsImportant.slice(displayFirstCol, realDataColCount) });

            // 读取数据行
            let displayColCount = realDataColCount - displayFirstCol;
            for (let dr = actualDataStartRow; dr <= actualDataStartRow + PREVIEW_LIMIT + 20 && dr <= 1000; dr++) {
                if (!isRowVisible(dr)) continue;
                let rowCols = [];
                let hasAnyContent = false;
                for (let c = 0; c < displayColCount; c++) {
                    let v = readCell(ws, dr, displayFirstCol + c + 1).trim();
                    if (v) hasAnyContent = true;
                    rowCols.push(v);
                }
                if (hasAnyContent) {
                    previewRows.push({ row: dr, cols: rowCols, isHeader: false, aligned: true });
                    hasData = true;
                    if (previewRows.filter(p => !p.isHeader).length >= PREVIEW_LIMIT) break;
                }
            }
        } else {
            // 完全找不到表头，显示前几个可见行原始内容
            let fallbackLimit = 0;
            for (let r = 1; r <= 100 && fallbackLimit < 5; r++) {
                if (!isRowVisible(r)) continue;
                fallbackLimit++;
                let rowCols = [];
                let hasAnyContent = false;
                for (let c = 1; c <= 60; c++) {
                    let v = readCell(ws, r, c).trim();
                    if (v) {
                        rowCols.push({ text: v, important: false });
                        hasAnyContent = true;
                    }
                }
                if (hasAnyContent) {
                    previewRows.push({ row: r, cols: rowCols, isHeader: false });
                    hasData = true;
                }
            }
        }
        } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "refreshData \u8BFB\u53D6\u9884\u89C8\u6570\u636E\u51FA\u9519: " + e.message);
    }

    // \u81EA\u52A8\u9501\u5B9A\u903B\u8F91\uFF1A\u5982\u679C\u627E\u5230\u6570\u636E\u4E14\u672A\u9501\u5B9A\uFF0C\u81EA\u52A8\u9501\u5B9A
    if (hasData && !BGM.sheet.isLocked) {
        BGM.sheet.lockedIndex = sheetIndex;
        BGM.sheet.lockedName = sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: sheetIndex, name: sheetName });
        updateLockButton();
        // \u540C\u6B65\u4E0B\u62C9\u6846\u9009\u4E2D\u72B6\u6001
        if (select) {
            select.value = sheetIndex;
        }
        showToast("\u5DF2\u81EA\u52A8\u9501\u5B9A\u5DE5\u4F5C\u8868: " + sheetName, "info");
        bgmLog(LOG_LEVELS.INFO, "refreshData: \u5DF2\u81EA\u52A8\u9501\u5B9A " + sheetName + " (index=" + sheetIndex + ")");
    }

    // \u6E32\u67D3\u9884\u89C8
    if (previewBox) {
        if (previewRows.length > 0) {
            let html = '<table class="preview-table"><tbody>';
            previewRows.forEach(item => {
                let rowClass = item.isHeader ? 'preview-header-row' : '';
                html += '<tr class="' + rowClass + '">';
                html += '<td class="preview-row-num">' + (item.isHeader ? 'H' : item.row) + '</td>';
                if (item.aligned) {
                    // 对齐模式：每列对应一个固定位置，只跳过尾部连续空列
                    let lastNonEmpty = -1;
                    for (let i = item.cols.length - 1; i >= 0; i--) {
                        if (item.cols[i]) { lastNonEmpty = i; break; }
                    }
                    let colLimit = lastNonEmpty + 1;
                    for (let i = 0; i < colLimit; i++) {
                        let text = item.cols[i] || '';
                        let cls = '';
                        if (item.isHeader) {
                            cls = 'preview-header';
                            if (item.isImportant && item.isImportant[i]) cls += ' preview-important-header';
                        }
                        html += '<td class="' + cls + '">' + escapeHtml(String(text)) + '</td>';
                    }
                } else {
                    // 旧模式：只显示非空列
                    item.cols.forEach((col) => {
                        let text = col.text || col;
                        let important = col.important || false;
                        let cls = '';
                        if (item.isHeader) {
                            cls = 'preview-header';
                            if (important) cls += ' preview-important-header';
                        } else if (important) {
                            cls = 'preview-important';
                        }
                        html += '<td class="' + cls + '">' + (typeof text === 'string' ? text : escapeHtml(String(text))) + '</td>';
                    });
                }
                html += '</tr>';
            });
            html += '</tbody></table>';
            html += '<p class="hint">\u5DF2\u9009\u62E9\u5DE5\u4F5C\u8868\u7D22\u5F15: ' + sheetIndex;
            if (sheetName) html += ' (' + escapeHtml(sheetName) + ')';
            if (foundHeaderRow) html += ' | \u8868\u5934\u884C: ' + foundHeaderRow;
            html += '</p>';
            previewBox.innerHTML = html;
        } else {
            previewBox.innerHTML = '<p class="hint">\u5DF2\u9009\u62E9\u5DE5\u4F5C\u8868\u7D22\u5F15: ' + sheetIndex;
            if (sheetName) previewBox.innerHTML += ' (' + escapeHtml(sheetName) + ')';
            previewBox.innerHTML += '<br>\u672A\u68C0\u6D4B\u5230\u6570\u636E\uFF0C\u8BF7\u786E\u4FDD\u8868\u5934\u5305\u542B\u201C\u540D\u79F0\u201D\u7B49\u5173\u952E\u8BCD</p>';
        }
    }

    // 恢复原活动表（如果临时激活了其他表）
    if (needRestore && originalActiveSheet) {
        try {
            originalActiveSheet.Activate();
            bgmLog(LOG_LEVELS.INFO, "refreshData: 已恢复活动表");
        } catch (_) {}
    }

    updateFilterStatus(ws);
    bgmLog(LOG_LEVELS.INFO, "refreshData \u6267\u884C\u5B8C\u6210, hasData=" + hasData + ", previewRows=" + previewRows.length);
}

/**
 * 模式切换处理
 */
function onSelectModeChange() {
    let manualInputs = document.getElementById("manualRangeInputs");
    let autoInfo = document.getElementById("autoRangeInfo");
    let modeRadios = document.querySelectorAll('input[name="selectMode"]');
    
    for (let radio of modeRadios) {
        if (radio.checked) {
            if (radio.value === "manual") {
                manualInputs.style.display = "block";
                autoInfo.style.display = "none";
            } else {
                manualInputs.style.display = "none";
                autoInfo.style.display = "block";
            }
            break;
        }
    }
}

// ========== 初始化 ==========
/**
 * 面板初始化
 */
function initPanel() {
    bgmLog(LOG_LEVELS.INFO, "initPanel \u5F00\u59CB");

    // 检查枚举
    if (typeof window.Application.Enum !== "object") {
        window.Application.Enum = WPS_Enum;
        bgmLog(LOG_LEVELS.DEBUG, "initPanel: \u5DF2\u8BBE\u7F6E WPS_Enum");
    }

    // 初始化消息监听
    initMessageListener();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: \u6D88\u606F\u76D1\u542C\u5DF2\u521D\u59CB\u5316");

    // 恢复锁定的工作表缓存
    let restored = restoreLockedSheet();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: \u5DE5\u4F5C\u8868\u9501\u5B9A\u6062\u590D=" + restored);

    // 初始化工作表列表（会自动选中锁定的工作表）
    refreshSheets();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: \u5DE5\u4F5C\u8868\u5217\u8868\u5DF2\u5237\u65B0");

    // 每次启动都重新自动检测最佳工作表（避免旧锁定缓存指向无效表）
    let detected = autoDetectSheet();
    if (detected) {
        let select = document.getElementById("sheetSelect");
        if (select) {
            select.value = detected.sheetIndex;
        }
        BGM.sheet.lockedIndex = detected.sheetIndex;
        BGM.sheet.lockedName = detected.sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: detected.sheetIndex, name: detected.sheetName });
        updateLockButton();
        bgmLog(LOG_LEVELS.INFO, "initPanel: \u81EA\u52A8\u8BC6\u522B\u5230\u6570\u636E\u8868 " + detected.sheetName +
            " (\u5339\u914D" + detected.matchCount + "\u4E2A\u5173\u952E\u8BCD\uFF0C\u8868\u5934\u7B2C" + detected.headerRow + "\u884C, " + detected.colCount + "\u5217)");
        refreshData();
    } else {
        // 未检测到有效数据表，尝试使用恢复的锁定表
        if (restored && BGM.sheet.isLocked) {
            let select = document.getElementById("sheetSelect");
            if (select) select.value = BGM.sheet.lockedIndex;
            refreshData();
        }
    }

    // 更新状态显示
    updateTokenStatus();
    updateUserIdStatus();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: Token/\u7528\u6237ID \u72B6\u6001\u5DF2\u66F4\u65B0");

    // 绑定工作表选择事件
    let sheetSelect = document.getElementById("sheetSelect");
    if (sheetSelect) {
        sheetSelect.addEventListener("change", () => {
            BGM.sheet.lockedIndex = null;
            BGM.sheet.lockedName = null;
            BGM.sheet.isLocked = false;
            saveLockedSheet(null);  // 手动切换工作表时清除锁定缓存
            updateLockButton();
            refreshData();
        });
    }

    // 绑定刷新数据按钮（通过 onclick 机制已处理）
    // refreshBtn 已在 HTML 中通过 onclick 绑定，无需重复绑定
    
    // 绑定模式切换
    let modeRadios = document.querySelectorAll('input[name="selectMode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener("change", onSelectModeChange);
    });

    // 绑定预览过滤（HTML中无detailFilter元素，跳过）
    
    // 绑定关闭详情模态框（通过 onclick 机制已处理）
    // closeDetailModal 已在 HTML 中通过 onclick 绑定，无需重复绑定
    
    // 绑定键盘事件
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeDetailModal();
            closeInputDialog();
            closeConfirmDialog();
        }
    });

    // 通知 HTML 模块已就绪，启用按钮
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'));

    bgmLog(LOG_LEVELS.INFO, "initPanel \u5B8C\u6210");
}

/**
 * 获取 BGM 收藏数据（委托给 handlers.js 增强版）
 */
function fetchBgCollectionRecords() {
    if (typeof window.syncCollectionFromBgm === 'function') {
        // 委托给 handlers.js 的增强版（会触发完整交互流程）
        window.syncCollectionFromBgm();
    } else {
        showAlert("\u8BF7\u5148\u8BBE\u7F6E Token\uFF01");
    }
}

/**
 * 清除同步记录
 * 实际实现在 syncRecord.js 中，这里作为转发入口
 */
function clearSyncRecords() {
    if (typeof _clearSyncRecords === 'function') {
        _clearSyncRecords();
    } else {
        showAlert("\u6E05\u9664\u540C\u6B65\u8BB0\u5F55\u529F\u80FD\u672A\u52A0\u8F7D");
    }
}

/**
 * 获取当前用户选择的工作表名称
 * 优先返回锁定的工作表名，其次返回下拉框选中的工作表名
 */
function getSelectedSheetName() {
    if (BGM.sheet.isLocked && BGM.sheet.lockedName) {
        return BGM.sheet.lockedName;
    }
    let select = document.getElementById('sheetSelect');
    if (select && select.selectedIndex > 0) {
        return select.options[select.selectedIndex].text;
    }
    return null;
}

/**
 * 标记已上传条目（当前选择的工作表）
 */
function markUploadedItemsDefault() {
    let sheetName = getSelectedSheetName();
    if (!sheetName) {
        showAlert('\u8BF7\u5148\u9009\u62E9\u5DE5\u4F5C\u8868！');
        return;
    }
    markUploadedItems(sheetName);
}

/**
 * 清除工作表标记（当前选择的工作表）
 */
function clearSheetMarksDefault() {
    let sheetName = getSelectedSheetName();
    if (!sheetName) {
        showAlert('\u8BF7\u5148\u9009\u62E9\u5DE5\u4F5C\u8868！');
        return;
    }
    clearSheetMarks(sheetName);
}

// ========== 导出函数 ==========
export {
    initPanel,
    refreshSheets,
    refreshData,
    toggleSheetLock,
    onSelectModeChange,
    fetchBgCollectionRecords,
    clearSyncRecords,
    markUploadedItems,
    markUploadedItemsDefault,
    clearSheetMarks,
    clearSheetMarksDefault,
    autoDetectSheet,
    updateFilterStatus
};

// ========== 挂载到 window（向后兼容）==========
window.onload = initPanel;
window.initPanel = initPanel;
window.refreshSheets = refreshSheets;
window.refreshData = refreshData;
window.toggleSheetLock = toggleSheetLock;
window.onSelectModeChange = onSelectModeChange;
window.fetchBgCollectionRecords = fetchBgCollectionRecords;
window.clearSyncRecords = clearSyncRecords;
window.markUploadedItemsDefault = markUploadedItemsDefault;
window.clearSheetMarksDefault = clearSheetMarksDefault;

// 导出全局函数别名（仅挂载 handlers.js/dialog.js 未覆盖的函数）
window.previewSyncContent = previewSyncContent;
window.closeDetailModal = closeDetailModal;
window.showAlertDialog = showAlert;  // 兼容别名
window.closeAlertDialog = closeAlertDialog;
window.showToast = showToast;
window.showTokenDialog = showTokenDialog;
window.showUserIdDialog = showUserIdDialog;
