
import {  WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS,ErrorLevel, type DialogOptions, type ErrorOptions,isWpsApp, type WpsApplication,BgmError,encryptToken, decryptToken, calcChecksum} from '../index.js';

// ========== BGM 全局命名空间 ==========
export const BGM: {
    cache: BGMCache;
    sheet: BGMSheet;
    sync: BGMSync;
    LOG_LEVEL: number;
    LOG_LEVELS: typeof LOG_LEVELS;
    ERROR_LEVELS: typeof ERROR_LEVELS;
    ErrorLevel: typeof ErrorLevel;
    BgmError: typeof BgmError;
    Dialog: {
        alert: (title: string, message: string) => void;
        confirm: (message: string, onConfirm?: () => void, onCancel?: () => void) => void;
        error: (title: string, message: string) => void;
        input: (title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void) => void;
        show: (type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions) => void;
    };
    Message: {
        send: (data: Record<string, unknown>, targetOrigin?: string) => boolean;
        postMessage: (data: Record<string, unknown>, targetOrigin?: string) => boolean;
    };
    postMessage: (data: Record<string, unknown>, targetOrigin?: string) => boolean;
    showAlert: (title: string, message: string) => void;
    showConfirm: (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) => void;
    handleError: (error: unknown, options?: ErrorOptions) => BgmError;
    safeExecute: <T>(fn: () => T, context?: string, options?: ErrorOptions) => T | BgmError;
} = {
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
        lastSyncTime:  new Date().toISOString(),
   
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
        alert: function(title: string, message: string): void {
            if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).BGMDialog !== undefined) {
                (window as unknown as Record<string, { alert: (t: string, m: string) => void }>).BGMDialog!.alert(title, message);
            } else if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).BGMAlert === 'function') {
                (window as unknown as Record<string, (m: string, t: string) => void>).BGMAlert!(message, title);
            } else if (typeof window !== 'undefined') {
                window.alert(message);
            }
        },
        confirm: function(message: string, onConfirm?: () => void, onCancel?: () => void): void {
            if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).BGMDialog !== undefined) {
                (window as unknown as Record<string, { confirm: (m: string, oc?: () => void, oc2?: () => void) => void }>).BGMDialog!.confirm(message, onConfirm, onCancel);
            } else if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).BGMConfirm === 'function') {
                (window as unknown as Record<string, (m: string, t: string, oc?: () => void, oc2?: () => void) => void>).BGMConfirm!(message, '确认', onConfirm, onCancel);
            } else if (typeof window !== 'undefined') {
                if (window.confirm(message)) {
                    if (onConfirm) onConfirm();
                } else {
                    if (onCancel) onCancel();
                }
            }
        },
        error: function(title: string, message: string): void {
            if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).BGMDialog !== undefined) {
                (window as unknown as Record<string, { error: (t: string, m: string) => void }>).BGMDialog!.error(title, message);
            } else if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).BGMError === 'function') {
                (window as unknown as Record<string, (m: string, t: string) => void>).BGMError!(message, title);
            } else if (typeof window !== 'undefined') {
                window.alert('[错误] ' + message);
            }
        },
        input: function(title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void): void {
            if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).BGMDialog !== undefined) {
                (window as unknown as Record<string, { input: (t: string, p: string, d: string, oc?: (v: string) => void, oc2?: () => void) => void }>).BGMDialog!.input(title, prompt, defaultValue || '', onOk, onCancel);
            } else if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).BGMInput === 'function') {
                (window as unknown as Record<string, (t: string, p: string, d: string, oc?: (v: string) => void, oc2?: () => void) => void>).BGMInput!(title, prompt, defaultValue || '', onOk, onCancel);
            } else if (typeof window !== 'undefined') {
                const result = window.prompt(prompt, defaultValue);
                if (result !== null) {
                    if (onOk) onOk(result);
                } else {
                    if (onCancel) onCancel();
                }
            }
        },
        show: function(type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions): void {
            if (typeof window !== 'undefined' && (window as any).BGMDialog !== undefined) {
                (window as any).BGMDialog.show(type, title, message, options);
            } else {
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
        send: function(data: Record<string, unknown>, targetOrigin?: string): boolean {
            try {
                if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                    window.parent.postMessage(data, targetOrigin || "*");
                    return true;
                }
            } catch (e) {
                const err = e as Error;
                if (typeof bgmLog === 'function') {
                    bgmLog(LOG_LEVELS?.DEBUG || 0, "postMessage 不可用: " + err.message);
                }
            }
            return false;
        },
        postMessage: function(data: Record<string, unknown>, targetOrigin?: string): boolean {
            return this.send(data, targetOrigin);
        }
    },
      // 向后兼容方法
    postMessage: function(data: Record<string, unknown>, targetOrigin?: string): boolean {
        return BGM.Message.send(data, targetOrigin);
    },

    showAlert: function(title: string, message: string): void {
        if (BGM.Message.send({ type: "showAlert", title: title, message: message })) {
            return;
        }
        BGM.Dialog.alert(title, message);
    },

    showConfirm: function(title: string, message: string, onConfirm?: () => void, onCancel?: () => void): void {
        if (BGM.Message.send({ type: "showConfirm", title: title, message: message, onConfirm: true })) {
            (window as any)._bgmConfirmCallback = { confirm: onConfirm, cancel: onCancel };
            return;
        }
        BGM.Dialog.confirm(message, onConfirm, onCancel);
    },

     // 统一错误处理
    handleError: function(error: unknown, options?: ErrorOptions): BgmError {
        const opts: ErrorOptions = {
            level: ErrorLevel.ERROR,
            showAlert: false,
            context: '',
            ...options
        };

        let bgmError: BgmError;
        if (error instanceof BgmError) {
            bgmError = error;
        } else if (error instanceof Error) {
            bgmError = new BgmError(error.message, 'JS_ERROR', {
                name: error.name,
                stack: error.stack
            });
        } else {
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
    safeExecute: function<T>(fn: () => T, context?: string, options?: ErrorOptions): T | BgmError {
        try {
            return fn();
        } catch (error) {
            return BGM.handleError(error, { context, ...options } as ErrorOptions);
        }
    }
}

// ========== 日志函数 ==========
/**
 * 日志函数（支持日志级别控制）
 * @param level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param message - 日志消息
 */
export function bgmLog(level: number, message: string): void {
    if (level >= BGM.LOG_LEVEL) {
        const prefix = ['[DEBUG]', '[INFO]', '[WARN]', '[ERROR]'][level] || '[INFO]';
        console.log(prefix + ' ' + message);
    }
}


// ========== Application 获取 ==========
/**
 * 获取 Application 对象（使用类型守卫）
 */
export function getApp(): WpsApplication | null {
    if (typeof window !== 'undefined') {
        const winApp = (window as any).Application;
        if (isWpsApp(winApp)) return winApp;
    }
    // 使用 window.Application 替代裸 Application
    if (typeof window !== 'undefined') {
        const globalApp = (window as any).Application;
        if (isWpsApp(globalApp)) return globalApp;
    }
    return null;
}

// ========== 单元格操作 ==========
/**
 * 列号转字母 (A, B, ..., Z, AA, AB, ...)
 */
export function colNumToLetter(col: number): string {
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
export function getCell(ws: unknown, row: number, col: number): unknown {
    try {
        const wsObj = ws as any;
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
    } catch (e) {
        console.error("getCell error:", e);
        return null;
    }
}

/**
 * 安全获取单元格值
 */
export function getCellValue(ws: unknown, row: number, col: number): string {
    try {
        const cell = getCell(ws, row, col) as any;
        if (cell?.Value != null) {
            const val = typeof cell.Value === 'function' ? cell.Value() : cell.Value;
            return val !== null && val !== undefined ? String(val) : '';
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "getCellValue 失败: " + (e as Error).message);
    }
    return "";
}

/**
 * 读取单元格文本（handle WPS Value/Value2/Text 等多种属性）
 */
export function readCell(ws: unknown, row: number, col: number): string {
    try {
        const cell = getCell(ws, row, col) as any;
        if (!cell) return "";
        if (typeof cell.Text === 'function') return String(cell.Text());
        if (cell.Text != null) return String(cell.Text);
        if (typeof cell.Value2 === 'function') return String(cell.Value2());
        if (cell.Value2 != null) return String(cell.Value2);
        if (typeof cell.Value === 'function') return String(cell.Value());
        if (cell.Value != null) return String(cell.Value);
        return "";
    } catch {
        return "";
    }
}

/**
 * 设置单元格值
 */
export function setCellValue(ws: unknown, row: number, col: number, value: unknown): boolean {
    try {
        const cell = getCell(ws, row, col) as any;
        if (!cell) {
            console.error("setCellValue - 无法获取单元格:", row, col);
            return false;
        }
        cell.Value = value;
        return true;
    } catch (e) {
        console.error("setCellValue error:", e);
    }
    return false;
}
/**
 * 获取工作表对象
 */
export function getSheetByIndex(sheetIndex: number): unknown {
    const app = getApp() as { ActiveWorkbook?: { Sheets?: { Count: number; Item: (i: number) => unknown } } };
    if (!app?.ActiveWorkbook?.Sheets) return null;
    const sheets = app.ActiveWorkbook.Sheets;
    if (sheets.Count === 0) return null;
    return sheets.Item(sheetIndex);
}

// ========== HTML 安全 ==========
/**
 * HTML 转义（防止 XSS）
 */
export function escapeHtml(text: string | null | undefined): string {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ========== Token 存储 ==========
/**
 * 存储 Token（加密）
 */
export function storeBgToken(token: string): boolean {
    const app = getApp() as { PluginStorage?: { setItem: (key: string, value: string) => void } };
    if (!app?.PluginStorage) return false;
    app.PluginStorage.setItem("bgm_token", encryptToken(token));
    return true;
}

/**
 * 清除 Token
 */
export function clearBgToken(): boolean {
    const app = getApp() as { PluginStorage?: { setItem: (key: string, value: string) => void } };
    if (!app?.PluginStorage) return false;
    app.PluginStorage.setItem("bgm_token", "");
    return true;
}

/**
 * 加载 Token（解密）
 */
export function loadBgToken(): string | null {
    const app = getApp() as { PluginStorage?: { getItem: (key: string) => string | null } };
    if (!app?.PluginStorage) return null;
    const stored = app.PluginStorage.getItem("bgm_token");
    if (!stored) return null;
    const token = decryptToken(stored);
    if (token) return token;
    clearBgToken();
    return null;
}

// ========== 用户信息 ==========
/**
 * 设置 BGM 用户 ID
 */
export function _setBgmUserId(id: string): void { 
    BGM.cache.userId = id; 
}

/**
 * 获取 BGM 用户 ID
 */
export function _getBgmUserId(): string | null { 
    return BGM.cache.userId; 
}

/**
 * 获取用户 API 路径
 */
export function _getUserApiPath(): string { 
    return BGM.cache.userId ? String(BGM.cache.userId) : "-"; 
}

/**
 * 获取 Bangumi 当前登录用户信息
 */
export function _fetchBgmUserInfo(callback?: (userInfo: BGMUserInfo | null) => void): void {
    const token = loadBgToken();
    if (!token) {
        if (callback) callback(null);
        return;
    }
    
    const xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/me", true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    
    xhr.onload = function(): void {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText) as { id?: string | number; user_id?: string | number; username?: string; user_name?: string; name?: string };
                const userId = String(data.id || data.user_id || '');
                const username = String(data.username || data.user_name || data.name || '');
                
                BGM.cache.userId = userId;
                BGM.cache.username = username;
                bgmLog(LOG_LEVELS.DEBUG, "_fetchBgmUserInfo: userId=" + userId);
                
                if (callback) callback({ id: userId, username: username });
            } catch {
                if (callback) callback(null);
            }
        } else {
            if (callback) callback(null);
        }
    };
    
    xhr.onerror = function(): void {
        if (callback) callback(null);
    };
    
    xhr.send();
}

