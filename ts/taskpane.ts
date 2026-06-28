/**
 * 任务面板主模块（TypeScript 版）
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑
 */


import { PANEL_CONFIG, WPS_ENUM , LOG_LEVELS ,getApp, bgmLog, BGM, escapeHtml, getCellValue, colNumToLetter,HEADER_KEYWORDS, IMPORTANT_COLS  , updateTokenStatus, updateUserIdStatus, loadBgToken, showTokenDialog, showUserIdDialog ,
     showAlert, showToast ,closeDetailModal,getFilterStatus,    getLastRow,clearSheetCache,WpsWorksheet, _getBgmUserId, _getBgmUsername, _setBgmUserId, _setBgmUsername,
     getIncrementalSync, getSkipConflicts, getSyncRecordEnabled
}from './index.js';
// ========== 类型定义 ==========
interface LockedSheetInfo {
    index: number;
    name: string;
}

interface CandidateHeader {
    row: number;
    matchCount: number;
    colCount: number;
}

interface HeaderMeta {
    headerRow: number;
    headerNames: string[];
    isImportant: boolean[];
    dataStartRow: number;
    lastCol: number;
    firstDataCol: number;
    previewColStart: number;        // 切片后的数组起始索引（0）
    previewColEnd: number;          // 切片后的列数
    previewColStartAbsolute: number; // 新增：预览第一列的实际列号（1‑based）
    headerMatchCount: number;
}

interface FilterState {
    isFiltered: boolean;
    visibleRowSet: Set<number> | null;
}

interface PreviewRow {
    row: number;
    cols: string[] | { text: string; important: boolean }[];
    isHeader: boolean;
    aligned: boolean;
    isImportant?: boolean[];
}

// ========== 工作表锁定功能 ==========

function toggleSheetLock(): void {
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null;
    if (!select) return;

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
    } else {
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

function saveLockedSheet(info: LockedSheetInfo | null): void {
    const app = getApp();
    if (app?.PluginStorage) {
        app.PluginStorage.setItem('bgm_locked_sheet', info ? JSON.stringify(info) : '');
    }
}

function restoreLockedSheet(): boolean {
    const app = getApp();
    if (app?.PluginStorage) {
        const raw = app.PluginStorage.getItem('bgm_locked_sheet');
        if (raw) {
            try {
                const info = JSON.parse(raw) as LockedSheetInfo;
                BGM.sheet.lockedIndex = (info.index != null) ? info.index : null;
                BGM.sheet.lockedName = info.name || null;
                BGM.sheet.isLocked = !!(info.index != null && info.name);
                return true;
            } catch (e: unknown) {
                BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'restoreLockedSheet' });
                saveLockedSheet(null);
            }
        }
    }
    return false;
}

function updateLockButton(): void {
    const btn = document.getElementById('lockSheetBtn') as HTMLButtonElement | null;
    const status = document.getElementById('lockStatus') as HTMLElement | null;

    if (btn) {
        if (BGM.sheet.isLocked) {
            btn.textContent = '🔓 解锁';
            btn.classList.add('locked');
        } else {
            btn.textContent = '🔒 锁定';
            btn.classList.remove('locked');
        }
    }

    if (status) {
        if (BGM.sheet.isLocked) {
            status.style.display = 'inline';
            status.textContent = '已锁定: ' + BGM.sheet.lockedName;
        } else {
            status.style.display = 'none';
        }
    }
}

function refreshSheets(opts?: { autoSelectActive?: boolean }): void {
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null;
    if (!select) return;

    const app = getApp();
    if (!app?.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.WARN, 'refreshSheets: 无法获取 ActiveWorkbook');
        return;
    }

    const workbook = app.ActiveWorkbook;
    const sheets = workbook.Worksheets;

    // 探测当前活动工作表索引（autoSelectActive 时用于自动选中）
    let activeSheetIndex = 0;
    try {
        const activeSheet = workbook.ActiveSheet;
        if (activeSheet) {
            for (let i = 1; i <= sheets.Count; i++) {
                if (sheets.Item(i) === activeSheet) {
                    activeSheetIndex = i;
                    break;
                }
            }
        }
    } catch (e: unknown) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'refreshSheets.getActiveSheet' });
    }

    select.innerHTML = '<option value="">-- 请选择 --</option>';

    const autoSelectActive = opts?.autoSelectActive === true;
    let selectedIndex = 0;
    for (let i = 1; i <= sheets.Count; i++) {
        const option = document.createElement('option');
        option.value = String(i);
        option.text = sheets.Item(i).Name;

        if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === i) {
            option.selected = true;
            selectedIndex = i;
        } else if (autoSelectActive && !BGM.sheet.isLocked && i === activeSheetIndex) {
            option.selected = true;
            selectedIndex = i;
        }

        select.appendChild(option);
    }

    // 同步 select.value，selectedIndex 已通过 option.selected 设置
    if (selectedIndex > 0) {
        select.value = String(selectedIndex);
        bgmLog(LOG_LEVELS.INFO, `[refreshSheets] ${autoSelectActive ? '自动选中' : '已锁定'} 工作表索引: ${selectedIndex}`);
    } else if (autoSelectActive && activeSheetIndex > 0) {
        select.value = String(activeSheetIndex);
        bgmLog(LOG_LEVELS.INFO, `[refreshSheets] 自动选中当前活动工作表: ${activeSheetIndex}`);
    } else {
        select.value = '';
    }

    updateLockButton();
}

