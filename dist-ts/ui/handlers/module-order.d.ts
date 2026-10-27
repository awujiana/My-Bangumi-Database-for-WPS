/**
 * @fileoverview 设置页「模块排序」编辑器
 * @module ui/handlers/module-order
 * @description 从 tools/nav-order 的模块注册表渲染各页面的可排序模块清单，
 *              提供 ↑↓ 按钮（键盘可达、WPS 中最稳）与鼠标拖拽两种排序方式。
 *
 * 设计要点：
 *  - 清单由注册表驱动，新增/删除模块无需改本文件或 HTML；
 *  - 事件用容器级委托绑定（列表会随排序整体重渲染，逐项绑定会失效）；
 *  - 自定义属性 `data-mod-move` / `data-mod-reset` 而非 `data-action`，
 *    避免与 setupButtonListeners 的一次性绑定机制互相干扰。
 */
/** 渲染（或重渲染）整个排序编辑器 */
export declare function renderModuleOrderEditor(): void;
/**
 * 跨页刷新：其他任务窗格改动排序后，本页编辑器里的清单会变旧。
 * 与 nav-order 的同步策略一致，轮询 PluginStorage 中的排序配置，变化时重渲染。
 * @returns 清理函数（清除定时器）
 */
export declare function startModuleOrderSync(): () => void;
/**
 * 初始化模块排序编辑器：渲染清单并绑定容器级事件委托。
 * 仅在存在 `#moduleOrderGroups` 的设置页生效，其余页面静默跳过。
 */
export declare function initializeModuleOrderEditor(): void;
//# sourceMappingURL=module-order.d.ts.map