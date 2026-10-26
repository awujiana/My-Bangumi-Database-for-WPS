/**
 * @fileoverview 外观主题应用模块
 * @module tools/theme
 * @description 负责将主题配置（深色 / 浅色 / 跟随系统 / 定时）应用到 <html data-theme>，
 *              并处理三类「运行时变化」：
 *              - system 模式：监听系统外观变化实时切换；
 *              - schedule 模式：按「深色开始 / 浅色开始」定时轮询切换；
 *              - 手动切换：从点击点中心向外扩散的圆形过渡动画（momo：点击时有
 *                从按钮开始从中心向外扩散到整个应用的动画效果）。
 *              配置读写复用 tools/config.ts 的 getTheme / setTheme / 主题定时。
 */
import { CONFIG_KEYS, getTheme, getThemeSchedule, resolveScheduledTheme, setTheme, } from './config.js';
import { subscribeConfigPoll } from './config-poll.js';
const systemMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;
/** 定时轮询间隔（毫秒）：到点切换不需要秒级精度，30s 足够且省电 */
const SCHEDULE_TICK_MS = 30_000;
/**
 * 解析最终主题：system 按系统外观、schedule 按定时配置解析为 light / dark。
 */
export function resolveTheme(mode) {
    if (mode === 'system')
        return systemMedia?.matches ? 'light' : 'dark';
    if (mode === 'schedule')
        return resolveScheduledTheme(getThemeSchedule(true), new Date());
    return mode;
}
/**
 * 将主题应用到 <html> 元素（data-theme 属性 + color-scheme）。
 */
export function applyTheme(mode) {
    if (typeof document === 'undefined')
        return;
    const resolved = resolveTheme(mode);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
}
function getStartViewTransition() {
    if (typeof document === 'undefined')
        return null;
    const candidate = document
        .startViewTransition;
    return typeof candidate === 'function' ? candidate.bind(document) : null;
}
/** 从点击点扩散到全屏所需的半径 */
function spreadRadius(origin) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y));
}
/**
 * 带动画地切换主题：新主题从 `origin`（一般是按钮中心）向外扩散覆盖旧主题
 *
 * 两条路径，按宿主能力选：
 * 1. **View Transition**（新内核）：`startViewTransition` 里换 `data-theme`，
 *    再对 `::view-transition-new(root)` 做 `clip-path: circle(0 → R)` 动画
 *    —— 新画面以点击点为圆心张开，标准做法、无额外 DOM；
 * 2. **覆盖层降级**（老 WebView 没有 View Transition）：盖一层旧主题色的
 *    `clip-path: circle(R → 0)` 收缩层，动画中点切主题 —— 收缩层下面已是
 *    新主题，视觉上同样「从中心扩散」，且不依赖任何新 API。
 *
 * 用户开了「减弱动态效果」（prefers-reduced-motion）时直接切，不动画。
 */
export function switchThemeAnimated(nextMode, origin) {
    if (typeof document === 'undefined')
        return;
    const root = document.documentElement;
    const isReducedMotion = typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const apply = () => {
        root.dataset.theme = nextMode;
        root.style.colorScheme = nextMode;
    };
    const startViewTransition = getStartViewTransition();
    if (startViewTransition && !isReducedMotion) {
        const radius = spreadRadius(origin);
        const transition = startViewTransition(apply);
        // ready 之后才能动 pseudoElement；await 形式满足 promise/prefer-await-to-then
        void (async () => {
            await transition.ready;
            // 个别老 WebView 可能没有 Web Animations API：缺失则跳过扩散动画，主题已切好
            if (typeof root.animate !== 'function')
                return;
            root.animate({
                clipPath: [
                    `circle(0px at ${String(origin.x)}px ${String(origin.y)}px)`,
                    `circle(${String(radius)}px at ${String(origin.x)}px ${String(origin.y)}px)`,
                ],
            }, { duration: 500, easing: 'ease-in', pseudoElement: '::view-transition-new(root)' });
        })();
        return;
    }
    if (isReducedMotion) {
        apply();
        return;
    }
    runRippleFallback(apply, origin);
}
/**
 * 覆盖层降级：旧主题色圆环从满屏收缩到点击点，露出下面的新主题
 *
 * 覆盖层色取**切换前**的 `--bg-app`（切换瞬间页面还是旧主题），所以动画起点
 * 与旧页面无缝；收缩到 0 后移除，剩下的是新主题。
 */
