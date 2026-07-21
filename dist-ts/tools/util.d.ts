import { LOG_LEVELS, ERROR_LEVELS, ErrorLevel, type ErrorOptions } from '../core/constants.js';
import { BgmError } from '../core/result.js';
import { type DialogOptions } from '../ui/dialog.js';
import { type WpsApplication, type WpsWorksheet, type WpsRange } from './wps.js';
import type { BGMCache, BGMSheet, BGMSync, BGMUserInfo } from '../index.js';
import { colNumToLetter, trim, escapeHtml, calcFingerprint } from './stringUtils.js';
export { colNumToLetter, trim, escapeHtml, calcFingerprint };
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
 * 设置单元格值
 */
export declare function setCellValue(ws: WpsWorksheet | null | undefined, row: number, col: number, value: unknown): boolean;
/**
 * 获取工作表对象
 */
export declare function getSheetByIndex(sheetIndex: number): unknown;
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
export declare function storeBgToken(token: string): boolean;
/**
 * 清除 Token
 */
export declare function clearBgToken(): boolean;
/**
 * 加载 Token（明文读取，自动兼容历史 XOR 加密数据）
 *
 * @description
 * - 新数据：直接返回明文 Token
 * - 历史数据：检测 `v1.` 前缀时调用 decryptToken 解密，并自动升级为明文存储
 *
 * @returns Token 字符串或 null（未存储或解密失败）
 */
export declare function loadBgToken(): string | null;
/**
 * 复制 Token 到剪贴板
 * @returns 是否复制成功
 */
export declare function copyTokenToClipboard(): boolean;
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
 * 获取 Bangumi 用户 ID（优先从内存缓存读取，回退到 PluginStorage）
 * @returns 用户 ID 字符串；若未设置则返回 null
 */
export declare function _getBgmUserId(): string | null;
/**
 * 设置 Bangumi 用户名（持久化到 PluginStorage）
 */
export declare function _setBgmUsername(name: string): void;
/**
 * 获取 Bangumi 用户名（优先从内存缓存读取，回退到 PluginStorage）
 * @returns 用户名；若未设置则返回 null
 */
export declare function _getBgmUsername(): string | null;
/**
 * 获取 Bangumi API 用户路径（格式：/-）
 * 用于拼接用户收藏请求的 URL
 * @returns 用户路径字符串 "/-"，代表当前认证用户
 * @description BGM API v0 使用 "-" 代表当前认证用户，而不是具体的用户ID
 */
export declare function _getUserApiPath(): string;
/**
 * 获取 Bangumi 当前登录用户信息
 * @param callback 回调函数，接收 userInfo 和错误类型
 *   - errorType: 'none' | 'network' | 'http' | 'parse'
 *   - network 错误通常意味着无法连接到 BGM API（如被 GFW 墙）
 */
export declare function _fetchBgmUserInfo(callback?: (userInfo: BGMUserInfo | null, errorType?: 'none' | 'network' | 'http' | 'parse') => void): void;
/**
 * 获取 Bangumi 用户信息（Promise 版本，供 handlers.js 等模块使用）
 * @returns { userInfo, errorType } - errorType 用于区分网络错误与 Token 错误
 *   - 'network': 网络错误（如被 GFW 墙、断网、DNS 失败等），Token 本身可能有效
 *   - 'http': HTTP 错误（如 401 Token 失效、500 服务器错误等）
 *   - 'parse': 响应解析失败
 *   - 'none': 无错误（成功或无 Token）
 */
export declare function fetchBgmUserInfo(): Promise<{
    userInfo: BGMUserInfo | null;
    errorType: 'none' | 'network' | 'http' | 'parse';
}>;
/**
 * 通过 WPS 提供的接口执行脚本
 */
export declare function shellExecuteByOAAssist(param: string): void;
/**
 * 获取 URL 路径
 */
export declare function getUrlPath(): string;
/**
 * 显示同步面板
 */
export declare function showBangumiPanel(): void;
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
export declare function readRangeValues(ws: WpsWorksheet | null | undefined, startRow: number, endRow: number, startCol: number, endCol: number): string[][];
/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export declare function cacheGet<T>(key: string, factory: () => T): T;
export declare function findHeaderRow(ws: WpsWorksheet | null | undefined, startRow?: number): number;
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
export declare function getColumnMap(ws: WpsWorksheet | null | undefined, headerRow: number): Map<string, number>;
/** 清除指定工作表的所有缓存 */
export declare function clearSheetCache(ws: WpsWorksheet | null | undefined): void;
/**
 * 获取工作表的最后有效数据行
 * @param ws            工作表对象（WpsWorksheet）
 * @param forceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export declare function getLastRow(ws: WpsWorksheet | null | undefined, forceRefresh?: boolean, headerRow?: number): number;
export declare function isEmptyValue(val: unknown): boolean;
export declare function getDataSheet(): WpsWorksheet | null | undefined;
export declare function safeActivate(ws: WpsWorksheet | null | undefined): void;
//# sourceMappingURL=util.d.ts.map