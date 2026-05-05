/**
 * BGM 工具模块
 * @module util
 * @description 提供通用工具函数、常量定义、错误处理等核心功能
 */

import { WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS } from './core/constants.js';
import { encryptToken, decryptToken, calcChecksum } from './core/crypto.js';

// ========== 导出常量（向后兼容）==========
export const WPS_Enum = WPS_ENUM;
export { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS };

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
        lastSyncTime: null
    },
    // 日志级别（0=DEBUG, 1=INFO, 2=WARN, 3=ERROR）
    LOG_LEVEL: LOG_LEVELS.INFO,
    
    // 日志级别常量
    LOG_LEVELS: LOG_LEVELS,

    // 错误级别常量
    ERROR_LEVELS: ERROR_LEVELS,

    // 统一对话框
    Dialog: {
        alert: function(title, message) {
            if (typeof window.BGMDialog !== 'undefined') {
                window.BGMDialog.alert(title, message);
            } else if (typeof window.BGMAlert === 'function') {
                window.BGMAlert(message, title);
            } else {
                window.alert(message);
            }
        },
        confirm: function(message, onConfirm, onCancel) {
            if (typeof window.BGMDialog !== 'undefined') {
                window.BGMDialog.confirm(message, onConfirm, onCancel);
            } else if (typeof window.BGMConfirm === 'function') {
                window.BGMConfirm(message, '确认', onConfirm, onCancel);
            } else {
                if (window.confirm(message)) {
                    if (onConfirm) onConfirm();
                } else {
                    if (onCancel) onCancel();
                }
            }
        },
        error: function(title, message) {
            if (typeof window.BGMDialog !== 'undefined') {
                window.BGMDialog.error(title, message);
            } else if (typeof window.BGMError === 'function') {
                window.BGMError(message, title);
            } else {
                window.alert('[错误] ' + message);
            }
        },
        input: function(title, prompt, defaultValue, onOk, onCancel) {
            if (typeof window.BGMDialog !== 'undefined') {
                window.BGMDialog.input(title, prompt, defaultValue, onOk, onCancel);
            } else if (typeof window.BGMInput === 'function') {
                window.BGMInput(title, prompt, defaultValue, onOk, onCancel);
            } else {
                const result = window.prompt(prompt, defaultValue);
                if (result !== null) {
                    if (onOk) onOk(result);
                } else {
                    if (onCancel) onCancel();
                }
            }
        },
        show: function(type, title, message, options) {
            if (typeof window.BGMDialog !== 'undefined') {
                window.BGMDialog.show(type, title, message, options);
            } else {
                // 降级处理
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

    // 统一消息通信
    Message: {
        send: function(data, targetOrigin) {
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage(data, targetOrigin || "*");
                    return true;
                }
            } catch (e) {
                // 静默处理 postMessage 不可用的情况（如跨域限制）
                // 仅在调试模式下记录
                if (typeof bgmLog === 'function') {
                    bgmLog(LOG_LEVELS?.DEBUG || 0, "postMessage 不可用: " + e.message);
                }
            }
            return false;
        },
        postMessage: function(data, targetOrigin) {
            return this.send(data, targetOrigin);
        }
    }
};

// ========== 日志函数 ==========
/**
 * 日志函数（支持日志级别控制）
 * @param {number} level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param {string} message - 日志消息
 */
export function bgmLog(level, message) {
    if (level >= BGM.LOG_LEVEL) {
        const prefix = ['[DEBUG]', '[INFO]', '[WARN]', '[ERROR]'][level] || '[INFO]';
        console.log(prefix + ' ' + message);
    }
}

// ========== Application 获取 ==========
/**
 * 获取 Application 对象
 */
export function getApp() {
    if (typeof window !== 'undefined' && window.Application) {
        return window.Application;
    }
    if (typeof Application !== 'undefined') {
        return Application;
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
        let mod = (col - 1) % 26;
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
        if (ws && typeof ws.Range === 'function') {
            let colLetter = colNumToLetter(col);
            return ws.Range(colLetter + row);
        }
        if (ws && ws.Cells && typeof ws.Cells.Item === 'function') {
            return ws.Cells.Item(row, col);
        }
        if (ws && ws.Cells) {
            return ws.Cells(row, col);
        }
        return null;
    } catch (e) {
        console.error("getCell error:", e);
        return null;
    }
}

