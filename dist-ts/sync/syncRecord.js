/**
 * @fileoverview 同步记录管理模块
 * @module sync/syncRecord
 * @description 管理「同步记录」工作表，记录所有同步操作的详细信息。
 *              支持记录的增删改查，并提供缓存机制优化读取性能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { LOG_LEVELS, SYNC_STATUS, BGM_COLOR, bgmLog, getApp, trim, BGM } from '../index.js';
/**
 * 同步记录工作表名称
 *
 * @constant
 * @type {string}
 */
const SYNC_RECORD_SHEET_NAME = '同步记录';
/**
 * 同步记录列配置
 *
 * @constant
 * @type {string[]}
 */
const SYNC_RECORD_COLUMNS = [
    '序号', '同步时间', '名称', 'URL', 'SID', '条目类型',
    '次数', '内容', '状态', '备注'
];
/**
 * 内存缓存：SID到行号的映射
 *
 * @type {Map<string, number>}
 */
let _syncRecordSidCache = new Map();
/**
 * 内存缓存：所有记录列表
 *
 * @type {SyncRecord[]}
 */
let _syncRecordListCache = [];
/**
 * 缓存有效标志
 *
 * @type {boolean}
 */
let _syncRecordCacheValid = false;
/**
 * 获取或创建同步记录工作表
 *
 * @function getOrCreateSyncRecordSheet
 * @returns {any} 工作表对象
 *
 * @description
 * 如果「同步记录」工作表不存在，则创建一个新的。
 * 工作表包含10列：序号、时间、名称、URL、SID、类型、次数、内容、状态、备注
 */
/**
 * 获取或创建同步记录工作表
 *
 * @function getOrCreateSyncRecordSheet
 * @returns {any} 工作表对象
 */
export function getOrCreateSyncRecordSheet() {
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        throw new Error('无法获取工作簿');
    }
    const wb = app.ActiveWorkbook;
    let syncSheet = null;
    // 尝试获取现有工作表（通过遍历 Sheets 集合，根据名称匹配）
    try {
        const sheets = wb.Sheets;
        for (let i = 1; i <= sheets.Count; i++) {
            const sheet = sheets.Item(i); // 使用数字索引
            if (sheet.Name === SYNC_RECORD_SHEET_NAME) {
                syncSheet = sheet;
                break;
            }
        }
    }
    catch (e) {
        syncSheet = null;
    }
    // 如果不存在，创建新工作表
    if (!syncSheet) {
        // 使用 wb.Sheets.Add() 创建新的工作表
        syncSheet = wb.Sheets.Add();
        // 设置工作表名称为同步记录表名称
        syncSheet.Name = SYNC_RECORD_SHEET_NAME;
        // 设置表头
        for (let i = 0; i < SYNC_RECORD_COLUMNS.length; i++) {
            const cell = syncSheet.Cells(1, i + 1);
            cell.Value2 = SYNC_RECORD_COLUMNS[i];
            if (cell.Interior) {
                cell.Interior.Color = BGM_COLOR.GRAY;
            }
            // 为了方便查看，可以将新创建的工作表移到末尾
            try {
                syncSheet.Move(null, wb.Sheets.Item(wb.Sheets.Count));
            }
            catch (moveError) {
                // 忽略移动错误，不影响功能
            }
            bgmLog(LOG_LEVELS.INFO, '已创建同步记录工作表');
        }
        // 使缓存失效，确保后续读取到最新数据
        invalidateCache();
        return syncSheet;
    }
}
/**
 * 使缓存失效
 *
 * @function invalidateCache
 */
function invalidateCache() {
    _syncRecordCacheValid = false;
}
/**
 * 构建缓存
 *
 * @function buildCache
 * @param {any} sheet - 工作表对象
 */
function buildCache(sheet) {
    if (_syncRecordCacheValid)
        return;
    _syncRecordSidCache.clear();
    _syncRecordListCache = [];
    try {
        const lastRow = sheet.UsedRange?.Rows.Count || 1;
        for (let r = 2; r <= lastRow; r++) {
            const sid = trim(String(sheet.Cells(r, 5).Value2 || ''));
            const record = {
                id: r,
                time: trim(String(sheet.Cells(r, 2).Value2 || '')),
                name: trim(String(sheet.Cells(r, 3).Value2 || '')),
                url: trim(String(sheet.Cells(r, 4).Value2 || '')),
                sid: sid,
                type: trim(String(sheet.Cells(r, 6).Value2 || '')),
                count: parseInt(String(sheet.Cells(r, 7).Value2 || '0'), 10) || 0,
                content: trim(String(sheet.Cells(r, 8).Value2 || '')),
                status: trim(String(sheet.Cells(r, 9).Value2 || '')),
                message: trim(String(sheet.Cells(r, 10).Value2 || ''))
            };
            _syncRecordListCache.push(record);
            if (sid) {
                _syncRecordSidCache.set(sid, r);
            }
        }
        _syncRecordCacheValid = true;
        bgmLog(LOG_LEVELS.DEBUG, `已构建缓存，共 ${_syncRecordListCache.length} 条记录`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'buildCache error:', e);
    }
}
/**
 * 添加同步记录
 *
 * @function addSyncRecord
 * @param {UpdateRecordParams} params - 记录参数
 * @returns {boolean} 是否添加成功
 *
 * @description
 * 如果该SID已有记录，则更新现有记录并增加计数。
 * 否则添加新记录。
 */
