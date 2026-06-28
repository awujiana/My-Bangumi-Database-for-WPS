/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */
import { getApp, bgmLog, LOG_LEVELS } from '../index.js';
import { showAlert as customShowAlert, showConfirm as customShowConfirm, showInput as customShowInput } from '../ui/dialog.js';
// ========== 类型守卫函数 ==========
export function isWpsApp(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'ActiveWorkbook' in value);
}
export function isWpsWorksheet(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'Name' in value &&
        'Range' in value);
}
export function isWpsRange(value) {
    return (typeof value === 'object' &&
        value !== null &&
        ('Row' in value ||
            'Value' in value ||
            'Value2' in value));
}
// ========== 工具函数 ==========
export function wpsPrompt(message, defaultValue) {
    return new Promise((resolve) => {
        const app = getApp();
        if (app?.InputBox) {
            try {
                const result = app.InputBox(message, "Bangumi 设置", defaultValue || "", 2);
                if (result === false || result === null || result === undefined) {
                    resolve(null);
                    return;
                }
                resolve(String(result));
                return;
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `WPS InputBox 不可用: ${e.message}`);
            }
        }
        if (typeof window !== 'undefined' && typeof window.BGMInput === 'function') {
            window.BGMInput("输入", message, defaultValue || '', (value) => {
                resolve(value);
            }, () => {
                resolve(null);
            });
        }
        else {
            // 使用自定义输入对话框
            customShowInput("输入", message, defaultValue, (value) => {
                resolve(value || null);
            }, () => {
                resolve(null);
            });
        }
    });
}
export function wpsMsgBox(message, buttons, icon) {
    return new Promise((resolve) => {
        const app = getApp();
        if (app?.MessageBox) {
            try {
                const result = app.MessageBox(message, (buttons || 0) + (icon || 64));
                resolve(result);
                return;
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `WPS MessageBox 不可用: ${e.message}`);
            }
        }
        if (buttons === 4) {
            if (typeof window !== 'undefined' && typeof window.BGMConfirm === 'function') {
                window.BGMConfirm(message, "确认", () => {
                    resolve(6);
                }, () => {
                    resolve(7);
                });
            }
            else {
                // 使用自定义确认对话框
                customShowConfirm(message, (confirmed) => {
                    resolve(confirmed ? 6 : 7);
                }, "确认");
            }
        }
        else {
            if (typeof window !== 'undefined' && typeof window.BGMAlert === 'function') {
                window.BGMAlert(message, "提示", () => {
                    resolve(1);
                });
            }
            else {
                // 使用自定义警告对话框
                customShowAlert(message, "提示", () => {
                    resolve(1);
                });
            }
        }
    });
}
/**
 * 安全获取指定行的 Range 对象（推荐使用）
 * @param ws  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export function getRowRange(ws, row) {
    if (!ws || typeof ws.Range !== 'function') {
        throw new Error('Invalid worksheet object');
    }
    if (!Number.isFinite(row) || row < 1) {
        throw new Error(`Row index must be a positive integer, got ${row}`);
    }
    return ws.Range(`${row}:${row}`);
}
/**
 * 带后备的安全行 Range 获取（当 Range 构造异常时尝试使用 Rows.Item）
 * @param ws  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export function getRowRangeSafe(ws, row) {
    try {
        return getRowRange(ws, row);
    }
    catch {
        try {
            const item = ws.Rows.Item(row);
            return item;
        }
        catch {
            throw new Error(`Failed to access row ${row}`);
        }
    }
}
