import { LOG_LEVELS, ERROR_LEVELS, ErrorLevel, type DialogOptions, type ErrorOptions, type WpsApplication, BgmError, BGMCache, BGMSheet, type BGMSync, BGMUserInfo, WpsWorksheet, WpsRange } from '../index.js';
export declare const BGM: {
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
    Message: {
        send: (data: Record<string, unknown>, targetOrigin?: string) => boolean;
    };
    showAlert: (title: string, message: string) => void;
    showConfirm: (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) => void;
    handleError: (error: unknown, options?: ErrorOptions) => BgmError;
    safeExecute: <T>(fn: () => T, context?: string, options?: ErrorOptions) => T | BgmError;
    setUserId: (id: string | null) => void;
    setUsername: (name: string | null) => void;
    notifyTokenUpdated: () => void;
    setSyncProgress: (current: number, total: number, message: string) => void;
    setSyncComplete: (results?: {
        success: number;
        fail: number;
        skip: number;
    }) => void;
    setSyncError: (error: unknown) => void;
};
/**
 * 日志函数（支持日志级别控制）
 * @param level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param message - 日志消息
 */
export declare function bgmLog(level: number, message: string | null | undefined): void;
/**
 * 获取 Application 对象（使用类型守卫）
 */
export declare function getApp(): WpsApplication | null;
/**
 * 列号转字母 (A, B, ..., Z, AA, AB, ...)
 */
export declare function colNumToLetter(col: number): string;
export declare function getCell(ws: WpsWorksheet | null | undefined, row: number, col: number): WpsRange | null;
/**
 * 获取单元格的值
 * @param ws - 工作表对象，可能为 null 或 undefined
 * @param row - 行号
 * @param col - 列号
 * @returns 单元格的字符串值；如果工作表无效或单元格不存在，则返回空字符串
 */
export declare function getCellValue(ws: WpsWorksheet | null | undefined, row: number, col: number): string;
/**
 * 读取单元格文本，兼容多种取值方式，且不依赖 Cells 方法
 * @param ws  WPS 工作表
 * @param row 行号 (1‑based)
 * @param col 列号 (1‑based)
 * @returns   单元格文本，若无法读取则返回空字符串
 */
export declare function readCell(ws: WpsWorksheet | null | undefined, row: number, col: number): string;
/**
 * 设置单元格值
 */
export declare function setCellValue(ws: WpsWorksheet | null | undefined, row: number, col: number, value: unknown): boolean;
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
export declare function _setBgmUserId(id: string): void;
/**
 * 获取 Bangumi 用户 ID（从全局缓存读取）
 * @returns 用户 ID 字符串；若未设置则返回 null
 */
export declare function _getBgmUserId(): string | null;
/**
 * 获取 Bangumi API 用户路径（格式：/-）
 * 用于拼接用户收藏请求的 URL
 * @returns 用户路径字符串 "/-"，代表当前认证用户
 * @description BGM API v0 使用 "-" 代表当前认证用户，而不是具体的用户ID
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
 * 延迟执行
 */
export declare function sleep(ms: number): void;
/**
 * 异步延迟指定的毫秒数
 * @param ms 毫秒
 * @returns Promise
 */
export declare function delay(ms: number): Promise<void>;
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
export declare function readRangeValues(ws: any, startRow: number, endRow: number, startCol: number, endCol: number): string[][];
/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export declare function cacheGet<T>(key: string, factory: () => T): T;
export declare function findHeaderRow(ws: any, startRow?: number): number;
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
export declare function getColumnMap(ws: any, headerRow: number): Map<string, number>;
/** 清除指定工作表的所有缓存 */
export declare function clearSheetCache(ws: any): void;
/**
 * 获取工作表的最后有效数据行
 * @param ws            工作表对象（WpsWorksheet）
 * @param forceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export declare function getLastRow(ws: WpsWorksheet | null | undefined, forceRefresh?: boolean, headerRow?: number): number;
export declare function isEmptyValue(val: any): boolean;
export declare function getDataSheet(): WpsWorksheet | null | undefined;
/**
 * 计算 Excel 行数据的指纹（用于增量同步比较）
 * @param fields 关键字段值数组，如 [name, type, rate, tags, comment]
 * @returns 指纹字符串
 */
export declare function calcFingerprint(fields: string[]): string;
export declare function safeActivate(ws: WpsWorksheet | null | undefined): void;
//# sourceMappingURL=util.d.ts.map