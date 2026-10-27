/**
 * @fileoverview 窗口能力原语：吞拖拽后的 click / 缩放 / 最大化
 * @module ui/components/windowChrome
 * @description 模态框（modal-drag）与浮动窗（detachable-panel）的「窗口 chrome」
 *   能力收敛于此——两边的拖动/收起/缩放曾各写一份，钳制口径、超时兜底容易漂移
 *   （momo：模态框组件和浮动窗口组件功能能否统一）。
 *
 *   **统一的是能力原语，不是组件本体**：遮罩模态框是一次性居中交互（开时重置
 *   居中、关即销毁），浮动窗是常驻面板（DOM 搬家 + 几何记忆 + 可停靠），生命周期
 *   完全不同，硬合一个组件只会把两边都搞复杂。本模块先收编跨组件复用的部分：
 *   - {@link suppressPostDragClick}：原 modal-drag / sortable-list 各一份同源实现；
 *   - {@link bindModalResize}：模态框右下角缩放把手（浮动窗的缩放范式 + 模态框
 *     的 fixed 抬升基准，见 modal-drag.bindModalDrag）；
 *   - {@link bindModalMaximize}：标题栏 ⛶ 最大化 / 还原（对齐浮动窗的最大化），
 *     几何走内联样式快照，还原即回到拖动/缩放留下的位置或 CSS 居中。
 *
 *   detachable-panel 自身的拖动/缩放暂未迁入：它带 transform 合成层与几何记忆，
 *   迁移是独立的重构，见模块尾注。
 */
/** 拖拽/缩放结束后吞掉那一次 click
 *
 * 模态框拖离遮罩中心后，松手时浏览器补发的 click 落在**遮罩空白处**
 * （modal 已经不在原位置），而「点遮罩关闭」的判定是 `event.target === mask`
 * ——于是「一拖动就关闭」（momo 实测：导入弹窗拖一下就没了）。
 *
 * window 上加一次 capture 阶段拦截，拦掉那一次 click 后自摘。**必须带超时
 * 兜底**——pointerup 后不一定紧跟 click（触摸 / 触控笔场景就没有），拦截器
 * 挂着不摘会把用户之后真正的点击也吞掉。
 */
export declare function suppressPostDragClick(): void;
/** 最大化态的类名（bindModalDrag 见它即不启动拖动：最大化后拖标题无意义） */
export declare const MODAL_MAXIMIZED_CLASS = "is-maximized";
/**
 * 兜底自检：弹窗被摆到可见区之外时调 `reset` 复位
 *
 * 为什么需要：宿主对定位的解析可能与我们的假设不一致（历史上遮罩用 fixed 时
 * 「弹窗出现在页面上方、窗口外」），一旦弹窗跑出可见区，**遮罩还在页面上**——
 * 用户看到的就是「弹窗没了、页面整块发黑」（momo 2026-10-25）。与其赌宿主，
 * 不如每次改完几何量一次：完全出界就复位回遮罩居中，弹窗和遮罩始终成对出现。
 *
 * 判据用 window.innerWidth/Height：宿主若把它们报成整份文档高，这里就偏宽松
 * （判不出来），但绝不会误复位——宁可漏判也不能把好端端的弹窗弹回去。
 */
export declare function ensureModalVisible(modal: HTMLElement, reset: () => void): void;
/** 定位层的可用尺寸（模态框可活动的范围）
 *
 * 取**定位包含块的 padding box**（absolute 子元素的包含块 = offsetParent），
 * 而不是 `window.innerWidth/Height`：本项目遮罩是「absolute + top=scrollY 锚定
 * 当前可见区」（见 conditional-format.css 的 .conditional-format-modal-mask），
 * 它本身就是「当前可见区在文档里的镜像」，用它当边界天然正确；而 window 尺寸
 * 在 WPS 宿主下会失真（"iframe 视口 = 内容全高"模型下 innerHeight 是整份文档
 * 高），拿它当边界会把弹窗放到看不见的地方。
 *
 * 没有定位祖先（offsetParent 为 null，含 jsdom）时回退视口尺寸。
 */
export declare function modalLayerSize(modal: HTMLElement): {
    width: number;
    height: number;
};
/**
 * 把 flex 流中的模态框抬升为「定位层」：absolute + 显式 left/top（相对包含块）
 *
 * **为什么不是 fixed**：本项目的 WPS 宿主对 `position: fixed` 的包含块解析
 * 不是视口（实测记录：遮罩用 `fixed + inset:0` 时"弹窗出现在页面上方、窗口
 * 外"）——fixed 元素被摆到了**文档**坐标上，而任务窗格只显示文档的一小段，
 * 于是「一拖动 / 一点最大化就消失」。遮罩改用 absolute + top=scrollY 锚定后
 * 弹窗才稳定可见，说明宿主只认文档流坐标。故拖动 / 缩放 / 最大化一律抬升为
 * **absolute**（包含块 = 遮罩，与已验证有效的锚定方案同基准），不碰 fixed。
 *
 * 抬升时的坐标换算用「置零测差」：先切 absolute 并把 left/top 写 0，量一次
 * 得到包含块原点的视口位置，再用它与原位置求差 —— 手算遮罩 padding / border
 * 容易偏，量一次最稳。
 *
 * @returns 抬升后相对包含块的 left/top（视觉位置与抬升前一致）
 */
export declare function promoteToModalLayer(modal: HTMLElement): {
    left: number;
    top: number;
};
/**
 * 给模态框绑右下角缩放把手
 *
 * 缩放起点先把模态框抬升为 fixed（与拖动同款：记当前视口矩形作基准），
 * 否则 flex 居中的子项改宽高会两边对称长、把手抓的点就漂了。宽高 rAF 合帧，
 * 钳制在 `[min, 视口-当前left/top-留隙]`——放大不超出视口（任务窗格就是
 * iframe 视口），缩小不小于保底。
 *
 * 缩放过的模态框挂 `is-resized` 类：CSS 借它把内容区（如导入列表）从
 * 「定高滚动」切换成「吃满剩余高度」，放大才有意义。
 */
export declare function bindModalResize(options: {
    modal: HTMLElement;
    handle: HTMLElement;
}): void;
/**
 *
 * 最大化 = 定位层内铺满遮罩（= 当前可见区）；还原 = 写回最大化前抓的内联
 * 几何快照（可能是拖动/缩放留下的位置，也可能是空——空值 removeProperty，
 * 元素回 CSS 居中）。状态以 `is-maximized` 类为准（外部清类后按钮再点会
 * 重新走最大化分支，不会拿旧快照套错）。
 *
 * 最大化后也做一次 {@link ensureModalVisible} 自检：真出界就当场还原，
 * 不让「弹窗没了、遮罩黑层还盖着页面」的失败模式出现。
 */
export declare function bindModalMaximize(options: {
    modal: HTMLElement;
    button: HTMLElement;
}): void;
/** detachable-panel 迁移尾注：浮动窗的 bindDrag / 缩放 / 最大化带 transform
 * 合成层与 PluginStorage 几何记忆，迁到本模块须先抽「几何记忆」接口，
 * 避免为统一而把面板特有逻辑反向灌进通用层。 */
//# sourceMappingURL=window-chrome.d.ts.map