/**
 * 任务面板主模块
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑
 */
import { BGM, PANEL_CONFIG, WPS_Enum } from './util.js';
import { getApp, bgmLog, LOG_LEVELS, escapeHtml, readCell, colNumToLetter } from './util.js';
import { HEADER_KEYWORDS, IMPORTANT_COLS } from './sync/exceltobangumi.js';
import { initMessageListener } from './ui/message.js';
import { markUploadedItems, clearSheetMarks, updateTokenStatus, updateUserIdStatus, showTokenDialog, showUserIdDialog } from './ui/handlers.js';
import { showAlert, closeAlertDialog, closeInputDialog, closeConfirmDialog, showToast } from './ui/dialog.js';
import { previewSyncContent, closeDetailModal } from './ui/preview.js';
import { clearSyncRecords as _clearSyncRecords } from './sync/syncRecord.js';
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
    if (!select)
        return;
    const sheetIndex = parseInt(select.value, 10);
    // 修复：防止 NaN 索引
    if (isNaN(sheetIndex) || sheetIndex <= 0) {
        showToast("请先选择一个有效的工作表", "warn");
        return;
    }
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === sheetIndex) {
        BGM.sheet.lockedIndex = null;
        BGM.sheet.lockedName = null;
        BGM.sheet.isLocked = false;
        saveLockedSheet(null); // 清除缓存
        showToast("已解锁工作表", "info");
    }
    else {
        let sheetName = select.options[select.selectedIndex]?.text || "";
        BGM.sheet.lockedIndex = sheetIndex;
        BGM.sheet.lockedName = sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: sheetIndex, name: sheetName }); // 写入缓存
        showToast("已锁定工作表: " + sheetName, "info");
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
                // 修复：index 可能为 0（避免被 || 误判为 falsy）
                BGM.sheet.lockedIndex = (info.index != null) ? info.index : null;
                BGM.sheet.lockedName = info.name || null;
                BGM.sheet.isLocked = !!(info.index != null && info.name);
                return true;
            }
            catch (e) {
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
            btn.textContent = "🔓 解锁";
            btn.classList.add("locked");
        }
        else {
            btn.textContent = "🔒 锁定";
            btn.classList.remove("locked");
        }
    }
    if (status) {
        if (BGM.sheet.isLocked) {
            status.style.display = "inline";
            status.textContent = "已锁定: " + BGM.sheet.lockedName;
        }
        else {
            status.style.display = "none";
        }
    }
}
/**
 * 刷新工作表列表
 */
function refreshSheets() {
    let select = document.getElementById("sheetSelect");
    if (!select)
        return;
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        console.warn("refreshSheets: 无法获取 ActiveWorkbook");
        return;
    }
    let sheets = app.ActiveWorkbook.Worksheets;
    select.innerHTML = '<option value="">-- 请选择 --</option>';
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
 * 临时激活工作表，返回恢复函数（或 false 表示未需激活）
 * @param {object} ws - 要激活的工作表
 * @returns {Function|boolean} 恢复函数或 false
 */
function activateSheetIfNeeded(ws) {
    const app = getApp();
    if (!app)
        return false;
    try {
        const active = app.ActiveWorkbook.ActiveSheet;
        const activeName = active.Name || "";
        if (activeName !== ws.Name) {
            ws.Activate();
            return function restore() {
                try {
                    active.Activate();
                }
                catch (_) { }
            };
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, "activateSheetIfNeeded 失败: " + e.message);
    }
    return false;
}
/**
 * 扫描工作表，找出最佳表头行、实际数据起始行、列宽等元信息
 * @param {object} ws - 工作表对象
 * @param {object} [opts] - 可选配置
 * @param {Set|null} [opts.visibleRowSet] - 筛选模式下的可见行集合
 * @param {boolean} [opts.isFiltered=false] - 是否启用了筛选
 * @returns {{
 *   headerRow: number,
 *   headerNames: string[],
 *   isImportant: boolean[],
 *   dataStartRow: number,
 *   lastCol: number,
 *   firstDataCol: number,
 *   previewColStart: Math.max(0, Math.min(previewColStart - 1, headerNames.length)),
 *   previewColEnd: number,
 *   headerMatchCount: number
 * }}
 */