/**
 * 安全获取单元格值
 */
export function getCellValue(ws, row, col) {
    try {
        let cell = getCell(ws, row, col);
        if (cell && cell.Value) {
            return String(cell.Value());
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "getCellValue 失败: " + e.message);
    }
    return "";
}

/**
 * 设置单元格值
 */
export function setCellValue(ws, row, col, value) {
    try {
        let cell = getCell(ws, row, col);
        if (!cell) {
            console.error("setCellValue - 无法获取单元格:", row, col);
            return false;
        }
        cell.Value = value;
        return true;
    } catch (e) {
        console.error("setCellValue error (行:", row, "列:", col, "):", e);
    }
    return false;
}

/**
 * 获取工作表对象
 */
export function getSheetByIndex(sheetIndex) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) return null;
    let sheets = app.ActiveWorkbook.Sheets;
    if (!sheets || sheets.Count === 0) return null;
    return sheets.Item(sheetIndex);
}

// ========== HTML 安全 ==========
/**
 * HTML 转义（防止 XSS）
 */
export function escapeHtml(text) {
    if (!text) return "";
    let div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ========== Token 存储 ==========
/**
 * 存储 Token（加密）
 */
export function storeBgToken(token) {
    let app = getApp();
    if (!app) return false;
    app.PluginStorage.setItem("bgm_token", encryptToken(token));
    return true;
}

/**
 * 清除 Token
 */
export function clearBgToken() {
    let app = getApp();
    if (!app) return false;
    app.PluginStorage.setItem("bgm_token", "");
    return true;
}

/**
 * 加载 Token（解密）
 */
export function loadBgToken() {
    let app = getApp();
    if (!app) return null;
    let stored = app.PluginStorage.getItem("bgm_token");
    if (!stored) return null;
    let token = decryptToken(stored);
    if (token) return token;
    // 非加密格式 → 删除无效数据
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
    let token = loadBgToken();
    if (!token) {
        if (callback) callback(null);
        return;
    }
    
    let xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/me", true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                let data = JSON.parse(xhr.responseText);
                let userId = String(data.id || data.user_id);
                let username = data.username || data.user_name || data.name || "";
                
                BGM.cache.userId = userId;
                BGM.cache.username = username;
                // 只在调试模式下记录用户信息（注意：不在生产环境日志中暴露敏感信息）
                bgmLog(LOG_LEVELS.DEBUG, "_fetchBgmUserInfo: userId=" + userId);
                
                if (callback) callback({ id: userId, username: username });
            } catch (e) {
                if (callback) callback(null);
            }
        } else {
            if (callback) callback(null);
        }
    };
    
    xhr.onerror = function() {
        if (callback) callback(null);
    };
    
    xhr.send();
}

// ========== 消息通信 ==========
/**
 * 统一的 postMessage 函数
 * @deprecated 使用 BGM.Message.send() 代替
 */
BGM.postMessage = function(data, targetOrigin) {
    return BGM.Message.send(data, targetOrigin);
};

/**
 * 统一的对话框显示函数
 * @deprecated 使用 BGM.Dialog.alert() 代替
 */
BGM.showDialog = function(title, message) {
    if (BGM.Message.send({ type: "showDialog", title: title, message: message })) {
        return;
    }
    BGM.Dialog.alert(title, message);
};

/**
 * 显示确认对话框
 * @deprecated 使用 BGM.Dialog.confirm() 代替
 */
BGM.showConfirm = function(title, message, onConfirm, onCancel) {
    if (BGM.Message.send({ type: "showConfirm", title: title, message: message, onConfirm: true })) {
        window._bgmConfirmCallback = { confirm: onConfirm, cancel: onCancel };
        return;
    }
    BGM.Dialog.confirm(message, onConfirm, onCancel);
};
(function() {
    try {
        const _origAlert = window.alert;
        window.BGMAlert = window.BGMAlert || function(message) {
            // 优先使用自定义对话框，否则回退到原生 alert
            if (typeof _origAlert === 'function') {
                _origAlert(message);
            }
        };
    } catch (e) {
        // 某些环境禁止覆盖 window.alert，忽略即可
        console.warn('[BGM] Cannot override window.alert:', e.message);
    }
})();

/**
 * 显示自定义提示对话框
 */
export function showAlertDialog(title, message) {
    if (typeof window.BGMAlert === 'function') {
        window.BGMAlert(message, title);
    } else {
        window.alert(message);
    }
}