export function addSyncRecord(params) {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        // 确保缓存是最新的
        if (!_syncRecordCacheValid) {
            buildCache(sheet);
        }
        const sid = params.sid || '';
        const now = new Date().toLocaleString('zh-CN');
        // 检查是否已有记录
        if (sid && _syncRecordSidCache.has(sid)) {
            // 更新现有记录
            const existingRow = _syncRecordSidCache.get(sid);
            const existingCount = parseInt(String(sheet.Cells(existingRow, 7).Value2 || '0'), 10) || 0;
            const newCount = existingCount + (params.count || 1);
            sheet.Cells(existingRow, 7).Value2 = newCount;
            if (params.status)
                sheet.Cells(existingRow, 9).Value2 = params.status;
            if (params.message)
                sheet.Cells(existingRow, 10).Value2 = params.message;
            // 根据同步次数设置颜色
            const seqCell = sheet.Cells(existingRow, 1);
            if (seqCell?.Interior) {
                if (newCount === 1) {
                    seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
                }
                else if (newCount === 2) {
                    seqCell.Interior.Color = BGM_COLOR.LIGHT_GREEN;
                }
                else {
                    seqCell.Interior.Color = BGM_COLOR.DARK_GREEN;
                }
            }
            bgmLog(LOG_LEVELS.DEBUG, `更新同步记录: SID=${sid}, 次数=${newCount}`);
        }
        else {
            // 添加新记录
            const lastRow = sheet.UsedRange?.Rows.Count || 1;
            const newRow = lastRow + 1;
            sheet.Cells(newRow, 1).Value2 = newRow - 1;
            sheet.Cells(newRow, 2).Value2 = now;
            sheet.Cells(newRow, 3).Value2 = params.name || '';
            sheet.Cells(newRow, 4).Value2 = params.url || '';
            sheet.Cells(newRow, 5).Value2 = sid;
            sheet.Cells(newRow, 6).Value2 = params.type || '';
            sheet.Cells(newRow, 7).Value2 = params.count || 1;
            sheet.Cells(newRow, 8).Value2 = params.content || '';
            sheet.Cells(newRow, 9).Value2 = params.status || SYNC_STATUS.SUCCESS;
            sheet.Cells(newRow, 10).Value2 = params.message || '';
            // 设置颜色标记
            const seqCell = sheet.Cells(newRow, 1);
            if (seqCell?.Interior) {
                if (params.status === SYNC_STATUS.SUCCESS) {
                    seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
                }
                else if (params.status === SYNC_STATUS.FAIL) {
                    seqCell.Interior.Color = BGM_COLOR.FAIL;
                }
                else {
                    seqCell.Interior.Color = BGM_COLOR.SKIP;
                }
            }
            // 更新缓存
            _syncRecordSidCache.set(sid, newRow);
            _syncRecordListCache.push({
                id: newRow,
                time: now,
                name: params.name,
                url: params.url,
                sid: sid,
                type: params.type,
                count: params.count || 1,
                content: params.content,
                status: params.status,
                message: params.message
            });
            bgmLog(LOG_LEVELS.DEBUG, `添加同步记录: SID=${sid}, 行=${newRow}`);
        }
        return true;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'addSyncRecord error:', e);
        return false;
    }
}
/**
 * 获取所有同步记录
 *
 * @function getAllSyncRecords
 * @returns {SyncRecord[]} 所有同步记录数组
 *
 * @description
 * 从缓存中返回所有同步记录。
 * 如果缓存无效，会先重建缓存。
 */
export function getAllSyncRecords() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        if (!_syncRecordCacheValid) {
            buildCache(sheet);
        }
        return [..._syncRecordListCache];
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'getAllSyncRecords error:', e);
        return [];
    }
}
/**
 * 清除所有同步记录
 *
 * @function clearSyncRecords
 * @returns {boolean} 是否清除成功
 */
export function clearSyncRecords() {
    try {
        const sheet = getOrCreateSyncRecordSheet();
        // 删除数据行（保留表头）
        const lastRow = sheet.UsedRange?.Rows.Count || 1;
        if (lastRow > 1) {
            sheet.Rows('2:' + lastRow).Delete();
        }
        // 重置缓存
        _syncRecordSidCache.clear();
        _syncRecordListCache = [];
        _syncRecordCacheValid = true;
        bgmLog(LOG_LEVELS.INFO, '已清除所有同步记录');
        return true;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, 'clearSyncRecords error:', e);
        return false;
    }
}
/**
 * 打开同步记录工作表
 *
 * @function openSyncRecordSheet
 */
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
/**
 * 清除指定工作表的颜色标记
 *
 * @function clearSheetMarksInSheet
 * @param {number} sheetIndex - 工作表索引
 */
export function clearSheetMarksInSheet(sheetIndex) {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return;
        const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
        if (!ws)
            return;
        const lastRow = ws.UsedRange?.Rows.Count || 1000;
        // 清除D列的颜色
        for (let r = 1; r <= lastRow; r++) {
            try {
                const cell = ws.Cells(r, 4);
                if (cell?.Interior) {
                    cell.Interior.ColorIndex = -4142; // xlColorIndexNone
                }
            }
            catch (_) { }
        }
        bgmLog(LOG_LEVELS.INFO, `已清除工作表 ${sheetIndex} 的颜色标记`);
    }
    catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'clearSheetMarksInSheet' });
    }
}
;
