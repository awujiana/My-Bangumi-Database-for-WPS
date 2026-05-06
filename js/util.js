import { WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS } from './core/constants.js';
import { encryptToken, decryptToken, calcChecksum } from './core/crypto.js';
import { BgmError, ErrorLevel } from './types/index.js';
export { BgmError, ErrorLevel };
export const WPS_Enum = WPS_ENUM;
export { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS };
export const BGM = {
    cache: {
        totalRows: 0,
        userId: null,
        username: null,
        sidCache: new Map(),
        listCache: []
    },
    sheet: {
        lockedIndex: null,
        lockedName: null,
        isLocked: false
    },
    sync: {
        isRunning: false,
        lastSyncTime: null
    },
    LOG_LEVEL: LOG_LEVELS.INFO,
    LOG_LEVELS: LOG_LEVELS,
    ERROR_LEVELS: ERROR_LEVELS,
    ErrorLevel: ErrorLevel,
    BgmError: BgmError,
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
    safeExecute: function (fn, context, options) {
        try {
            return fn();
        }
        catch (error) {
            return BGM.handleError(error, { context, ...options });
        }
    }
};
export function bgmLog(level, message) {
    if (level >= BGM.LOG_LEVEL) {
        const prefix = ['[DEBUG]', '[INFO]', '[WARN]', '[ERROR]'][level] || '[INFO]';
        console.log(prefix + ' ' + message);
    }
}
export function getApp() {
    if (typeof window !== 'undefined' && window.Application) {
        return window.Application;
    }
    if (typeof Application !== 'undefined') {
        return Application;
    }
    return null;
}
export function colNumToLetter(col) {
    let letter = "";
    while (col > 0) {
        const mod = (col - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        col = Math.floor((col - mod) / 26);
    }
    return letter;
}
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
export function getSheetByIndex(sheetIndex) {
    const app = getApp();
    if (!app?.ActiveWorkbook?.Sheets)
        return null;
    const sheets = app.ActiveWorkbook.Sheets;
    if (sheets.Count === 0)
        return null;
    return sheets.Item(sheetIndex);
}
export function escapeHtml(text) {
    if (!text)
        return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
export function storeBgToken(token) {
    const app = getApp();
    if (!app?.PluginStorage)
        return false;
    app.PluginStorage.setItem("bgm_token", encryptToken(token));
    return true;
}
export function clearBgToken() {
    const app = getApp();
    if (!app?.PluginStorage)
        return false;
    app.PluginStorage.setItem("bgm_token", "");
    return true;
}
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
export function _setBgmUserId(id) {
    BGM.cache.userId = id;
}
export function _getBgmUserId() {
    return BGM.cache.userId;
}
export function _getUserApiPath() {
    return BGM.cache.userId ? String(BGM.cache.userId) : "-";
}
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
export function fetchBgmUserInfo() {
    return new Promise((resolve) => {
        _fetchBgmUserInfo((userInfo) => {
            resolve(userInfo);
        });
    });
}
export function shellExecuteByOAAssist(param) {
    const app = getApp();
    if (app?.OAAssist) {
        app.OAAssist.ShellExecute(param);
    }
}
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
export function trim(str) {
    if (!str)
        return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}
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
export function showAlertDialog(title, message) {
    if (typeof window !== 'undefined' && typeof window.BGMAlert === 'function') {
        window.BGMAlert(message, title);
    }
    else if (typeof window !== 'undefined') {
        window.alert(message);
    }
}
export function closeAlertDialog() {
    const modal = document.getElementById("alertDialog");
    if (modal) {
        modal.style.display = "none";
    }
}
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
if (typeof window !== 'undefined') {
    const win = window;
    win.WPS_Enum = WPS_ENUM;
    win.XL = XL;
    win.BGM_CONFIG = BGM_CONFIG;
    win.BGM_COLOR = BGM_COLOR;
    win.BGM = BGM;
    win.bgmLog = bgmLog;
    win.getApp = getApp;
    win.colNumToLetter = colNumToLetter;
    win.getCell = getCell;
    win.getCellValue = getCellValue;
    win.setCellValue = setCellValue;
    win.readCell = readCell;
    win.getSheetByIndex = getSheetByIndex;
    win.escapeHtml = escapeHtml;
    win.storeBgToken = storeBgToken;
    win.clearBgToken = clearBgToken;
    win.loadBgToken = loadBgToken;
    win._setBgmUserId = _setBgmUserId;
    win._getBgmUserId = _getBgmUserId;
    win._getUserApiPath = _getUserApiPath;
    win._fetchBgmUserInfo = _fetchBgmUserInfo;
    win.fetchBgmUserInfo = fetchBgmUserInfo;
    win.showAlertDialog = showAlertDialog;
    win.closeAlertDialog = closeAlertDialog;
    win.shellExecuteByOAAssist = shellExecuteByOAAssist;
    win.GetUrlPath = GetUrlPath;
    win.showBangumiPanel = showBangumiPanel;
    win.trim = trim;
    win.wpsPrompt = wpsPrompt;
    win.wpsMsgBox = wpsMsgBox;
    win.sleep = sleep;
    win.calcChecksum = calcChecksum;
}
