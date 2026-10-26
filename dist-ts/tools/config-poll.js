/**
 * @fileoverview 跨窗格配置轮询（单定时器 + 去重读 + 隐藏跳过 + 下拉交互让路）
 * @module tools/configPoll
 *
 * ## 为什么需要这个模块
 *
 * WPS 各任务窗格是独立 WebView，没有跨窗格广播通道，`PluginStorage` 只能读、不
 * 通知——所以主题 / 导航模式 / 导航顺序 / 模块折叠状态只能各自轮询。改造前是
 * **四个独立定时器**（各 2s 一个，活跃期 300ms），每个 tick 各读 1~2 个键：
 * 合计 **5 次 PluginStorage（COM）读 / 2s**，且分散在不同时刻——平均每 400ms
 * 一次跨进程同步调用，主线程被反复打顿。
 *
 * 真机表现（2026-10-24 momo）：条件格式页「目标工作表」的原生 `<select>` 下拉
 * 展开/悬停明显卡顿；开 JsApiDevTool 调速器把 COM 限速后更严重——每次读要
 * 几百毫秒，5 次读摊在 2 秒里等于页面一直在顿。
 *
 * ## 本模块做四件事
 *
 * 1. **单定时器**：所有订阅共用一个 `setTimeout` 链，一次任务里读完所有订阅键
 *    （键去重），把「多次散落的微卡顿」压成「每拍一次集中停顿」；
 * 2. **空闲 3s / 变化后 600ms 快拍 4s**：保留「连续调整跟手」，又把空闲轮询
 *    频率降下来（原 2s × 4 个定时器）；
 * 3. **页面隐藏跳过**：`document.visibilityState === 'hidden'` 时连读都不读——
 *    后台窗格同步没有意义；
 * 4. **原生下拉交互让路**：`select` 上最近有过 pointerdown / focusin、或当前
 *    焦点就在 `select` 上时，这一拍直接跳过（不发起任何 COM），让原生下拉的
 *    展开与悬停不被跨进程调用打断。焦点留在 select 上时最多让路 10s，避免
 *    键盘用户把焦点停在 select 上导致同步永久停摆。
 */
import { getConfig } from './config.js';
/** 空闲轮询间隔：改造前是每个模块各 2s，现在全局一拍 3s */
const IDLE_INTERVAL_MS = 3000;
/** 检测到变化后的快拍间隔（连续调整跟手） */
const ACTIVE_INTERVAL_MS = 600;
/** 变化后保持快拍的时间窗 */
const ACTIVE_WINDOW_MS = 4000;
/** 下拉交互让路：最近一次交互后的静默时长 */
const SELECT_SUPPRESS_MS = 1500;
/** 焦点停在 select 上时的最大让路时长（防键盘用户把同步卡死） */
const SELECT_MAX_SUPPRESS_MS = 10_000;
const subscriptions = new Set();
/** 各键上次读到的值（用于判定变化） */
const lastValues = new Map();
let timer = null;
/** 最近一次检测到变化的时间（决定下一拍用快拍还是空闲） */
let lastChangeAt = 0;
/** 最近一次与 select 交互的时间 */
let lastSelectInteractionAt = 0;
let isGuardBound = false;
/** 一次任务里读完给定键（键去重由调用方保证；读失败按空串处理） */
function readKeys(keys) {
    const values = new Map();
    for (const key of keys) {
        try {
            values.set(key, getConfig(key, '', true));
        }
        catch {
            values.set(key, '');
        }
    }
    return values;
}
/** 记一次与 select 的交互（pointerdown / focusin 共用一个 handler） */
function markSelectInteraction(event) {
    const { target } = event;
    if (target instanceof Element && target.closest('select') !== null) {
        lastSelectInteractionAt = Date.now();
    }
}
/** 原生下拉交互让路：绑一次 pointerdown / focusin（capture，页面级） */
function bindSelectGuard() {
    if (isGuardBound || typeof document === 'undefined')
        return;
    isGuardBound = true;
    document.addEventListener('pointerdown', markSelectInteraction, { capture: true, passive: true });
    document.addEventListener('focusin', markSelectInteraction, { capture: true, passive: true });
}
/** 当前是否正在与原生下拉交互（是则这一拍不读 COM） */
function isSelectBusy() {
    if (typeof document === 'undefined')
        return false;
    const active = document.activeElement;
    const isSelectFocused = active instanceof HTMLElement && active.tagName === 'SELECT';
    const limit = isSelectFocused ? SELECT_MAX_SUPPRESS_MS : SELECT_SUPPRESS_MS;
    return Date.now() - lastSelectInteractionAt < limit;
}
/** 安排下一拍（已有定时器 / 无订阅时不重复安排） */
function schedule() {
    if (timer !== null || subscriptions.size === 0)
        return;
    const isActive = Date.now() - lastChangeAt < ACTIVE_WINDOW_MS;
    timer = setTimeout(tick, isActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
}
/** 单拍：读所有订阅键 → 只通知变化了的订阅者 → 安排下一拍 */
function tick() {
    timer = null;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule();
        return;
    }
    if (isSelectBusy()) {
        schedule();
        return;
    }
    // 键去重：5 个订阅键在同一任务里读完（原来散落在 4 个定时器里）
    const keys = [...new Set([...subscriptions].flatMap((subscription) => [...subscription.keys]))];
    const values = readKeys(keys);
    let hasChanged = false;
    for (const subscription of subscriptions) {
        const isChanged = subscription.keys.some((key) => (lastValues.get(key) ?? '') !== (values.get(key) ?? ''));
        if (isChanged) {
            hasChanged = true;
            const snapshot = {};
            for (const key of subscription.keys)
                snapshot[key] = values.get(key) ?? '';
            subscription.apply(snapshot);
        }
    }
    for (const [key, value] of values)
        lastValues.set(key, value);
    if (hasChanged)
        lastChangeAt = Date.now();
    schedule();
}
/**
 * 订阅配置变化（返回退订函数）
 *
 * 订阅时会把当前值读成基线——避免「刚订阅就被判定为变化 → 立刻 apply 一次」
 * （各模块启动时已各自 apply 过；多这一次读只发生在启动阶段）。
 */
export function subscribeConfigPoll(subscription) {
    subscriptions.add(subscription);
    bindSelectGuard();
    for (const key of subscription.keys) {
        if (!lastValues.has(key))
            lastValues.set(key, readKeys([key]).get(key) ?? '');
    }
    schedule();
    return () => {
        subscriptions.delete(subscription);
        if (timer !== null && subscriptions.size === 0) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
/** 仅测试用：复位模块级状态 */
export function resetConfigPollForTest() {
    subscriptions.clear();
    lastValues.clear();
    lastChangeAt = 0;
    lastSelectInteractionAt = 0;
    isGuardBound = false;
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
}
