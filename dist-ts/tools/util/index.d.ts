/**
 * 工具模块 - 统一导出入口
 * @module tools/util
 * @description 原 utility.ts 已按职责拆分到 util/ 子目录，此文件作为聚合入口，
 *              保留 BGM 全局命名空间、bgmLog、getApp、Token 存储、用户信息、辅助函数等核心内容，
 *              并 re-export 子模块以保持外部 import 路径不变。
 *
 * 拆分结构：
 *   - util/cell.ts：单元格读取/设置（getCell、getCellValue、setCellValue、getSheetByIndex）
 *   - util/sheet.ts：工作表读取/缓存（readRangeValues、cacheGet、findHeaderRow、getColumnMap、clearSheetCache、getLastRow、isEmptyValue、getDataSheet、safeActivate）
 *   - util/field-getter.ts：批量字段访问器（矩形读 + 逐格回退）与同步行指纹
 *   - util/sleep.ts：延时（sleep、delay）
 *   - util/index.ts：BGM 命名空间、bgmLog、getApp、Token 存储、用户 ID/用户名、辅助函数（shellExecuteByOAAssist、getUrlPath、showBangumiPanel）
 */
import { LOG_LEVELS, ERROR_LEVELS, ErrorLevel } from '../../core/constants.js';
import type { ErrorOptions } from '../../core/constants.js';
import { BgmError } from '../../core/result.js';
import type { BGMCache, BGMSheet, BGMSync, BGMUserInfo } from '../../core/types.js';
import type { DialogOptions } from '../../ui/dialog.js';
import type { WpsApp, WpsWorksheet } from '../wps.js';
export { getCell, getCellValue, setCellValue, getSheetByIndex } from './cell.js';
export { readRowsCache, createSheetCellCache, type SheetCellCache, readRangeValues, readRangeCellValues, cacheGet, findHeaderRow, getColumnMap, clearSheetCache, getLastRow, isEmptyValue, getDataSheet, safeActivate, ensureSheetHeaders, } from './sheet.js';
export { fetchBgmMe } from './bgm-me.js';
export { createBatchFieldGetter, calcSyncRowFingerprint, type FieldGetter } from './field-getter.js';
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
        worksheet: WpsWorksheet | null | undefined;
        visibleRows: number[];
        headerRow: number;
        dataStartRow: number;
        previewColumnStart: number;
        previewColumnEnd: number;
        columnCount: number;
        headerNames: string[];
        isImportant: boolean[];
    };
    Dialog: {
        alert: (title: string, message: string) => void;
        confirm: (message: string, callback: (isConfirmed: boolean) => void, title?: string) => void;
        error: (title: string, message: string) => void;
        input: (title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void) => void;
        show: (type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions) => void;
    };
    showAlert: (title: string, message: string) => void;
    handleError: (error: unknown, options?: ErrorOptions) => BgmError;
    safeExecute: <T>(function_: () => T, context?: string, options?: ErrorOptions) => T | BgmError;
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
 *
 * `level >= BGM.LOG_LEVEL` 才记录，故 DEBUG 级别（`LOG_LEVELS.DEBUG = 0`）即「全部日志」。
 *
 * @param level - 日志级别（取 {@link LOG_LEVELS} 之一）
 * @param message - 日志消息
 */
export declare function bgmLog(level: number, message_?: string): void;
/**
 * 获取 Application 对象（使用类型守卫）
 */
export declare function getApp(): WpsApp | null;
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
 * execCommand 复制结果。
 *
 * `kind` 区分两种失败：`unsupported`（execCommand 返回 false，浏览器/WPS 不支持）
 * 与 `error`（抛异常，`message` 带具体原因）——Ribbon 弹窗需要据此给不同文案。
 */
export type ClipboardCopyResult = {
    ok: true;
} | {
    ok: false;
    kind: 'unsupported';
    message: string;
} | {
    ok: false;
    kind: 'error';
    message: string;
};
/**
 * 用 execCommand 把文本写入剪贴板（WPS WebView 里 Clipboard API 不可用时的回退路径）。
 *
 * `copyTokenToClipboard` 与 `copyTokenForRibbon` 此前各写一份逐字相同的实现，
 * 收敛于此。
 *
 * @param text 待复制文本
 * @returns 复制结果（区分「不支持」与「异常」，供调用方给不同文案）
 */
export declare function copyTextWithResult(text: string): ClipboardCopyResult;
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
export declare function shellExecuteByOAAssist(parameter: string): void;
/**
 * 获取 URL 路径
 */
export declare function getUrlPath(): string;
/**
 * 标记设置面板已成功加载
 *
 * showSettingsPanel 依据该标记判断已缓存的面板 ID 是否可用：
 * 页面若加载失败（URL 错误等），标记不会被写入，下次点击时直接重建面板。
 */
export declare function markSettingsPaneLoaded(): void;
/**
 * 标记清理面板已成功加载
 *
 * 与 markSettingsPaneLoaded 同款自愈机制：页面若加载失败（URL 错误等），
 * 标记不会被写入，下次点击「数据清理」时直接重建面板，避免坏 ID 被持久化卡死。
 */
