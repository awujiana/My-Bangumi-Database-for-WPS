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

import { normalizeHexColor } from './conditional-format-rules.js'
import { columnNumberOf, parseRangeRect } from './conditional-format-table.js'

/** 自动修复的轮次上限（防「修法制造新问题」时死循环） */
const MAX_FIX_ROUNDS = 8

/** Excel / WPS 的最大行号（1 基） */
const MAX_ROW = 1_048_576
/** Excel / WPS 的最大列号（XFD） */
const MAX_COLUMN = 16_384

/** 体检发现的某一类问题 */
export type RuleIssueCode =
  | 'range-empty'
  | 'range-unparsable'
  | 'range-sheet-prefix'
  | 'range-out-of-sheet'
  | 'formula-empty'
  | 'formula-redundant-equals'
  | 'formula-quote-unbalanced'
  | 'formula-other-sheet'
  | 'range-formula-column-mismatch'
  | 'color-invalid'

/** 一条问题 */
export interface RuleIssue {
  /** 问题类别（UI 排序 / 测试断言用） */
  code: RuleIssueCode
  /** 出问题的字段（决定编辑弹窗里高亮哪一格） */
  field: 'appliesTo' | 'formula' | 'interior' | 'fontColor'
  /** 人话说明（直接显示在弹窗里） */
  message: string
  /** 自动修复后的值；没有安全修法时缺省（不能瞎猜的字段不给自动修） */
  fixed?: string
  /** true = 宿主会拒绝，必须修完才能应用 / 导入 */
  blocking: boolean
}