/**
 * 关闭提示对话框
 */
export function closeAlertDialog() {
    let modal = document.getElementById("alertDialog");
    if (modal) {
        modal.style.display = "none";
    }
}

// ========== 辅助函数 ==========
/**
 * 通过 WPS 提供的接口执行脚本
 */
export function shellExecuteByOAAssist(param) {
    let app = getApp();
    if (app && app.OAAssist) {
        app.OAAssist.ShellExecute(param);
    }
}

/**
 * 获取 URL 路径
 */
export function GetUrlPath() {
    let app = getApp();
    let manifestPath = app ? app.PluginStorage.getItem("manifest_base_path") : null;
    if (manifestPath) {
        return manifestPath;
    }
    if (typeof window !== 'undefined' && window.location && window.location.href) {
        let currentUrl = window.location.href;
        let lastSlash = currentUrl.lastIndexOf("/");
        return currentUrl.substring(0, lastSlash);
    }
    return "";
}

/**
 * 显示同步面板
 */
export function showBangumiPanel() {
    let app = getApp();
    if (!app) {
        if (typeof window.BGMError === 'function') {
            window.BGMError("无法获取 WPS Application 对象！", "错误");
        } else {
            window.alert("无法获取 WPS Application 对象！");
        }
        return;
    }
    let tsId = app.PluginStorage.getItem("taskpane_id");
    if (!tsId) {
        let tskpane = app.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html");
        let id = tskpane.ID;
        app.PluginStorage.setItem("taskpane_id", id);
        tskpane.Visible = true;
    } else {
        let tskpane = app.GetTaskPane(tsId);
        tskpane.Visible = !tskpane.Visible;
    }
}

/**
 * 字符串去除首尾空格
 */
export function trim(str) {
    if (!str) return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}

/**
 * 显示输入提示框
 */
