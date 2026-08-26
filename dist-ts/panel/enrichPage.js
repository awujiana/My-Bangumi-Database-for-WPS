/**
 * @fileoverview 富化页面的 UI 控制器
 * @module panel/enrichPage
 * @description 负责文件选择、表头识别、列映射编辑、匹配预览、富化执行与进度、富化记录查看。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { detectColumns, matchEntries, enrichEntries, resolveConflictField, } from '../sync/enrichEngine.js';
import { refreshEnrichWorkbooks, refreshEnrichSheets, toggleEnrichWorkbookLock, updateEnrichLockButton, getLockedEnrichSheet, initEnrichLock, } from '../sync/enrichLock.js';
import { getAllEnrichRecords, getOrCreateEnrichRecordSheet, clearEnrichRecords, } from '../sync/enrichRecord.js';
import { sanitizeHtml } from '../tools/sanitize.js';
import { escapeHtml } from '../tools/stringUtils.js';
import { getCellValue, getLastRow, findHeaderRow, getDataSheet, bgmLog, BGM, getApp, } from '../tools/util/index.js';
// ========== 状态 ==========
const state = {
    filePath: '',
    newAnimeSheet: null,
    bangumiSheet: null,
    columnMapping: null,
    headerRow: 0,
    dataStartRow: 0,
    matches: [],
    isEnriching: false,
    cancelRequested: false,
    pendingConflicts: [],
    currentConflictIndex: 0,
};
// ========== 列映射字段元数据 ==========
const COLUMN_MAPPING_FIELDS = [
    { key: 'nameCol', label: '名称', required: true },
    { key: 'tagsCol', label: 'TAGS/标签', required: false },
    { key: 'premiereCol', label: '首播', required: false },
    { key: 'episodesCol', label: '集数', required: false },
    { key: 'weekdayCol', label: '周更时间', required: false },
    { key: 'platformCol', label: '播放平台', required: false },
    { key: 'exclusiveCol', label: '独播', required: false },
    { key: 'specialCol', label: '特殊/备注', required: false },
];
// ========== 工具函数 ==========
function safeGetElement(id) {
    return document.getElementById(id);
}
function safeGetButton(id) {
    const el = document.getElementById(id);
    return el instanceof HTMLButtonElement ? el : null;
}
function safeGetSelect(id) {
    const el = document.getElementById(id);
    return el instanceof HTMLSelectElement ? el : null;
}
function formatEta(etaMs) {
    if (etaMs <= 0)
        return '-';
    const seconds = Math.ceil(etaMs / 1000);
    if (seconds < 60)
        return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60)
        return `${minutes}分${remainingSeconds}秒`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}时${remainingMinutes}分`;
}
// ========== 初始化 ==========
export function initEnrichPage() {
    bgmLog(LOG_LEVELS.INFO, '[enrich] initEnrichPage 开始');
    // 初始化富化工作簿锁定模块（恢复持久化的锁定状态）
    initEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus');
    bindFileSelector();
    bindDetectHeaderButton();
    bindTargetSheetControls();
    bindTabSwitches();
    bindStartEnrichButton();
    bindRecordControls();
    loadRecentRecords();
    // 如果有锁定的工作表，自动填充到 state
    if (BGM.enrich.isLocked && BGM.enrich.lockedSheetIndex) {
        const locked = getLockedEnrichSheet();
        if (locked) {
            state.bangumiSheet = locked[1];
            bgmLog(LOG_LEVELS.INFO, `[enrich] 已恢复锁定的目标工作表: ${locked[1].Name}`);
        }
    }
    bgmLog(LOG_LEVELS.INFO, '[enrich] initEnrichPage 完成');
}
function bindFileSelector() {
    const btn = safeGetButton('selectFileBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            selectNewAnimeFile();
        });
    }
}
function bindDetectHeaderButton() {
    const btn = safeGetButton('detectHeaderBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            autoDetectHeader();
        });
    }
}
function bindTargetSheetControls() {
    const wbSelect = safeGetSelect('workbookSelect');
    if (wbSelect) {
        wbSelect.addEventListener('change', () => {
            refreshSheetList();
            // 切换工作簿时同步锁定状态显示
            updateEnrichLockButton('lockSheetBtn', 'lockStatus');
        });
    }
    const sheetSelect = safeGetSelect('sheetSelect');
    if (sheetSelect) {
        sheetSelect.addEventListener('change', () => {
            selectTargetSheet();
            // 切换工作表时同步锁定状态显示
            updateEnrichLockButton('lockSheetBtn', 'lockStatus');
        });
    }
    const refreshBtn = document.querySelector('[data-action="refreshSheets"]');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshWorkbookList();
            refreshSheetList();
            updateEnrichLockButton('lockSheetBtn', 'lockStatus');
        });
    }
    const lockBtn = safeGetButton('lockSheetBtn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            toggleSheetLock();
        });
    }
    refreshWorkbookList();
    refreshSheetList();
}
function bindTabSwitches() {
    const tabs = document.querySelectorAll('.preview-tab');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            if (!tabName)
                return;
            tabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            const sourceTable = safeGetElement('sourcePreviewTable');
            const matchTable = safeGetElement('matchPreviewTable');
            if (tabName === 'source') {
                if (sourceTable)
                    sourceTable.style.display = '';
                if (matchTable)
                    matchTable.style.display = 'none';
            }
            else if (tabName === 'match') {
                if (sourceTable)
                    sourceTable.style.display = 'none';
                if (matchTable)
                    matchTable.style.display = '';
            }
        });
    });
}
function bindStartEnrichButton() {
    const btn = safeGetButton('startEnrichBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            startEnrichment();
        });
    }
}
function bindRecordControls() {
    const openRecordBtn = document.querySelector('[data-action="openRecordSheet"]');
    if (openRecordBtn) {
        openRecordBtn.addEventListener('click', () => {
            openEnrichRecordSheet();
        });
    }
    const clearRecordBtn = document.querySelector('[data-action="clearRecords"]');
    if (clearRecordBtn) {
        clearRecordBtn.addEventListener('click', () => {
            clearRecords();
        });
    }
}
// ========== 文件选择 ==========
export function selectNewAnimeFile() {
    try {
        const app = getApp();
        if (!app || typeof app.GetOpenFilename !== 'function') {
            BGM.Dialog.alert('提示', 'WPS 文件对话框不可用，请直接在 WPS 中打开文件');
            return;
        }
        const selected = app.GetOpenFilename('Excel 文件 (*.xlsx),*.xlsx,Excel 97-2003 文件 (*.xls),*.xls,CSV 文件 (*.csv),*.csv,所有文件 (*.*),*.*', '选择新番表文件');
        if (typeof selected === 'boolean' || selected === false) {
            bgmLog(LOG_LEVELS.INFO, '[enrich] 用户取消文件选择');
            return;
        }
        const filePath = String(selected);
        state.filePath = filePath;
        const display = safeGetElement('filePathDisplay');
        if (display) {
            display.textContent = filePath;
            display.title = filePath;
        }
        bgmLog(LOG_LEVELS.INFO, `[enrich] 已选择文件: ${filePath}`);
    }
    catch (e) {
        BGM.handleError(e, {
            showAlert: true,
            level: BGM.ErrorLevel.ERROR,
            context: 'selectNewAnimeFile',
        });
    }
}
// ========== 表头自动识别 ==========
export function autoDetectHeader() {
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        BGM.Dialog.alert('提示', '未连接到 Excel，请先打开包含新番表的工作簿');
        return;
    }
    const sheetSelect = safeGetSelect('sheetSelect');
    let ws = null;
    if (sheetSelect?.value) {
        const sheetIndex = parseInt(sheetSelect.value, 10);
        const wb = getSelectedWorkbook();
        if (wb && sheetIndex > 0) {
            try {
                ws = wb.Worksheets.Item(sheetIndex);
            }
            catch (e) {
                BGM.handleError(e, {
                    showAlert: false,
                    level: BGM.ErrorLevel.INFO,
                    context: 'autoDetectHeader',
                });
            }
        }
    }
    if (!ws) {
        const dataSheet = getDataSheet();
        if (dataSheet) {
            ws = dataSheet;
        }
        else {
            BGM.Dialog.alert('提示', '请先选择新番表所在的工作表');
            return;
        }
    }
    state.newAnimeSheet = ws;
    try {
        const headerRow = findHeaderRow(ws);
        if (headerRow === 0) {
            BGM.Dialog.alert('提示', '未检测到有效的表头行，请检查表头是否在前 10 行内');
            return;
        }
        state.headerRow = headerRow;
        state.dataStartRow = headerRow + 1;
        const mapping = detectColumns(ws, headerRow);
        state.columnMapping = mapping;
        renderDetectResult(ws, mapping);
        renderColumnMappingEditor(ws, mapping);
        bgmLog(LOG_LEVELS.INFO, `[enrich] 表头识别完成: headerRow=${headerRow}, nameCol=${mapping.nameCol}`);
        renderSourcePreview(ws, mapping);
    }
    catch (e) {
        BGM.handleError(e, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'autoDetectHeader',
        });
        BGM.Dialog.error('错误', '识别表头失败: ' + (e instanceof Error ? e.message : String(e)));
    }
}
function renderDetectResult(ws, _mapping) {
    const resultArea = safeGetElement('detectResult');
    if (!resultArea)
        return;
    const sheetName = ws.Name || '未知';
    const sheetNameEl = safeGetElement('detectSheetName');
    if (sheetNameEl)
        sheetNameEl.textContent = sheetName;
    const headerRowEl = safeGetElement('detectHeaderRow');
    if (headerRowEl)
        headerRowEl.textContent = String(state.headerRow);
    const dataRowEl = safeGetElement('detectDataRow');
    if (dataRowEl)
        dataRowEl.textContent = String(state.dataStartRow);
    resultArea.style.display = '';
}
function renderColumnMappingEditor(ws, mapping) {
    const mappingList = safeGetElement('mappingList');
    if (!mappingList)
        return;
    const maxCols = 50;
    const headerRow = state.headerRow;
    const colOptions = [];
    for (let col = 1; col <= maxCols; col++) {
        const header = getCellValue(ws, headerRow, col).trim();
        if (header) {
            colOptions.push({ col, header });
        }
    }
    let html = '';
    for (const field of COLUMN_MAPPING_FIELDS) {
        const currentCol = mapping[field.key];
        const selectedValue = currentCol ? String(currentCol) : '';
        const optionsHtml = '<option value="">-- 未映射 --</option>' +
            colOptions
                .map((o) => `<option value="${o.col}" ${String(o.col) === selectedValue ? 'selected' : ''}>${escapeHtml(o.header)} (列${o.col})</option>`)
                .join('');
        const requiredMark = field.required ? ' <span style="color:#ff6b6b;">*</span>' : '';
        html += `
      <div class="mapping-item" data-field="${field.key}">
        <label class="mapping-label">${escapeHtml(field.label)}${requiredMark}</label>
        <select class="mapping-select" data-field="${field.key}">
          ${optionsHtml}
        </select>
      </div>
    `;
    }
    mappingList.innerHTML = sanitizeHtml(html);
    const selects = mappingList.querySelectorAll('.mapping-select');
    selects.forEach((select) => {
        const fieldKey = select.getAttribute('data-field');
        if (!fieldKey)
            return;
        select.addEventListener('change', () => {
            const value = parseInt(select.value, 10);
            if (state.columnMapping) {
                updateColumnMapping(fieldKey, isNaN(value) ? 0 : value);
            }
        });
    });
}
function updateColumnMapping(field, value) {
    if (!state.columnMapping)
        return;
    if (value === 0) {
        state.columnMapping[field] = undefined;
    }
    else {
        state.columnMapping[field] = value;
    }
    bgmLog(LOG_LEVELS.INFO, `[enrich] 列映射更新: ${String(field)} → ${value > 0 ? '列' + value : '未映射'}`);
}
// ========== 目标工作表选择 ==========
function getSelectedWorkbook() {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        return null;
    const wbSelect = safeGetSelect('workbookSelect');
    const wbName = wbSelect?.value || '';
    if (!wbName)
        return app.ActiveWorkbook;
    const wbs = app.Workbooks;
    if (!wbs)
        return app.ActiveWorkbook;
    for (let i = 1; i <= wbs.Count; i++) {
        const wb = wbs.Item(i);
        if (wb.Name === wbName) {
            return wb;
        }
    }
    return app.ActiveWorkbook;
}
function refreshWorkbookList() {
    refreshEnrichWorkbooks('workbookSelect');
    // 如果已锁定，选中锁定的工作簿
    if (BGM.enrich.isLocked && BGM.enrich.lockedWorkbookName) {
        const wbSelect = safeGetSelect('workbookSelect');
        if (wbSelect)
            wbSelect.value = BGM.enrich.lockedWorkbookName;
    }
}
function refreshSheetList() {
    const wbSelect = safeGetSelect('workbookSelect');
    const wbName = wbSelect?.value || undefined;
    refreshEnrichSheets(wbName, 'sheetSelect', 'workbookSelect');
    // 如果已锁定，选中锁定的工作表
    if (BGM.enrich.isLocked && BGM.enrich.lockedSheetIndex) {
        const sheetSelect = safeGetSelect('sheetSelect');
        if (sheetSelect)
            sheetSelect.value = String(BGM.enrich.lockedSheetIndex);
    }
}
function selectTargetSheet() {
    const sheetSelect = safeGetSelect('sheetSelect');
    if (!sheetSelect?.value) {
        state.bangumiSheet = null;
        return;
    }
    const sheetIndex = parseInt(sheetSelect.value, 10);
    const wb = getSelectedWorkbook();
    if (!wb || sheetIndex <= 0) {
        state.bangumiSheet = null;
        return;
    }
    try {
        const ws = wb.Worksheets.Item(sheetIndex);
        state.bangumiSheet = ws;
        bgmLog(LOG_LEVELS.INFO, `[enrich] 已选择目标工作表: ${ws.Name} (索引: ${sheetIndex})`);
        // 同步到 BGM.enrich 状态（未锁定时自动更新）
        if (!BGM.enrich.isLocked) {
            BGM.enrich.lockedWorkbookName = wb.Name;
            BGM.enrich.lockedSheetName = ws.Name;
            BGM.enrich.lockedSheetIndex = sheetIndex;
        }
    }
    catch (e) {
        state.bangumiSheet = null;
        BGM.handleError(e, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'selectTargetSheet',
        });
    }
}
function toggleSheetLock() {
    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus');
    const sheetSelect = safeGetSelect('sheetSelect');
    if (!sheetSelect)
        return;
    sheetSelect.disabled = BGM.enrich.isLocked;
    if (!BGM.enrich.isLocked) {
        state.bangumiSheet = null;
    }
}
// ========== 源数据预览 ==========
function renderSourcePreview(ws, _mapping) {
    const tableContainer = safeGetElement('sourceTable');
    if (!tableContainer)
        return;
    const maxRows = 20;
    const maxCols = 50;
    const headerRow = state.headerRow;
    const dataStartRow = state.dataStartRow;
    const headerCells = [];
    for (let col = 1; col <= maxCols; col++) {
        const val = getCellValue(ws, headerRow, col).trim();
        if (val) {
            headerCells.push(escapeHtml(val));
        }
    }
    const thead = tableContainer.querySelector('thead');
    if (thead) {
        thead.innerHTML = sanitizeHtml('<tr>' + headerCells.map((h) => `<th>${h}</th>`).join('') + '</tr>');
    }
    const tbody = tableContainer.querySelector('tbody');
    if (!tbody)
        return;
    const rowsHtml = [];
    const lastRow = Math.min(getLastRow(ws), dataStartRow + maxRows - 1);
    for (let row = dataStartRow; row <= lastRow; row++) {
        const rowCells = [];
        let hasData = false;
        for (let col = 1; col <= headerCells.length; col++) {
            const val = getCellValue(ws, row, col).trim();
            if (val)
                hasData = true;
            rowCells.push(escapeHtml(val));
        }
        if (hasData) {
            rowsHtml.push(`<tr data-row="${row}">${rowCells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
        }
    }
    tbody.innerHTML = sanitizeHtml(rowsHtml.join(''));
    bgmLog(LOG_LEVELS.INFO, `[enrich] 源数据预览已渲染: ${rowsHtml.length} 行`);
}
// ========== 匹配预览 ==========
export function previewMatch() {
    if (!state.newAnimeSheet) {
        BGM.Dialog.alert('提示', '请先选择新番表文件并识别表头');
        return;
    }
    if (!state.bangumiSheet) {
        BGM.Dialog.alert('提示', '请先选择目标 Bangumi 工作表');
        return;
    }
    if (!state.columnMapping || state.columnMapping.nameCol === 0) {
        BGM.Dialog.alert('提示', '列映射未正确识别，缺少名称列');
        return;
    }
    try {
        const config = {
            filePath: state.filePath,
            sheetName: state.newAnimeSheet.Name || '',
            headerRow: state.headerRow,
            dataStartRow: state.dataStartRow,
            columnMapping: state.columnMapping,
            targetSheetName: state.bangumiSheet.Name || '',
        };
        state.matches = matchEntries(state.newAnimeSheet, state.bangumiSheet, config);
        renderMatchStats(state.matches);
        renderMatchResultsToTable(state.matches);
        bgmLog(LOG_LEVELS.INFO, `[enrich] 匹配预览完成: ${state.matches.length} 条结果`);
    }
    catch (e) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.ERROR, context: 'previewMatch' });
        BGM.Dialog.error('错误', '匹配预览失败: ' + (e instanceof Error ? e.message : String(e)));
    }
}
function renderMatchStats(matches) {
    const statsArea = safeGetElement('matchStats');
    if (!statsArea)
        return;
    const exactCount = matches.filter((m) => m.matchType === 'exact').length;
    const aliasCount = matches.filter((m) => m.matchType === 'alias').length;
    const unmatchedCount = matches.filter((m) => m.matchType === 'unmatched').length;
    const exactEl = safeGetElement('exactMatchCount');
    if (exactEl)
        exactEl.textContent = String(exactCount);
    const aliasEl = safeGetElement('aliasMatchCount');
    if (aliasEl)
        aliasEl.textContent = String(aliasCount);
    const unmatchedEl = safeGetElement('unmatchedCount');
    if (unmatchedEl)
        unmatchedEl.textContent = String(unmatchedCount);
    statsArea.style.display = '';
}
function renderMatchResultsToTable(matches) {
    const tbodyEl = safeGetElement('matchTable')?.querySelector('tbody');
    if (!tbodyEl)
        return;
    const maxDisplay = 20;
    const displayMatches = matches.slice(0, maxDisplay);
    const rowsHtml = displayMatches.map((m) => {
        let statusClass = 'match-status';
        let statusText = '';
        switch (m.matchType) {
            case 'exact':
                statusClass += ' status-exact';
                statusText = '✅ 精确';
                break;
            case 'alias':
                statusClass += ' status-alias';
                statusText = '🔄 别名';
                break;
            case 'unmatched':
                statusClass += ' status-unmatched';
                statusText = '❌ 未匹配';
                break;
            case 'error':
                statusClass += ' status-error';
                statusText = '⚠️ 错误';
                break;
        }
        const bangumiRow = m.bangumiRow ? String(m.bangumiRow) : '-';
        const name = escapeHtml(m.newAnimeName);
        const bangumiName = m.bangumiName ? escapeHtml(m.bangumiName) : '-';
        return `
      <tr class="match-row match-${m.matchType}">
        <td>${name}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
        <td>${bangumiRow}</td>
        <td>${bangumiName}</td>
      </tr>
    `;
    });
    tbodyEl.innerHTML = sanitizeHtml(rowsHtml.join(''));
    const matchTableContainer = safeGetElement('matchPreviewTable');
    if (matchTableContainer) {
        matchTableContainer.style.display = '';
    }
}
// ========== 富化执行 ==========
export function startEnrichment() {
    if (state.isEnriching) {
        bgmLog(LOG_LEVELS.WARN, '[enrich] 富化正在进行中，忽略重复请求');
        return;
    }
    if (!state.newAnimeSheet) {
        BGM.Dialog.alert('提示', '请先选择新番表文件并识别表头');
        return;
    }
    // 如果 state 中没有 bangumiSheet，尝试从锁定状态获取
    if (!state.bangumiSheet) {
        const locked = getLockedEnrichSheet();
        if (locked) {
            state.bangumiSheet = locked[1];
            bgmLog(LOG_LEVELS.INFO, `[enrich] 使用锁定的目标工作表: ${locked[1].Name}`);
        }
    }
    if (!state.bangumiSheet) {
        BGM.Dialog.alert('提示', '请先选择目标 Bangumi 工作表');
        return;
    }
    if (!state.columnMapping || state.columnMapping.nameCol === 0) {
        BGM.Dialog.alert('提示', '列映射未正确识别');
        return;
    }
    if (state.matches.length === 0) {
        previewMatch();
        if (state.matches.length === 0) {
            BGM.Dialog.alert('提示', '未匹配到任何条目，无法开始富化');
            return;
        }
    }
    state.isEnriching = true;
    state.cancelRequested = false;
    showProgressUI(true);
    const config = {
        filePath: state.filePath,
        sheetName: state.newAnimeSheet.Name || '',
        headerRow: state.headerRow,
        dataStartRow: state.dataStartRow,
        columnMapping: state.columnMapping,
        targetSheetName: state.bangumiSheet.Name || '',
    };
    const progressCallback = (progress) => {
        if (state.cancelRequested)
            return;
        updateProgressUI(progress);
    };
    try {
        bgmLog(LOG_LEVELS.INFO, `[enrich] 开始富化，共 ${state.matches.length} 条匹配`);
        const results = enrichEntries(state.newAnimeSheet, state.bangumiSheet, state.matches, config, progressCallback);
        showProgressUI(false);
        const allConflicts = collectAllConflicts(results);
        if (allConflicts.length > 0) {
            state.pendingConflicts = allConflicts;
            state.currentConflictIndex = 0;
            showConflictDialog();
        }
        else {
            renderEnrichSummary(results);
        }
        bgmLog(LOG_LEVELS.INFO, `[enrich] 富化完成: ${results.length} 条结果, 冲突 ${allConflicts.length} 条`);
    }
    catch (e) {
        BGM.handleError(e, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'startEnrichment',
        });
        BGM.Dialog.error('错误', '富化执行失败: ' + (e instanceof Error ? e.message : String(e)));
    }
    finally {
        state.isEnriching = false;
        state.cancelRequested = false;
    }
}
function cancelEnrichment() {
    if (!state.isEnriching)
        return;
    state.cancelRequested = true;
    bgmLog(LOG_LEVELS.INFO, '[enrich] 用户请求取消富化');
}
function showProgressUI(visible) {
    const progressArea = safeGetElement('enrichProgress');
    if (progressArea) {
        progressArea.style.display = visible ? '' : 'none';
    }
    const startBtn = safeGetButton('startEnrichBtn');
    if (startBtn) {
        startBtn.disabled = visible;
        startBtn.textContent = visible ? '⏳ 富化中...' : '🚀 开始富化';
    }
}
function updateProgressUI(progress) {
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    const fillEl = safeGetElement('progressBarFill');
    if (fillEl) {
        fillEl.style.width = `${percent}%`;
        fillEl.textContent = `${percent}%`;
    }
    const currentEl = safeGetElement('currentItem');
    if (currentEl) {
        currentEl.textContent = progress.currentName || '-';
    }
    const enrichedEl = safeGetElement('enrichedCount');
    if (enrichedEl)
        enrichedEl.textContent = String(progress.stats.enriched);
    const skippedEl = safeGetElement('skippedCount');
    if (skippedEl)
        skippedEl.textContent = String(progress.stats.skipped);
    const failedEl = safeGetElement('failedCount');
    if (failedEl)
        failedEl.textContent = String(progress.stats.failed);
    const etaEl = safeGetElement('etaTime');
    if (etaEl)
        etaEl.textContent = formatEta(progress.etaMs);
}
function renderEnrichSummary(results) {
    const enriched = results.filter((r) => r.kind === 'matched').length;
    const unmatched = results.filter((r) => r.kind === 'unmatched').length;
    const errors = results.filter((r) => r.kind === 'error').length;
    bgmLog(LOG_LEVELS.INFO, `[enrich] 富化摘要: 匹配 ${enriched}, 未匹配 ${unmatched}, 错误 ${errors}`);
    try {
        getOrCreateEnrichRecordSheet();
        loadRecentRecords();
    }
    catch (e) {
        BGM.handleError(e, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'renderEnrichSummary',
        });
    }
}
// ========== 富化记录 ==========
export function openEnrichRecordSheet() {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        const app = getApp();
        if (app?.ActiveWorkbook && sheet) {
            sheet.Activate();
            bgmLog(LOG_LEVELS.INFO, `[enrich] 已打开富化记录工作表: ${sheet.Name}`);
        }
    }
    catch (e) {
        BGM.handleError(e, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'openEnrichRecordSheet',
        });
        BGM.Dialog.error('错误', '无法打开富化记录工作表');
    }
}
export function clearRecords() {
    BGM.Dialog.confirm('确定要清除所有富化记录吗？此操作不可撤销。', (confirmed) => {
        if (!confirmed)
            return;
        try {
            clearEnrichRecords();
            loadRecentRecords();
            bgmLog(LOG_LEVELS.INFO, '[enrich] 富化记录已清除');
        }
        catch (e) {
            BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.ERROR, context: 'clearRecords' });
        }
    });
}
function loadRecentRecords() {
    try {
        const records = getAllEnrichRecords();
        const totalEl = safeGetElement('totalRecordCount');
        if (totalEl)
            totalEl.textContent = String(records.length);
        const successCount = records.filter((r) => r.action === 'fill' || r.action === 'append').length;
        const skipCount = records.filter((r) => r.action === 'skip').length;
        const errorCount = records.filter((r) => r.action === 'error').length;
        const successEl = safeGetElement('successRecordCount');
        if (successEl)
            successEl.textContent = String(successCount);
        const skipEl = safeGetElement('skipRecordCount');
        if (skipEl)
            skipEl.textContent = String(skipCount);
        const errorEl = safeGetElement('errorRecordCount');
        if (errorEl)
            errorEl.textContent = String(errorCount);
        const recordsContainer = safeGetElement('recentRecords');
        if (!recordsContainer)
            return;
        const recentRecords = records.slice(-10).reverse();
        if (recentRecords.length === 0) {
            recordsContainer.innerHTML = sanitizeHtml('<div class="record-empty">暂无记录</div>');
            return;
        }
        const recordsHtml = recentRecords
            .map((r) => {
            const actionClass = `record-action-${r.action}`;
            const actionText = r.action === 'fill'
                ? '填充'
                : r.action === 'append'
                    ? '追加'
                    : r.action === 'skip'
                        ? '跳过'
                        : '错误';
            const name = escapeHtml(r.name);
            const field = escapeHtml(r.enrichedField);
            const newValue = escapeHtml(r.newValue);
            const time = escapeHtml(r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN') : '');
            return `
          <div class="record-item">
            <div class="record-header">
              <span class="record-name">${name}</span>
              <span class="record-action ${actionClass}">${actionText}</span>
            </div>
            <div class="record-detail">
              <span class="record-field">${field}</span>
              <span class="record-value">${newValue}</span>
            </div>
            <div class="record-time">${time}</div>
          </div>
        `;
        })
            .join('');
        recordsContainer.innerHTML = sanitizeHtml(recordsHtml);
        bgmLog(LOG_LEVELS.INFO, `[enrich] 最近记录已加载: ${records.length} 条`);
    }
    catch (e) {
        BGM.handleError(e, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'loadRecentRecords',
        });
    }
}
// ========== 预览表格渲染（导出函数） ==========
export function renderPreviewTable(container, sheet, _mapping, maxRows = 20) {
    if (!container)
        return;
    const headerRow = state.headerRow;
    if (headerRow === 0)
        return;
    const maxCols = 50;
    const headerCells = [];
    for (let col = 1; col <= maxCols; col++) {
        const val = getCellValue(sheet, headerRow, col).trim();
        if (val)
            headerCells.push(escapeHtml(val));
    }
    const dataStartRow = state.dataStartRow;
    const lastRow = Math.min(getLastRow(sheet), dataStartRow + maxRows - 1);
    const bodyRows = [];
    for (let row = dataStartRow; row <= lastRow; row++) {
        const cells = [];
        let hasData = false;
        for (let col = 1; col <= headerCells.length; col++) {
            const val = getCellValue(sheet, row, col).trim();
            if (val)
                hasData = true;
            cells.push(escapeHtml(val));
        }
        if (hasData) {
            bodyRows.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
        }
    }
    const html = `
    <table class="preview-table">
      <thead><tr>${headerCells.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows.join('')}</tbody>
    </table>
  `;
    container.innerHTML = sanitizeHtml(html);
}
export function renderMatchResults(container, matches) {
    if (!container)
        return;
    const maxDisplay = 20;
    const displayMatches = matches.slice(0, maxDisplay);
    const rowsHtml = displayMatches.map((m) => {
        let statusClass = '';
        let statusText = '';
        switch (m.matchType) {
            case 'exact':
                statusClass = 'status-exact';
                statusText = '✅ 精确';
                break;
            case 'alias':
                statusClass = 'status-alias';
                statusText = '🔄 别名';
                break;
            case 'unmatched':
                statusClass = 'status-unmatched';
                statusText = '❌ 未匹配';
                break;
            case 'error':
                statusClass = 'status-error';
                statusText = '⚠️ 错误';
                break;
        }
        const name = escapeHtml(m.newAnimeName);
        const bangumiRow = m.bangumiRow ? String(m.bangumiRow) : '-';
        const bangumiName = m.bangumiName ? escapeHtml(m.bangumiName) : '-';
        return `
      <tr class="match-${m.matchType}">
        <td>${name}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
        <td>${bangumiRow}</td>
        <td>${bangumiName}</td>
      </tr>
    `;
    });
    const html = `
    <table class="preview-table">
      <thead><tr><th>动漫名</th><th>匹配方式</th><th>Bangumi行号</th><th> Bangumi名称</th></tr></thead>
      <tbody>${rowsHtml.join('')}</tbody>
    </table>
  `;
    container.innerHTML = sanitizeHtml(html);
}
export function renderProgress(progress) {
    updateProgressUI(progress);
}
// ========== 冲突对话框 ==========
function collectAllConflicts(results) {
    const all = [];
    for (const r of results) {
        if (r.conflicts && r.conflicts.length > 0) {
            all.push(...r.conflicts);
        }
    }
    return all;
}
function showConflictDialog() {
    const dialogEl = safeGetElement('conflictDialog');
    if (!dialogEl)
        return;
    const conflict = state.pendingConflicts[state.currentConflictIndex];
    if (!conflict) {
        hideConflictDialog();
        return;
    }
    const total = state.pendingConflicts.length;
    const current = state.currentConflictIndex + 1;
    const percent = Math.round((current / total) * 100);
    const html = `
    <div class="conflict-header">
      <span class="conflict-title">⚡ 字段冲突确认 (${current}/${total})</span>
      <div class="conflict-progress">
        <div style="width:${percent}%;height:4px;background:#4a90d9;border-radius:2px;"></div>
      </div>
    </div>
    <div class="conflict-body">
      <div class="conflict-item">
        <div class="conflict-row">
          <span class="conflict-label">条目：</span>
          <span class="conflict-name">${escapeHtml(conflict.newAnimeName)}</span>
        </div>
        <div class="conflict-row">
          <span class="conflict-label">字段：</span>
          <span class="conflict-field">${escapeHtml(conflict.fieldName)}</span>
        </div>
        <div class="conflict-row">
          <span class="conflict-label">现有值：</span>
          <span class="conflict-old">${escapeHtml(conflict.oldValue)}</span>
        </div>
        <div class="conflict-row">
          <span class="conflict-label">新番表值：</span>
          <span class="conflict-new">${escapeHtml(conflict.newValue)}</span>
        </div>
      </div>
      <div class="conflict-hint">💡 选择如何处理此冲突</div>
    </div>
    <div class="conflict-footer">
      <button class="btn conflict-btn-btn" id="conflictAppend" data-resolution="append">
        🔗 全部增量更新
      </button>
      <button class="btn conflict-btn-keep" id="conflictKeep" data-resolution="keep">
        📋 保留原名
      </button>
      <button class="btn conflict-btn-overwrite" id="conflictOverwrite" data-resolution="overwrite">
        ✏️ 使用新番表名
      </button>
    </div>
  `;
    dialogEl.innerHTML = sanitizeHtml(html);
    dialogEl.style.display = 'block';
    dialogEl.querySelectorAll('[data-resolution]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const resolution = btn.dataset.resolution;
            handleConflictResolution(resolution);
        });
    });
}
function hideConflictDialog() {
    const dialogEl = safeGetElement('conflictDialog');
    if (dialogEl) {
        dialogEl.style.display = 'none';
        dialogEl.innerHTML = '';
    }
}
function handleConflictResolution(resolution) {
    const conflict = state.pendingConflicts[state.currentConflictIndex];
    if (!conflict)
        return;
    conflict.resolution = resolution;
    try {
        const enriched = [];
        if (state.bangumiSheet) {
            resolveConflictField(state.bangumiSheet, conflict, enriched);
        }
        bgmLog(LOG_LEVELS.INFO, `[conflict] 字段 "${conflict.fieldName}" (${conflict.newAnimeName}): ${resolution}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, `[conflict] 解析冲突失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    state.currentConflictIndex++;
    if (state.currentConflictIndex < state.pendingConflicts.length) {
        showConflictDialog();
    }
    else {
        hideConflictDialog();
        bgmLog(LOG_LEVELS.INFO, '[conflict] 所有冲突已解决');
        BGM.Dialog.alert('冲突解决完成', `共处理 ${state.currentConflictIndex} 个字段冲突`);
    }
}
// ========== 导出 ==========
export { state, cancelEnrichment, COLUMN_MAPPING_FIELDS };
