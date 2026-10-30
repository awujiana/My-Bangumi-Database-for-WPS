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
import { isWebDialogSupported, openWebDialog, resolveDialogUrl, } from '../../tools/wps-web-dialog.js';
import { onBeforeEnterSolo } from '../../core/solo-hooks.js';
/** 面板尺寸下限（再小内容就被裁没了） */
export const MIN_PANEL_WIDTH = 360;
export const MIN_PANEL_HEIGHT = 200;
/** 收起后只剩标题栏的高度 */
export const COLLAPSED_HEIGHT = 40;
/** 未指定尺寸时的默认窗口大小 */
export const DEFAULT_PANEL_WIDTH = 720;
export const DEFAULT_PANEL_HEIGHT = 520;
/**
 * 浮动窗比区块多出来的 chrome 高度估计（标题栏 + body 内边距 + 卡片皮差）
 *
 * 自适应尺寸时给区块测量值加这个余量：少了它窗口底部会差一两行、
 * 出现本不该有的滚动条。
 */
export const PANEL_CHROME_ALLOWANCE = 48;
/**
 * 浮动窗口的层级：低于页面模态框（各页 modal-mask 都是 1000），
 * 高于正文（正文最高 100）。多窗口不靠 z-index 抢层级 —— 一律用同一个值，
 * 谁在上面由 DOM 顺序决定，「点谁谁置顶」就是把节点重新 append 到 body 末尾。
 * 早先用「每开一个 +1」会一路涨到盖住模态框，确认对话框被压在下面。
 */
const PANEL_Z_INDEX = 900;
/** 几何记忆：key = 面板 id，关闭再打开时恢复上次的位置与尺寸 */
const geometryMemory = new Map();
/**
 * 几何的持久化 key 前缀（localStorage）
 *
 * 为什么不用 PluginStorage（getConfig/setConfig）：① 那是宿主隔离存储，pane
 * 重载后不一定还在；② 它是 COM 调用——拖拽收尾时写它要等 COM，桥未就绪时还会
 * 抛错把 onEnd 搞崩。面板几何是纯 UI 状态，localStorage 同步、零 COM、跨 pane
 * 重载存活，正合适（2026-10-24 真机缺陷：JsApiDevTool 调速器拖动导致 pane
 * 重载，内存几何全丢，浮窗「还原位置」回默认位）。
 */
const GEO_STORAGE_PREFIX = 'bgm:panelGeo:';
/** 从 localStorage 读记住的几何；坏数据 / 存储不可用一律回 null（回退默认位） */
function loadRememberedRect(panelId) {
    try {
        const raw = window.localStorage.getItem(GEO_STORAGE_PREFIX + panelId);
        if (raw === null)
            return null;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object')
            return null;
        const candidate = parsed;
        const numbers = ['left', 'top', 'width', 'height'].map((key) => candidate[key]);
        if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value)))
            return null;
        return {
            left: numbers[0],
            top: numbers[1],
            width: numbers[2],
            height: numbers[3],
        };
    }
    catch {
        // 隐私模式 / 存储被禁：静默回退，不影响当前会话
        return null;
    }
}
/** 记住几何到 localStorage；写失败只影响下次重载的恢复，不抛 */
function persistRect(panelId, rect) {
    try {
        window.localStorage.setItem(GEO_STORAGE_PREFIX + panelId, JSON.stringify(rect));
    }
    catch {
        // 存不上不影响当前会话（内存记忆还在）
    }
}
/** 当前处于拖出状态的收回函数栈（Esc 关最上面那个） */
const detachedClosers = [];
/** Esc 监听是否装过（全局只装一次） */
let isEscapeBound = false;
/**
 * 钳制拖动后的位置：窗口必须完整留在视口内
 *
 * 允许负 left/top 吗？不允许 —— 负值会把标题栏推到视口外，用户再也抓不回来。
 */
export function clampPosition(position, size, viewport) {
    const maxLeft = Math.max(0, viewport.width - size.width);
    const maxTop = Math.max(0, viewport.height - size.height);
    return {
        left: Math.min(Math.max(0, position.left), maxLeft),
        top: Math.min(Math.max(0, position.top), maxTop),
    };
}
/**
 * 钳制缩放后的尺寸：不小于下限、不大于视口
 *
 * 宽高都保底：只保宽不保高的话用户能把面板压成一条线，内容全被裁掉。
 */
export function clampSize(size, viewport) {
    const maxWidth = Math.max(MIN_PANEL_WIDTH, viewport.width);
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, viewport.height);
    return {
        width: Math.min(Math.max(MIN_PANEL_WIDTH, size.width), maxWidth),
        height: Math.min(Math.max(MIN_PANEL_HEIGHT, size.height), maxHeight),
    };
}
/** 收起 / 展开时的目标高度：收起收到标题栏一行，展开还原（不低于下限） */
export function nextPanelHeight(currentHeight, isCollapsed, restoredHeight) {
    return isCollapsed
        ? COLLAPSED_HEIGHT
        : Math.max(MIN_PANEL_HEIGHT, restoredHeight || currentHeight);
}
/**
 * 新窗口的默认位置：居中后再按已开数量做阶梯偏移
 *
 * 阶梯偏移是必须的：不开偏移的话连开三个窗口会严丝合缝叠在一起，
 * 用户只看到「没反应」。
 */