function activateSheetIfNeeded(ws: WpsWorksheet): (() => void) | false {
    const app = getApp();
    if (!app?.ActiveWorkbook) return false;  // 确保工作簿存在

    try {
        const active = app.ActiveWorkbook.ActiveSheet;
        if (!active || !ws) return false;     // ✅ 防止 undefined

        const activeName = active.Name || '';
        if (activeName !== (ws.Name || '')) {
            ws.Activate();
            return function restore() {
                try { active.Activate(); } catch (e: unknown) {
                    BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'activateSheetIfNeeded' });
                }
            };
        }
    } catch (e: unknown) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'activateSheetIfNeeded' });
    }
    return false;
}

// ========== 表头检测 ==========

function detectHeaderAndColumns(ws: WpsWorksheet | null | undefined, opts: { visibleRowSet?: Set<number> | null; isFiltered?: boolean } = {}): HeaderMeta {
    const { visibleRowSet = null, isFiltered = false } = opts;

    // 判断某行是否可见
    function isRowVisible(r: number, headerRow: number): boolean {
        if (r === headerRow) return true;
        return !isFiltered || (visibleRowSet !== null && visibleRowSet.has(r));
    }

    // 1. 扫描前 MAX_SCAN_ROWS 行，找出所有候选表头行
    const candidates: CandidateHeader[] = [];
    for (let r = 1; r <= PANEL_CONFIG.MAX_SCAN_ROWS; r++) {
        if (!isFiltered || !visibleRowSet || visibleRowSet.has(r)) {
            let matchCount = 0;
            let colCount = 0;
           for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
                try {
                    const v = getCellValue(ws, r, c).trim();
                    if (v) {
                        colCount++;
                        const cv = v.toLowerCase();
                        if (HEADER_KEYWORDS.some(kw => cv === kw || cv.includes(kw))) {
                            matchCount++;
                        }
                    }
                } catch (cellError) {
                    BGM.handleError(cellError, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'detectHeaderAndColumns' });
                    // 单个单元格读取失败，不影响该行其他列
                    continue;
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
           lastCol: 0, firstDataCol: 0, previewColStart: 0, previewColEnd: 0, previewColStartAbsolute: 0, headerMatchCount: 0
        };
    }

    // 选列数最多、行号最小的作为表头
    candidates.sort((a, b) => b.colCount - a.colCount || a.row - b.row);
    const headerRow = candidates[0].row;
    const headerMatchCount = candidates[0].matchCount;

    // 2. 读取表头名称
    const headerNames: string[] = [];
    const headerIsImportant: boolean[] = [];
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
        const v = getCellValue(ws, headerRow, c).trim();
        headerNames.push(v);
        headerIsImportant.push(IMPORTANT_COLS[v.toLowerCase()] || false);
    }

    // 3. 检测多行表头（下一行是否填充了当前表头的空列）
    let dataStartRow = headerRow + 1;
    const secondHeaderRowLimit = Math.min(headerRow + 1, PANEL_CONFIG.MAX_SCAN_ROWS);
    if (headerRow + 1 <= secondHeaderRowLimit) {
        let filled = 0, total = 0;
        for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
            const nv = getCellValue(ws, headerRow + 1, c).trim();
            if (nv) {
                total++;
                if (!headerNames[c - 1]) filled++;
            }
        }
        if (filled >= 3 && total >= 3) {
            dataStartRow = headerRow + 2;
            for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
                if (!headerNames[c - 1]) {
                    const nv = getCellValue(ws, headerRow + 1, c).trim();
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
        if (!isRowVisible(dr, headerRow)) continue;
        samples++;
        for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
            const v = getCellValue(ws, dr, c).trim();
            if (v) {
                if (firstDataCol < 0) firstDataCol = c;
                if (c > lastDataCol) lastDataCol = c;
            }
        }
    }
    if (firstDataCol < 0) firstDataCol = 1;

    // 表头结束列
    let headerLastCol = 0;
    for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
        if (headerNames[c - 1]) headerLastCol = c;
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
         headerNames: headerNames.slice(previewColStart - 1, previewColEnd),
         isImportant: headerIsImportant.slice(previewColStart - 1, previewColEnd),
         dataStartRow,
         lastCol: actualLastCol,
         firstDataCol,
         previewColStart: 0,                             // 保留，但不用于数据读取
         previewColEnd: previewColEnd - previewColStart + 1,
         previewColStartAbsolute: previewColStart,   // 新增，实际列号
         headerMatchCount
    };
}

