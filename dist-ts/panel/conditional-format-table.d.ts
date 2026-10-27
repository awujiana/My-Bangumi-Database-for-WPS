/**
 * @fileoverview 既有条件格式规则的表格呈现引擎（纯函数，零 WPS / DOM 依赖）
 * @module panel/conditionalFormatTable
 * @description 「既有规则」区从纯文本列表升级为**表格**（对标 WPS 规则管理器并更强）：
 *   列 = 优先级序号 / 类型 / 格式预览 / 应用于 / 公式 / 如果为真则停止 / 操作。
 *
 * 为什么把 HTML 生成也做成纯函数：
 *   347 条规则（实测用户表就是这个量级）下，页面层每次渲染都要重建整棵列表。
 *   行 HTML 抽成纯函数后可以脱离 jsdom 单测「转义 / 越界 / 空值」三类边界，
 *   页面层只管拼装与事件委托。
 *
 * 与 WPS 原生的差异（本项目更强的点）：
 *   - 支持对既有规则**搜索**（WPS 只有「当前选择 / 整表」下拉）；
 *   - 支持把任意一条既有规则**一键导入规则库**（变成可管理的插件规则）；
 *   - 分页渲染，347 条不卡（WPS 一次性渲染整表会明显掉帧）；
 *   - 格式预览同时显示填充色与字体色（WPS 只显示填充）。
 */
import type { ForeignRuleSnapshot } from './conditional-format-rules.js';
/** WPS XlFormatConditionType → 中文标签（与 WPS 规则管理器口径一致） */
export declare const FC_TYPE_LABELS: Record<number, string>;
/** 取类型标签（读不到类型号时按 kind 给兜底文案） */
export declare function fcTypeLabel(type: number | undefined, kind: 'expression' | 'other'): string;
/** 表格的一行（由快照派生，全部为渲染所需，不直接持 COM 对象） */
export interface ForeignRuleRow {
    /** 1 基序号，即优先级（靠前先生效）；同时是 COM 层 Item() 的下标 */
    index: number;
    /**
     * 分组映射的查找键（= snapshotGroupKey(快照)，公式 \0 原始范围）
     *
     * ⚠️ 不能用行上的 `range` 字段现算：那个字段读不到范围时是**显示兜底**
     * 「（未读到范围）」，而分组映射（existingGroups）是用**原始**范围存的——
     * 拿兜底串算 key 永远命中不了，范围读不到的规则会死死掉进「未分组」，
     * 归组 / 重命名对它全部静默失效（2026-10-24 修：渲染层与存储层的 key 口径统一）。
     */
    groupKey: string;
    /** 类型中文标签 */
    typeLabel: string;
    /** 插件能否按原样重建（false = 数据条 / 图标集等，导入时会说明） */
    rebuildable: boolean;
    /** 填充色（'#00B050'；读不到留空） */
    fillColor?: string;
    /** 字体色 */
    fontColor?: string;
    /** 生效范围地址 */
    range: string;
    /** 公式（非公式类为空串） */
    formula: string;
    /** 「如果为真则停止」；undefined = 宿主未暴露该属性 */
    stopIfTrue?: boolean;
    /** 是否被选中（多选） */
    selected: boolean;
}
/**
 * 快照 → 行模型（序号由数组下标推，保证与 FormatConditions.Item 一致）
 *
 * @param selection 已选中的 1 基序号集合（跨筛选 / 翻页保持：用户在第 2 页选的，
 *   翻回第 1 页仍然勾着 —— 这是多选的基本预期，做不到就是 bug）
 */
export declare function toForeignRuleRows(snapshots: readonly ForeignRuleSnapshot[], selection?: ReadonlySet<number>): ForeignRuleRow[];
/**
 * 当前可见行里「是否全选」与「半选」（全选复选框的三态）
 *
 * 半选用 `indeterminate` 而不是用第三个图标：原生 checkbox 支持该属性，
 * 且读屏软件能正确播报「部分选中」。
 */
export declare function selectionSummary(visibleRows: readonly ForeignRuleRow[]): {
    isAllSelected: boolean;
    isSomeSelected: boolean;
};
/**
 * 把序号在选中集合里加入 / 移除（返回新集合，不改原集合）
 *
 * 不可变：渲染层每次都是 `state.existingSelection = toggleSelection(...)` 再重渲染，
 * 改原集合会让「上一次渲染的旧行模型」和「当前 state」指向同一个 Set，
 * 出现「取消了勾选但旧行还显示勾着」的灵异画面。
 */
