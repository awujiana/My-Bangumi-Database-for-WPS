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
import { LOG_LEVELS, ERROR_LEVELS, ErrorLevel, type ErrorOptions } from '../../core/constants.js';
import { BgmError } from '../../core/result.js';
import type { BGMCache, BGMSheet, BGMSync, BGMUserInfo } from '../../index.js';
import { type DialogOptions } from '../../ui/dialog.js';
import { colNumToLetter, trim, escapeHtml, calcFingerprint } from '../stringUtils.js';
import { type WpsApplication, type WpsWorksheet } from '../wps.js';
export { colNumToLetter, trim, escapeHtml, calcFingerprint };
export { getCell, getCellValue, setCellValue, getSheetByIndex } from './cell.js';
export { readRangeValues, cacheGet, findHeaderRow, getColumnMap, clearSheetCache, getLastRow, isEmptyValue, getDataSheet, safeActivate, ensureSheetHeaders, } from './sheet.js';
export { sleep, delay } from './sleep.js';
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
    /** 全局 AbortController，用于取消所有关联的 HTTP 请求 */
    abortController: AbortController;
    /** 重置 AbortController（创建新实例，用于重新发起请求） */
    resetAbortController: () => void;
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
 * 存储 Token 过期时间戳
 *
 * @param expires - Unix 时间戳（秒），来自 /oauth/token_status 接口
 */
export declare function storeTokenExpires(expires: number): void;
/**
 * 加载 Token 过期时间戳
 *
 * @returns Unix 时间戳（秒）或 null（未存储）
 */
export declare function loadTokenExpires(): number | null;
/**
 * 清除 Token 过期时间戳
 */
export declare function clearTokenExpires(): void;
/**
 * 计算 Token 剩余有效期信息
 *
 * @param expires - Unix 时间戳（秒）
 * @returns 剩余天数/小时数/状态描述，过期返回 expired 状态
 */
export declare function getTokenRemainingTime(expires: number): {
    days: number;
    hours: number;
    totalSeconds: number;
    status: 'normal' | 'warning' | 'danger' | 'expired';
    label: string;
};
/**
 * 加载 Token（明文读取）
 *
 * @returns Token 字符串或 null（未存储）
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
 *   - errorType: 'none' | 'network' | 'http' | 'parse' | 'aborted'
 *   - network 错误通常意味着无法连接到 BGM API（如被 GFW 墙）
 * @param signal 可选 AbortSignal，用于取消请求
 */
export declare function _fetchBgmUserInfo(callback?: (userInfo: BGMUserInfo | null, errorType?: 'none' | 'network' | 'http' | 'parse' | 'aborted') => void, signal?: AbortSignal): void;
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
export declare function fetchBgmUserInfo(signal?: AbortSignal): Promise<{
    userInfo: BGMUserInfo | null;
    errorType: 'none' | 'network' | 'http' | 'parse' | 'aborted';
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
//# sourceMappingURL=index.d.ts.map