/**
 * 获取 Bangumi 用户信息（Promise 版本，供 handlers.js 等模块使用）
 */
export function fetchBgmUserInfo(): Promise<BGMUserInfo | null> {
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
export function shellExecuteByOAAssist(param: string): void {
    const app = getApp() as { OAAssist?: { ShellExecute: (p: string) => void } };
    if (app?.OAAssist) {
        app.OAAssist.ShellExecute(param);
    }
}

/**
 * 获取 URL 路径
 */
export function GetUrlPath(): string {
    const app = getApp() as { PluginStorage?: { getItem: (key: string) => string | null } };
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
export function showBangumiPanel(): void {
    const app = getApp() as {
        PluginStorage?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
        CreateTaskPane?: (url: string) => { ID: string; Visible: boolean };
        GetTaskPane?: (id: string) => { Visible: boolean };
    };
    if (!app) {
        if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).BGMError === 'function') {
            (window as unknown as Record<string, (m: string, t: string) => void>).BGMError("无法获取 WPS Application 对象！", "错误");
        } else if (typeof window !== 'undefined') {
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
    } else {
        const tskpane = app.GetTaskPane?.(tsId);
        if (tskpane) {
            tskpane.Visible = !tskpane.Visible;
        }
    }
}

/**
 * 字符串去除首尾空格
 */
export function trim(str: string | null | undefined): string {
    if (!str) return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}

/**
 * 延迟执行
 */
export function sleep(ms: number): void {
    try {
        const app = getApp() as { Wait?: (date: Date) => void; DoEvents?: () => void };
        if (app?.Wait) {
            const waitTime = new Date(Date.now() + ms);
            app.Wait(waitTime);
            return;
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "sleep app.Wait 失败: " + (e as Error).message);
    }
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            const app = getApp() as { DoEvents?: () => void };
            if (app?.DoEvents) app.DoEvents();
        } catch(e) {
            if (typeof bgmLog === 'function') {
                bgmLog(LOG_LEVELS?.DEBUG || 0, "sleep DoEvents 失败: " + (e as Error).message);
            }
            break;
        }
    }
}

