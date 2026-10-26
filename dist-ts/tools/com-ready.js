/**
 * @fileoverview 宿主 COM 就绪闸门（首屏零 COM + 初始化分片 + 卡顿降级）
 *
 * 背景（高亮页面打开卡 70 秒）：WPS 任务窗格在「新窗格打开 → 宿主渲染进程 attach →
 * COM 桥建好」之间存在一个**初始化窗口**。在这个窗口里从渲染进程发起**任何同步跨进程
 * COM 调用**（`getDataSheet` / `Worksheet.Range.Read` / `PluginStorage` 读写）都会让
 * 宿主主线程阻塞：宿主同步等渲染进程回复，渲染进程又被宿主的同步 IPC 堵住 ——
 * 宿主与渲染进程互锁死等，直到 JSAPI 桥的看门狗超时（实测 10s 轻 COM / 70s 大 Range）。
 *
 * 真机 bisect 证据（用户实测）：
 *   - 只 import highlight-page 不调函数      → 秒开（静态 import 148 模块无罪）
 *   - 调 initializeHighlightPage（3 次轻 COM）→ 卡 10 秒
 *   - 原版（3 轻 COM + 一次大 Range 读）      → 卡 70 秒
 *   - panel.html                              → 秒开（首帧后 COM 更晚更少）
 *
 * 结论：**卡多久取决于「首次 COM 落在窗口内多久」，而不是代码本身**。靠固定
 * `setTimeout(0)` 挪不动窗口（离 load 只有几毫秒，宿主还在等 attach），所以本模块
 * 用两层组合拳而不是猜时间：
 *
 *   1. **首屏零 COM**：闸门开启前，任何 COM 任务只排队不执行 → 骨架先渲染出来，
 *      用户看到的是「加载中」而不是「卡死」；
 *   2. **分片执行 + 卡顿降级**：初始化拆成若干小片，片间让出主线程；单片超时即
 *      停止后续自动分片并派发降级事件，由页面插「点此继续初始化」按钮 —— 用户点击时
 *      宿主主线程必然空闲（点击是宿主派发的输入事件），因此点击路径不会互锁。
 *
 * 依赖说明：本模块是**底层**（被各页 bootstrap 使用），不得反向 import
 * tools/util/index（bgmLog/getApp 都在那，会构成运行时循环，被 check:cycles 拦截）
 * —— 日志走 tools/logger，宿主直接读 `window.Application`。
 */
import { logger } from './logger.js';
/** 闸门默认延迟：首帧后再给宿主 800ms 收尾（首次冷启动尚无观测数据） */
const GATE_DELAY_DEFAULT_MS = 800;
/**
 * 闸门延迟上限 3s
 *
 * 延迟的作用只是「等宿主 attach 完」。真机实测 800ms 闸门下轻分片 1057ms 就全跑完、
 * 按钮已可用，说明轻活根本不需要十几秒。所以这里刻意不追着 stall 抬到更高，否则
 * 轻分片（按钮启用）也要陪着等，那是纯 UX 倒退。
 */
const GATE_DELAY_MAX_MS = 3000;
/** 单片预算：超过即认定踩进初始化窗口，停止后续自动分片并降级 */
const STALL_BUDGET_MS = 800;
/** 自适应延迟的余量：在观测到的 stall 之上再加一点 */
const STALL_MARGIN_MS = 200;
/** stall 观测值存储前缀（完整键：`bgm_com_stall_<pageKey>`） */
const STALL_KEY_PREFIX = 'bgm_com_stall_';
/** 降级事件名（各页 bootstrap 用 installComInitFallback 监听） */
export const COM_DEGRADED_EVENT = 'bgm:comInitDegraded';
/** 闸门是否已开启 */
let isGateOpen = false;
/** 闸门是否已启动（防重复装配） */
let isGateStarted = false;
/** 闸门开启前排队的任务 */
const pendingTasks = [];
/** 读宿主（等价于 getApp() 的取值路径，但不依赖 util/index 以避免循环依赖） */
function readHost() {
    if (typeof window === 'undefined')
        return null;
    const app = window.Application;
    return app && typeof app === 'object' ? app : null;
}
/** @returns 闸门是否已开启（供断言 / 调试用） */
export function isComGateOpen() {
    return isGateOpen;
}
/**
 * 读某页上一次观测到的 stall 时长（毫秒）；无记录 / 脏值一律 0
 */