function detectHeaderAndColumns(ws, opts = {}) {
    const { visibleRowSet = null, isFiltered = false } = opts;
    // 判断某行是否可见
    function isRowVisible(r, headerRow) {
        if (r === headerRow)
            return true;
        return !isFiltered || (visibleRowSet && visibleRowSet.has(r));
    }
    // 1. 扫描前 MAX_SCAN_ROWS 行，找出所有候选表头行
    const candidates = [];
    for (let r = 1; r <= PANEL_CONFIG.MAX_SCAN_ROWS; r++) {
        if (!isFiltered || !visibleRowSet || visibleRowSet.has(r)) {
            let matchCount = 0;
            let colCount = 0;
            for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
                const v = readCell(ws, r, c).trim();
                if (v) {
                    colCount++;
                    const cv = v.toLowerCase();
                    if (HEADER_KEYWORDS.some(kw => cv === kw || cv.includes(kw))) {
                        matchCount++;
                    }
                }
            }
            if (matchCount >= 3) {
                candidates.push({ row: r, matchCount, colCount });
            }
        }
    }
    if (candidates.length === 0) {
        return {
            headerRow: 0,
            headerNames: [],
            isImportant: [],
            dataStartRow: 0,
            lastCol: 0,
            firstDataCol: 0,
            previewColStart: 0,
            previewColEnd: 0,
            headerMatchCount: 0
        };
    }
    // 选列数最多、行号最小的作为表头
    candidates.sort((a, b) => b.colCount - a.colCount || a.row - b.row);
    const headerRow = candidates[0].row;
    const headerMatchCount = candidates[0].matchCount;
    // 2. 读取表头名称
    const headerNames = [];
    const headerIsImportant = [];
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
        const v = readCell(ws, headerRow, c).trim();
        headerNames.push(v);
        headerIsImportant.push(IMPORTANT_COLS[v.toLowerCase()] || false);
    }
    // 3. 检测多行表头（下一行是否填充了当前表头的空列）
    let dataStartRow = headerRow + 1;
    // 修复：使用配置常量替代硬编码 100
    const secondHeaderRowLimit = Math.min(headerRow + 1, PANEL_CONFIG.MAX_SCAN_ROWS);
    if (headerRow + 1 <= secondHeaderRowLimit) {
        let filled = 0, total = 0;
        for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
            const nv = readCell(ws, headerRow + 1, c).trim();
            if (nv) {
                total++;
                if (!headerNames[c - 1])
                    filled++;
            }
        }
        if (filled >= 3 && total >= 3) {
            dataStartRow = headerRow + 2;
            for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
                if (!headerNames[c - 1]) {
                    const nv = readCell(ws, headerRow + 1, c).trim();
                    if (nv) {
                        headerNames[c - 1] = nv;
                        headerIsImportant[c - 1] = IMPORTANT_COLS[nv.toLowerCase()] || false;
                    }
                }
            }
        }
    }
    // 4. 计算实际使用的列范围（数据列）
    let firstDataCol = -1;
    let lastDataCol = 0;
    let samples = 0;
    for (let dr = dataStartRow; dr <= dataStartRow + 20 && samples < 5; dr++) {
        if (!isRowVisible(dr, headerRow))
            continue;
        samples++;
        for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
            const v = readCell(ws, dr, c).trim();
            if (v) {
                if (firstDataCol < 0)
                    firstDataCol = c;
                if (c > lastDataCol)
                    lastDataCol = c;
            }
        }
    }
    if (firstDataCol < 0)
        firstDataCol = 1;
    // 表头结束列
    let headerLastCol = 0;
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
        if (headerNames[c - 1])
            headerLastCol = c;
    }
    const actualLastCol = Math.max(lastDataCol, headerLastCol);
    // 预览显示的列范围：从第一个数据列左扩找到最左非空表头，但不能超过表头范围
    let previewColStart = Math.max(1, firstDataCol - 5);
    for (let c = previewColStart; c <= firstDataCol; c++) {
        if (headerNames[c - 1]) {
            previewColStart = c;
            break;
        }
    }
    // 预览结束列为表头最大列，若实际数据超出表头范围则以表头为准
    const previewColEnd = actualLastCol > headerLastCol ? headerLastCol : actualLastCol;
    return {
        headerRow,
        headerNames,
        isImportant: headerIsImportant,
        dataStartRow,
        lastCol: actualLastCol,
        firstDataCol,
        previewColStart: previewColStart - 1, // 转为 0 基索引供 slice 使用
        previewColEnd,
        headerMatchCount
    };
}
/**
 * 自动检测包含数据表头的工作表并选中
 * 扫描所有工作表，找表头匹配度最高的，自动选中、锁定、预览
 * @returns {{ sheetIndex: number, sheetName: string, headerRow: number, matchCount: number }|null}
 */