function autoDetectSheet(): { sheetIndex: number; sheetName: string; headerRow: number; matchCount: number; colCount: number } | null {
    const app = getApp();
    if (!app?.ActiveWorkbook) { 
        BGM.handleError(new Error('Application 不可用'), { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' });
        return null;
    }

    const sheets = app.ActiveWorkbook.Worksheets;
    let bestMatch: { sheetIndex: number; sheetName: string; headerRow: number; matchCount: number; colCount: number } | null = null;

    bgmLog(LOG_LEVELS.INFO, `autoDetectSheet: 开始扫描 ${sheets.Count} 个工作表...`);

    for (let si = 1; si <= sheets.Count; si++) {
        let needRestore: (() => void) | false = false;
        try {
            const ws : WpsWorksheet = sheets.Item(si);
            if (!ws || typeof ws.Activate !== 'function') {
                BGM.handleError(new Error(`autoDetectSheet: 工作表索引 ${si} 为 null 或无法访问，已跳过`), { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' });
                continue;
            }

            const sheetName = ws.Name || '';
            // 跳过特定系统表（例如同步记录等）
            if (/^(同步记录|SyncRecord|模糊|搜索|SEARCH)/i.test(sheetName)) {
                BGM.handleError(new Error(`autoDetectSheet: 跳过系统工作表 "${sheetName}"`), { showAlert: false, level: BGM.ErrorLevel.INFO ,context: 'autoDetectSheet' });
                continue;
            }

            bgmLog(LOG_LEVELS.INFO, `autoDetectSheet: 正在分析工作表 "${sheetName}"`);
                
            needRestore = activateSheetIfNeeded(ws);
            const meta = detectHeaderAndColumns(ws);

            if (meta.headerRow === 0) {
                bgmLog(LOG_LEVELS.INFO, `  => 工作表 "${sheetName}" 未检测到有效表头 (headerRow=0), 已跳过`);
                continue;
            }

            // 检查表头下方是否有足够的数据行
            let dataRowCount = 0;
            let firstDataRow = -1;
            for (let dr = meta.dataStartRow; dr <= meta.dataStartRow + 10; dr++) {
                let hasAny = false;
                for (let c = 1; c <= meta.lastCol; c++) {
                    if (getCellValue(ws, dr, c).trim()) { hasAny = true; break; }
                }
                if (hasAny) {
                    dataRowCount++;
                    if (firstDataRow < 0) firstDataRow = dr;
                }
            }

            BGM.handleError(new Error(`  => 工作表 "${sheetName}" 表头行 ${meta.headerRow}, 匹配关键词数 ${meta.headerMatchCount}, ` +
                `数据列数 ${meta.lastCol}, 前10行含数据行数 ${dataRowCount}`), { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' });

            if (dataRowCount < 2) {
                BGM.handleError(new Error(`  => 数据行不足 (${dataRowCount} 行)，不视为有效数据表`), { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' });
                continue;
            }

            // 判断是否更优
            const isBetter = !bestMatch ||
                meta.lastCol > bestMatch.colCount ||
                (meta.lastCol === bestMatch.colCount && meta.headerMatchCount > bestMatch.matchCount);

            BGM.handleError(new Error(`  => 是否为当前最优: ${isBetter ? '是' : '否'} (现有最优: ${bestMatch ? `${bestMatch.sheetName}(列${bestMatch.colCount})` : '无'})`), { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' });

            if (isBetter) {
                bestMatch = {
                    sheetIndex: si,
                    sheetName: sheetName,
                    headerRow: meta.headerRow,
                    matchCount: meta.headerMatchCount,
                    colCount: meta.lastCol
                };
            }
        } catch (e: unknown) {
            BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'autoDetectSheet' });
        } finally {
            if (typeof needRestore === 'function') needRestore();
        }
    }

    if (bestMatch) {
        bgmLog(LOG_LEVELS.INFO, `autoDetectSheet: 最终选中工作表 "${bestMatch.sheetName}" (列${bestMatch.colCount}, 行${bestMatch.headerRow})`);
    } else {
        bgmLog(LOG_LEVELS.WARN, 'autoDetectSheet: 未在任何工作表中找到有效数据表头（可在切换工作表后手动选择）');
    }
    return bestMatch;
}
// ========== 筛选状态 ==========

function updateFilterStatus(targetWs?: WpsWorksheet): void {
    const el = document.getElementById('filterStatus');
    if (!el) return;

    const app = getApp();
    const sheet = targetWs || app?.ActiveWorkbook?.ActiveSheet;
        if (!sheet) {
            // 处理：显示提示、返回等
            return;
        }
// 现在 sheet 被收窄为 WpsWorksheet
const ws: WpsWorksheet | null | undefined = sheet;
if (!ws) { el.textContent = '未连接到工作表'; return; }

    let autoFilterMode = false;
    try { autoFilterMode = !!ws.AutoFilterMode; } catch (e: unknown) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'updateFilterStatus' });
    }
    try { if (!autoFilterMode && ws.AutoFilter) autoFilterMode = !!ws.AutoFilter.Mode; } catch (e: unknown) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'updateFilterStatus' });
    }

    if (!autoFilterMode) {
        el.textContent = '未开启筛选，同步全部数据';
        el.removeAttribute('title');
        return;
    }

    try {
        const autoFilter = ws.AutoFilter;
        if (!autoFilter) { el.textContent = '筛选已开启但无活动筛选'; return; }
        const filters = autoFilter.Filters;
        if (!filters || !filters.Count) { el.textContent = '筛选已开启但无活动筛选，同步全部数据'; return; }

        const activeCols: string[] = [];
        for (let i = 1; i <= filters.Count; i++) {
            try {
                const f = filters.Item ? filters.Item(i) : filters(i);
                if (f?.On) {
                    let colName = '';
                    try {
                        const headerCell = ws.Range(colNumToLetter(i) + '1');
                        if (headerCell) colName = String(headerCell.Value2 || '').substring(0, 12);
                    } catch (e: unknown) {
                        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'updateFilterStatus' });
                    }
                    let criteria = f.Criteria1 || '';
                    if (f.Criteria2) {
                        const op = f.Operator;
                        criteria += op === 1 ? ' 且 ' + f.Criteria2 : op === 2 ? ' 或 ' + f.Criteria2 : ' / ' + f.Criteria2;
                    }
                    activeCols.push(colName ? `${colName}(${criteria})` : `列${i}`);
                }
            } catch (e: unknown) {
                BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'updateFilterStatus' });
            }
        }

        if (activeCols.length > 0) {
            const text = `✔ 筛选已开启（${activeCols.length} 列），将同步筛选后的可见数据\n${activeCols.join('、')}`;
            el.textContent = text;
            el.setAttribute('title', text);
        } else {
            el.textContent = '筛选已开启但无活动筛选，同步全部数据';
            el.removeAttribute('title');
        }
    } catch (e: unknown) {
        el.textContent = '检测筛选状态失败: ' + (e as Error).message;
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'updateFilterStatus' });
    }
}


