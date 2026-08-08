/**
 * 工具模块 - 统一导出入口
 * @module tools/util
 * @description 原 util.ts 已按职责拆分到 util/ 子目录，此文件作为聚合入口，
 *              保留 BGM 全局命名空间、bgmLog、getApp、Token 存储、用户信息、辅助函数等核心内容，
 *              并 re-export 子模块以保持外部 import 路径不变。
 *
 * 拆分结构：
 *   - util/cell.ts：单元格读取/设置（getCell、getCellValue、setCellValue、getSheetByIndex）
 *   - util/sheet.ts：工作表读取/缓存（readRangeValues、cacheGet、findHeaderRow、getColumnMap、clearSheetCache、getLastRow、isEmptyValue、getDataSheet、safeActivate）
 *   - util/sleep.ts：延时（sleep、delay）
 *   - util/index.ts：BGM 命名空间、bgmLog、getApp、Token 存储、用户 ID/用户名、辅助函数（shellExecuteByOAAssist、getUrlPath、showBangumiPanel）
 */
// 直接从源模块导入，打破 util.ts ↔ index.ts 的循环依赖
import { BGM_CONFIG, LOG_LEVELS, ERROR_LEVELS, ErrorLevel, TOKEN_CONFIG, } from '../../core/constants.js';
import { decryptToken } from '../../core/crypto.js';
import { BgmError } from '../../core/result.js';
import { showConfirm } from '../../ui/dialog.js';
import { showAlert as customShowAlert, showError as customShowError, showInput as customShowInput, } from '../../ui/dialog.js';
import { syncAllRows } from '../../ui/preview.js';
// 类型只从 index.js 导入（type-only import 不会产生运行时循环依赖）
import { BGM_EVENTS, eventBus } from '../events.js';
// 字符串工具已拆分到 stringUtils.ts，此处 import 供内部调用，并 re-export 保持向后兼容
import { logger } from '../logger.js';
import { colNumToLetter, trim, escapeHtml, calcFingerprint } from '../stringUtils.js';
// 日志模块：bgmLog 内部通过 logger 输出，自动脱敏敏感信息，且不污染全局 console
import { isWpsApp } from '../wps.js';
// re-export 字符串工具保持向后兼容
export { colNumToLetter, trim, escapeHtml, calcFingerprint };
// re-export 子模块
export { getCell, getCellValue, setCellValue, getSheetByIndex } from './cell.js';
export { readRangeValues, cacheGet, findHeaderRow, getColumnMap, clearSheetCache, getLastRow, isEmptyValue, getDataSheet, safeActivate, } from './sheet.js';
export { sleep, delay } from './sleep.js';
// ========== BGM 全局命名空间 ==========
export const BGM = {
    // 缓存数据
    cache: {
        totalRows: 0,
        userId: null,
        username: null,
        sidCache: new Map(),
        listCache: [],
    },
    // 工作表状态
    sheet: {
        lockedIndex: null,
        lockedName: null,
        isLocked: false,
    },
    // 同步状态
    sync: {
        isRunning: false,
        shouldStop: false,
        isPaused: false,
        lastSyncTime: null,
        currentRow: 0,
        currentSheet: null,
        currentCol: 0,
        /** 进入运行状态：防重复 + 重置标志 + 置位 */
        enterRunningState() {
            if (this.isRunning) {
                BGM.Dialog.alert('同步正在进行中，请稍后', '提示');
                return false;
            }
            this.resetStopFlag();
            this.isRunning = true;
            this.lastSyncTime = new Date().toISOString();
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'running' });
            return true;
        },
        /** 退出运行状态：清运行标志 + 重置停止标志 */
        exitRunningState() {
            this.isRunning = false;
            this.resetStopFlag();
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'idle' });
        },
        startSync() {
            if (this.isRunning) {
                BGM.Dialog.alert('同步正在进行中，请稍后', '提示');
                return;
            }
            this.resetStopFlag();
            BGM.Dialog.confirm('确定要开始上传同步吗？', (confirmed) => {
                if (!confirmed)
                    return;
                // 复用统一入口，确保状态一致
                if (!this.enterRunningState())
                    return;
                bgmLog(LOG_LEVELS.INFO, '开始执行同步...');
                syncAllRows()
                    .then(() => {
                    // 成功路径也清理状态，与 catch 分支对称
                    if (this.shouldStop) {
                        BGM.Dialog.alert('同步已停止', '提示');
                    }
                    this.exitRunningState();
                })
                    .catch((err) => {
                    this.exitRunningState();
                    BGM.handleError(err, { showAlert: true });
                });
            });
        },
        requestStop() {
            // 静默返回，不弹 alert
            if (!this.isRunning)
                return;
            this.shouldStop = true;
            this.isPaused = false;
            bgmLog(LOG_LEVELS.INFO, '用户请求停止同步');
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'stopped' });
        },
        pause() {
            // 增加 shouldStop 检查：已请求停止时不再允许暂停
            if (!this.isRunning || this.isPaused || this.shouldStop)
                return;
            this.isPaused = true;
            bgmLog(LOG_LEVELS.INFO, `[sync] 同步已暂停，当前行: ${this.currentRow}`);
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'paused', row: this.currentRow });
            // 定位到当前单元格
            this.locateCurrentCell();
        },
        resume() {
            if (!this.isPaused)
                return;
            this.isPaused = false;
            bgmLog(LOG_LEVELS.INFO, '[sync] 同步已恢复');
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'resumed' });
        },
        checkShouldStop() {
            return this.shouldStop;
        },
        checkPaused() {
            return this.isPaused;
        },
        /** 暂停时等待恢复，每 50ms 轮询一次 */
        async waitForResume() {
            while (this.isPaused && !this.shouldStop) {
                await new Promise((r) => setTimeout(r, 50));
            }
        },
        /** 定位到当前正在处理的单元格 */
        locateCurrentCell() {
            if (!this.currentRow || this.currentRow < 1 || !this.currentSheet)
                return;
            try {
                const ws = this.currentSheet;
                const col = this.currentCol > 0 ? this.currentCol : 1;
                const cellAddr = `${colNumToLetter(col)}${this.currentRow}`;
                const cell = ws.Range(cellAddr);
                if (cell) {
                    cell.Select();
                    bgmLog(LOG_LEVELS.INFO, `[sync] 已定位到单元格: ${cellAddr}`);
                }
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                bgmLog(LOG_LEVELS.WARN, `[sync] 定位单元格失败: ${msg}`);
            }
        },
        /** 更新当前位置（供同步循环调用，传 undefined 保留原值） */
        updatePosition(ws, row, col) {
            // 行号范围校验：必须为非负整数
            if (!Number.isInteger(row) || row < 0)
                return;
            if (ws !== undefined)
                this.currentSheet = ws;
            this.currentRow = row;
            if (col !== undefined && col > 0)
                this.currentCol = col;
        },
        resetStopFlag() {
            this.shouldStop = false;
            this.isPaused = false;
            this.currentRow = 0;
            this.currentSheet = null;
            // 同步清理列号，避免遗留状态
            this.currentCol = 0;
        },
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
            if (typeof window !== 'undefined') {
                const win = window;
                if (win.BGMDialog !== undefined && win.BGMDialog) {
                    win.BGMDialog.alert(title, message);
                    return;
                }
                if (typeof win.BGMAlert === 'function') {
                    win.BGMAlert(message, title);
                    return;
                }
            }
            // 使用自定义对话框
            customShowAlert(message, title);
        },
        confirm: function (message, callback, title) {
            showConfirm(message, callback, title);
        },
        error: function (title, message) {
            if (typeof window !== 'undefined') {
                const win = window;
                if (win.BGMDialog !== undefined && win.BGMDialog) {
                    win.BGMDialog.error(title, message);
                    return;
                }
                if (typeof win.BGMError === 'function') {
                    win.BGMError(message, title);
                    return;
                }
            }
            // 使用自定义对话框
            customShowError(message, title);
        },
        input: function (title, prompt, defaultValue, onOk, onCancel) {
            if (typeof window !== 'undefined') {
                const win = window;
                if (win.BGMDialog !== undefined && win.BGMDialog) {
                    win.BGMDialog.input(title, prompt, defaultValue || '', onOk, onCancel);
                    return;
                }
                if (typeof win.BGMInput === 'function') {
                    win.BGMInput(title, prompt, defaultValue || '', onOk, onCancel);
                    return;
                }
            }
            // 使用自定义对话框
            customShowInput(title, prompt, defaultValue, (value) => {
                if (onOk && value !== undefined)
                    onOk(value);
            }, onCancel);
        },
        show: function (type, title, message, options) {
            if (typeof window !== 'undefined') {
                const win = window;
                if (win.BGMDialog !== undefined && win.BGMDialog) {
                    win.BGMDialog.show(type, title, message, options);
                    return;
                }
            }
            {
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
        },
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
            ...options,
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
                stack: error.stack,
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
    },
    // 全局 AbortController：用于取消所有关联的 HTTP 请求
    abortController: new AbortController(),
    // 重置 AbortController：创建新实例，旧实例保持 aborted 状态
    resetAbortController() {
        this.abortController = new AbortController();
    },
};
// ========== 日志函数 ==========
/**
 * 日志函数（支持日志级别控制）
 * @param level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param message - 日志消息
 */