function autoDetectSheet() {
    const app = getApp();
    if (!app || !app.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.WARN, "autoDetectSheet: Application 不可用");
        return null;
    }
    const sheets = app.ActiveWorkbook.Worksheets;
    let bestMatch = null;
    for (let si = 1; si <= sheets.Count; si++) {
        let needRestore = null; // 存储恢复函数
        try {
            const ws = sheets.Item(si);
            if (!ws)
                continue;
            const sheetName = ws.Name || "";
            if (/^(同步记录|SyncRecord|模糊|搜索|SEARCH)/i.test(sheetName))
                continue;
            needRestore = activateSheetIfNeeded(ws);
            const meta = detectHeaderAndColumns(ws);
            if (meta.headerRow > 0) {
                // 验证表头下方至少有 2 行有效数据
                let dataRowCount = 0;
                for (let dr = meta.dataStartRow; dr <= meta.dataStartRow + 10; dr++) {
                    let hasAny = false;
                    for (let c = 1; c <= meta.lastCol; c++) {
                        if (readCell(ws, dr, c).trim()) {
                            hasAny = true;
                            break;
                        }
                    }
                    if (hasAny)
                        dataRowCount++;
                }
                if (dataRowCount >= 2) {
                    // 优先选择列数更多的表，列数相同时选匹配关键词更多的
                    if (!bestMatch ||
                        meta.lastCol > bestMatch.colCount ||
                        (meta.lastCol === bestMatch.colCount && meta.headerMatchCount > bestMatch.matchCount)) {
                        bestMatch = {
                            sheetIndex: si,
                            sheetName: sheetName,
                            headerRow: meta.headerRow,
                            matchCount: meta.headerMatchCount, // 使用实际匹配数
                            colCount: meta.lastCol
                        };
                    }
                }
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `autoDetectSheet: 扫描工作表 ${si} 出错: ${e.message}`);
        }
        finally {
            // 修复：正确调用返回的恢复函数（而不是不存在的 restoreActiveSheet）
            if (typeof needRestore === 'function') {
                needRestore();
            }
        }
    }
    if (bestMatch) {
        bgmLog(LOG_LEVELS.INFO, `autoDetectSheet: 找到最佳匹配 ${bestMatch.sheetName} (index=${bestMatch.sheetIndex}, headerRow=${bestMatch.headerRow}, match=${bestMatch.matchCount})`);
    }
    else {
        bgmLog(LOG_LEVELS.INFO, "autoDetectSheet: 未找到包含数据表头的工作表");
    }
    return bestMatch;
}
/**
 * 更新筛选状态显示（增强版：显示筛选列名、条件、可见/隐藏行数）
 */
function updateFilterStatus(targetWs) {
    const el = document.getElementById("filterStatus");
    if (!el)
        return;
    const app = getApp();
    const ws = targetWs || (app?.ActiveWorkbook?.ActiveSheet);
    if (!ws) {
        el.textContent = "未连接到工作表";
        return;
    }
    let autoFilterMode = false;
    try {
        autoFilterMode = !!ws.AutoFilterMode;
    }
    catch (_) { }
    try {
        if (!autoFilterMode && ws.AutoFilter)
            autoFilterMode = !!ws.AutoFilter.Mode;
    }
    catch (_) { }
    if (!autoFilterMode) {
        el.textContent = "未开启筛选，同步全部数据";
        el.removeAttribute("title");
        return;
    }
    // 筛选已开启
    try {
        const autoFilter = ws.AutoFilter;
        if (!autoFilter) {
            el.textContent = "筛选已开启但无活动筛选";
            return;
        }
        const filters = autoFilter.Filters;
        if (!filters || typeof filters.Count === 'undefined' || filters.Count === 0) {
            el.textContent = "筛选已开启但无活动筛选，同步全部数据";
            return;
        }
        const activeCols = [];
        for (let i = 1; i <= filters.Count; i++) {
            try {
                const f = filters.Item ? filters.Item(i) : filters(i);
                if (f && f.On) {
                    // 获取列标题
                    let colName = "";
                    try {
                        const headerCell = ws.Range(colNumToLetter(i) + "1");
                        if (headerCell) {
                            colName = String(headerCell.Value2 || "").substring(0, 12);
                        }
                    }
                    catch (_) { }
                    // 获取筛选条件文本
                    let criteria = f.Criteria1 || "";
                    if (f.Criteria2) {
                        const op = f.Operator;
                        criteria += op === 1 ? " 且 " + f.Criteria2 : op === 2 ? " 或 " + f.Criteria2 : " / " + f.Criteria2;
                    }
                    activeCols.push(colName ? `${colName}(${criteria})` : `列${i}`);
                }
            }
            catch (_) { }
        }
        if (activeCols.length > 0) {
            const text = `✔ 筛选已开启（${activeCols.length} 列），将同步筛选后的可见数据\n${activeCols.join("、")}`;
            el.textContent = text;
            el.setAttribute("title", text);
        }
        else {
            el.textContent = "筛选已开启但无活动筛选，同步全部数据";
            el.removeAttribute("title");
        }
    }
    catch (e) {
        el.textContent = "检测筛选状态失败: " + e.message;
        bgmLog(LOG_LEVELS.ERROR, "updateFilterStatus error: " + e.message);
    }
}
/**
 * 检测工作表的筛选状态，返回 { isFiltered, visibleRowSet }
 */
