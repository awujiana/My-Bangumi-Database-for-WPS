/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */
import type { SyncProgressStats } from '../core/types.js';
import type { SyncProgressHandlers } from '../core/sync-progress-handlers.js';
import type { GithubSyncDetailItem } from '../sync/github-sync-diff.js';
import type { SyncConfigSummary } from '../sync/sync-config-summary.js';
export interface DialogOptions {
    title?: string;
    message?: string;
    prompt?: string;
    onOk?: (value?: string) => void;
    onCancel?: () => void;
    defaultValue?: string;
}
export interface DialogButton {
    id: string;
    cssClass: string;
    text: string;
    event: string;
}
export interface DialogConfig {
    id: string;
    titleId: string;
    messageId: string;
    buttons: DialogButton[];
}
export interface DialogCallback {
    onOk?: (value?: string) => void;
    onCancel?: () => void;
}
export { buildSyncConfig } from '../sync/sync-config-summary.js';
export type { BuildSyncConfigContext, SyncConfigSummary } from '../sync/sync-config-summary.js';
export declare function showSyncResult(summary: string, details: string[]): void;
/**
 * 渲染配置摘要为 HTML 字符串
 */
export declare function renderConfigSummary(config: SyncConfigSummary): string;
/**
 * 显示同步进度弹窗（运行中状态）
 * @param title 弹窗标题（如"正在同步 - 选中行同步"）
 * @param handlers 暂停/恢复/停止回调集合
 * @param config 可选的同步配置摘要，显示在进度区上方
 */
export declare function showSyncProgressDialog(title: string, handlers: SyncProgressHandlers, config?: SyncConfigSummary, phaseNames?: readonly string[]): void;
/**
 * 更新进度条
 * @param current 当前完成数
 * @param total 总数
 * @param message 当前任务描述（显示在进度条下方）
 * @param logLine 可选的实时日志行（追加到日志区）
 * @param eta 可选的 ETA 字符串（显示在 ETA 区域，独立于 logLine）
 */
export declare function updateSyncProgressDialog(current: number, total: number, message?: string, logLine?: string, eta?: string): void;
/**
 * 同步统计数据接口（增强版，支持完整仪表盘渲染）。
 *
 * 形状本身与 UI 无关，已下沉到 `core/types.ts`，供 `sync/`、`ui/handlers/` 与
 * 进度桥（`core/ui-bridge.ts`）共同引用，避免下层为了拿一个数据形状而反向依赖 UI。
 */
export type { SyncProgressStats } from '../core/types.js';
/**
 * 将同步明细数据渲染为可折叠的 HTML 表格
 * @param items 同步明细条目数组
 * @returns 已做 HTML 转义的表格 HTML 字符串
 */
export declare function renderSyncDetailTable(items: GithubSyncDetailItem[]): string;
/**
 * 切换弹窗为完成状态，显示统计结果
 * @param summary 统计摘要文本
 * @param details 详情文本数组（无明细对象时的兼容显示）
 * @param isStopped 是否被用户停止
 * @param onNext 点击"下一步"时的回调（用于打开同步完成详情弹窗）
 * @param stats 同步统计数据（用于渲染图表）
 * @param detailItems 同步明细数据（用于渲染详情表格）
 */
export declare function completeSyncProgressDialog(summary: string, details: string[], isStopped?: boolean, onNext?: () => void, stats?: SyncProgressStats, detailItems?: GithubSyncDetailItem[]): void;
/** 隐藏同步进度弹窗 */
export declare function hideSyncProgressDialog(): void;
export declare function showAlert(message: string, title?: string, onOk?: () => void): void;
export declare function showConfirm(message: string, callback: (isConfirmed: boolean) => void | Promise<void>, title?: string): void;
/**
 * 确认对话框的 Promise 版（异步流程里需要 `await` 用户决策时用）
 *
 * 同步流程用 {@link showConfirm} 的回调式即可；但 `syncFromPanel` / `_doAPISync`
 * 这类本身就是 `async` 的链路，用回调式要把后续逻辑整段塞进回调里（或手写
 * `new Promise` 包装）。此前两处**逐字重复**了同一段 `new Promise` 样板，
 * 收敛到这里。
 *
 * @param message 提示内容
 * @param title   可选标题
 * @returns 用户点了「确定」为 true，取消为 false
 */
export declare function confirmAsync(message: string, title?: string): Promise<boolean>;
export declare function showError(message: string, title?: string, onOk?: () => void): void;
export declare function showWarning(message: string, title?: string, onOk?: () => void): void;
export declare function showSuccess(message: string, title?: string, onOk?: () => void): void;
export declare function showInput(title: string, prompt: string, defaultValue?: string, onOk?: (value?: string) => void, onCancel?: () => void): void;
export declare function showToast(message: string, type?: string): void;
//# sourceMappingURL=dialog.d.ts.map