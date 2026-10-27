/**
 * @fileoverview 条件格式的 COM 读写层（探测 / 读快照 / 执行应用计划）
 * @module panel/conditionalFormatApply
 * @description 条件格式管理器的宿主交互全部收敛在本模块：
 *   1. {@link isFormatConditionsSupported}——老版本 WPS 不暴露 FormatConditions，
 *      探测失败时页面隐藏该功能并提示，不影响其它页；
 *   2. {@link readForeignRules}——应用前读工作表既有规则快照（供指纹比对与确认框列出）；
 *   3. {@link applyConditionalFormatPlan}——执行 {@link ConditionalFormatApplyPlan}：
 *      **默认不清空**，只按计划新增 / 刷新 / 删除「插件自己那一份」；
 *      仅当 `plan.clearAll` 为真（用户显式选择「清空整表后应用」）才整表重来。
 *
 * 判断逻辑全在纯函数引擎（conditional-format-rules.ts）；本模块只做 IPC，每个宿主调用都
 * try 包裹并按条计数——单条失败不中断整批（与同步写入的「批次失败可见」一致）。
 */
import type { ConditionalFormatApplyPlan, ForeignRuleSnapshot } from './conditional-format-rules.js';
import type { WpsFormatCondition, WpsWorksheet } from '../tools/wps.js';
/** 应用结果统计（进日志与完成提示） */
export interface ConditionalFormatApplyResult {
    /** 新写入的条数 */
    added: number;
    /** 表上已存在、只刷新了格式的条数 */
    refreshed: number;
    /** 移除的「上一轮自己写的、规则库里已删掉」的条数 */
    deleted: number;
    /** 写入失败的条数 */
    failed: number;
    /** 写完后回读到的整表条数（-1 = 宿主不支持回读）；页面据此判「是否真的写进去了」 */
    verified: number;
    /**
     * 写完后回读「规则库里有、表上却找不到」的规则名
     *
     * 这是「规则应用不上去」的唯一可靠判据：`Add` 返回了对象、整表条数也涨了，
     * 仍可能因为公式非法 / 范围越界 / 宿主丢弃而**这一条**没生效。只报总数会
     * 把这种局部失败说成「已写入 N 条」，用户去表上找不到却无从定位。
     */
    missing: string[];
}
/**
 * 探测宿主是否支持条件格式 API
 *
 * 判据是能拿到 FormatConditions 且 Add 是函数——只读属性、不创建任何规则。
 * 部分 WPS 版本 / 只读代理下为 false。
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
 * 走 FormatCondition.ModifyAppliesToRange（WPS 文档方法），**写后回读比对**：
 * 宿主接受调用却不生效时（只读代理 / 老版本），不回读就会提示「已改为 X」
 * 而表上没变——正是用户反馈的「修改后无法应用到工作表」。
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
 * 同样**写后回读**——赋值不抛错不代表生效。
 */
export declare function setForeignFormula(worksheet: WpsWorksheet | null | undefined, index: number, formula: string): {
    ok: true;
} | {
    ok: false;
    error: string;
};
/**
 * 编辑一条既有规则时可改的字段（未提供的字段不动）
 *
 * 范围走 `ModifyAppliesToRange`、公式走 `Formula1` 赋值、颜色走 `With`——
 * 与新建规则用的同一套宿主能力，避免「编辑器里改得了、应用时改不了」的两套口径。
 */
export interface ForeignRulePatch {
    range?: string;
    formula?: string;
    interior?: string;
    fontColor?: string;
    fontBold?: boolean;
}
/** 编辑既有规则的结果：`warnings` 是「写进去了但回读不一致」的软告警 */
export type ForeignRuleUpdateResult = {
    ok: true;
    changed: string[];
    warnings: string[];
} | {
    ok: false;
    error: string;
    warnings: string[];
};
/**
 * 编辑工作表上第 index 条既有规则（范围 / 公式 / 填充色 / 字体色 / 加粗）
 *
 * ## 为什么每条都要回读校验
 * WPS 的 `Formula1` / `ModifyAppliesToRange` 在部分版本上是**接受赋值但不生效**的
 * 只读代理：不校验就会提示「已更新」，而表上纹丝不动——这正是用户反馈的
 * 「规则管理器修改后无法应用到工作表」。故写后立刻回读：
 *   - 公式 / 范围不一致 → 硬失败（还原输入、明确报错）；
 *   - 颜色不一致 → 软告警（宿主可能按调色板就近取色，不该阻断用户）。
 * 读不到（宿主不暴露该属性）时**不判失败**——无法验证不等于没写进去。
 */
export declare function updateForeignRule(worksheet: WpsWorksheet | null | undefined, index: number, patch: ForeignRulePatch): ForeignRuleUpdateResult;
/**
 * 把第 index 条既有规则复制成一条新规则（同公式、同格式，范围可换）
 *
 * ## 为什么必须回读条数
 * `FormatConditions.Add` 在只读代理上可能返回对象却什么也没加。写前写后各读一次
 * `Count`，没涨就是没生效——否则用户看到「已复制」却找不到副本。
 *
 * 副本按 Add 的默认顺序排在**最低优先级**（列表末尾），不抢原规则的优先级；
 * 要提前就点 ↑ 上调（与「上移一格」同一套逻辑，不会整条蹦到表顶）。
 */
export declare function duplicateForeignRule(worksheet: WpsWorksheet | null | undefined, index: number, targetRange?: string): {
    ok: true;
    range: string;
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
 * ## 顺序与「为什么不再无条件清空」
 * 旧实现在这里第一件事就是 `clearConditions()`——于是「应用」= 抹掉整表规则
 * 再重建。用户点一次应用，手工建的数据条 / 图标集 / 色阶规则全没了，且
 * 第二版「保留手工规则」也只是**清空后原样重建**，同样丢掉 StopIfTrue、
 * 字体、边框等无法回读的属性。现在的语义：
 *
 * 1. `plan.clearAll` 为真（用户显式选了「清空整表后应用」）才清空；
 * 2. 删 `plan.deletions`——**只有上一轮自己写的、规则库里已删掉的**；
 * 3. 刷新 `plan.refreshes`——表上已有同「范围 + 公式」的规则，只更新颜色；
 * 4. 逐条 Add `plan.entries` → With 上格式；
 * 5. 反序 `SetFirstPriority`（每调一次把该规则顶到最高，走完 entries[0] 最高）；
 * 6. 回读校验：整表条数 + **逐条指纹**（`missing` 指出哪几条没落地）。
 *
 * @returns 新增 / 刷新 / 移除 / 失败条数 + 回读条数 + 未落地的规则名
 */
export declare function applyConditionalFormatPlan(worksheet: WpsWorksheet | null | undefined, plan: ConditionalFormatApplyPlan): ConditionalFormatApplyResult;
//# sourceMappingURL=conditional-format-apply.d.ts.map