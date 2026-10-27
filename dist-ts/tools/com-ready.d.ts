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
/** 初始化分片：初始化流程被拆成的最小可执行单元 */
export interface ComPhase {
    /** 分片名（日志 / 降级提示里显示） */
    name: string;
    /** 分片本体（内部允许含同步 COM） */
    run: () => void;
}
/** 降级事件携带的信息 */
export interface ComDegradedDetail {
    pageKey: string;
    /** 触发降级的分片名与实测耗时 */
    reason: string;
    /** 用户点击「继续」时调用：接着跑剩余分片（此时宿主必然空闲） */
    resume: () => void;
}
/** 降级事件名（各页 bootstrap 用 installComInitFallback 监听） */
export declare const COM_DEGRADED_EVENT = "bgm:comInitDegraded";
/** @returns 闸门是否已开启（供断言 / 调试用） */
export declare function isComGateOpen(): boolean;
/**
 * 读某页上一次观测到的 stall 时长（毫秒）；无记录 / 脏值一律 0
 */
export declare function readLastStallMs(pageKey: string): number;
/**
 * 本次闸门延迟：上次观测到的 stall + 余量，上限 3s
 * （第一次冷启动没有观测值 → 走默认 800ms）
 */
export declare function resolveGateDelayMs(pageKey: string): number;
/**
 * 开启闸门：load（或已 complete）→ 连续两帧 → 自适应延迟 → 开闸排空队列
 *
 * 幂等：同一页面重复调用只生效一次。本函数自身**不发任何 COM**（只注册事件），
 * 可以放心在模块顶层调用。
 */
export declare function openComGate(pageKey: string): void;
/**
 * 排一个 COM 任务：闸门未开则排队，开了就放进下一个宏任务执行
 *
 * 所有会碰 COM（含 PluginStorage 读配置）的初始化都必须走这里，**禁止在模块顶层
 * 或 load 回调里直接同步发 COM**（scripts/check-boot-com.mjs 守这条）。
 */
export declare function scheduleComTask(name: string, run: () => void): void;
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
export declare function runComPhases(pageKey: string, phases: ComPhase[], budgetMs?: number): void;
/**
 * 安装降级兜底 UI：收到本页降级事件时插入提示条 + 「点此继续」按钮
 *
 * 为什么必须留这条兜底：同步 COM 一旦阻塞，JS 线程自己无法中断或超时，
 * 只能**事先不跑**。而用户点击时宿主主线程必然空闲（点击是宿主派发的输入事件），
 * 因此点击路径不会互锁 —— 真机实测：自动跑 69735ms，点击跑 642ms。
 *
 * @param pageKey 页面标识（只响应本页的降级事件）
 */
export declare function installComStartupFallback(pageKey: string): void;
/** 仅测试用：复位闸门状态，让 openComGate / scheduleComTask 可以重复装配 */
export declare function resetComGateForTest(): void;
//# sourceMappingURL=com-ready.d.ts.map