export function defaultPanelRect(openCount, viewport, desiredWidth = DEFAULT_PANEL_WIDTH, desiredHeight = DEFAULT_PANEL_HEIGHT) {
    const size = clampSize({ width: desiredWidth, height: desiredHeight }, viewport);
    const step = 24;
    const offset = (openCount % 6) * step;
    const position = clampPosition({
        left: (viewport.width - size.width) / 2 + offset,
        top: (viewport.height - size.height) / 2 + offset,
    }, size, viewport);
    return { left: position.left, top: position.top, width: size.width, height: size.height };
}
/** 触发按钮的类名（样式 + 测试定位） */
export const TRIGGER_BUTTON_CLASS = 'detachable-trigger';
/** 占位块的类名 */
export const PLACEHOLDER_CLASS = 'detachable-placeholder';
/** 浮动窗口根元素类名 */
export const PANEL_CLASS = 'detachable-panel';
/** 区块被拖出后加在它身上的类（原生模式用它隐藏区块，不用 hidden 属性：section 的 display 会盖掉它） */
const DETACHED_CLASS = 'detachable-detached';
/** 原生对话框存活轮询间隔（ms）。
 *  一轮要两次 COM 往返（`GetWebDialog(id)` + 读 `Visible`），1 秒一轮在用户
 *  操作原生窗口期间是持续的宿主演入；2 秒足够快（占位块最多多留 1 秒），
 *  负担减半。 */
const NATIVE_POLL_INTERVAL = 2000;
/** 标记「该区块已装配」的属性（通用扫描据此跳过，避免重复注入） */
const DETACHABLE_READY_ATTRIBUTE = 'data-detachable-ready';
/** 拖动 / 缩放进行中的类名（用于禁用过渡与文本选中） */
const DRAGGING_CLASS = 'is-dragging';
const RESIZING_CLASS = 'is-resizing';
const COLLAPSED_CLASS = 'is-collapsed';
const MAXIMIZED_CLASS = 'is-maximized';
/** 读视口：只在 pointerdown 时调用一次 */
function readViewport() {
    return { width: window.innerWidth, height: window.innerHeight };
}
/** 建一个带 class 的 div */
function makeDiv(cssClass) {
    const element = document.createElement('div');
    element.className = cssClass;
    return element;
}
/**
 * 判断事件目标是不是可交互控件。
 * 放在模块作用域：`bindDrag` 里定义会被 `consistent-function-scoping` 判为可外提。
 */
function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest('button, select, input, textarea, a'));
}
/** 建一个图标按钮（不落地成变量，避免动词前缀误伤） */
function makeIconButton(icon, label, cssClass, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = cssClass;
    button.textContent = icon;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
}
/**
 * 造一个「已拖出」占位块
 *
 * float 与 native 两种模式共用，只是文案不同 —— 两者对用户的回路是一样的：
 * 原位置不会凭空塌陷，且都给一个「收回」按钮（少了它用户只能刷新任务窗格找回来）。
 */
function makePlaceholder(message, onRecall) {
    const placeholder = makeDiv(PLACEHOLDER_CLASS);
    const icon = document.createElement('span');
    icon.className = 'detachable-placeholder-icon';
    icon.textContent = '⧉';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'detachable-placeholder-text';
    text.textContent = message;
    const recall = document.createElement('button');
    recall.type = 'button';
    recall.className = 'bgm-btn small detachable-placeholder-recall';
    // 文案用「还原」而非「关闭」：用户要的是「把内容放回原位」这个语义，
    // 「关闭」容易被理解成把内容丢掉（区块其实一直在，只是搬去了窗口里）。
    recall.textContent = '还原';
    recall.title = '把区块收回本页面原位';
    recall.setAttribute('aria-label', recall.title);
    recall.addEventListener('click', onRecall);
    placeholder.append(icon, text, recall);
    return placeholder;
}
/**
 * 量出区块的「栅格 Span + 高度」，供占位块继承。
 *
 * ## 为什么必须继承（真机反馈：拖出后原页面布局坏了）
 * 各页主区 `.main` 在 960px / 1440px 等断点下是 `display: grid`，区块靠
 * `grid-column: 1 / -1` 通栏（`.section-wide` / `.command-center`）。占位块是个
 * 普通 div，**既不继承那个 Span 也没有原区块的高度**，于是：
 *   1. 通栏区块塌成一个窄格，同行的其它区块被挤到奇怪的位置；
 *   2. 原本 300px 高的区块换成 40px 的占位块，栅格行高整体重算，下方内容上跳。
 * 用户看到的就是「布局坏了」——而内容其实一块没丢。
 *
 * 只继承「显式跨列」的 Span；`auto / auto`（普通单格区块）不继承 —— 写了反而
 * 把栅格的自动放置逻辑钉死，还原后可能对不上。
 *
 * 取不到计算样式（极端宿主）时返回空对象：占位块塌一点比整页崩好。
 */
function measureSectionLayout(section) {
    try {
        const { height } = section.getBoundingClientRect();
        const computed = window.getComputedStyle(section);
        const layout = {};
        if (height > 0)
            layout.minHeight = `${String(Math.round(height))}px`;
        if (isExplicitGridSpan(computed.gridColumn))
            layout.gridColumn = computed.gridColumn;
        if (isExplicitGridSpan(computed.gridRow))
            layout.gridRow = computed.gridRow;
        return layout;
    }
    catch {
        return {};
    }
}
/** 判断栅格 Span 是否是「显式跨列」而非默认的 auto */
function isExplicitGridSpan(value) {
    return value !== '' && value !== 'auto' && value !== 'auto / auto';
}
/**
 * 量区块的内容尺寸，供浮动窗口**初始大小自适应**
 *
 * 固定 720×520 对只有六个按钮的「开始同步」会留大片空白（momo 反馈：
 * 浮动窗口体积太大、空出来的区域太多）。按内容量：区块多高窗口就多高，
 * 宽度同理；量不到（宿主不给布局 / 区块隐藏）时兜底默认值。
 *
 * 必须在 `detach()` 里调（区块还挂在原页面、尺寸是页面里的真实尺寸）；
 * 搬进窗口后它脱了卡片皮、换了容器，量到的就对不上原布局了。
 */