export declare function markCleanPaneLoaded(): void;
/**
 * 显示 / 切换「数据清理」面板（独立面板，与设置 / 富化面板并列）
 *
 * 面板 ID 缓存于 `clean_pane_id`；配合 `clean_pane_url` 标记做自愈：
 * 缓存 ID 存在但页面从未成功加载时，隐藏旧面板并重建。
 */
export declare function showCleanPanel(): void;
/**
 * 标记「番剧高亮」面板已成功加载（自愈用：URL 拼错 / 页面报错时下次重建）
 */
export declare function markHighlightPaneLoaded(): void;
/**
 * 标记「赞赏」页面已成功加载（自愈用：URL 拼错 / 页面报错时下次重建）
 */
export declare function markDonatePaneLoaded(): void;
/**
 * 标记「条件格式管理」面板已成功加载（自愈用：URL 拼错 / 页面报错时下次重建）
 */
export declare function markConditionalFormatPaneLoaded(): void;
/**
 * 显示 / 切换「条件格式管理」面板（独立面板，与设置 / 富化 / 清理 / 高亮并列）
 *
 * 面板 ID 缓存于 `conditionalFormat_pane_id`；配合 `conditionalFormat_pane_url` 标记做自愈：
 * 缓存 ID 存在但页面从未成功加载时，隐藏旧面板并重建。与清理 / 高亮面板同款机制。
 */
export declare function showConditionalFormatPanel(): void;
/**
 * 显示 / 切换「番剧高亮」面板（独立面板，与设置 / 富化 / 清理面板并列）
 *
 * 面板 ID 缓存于 `highlight_pane_id`；配合 `highlight_pane_url` 标记做自愈：
 * 缓存 ID 存在但页面从未成功加载时，隐藏旧面板并重建。与清理面板同款机制。
 */
export declare function showHighlightPanel(): void;
/**
 * 显示 / 切换「赞赏」页面（Ribbon「赞赏」按钮的落地页）
 *
 * 与其它工具页不同，赞赏页是纯展示页（作者 GitHub / 邮箱 / 微信赞赏码），
 * 不参与功能导航与模块排序，因此不进 `PAGE_MODULES`；但它同样需要
 * 「窗格对象活着 ≠ 页面活着」的自愈，故沿用 `donate_pane_id` 缓存 + 心跳。
 */
export declare function showDonatePanel(): void;
/**
 * 构造任务窗格页面 URL
 *
 * 背景：getUrlPath() 在面板页面内（如 .../ui/panel.html）执行时返回的是页面所在目录
 * `.../ui`，此时若直接拼接 `/ui/settings.html` 会得到错误的 `.../ui/ui/settings.html`。
 * 这里统一把末尾的 `/ui` 归一化掉后再拼接，保证任何调用上下文都得到 `.../ui/<page>`。
 *
 * @param page 页面文件名，如 `settings.html`
 * @returns 归一化后的完整页面 URL
 */
export declare function buildTaskPaneUrl(page: string): string;
/**
 * 显示同步面板
 */
export declare function showBangumiPanel(): void;
/**
 * 显示新番表富化面板
 * 独立面板，与主同步面板分离
 */
export declare function showEnrichPanel(): void;
/**
 * 显示/切换设置面板
 * 设置面板位置逻辑：
 * - 始终停靠右侧（msoCTPDockPositionRight）
 * - 有主面板时在主面板右边弹出，无主面板时直接弹出在右侧
 */
export declare function showSettingsPanel(): void;
/**
 * 一键关闭所有任务窗格页面（Ribbon「关闭所有页面」按钮）。
 *
 * ## 为什么是「置 Visible = false」而不是清存储 / Delete
 * 1. **不能清 ID**：清了之后下次点「打开同步面板」会走 `CreateTaskPane` 分支，
 *    重新建一个窗格 —— 旧的那个还挂着，只是看不见了，最后堆出一串孤儿窗格
 *    （`tools/pane-alive.ts` 的注释记着这个坑）。
 * 2. **不能 Delete**：WPS 的 TaskPane 没有可靠的销毁入口，且页面 JS 还在跑
 *    （心跳、轮询），删了对象反而让 `GetTaskPane` 返回 null，下次打开又要重建。
 * 3. 置不可见是**可逆的**：下次点任意「打开 XX」按钮，`showXxxPanel` 拿到缓存
 *    ID、校验心跳（页面还活着）→ 直接切回 Visible，不重建、不丢页面状态。
 *
 * 页面里拖出的浮动窗口、以及条件格式的原生独立窗口（另一个 WebView）不在
 * 管辖范围：前者在各页自己的 DOM 里，后者是宿主 WebDialog 而非 TaskPane。
 *
 * @returns 实际被置为不可面的窗格数量（已不可见 / 拿不到对象的不计入）
 */
export declare function closeAllPanels(): number;
export { trim, escapeHtml, calcFingerprint, columnNumberToLetter } from '../string-utilities.js';
//# sourceMappingURL=index.d.ts.map