/** 可被体检的最小规则形状（`ConditionalFormatRule` 与导入快照都满足） */
export interface InspectableRule {
  appliesTo: string
  formula: string
  interior?: string
  fontColor?: string
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
export function stripSheetPrefix(range: string): string {
  const lastBang = range.lastIndexOf('!')
  if (lastBang === -1) return range
  return range.slice(lastBang + 1).trim()
}

/** 统计字符串里 `"` 的个数（奇数 = 引号没配对） */
function countQuotes(text: string): number {
  let count = 0
  for (const char of text) {
    if (char === '"') count += 1
  }
  return count
}

/**
 * 取公式里第一个「单元格引用」的列字母（`$I2` / `I2` → `I`）
 *
 * 只用来判断「公式在判哪一列」，不解析整个公式：条件格式的公式形态固定
 * （`=$I2="x"` / `=AND($I2>0,…)`），取第一个引用足够。
 */
function firstReferencedColumn(formula: string): string | null {
  const matched = /\$?([A-Za-z]{1,3})\$?\d+/u.exec(formula.replace(/^=/u, ''))
  return matched?.[1]?.toUpperCase() ?? null
}

/**
 * 体检一条规则
 *
 * @param rule 待检规则（范围 / 公式 / 颜色）
 * @returns 问题列表（**空数组 = 健康**；顺序 = 阻断项在前）
 */
export function inspectRule(rule: InspectableRule): RuleIssue[] {
  const issues: RuleIssue[] = []
  const rawRange = rule.appliesTo.trim()
  const rawFormula = rule.formula.trim()

  // ---- 范围 ----
  if (rawRange === '') {
    issues.push({
      code: 'range-empty',
      field: 'appliesTo',
      message: '应用范围为空，宿主会直接拒绝（请先填范围，如 B2:B50001）',
      blocking: true,
    })
  } else {
    // 前缀先剥掉再判其它：带 `!` 的地址 `parseRangeRect` 一律解析失败，
    // 只报「不是合法地址」会把「带表名前缀」和「越界」两个问题混成一个，
    // 自动修也就只能修一半（剥完前缀才发现还越界，却没有对应的修法了）。
    const bareRange = stripSheetPrefix(rawRange)
    if (bareRange !== rawRange) {
      issues.push({
        code: 'range-sheet-prefix',
        field: 'appliesTo',
        message: `范围带了工作表名前缀（“${rawRange}”），条件格式只能落在本表范围内`,
        fixed: bareRange,
        blocking: true,
      })
    }
    // 既没有冒号也没有行号（“abc”）不是地址：既不是单元格也不是整列 / 整行
    const isRangeShaped = bareRange.includes(':') || /\d/u.test(bareRange)
    const rect = isRangeShaped ? parseRangeRect(bareRange) : null
    if (rect === null) {
      issues.push({
        code: 'range-unparsable',
        field: 'appliesTo',
        message: `范围“${rawRange}”不是合法地址（应为 B2:B50001 / $J:$J / 2:500 这类写法）`,
        blocking: true,
      })
    } else if (rect.endRow > MAX_ROW || rect.endColumn > MAX_COLUMN) {
      issues.push({
        code: 'range-out-of-sheet',
        field: 'appliesTo',
        message: `范围超出了工作表边界（最大 ${String(MAX_ROW)} 行 / 16384 列）`,
        fixed: buildClampedRange(rect),
        blocking: true,
      })
    }
  }

  // ---- 公式 ----
  if (rawFormula === '') {
    issues.push({
      code: 'formula-empty',
      field: 'formula',
      message: '公式为空，宿主会直接拒绝（如 =$I2="拼多多驿站"）',
      blocking: true,
    })
  } else {
    if (/^=(?=[=+])/u.test(rawFormula)) {
      issues.push({
        code: 'formula-redundant-equals',
        field: 'formula',
        message: `公式开头有多余的等号（“${rawFormula.slice(0, 8)}…”）`,
        fixed: rawFormula.replace(/^=+/u, '='),
        blocking: true,
      })
    }
    if (countQuotes(rawFormula) % 2 === 1) {
      issues.push({
        code: 'formula-quote-unbalanced',
        field: 'formula',
        message: '公式里的英文引号没配对（奇数个 "），宿主会判语法错误',
        fixed: `${rawFormula}"`,
        blocking: true,
      })
    }
    if (rawFormula.includes('!')) {
      issues.push({
        code: 'formula-other-sheet',
        field: 'formula',
        message: '公式引用了别的工作表（含 “!”），条件格式里通常不生效',
        blocking: false,
      })
    }
  }

  // ---- 范围与公式的列是否对得上（不拦，但必须让用户看见）----
  if (rawRange !== '' && rawFormula !== '') {
    const rect = parseRangeRect(stripSheetPrefix(rawRange))
    const referenced = firstReferencedColumn(rawFormula)
    if (
      rect !== null &&
      referenced !== null &&
      rect.startColumn > 0 &&
      columnNumberOf(referenced) !== rect.startColumn
    ) {
      issues.push({
        code: 'range-formula-column-mismatch',
        field: 'appliesTo',
        message: `范围首列在第 ${String(rect.startColumn)} 列，公式却在判 ${referenced} 列 —— 能写进去，但看起来会“没生效”`,
        blocking: false,
      })
    }
  }

  // ---- 颜色 ----
  const interiorIssue = inspectColor('interior', rule.interior, '#CCCCCC')
  if (interiorIssue) issues.push(interiorIssue)
  const fontIssue = inspectColor('fontColor', rule.fontColor, '#000000')
  if (fontIssue) issues.push(fontIssue)

  return issues.sort((left, right) => Number(right.blocking) - Number(left.blocking))
}

/** 把越界的矩形夹回工作表内（列号 → 字母） */
function buildClampedRange(rect: {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}): string {
  const startColumn = Math.min(Math.max(rect.startColumn, 1), MAX_COLUMN)
  const endColumn = Math.min(Math.max(rect.endColumn, 1), MAX_COLUMN)
  const startRow = Math.min(Math.max(rect.startRow, 1), MAX_ROW)
  const endRow = Math.min(Math.max(rect.endRow, 1), MAX_ROW)
  return `${columnLetters(startColumn)}${String(startRow)}:${columnLetters(endColumn)}${String(endRow)}`
}

/** 列号 → 字母（1 → A，27 → AA） */
function columnLetters(column: number): string {
  let rest = column
  let letters = ''
  while (rest > 0) {
    const remainder = (rest - 1) % 26
    letters = String.fromCodePoint(65 + remainder) + letters
    rest = Math.floor((rest - 1) / 26)
  }
  return letters
}

/** 颜色字段体检：空 / 非法 → 给一个可落地的兜底值 */
function inspectColor(
  field: 'interior' | 'fontColor',
  raw: string | undefined,
  fallback: string,
): RuleIssue | null {
  if (raw === undefined || raw.trim() === '') return null
  if (normalizeHexColor(raw) !== null) return null
  return {
    code: 'color-invalid',
    field,
    message: `颜色“${raw}”不是合法的 #RRGGBB，写进宿主会被拒绝`,
    fixed: fallback,
    blocking: true,
  }
}

/** 是否有「必须修」的问题 */
export function hasBlockingIssue(issues: readonly RuleIssue[]): boolean {
  return issues.some((issue) => issue.blocking)
}

/**
 * 按字段产出「改了哪一条」的部分对象（不就地改参数：no-param-reassign）
 *
 * @returns 待合并进规则对象的补丁
 */
function fixPatch(field: RuleIssue['field'], value: string): Partial<InspectableRule> {
  switch (field) {
    case 'appliesTo': {
      return { appliesTo: value }
    }
    case 'formula': {
      return { formula: value }
    }
    case 'interior': {
      return { interior: value }
    }
    default: {
      return { fontColor: value }
    }
  }
}

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
export function fixRule<T extends InspectableRule>(rule: T): { rule: T; applied: RuleIssue[] } {
  const next: T = { ...rule }
  const applied: RuleIssue[] = []
  const usedCodes = new Set<RuleIssueCode>()
  for (let round = 0; round < MAX_FIX_ROUNDS; round += 1) {
    const pending = inspectRule(next).filter(
      (issue) => issue.fixed !== undefined && !usedCodes.has(issue.code),
    )
    const issue = pending[0]
    if (issue?.fixed === undefined) break
    usedCodes.add(issue.code)
    Object.assign(next, fixPatch(issue.field, issue.fixed))
    applied.push(issue)
  }
  return { rule: next, applied }
}

/**
 * 体检一批规则（导入 / 应用前的统一入口）
 *
 * @param rules 待检规则
 * @param pickName 规则名（弹窗里显示）；不传则用「#序号」
 * @returns 有问题**且需要用户处理**的条目（阻断项或全部？—— 见 `blockingOnly`）
 */
export function inspectRules<T extends InspectableRule>(
  rules: readonly T[],
  pickName?: (rule: T, index: number) => string,
): { rule: T; index: number; name: string; issues: RuleIssue[] }[] {
  return rules
    .map((rule, index) => ({
      rule,
      index,
      name: pickName?.(rule, index) ?? `#${String(index + 1)}`,
      issues: inspectRule(rule),
    }))
    .filter((entry) => entry.issues.length > 0)
}