function measureSectionSize(section) {
    try {
        const box = section.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) {
            return { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT };
        }
        return {
            width: Math.round(box.width) + PANEL_CHROME_ALLOWANCE,
            height: Math.round(box.height) + PANEL_CHROME_ALLOWANCE,
        };
    }
    catch {
        return { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT };
    }
}
/**
 * 造一个 native 模式句柄：把区块换成宿主原生独立窗口
 *
 * ## 与 float 模式的两处本质差异
 * 1. **不搬 DOM**：原生对话框是另一个 WebView，本页节点搬不过去。所以
 *    区块本体留在页面上（加 `.detachable-detached` 隐藏），窗口里加载
 *    `nativeUrl` 指向的独立页面 —— 那份页面自己装配同一套逻辑。
 * 2. **窗口能被用户在 WPS 里直接关掉**（系统关闭按钮），任务窗格无从得知。
 *    故开窗口后轮询 `isAlive()`，发现关了就自动收回 ——
 *    否则占位块会永久卡在「已拖出」，而窗口早没了（比塌陷更难发现）。
 */
function createNativeDetachable(section, resolved) {
    const title = resolved.title ?? '浮动窗口';
    const homeParent = section.parentElement;
    const homeNextSibling = section.nextElementSibling;
    const placeholder = makePlaceholder(`「${title}」已拖出为独立窗口`, attach);
    let session = null;
    let pollTimer = null;
    let isDetached = false;
    function stopPolling() {
        if (pollTimer === null)
            return;
        window.clearInterval(pollTimer);
        pollTimer = null;
    }
    function attach() {
        if (!isDetached)
            return;
        stopPolling();
        if (session)
            session.close();
        session = null;
        isDetached = false;
        // 用 class 而非 hidden 属性：`.section` 自带 display 会盖掉 [hidden]
        section.classList.remove(DETACHED_CLASS);
        placeholder.remove();
        resolved.onAttach?.();
    }
    function detach() {
        // 已经开着就别再开第二个：原生窗口没有「置顶」回调，重复开只会叠一屏窗口
        if (session?.isAlive())
            return;
        const { nativeUrl } = resolved;
        if (!nativeUrl)
            return;
        const opened = openWebDialog({
            url: resolveDialogUrl(nativeUrl, window.location.href),
            title,
            width: resolved.width ?? DEFAULT_PANEL_WIDTH,
            height: resolved.height ?? DEFAULT_PANEL_HEIGHT,
            isModal: false,
        });
        if (!opened)
            return;
        session = opened;
        isDetached = true;
        section.classList.add(DETACHED_CLASS);
        if (homeParent?.isConnected) {
            if (homeNextSibling?.isConnected)
                homeNextSibling.before(placeholder);
            else
                homeParent.append(placeholder);
        }
        // 用户在 WPS 里点系统关闭按钮时，本页收不到任何事件 —— 只能轮询。
        // 1 秒一次足够快，开销可忽略（一次 COM 属性读取）。
        pollTimer = window.setInterval(() => {
            if (session?.isAlive() === false)
                attach();
        }, NATIVE_POLL_INTERVAL);
        resolved.onDetach?.();
    }
    const trigger = resolved.trigger ?? injectTrigger(section, title);
    const onTriggerClick = () => {
        if (isDetached)
            attach();
        else
            detach();
    };
    trigger?.addEventListener('click', onTriggerClick);
    return {
        detach,
        attach,
        toggle: onTriggerClick,
        isDetached: () => isDetached,
        destroy: () => {
            attach();
            trigger?.removeEventListener('click', onTriggerClick);
            section.removeAttribute(DETACHABLE_READY_ATTRIBUTE);
        },
    };
}
/**
 * 给把手绑上「按住拖动」行为
 *
 * 用 pointer capture 而非 window 监听：capture 后即使指针移出把手甚至移出窗口，
 * 事件仍然派发给把手，不会脱轨。
 *
 * @param onEnd 拖动结束回调（在最后一次位移落定之后调用）：供调用方把
 *   「拖动期临时状态」提交回正式状态。拖动可能一个 rAF 都没等到就结束，
 *   所以这里保证先 flush 再 onEnd，调用方不会丢最后几像素。
 */
