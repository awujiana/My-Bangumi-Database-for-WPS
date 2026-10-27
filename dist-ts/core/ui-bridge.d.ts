/**
 * @fileoverview 底层 → 上层 UI 能力桥（UI Bridge）
 * @module core/ui-bridge
 *
 * @description
 * 解决的问题（见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）：
 *   `tools/`、`sync/` 等底层模块原先直接 `import` 上层的 `ui/dialog.ts` 来弹窗 / 报错 /
 *   更新同步进度条，形成「底层 → 上层」的反向依赖，并在 barrel（`ts/index.ts`、
 *   `tools/util/index.ts`）参与下构成运行时循环依赖。后果：模块初始化顺序敏感
 *   （本项目历史上已踩过 barrel 顶层读取其它模块导出常量拿到 `undefined` 的坑），
 *   且底层模块无法脱离 UI 独立测试。
 *
 * 做法：底层只依赖本模块的**接口**，UI 层在模块加载时注册实现。方向变为
 *   `tools/sync → core/ui-bridge ← ui/dialog`
 * 即依赖反转（Dependency Inversion）。运行时不再有底层 → 上层的边。
 *
 * 未注册时的行为：返回**降级实现**（写日志 + 不崩），而不是抛错或静默——
 * 无 UI 环境（单测、纯 Node）下调用弹窗不会中断业务流程，同时留下可排查的痕迹。
 *
 * @example
 * // 底层模块
 * import { getNotifyApi } from '../core/ui-bridge.js'
 * getNotifyApi().alert('同步失败', '错误')
 *
 * // UI 层（ui/dialog.ts，模块加载时执行一次）
 * registerNotifyApi({ alert: showAlert, confirm: showConfirm, ... })
 */
import type { SyncConfigSummary } from '../sync/sync-config-summary.js';
import type { SyncProgressStats } from './types.js';
import type { SyncProgressHandlers } from './sync-progress-handlers.js';
import type { GithubSyncDetailItem } from '../sync/github-sync-diff.js';
/**
 * 通知类 UI 能力（由 ui/dialog.ts 实现）。
 *
 * 签名与 `ui/dialog.ts` 的导出保持一致，便于直接注册而无适配层。
 */
export interface NotifyApi {
    /** 提示框 */
    alert(message: string, title?: string, onOk?: () => void): void;
    /** 确认框（回调式，非 Promise） */
    confirm(message: string, callback: (isConfirmed: boolean) => void, title?: string): void;
    /** 错误框 */
    error(message: string, title?: string, onOk?: () => void): void;
    /** 成功框 */
    success(message: string, title?: string, onOk?: () => void): void;
    /** 轻提示（3 秒自动消失） */
    toast(message: string, type?: string): void;
    /** 单行输入框 */
    input(title: string, prompt: string, defaultValue?: string, onOk?: (value?: string) => void, onCancel?: () => void): void;
}
/** 同步进度弹窗能力（由 ui/dialog.ts 实现，现为通用进度组件的 modal 包装） */
export interface SyncProgressApi {
    /** 打开进度弹窗并接管暂停/继续/停止回调（phaseNames 提供时渲染阶段时间线） */
    show(title: string, handlers: SyncProgressHandlers, config?: SyncConfigSummary, phaseNames?: readonly string[]): void;
    /** 更新进度 */
    update(current: number, total: number, message?: string, logLine?: string, eta?: string): void;
    /**
     * 推进阶段时间线（未启用时静默忽略，调用方不必分支判断）。
     * 阶段名由 `show()` 的 `phaseNames` 给出，这里只按下标推进。
     */
    setPhase(index: number): void;
    /** 置为完成态 */
    complete(summary: string, details: string[], isStopped?: boolean, onNext?: () => void, stats?: SyncProgressStats, detailItems?: GithubSyncDetailItem[]): void;
    /** 隐藏并销毁 */
    hide(): void;
}
/** 全量同步的统计结果（与 `ui/preview.ts` 的 `syncAllRows()` 返回值同形） */
export interface SyncRunSummary {
    success: number;
    fail: number;
    skip: number;
}
/** 全量同步执行体（由 ui/preview.ts 注册，供主面板「开始同步」按钮调用） */
export type SyncRunner = () => Promise<SyncRunSummary>;
/** 注册通知能力（由 ui/dialog.ts 在模块加载时调用） */
export declare function registerNotifyApi(api: NotifyApi): void;
/** 取得通知能力；未注册时返回降级实现（不返回 null，调用方无需到处判空） */
export declare function getNotifyApi(): NotifyApi;
/** 注册同步进度弹窗能力（由 ui/dialog.ts 在模块加载时调用） */
export declare function registerSyncProgressApi(api: SyncProgressApi): void;
/** 取得同步进度弹窗能力；未注册时返回降级实现 */
export declare function getSyncProgressApi(): SyncProgressApi;
/** 注册全量同步执行体（由 ui/preview.ts 在模块加载时调用） */
export declare function registerSyncRunner(run: SyncRunner): void;
/** 取得全量同步执行体；未注册时返回 null（调用方需给出「同步不可用」的提示） */
export declare function getSyncRunner(): SyncRunner | null;
//# sourceMappingURL=ui-bridge.d.ts.map