function detectFilterState(ws) {
    let isFiltered = false;
    let visibleRowSet = null;
    let filterStartRow = 1;
    try {
        // 判断是否开启了筛选
        let autoFilterMode = !!ws.AutoFilterMode;
        if (!autoFilterMode && ws.AutoFilter)
            autoFilterMode = !!ws.AutoFilter.Mode;
        if (!autoFilterMode)
            return { isFiltered: false, visibleRowSet: null };
        isFiltered = true;
        // 获取筛选范围起始行（如果存在）
        try {
            const filterRange = ws.AutoFilter.Range;
            if (filterRange)
                filterStartRow = filterRange.Row;
        }
        catch (_) { /* 使用默认值 1 */ }
        // 方法1：SpecialCells 快速获取可见行（大范围）
        try {
            const lastRow = Math.min(ws.Rows.Count, PANEL_CONFIG.MAX_FILTER_SCAN_ROWS);
            const rangeStr = `${colNumToLetter(1)}${filterStartRow}:${colNumToLetter(1)}${lastRow}`;
            const visibleCells = ws.Range(rangeStr).SpecialCells(12);
            if (visibleCells) {
                visibleRowSet = new Set();
                for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                    const area = visibleCells.Areas.Item(a);
                    for (let r = 1; r <= area.Rows.Count; r++) {
                        visibleRowSet.add(area.Rows.Item(r).Row);
                    }
                }
                if (visibleRowSet.size < 3)
                    visibleRowSet = null; // 不可信
            }
        }
        catch (_) {
            // SpecialCells 不可用或出错，降级到逐行检查
        }
        // 方法2：逐行检查 Hidden 属性（回退，小范围避免卡顿）
        if (!visibleRowSet) {
            visibleRowSet = new Set();
            const lastRow = Math.min(ws.Rows.Count, PANEL_CONFIG.FILTER_FALLBACK_LIMIT);
            for (let r = filterStartRow; r <= lastRow; r++) {
                try {
                    if (!ws.Rows(r).Hidden)
                        visibleRowSet.add(r);
                }
                catch (_) {
                    visibleRowSet.add(r);
                }
            }
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "detectFilterState error: " + e.message);
    }
    return { isFiltered, visibleRowSet };
}
/**
 * 渲染预览表格 HTML
 * @param {Array} rows - 预览行数据
 * @param {number} sheetIndex
 * @param {string} sheetName
 * @param {number} headerRow
 * @returns {string}
 */
function renderPreviewTable(rows, sheetIndex, sheetName, headerRow) {
    let html = '<table class="preview-table"><tbody>';
    rows.forEach(item => {
        const rowClass = item.isHeader ? 'preview-header-row' : '';
        html += `<tr class="${rowClass}">`;
        html += `<td class="preview-row-num">${item.isHeader ? 'H' : item.row}</td>`;
        if (item.aligned) {
            const lastNonEmpty = item.cols.map((v, i) => v ? i : -1).filter(i => i >= 0).pop() || -1;
            const colLimit = lastNonEmpty + 1;
            for (let i = 0; i < colLimit; i++) {
                const text = item.cols[i] || '';
                let cls = '';
                if (item.isHeader) {
                    cls = 'preview-header';
                    if (item.isImportant && item.isImportant[i])
                        cls += ' preview-important-header';
                }
                html += `<td class="${cls}">${escapeHtml(String(text))}</td>`;
            }
        }
        html += '</tr>';
    });
    html += '</tbody></table>';
    html += `<p class="hint">已选择工作表索引: ${sheetIndex} (${escapeHtml(sheetName)})`;
    if (headerRow)
        html += ` | 表头行: ${headerRow}`;
    html += '</p>';
    return html;
}
/**
 * 刷新数据预览
 */
