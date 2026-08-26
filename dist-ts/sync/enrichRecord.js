/**
 * @fileoverview 富化记录管理模块
 * @module sync/enrichRecord
 * @description 管理「富化记录」工作表，记录所有新番表富化操作的详细信息。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { LOG_LEVELS, BGM_COLOR } from '../core/constants.js';
import { bgmLog, getApp, getLastRow, colNumToLetter, setCellValue, readRangeValues, BGM, } from '../tools/util/index.js';
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
export const ENRICH_RECORD_COL = {
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
        case 'fill':
            return BGM_COLOR.SUCCESS;
        case 'append':
            return 0xffff80;
        case 'skip':
            return BGM_COLOR.SKIP;
        case 'error':
            return BGM_COLOR.FAIL;
        default:
            return BGM_COLOR.GRAY;
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
        for (let i = 1; i <= sheets.Count; i++) {
            const sheet = sheets.Item(i);
            if (sheet.Name === ENRICH_RECORD_SHEET_NAME) {
                enrichSheet = sheet;
                break;
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getOrCreateEnrichRecordSheet', showAlert: false });
    }
    if (!enrichSheet) {
        enrichSheet = wb.Sheets.Add();
        enrichSheet.Name = ENRICH_RECORD_SHEET_NAME;
        for (let i = 0; i < ENRICH_RECORD_COLUMNS.length; i++) {
            const colLetter = colNumToLetter(i + 1);
            const cell = enrichSheet.Range(`${colLetter}1`);
            cell.Value2 = ENRICH_RECORD_COLUMNS[i] ?? '';
            if (cell.Interior) {
                cell.Interior.Color = BGM_COLOR.GRAY;
            }
        }
        try {
            enrichSheet.Move(null, wb.Sheets.Item(wb.Sheets.Count));
        }
        catch (moveError) {
            BGM.handleError(moveError, { context: 'getOrCreateEnrichRecordSheet', showAlert: false });
        }
        const lastColLetter = colNumToLetter(ENRICH_RECORD_COLUMNS.length);
        const fullRange = enrichSheet.Range(`A1:${lastColLetter}1`);
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
    else {
        const existingCols = ENRICH_RECORD_COLUMNS.length;
        for (let i = 0; i < existingCols; i++) {
            const colLetter = colNumToLetter(i + 1);
            const cell = enrichSheet.Range(`${colLetter}1`);
            const currentHeader = String(cell.Value2 ?? '').trim();
            const expectedHeader = ENRICH_RECORD_COLUMNS[i] ?? '';
            if (currentHeader !== expectedHeader) {
                cell.Value2 = expectedHeader;
                bgmLog(LOG_LEVELS.INFO, `修复表头: ${colLetter}1 从 "${currentHeader}" → "${expectedHeader}"`);
            }
        }
    }
    return enrichSheet;
}
export function addEnrichRecord(params) {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        let newRow = 1;
        const usedRange = sheet.UsedRange;
        if (usedRange) {
            const lastUsedRow = usedRange.Row + usedRange.Rows.Count - 1;
            newRow = lastUsedRow + 1;
        }
        else {
            newRow = sheet.Rows.Count > 1 ? 2 : 1;
        }
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.TIMESTAMP, params.timestamp);
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.MATCH_TYPE, params.matchType);
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.NAME, params.name);
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.ROW, params.row);
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.ENRICHED_FIELD, params.enrichedField);
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.OLD_VALUE, params.oldValue);
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.NEW_VALUE, params.newValue);
        setCellValue(sheet, newRow, ENRICH_RECORD_COL.ACTION, params.action);
        if (params.note !== undefined) {
            setCellValue(sheet, newRow, ENRICH_RECORD_COL.NOTE, params.note);
        }
        const actionColor = getActionColor(params.action);
        const actionColLetter = colNumToLetter(ENRICH_RECORD_COL.ACTION);
        const actionCell = sheet.Range(`${actionColLetter}${newRow}`);
        if (actionCell?.Interior) {
            actionCell.Interior.Color = actionColor;
        }
        bgmLog(LOG_LEVELS.INFO, `[addEnrichRecord] ${params.name} (${params.enrichedField}): ${params.action}`);
    }
    catch (e) {
        BGM.handleError(e, { context: 'addEnrichRecord', showAlert: false });
    }
}
export function addEnrichRecords(records) {
    if (records.length === 0)
        return;
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        let startRow = 2;
        const usedRange = sheet.UsedRange;
        if (usedRange) {
            startRow = usedRange.Row + usedRange.Rows.Count;
        }
        const newRows = records.map((r) => [
            r.timestamp,
            r.matchType,
            r.name,
            String(r.row),
            r.enrichedField,
            r.oldValue,
            r.newValue,
            r.action,
            r.note ?? '',
        ]);
        const endRow = startRow + newRows.length - 1;
        const startColLetter = colNumToLetter(1);
        const endColLetter = colNumToLetter(ENRICH_RECORD_COLUMNS.length);
        const range = sheet.Range(`${startColLetter}${startRow}:${endColLetter}${endRow}`);
        range.Value2 = newRows;
        for (let i = 0; i < newRows.length; i++) {
            const row = startRow + i;
            const action = newRows[i]?.[ENRICH_RECORD_COL.ACTION - 1] ?? '';
            const color = getActionColor(action);
            const actionColLetter = colNumToLetter(ENRICH_RECORD_COL.ACTION);
            const cell = sheet.Range(`${actionColLetter}${row}`);
            if (cell?.Interior) {
                cell.Interior.Color = color;
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[addEnrichRecords] 批量写入完成：${records.length} 条记录`);
    }
    catch (e) {
        BGM.handleError(e, { context: 'addEnrichRecords', showAlert: false });
    }
}
export function clearEnrichRecords() {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        const lastRow = sheet.UsedRange
            ? sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
            : sheet.Rows.Count;
        if (lastRow > 1) {
            sheet.Range(`2:${lastRow}`).Delete();
        }
        bgmLog(LOG_LEVELS.INFO, '已清除所有富化记录');
    }
    catch (e) {
        BGM.handleError(e, { context: 'clearEnrichRecords', showAlert: false });
    }
}
export function getAllEnrichRecords() {
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return [];
        const wb = app.ActiveWorkbook;
        let sheet = null;
        try {
            const sheets = wb.Sheets;
            for (let i = 1; i <= sheets.Count; i++) {
                const s = sheets.Item(i);
                if (s.Name === ENRICH_RECORD_SHEET_NAME) {
                    sheet = s;
                    break;
                }
            }
        }
        catch (e) {
            BGM.handleError(e, { context: 'getAllEnrichRecords', showAlert: false });
            return [];
        }
        if (!sheet)
            return [];
        const lastRow = getLastRow(sheet);
        if (lastRow < 2)
            return [];
        const allData = readRangeValues(sheet, 2, lastRow, 1, ENRICH_RECORD_COLUMNS.length);
        if (!allData || allData.length === 0)
            return [];
        const records = [];
        for (const rowData of allData) {
            if (!rowData)
                continue;
            const record = {
                timestamp: String(rowData[ENRICH_RECORD_COL.TIMESTAMP - 1] ?? ''),
                matchType: String(rowData[ENRICH_RECORD_COL.MATCH_TYPE - 1] ?? '未匹配'),
                name: String(rowData[ENRICH_RECORD_COL.NAME - 1] ?? ''),
                row: parseInt(String(rowData[ENRICH_RECORD_COL.ROW - 1] ?? '0')) || 0,
                enrichedField: String(rowData[ENRICH_RECORD_COL.ENRICHED_FIELD - 1] ?? ''),
                oldValue: String(rowData[ENRICH_RECORD_COL.OLD_VALUE - 1] ?? ''),
                newValue: String(rowData[ENRICH_RECORD_COL.NEW_VALUE - 1] ?? ''),
                action: String(rowData[ENRICH_RECORD_COL.ACTION - 1] ?? 'skip'),
                note: String(rowData[ENRICH_RECORD_COL.NOTE - 1] ?? ''),
            };
            records.push(record);
        }
        return records;
    }
    catch (e) {
        BGM.handleError(e, { context: 'getAllEnrichRecords', showAlert: false });
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
        const count = sheets?.Count ?? 0;
        for (let i = 1; i <= count; i++) {
            const sheet = sheets?.Item(i);
            if (sheet && sheet.Name === ENRICH_RECORD_SHEET_NAME) {
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
        sheet?.Activate();
    }
    catch (e) {
        BGM.handleError(e, { context: 'openEnrichRecordSheet', showAlert: true });
    }
}
/**
 * 格式化富化记录表样式
 */