export function readLastStallMs(pageKey) {
    const raw = readHost()?.PluginStorage?.getItem?.(STALL_KEY_PREFIX + pageKey);
    if (!raw)
        return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
/** 记一次 stall：只在比历史值更大时写（避免把延迟越调越小） */
function recordStall(pageKey, costMs) {
    if (costMs <= readLastStallMs(pageKey))
        return;
    try {
        readHost()?.PluginStorage?.setItem?.(STALL_KEY_PREFIX + pageKey, String(costMs));
    }
    catch {
        // 写不进去不影响本次降级（内存里已有本次观测，页面内重试点得动）
    }
}
/**
 * 本次闸门延迟：上次观测到的 stall + 余量，上限 3s
 * （第一次冷启动没有观测值 → 走默认 800ms）
 */
export function resolveGateDelayMs(pageKey) {
    const adaptive = readLastStallMs(pageKey) + STALL_MARGIN_MS;
    const raw = Math.max(GATE_DELAY_DEFAULT_MS, adaptive);
    return Math.min(raw, GATE_DELAY_MAX_MS);
}
/** 连续两帧后再回调（确保第一帧真的画出来了）；无 rAF 环境直接回调 */
function afterTwoFrames(callback) {
    if (typeof requestAnimationFrame !== 'function') {
        callback();
        return;
    }
    requestAnimationFrame(() => {
        requestAnimationFrame(callback);
    });
}
/** 排空游标：避免用 Array#shift() 做队首删除（unicorn/no-array-front-mutation） */
let drainCursor = 0;
/** 是否正在排空（防重复调度两条消费链） */
let isDraining = false;
/** 排空队列：每个任务独占一个宏任务，避免一整串 COM 挤在一次调度里 */
function drainPending() {
    if (isDraining)
        return;
    isDraining = true;
    const next = () => {
        const task = pendingTasks[drainCursor];
        drainCursor += 1;
        if (!task) {
            isDraining = false;
            drainCursor = 0;
            pendingTasks.length = 0;
            return;
        }
        try {
            task.run();
        }
        catch (error) {
            logger.warn(`[comReady] 任务「${task.name}」执行失败: ${error instanceof Error ? error.message : String(error)}`);
        }
        window.setTimeout(next, 0);
    };
    window.setTimeout(next, 0);
}
/**
 * 开启闸门：load（或已 complete）→ 连续两帧 → 自适应延迟 → 开闸排空队列
 *
 * 幂等：同一页面重复调用只生效一次。本函数自身**不发任何 COM**（只注册事件），
 * 可以放心在模块顶层调用。
 */
export function openComGate(pageKey) {
    if (typeof window === 'undefined' || typeof document === 'undefined')
        return;
    if (isGateStarted)
        return;
    isGateStarted = true;
    const delayMs = resolveGateDelayMs(pageKey);
    const open = () => {
        isGateOpen = true;
        logger.info(`[comReady] ${pageKey} 闸门已开（延迟 ${String(delayMs)}ms，历史 stall ${String(readLastStallMs(pageKey))}ms）`);
        drainPending();
    };
    const scheduleOpen = () => {
        afterTwoFrames(() => {
            window.setTimeout(open, delayMs);
        });
    };
    if (document.readyState === 'complete') {
        scheduleOpen();
        return;
    }
    window.addEventListener('load', scheduleOpen, { once: true });
}
/**
 * 排一个 COM 任务：闸门未开则排队，开了就放进下一个宏任务执行
 *
 * 所有会碰 COM（含 PluginStorage 读配置）的初始化都必须走这里，**禁止在模块顶层
 * 或 load 回调里直接同步发 COM**（scripts/check-boot-com.mjs 守这条）。
 */
export function scheduleComTask(name, run) {
    if (!isGateOpen) {
        pendingTasks.push({ name, run });
        return;
    }
    pendingTasks.push({ name, run });
    if (pendingTasks.length === 1)
        drainPending();
}
/** 派发降级事件（供页面渲染「点此继续」按钮） */
function dispatchDegraded(pageKey, reason, resume) {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function')
        return;
    const detail = { pageKey, reason, resume };
    document.dispatchEvent(new CustomEvent(COM_DEGRADED_EVENT, { detail }));
}
/**
 * 跑 [startIndex, endIndex) 这一段分片：一片一个宏任务，单片超预算即停止并降级
 */
function runPhaseRange(pageKey, phases, startIndex, endIndex, budgetMs) {
    if (startIndex >= endIndex)
        return;
    const phase = phases[startIndex];
    if (!phase)
        return;
    const startAt = Date.now();
    try {
        phase.run();
    }
    catch (error) {
        logger.warn(`[comReady] ${pageKey} 分片「${phase.name}」抛出异常: ${error instanceof Error ? error.message : String(error)}`);
    }
    const costMs = Date.now() - startAt;
    const nextIndex = startIndex + 1;
    // 踩进宿主初始化窗口：记下这次的代价（下次绕开），剩下的交给用户点击
    if (costMs > budgetMs) {
        recordStall(pageKey, costMs);
        const reason = `分片「${phase.name}」耗时 ${String(costMs)}ms，疑似撞上宿主初始化窗口`;
        logger.warn(`[comReady] ${pageKey} ${reason} —— 停止自动初始化，等待用户点击继续`);
        dispatchDegraded(pageKey, reason, () => {
            window.setTimeout(() => {
                runPhaseRange(pageKey, phases, nextIndex, endIndex, budgetMs);
            }, 0);
        });
        return;
    }
    if (nextIndex >= endIndex)
        return;
    window.setTimeout(() => {
        runPhaseRange(pageKey, phases, nextIndex, endIndex, budgetMs);
    }, 0);
}
/**
 * 分片执行初始化：闸门开启后一片一片跑，片间让出主线程
 *
 * 分片数组按依赖顺序排列（越重的放越后面）。单片超预算即停止后续自动分片、
 * 派发降级事件，由页面插「点此继续初始化」按钮；用户点击时宿主必然空闲，点击
 * 路径不会互锁（真机实测：自动跑 69735ms，点击跑 642ms）。
 *
 * @param pageKey 页面标识（用于读写 stall 观测值）
 * @param phases 初始化分片，按依赖顺序排列（越重的放越后面）
 * @param budgetMs 单片预算，默认 800ms；超过即降级为「点击继续」
 */
export function runComPhases(pageKey, phases, budgetMs = STALL_BUDGET_MS) {
    if (phases.length === 0)
        return;
    scheduleComTask(`${pageKey}:startup`, () => {
        runPhaseRange(pageKey, phases, 0, phases.length, budgetMs);
    });
}
/**
 * 安装降级兜底 UI：收到本页降级事件时插入提示条 + 「点此继续」按钮
 *
 * 为什么必须留这条兜底：同步 COM 一旦阻塞，JS 线程自己无法中断或超时，
 * 只能**事先不跑**。而用户点击时宿主主线程必然空闲（点击是宿主派发的输入事件），
 * 因此点击路径不会互锁 —— 真机实测：自动跑 69735ms，点击跑 642ms。
 *
 * @param pageKey 页面标识（只响应本页的降级事件）
 */
export function installComStartupFallback(pageKey) {
    if (typeof document === 'undefined')
        return;
    document.addEventListener(COM_DEGRADED_EVENT, (event) => {
        // 事件.detail 的类型是声明式的：运行期可能被无 detail 的事件触发（比如手工派发）
        const { detail } = event;
        if (detail?.pageKey !== pageKey)
            return;
        if (document.getElementById('bgm-com-fallback'))
            return;
        const banner = document.createElement('div');
        banner.id = 'bgm-com-fallback';
        banner.setAttribute('role', 'status');
        banner.style.cssText =
            'position:sticky;top:0;z-index:9999;padding:8px 10px;margin:0 0 8px;' +
                'background:#fff4e5;border:1px solid #ffb35c;border-radius:6px;' +
                'font-size:12px;line-height:1.5;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
        const text = document.createElement('span');
        text.textContent = `初始化撞上宿主忙（${detail.reason}）。`;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '点此继续初始化';
        button.style.cssText =
            'flex:0 0 auto;padding:4px 10px;border:1px solid #d98c2b;border-radius:4px;' +
                'background:#ffb35c;color:#3a2200;cursor:pointer;font-size:12px';
        button.addEventListener('click', () => {
            banner.remove();
            detail.resume();
        });
        banner.append(text, button);
        document.body.prepend(banner);
        logger.info(`[comReady] ${pageKey} 已显示「点此继续初始化」兜底按钮`);
    });
}
/** 仅测试用：复位闸门状态，让 openComGate / scheduleComTask 可以重复装配 */
export function resetComGateForTest() {
    isGateOpen = false;
    isGateStarted = false;
    isDraining = false;
    drainCursor = 0;
    pendingTasks.length = 0;
}