function refreshData() {
    bgmLog(LOG_LEVELS.INFO, "refreshData 开始执行");
    const select = document.getElementById("sheetSelect");
    const previewBox = document.getElementById("previewBox");
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 0;
    if (!sheetIndex) {
        if (previewBox)
            previewBox.innerHTML = '<p class="hint">请先选择工作表</p>';
        updateFilterStatus();
        bgmLog(LOG_LEVELS.INFO, "refreshData: 未选择工作表");
        return;
    }
    const app = getApp();
    if (!app || !app.ActiveWorkbook) {
        if (previewBox)
            previewBox.innerHTML = '<p class="hint">未连接到 Excel</p>';
        updateFilterStatus();
        return;
    }
    let ws;
    try {
        ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    }
    catch (e) {
        if (previewBox)
            previewBox.innerHTML = `<p class="hint">无法获取工作表: ${sheetIndex}</p>`;
        updateFilterStatus();
        return;
    }
    const sheetName = ws.Name || "";
    // 临时激活非活动表
    const needRestore = activateSheetIfNeeded(ws);
    try {
        // 筛选状态
        const { isFiltered, visibleRowSet } = detectFilterState(ws);
        // 获取表头及列信息
        const meta = detectHeaderAndColumns(ws, { visibleRowSet, isFiltered });
        // 构建预览行
        const previewRows = [];
        let hasData = false;
        if (meta.headerRow > 0) {
            // 表头行
            previewRows.push({
                row: -1,
                cols: meta.headerNames.slice(meta.previewColStart, meta.previewColEnd),
                isHeader: true,
                aligned: true,
                isImportant: meta.isImportant.slice(meta.previewColStart, meta.previewColEnd)
            });
            // 数据行
            const displayColCount = meta.previewColEnd - meta.previewColStart;
            for (let dr = meta.dataStartRow; dr <= meta.dataStartRow + PANEL_CONFIG.PREVIEW_LIMIT + 20 && dr <= 1000; dr++) {
                if (!isFiltered || !visibleRowSet || visibleRowSet.has(dr)) {
                    let hasAny = false;
                    const rowCols = [];
                    for (let ci = 0; ci < displayColCount; ci++) {
                        const v = readCell(ws, dr, meta.previewColStart + ci + 1).trim();
                        if (v)
                            hasAny = true;
                        rowCols.push(v);
                    }
                    if (hasAny) {
                        previewRows.push({ row: dr, cols: rowCols, isHeader: false, aligned: true });
                        hasData = true;
                        if (previewRows.filter(p => !p.isHeader).length >= PANEL_CONFIG.PREVIEW_LIMIT)
                            break;
                    }
                }
            }
        }
        else {
            // 无表头时回退到前几行
            let count = 0;
            for (let r = 1; r <= 100 && count < 5; r++) {
                if (isFiltered && visibleRowSet && !visibleRowSet.has(r))
                    continue;
                const cols = [];
                let any = false;
                for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
                    const v = readCell(ws, r, c).trim();
                    if (v) {
                        cols.push({ text: v, important: false });
                        any = true;
                    }
                }
                if (any) {
                    // 修复：添加 aligned: true，否则预览不显示列内容
                    previewRows.push({ row: r, cols: cols, isHeader: false, aligned: true });
                    hasData = true;
                    count++;
                }
            }
        }
        // 自动锁定逻辑
        if (hasData && !BGM.sheet.isLocked) {
            BGM.sheet.lockedIndex = sheetIndex;
            BGM.sheet.lockedName = sheetName;
            BGM.sheet.isLocked = true;
            saveLockedSheet({ index: sheetIndex, name: sheetName });
            updateLockButton();
            if (select)
                select.value = sheetIndex;
            showToast("已自动锁定工作表: " + sheetName, "info");
        }
        // 渲染
        if (previewBox) {
            previewBox.innerHTML = previewRows.length > 0
                ? renderPreviewTable(previewRows, sheetIndex, sheetName, meta.headerRow)
                : `<p class="hint">已选择工作表索引: ${sheetIndex} (${escapeHtml(sheetName)})<br>未检测到数据</p>`;
        }
        updateFilterStatus(ws);
        bgmLog(LOG_LEVELS.INFO, `refreshData 完成, hasData=${hasData}, rows=${previewRows.length}`);
    }
    finally {
        if (needRestore)
            needRestore(); // needRestore 现在是恢复函数
    }
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
                if (manualInputs)
                    manualInputs.style.display = "block";
                if (autoInfo)
                    autoInfo.style.display = "none";
            }
            else {
                if (manualInputs)
                    manualInputs.style.display = "none";
                if (autoInfo)
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
    bgmLog(LOG_LEVELS.INFO, "initPanel 开始");
    // 检查枚举（兼容 WPS 环境可能未就绪的情况）
    if (typeof window.Application !== "undefined" && typeof window.Application.Enum !== "object") {
        window.Application.Enum = WPS_Enum;
        bgmLog(LOG_LEVELS.DEBUG, "initPanel: 已设置 WPS_Enum");
    }
    // 初始化消息监听
    initMessageListener();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: 消息监听已初始化");
    // 恢复锁定的工作表缓存
    let restored = restoreLockedSheet();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: 工作表锁定恢复=" + restored);
    // 初始化工作表列表（会自动选中锁定的工作表）
    refreshSheets();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: 工作表列表已刷新");
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
        bgmLog(LOG_LEVELS.INFO, "initPanel: 自动识别到数据表 " + detected.sheetName +
            " (匹配" + detected.matchCount + "个关键词，表头第" + detected.headerRow + "行, " + detected.colCount + "列)");
        refreshData();
    }
    else {
        // 未检测到有效数据表，尝试使用恢复的锁定表
        if (restored && BGM.sheet.isLocked) {
            let select = document.getElementById("sheetSelect");
            if (select)
                select.value = BGM.sheet.lockedIndex;
            refreshData();
        }
    }
    // 更新状态显示
    updateTokenStatus();
    updateUserIdStatus();
    bgmLog(LOG_LEVELS.DEBUG, "initPanel: Token/用户ID 状态已更新");
    // 绑定工作表选择事件
    let sheetSelect = document.getElementById("sheetSelect");
    if (sheetSelect) {
        sheetSelect.addEventListener("change", () => {
            BGM.sheet.lockedIndex = null;
            BGM.sheet.lockedName = null;
            BGM.sheet.isLocked = false;
            saveLockedSheet(null); // 手动切换工作表时清除锁定缓存
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
    bgmLog(LOG_LEVELS.INFO, "initPanel 完成");
}
/**
 * 获取 BGM 收藏数据（委托给 handlers.js 增强版）
 */
function fetchBgCollectionRecords() {
    if (typeof window.syncCollectionFromBgm === 'function') {
        // 委托给 handlers.js 的增强版（会触发完整交互流程）
        window.syncCollectionFromBgm();
    }
    else {
        showAlert("请先设置 Token！");
    }
}
/**
 * 清除同步记录
 * 实际实现在 syncRecord.js 中，这里作为转发入口
 */
function clearSyncRecords() {
    if (typeof _clearSyncRecords === 'function') {
        _clearSyncRecords();
    }
    else {
        showAlert("清除同步记录功能未加载");
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
        showAlert('请先选择工作表！');
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
        showAlert('请先选择工作表！');
        return;
    }
    clearSheetMarks(sheetName);
}
// ========== 导出函数 ==========
export { initPanel, refreshSheets, refreshData, toggleSheetLock, onSelectModeChange, fetchBgCollectionRecords, clearSyncRecords, markUploadedItems, markUploadedItemsDefault, clearSheetMarks, clearSheetMarksDefault, autoDetectSheet, updateFilterStatus };
// ========== 挂载到 window（向后兼容）==========
// 修复：当脚本在 load 事件后执行时仍能初始化
function safeInitPanel() {
    try {
        initPanel();
    }
    catch (e) {
        console.error('[BGM] initPanel 执行失败:', e);
        // 即使初始化失败，也通知模块已加载（函数已挂载到 window）
        document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    }
}
if (document.readyState === 'complete') {
    safeInitPanel();
}
else {
    window.addEventListener('load', safeInitPanel);
}
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
window.showAlertDialog = showAlert; // 兼容别名
window.closeAlertDialog = closeAlertDialog;
window.showToast = showToast;
window.showTokenDialog = showTokenDialog;
window.showUserIdDialog = showUserIdDialog;
