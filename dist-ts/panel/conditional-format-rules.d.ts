/**
 * @fileoverview 条件格式规则引擎（纯函数，零 WPS / DOM 依赖，可在 Node 下单测）
 * @module panel/conditionalFormatRules
 * @description 「条件格式管理器」独立页的规则模型与全部判断逻辑：
 *   默认规则集（当前季 / 日期格式错误 / 四季分色）、自维护季节公式、
 *   PluginStorage 存取校验、搜索分组、双策略应用计划。
 *
 * 设计基石——**store-as-truth**：规则以 JSON 存 PluginStorage 为唯一真相，
 * 工作表上的条件格式只是它的一次「投影」。应用 = 先读工作表快照 → 算计划 →
 * 清空重建（幂等：重复应用不产生重复规则，删除行把范围搞乱后重应用即自愈）。
 *
 * 双策略（用户裁定两种都要）：
 * - `clear-all`：清空工作表上**全部**规则后按 Store 重建。手工规则被丢弃，
 *   应用前必须弹确认框列出（范围 + 公式）。
 * - `append-after`：保留手工规则——先把读到的公式类快照原样重建（保持原优先序），
 *   再把插件规则置后追加。含数据条 / 图标集 / 单元格值等无法重建的类型时
 *   降级为 clear-all 并在 warnings 里说明（不静默丢数据）。
 */
import type { ClusterMode } from '../tools/config.js';
/** 单条条件格式规则（Store 里的一条记录） */
export interface ConditionalFormatRule {
    /** 唯一 id（页面创建时生成） */
    id: string;
    /** 人类可读名（「当前季高亮」） */
    name: string;
    /** 分组（「番剧高亮」「数据质量」「导入的规则」…） */
    group: string;
    /** 生效范围（A1 风格，如 'B3:B26958'） */
    appliesTo: string;
    /** xlExpression 公式（相对锚定 appliesTo 的首行） */
    formula: string;
    /** 填充色（'#00B050'） */
    interior: string;
    /** 字体色（可选） */
    fontColor?: string;
    /** 加粗（可选） */
    fontBold?: boolean;
    /** 隐藏 = 留在 Store 但不应用（「可隐藏」） */
    hidden?: boolean;
}
/** 工作表上读到的既有规则快照（应用前读取） */
export interface ForeignRuleSnapshot {
    /** 规则生效范围地址 */
    range: string;
    /** 公式类规则的公式；非公式类为空串 */
    formula: string;
    /** 规则类型能否被插件重建保留 */
    kind: 'expression' | 'other';
    /** 宿主的原始类型号（WPS XlFormatConditionType）；读不到留空 */
    type?: number;
    /** 读到的填充色（尽力而为，读不到留空） */
    interior?: string;
    /** 读到的字体色 */
    fontColor?: string;
    /** 「如果为真则停止」（StopIfTrue）：命中后续规则就不再评估。读不到留空 */
    stopIfTrue?: boolean;
}
/** 应用策略 */
export type ApplyStrategy = 'clear-all' | 'append-after';
/** 计划里的一条待写入项 */
export type ConditionalFormatApplyEntry = {
    source: 'foreign';
    range: string;
    formula: string;
    interior?: string;
    fontColor?: string;
} | {
    source: 'plugin';
    rule: ConditionalFormatRule;
};
/** 应用计划（由 planApply 纯函数算出，COM 层只负责执行） */
export interface ConditionalFormatApplyPlan {
    /** 按优先级排序的写入项（靠前 = 优先） */
    entries: ConditionalFormatApplyEntry[];
    /** 将被丢弃的手工规则（供确认弹窗列出） */
    discarded: ForeignRuleSnapshot[];
    /** 需要醒目展示的警告（如「N 条规则类型不支持保留」） */
    warnings: string[];
}
/** 规则 Store 的 PluginStorage 键 */
export declare const CONDITIONAL_FORMAT_STORE_KEY = "conditionalFormat.rules.v1";
/** 默认应用策略的 PluginStorage 键 */
export declare const CONDITIONAL_FORMAT_STRATEGY_KEY = "conditionalFormat.strategy.v1";
/** 默认策略（无历史选择时）：清掉后应用——插件规则完整生效 */
export declare const CONDITIONAL_FORMAT_STRATEGY_FALLBACK: ApplyStrategy;
/** 默认分组名 */
export declare const CONDITIONAL_FORMAT_GROUP_HIGHLIGHT = "\u756A\u5267\u9AD8\u4EAE";
export declare const CONDITIONAL_FORMAT_GROUP_QUALITY = "\u6570\u636E\u8D28\u91CF";
/** 从工作表导入的既有规则所在分组 */
export declare const IMPORTED_RULE_GROUP = "\u5BFC\u5165\u7684\u89C4\u5219";
/** 导入时读不到填充色用的兜底色（中灰：可见但不抢注意力） */
export declare const IMPORTED_RULE_FALLBACK_COLOR = "#CCCCCC";
/** 当前季高亮色：与宏的 RGB(0,176,80) 一致 */
export declare const COLOR_CURRENT_SEASON = "#00B050";
/** 日期格式错误：Excel 经典「差」样式（浅红底 + 深红字） */
export declare const COLOR_ERROR_FILL = "#FFC7CE";
export declare const COLOR_ERROR_FONT = "#9C0006";
/** 四季分色（浅填充，保证文字可读）：1 月季 / 4 月季 / 7 月季 / 10 月季 */
export declare const SEASON_COLORS: readonly (readonly [string, string, string])[];
/** xlExpression 常量（WPS Enum.XlFormatConditionType.xlExpression） */
export declare const XL_EXPRESSION = 2;
/**
 * 「当前季」的自维护表达式（不依赖任何单元格，随 TODAY() 自动演化）
 *
 * 与数据页公式同款 LOOKUP 表：12 月播归次年 1 月季；
 * 年份取两位（TEXT "00"），输出如 `26年10月`。
 */
