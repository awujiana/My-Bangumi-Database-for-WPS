/**
 * 同步记录模块
 * @module sync/syncRecord
 * @description 管理同步记录工作表，记录同步历史
 */
import { XL, BGM_COLOR, LOG_LEVELS, BGM, BGM_SUBJECT_TYPES, SYNC_STATUS } from '../../generated-types/types/util.js';
import { getApp, bgmLog, colNumToLetter, getCell } from '../../generated-types/types/util.js';
// ========== 向后兼容别名 ==========
export function sendToTaskpaneSR(data) {
    return BGM.postMessage(data);
}
export function showDialogSR(title, message) {
    BGM.showDialog(title, message);
}
// ========== 常量定义 ==========
// 已从 util.js 导入
// ========== 表头设置 ==========
export function setSyncRecordHeaders(sheet) {
    const headers = ["序号", "同步时间", "名称", "URL", "SID", "条目类型", "次数", "内容", "状态", "备注"];
    bgmLog(LOG_LEVELS.DEBUG, "setSyncRecordHeaders 开始 - 工作表: " + (sheet ? sheet.Name : "null"));
    // 设置表头
    for (let i = 0; i < headers.length; i++) {
        try {
            const colLetter = colNumToLetter(i + 1);
            const cell = sheet.Range(`${colLetter}1`);
            if (cell) {
                cell.Value2 = headers[i];
                if (cell.Font)
                    cell.Font.Bold = true;
                if (cell.Interior)
                    cell.Interior.Color = BGM_COLOR.GRAY;
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.ERROR, `设置表头失败 - 列${i + 1}: ${e.message}`);
        }
    }
    // 设置说明行并冻结首行
    try {
        const noteCell = sheet.Range("I2");
        if (noteCell) {
            noteCell.Value2 = "状态颜色：绿=成功 | 红=失败 | 黄=跳过 | 紫=已收藏(1次) | 浅绿=已收藏(2次) | 深绿=已收藏(3次+)";
            if (noteCell.Font) {
                noteCell.Font.Size = 9;
                noteCell.Font.Color = 0x404040;
            }
            if (noteCell.Interior)
                noteCell.Interior.Color = XL.NONE;
        }
        // 冻结首行
        try {
            if (sheet && sheet.Application && sheet.Application.ActiveWindow) {
                sheet.Range("A2").Select();
                sheet.Application.ActiveWindow.FreezePanes = true;
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, "冻结首行失败: " + e.message);
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, "设置说明行失败: " + e.message);
    }
    bgmLog(LOG_LEVELS.INFO, "setSyncRecordHeaders 完成");
}
export function checkHeaderExists(sheet) {
    try {
        const firstCell = sheet.Range("A1");
        return firstCell && String(firstCell.Value2 || "").trim() === "序号";
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, "checkHeaderExists error: " + e.message);
        return false;
    }
}
// ========== 缓存管理（核心优化） ==========
let _syncRecordSidCache = new Map(); // sid -> 行号
let _syncRecordListCache = []; // 完整记录列表
let _syncRecordCacheValid = false; // 缓存是否有效
function invalidateCache() {
    _syncRecordSidCache.clear();
    _syncRecordListCache.length = 0;
    _syncRecordCacheValid = false;
}
function buildCache(sheet) {
    if (_syncRecordCacheValid)
        return;
    _syncRecordSidCache.clear();
    _syncRecordListCache.length = 0;
    const lastRow = getLastDataRow(sheet);
    for (let row = 2; row <= lastRow; row++) {
        try {
            const sid = String(sheet.Range("E" + row).Value2 || "").trim();
            const url = String(sheet.Range("D" + row).Value2 || "").trim();
            if (!url && !sid)
                continue;
            _syncRecordSidCache.set(sid, row);
            _syncRecordListCache.push({
                seq: sheet.Range("A" + row).Value2,
                time: sheet.Range("B" + row).Value2,
                name: sheet.Range("C" + row).Value2,
                url: url,
                sid: sid,
                type: sheet.Range("F" + row).Value2,
                count: parseInt(sheet.Range("G" + row).Value2) || 1,
                content: sheet.Range("H" + row).Value2,
                status: sheet.Range("I" + row).Value2 || SYNC_STATUS.SUCCESS,
                message: sheet.Range("J" + row).Value2,
                row: row
            });
        }
        catch (e) {
            // 忽略单行读取错误
        }
    }
    _syncRecordCacheValid = true;
}
/**
 * 获取工作表最后有数据的行号（从 A 列向上定位）
 */
