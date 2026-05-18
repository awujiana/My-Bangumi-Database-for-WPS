/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.1.0
 */
import { LOG_LEVELS, SYNC_STATUS, BGM_COLOR, bgmLog, getApp, BGM, getLastRow, colNumToLetter, SYNC_RECORD_COLUMNS, SYNC_RECORD_SHEET_NAME, SYNC_RECORD_COL, SYNC_RECORD_TYPE_COLOR, getCellValue, setCellValue, } from '../index.js';
// ========== 内存缓存 ==========
let _syncRecordSidCache = new Map();
let _syncRecordListCache = [];
let _syncRecordCacheValid = false;
/**
 * 根据同步次数获取颜色
 */
function getCountColor(count) {
    if (count === 1)
        return BGM_COLOR.BGM_SYNC;
    if (count === 2)
        return BGM_COLOR.LIGHT_GREEN;
    return BGM_COLOR.DARK_GREEN;
}
/**
 * 根据状态获取颜色
 */
function getStatusColor(status) {
    switch (status) {
        case SYNC_STATUS.FAIL: return BGM_COLOR.FAIL;
        case SYNC_STATUS.SKIP: return BGM_COLOR.SKIP;
        default: return BGM_COLOR.SUCCESS;
    }
}
/**
 * 获取或创建同步记录工作表
 */