// ========== 预览渲染 ==========

function renderPreviewTable(rows: PreviewRow[], sheetIndex: number, sheetName: string, headerRow: number): string {
    let html = '<table class="preview-table"><tbody>';
    rows.forEach(item => {
        const rowClass = item.isHeader ? 'preview-header-row' : '';
        html += `<tr class="${rowClass}">`;
        html += `<td class="preview-row-num">${item.isHeader ? 'H' : item.row}</td>`;
        if (item.aligned) {
            const cols = item.cols as string[];
            const lastNonEmpty = cols.map((v, i) => v ? i : -1).filter(i => i >= 0).pop() ?? -1;
            const colLimit = lastNonEmpty + 1;
            for (let i = 0; i < colLimit; i++) {
                const text = cols[i] || '';
                let cls = '';
                if (item.isHeader) {
                    cls = 'preview-header';
                    if (item.isImportant?.[i]) cls += ' preview-important-header';
                }
                html += `<td class="${cls}">${escapeHtml(String(text))}</td>`;
            }
        }
        html += '</tr>';
    });
    html += '</tbody></table>';
    html += `<p class="hint">已选择工作表索引: ${sheetIndex} (${escapeHtml(sheetName)})`;
    if (headerRow) html += ` | 表头行: ${headerRow}`;
    html += '</p>';
    return html;
}

