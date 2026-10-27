/**
 * @fileoverview 条件格式的 COM 读写层（探测 / 读快照 / 执行应用计划）
 * @module panel/conditionalFormatApply
 * @description 条件格式管理器的宿主交互全部收敛在本模块：
 *   1. {@link isFormatConditionsSupported}——老版本 WPS 不暴露 FormatConditions，
 *      探测失败时页面隐藏该功能并提示，不影响其它页；
 *   2. {@link readForeignRules}——应用前读工作表既有规则快照（供双策略决策与确认框列出）；
 *   3. {@link applyConditionalFormatPlan}——执行 {@link ConditionalFormatApplyPlan}：先清空（Delete）再逐条 Add + With，
 *      最后反序 SetFirstPriority 把 entries[0] 顶到最高优先级。
 *
 * 判断逻辑全在纯函数引擎（conditional-format-rules.ts）；本模块只做 IPC，每个宿主调用都
 * try 包裹并按条计数——单条失败不中断整批（与同步写入的「批次失败可见」一致）。
 */
import type { ConditionalFormatApplyPlan, ForeignRuleSnapshot } from './conditional-format-rules.js';
import type { WpsFormatCondition, WpsWorksheet } from '../tools/wps.js';
/** 应用结果统计（进日志与完成提示） */
export interface ConditionalFormatApplyResult {
    added: number;
    failed: number;
}
/**
 * 探测宿主是否支持条件格式 API
 *
 * 判据是 UsedRange 上能拿到 FormatConditions 且 Add 是函数——只读属性、
 * 不创建任何规则。部分 WPS 版本 / 只读代理下为 false。
 */
export declare function isFormatConditionsSupported(worksheet: WpsWorksheet | null | undefined): boolean;
/**
 * 检查能否枚举既有规则
 *
 * @returns 能枚举返回 null；否则返回**原因**（页面据此区分「这张表没有规则」和
 *   「根本读不到规则」——后者曾被静默当成前者，用户看到的是误导性的空列表）
 */
export declare function checkFormatConditionsReadable(worksheet: WpsWorksheet | null | undefined): string | null;
/**
 * 取第 index 条（1 基，与 FormatConditions.Item 一致）规则对象
 *
 * 统一入口：调用方拿不到对象时（Item 不存在 / 越界 / 宿主抛错）返回 null，
 * 由调用方给出「操作失败」提示，不静默当成功。
 *
 * ⚠️ **索引空间必须与 {@link readForeignRules} 一致**：读取走 Sheet 级
 * FormatConditions（全表规则），这里若走 UsedRange 级，两条规则范围若不在
 * UsedRange 内，两个集合的条目数与排序就会错位——表格第 N 行点「上移」，
 * 动的将是另一条规则（观感：点一下整组规则莫名其妙换序）。故同样优先
 * Sheet 级、个别 WPS 版本无该属性时回退 UsedRange（与 readForeignRules 同序）。
 */
export declare function getForeignCondition(worksheet: WpsWorksheet | null | undefined, index: number): WpsFormatCondition | null;
/**
 * 删除工作表上第 index 条既有规则
 *
 * WPS 对 FormatCondition.Delete 的支持随版本/只读代理而变，故用可选调用 +
 * try 包裹：失败返回错误文案（页面提示），绝不静默返回成功。
 */
export declare function deleteForeignRule(worksheet: WpsWorksheet | null | undefined, index: number): {
    ok: true;
} | {
    ok: false;
    error: string;
};
/**
 * 设置「如果为真则停止」
 *
 * 同理：写不进去就明说，不假装成功（用户会以为设置生效了）。
 */
export declare function setForeignStopIfTrue(worksheet: WpsWorksheet | null | undefined, index: number, isStopIfTrue: boolean): {
    ok: true;
} | {
    ok: false;
    error: string;
};
/**
 * 改第 index 条既有规则的应用范围
 *
 * 走 FormatCondition.ModifyAppliesToRange（WPS 文档方法）。
 * 写不进去就明说（宿主版本不支持 / 范围字符串非法），由页面还原输入。
 */
export declare function setForeignAppliesTo(worksheet: WpsWorksheet | null | undefined, index: number, range: string): {
    ok: true;
} | {
    ok: false;
    error: string;
};
/**
 * 改第 index 条既有规则的公式（Formula1 赋值）
 *
 * 与 setForeignStopIfTrue 同款：VBA 口径 Formula1 可写，JS 侧属性赋值；
 * 宿主只读时抛错，返回错误文案由页面提示并还原输入框。
 */
export declare function setForeignFormula(worksheet: WpsWorksheet | null | undefined, index: number, formula: string): {
    ok: true;
} | {
    ok: false;
    error: string;
};
/**
 * 调整既有规则优先级：与相邻规则**交换一格**（-1 上移 / +1 下移）
 *
 * ## 为什么不再用 SetFirstPriority / SetLastPriority
 * 那两个方法是**绝对**置顶 / 置底：点一次「上移」，第 20 条瞬移到第 1 条。
 * 分组视图按「组名桶 + 首现顺序」渲染，整组跟着跳到表顶——用户实测观感是
 * 「点上移结果变成了新的分组」。行内 tooltip 写的是「上移（提高优先级）」
 * （一格），实现必须与之一致。
 *
 * ## 交换算法
 * FormatConditions 没有「移动一格」的原语，但 FormatCondition.Priority 可读写：
 * 把两条的 Priority 互换即完成相邻交换（宿主负责重排其余规则的名次）。
 * 写后**回读校验**——宿主忽略写入时（只读代理 / 老版本）Priority 原样不动，
 * 据此返回明确错误；不静默置顶，也不假装成功（项目铁律：写不进去就明说）。
 *
 * 已知局限：个别宿主若「接受写入但不保证唯一名次」，校验能抓到值未互换的
 * 情况并报错，但规则可能已停在半交换态——此时重读整表即恢复真实视图，
 * 用户可按提示重试或改用 WPS 原生规则管理器。
 */
export declare function moveForeignRule(worksheet: WpsWorksheet | null | undefined, index: number, direction: -1 | 1): {
    ok: true;
} | {
    ok: false;
    error: string;
};
/**
 * 读工作表既有条件格式规则快照
 *
 * 走 worksheet.FormatConditions（**全表**规则，各自带 AppliesTo）—— 对标 WPS 原生
 * 规则管理器的全表口径。先前用 UsedRange.FormatConditions：只收与 UsedRange 相交的
 * 规则，且相交规则的 AppliesTo 在部分 WPS 版本读不到 → 「应用于」列显示「（未读到范围）」。
 * 兜底：个别 WPS 版本 Sheet 无 FormatConditions 时回退 UsedRange（不完整但不空）。
 * Count 提到循环外单次读取（com-in-loop 铁律：循环条件里不读 COM 属性）。
 */
export declare function readForeignRules(worksheet: WpsWorksheet | null | undefined): ForeignRuleSnapshot[];
/**
 * 执行应用计划
 *
 * 顺序：UsedRange 上 Delete() 清空 → 逐条 Range(范围).FormatConditions.Add →
 * With 上格式 → **反序 SetFirstPriority**（每调一次都把该规则顶到最高，
 * 反序走完后 entries[0] 即为最高优先级——不依赖 Add 的默认优先序）。
 *
 * @returns 成功 / 失败条数（失败进 WARN 日志，不中断整批）
 */
export declare function applyConditionalFormatPlan(worksheet: WpsWorksheet | null | undefined, plan: ConditionalFormatApplyPlan): ConditionalFormatApplyResult;
//# sourceMappingURL=conditional-format-apply.d.ts.map