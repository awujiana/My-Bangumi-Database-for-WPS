/**
 * BGM 工具模块
 * @module util
 * @description 提供通用工具函数、常量定义、错误处理等核心功能
 */
import { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS } from './core/constants.js';
export declare const WPS_Enum: import("./core/constants.js").WPSEnum;
export { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS };
/** BGM 缓存数据结构 */
interface BGMCache {
    totalRows: number;
    userId: string | null;
    username: string | null;
    sidCache: Map<string, string>;
    listCache: unknown[];
}
/** BGM 工作表状态 */
interface BGMSheet {
    lockedIndex: number | null;
    lockedName: string | null;
    isLocked: boolean;
}
/** BGM 同步状态 */
interface BGMSync {
    isRunning: boolean;
    lastSyncTime: string | null;
}
/** BGM 用户信息 */
interface BGMUserInfo {
    id: string;
    username: string;
}
/** BGM 错误级别 */
declare enum ErrorLevel {
    SILENT = 0,
    WARN = 1,
    ERROR = 2,
    THROW = 3
}
/** BGM 错误类 */
declare class BgmError extends Error {
    code: string;
    details: Record<string, unknown>;
    timestamp: string;
    constructor(message: string, code?: string, details?: Record<string, unknown>);
    toString(): string;
}
/** 对话框选项 */
interface DialogOptions {
    onConfirm?: () => void;
    onCancel?: () => void;
    onOk?: (value: string) => void;
    defaultValue?: string;
}
/** 错误处理选项 */
interface ErrorOptions {
    level?: ErrorLevel;
    showDialog?: boolean;
    context?: string;
}
export declare const BGM: {
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
    showDialog: (title: string, message: string) => void;
    showConfirm: (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) => void;
    handleError: (error: unknown, options?: ErrorOptions) => BgmError;
    safeExecute: <T>(fn: () => T, context?: string, options?: ErrorOptions) => T | BgmError;
};
/**
 * 日志函数（支持日志级别控制）
 * @param level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param message - 日志消息
 */
export declare function bgmLog(level: number, message: string): void;
/**
 * 获取 Application 对象
 */
export declare function getApp(): unknown;
/**
 * 列号转字母 (A, B, ..., Z, AA, AB, ...)
 */
export declare function colNumToLetter(col: number): string;
/**
 * 安全获取单元格对象
 */
export declare function getCell(ws: unknown, row: number, col: number): unknown;
/**
 * 安全获取单元格值
 */
export declare function getCellValue(ws: unknown, row: number, col: number): string;
/**
 * 设置单元格值
 */
export declare function setCellValue(ws: unknown, row: number, col: number, value: unknown): boolean;
/**
 * 获取工作表对象
 */
export declare function getSheetByIndex(sheetIndex: number): unknown;
/**
 * HTML 转义（防止 XSS）
 */
export declare function escapeHtml(text: string | null | undefined): string;
/**
 * 存储 Token（加密）
 */
export declare function storeBgToken(token: string): boolean;
/**
 * 清除 Token
 */
export declare function clearBgToken(): boolean;
/**
 * 加载 Token（解密）
 */
export declare function loadBgToken(): string | null;
/**
 * 设置 BGM 用户 ID
 */
export declare function _setBgmUserId(id: string): void;
/**
 * 获取 BGM 用户 ID
 */
export declare function _getBgmUserId(): string | null;
/**
 * 获取用户 API 路径
 */
export declare function _getUserApiPath(): string;
/**
 * 获取 Bangumi 当前登录用户信息
 */
export declare function _fetchBgmUserInfo(callback?: (userInfo: BGMUserInfo | null) => void): void;
/**
 * 通过 WPS 提供的接口执行脚本
 */
export declare function shellExecuteByOAAssist(param: string): void;
/**
 * 获取 URL 路径
 */
export declare function GetUrlPath(): string;
/**
 * 显示同步面板
 */
export declare function showBangumiPanel(): void;
/**
 * 字符串去除首尾空格
 */
export declare function trim(str: string | null | undefined): string;
/**
 * 显示输入提示框
 */
export declare function wpsPrompt(message: string, defaultValue?: string): Promise<string | null>;
/**
 * 显示 WPS 消息对话框
 */
export declare function wpsMsgBox(message: string, buttons?: number, icon?: number): Promise<number>;
/**
 * 延迟执行
 */
export declare function sleep(ms: number): void;
/**
 * 显示自定义提示对话框
 */
export declare function showAlertDialog(title: string, message: string): void;
/**
 * 关闭提示对话框
 */
export declare function closeAlertDialog(): void;