function refreshData(): void {
    bgmLog(LOG_LEVELS.INFO, 'refreshData 开始执行');
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null;
    const previewBox = document.getElementById('previewBox');
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value || '') || 0;

    if (!sheetIndex) {
        if (previewBox) previewBox.innerHTML = '<p class="hint">请先选择工作表</p>';
        updateFilterStatus();
        return;
    }

    const app = getApp();
    if (!app?.ActiveWorkbook) {
        if (previewBox) previewBox.innerHTML = '<p class="hint">未连接到 Excel</p>';
        updateFilterStatus();
        return;
    }

    let ws: WpsWorksheet | null | undefined = null;
    try { ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex); }
    catch (e: unknown) {
        if (previewBox) previewBox.innerHTML = `<p class="hint">无法获取工作表: ${sheetIndex}</p>`;
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'refreshData' });
        updateFilterStatus();
        return;
    }
     // ✅ 增加判空，防止 Item 返回 null/undefined
    if (!ws || typeof ws.Activate !== 'function') {
        if (previewBox) previewBox.innerHTML = `<p class="hint">无法访问工作表 ${sheetIndex}</p>`;
        BGM.handleError(new Error(`无法访问工作表 ${sheetIndex}`), { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'refreshData' });
        updateFilterStatus();
        return;
    }


    const sheetName = ws.Name || '';
    // 清除该工作表所有缓存，确保获取到最新数据
    if (typeof clearSheetCache === 'function') {
        clearSheetCache(ws);
    }
    const needRestore = activateSheetIfNeeded(ws);
    try {
        // 获取最后数据行（强制刷新，不使用缓存）
        const lastRow = getLastRow(ws, true);
        bgmLog(LOG_LEVELS.INFO, `工作表最后数据行: ${lastRow}`);

        // 使用统一的筛选状态检测
        const filterStatus = getFilterStatus(ws, lastRow);
        const isFiltered = filterStatus ? filterStatus.hasFilter : false;
        const visibleRows = filterStatus?.visibleRows || [];
        const visibleRowSet = isFiltered ? new Set<number>(visibleRows) : null;

        // 记录筛选状态详情
        bgmLog(LOG_LEVELS.INFO, `筛选状态: isFiltered=${isFiltered}, 可见行数=${visibleRows.length}`);
        if (isFiltered && visibleRows.length > 0) {
            bgmLog(LOG_LEVELS.INFO, `可见行列表(前10): ${visibleRows.slice(0, 10).join(',')}`);
        }

        const meta = detectHeaderAndColumns(ws, { visibleRowSet, isFiltered });
        // ✅ 保存供 previewSyncContent 使用
        BGM.dataPreview = {
            ws,                          // 工作表引用
            visibleRows: filterStatus.visibleRows,   // 筛选后可见行（含表头）
            headerRow: meta.headerRow,
            dataStartRow: meta.dataStartRow,
            previewColStart: meta.previewColStartAbsolute,  // 实际起始列号
            previewColEnd: meta.previewColStartAbsolute + (meta.previewColEnd - meta.previewColStart) - 1,
            columnCount: meta.previewColEnd - meta.previewColStart,
            headerNames: meta.headerNames.slice(meta.previewColStart, meta.previewColEnd),
            isImportant: meta.isImportant.slice(meta.previewColStart, meta.previewColEnd),
        };
        bgmLog(LOG_LEVELS.INFO, `表头检测: headerRow=${meta.headerRow}, dataStartRow=${meta.dataStartRow}, 列数=${meta.previewColEnd - meta.previewColStart}`);

        const previewRows: PreviewRow[] = [];
        let hasData = false;

            if (meta.headerRow > 0) {
                previewRows.push({
                    row: -1,
                    cols: meta.headerNames.slice(meta.previewColStart, meta.previewColEnd),
                    isHeader: true,
                    aligned: true,
                    isImportant: meta.isImportant.slice(meta.previewColStart, meta.previewColEnd),
                });
            
                const displayColCount = meta.previewColEnd - meta.previewColStart;
                // 使用 visibleRows 过滤，而不是遍历整个范围
                // 防御性排序 + 去重：确保行号严格升序且无重复（修复"190-201后跳到3"问题）
                const dataRows = Array.from(new Set(
                    (filterStatus?.visibleRows || [])
                        .filter(r => r !== meta.headerRow && r >= meta.dataStartRow)
                )).sort((a, b) => a - b);
                const maxPreview = Math.min(dataRows.length, PANEL_CONFIG.PREVIEW_LIMIT);

                // 批量读取：按连续行段一次性读取 Range.Value2，减少 COM 调用次数
                let i = 0;
                while (i < maxPreview) {
                    // 找到连续行段
                    let j = i;
                    while (j + 1 < maxPreview && dataRows[j + 1] === dataRows[j] + 1) j++;
                    const segStart = dataRows[i];
                    const segLen = j - i + 1;

                    try {
                        // 一次性读取整个矩形区域
                        const startColLetter = colNumToLetter(meta.previewColStartAbsolute);
                        const endColLetter = colNumToLetter(meta.previewColStartAbsolute + displayColCount - 1);
                        const rangeAddr = ws.Range(`${startColLetter}${segStart}:${endColLetter}${segStart + segLen - 1}`);
                        const raw = rangeAddr.Value2;
                        // WPS 返回二维数组（1-based），或单值
                        const is2D = Array.isArray(raw);
                        for (let r = 0; r < segLen; r++) {
                            const dr = dataRows[i + r];
                            const rowCols: string[] = [];
                            let hasAny = false;
                            for (let ci = 0; ci < displayColCount; ci++) {
                                let v: string;
                                if (is2D && Array.isArray(raw)) {
                                    const cell = raw[r + 1][ci + 1];
                                    v = cell == null ? '' : String(cell).trim();
                                } else {
                                    v = segLen === 1 && displayColCount === 1
                                        ? (raw == null ? '' : String(raw).trim())
                                        : getCellValue(ws, dr, meta.previewColStartAbsolute + ci).trim();
                                }
                                if (v) hasAny = true;
                                rowCols.push(v);
                            }
                            if (hasAny) {
                                previewRows.push({ row: dr, cols: rowCols, isHeader: false, aligned: true });
                                hasData = true;
                            }
                        }
                    } catch (batchErr) {
                        // 批量读取失败，回退到逐单元格
                        for (let r = 0; r < segLen; r++) {
                            const dr = dataRows[i + r];
                            const rowCols: string[] = [];
                            let hasAny = false;
                            for (let ci = 0; ci < displayColCount; ci++) {
                                const col = meta.previewColStartAbsolute + ci;
                                const v = getCellValue(ws, dr, col).trim();
                                if (v) hasAny = true;
                                rowCols.push(v);
                            }
                            if (hasAny) {
                                previewRows.push({ row: dr, cols: rowCols, isHeader: false, aligned: true });
                                hasData = true;
                            }
                        }
                    }
                    i = j + 1;
                }
            }else {
            // 无表头时的回退逻辑
            let count = 0;
            for (let r = 1; r <= Math.min(lastRow, 100) && count < 5; r++) {
                if (isFiltered && visibleRowSet && !visibleRowSet.has(r)) continue;
                const cols: { text: string; important: boolean }[] = [];
                let any = false;
                for (let c = 1; c <= PANEL_CONFIG.MAX_SCAN_COLUMNS; c++) {
                    const v = getCellValue(ws, r, c).trim();
                    if (v) { cols.push({ text: v, important: false }); any = true; }
                }
                if (any) {
                    previewRows.push({ row: r, cols, isHeader: false, aligned: true });
                    hasData = true;
                    count++;
                }
            }
        }

        bgmLog(LOG_LEVELS.INFO, `生成预览行数: ${previewRows.length}, 其中数据行: ${previewRows.filter(p => !p.isHeader).length}`);

        if (hasData && !BGM.sheet.isLocked) {
            BGM.sheet.lockedIndex = sheetIndex;
            BGM.sheet.lockedName = sheetName;
            BGM.sheet.isLocked = true;
            saveLockedSheet({ index: sheetIndex, name: sheetName });
            updateLockButton();
            if (select) select.value = String(sheetIndex);
            showToast('已自动锁定工作表: ' + sheetName, 'info');
        }

        if (previewBox) {
            previewBox.innerHTML = previewRows.length > 0
                ? renderPreviewTable(previewRows, sheetIndex, sheetName, meta.headerRow)
                : `<p class="hint">已选择工作表索引: ${sheetIndex} (${escapeHtml(sheetName)})<br>未检测到数据</p>`;
        }
        updateFilterStatus(ws);
    } finally {
        if (needRestore) needRestore();
    }
    bgmLog(LOG_LEVELS.INFO, `refreshData 完成, hasData=${previewBox != null}`);
}

