/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.1.0
 */
import { LOG_LEVELS, SYNC_STATUS, BGM_COLOR, SYNC_RECORD_COLUMNS, SYNC_RECORD_SHEET_NAME, SYNC_RECORD_COL, SYNC_RECORD_TYPE_COLOR, } from '../core/constants.js';
import { getSyncRecordEnabled } from '../tools/config.js';
import { bgmLog, getApp, BGM, getLastRow, colNumToLetter, getCellValue, setCellValue, readRangeValues, } from '../tools/util/index.js';
// ========== 内存缓存 ==========
const _syncRecordSidCache = new Map();
let _syncRecordListCache = [];
let _syncRecordCacheValid = false;
let _formattingInProgress = false;
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
        case SYNC_STATUS.FAIL:
            return BGM_COLOR.FAIL;
        case SYNC_STATUS.SKIP:
            return BGM_COLOR.SKIP;
        default:
            return BGM_COLOR.SUCCESS;
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
            cell.Value2 = SYNC_RECORD_COLUMNS[i] ?? '';
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
        // 新表设置格式（列宽、行高、字体、居中、边框等）
        formatSyncRecordSheet(syncSheet);
    }
    else {
        // 检测并迁移旧 schema（旧版无"来源"列 → 当前 12 列结构）
        try {
            const firstHeader = String(syncSheet.Range('A1').Value2 ?? '').trim();
            const sourceHeader = String(syncSheet.Range('F1').Value2 ?? '').trim();
            if (firstHeader === '序号' || (firstHeader === 'SID' && sourceHeader !== '来源')) {
                bgmLog(LOG_LEVELS.INFO, '检测到旧版本同步记录表，开始迁移...');
                migrateSyncRecordSchema(syncSheet);
                bgmLog(LOG_LEVELS.INFO, '同步记录表迁移完成');
                invalidateCache();
            }
        }
        catch (e) {
            // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
            const errMsg = e instanceof Error ? e.message : String(e);
            bgmLog(LOG_LEVELS.WARN, '同步记录表迁移失败: ' + errMsg);
        }
        // 已有工作表，检查并补齐表头
        const existingCols = SYNC_RECORD_COLUMNS.length;
        for (let i = 0; i < existingCols; i++) {
            const colLetter = colNumToLetter(i + 1);
            const cell = syncSheet.Range(`${colLetter}1`);
            const currentHeader = String(cell.Value2 ?? '').trim();
            const expectedHeader = SYNC_RECORD_COLUMNS[i] ?? '';
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
/**
 * 查找现有的同步记录工作表（不创建新表）
 * @returns 现有的同步记录工作表，若不存在则返回 null
 */
export function getSyncRecordSheetIfExists() {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        return null;
    try {
        const sheets = app.ActiveWorkbook.Sheets;
        for (let i = 1; i <= sheets.Count; i++) {
            const sheet = sheets.Item(i);
            if (sheet.Name === SYNC_RECORD_SHEET_NAME)
                return sheet;
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getSyncRecordSheetIfExists', showAlert: false });
    }
    return null;
}
function invalidateCache() {
    _syncRecordCacheValid = false;
}
/**
 * 迁移旧版同步记录表数据到当前 12 列结构
 * 当前列序：SID(1) 同步时间(2) 名称(3) URL(4) 条目类型(5) 来源(6)
 *          → 次数(7) 内容(8) 状态(9) 收藏状态(10) 备注(11) 数据指纹(12)
 *
 * 支持两种旧结构：
 * - 旧 12 列（序号第一列）：序号(1) 同步时间(2) 名称(3) URL(4) SID(5) 条目类型(6) 次数(7) 内容(8) 状态(9) 备注(10) 数据指纹(11) 收藏状态(12)
 * - 旧 11 列（SID第一列无来源）：SID(1) 同步时间(2) 名称(3) URL(4) 条目类型(5) 次数(6) 内容(7) 状态(8) 收藏状态(9) 备注(10) 数据指纹(11)
 */
function migrateSyncRecordSchema(sheet) {
    const firstHeader = String(sheet.Range('A1').Value2 ?? '').trim();
    const isLegacyWithSeq = firstHeader === '序号';
    const lastRow = getLastRow(sheet);
    if (lastRow <= 1)
        return;
    const rows = [];
    for (let row = 2; row <= lastRow; row++) {
        let oldSid;
        let oldUrl;
        let oldType;
        let oldCount;
        let oldContent;
        let oldStatus;
        let oldCollType;
        let oldMessage;
        let oldFingerprint;
        if (isLegacyWithSeq) {
            oldSid = getCellValue(sheet, row, 5).trim();
            oldUrl = getCellValue(sheet, row, 4).trim();
            oldType = getCellValue(sheet, row, 6);
            oldCount = getCellValue(sheet, row, 7);
            oldContent = getCellValue(sheet, row, 8);
            oldStatus = getCellValue(sheet, row, 9);
            oldCollType = getCellValue(sheet, row, 12);
            oldMessage = getCellValue(sheet, row, 10);
            oldFingerprint = getCellValue(sheet, row, 11);
        }
        else {
            oldSid = getCellValue(sheet, row, 1).trim();
            oldUrl = getCellValue(sheet, row, 4).trim();
            oldType = getCellValue(sheet, row, 5);
            oldCount = getCellValue(sheet, row, 6);
            oldContent = getCellValue(sheet, row, 7);
            oldStatus = getCellValue(sheet, row, 8);
            oldCollType = getCellValue(sheet, row, 9);
            oldMessage = getCellValue(sheet, row, 10);
            oldFingerprint = getCellValue(sheet, row, 11);
        }
        if (!oldUrl && !oldSid)
            continue;
        rows.push([
            oldSid,
            getCellValue(sheet, row, 2),
            getCellValue(sheet, row, 3),
            oldUrl,
            oldType,
            '', // 来源：旧数据无此字段，默认空
            oldCount,
            oldContent,
            oldStatus,
            oldCollType,
            oldMessage,
            oldFingerprint,
        ]);
    }
    if (lastRow > 1) {
        sheet.Range(`2:${lastRow}`).Delete();
    }
    for (let i = 0; i < SYNC_RECORD_COLUMNS.length; i++) {
        const colLetter = colNumToLetter(i + 1);
        const cell = sheet.Range(`${colLetter}1`);
        cell.Value2 = SYNC_RECORD_COLUMNS[i] ?? '';
        if (cell.Interior) {
            cell.Interior.Color = BGM_COLOR.GRAY;
        }
    }
    for (let i = 0; i < rows.length; i++) {
        const newRow = i + 2;
        const data = rows[i];
        if (!data)
            continue;
        for (let col = 0; col < data.length; col++) {
            setCellValue(sheet, newRow, col + 1, data[col]);
        }
    }
    bgmLog(LOG_LEVELS.INFO, `数据迁移完成：${rows.length} 条记录已重组到 12 列结构`);
}
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
    const allData = readRangeValues(sheet, 2, lastRow, 1, SYNC_RECORD_COLUMNS.length);
    if (!allData || allData.length === 0) {
        _syncRecordCacheValid = true;
        return;
    }
    for (let i = 0; i < allData.length; i++) {
        try {
            const rowData = allData[i];
            if (!rowData)
                continue;
            const sid = String(rowData[SYNC_RECORD_COL.SID - 1] ?? '').trim();
            const url = String(rowData[SYNC_RECORD_COL.URL - 1] ?? '').trim();
            if (!url && !sid)
                continue;
            const row = i + 2;
            _syncRecordSidCache.set(sid, row);
            _syncRecordListCache.push({
                time: String(rowData[SYNC_RECORD_COL.TIME - 1] ?? ''),
                name: String(rowData[SYNC_RECORD_COL.NAME - 1] ?? ''),
                url: url,
                sid: sid,
                type: String(rowData[SYNC_RECORD_COL.TYPE - 1] ?? ''),
                source: String(rowData[SYNC_RECORD_COL.SOURCE - 1] ?? ''),
                count: parseInt(String(rowData[SYNC_RECORD_COL.COUNT - 1] ?? '')) || 1,
                content: String(rowData[SYNC_RECORD_COL.CONTENT - 1] ?? ''),
                status: String(rowData[SYNC_RECORD_COL.STATUS - 1] ?? '') || SYNC_STATUS.SUCCESS,
                message: String(rowData[SYNC_RECORD_COL.MESSAGE - 1] ?? ''),
                fingerprint: String(rowData[SYNC_RECORD_COL.FINGERPRINT - 1] ?? ''),
                collType: String(rowData[SYNC_RECORD_COL.COLL_TYPE - 1] ?? ''),
                row: row,
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
    // SID列（A列）- 根据同步次数或状态设置颜色
    setColor(SYNC_RECORD_COL.SID, status === SYNC_STATUS.FAIL
        ? BGM_COLOR.FAIL
        : status === SYNC_STATUS.SKIP
            ? BGM_COLOR.SKIP
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
    if (!getSyncRecordEnabled()) {
        bgmLog(LOG_LEVELS.INFO, '[addSyncRecord] 同步记录功能未启用，跳过');
        return false;
    }
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
            if (params.source)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.SOURCE, params.source);
            if (params.content)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.CONTENT, params.content);
            if (params.collType)
                setCellValue(sheet, existingRow, SYNC_RECORD_COL.COLL_TYPE, params.collType);
            setSyncRecordColors(sheet, existingRow, finalStatus, newCount);
            // 更新缓存
            const cacheItem = _syncRecordListCache.find((item) => item.sid === sid);
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
                if (params.source)
                    cacheItem.source = params.source;
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
            setCellValue(sheet, newRow, SYNC_RECORD_COL.TIME, now);
            setCellValue(sheet, newRow, SYNC_RECORD_COL.NAME, params.name || '');
            setCellValue(sheet, newRow, SYNC_RECORD_COL.URL, params.url || '');
            setCellValue(sheet, newRow, SYNC_RECORD_COL.SID, sid);
            setCellValue(sheet, newRow, SYNC_RECORD_COL.TYPE, params.type || '');
            setCellValue(sheet, newRow, SYNC_RECORD_COL.SOURCE, params.source || '');
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
                id: newRow,
                time: now,
                sid: sid,
                count: finalCount,
                status: finalStatus,
                message: params.message || '',
                ...(params.name ? { name: params.name } : {}),
                ...(params.url ? { url: params.url } : {}),
                ...(params.type ? { type: params.type } : {}),
                ...(params.source ? { source: params.source } : {}),
                ...(params.content ? { content: params.content } : {}),
                ...(params.fingerprint !== undefined ? { fingerprint: params.fingerprint } : {}),
                ...(params.collType ? { collType: params.collType } : {}),
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
 * 批量写入同步记录
 *
 * 性能优化入口：相比逐条调用 addSyncRecord，本函数一次性计算所有新行的起始位置，
 * 并通过 Range.Value2 批量写入二维数组，显著减少 WPS COM 调用次数。
 * 对于已存在的 SID，仍按单条更新（合并次数）。
 *
 * @param records 待写入的记录数组
 * @returns 是否全部成功
 */
export function addSyncRecords(records) {
    if (!getSyncRecordEnabled()) {
        bgmLog(LOG_LEVELS.INFO, '[addSyncRecords] 同步记录功能未启用，跳过');
        return false;
    }
    if (records.length === 0)
        return true;
    try {
        const sheet = getOrCreateSyncRecordSheet();
        deduplicateSyncRecords();
        if (!_syncRecordCacheValid)
            buildCache(sheet);
        const now = new Date().toLocaleString('zh-CN');
        const newRows = [];
        const sidToUpdate = new Map();
        for (const params of records) {
            const sid = params.sid || '';
            if (sid && _syncRecordSidCache.has(sid)) {
                const existingRow = _syncRecordSidCache.get(sid);
                const existingCount = parseInt(getCellValue(sheet, existingRow, SYNC_RECORD_COL.COUNT)) || 0;
                const existing = sidToUpdate.get(sid);
                const totalCount = (existing?.newCount ?? existingCount) + (params.count || 1);
                sidToUpdate.set(sid, {
                    row: existingRow,
                    newCount: totalCount,
                    status: params.status || SYNC_STATUS.SUCCESS,
                    params,
                });
                continue;
            }
            newRows.push([
                now,
                params.name || '',
                params.url || '',
                sid,
                params.type || '',
                params.source || '',
                String(params.count || 1),
                params.content || '',
                params.status || SYNC_STATUS.SUCCESS,
                params.collType || '',
                params.message || '',
                params.fingerprint !== undefined ? params.fingerprint : '',
            ]);
        }
        // 批量写入新行：通过 Range.Value2 一次性写入二维数组
        if (newRows.length > 0) {
            const usedRange = sheet.UsedRange;
            let startRow = 2;
            if (usedRange) {
                startRow = usedRange.Row + usedRange.Rows.Count;
            }
            const endRow = startRow + newRows.length - 1;
            const startColLetter = colNumToLetter(1);
            const endColLetter = colNumToLetter(SYNC_RECORD_COLUMNS.length);
            const range = sheet.Range(`${startColLetter}${startRow}:${endColLetter}${endRow}`);
            range.Value2 = newRows;
            // 设置新增行的颜色
            for (let i = 0; i < newRows.length; i++) {
                const row = startRow + i;
                const data = newRows[i];
                if (!data)
                    continue;
                const status = data[SYNC_RECORD_COL.STATUS - 1] ?? SYNC_STATUS.SUCCESS;
                const count = parseInt(data[SYNC_RECORD_COL.COUNT - 1] ?? '') || 1;
                setSyncRecordColors(sheet, row, status, count);
            }
        }
        // 更新已有 SID 的时间、次数、状态及其他字段
        for (const [sid, { row, newCount, status, params }] of sidToUpdate) {
            setCellValue(sheet, row, SYNC_RECORD_COL.TIME, now);
            setCellValue(sheet, row, SYNC_RECORD_COL.COUNT, newCount);
            setCellValue(sheet, row, SYNC_RECORD_COL.STATUS, status);
            if (params.name)
                setCellValue(sheet, row, SYNC_RECORD_COL.NAME, params.name);
            if (params.url)
                setCellValue(sheet, row, SYNC_RECORD_COL.URL, params.url);
            if (params.type)
                setCellValue(sheet, row, SYNC_RECORD_COL.TYPE, params.type);
            if (params.source)
                setCellValue(sheet, row, SYNC_RECORD_COL.SOURCE, params.source);
            if (params.content)
                setCellValue(sheet, row, SYNC_RECORD_COL.CONTENT, params.content);
            if (params.message)
                setCellValue(sheet, row, SYNC_RECORD_COL.MESSAGE, params.message);
            if (params.fingerprint !== undefined)
                setCellValue(sheet, row, SYNC_RECORD_COL.FINGERPRINT, params.fingerprint);
            if (params.collType)
                setCellValue(sheet, row, SYNC_RECORD_COL.COLL_TYPE, params.collType);
            setSyncRecordColors(sheet, row, status, newCount);
            _syncRecordSidCache.set(sid, row);
        }
        invalidateCache();
        bgmLog(LOG_LEVELS.INFO, `[addSyncRecords] 批量写入完成：新增 ${newRows.length} 条，更新 ${sidToUpdate.size} 条`);
        return true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'addSyncRecords', showAlert: false });
        return false;
    }
}
/**
 * 写入汇总同步记录
 *
 * 用于记录一次批量同步的整体结果（如 GitHub 仓库同步结束后新增/更新/删除统计）。
 * 汇总行以 SID 为空标识，不参与按 SID 合并次数。
 *
 * @param params 汇总记录参数，建议 content 写"仓库同步汇总"，message 写统计信息
 * @returns 是否成功
 */
export function addSyncRecordSummary(params) {
    return addSyncRecord({
        ...params,
        sid: '',
        count: 1,
    });
}
export function getAllSyncRecords() {
    try {
        const sheet = getSyncRecordSheetIfExists();
        if (!sheet) {
            bgmLog(LOG_LEVELS.WARN, '[getAllSyncRecords] 同步记录表不存在，请先启用同步记录功能');
            return [];
        }
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
        const sheet = getSyncRecordSheetIfExists();
        if (!sheet) {
            bgmLog(LOG_LEVELS.WARN, '[deduplicateSyncRecords] 同步记录表不存在，请先启用同步记录功能');
            return false;
        }
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
        for (const [, rows] of sidRows) {
            if (rows.length <= 1)
                continue;
            hasDuplicates = true;
            const keepRow = rows[0];
            if (keepRow === undefined)
                continue;
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
export function formatSyncRecordSheet(sheet) {
    if (_formattingInProgress)
        return;
    _formattingInProgress = true;
    try {
        const target = sheet || getSyncRecordSheetIfExists();
        if (!target) {
            bgmLog(LOG_LEVELS.WARN, '[formatSyncRecordSheet] 同步记录表不存在，请先启用同步记录功能');
            _formattingInProgress = false;
            return;
        }
        const lastRow = getLastRow(target);
        if (lastRow < 1) {
            _formattingInProgress = false;
            return;
        }
        const colCount = SYNC_RECORD_COLUMNS.length;
        const lastColLetter = colNumToLetter(colCount);
        const fullRange = target.Range(`A1:${lastColLetter}${lastRow}`);
        const dataRange = lastRow >= 2 ? target.Range(`A2:${lastColLetter}${lastRow}`) : null;
        // 1. 字体
        try {
            if (fullRange.Font)
                fullRange.Font.Name = 'Maple Mono NF CN Medium';
        }
        catch {
            // 忽略：此处无需处理错误
        }
        // 2. 自动行高
        try {
            fullRange.EntireRow.AutoFit();
        }
        catch {
            // 忽略：此处无需处理错误
        }
        // 3. 水平居中
        if (dataRange) {
            try {
                dataRange.HorizontalAlignment = -4108;
            }
            catch {
                // 忽略：此处无需处理错误
            }
        }
        // 表头也居中
        try {
            target.Range(`A1:${lastColLetter}1`).HorizontalAlignment = -4108;
        }
        catch {
            // 忽略：此处无需处理错误
        }
        // 4. 自动列宽（全列）
        try {
            fullRange.EntireColumn.AutoFit();
        }
        catch {
            // 忽略：此处无需处理错误
        }
        // 5. URL 列（D列）固定宽度，不撑宽也不撑高
        const urlColLetter = colNumToLetter(SYNC_RECORD_COL.URL);
        try {
            const urlRange = target.Range(`${urlColLetter}:${urlColLetter}`);
            urlRange.ColumnWidth = 42;
        }
        catch {
            // 忽略：此处无需处理错误
        }
        // 6. 名称列边框（C列）
        const nameColLetter = colNumToLetter(SYNC_RECORD_COL.NAME);
        if (dataRange) {
            try {
                const nameRange = target.Range(`${nameColLetter}2:${nameColLetter}${lastRow}`);
                nameRange.Borders.LineStyle = 1;
            }
            catch {
                // 忽略：此处无需处理错误
            }
        }
        // 7. 收藏状态列边框
        const collTypeColLetter = colNumToLetter(SYNC_RECORD_COL.COLL_TYPE);
        if (dataRange) {
            try {
                const collRange = target.Range(`${collTypeColLetter}2:${collTypeColLetter}${lastRow}`);
                collRange.Borders.LineStyle = 1;
            }
            catch {
                // 忽略：此处无需处理错误
            }
        }
        bgmLog(LOG_LEVELS.INFO, '同步记录表格式已设置');
        _formattingInProgress = false;
    }
    catch (e) {
        _formattingInProgress = false;
        BGM.handleError(e, { context: 'formatSyncRecordSheet', showAlert: false });
    }
}
export function clearSyncRecords() {
    try {
        const sheet = getSyncRecordSheetIfExists();
        if (!sheet) {
            bgmLog(LOG_LEVELS.WARN, '[clearSyncRecords] 同步记录表不存在，请先启用同步记录功能');
            return false;
        }
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
        const sheet = getSyncRecordSheetIfExists();
        if (!sheet) {
            bgmLog(LOG_LEVELS.WARN, '[openSyncRecordSheet] 同步记录表不存在，请先启用同步记录功能');
            return;
        }
        sheet.Activate();
        bgmLog(LOG_LEVELS.INFO, '已切换到同步记录工作表');
    }
    catch (e) {
        BGM.handleError(e, { context: 'openSyncRecordSheet', showAlert: false });
    }
}
