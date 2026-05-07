import { WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS } from '../core/constants.js';
import { encryptToken, decryptToken } from '../core/cypto.js';
import { BgmError, ErrorLevel, isWpsApp } from './index.js';
// 重新导出（向后兼容）
export { BgmError, ErrorLevel };
// ========== 导出常量（向后兼容）==========
export const WPS_Enum = WPS_ENUM;
export { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS };
// ========== BGM 全局命名空间 ==========
export const BGM = {
    // 缓存数据
    cache: {
        totalRows: 0,
        userId: null,
        username: null,
        sidCache: new Map(),
        listCache: []
    },
    // 工作表状态
    sheet: {
        lockedIndex: null,
        lockedName: null,
        isLocked: false
    },
    // 同步状态
    sync: {
        isRunning: false,
        lastSyncTime: new Date().toISOString(),
    },
    // 日志级别（0=DEBUG, 1=INFO, 2=WARN, 3=ERROR）
    LOG_LEVEL: LOG_LEVELS.INFO,
    // 日志级别常量
    LOG_LEVELS: LOG_LEVELS,
    // 错误级别常量
    ERROR_LEVELS: ERROR_LEVELS,
    // 错误级别枚举
    ErrorLevel: ErrorLevel,
    // BGM 错误类
    BgmError: BgmError,
    // 统一对话框
    Dialog: {
        alert: function (title, message) {
            if (typeof window !== 'undefined' && window.BGMDialog !== undefined) {
                window.BGMDialog.alert(title, message);
            }
            else if (typeof window !== 'undefined' && typeof window.BGMAlert === 'function') {
                window.BGMAlert(message, title);
            }
            else if (typeof window !== 'undefined') {
                window.alert(message);
            }
        },
        confirm: function (message, onConfirm, onCancel) {
            if (typeof window !== 'undefined' && window.BGMDialog !== undefined) {
                window.BGMDialog.confirm(message, onConfirm, onCancel);
            }
            else if (typeof window !== 'undefined' && typeof window.BGMConfirm === 'function') {
                window.BGMConfirm(message, '确认', onConfirm, onCancel);
            }
            else if (typeof window !== 'undefined') {
                if (window.confirm(message)) {
                    if (onConfirm)
                        onConfirm();
                }
                else {
                    if (onCancel)
                        onCancel();
                }
            }
        },
        error: function (title, message) {
            if (typeof window !== 'undefined' && window.BGMDialog !== undefined) {
                window.BGMDialog.error(title, message);
            }
            else if (typeof window !== 'undefined' && typeof window.BGMError === 'function') {
                window.BGMError(message, title);
            }
            else if (typeof window !== 'undefined') {
                window.alert('[错误] ' + message);
            }
        },
        input: function (title, prompt, defaultValue, onOk, onCancel) {
            if (typeof window !== 'undefined' && window.BGMDialog !== undefined) {
                window.BGMDialog.input(title, prompt, defaultValue || '', onOk, onCancel);
            }
            else if (typeof window !== 'undefined' && typeof window.BGMInput === 'function') {
                window.BGMInput(title, prompt, defaultValue || '', onOk, onCancel);
            }
            else if (typeof window !== 'undefined') {
                const result = window.prompt(prompt, defaultValue);
                if (result !== null) {
                    if (onOk)
                        onOk(result);
                }
                else {
                    if (onCancel)
                        onCancel();
                }
            }
        },
        show: function (type, title, message, options) {
            if (typeof window !== 'undefined' && window.BGMDialog !== undefined) {
                window.BGMDialog.show(type, title, message, options);
            }
            else {
                switch (type) {
                    case 'error':
                        this.error(title, message);
                        break;
                    case 'confirm':
                        // 传递 message 而非 onConfirm
                        this.confirm(message, options?.onConfirm, options?.onCancel);
                        break;
                    case 'input':
                        this.input(title, message, options?.defaultValue, options?.onOk, options?.onCancel);
                        break;
                    default:
                        this.alert(title, message);
                }
            }
        }
    },
    // 统一消息通信
    Message: {
        send: function (data, targetOrigin) {
            try {
                if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                    window.parent.postMessage(data, targetOrigin || "*");
                    return true;
                }
            }
            catch (e) {
                const err = e;
                if (typeof bgmLog === 'function') {
                    bgmLog(LOG_LEVELS?.DEBUG || 0, "postMessage 不可用: " + err.message);
                }
            }
            return false;
        },
        postMessage: function (data, targetOrigin) {
            return this.send(data, targetOrigin);
        }
    },
    // 向后兼容方法
    postMessage: function (data, targetOrigin) {
        return BGM.Message.send(data, targetOrigin);
    },
    showDialog: function (title, message) {
        if (BGM.Message.send({ type: "showDialog", title: title, message: message })) {
            return;
        }
        BGM.Dialog.alert(title, message);
    },
    showConfirm: function (title, message, onConfirm, onCancel) {
        if (BGM.Message.send({ type: "showConfirm", title: title, message: message, onConfirm: true })) {
            window._bgmConfirmCallback = { confirm: onConfirm, cancel: onCancel };
            return;
        }
        BGM.Dialog.confirm(message, onConfirm, onCancel);
    },
    // 统一错误处理
    handleError: function (error, options) {
        const opts = {
            level: ErrorLevel.ERROR,
            showDialog: false,
            context: '',
            ...options
        };
        let bgmError;
        if (error instanceof BgmError) {
            bgmError = error;
        }
        else if (error instanceof Error) {
            bgmError = new BgmError(error.message, 'JS_ERROR', {
                name: error.name,
                stack: error.stack
            });
        }
        else {
            bgmError = new BgmError(String(error), 'UNKNOWN');
        }
        if (opts.context) {
            bgmError.details.context = opts.context;
        }
        switch (opts.level) {
            case ErrorLevel.SILENT:
                break;
            case ErrorLevel.WARN:
                bgmLog(LOG_LEVELS.WARN, bgmError.toString());
                break;
            case ErrorLevel.ERROR:
                bgmLog(LOG_LEVELS.ERROR, bgmError.toString());
                if (opts.showDialog) {
                    BGM.showDialog('错误', bgmError.message);
                }
                break;
            case ErrorLevel.THROW:
                bgmLog(LOG_LEVELS.ERROR, bgmError.toString());
                throw bgmError;
        }
        return bgmError;
    },
    // 安全执行函数
    safeExecute: function (fn, context, options) {
        try {
            return fn();
        }
        catch (error) {
            return BGM.handleError(error, { context, ...options });
        }
    }
};
// ========== 日志函数 ==========
/**
 * 日志函数（支持日志级别控制）
 * @param level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param message - 日志消息
 */
