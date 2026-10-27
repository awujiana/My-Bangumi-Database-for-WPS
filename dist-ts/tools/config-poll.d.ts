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
/** 一个配置轮询订阅 */
export interface ConfigPollSubscription {
    /** 要监听的键（多个订阅者监听同一键时只读一次） */
    readonly keys: readonly string[];
    /** 任一键变化时回调；`values` 是本次读到的快照（避免订阅方再读一次 COM） */
    apply: (values: Readonly<Record<string, string>>) => void;
}
/**
 * 订阅配置变化（返回退订函数）
 *
 * 订阅时会把当前值读成基线——避免「刚订阅就被判定为变化 → 立刻 apply 一次」
 * （各模块启动时已各自 apply 过；多这一次读只发生在启动阶段）。
 */
export declare function subscribeConfigPoll(subscription: ConfigPollSubscription): () => void;
/** 仅测试用：复位模块级状态 */
export declare function resetConfigPollForTest(): void;
//# sourceMappingURL=config-poll.d.ts.map