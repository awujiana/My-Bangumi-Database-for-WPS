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

// ===== 规则模型 =====

/** 单条条件格式规则（Store 里的一条记录） */
export interface ConditionalFormatRule {
  /** 唯一 id（页面创建时生成） */
  id: string
  /** 人类可读名（「当前季高亮」） */
  name: string
  /** 分组（「番剧高亮」「数据质量」「导入的规则」…） */
  group: string
  /** 生效范围（A1 风格，如 'B3:B26958'） */
  appliesTo: string
  /** xlExpression 公式（相对锚定 appliesTo 的首行） */
  formula: string
  /** 填充色（'#00B050'） */
  interior: string
  /** 字体色（可选） */
  fontColor?: string
  /** 加粗（可选） */
  fontBold?: boolean
  /** 隐藏 = 留在 Store 但不应用（「可隐藏」） */
  hidden?: boolean
}

/** 工作表上读到的既有规则快照（应用前读取） */
export interface ForeignRuleSnapshot {
  /** 规则生效范围地址 */
  range: string
  /** 公式类规则的公式；非公式类为空串 */
  formula: string
  /** 规则类型能否被插件重建保留 */
  kind: 'expression' | 'other'
  /** 宿主的原始类型号（WPS XlFormatConditionType）；读不到留空 */
  type?: number
  /** 读到的填充色（尽力而为，读不到留空） */
  interior?: string
  /** 读到的字体色 */
  fontColor?: string
  /** 「如果为真则停止」（StopIfTrue）：命中后续规则就不再评估。读不到留空 */
  stopIfTrue?: boolean
}

/** 应用策略 */
export type ApplyStrategy = 'clear-all' | 'append-after'

/** 计划里的一条待写入项 */
export type ConditionalFormatApplyEntry =
  | { source: 'foreign'; range: string; formula: string; interior?: string; fontColor?: string }
  | { source: 'plugin'; rule: ConditionalFormatRule }

/** 应用计划（由 planApply 纯函数算出，COM 层只负责执行） */
export interface ConditionalFormatApplyPlan {
  /** 按优先级排序的写入项（靠前 = 优先） */
  entries: ConditionalFormatApplyEntry[]
  /** 将被丢弃的手工规则（供确认弹窗列出） */
  discarded: ForeignRuleSnapshot[]
  /** 需要醒目展示的警告（如「N 条规则类型不支持保留」） */
  warnings: string[]
}

// ===== 常量 =====

/** 规则 Store 的 PluginStorage 键 */
export const CONDITIONAL_FORMAT_STORE_KEY = 'conditionalFormat.rules.v1'

/** 默认应用策略的 PluginStorage 键 */
export const CONDITIONAL_FORMAT_STRATEGY_KEY = 'conditionalFormat.strategy.v1'

/** 默认策略（无历史选择时）：清掉后应用——插件规则完整生效 */
export const CONDITIONAL_FORMAT_STRATEGY_FALLBACK: ApplyStrategy = 'clear-all'

/** 默认分组名 */
export const CONDITIONAL_FORMAT_GROUP_HIGHLIGHT = '番剧高亮'
export const CONDITIONAL_FORMAT_GROUP_QUALITY = '数据质量'

/** 从工作表导入的既有规则所在分组 */
export const IMPORTED_RULE_GROUP = '导入的规则'

/** 导入时读不到填充色用的兜底色（中灰：可见但不抢注意力） */
export const IMPORTED_RULE_FALLBACK_COLOR = '#CCCCCC'

/** 当前季高亮色：与宏的 RGB(0,176,80) 一致 */
export const COLOR_CURRENT_SEASON = '#00B050'

/** 日期格式错误：Excel 经典「差」样式（浅红底 + 深红字） */
export const COLOR_ERROR_FILL = '#FFC7CE'
export const COLOR_ERROR_FONT = '#9C0006'

/** 四季分色（浅填充，保证文字可读）：1 月季 / 4 月季 / 7 月季 / 10 月季 */
export const SEASON_COLORS: readonly (readonly [string, string, string])[] = [
  ['1月', '#BDD7EE', '#1F4E79'],
  ['4月', '#C6EFCE', '#375623'],
  ['7月', '#FFE699', '#7F6000'],
  ['10月', '#E4DFEC', '#5F497A'],
]

/** xlExpression 常量（WPS Enum.XlFormatConditionType.xlExpression） */
export const XL_EXPRESSION = 2

