/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.1.0
 */

import {
    BGM_CONFIG, LOG_LEVELS, SYNC_STATUS, BGM_COLOR, bgmLog, getApp,
    trim, isEmptyValue, BGM, getLastRow, colNumToLetter,
    SYNC_RECORD_COLUMNS, SYNC_RECORD_SHEET_NAME,
    getCellValue, setCellValue, readCell      // 复用公共函数
} from '../index.js';

export interface SyncRecord {
    seq?: number | string;
    id?: number;
    time?: string;
    name?: string;
    url?: string;
    sid?: string;
    type?: string;
    count?: number;
    content?: string;
    status?: string;
    message?: string;
    fingerprint?: string;
    row?: number;
}

export interface UpdateRecordParams {
    name?: string;
    url?: string;
    sid?: string;
    type?: string;
    content?: string;
    status?: string;
    message?: string;
    count?: number;
    fingerprint?: string;
    row?: number;
}

// ========== 列索引常量 (1-based，便于维护) ==========
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
} as const;

// 类型颜色映射表 (提取为常量)
const TYPE_COLOR_MAP: Record<string, number> = {
    '想看': BGM_COLOR.WISH,
    '在看': BGM_COLOR.WATCHING,
    '看过': BGM_COLOR.SUCCESS,
    '搁置': BGM_COLOR.SKIP,
    '抛弃': BGM_COLOR.FAIL
};

/**
 * 根据同步次数获取颜色
 */
function getCountColor(count: number): number {
    if (count === 1) return BGM_COLOR.BGM_SYNC;
    if (count === 2) return BGM_COLOR.LIGHT_GREEN;
    return BGM_COLOR.DARK_GREEN;
}

/**
 * 根据状态获取颜色
 */
function getStatusColor(status: string): number {
    switch (status) {
        case SYNC_STATUS.FAIL: return BGM_COLOR.FAIL;
        case SYNC_STATUS.SKIP: return BGM_COLOR.SKIP;
        default: return BGM_COLOR.SUCCESS;
    }
}

// ========== 内存缓存 ==========
let _syncRecordSidCache = new Map<string, number>();     // sid -> 行号 (空 sid 不被缓存)
let _syncRecordListCache: SyncRecord[] = [];
let _syncRecordCacheValid = false;

/**
 * 获取或创建同步记录工作表
 */
export function getOrCreateSyncRecordSheet(): any {
    const app = getApp();
    if (!app?.ActiveWorkbook) throw new Error('无法获取工作簿');

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
    } catch (e: any) {
        BGM.handleError(e, { context: 'getOrCreateSyncRecordSheet', showAlert: false });
    }

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
        } catch (moveError: any) {
            BGM.handleError(moveError, { context: 'getOrCreateSyncRecordSheet', showAlert: false });
        }

        bgmLog(LOG_LEVELS.INFO, '已创建同步记录工作表');
    }

    invalidateCache();
    return syncSheet;
}

function invalidateCache(): void {
    _syncRecordCacheValid = false;
}

