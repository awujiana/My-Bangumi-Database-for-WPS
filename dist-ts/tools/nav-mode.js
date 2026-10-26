/**
 * @fileoverview 导航显示模式跨页同步
 * @module tools/navMode
 * @description WPS 中每个任务窗格是独立 WebView，postMessage 无法跨上下文广播，
 *              因此在 settings 页勾选/取消「导航仅显示图标」后，panel / enrich 页
 *              需定期从 PluginStorage 读取最新配置并切换 body.nav-icons-only 类，
 *              实现「三个页面同时生效」。各页面入口（panel / settings / enrich）
 *              在启动时调用一次。
 */
import { CONFIG_KEYS, areNavIconsOnly } from './config.js';
import { subscribeConfigPoll } from './config-poll.js';
/** 应用或移除「图标仅显示」模式；布局变化后触发 resize 让 shell-nav 重测胶囊位置 */
function applyNavMode(isEnabled) {
    if (typeof document === 'undefined')
        return;
    const wasEnabled = document.body.classList.contains('nav-icons-only');
    if (wasEnabled === isEnabled)
        return;
    document.body.classList.toggle('nav-icons-only', isEnabled);
    // 导航宽度变化后，滚动高亮胶囊 / 吸顶偏移需按新布局重测
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('resize'));
    }
}
/**
 * 跨页导航模式同步：订阅共享配置轮询，「导航仅显示图标」变化时切换
 * body.nav-icons-only 类并重测导航布局。
 *
 * 轮询本体在 `tools/config-poll.ts`（单定时器 + 键去重 + 隐藏跳过 + 原生下拉
 * 交互让路）；此前这里自带 2s `setInterval`。
 */
/** 非 DOM 环境（SSR / 测试）下的空退订函数 */
function noopUnsubscribe() {
    // 没有订阅，无需退订
}
export function startNavModeSync() {
    if (typeof window === 'undefined')
        return noopUnsubscribe;
    let wasEnabled = areNavIconsOnly(true);
    applyNavMode(wasEnabled);
    return subscribeConfigPoll({
        keys: [CONFIG_KEYS.NAV_ICONS_ONLY],
        apply: (values) => {
            const isCurrentlyEnabled = values[CONFIG_KEYS.NAV_ICONS_ONLY] === 'true';
            if (isCurrentlyEnabled === wasEnabled)
                return;
            wasEnabled = isCurrentlyEnabled;
            applyNavMode(isCurrentlyEnabled);
        },
    });
}