// ===== 公式构建 =====

/**
 * 「当前季」的自维护表达式（不依赖任何单元格，随 TODAY() 自动演化）
 *
 * 与数据页公式同款 LOOKUP 表：12 月播归次年 1 月季；
 * 年份取两位（TEXT "00"），输出如 `26年10月`。
 */
export function buildCurrentSeasonExpression(): string {
  return (
    'TEXT(MOD(YEAR(TODAY())+IF(MONTH(TODAY())=12,1,0),100),"00")&"年"&' +
    'LOOKUP(MONTH(TODAY()),{1,2,3,4,5,6,7,8,9,10,11,12},{1,1,4,4,4,7,7,7,10,10,10,1})&"月"'
  )
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
export function shiftFormulaRows(formula: string, rowDelta: number): string {
  if (rowDelta === 0) return formula
  return formula.replace(
    /(\$?)([A-Z]{1,3})(\d+)/g,
    (match, dollar: string, column: string, row: string) => {
      const shifted = Number(row) + rowDelta
      if (shifted < 1) return match
      return `${dollar}${column}${String(shifted)}`
    },
  )
}

/**
 * 取 A1 范围的首行号（公式锚点行）
 *
 * `B3:B1048576` → 3；解析不了回 1（调用方会连同公式一起让用户编辑）。
 */
export function firstRowOfRange(range: string): number {
  const head = range.split(':', 1)[0] ?? ''
  const match = /(\d+)/.exec(head)
  return match ? Number(match[1]) : 1
}

/** 「日期格式错误」标红公式（数据页公式列的报错文本） */
export function buildErrorFormula(seasonColumn: string, anchorRow: number): string {
  return `=$${seasonColumn}${String(anchorRow)}="日期格式错误"`
}

/** 四季分色公式：取季列「年」之后的月令牌与目标比 */
export function buildSeasonFormula(
  seasonColumn: string,
  anchorRow: number,
  monthToken: string,
): string {
  return (
    `=IFERROR(MID($${seasonColumn}${String(anchorRow)},FIND("年",$${seasonColumn}${String(anchorRow)})+1,10),"")` +
    `="${monthToken}"`
  )
}

// ===== 默认规则集 =====

/** 默认规则的构建参数（页面按当前工作表探测后传入） */
export interface DefaultRulesOptions {
  /** 季列字母（数据页公式列，如 'R'） */
  seasonColumn: string
  /** 名称列字母（如 'B'） */
  nameColumn: string
  /** 应用范围首行（公式锚点行，通常 = 表头行 + 1） */
  firstRow: number
  /** id 生成器（页面注入；测试传计数器） */
  makeId: () => string
}

/**
 * 构建默认规则集：当前季名称填绿 + 日期格式错误标红 + 四季分色
 *
 * 「当前季」用自维护 TODAY 公式（跨季度无需改规则）；其余按 anchorRow 锚定。
 * 数组顺序即优先级：当前季最靠前（压过四季色），错误标红次之。
 */
export function buildDefaultRules(options: DefaultRulesOptions): ConditionalFormatRule[] {
  const { seasonColumn, nameColumn, firstRow, makeId } = options
  const seasonExpression = buildCurrentSeasonExpression()

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
  ]
}

// ===== Store 存取（序列化/校验为纯函数，配置读写由页面接）=====

function isConditionalFormatRule(value: unknown): value is ConditionalFormatRule {
  if (value === null || typeof value !== 'object') return false
  const rule = value as Record<string, unknown>
  return (
    typeof rule.id === 'string' &&
    rule.id !== '' &&
    typeof rule.name === 'string' &&
    typeof rule.group === 'string' &&
    typeof rule.appliesTo === 'string' &&
    typeof rule.formula === 'string' &&
    typeof rule.interior === 'string' &&
    (rule.fontColor === undefined || typeof rule.fontColor === 'string') &&
    (rule.fontBold === undefined || typeof rule.fontBold === 'boolean') &&
    (rule.hidden === undefined || typeof rule.hidden === 'boolean')
  )
}

/** 序列化（顺序即优先级，原样保留） */
export function serializeRules(rules: readonly ConditionalFormatRule[]): string {
  return JSON.stringify(rules)
}

