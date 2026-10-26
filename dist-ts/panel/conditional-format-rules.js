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
// ===== 常量 =====
/** 规则 Store 的 PluginStorage 键 */
export const CONDITIONAL_FORMAT_STORE_KEY = 'conditionalFormat.rules.v1';
/** 默认应用策略的 PluginStorage 键 */
export const CONDITIONAL_FORMAT_STRATEGY_KEY = 'conditionalFormat.strategy.v1';
/** 默认策略（无历史选择时）：清掉后应用——插件规则完整生效 */
export const CONDITIONAL_FORMAT_STRATEGY_FALLBACK = 'clear-all';
/** 默认分组名 */
export const CONDITIONAL_FORMAT_GROUP_HIGHLIGHT = '番剧高亮';
export const CONDITIONAL_FORMAT_GROUP_QUALITY = '数据质量';
/** 从工作表导入的既有规则所在分组 */
export const IMPORTED_RULE_GROUP = '导入的规则';
/** 导入时读不到填充色用的兜底色（中灰：可见但不抢注意力） */
export const IMPORTED_RULE_FALLBACK_COLOR = '#CCCCCC';
/** 当前季高亮色：与宏的 RGB(0,176,80) 一致 */
export const COLOR_CURRENT_SEASON = '#00B050';
/** 日期格式错误：Excel 经典「差」样式（浅红底 + 深红字） */
export const COLOR_ERROR_FILL = '#FFC7CE';
export const COLOR_ERROR_FONT = '#9C0006';
/** 四季分色（浅填充，保证文字可读）：1 月季 / 4 月季 / 7 月季 / 10 月季 */
export const SEASON_COLORS = [
    ['1月', '#BDD7EE', '#1F4E79'],
    ['4月', '#C6EFCE', '#375623'],
    ['7月', '#FFE699', '#7F6000'],
    ['10月', '#E4DFEC', '#5F497A'],
];
/** xlExpression 常量（WPS Enum.XlFormatConditionType.xlExpression） */
export const XL_EXPRESSION = 2;
// ===== 公式构建 =====
/**
 * 「当前季」的自维护表达式（不依赖任何单元格，随 TODAY() 自动演化）
 *
 * 与数据页公式同款 LOOKUP 表：12 月播归次年 1 月季；
 * 年份取两位（TEXT "00"），输出如 `26年10月`。
 */
export function buildCurrentSeasonExpression() {
    return ('TEXT(MOD(YEAR(TODAY())+IF(MONTH(TODAY())=12,1,0),100),"00")&"年"&' +
        'LOOKUP(MONTH(TODAY()),{1,2,3,4,5,6,7,8,9,10,11,12},{1,1,4,4,4,7,7,7,10,10,10,1})&"月"');
}
/**
 * 公式行号平移（复制规则到首行不同的范围时用）
 *
 * 只平移「列字母 + 行号」模式（`$R3` → `$R13`）；公式字符串字面量里若含
 * 同形态文本（如 "A1"）会被误平移——已知限制，规则编辑器可手动改。
 *
 * @param formula 原公式
 * @param rowDelta 行号平移量（目标范围首行 - 原范围首行）
 */
export function shiftFormulaRows(formula, rowDelta) {
    if (rowDelta === 0)
        return formula;
    return formula.replace(/(\$?)([A-Z]{1,3})(\d+)/g, (match, dollar, column, row) => {
        const shifted = Number(row) + rowDelta;
        if (shifted < 1)
            return match;
        return `${dollar}${column}${String(shifted)}`;
    });
}
/**
 * 取 A1 范围的首行号（公式锚点行）
 *
 * `B3:B1048576` → 3；解析不了回 1（调用方会连同公式一起让用户编辑）。
 */
export function firstRowOfRange(range) {
    const head = range.split(':', 1)[0] ?? '';
    const match = /(\d+)/.exec(head);
    return match ? Number(match[1]) : 1;
}
/** 「日期格式错误」标红公式（数据页公式列的报错文本） */
export function buildErrorFormula(seasonColumn, anchorRow) {
    return `=$${seasonColumn}${String(anchorRow)}="日期格式错误"`;
}
/** 四季分色公式：取季列「年」之后的月令牌与目标比 */
export function buildSeasonFormula(seasonColumn, anchorRow, monthToken) {
    return (`=IFERROR(MID($${seasonColumn}${String(anchorRow)},FIND("年",$${seasonColumn}${String(anchorRow)})+1,10),"")` +
        `="${monthToken}"`);
}
/**
 * 构建默认规则集：当前季名称填绿 + 日期格式错误标红 + 四季分色
 *
 * 「当前季」用自维护 TODAY 公式（跨季度无需改规则）；其余按 anchorRow 锚定。
 * 数组顺序即优先级：当前季最靠前（压过四季色），错误标红次之。
 */