export function bgmLog(level, message) {
    if (level >= BGM.LOG_LEVEL) {
        const prefix = ['[DEBUG]', '[INFO]', '[WARN]', '[ERROR]'][level] || '[INFO]';
        console.log(prefix + ' ' + message);
    }
}
// ========== Application 获取 ==========
/**
 * 获取 Application 对象（使用类型守卫）
 */
export function getApp() {
    if (typeof window !== 'undefined') {
        const winApp = window.Application;
        if (isWpsApp(winApp))
            return winApp;
    }
    // 使用 window.Application 替代裸 Application
    if (typeof window !== 'undefined') {
        const globalApp = window.Application;
        if (isWpsApp(globalApp))
            return globalApp;
    }
    return null;
}
// ========== 单元格操作 ==========
/**
 * 列号转字母 (A, B, ..., Z, AA, AB, ...)
 */
export function colNumToLetter(col) {
    let letter = "";
    while (col > 0) {
        const mod = (col - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        col = Math.floor((col - mod) / 26);
    }
    return letter;
}
/**
 * 安全获取单元格对象
 */
export function getCell(ws, row, col) {
    try {
        const wsObj = ws;
        if (wsObj && typeof wsObj.Range === 'function') {
            const colLetter = colNumToLetter(col);
            return wsObj.Range(colLetter + row);
        }
        const cellsObj = wsObj?.Cells;
        if (typeof cellsObj === 'object' && cellsObj !== null) {
            if (typeof cellsObj.Item === 'function') {
                return cellsObj.Item(row, col);
            }
            return cellsObj(row, col);
        }
        return null;
    }
    catch (e) {
        console.error("getCell error:", e);
        return null;
    }
}
/**
 * 安全获取单元格值
 */
export function getCellValue(ws, row, col) {
    try {
        const cell = getCell(ws, row, col);
        if (cell?.Value != null) {
            const val = typeof cell.Value === 'function' ? cell.Value() : cell.Value;
            return val !== null && val !== undefined ? String(val) : '';
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, "getCellValue 失败: " + e.message);
    }
    return "";
}
/**
 * 读取单元格文本（handle WPS Value/Value2/Text 等多种属性）
 */
export function readCell(ws, row, col) {
    try {
        const cell = getCell(ws, row, col);
        if (!cell)
            return "";
        if (typeof cell.Text === 'function')
            return String(cell.Text());
        if (cell.Text != null)
            return String(cell.Text);
        if (typeof cell.Value2 === 'function')
            return String(cell.Value2());
        if (cell.Value2 != null)
            return String(cell.Value2);
        if (typeof cell.Value === 'function')
            return String(cell.Value());
        if (cell.Value != null)
            return String(cell.Value);
        return "";
    }
    catch {
        return "";
    }
}
/**
 * 设置单元格值
 */
export function setCellValue(ws, row, col, value) {
    try {
        const cell = getCell(ws, row, col);
        if (!cell) {
            console.error("setCellValue - 无法获取单元格:", row, col);
            return false;
        }
        cell.Value = value;
        return true;
    }
    catch (e) {
        console.error("setCellValue error:", e);
    }
    return false;
}
/**
 * 获取工作表对象
 */
export function getSheetByIndex(sheetIndex) {
    const app = getApp();
    if (!app?.ActiveWorkbook?.Sheets)
        return null;
    const sheets = app.ActiveWorkbook.Sheets;
    if (sheets.Count === 0)
        return null;
    return sheets.Item(sheetIndex);
}
// ========== HTML 安全 ==========
/**
 * HTML 转义（防止 XSS）
 */
export function escapeHtml(text) {
    if (!text)
        return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
// ========== Token 存储 ==========
/**
 * 存储 Token（加密）
 */
export function storeBgToken(token) {
    const app = getApp();
    if (!app?.PluginStorage)
        return false;
    app.PluginStorage.setItem("bgm_token", encryptToken(token));
    return true;
}
/**
 * 清除 Token
 */
export function clearBgToken() {
    const app = getApp();
    if (!app?.PluginStorage)
        return false;
    app.PluginStorage.setItem("bgm_token", "");
    return true;
}
/**
 * 加载 Token（解密）
 */
export function loadBgToken() {
    const app = getApp();
    if (!app?.PluginStorage)
        return null;
    const stored = app.PluginStorage.getItem("bgm_token");
    if (!stored)
        return null;
    const token = decryptToken(stored);
    if (token)
        return token;
    clearBgToken();
    return null;
}
// ========== 用户信息 ==========
/**
 * 设置 BGM 用户 ID
 */
export function _setBgmUserId(id) {
    BGM.cache.userId = id;
}
/**
 * 获取 BGM 用户 ID
 */
export function _getBgmUserId() {
    return BGM.cache.userId;
}
/**
 * 获取用户 API 路径
 */
export function _getUserApiPath() {
    return BGM.cache.userId ? String(BGM.cache.userId) : "-";
}
/**
 * 获取 Bangumi 当前登录用户信息
 */
export function _fetchBgmUserInfo(callback) {
    const token = loadBgToken();
    if (!token) {
        if (callback)
            callback(null);
        return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/me", true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                const userId = String(data.id || data.user_id || '');
                const username = String(data.username || data.user_name || data.name || '');
                BGM.cache.userId = userId;
                BGM.cache.username = username;
                bgmLog(LOG_LEVELS.DEBUG, "_fetchBgmUserInfo: userId=" + userId);
                if (callback)
                    callback({ id: userId, username: username });
            }
            catch {
                if (callback)
                    callback(null);
            }
        }
        else {
            if (callback)
                callback(null);
        }
    };
    xhr.onerror = function () {
        if (callback)
            callback(null);
    };
    xhr.send();
}
/**
 * 获取 Bangumi 用户信息（Promise 版本，供 handlers.js 等模块使用）
 */