function getLastDataRow(sheet) {
    try {
        const lastCell = sheet.Range("A" + sheet.Rows.Count);
        if (lastCell?.Value2) {
            const endCell = lastCell.End(-4162); // xlUp
            return Math.max(endCell?.Row || 1, 1);
        }
    }
    catch (e) { }
    // 回退到遍历
    for (let row = 2; row <= 10000; row++) {
        if (!sheet.Range("A" + row)?.Value2)
            return row - 1;
    }
    return 1;
}
/**
 * 根据 SID 获取缓存中的行号（0 表示未找到）
 */
function getRecordRowBySid(sheet, sid) {
    if (!sid)
        return 0;
    buildCache(sheet);
    return _syncRecordSidCache.get(sid) || 0;
}
// ========== 添加/更新同步记录（核心优化：消除重复代码） ==========
/**
 * 添加同步记录（同时支持新增与更新）
 * 调用方式灵活：
 *   addSyncRecord(options) - 自动获取工作表
 *   addSyncRecord(sheet, record) - 指定工作表
 */
export function addSyncRecord(sheetOrOptions, record) {
    let sheet, options;
    if (sheetOrOptions && typeof sheetOrOptions === 'object' && !sheetOrOptions.Name && !sheetOrOptions.Range) {
        options = sheetOrOptions;
    }
    else {
        sheet = sheetOrOptions;
        options = record;
    }
    if (!sheet)
        sheet = getOrCreateSyncRecordSheet();
    if (!sheet || !options)
        return false;
    try {
        // 确保缓存最新（使用前刷新，避免旧缓存干扰）
        invalidateCache();
        buildCache(sheet);
        const sid = String(options.sid || "");
        const existingRow = _syncRecordSidCache.get(sid) || 0;
        const isNew = existingRow === 0;
        const newRow = isNew ? getLastDataRow(sheet) + 1 : existingRow;
        const currentCount = isNew ? 1 : (parseInt(sheet.Range("G" + existingRow).Value2) || 0) + 1;
        const now = formatCurrentTime();
        // 构建要写入的数据结构
        const data = {
            A: isNew ? (getLastDataRow(sheet) + 1 - 1) : undefined, // 序号（仅新增时）
            B: now,
            C: options.name || "",
            D: options.url || "",
            E: sid,
            F: options.type || "",
            G: currentCount,
            H: options.content || "",
            I: options.status || SYNC_STATUS.COLLECTED,
            J: options.message || options.comment || ""
        };
        // 执行写入（带激活重试）
        if (!writeRowData(sheet, newRow, data, isNew)) {
            bgmLog(LOG_LEVELS.ERROR, "addSyncRecord 写入失败 row:" + newRow);
            return false;
        }
        // 设置状态颜色
        setStatusColor(sheet, newRow, data.I);
        // 更新缓存（直接修改本地缓存比重建更快，且保证一致性）
        if (isNew) {
            _syncRecordListCache.push({
                seq: data.A, time: data.B, name: data.C, url: data.D,
                sid: sid, type: data.F, count: data.G, content: data.H,
                status: data.I, message: data.J, row: newRow
            });
        }
        else {
            const idx = _syncRecordListCache.findIndex(r => String(r.sid) === sid);
            if (idx !== -1) {
                Object.assign(_syncRecordListCache[idx], {
                    time: data.B, name: data.C, url: data.D, type: data.F,
                    count: data.G, content: data.H, status: data.I, message: data.J
                });
            }
        }
        _syncRecordSidCache.set(sid, newRow);
        bgmLog(LOG_LEVELS.INFO, `addSyncRecord ${isNew ? "新增" : "更新"} - 行:${newRow} 状态:${data.I}`);
        return true;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "addSyncRecord error: " + e.message);
        return false;
    }
}
/**
 * 将数据写入指定行的所有列（带激活重试机制）
 */