function bindDrag(grip, root, draggingClass, onStart, onDelta, onEnd) {
    // 标题栏里嵌了按钮 / 下拉，按在这些控件上不应该启动拖动
    grip.addEventListener('pointerdown', (event) => {
        // 只响应主键：右键 / 中键拖动会和系统菜单、滚轮冲突
        if (event.button !== 0)
            return;
        if (isInteractiveTarget(event.target))
            return;
        const startX = event.clientX;
        const startY = event.clientY;
        grip.setPointerCapture(event.pointerId);
        root.classList.add(draggingClass);
        // 拖动起点：让调用方捕获基准几何与视口（见下方 onStart 说明）
        onStart();
        // rAF 合帧：pointermove 可能快于屏幕刷新率，每次都写 style 会让一帧内跑多次
        // 「样式重算 + 布局」。只记最新位移，一帧至多写一次。
        let frame = null;
        let latestX = 0;
        let latestY = 0;
        const flush = () => {
            frame = null;
            onDelta(latestX, latestY);
        };
        const onMove = (moveEvent) => {
            latestX = moveEvent.clientX - startX;
            latestY = moveEvent.clientY - startY;
            frame ??= window.requestAnimationFrame(flush);
        };
        const onUp = () => {
            // 收尾补一次：最后一个 rAF 可能还没跑，直接结束会丢掉最后几像素
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
                frame = null;
            }
            flush();
            root.classList.remove(draggingClass);
            grip.removeEventListener('pointermove', onMove);
            grip.removeEventListener('pointerup', onUp);
            grip.removeEventListener('pointercancel', onUp);
            // pointercancel 时浏览器已自动释放，未守卫直接 release 会抛 NotFoundError
            if (grip.hasPointerCapture(event.pointerId))
                grip.releasePointerCapture(event.pointerId);
            // 提交放在撤类之后：两次样式写入在同一个任务里，浏览器只做一次重算，
            // 不会出现「先看见窗口跳回基准位、再跳到终点」的中间帧。
            onEnd?.();
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
        grip.addEventListener('pointercancel', onUp);
        event.preventDefault();
    });
}
/** 从区块里取标题文本：优先 data 属性，其次标题元素文本（去掉内嵌按钮的字） */
function readSectionTitle(section) {
    const fromAttribute = section.dataset.detachableTitle;
    if (fromAttribute)
        return fromAttribute.trim();
    // .command-title 也要认：sec-command（开始同步）用的是 div 而不是 h3，
    // 只找 h3/h2 会退化成「浮动窗口」——窗口标题与内容标题对不上（momo 反馈）。
    const heading = section.querySelector('h3, h2, .command-title');
    if (!heading)
        return '浮动窗口';
    const clone = heading.cloneNode(true);
    clone.querySelectorAll('button').forEach((button) => {
        button.remove();
    });
    // 去掉内嵌按钮的字（折叠按钮、拖出按钮都会污染标题）
    return (clone.textContent || '').replace(/\s+/g, ' ').trim() || '浮动窗口';
}
/** 读 HTML 上的数字属性，缺省或非法值返回 undefined */
function readNumberAttribute(section, name) {
    const raw = name === 'width' ? section.dataset.detachableWidth : section.dataset.detachableHeight;
    if (!raw)
        return undefined;
    // 不用 parseInt：`radix` 规则要基数、`unicorn/prefer-number-coercion` 又不许写 10，
    // 两条规则在这个点上互斥。属性是我们自己写的，直接 Number() 足够。
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
/** 按 id 找元素（只接受 HTMLElement，找不到返回 null） */
function elementById(id) {
    if (!id)
        return null;
    const found = document.getElementById(id);
    return found instanceof HTMLElement ? found : null;
}
/** 从 HTML 属性读出该区块的配置 */
function readOptionsFromDataset(section) {
    return {
        title: readSectionTitle(section),
        width: readNumberAttribute(section, 'width'),
        height: readNumberAttribute(section, 'height'),
        mode: section.dataset.detachableMode === 'native' ? 'native' : 'float',
        nativeUrl: section.dataset.detachableUrl,
        toolbar: elementById(section.dataset.detachableToolbar),
        trigger: elementById(section.dataset.detachableTrigger),
    };
}
/**
 * 把区块变成可拖出的
 *
 * @param section 要被搬家的区块（通常是 `<section>`）
 * @param options 可选项；不传时全部从 `data-detachable-*` 属性读
 * @returns 句柄；入参不是 HTMLElement 时返回 null（页面侧直接 `?.` 即可）
 */
export function createDetachablePanel(section, options = {}) {
    if (!(section instanceof HTMLElement))
        return null;
    // 幂等：页面若已用 `createDetachablePanel` 定制过（传了回调 / 工具条），
    // 通用扫描必须让路，否则会再注入一个「⧉」按钮、再建一个窗口。
    // 用 attribute 而非 dataset 赋值：`no-param-reassign` 禁止写入入参属性。
    if (section.getAttribute(DETACHABLE_READY_ATTRIBUTE) === 'true')
        return null;
    section.setAttribute(DETACHABLE_READY_ATTRIBUTE, 'true');
    const resolved = {
        title: options.title ?? readSectionTitle(section),
        // 不再 fallback 到 DEFAULT：undefined = 「按内容自适应」，由 detach 首开时
        // 量区块尺寸决定（显式配了 width/height 的区块仍听配置）。
        width: options.width ?? readNumberAttribute(section, 'width'),
        height: options.height ?? readNumberAttribute(section, 'height'),
        mode: options.mode ?? readOptionsFromDataset(section).mode,
        nativeUrl: options.nativeUrl ?? section.dataset.detachableUrl,
        toolbar: options.toolbar ?? elementById(section.dataset.detachableToolbar),
        trigger: options.trigger ?? elementById(section.dataset.detachableTrigger),
        onDetach: options.onDetach,
        onAttach: options.onAttach,
    };
    // native 需要宿主支持；不支持时**静默回落** float —— 用户照样能拖出，
    // 只是窗口在任务窗格内。功能不丢比「点了没反应」重要。
    if (resolved.mode === 'native' && resolved.nativeUrl && isWebDialogSupported()) {
        return createNativeDetachable(section, resolved);
    }
    const panelId = section.id || `detachable-${String(geometryMemory.size + 1)}`;
    const title = resolved.title ?? '浮动窗口';
    // ---- 浮动窗口骨架（追加到 body：position fixed 相对视口，可宽于任务窗格）----
    const root = makeDiv(PANEL_CLASS);
    root.dataset.detachableFor = panelId;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', title);
    root.style.zIndex = String(PANEL_Z_INDEX);
    root.hidden = true;
    // ---- 几何（必须早于按钮创建：折叠按钮的回调要读 rect 当前高度）----
    // 取值优先级：本次会话内存 > localStorage（上会话 / pane 重载前）> 级联默认位。
    // 持久化的几何还要按当前视口钳一次——记住的位置可能落在缩小后的视口外，
    // 不钳就会出现「浮窗拖出去了找不回来」（比不记忆更糟）。
    const remembered = geometryMemory.get(panelId) ?? loadRememberedRect(panelId);
    const rect = remembered
        ? (() => {
            const viewport = readViewport();
            const clamped = clampPosition({ left: remembered.left, top: remembered.top }, { width: remembered.width, height: remembered.height }, viewport);
            return { ...remembered, left: clamped.left, top: clamped.top };
        })()
        : {
            ...defaultPanelRect(detachedClosers.length, readViewport(), resolved.width, resolved.height),
        };
    function applyPosition() {
        root.style.left = `${String(rect.left)}px`;
        root.style.top = `${String(rect.top)}px`;
    }
    function applySize() {
        // 最大化期间不写内联尺寸：内联优先级高于 .is-maximized 的 inset，
        // 一写就把最大化窗口顶回旧尺寸（momo 反馈：最大化还会自己变回去）。
        // 所有写回路径（拖动结束 / 缩放 / 展开）都必须经过这里或 applyRect。
        if (root.classList.contains(MAXIMIZED_CLASS))
            return;
        root.style.width = `${String(rect.width)}px`;
        root.style.height = `${String(rect.height)}px`;
    }
    function applyRect() {
        if (root.classList.contains(MAXIMIZED_CLASS))
            return;
        applyPosition();
        applySize();
        // transform 是「只在拖动期存在」的临时偏移，任何一次全量落地都把它撤掉，
        // 保证几何的单一来源始终是 rect + left/top（最大化前也必须撤，否则
        // inset 定位会被残留位移顶偏）。
        root.style.transform = '';
    }
    /** 记住几何，供下次打开恢复（只在收回时写一次，避免拖动过程频繁写 Map） */
    function rememberRect() {
        geometryMemory.set(panelId, { ...rect });
        // 同时落盘：pane 重载（如 JsApiDevTool 调速器场景）后内存没了，靠它恢复
        persistRect(panelId, { ...rect });
    }
    const header = document.createElement('header');
    header.className = 'detachable-panel-header';
    const grip = document.createElement('span');
    grip.className = 'detachable-panel-grip';
    grip.textContent = '⡇';
    grip.setAttribute('aria-hidden', 'true');
    const titleNode = document.createElement('span');
    titleNode.className = 'detachable-panel-title';
    titleNode.textContent = title;
    const toolbarSlot = makeDiv('detachable-panel-toolbar');
    const actions = makeDiv('detachable-panel-actions');
    const buttonCollapse = makeIconButton('▾', '收起 / 展开', 'detachable-panel-icon-btn', () => {
        const isCollapsed = root.classList.toggle(COLLAPSED_CLASS);
        // 最大化态一律不写内联高度：inset 的 96% 与收起高度都交给 CSS 规则
        // （.is-maximized / .is-maximized.is-collapsed），内联一写就顶掉它们
        if (!root.classList.contains(MAXIMIZED_CLASS)) {
            root.style.height = isCollapsed ? `${String(COLLAPSED_HEIGHT)}px` : `${String(rect.height)}px`;
        }
        buttonCollapse.textContent = isCollapsed ? '▸' : '▾';
        buttonCollapse.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    });
    buttonCollapse.setAttribute('aria-expanded', 'true');
    const buttonMaximize = makeIconButton('⤢', '最大化 / 还原', 'detachable-panel-icon-btn', () => {
        const isMaximized = root.classList.toggle(MAXIMIZED_CLASS);
        if (isMaximized) {
            // 最大化靠 CSS 的 inset，必须清掉内联几何，否则内联优先级更高撑不开
            // （transform 同理：残留的拖动位移会把最大化窗口顶偏）
            root.style.left = '';
            root.style.top = '';
            root.style.width = '';
            root.style.height = '';
            root.style.transform = '';
        }
        else {
            applyRect();
        }
        buttonMaximize.textContent = isMaximized ? '⤡' : '⤢';
    });
    // 还原按钮改用图标（⧉）而非文字：momo 要求与其它窗口按钮统一。
    // 图标语义弱于文字，故 tooltip / aria-label 写全「放回页面原位」。
    const buttonRestore = makeIconButton('⧉', '还原：把模块放回页面原位', 'detachable-panel-icon-btn', () => {
        attach();
    });
    actions.append(buttonCollapse, buttonMaximize, buttonRestore);
    header.append(grip, titleNode, toolbarSlot, actions);
    const body = makeDiv('detachable-panel-body');
    const resizeHandle = makeDiv('detachable-panel-resize');
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-label', '拖动缩放窗口');
    resizeHandle.title = '拖动缩放';
    root.append(header, body, resizeHandle);
    // ---- 占位块：拖出后顶在原位置，避免正文塌陷 ----
    const placeholder = makePlaceholder(`「${title}」已拖出为浮动窗口`, attach);
    // 拖动 / 缩放期间的基准：起点几何 + 起点视口。
    // 视口只在 pointerdown 时读一次（`window.innerWidth/Height` 有挂起样式变更时会触发
    // 强制布局，逐帧读 = 逐帧重排）；几何用「基准 + 累计位移」算绝对位置 —— 若用
    // 「当前 rect + 累计位移」，rect 已被上一帧改过，位移会被重复累加，窗口越拖越快。
    let dragViewport = readViewport();
    let dragBase = { ...rect };
    /** 拖动期相对基准位置的位移；只在拖动中非零，onEnd 提交后清零 */
    let dragDeltaX = 0;
    let dragDeltaY = 0;
    /** 本次拖动开始时窗口是否已收起：收起态拖动要按收起高度钳制并保高 */
    let isDragCollapsed = false;
    bindDrag(header, root, DRAGGING_CLASS, () => {
        dragBase = { ...rect };
        dragViewport = readViewport();
        dragDeltaX = 0;
        dragDeltaY = 0;
        // 收起态拖动：钳制与最终高度都要按收起高度算，否则会（1）按展开高度限位
        // 导致收起的小窗拖不到视口底部；（2）onEnd 把内联高度写回展开值，
        // 收起窗口弹开一大片空白（body 被 is-collapsed 藏了，只剩标题栏却占着
        // 展开高度的位置）。
        isDragCollapsed = root.classList.contains(COLLAPSED_CLASS);
    }, (deltaX, deltaY) => {
        const dragHeight = isDragCollapsed ? COLLAPSED_HEIGHT : dragBase.height;
        const next = clampPosition({ left: dragBase.left + deltaX, top: dragBase.top + deltaY }, { width: dragBase.width, height: dragHeight }, dragViewport);
        dragDeltaX = next.left - dragBase.left;
        dragDeltaY = next.top - dragBase.top;
        // 只写 transform，不碰 left/top：left/top 每帧变一次，浏览器就要重排 +
        // 重绘整个面板内容（预览表 / 规则表几百行时一帧几十毫秒，这就是「拖动
        // 掉帧」的本因）。transform 命中合成层，配合 .is-dragging 的 will-change
        // 提示，每帧只做一次层平移，内容一次都不用重画。
        root.style.transform = `translate(${String(dragDeltaX)}px, ${String(dragDeltaY)}px)`;
    }, () => {
        // 收尾提交：基准 + 最终位移写回 rect 与 left/top，撤掉临时 transform，
        // 几何回到单一来源（rect + left/top）。
        rect.left = dragBase.left + dragDeltaX;
        rect.top = dragBase.top + dragDeltaY;
        dragDeltaX = 0;
        dragDeltaY = 0;
        applyRect();
        // 收起态：applyRect 会把内联高度写回展开值，这里压回收起高度，
        // 保持「只剩标题栏一行」，且位置已按收起高度钳制、可拖到底部。
        // 最大化态跳过（写了就把最大化顶回去）。
        if (isDragCollapsed && !root.classList.contains(MAXIMIZED_CLASS)) {
            root.style.height = `${String(COLLAPSED_HEIGHT)}px`;
        }
    });
    bindDrag(resizeHandle, root, RESIZING_CLASS, () => {
        dragBase = { ...rect };
        dragViewport = readViewport();
    }, (deltaX, deltaY) => {
        const next = clampSize({ width: dragBase.width + deltaX, height: dragBase.height + deltaY }, dragViewport);
        rect.width = next.width;
        rect.height = next.height;
        // 缩放必须改 width/height（内容要跟着重排），只写尺寸不写位置，
        // 少两个属性的样式失效。
        applySize();
    });
    // 点击任意位置置顶：把节点重新 append 到 body 末尾（同 z-index 下由 DOM 顺序决定层级）。
    // 已是最后一个就别再 append —— 重复 append 等于「移除再插入」，会强制整树样式重算，
    // 而这个监听在每次 pointerdown（含每次拖动开始）都会触发。
    root.addEventListener('pointerdown', () => {
        if (document.body.lastElementChild !== root)
            document.body.append(root);
    });
    // ---- 搬家 ----
    const homeParent = section.parentElement;
    const homeNextSibling = section.nextElementSibling;
    function detach() {
        // 无条件 append（已连接时等于「移到末尾」）：后开的窗口排在后面，天然在上面
        document.body.append(root);
        // 首次打开（无记忆几何、无显式尺寸配置）时按内容量尺寸：
        // 固定默认值对内容少的区块会留大片空白（momo 反馈：体积太大、空区域太多）。
        // 用户拖过/缩放过后几何进 memory，之后都听 memory。
        // 「首次打开」= 内存与落盘都没有几何。必须在 **detach 时**动态判定：
        // 同一实例第二次打开时，内存已由上一次 rememberRect 写入，不该再重新量尺寸；
        // 而 pane 重载后的首次打开要靠落盘几何认出「不是首次」，否则会把恢复的
        // 位置覆盖成居中默认位（真机「还原位置」的本因）。
        if (!geometryMemory.has(panelId) &&
            loadRememberedRect(panelId) === null &&
            resolved.width === undefined &&
            resolved.height === undefined) {
            const measured = measureSectionSize(section);
            // defaultPanelRect 内部过 clampSize（下限 MIN_PANEL_*、上限视口），
            // 拿回来的尺寸必须接住——直接把测量值赋给 rect 会绕过钳制
            // （348px 的窗比 MIN_PANEL_WIDTH 还窄，拖把手都按不准）。
            const centered = defaultPanelRect(detachedClosers.length, readViewport(), measured.width, measured.height);
            rect.width = centered.width;
            rect.height = centered.height;
            rect.left = centered.left;
            rect.top = centered.top;
        }
        if (homeParent?.isConnected) {
            if (homeNextSibling?.isConnected)
                homeNextSibling.before(placeholder);
            else
                homeParent.append(placeholder);
        }
        // 必须在区块搬走**之前**量：搬进浮动窗口后它脱掉了卡片皮、也换了容器，
        // 量到的是窗口里的高度，搬回去就对不上原布局了。
        const layout = measureSectionLayout(section);
        if (layout.minHeight !== undefined)
            placeholder.style.minHeight = layout.minHeight;
        if (layout.gridColumn !== undefined)
            placeholder.style.gridColumn = layout.gridColumn;
        if (layout.gridRow !== undefined)
            placeholder.style.gridRow = layout.gridRow;
        body.append(section);
        root.hidden = false;
        root.classList.remove(COLLAPSED_CLASS, MAXIMIZED_CLASS);
        buttonCollapse.textContent = '▾';
        buttonCollapse.setAttribute('aria-expanded', 'true');
        buttonMaximize.textContent = '⤢';
        applyRect();
        // 工具条只在窗口里才有意义（作用于当前窗口内容），显示出来
        if (resolved.toolbar) {
            toolbarSlot.append(resolved.toolbar);
            resolved.toolbar.hidden = false;
        }
        if (!detachedClosers.includes(attach))
            detachedClosers.push(attach);
        resolved.onDetach?.();
    }
    function attach() {
        if (root.hidden)
            return;
        rememberRect();
        if (homeParent?.isConnected) {
            if (homeNextSibling?.isConnected)
                homeNextSibling.before(section);
            else
                homeParent.append(section);
        }
        else {
            // 原父节点被整块重渲染掉时（个别页面会重写容器）不能让区块凭空消失，
            // 兜底挂回 body 至少保证内容还在、可滚动看到。
            document.body.append(section);
        }
        placeholder.remove();
        if (resolved.toolbar) {
            resolved.toolbar.hidden = true;
            document.body.append(resolved.toolbar);
        }
        root.hidden = true;
        const index = detachedClosers.indexOf(attach);
        if (index !== -1)
            detachedClosers.splice(index, 1);
        resolved.onAttach?.();
    }
    // ---- 触发按钮 ----
    const trigger = resolved.trigger ?? injectTrigger(section, title);
    const onTriggerClick = () => {
        if (root.hidden)
            detach();
        else
            attach();
    };
    trigger?.addEventListener('click', onTriggerClick);
    // ---- 右键菜单：绑标题栏（见 bindWindowMenu 的说明：不绑内容区）----
    bindWindowMenu(header, () => [
        { label: '✕ 关闭窗口（内容还原到页面）', run: attach },
        {
            label: root.classList.contains(COLLAPSED_CLASS) ? '▾ 展开' : '▸ 收起',
            run: () => {
                buttonCollapse.click();
            },
        },
        {
            label: root.classList.contains(MAXIMIZED_CLASS) ? '⤡ 还原大小' : '⤢ 最大化',
            run: () => {
                buttonMaximize.click();
            },
        },
        { label: '⧉ 关闭所有浮动窗口', run: () => closeAllDetachedPanels() },
    ]);
    const handle = {
        detach,
        attach,
        toggle: onTriggerClick,
        isDetached: () => !root.hidden,
        destroy: () => {
            attach();
            trigger?.removeEventListener('click', onTriggerClick);
            root.remove();
            section.removeAttribute(DETACHABLE_READY_ATTRIBUTE);
        },
    };
    return handle;
}
/**
 * 在区块标题里注入「拖出」按钮
 *
 * 选择器与 {@link readSectionTitle} 保持一致（`h3, h2, .command-title`）：
 * 「开始同步」（sec-command）的标题是 `div.command-title` 而不是 `h3`，只认
 * `h3/h2` 会走 `section.prepend` 分支 —— 按钮变成卡片栅格的**独立一行**，
 * 浮在标题上方右端，与「开始同步」不在同一水平线（momo 反馈不美观）。
 * 插进标题元素里才能和标题同一行、靠右对齐。
 *
 * 没有标题元素时退化为插到区块最前面 —— 有按钮总比没有入口强。
 */
function injectTrigger(section, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = TRIGGER_BUTTON_CLASS;
    button.textContent = '⧉';
    button.title = `把「${title}」拖出为浮动窗口（可拖动 / 缩放 / 最大化）`;
    button.setAttribute('aria-label', button.title);
    const heading = section.querySelector('h3, h2, .command-title');
    if (heading)
        heading.append(button);
    else
        section.prepend(button);
    return button;
}
/** 给文档里所有 `[data-detachable]` 区块装上拖出能力 */
export function setupDetachablePanels(scope = document) {
    const sections = scope.querySelectorAll('[data-detachable]');
    const handles = [];
    sections.forEach((section) => {
        const handle = createDetachablePanel(section, readOptionsFromDataset(section));
        if (handle)
            handles.push(handle);
    });
    bindEscapeToCloseTopmost();
    // 进入专注模式前收回所有浮动窗：模块若在浮动窗里，专注只会得到「顶部小浮动窗 + 主区
    // 大片空白」，而非单组件铺满。经 onBeforeEnterSolo 钩子注册（避免 module-state 反向
    // import 本组件触发分层门禁）。幂等，重复调用不重复注册。
    onBeforeEnterSolo(() => {
        closeAllDetachedPanels();
    });
    return handles;
}
/** Esc 关闭最上面的浮动窗口（全局只绑一次） */
function bindEscapeToCloseTopmost() {
    if (isEscapeBound)
        return;
    isEscapeBound = true;
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape')
            return;
        detachedClosers.at(-1)?.();
    });
}
/** 供测试 / 调试：清空模块级状态 */
export function resetDetachablePanelsForTest() {
    geometryMemory.clear();
    detachedClosers.length = 0;
    // 持久化几何也要清：否则跨用例残留的位置会污染后续断言
    try {
        const doomed = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
            const key = window.localStorage.key(index);
            if (key?.startsWith(GEO_STORAGE_PREFIX) === true)
                doomed.push(key);
        }
        for (const key of doomed)
            window.localStorage.removeItem(key);
    }
    catch {
        // 存储不可用时无事可做
    }
    hideWindowMenu();
}
// ===== 窗口右键菜单 =====
/** 菜单根元素类名（样式 + 测试定位） */
export const WINDOW_MENU_CLASS = 'detachable-window-menu';
/** 菜单项类名 */
const WINDOW_MENU_ITEM_CLASS = 'detachable-window-menu-item';
/**
 * 窗口右键菜单（全局只建一个元素，随用随显示）。
 *
 * 为什么**只绑标题栏**而不绑整个窗口：窗格内容是用户的表格 / 表单，
 * 在那里 `preventDefault()` 会连 CEF 原生的文本编辑菜单一起干掉。
 * 标题栏是组件自己的 chrome，右键它不会和任何原生行为冲突 —— 这也是
 * 浏览器标签页、IDE 窗口的一致约定。
 *
 * 菜单动作与标题栏右侧三个按钮**同一套回调**，不另起炉灶：
 * 「关闭窗口」= 还原到页面原位（浮动窗口没有真正的"销毁"语义 ——
 * 内容是搬进去的，关掉必须搬回来，否则正文里那块就永久消失了）。
 */
