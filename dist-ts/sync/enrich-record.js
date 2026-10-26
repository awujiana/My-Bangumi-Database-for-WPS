/**
 * @fileoverview 富化记录管理模块
 * @module sync/enrichRecord
 * @description 管理「富化记录」工作表，记录所有新番表富化操作的详细信息。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { LOG_LEVELS, BGM_COLOR } from '../core/constants.js';
import { writeSheetHeaderRow } from './sync-record.js';
import { bgmLog, getApp, getLastRow, columnNumberToLetter, setCellValue, readRangeValues, BGM, } from '../tools/util/index.js';
export const ENRICH_RECORD_SHEET_NAME = '富化记录';
export const ENRICH_RECORD_COLUMNS = [
    '时间戳',
    '匹配方式',
    '动漫名称',
    '行号',
    '富化字段',
    '原字段',
    '新字段',
    '操作类型',
    '备注',
];
export const ENRICH_RECORD_COLUMN = {
    TIMESTAMP: 1,
    MATCH_TYPE: 2,
    NAME: 3,
    ROW: 4,
    ENRICHED_FIELD: 5,
    OLD_VALUE: 6,
    NEW_VALUE: 7,
    ACTION: 8,
    NOTE: 9,
};
export function getActionColor(action) {
    switch (action) {
        case 'fill': {
            return BGM_COLOR.SUCCESS;
        }
        case 'append': {
            return 0xffff80;
        }
        case 'skip': {
            return BGM_COLOR.SKIP;
        }
        case 'error': {
            return BGM_COLOR.FAIL;
        }
        default: {
            return BGM_COLOR.GRAY;
        }
    }
}
export function getOrCreateEnrichRecordSheet() {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        throw new Error('无法获取工作簿');
    const wb = app.ActiveWorkbook;
    let enrichSheet = null;
    try {
        const sheets = wb.Sheets;
        // 工作表总数只读一次：写在循环条件里每轮都会多一次跨进程 COM 往返
        const sheetCount = sheets.Count;
        for (let index = 1; index <= sheetCount; index += 1) {
            const sheet = sheets.Item(index);
            if (sheet.Name === ENRICH_RECORD_SHEET_NAME) {
                enrichSheet = sheet;
                break;
            }
        }
    }
    catch (error) {
        BGM.handleError(error, { context: 'getOrCreateEnrichRecordSheet', showAlert: false });
    }
    if (enrichSheet) {
        for (const [index, expectedHeader] of ENRICH_RECORD_COLUMNS.entries()) {
            const columnLetter = columnNumberToLetter(index + 1);
            const cell = enrichSheet.Range(`${columnLetter}1`);
            const currentHeader = String(cell.Value2 ?? '').trim();
            if (currentHeader !== expectedHeader) {
                cell.Value2 = expectedHeader;
                bgmLog(LOG_LEVELS.INFO, `修复表头: ${columnLetter}1 从 "${currentHeader}" → "${expectedHeader}"`);
            }
        }
    }
    else {
        enrichSheet = wb.Sheets.Add();
        enrichSheet.Name = ENRICH_RECORD_SHEET_NAME;
        writeSheetHeaderRow(enrichSheet, ENRICH_RECORD_COLUMNS, { gray: true });
        try {
            enrichSheet.Move(null, wb.Sheets.Item(wb.Sheets.Count));
        }
        catch (moveError) {
            BGM.handleError(moveError, { context: 'getOrCreateEnrichRecordSheet', showAlert: false });
        }
        const lastColumnLetter = columnNumberToLetter(ENRICH_RECORD_COLUMNS.length);
        const fullRange = enrichSheet.Range(`A1:${lastColumnLetter}1`);
        try {
            if (fullRange.Font)
                fullRange.Font.Name = 'Maple Mono NF CN Medium';
        }
        catch {
            // 忽略字体设置失败
        }
        try {
            fullRange.EntireColumn.AutoFit();
        }
        catch {
            // 忽略列宽自适应失败
        }
        bgmLog(LOG_LEVELS.INFO, '已创建富化记录工作表');
    }
    return enrichSheet;
}
/**
 * 写入单条富化记录
 *
 * 性能提示：批量场景请用 `addEnrichRecords()` —— 本函数每次调用都会重新获取表句柄
 * 并逐单元格写入 9 次，循环调用会产生大量跨进程 COM 调用（P1-C）。
 *
 * @returns 是否写入成功（失败时已记录日志）
 */
