/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { LOG_LEVELS, SYNC_STATUS, BGM_COLOR, bgmLog, getApp, BGM, getLastRow, colNumToLetter, SYNC_RECORD_COLUMNS, SYNC_RECORD_SHEET_NAME } from '../index.js';
// ========== 内存缓存 ==========
let _syncRecordSidCache = new Map();
let _syncRecordListCache = [];
let _syncRecordCacheValid = false;
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
    catch (e) { /* 忽略 */ }
    // 不存在则创建
    if (!syncSheet) {
        syncSheet = wb.Sheets.Add();
        syncSheet.Name = SYNC_RECORD_SHEET_NAME;
        // 写入表头（修复：循环内正确创建每个单元格）
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
        catch (moveError) { /* 忽略 */ }
        bgmLog(LOG_LEVELS.INFO, '已创建同步记录工作表');
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
    // 使用精确的最后数据行（避免扫描整张表）
    const lastRow = getLastRow(sheet);
    for (let row = 2; row <= lastRow; row++) {
        try {
            const sid = String(sheet.Range(`E${row}`).Value2 || '').trim();
            const url = String(sheet.Range(`D${row}`).Value2 || '').trim();
            if (!url && !sid)
                continue;
            _syncRecordSidCache.set(sid, row);
            _syncRecordListCache.push({
                seq: sheet.Range(`A${row}`).Value2,
                time: sheet.Range(`B${row}`).Value2,
                name: sheet.Range(`C${row}`).Value2,
                url: url,
                sid: sid,
                type: sheet.Range(`F${row}`).Value2,
                count: parseInt(sheet.Range(`G${row}`).Value2) || 1,
                content: sheet.Range(`H${row}`).Value2,
                status: sheet.Range(`I${row}`).Value2 || SYNC_STATUS.SUCCESS,
                message: sheet.Range(`J${row}`).Value2,
                fingerprint: String(sheet.Range(`K${row}`).Value2 || ''),
                row: row
            });
        }
        catch (e) { /* 忽略单行错误 */ }
    }
    _syncRecordCacheValid = true;
}
export function addSyncRecord(params) {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        if (!_syncRecordCacheValid)
            buildCache(sheet);
        const sid = params.sid || '';
        const now = new Date().toLocaleString('zh-CN');
        if (sid && _syncRecordSidCache.has(sid)) {
            // 更新现有记录
            const existingRow = _syncRecordSidCache.get(sid);
            const existingCount = parseInt(String(sheet.Range(`G${existingRow}`).Value2 || '0'), 10) || 0;
            const newCount = existingCount + (params.count || 1);
            sheet.Range(`G${existingRow}`).Value2 = newCount;
            if (params.status)
                sheet.Range(`I${existingRow}`).Value2 = params.status;
            if (params.message)
                sheet.Range(`J${existingRow}`).Value2 = params.message;
            if (params.fingerprint !== undefined)
                sheet.Range(`K${existingRow}`).Value2 = params.fingerprint;
            // 设置颜色
            const seqCell = sheet.Range(`A${existingRow}`);
            if (seqCell?.Interior) {
                if (newCount === 1)
                    seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
                else if (newCount === 2)
                    seqCell.Interior.Color = BGM_COLOR.LIGHT_GREEN;
                else
                    seqCell.Interior.Color = BGM_COLOR.DARK_GREEN;
            }
            // 更新缓存
            const cacheItem = _syncRecordListCache.find(item => item.sid === sid);
            if (cacheItem) {
                cacheItem.count = newCount;
                if (params.status)
                    cacheItem.status = params.status;
                if (params.message)
                    cacheItem.message = params.message;
                if (params.fingerprint !== undefined)
                    cacheItem.fingerprint = params.fingerprint;
            }
        }
        else {
            // 新增记录
            // 正确计算最后行号（避免 UsedRange 错误）
            let newRow = 1;
            const usedRange = sheet.UsedRange;
            if (usedRange) {
                const lastUsedRow = usedRange.Row + usedRange.Rows.Count - 1;
                newRow = lastUsedRow + 1;
            }
            else {
                newRow = sheet.Rows.Count > 1 ? 2 : 1; // 至少从第2行开始
            }
            sheet.Range(`A${newRow}`).Value2 = newRow - 1;
            sheet.Range(`B${newRow}`).Value2 = now;
            sheet.Range(`C${newRow}`).Value2 = params.name || '';
            sheet.Range(`D${newRow}`).Value2 = params.url || '';
            sheet.Range(`E${newRow}`).Value2 = sid;
            sheet.Range(`F${newRow}`).Value2 = params.type || '';
            sheet.Range(`G${newRow}`).Value2 = params.count || 1;
            sheet.Range(`H${newRow}`).Value2 = params.content || '';
            sheet.Range(`I${newRow}`).Value2 = params.status || SYNC_STATUS.SUCCESS;
            sheet.Range(`J${newRow}`).Value2 = params.message || '';
            if (params.fingerprint !== undefined)
                sheet.Range(`K${newRow}`).Value2 = params.fingerprint;
            // 设置颜色
            const seqCell = sheet.Range(`A${newRow}`);
            if (seqCell?.Interior) {
                if (params.status === SYNC_STATUS.SUCCESS)
                    seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
                else if (params.status === SYNC_STATUS.FAIL)
                    seqCell.Interior.Color = BGM_COLOR.FAIL;
                else
                    seqCell.Interior.Color = BGM_COLOR.SKIP;
            }
            _syncRecordSidCache.set(sid, newRow);
            _syncRecordListCache.push({
                id: newRow, time: now, name: params.name, url: params.url,
                sid: sid, type: params.type, count: params.count || 1,
                content: params.content, status: params.status || SYNC_STATUS.SUCCESS,
                message: params.message || '', fingerprint: params.fingerprint
            });
        }
        return true;
    }
    catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'addSyncRecord' });
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
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'getAllSyncRecords' });
        return [];
    }
}
export function clearSyncRecords() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        const lastRow = sheet.UsedRange
            ? sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
            : sheet.Rows.Count;
        if (lastRow > 1) {
            sheet.Range(`2:${lastRow}`).Delete(); // 修复语法
        }
        _syncRecordSidCache.clear();
        _syncRecordListCache = [];
        _syncRecordCacheValid = true;
        bgmLog(LOG_LEVELS.INFO, '已清除所有同步记录');
        return true;
    }
    catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'clearSyncRecords' });
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
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'openSyncRecordSheet' });
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
        catch (_) { }
    }
    bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的颜色标记`);
}
