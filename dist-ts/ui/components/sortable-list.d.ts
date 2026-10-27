/**
 * @fileoverview 可拖拽排序列表（dnd-kit 核心范式的轻量实现，零依赖）
 * @module ui/components/sortableList
 * @description 条件格式规则此前只能靠行内 ↑/↓ 一格格调优先级——38 条规则把
 *   一条从第 30 位移到第 5 位要点 25 次。本组件把「拖拽重排」补上，并对齐
 *   dnd-kit（React 生态最常用 DnD 库）的四个招牌能力：
 *
 *   1. **指针传感器 + 激活阈值**：按下后移动超过阈值（默认 5px）才进入拖拽，
 *      单击（点按钮 / 进编辑）完全不受影响——与 dnd-kit PointerSensor 的
 *      activation constraint 同思路；
 *   2. **碰撞检测**：指针落在项的中点上半 → 插它前面，下半 → 插后面
 *      （closest-center 的简化：列表只有一维，中点法即最优解）；
 *   3. **拖拽 overlay + 放置指示线 + 放置动画**：拖的是一个克隆浮层（原项变
 *      虚线占位），松手时浮层动画落到新位置后再销毁，不是生硬跳变；
 *   4. **完整键盘排序（dnd-kit 的招牌无障碍）**：项可 Tab 聚焦，Space 拾起、
 *      ↑↓ 移动（DOM 实时换位给预览）、Space 放置、Esc 取消，全程 aria-live
 *      播报——鼠标不是唯一输入方式。
 *
 *   另外补两条工程细节：指针贴视口 / 容器边缘时**自动滚动**（长列表拖到
 *   屏幕边不用手动滚）；拖拽中产生的那次 click 会被吞掉（否则送进的鼠标
 *   事件会误触发行内按钮）。
 *
 *   与 detachable-panel 的 bindDrag 分工：那个服务「区块拖出为浮动窗口」
 *   （transform 合成层 + 提交时落 left/top），本模块服务「列表内排序」
 *   （克隆 overlay + 中点碰撞 + 键盘传感器）。
 */
/** 重排事件：fromId 移到了 overId 的前面（placeAfter=false）或后面 */
export interface SortableReorderEvent {
    /** 被拖项的 id（getItemId 的返回值） */
    fromId: string;
    /** 落点项的 id；null = 移到了列表末尾 */
    overId: string | null;
    /** 落在 overId 之后（true）还是之前（false） */
    placeAfter: boolean;
    /** 目标下标（当前 DOM 序，仅供参考；调用方一般用 id 自己算） */
    toIndex: number;
    /** 提交时的 DOM 序 id 列表 */
    ids: string[];
}
/** createSortable 的选项 */
export interface SortableOptions {
    /** 列表容器（事件委托挂这里；DOM 重渲染后调 refresh 重新扫描） */
    container: HTMLElement;
    /** 可拖拽项选择器（相对容器；分组标题 / 表头等非项元素天然排除） */
    itemSelector: string;
    /** 从项元素取稳定 id（重渲染前后不变；规则用 rule id，表格行用行号） */
    getItemId: (item: HTMLElement) => string;
    /** 提交重排（同步改数据 + 重渲染；返回 Promise 时等它 resolved 再播放置动画） */
    onReorder: (event: SortableReorderEvent) => void | Promise<void>;
    /** 拖拽把手选择器（不传 = 整行可拖，但按钮 / 输入框上的按下不启动） */
    handleSelector?: string;
    /** 拾起阈值（px，默认 5）：小于它的位移算单击，不进入拖拽 */
    activationDistance?: number;
    /** 禁用开关（返回 true 时拖拽与键盘排序都不响应，如 COM 忙 / 搜索态） */
    isDisabled?: () => boolean;
    /**
     * 松手后是否播放「浮层飞到新位置」的落位动画（默认 true）。
     *
     * 关掉它的场景：**提交后项的 id 会变**——如既有规则表格用行号当 id，移动后
     * 行号整体漂移，按旧 id 找不到「移动后的项」，动画会飞到占了旧行号的那个
     * 规则上（视觉错位）。这种列表提交后整表重渲染，直接撤浮层即可。
     */
    animateDrop?: boolean;
    /** 自定义播报（默认写进容器内的 live region） */
    announce?: (message: string) => void;
}
/** createSortable 的返回值 */
export interface SortableHandle {
    /** 容器 DOM 重渲染后必须调用：重新扫描项、补 tabindex 与 aria */
    refresh: () => void;
    /** 卸载：摘全部监听、清 live region */
    destroy: () => void;
    /** 当前是否在拖（页面可用来抑制其它交互） */
    isDragging: () => boolean;
}
/** 一维列表的数组搬运（纯函数，单测直测） */
export declare function moveInArray<T>(items: readonly T[], fromIndex: number, toIndex: number): T[];
/** 碰撞检测的输入：项的中线与高度（DOM 序） */
export interface DropProbe {
    id: string;
    top: number;
    height: number;
}
/** 碰撞检测的输出 */
export interface DropTarget {
    /** 指针落在哪项上；null = 列表末尾之后 */
    overId: string | null;
    /** 落点是该项之后（true）还是之前（false） */
    placeAfter: boolean;
    /** 插入下标（DOM 序） */
    index: number;
}
/**
 * 中点碰撞检测（纯函数）：指针 y 小于项中心 → 插前面；遍历完都没超过 → 末尾
 *
 * dnd-kit 的 closestCenter 在多列布局里要找「最近中心」，一维列表里中点法
 * 与它等价且不需要距离比较：从上往下找到第一个「指针在中点之上」的项即可。
 */
export declare function computeDropTarget(probes: readonly DropProbe[], pointerY: number): DropTarget;
/** 键盘移动的目标下标（钳在 [0, count-1]，不循环——dnd-kit sortable 同口径） */
export declare function keyboardMoveIndex(current: number, delta: number, count: number): number;
/**
 * 把容器变成一个可拖拽排序列表
 *
 * 用法：`const sortable = createSortable({...})`；容器 DOM 重渲染后（页面
 * render 函数末尾）调 `sortable.refresh()` 重新扫描项；卸载时 `destroy()`。
 */
export declare function createSortable(options: SortableOptions): SortableHandle;
//# sourceMappingURL=sortable-list.d.ts.map