export function addEnrichRecord(parameters) {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        let nextRow = 1;
        const usedRange = sheet.UsedRange;
        if (usedRange) {
            const lastUsedRow = usedRange.Row + usedRange.Rows.Count - 1;
            nextRow = lastUsedRow + 1;
        }
        else {
            nextRow = sheet.Rows.Count > 1 ? 2 : 1;
        }
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.TIMESTAMP, parameters.timestamp);
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.MATCH_TYPE, parameters.matchType);
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.NAME, parameters.name);
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.ROW, parameters.row);
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.ENRICHED_FIELD, parameters.enrichedField);
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.OLD_VALUE, parameters.oldValue);
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.NEW_VALUE, parameters.updatedValue);
        setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.ACTION, parameters.action);
        if (parameters.note !== undefined) {
            setCellValue(sheet, nextRow, ENRICH_RECORD_COLUMN.NOTE, parameters.note);
        }
        const actionColor = getActionColor(parameters.action);
        const actionColumnLetter = columnNumberToLetter(ENRICH_RECORD_COLUMN.ACTION);
        const actionCell = sheet.Range(`${actionColumnLetter}${String(nextRow)}`);
        if (actionCell.Interior) {
            actionCell.Interior.Color = actionColor;
        }
        bgmLog(LOG_LEVELS.INFO, `[addEnrichRecord] ${parameters.name} (${parameters.enrichedField}): ${parameters.action}`);
        return true;
    }
    catch (error) {
        BGM.handleError(error, { context: 'addEnrichRecord', showAlert: false });
        return false;
    }
}
/**
 * 批量写入富化记录（性能入口）
 *
 * 相比逐条 `addEnrichRecord`：只获取一次表句柄，并通过一次 `Range.Value2` 写入全部行。
 *
 * @returns 是否写入成功（失败时已记录日志）
 */
