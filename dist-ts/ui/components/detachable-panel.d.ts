/**
 * @fileoverview 可拖出浮动窗口的通用组件（detachable panel）
 * @module ui/components/detachablePanel
 * @description 把页面上任意「区块」按需拖出成一个独立浮动窗口：可拖动、可缩放、
 *   可最大化、可收起，关掉后原样回到页面原位。
 *
 * ## 为什么要做成组件（而不是每页手写一份）
 * 第一版是条件格式页专用的 `#conditionalFormatFloat`：一个页面一套 DOM、一套 CSS、
 * 一套拖动逻辑。用户要「所有页面能应用的都应用」时，复制 6 份必然漂移。
 * 抽成组件后，页面侧只需要一个属性：
 * ```html
 * <section id="sec-preview" data-detachable data-detachable-title="执行前预览"> … </section>
 * ```
 *
 * ## 四条硬约束
 * 1. **默认在页面上**：不拖出时就是普通 section，组件不改变任何既有布局与交互。
 *    浮动是**可选项**，用户主动点「⧉」才发生。
 * 2. **搬家而非复制**：拖出时把 section 这个 DOM 节点**整体移动**到浮动窗口 body，
 *    关闭时搬回原父节点的原位置（记住原下一个兄弟节点，避免排到 section 末尾）。
 *    复制一份会出现「浮动窗口里删了规则、正文列表还在」的两份视图漂移；
 *    搬家后事件监听随节点走，**页面代码继续 `getElementById` 读写同一份 DOM** ——
 *    这就是「原页面在变化」的实现方式：不是同步，是同一份。
 * 3. **几何计算是纯函数**：`(起点, 位移, 视口, 下限) → 新值`，没有 DOM 依赖，
 *    可以直接在 Node 下单测越界钳制与最小尺寸。DOM 层只负责把算出的值写回 style。
 * 4. **拖出后原位置留占位块**：否则正文会突然塌陷一大块，用户以为内容丢了。
 *    占位块上带「收回」按钮，给出明确回路。
 *
 * ## 交互细节（真机踩过或一定会踩的坑）
 * - `setPointerCapture`：不用的话鼠标挪快了移出标题栏就「脱轨」，之后收不到
 *   pointermove，窗口粘在鼠标上直到用户再点一次；
 * - `hasPointerCapture` 守卫后再 `releasePointerCapture`：pointercancel 时浏览器
 *   已经自动释放，直接 release 会抛 NotFoundError；
 * - 视口尺寸读 `window.innerWidth/Height`：便宜且不触发重排；真正要避的是在 move
 *   回调里读 `offsetWidth` / `getBoundingClientRect()`（强制同步布局，每帧抖一次），
 *   故尺寸全程由 `rect` 状态维护，拖动只做加法；
 * - 拖动写 `transform: translate()` 而不是 `left/top`：后者每帧变一次，浏览器就要
 *   重排 + 重绘整个面板内容（预览表 / 规则表几百行时一帧几十毫秒，实测拖起来
 *   明显掉帧）；transform 命中合成层（配合 `.is-dragging` 的 `will-change` 提示），
 *   每帧只做一次层平移，内容一次都不用重画。位移在 pointerup 时一次性提交回
 *   left/top —— 几何的单一来源始终是 `rect`，transform 只在拖动期存在；
 * - 位置钳制在视口内：不允许把窗口拖到屏幕外（否则找不回来，只能刷新任务窗格）。
 */
/** 视口尺寸（拖动 / 缩放开始时读一次） */
export interface ViewportSize {
    width: number;
    height: number;
}
/** 面板矩形：位置 + 尺寸（内联样式的唯一来源） */
export interface PanelRect {
    left: number;
    top: number;
    width: number;
    height: number;
}
/** 面板尺寸下限（再小内容就被裁没了） */
export declare const MIN_PANEL_WIDTH = 360;
export declare const MIN_PANEL_HEIGHT = 200;
/** 收起后只剩标题栏的高度 */
export declare const COLLAPSED_HEIGHT = 40;
/** 未指定尺寸时的默认窗口大小 */
export declare const DEFAULT_PANEL_WIDTH = 720;
export declare const DEFAULT_PANEL_HEIGHT = 520;
/**
 * 浮动窗比区块多出来的 chrome 高度估计（标题栏 + body 内边距 + 卡片皮差）
 *
 * 自适应尺寸时给区块测量值加这个余量：少了它窗口底部会差一两行、
 * 出现本不该有的滚动条。
 */
export declare const PANEL_CHROME_ALLOWANCE = 48;
/**
 * 钳制拖动后的位置：窗口必须完整留在视口内
 *
 * 允许负 left/top 吗？不允许 —— 负值会把标题栏推到视口外，用户再也抓不回来。
 */