function writeRowData(sheet, row, data, isNew) {
    const write = () => {
        if (isNew) {
            const cellA = sheet.Range("A" + row);
            if (cellA)
                cellA.Value2 = data.A;
        }
        for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
            const cell = sheet.Range(col + row);
            if (cell)
                cell.Value2 = data[col];
        }
    };
    // 第一次写入
    write();
    // 验证写入是否成功（A列）
    const verifyCell = sheet.Range("A" + row);
    const verifyVal = verifyCell ? verifyCell.Value2 : null;
    if (verifyVal !== null && verifyVal !== undefined && String(verifyVal).trim() !== "") {
        return true;
    }
    // 重试：激活工作表后再次写入
    bgmLog(LOG_LEVELS.WARN, "首次写入验证失败，尝试激活后重新写入");
    try {
        sheet.Activate();
        write();
        const reVerify = sheet.Range("A" + row);
        return reVerify && reVerify.Value2 != null && String(reVerify.Value2).trim() !== "";
    }
    catch (retryErr) {
        bgmLog(LOG_LEVELS.ERROR, "写入重试失败: " + retryErr.message);
        return false;
    }
}
/**
 * 设置状态单元格的颜色
 */
function setStatusColor(sheet, row, status) {
    const cell = sheet.Range("I" + row);
    if (!cell?.Interior)
        return;
    const colorMap = {
        [SYNC_STATUS.SUCCESS]: BGM_COLOR.SUCCESS,
        [SYNC_STATUS.COLLECTED]: BGM_COLOR.SUCCESS, // 已收藏等同于成功
        [SYNC_STATUS.FAIL]: BGM_COLOR.FAIL,
        [SYNC_STATUS.SKIP]: BGM_COLOR.SKIP,
    };
    const color = colorMap[status] || BGM_COLOR.GRAY;
    cell.Interior.Color = color;
}
// ========== 获取或创建同步记录工作表 ==========
export function getOrCreateSyncRecordSheet() {
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.ERROR, "getOrCreateSyncRecordSheet - 无法获取 ActiveWorkbook");
        return null;
    }
    const sheets = app.ActiveWorkbook.Sheets;
    const sheetName = "同步记录";
    // 查找已存在的工作表
    for (let i = 1; i <= sheets.Count; i++) {
        if (sheets.Item(i).Name === sheetName) {
            const existingSheet = sheets.Item(i);
            if (!checkHeaderExists(existingSheet)) {
                setSyncRecordHeaders(existingSheet);
            }
            bgmLog(LOG_LEVELS.INFO, "找到现有同步记录工作表");
            return existingSheet;
        }
    }
    // 创建新工作表
    try {
        const newSheet = sheets.Add();
        newSheet.Name = sheetName;
        setSyncRecordHeaders(newSheet);
        bgmLog(LOG_LEVELS.INFO, "新工作表已创建: " + sheetName);
        return newSheet;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "创建工作表失败: " + e.message);
        return null;
    }
}
// ========== 更新同步记录（单独函数） ==========
export function updateSyncRecord(sid, updates) {
    const sheet = getOrCreateSyncRecordSheet();
    if (!sheet)
        return false;
    // 使缓存失效，重新读取最新数据
    invalidateCache();
    buildCache(sheet);
    const row = _syncRecordSidCache.get(sid);
    if (!row)
        return false;
    try {
        if (updates.count !== undefined) {
            const current = parseInt(sheet.Range("G" + row).Value2) || 0;
            sheet.Range("G" + row).Value2 = current + updates.count;
        }
        if (updates.time)
            sheet.Range("B" + row).Value2 = updates.time;
        if (updates.status) {
            sheet.Range("I" + row).Value2 = updates.status;
            setStatusColor(sheet, row, updates.status);
        }
        if (updates.message) {
            const currentMsg = sheet.Range("J" + row).Value2 || "";
            sheet.Range("J" + row).Value2 = currentMsg ? `${currentMsg}; ${updates.message}` : updates.message;
        }
        invalidateCache(); // 修改后必须使缓存失效
        return true;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "updateSyncRecord error: " + e.message);
        return false;
    }
}
// ========== 查询 ==========
export function getAllSyncRecords() {
    const sheet = getOrCreateSyncRecordSheet();
    if (!sheet)
        return [];
    buildCache(sheet);
    return _syncRecordListCache.slice(); // 返回副本
}
// ========== 清除同步记录 ==========
export function clearSyncRecords(confirmPrompt = true) {
    if (confirmPrompt !== false) {
        const confirmMsg = "确定要清除所有同步记录吗？此操作不可撤销。";
        if (typeof window.showConfirmDialog === 'function') {
            window.showConfirmDialog(confirmMsg, () => _doClearSyncRecords());
            return;
        }
        if (typeof window.BGMConfirm === 'function') {
            window.BGMConfirm(confirmMsg, "确认清除", () => _doClearSyncRecords());
            return;
        }
        if (!confirm(confirmMsg))
            return;
    }
    _doClearSyncRecords();
}
function _doClearSyncRecords() {
    const sheet = getOrCreateSyncRecordSheet();
    if (!sheet)
        return;
    try {
        sheet.Activate();
        const lastRow = getLastDataRow(sheet);
        if (lastRow < 2) {
            window.showAlert?.("没有同步记录可清除");
            return;
        }
        sheet.Range(`A2:J${lastRow}`).Delete();
        invalidateCache();
        window.showAlert?.(`已清除 ${lastRow - 1} 条同步记录`);
        bgmLog(LOG_LEVELS.INFO, "同步记录已清除");
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "清除同步记录失败: " + e.message);
    }
}
// ========== 批量写入辅助 ==========
export function activateSyncRecordSheet() {
    const sheet = getOrCreateSyncRecordSheet();
    if (sheet) {
        try {
            sheet.Activate();
        }
        catch (e) { }
    }
    return sheet;
}
export function finalizeSyncRecordBatch() {
    const sheet = getOrCreateSyncRecordSheet();
    if (sheet) {
        try {
            sheet.Calculate();
        }
        catch (e) { }
        invalidateCache(); // 批量操作后使缓存失效
    }
}
// ========== 打开同步记录工作表 ==========
export function openSyncRecordSheet() {
    const sheet = getOrCreateSyncRecordSheet();
    if (sheet) {
        sheet.Activate();
    }
    else {
        window.showAlert?.("无法打开同步记录工作表");
    }
}
// ========== 工具函数 ==========
export function formatCurrentTime() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}
// ========== 旧接口兼容 ==========
export function fetchAndRecordBgCollections(_token, _userId, collections) {
    if (!collections?.length) {
        bgmLog(LOG_LEVELS.WARN, "没有收藏数据需要记录");
        return;
    }
    bgmLog(LOG_LEVELS.INFO, `开始记录 ${collections.length} 条收藏`);
    let count = 0;
    collections.forEach(item => {
        if (addSyncRecord({
            name: item.name || "",
            url: `https://bgm.tv/subject/${item.sid}`,
            sid: String(item.sid),
            type: String(item.type || "2"),
            count: 1,
            content: item.comment || (item.rate ? `评分: ${item.rate}` : ""),
            status: SYNC_STATUS.COLLECTED
        })) {
            count++;
        }
    });
    bgmLog(LOG_LEVELS.INFO, `记录完成，共添加 ${count} 条`);
}
export function clearSheetMarksInSheet(sheetIndex) {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        return;
    const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    if (!ws)
        return;
    try {
        const lastRow = ws.Range("A" + ws.Rows.Count).End(-4162).Row;
        for (let row = 2; row <= lastRow; row++) {
            const cell = getCell(ws, row, 4);
            if (cell) {
                cell.Value = "";
                if (cell.Interior)
                    cell.Interior.ColorIndex = XL.NONE;
            }
        }
        BGM?.showDialog?.("完成", "已清除所有标记");
        bgmLog(LOG_LEVELS.INFO, "清除标记完成");
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "清除标记失败: " + e.message);
    }
}
// ========== 向后兼容挂载 ==========
if (typeof window !== 'undefined') {
    window.setSyncRecordHeaders = setSyncRecordHeaders;
    window.checkHeaderExists = checkHeaderExists;
    window.getOrCreateSyncRecordSheet = getOrCreateSyncRecordSheet;
    window.addSyncRecord = addSyncRecord;
    window.updateSyncRecord = updateSyncRecord;
    window.getAllSyncRecords = getAllSyncRecords;
    window.clearSyncRecords = clearSyncRecords;
    window.openSyncRecordSheet = openSyncRecordSheet;
    window.activateSyncRecordSheet = activateSyncRecordSheet;
    window.finalizeSyncRecordBatch = finalizeSyncRecordBatch;
    window.fetchAndRecordBgCollections = fetchAndRecordBgCollections;
    window.formatCurrentTime = formatCurrentTime;
    window.clearSheetMarksInSheet = clearSheetMarksInSheet;
    window.BGM_SUBJECT_TYPES = BGM_SUBJECT_TYPES;
}
