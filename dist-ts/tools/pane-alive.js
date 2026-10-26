/**
 * @fileoverview 任务窗格「页面心跳」：让 COM 侧能区分「窗格对象活着」和「窗格内容活着」
 *
 * 背景（黑屏窗格问题）：`showXxxPanel` 的复用分支用 `GetTaskPane(id)` 拿到窗格对象
 * 就切 Visible —— 但 **拿到对象 ≠ 页面内容正常**。WebView 内容加载失败
 * （dev server 停了 / 页面 JS 早崩 / 宿主回收后重载失败）时，COM 层的窗格对象
 * 依然「活着」，复用分支会把一块黑屏窗格显示出来，且全程只有 INFO 日志，
 * 用户侧表现就是「打开部分页面时右边黑屏，没有任何报错」。
 *
 * 机制：每个窗格页面（bootstrap 里）起一个心跳，周期性把 `Date.now()` 写进
 * PluginStorage（app 级、跨 WebView 共享）。开关面板的复用分支先查心跳：
 *   - 心跳新鲜 → 页面真的活着 → 放心复用；
 *   - 心跳缺失 / 过期 → 页面死了（或从未加载成功）→ 隐藏旧窗格、清 ID、重建，
 *     并打 WARN（旧自愈逻辑 markXxxPaneLoaded 只覆盖「从未加载成功」，
 *     覆盖不了「先成功后来死了」，心跳两种都覆盖）。
 *
 * 为什么不担心隐藏窗格被节流误判：Chromium/CEF 对隐藏页的 setInterval 只是
 * 节流（最小间隔约 1s），30s 的心跳周期远大于节流下限，照常执行。
 * 误判的代价可控：多建一次窗格（旧窗格先隐藏，不会叠出孤儿）。
 *
 * 依赖说明：本模块是**底层**（被 tools/util/index.ts 的 showXxxPanel 与各页
 * bootstrap 共用），因此**不得反向 import util/index**（bgmLog/getApp 都在那，
 * 直接导入会构成运行时循环，被 check:cycles 拦截）——日志走 tools/logger，
 * 宿主直接读 `window.Application?.PluginStorage`（与 getApp 的取值路径一致）。
 */
import { logger } from './logger.js';
/** 心跳写入的 PluginStorage 键前缀（完整键：`pane_alive_<pageKey>`） */
const HEARTBEAT_KEY_PREFIX = 'pane_alive_';
/** 心跳默认周期：30s。太密是无谓的 COM 往返，太疏拉长「检测到死亡」的窗口 */
const DEFAULT_INTERVAL_MS = 30_000;
/** 心跳过期判定：90s（3 个周期没跳动即认定死亡） */
export const HEARTBEAT_MAX_AGE_MS = 90_000;
/** 防重复启动：同一页面重复调用只起一个 interval（bootstrap 可能被重放） */
const startedPages = new Set();
/** 读宿主（等价于 getApp() 的取值路径，但不依赖 util/index 以避免循环依赖） */
function readHost() {
    if (typeof window === 'undefined')
        return null;
    const app = window.Application;
    return app && typeof app === 'object' ? app : null;
}
/**
 * 页面侧：启动心跳（各窗格页 bootstrap 各调一次）
 *
 * @param pageKey 页面标识，与 `showXxxPanel` 校验时用的键一致
 *   ('panel' / 'clean' / 'enrich' / 'highlight' / 'conditionalFormat' / 'settings')
 */
export function startPaneHeartbeat(pageKey, intervalMs = DEFAULT_INTERVAL_MS) {
    if (typeof window === 'undefined')
        return;
    if (startedPages.has(pageKey))
        return;
    startedPages.add(pageKey);
    const writeBeat = () => {
        try {
            readHost()?.PluginStorage?.setItem?.(HEARTBEAT_KEY_PREFIX + pageKey, String(Date.now()));
        }
        catch {
            // 写不进去（宿主暂时不可用）不刷 ERROR —— 下一轮心跳会再试；
            // 连续写失败自然表现为「心跳过期」，由开关侧兜底重建
        }
    };
    writeBeat();
    window.setInterval(writeBeat, intervalMs);
    logger.info(`[paneHeartbeat] ${pageKey} 心跳已启动（${String(intervalMs)}ms）`);
}
/**
 * COM 侧（ribbon 调用方）：判断某页面的窗格内容是否真的活着
 *
 * **「没有记录」一律判活**（保守），理由：
 *   - 旧版本升级上来：pane_id 在，但旧代码没写过心跳 → 判死会让每次点击都
 *     `CreateTaskPane`，堆出一串孤儿窗格，比黑屏更糟；
 *   - 宿主 `PluginStorage` 不可写：心跳永远写不进去，同理会退化成每次重建。
 *   这两类「无法判定」的场景交给既有自愈机制 `markXxxPaneLoaded`（pane_url 标记，
 *   覆盖「页面从未加载成功」），心跳只负责它俩覆盖不了的「先活后死」。
 *
 * @returns false 仅表示「心跳明确存在且已停跳」→ 调用方应重建；
 *          true = 可以复用窗格（含无法判定的保守情况）
 */
export function isPanePageAlive(pageKey, maxAgeMs = HEARTBEAT_MAX_AGE_MS) {
    const raw = readHost()?.PluginStorage?.getItem?.(HEARTBEAT_KEY_PREFIX + pageKey);
    if (!raw)
        return true;
    const lastBeat = Number(raw);
    if (!Number.isFinite(lastBeat) || lastBeat <= 0)
        return true;
    return Date.now() - lastBeat < maxAgeMs;
}
/** 仅测试用：清空「已启动」记录，让 startPaneHeartbeat 可以重复装配 */
export function resetPaneHeartbeatForTest() {
    startedPages.clear();
}
