
// 直接从源模块导入，打破 util.ts ↔ index.ts 的循环依赖
import {
    BGM_CONFIG,
    LOG_LEVELS,
    ERROR_LEVELS,
    PANEL_CONFIG,
    COLUMN_RULES,
    HEADER_KEYWORDS,
    ErrorLevel,
    type ErrorOptions,
} from '../core/constants.js';
import { BgmError } from '../core/result.js';
import { decryptToken } from '../core/crypto.js';
import { showConfirm, type DialogOptions } from '../ui/dialog.js';
import { showAlert as customShowAlert, showError as customShowError, showInput as customShowInput } from '../ui/dialog.js';
import { isWpsApp, type WpsApplication, type WpsWorksheet, type WpsRange } from './wps.js';
import { syncAllRows } from '../ui/preview.js';
// 类型只从 index.js 导入（type-only import 不会产生运行时循环依赖）
import type { BGMCache, BGMSheet, BGMSync, BGMUserInfo } from '../index.js';
import { BGM_EVENTS, eventBus } from './events.js';
// 字符串工具已拆分到 stringUtils.ts，此处 import 供内部调用，并 re-export 保持向后兼容
import { colNumToLetter, trim, escapeHtml, calcFingerprint } from './stringUtils.js';
export { colNumToLetter, trim, escapeHtml, calcFingerprint };