export function buildDefaultRules(options) {
    const { seasonColumn, nameColumn, firstRow, makeId } = options;
    const seasonExpression = buildCurrentSeasonExpression();
    return [
        {
            id: makeId(),
            name: '当前季高亮',
            group: CONDITIONAL_FORMAT_GROUP_HIGHLIGHT,
            appliesTo: `${nameColumn}${String(firstRow)}:${nameColumn}1048576`,
            formula: `=$${seasonColumn}${String(firstRow)}=${seasonExpression}`,
            interior: COLOR_CURRENT_SEASON,
        },
        {
            id: makeId(),
            name: '日期格式错误',
            group: CONDITIONAL_FORMAT_GROUP_QUALITY,
            appliesTo: `${nameColumn}${String(firstRow)}:${nameColumn}1048576`,
            formula: buildErrorFormula(seasonColumn, firstRow),
            interior: COLOR_ERROR_FILL,
            fontColor: COLOR_ERROR_FONT,
        },
        ...SEASON_COLORS.map(([monthToken, fill, font]) => ({
            id: makeId(),
            name: `${monthToken}季`,
            group: CONDITIONAL_FORMAT_GROUP_HIGHLIGHT,
            appliesTo: `${nameColumn}${String(firstRow)}:${nameColumn}1048576`,
            formula: buildSeasonFormula(seasonColumn, firstRow, monthToken),
            interior: fill,
            fontColor: font,
        })),
    ];
}
// ===== Store 存取（序列化/校验为纯函数，配置读写由页面接）=====
function isConditionalFormatRule(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const rule = value;
    return (typeof rule.id === 'string' &&
        rule.id !== '' &&
        typeof rule.name === 'string' &&
        typeof rule.group === 'string' &&
        typeof rule.appliesTo === 'string' &&
        typeof rule.formula === 'string' &&
        typeof rule.interior === 'string' &&
        (rule.fontColor === undefined || typeof rule.fontColor === 'string') &&
        (rule.fontBold === undefined || typeof rule.fontBold === 'boolean') &&
        (rule.hidden === undefined || typeof rule.hidden === 'boolean'));
}
/** 序列化（顺序即优先级，原样保留） */
export function serializeRules(rules) {
    return JSON.stringify(rules);
}
/** 反序列化：坏行跳过不致命（与分片解析「非法行不中断」同口径） */
export function parseRules(text) {
    if (!text)
        return { rules: [], dropped: 0 };
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { rules: [], dropped: 1 };
    }
    if (!Array.isArray(parsed))
        return { rules: [], dropped: 1 };
    const rules = [];
    let dropped = 0;
    for (const item of parsed) {
        if (isConditionalFormatRule(item))
            rules.push(item);
        else
            dropped += 1;
    }
    return { rules, dropped };
}
// ===== 既有规则的本地分组（视图层：只归组展示，不写工作表）=====
/** 既有规则分组映射的 PluginStorage 键（key = 公式@范围 → 组名） */
export const EXISTING_GROUPS_STORE_KEY = 'conditionalFormat.existingGroups.v1';
/** 未归组的规则在表格里显示的名字 */
export const UNGROUPED_LABEL = '未分组';
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
export function snapshotGroupKey(snapshot) {
    return `${snapshot.formula}\u{0}${snapshot.range}`;
}
/** 序列化分组映射 */
export function serializeExistingGroups(groups) {
    return JSON.stringify(groups);
}
/** 反序列化：整体不是纯对象就当空（不逐条救——分组是便利功能，坏了重置即可） */
export function parseExistingGroups(text) {
    if (!text)
        return {};
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return {};
        const groups = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string' && value !== '')
                groups[key] = value;
        }
        return groups;
    }
    catch {
        return {};
    }
}
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
 * @returns key → 组名（组名即模式串，用户之后可手动改名）
 */
