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
import { logger } from '../tools/logger.js';
let notifyApi = null;
let syncProgressApi = null;
let syncRunner = null;
/** 记录「未注册即调用」的告警，按 API 名去重，避免刷屏 */
const warnedApis = new Set();
/** 未注册时写一次告警日志（不静默吞掉，否则无 UI 环境的问题无法定位） */
function warnNotRegistered(apiName, method) {
    const key = `${apiName}.${method}`;
    if (warnedApis.has(key))
        return;
    warnedApis.add(key);
    logger.warn(`[ui-bridge] ${key} 在 UI 未注册的情况下被调用，已忽略（无 UI 环境属预期）`);
}
/** NotifyApi 的降级实现：全部写一次告警后忽略 */
const FALLBACK_NOTIFY = {
    alert: () => {
        warnNotRegistered('notify', 'alert');
    },
    confirm: (message, callback) => {
        warnNotRegistered('notify', 'confirm');
        // 无 UI 时无法询问用户：按「未确认」回调，避免调用方把默认值当成用户同意
        callback(false);
    },
    error: () => {
        warnNotRegistered('notify', 'error');
    },
    success: () => {
        warnNotRegistered('notify', 'success');
    },
    toast: () => {
        warnNotRegistered('notify', 'toast');
    },
    input: () => {
        warnNotRegistered('notify', 'input');
    },
};
/** SyncProgressApi 的降级实现：全部写一次告警后忽略 */
const FALLBACK_SYNC_PROGRESS = {
    show: () => {
        warnNotRegistered('syncProgress', 'show');
    },
    update: () => {
        warnNotRegistered('syncProgress', 'update');
    },
    setPhase: () => {
        warnNotRegistered('syncProgress', 'setPhase');
    },
    complete: () => {
        warnNotRegistered('syncProgress', 'complete');
    },
    hide: () => {
        warnNotRegistered('syncProgress', 'hide');
    },
};
/** 注册通知能力（由 ui/dialog.ts 在模块加载时调用） */
export function registerNotifyApi(api) {
    notifyApi = api;
}
/** 取得通知能力；未注册时返回降级实现（不返回 null，调用方无需到处判空） */
export function getNotifyApi() {
    return notifyApi ?? FALLBACK_NOTIFY;
}
/** 注册同步进度弹窗能力（由 ui/dialog.ts 在模块加载时调用） */
export function registerSyncProgressApi(api) {
    syncProgressApi = api;
}
/** 取得同步进度弹窗能力；未注册时返回降级实现 */
export function getSyncProgressApi() {
    return syncProgressApi ?? FALLBACK_SYNC_PROGRESS;
}
/** 注册全量同步执行体（由 ui/preview.ts 在模块加载时调用） */
export function registerSyncRunner(run) {
    syncRunner = run;
}
/** 取得全量同步执行体；未注册时返回 null（调用方需给出「同步不可用」的提示） */
export function getSyncRunner() {
    return syncRunner;
}
