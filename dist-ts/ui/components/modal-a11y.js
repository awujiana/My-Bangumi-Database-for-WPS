/**
 * @fileoverview 静态模态框无障碍增强（P2-10）
 * @module ui/components/modalA11y
 * @description
 * 页面内静态模态框（`ui/*.html` 中的 `.modal` / `.detail-modal`）此前只能靠鼠标关闭：
 * 缺 `role="dialog"` / `aria-modal`、缺 ESC 关闭（仅进度组件支持）、缺焦点陷阱（Tab 会逃逸到背景）。
 * 本模块以 **document 级事件委托**补齐 ESC 与焦点陷阱：页面入口调用一次 `installModalA11y()` 即可，
 * 无需在每个 show/hide 调用点改动。
 *
 * 设计要点：
 * - 关闭一律「点击模态框自身的关闭控件」，确保既有清理 / 回调逻辑照常执行；
 *   找不到关闭控件时**不做任何处理**，避免强行 `display: none` 破坏内部状态机。
 * - 只覆盖静态 `.modal` / `.detail-modal`。`dialog.ts` 与 `progress.ts` 动态创建的
 *   `.bgm-modal` 不在范围内：前者已自带 role/aria-modal，后者自管 ESC 且运行期需保持阻塞。
 */
/** 静态模态框容器 */
const MODAL_SELECTOR = '.modal, .detail-modal';
/** 模态框内的关闭控件（点击它等价于用户点关闭） */
const CLOSE_SELECTOR = '.modal-close-btn, .detail-close-btn, [data-action^="close"]';
/** 可在模态框内获得焦点的元素（不依赖布局，jsdom 下亦可用） */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let keydownHandler = null;
/** 仅凭内联 `display` 判定可见性：静态模态框均以 `style.display = 'none' | 'flex'` 切换 */
function isVisible(element) {
    return element.style.display !== 'none' && !element.hidden;
}
function visibleModals() {
    return [...document.querySelectorAll(MODAL_SELECTOR)].filter((element) => isVisible(element));
}
/** 最上层（文档顺序最后）的可见模态框 */
function topmostModal() {
    return visibleModals().at(-1) ?? null;
}
function focusableWithin(modal) {
    return [...modal.querySelectorAll(FOCUSABLE_SELECTOR)];
}
/** 找出模态框自身的关闭控件；不存在则返回 null（此时不强关） */
function findCloseControl(modal) {
    return modal.querySelector(CLOSE_SELECTOR);
}
function handleKeydown(event) {
    const modal = topmostModal();
    if (!modal)
        return;
    if (event.key === 'Escape') {
        const control = findCloseControl(modal);
        if (control) {
            control.click();
            event.preventDefault();
        }
        return;
    }
    if (event.key !== 'Tab')
        return;
    const focusable = focusableWithin(modal);
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
        // 无可聚焦元素：不让 Tab 逃逸到背景
        event.preventDefault();
        return;
    }
    const active = document.activeElement;
    const isInside = active instanceof HTMLElement && modal.contains(active);
    if (event.shiftKey) {
        if (!isInside || active === first) {
            event.preventDefault();
            last.focus();
        }
        return;
    }
    if (!isInside || active === last) {
        event.preventDefault();
        first.focus();
    }
}
/**
 * 安装静态模态框无障碍增强（幂等）。页面入口（`*-bootstrap`）调用一次即可。
 */
export function installModalA11y() {
    if (keydownHandler)
        return;
    if (typeof document === 'undefined')
        return;
    keydownHandler = handleKeydown;
    // 捕获阶段：先于模态框内部的按键处理执行，保证 Tab 不会先逃逸
    document.addEventListener('keydown', keydownHandler, { capture: true });
}
/** 卸载（仅测试使用） */
export function teardownModalA11y() {
    if (!keydownHandler)
        return;
    document.removeEventListener('keydown', keydownHandler, { capture: true });
    keydownHandler = null;
}