export function wpsPrompt(message, defaultValue) {
    return new Promise((resolve) => {
        let app = getApp();
        if (app && typeof app.InputBox === 'function') {
            try {
                let result = app.InputBox(message, "Bangumi 设置", defaultValue || "", 2);
                if (result === false || result === null || result === undefined) {
                    resolve(null);
                    return;
                }
                resolve(String(result));
                return;
            } catch (e) {
                console.warn("WPS InputBox 不可用:", e.message);
            }
        }
        // 使用自定义输入对话框
        if (typeof window.BGMInput === 'function') {
            window.BGMInput("输入", message, defaultValue, (value) => {
                resolve(value);
            }, () => {
                resolve(null);
            });
        } else {
            try {
                let result = window.prompt(message, defaultValue);
                resolve(result);
            } catch (e) {
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
        let app = getApp();
        if (app && typeof app.MessageBox === 'function') {
            try {
                let result = app.MessageBox(message, (buttons || 0) + (icon || 64));
                resolve(result);
                return;
            } catch (e) {
                console.warn("WPS MessageBox 不可用:", e.message);
            }
        }
        
        if (buttons === 4) {
            // 确认对话框
            if (typeof window.BGMConfirm === 'function') {
                window.BGMConfirm(message, "确认", () => {
                    resolve(6); // IDOK
                }, () => {
                    resolve(7); // IDCANCEL
                });
            } else {
                resolve(window.confirm(message) ? 6 : 7);
            }
        } else {
            // 普通提示
            if (typeof window.BGMAlert === 'function') {
                window.BGMAlert(message, "提示", () => {
                    resolve(1);
                });
            } else {
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
        let app = getApp();
        if (app && typeof app.Wait !== 'undefined') {
            let waitTime = new Date(Date.now() + ms);
            app.Wait(waitTime);
            return;
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "sleep app.Wait 失败: " + e.message);
    }
    let end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            let app = getApp();
            if (app && app.DoEvents) app.DoEvents();
        } catch(e) {
            // 静默处理 DoEvents 不可用的情况
            // 仅在调试模式下记录
            if (typeof bgmLog === 'function') {
                bgmLog(LOG_LEVELS?.DEBUG || 0, "sleep DoEvents 失败: " + e.message);
            }
            break; // 退出循环，避免无限等待
        }
    }
}

// ========== 错误处理模块 ==========
BGM.ErrorLevel = {
    SILENT: 0,
    WARN: 1,
    ERROR: 2,
    THROW: 3
};

/**
 * 错误类
 */
BGM.BgmError = function(message, code, details) {
    this.message = message;
    this.code = code || 'UNKNOWN';
    this.details = details || {};
    this.timestamp = new Date().toISOString();
};

BGM.BgmError.prototype.toString = function() {
    return `[${this.code}] ${this.message}`;
};

/**
 * 统一错误处理函数
 */
BGM.handleError = function(error, options) {
    const opts = Object.assign({
        level: BGM.ErrorLevel.ERROR,
        showDialog: false,
        context: ''
    }, options || {});

    let bgmError;
    if (error instanceof BGM.BgmError) {
        bgmError = error;
    } else if (error instanceof Error) {
        bgmError = new BGM.BgmError(error.message, 'JS_ERROR', {
            name: error.name,
            stack: error.stack
        });
    } else {
        bgmError = new BGM.BgmError(String(error), 'UNKNOWN');
    }

    if (opts.context) {
        bgmError.context = opts.context;
    }

    switch (opts.level) {
        case BGM.ErrorLevel.SILENT:
            break;
        case BGM.ErrorLevel.WARN:
            bgmLog(LOG_LEVELS.WARN, bgmError.toString());
            break;
        case BGM.ErrorLevel.ERROR:
            bgmLog(LOG_LEVELS.ERROR, bgmError.toString());
            if (opts.showDialog) {
                BGM.showDialog('错误', bgmError.message);
            }
            break;
        case BGM.ErrorLevel.THROW:
            bgmLog(LOG_LEVELS.ERROR, bgmError.toString());
            throw bgmError;
    }

    return bgmError;
};

/**
 * 安全执行函数
 */
BGM.safeExecute = function(fn, context, options) {
    try {
        return fn();
    } catch (error) {
        return BGM.handleError(error, Object.assign({ context: context }, options));
    }
};

// ========== 统一日志前缀 ==========
(function() {
    const _origLog = console.log;
    const _origWarn = console.warn;
    const _origError = console.error;
    console.log = function() {
        let args = Array.prototype.slice.call(arguments);
        if (args.length > 0 && typeof args[0] === 'string' && !args[0].startsWith('[BGM]')) {
            args[0] = '[BGM] ' + args[0];
        }
        _origLog.apply(console, args);
    };
    console.warn = function() {
        let args = Array.prototype.slice.call(arguments);
        if (args.length > 0 && typeof args[0] === 'string' && !args[0].startsWith('[BGM]')) {
            args[0] = '[BGM] ' + args[0];
        }
        _origWarn.apply(console, args);
    };
    console.error = function() {
        let args = Array.prototype.slice.call(arguments);
        if (args.length > 0 && typeof args[0] === 'string' && !args[0].startsWith('[BGM]')) {
            args[0] = '[BGM] ' + args[0];
        }
        _origError.apply(console, args);
    };
})();

// ========== 向后兼容别名（挂载到 window）==========
// 这些别名用于兼容旧代码，待完全迁移后可移除
window.WPS_Enum = WPS_ENUM;
window.XL = XL;
window.BGM_CONFIG = BGM_CONFIG;
window.BGM_COLOR = BGM_COLOR;
window.BGM = BGM;
window.bgmLog = bgmLog;
window.getApp = getApp;
window.colNumToLetter = colNumToLetter;
window.getCell = getCell;
window.getCellValue = getCellValue;
window.setCellValue = setCellValue;
window.getSheetByIndex = getSheetByIndex;
window.escapeHtml = escapeHtml;
window.storeBgToken = storeBgToken;
window.clearBgToken = clearBgToken;
window.loadBgToken = loadBgToken;
window._setBgmUserId = _setBgmUserId;
window._getBgmUserId = _getBgmUserId;
window._getUserApiPath = _getUserApiPath;
window._fetchBgmUserInfo = _fetchBgmUserInfo;
window.showAlertDialog = showAlertDialog;
window.closeAlertDialog = closeAlertDialog;
window.shellExecuteByOAAssist = shellExecuteByOAAssist;
window.GetUrlPath = GetUrlPath;
window.showBangumiPanel = showBangumiPanel;
window.trim = trim;
window.wpsPrompt = wpsPrompt;
window.wpsMsgBox = wpsMsgBox;
window.sleep = sleep;
window.calcChecksum = calcChecksum;
