/**
 * @fileoverview 模态框拖动与「拉回可见区」（纯 DOM，零 WPS 依赖，可 jsdom 单测）
 * @module ui/components/modalDrag
 * @description 遮罩式模态框（条件格式页的规则编辑器 / 导入手工规则 / 归组命名 /
 *   双策略确认）此有两个实测缺陷（2026-10-24 用户反馈）：
 *
 *   1. **拖不动**：模态框是遮罩 flex 居中的子项，位置完全由 CSS 决定——任务窗格
 *      窄、宿主滚动模型各异时它可能落在半屏外，用户却没有任何办法移动它；
 *   2. **显示不全**：遮罩用 absolute + top=scrollY 锚定文档，模态框 max-height 用
 *      `calc(100vh - 64px)`；宿主「iframe 视口 = 内容全高」或页面滚动后，
 *      模态框会整体落在可见区外（截图：标题栏被切掉半个）。
 *
 *   本模块补三能力：
 *   - {@link bindModalDrag}：按住标题栏把手拖动模态框。指针按下时把模态框抬升为
 *     `position: fixed`（基准几何 = 当前视口矩形），位移 rAF 合帧（一帧至多写一次
 *     样式，指针事件快于屏幕刷新时不掉帧），并做视口钳制——横向允许露头但保证
 *     ≥96px 可抓宽度，纵向钳在 `[0, 视口高-40]`：「拖出去找不回来」是最糟的
 *     失败模式（与 detachable-panel 的 bindDrag 同口径）。**拖过之后吞掉松手
 *     补发的那一次 click**（否则 modal 拖离遮罩中心后，click 落在遮罩空白处，
 *     「点遮罩关闭」逻辑会把弹窗点关——momo 实测「一拖动就关闭」）。
 *   - {@link bringModalIntoView}：打开后量一次，越界就 scrollBy 修正并重锚遮罩
 *     top——修「iframe 内部滚动」宿主模型下的显示不全；「iframe=内容全高」模型
 *     下 window 不可滚（scrollBy 是 no-op），此时靠拖动兜底。
 *
 *   与 detachable-panel 的 bindDrag 的分工：那个服务「区块拖出为浮动窗口」
 *   （transform 合成层 + pointerup 时落 left/top），本模块服务「遮罩内小模态框」
 *   （直接写 left/top，没有可复用的基准几何）。事件监听挂 **window** 而不是
 *   把手 + setPointerCapture：老宿主 / jsdom 没有指针捕获 API，window 监听
 *   在两者下都能完整收到 move/up（拖到遮罩外也不丢事件）。
 *
 *   收起 / 最大化 / 缩放三件套在 window-chrome（模态框与浮动窗共用的窗口
 *   能力层）；本模块只保留拖动与拉回可见区这两个遮罩模态框特有能力。
 */
/**
 * 给模态框绑「拖标题栏移动」
 *
 * 拖动开始时把模态框抬升为 fixed（记下当前视口矩形作基准），结束时保留
 * left/top（停在用户放的位置）；下次打开由 {@link resetModalPosition} 清回
 * CSS 居中，不记住上次位置（模态框是「一次性」交互，重新居中最好找）。
 */
export declare function bindModalDrag(options: {
    modal: HTMLElement;
    grip: HTMLElement;
}): void;
/**
 * 清掉拖动 / 缩放 / 最大化 / 收起留下的状态，让模态框回到遮罩的 CSS 居中位
 *
 * 打开模态框前调用（每次打开都重新居中 + 展开，不记住上次的几何与会话态）。
 */
export declare function resetModalPosition(modal: HTMLElement): void;
/**
 * 打开后把模态框拉回可见区（iframe 内部滚动模型下修正「显示不全」）
 *
 * 量模态框矩形：顶部越界 → 向下滚到底部对齐；底部越界 → 向上滚。滚动后
 * **必须重锚遮罩 top**——遮罩是 absolute 相对文档的，不跟着走就会错位
 * （anchored top 还是旧 scrollY，遮罩盖住的是滚走前的区域）。
 *
 * 「iframe 视口 = 内容全高」的宿主模型下 window 不可滚，scrollBy 是 no-op，
 * 重锚写的是同一个值，无害；那种模型只能靠拖动兜底（见模块注释）。
 */
export declare function bringModalIntoView(mask: HTMLElement, modal: HTMLElement): void;
/**
 * 给模态框标题栏的收起按钮绑「收起 / 展开」
 *
 * 收起 = 只留标题栏一行（body / footer 用 CSS 藏掉），再点展开——
 * 与 detachable-panel 浮动窗的 ▾/▸ 同范式（momo：确认框要能收起，
 * 范围看完先收起来，别一直挡着后面的表格）。
 *
 * 只切 class + 改 aria，不碰几何：拖过的位置（fixed + left/top）不受影响，
 * 展开后还在原处。按钮文字 ▾↔▸ 与模块折叠按钮一致。
 */
export declare function bindModalCollapse(options: {
    modal: HTMLElement;
    button: HTMLElement;
}): void;
//# sourceMappingURL=modal-drag.d.ts.map