// ===== 统一日志前缀 ==========
(function(): void {
    const _origLog = console.log;
    const _origWarn = console.warn;
    const _origError = console.error;
    console.log = function(...args: unknown[]): void {
        const argsArray = Array.from(args);
        if (argsArray.length > 0 && typeof argsArray[0] === 'string' && !argsArray[0].startsWith('[BGM]')) {
            argsArray[0] = '[BGM] ' + argsArray[0];
        }
        _origLog.apply(console, argsArray as Parameters<typeof console.log>);
    };
    console.warn = function(...args: unknown[]): void {
        const argsArray = Array.from(args);
        if (argsArray.length > 0 && typeof argsArray[0] === 'string' && !argsArray[0].startsWith('[BGM]')) {
            argsArray[0] = '[BGM] ' + argsArray[0];
        }
        _origWarn.apply(console, argsArray as Parameters<typeof console.warn>);
    };
    console.error = function(...args: unknown[]): void {
        const argsArray = Array.from(args);
        if (argsArray.length > 0 && typeof argsArray[0] === 'string' && !argsArray[0].startsWith('[BGM]')) {
            argsArray[0] = '[BGM] ' + argsArray[0];
        }
        _origError.apply(console, argsArray as Parameters<typeof console.error>);
    };
})();


// ========== BGM 缓存数据结构 ==========
export interface BGMCache {
    /** WPS 文档总行数缓存 */
    totalRows: number;
    /** 当前用户 ID */
    userId: string | null;
    /** 当前用户名 */
    username: string | null;
    /** Subject ID 缓存（sid → 行号） */
    sidCache: Map<string, string>;
    /** 列表缓存（通用数据） */
    listCache: unknown[];
}

// ========== BGM 工作表状态 ==========
export interface BGMSheet {
    /** 锁定的工作表索引 */
    lockedIndex: number | null;
    /** 锁定的工作表名称 */
    lockedName: string | null;
    /** 是否已锁定 */
    isLocked: boolean;
}

// ========== BGM 同步状态 ==========
export interface BGMSync {
    /** 是否正在同步 */
    isRunning: boolean;
    /** 上次同步时间（ISO 格式） */
    lastSyncTime: string | null;
}

// ========== BGM 用户信息 ==========
export interface BGMUserInfo {
    /** 用户 ID */
    id: string;
    /** 用户名 */
    username: string;
}