function onSelectModeChange(): void {
    const manualInputs = document.getElementById('manualRangeInputs');
    const autoInfo = document.getElementById('autoRangeInfo');
    const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="selectMode"]');

    for (const radio of modeRadios) {
        if (radio.checked) {
            if (radio.value === 'manual') {
                if (manualInputs) manualInputs.style.display = 'block';
                if (autoInfo) autoInfo.style.display = 'none';
            } else {
                if (manualInputs) manualInputs.style.display = 'none';
                if (autoInfo) autoInfo.style.display = 'block';
            }
            break;
        }
    }
}

// ========== 初始化 ==========

/**
 * 从 PluginStorage 恢复用户信息到内存缓存
 * Ribbon 设置的用户信息通过 PluginStorage 在 Ribbon 和 Taskpane 之间共享
 */
function restoreUserInfoFromStorage(): void {
    try {
        const app = getApp();
        if (!app?.PluginStorage) {
            bgmLog(LOG_LEVELS.INFO, '[restoreUserInfoFromStorage] PluginStorage 不可用');
            return;
        }
        const storedUserId = app.PluginStorage.getItem('bgm_user_id');
        const storedUsername = app.PluginStorage.getItem('bgm_username');
        
        if (storedUserId) {
            BGM.cache.userId = storedUserId;
            bgmLog(LOG_LEVELS.INFO, `[restoreUserInfoFromStorage] 恢复 userId: ${storedUserId}`);
        }
        if (storedUsername) {
            BGM.cache.username = storedUsername;
            bgmLog(LOG_LEVELS.INFO, `[restoreUserInfoFromStorage] 恢复 username: ${storedUsername}`);
        }
        if (storedUserId || storedUsername) {
            updateUserIdStatus();
        }
    } catch (e: unknown) {
        bgmLog(LOG_LEVELS.WARN, `[restoreUserInfoFromStorage] 恢复失败: ${(e as Error).message}`);
    }
}