export declare function toggleSelection(selection: ReadonlySet<number>, index: number, isSelected: boolean): Set<number>;
/**
 * 解析 A1 范围地址为可比较的矩形（绝对引用符 `$` 先剥掉）
 *
 * 支持 `A1` / `A1:B9` / `A:A`（整列）/ `1:10`（整行）三种形态；
 * 解析不了返回 null —— 调用方按「不相交」处理并在 UI 上说明，
 * 而不是抛错把整张表都藏掉。
 *
 * 行 / 列的「0」表示该维度不限：`A:A` 的 row 是 0..0，与任何行范围都算相交。
 */
/**
 * 列字母转列号（A→1，Z→26，AA→27）
 *
 * 用 `charCodeAt` 逐字符算而不是 `[...letters]` 展开：展开运算符遇组合字符 / emoji
 * 会拆成码点，而列字母只可能是 ASCII，逐字符更稳也更快。
 */
export declare function columnNumberOf(letters: string): number;
export declare function parseRangeRect(range: string): {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
} | null;
/** 两个 A1 范围是否相交（含「整列 / 整行」语义） */
export declare function hasRangeOverlap(first: string, second: string): boolean;
/**
 * 按「显示其格式规则」范围筛选行
 *
 * `selection` 时只保留 AppliesTo 与选区相交的规则 —— 用户框了一列想看
 * 「这条列上挂了哪些条件」时不用在 347 条里翻（对齐 WPS 原生下拉）。
 */
export declare function filterRowsByScope(rows: readonly ForeignRuleRow[], scope: 'all' | 'selection', selectionRange: string): ForeignRuleRow[];
/**
 * 搜索既有规则（类型 / 范围 / 公式 / 颜色，大小写不敏感子串）
 *
 * 颜色也进索引：实测用户找规则时经常记得「那条黄色的」而不记得公式。
 */
export declare function filterForeignRuleRows(rows: readonly ForeignRuleRow[], query: string): ForeignRuleRow[];
/** 每页行数：347 条分 7 页；单页 DOM 量可控，翻页无感 */
export declare const FOREIGN_RULE_PAGE_SIZE = 50;
export interface Page<T> {
    /** 当前页码（1 基） */
    page: number;
    /** 总页数（至少 1，空列表也是 1 页） */
    pageCount: number;
    /** 本页条目 */
    items: T[];
}
/**
 * 切片分页（页码越界时收敛到合法区间，避免「删完最后一页后停在空页」）
 */
export declare function paginate<T>(items: readonly T[], page: number, pageSize?: number): Page<T>;
/** 格式预览：填充块 + 字体色细条（WPS 只显示填充，这里两个都给） */
export declare function formatSwatchHtml(row: ForeignRuleRow): string;
/**
 * 生成单行 HTML
 *
 * 所有用户/宿主可控字符串都过 {@link escapeHtml}——公式与范围来自 Excel 内容，
 * 是 XSS 的入口（本页 CSP 禁 inline script，但仍要防 attribute 注入）。
 * 交互走 `data-action` + 容器事件委托，不给每行绑监听器（347 行 = 347×N 个监听器）。
 */
export declare function buildForeignRuleRowHtml(row: ForeignRuleRow): string;
/**
 * 表头（与 buildForeignRuleRowHtml 的列一一对应）
 *
 * 全选复选框带 `data-action="select-all"`，`indeterminate` 由页面层在渲染后设置
 * （HTML 属性表达不了三态，必须走 DOM property）。
 *
 * 三个类各有分工，缺一个都会静默失效：
 * - `conditional-format-row`：与数据行共用同一套 `--table-cols` 列模板；
 * - `conditional-format-table-head`：表头观感（灰字/加粗/浅底 + 列名不吃事件）；
 * - `table-resize-head`：列宽/行高把手的插入点（`decorate()` 只认这个类）。
 */
export declare function buildForeignRuleHeadHtml(isAllSelected?: boolean): string;
/**
 * 既有规则表格的本地分组渲染
 *
 * 组序 = 组内首条规则的出现顺序（Map 插入序），「未分组」恒排最后。
 * 标题复用规则库分组的 class（group-title / group-toggle / group-count），
 * 两处观感天然一致；折叠只藏行、计数仍在（看得出这组有多少条）。
 *
 * 标题上除收起钮外还有两个组级操作：✎ 重命名（组内全部规则换组名）、
 * ✕ 解散（映射清除，规则回「未分组」）——只靠「先勾行再找批量条」的归组
 * 入口不符合「看到组标题就能改组名」的心智（2026-10-24 用户实测反馈）。
 *
 * @param groups snapshotGroupKey → 组名（页面层从 PluginStorage 读出）
 * @param collapsed 被收起的分组名集合（会话态）
 */
export declare function buildForeignRuleGroupsHtml(rows: readonly ForeignRuleRow[], groups: Readonly<Record<string, string>>, collapsed: ReadonlySet<string>): string;
//# sourceMappingURL=conditional-format-table.d.ts.map