function buildCache(sheet: any): void {
    if (_syncRecordCacheValid) return;
    _syncRecordSidCache.clear();
    _syncRecordListCache.length = 0;

    // 使用精确的最后数据行（避免扫描整张表）
    const lastRow = getLastRow(sheet);
    for (let row = 2; row <= lastRow; row++) {
        try {
            // 改用公共函数 getCellValue 读取
            const sid = getCellValue(sheet, row, COL.SID).trim();
            const url = getCellValue(sheet, row, COL.URL).trim();
            if (!url && !sid) continue;

            _syncRecordSidCache.set(sid, row);
            _syncRecordListCache.push({
                seq: getCellValue(sheet, row, COL.SEQ),
                time: getCellValue(sheet, row, COL.TIME),
                name: getCellValue(sheet, row, COL.NAME),
                url: url,
                sid: sid,
                type: getCellValue(sheet, row, COL.TYPE),
                count: parseInt(getCellValue(sheet, row, COL.COUNT)) || 1,
                content: getCellValue(sheet, row, COL.CONTENT),
                status: getCellValue(sheet, row, COL.STATUS) || SYNC_STATUS.SUCCESS,
                message: getCellValue(sheet, row, COL.MESSAGE),
                fingerprint: getCellValue(sheet, row, COL.FINGERPRINT),
                row: row
            });
        } catch (e: any) {
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
function setSyncRecordColors(sheet: any, row: number, status: string, count: number): void {
    const setColor = (colIdx: number, color: number): void => {
        const cell = sheet.Range(`${colNumToLetter(colIdx)}${row}`);
        if (cell?.Interior) cell.Interior.Color = color;
    };

    // 序号列（A列）- 根据同步次数或状态设置颜色
    setColor(COL.SEQ, status === SYNC_STATUS.FAIL ? BGM_COLOR.FAIL
                : status === SYNC_STATUS.SKIP ? BGM_COLOR.SKIP
                : getCountColor(count));

    // 状态列（I列）- 根据状态设置颜色
    setColor(COL.STATUS, getStatusColor(status));

    // 类型列（F列）- 根据类型设置颜色
    const typeCell = sheet.Range(`${colNumToLetter(COL.TYPE)}${row}`);
    if (typeCell?.Interior) {
        const typeName = String(getCellValue(sheet, row, COL.TYPE) || '');
        typeCell.Interior.Color = TYPE_COLOR_MAP[typeName] || BGM_COLOR.GRAY;
    }
}

export function addSyncRecord(params: UpdateRecordParams): boolean {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        if (!_syncRecordCacheValid) buildCache(sheet);

        const sid = params.sid || '';
        const now = new Date().toLocaleString('zh-CN');

        if (sid && _syncRecordSidCache.has(sid)) {
            // 更新现有记录
            const existingRow = _syncRecordSidCache.get(sid)!;
            const existingCount = parseInt(getCellValue(sheet, existingRow, COL.COUNT)) || 0;
            const newCount = existingCount + (params.count || 1);
            const finalStatus = params.status || SYNC_STATUS.SUCCESS;

            setCellValue(sheet, existingRow, COL.COUNT, newCount);
            if (params.status) setCellValue(sheet, existingRow, COL.STATUS, params.status);
            if (params.message) setCellValue(sheet, existingRow, COL.MESSAGE, params.message);
            if (params.fingerprint !== undefined) setCellValue(sheet, existingRow, COL.FINGERPRINT, params.fingerprint);

            // 设置颜色标记
            setSyncRecordColors(sheet, existingRow, finalStatus, newCount);

            // 更新缓存
            const cacheItem = _syncRecordListCache.find(item => item.sid === sid);
            if (cacheItem) {
                cacheItem.count = newCount;
                if (params.status) cacheItem.status = params.status;
                if (params.message) cacheItem.message = params.message;
                if (params.fingerprint !== undefined) cacheItem.fingerprint = params.fingerprint;
            }
        } else {
            // 新增记录
            let newRow = 1;
            const usedRange = sheet.UsedRange;
            if (usedRange) {
                const lastUsedRow = usedRange.Row + usedRange.Rows.Count - 1;
                newRow = lastUsedRow + 1;
            } else {
                newRow = sheet.Rows.Count > 1 ? 2 : 1;
            }

            const finalStatus = params.status || SYNC_STATUS.SUCCESS;
            const finalCount = params.count || 1;

            setCellValue(sheet, newRow, COL.SEQ, newRow - 1);
            setCellValue(sheet, newRow, COL.TIME, now);
            setCellValue(sheet, newRow, COL.NAME, params.name || '');
            setCellValue(sheet, newRow, COL.URL, params.url || '');
            setCellValue(sheet, newRow, COL.SID, sid);
            setCellValue(sheet, newRow, COL.TYPE, params.type || '');
            setCellValue(sheet, newRow, COL.COUNT, finalCount);
            setCellValue(sheet, newRow, COL.CONTENT, params.content || '');
            setCellValue(sheet, newRow, COL.STATUS, finalStatus);
            setCellValue(sheet, newRow, COL.MESSAGE, params.message || '');
            if (params.fingerprint !== undefined) setCellValue(sheet, newRow, COL.FINGERPRINT, params.fingerprint);

            // 设置颜色标记
            setSyncRecordColors(sheet, newRow, finalStatus, finalCount);

            _syncRecordSidCache.set(sid, newRow);
            _syncRecordListCache.push({
                id: newRow, time: now, name: params.name, url: params.url,
                sid: sid, type: params.type, count: finalCount,
                content: params.content, status: finalStatus,
                message: params.message || '', fingerprint: params.fingerprint
            });
        }
        return true;
    } catch (e: any) {
        BGM.handleError(e, { context: 'addSyncRecord', showAlert: false });
        return false;
    }
}

export function getAllSyncRecords(): SyncRecord[] {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        if (!_syncRecordCacheValid) buildCache(sheet);
        return [..._syncRecordListCache];
    } catch (e: any) {
        BGM.handleError(e, { context: 'getAllSyncRecords', showAlert: false });
        return [];
    }
}

export function clearSyncRecords(): boolean {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        const lastRow = sheet.UsedRange
            ? sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
            : sheet.Rows.Count;
        if (lastRow > 1) {
            sheet.Range(`2:${lastRow}`).Delete();          // 修复语法
        }
        _syncRecordSidCache.clear();
        _syncRecordListCache = [];
        _syncRecordCacheValid = true;
        bgmLog(LOG_LEVELS.INFO, '已清除所有同步记录');
        return true;
    } catch (e: any) {
        BGM.handleError(e, { context: 'clearSyncRecords', showAlert: false });
        return false;
    }
}

export function openSyncRecordSheet(): void {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        sheet.Activate();
        bgmLog(LOG_LEVELS.INFO, '已切换到同步记录工作表');
    } catch (e: any) {
        BGM.handleError(e, { context: 'openSyncRecordSheet', showAlert: false });
    }
}

export function clearSheetMarksInSheet(sheetIndex: number): void {
    const app = getApp();
    if (!app?.ActiveWorkbook) return;
    const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    if (!ws) return;

    const lastRow = getLastRow(ws);
    for (let r = 1; r <= lastRow; r++) {
        try {
            const cell = ws.Range(`D${r}`);
            if (cell?.Interior) {
                cell.Interior.Color = 0xFFFFFF;      // 重置为白色（而非 ColorIndex）
            }
        } catch (e: any) {
            BGM.handleError(e, { context: 'clearSheetMarksInSheet', showAlert: false });
        }
    }
    bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的颜色标记`);
}