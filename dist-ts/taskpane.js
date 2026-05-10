/**
 * 任务面板主模块（TypeScript 版）
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑
 */
import { PANEL_CONFIG, WPS_ENUM, LOG_LEVELS, getApp, bgmLog, BGM, escapeHtml, readCell, colNumToLetter, HEADER_KEYWORDS, IMPORTANT_COLS, initMessageListener, markUploadedItems, clearSheetMarks, updateTokenStatus, updateUserIdStatus, showAlert, showToast, closeDetailModal, clearSyncRecords as _clearSyncRecords } from './index.js';
// ========== 工作表锁定功能 ==========
function toggleSheetLock() {
    const select = document.getElementById('sheetSelect');
    if (!select)
        return;
    const sheetIndex = parseInt(select.value, 10);
    if (isNaN(sheetIndex) || sheetIndex <= 0) {
        showToast('请先选择一个有效的工作表', 'warn');
        return;
    }
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === sheetIndex) {
        BGM.sheet.lockedIndex = null;
        BGM.sheet.lockedName = null;
        BGM.sheet.isLocked = false;
        saveLockedSheet(null);
        showToast('已解锁工作表', 'info');
    }
    else {
        const sheetName = select.options[select.selectedIndex]?.text || '';
        BGM.sheet.lockedIndex = sheetIndex;
        BGM.sheet.lockedName = sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: sheetIndex, name: sheetName });
        showToast('已锁定工作表: ' + sheetName, 'info');
    }
    updateLockButton();
    refreshData();
}
function saveLockedSheet(info) {
    const app = getApp();
    if (app?.PluginStorage) {
        app.PluginStorage.setItem('bgm_locked_sheet', info ? JSON.stringify(info) : '');
    }
}
function restoreLockedSheet() {
    const app = getApp();
    if (app?.PluginStorage) {
        const raw = app.PluginStorage.getItem('bgm_locked_sheet');
        if (raw) {
            try {
                const info = JSON.parse(raw);
                BGM.sheet.lockedIndex = (info.index != null) ? info.index : null;
                BGM.sheet.lockedName = info.name || null;
                BGM.sheet.isLocked = !!(info.index != null && info.name);
                return true;
            }
            catch (e) {
                saveLockedSheet(null);
            }
        }
    }
    return false;
}
function updateLockButton() {
    const btn = document.getElementById('lockSheetBtn');
    const status = document.getElementById('lockStatus');
    if (btn) {
        if (BGM.sheet.isLocked) {
            btn.textContent = '🔓 解锁';
            btn.classList.add('locked');
        }
        else {
            btn.textContent = '🔒 锁定';
            btn.classList.remove('locked');
        }
    }
    if (status) {
        if (BGM.sheet.isLocked) {
            status.style.display = 'inline';
            status.textContent = '已锁定: ' + BGM.sheet.lockedName;
        }
        else {
            status.style.display = 'none';
        }
    }
}
function refreshSheets() {
    const select = document.getElementById('sheetSelect');
    if (!select)
        return;
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        console.warn('refreshSheets: 无法获取 ActiveWorkbook');
        return;
    }
    const sheets = app.ActiveWorkbook.Worksheets;
    select.innerHTML = '<option value="">-- 请选择 --</option>';
    for (let i = 1; i <= sheets.Count; i++) {
        const option = document.createElement('option');
        option.value = String(i);
        option.text = sheets.Item(i).Name;
        if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === i) {
            option.selected = true;
        }
        select.appendChild(option);
    }
    updateLockButton();
}
function activateSheetIfNeeded(ws) {
    const app = getApp();
    if (!app)
        return false;
    try {
        const active = app.ActiveWorkbook.ActiveSheet;
        const activeName = active.Name || '';
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
        bgmLog(LOG_LEVELS.WARN, 'activateSheetIfNeeded 失败: ' + e.message);
    }
    return false;
}
// ========== 表头检测 ==========
function detectHeaderAndColumns(ws, opts = {}) {
    const { visibleRowSet = null, isFiltered = false } = opts;
    function isRowVisible(r, headerRow) {
        if (r === headerRow)
            return true;
        return !isFiltered || (visibleRowSet !== null && visibleRowSet.has(r));
    }
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
            headerRow: 0, headerNames: [], isImportant: [], dataStartRow: 0,
            lastCol: 0, firstDataCol: 0, previewColStart: 0, previewColEnd: 0, headerMatchCount: 0
        };
    }
    candidates.sort((a, b) => b.colCount - a.colCount || a.row - b.row);
    const headerRow = candidates[0].row;
    const headerMatchCount = candidates[0].matchCount;
    const headerNames = [];
    const headerIsImportant = [];
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
        const v = readCell(ws, headerRow, c).trim();
        headerNames.push(v);
        headerIsImportant.push(IMPORTANT_COLS[v.toLowerCase()] || false);
    }
    let dataStartRow = headerRow + 1;
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
    let firstDataCol = -1;
    let lastDataCol = 0;
    let samples = 0;
    for (let dr = dataStartRow; dr <= dataStartRow + 20 && samples < 5; dr++) {
        if (!isRowVisible(dr, headerRow))
            continue;
        samples++;
        for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
            if (readCell(ws, dr, c).trim()) {
                if (firstDataCol < 0)
                    firstDataCol = c;
                if (c > lastDataCol)
                    lastDataCol = c;
            }
        }
    }
    if (firstDataCol < 0)
        firstDataCol = 1;
    let headerLastCol = 0;
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
        if (headerNames[c - 1])
            headerLastCol = c;
    }
    const actualLastCol = Math.max(lastDataCol, headerLastCol);
    let previewColStart = Math.max(1, firstDataCol - 5);
    for (let c = previewColStart; c <= firstDataCol; c++) {
        if (headerNames[c - 1]) {
            previewColStart = c;
            break;
        }
    }
    const previewColEnd = actualLastCol > headerLastCol ? headerLastCol : actualLastCol;
    return {
        headerRow, headerNames, isImportant: headerIsImportant, dataStartRow,
        lastCol: actualLastCol, firstDataCol,
        previewColStart: previewColStart - 1, previewColEnd, headerMatchCount
    };
}
function autoDetectSheet() {
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.WARN, 'autoDetectSheet: Application 不可用');
        return null;
    }
    const sheets = app.ActiveWorkbook.Worksheets;
    let bestMatch = null;
    for (let si = 1; si <= sheets.Count; si++) {
        let needRestore = false;
        try {
            const ws = sheets.Item(si);
            if (!ws)
                continue;
            const sheetName = ws.Name || '';
            if (/^(同步记录|SyncRecord|模糊|搜索|SEARCH)/i.test(sheetName))
                continue;
            needRestore = activateSheetIfNeeded(ws);
            const meta = detectHeaderAndColumns(ws);
            if (meta.headerRow > 0) {
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
                    if (!bestMatch || meta.lastCol > bestMatch.colCount ||
                        (meta.lastCol === bestMatch.colCount && meta.headerMatchCount > bestMatch.matchCount)) {
                        bestMatch = {
                            sheetIndex: si, sheetName: sheetName,
                            headerRow: meta.headerRow, matchCount: meta.headerMatchCount, colCount: meta.lastCol
                        };
                    }
                }
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `autoDetectSheet: 扫描工作表 ${si} 出错: ${e.message}`);
        }
        finally {
            if (typeof needRestore === 'function')
                needRestore();
        }
    }
    if (bestMatch) {
        bgmLog(LOG_LEVELS.INFO, `autoDetectSheet: 找到最佳匹配 ${bestMatch.sheetName}`);
    }
    else {
        bgmLog(LOG_LEVELS.INFO, 'autoDetectSheet: 未找到包含数据表头的工作表');
    }
    return bestMatch;
}
// ========== 筛选状态 ==========
function updateFilterStatus(targetWs) {
    const el = document.getElementById('filterStatus');
    if (!el)
        return;
    const app = getApp();
    const ws = targetWs || app?.ActiveWorkbook?.ActiveSheet;
    if (!ws) {
        el.textContent = '未连接到工作表';
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
        el.textContent = '未开启筛选，同步全部数据';
        el.removeAttribute('title');
        return;
    }
    try {
        const autoFilter = ws.AutoFilter;
        if (!autoFilter) {
            el.textContent = '筛选已开启但无活动筛选';
            return;
        }
        const filters = autoFilter.Filters;
        if (!filters || !filters.Count) {
            el.textContent = '筛选已开启但无活动筛选，同步全部数据';
            return;
        }
        const activeCols = [];
        for (let i = 1; i <= filters.Count; i++) {
            try {
                const f = filters.Item ? filters.Item(i) : filters(i);
                if (f?.On) {
                    let colName = '';
                    try {
                        const headerCell = ws.Range(colNumToLetter(i) + '1');
                        if (headerCell)
                            colName = String(headerCell.Value2 || '').substring(0, 12);
                    }
                    catch (_) { }
                    let criteria = f.Criteria1 || '';
                    if (f.Criteria2) {
                        const op = f.Operator;
                        criteria += op === 1 ? ' 且 ' + f.Criteria2 : op === 2 ? ' 或 ' + f.Criteria2 : ' / ' + f.Criteria2;
                    }
                    activeCols.push(colName ? `${colName}(${criteria})` : `列${i}`);
                }
            }
            catch (_) { }
        }
        if (activeCols.length > 0) {
            const text = `✔ 筛选已开启（${activeCols.length} 列），将同步筛选后的可见数据\n${activeCols.join('、')}`;
            el.textContent = text;
            el.setAttribute('title', text);
        }
        else {
            el.textContent = '筛选已开启但无活动筛选，同步全部数据';
            el.removeAttribute('title');
        }
    }
    catch (e) {
        el.textContent = '检测筛选状态失败: ' + e.message;
    }
}
function detectFilterState(ws) {
    let isFiltered = false;
    let visibleRowSet = null;
    let filterStartRow = 1;
    try {
        let autoFilterMode = !!ws.AutoFilterMode;
        if (!autoFilterMode && ws.AutoFilter)
            autoFilterMode = !!ws.AutoFilter.Mode;
        if (!autoFilterMode)
            return { isFiltered: false, visibleRowSet: null };
        isFiltered = true;
        try {
            const filterRange = ws.AutoFilter.Range;
            if (filterRange)
                filterStartRow = filterRange.Row;
        }
        catch (_) { }
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
                    visibleRowSet = null;
            }
        }
        catch (_) { }
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
        bgmLog(LOG_LEVELS.ERROR, 'detectFilterState error: ' + e.message);
    }
    return { isFiltered, visibleRowSet };
}
// ========== 预览渲染 ==========
function renderPreviewTable(rows, sheetIndex, sheetName, headerRow) {
    let html = '<table class="preview-table"><tbody>';
    rows.forEach(item => {
        const rowClass = item.isHeader ? 'preview-header-row' : '';
        html += `<tr class="${rowClass}">`;
        html += `<td class="preview-row-num">${item.isHeader ? 'H' : item.row}</td>`;
        if (item.aligned) {
            const cols = item.cols;
            const lastNonEmpty = cols.map((v, i) => v ? i : -1).filter(i => i >= 0).pop() ?? -1;
            const colLimit = lastNonEmpty + 1;
            for (let i = 0; i < colLimit; i++) {
                const text = cols[i] || '';
                let cls = '';
                if (item.isHeader) {
                    cls = 'preview-header';
                    if (item.isImportant?.[i])
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
function refreshData() {
    bgmLog(LOG_LEVELS.INFO, 'refreshData 开始执行');
    const select = document.getElementById('sheetSelect');
    const previewBox = document.getElementById('previewBox');
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value || '') || 0;
    if (!sheetIndex) {
        if (previewBox)
            previewBox.innerHTML = '<p class="hint">请先选择工作表</p>';
        updateFilterStatus();
        return;
    }
    const app = getApp();
    if (!app?.ActiveWorkbook) {
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
    const sheetName = ws.Name || '';
    const needRestore = activateSheetIfNeeded(ws);
    try {
        const { isFiltered, visibleRowSet } = detectFilterState(ws);
        const meta = detectHeaderAndColumns(ws, { visibleRowSet, isFiltered });
        const previewRows = [];
        let hasData = false;
        if (meta.headerRow > 0) {
            previewRows.push({
                row: -1,
                cols: meta.headerNames.slice(meta.previewColStart, meta.previewColEnd),
                isHeader: true, aligned: true,
                isImportant: meta.isImportant.slice(meta.previewColStart, meta.previewColEnd)
            });
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
                    previewRows.push({ row: r, cols, isHeader: false, aligned: true });
                    hasData = true;
                    count++;
                }
            }
        }
        if (hasData && !BGM.sheet.isLocked) {
            BGM.sheet.lockedIndex = sheetIndex;
            BGM.sheet.lockedName = sheetName;
            BGM.sheet.isLocked = true;
            saveLockedSheet({ index: sheetIndex, name: sheetName });
            updateLockButton();
            if (select)
                select.value = String(sheetIndex);
            showToast('已自动锁定工作表: ' + sheetName, 'info');
            const meta = detectHeaderAndColumns(ws, { visibleRowSet, isFiltered });
            bgmLog(LOG_LEVELS.INFO, `headerRow=${meta.headerRow}, dataStartRow=${meta.dataStartRow}, lastCol=${meta.lastCol}, previewColStart=${meta.previewColStart},  previewColEnd=${meta.previewColEnd}`);
        }
        if (previewBox) {
            previewBox.innerHTML = previewRows.length > 0
                ? renderPreviewTable(previewRows, sheetIndex, sheetName, meta.headerRow)
                : `<p class="hint">已选择工作表索引: ${sheetIndex} (${escapeHtml(sheetName)})<br>未检测到数据</p>`;
        }
        updateFilterStatus(ws);
    }
    finally {
        if (needRestore)
            needRestore();
    }
    bgmLog(LOG_LEVELS.INFO, `refreshData 完成, hasData=${previewBox != null}`);
}
function onSelectModeChange() {
    const manualInputs = document.getElementById('manualRangeInputs');
    const autoInfo = document.getElementById('autoRangeInfo');
    const modeRadios = document.querySelectorAll('input[name="selectMode"]');
    for (const radio of modeRadios) {
        if (radio.checked) {
            if (radio.value === 'manual') {
                if (manualInputs)
                    manualInputs.style.display = 'block';
                if (autoInfo)
                    autoInfo.style.display = 'none';
            }
            else {
                if (manualInputs)
                    manualInputs.style.display = 'none';
                if (autoInfo)
                    autoInfo.style.display = 'block';
            }
            break;
        }
    }
}
// ========== 初始化 ==========
function initPanel() {
    bgmLog(LOG_LEVELS.INFO, 'initPanel 开始');
    if (typeof window.Application !== 'undefined' && typeof window.Application.Enum !== 'object') {
        window.Application.Enum = WPS_ENUM;
    }
    initMessageListener();
    const restored = restoreLockedSheet();
    refreshSheets();
    const detected = autoDetectSheet();
    if (detected) {
        const select = document.getElementById('sheetSelect');
        if (select)
            select.value = String(detected.sheetIndex);
        BGM.sheet.lockedIndex = detected.sheetIndex;
        BGM.sheet.lockedName = detected.sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: detected.sheetIndex, name: detected.sheetName });
        updateLockButton();
        refreshData();
    }
    else if (restored && BGM.sheet.isLocked) {
        const select = document.getElementById('sheetSelect');
        if (select)
            select.value = String(BGM.sheet.lockedIndex);
        refreshData();
    }
    updateTokenStatus();
    updateUserIdStatus();
    const sheetSelect = document.getElementById('sheetSelect');
    if (sheetSelect) {
        sheetSelect.addEventListener('change', () => {
            BGM.sheet.lockedIndex = null;
            BGM.sheet.lockedName = null;
            BGM.sheet.isLocked = false;
            saveLockedSheet(null);
            updateLockButton();
            refreshData();
        });
    }
    document.querySelectorAll('input[name="selectMode"]').forEach(radio => {
        radio.addEventListener('change', onSelectModeChange);
    });
    // 按 Escape 键只关闭详情模态框，其它弹窗由各自的关闭按钮控制
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDetailModal();
        }
    });
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    bgmLog(LOG_LEVELS.INFO, 'initPanel 完成');
}
function fetchBgCollectionRecords() {
    if (typeof window.syncCollectionFromBgm === 'function') {
        window.syncCollectionFromBgm();
    }
    else {
        showAlert('请先设置 Token！');
    }
}
function clearSyncRecords() {
    if (typeof _clearSyncRecords === 'function')
        _clearSyncRecords();
    else
        showAlert('清除同步记录功能未加载');
}
function getSelectedSheetName() {
    if (BGM.sheet.isLocked && BGM.sheet.lockedName)
        return BGM.sheet.lockedName;
    const select = document.getElementById('sheetSelect');
    if (select && select.selectedIndex > 0)
        return select.options[select.selectedIndex].text;
    return null;
}
function markUploadedItemsDefault() {
    const sheetName = getSelectedSheetName();
    if (!sheetName) {
        showAlert('请先选择工作表！');
        return;
    }
    markUploadedItems(sheetName);
}
function clearSheetMarksDefault() {
    const sheetName = getSelectedSheetName();
    if (!sheetName) {
        showAlert('请先选择工作表！');
        return;
    }
    clearSheetMarks(sheetName);
}
// ========== 导出 ==========
export { initPanel, refreshSheets, refreshData, toggleSheetLock, onSelectModeChange, fetchBgCollectionRecords, clearSyncRecords, markUploadedItems, markUploadedItemsDefault, clearSheetMarksDefault, autoDetectSheet, updateFilterStatus };
// ========== 挂载到 window ==========
function safeInitPanel() {
    try {
        initPanel();
    }
    catch (e) {
        console.error('[BGM] initPanel 执行失败:', e);
        document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    }
}
// 只在 taskpane.html 中自动初始化，避免 main.js 加载时重复执行
if (window.location.pathname.includes('taskpane.html')) {
    if (document.readyState === 'complete') {
        safeInitPanel();
    }
    else {
        window.addEventListener('load', safeInitPanel);
    }
}