export declare function buildCurrentSeasonExpression(): string;
/**
 * 公式行号平移（复制规则到首行不同的范围时用）
 *
 * 只平移「列字母 + 行号」模式（`$R3` → `$R13`）；公式字符串字面量里若含
 * 同形态文本（如 "A1"）会被误平移——已知限制，规则编辑器可手动改。
 *
 * @param formula 原公式
 * @param rowDelta 行号平移量（目标范围首行 - 原范围首行）
 */
export declare function shiftFormulaRows(formula: string, rowDelta: number): string;
/**
 * 取 A1 范围的首行号（公式锚点行）
 *
 * `B3:B1048576` → 3；解析不了回 1（调用方会连同公式一起让用户编辑）。
 */
export declare function firstRowOfRange(range: string): number;
/** 「日期格式错误」标红公式（数据页公式列的报错文本） */
export declare function buildErrorFormula(seasonColumn: string, anchorRow: number): string;
/** 四季分色公式：取季列「年」之后的月令牌与目标比 */
export declare function buildSeasonFormula(seasonColumn: string, anchorRow: number, monthToken: string): string;
/** 默认规则的构建参数（页面按当前工作表探测后传入） */
export interface DefaultRulesOptions {
    /** 季列字母（数据页公式列，如 'R'） */
    seasonColumn: string;
    /** 名称列字母（如 'B'） */
    nameColumn: string;
    /** 应用范围首行（公式锚点行，通常 = 表头行 + 1） */
    firstRow: number;
    /** id 生成器（页面注入；测试传计数器） */
    makeId: () => string;
}
/**
 * 构建默认规则集：当前季名称填绿 + 日期格式错误标红 + 四季分色
 *
 * 「当前季」用自维护 TODAY 公式（跨季度无需改规则）；其余按 anchorRow 锚定。
 * 数组顺序即优先级：当前季最靠前（压过四季色），错误标红次之。
 */
export declare function buildDefaultRules(options: DefaultRulesOptions): ConditionalFormatRule[];
/** 序列化（顺序即优先级，原样保留） */
export declare function serializeRules(rules: readonly ConditionalFormatRule[]): string;
export declare function parseRules(text: string): {
    rules: ConditionalFormatRule[];
    dropped: number;
};
/**
 * 解析「规则文件 / 剪贴板里的规则 JSON」
 *
 * 与 {@link parseRules} 的区别：导出文件是**包装格式**
 * `{format, version, exportedAt, rules: [...]}`，而 PluginStorage 里存的是裸数组。
 * 导入必须两种都吃——用户从「导出规则 → 复制到剪贴板」拿到的就是包装格式。
 *
 * `dropped` 的语义与 parseRules 一致：1 = 整体不是可识别的 JSON；>1 = 条数不合法。
 *
 * @param text 文件内容或粘贴的文本（允许带 UTF-8 BOM 与首尾空白）
 * @returns 合法规则与丢弃计数
 */