export function bgmLog(level, message) {
    if (level >= BGM.LOG_LEVEL) {
        const msg = message ?? '';
        // 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR（与 LOG_LEVELS 保持一致）
        // 通过 logger 输出，message 会自动经过 maskSensitiveData 脱敏
        switch (level) {
            case 0:
                logger.debug(msg);
                break;
            case 1:
                logger.info(msg);
                break;
            case 2:
                logger.warn(msg);
                break;
            case 3:
                logger.error(msg);
                break;
            default:
                logger.info(msg);
        }
    }
}
/**
 * 从调用栈中提取第一个非内部函数的名称
 * @param skipAdditional 额外跳过的帧数（备用，通常无需传）
 */
function getCallerFunctionName(_skipAdditional = 0) {
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
        const rawLine = lines[i];
        if (rawLine === undefined)
            continue;
        const line = rawLine.trim();
        const match = /at\s+([^\s(]+)/.exec(line);
        if (match) {
            const name = match[1];
            if (name !== undefined && !internalFuncs.includes(name)) {
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
// ========== Token 存储 ==========
/**
 * 存储 Token（明文存储）
 *
 * @description
 * 当前为明文存储，原因：
 * 1. 用户需要可直接复制使用 Token
 * 2. WPS PluginStorage 本身是宿主隔离的，非浏览器全局 localStorage
 * 3. 历史版本曾使用 XOR 加密，但已废弃（仅 loadBgToken 兼容旧数据）
 *
 * 不应引入 AES-GCM 等加密，因为：
 * - 加密 key 仍需存储在同一环境，无法真正提升安全性
 * - 用户明确指示保持明文以便复制使用
 *
 * @param token - Bangumi API Token
 * @returns 是否存储成功
 */
export function storeBgToken(token) {
    const app = getApp();
    if (!app?.PluginStorage)
        return false;
    app.PluginStorage.setItem('bgm_token', token);
    return true;
}
/**
 * 清除 Token
 */
export function clearBgToken() {
    const app = getApp();
    if (!app?.PluginStorage)
        return false;
    app.PluginStorage.setItem('bgm_token', '');
    return true;
}
/**
 * 加载 Token（明文读取，自动兼容历史 XOR 加密数据）
 *
 * @description
 * - 新数据：直接返回明文 Token
 * - 历史数据：检测 `v1.` 前缀时调用 decryptToken 解密，并自动升级为明文存储
 *
 * @returns Token 字符串或 null（未存储或解密失败）
 */
export function loadBgToken() {
    const app = getApp();
    if (!app?.PluginStorage)
        return null;
    const stored = app.PluginStorage.getItem('bgm_token');
    if (!stored)
        return null;
    // 兼容历史 XOR 加密数据：格式为 "{VERSION}.{ivBase64}.{encryptedBase64}"
    if (stored.startsWith(`${TOKEN_CONFIG.VERSION}.`)) {
        const decrypted = decryptToken(stored);
        if (decrypted) {
            // 自动升级为明文存储
            app.PluginStorage.setItem('bgm_token', decrypted);
            bgmLog(LOG_LEVELS.INFO, '[loadBgToken] 历史加密 Token 已升级为明文存储');
            return decrypted;
        }
        bgmLog(LOG_LEVELS.WARN, '[loadBgToken] 历史加密 Token 解密失败，视为无效');
        return null;
    }
    // 明文直接返回
    return stored;
}
/**
 * 复制 Token 到剪贴板
 * @returns 是否复制成功
 */
export function copyTokenToClipboard() {
    const token = loadBgToken();
    if (!token)
        return false;
    try {
        const textarea = document.createElement('textarea');
        textarea.value = token;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) {
            bgmLog(LOG_LEVELS.INFO, '[copyTokenToClipboard] Token 已复制到剪贴板');
        }
        else {
            bgmLog(LOG_LEVELS.WARN, '[copyTokenToClipboard] execCommand copy 失败');
        }
        return ok;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, `[copyTokenToClipboard] 复制失败: ${e.message}`);
        return false;
    }
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
    catch {
        /* 忽略 PluginStorage 读取错误 */
    }
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
    catch {
        /* 忽略 */
    }
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
 * @param callback 回调函数，接收 userInfo 和错误类型
 *   - errorType: 'none' | 'network' | 'http' | 'parse' | 'aborted'
 *   - network 错误通常意味着无法连接到 BGM API（如被 GFW 墙）
 * @param signal 可选 AbortSignal，用于取消请求
 */
export function _fetchBgmUserInfo(callback, signal) {
    const token = loadBgToken();
    if (!token) {
        if (callback)
            callback(null, 'none');
        return;
    }
    // 如果 signal 已 aborted，立即回调
    if (signal?.aborted) {
        bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] 请求被取消（signal 已 aborted）`);
        if (callback)
            callback(null, 'aborted');
        return;
    }
    const apiUrl = BGM_CONFIG.API_BASE + '/v0/me';
    bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] API 路由: ${apiUrl}`);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 15000; // 15 秒超时，便于快速感知网络问题
    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
    if (signal) {
        signal.addEventListener('abort', () => {
            xhr.abort();
        });
    }
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
                    callback({ id: userId, username: username }, 'none');
            }
            catch (e) {
                bgmLog(LOG_LEVELS.ERROR, `[_fetchBgmUserInfo] 解析响应失败: ${e.message}`);
                if (callback)
                    callback(null, 'parse');
            }
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 获取用户信息失败，HTTP 状态码: ${xhr.status}`);
            if (callback)
                callback(null, 'http');
        }
    };
    xhr.onerror = function () {
        // 如果是 abort 导致的 onerror，归类为 aborted
        if (signal?.aborted) {
            bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] 请求被取消`);
            if (callback)
                callback(null, 'aborted');
            return;
        }
        bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 网络错误：无法连接到 ${apiUrl}（可能被 GFW 墙）`);
        if (callback)
            callback(null, 'network');
    };
    xhr.ontimeout = function () {
        bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 请求超时（15s）：可能网络受限或被墙`);
        if (callback)
            callback(null, 'network');
    };
    xhr.send();
}
/**
 * 获取 Bangumi 用户信息（Promise 版本，供 handlers.js 等模块使用）
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns { userInfo, errorType } - errorType 用于区分网络错误与 Token 错误
 *   - 'network': 网络错误（如被 GFW 墙、断网、DNS 失败等），Token 本身可能有效
 *   - 'http': HTTP 错误（如 401 Token 失效、500 服务器错误等）
 *   - 'parse': 响应解析失败
 *   - 'aborted': 请求被取消
 *   - 'none': 无错误（成功或无 Token）
 */
