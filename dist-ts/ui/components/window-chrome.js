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
export function suppressPostDragClick() {
    let isRemoved = false;
    // handler 先持变量、后赋值：remove 与 handler 互相引用，
    // 任一定义在前都踩 no-use-before-define
    let handler = null;
    const remove = () => {
        if (isRemoved)
            return;
        isRemoved = true;
        if (handler)
            window.removeEventListener('click', handler, { capture: true });
    };
    handler = (event) => {
        event.stopPropagation();
        event.preventDefault();
        remove();
    };
    window.addEventListener('click', handler, { capture: true });
    window.setTimeout(remove, 300);
}
/** 最大化态的类名（bindModalDrag 见它即不启动拖动：最大化后拖标题无意义） */
export const MODAL_MAXIMIZED_CLASS = 'is-maximized';
/** 缩放后的最小尺寸：低于它内容被裁没、把手也按不准（对齐浮动窗的保底思路） */
const MIN_MODAL_WIDTH = 280;
const MIN_MODAL_HEIGHT = 120;
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
export function ensureModalVisible(modal, reset) {
    const rect = modal.getBoundingClientRect();
    // 零面积 = 还没布局（jsdom / 未渲染）：量不出位置，不判——免得把好弹窗复位掉
    if (rect.width === 0 && rect.height === 0)
        return;
    const isOffscreen = rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth;
    if (isOffscreen)
        reset();
}
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
export function modalLayerSize(modal) {
    const container = modal.offsetParent;
    if (container instanceof HTMLElement && container.clientWidth > 0) {
        return { width: container.clientWidth, height: container.clientHeight };
    }
    return { width: window.innerWidth, height: window.innerHeight };
}
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
export function promoteToModalLayer(modal) {
    const before = modal.getBoundingClientRect();
    modal.style.setProperty('position', 'absolute');
    modal.style.setProperty('margin', '0');
    modal.style.setProperty('left', '0px');
    modal.style.setProperty('top', '0px');
    const origin = modal.getBoundingClientRect();
    const left = before.left - origin.left;
    const top = before.top - origin.top;
    modal.style.setProperty('left', `${String(left)}px`);
    modal.style.setProperty('top', `${String(top)}px`);
    return { left, top };
}
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
export function bindModalResize(options) {
    const { modal, handle } = options;
    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0)
            return;
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        // 抬升为定位层（absolute 相对遮罩，见 promoteToModalLayer 的宿主说明）
        const { left, top } = promoteToModalLayer(modal);
        const rect = modal.getBoundingClientRect();
        const startWidth = rect.width;
        const startHeight = rect.height;
        const layer = modalLayerSize(modal);
        modal.classList.add('is-dragged', 'is-resized');
        // rAF 合帧：与拖动同口径，一帧至多写一次样式
        let frame = null;
        let latestX = 0;
        let latestY = 0;
        const flush = () => {
            frame = null;
            // 上界随当前 left/top 走：位置不动，宽高放大到撞定位层边界即停
            const maxWidth = Math.max(MIN_MODAL_WIDTH, layer.width - left);
            const maxHeight = Math.max(MIN_MODAL_HEIGHT, layer.height - top);
            const width = Math.min(Math.max(MIN_MODAL_WIDTH, startWidth + latestX), maxWidth);
            const height = Math.min(Math.max(MIN_MODAL_HEIGHT, startHeight + latestY), maxHeight);
            modal.style.setProperty('width', `${String(width)}px`);
            modal.style.setProperty('height', `${String(height)}px`);
        };
        const onMove = (moveEvent) => {
            latestX = moveEvent.clientX - startX;
            latestY = moveEvent.clientY - startY;
            frame ??= window.requestAnimationFrame(flush);
        };
        const onUp = () => {
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
                frame = null;
            }
            flush();
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    });
}
/** 写回几何快照：值为空 = 该属性原本没有内联值 → removeProperty 回 CSS 居中 */
function restoreFromSnapshot(modal, snapshot) {
    const restore = snapshot ?? new Map();
    for (const [property, value] of restore) {
        if (value === '')
            modal.style.removeProperty(property);
        else
            modal.style.setProperty(property, value);
    }
}
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
export function bindModalMaximize(options) {
    const { modal, button } = options;
    const GEOMETRY_PROPERTIES = ['position', 'margin', 'left', 'top', 'width', 'height'];
    let snapshot = null;
    button.addEventListener('click', () => {
        const isMaximized = modal.classList.contains(MODAL_MAXIMIZED_CLASS);
        if (!isMaximized) {
            snapshot = new Map(GEOMETRY_PROPERTIES.map((property) => [property, modal.style.getPropertyValue(property)]));
            // 铺满**定位层**（遮罩 = 当前可见区），不用 window.inner*：宿主下
            // innerWidth/Height 会失真（见 modalLayerSize 注释），铺成失真尺寸
            // 等于把弹窗撑到窗格外 → momo 实测「点最大化窗口就没了」。
            promoteToModalLayer(modal);
            const layer = modalLayerSize(modal);
            modal.style.setProperty('left', '0px');
            modal.style.setProperty('top', '0px');
            modal.style.setProperty('width', `${String(Math.max(MIN_MODAL_WIDTH, layer.width))}px`);
            modal.style.setProperty('height', `${String(Math.max(MIN_MODAL_HEIGHT, layer.height))}px`);
            modal.classList.add(MODAL_MAXIMIZED_CLASS);
            button.textContent = '🗗';
            button.setAttribute('aria-label', '还原窗口大小');
            button.setAttribute('aria-pressed', 'true');
            ensureModalVisible(modal, () => {
                restoreFromSnapshot(modal, snapshot);
                modal.classList.remove(MODAL_MAXIMIZED_CLASS);
                button.textContent = '⛶';
                button.setAttribute('aria-label', '最大化窗口');
                button.setAttribute('aria-pressed', 'false');
            });
            return;
        }
        // 还原：快照里有值写回，空值清掉（回到 CSS 居中）
        restoreFromSnapshot(modal, snapshot);
        modal.classList.remove(MODAL_MAXIMIZED_CLASS);
        button.textContent = '⛶';
        button.setAttribute('aria-label', '最大化窗口');
        button.setAttribute('aria-pressed', 'false');
    });
}
/** detachable-panel 迁移尾注：浮动窗的 bindDrag / 缩放 / 最大化带 transform
 * 合成层与 PluginStorage 几何记忆，迁到本模块须先抽「几何记忆」接口，
 * 避免为统一而把面板特有逻辑反向灌进通用层。 */
