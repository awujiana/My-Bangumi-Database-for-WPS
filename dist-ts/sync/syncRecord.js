/**
 * @fileoverview 同步记录管理模块 (优化版)
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.1.0
 */
import { LOG_LEVELS, SYNC_STATUS, BGM_COLOR, bgmLog, getApp, setCellValue, BGM, getLastRow, colNumToLetter, SYNC_RECORD_COLUMNS, SYNC_RECORD_SHEET_NAME, getCellValue } from '../index.js';
// ========== 列索引常量 (1-based) ==========
const COL = {
    SEQ: 1,
    TIME: 2,
    NAME: 3,
    URL: 4,
    SID: 5,
    TYPE: 6,
    COUNT: 7,
    CONTENT: 8,
    STATUS: 9,
    MESSAGE: 10,
    FINGERPRINT: 11
};
// 类型颜色映射表 (提取为常量)
const TYPE_COLOR_MAP = {
    '想看': BGM_COLOR.WISH,
    '在看': BGM_COLOR.WATCHING,
    '看过': BGM_COLOR.SUCCESS,
    '搁置': BGM_COLOR.SKIP,
    '抛弃': BGM_COLOR.FAIL
};
// ========== 内存缓存 ==========
let _syncRecordSidCache = new Map(); // sid -> 行号 (空 sid 不被缓存)
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
    // 查找现有工作表 (使用更简洁的方式)
    try {
        const sheets = wb.Sheets;
        for (let i = 1; i <= sheets.Count; i++) {
            if (sheets.Item(i).Name === SYNC_RECORD_SHEET_NAME) {
                syncSheet = sheets.Item(i);
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
        // 写入表头并设置背景色
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
    invalidateCache();
    return syncSheet;
}
function invalidateCache() {
    _syncRecordCacheValid = false;
}
/**
 * 构建缓存 (优化版：一次读取所有数据到二维数组)
 */
function buildCache(sheet) {
    if (_syncRecordCacheValid)
        return;
    _syncRecordSidCache.clear();
    _syncRecordListCache.length = 0;
    const lastRow = getLastRow(sheet);
    if (lastRow < 2) {
        _syncRecordCacheValid = true;
        return;
    }
    // 获取数据区域: 从第2行到 lastRow，列数 1~11
    const dataRange = sheet.Range(`A2:${colNumToLetter(Object.keys(COL).length)}${lastRow}`);
    const values = dataRange.Value2; // 预期为二维数组 [row][col]
    if (!values || !Array.isArray(values)) {
        // 单行情况可能不是二维数组，做兼容处理
        _syncRecordCacheValid = true;
        return;
    }
    // values 是 (rowIndex, colIndex) 从0开始，每行对应一个数组
    const rowCount = values.length;
    for (let i = 0; i < rowCount; i++) {
        const rowData = values[i];
        // 确保 rowData 是数组，否则跳过
        if (!Array.isArray(rowData))
            continue;
        const sid = rowData[COL.SID - 1] ? String(rowData[COL.SID - 1]).trim() : '';
        const url = rowData[COL.URL - 1] ? String(rowData[COL.URL - 1]).trim() : '';
        if (!url && !sid)
            continue;
        const actualRow = i + 2; // 数据行在表格中的真实行号
        // 仅当 sid 非空时才加入 sid 缓存
        if (sid) {
            _syncRecordSidCache.set(sid, actualRow);
        }
        _syncRecordListCache.push({
            seq: rowData[COL.SEQ - 1],
            time: rowData[COL.TIME - 1],
            name: rowData[COL.NAME - 1],
            url: url,
            sid: sid,
            type: rowData[COL.TYPE - 1],
            count: parseInt(rowData[COL.COUNT - 1]) || 1,
            content: rowData[COL.CONTENT - 1],
            status: rowData[COL.STATUS - 1] || SYNC_STATUS.SUCCESS,
            message: rowData[COL.MESSAGE - 1],
            fingerprint: String(rowData[COL.FINGERPRINT - 1] || ''),
            row: actualRow
        });
    }
    _syncRecordCacheValid = true;
}
/**
 * 设置同步记录的颜色标记
 */
function setSyncRecordColors(sheet, row, status, count) {
    // 序号列（默认A列）
    const seqCell = sheet.Range(`${colNumToLetter(COL.SEQ)}${row}`);
    if (seqCell?.Interior) {
        if (status === SYNC_STATUS.FAIL) {
            seqCell.Interior.Color = BGM_COLOR.FAIL;
        }
        else if (status === SYNC_STATUS.SKIP) {
            seqCell.Interior.Color = BGM_COLOR.SKIP;
        }
        else {
            if (count === 1)
                seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
            else if (count === 2)
                seqCell.Interior.Color = BGM_COLOR.LIGHT_GREEN;
            else
                seqCell.Interior.Color = BGM_COLOR.DARK_GREEN;
        }
    }
    // 状态列（I列）
    const statusCell = sheet.Range(`${colNumToLetter(COL.STATUS)}${row}`);
    if (statusCell?.Interior) {
        if (status === SYNC_STATUS.FAIL) {
            statusCell.Interior.Color = BGM_COLOR.FAIL;
        }
        else if (status === SYNC_STATUS.SKIP) {
            statusCell.Interior.Color = BGM_COLOR.SKIP;
        }
        else {
            statusCell.Interior.Color = BGM_COLOR.SUCCESS;
        }
    }
    // 类型列（F列）
    const typeCell = sheet.Range(`${colNumToLetter(COL.TYPE)}${row}`);
    if (typeCell?.Interior) {
        const typeName = String(typeCell.Value2 || '');
        typeCell.Interior.Color = TYPE_COLOR_MAP[typeName] || BGM_COLOR.GRAY;
    }
}
/**
 * 添加或更新同步记录
 * @param params 记录参数
 * @returns 是否成功
 */
export function addSyncRecord(params) {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        if (!_syncRecordCacheValid)
            buildCache(sheet);
        const sid = params.sid ? params.sid.trim() : '';
        const now = new Date().toLocaleString('zh-CN');
        // 重要: 空 sid 不应被视为已存在记录的唯一标识，总是新增
        const isExisting = sid !== '' && _syncRecordSidCache.has(sid);
        if (isExisting) {
            // 更新现有记录
            const existingRow = _syncRecordSidCache.get(sid);
            const existingCount = parseInt(getCellValue(sheet, COL.COUNT, existingRow)) || 0;
            const newCount = existingCount + (params.count || 1);
            const finalStatus = params.status || SYNC_STATUS.SUCCESS;
            setCellValue(sheet, COL.COUNT, existingRow, newCount.toString());
            if (params.status)
                setCellValue(sheet, COL.STATUS, existingRow, params.status);
            if (params.message)
                setCellValue(sheet, COL.MESSAGE, existingRow, params.message);
            if (params.fingerprint !== undefined)
                setCellValue(sheet, COL.FINGERPRINT, existingRow, params.fingerprint);
            // 设置颜色标记
            setSyncRecordColors(sheet, existingRow, finalStatus, newCount);
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
            // 新增记录: 找到第一个空行或末尾追加
            let newRow = 2;
            const lastUsedRow = sheet.UsedRange ? sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1 : 1;
            newRow = Math.max(lastUsedRow + 1, 2);
            const finalStatus = params.status || SYNC_STATUS.SUCCESS;
            const finalCount = params.count || 1;
            // 写入各列
            setCellValue(sheet, COL.SEQ, newRow, newRow - 1);
            setCellValue(sheet, COL.TIME, newRow, now);
            setCellValue(sheet, COL.NAME, newRow, params.name || '');
            setCellValue(sheet, COL.URL, newRow, params.url || '');
            setCellValue(sheet, COL.SID, newRow, sid);
            setCellValue(sheet, COL.TYPE, newRow, params.type || '');
            setCellValue(sheet, COL.COUNT, newRow, finalCount);
            setCellValue(sheet, COL.CONTENT, newRow, params.content || '');
            setCellValue(sheet, COL.STATUS, newRow, finalStatus);
            setCellValue(sheet, COL.MESSAGE, newRow, params.message || '');
            if (params.fingerprint !== undefined)
                setCellValue(sheet, COL.FINGERPRINT, newRow, params.fingerprint);
            setSyncRecordColors(sheet, newRow, finalStatus, finalCount);
            // 更新缓存 (仅当 sid 非空时)
            if (sid)
                _syncRecordSidCache.set(sid, newRow);
            _syncRecordListCache.push({
                id: newRow,
                time: now,
                name: params.name,
                url: params.url,
                sid: sid,
                type: params.type,
                count: finalCount,
                content: params.content,
                status: finalStatus,
                message: params.message || '',
                fingerprint: params.fingerprint,
                row: newRow
            });
        }
        return true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'addSyncRecord', showAlert: false });
        return false;
    }
}
/**
 * 获取所有同步记录 (返回缓存副本)
 */
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
/**
 * 清除所有同步记录 (保留表头)
 */
export function clearSyncRecords() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        const lastRow = sheet.UsedRange
            ? sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
            : sheet.Rows.Count;
        if (lastRow > 1) {
            const deleteRange = sheet.Range(`2:${lastRow}`);
            deleteRange.Delete();
        }
        // 清空缓存并标记为有效 (空缓存)
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
/**
 * 激活并切换到同步记录工作表
 */
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
/**
 * 清除指定工作表指定列的颜色颜色标记 (默认清除D列)
 * @param sheetIndex 工作表索引 (1-based)
 * @param columnLetter 要清除的列，默认为 'D'
 */
export function clearSheetMarksInSheet(sheetIndex, columnLetter = 'D') {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        return;
    const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    if (!ws)
        return;
    const lastRow = getLastRow(ws);
    for (let r = 1; r <= lastRow; r++) {
        try {
            const cell = ws.Range(`${columnLetter}${r}`);
            if (cell?.Interior) {
                cell.Interior.Color = 0xFFFFFF; // 白色
            }
        }
        catch (e) {
            BGM.handleError(e, { context: 'clearSheetMarksInSheet', showAlert: false });
        }
    }
    bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的 ${columnLetter} 列颜色标记`);
}