export declare function parseRulesPayload(text: string): {
    rules: ConditionalFormatRule[];
    dropped: number;
};
/** 既有规则分组映射的 PluginStorage 键（key = 公式@范围 → 组名） */
export declare const EXISTING_GROUPS_STORE_KEY = "conditionalFormat.existingGroups.v1";
/** 未归组的规则在表格里显示的名字 */
export declare const UNGROUPED_LABEL = "\u672A\u5206\u7EC4";
/**
 * 既有规则分组的稳定 key：公式 + 范围
 *
 * 不用 1 基序号：序号会因工作表规则增删**整体漂移**（删掉第 3 条后原第 5 条
 * 变第 4 条），按序号存的分组会错位到别的规则上。公式 + 范围是规则内容本身，
 * 规则还在、键就对得上。` `（NUL）分隔防串键——公式里 legitimately
 * 可含空格（`=IF(A1="x", 1, 2)`），用空格分隔会把两条不同规则撞成同一键。
 *
 * 签名只取 `{ formula, range }`：快照（ForeignRuleSnapshot）与表格行
 * （ForeignRuleRow）都能直接传，不必为行模型再造一个 key 函数。
 */
export declare function snapshotGroupKey(snapshot: {
    formula: string;
    range: string;
}): string;
/** 序列化分组映射 */
export declare function serializeExistingGroups(groups: Readonly<Record<string, string>>): string;
/** 反序列化：整体不是纯对象就当空（不逐条救——分组是便利功能，坏了重置即可） */
export declare function parseExistingGroups(text: string): Record<string, string>;
/**
 * 按公式模式自动聚类
 *
 * 模式 = 公式剥掉**字符串字面量**后的形状：`=$J2="饮品"` 与 `=$J2="大区"`
 * 同模式（`=$J2="*"`）聚成一组；`=$K2<>""` 另一组。范围不参与——同一公式
 * 模式就是同一「业务含义」，范围不同只是作用的列不一样。
 *
 * **只归一字面串，不动数字**：数字归一会把行锚（`$J2` 的 2）也吃掉，
 * 组名变成 `=$J#="*"` 反而看不懂。没有字面串的公式（`=$A1>100`）原样成组，
 * 同公式的规则仍会聚在一起。
 *
 * `mode` 决定分组口径（设置页「条件格式」可切，见 `ClusterMode`）：
 * - `formula`（默认）：只按公式模式；
 * - `range-formula`：范围 + 公式模式，同公式不同范围也分开；
 * - `column`：按范围起始列（`列 J`）；
 * - `row`：按范围起始行（`行 2`）。
 *
 * @returns key → 组名（组名即模式串 / 列名 / 行名，用户之后可手动改名）
 */
export declare function autoClusterGroups(snapshots: readonly ForeignRuleSnapshot[], mode?: ClusterMode): Record<string, string>;
/** 合并口径 */
export type MergeMode = 'adjacent' | 'union';
/**
 * 合并重复项：把「同一公式 + 同类型 + 同列」的多条**单行**规则并成一条
 *
 * 典型来源：同一公式被逐行应用（`J2:J2`、`J3:J3`、`J4:J4`…），列表里几十条长得
 * 一模一样。合并只改范围，不动公式 / 类型 / 颜色 / 字体等其它属性。
 *
 * 两种口径（设置页「条件格式 → 合并重复项口径」）：
 * - `adjacent`：只合并**行号连续**的段。`2,3,4` 合成 `J2:J4`，断开的 `7` 单独留着
 *   —— 不会给中间没规则的行悄悄加格式，是安全默认；
 * - `union`：同组内取 `min..max` 一次并成一块，**中间空行也会被覆盖**（用户明确要求
 *   的「强行并成一块」）。跨段差距大时要留意副作用。
 *
 * 范围解析不出单行（`J2:J9`、`A1:B2`、多区域）或公式为空的规则原样保留。
 *
 * @returns `rules` 合并后的规则（顺序按首次出现），`mergedGroups` 实际合并的组数，
 *   `removedCount` 减少的条数（0 表示没有可合并项）
 */