// ========== BGM 全局窗口扩展接口 ==========
interface BgmWindowGlobals {
    Application?: unknown;
    BGMDialog?: {
        alert(title: string, message: string): void;
        error(title: string, message: string): void;
        input(title: string, prompt: string, defaultValue: string, onOk?: (value: string) => void, onCancel?: () => void): void;
        show(type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions): void;
    };
    BGMAlert?(message: string, title: string, callback?: () => void): void;
    BGMError?(message: string, title: string): void;
    BGMInput?(title: string, prompt: string, defaultValue: string, onOk?: (value: string) => void, onCancel?: () => void): void;
}

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
    dataPreview?: {
        ws: WpsWorksheet | null | undefined;
        visibleRows: number[];
        headerRow: number;
        dataStartRow: number;
        previewColStart: number;
        previewColEnd: number;
        columnCount: number;
        headerNames: string[];
        isImportant: boolean[];
    };
     Dialog: {
        alert: (title: string, message: string) => void;
        confirm: (message: string, callback: (confirmed: boolean) => void, title?: string) => void;
        error: (title: string, message: string) => void;
        input: (title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void) => void;
        show: (type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions) => void;
    };
   
    showAlert: (title: string, message: string) => void;
    showConfirm: (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) => void;
    handleError: (error: unknown, options?: ErrorOptions) => BgmError;
    safeExecute: <T>(fn: () => T, context?: string, options?: ErrorOptions) => T | BgmError;

    setUserId: (id: string | null) => void;
    setUsername: (name: string | null) => void;
    notifyTokenUpdated: () => void;
    setSyncProgress: (current: number, total: number, message: string) => void;
    setSyncComplete: (results?: { success: number; fail: number; skip: number }) => void;
    setSyncError: (error: unknown) => void;

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
        shouldStop: false,
        isPaused: false,
        lastSyncTime: null,
        currentRow: 0,
        currentSheet: null as WpsWorksheet | null,
        currentCol: 0,

        /** 进入运行状态：防重复 + 重置标志 + 置位 */
        enterRunningState(): boolean {
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
        exitRunningState(): void {
            this.isRunning = false;
            this.resetStopFlag();
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'idle' });
        },

        startSync(): void {
            if (this.isRunning) {
                BGM.Dialog.alert('同步正在进行中，请稍后', '提示');
                return;
            }
            this.resetStopFlag();
            BGM.Dialog.confirm('确定要开始全面同步吗？', (confirmed: boolean) => {
                if (!confirmed) return;
                // 复用统一入口，确保状态一致
                if (!this.enterRunningState()) return;
                bgmLog(LOG_LEVELS.INFO, '开始执行同步...');
                syncAllRows()
                    .then(() => {
                        // 成功路径也清理状态，与 catch 分支对称
                        if (this.shouldStop) {
                            BGM.Dialog.alert('同步已停止', '提示');
                        }
                        this.exitRunningState();
                    })
                    .catch((err: unknown) => {
                        this.exitRunningState();
                        BGM.handleError(err, { showAlert: true });
                    });
            });
        },

        requestStop(): void {
            // 静默返回，不弹 alert
            if (!this.isRunning) return;
            this.shouldStop = true;
            this.isPaused = false;
            bgmLog(LOG_LEVELS.INFO, '用户请求停止同步');
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'stopped' });
        },

        pause(): void {
            // 增加 shouldStop 检查：已请求停止时不再允许暂停
            if (!this.isRunning || this.isPaused || this.shouldStop) return;
            this.isPaused = true;
            bgmLog(LOG_LEVELS.INFO, `[sync] 同步已暂停，当前行: ${this.currentRow}`);
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'paused', row: this.currentRow });
            // 定位到当前单元格
            this.locateCurrentCell();
        },

        resume(): void {
            if (!this.isPaused) return;
            this.isPaused = false;
            bgmLog(LOG_LEVELS.INFO, '[sync] 同步已恢复');
            eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'resumed' });
        },

        checkShouldStop(): boolean {
            return this.shouldStop;
        },

        checkPaused(): boolean {
            return this.isPaused;
        },

        /** 暂停时等待恢复，每 50ms 轮询一次 */
        async waitForResume(): Promise<void> {
            while (this.isPaused && !this.shouldStop) {
                await new Promise(r => setTimeout(r, 50));
            }
        },

        /** 定位到当前正在处理的单元格 */
        locateCurrentCell(): void {
            if (!this.currentRow || this.currentRow < 1 || !this.currentSheet) return;
            try {
                const ws = this.currentSheet;
                const col = this.currentCol > 0 ? this.currentCol : 1;
                const cellAddr = `${colNumToLetter(col)}${this.currentRow}`;
                const cell = ws.Range(cellAddr);
                if (cell) {
                    cell.Select();
                    bgmLog(LOG_LEVELS.INFO, `[sync] 已定位到单元格: ${cellAddr}`);
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                bgmLog(LOG_LEVELS.WARN, `[sync] 定位单元格失败: ${msg}`);
            }
        },

        /** 更新当前位置（供同步循环调用，传 undefined 保留原值） */
        updatePosition(ws: WpsWorksheet | null | undefined, row: number, col?: number): void {
            // 行号范围校验：必须为非负整数
            if (!Number.isInteger(row) || row < 0) return;
            if (ws !== undefined) this.currentSheet = ws;
            this.currentRow = row;
            if (col !== undefined && col > 0) this.currentCol = col;
        },

        resetStopFlag(): void {
            this.shouldStop = false;
            this.isPaused = false;
            this.currentRow = 0;
            this.currentSheet = null;
            // 同步清理列号，避免遗留状态
            this.currentCol = 0;
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
        alert: function(title: string, message: string): void {
            if (typeof window !== 'undefined') {
                const win = window as unknown as BgmWindowGlobals;
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
        confirm: function(message: string, callback: (confirmed: boolean) => void, title?: string): void {
            showConfirm(message, callback, title);
        },
        error: function(title: string, message: string): void {
            if (typeof window !== 'undefined') {
                const win = window as unknown as BgmWindowGlobals;
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
        input: function(title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void): void {
            if (typeof window !== 'undefined') {
                const win = window as unknown as BgmWindowGlobals;
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
                if (onOk && value !== undefined) onOk(value);
            }, onCancel);
        },
       show: function(type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions): void {
            if (typeof window !== 'undefined') {
                const win = window as unknown as BgmWindowGlobals;
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
                            if (confirmed) options?.onOk?.();
                            else options?.onCancel?.();
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
    
    showAlert: function(title: string, message: string): void {
        BGM.Dialog.alert(title, message);
    },
    
    showConfirm: function(title: string, message: string, onConfirm?: () => void, onCancel?: () => void): void {
           BGM.Dialog.confirm(message, (confirmed: boolean) => {
               if (confirmed) {
                   onConfirm?.();
               } else {
                   onCancel?.();
               }
           }, title);
    },
 

     // 统一错误处理
    handleError: function(error: unknown, options?: ErrorOptions): BgmError {
        const opts: ErrorOptions = {
            level: ErrorLevel.ERROR,
            showAlert: false,
            context: '',
            ...options
        };
             // ✅ 自动获取调用函数名（如果 context 未手动指定）
        if (!opts.context) {
            opts.context = getCallerFunctionName();
        }
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
    },
    setUserId(id: string | null) {
        if (id) {
            _setBgmUserId(id);
        } else {
            this.cache.userId = null;
            eventBus.emit(BGM_EVENTS.USER_ID_UPDATED);
        }
    },
    setUsername(name: string | null) {
        if (name) {
            _setBgmUsername(name);
        } else {
            this.cache.username = null;
            eventBus.emit(BGM_EVENTS.USER_NAME_UPDATED);
        }
    },
    notifyTokenUpdated() {
        eventBus.emit(BGM_EVENTS.TOKEN_UPDATED);
    },
    // 同步进度更新
    setSyncProgress(current: number, total: number, message: string) {
        eventBus.emit(BGM_EVENTS.SYNC_PROGRESS, { current, total, message });
    },
    // 同步完成，结果可选（成功/失败/跳过数量）
    setSyncComplete(results?: unknown) {
        eventBus.emit(BGM_EVENTS.SYNC_COMPLETED, results);
    },
    // 同步错误更新
    setSyncError(error: unknown) {
        eventBus.emit(BGM_EVENTS.SYNC_ERROR, error);
    }

};

// ========== 日志函数 ==========
/**
 * 日志函数（支持日志级别控制）
 * @param level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param message - 日志消息
 */

export function bgmLog(level: number, message: string | null | undefined): void {
    if (level >= BGM.LOG_LEVEL) {
        const prefixes: string[] = ['[DEBUG]', '[INFO]', '[WARN]', '[ERROR]'];
        const prefix = prefixes[level] ?? '[INFO]';
        console.log(prefix + ' ' + (message ?? ''));
    }
}
/**
 * 从调用栈中提取第一个非内部函数的名称
 * @param skipAdditional 额外跳过的帧数（备用，通常无需传）
 */
function getCallerFunctionName(skipAdditional = 0): string {
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
export function getApp(): WpsApplication | null {
    if (typeof window !== 'undefined') {
        const winApp = (window as unknown as BgmWindowGlobals).Application;
        if (isWpsApp(winApp)) return winApp;
    }
    // 使用 window.Application 替代裸 Application
    if (typeof window !== 'undefined') {
        const globalApp = (window as unknown as BgmWindowGlobals).Application;
        if (isWpsApp(globalApp)) return globalApp;
    }
    return null;
}

// ========== 单元格操作 ==========
export function getCell(
                    ws: WpsWorksheet | null | undefined,
                    row: number,
                    col: number
                ): WpsRange | null {
                    if (!ws) return null;
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
function tryGetProperty(cell: unknown, prop: string): unknown {
    if (cell == null || typeof cell !== 'object') return undefined;
    const obj = cell as Record<string, unknown>;
    if (!(prop in obj)) return undefined;
    try {
        const val = obj[prop];
        if (typeof val === 'function') {
            try {
                const result = (val as () => unknown)();
                if (typeof result === 'function' && result.toString().includes('[native code]')) {
                    return undefined;
                }
                return result;
            } catch { return undefined; }
        }
        if (val && typeof val === 'object') {
            const valObj = val as { toString?: () => string };
            if (typeof valObj.toString === 'function') {
                const str = valObj.toString();
                if (str.includes('function') || str.includes('[native code]')) {
                    return undefined;
                }
            }
        }
        return val;
    } catch {
        return undefined;
    }
}
//内部辅助函数，不导出
/**
 * 获取单元格的原始值，按优先级尝试 Value2、Value 和 Text 属性
 * @param cell - 单元格对象
 * @returns 单元格的原始值；如果单元格无效或没有值，则返回 null
 */
function getCellRawValue(cell: WpsRange | null | undefined): unknown {
    if (!cell) return null;
    const val2 = tryGetProperty(cell, 'Value2');
    if (val2 !== undefined && val2 !== null) return val2;
    const val = tryGetProperty(cell, 'Value');
    if (val !== undefined && val !== null) return val;
    const text = tryGetProperty(cell, 'Text');
    if (text !== undefined && text !== null) return text;
    return null;
}

/**
 * 获取单元格的值
 * @param ws - 工作表对象，可能为 null 或 undefined
 * @param row - 行号
 * @param col - 列号
 * @returns 单元格的字符串值；如果工作表无效或单元格不存在，则返回空字符串
 */
export function getCellValue(
    ws: WpsWorksheet | null | undefined,
    row: number,
    col: number
): string {
    if (!ws) return '';
    try {
        const address = colNumToLetter(col) + row;
        const cell = ws.Range(address);
        if (!cell) return '';
        const raw = getCellRawValue(cell);
        return raw != null ? String(raw) : '';
    } catch {
        return '';
    }
}


/**
 * 设置单元格值
 */
export function setCellValue(ws: WpsWorksheet | null | undefined, row: number, col: number, value: unknown): boolean {
    try {
        const cell = getCell(ws, row, col);
        if (!cell) {
            bgmLog(LOG_LEVELS.ERROR, `setCellValue - 无法获取单元格: (${row}, ${col})`);
            return false;
        }
        cell.Value2 = value as import('./wps.js').WpsCellValue;
        return true;
    } catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.ERROR, context: 'setCellValue' });
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

// ========== Token 存储 ==========
/**
 * 存储 Token（明文存储，便于用户复制使用）
 */
export function storeBgToken(token: string): boolean {
    const app = getApp() as { PluginStorage?: { setItem: (key: string, value: string) => void } };
    if (!app?.PluginStorage) return false;
    app.PluginStorage.setItem("bgm_token", token);
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
 * 加载 Token（明文读取，自动兼容历史 XOR 加密数据）
 */
export function loadBgToken(): string | null {
    const app = getApp() as { PluginStorage?: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } };
    if (!app?.PluginStorage) return null;
    const stored = app.PluginStorage.getItem("bgm_token");
    if (!stored) return null;
    // 兼容历史 XOR 加密数据：若格式为 "v1.iv.payload"，尝试解密
    if (stored.startsWith("v1.")) {
        const decrypted = decryptToken(stored);
        if (decrypted) {
            // 升级为明文存储
            app.PluginStorage.setItem("bgm_token", decrypted);
            return decrypted;
        }
        clearBgToken();
        return null;
    }
    // 明文直接返回
    return stored;
}

/**
 * 复制 Token 到剪贴板
 * @returns 是否复制成功
 */
export function copyTokenToClipboard(): boolean {
    const token = loadBgToken();
    if (!token) return false;
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
        } else {
            bgmLog(LOG_LEVELS.WARN, '[copyTokenToClipboard] execCommand copy 失败');
        }
        return ok;
    } catch (e: unknown) {
        bgmLog(LOG_LEVELS.ERROR, `[copyTokenToClipboard] 复制失败: ${(e as Error).message}`);
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
export function _setBgmUserId(id: string): void {
    if (!id || id.trim() === '') return;
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
export function _getBgmUserId(): string | null {
    if (BGM.cache.userId) return BGM.cache.userId;
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
    } catch (e) { /* 忽略 PluginStorage 读取错误 */ }
    return null;
}

/**
 * 设置 Bangumi 用户名（持久化到 PluginStorage）
 */
export function _setBgmUsername(name: string): void {
    if (!name || name.trim() === '') return;
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
export function _getBgmUsername(): string | null {
    if (BGM.cache.username) return BGM.cache.username;
    try {
        const app = getApp();
        if (app?.PluginStorage) {
            const stored = app.PluginStorage.getItem('bgm_username');
            if (stored) {
                BGM.cache.username = stored;
                return stored;
            }
        }
    } catch (e) { /* 忽略 */ }
    return null;
}

/**
 * 获取 Bangumi API 用户路径（格式：/-）
 * 用于拼接用户收藏请求的 URL
 * @returns 用户路径字符串 "/-"，代表当前认证用户
 * @description BGM API v0 使用 "-" 代表当前认证用户，而不是具体的用户ID
 */
export function _getUserApiPath(): string {
    // BGM API v0 使用 "-" 代表当前认证用户
    return '/-';
}

/**
 * 获取 Bangumi 当前登录用户信息
 * @param callback 回调函数，接收 userInfo 和错误类型
 *   - errorType: 'none' | 'network' | 'http' | 'parse'
 *   - network 错误通常意味着无法连接到 BGM API（如被 GFW 墙）
 */
export function _fetchBgmUserInfo(
    callback?: (userInfo: BGMUserInfo | null, errorType?: 'none' | 'network' | 'http' | 'parse') => void
): void {
    const token = loadBgToken();
    if (!token) {
        if (callback) callback(null, 'none');
        return;
    }
    
    const apiUrl = BGM_CONFIG.API_BASE + "/v0/me";
    bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] API 路由: ${apiUrl}`);
    
    const xhr = new XMLHttpRequest();
    xhr.open("GET", apiUrl, true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 15000; // 15 秒超时，便于快速感知网络问题
    
    xhr.onload = function(): void {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText) as { id?: string | number; user_id?: string | number; username?: string; user_name?: string; name?: string; nickname?: string };
                const userId = String(data.id || data.user_id || '');
                // BGM API v0 返回的用户名字段是 nickname，username 是用户ID
                const username = String(data.nickname || data.username || data.user_name || data.name || '');
                
                _setBgmUserId(userId);
                _setBgmUsername(username);
                bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] 获取用户信息成功: userId=${userId}, username=${username}`);
                
                if (callback) callback({ id: userId, username: username }, 'none');
            } catch (e: unknown) {
                bgmLog(LOG_LEVELS.ERROR, `[_fetchBgmUserInfo] 解析响应失败: ${(e as Error).message}`);
                if (callback) callback(null, 'parse');
            }
        } else {
            bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 获取用户信息失败，HTTP 状态码: ${xhr.status}`);
            if (callback) callback(null, 'http');
        }
    };
    
    xhr.onerror = function(): void {
        bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 网络错误：无法连接到 ${apiUrl}（可能被 GFW 墙）`);
        if (callback) callback(null, 'network');
    };

    xhr.ontimeout = function(): void {
        bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 请求超时（15s）：可能网络受限或被墙`);
        if (callback) callback(null, 'network');
    };
    
    xhr.send();
}
/**
 * 获取 Bangumi 用户信息（Promise 版本，供 handlers.js 等模块使用）
 * @returns { userInfo, errorType } - errorType 用于区分网络错误与 Token 错误
 *   - 'network': 网络错误（如被 GFW 墙、断网、DNS 失败等），Token 本身可能有效
 *   - 'http': HTTP 错误（如 401 Token 失效、500 服务器错误等）
 *   - 'parse': 响应解析失败
 *   - 'none': 无错误（成功或无 Token）
 */
export function fetchBgmUserInfo(): Promise<{ userInfo: BGMUserInfo | null; errorType: 'none' | 'network' | 'http' | 'parse' }> {
    return new Promise((resolve) => {
        _fetchBgmUserInfo((userInfo, errorType) => {
            resolve({ userInfo, errorType: errorType || 'none' });
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
export function getUrlPath(): string {
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
        } else {
            // 使用自定义错误对话框
            customShowError("无法获取 WPS Application 对象！", "错误");
        }
        return;
    }
    const tsId = app.PluginStorage?.getItem("taskpane_id");
    let becameVisible = false;
    if (!tsId) {
        const tskpane = app.CreateTaskPane?.(getUrlPath() + "/ui/taskpane.html");
        if (tskpane) {
            const id = tskpane.ID;
            app.PluginStorage?.setItem("taskpane_id", id);
            tskpane.Visible = true;
            becameVisible = true;
        }
    } else {
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
            app.PluginStorage?.setItem("bgm_panel_shown_at", String(Date.now()));
            bgmLog(LOG_LEVELS.INFO, `[showBangumiPanel] 面板已显示，已写入刷新信号`);
        } catch (e: unknown) {
            bgmLog(LOG_LEVELS.WARN, `[showBangumiPanel] 写入面板显示信号失败: ${(e as Error).message}`);
        }
    }
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
                bgmLog(LOG_LEVELS.INFO, "sleep DoEvents 失败: " + (e as Error).message);
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




/**
 * 异步延迟指定的毫秒数
 * @param ms 毫秒
 * @returns Promise
 */
export function delay(ms: number): Promise<void> {
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
function isNativeCode(val: unknown): boolean {
    if (typeof val === 'function') {
        const str = val.toString();
        return str.includes('[native code]') || str.includes('function Value()');
    }
    if (val && typeof val === 'object') {
        const obj = val as { toString?: () => string };
        if (typeof obj.toString === 'function') {
            const str = obj.toString();
            return str.includes('[native code]') || str.includes('function Value()');
        }
    }
    return false;
}

function safeCellValue(cell: unknown): string {
    if (cell == null) return '';
    if (isNativeCode(cell)) return '';
    if (typeof cell === 'function') {
        try {
            const result = (cell as () => unknown)();
            if (isNativeCode(result)) return '';
            return result == null ? '' : String(result);
        } catch { return ''; }
    }
    if (cell && typeof cell === 'object') {
        const obj = cell as { toString?: () => string };
        if (obj.toString) {
            const str = obj.toString();
            if (isNativeCode(str) || isNativeCode(cell)) return '';
            return str;
        }
    }
    return String(cell);
}

export function readRangeValues(
    ws: WpsWorksheet | null | undefined,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number
): string[][] {
    if (!ws) return [];
    try {
        const range = ws.Range(`${colNumToLetter(startCol)}${startRow}:${colNumToLetter(endCol)}${endRow}`);
        const raw = tryGetProperty(range, 'Value2');
        if (!raw) return [];
        // 处理单个值的情况
        if (!Array.isArray(raw)) {
            return [[safeCellValue(raw)]];
        }
        const result: string[][] = [];
        for (const row of raw) {
            if (!Array.isArray(row)) {
                result.push([safeCellValue(row)]);
            } else {
                result.push(row.map((cell: unknown) => safeCellValue(cell)));
            }
        }
        return result;
    } catch (e) {
        return [];
    }
}
// 缓存相关（放在文件顶部，导入之后）
const sheetCache = new Map<string, unknown>();

/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export function cacheGet<T>(key: string, factory: () => T): T {
    if (sheetCache.has(key)) {
        return sheetCache.get(key) as T;
    }
    const value = factory();
    sheetCache.set(key, value);
    return value;
}
export function findHeaderRow(ws: WpsWorksheet | null | undefined, startRow?: number): number {
    const sheetName = ws?.Name || '';
    const cacheKey = `${sheetName}:headerRow:${startRow || 1}`;
    return cacheGet(cacheKey, () => {
        let sRow = startRow || 1;
        for (let row = sRow; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row++) {
            let matchCount = 0;
            for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col++) {
                try {
                    let cellVal = String(getCellValue(ws, row, col)).toLowerCase();
                    if (!cellVal) continue;
                    for (let header of HEADER_KEYWORDS) {
                        if (cellVal.indexOf(header.toLowerCase()) >= 0) {
                            matchCount++;
                            break;
                        }
                    }
                    if (matchCount >= 3) break;
                } catch (e) {}
            }
            if (matchCount >= 3) return row;
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
export function getColumnMap(ws: WpsWorksheet | null | undefined, headerRow: number): Map<string, number> {
    const sheetName = ws?.Name || '';
    const cacheKey = `${sheetName}:columnMap:${headerRow}`;
    return cacheGet(cacheKey, () => {
        const colMap = new Map<string, number>();
        let firstNonEmptyCol: number | undefined;

        const lastCol = 50;
        for (let i = 1; i <= lastCol; i++) {
            const colName = trim(String(getCellValue(ws, headerRow, i)));
            // 记录第一个非空列作为序列号列候选
            if (!firstNonEmptyCol && colName) {
                firstNonEmptyCol = i;
            }
            if (!colName) continue;
            for (const [pattern, key] of COLUMN_RULES) {
                if (pattern.test(colName)) {
                    if (!colMap.has(key)) {
                        colMap.set(key, i);
                        break;  // 匹配到未映射的key，处理下一列
                    }
                    // 该key已被前面的列匹配，继续尝试其他规则
                }
            }
        }

        // 如果没有通过规则匹配到序列号列，尝试找一个未被其他 key 占用的列
        // 修复：避免将"序列号"映射到已被"是否看完"等字段占用的列，导致两个字段读取同一列
        if (!colMap.has('序列号')) {
            const mappedCols = new Set(colMap.values());
            let seqCol: number | undefined;
            if (firstNonEmptyCol && !mappedCols.has(firstNonEmptyCol)) {
                // 第一个非空列未被占用，使用它
                seqCol = firstNonEmptyCol;
            } else {
                // 第一个非空列已被占用，向后查找第一个未被占用的非空列
                for (let i = 1; i <= lastCol; i++) {
                    if (!mappedCols.has(i)) {
                        const v = trim(String(getCellValue(ws, headerRow, i)));
                        if (v) {
                            seqCol = i;
                            break;
                        }
                    }
                }
            }
            if (seqCol) {
                colMap.set('序列号', seqCol);
                bgmLog(LOG_LEVELS.INFO, `[getColumnMap] 序列号列未匹配到表头，使用列 ${seqCol} 作为序列号列`);
            }
        }

        return colMap;
    });
}
/** 清除指定工作表的所有缓存 */
export function clearSheetCache(ws: WpsWorksheet | null | undefined): void {
    const prefix = ws?.Name || '';
    for (const key of sheetCache.keys()) {
        if (key.startsWith(prefix)) sheetCache.delete(key);
    }
}


/**
 * 在表头行中查找第一个匹配「序列号 / Bangumi URL / 名称 / 别名」的列索引
 * @param ws           工作表
 * @param headerRow 表头行号
 * @returns 列索引（1‑based），若未找到返回 undefined
 */
function findAnchorColumn(ws: WpsWorksheet, headerRow: number): number | undefined {
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
        if (val == null) continue;
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
export function getLastRow(
    ws: WpsWorksheet | null | undefined,
    forceRefresh: boolean = false,
    headerRow?: number
): number {
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

    const cached = cacheGet<number>(cacheKey, () => {
        bgmLog(LOG_LEVELS.INFO,
            `正在计算工作表 "${sheetName}" 的最后数据行（${headerRow ? '根据表头自动选择列' : '多列回退'}）...`
        );

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
                        bgmLog(LOG_LEVELS.INFO,
                            `根据表头找到锚定列 ${col}(${colLetter})，最后行: ${endCell.Row}`
                        );
                        return endCell.Row;
                    }
                } catch (e) {
                    bgmLog(LOG_LEVELS.WARN,
                        `锚定列 ${col} 定位失败: ${(e as Error).message}，回退到原有逻辑`
                    );
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
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, `D列定位失败: ${(e as Error).message}`);
        }

        // 3. 尝试 A 列
        try {
            const cell = ws.Range(`A${ws.Rows.Count}`);
            const endCell = cell.End(-4162);
            if (endCell && endCell.Row > 0) {
                bgmLog(LOG_LEVELS.INFO, `A列向上定位成功，最后行: ${endCell.Row}`);
                return endCell.Row;
            }
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, `A列定位失败: ${(e as Error).message}`);
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
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, `UsedRange 失败: ${(e as Error).message}`);
        }

        // 5. 最终默认值
        bgmLog(LOG_LEVELS.WARN, `无法确定工作表 "${sheetName}" 的最后行，使用默认值 50000`);
        return 50000;
    });

    bgmLog(LOG_LEVELS.INFO,
        `工作表 "${sheetName}" 最后数据行: ${cached}${sheetCache.has(cacheKey) ? ' (来自缓存)' : ' (首次计算)'}`
    );
    return cached;
}


export function isEmptyValue(val: unknown): boolean {
  return val === null || val === undefined || val === "" ||
         val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}

// ========== 获取数据工作表 ==========
export function getDataSheet(): WpsWorksheet | null | undefined {
  let app = getApp();
  if (!app || !app.ActiveWorkbook) return null;

  bgmLog(LOG_LEVELS.INFO, `getDataSheet: isLocked=${BGM.sheet.isLocked}, lockedIndex=${BGM.sheet.lockedIndex}`);

  if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
    try {
      const ws = app.ActiveWorkbook.Worksheets.Item(BGM.sheet.lockedIndex);
      bgmLog(LOG_LEVELS.INFO, `getDataSheet: 返回锁定的工作表: ${ws.Name}`);
      return ws;
    } catch (e: unknown) {
      bgmLog(LOG_LEVELS.WARN, "getDataSheet 锁定工作表失败: " + (e as Error).message);
    }
  }

  const ws = app.ActiveWorkbook.ActiveSheet;
  bgmLog(LOG_LEVELS.INFO, `getDataSheet: 返回当前活动工作表: ${ws.Name}`);
  return ws;
}

export function safeActivate(ws: WpsWorksheet | null | undefined): void {
    if (ws && typeof ws.Activate === 'function') {
        ws.Activate();
    } else {
        bgmLog(LOG_LEVELS.WARN, 'safeActivate: 无法激活工作表');
    }
}