function runRippleFallback(apply, origin) {
    const root = document.documentElement;
    const previousBackground = getComputedStyle(root).getPropertyValue('--bg-app').trim() || '#000';
    const overlay = document.createElement('div');
    overlay.className = 'theme-ripple-overlay';
    overlay.style.setProperty('--ripple-x', `${String(origin.x)}px`);
    overlay.style.setProperty('--ripple-y', `${String(origin.y)}px`);
    overlay.style.setProperty('--ripple-radius', `${String(spreadRadius(origin))}px`);
    overlay.style.background = previousBackground;
    document.body.append(overlay);
    // 动画中点切主题：覆盖层仍盖着，用户看不到切换瞬间，只看到圆环收缩
    window.setTimeout(apply, 150);
    window.setTimeout(() => {
        overlay.remove();
    }, 520);
}
/**
 * 保存主题并立即应用。
 * @returns 是否保存成功
 */
export function saveTheme(mode) {
    if (mode !== 'dark' && mode !== 'light' && mode !== 'system' && mode !== 'schedule')
        return false;
    const isOk = setTheme(mode);
    if (isOk)
        applyTheme(mode);
    return isOk;
}
/**
 * 初始化主题：从配置读取并应用；若为「跟随系统」则监听系统外观变化。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 */
/**
 * 初始化主题：从配置读取并应用；system 监听系统外观，schedule 起定时轮询。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 */
export function initializeTheme() {
    const mode = getTheme(true);
    applyTheme(mode);
    systemMedia?.addEventListener('change', () => {
        if (getTheme(true) === 'system')
            applyTheme('system');
    });
    // 定时模式常驻轮询（其它模式下每 30s 一次空转解析，开销可忽略）
    startThemeScheduleWatch();
}
/**
 * 启动定时切换轮询（schedule 模式）
 *
 * 每 30s 看一次时钟：到点（该深了/该浅了）就 applyTheme。其它模式下定时器
 * 空转（一次解析 + 比较，可忽略），不白起线程；切换方向变了才写样式。
 *
 * @returns 停止轮询的函数
 */
/** 非 DOM 环境（SSR / 测试）下的空退订函数 */
function noopUnsubscribe() {
    // 没有订阅，无需退订
}
export function startThemeScheduleWatch() {
    if (typeof window === 'undefined')
        return noopUnsubscribe;
    let lastApplied = resolveTheme(getTheme(true));
    const timer = window.setInterval(() => {
        try {
            const mode = getTheme(true);
            const resolved = resolveTheme(mode);
            if (resolved !== lastApplied) {
                lastApplied = resolved;
                applyTheme(mode);
            }
        }
        catch {
            // 静默处理偶发读取异常，轮询继续
        }
    }, SCHEDULE_TICK_MS);
    return () => {
        window.clearInterval(timer);
    };
}
/**
 * 跨页主题同步：订阅共享配置轮询，主题变化时重新应用。
 *
 * WPS 中每个任务窗格是独立 WebView，postMessage 无法跨上下文广播，
 * 因此在 settings 页切换主题后，panel / enrich 页需定期从 PluginStorage
 * 读取最新主题并 `applyTheme`，实现「所有页面同时变色」。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 *
 * 轮询本体在 `tools/config-poll.ts`（单定时器 + 键去重 + 隐藏跳过 + 原生下拉
 * 交互让路）——此前这里自带 2s `setInterval`，与另外三个同步模块叠加成
 * 「5 次 COM 读 / 2s、每 400ms 一次微卡顿」，真机上让原生 `<select>` 下拉卡顿。
 */
export function startThemeSync() {
    if (typeof window === 'undefined')
        return noopUnsubscribe;
    let lastApplied = resolveTheme(getTheme(true));
    return subscribeConfigPoll({
        // 定时时刻也进轮询键：settings 改了 darkStart/lightStart，其它页面下一次
        // 轮询就按新时刻重解析，不用等本页 30s 的定时器
        keys: [CONFIG_KEYS.THEME, CONFIG_KEYS.THEME_SCHEDULE],
        apply: () => {
            try {
                // system 模式下 resolveTheme 会随系统外观变化，因此比较解析值即可同时捕获
                // 配置变更与系统外观切换，变化时才重应用样式。
                const mode = getTheme(true);
                const resolved = resolveTheme(mode);
                if (resolved !== lastApplied) {
                    lastApplied = resolved;
                    applyTheme(mode);
                }
            }
            catch {
                // 静默处理偶发读取异常，轮询继续
            }
        },
    });
}