export declare function mergeDuplicateRules(snapshots: readonly ForeignRuleSnapshot[], mode?: MergeMode): {
    rules: ForeignRuleSnapshot[];
    mergedGroups: number;
    removedCount: number;
};
/** 锚定表的 PluginStorage 键（`{ 规则身份: 锚定范围 }`） */
export declare const EXISTING_ANCHORS_STORE_KEY = "conditionalFormat.anchors.v1";
/**
 * 规则身份键：公式 + 类型
 *
 * 不含范围 —— 范围正是锚定要**保住**的东西；也不含 1 基序号，序号会随规则增删漂移。
 * 同公式但作用在两列的情况公式本身不同（`=$J2=""` vs `=$K2=""`），不会串。
 */
export declare function anchorKeyOf(snapshot: {
    formula: string;
    kind: string;
}): string;
/**
 * 把任意范围转成**整列范围**：`J2:J9` → `$J:$J`，`A1:C99` → `$A:$C`
 *
 * 这是「锚定」的落点（momo：锚定 = 把应用范围改写成整列，公式不变）。
 * 整列范围的好处是**行增删不再影响它** —— 宿主只会在列被删除时调整它，
 * 而行号怎么变都还是「整列」。
 *
 * 解析不出列字母（空范围、多区域、非法地址）时返回 null，调用方保留原范围。
 */
export declare function toFullColumnRange(range: string): string | null;
/**
 * 把任意范围转成**整行范围**：`J2:J9` → `$2:$9`，`A1:C99` → `$1:$99`
 *
 * 与 {@link toFullColumnRange} 对称：整行范围对**列增删**天然免疫（宿主只在
 * 行被删除时调整它），适合「一行一条记录、列会增删」的表。
 *
 * 解析不出行号（空范围、多区域、非法地址）时返回 null，调用方保留原范围。
 */
export declare function toFullRowRange(range: string): string | null;
/** 把单元格地址规范成绝对引用：`J5` → `$J$5`（固定单元格用） */
export declare function toAbsoluteCell(text: string): string | null;
/** 反序列化锚定表（坏数据当空，不逐条救） */
export declare function parseAnchors(text: string): Record<string, string>;
/** 序列化锚定表 */
export declare function serializeAnchors(anchors: Readonly<Record<string, string>>): string;
/**
 * 算出「按锚定需要改回哪些范围」
 *
 * 语义：锚定 = 这条规则的**应用范围**被钉死。用户删掉行 / 列后，工作表上的
 * 条件格式范围会被宿主自动收缩或平移，锚定表里记的仍是原范围 —— 这里把两者
 * 比出来，由页面层写回工作表。
 *
 * 只按「公式 + 类型」匹配：范围已变，不能拿范围当身份；序号会漂移也不能用。
 *
 * @returns `repairs` 待写回的 `{ 0 基下标, 锚定范围 }`；`unmatched` 找不到对应规则的锚定数
 *   （规则被删了，锚定自然失效，由调用方决定是否清理）
 */
export declare function planAnchorRepair(snapshots: readonly ForeignRuleSnapshot[], anchors: Readonly<Record<string, string>>): {
    repairs: {
        index: number;
        range: string;
    }[];
    unmatched: number;
};
/**
 * 重命名一个既有规则分组（映射里所有值为 oldName 的键改值为 newName）
 *
 * 按**组名**改而不是按 key 改：用户视角的分组单位是组名，一键改名要作用于
 * 组内全部规则。规则本身不动（分组只是视图层映射，不写工作表）。
 *
 * @returns 新映射；oldName 不存在（或新旧同名）时返回 null —— 调用方 toast
 *   说明，不静默返回原映射假装成功
 */
export declare function renameGroupMapping(groups: Readonly<Record<string, string>>, oldName: string, nextName: string): Record<string, string> | null;
/**
 * 解散一个既有规则分组（删掉映射里所有值为 name 的条目）
 *
 * 不用 `delete groups[key]`：no-dynamic-delete 禁动态键删除，filter 重建一份
 * 更直白（与 migrateExistingGroupKey 同口径）。解散后这些规则回「未分组」桶，
 * **不会**从工作表删除任何规则。
 *
 * @returns 新映射；name 不存在时返回 null（调用方 toast，不静默成功）
 */
