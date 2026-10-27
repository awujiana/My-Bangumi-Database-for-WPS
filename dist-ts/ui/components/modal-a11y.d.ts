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
/**
 * 安装静态模态框无障碍增强（幂等）。页面入口（`*-bootstrap`）调用一次即可。
 */
export declare function installModalA11y(): void;
/** 卸载（仅测试使用） */
export declare function teardownModalA11y(): void;
//# sourceMappingURL=modal-a11y.d.ts.map