export function addEnrichRecords(records) {
    if (records.length === 0)
        return true;
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        let startRow = 2;
        const usedRange = sheet.UsedRange;
        if (usedRange) {
            startRow = usedRange.Row + usedRange.Rows.Count;
        }
        const rows = records.map((r) => [
            r.timestamp,
            r.matchType,
            r.name,
            String(r.row),
            r.enrichedField,
            r.oldValue,
            r.updatedValue,
            r.action,
            r.note ?? '',
        ]);
        const endRow = startRow + rows.length - 1;
        const startColumnLetter = columnNumberToLetter(1);
        const endColumnLetter = columnNumberToLetter(ENRICH_RECORD_COLUMNS.length);
        const range = sheet.Range(`${startColumnLetter}${String(startRow)}:${endColumnLetter}${String(endRow)}`);
        range.Value2 = rows;
        for (const [index, rowValues] of rows.entries()) {
            const row = startRow + index;
            const action = rowValues[ENRICH_RECORD_COLUMN.ACTION - 1] ?? '';
            const color = getActionColor(action);
            const actionColumnLetter = columnNumberToLetter(ENRICH_RECORD_COLUMN.ACTION);
            const cell = sheet.Range(`${actionColumnLetter}${String(row)}`);
            if (cell.Interior) {
                cell.Interior.Color = color;
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[addEnrichRecords] 批量写入完成：${String(records.length)} 条记录`);
        return true;
    }
    catch (error) {
        BGM.handleError(error, { context: 'addEnrichRecords', showAlert: false });
        return false;
    }
}
export function clearEnrichRecords() {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        const usedRange = sheet.UsedRange;
        const lastRow = usedRange ? usedRange.Row + usedRange.Rows.Count - 1 : sheet.Rows.Count;
        if (lastRow > 1) {
            sheet.Range(`2:${String(lastRow)}`).Delete();
        }
        bgmLog(LOG_LEVELS.INFO, '已清除所有富化记录');
    }
    catch (error) {
        BGM.handleError(error, { context: 'clearEnrichRecords', showAlert: false });
    }
}
export function getAllEnrichRecords() {
    try {
        return getAllEnrichRecordsInner();
    }
    catch (error) {
        BGM.handleError(error, { context: 'getAllEnrichRecords', showAlert: false });
        return [];
    }
}
/**
 * 获取富化记录表（如果存在）
 * @returns 工作表或 null
 */
export function getEnrichRecordSheetIfExists() {
    try {
        const app = getApp();
        if (!app)
            return null;
        const wb = app.ActiveWorkbook;
        if (!wb)
            return null;
        const sheets = wb.Worksheets;
        const count = sheets.Count;
        for (let index = 1; index <= count; index += 1) {
            const sheet = sheets.Item(index);
            if (sheet.Name === ENRICH_RECORD_SHEET_NAME) {
                return sheet;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * 打开富化记录表（激活工作表）
 */
export function openEnrichRecordSheet() {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        sheet.Activate();
    }
    catch (error) {
        BGM.handleError(error, { context: 'openEnrichRecordSheet', showAlert: true });
    }
}
/**
 * 格式化富化记录表样式
 */
export function formatEnrichRecordSheet() {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        const lastColumn = ENRICH_RECORD_COLUMNS.length;
        const lastRow = getLastRow(sheet);
        writeSheetHeaderRow(sheet, ENRICH_RECORD_COLUMNS);
        const headerRange = sheet.Range('1:1');
        if (headerRange.Font) {
            headerRange.Font.Bold = true;
        }
        if (headerRange.Interior) {
            headerRange.Interior.Color = BGM_COLOR.GRAY;
        }
        headerRange.HorizontalAlignment = -4108;
        if (lastRow >= 2) {
            const dataRange = sheet.Range(`A${String(2)}:${columnNumberToLetter(lastColumn)}${String(lastRow)}`);
            dataRange.Borders.LineStyle = 1;
        }
        for (let c = 1; c <= lastColumn; c += 1) {
            const columnLetter = columnNumberToLetter(c);
            const columnRange = sheet.Range(`${columnLetter}:${columnLetter}`);
            columnRange.ColumnWidth = 15;
        }
        const nameColumn = sheet.Range('C:C');
        nameColumn.ColumnWidth = 25;
        const oldValueColumn = sheet.Range('F:F');
        oldValueColumn.ColumnWidth = 20;
        const valueColumn = sheet.Range('G:G');
        valueColumn.ColumnWidth = 40;
        const noteColumn = sheet.Range('I:I');
        noteColumn.ColumnWidth = 20;
    }
    catch (error) {
        BGM.handleError(error, { context: 'formatEnrichRecordSheet', showAlert: false });
    }
}
/**
 * getAllEnrichRecordsInner（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function getAllEnrichRecordsInner() {
    const app = getApp();
    if (!app?.ActiveWorkbook)
        return [];
    const wb = app.ActiveWorkbook;
    let sheet = null;
    try {
        const sheets = wb.Sheets;
        // 工作表总数只读一次：写在循环条件里每轮都会多一次跨进程 COM 往返
        const sheetCount = sheets.Count;
        for (let index = 1; index <= sheetCount; index += 1) {
            const s = sheets.Item(index);
            if (s.Name === ENRICH_RECORD_SHEET_NAME) {
                sheet = s;
                break;
            }
        }
    }
    catch (error) {
        BGM.handleError(error, { context: 'getAllEnrichRecords', showAlert: false });
        return [];
    }
    if (!sheet)
        return [];
    const lastRow = getLastRow(sheet);
    if (lastRow < 2)
        return [];
    const allData = readRangeValues(sheet, 2, lastRow, 1, ENRICH_RECORD_COLUMNS.length);
    if (allData.length === 0)
        return [];
    const records = [];
    for (const rowData of allData) {
        const record = {
            timestamp: rowData[ENRICH_RECORD_COLUMN.TIMESTAMP - 1] ?? '',
            matchType: (rowData[ENRICH_RECORD_COLUMN.MATCH_TYPE - 1] ??
                '未匹配'),
            name: rowData[ENRICH_RECORD_COLUMN.NAME - 1] ?? '',
            row: Math.trunc(Number(rowData[ENRICH_RECORD_COLUMN.ROW - 1] ?? '0')) || 0,
            enrichedField: rowData[ENRICH_RECORD_COLUMN.ENRICHED_FIELD - 1] ?? '',
            oldValue: rowData[ENRICH_RECORD_COLUMN.OLD_VALUE - 1] ?? '',
            updatedValue: rowData[ENRICH_RECORD_COLUMN.NEW_VALUE - 1] ?? '',
            action: (rowData[ENRICH_RECORD_COLUMN.ACTION - 1] ?? 'skip'),
            note: rowData[ENRICH_RECORD_COLUMN.NOTE - 1] ?? '',
        };
        records.push(record);
    }
    return records;
}