export declare function clampPosition(position: {
    left: number;
    top: number;
}, size: {
    width: number;
    height: number;
}, viewport: ViewportSize): {
    left: number;
    top: number;
};
/**
 * 钳制缩放后的尺寸：不小于下限、不大于视口
 *
 * 宽高都保底：只保宽不保高的话用户能把面板压成一条线，内容全被裁掉。
 */
export declare function clampSize(size: {
    width: number;
    height: number;
}, viewport: ViewportSize): {
    width: number;
    height: number;
};
/** 收起 / 展开时的目标高度：收起收到标题栏一行，展开还原（不低于下限） */
export declare function nextPanelHeight(currentHeight: number, isCollapsed: boolean, restoredHeight: number): number;
/**
 * 新窗口的默认位置：居中后再按已开数量做阶梯偏移
 *
 * 阶梯偏移是必须的：不开偏移的话连开三个窗口会严丝合缝叠在一起，
 * 用户只看到「没反应」。
 */
export declare function defaultPanelRect(openCount: number, viewport: ViewportSize, desiredWidth?: number, desiredHeight?: number): PanelRect;
/** 单个可拖出面板的对外句柄 */
export interface DetachablePanelHandle {
    /** 拖出为浮动窗口 */
    readonly detach: () => void;
    /** 收回页面原位 */
    readonly attach: () => void;
    /** 开 / 关切换 */
    readonly toggle: () => void;
    /** 当前是否已拖出 */
    readonly isDetached: () => boolean;
    /** 解绑并移除浮动窗口（页面销毁时调用） */
    readonly destroy: () => void;
}
/** 创建单个可拖出面板时的可选项（`| undefined` 是 `exactOptionalPropertyTypes` 要求） */
export interface DetachablePanelOptions {
    /** 窗口标题；缺省取区块标题元素（h3/h2）的文本 */
    title?: string | undefined;
    /** 初始宽度（px） */
    width?: number | undefined;
    /** 初始高度（px） */
    height?: number | undefined;
    /** 挂进窗口标题栏的工具条元素（随窗口显示，不随内容搬家） */
    toolbar?: HTMLElement | null | undefined;
    /** 外部已有的触发按钮（例：条件格式页的「工作表规则」） */
    trigger?: HTMLElement | null | undefined;
    /**
     * 拖出方式
     * - `float`（默认）：任务窗格内的浮动窗口，可拖动 / 缩放，但出不了窗格边界；
     * - `native`：宿主原生独立窗口，能浮到 WPS 表格上面、能最大化。
     *   宿主不支持时**自动回落**到 `float`，不会变成点了没反应。
     */
    mode?: DetachableMode | undefined;
    /**
     * `native` 模式下窗口要加载的页面（相对当前页面解析，见 `resolveDialogUrl`）
     *
     * 必须是**独立页面**：原生对话框是另一个 WebView，拿不到本页的 DOM，
     * 搬不了节点。页面里要自己装配同一套逻辑（对话框页复用 `conditional-format-page.js`）。
     */
    nativeUrl?: string | undefined;
    /** 拖出后回调（页面可借此刷新一次数据） */
    onDetach?: (() => void) | undefined;
    /** 收回后回调 */
    onAttach?: (() => void) | undefined;
}
/** 触发按钮的类名（样式 + 测试定位） */
export declare const TRIGGER_BUTTON_CLASS = "detachable-trigger";
/** 占位块的类名 */
export declare const PLACEHOLDER_CLASS = "detachable-placeholder";
/** 浮动窗口根元素类名 */
export declare const PANEL_CLASS = "detachable-panel";
/** 拖出方式 */
export type DetachableMode = 'float' | 'native';
/**
 * 把区块变成可拖出的
 *
 * @param section 要被搬家的区块（通常是 `<section>`）
 * @param options 可选项；不传时全部从 `data-detachable-*` 属性读
 * @returns 句柄；入参不是 HTMLElement 时返回 null（页面侧直接 `?.` 即可）
 */
export declare function createDetachablePanel(section: HTMLElement, options?: DetachablePanelOptions): DetachablePanelHandle | null;
/** 给文档里所有 `[data-detachable]` 区块装上拖出能力 */
export declare function setupDetachablePanels(scope?: ParentNode): DetachablePanelHandle[];
/** 供测试 / 调试：清空模块级状态 */
export declare function resetDetachablePanelsForTest(): void;
/** 菜单根元素类名（样式 + 测试定位） */
export declare const WINDOW_MENU_CLASS = "detachable-window-menu";
/** 关闭所有已拖出的浮动窗口（内容各自还原回页面原位） */
export declare function closeAllDetachedPanels(): number;
//# sourceMappingURL=detachable-panel.d.ts.map