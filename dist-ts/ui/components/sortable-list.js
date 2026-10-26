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
import { suppressPostDragClick } from './window-chrome.js';
/** 一维列表的数组搬运（纯函数，单测直测） */
export function moveInArray(items, fromIndex, toIndex) {
    const next = [...items];
    const moved = next.splice(fromIndex, 1)[0];
    if (moved === undefined)
        return next;
    next.splice(toIndex, 0, moved);
    return next;
}
/**
 * 中点碰撞检测（纯函数）：指针 y 小于项中心 → 插前面；遍历完都没超过 → 末尾
 *
 * dnd-kit 的 closestCenter 在多列布局里要找「最近中心」，一维列表里中点法
 * 与它等价且不需要距离比较：从上往下找到第一个「指针在中点之上」的项即可。
 */
export function computeDropTarget(probes, pointerY) {
    for (const [position, probe] of probes.entries()) {
        if (pointerY < probe.top + probe.height / 2) {
            return { overId: probe.id, placeAfter: false, index: position };
        }
    }
    const last = probes.at(-1);
    return { overId: last?.id ?? null, placeAfter: true, index: probes.length };
}
/** 键盘移动的目标下标（钳在 [0, count-1]，不循环——dnd-kit sortable 同口径） */
export function keyboardMoveIndex(current, delta, count) {
    if (count <= 0)
        return 0;
    return Math.min(Math.max(current + delta, 0), count - 1);
}
/** 默认拾起阈值（px） */
const DEFAULT_ACTIVATION_DISTANCE = 5;
/** 边缘自动滚动的触发带宽与每帧步长 */
const EDGE_BAND = 48;
const EDGE_STEP = 12;
/** overlay 的 z-index：高于模态框（1000）与右键菜单（1200） */
const OVERLAY_Z_INDEX = 1300;
/** 建元素小工具 */
function makeDiv(cssClass) {
    const element = document.createElement('div');
    element.className = cssClass;
    return element;
}
/** 判断按下的目标是不是交互控件（按钮 / 输入 / 链接——这些上面不启动拖拽） */
function isInteractivePress(target) {
    if (!(target instanceof Element))
        return false;
    return target.closest('button, a, input, select, textarea, [role="button"]') !== null;
}
/** 找最近的可滚动祖先（边缘自动滚动用；都没有就返回 null = 滚 window） */
function findScrollParent(element) {
    let node = element.parentElement;
    while (node !== null) {
        const { overflowY } = window.getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll')
            return node;
        node = node.parentElement;
    }
    return null;
}
/**
 * 把容器变成一个可拖拽排序列表
 *
 * 用法：`const sortable = createSortable({...})`；容器 DOM 重渲染后（页面
 * render 函数末尾）调 `sortable.refresh()` 重新扫描项；卸载时 `destroy()`。
 */
