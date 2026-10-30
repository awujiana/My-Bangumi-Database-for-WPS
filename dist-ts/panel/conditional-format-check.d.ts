/**
 * @fileoverview 条件格式规则「体检」（纯函数：只判不改，改由 {@link fixRule} 产出新值）
 * @module panel/conditionalFormatCheck
 * @description
 *   起因（momo 真机反馈）：导入的一条规则报「没写进工作表：导入 B2:B50001」，
 *   而当时**没有任何前置检查** —— 规则带着非法范围进了库，直到「应用」才在
 *   COM 层炸掉，用户只看到一句 toast，既不知道哪条坏了、也不知道怎么改。
 *
 *   所以体检分两层，各自对接一个时机：
 *   1. **导入前**：解析完规则先体检，有问题直接开「规则体检」弹窗，修完才入库
 *      （脏规则根本不该进库）；
 *   2. **应用前**：应用前再体检一遍（库里的规则可能被手改成脏的），有问题同样
 *      弹窗；应用后回读不到的规则也进同一个弹窗，并附上 COM 给的真实原因。
 *
 *   为什么不在 Add 失败时才处理：COM 抛错时规则已经写了一半（前面几条已落表），
 *   用户在 toast 里点不了、改不了、重试不了 —— 只能去看日志。
 *
 *   每条问题都带 `blocking`：
 *   - `true` = 宿主一定会拒绝（范围非法 / 公式空 / 引号不配对），必须修；
 *   - `false` = 能写进去但**结果不对**（如范围在 B 列、公式却在判 I 列）——
 *     这类不拦，但要摆在用户眼前，否则就是「写进去了却看着没生效」。
 */
/** 体检发现的某一类问题 */
export type RuleIssueCode = 'range-empty' | 'range-unparsable' | 'range-sheet-prefix' | 'range-out-of-sheet' | 'formula-empty' | 'formula-redundant-equals' | 'formula-quote-unbalanced' | 'formula-other-sheet' | 'range-formula-column-mismatch' | 'color-invalid';
/** 一条问题 */
export interface RuleIssue {
    /** 问题类别（UI 排序 / 测试断言用） */
    code: RuleIssueCode;
    /** 出问题的字段（决定编辑弹窗里高亮哪一格） */
    field: 'appliesTo' | 'formula' | 'interior' | 'fontColor';
    /** 人话说明（直接显示在弹窗里） */
    message: string;
    /** 自动修复后的值；没有安全修法时缺省（不能瞎猜的字段不给自动修） */
    fixed?: string;
    /** true = 宿主会拒绝，必须修完才能应用 / 导入 */
    blocking: boolean;
}
/** 可被体检的最小规则形状（`ConditionalFormatRule` 与导入快照都满足） */
export interface InspectableRule {
    appliesTo: string;
    formula: string;
    interior?: string;
    fontColor?: string;
}
/**
 * 剥掉范围里的「工作表名 / 工作簿名」前缀
 *
 * `Sheet1!B2:B10`、`'动画 2026'!B2:B10` 这类写法在**跨表引用**里合法，但
 * 条件格式的 AppliesTo 必须落在本表：`worksheet.Range("Sheet1!B2:B10")` 在
 * WPS 里直接抛错（表现就是「这条没写进工作表」，且原因写在日志里没人看）。
 *
 * @returns 去掉前缀后的范围；没有前缀则原样返回
 */
export declare function stripSheetPrefix(range: string): string;
/**
 * 体检一条规则
 *
 * @param rule 待检规则（范围 / 公式 / 颜色）
 * @returns 问题列表（**空数组 = 健康**；顺序 = 阻断项在前）
 */
export declare function inspectRule(rule: InspectableRule): RuleIssue[];
/** 是否有「必须修」的问题 */
export declare function hasBlockingIssue(issues: readonly RuleIssue[]): boolean;
/**
 * 把所有**能自动修**的问题修掉（返回新对象，不改入参）
 *
 * ## 为什么一轮只修一条、修完重新体检
 * 修法是按「体检时的值」算出来的（如「补一个引号」是给当时的公式串追加 `"`）。
 * 若把几条修法一次性套上去，第二条会把第一条冲掉 —— 实测
 * `==$I2="x`：先去多余等号得 `=$I2="x`，再按**原串**补引号得 `==$I2="x"`，
 * 越修越回去了。所以每修一条就重新体检一次，直到没有可修的为止。
 *
 * 同一个 `code` 只修一次，配合轮次上限（8）——防的是「修法本身制造新问题」
 * 时死循环。
 *
 * @param rule 原规则
 * @returns 修好的新规则 + 实际应用的修法（弹窗里要告诉用户改了什么）
 */
export declare function fixRule<T extends InspectableRule>(rule: T): {
    rule: T;
    applied: RuleIssue[];
};
/**
 * 体检一批规则（导入 / 应用前的统一入口）
 *
 * @param rules 待检规则
 * @param pickName 规则名（弹窗里显示）；不传则用「#序号」
 * @returns 有问题**且需要用户处理**的条目（阻断项或全部？—— 见 `blockingOnly`）
 */
export declare function inspectRules<T extends InspectableRule>(rules: readonly T[], pickName?: (rule: T, index: number) => string): {
    rule: T;
    index: number;
    name: string;
    issues: RuleIssue[];
}[];
//# sourceMappingURL=conditional-format-check.d.ts.map