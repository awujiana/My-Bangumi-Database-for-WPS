/**
 * @fileoverview 通用右键菜单（任何页面的任何组件可挂，单例）
 * @module ui/components/contextMenu
 * @description 六个页面共用的「右键菜单 / 上下文菜单」组件。此前的交互只有
 *   行内小按钮与底部批量条：按钮挤在 96px 操作列里（↑↓✕⤵ 挤一排），
 *   低频操作（导入 / 归组 / 切换「如果为真则停」）要么没有入口、要么藏在
 *   批量条里要先勾选。右键菜单把「针对这一行的全部操作」收到指针处，
 *   任何组件一行接线即可挂载：
 *
 *   ```ts
 *   attachContextMenu(row, () => [
 *     { id: 'edit', label: '✎ 编辑', onSelect: () => openEditor(row.dataset.ruleId) },
 *     { id: 'sep', separator: true },
 *     { id: 'del', label: '✕ 删除', danger: true, onSelect: () => remove(row.dataset.ruleId) },
 *   ])
 *   ```
 *
 *   设计要点（对标 VS Code / dnd-kit 生态菜单的手感）：
 *   - **单例**：同时只存在一个菜单，开新的先关旧的（绝不叠罗汉）；
 *   - **视口翻转**：默认在指针处展开，右 / 下溢出时翻到另一侧，永不出屏；
 *   - **完整键盘**：↑↓ 循环导航、Home/End、Enter 执行、Esc 关闭并还原焦点，
 *     Tab 不困在菜单里（直接关）；aria role=menu/menuitem；
 *   - **关闭时机**：Esc、外部点击、窗口 scroll/resize（页面滚走还挂在原地的
 *     菜单比没有更糟）、执行动作后；
 *   - **危险操作**标红但不二次确认（确认由调用方的 onSelect 负责，菜单只递达）。
 */
/** 可执行菜单项 */
export interface ContextMenuAction {
    /** 稳定 id（同一份菜单内唯一） */
    id: string;
    /** 显示文本（项目风格：emoji 前缀 + 中文） */
    label: string;
    /** 右侧快捷键提示（纯展示，如 'Ctrl+C'） */
    shortcut?: string;
    /** 危险操作（删除类）：红色，hover 也更醒目 */
    danger?: boolean;
    /** 禁用：不可聚焦、不可点（保留可见，让用户知道「有这操作但现在不行」） */
    disabled?: boolean;
    /** 禁用时的原因（进 title 提示；不填用通用文案） */
    disabledReason?: string;
    /**
     * 选中回调。返回 `false` 可阻止关闭（极少用，如「切换」类操作想留在菜单里）；
     * 默认执行后关闭。同步抛错会被吞掉并打日志——不让一个坏项弄坏菜单骨架。
     *
     * 返回类型用 `unknown` 而非 `void | boolean | Promise<void>`：项目的
     * no-invalid-void-type 禁 union 里出现 void；调用方什么都不返回（多数）
     * 或返回 boolean / Promise 都合法，内部只关心 `=== false` 与 Promise 两种形态。
     */
    onSelect?: () => unknown;
    /** 占位：可执行项不是分隔线（联合判别用，见 ContextMenuItem） */
    separator?: never;
}
/** 分隔线项：只能给 id + separator，其余字段一律不许给（写错编译期就红） */
export interface ContextMenuSeparator {
    id: string;
    separator: true;
    label?: never;
    shortcut?: never;
    danger?: never;
    disabled?: never;
    disabledReason?: never;
    onSelect?: never;
}
/** 菜单项 = 可执行项 | 分隔线 */
export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;
/** showContextMenu 的入参 */
export interface ContextMenuShowOptions {
    items: readonly ContextMenuItem[];
    /** 指针 clientX（右键事件的 clientX） */
    x: number;
    /** 指针 clientY */
    y: number;
    /** 触发元素：关闭后焦点还原给它；不传则不还原 */
    anchor?: HTMLElement;
}
/** 视口翻转 + 钳位的纯计算（菜单定位的唯一算法，单测直测） */
export declare function resolveMenuPosition(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    /** 距视口边缘留白（px） */
    margin?: number;
}): {
    left: number;
    top: number;
};
/** 关菜单（幂等；没开时 no-op） */
export declare function hideContextMenu(): void;
/** 菜单是否开着 */
export declare function isContextMenuOpen(): boolean;
/**
 * 在指定坐标打开菜单（单例：已在开先关旧的）
 *
 * 定位算法见 {@link resolveMenuPosition}：先按内容实测宽高（挂到 DOM 后再量），
 * 再翻转钳位。打开期间锁三件事：外部点击关闭、scroll/resize 关闭、Esc 关闭。
 */
export declare function showContextMenu(options: ContextMenuShowOptions): void;
/**
 * 给元素挂右键菜单（稳定元素用；动态列表的行用 {@link attachDelegatedContextMenu}）
 *
 * @param provider 菜单项提供者：每次右键时调用（可按元素 dataset / 状态返回
 *   不同菜单）；返回空数组 = 不拦默认菜单（让浏览器原生菜单出来）。
 * @returns 解绑函数（组件销毁 / DOM 搬家后调用；detachable-panel 的
 *   appendChild 搬家不丢监听器，但卸载旧 DOM 时必须解）
 */
export declare function attachContextMenu(element: HTMLElement, provider: (element: HTMLElement) => readonly ContextMenuItem[]): () => void;
/**
 * 委托式挂右键菜单（给「行会反复重渲染」的动态列表用）
 *
 * 逐行 attachContextMenu 在 innerHTML 重渲染后要全部解绑重挂（347 行就是
 * 347 次 add/remove），还容易漏。委托挂在**容器**上：contextmenu 冒泡到容器，
 * 用 closest(itemSelector) 找到行——重渲染只换子节点，容器监听不动。
 *
 * @param provider 菜单项提供者：每次右键时调用（可按行 dataset / 状态返回不同菜单）；
 *   返回空数组 = 不拦默认菜单
 * @returns 解绑函数
 */
export declare function attachDelegatedContextMenu(container: HTMLElement, itemSelector: string, provider: (item: HTMLElement) => readonly ContextMenuItem[]): () => void;
//# sourceMappingURL=context-menu.d.ts.map