export function getOrCreateSyncRecordSheet() {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        throw new Error('无法获取工作簿');
    const wb = app.ActiveWorkbook;
    let syncSheet = null;
    // 查找现有工作表
    try {
        const sheets = wb.Sheets;
        for (let i = 1; i <= sheets.Count; i++) {
            const sheet = sheets.Item(i);
            if (sheet.Name === SYNC_RECORD_SHEET_NAME) {
                syncSheet = sheet;
                break;
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getOrCreateSyncRecordSheet', showAlert: false });
    }
    if (!syncSheet) {
        syncSheet = wb.Sheets.Add();
        syncSheet.Name = SYNC_RECORD_SHEET_NAME;
        // 写入表头
        for (let i = 0; i < SYNC_RECORD_COLUMNS.length; i++) {
            const colLetter = colNumToLetter(i + 1);
            const cell = syncSheet.Range(`${colLetter}1`);
            cell.Value2 = SYNC_RECORD_COLUMNS[i];
            if (cell.Interior) {
                cell.Interior.Color = BGM_COLOR.GRAY;
            }
        }
        // 移到末尾
        try {
            syncSheet.Move(null, wb.Sheets.Item(wb.Sheets.Count));
        }
        catch (moveError) {
            BGM.handleError(moveError, { context: 'getOrCreateSyncRecordSheet', showAlert: false });
        }
        bgmLog(LOG_LEVELS.INFO, '已创建同步记录工作表');
    }
    else {
        // 已有工作表，检查并补齐表头（修复历史遗留的表头错位问题）
        const existingCols = SYNC_RECORD_COLUMNS.length;
        for (let i = 0; i < existingCols; i++) {
            const colLetter = colNumToLetter(i + 1);
            const cell = syncSheet.Range(`${colLetter}1`);
            const currentHeader = String(cell.Value2 ?? '').trim();
            const expectedHeader = SYNC_RECORD_COLUMNS[i];
            if (currentHeader !== expectedHeader) {
                cell.Value2 = expectedHeader;
                if (cell.Interior) {
                    cell.Interior.Color = BGM_COLOR.GRAY;
                }
                bgmLog(LOG_LEVELS.INFO, `修复表头: ${colLetter}1 从 "${currentHeader}" → "${expectedHeader}"`);
            }
        }
    }
    invalidateCache();
    return syncSheet;
}
function invalidateCache() {
    _syncRecordCacheValid = false;
}
function buildCache(sheet) {
    if (_syncRecordCacheValid)
        return;
    _syncRecordSidCache.clear();
    _syncRecordListCache.length = 0;
    const lastRow = getLastRow(sheet);
    for (let row = 2; row <= lastRow; row++) {
        try {
            const sid = getCellValue(sheet, row, SYNC_RECORD_COL.SID).trim();
            const url = getCellValue(sheet, row, SYNC_RECORD_COL.URL).trim();
            if (!url && !sid)
                continue;
            _syncRecordSidCache.set(sid, row);
            _syncRecordListCache.push({
                seq: getCellValue(sheet, row, SYNC_RECORD_COL.SEQ),
                time: getCellValue(sheet, row, SYNC_RECORD_COL.TIME),
                name: getCellValue(sheet, row, SYNC_RECORD_COL.NAME),
                url: url,
                sid: sid,
                type: getCellValue(sheet, row, SYNC_RECORD_COL.TYPE),
                count: parseInt(getCellValue(sheet, row, SYNC_RECORD_COL.COUNT)) || 1,
                content: getCellValue(sheet, row, SYNC_RECORD_COL.CONTENT),
                status: getCellValue(sheet, row, SYNC_RECORD_COL.STATUS) || SYNC_STATUS.SUCCESS,
                message: getCellValue(sheet, row, SYNC_RECORD_COL.MESSAGE),
                fingerprint: getCellValue(sheet, row, SYNC_RECORD_COL.FINGERPRINT),
                collType: getCellValue(sheet, row, SYNC_RECORD_COL.COLL_TYPE),
                row: row
            });
        }
        catch (e) {
            BGM.handleError(e, { context: 'buildCache', showAlert: false });
        }
    }
    _syncRecordCacheValid = true;
}
/**
 * 设置同步记录的颜色标记
 * @param sheet 工作表对象
 * @param row 行号
 * @param status 同步状态 (SUCCESS/FAIL/SKIP)
 * @param count 同步次数
 */
function setSyncRecordColors(sheet, row, status, count) {
    const setColor = (colIdx, color) => {
        const cell = sheet.Range(`${colNumToLetter(colIdx)}${row}`);
        if (cell?.Interior)
            cell.Interior.Color = color;
    };
    // 序号列（A列）- 根据同步次数或状态设置颜色
    setColor(SYNC_RECORD_COL.SEQ, status === SYNC_STATUS.FAIL ? BGM_COLOR.FAIL
        : status === SYNC_STATUS.SKIP ? BGM_COLOR.SKIP
            : getCountColor(count));
    // 状态列（I列）- 根据状态设置颜色
    setColor(SYNC_RECORD_COL.STATUS, getStatusColor(status));
    // 类型列（F列）- 根据类型设置颜色
    const typeCell = sheet.Range(`${colNumToLetter(SYNC_RECORD_COL.TYPE)}${row}`);
    if (typeCell?.Interior) {
        const typeName = String(getCellValue(sheet, row, SYNC_RECORD_COL.TYPE) || '');
        typeCell.Interior.Color = SYNC_RECORD_TYPE_COLOR[typeName] || BGM_COLOR.GRAY;
    }
}
export function addSyncRecord(params) {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        // 写入数据前先去重，确保缓存数据干净
        deduplicateSyncRecords();
        if (!_syncRecordCacheValid)
            buildCache(sheet);
        const sid = params.sid || '';
        const now = new Date().toLocaleString('zh-CN');
        if (sid && _syncRecordSidCache.has(sid)) {
            const existingRow = _syncRecordSidCache.get(sid);
            const existingCount = parseInt(getCellValue(sheet, existingRow, SYNC_RECORD_COL.COUNT)) || 0;
            const newCount = existingCount + (params.count || 1);
            const finalStatus = params.status || SYNC_STATUS.SUCCESS;
            // 更新时间戳
            setCellValue(sheet, existingRow, SYNC_RECORD_COL.TIME, now);
            setCellValue(sheet, existingRow, SYNC_RECORD_COL.COUNT, newCount);
            if (params.status)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.STATUS, params.status);
            if (params.message)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.MESSAGE, params.message);
            if (params.fingerprint !== undefined)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.FINGERPRINT, params.fingerprint);
            if (params.name)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.NAME, params.name);
            if (params.url)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.URL, params.url);
            if (params.type)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.TYPE, params.type);
            if (params.content)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.CONTENT, params.content);
            if (params.collType)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.COLL_TYPE, params.collType);
            setSyncRecordColors(sheet, existingRow, finalStatus, newCount);
            // 更新缓存
            const cacheItem = _syncRecordListCache.find(item => item.sid === sid);
            if (cacheItem) {
                cacheItem.time = now;
                cacheItem.count = newCount;
                if (params.status)
                    cacheItem.status = params.status;
                if (params.message)
                    cacheItem.message = params.message;
                if (params.fingerprint !== undefined)
                    cacheItem.fingerprint = params.fingerprint;
                if (params.name)
                    cacheItem.name = params.name;
                if (params.url)
                    cacheItem.url = params.url;
                if (params.type)
                    cacheItem.type = params.type;
                if (params.content)
                    cacheItem.content = params.content;
                if (params.collType)
                    cacheItem.collType = params.collType;
            }
        }
        else {
            let newRow = 1;
            const usedRange = sheet.UsedRange;
            if (usedRange) {
                const lastUsedRow = usedRange.Row + usedRange.Rows.Count - 1;
                newRow = lastUsedRow + 1;
            }
            else {
                newRow = sheet.Rows.Count > 1 ? 2 : 1;
            }
            const finalStatus = params.status || SYNC_STATUS.SUCCESS;
            const finalCount = params.count || 1;
            setCellValue(sheet, newRow, SYNC_RECORD_COL.SEQ, newRow - 1);
            setCellValue(sheet, newRow, SYNC_RECORD_COL.TIME, now);
            setCellValue(sheet, newRow, SYNC_RECORD_COL.NAME, params.name || '');
            setCellValue(sheet, newRow, SYNC_RECORD_COL.URL, params.url || '');
            setCellValue(sheet, newRow, SYNC_RECORD_COL.SID, sid);
            setCellValue(sheet, newRow, SYNC_RECORD_COL.TYPE, params.type || '');
            setCellValue(sheet, newRow, SYNC_RECORD_COL.COUNT, finalCount);
            setCellValue(sheet, newRow, SYNC_RECORD_COL.CONTENT, params.content || '');
            setCellValue(sheet, newRow, SYNC_RECORD_COL.STATUS, finalStatus);
            setCellValue(sheet, newRow, SYNC_RECORD_COL.MESSAGE, params.message || '');
            if (params.fingerprint !== undefined)
                setCellValue(sheet, newRow, SYNC_RECORD_COL.FINGERPRINT, params.fingerprint);
            if (params.collType)
                setCellValue(sheet, newRow, SYNC_RECORD_COL.COLL_TYPE, params.collType);
            setSyncRecordColors(sheet, newRow, finalStatus, finalCount);
            _syncRecordSidCache.set(sid, newRow);
            _syncRecordListCache.push({
                id: newRow, time: now, name: params.name, url: params.url,
                sid: sid, type: params.type, count: finalCount,
                content: params.content, status: finalStatus,
                message: params.message || '', fingerprint: params.fingerprint,
                collType: params.collType
            });
        }
        return true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'addSyncRecord', showAlert: false });
        return false;
    }
}
export function getAllSyncRecords() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        if (!_syncRecordCacheValid)
            buildCache(sheet);
        return [..._syncRecordListCache];
    }
    catch (e) {
        BGM.handleError(e, { context: 'getAllSyncRecords', showAlert: false });
        return [];
    }
}
export function deduplicateSyncRecords() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        const lastRow = getLastRow(sheet);
        if (lastRow <= 1)
            return true;
        // 按 SID 分组
        const sidRows = new Map();
        for (let row = 2; row <= lastRow; row++) {
            const sid = getCellValue(sheet, row, SYNC_RECORD_COL.SID).trim();
            if (!sid)
                continue;
            const rows = sidRows.get(sid) || [];
            rows.push(row);
            sidRows.set(sid, rows);
        }
        // 找出并合并重复 SID
        let removedCount = 0;
        let hasDuplicates = false;
        for (const [sid, rows] of sidRows) {
            if (rows.length <= 1)
                continue;
            hasDuplicates = true;
            const keepRow = rows[0];
            let totalCount = parseInt(getCellValue(sheet, keepRow, SYNC_RECORD_COL.COUNT)) || 1;
            const rowsToDelete = [...rows.slice(1)].sort((a, b) => b - a);
            for (const delRow of rowsToDelete) {
                const delCount = parseInt(getCellValue(sheet, delRow, SYNC_RECORD_COL.COUNT)) || 1;
                totalCount += delCount;
                sheet.Range(`${delRow}:${delRow}`).Delete();
                removedCount++;
            }
            setCellValue(sheet, keepRow, SYNC_RECORD_COL.COUNT, totalCount);
        }
        if (hasDuplicates) {
            const newLastRow = getLastRow(sheet);
            for (let row = 2; row <= newLastRow; row++) {
                setCellValue(sheet, row, SYNC_RECORD_COL.SEQ, row - 1);
            }
            bgmLog(LOG_LEVELS.INFO, `去重完成：删除了 ${removedCount} 条重复记录`);
            invalidateCache();
        }
        return true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'deduplicateSyncRecords', showAlert: false });
        return false;
    }
}
export function clearSyncRecords() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        const lastRow = sheet.UsedRange
            ? sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
            : sheet.Rows.Count;
        if (lastRow > 1) {
            sheet.Range(`2:${lastRow}`).Delete();
        }
        _syncRecordSidCache.clear();
        _syncRecordListCache = [];
        _syncRecordCacheValid = true;
        bgmLog(LOG_LEVELS.INFO, '已清除所有同步记录');
        return true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'clearSyncRecords', showAlert: false });
        return false;
    }
}
export function openSyncRecordSheet() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        sheet.Activate();
        bgmLog(LOG_LEVELS.INFO, '已切换到同步记录工作表');
    }
    catch (e) {
        BGM.handleError(e, { context: 'openSyncRecordSheet', showAlert: false });
    }
}
export function clearSheetMarksInSheet(sheetIndex) {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        return;
    const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    if (!ws)
        return;
    const lastRow = getLastRow(ws);
    for (let r = 1; r <= lastRow; r++) {
        try {
            const cell = ws.Range(`D${r}`);
            if (cell?.Interior) {
                cell.Interior.Color = 0xFFFFFF; // 重置为白色（而非 ColorIndex）
            }
        }
        catch (e) {
            BGM.handleError(e, { context: 'clearSheetMarksInSheet', showAlert: false });
        }
    }
    bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的颜色标记`);
}