export function createSortable(options) {
    const { container, itemSelector, getItemId, onReorder, handleSelector, activationDistance = DEFAULT_ACTIVATION_DISTANCE, isDisabled, animateDrop = true, announce, } = options;
    const listeners = [];
    let pointerDrag = null;
    let keyboardDrag = null;
    /** 按下但还没过阈值（单击 vs 拖拽的判别窗） */
    let pending = null;
    /** live region（键盘播报；指针拖拽视觉足够，不播） */
    const liveRegion = makeDiv('sortable-live-region');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    const say = (message) => {
        if (announce !== undefined) {
            announce(message);
            return;
        }
        liveRegion.textContent = message;
    };
    /** 登记监听（destroy 统一摘） */
    function listen(target, type, handler, isCapture = false) {
        // 泛型帮助函数的边界上做一次收敛：addEventListener 的重载对具名事件类型
        // 接受强类型处理器，但泛型 E 在函数体内解析不了，收敛成 EventListener 再交
        const listener = handler;
        target.addEventListener(type, listener, { capture: isCapture });
        listeners.push([target, type, listener, isCapture]);
        // 返回原处理器：让 E 在签名里出现两次（no-unnecessary-type-parameters），
        // 调用方一般不收
        return handler;
    }
    /** 当前全部项（DOM 序，排除占位中的被拖项） */
    function currentItems(exclude) {
        return [...container.querySelectorAll(itemSelector)].filter((item) => item !== exclude);
    }
    /** 项的中线探针（碰撞检测输入） */
    function probes(exclude) {
        return currentItems(exclude).map((item) => {
            const rect = item.getBoundingClientRect();
            return { id: getItemId(item), top: rect.top, height: rect.height };
        });
    }
    /** 把指示线移到某个边界 y（相对视口，fixed 定位） */
    function moveIndicator(indicator, y, width, left) {
        indicator.style.setProperty('top', `${String(y)}px`);
        indicator.style.setProperty('left', `${String(left)}px`);
        indicator.style.setProperty('width', `${String(width)}px`);
        indicator.style.setProperty('visibility', 'visible');
    }
    /** 指示线落到目标边界：overId 非空 → 该项顶 / 底；为空 → 最后一项底部 */
    function updateIndicator() {
        const drag = pointerDrag;
        if (drag === null)
            return;
        const items = currentItems(drag.item);
        if (drag.overId !== null) {
            const target = items.find((item) => getItemId(item) === drag.overId);
            const rect = target?.getBoundingClientRect();
            if (rect === undefined) {
                drag.indicator.style.setProperty('visibility', 'hidden');
                return;
            }
            const boundary = drag.placeAfter ? rect.bottom : rect.top;
            moveIndicator(drag.indicator, boundary, Math.max(40, rect.width), rect.left);
            return;
        }
        // overId 为空（指针在最后一项之后）→ 指示线落最后一项底部
        const containerRect = container.getBoundingClientRect();
        const last = items.at(-1);
        const rect = last?.getBoundingClientRect();
        moveIndicator(drag.indicator, rect === undefined ? containerRect.top : rect.bottom, Math.max(40, containerRect.width - 8), containerRect.left + 4);
    }
    /** 边缘自动滚动（指针贴边时每帧滚一点；长列表拖到屏幕边不用手动滚） */
    function autoScroll(pointerY) {
        const drag = pointerDrag;
        if (drag === null)
            return;
        const parent = drag.scrollParent;
        const top = parent === null ? 0 : parent.getBoundingClientRect().top;
        const bottom = parent === null ? window.innerHeight : parent.getBoundingClientRect().bottom;
        let step = 0;
        if (pointerY < top + EDGE_BAND)
            step = -EDGE_STEP;
        else if (pointerY > bottom - EDGE_BAND)
            step = EDGE_STEP;
        if (step === 0)
            return;
        if (parent === null)
            window.scrollBy(0, step);
        else
            parent.scrollTop += step;
    }
    /** 每帧：overlay 跟手 + 碰撞检测 + 指示线 + 自动滚动（拖拽期间自循环） */
    function flushFrame() {
        const drag = pointerDrag;
        if (drag === null)
            return;
        drag.frame = null;
        drag.overlay.style.setProperty('transform', `translate(${String(drag.clientX - drag.grabX)}px, ${String(drag.clientY - drag.grabY)}px)`);
        const target = computeDropTarget(probes(drag.item), drag.clientY);
        if (target.overId !== drag.overId || target.placeAfter !== drag.placeAfter) {
            drag.overId = target.overId;
            drag.placeAfter = target.placeAfter;
        }
        updateIndicator();
        autoScroll(drag.clientY);
        // 自循环：指针停在边缘不动时也要持续滚
        drag.frame ??= window.requestAnimationFrame(flushFrame);
    }
    /** 摘拖拽浮态（overlay / 指示线 / 占位类 / body 类） */
    function teardownDragVisuals() {
        if (pointerDrag !== null) {
            if (pointerDrag.frame !== null)
                window.cancelAnimationFrame(pointerDrag.frame);
            pointerDrag.overlay.remove();
            pointerDrag.indicator.remove();
            pointerDrag.item.classList.remove('is-placeholder');
            pointerDrag = null;
        }
        document.body.classList.remove('sortable-dragging');
    }
    /** 松手后的放置动画：浮层飞到项的新位置再销毁（dnd-kit DropAnimation 同款） */
    function playDropAnimation(overlay, fromId) {
        const moved = currentItems().find((item) => getItemId(item) === fromId);
        const rect = moved?.getBoundingClientRect();
        if (rect === undefined) {
            overlay.remove();
            return;
        }
        overlay.classList.add('is-dropping');
        overlay.style.setProperty('transition', 'left 140ms var(--ease), top 140ms var(--ease)');
        overlay.style.setProperty('left', `${String(rect.left)}px`);
        overlay.style.setProperty('top', `${String(rect.top)}px`);
        overlay.style.setProperty('transform', 'none');
        const done = () => {
            overlay.remove();
        };
        overlay.addEventListener('transitionend', done, { once: true });
        // 兜底：transitionend 不保证触发（元素被同步移除 / 显示态变化）
        window.setTimeout(done, 240);
    }
    // 吞掉拖拽结束后那一次 click（否则会误触发行内按钮）。实现已收敛到 window-chrome（modal-drag 同源共用，带超时兜底自摘）。
    /** 提交重排（同步 / 异步都支持） */
    function commitReorder(event, overlay) {
        const result = onReorder(event);
        if (!(result instanceof Promise)) {
            if (overlay !== null) {
                if (animateDrop)
                    playDropAnimation(overlay, event.fromId);
                else
                    overlay.remove();
            }
            return;
        }
        // 异步提交（COM 交换批处理）：等它 resolved 再播放放置动画；失败兜底摘浮层
        void (async () => {
            try {
                await result;
                if (overlay !== null) {
                    if (animateDrop)
                        playDropAnimation(overlay, event.fromId);
                    else
                        overlay.remove();
                }
            }
            catch (error) {
                // eslint-disable-next-line no-console -- 纯 DOM 组件不依赖日志后端，console 是重排失败兜底日志的唯一通道
                console.error('[sortable] 重排提交失败', error);
                overlay?.remove();
            }
        })();
    }
    /** 键盘放置：按当前 DOM 序算 from/over（被拖项已在预览位置） */
    function keyboardCommit(drag) {
        const items = currentItems();
        const index = items.indexOf(drag.item);
        const ids = items.map((item) => getItemId(item));
        // 落点用「前一个兄弟之后」描述；移到首位时用「后一个之前」；只有一项时无处可移。
        // slice().at(-1) / 下标访问拿「可能undefined」而不写字面量 undefined（no-useless-undefined）
        const previous = items.slice(0, index).at(-1);
        const next = items[index + 1];
        let event;
        if (previous === undefined) {
            event =
                next === undefined
                    ? { fromId: drag.fromId, overId: null, placeAfter: true, toIndex: index, ids }
                    : { fromId: drag.fromId, overId: getItemId(next), placeAfter: false, toIndex: index, ids };
        }
        else {
            event = {
                fromId: drag.fromId,
                overId: getItemId(previous),
                placeAfter: true,
                toIndex: index,
                ids,
            };
        }
        drag.indicator.remove();
        drag.item.classList.remove('is-keyboard-dragging');
        keyboardDrag = null;
        say(`已放置到第 ${String(index + 1)} 位，共 ${String(items.length)} 项`);
        // 键盘提交是即发即弃：页面同步重渲染，不需要等 Promise（void 防 floating）
        void onReorder(event);
    }
    /** 键盘取消：DOM 插回原址、清视觉 */
    function keyboardCancel(drag) {
        const parent = drag.item.parentElement;
        if (parent !== null) {
            if (drag.originalNext !== null && drag.originalNext.parentElement === parent) {
                parent.insertBefore(drag.item, drag.originalNext);
            }
            else {
                parent.append(drag.item);
            }
        }
        drag.indicator.remove();
        drag.item.classList.remove('is-keyboard-dragging');
        keyboardDrag = null;
        say('已取消拖动');
        drag.item.focus();
    }
    // ===== 指针传感器 =====
    listen(container, 'pointerdown', (event) => {
        if (isDisabled?.() === true)
            return;
        if (event.button !== 0)
            return;
        const { target } = event;
        if (!(target instanceof Element))
            return;
        const item = target.closest(itemSelector);
        if (item === null || !container.contains(item))
            return;
        if (handleSelector !== undefined) {
            // 指定了把手：只有按在把手上才启动（把手可以是按钮）
            const handle = target.closest(handleSelector);
            if (handle === null || !item.contains(handle))
                return;
        }
        else if (isInteractivePress(target)) {
            // 没指定把手：按钮 / 输入上的按下让给控件本身（单击语义优先）
            return;
        }
        pending = { item, startX: event.clientX, startY: event.clientY };
    });
    listen(window, 'pointermove', (event) => {
        if (pending !== null && pointerDrag === null) {
            // 判别窗：没过阈值算单击（不 preventDefault，点击照常派发）
            const dx = event.clientX - pending.startX;
            const dy = event.clientY - pending.startY;
            if (Math.abs(dx) < activationDistance && Math.abs(dy) < activationDistance)
                return;
            // 过阈值 → 真正进入拖拽
            const { item } = pending;
            pending = null;
            if (isDisabled?.() === true)
                return;
            const rect = item.getBoundingClientRect();
            const overlay = item.cloneNode(true);
            // 剥掉克隆上的身份标识：overlay 挂在 body 下（不在容器里），带着 data-*
            // （行号 / rule id / data-action 钩子）会让同一时刻 DOM 里出现两个
            // 「第 N 行」，devtools 与将来的全局查询都会认错。克隆是纯展示，全剥无害。
            overlay.removeAttribute('id');
            // 两段式：先快照 data-* 属性名，再删。不能边迭代边删——attributes 是
            // live 集合，删除会跳项；也不能 [...attributes] 直接 for-of（no-useless-spread）
            const dataAttributeNames = [...overlay.attributes]
                .map((attribute) => attribute.name)
                .filter((name) => name.startsWith('data-'));
            for (const name of dataAttributeNames)
                overlay.removeAttribute(name);
            overlay.querySelectorAll('[id]').forEach((node) => {
                node.removeAttribute('id');
            });
            overlay.classList.add('sortable-overlay');
            overlay.setAttribute('aria-hidden', 'true');
            overlay.style.setProperty('position', 'fixed');
            overlay.style.setProperty('left', `${String(rect.left)}px`);
            overlay.style.setProperty('top', `${String(rect.top)}px`);
            overlay.style.setProperty('width', `${String(rect.width)}px`);
            overlay.style.setProperty('z-index', String(OVERLAY_Z_INDEX));
            document.body.append(overlay);
            const indicator = makeDiv('sortable-drop-indicator');
            indicator.style.setProperty('visibility', 'hidden');
            document.body.append(indicator);
            item.classList.add('is-placeholder');
            document.body.classList.add('sortable-dragging');
            pointerDrag = {
                item,
                overlay,
                indicator,
                fromId: getItemId(item),
                overId: null,
                placeAfter: true,
                // 位移基准 = 过阈值那一刻的指针坐标（overlay 起点是元素 rect，
                // 两者之差保持「抓住的点」不跳——dnd-kit 的 grab 偏移同思路）
                grabX: event.clientX,
                grabY: event.clientY,
                clientX: event.clientX,
                clientY: event.clientY,
                frame: null,
                scrollParent: findScrollParent(container),
            };
            pointerDrag.frame ??= window.requestAnimationFrame(flushFrame);
            return;
        }
        if (pointerDrag === null)
            return;
        pointerDrag.clientX = event.clientX;
        pointerDrag.clientY = event.clientY;
    });
    listen(window, 'pointerup', () => {
        if (pointerDrag === null) {
            // 没过阈值的按下直接抬：单击语义，点击照常派发
            pending = null;
            return;
        }
        const drag = pointerDrag;
        const hasMoved = drag.overId !== drag.fromId && (drag.overId !== null || currentItems().length > 1);
        teardownDragVisuals();
        suppressPostDragClick();
        if (!hasMoved) {
            drag.overlay.remove();
            drag.item.focus();
            return;
        }
        const items = currentItems();
        commitReorder({
            fromId: drag.fromId,
            overId: drag.overId,
            placeAfter: drag.placeAfter,
            toIndex: drag.overId === null ? items.length : items.indexOf(drag.item),
            ids: items.map((item) => getItemId(item)),
        }, drag.overlay);
    });
    listen(window, 'pointercancel', () => {
        pending = null;
        if (pointerDrag !== null) {
            const drag = pointerDrag;
            teardownDragVisuals();
            drag.overlay.remove();
            say('已取消拖动');
        }
    });
    // ===== 键盘传感器（dnd-kit 招牌无障碍）=====
    listen(container, 'keydown', (event) => {
        if (isDisabled?.() === true)
            return;
        const { target } = event;
        if (!(target instanceof Element))
            return;
        const item = target.closest(itemSelector);
        if (item === null || !container.contains(item))
            return;
        if (keyboardDrag !== null && event.key === 'Escape') {
            event.preventDefault();
            keyboardCancel(keyboardDrag);
            return;
        }
        if (keyboardDrag !== null && event.key === 'Tab') {
            // 拖拽中按 Tab：取消并让焦点正常走（不困在拖动态）
            keyboardCancel(keyboardDrag);
            return;
        }
        if (event.key === ' ' || event.key === 'Enter') {
            // 只在项本身聚焦时响应（项内按钮的 Enter/Space 归按钮）
            if (target !== item)
                return;
            event.preventDefault();
            if (keyboardDrag === null) {
                const rect = item.getBoundingClientRect();
                const indicator = makeDiv('sortable-drop-indicator');
                document.body.append(indicator);
                moveIndicator(indicator, rect.bottom, Math.max(40, rect.width), rect.left);
                keyboardDrag = { item, fromId: getItemId(item), originalNext: item.nextSibling, indicator };
                item.classList.add('is-keyboard-dragging');
                item.focus();
                const items = currentItems();
                say(`已拾起第 ${String(items.indexOf(item) + 1)} 项，共 ${String(items.length)} 项。` +
                    '上下方向键移动，空格放置，Esc 取消');
            }
            else if (keyboardDrag.item === item) {
                keyboardCommit(keyboardDrag);
            }
            return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
            return;
        if (keyboardDrag === null) {
            // 没在拖：项本身聚焦时方向键 = roving focus（在项间移焦点）
            if (target !== item)
                return;
            event.preventDefault();
            const items = currentItems();
            const step = event.key === 'ArrowUp' ? -1 : 1;
            const next = keyboardMoveIndex(items.indexOf(item), step, items.length);
            const destination = items[next];
            if (destination === undefined || destination === item)
                return;
            // tabindex 跟着焦点搬迁：旧项收起为 -1，新项升起为 0（停靠点始终只有一个）
            item.tabIndex = -1;
            destination.tabIndex = 0;
            destination.focus();
            return;
        }
        if (keyboardDrag.item !== item)
            return;
        event.preventDefault();
        const delta = event.key === 'ArrowUp' ? -1 : 1;
        const items = currentItems();
        const from = items.indexOf(item);
        const to = keyboardMoveIndex(from, delta, items.length);
        if (to === from) {
            say(delta < 0 ? '已经到顶了' : '已经到底了');
            return;
        }
        // DOM 实时换位 = 键盘拖拽的「预览」（与 dnd-kit 的 live reorder 同效果）
        if (delta < 0)
            items[to]?.insertAdjacentElement('beforebegin', item);
        else
            items[to]?.insertAdjacentElement('afterend', item);
        const rect = item.getBoundingClientRect();
        moveIndicator(keyboardDrag.indicator, rect.bottom, Math.max(40, rect.width), rect.left);
        const after = currentItems();
        say(`第 ${String(to + 1)} 项，共 ${String(after.length)} 项`);
    });
    // ===== 对外 =====
    container.append(liveRegion);
    container.setAttribute('aria-roledescription', '可拖拽排序列表');
    function refresh() {
        const items = container.querySelectorAll(itemSelector);
        items.forEach((item, index) => {
            // roving tabindex：整列只有一个 Tab 停靠点——实测用户的表有 347 条规则，
            // 每项都可 Tab 就是 347 个停靠点，键盘用户 Tab 到手脱。方向键在项间移
            // 焦点时同步搬迁 tabindex（见 keydown 的 roving 分支）
            item.tabIndex = index === 0 ? 0 : -1;
            item.setAttribute('aria-roledescription', '可拖拽排序项');
        });
    }
    function destroy() {
        for (const [target, type, handler, isCapture] of listeners) {
            // exactOptionalPropertyTypes：元组第四列可选（boolean | undefined），
            // 显式传 undefined 给 capture 会报错，收敛成布尔
            target.removeEventListener(type, handler, { capture: isCapture ?? false });
        }
        listeners.length = 0;
        teardownDragVisuals();
        if (keyboardDrag !== null)
            keyboardCancel(keyboardDrag);
        liveRegion.remove();
        container.removeAttribute('aria-roledescription');
    }
    refresh();
    return {
        refresh,
        destroy,
        isDragging: () => pointerDrag !== null || keyboardDrag !== null,
    };
}