/** 反序列化：坏行跳过不致命（与分片解析「非法行不中断」同口径） */
export function parseRules(text: string): { rules: ConditionalFormatRule[]; dropped: number } {
  if (!text) return { rules: [], dropped: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { rules: [], dropped: 1 }
  }
  if (!Array.isArray(parsed)) return { rules: [], dropped: 1 }
  const rules: ConditionalFormatRule[] = []
  let dropped = 0
  for (const item of parsed) {
    if (isConditionalFormatRule(item)) rules.push(item)
    else dropped += 1
  }
  return { rules, dropped }
}

// ===== 搜索 / 分组 =====

/** 搜索：名称 / 公式 / 范围 / 分组，大小写不敏感子串 */
export function filterRules(
  rules: readonly ConditionalFormatRule[],
  query: string,
): ConditionalFormatRule[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...rules]
  return rules.filter((rule) =>
    [rule.name, rule.formula, rule.appliesTo, rule.group].some((field) =>
      field.toLowerCase().includes(q),
    ),
  )
}

/** 分组：保持组内顺序与组的首现顺序（Map 插入序） */
export function groupRules(
  rules: readonly ConditionalFormatRule[],
): [string, ConditionalFormatRule[]][] {
  const groups = new Map<string, ConditionalFormatRule[]>()
  for (const rule of rules) {
    const bucket = groups.get(rule.group)
    if (bucket) bucket.push(rule)
    else groups.set(rule.group, [rule])
  }
  return [...groups]
}

/**
 * 工作表既有规则快照 → 规则库条目（「导入」用）
 *
 * 只转**公式类**：数据条 / 图标集 / 色阶的类型插件无法重建（
 * {@link planApply} 的 append-after 会因此降级），导进来只会得到一条看着像、
 * 实际不生效的规则，所以直接拒绝并让调用方提示原因。
 *
 * @returns 可导入返回条目；不可导入返回 null
 */
export function foreignSnapshotToRule(
  snapshot: ForeignRuleSnapshot,
  makeId: () => string,
): ConditionalFormatRule | null {
  if (snapshot.kind !== 'expression' || !snapshot.formula) return null
  return {
    id: makeId(),
    name: `导入 ${snapshot.range || '未知范围'}`,
    group: IMPORTED_RULE_GROUP,
    appliesTo: snapshot.range,
    formula: snapshot.formula,
    // 读不到颜色时给中灰：规则库里必须有个可见色块，否则用户分不出是哪条
    interior: snapshot.interior ?? IMPORTED_RULE_FALLBACK_COLOR,
    ...(snapshot.fontColor !== undefined && { fontColor: snapshot.fontColor }),
  }
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
export function planApply(
  rules: readonly ConditionalFormatRule[],
  foreign: readonly ForeignRuleSnapshot[],
  strategy: ApplyStrategy,
): ConditionalFormatApplyPlan {
  const visible = rules.filter((rule) => rule.hidden !== true)
  const pluginEntries: ConditionalFormatApplyEntry[] = visible.map((rule) => ({
    source: 'plugin',
    rule,
  }))
  const warnings: string[] = []

  if (strategy === 'append-after' && foreign.every((f) => f.kind === 'expression')) {
    const foreignEntries: ConditionalFormatApplyEntry[] = foreign.map((f) => ({
      source: 'foreign',
      range: f.range,
      formula: f.formula,
      ...(f.interior !== undefined && { interior: f.interior }),
      ...(f.fontColor !== undefined && { fontColor: f.fontColor }),
    }))
    return { entries: [...foreignEntries, ...pluginEntries], discarded: [], warnings }
  }

  if (strategy === 'append-after' && foreign.length > 0) {
    const unsupported = foreign.filter((f) => f.kind !== 'expression').length
    warnings.push(
      `有 ${String(unsupported)} 条手工规则的类型不支持保留（数据条 / 图标集 / 单元格值规则），` +
        '本次按清空处理，已在确认框列出',
    )
  } else if (foreign.length > 0) {
    warnings.push(`将清空 ${String(foreign.length)} 条手工规则，范围与公式已在确认框列出`)
  }

  return { entries: pluginEntries, discarded: [...foreign], warnings }
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
export function normalizeHexColor(raw: string): string | null {
  const text = raw.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(text)) {
    const expanded = text
      .split('')
      .map((char) => char + char)
      .join('')
    return `#${expanded.toUpperCase()}`
  }
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toUpperCase()}`
  return null
}