export declare function dissolveGroupMapping(groups: Readonly<Record<string, string>>, name: string): Record<string, string> | null;
/**
 * 把 fromId 项移到 overId 项旁边（placeAfter = 之后 / 之前）；overId 为 null = 移到最后
 *
 * 拖拽排序的提交语义（与 ui/components/sortable-list.ts 的 SortableReorderEvent
 * 对齐）：不传「目标下标」而传「落点项」——下标在分组 / 搜索视图下会漂（DOM 序
 * ≠ 全量序），落点 id 在任何视图下都稳定。找不到 from / over 时原样返回
 * （调用方据此跳过持久化与重渲染）。
 */
export declare function moveItemNear<T extends {
    id: string;
}>(items: readonly T[], fromId: string, overId: string | null, isPlaceAfter: boolean): T[];
/**
 * 按给定组序重排规则（组内相对顺序不变；未列出的组按原相对序追加在后）
 *
 * 语义：分组的次序 = 组内首条规则在数组里的位置（groupRules 的 Map 插入序）。
 * 把组 G 拖到最前 = G 的全部成员（保持组内先后）整体移到数组前部。这样
 * 「拖组标题」与「拖单条规则」落到同一个持久化结构上，不需要额外的组序状态。
 *
 * @param orderedGroups 新的组序（拖拽提交时的 DOM 序；只含当前可见的组）
 * @returns 新数组；组序没变时返回原数组的副本（调用方比较后跳过持久化）
 */
export declare function reorderGroups<T extends {
    group: string;
}>(items: readonly T[], orderedGroups: readonly string[]): T[];
/**
 * 组序数组里把 from 组移到 over 组旁边（overGroup 为 null = 移到最后）
 *
 * 与 {@link moveItemNear} 同语义，作用于「组序」这一维：包一层 { id } 复用
 * 同一套搬运逻辑，避免两处各写一遍 splice。调用方（页面）拿当前**全量**
 * 组序（不是搜索后的可见序）做搬迁，再交给 {@link reorderGroups} 落成规则序。
 */
export declare function moveGroupNear(groupOrder: readonly string[], fromGroup: string, overGroup: string | null, isPlaceAfter: boolean): string[];
/** 搜索：名称 / 公式 / 范围 / 分组，大小写不敏感子串 */
export declare function filterRules(rules: readonly ConditionalFormatRule[], query: string): ConditionalFormatRule[];
/** 分组：保持组内顺序与组的首现顺序（Map 插入序） */
export declare function groupRules(rules: readonly ConditionalFormatRule[]): [string, ConditionalFormatRule[]][];
/**
 * 工作表既有规则快照 → 规则库条目（「导入」用）
 *
 * 只转**公式类**：数据条 / 图标集 / 色阶的类型插件无法重建（
 * {@link planApply} 的 append-after 会因此降级），导进来只会得到一条看着像、
 * 实际不生效的规则，所以直接拒绝并让调用方提示原因。
 *
 * @param group 导入后落进的分组；缺省「导入的规则」。既有规则表格里归好组的
 *   （{@link snapshotGroupKey} → 组名）由调用方查出来传这里，组名随导入带进规则库。
 * @returns 可导入返回条目；不可导入返回 null
 */
export declare function foreignSnapshotToRule(snapshot: ForeignRuleSnapshot, makeId: () => string, group?: string): ConditionalFormatRule | null;
/**
 * 算应用计划（纯函数：给 Store 规则 + 工作表快照 + 策略 → 执行清单）
 *
 * - clear-all：丢弃全部手工规则（进 discarded 供确认框列出），只写插件规则；
 * - append-after：公式类手工规则原样重建在前（保原优先序），插件规则置后；
 *   快照里含无法重建的类型（数据条/图标集/单元格值）时**降级 clear-all**，
 *   warnings 说明——不静默丢数据。
 */
export declare function planApply(rules: readonly ConditionalFormatRule[], foreign: readonly ForeignRuleSnapshot[], strategy: ApplyStrategy): ConditionalFormatApplyPlan;
/**
 * 规范化十六进制颜色码：3 位展开、补 `#`、统一大写
 *
 * @returns 规范化后的 `#RRGGBB`；输入不是合法 hex 时返回 null
 *
 * 编辑器颜色字段用：用户可手输 `00b050` / `#00b050` / `0f0`，都收敛成
 * `#00B050`；非法输入（`xyz` / 空串 / 5 位）返回 null，由调用方决定
 * 提示还是回落，不把脏值写进规则库。
 */
export declare function normalizeHexColor(raw: string): string | null;
//# sourceMappingURL=conditional-format-rules.d.ts.map