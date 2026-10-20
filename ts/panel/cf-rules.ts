/**
 * @fileoverview 条件格式规则引擎（纯函数，零 WPS / DOM 依赖，可在 Node 下单测）
 * @module panel/cfRules
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
export interface CfRule {
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
}

/** 应用策略 */
export type ApplyStrategy = 'clear-all' | 'append-after'

/** 计划里的一条待写入项 */
export type CfApplyEntry =
  | { source: 'foreign'; range: string; formula: string; interior?: string; fontColor?: string }
  | { source: 'plugin'; rule: CfRule }

/** 应用计划（由 planApply 纯函数算出，COM 层只负责执行） */
export interface CfApplyPlan {
  /** 按优先级排序的写入项（靠前 = 优先） */
  entries: CfApplyEntry[]
  /** 将被丢弃的手工规则（供确认弹窗列出） */
  discarded: ForeignRuleSnapshot[]
  /** 需要醒目展示的警告（如「N 条规则类型不支持保留」） */
  warnings: string[]
}

// ===== 常量 =====

/** 规则 Store 的 PluginStorage 键 */
export const CF_STORE_KEY = 'cf.rules.v1'

/** 默认应用策略的 PluginStorage 键 */
export const CF_STRATEGY_KEY = 'cf.strategy.v1'

/** 默认策略（无历史选择时）：清掉后应用——插件规则完整生效 */
export const CF_STRATEGY_FALLBACK: ApplyStrategy = 'clear-all'

/** 默认分组名 */
export const CF_GROUP_HIGHLIGHT = '番剧高亮'
export const CF_GROUP_QUALITY = '数据质量'

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
    (match, dollar: string, col: string, row: string) => {
      const shifted = Number(row) + rowDelta
      if (shifted < 1) return match
      return `${dollar}${col}${String(shifted)}`
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
export function buildErrorFormula(seasonCol: string, anchorRow: number): string {
  return `=$${seasonCol}${String(anchorRow)}="日期格式错误"`
}

/** 四季分色公式：取季列「年」之后的月令牌与目标比 */
export function buildSeasonFormula(
  seasonCol: string,
  anchorRow: number,
  monthToken: string,
): string {
  return (
    `=IFERROR(MID($${seasonCol}${String(anchorRow)},FIND("年",$${seasonCol}${String(anchorRow)})+1,10),"")` +
    `="${monthToken}"`
  )
}

// ===== 默认规则集 =====

/** 默认规则的构建参数（页面按当前工作表探测后传入） */
export interface DefaultRulesOptions {
  /** 季列字母（数据页公式列，如 'R'） */
  seasonCol: string
  /** 名称列字母（如 'B'） */
  nameCol: string
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
export function buildDefaultRules(options: DefaultRulesOptions): CfRule[] {
  const { seasonCol, nameCol, firstRow, makeId } = options
  const seasonExpression = buildCurrentSeasonExpression()

  return [
    {
      id: makeId(),
      name: '当前季高亮',
      group: CF_GROUP_HIGHLIGHT,
      appliesTo: `${nameCol}${String(firstRow)}:${nameCol}1048576`,
      formula: `=$${seasonCol}${String(firstRow)}=${seasonExpression}`,
      interior: COLOR_CURRENT_SEASON,
    },
    {
      id: makeId(),
      name: '日期格式错误',
      group: CF_GROUP_QUALITY,
      appliesTo: `${nameCol}${String(firstRow)}:${nameCol}1048576`,
      formula: buildErrorFormula(seasonCol, firstRow),
      interior: COLOR_ERROR_FILL,
      fontColor: COLOR_ERROR_FONT,
    },
    ...SEASON_COLORS.map(([monthToken, fill, font]) => ({
      id: makeId(),
      name: `${monthToken}季`,
      group: CF_GROUP_HIGHLIGHT,
      appliesTo: `${nameCol}${String(firstRow)}:${nameCol}1048576`,
      formula: buildSeasonFormula(seasonCol, firstRow, monthToken),
      interior: fill,
      fontColor: font,
    })),
  ]
}

// ===== Store 存取（序列化/校验为纯函数，配置读写由页面接）=====

function isCfRule(value: unknown): value is CfRule {
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
export function serializeRules(rules: readonly CfRule[]): string {
  return JSON.stringify(rules)
}

/** 反序列化：坏行跳过不致命（与分片解析「非法行不中断」同口径） */
export function parseRules(text: string): { rules: CfRule[]; dropped: number } {
  if (!text) return { rules: [], dropped: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { rules: [], dropped: 1 }
  }
  if (!Array.isArray(parsed)) return { rules: [], dropped: 1 }
  const rules: CfRule[] = []
  let dropped = 0
  for (const item of parsed) {
    if (isCfRule(item)) rules.push(item)
    else dropped += 1
  }
  return { rules, dropped }
}

// ===== 搜索 / 分组 =====

/** 搜索：名称 / 公式 / 范围 / 分组，大小写不敏感子串 */
export function filterRules(rules: readonly CfRule[], query: string): CfRule[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...rules]
  return rules.filter((rule) =>
    [rule.name, rule.formula, rule.appliesTo, rule.group].some((field) =>
      field.toLowerCase().includes(q),
    ),
  )
}

/** 分组：保持组内顺序与组的首现顺序（Map 插入序） */
export function groupRules(rules: readonly CfRule[]): [string, CfRule[]][] {
  const groups = new Map<string, CfRule[]>()
  for (const rule of rules) {
    const bucket = groups.get(rule.group)
    if (bucket) bucket.push(rule)
    else groups.set(rule.group, [rule])
  }
  return [...groups]
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
  rules: readonly CfRule[],
  foreign: readonly ForeignRuleSnapshot[],
  strategy: ApplyStrategy,
): CfApplyPlan {
  const visible = rules.filter((rule) => rule.hidden !== true)
  const pluginEntries: CfApplyEntry[] = visible.map((rule) => ({ source: 'plugin', rule }))
  const warnings: string[] = []

  if (strategy === 'append-after' && foreign.every((f) => f.kind === 'expression')) {
    const foreignEntries: CfApplyEntry[] = foreign.map((f) => ({
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