export function fetchBgmUserInfo() {
    return new Promise((resolve) => {
        _fetchBgmUserInfo((userInfo) => {
            resolve(userInfo);
        });
    });
}
// ========== 辅助函数 ==========
/**
 * 通过 WPS 提供的接口执行脚本
 */
export function shellExecuteByOAAssist(param) {
    const app = getApp();
    if (app?.OAAssist) {
        app.OAAssist.ShellExecute(param);
    }
}
/**
 * 获取 URL 路径
 */
export function GetUrlPath() {
    const app = getApp();
    const manifestPath = app?.PluginStorage?.getItem("manifest_base_path");
    if (manifestPath) {
        return manifestPath;
    }
    if (typeof window !== 'undefined' && window.location?.href) {
        const currentUrl = window.location.href;
        const lastSlash = currentUrl.lastIndexOf("/");
        return currentUrl.substring(0, lastSlash);
    }
    return "";
}
/**
 * 显示同步面板
 */
export function showBangumiPanel() {
    const app = getApp();
    if (!app) {
        if (typeof window !== 'undefined' && typeof window.BGMError === 'function') {
            window.BGMError("无法获取 WPS Application 对象！", "错误");
        }
        else if (typeof window !== 'undefined') {
            window.alert("无法获取 WPS Application 对象！");
        }
        return;
    }
    const tsId = app.PluginStorage?.getItem("taskpane_id");
    if (!tsId) {
        const tskpane = app.CreateTaskPane?.(GetUrlPath() + "/ui/taskpane.html");
        if (tskpane) {
            const id = tskpane.ID;
            app.PluginStorage?.setItem("taskpane_id", id);
            tskpane.Visible = true;
        }
    }
    else {
        const tskpane = app.GetTaskPane?.(tsId);
        if (tskpane) {
            tskpane.Visible = !tskpane.Visible;
        }
    }
}
/**
 * 字符串去除首尾空格
 */
