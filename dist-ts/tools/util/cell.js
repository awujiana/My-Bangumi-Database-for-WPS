/**
 * 工具模块 - 单元格操作
 * @module tools/util/cell
 * @description 单元格读取、设置、属性探测等底层操作。
 *              本模块对 index.js 存在循环依赖（setCellValue 调用 BGM.handleError），
 *              但仅在函数体内引用，运行时安全。
 */
import { LOG_LEVELS } from '../../core/constants.js';
import { columnNumberToLetter } from '../string-utilities.js';
// 循环依赖：仅在函数体内使用 BGM.handleError / bgmLog / getApp，运行时安全
import { BGM, bgmLog, getApp } from './index.js';
// ========== 单元格操作 ==========
export function getCell(worksheet, row, column) {
    if (!worksheet)
        return null;
    const address = columnNumberToLetter(column) + String(row);
    return worksheet.Range(address);
}
// 内部辅助函数，不导出
/**
 * 安全地获取对象属性值，处理属性值为函数的情况
 * @param cell - 要获取属性的对象
 * @param property - 属性名称
 * @returns 属性的值；如果属性不存在或访问失败，则返回 undefined
 */
function tryGetProperty(cell, property) {
    if (cell == null || typeof cell !== 'object')
        return undefined;
    const object = cell;
    if (!Object.hasOwn(object, property))
        return undefined;
    try {
        const value = object[property];
        if (typeof value === 'function') {
            try {
                const result = value();
                if (typeof result === 'function' && result.toString().includes('[native code]')) {
                    return undefined;
                }
                return result;
            }
            catch {
                return undefined;
            }
        }
        if (value && typeof value === 'object') {
            const valueObject = value;
            if (typeof valueObject.toString === 'function') {
                const string_ = valueObject.toString();
                if (string_.includes('function') || string_.includes('[native code]')) {
                    return undefined;
                }
            }
        }
        return value;
    }
    catch {
        return undefined;
    }
}
// 内部辅助函数，不导出
/**
 * 获取单元格的原始值，按优先级尝试 Value2、Value 和 Text 属性
 * @param cell - 单元格对象
 * @returns 单元格的原始值；如果单元格无效或没有值，则返回 null
 */
function getCellRawValue(cell) {
    if (!cell)
        return null;
    const value2 = tryGetProperty(cell, 'Value2');
    if (value2 !== undefined && value2 !== null)
        return value2;
    const value = tryGetProperty(cell, 'Value');
    if (value !== undefined && value !== null)
        return value;
    const text = tryGetProperty(cell, 'Text');
    if (text !== undefined && text !== null)
        return text;
    return null;
}
/**
 * 获取单元格的值
 * @param worksheet - 工作表对象，可能为 null 或 undefined
 * @param row - 行号
 * @param column - 列号
 * @returns 单元格的字符串值；如果工作表无效或单元格不存在，则返回空字符串
 */
export function getCellValue(worksheet, row, column) {
    if (!worksheet)
        return '';
    try {
        const address = columnNumberToLetter(column) + String(row);
        const cell = worksheet.Range(address);
        const raw = getCellRawValue(cell);
        if (raw == null)
            return '';
        // 单元格原始值通常为 string/number/boolean；罕见对象值沿用 String() 的默认转换语义
        const rawText = raw;
        return String(rawText);
    }
    catch {
        return '';
    }
}
/**
 * 设置单元格值
 */
export function setCellValue(worksheet, row, column, value) {
    try {
        const cell = getCell(worksheet, row, column);
        if (!cell) {
            bgmLog(LOG_LEVELS.ERROR, `setCellValue - 无法获取单元格: (${String(row)}, ${String(column)})`);
            return false;
        }
        cell.Value2 = value;
        return true;
    }
    catch (error) {
        BGM.handleError(error, { level: BGM.ErrorLevel.ERROR, context: 'setCellValue' });
    }
    return false;
}
/**
 * 获取工作表对象
 */
export function getSheetByIndex(sheetIndex) {
    const appObject = getApp();
    if (!appObject?.ActiveWorkbook?.Sheets)
        return null;
    const sheets = appObject.ActiveWorkbook.Sheets;
    if (sheets.Count === 0)
        return null;
    try {
        return sheets.Item(sheetIndex);
    }
    catch {
        return undefined;
    }
}
