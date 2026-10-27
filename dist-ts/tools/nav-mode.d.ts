/**
 * @fileoverview 导航显示模式跨页同步
 * @module tools/navMode
 * @description WPS 中每个任务窗格是独立 WebView，postMessage 无法跨上下文广播，
 *              因此在 settings 页勾选/取消「导航仅显示图标」后，panel / enrich 页
 *              需定期从 PluginStorage 读取最新配置并切换 body.nav-icons-only 类，
 *              实现「三个页面同时生效」。各页面入口（panel / settings / enrich）
 *              在启动时调用一次。
 */
export declare function startNavModeSync(): () => void;
//# sourceMappingURL=nav-mode.d.ts.map