export function autoClusterGroups(snapshots) {
    const groups = {};
    // 空公式不聚（没有可识别的模式）。先 filter 再 for：no-continue 禁 continue、
    // unicorn/prefer-continue 又禁把循环体包在 if 里，两条规则互斥，filter 是
    // 同时满足两者的写法（2026-10-23 踩过同一对）。
    const withFormula = snapshots.filter((snapshot) => snapshot.formula !== '');
    for (const snapshot of withFormula) {
        const pattern = snapshot.formula.replace(/"[^"]*"/g, '"*"');
        groups[snapshotGroupKey(snapshot)] = pattern;
    }
    return groups;
}
// ===== 既有规则分组的维护（纯函数：页面层只负责持久化与重渲染）=====
/**
 * 重命名一个既有规则分组（映射里所有值为 oldName 的键改值为 newName）
 *
 * 按**组名**改而不是按 key 改：用户视角的分组单位是组名，一键改名要作用于
 * 组内全部规则。规则本身不动（分组只是视图层映射，不写工作表）。
 *
 * @returns 新映射；oldName 不存在（或新旧同名）时返回 null —— 调用方 toast
 *   说明，不静默返回原映射假装成功
 */
export function renameGroupMapping(groups, oldName, nextName) {
    if (nextName === '' || nextName === oldName)
        return null;
    if (!Object.values(groups).includes(oldName))
        return null;
    const renamed = {};
    for (const [key, value] of Object.entries(groups)) {
        renamed[key] = value === oldName ? nextName : value;
    }
    return renamed;
}
/**
 * 解散一个既有规则分组（删掉映射里所有值为 name 的条目）
 *
 * 不用 `delete groups[key]`：no-dynamic-delete 禁动态键删除，filter 重建一份
 * 更直白（与 migrateExistingGroupKey 同口径）。解散后这些规则回「未分组」桶，
 * **不会**从工作表删除任何规则。
 *
 * @returns 新映射；name 不存在时返回 null（调用方 toast，不静默成功）
 */
export function dissolveGroupMapping(groups, name) {
    if (!Object.values(groups).includes(name))
        return null;
    const next = {};
    for (const [key, value] of Object.entries(groups)) {
        if (value !== name)
            next[key] = value;
    }
    return next;
}
// ===== 拖拽重排（sortable-list 的提交语义：from 移到 over 旁）=====
/**
 * 把 fromId 项移到 overId 项旁边（placeAfter = 之后 / 之前）；overId 为 null = 移到最后
 *
 * 拖拽排序的提交语义（与 ui/components/sortable-list.ts 的 SortableReorderEvent
 * 对齐）：不传「目标下标」而传「落点项」——下标在分组 / 搜索视图下会漂（DOM 序
 * ≠ 全量序），落点 id 在任何视图下都稳定。找不到 from / over 时原样返回
 * （调用方据此跳过持久化与重渲染）。
 */
export function moveItemNear(items, fromId, overId, isPlaceAfter) {
    const from = items.find((item) => item.id === fromId);
    if (from === undefined)
        return [...items];
    const rest = items.filter((item) => item.id !== fromId);
    if (overId === null)
        return [...rest, from];
    const overIndex = rest.findIndex((item) => item.id === overId);
    if (overIndex === -1)
        return [...items];
    const at = isPlaceAfter ? overIndex + 1 : overIndex;
    return [...rest.slice(0, at), from, ...rest.slice(at)];
}
// ===== 分组排序（拖组标题 → 按新组序重排规则）=====
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
export function reorderGroups(items, orderedGroups) {
    const buckets = new Map();
    for (const item of items) {
        const bucket = buckets.get(item.group);
        if (bucket)
            bucket.push(item);
        else
            buckets.set(item.group, [item]);
    }
    // 新序：先按 orderedGroups（只取真实存在的组），再补未列出的组（原相对序）
    const order = [
        ...orderedGroups.filter((group) => buckets.has(group)),
        ...[...buckets.keys()].filter((group) => !orderedGroups.includes(group)),
    ];
    // 同序短路：组序没变时原样返回——否则「拖到邻居位上」的无操作拖拽也会把
    // 交错的分组整块化（A,B,A,C,B → A,A,B,B,C），用户没要求的重排被持久化
    const currentOrder = [...buckets.keys()];
    const isSameOrder = order.length === currentOrder.length &&
        order.every((group, index) => group === currentOrder[index]);
    if (isSameOrder)
        return [...items];
    const next = [];
    for (const group of order) {
        next.push(...(buckets.get(group) ?? []));
    }
    return next;
}
/**
 * 组序数组里把 from 组移到 over 组旁边（overGroup 为 null = 移到最后）
 *
 * 与 {@link moveItemNear} 同语义，作用于「组序」这一维：包一层 { id } 复用
 * 同一套搬运逻辑，避免两处各写一遍 splice。调用方（页面）拿当前**全量**
 * 组序（不是搜索后的可见序）做搬迁，再交给 {@link reorderGroups} 落成规则序。
 */
