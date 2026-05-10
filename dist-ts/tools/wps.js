/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */
import { getApp, } from '../index.js';
// ========== 类型守卫函数 ==========
/**
 * 检查对象是否为有效的 WPS Application
 */
export function isWpsApp(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'ActiveWorkbook' in value);
}
/**
 * 检查对象是否为有效的 WPS 工作表
 */
export function isWpsWorksheet(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'Name' in value &&
        'Range' in value);
}
/**
 * 检查对象是否为有效的 WPS Range
 */
export function isWpsRange(value) {
    return (typeof value === 'object' &&
        value !== null &&
        ('Row' in value ||
            'Value' in value ||
            'Value2' in value));
}
/**
 * 显示输入提示框
 */
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
                console.warn("WPS InputBox 不可用:", e.message);
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
            try {
                const result = window.prompt(message, defaultValue);
                resolve(result);
            }
            catch (e) {
                console.error("prompt 也不可用:", e.message);
                resolve(null);
            }
        }
    });
}
/**
 * 显示 WPS 消息对话框
 */
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
                console.warn("WPS MessageBox 不可用:", e.message);
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
            else if (typeof window !== 'undefined') {
                resolve(window.confirm(message) ? 6 : 7);
            }
        }
        else {
            if (typeof window !== 'undefined' && typeof window.BGMAlert === 'function') {
                window.BGMAlert(message, "提示", () => {
                    resolve(1);
                });
            }
            else if (typeof window !== 'undefined') {
                window.alert(message);
                resolve(1);
            }
        }
    });
}
