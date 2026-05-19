import { BGM_CONFIG, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, ErrorLevel, isWpsApp, BgmError, encryptToken, decryptToken, calcChecksum, COLUMN_RULES, HEADER_KEYWORDS, syncAllRows, showConfirm } from '../index.js';
import { showAlert as customShowAlert, showError as customShowError, showInput as customShowInput } from '../ui/dialog.js';
import { BGM_EVENTS, eventBus } from '../tools/events.js';
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
        shouldStop: false,
        lastSyncTime: null,
        startSync() {
            // 防重复
            if (this.isRunning) {
                BGM.Dialog.alert('同步正在进行中，请稍后', '提示');
                return;
            }
            // 重置停止标志
            this.resetStopFlag();
            // 显示确认对话框，避免误操作
            BGM.Dialog.confirm('确定要开始全面同步吗？', (confirmed) => {
                if (!confirmed)
                    return;
                this.isRunning = true;
                this.lastSyncTime = new Date().toISOString();
                bgmLog(LOG_LEVELS.INFO, '开始执行同步...');
                syncAllRows()
                    .then(() => {
                    this.isRunning = false;
                    // 如果是因为停止而结束，显示提示
                    if (this.shouldStop) {
                        BGM.Dialog.alert('同步已停止', '提示');
                        this.resetStopFlag();
                    }
                })
                    .catch((err) => {
                    this.isRunning = false;
                    this.resetStopFlag();
                    BGM.handleError(err, { showAlert: true });
                });
            });
        },
        requestStop() {
            if (!this.isRunning) {
                BGM.Dialog.alert('当前没有正在进行的同步', '提示');
                return;
            }
            BGM.Dialog.confirm('确定要停止同步吗？已同步的数据不会回滚。', (confirmed) => {
                if (confirmed) {
                    this.shouldStop = true;
                    bgmLog(LOG_LEVELS.INFO, '用户请求停止同步');
                    BGM.Dialog.alert('正在停止同步，请稍候...', '提示');
                }
            }, '确认停止');
        },
        checkShouldStop() {
            return this.shouldStop;
        },
        resetStopFlag() {
            this.shouldStop = false;
        }
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
            else {
                // 使用自定义对话框
                customShowAlert(message, title);
            }
        },
        confirm: function (message, callback, title) {
            showConfirm(message, callback, title);
        },
        error: function (title, message) {
            if (typeof window !== 'undefined' && window.BGMDialog !== undefined) {
                window.BGMDialog.error(title, message);
            }
            else if (typeof window !== 'undefined' && typeof window.BGMError === 'function') {
                window.BGMError(message, title);
            }
            else {
                // 使用自定义对话框
                customShowError(message, title);
            }
        },
        input: function (title, prompt, defaultValue, onOk, onCancel) {
            if (typeof window !== 'undefined' && window.BGMDialog !== undefined) {
                window.BGMDialog.input(title, prompt, defaultValue || '', onOk, onCancel);
            }
            else if (typeof window !== 'undefined' && typeof window.BGMInput === 'function') {
                window.BGMInput(title, prompt, defaultValue || '', onOk, onCancel);
            }
            else {
                // 使用自定义对话框
                customShowInput(title, prompt, defaultValue, (value) => {
                    if (onOk && value !== undefined)
                        onOk(value);
                }, onCancel);
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
                        this.confirm(message, (confirmed) => {
                            if (confirmed)
                                options?.onOk?.();
                            else
                                options?.onCancel?.();
                        }, title);
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
    showAlert: function (title, message) {
        BGM.Dialog.alert(title, message);
    },
    showConfirm: function (title, message, onConfirm, onCancel) {
        BGM.Dialog.confirm(message, (confirmed) => {
            if (confirmed) {
                onConfirm?.();
            }
            else {
                onCancel?.();
            }
        }, title);
    },
    // 统一错误处理
    handleError: function (error, options) {
        const opts = {
            level: ErrorLevel.ERROR,
            showAlert: false,
            context: '',
            ...options
        };
        // ✅ 自动获取调用函数名（如果 context 未手动指定）
        if (!opts.context) {
            opts.context = getCallerFunctionName();
        }
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
                if (opts.showAlert) {
                    BGM.showAlert('错误', bgmError.message);
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
    },
    setUserId(id) {
        if (id) {
            _setBgmUserId(id);
        }
        else {
            this.cache.userId = null;
            eventBus.emit(BGM_EVENTS.USER_ID_UPDATED);
        }
    },
    setUsername(name) {
        if (name) {
            _setBgmUsername(name);
        }
        else {
            this.cache.username = null;
            eventBus.emit(BGM_EVENTS.USER_NAME_UPDATED);
        }
    },
    notifyTokenUpdated() {
        eventBus.emit(BGM_EVENTS.TOKEN_UPDATED);
    },
    // 同步进度更新
    setSyncProgress(current, total, message) {
        eventBus.emit(BGM_EVENTS.SYNC_PROGRESS, { current, total, message });
    },
    // 同步完成，结果可选（成功/失败/跳过数量）
    setSyncComplete(results) {
        eventBus.emit(BGM_EVENTS.SYNC_COMPLETED, results);
    },
    // 同步错误更新
    setSyncError(error) {
        eventBus.emit(BGM_EVENTS.SYNC_ERROR, error);
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
        const prefixes = ['[DEBUG]', '[INFO]', '[WARN]', '[ERROR]'];
        const prefix = prefixes[level] ?? '[INFO]';
        console.log(prefix + ' ' + (message ?? ''));
    }
}
/**
 * 从调用栈中提取第一个非内部函数的名称
 * @param skipAdditional 额外跳过的帧数（备用，通常无需传）
 */
function getCallerFunctionName(skipAdditional = 0) {
    const e = new Error();
    const stack = e.stack || '';
    const lines = stack.split('\n');
    // 需要跳过的内部函数名列表
    const internalFuncs = [
        'getCallerFunctionName',
        'handleError',
        'safeExecute',
        'BGM.handleError',
        'BGM.safeExecute',
    ];
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        const match = /at\s+([^\s(]+)/.exec(line);
        if (match) {
            const name = match[1];
            if (!internalFuncs.includes(name)) {
                return name;
            }
        }
    }
    return 'unknown';
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
export function getCell(ws, row, col) {
    if (!ws)
        return null;
    const address = colNumToLetter(col) + row;
    return ws.Range(address);
}
// 内部辅助函数，不导出
/**
 * 安全地获取对象属性值，处理属性值为函数的情况
 * @param cell - 要获取属性的对象
 * @param prop - 属性名称
 * @returns 属性的值；如果属性不存在或访问失败，则返回 undefined
 */
function tryGetProperty(cell, prop) {
    if (!(prop in cell))
        return undefined;
    try {
        const val = cell[prop];
        if (typeof val === 'function') {
            try {
                const result = val();
                if (typeof result === 'function' && result.toString().includes('[native code]')) {
                    return undefined;
                }
                return result;
            }
            catch {
                return undefined;
            }
        }
        if (val && typeof val === 'object' && typeof val.toString === 'function') {
            const str = val.toString();
            if (str.includes('function') || str.includes('[native code]')) {
                return undefined;
            }
        }
        return val;
    }
    catch {
        return undefined;
    }
}
//内部辅助函数，不导出
/**
 * 获取单元格的原始值，按优先级尝试 Value2、Value 和 Text 属性
 * @param cell - 单元格对象
 * @returns 单元格的原始值；如果单元格无效或没有值，则返回 null
 */
function getCellRawValue(cell) {
    if (!cell)
        return null;
    const val2 = tryGetProperty(cell, 'Value2');
    if (val2 !== undefined && val2 !== null)
        return val2;
    const val = tryGetProperty(cell, 'Value');
    if (val !== undefined && val !== null)
        return val;
    const text = tryGetProperty(cell, 'Text');
    if (text !== undefined && text !== null)
        return text;
    return null;
}
/**
 * 获取单元格的值
 * @param ws - 工作表对象，可能为 null 或 undefined
 * @param row - 行号
 * @param col - 列号
 * @returns 单元格的字符串值；如果工作表无效或单元格不存在，则返回空字符串
 */
export function getCellValue(ws, row, col) {
    if (!ws)
        return '';
    try {
        const address = colNumToLetter(col) + row;
        const cell = ws.Range(address);
        if (!cell)
            return '';
        const raw = getCellRawValue(cell);
        return raw != null ? String(raw) : '';
    }
    catch {
        return '';
    }
}
/**
 * 设置单元格值
 */
export function setCellValue(ws, row, col, value) {
    try {
        const cell = getCell(ws, row, col);
        if (!cell) {
            bgmLog(LOG_LEVELS.ERROR, `setCellValue - 无法获取单元格: (${row}, ${col})`);
            return false;
        }
        cell.Value2 = value;
        return true;
    }
    catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'setCellValue' });
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
/**
 * 设置 Bangumi 用户 ID（存储到全局缓存）
 * @param id - 用户 ID 字符串，不能为空
 *
 *
 *
 *  1.验证输入的用户ID是否为空
    2.将用户ID存储到全局缓存 BGM.cache.userId 中
    3.同时使用插件存储功能将用户ID持久化保存
    4.触发用户ID更新事件通知其他模块
 */
export function _setBgmUserId(id) {
    if (!id || id.trim() === '')
        return;
    const userId = id.trim();
    BGM.cache.userId = userId;
    // 持久化存储
    const app = getApp();
    if (app?.PluginStorage) {
        app.PluginStorage.setItem('bgm_user_id', userId);
    }
    eventBus.emit(BGM_EVENTS.USER_ID_UPDATED);
}
/**
 * 获取 Bangumi 用户 ID（优先从内存缓存读取，回退到 PluginStorage）
 * @returns 用户 ID 字符串；若未设置则返回 null
 */
export function _getBgmUserId() {
    if (BGM.cache.userId)
        return BGM.cache.userId;
    // 回退到 PluginStorage（Ribbon 设置后 Taskpane 可从持久化存储读取）
    try {
        const app = getApp();
        if (app?.PluginStorage) {
            const stored = app.PluginStorage.getItem('bgm_user_id');
            if (stored) {
                BGM.cache.userId = stored;
                return stored;
            }
        }
    }
    catch (e) { /* 忽略 PluginStorage 读取错误 */ }
    return null;
}
/**
 * 设置 Bangumi 用户名（持久化到 PluginStorage）
 */
export function _setBgmUsername(name) {
    if (!name || name.trim() === '')
        return;
    const username = name.trim();
    BGM.cache.username = username;
    const app = getApp();
    if (app?.PluginStorage) {
        app.PluginStorage.setItem('bgm_username', username);
    }
    eventBus.emit(BGM_EVENTS.USER_NAME_UPDATED);
}
/**
 * 获取 Bangumi 用户名（优先从内存缓存读取，回退到 PluginStorage）
 * @returns 用户名；若未设置则返回 null
 */
export function _getBgmUsername() {
    if (BGM.cache.username)
        return BGM.cache.username;
    try {
        const app = getApp();
        if (app?.PluginStorage) {
            const stored = app.PluginStorage.getItem('bgm_username');
            if (stored) {
                BGM.cache.username = stored;
                return stored;
            }
        }
    }
    catch (e) { /* 忽略 */ }
    return null;
}
/**
 * 获取 Bangumi API 用户路径（格式：/-）
 * 用于拼接用户收藏请求的 URL
 * @returns 用户路径字符串 "/-"，代表当前认证用户
 * @description BGM API v0 使用 "-" 代表当前认证用户，而不是具体的用户ID
 */
export function _getUserApiPath() {
    // BGM API v0 使用 "-" 代表当前认证用户
    return '/-';
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
    const apiUrl = BGM_CONFIG.API_BASE + "/v0/me";
    bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] API 路由: ${apiUrl}`);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", apiUrl, true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                const userId = String(data.id || data.user_id || '');
                // BGM API v0 返回的用户名字段是 nickname，username 是用户ID
                const username = String(data.nickname || data.username || data.user_name || data.name || '');
                _setBgmUserId(userId);
                _setBgmUsername(username);
                bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] 获取用户信息成功: userId=${userId}, username=${username}`);
                if (callback)
                    callback({ id: userId, username: username });
            }
            catch (e) {
                bgmLog(LOG_LEVELS.ERROR, `[_fetchBgmUserInfo] 解析响应失败: ${e.message}`);
                if (callback)
                    callback(null);
            }
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 获取用户信息失败，HTTP 状态码: ${xhr.status}`);
            if (callback)
                callback(null);
        }
    };
    xhr.onerror = function () {
        BGM.handleError(new Error('获取用户信息网络错误'), { level: ErrorLevel.WARN, context: '_fetchBgmUserInfo' });
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
        else {
            // 使用自定义错误对话框
            customShowError("无法获取 WPS Application 对象！", "错误");
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
                bgmLog(LOG_LEVELS.INFO, "sleep DoEvents 失败: " + e.message);
            }
            break;
        }
    }
}
// ===== 统一日志前缀 ==========
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
/**
 * 异步延迟指定的毫秒数
 * @param ms 毫秒
 * @returns Promise
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * 批量读取工作表中指定范围的所有值，返回字符串二维数组 [行][列]
 * 如果读取失败则返回空数组，调用方应处理空数组情况
 * @param ws 工作表对象
 * @param startRow 起始行
 * @param endRow 结束行
 * @param startCol 起始列
 * @param endCol 结束列
 * @returns 字符串二维数组
 */
function isNativeCode(val) {
    if (typeof val === 'function') {
        const str = val.toString();
        return str.includes('[native code]') || str.includes('function Value()');
    }
    if (val && typeof val === 'object' && typeof val.toString === 'function') {
        const str = val.toString();
        return str.includes('[native code]') || str.includes('function Value()');
    }
    return false;
}
function safeCellValue(cell) {
    if (cell == null)
        return '';
    if (isNativeCode(cell))
        return '';
    if (typeof cell === 'function') {
        try {
            const result = cell();
            if (isNativeCode(result))
                return '';
            return result == null ? '' : String(result);
        }
        catch {
            return '';
        }
    }
    if (typeof cell === 'object' && cell.toString) {
        const str = cell.toString();
        if (isNativeCode(str) || isNativeCode(cell))
            return '';
        return str;
    }
    return String(cell);
}
export function readRangeValues(ws, startRow, endRow, startCol, endCol) {
    try {
        const range = ws.Range(`${colNumToLetter(startCol)}${startRow}:${colNumToLetter(endCol)}${endRow}`);
        const raw = tryGetProperty(range, 'Value2');
        if (!raw)
            return [];
        // 处理单个值的情况
        if (!Array.isArray(raw)) {
            return [[safeCellValue(raw)]];
        }
        const result = [];
        for (const row of raw) {
            if (!Array.isArray(row)) {
                result.push([safeCellValue(row)]);
            }
            else {
                result.push(row.map((cell) => safeCellValue(cell)));
            }
        }
        return result;
    }
    catch (e) {
        return [];
    }
}
// 缓存相关（放在文件顶部，导入之后）
const sheetCache = new Map();
/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export function cacheGet(key, factory) {
    if (sheetCache.has(key)) {
        return sheetCache.get(key);
    }
    const value = factory();
    sheetCache.set(key, value);
    return value;
}
export function findHeaderRow(ws, startRow) {
    const sheetName = ws?.Name || '';
    const cacheKey = `${sheetName}:headerRow:${startRow || 1}`;
    return cacheGet(cacheKey, () => {
        let sRow = startRow || 1;
        for (let row = sRow; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row++) {
            let matchCount = 0;
            for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col++) {
                try {
                    let cellVal = String(getCellValue(ws, row, col)).toLowerCase();
                    if (!cellVal)
                        continue;
                    for (let header of HEADER_KEYWORDS) {
                        if (cellVal.indexOf(header.toLowerCase()) >= 0) {
                            matchCount++;
                            break;
                        }
                    }
                    if (matchCount >= 3)
                        break;
                }
                catch (e) { }
            }
            if (matchCount >= 3)
                return row;
        }
        return 0;
    });
}
/**
 * 获取列名到列号的映射（优化版：使用正则规则数组，时间复杂度 O(N*M) 但 M 较小）
 * @param ws 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列映射
 */
/**
 * 获取列名到列号的映射（优化版：正则规则数组 + 缓存）
 * @param ws 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列名 -> 列号
 */
export function getColumnMap(ws, headerRow) {
    const sheetName = ws?.Name || '';
    const cacheKey = `${sheetName}:columnMap:${headerRow}`;
    return cacheGet(cacheKey, () => {
        const colMap = new Map();
        let firstNonEmptyCol;
        const lastCol = 50;
        for (let i = 1; i <= lastCol; i++) {
            const colName = trim(String(getCellValue(ws, headerRow, i)));
            // 记录第一个非空列作为序列号列
            if (!firstNonEmptyCol && colName) {
                firstNonEmptyCol = i;
            }
            if (!colName)
                continue;
            for (const [pattern, key] of COLUMN_RULES) {
                if (pattern.test(colName)) {
                    colMap.set(key, i);
                    break; // 每个列名只匹配第一个规则
                }
            }
        }
        // 如果没有通过规则匹配到序列号列，使用第一个非空列
        if (!colMap.has('序列号') && firstNonEmptyCol) {
            colMap.set('序列号', firstNonEmptyCol);
        }
        return colMap;
    });
}
/** 清除指定工作表的所有缓存 */
export function clearSheetCache(ws) {
    const prefix = ws?.Name || '';
    for (const key of sheetCache.keys()) {
        if (key.startsWith(prefix))
            sheetCache.delete(key);
    }
}
/**
 * 在表头行中查找第一个匹配「序列号 / Bangumi URL / 名称 / 别名」的列索引
 * @param ws           工作表
 * @param headerRow 表头行号
 * @returns 列索引（1‑based），若未找到返回 undefined
 */
function findAnchorColumn(ws, headerRow) {
    const keywords = [
        // 序列号
        '序号', '编号', '序列号', '整理序号', 'id', 'no', 'number',
        // Bangumi URL
        'bangumi', 'url', '链接', '地址', 'bgm',
        // 名称
        '名称', '标题', '作品名', 'title', 'name',
        // 别名
        '别名', '又名', 'alias', 'othername'
    ];
    const maxCols = 50;
    for (let c = 1; c <= maxCols; c++) {
        const val = ws.Range(`${colNumToLetter(c)}${headerRow}`).Value2;
        if (val == null)
            continue;
        const text = String(val).trim().toLowerCase();
        if (keywords.some(kw => text === kw || text.includes(kw))) {
            return c;
        }
    }
    return undefined;
}
/**
 * 获取工作表的最后有效数据行
 * @param ws            工作表对象（WpsWorksheet）
 * @param forceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export function getLastRow(ws, forceRefresh = false, headerRow) {
    if (!ws) {
        bgmLog(LOG_LEVELS.WARN, 'getLastRow: 工作表对象无效，返回默认值 50000');
        return 50000;
    }
    const sheetName = ws.Name || '';
    const cacheKey = `${sheetName}:lastRow${headerRow ? `:hr${headerRow}` : ''}`;
    if (forceRefresh) {
        clearSheetCache(ws);
        bgmLog(LOG_LEVELS.INFO, '缓存已清除，重新计算最后行');
    }
    const cached = cacheGet(cacheKey, () => {
        bgmLog(LOG_LEVELS.INFO, `正在计算工作表 "${sheetName}" 的最后数据行（${headerRow ? '根据表头自动选择列' : '多列回退'}）...`);
        // 1. 如果提供了表头行，尝试自动选择锚定列
        if (headerRow != null && headerRow >= 1) {
            const col = findAnchorColumn(ws, headerRow);
            if (col) {
                try {
                    // ✅ 修复点：使用 col 拼地址，而不是硬编码 D
                    const colLetter = colNumToLetter(col);
                    const cell = ws.Range(`${colLetter}${ws.Rows.Count}`);
                    const endCell = cell.End(-4162);
                    if (endCell && endCell.Row > 0) {
                        bgmLog(LOG_LEVELS.INFO, `根据表头找到锚定列 ${col}(${colLetter})，最后行: ${endCell.Row}`);
                        return endCell.Row;
                    }
                }
                catch (e) {
                    bgmLog(LOG_LEVELS.WARN, `锚定列 ${col} 定位失败: ${e.message}，回退到原有逻辑`);
                }
            }
        }
        // 2. 优先 D 列（常见序号列）
        try {
            const cell = ws.Range(`D${ws.Rows.Count}`);
            const endCell = cell.End(-4162);
            if (endCell && endCell.Row > 0) {
                bgmLog(LOG_LEVELS.INFO, `D列向上定位成功，最后行: ${endCell.Row}`);
                return endCell.Row;
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `D列定位失败: ${e.message}`);
        }
        // 3. 尝试 A 列
        try {
            const cell = ws.Range(`A${ws.Rows.Count}`);
            const endCell = cell.End(-4162);
            if (endCell && endCell.Row > 0) {
                bgmLog(LOG_LEVELS.INFO, `A列向上定位成功，最后行: ${endCell.Row}`);
                return endCell.Row;
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `A列定位失败: ${e.message}`);
        }
        // 4. UsedRange 兜底
        try {
            const usedRange = ws.UsedRange;
            if (usedRange) {
                const last = usedRange.Row + usedRange.Rows.Count - 1;
                if (last > 0) {
                    bgmLog(LOG_LEVELS.INFO, `UsedRange 估算最后行: ${last}`);
                    return last;
                }
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `UsedRange 失败: ${e.message}`);
        }
        // 5. 最终默认值
        bgmLog(LOG_LEVELS.WARN, `无法确定工作表 "${sheetName}" 的最后行，使用默认值 50000`);
        return 50000;
    });
    bgmLog(LOG_LEVELS.INFO, `工作表 "${sheetName}" 最后数据行: ${cached}${sheetCache.has(cacheKey) ? ' (来自缓存)' : ' (首次计算)'}`);
    return cached;
}
export function isEmptyValue(val) {
    return val === null || val === undefined || val === "" ||
        val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}
// ========== 获取数据工作表 ==========
export function getDataSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook)
        return null;
    bgmLog(LOG_LEVELS.INFO, `getDataSheet: isLocked=${BGM.sheet.isLocked}, lockedIndex=${BGM.sheet.lockedIndex}`);
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        try {
            const ws = app.ActiveWorkbook.Worksheets.Item(BGM.sheet.lockedIndex);
            bgmLog(LOG_LEVELS.INFO, `getDataSheet: 返回锁定的工作表: ${ws.Name}`);
            return ws;
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, "getDataSheet 锁定工作表失败: " + e.message);
        }
    }
    const ws = app.ActiveWorkbook.ActiveSheet;
    bgmLog(LOG_LEVELS.INFO, `getDataSheet: 返回当前活动工作表: ${ws.Name}`);
    return ws;
}
/**
 * 计算 Excel 行数据的指纹（用于增量同步比较）
 * @param fields 关键字段值数组，如 [name, type, rate, tags, comment]
 * @returns 指纹字符串
 */
export function calcFingerprint(fields) {
    const raw = fields.join('|');
    // 复用已有的 calcChecksum 生成简短校验和，或直接返回原始字符串前 50 字符
    return calcChecksum(raw).toString(16).padStart(4, '0');
}
export function safeActivate(ws) {
    if (ws && typeof ws.Activate === 'function') {
        ws.Activate();
    }
    else {
        bgmLog(LOG_LEVELS.WARN, 'safeActivate: 无法激活工作表');
    }
}
