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
import type { ThemeMode } from './config.js';
/**
 * 解析最终主题：system 按系统外观、schedule 按定时配置解析为 light / dark。
 */
export declare function resolveTheme(mode: ThemeMode): 'dark' | 'light';
/**
 * 将主题应用到 <html> 元素（data-theme 属性 + color-scheme）。
 */
export declare function applyTheme(mode: ThemeMode): void;
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
export declare function switchThemeAnimated(nextMode: 'dark' | 'light', origin: {
    x: number;
    y: number;
}): void;
/**
 * 保存主题并立即应用。
 * @returns 是否保存成功
 */
export declare function saveTheme(mode: string): boolean;
/**
 * 初始化主题：从配置读取并应用；若为「跟随系统」则监听系统外观变化。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 */
/**
 * 初始化主题：从配置读取并应用；system 监听系统外观，schedule 起定时轮询。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 */
export declare function initializeTheme(): void;
export declare function startThemeScheduleWatch(): () => void;
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
export declare function startThemeSync(): () => void;
export { type ThemeMode } from './config.js';
//# sourceMappingURL=theme.d.ts.map