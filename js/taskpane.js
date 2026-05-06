/**
 * 任务面板主模块
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑
 */

import { BGM, BGM_CONFIG } from './util.js';
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
 * 更新筛选状态显示
 */
function updateFilterStatus() {
    let filterStatusEl = document.getElementById("filterStatus");
    if (!filterStatusEl) return;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        filterStatusEl.textContent = "\u672A\u8FDE\u63A5\u5230 Excel\uFF08\u8C03\u8BD5\u6A21\u5F0F\u4E0B\u4E0D\u53EF\u7528\uFF09";
        bgmLog(LOG_LEVELS.WARN, "updateFilterStatus: Application \u4E0D\u53EF\u7528");
        return;
    }

    let ws = app.ActiveWorkbook.ActiveSheet;
    if (!ws) {
        filterStatusEl.textContent = "\u672A\u627E\u5230\u5DE5\u4F5C\u8868";
        bgmLog(LOG_LEVELS.WARN, "updateFilterStatus: ActiveSheet \u4E3A\u7A7A");
        return;
    }

    try {
        if (ws.AutoFilterMode) {
            let filters = ws.AutoFilter.Filters;
            if (filters && typeof filters.Count !== 'undefined') {
                let activeCount = 0;
                for (let i = 1; i <= filters.Count; i++) {
                    try {
                        let f = filters.Item(i);
                        if (f && f.On) activeCount++;
                    } catch (_) { /* \u8DF3\u8FC7\u65E0\u6548\u7B5B\u9009 */ }
                }
                if (activeCount > 0) {
                    filterStatusEl.textContent = "\u2714 \u7B5B\u9009\u5DF2\u5F00\u542F\uFF08" + activeCount + " \u5217\uFF09\uFF0C\u5C06\u540C\u6B65\u7B5B\u9009\u540E\u7684\u53EF\u89C1\u6570\u636E";
                    bgmLog(LOG_LEVELS.INFO, "updateFilterStatus: \u7B5B\u9009\u5DF2\u5F00\u542F, activeColumns=" + activeCount);
                } else {
                    filterStatusEl.textContent = "\u7B5B\u9009\u5DF2\u5F00\u542F\u4F46\u65E0\u6D3B\u52A8\u7B5B\u9009\uFF0C\u540C\u6B65\u5168\u90E8\u6570\u636E";
                    bgmLog(LOG_LEVELS.INFO, "updateFilterStatus: AutoFilter \u5DF2\u5F00\u542F\u4F46\u65E0\u6D3B\u52A8\u7B5B\u9009");
                }
                return;
            }
        }
        filterStatusEl.textContent = "\u672A\u5F00\u542F\u7B5B\u9009\uFF0C\u540C\u6B65\u5168\u90E8\u6570\u636E";
        bgmLog(LOG_LEVELS.INFO, "updateFilterStatus: \u672A\u5F00\u542F\u7B5B\u9009");
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
        try {
            let v = ws.Cells(row, col).Value;
            if (typeof v === 'function') v = v();
            if (v !== null && v !== undefined && v !== '') return String(v);
        } catch (_) {}
        try {
            let cell = ws.Cells.Item(row, col);
            if (cell) {
                let v = cell.Value;
                if (typeof v === 'function') v = v();
                if (v !== null && v !== undefined && v !== '') return String(v);
            }
        } catch (_) {}
        try {
            let colLetter = String.fromCharCode(64 + col);
            let cell2 = ws.Range(colLetter + row);
            if (cell2) {
                let v = cell2.Value;
                if (typeof v === 'function') v = v();
                if (v !== null && v !== undefined && v !== '') return String(v);
            }
        } catch (_) {}
        // 备用4: 通过 UsedRange 读取（解决非活动表读取失败问题）
        try {
            let usedRange = ws.UsedRange;
            if (usedRange) {
                let rIdx = row - usedRange.Row;
                let cIdx = col - usedRange.Column;
                if (rIdx >= 0 && rIdx < usedRange.Rows.Count && cIdx >= 0 && cIdx < usedRange.Columns.Count) {
                    let cell = usedRange.Cells.Item(rIdx + 1, cIdx + 1);
                    if (cell) {
                        let v = cell.Value;
                        if (typeof v === 'function') v = v();
                        if (v !== null && v !== undefined && v !== '') return String(v);
                    }
                }
            }
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

    try {
        // 扫描前 50 行找表头（筛选模式下只扫描可见行）
        let rowsToScan = [];
        if (isFiltered && visibleRowSet) {
            for (let r = 1; r <= 50; r++) {
                if (visibleRowSet.has(r)) rowsToScan.push(r);
            }
        } else {
            for (let r = 1; r <= 50; r++) rowsToScan.push(r);
        }

        for (let ri = 0; ri < rowsToScan.length; ri++) {
            let r = rowsToScan[ri];
            let matchCount = 0;
            let matchedCol = 0;
            for (let c = 1; c <= 35; c++) {
                let cellVal = readCell(ws, r, c).trim().toLowerCase();
                if (!cellVal) continue;
                if (scanKeywords.some(kw => cellVal === kw || cellVal.includes(kw))) {
                    matchCount++;
                    matchedCol = c;
                    if (matchCount >= 3) break; // 匹配到 3 个关键词就确认是表头行
                }
            }
            if (matchCount >= 3) {
                foundHeaderRow = r;
                bgmLog(LOG_LEVELS.INFO, "refreshData: 找到表头 行" + r + ", 匹配" + matchCount + "个关键词");
                break;
            }
        }

        // 调试：如果未找到，输出前几个可见行的内容
        if (!foundHeaderRow) {
            let diagRows = [];
            let diagLimit = 0;
            for (let r = 1; r <= 50 && diagLimit < 5; r++) {
                if (!isRowVisible(r)) continue;
                diagLimit++;
                let vals = [];
                for (let c = 1; c <= 35; c++) {
                    let v = readCell(ws, r, c).trim();
                    if (v) vals.push("C" + c + "='" + v + "'");
                }
                diagRows.push("R" + r + ": {" + vals.join(", ") + "}");
            }
            bgmLog(LOG_LEVELS.WARN, "refreshData: 未找到表头, 可见行内容: " + diagRows.join(" | "));
        }

        if (foundHeaderRow > 0) {
            // 读取表头行，记录各列名称和重要性
            let headerNames = [];
            let headerIsImportant = [];
            for (let c = 1; c <= 35; c++) {
                let v = readCell(ws, foundHeaderRow, c).trim();
                headerNames.push(v);
                headerIsImportant.push(importantCols[v.toLowerCase()] || false);
            }

            // 添加表头行到预览
            let headerCols = [];
            for (let c = 0; c < headerNames.length; c++) {
                if (headerNames[c]) headerCols.push({ text: headerNames[c], important: headerIsImportant[c] });
            }
            if (headerCols.length > 0) {
                previewRows.push({ row: -1, cols: headerCols, isHeader: true });
            }

            // 读取数据行（只读取有表头的列，跳过隐藏行）
            let dataColCount = 0;
            for (let c = 0; c < headerNames.length; c++) {
                if (headerNames[c]) dataColCount = c + 1;
            }

            for (let dr = foundHeaderRow + 1; dr <= foundHeaderRow + PREVIEW_LIMIT + 20 && dr <= 1000; dr++) {
                if (!isRowVisible(dr)) continue;
                let rowCols = [];
                let hasAnyContent = false;
                for (let c = 0; c < dataColCount; c++) {
                    let v = readCell(ws, dr, c + 1).trim();
                    if (v) {
                        rowCols.push({ text: v, important: headerIsImportant[c] });
                        hasAnyContent = true;
                    }
                }
                if (hasAnyContent) {
                    previewRows.push({ row: dr, cols: rowCols, isHeader: false });
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
                for (let c = 1; c <= 35; c++) {
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

    updateFilterStatus();
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

    // 初始化工作表列表
    refreshSheets();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: \u5DE5\u4F5C\u8868\u5217\u8868\u5DF2\u5237\u65B0");

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
    clearSheetMarksDefault
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
