import { LOG_LEVELS, ERROR_LEVELS, ErrorLevel, type DialogOptions, type ErrorOptions, type WpsApplication, BgmError } from '../index.js';
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
 * 获取 Application 对象（使用类型守卫）
 */
export declare function getApp(): WpsApplication | null;
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
 * 读取单元格文本（handle WPS Value/Value2/Text 等多种属性）
 */
export declare function readCell(ws: unknown, row: number, col: number): string;
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
 * 获取 Bangumi 用户信息（Promise 版本，供 handlers.js 等模块使用）
 */
export declare function fetchBgmUserInfo(): Promise<BGMUserInfo | null>;
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
export interface BGMSheet {
    /** 锁定的工作表索引 */
    lockedIndex: number | null;
    /** 锁定的工作表名称 */
    lockedName: string | null;
    /** 是否已锁定 */
    isLocked: boolean;
}
export interface BGMSync {
    /** 是否正在同步 */
    isRunning: boolean;
    /** 上次同步时间（ISO 格式） */
    lastSyncTime: string | null;
}
export interface BGMUserInfo {
    /** 用户 ID */
    id: string;
    /** 用户名 */
    username: string;
}
//# sourceMappingURL=util.d.ts.map