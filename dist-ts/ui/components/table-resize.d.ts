/**
 * @fileoverview 表格列宽 / 行高拖拽（拖完记住，双击回到自动）
 * @module ui/components/table-resize
 *
 * 为什么单独抽：条件格式页有四张表（工作表规则 / 我的规则 / 导入弹框 / 粘贴表格），
 * 各自渲染行，但「列模板 + 表头 + 可拖动」是同一件事。列宽此前写死在 CSS 里——
 * 窄任务窗格下长公式永远被截断，用户又调不了。
 *
 * 设计取舍：
 * 1. **一列一个 CSS 变量 `--table-col-<i>`**：行是逐行 CSS Grid（不是一个大 grid
 *    容器），所以列模板写在每一行上。若把「整串模板」交给组件生成，组件就得在 JS
 *    里再抄一份各表的默认模板 —— 两份默认值必然漂移（本页的列模板此前就在 CSS 里
 *    定义过两遍，后一份静默覆盖前一份）。改成「每列一个带兜底值的变量」后：
 *
 *        grid-template-columns: var(--table-col-0, 30px) var(--table-col-1, 34px) …;
 *
 *    默认值**只存在于 CSS**，组件只负责「把用户拖过的列写成固定 px」，
 *    没拖过的列连属性都不写（自动回落到 CSS 兜底值）。组件因此不需要知道
 *    有几列、每列默认多宽。
 * 2. **默认 auto**：双击把手 = 删掉该列的变量 = 回到「自动调整」。
 * 3. **事件委托**：表头每次重渲染都会换新节点，逐节点绑监听器会全丢；把手是纯标记，
 *    监听挂在容器上一次即可，`decorate()` 只负责补把手（幂等）。
 * 4. **不碰存储**：状态通过 `onChange` 抛给调用方（页面写 PluginStorage），组件零依赖、
 *    可单测。
 */
/** 表格尺寸状态（持久化用） */
export interface TableSizeState {
    /** 每列固定宽度（px）；`null` / 缺位 = 自动（用 CSS 里的默认模板） */
    cols: (number | null)[];
    /** 行高（px）；`null` = 自动 */
    rowHeight: number | null;
}
/** {@link bindTableResize} 的入参 */
export interface TableResizeOptions {
    /** 表格容器（行都在它里面；`--table-col-*` / `--table-row-h` 挂在它上面） */
    container: HTMLElement;
    /** 上次保存的尺寸（没有 = 全自动） */
    initial?: Partial<TableSizeState>;
    /** 尺寸变化时回调（写存储用） */
    onChange?: (state: TableSizeState) => void;
    /** 列最小宽度（px），默认 48 */
    minColumnWidth?: number;
    /** 行最小高度（px），默认 22 */
    minRowHeight?: number;
}
/** {@link bindTableResize} 的返回值 */
export interface TableResizeController {
    /** 每次重渲染表格后调用：重新应用变量 + 补把手（幂等） */
    decorate: () => void;
    /** 全部恢复自动 */
    reset: () => void;
    /** 当前状态（持久化用；返回副本） */
    getState: () => TableSizeState;
    /** 解绑并清掉变量与把手 */
    destroy: () => void;
}
/**
 * 给一张表接上「拖列宽 / 拖行高」
 *
 * @param options 见 {@link TableResizeOptions}
 * @returns 控制器（`decorate` / `reset` / `getState` / `destroy`）
 */
export declare function bindTableResize(options: TableResizeOptions): TableResizeController;
//# sourceMappingURL=table-resize.d.ts.map