/**
 * 定时轮询 PluginStorage 检查用户信息和 Token 变更
 * 由于 WPS 中 Ribbon 和 Taskpane 是独立 iframe，postMessage 无法跨上下文通信，
 * 因此 Taskpane 需要定期从 PluginStorage 读取最新数据并更新 UI。
 */
function startUserInfoPolling(): void {
    let lastUserId = BGM.cache.userId || null;
    let lastUsername = BGM.cache.username || null;
    let lastToken = loadBgToken();
    let lastIncrementalSync: boolean | null = null;
    let lastSkipConflicts: boolean | null = null;
    let lastEnableSyncRecord: boolean | null = null;
    let lastPanelShownAt: string | null = null;

    const pollingInterval = setInterval(() => {
        try {
            const currentUserId = _getBgmUserId();
            const currentUsername = _getBgmUsername();
            const currentToken = loadBgToken();

            const userInfoChanged = currentUserId !== lastUserId || currentUsername !== lastUsername;
            const tokenChanged = currentToken !== lastToken;

            if (userInfoChanged) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到用户信息变更: userId=${currentUserId || '(无)'}, username=${currentUsername || '(无)'}`);
                lastUserId = currentUserId;
                lastUsername = currentUsername;
                if (currentUserId) BGM.cache.userId = currentUserId;
                if (currentUsername) BGM.cache.username = currentUsername;
                updateUserIdStatus();
            }

            if (tokenChanged) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到 Token 变更: ${currentToken ? '已设置' : '已清除'}`);
                lastToken = currentToken;
                if (!currentToken) {
                    BGM.cache.userId = null;
                    BGM.cache.username = null;
                }
                updateTokenStatus();
                updateUserIdStatus();
            }

            // 同步 Ribbon 的配置变更到 Taskpane UI（增量同步 + 跳过冲突，静默读取避免日志刷屏）
            const currentIncrementalSync = getIncrementalSync(true);
            const currentSkipConflicts = getSkipConflicts(true);

            if (currentIncrementalSync !== lastIncrementalSync) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到增量同步配置变更: ${currentIncrementalSync ? '开启' : '关闭'}`);
                lastIncrementalSync = currentIncrementalSync;
                const chkIncremental = document.getElementById('chkIncremental') as HTMLInputElement;
                if (chkIncremental) {
                    chkIncremental.checked = currentIncrementalSync;
                    bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 增量同步复选框已同步: ${currentIncrementalSync ? '开启' : '关闭'}`);
                }
            }

            if (currentSkipConflicts !== lastSkipConflicts) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到跳过冲突配置变更: ${currentSkipConflicts ? '跳过' : 'Excel覆盖'}`);
                lastSkipConflicts = currentSkipConflicts;
                const conflictStrategySelect = document.getElementById('conflictStrategy') as HTMLSelectElement;
                if (conflictStrategySelect) {
                    conflictStrategySelect.value = currentSkipConflicts ? 'skip' : 'excel';
                    bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 冲突策略 select 已同步: ${conflictStrategySelect.value}`);
                }
            }

            const currentEnableSyncRecord = getSyncRecordEnabled(true);
            if (currentEnableSyncRecord !== lastEnableSyncRecord) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到同步记录开关变更: ${currentEnableSyncRecord ? '开启' : '关闭'}`);
                lastEnableSyncRecord = currentEnableSyncRecord;
                const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord') as HTMLInputElement;
                if (chkEnableSyncRecord) {
                    chkEnableSyncRecord.checked = currentEnableSyncRecord;
                    bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 启用同步记录 checkbox 已同步: ${currentEnableSyncRecord ? '开启' : '关闭'}`);
                }
            }

            // 检测面板显示信号：Ribbon 点击"打开同步面板"时会写入 bgm_panel_shown_at 时间戳
            const app = getApp();
            const currentPanelShownAt = app?.PluginStorage?.getItem('bgm_panel_shown_at') || null;
            if (currentPanelShownAt && currentPanelShownAt !== lastPanelShownAt) {
                bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到面板显示信号: ${currentPanelShownAt}`);
                lastPanelShownAt = currentPanelShownAt;
                // 自动刷新工作表（匹配当前活动工作表）+ 刷新数据预览
                refreshSheets({ autoSelectActive: true });
                refreshData();
            }
        } catch (e: unknown) {
            // 静默处理轮询错误
        }
    }, 2000); // 每2秒轮询一次

    // 面板关闭时清理定时器
    window.addEventListener('beforeunload', () => clearInterval(pollingInterval));
}

function initPanel(): void {
    bgmLog(LOG_LEVELS.INFO, 'initPanel 开始');

    // 初始化 WPS 枚举（如果未设置）
    const app = getApp();
    if (app && typeof app.Enum !== 'object') {
        app.Enum = WPS_ENUM;
    }
    
    bgmLog(LOG_LEVELS.INFO, '[taskpane] 锁定按钮监听器设置完成');

    // 初始化事件监听
    restoreUserInfoFromStorage();
    // 定时轮询 PluginStorage，确保在 Ribbon 设置 Token 后 Taskpane 能自动更新 UI
    startUserInfoPolling();

    // 恢复上次锁定的工作表
    const restored = restoreLockedSheet();
    refreshSheets();

    // 自动检测最佳工作表并锁定
    const detected = autoDetectSheet();
    if (detected) {
        const select = document.getElementById('sheetSelect') as HTMLSelectElement | null;
        if (select) select.value = String(detected.sheetIndex);
        BGM.sheet.lockedIndex = detected.sheetIndex;
        BGM.sheet.lockedName = detected.sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: detected.sheetIndex, name: detected.sheetName });
        updateLockButton();
        refreshData();  // 立即刷新一次预览
    } else if (restored && BGM.sheet.isLocked) {
        const select = document.getElementById('sheetSelect') as HTMLSelectElement | null;
        if (select) select.value = String(BGM.sheet.lockedIndex);
        refreshData();
    }

    // 更新 Token 和用户 ID 状态显示
    updateTokenStatus();
    updateUserIdStatus();

    // 工作表选择器变更事件
    const sheetSelect = document.getElementById('sheetSelect');
    if (sheetSelect) {
        sheetSelect.addEventListener('change', () => {
            BGM.sheet.lockedIndex = null;
            BGM.sheet.lockedName = null;
            BGM.sheet.isLocked = false;
            saveLockedSheet(null);
            updateLockButton();
            refreshData();  // 切换工作表时刷新预览
        });
    }

    // 模式切换（自动/手动）
    document.querySelectorAll<HTMLInputElement>('input[name="selectMode"]').forEach(radio => {
        radio.addEventListener('change', onSelectModeChange);
    });

    // 在 initPanel 中添加
    document.getElementById('closeSyncPreview')?.addEventListener('click', () => {
        const modal = document.getElementById('syncPreviewModal');
        if (modal) modal.style.display = 'none';
    });
    // 按 Escape 键关闭详情模态框
    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            closeDetailModal();
        }
    };
    document.addEventListener('keydown', handleKeydown);
    // 面板关闭时移除键盘监听
    window.addEventListener('beforeunload', () => document.removeEventListener('keydown', handleKeydown));
    // 通知模块就绪
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    bgmLog(LOG_LEVELS.INFO, 'initPanel 完成');
}




// ========== 导出 ==========
export {
    initPanel, refreshSheets, refreshData, toggleSheetLock,
    onSelectModeChange, 
    autoDetectSheet, updateFilterStatus
};


// ========== 挂载到 window ==========
(window as unknown as { initPanel: () => void }).initPanel = initPanel;

/**
 * 全局函数：供 Ribbon 通过 GetTaskPane 直接调用，
 * 从 PluginStorage 刷新所有 UI 状态（用户信息、配置等）
 * 如果 GetTaskPane 不可用，轮询也请购底机制。）
 */
(window as unknown as { refreshTaskpaneUI: () => void }).refreshTaskpaneUI = function (): void {
    try {
        restoreUserInfoFromStorage();
        bgmLog(LOG_LEVELS.INFO, '[refreshTaskpaneUI] UI 已刷新');
    } catch (e: unknown) {
        bgmLog(LOG_LEVELS.WARN, '[refreshTaskpaneUI] 刷新失败: ' + (e as Error).message);
    }
};

function safeInitPanel(): void {
    try { initPanel(); }
    catch (e: unknown) {
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.INFO, context: 'initPanel' });
        document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    }
}

// 只在 taskpane.html 中自动初始化，避免 main.js 加载时重复执行
if (window.location.pathname.includes('taskpane.html')) {
    if (document.readyState === 'complete') {
        safeInitPanel();
    } else {
        window.addEventListener('load', safeInitPanel);
    }
}