export function fetchBgmUserInfo(signal) {
    return new Promise((resolve) => {
        _fetchBgmUserInfo((userInfo, errorType) => {
            resolve({ userInfo, errorType: errorType || 'none' });
        }, signal);
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
export function getUrlPath() {
    const app = getApp();
    const manifestPath = app?.PluginStorage?.getItem('manifest_base_path');
    if (manifestPath) {
        return manifestPath;
    }
    if (typeof window !== 'undefined' && window.location?.href) {
        const currentUrl = window.location.href;
        const lastSlash = currentUrl.lastIndexOf('/');
        return currentUrl.substring(0, lastSlash);
    }
    return '';
}
/**
 * 显示同步面板
 */
export function showBangumiPanel() {
    const app = getApp();
    if (!app) {
        const win = typeof window !== 'undefined' ? window : null;
        if (win?.BGMError) {
            win.BGMError('无法获取 WPS Application 对象！', '错误');
        }
        else {
            // 使用自定义错误对话框
            customShowError('无法获取 WPS Application 对象！', '错误');
        }
        return;
    }
    const tsId = app.PluginStorage?.getItem('taskpane_id');
    let becameVisible = false;
    if (!tsId) {
        const tskpane = app.CreateTaskPane?.(getUrlPath() + '/ui/taskpane.html');
        if (tskpane) {
            const id = tskpane.ID;
            app.PluginStorage?.setItem('taskpane_id', id);
            tskpane.Visible = true;
            becameVisible = true;
        }
    }
    else {
        const tskpane = app.GetTaskPane?.(tsId);
        if (tskpane) {
            // 切换可见性：从隐藏→显示时才触发刷新信号
            if (!tskpane.Visible) {
                becameVisible = true;
            }
            tskpane.Visible = !tskpane.Visible;
        }
    }
    // 写入"面板已显示"信号（时间戳），taskpane 轮询检测到变化后自动刷新工作表
    if (becameVisible) {
        try {
            app.PluginStorage?.setItem('bgm_panel_shown_at', String(Date.now()));
            bgmLog(LOG_LEVELS.INFO, `[showBangumiPanel] 面板已显示，已写入刷新信号`);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[showBangumiPanel] 写入面板显示信号失败: ${e.message}`);
        }
    }
}
//# sourceMappingURL=index.js.map