export function moveGroupNear(groupOrder, fromGroup, overGroup, isPlaceAfter) {
    const wrapped = groupOrder.map((name) => ({ id: name }));
    return moveItemNear(wrapped, fromGroup, overGroup, isPlaceAfter).map((entry) => entry.id);
}
// ===== 搜索 / 分组 =====
/** 搜索：名称 / 公式 / 范围 / 分组，大小写不敏感子串 */
export function filterRules(rules, query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return [...rules];
    return rules.filter((rule) => [rule.name, rule.formula, rule.appliesTo, rule.group].some((field) => field.toLowerCase().includes(q)));
}
/** 分组：保持组内顺序与组的首现顺序（Map 插入序） */
export function groupRules(rules) {
    const groups = new Map();
    for (const rule of rules) {
        const bucket = groups.get(rule.group);
        if (bucket)
            bucket.push(rule);
        else
            groups.set(rule.group, [rule]);
    }
    return [...groups];
}
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
export function foreignSnapshotToRule(snapshot, makeId, group = IMPORTED_RULE_GROUP) {
    if (snapshot.kind !== 'expression' || !snapshot.formula)
        return null;
    return {
        id: makeId(),
        name: `导入 ${snapshot.range || '未知范围'}`,
        group,
        appliesTo: snapshot.range,
        formula: snapshot.formula,
        // 读不到颜色时给中灰：规则库里必须有个可见色块，否则用户分不出是哪条
        interior: snapshot.interior ?? IMPORTED_RULE_FALLBACK_COLOR,
        ...(snapshot.fontColor !== undefined && { fontColor: snapshot.fontColor }),
    };
}
// ===== 应用计划 =====
/**
 * 算应用计划（纯函数：给 Store 规则 + 工作表快照 + 策略 → 执行清单）
 *
 * - clear-all：丢弃全部手工规则（进 discarded 供确认框列出），只写插件规则；
 * - append-after：公式类手工规则原样重建在前（保原优先序），插件规则置后；
 *   快照里含无法重建的类型（数据条/图标集/单元格值）时**降级 clear-all**，
 *   warnings 说明——不静默丢数据。
 */
export function planApply(rules, foreign, strategy) {
    const visible = rules.filter((rule) => rule.hidden !== true);
    const pluginEntries = visible.map((rule) => ({
        source: 'plugin',
        rule,
    }));
    const warnings = [];
    if (strategy === 'append-after' && foreign.every((f) => f.kind === 'expression')) {
        const foreignEntries = foreign.map((f) => ({
            source: 'foreign',
            range: f.range,
            formula: f.formula,
            ...(f.interior !== undefined && { interior: f.interior }),
            ...(f.fontColor !== undefined && { fontColor: f.fontColor }),
        }));
        return { entries: [...foreignEntries, ...pluginEntries], discarded: [], warnings };
    }
    if (strategy === 'append-after' && foreign.length > 0) {
        const unsupported = foreign.filter((f) => f.kind !== 'expression').length;
        warnings.push(`有 ${String(unsupported)} 条手工规则的类型不支持保留（数据条 / 图标集 / 单元格值规则），` +
            '本次按清空处理，已在确认框列出');
    }
    else if (foreign.length > 0) {
        warnings.push(`将清空 ${String(foreign.length)} 条手工规则，范围与公式已在确认框列出`);
    }
    return { entries: pluginEntries, discarded: [...foreign], warnings };
}
/**
 * 规范化十六进制颜色码：3 位展开、补 `#`、统一大写
 *
 * @returns 规范化后的 `#RRGGBB`；输入不是合法 hex 时返回 null
 *
 * 编辑器颜色字段用：用户可手输 `00b050` / `#00b050` / `0f0`，都收敛成
 * `#00B050`；非法输入（`xyz` / 空串 / 5 位）返回 null，由调用方决定
 * 提示还是回落，不把脏值写进规则库。
 */
export function normalizeHexColor(raw) {
    const text = raw.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(text)) {
        const expanded = text
            .split('')
            .map((char) => char + char)
            .join('');
        return `#${expanded.toUpperCase()}`;
    }
    if (/^[0-9a-f]{6}$/i.test(text))
        return `#${text.toUpperCase()}`;
    return null;
}
