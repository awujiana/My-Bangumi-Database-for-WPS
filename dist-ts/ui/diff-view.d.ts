/**
 * @fileoverview 通用 diff 视图模块（diff2html 风格）
 * @module ui/diffView
 * @description
 * 把「待删除行 / 单元格新旧值 / 重复组保留对比」渲染成统一的 diff 视图，
 * 参考 diff2html 的行式呈现范式：**行号 + 变更标记 + 行级底色 + 行内高亮**。
 *
 * 行类型（{@link DiffRowKind}）：
 * - `keep`     保留行（重复组对比中的基准，标记 `=`）
 * - `delete`   将被删除的行 / 单元格旧值（标记 `-`，红色系）
 * - `insert`   变更后的新值（标记 `+`，绿色系）
 * - `context`  分组说明行（跨列单格，标记 `·`）
 *
 * 设计约束：
 * - **安全**：所有用户数据（工作表名、条目名、URL）先 `escapeHtml`，再整体过
 *   `sanitizeHtml`；「显示更多」的批量行追加走 `sanitizeTableRows` ——
 *   顶层裸 `<tr>` 会被 DOMPurify 按 HTML 规范剥离，必须包进表格上下文。
 * - **性能**：大列表分页渲染（默认每页 50 行），「显示更多」按批
 *   `insertAdjacentHTML` 追加，避免千行级 innerHTML 一次性注入导致任务窗格卡顿。
 * - **零依赖**：不引 diff2html 本体（任务窗格 CSP 禁外链、包体敏感），
 *   只复用其交互范式。
 */
/** diff 行的类型 */
export type DiffRowKind = 'keep' | 'delete' | 'insert' | 'context';
/** diff 视图的一行 */
export interface DiffRow {
    /** 行类型 */
    kind: DiffRowKind;
    /** Excel 行号（1-based；context 行可省略） */
    rowNumber?: number;
    /** 行单元格内容（原始文本，模块负责转义） */
    cells: readonly string[];
    /** 行尾补充说明（如「无 URL」「标签并入保留行」） */
    note?: string;
    /**
     * 行内 diff：设置后**最后一个单元格**按公共前后缀裁剪渲染
     * （`<span class="diff-del">` 旧中段 / `diff-ins` 新中段）。
     * delete 行与 insert 行应设置同一份 `{ oldValue, nextValue }`。
     */
    inlineDiff?: {
        oldValue: string;
        nextValue: string;
    };
}
/** diff 视图的一个区块（通常 = 一条规则 × 一个目标） */
export interface DiffSection {
    /** 稳定标识（分页状态键；同一容器内必须唯一） */
    id: string;
    /** 区块标题（如规则名） */
    title: string;
    /** 副标题（如目标标签 + 统计） */
    subtitle?: string;
    /** 表头列名 */
    columns: readonly string[];
    /** 数据行 */
    rows: readonly DiffRow[];
}
/** 渲染选项 */
export interface DiffRenderOptions {
    /** 每页行数（默认 50） */
    pageSize?: number;
}
/** 行内 diff 的四段裁剪结果 */
export interface InlineDiffParts {
    /** 公共前缀 */
    prefix: string;
    /** 旧值中段（差异部分） */
    oldMid: string;
    /** 新值中段（差异部分） */
    nextMid: string;
    /** 公共后缀 */
    suffix: string;
}
/**
 * 按公共前后缀裁剪新旧值，得到行内高亮的四段。
 * 纯函数、零依赖：不追求最小编辑脚本（LCS），只裁剪首尾公共部分——
 * 单元格值通常是小改动（去空格 / 改分隔符 / 补别名），前后缀裁剪已足够直观。
 */
export declare function splitInlineDiff(oldValue: string, nextValue: string): InlineDiffParts;
/** 渲染单行（context 行为跨列单格） */
export declare function renderDiffRow(row: DiffRow, columnCount: number): string;
/**
 * 把 diff 区块渲染进容器（整体替换容器内容）。
 *
 * @param container - 目标容器（null 时静默返回）
 * @param sections - 区块列表；空数组清空容器
 * @param options - 渲染选项（每页行数）
 */
export declare function renderDiffSections(container: HTMLElement | null, sections: readonly DiffSection[], options?: DiffRenderOptions): void;
/**
 * 「显示更多」按批追加（由容器点击委托调用，也可在测试中直接调用）。
 *
 * @returns 本次追加后的该区块剩余行数（0 = 已全部渲染）
 */
export declare function appendDiffPage(container: HTMLElement, sectionId: string): number;
/**
 * 绑定容器内的「显示更多」点击委托（幂等：重复调用不会重复绑定）。
 * {@link renderDiffSections} 内部已绑定，一般无需显式调用；
 * 仅当容器内容被外部逻辑重建后才需要重新绑定。
 */
export declare function bindDiffPagination(container: HTMLElement): void;
//# sourceMappingURL=diff-view.d.ts.map