let windowMenu = null;
/** 菜单当前是否可见（供测试与重复触发判断） */
function isWindowMenuOpen() {
    return windowMenu?.isConnected === true;
}
/** 建一个菜单项按钮 */
function makeMenuItem(label, onClick, isDanger = false) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = WINDOW_MENU_ITEM_CLASS;
    if (isDanger)
        item.classList.add(`${WINDOW_MENU_ITEM_CLASS}--danger`);
    item.textContent = label;
    item.addEventListener('click', () => {
        hideWindowMenu();
        onClick();
    });
    return item;
}
/**
 * 在指定位置打开窗口右键菜单。
 *
 * 位置做视口钳制：菜单贴右边或贴底时往回拉，否则点在标题栏最右端
 * 会让菜单溢出屏幕（任务窗格本身就可能很窄）。
 */
function showWindowMenu(x, y, items) {
    hideWindowMenu();
    if (items.length === 0)
        return;
    const menu = makeDiv(WINDOW_MENU_CLASS);
    menu.setAttribute('role', 'menu');
    for (const item of items) {
        menu.append(makeMenuItem(item.label, item.run));
    }
    document.body.append(menu);
    // 先插入再量：菜单宽度由内容决定，不量就没法做钳制
    const { offsetWidth: menuWidth, offsetHeight: menuHeight } = menu;
    const viewport = readViewport();
    const left = Math.min(x, Math.max(0, viewport.width - menuWidth - 4));
    const top = Math.min(y, Math.max(0, viewport.height - menuHeight - 4));
    menu.style.left = `${String(left)}px`;
    menu.style.top = `${String(top)}px`;
    windowMenu = menu;
}
/** 关闭菜单（重复调用安全） */
function hideWindowMenu() {
    if (windowMenu === null)
        return;
    windowMenu.remove();
    windowMenu = null;
}
/** 点菜单外任意处即收起（capture 阶段，早于页面自身处理器） */
function bindWindowMenuDismiss() {
    if (typeof document === 'undefined')
        return;
    document.addEventListener('pointerdown', (event) => {
        const menu = windowMenu;
        if (menu === null)
            return;
        const { target } = event;
        if (target instanceof Node && menu.contains(target))
            return;
        hideWindowMenu();
    }, { capture: true });
    // Esc 关菜单；若菜单已关则让既有逻辑关最上面的窗口
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape')
            return;
        if (isWindowMenuOpen()) {
            event.stopPropagation();
            hideWindowMenu();
        }
    });
    // 滚动 / 失焦时菜单还挂在旧坐标会显得诡异，一并收掉
    window.addEventListener('blur', hideWindowMenu);
}
/**
 * 给浮动窗口标题栏绑右键菜单。
 *
 * @param getItems 每次右键时取菜单项（收起 / 最大化的文案要跟当前状态走）
 */
function bindWindowMenu(header, getItems) {
    bindWindowMenuDismiss();
    header.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showWindowMenu(event.clientX, event.clientY, getItems());
    });
}
/** 关闭所有已拖出的浮动窗口（内容各自还原回页面原位） */
export function closeAllDetachedPanels() {
    // 复制一份再遍历：attach() 内部会从 detachedClosers 里 splice 自己
    const closers = [...detachedClosers];
    for (const closer of closers)
        closer();
    hideWindowMenu();
    return closers.length;
}
