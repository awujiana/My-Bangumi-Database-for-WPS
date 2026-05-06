/**
 * BGM 工具模块
 * @module util
 * @description 提供通用工具函数、常量定义、错误处理等核心功能
 */
import { WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS } from './core/constants.js';
import { encryptToken, decryptToken, calcChecksum } from './core/crypto.js';
// ========== 导出常量（向后兼容）==========
export const WPS_Enum = WPS_ENUM;
export { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS };


/** BGM 错误类 */
export class BgmError extends Error {
    constructor(message, code = 'UNKNOWN', details = {}) {
        super(message);
        this.name = 'BgmError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
    toString() {
        return `[${this.code}] ${this.message}`;
    }
}








// 对话框适配器（自动检测环境）
const DialogAdapter = (() => {
  const w = (typeof window !== 'undefined') ? window : null;
  if (w?.BGMDialog) {
    return {
      alert: (title, msg) => w.BGMDialog.alert(title, msg),
      confirm: (msg, onConfirm, onCancel) => w.BGMDialog.confirm(msg, onConfirm, onCancel),
      error: (title, msg) => w.BGMDialog.error(title, msg),
      input: (title, prompt, defaultValue, onOk, onCancel) =>
        w.BGMDialog.input(title, prompt, defaultValue ?? '', onOk, onCancel),
      show: (type, title, msg, options) => w.BGMDialog.show(type, title, msg, options)
    };
  }
  if (w?.BGMAlert) {
    return {
      alert: (title, msg) => w.BGMAlert(msg, title),
      confirm: (msg, onConfirm, onCancel) => w.BGMConfirm(msg, '\u786E\u8BA4', onConfirm, onCancel),
      error: (title, msg) => w.BGMError(msg, title),
      input: (title, prompt, defaultValue, onOk, onCancel) =>
        w.BGMInput(title, prompt, defaultValue ?? '', onOk, onCancel),
      show: (type, title, msg, options) => {
        switch (type) {
          case 'error': w.BGMError(msg, title); break;
          case 'confirm': w.BGMConfirm(msg, '\u786E\u8BA4', options?.onConfirm, options?.onCancel); break;
          case 'input': w.BGMInput(title, msg, options?.defaultValue, options?.onOk, options?.onCancel); break;
          default: w.BGMAlert(msg, title);
        }
      }
    };
  }
  // 回退到原生
  return {
    alert: (title, msg) => w?.alert?.(msg),
    confirm: (msg, onConfirm, onCancel) => {
      if (w?.confirm?.(msg)) { onConfirm?.(); } else { onCancel?.(); }
    },
    error: (title, msg) => w?.alert?.('[\u9519\u8BEF] ' + msg),
    input: (title, prompt, defaultValue, onOk, onCancel) => {
      const result = w?.prompt?.(prompt, defaultValue);
      if (result !== null) { onOk?.(result); } else { onCancel?.(); }
    },
    show: (type, title, msg, options) => {
      switch (type) {
        case 'error': this.error(title, msg); break;
        case 'confirm': this.confirm(msg, options?.onConfirm, options?.onCancel); break;
        case 'input': this.input(title, msg, options?.defaultValue, options?.onOk, options?.onCancel); break;
        default: this.alert(title, msg);
      }
    }
  };
})();



// ========== BGM 全局命名空间 ==========
export const BGM = {
    // 在 BGM 对象定义内添加：
    PANEL_CONFIG: PANEL_CONFIG,
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
    // 错误级别枚举
    ErrorLevel: ERROR_LEVELS,
    // BGM 错误类
    BgmError: BgmError,
    // 统一对话框
    Dialog: DialogAdapter,
    // 统一消息通信
    Message: {
        send: function (data, targetOrigin) {
            try {
                if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                    const origin = targetOrigin || (typeof window !== 'undefined' ? window.location.origin : '*');
                        if (!targetOrigin && origin === '*') {
                                if (typeof bgmLog === 'function') {
                                  bgmLog(LOG_LEVELS?.WARN ?? 2, 'postMessage 使用通配符 *，存在安全风险');
                                }
                        }
                        window.parent.postMessage(data, origin);
                    return true;
                }
            }
            catch (e) {
                const err = e;
                if (typeof bgmLog === 'function') {
                    bgmLog(LOG_LEVELS?.DEBUG || 0, "postMessage \u4E0D\u53EF\u7528: " + err.message);
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
                    BGM.showDialog('\u9519\u8BEF', bgmError.message);
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
            // Cells(row, col) 形式
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
 * 安全获取单元格值（基础版，1种读取方式）
 */
export function getCellValue(ws, row, col) {
    try {
        const cell = getCell(ws, row, col);
        if (cell && cell.Value) {
            const val = cell.Value();
            return val !== null && val !== undefined ? String(val) : '';
        }
    }
    catch (e) {
        const err = e;
        bgmLog(LOG_LEVELS.WARN, "getCellValue \u5931\u8D25: " + err.message);
    }
    return "";
}
// 缓存最佳读取器，首次调用时自动探测
let bestReader = null;

function detectBestReader(ws) {
  const colLetter = colNumToLetter(1);
  const cellRef = colLetter + '1';

  // 按性能排序的候选读取方式
  const candidates = [
    {
      name: 'Range.Value2',
      test: () => ws.Range?.(cellRef)?.Value2,
      read: (r, c) => {
        const v = ws.Range(colNumToLetter(c) + r)?.Value2;
        return v != null && v !== '' ? String(v) : '';
      }
    },
    {
      name: 'Range.Value',
      test: () => {
        const cell = ws.Range?.(cellRef);
        let v = cell?.Value;
        if (typeof v === 'function') v = v();
        return v;
      },
      read: (r, c) => {
        const cell = ws.Range(colNumToLetter(c) + r);
        let v = cell?.Value;
        if (typeof v === 'function') v = v();
        return v != null && v !== '' ? String(v) : '';
      }
    },
    {
      name: 'Cells.Value2',
      test: () => ws.Cells?.(1, 1)?.Value2,
      read: (r, c) => {
        const v = ws.Cells(r, c)?.Value2;
        return v != null && v !== '' ? String(v) : '';
      }
    },
    {
      name: 'Cells.Item.Value',
      test: () => {
        const cell = ws.Cells?.Item?.(1, 1);
        let v = cell?.Value;
        if (typeof v === 'function') v = v();
        return v;
      },
      read: (r, c) => {
        const cell = ws.Cells.Item(r, c);
        let v = cell?.Value;
        if (typeof v === 'function') v = v();
        return v != null && v !== '' ? String(v) : '';
      }
    },
    {
      name: 'Cells.Value',
      test: () => {
        let v = ws.Cells?.(1, 1)?.Value;
        if (typeof v === 'function') v = v();
        return v;
      },
      read: (r, c) => {
        let v = ws.Cells(r, c)?.Value;
        if (typeof v === 'function') v = v();
        return v != null && v !== '' ? String(v) : '';
      }
    }
  ];

  for (const candidate of candidates) {
    try {
      candidate.test();
      return (rIdx, colIdx) => {
        try {
          return candidate.read(rIdx, colIdx);
        } catch {
          return '';
        }
      };
    } catch {
      continue;
    }
  }

  // 完全回退
  return (rIdx, colIdx) => {
    const cl = colNumToLetter(colIdx);
    try { const v = ws.Range(cl + rIdx)?.Value2; if (v != null && v !== '') return String(v); } catch {}
    try {
      const cell = ws.Range(cl + rIdx);
      let v = cell?.Value; if (typeof v === 'function') v = v();
      if (v != null && v !== '') return String(v);
    } catch {}
    try { const v = ws.Cells(rIdx, colIdx)?.Value2; if (v != null && v !== '') return String(v); } catch {}
    try {
      const cell = ws.Cells.Item(rIdx, colIdx);
      let v = cell?.Value; if (typeof v === 'function') v = v();
      if (v != null && v !== '') return String(v);
    } catch {}
    try {
      let v = ws.Cells(rIdx, colIdx)?.Value;
      if (typeof v === 'function') v = v();
      if (v != null && v !== '') return String(v);
    } catch {}
    return '';
  };
}




/**
 * WPS COM 兼容读取单元格值（自动选择最快方式）
 */
export function readCell(ws, row, col) {
  if (!bestReader) {
    bestReader = detectBestReader(ws);
  }
  return bestReader(ws, row, col);
}
/**
 * 设置单元格值
 */
export function setCellValue(ws, row, col, value) {
    try {
        const cell = getCell(ws, row, col);
        if (!cell) {
            console.error("setCellValue - \u65E0\u6CD5\u83B7\u53D6\u5355\u5143\u683C:", row, col);
            return false;
        }
        cell.Value = value;
        return true;
    }
    catch (e) {
        console.error("setCellValue error (\u884C:", row, "\u5217:", col, "):", e);
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
 * 获取 Bangumi 当前登录用户信息（返回 Promise）
 */
export function fetchBgmUserInfo() {
  return new Promise((resolve) => {
    const token = loadBgToken();
    if (!token) return resolve(null);

    const xhr = new XMLHttpRequest();
    xhr.open('GET', BGM_CONFIG.API_BASE + '/me', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText);
          const userId = String(data.id || data.user_id || '');
          const username = String(data.username || data.user_name || data.name || '');
          BGM.cache.userId = userId;
          BGM.cache.username = username;
          bgmLog(LOG_LEVELS.DEBUG, `fetchBgmUserInfo: userId=${userId}`);
          resolve({ id: userId, username });
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    };

    xhr.onerror = () => resolve(null);
    xhr.send();
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
            window.BGMError("\u65E0\u6CD5\u83B7\u53D6 WPS Application \u5BF9\u8C61！", "\u9519\u8BEF");
        }
        else if (typeof window !== 'undefined') {
            window.alert("\u65E0\u6CD5\u83B7\u53D6 WPS Application \u5BF9\u8C61！");
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
                const result = app.InputBox(message, "Bangumi \u8BBE\u7F6E", defaultValue || "", 2);
                if (result === false || result === null || result === undefined) {
                    resolve(null);
                    return;
                }
                resolve(String(result));
                return;
            }
            catch (e) {
                console.warn("WPS InputBox \u4E0D\u53EF\u7528:", e.message);
            }
        }
        if (typeof window !== 'undefined' && typeof window.BGMInput === 'function') {
            window.BGMInput("\u8F93\u5165", message, defaultValue || '', (value) => {
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
                console.error("prompt \u4E5F\u4E0D\u53EF\u7528:", e.message);
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
                console.warn("WPS MessageBox \u4E0D\u53EF\u7528:", e.message);
            }
        }
        if (buttons === 4) {
            if (typeof window !== 'undefined' && typeof window.BGMConfirm === 'function') {
                window.BGMConfirm(message, "\u786E\u8BA4", () => {
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
                window.BGMAlert(message, "\u63D0\u793A", () => {
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
 * 异步延迟（不阻塞 UI）
 */
export async function sleep(ms) {
  const app = getApp();
  if (app?.Wait) {
    try {
      const waitUntil = new Date(Date.now() + ms);
      app.Wait(waitUntil);
      return;
    } catch {
      // 回退到 setTimeout
    }
  }
  return new Promise(resolve => setTimeout(resolve, ms));
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
// ========== 向后兼容别名（挂载到 window）==========
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
    win.readCell = readCell;
    win.setCellValue = setCellValue;
    win.getSheetByIndex = getSheetByIndex;
    win.escapeHtml = escapeHtml;
    win.storeBgToken = storeBgToken;
    win.clearBgToken = clearBgToken;
    win.loadBgToken = loadBgToken;
    win._setBgmUserId = _setBgmUserId;
    win._getBgmUserId = _getBgmUserId;
    win._getUserApiPath = _getUserApiPath;
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
