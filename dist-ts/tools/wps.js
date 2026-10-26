/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */
import { LOG_LEVELS } from '../core/constants.js';
// 对话框走依赖反转桥：本模块属于底层（tools/），不得 runtime-import 上层 UI 层
// （见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）。实现由 ui/dialog.ts 注册。
import { getNotifyApi } from '../core/ui-bridge.js';
import { getApp, bgmLog } from './util/index.js';
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
                const result = app.InputBox(message, 'Bangumi 设置', defaultValue ?? '', 2);
                if (result === false) {
                    resolve(null);
                    return;
                }
                resolve(result);
                return;
            }
            catch (error) {
                // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
                const errorMessage = error instanceof Error ? error.message : String(error);
                bgmLog(LOG_LEVELS.WARN, `WPS InputBox 不可用: ${errorMessage}`);
            }
        }
        const bgmInput = typeof window === 'undefined'
            ? undefined
            : window.BGMInput;
        if (typeof bgmInput === 'function') {
            bgmInput('输入', message, defaultValue ?? '', (value) => {
                resolve(value);
            }, () => {
                resolve(null);
            });
        }
        else {
            // 使用自定义输入对话框
            getNotifyApi().input('输入', message, defaultValue, (value) => {
                resolve(value ?? null);
            }, () => {
                resolve(null);
            });
        }
    });
}
export function wpsMessageBox(message, buttons, icon) {
    return new Promise((resolve) => {
        const app = getApp();
        if (app?.MessageBox) {
            try {
                const result = app.MessageBox(message, (buttons ?? 0) + (icon ?? 64));
                resolve(result);
                return;
            }
            catch (error) {
                // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
                const errorMessage = error instanceof Error ? error.message : String(error);
                bgmLog(LOG_LEVELS.WARN, `WPS MessageBox 不可用: ${errorMessage}`);
            }
        }
        const bgmAlert = typeof window === 'undefined'
            ? undefined
            : window.BGMAlert;
        if (buttons === 4) {
            const bgmConfirm = typeof window === 'undefined'
                ? undefined
                : window.BGMConfirm;
            if (typeof bgmConfirm === 'function') {
                bgmConfirm(message, '确认', () => {
                    resolve(6);
                }, () => {
                    resolve(7);
                });
            }
            else {
                // 使用自定义确认对话框
                getNotifyApi().confirm(message, (confirmed) => {
                    resolve(confirmed ? 6 : 7);
                }, '确认');
            }
        }
        else if (typeof bgmAlert === 'function') {
            bgmAlert(message, '提示', () => {
                resolve(1);
            });
        }
        else {
            // 使用自定义警告对话框
            getNotifyApi().alert(message, '提示', () => {
                resolve(1);
            });
        }
    });
}
/**
 * 安全获取指定行的 Range 对象（推荐使用）
 * @param worksheet  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export function getRowRange(worksheet, row) {
    if (typeof worksheet.Range !== 'function') {
        throw new TypeError('Invalid worksheet object');
    }
    if (!Number.isFinite(row) || row < 1) {
        throw new Error(`Row index must be a positive integer, got ${String(row)}`);
    }
    return worksheet.Range(`${String(row)}:${String(row)}`);
}
/**
 * 带后备的安全行 Range 获取（当 Range 构造异常时尝试使用 Rows.Item）
 * @param worksheet  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export function getRowRangeSafe(worksheet, row) {
    try {
        return getRowRange(worksheet, row);
    }
    catch {
        try {
            const item = worksheet.Rows.Item(row);
            return item;
        }
        catch {
            throw new Error(`Failed to access row ${String(row)}`);
        }
    }
}