export function trim(str) {
    if (!str)
        return "";
    return String(str).replace(/^\s+|\s+$/g, "");
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
/**
 * 延迟执行
 */
export function sleep(ms) {
    try {
        const app = getApp();
        if (app?.Wait) {
            const waitTime = new Date(Date.now() + ms);
            app.Wait(waitTime);
            return;
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, "sleep app.Wait 失败: " + e.message);
    }
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            const app = getApp();
            if (app?.DoEvents)
                app.DoEvents();
        }
        catch (e) {
            if (typeof bgmLog === 'function') {
                bgmLog(LOG_LEVELS?.DEBUG || 0, "sleep DoEvents 失败: " + e.message);
            }
            break;
        }
    }
}
/**
 * 显示自定义提示对话框
 */
export function showAlertDialog(title, message) {
    if (typeof window !== 'undefined' && typeof window.BGMAlert === 'function') {
        window.BGMAlert(message, title);
    }
    else if (typeof window !== 'undefined') {
        window.alert(message);
    }
}
/**
 * 关闭提示对话框
 */
export function closeAlertDialog() {
    const modal = document.getElementById("alertDialog");
    if (modal) {
        modal.style.display = "none";
    }
}
// ========== 统一日志前缀 ==========
(function () {
    const _origLog = console.log;
    const _origWarn = console.warn;
    const _origError = console.error;
    console.log = function (...args) {
        const argsArray = Array.from(args);
        if (argsArray.length > 0 && typeof argsArray[0] === 'string' && !argsArray[0].startsWith('[BGM]')) {
            argsArray[0] = '[BGM] ' + argsArray[0];
        }
        _origLog.apply(console, argsArray);
    };
    console.warn = function (...args) {
        const argsArray = Array.from(args);
        if (argsArray.length > 0 && typeof argsArray[0] === 'string' && !argsArray[0].startsWith('[BGM]')) {
            argsArray[0] = '[BGM] ' + argsArray[0];
        }
        _origWarn.apply(console, argsArray);
    };
    console.error = function (...args) {
        const argsArray = Array.from(args);
        if (argsArray.length > 0 && typeof argsArray[0] === 'string' && !argsArray[0].startsWith('[BGM]')) {
            argsArray[0] = '[BGM] ' + argsArray[0];
        }
        _origError.apply(console, argsArray);
    };
})();