export function formatEnrichRecordSheet() {
    try {
        const sheet = getOrCreateEnrichRecordSheet();
        if (!sheet)
            return;
        const lastCol = ENRICH_RECORD_COLUMNS.length;
        const lastRow = getLastRow(sheet);
        for (let c = 1; c <= lastCol; c++) {
            setCellValue(sheet, 1, c, ENRICH_RECORD_COLUMNS[c - 1]);
        }
        const headerRange = sheet.Range('1:1');
        if (headerRange) {
            if (headerRange.Font) {
                headerRange.Font.Bold = true;
            }
            if (headerRange.Interior) {
                headerRange.Interior.Color = BGM_COLOR.GRAY;
            }
            headerRange.HorizontalAlignment = -4108;
        }
        if (lastRow >= 2) {
            const dataRange = sheet.Range(`A${2}:${colNumToLetter(lastCol)}${lastRow}`);
            if (dataRange) {
                dataRange.Borders.LineStyle = 1;
            }
        }
        for (let c = 1; c <= lastCol; c++) {
            const colLetter = colNumToLetter(c);
            const colRange = sheet.Range(`${colLetter}:${colLetter}`);
            if (colRange) {
                colRange.ColumnWidth = 15;
            }
        }
        const nameCol = sheet.Range('C:C');
        if (nameCol)
            nameCol.ColumnWidth = 25;
        const oldValCol = sheet.Range('F:F');
        if (oldValCol)
            oldValCol.ColumnWidth = 20;
        const newValCol = sheet.Range('G:G');
        if (newValCol)
            newValCol.ColumnWidth = 40;
        const noteCol = sheet.Range('I:I');
        if (noteCol)
            noteCol.ColumnWidth = 20;
    }
    catch (e) {
        BGM.handleError(e, { context: 'formatEnrichRecordSheet', showAlert: false });
    }
}
