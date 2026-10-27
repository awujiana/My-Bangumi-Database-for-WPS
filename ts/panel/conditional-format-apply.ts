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

import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog } from '../tools/util/index.js'
import { describeRangeForDiagnosis, readRangeAddress } from '../tools/wps-range.js'
import {
  XL_EXPRESSION,
  ruleFingerprint,
  ruleFingerprintOfRule,
  ruleFormulaKey,
} from './conditional-format-rules.js'
import type {
  ConditionalFormatApplyEntry,
  ConditionalFormatApplyPlan,
  ConditionalFormatRule,
  ForeignRuleSnapshot,
} from './conditional-format-rules.js'
import type {
  WpsFormatCondition,
  WpsFormatConditions,
  WpsRange,
  WpsWorksheet,
} from '../tools/wps.js'

/** 应用结果统计（进日志与完成提示） */
export interface ConditionalFormatApplyResult {
  /** 新写入的条数 */
  added: number
  /** 表上已存在、只刷新了格式的条数 */
  refreshed: number
  /** 移除的「上一轮自己写的、规则库里已删掉」的条数 */
  deleted: number
  /** 写入失败的条数 */
  failed: number
  /** 写完后回读到的整表条数（-1 = 宿主不支持回读）；页面据此判「是否真的写进去了」 */
  verified: number
  /**
   * 写完后回读「规则库里有、表上却找不到」的规则名
   *
   * 这是「规则应用不上去」的唯一可靠判据：`Add` 返回了对象、整表条数也涨了，
   * 仍可能因为公式非法 / 范围越界 / 宿主丢弃而**这一条**没生效。只报总数会
   * 把这种局部失败说成「已写入 N 条」，用户去表上找不到却无从定位。
   */
  missing: string[]
}

/**
 * 取本表可用的 FormatConditions 集合（**Sheet 级优先，回退 UsedRange**）
 *
 * ## 为什么必须与 readForeignRules 同序
 * 读取走 Sheet 级（全表规则），而应用与探测原先只认 `UsedRange.FormatConditions`。
 * 在「Sheet 级有、UsedRange 级没有（或只在 UsedRange 上 Add 不生效）」的宿主上，
 * 界面能列出规则、点应用却一条也写不进去（`added = 0`），表现就是
 * **「规则管理器修改后无法应用到工作表」**——两侧口径不一致的静默后果。
 */
function resolveFormatConditions(
  worksheet: WpsWorksheet | null | undefined,
): WpsFormatConditions | undefined {
  return worksheet?.FormatConditions ?? worksheet?.UsedRange?.FormatConditions
}

/**
 * 探测宿主是否支持条件格式 API
 *
 * 判据是能拿到 FormatConditions 且 Add 是函数——只读属性、不创建任何规则。
 * 部分 WPS 版本 / 只读代理下为 false。
 */
export function isFormatConditionsSupported(worksheet: WpsWorksheet | null | undefined): boolean {
  return typeof resolveFormatConditions(worksheet)?.Add === 'function'
}

/**
 * 检查能否枚举既有规则
 *
 * @returns 能枚举返回 null；否则返回**原因**（页面据此区分「这张表没有规则」和
 *   「根本读不到规则」——后者曾被静默当成前者，用户看到的是误导性的空列表）
 */
export function checkFormatConditionsReadable(
  worksheet: WpsWorksheet | null | undefined,
): string | null {
  if (!isFormatConditionsSupported(worksheet)) return '当前 WPS 版本不支持条件格式 API'
  if (typeof resolveFormatConditions(worksheet)?.Item !== 'function') {
    return '宿主未提供 FormatConditions.Item，无法枚举既有规则'
  }
  return null
}

/** 归一化公式用于回读比对：去首尾空白、去前导 `=`、压掉全部空格 */
function normalizeFormulaForCompare(formula: string): string {
  return formula.replace(/\s+/gu, '').replace(/^=/u, '')
}

/** 归一化范围用于回读比对：去空白、去 `$`、转大写（`b2:b50001` 与 `$B$2:$B$50001` 等价） */
function normalizeRangeForCompare(range: string): string {
  return range.replace(/\s+/gu, '').replace(/\$/gu, '').toUpperCase()
}

/** 归一化颜色：`#00b050` / `00B050` 都收敛成 `#00B050` */
function normalizeColorForCompare(color: string): string {
  const bare = color.replace(/^#/u, '').toUpperCase()
  return `#${bare}`
}

/** 读一条规则的填充色（尽力而为；宿主拒绝时留空） */
function readInteriorColor(fc: WpsFormatCondition): string | undefined {
  try {
    const color = fc.Interior?.Color
    return typeof color === 'number'
      ? `#${color.toString(16).padStart(6, '0').toUpperCase()}`
      : undefined
  } catch {
    return undefined
  }
}

/** 读一条规则的字体色（尽力而为） */
function readFontColor(fc: WpsFormatCondition): string | undefined {
  try {
    const color = fc.Font?.Color
    return typeof color === 'number'
      ? `#${color.toString(16).padStart(6, '0').toUpperCase()}`
      : undefined
  } catch {
    return undefined
  }
}

/** 读「如果为真则停止」（尽力而为；宿主不暴露时留空，UI 显示为未设置） */
function readStopIfTrue(fc: WpsFormatCondition): boolean | undefined {
  try {
    const value = fc.StopIfTrue
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

/** 读规则公式（宿主不暴露 / 抛错时收敛成空串） */
function readFormulaSafe(fc: WpsFormatCondition): string {
  try {
    return typeof fc.Formula1 === 'string' ? fc.Formula1 : ''
  } catch {
    return ''
  }
}

/** 读 Areas 联合选区：多个不连续区域拼成 "A1:C38,D1:D38"（对标 WPS 原生规则管理器） */
function readAreasAddress(appliesTo: WpsRange): string {
  try {
    // 写法对齐 exceltobangumi 的 collectRowNumbersFromSelection：直接属性访问 +
    // 可选链。勿改解构 `const { areas } = appliesTo` —— 可选属性解构会被
    // typescript-eslint 判成 error typed（实测报一串 no-unsafe-*）。
    const areas = appliesTo.Areas
    const count = areas?.Count ?? 0
    if (count <= 0) return ''
    const parts: string[] = []
    for (let index = 1; index <= count; index += 1) {
      const address = readRangeAddress(areas?.Item(index))
      if (address !== '') parts.push(address)
    }
    return parts.join(',')
  } catch {
    return ''
  }
}

/** 宿主对象形态一句话（诊断日志用；宿主代理可能禁 keys，故 try） */
function describeHostValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'object') {
    let keys: string
    try {
      keys = Object.keys(value).slice(0, 24).join(',')
    } catch {
      keys = '<不可枚举>'
    }
    return `object keys=[${keys}]`
  }
  if (typeof value === 'string') return `string: ${value}`
  if (typeof value === 'function') return 'function'
  // number / boolean / bigint / symbol：只报类型名，不值（地址诊断用不到值）
  return typeof value
}

/** AppliesTo 诊断日志（只记第 1 条，见 readAppliesToAddress 注释） */
function logAppliesToDiagnosis(index: number, detail: string): void {
  if (index !== 1) return
  bgmLog(LOG_LEVELS.WARN, `[conditionalFormatApply] 第 1 条规则范围读取异常: ${detail}`)
}

/**
 * 读规则的应用范围地址（尽力而为，多路尝试 + 诊断）。
 *
 * ## 背景（momo 实测两轮诊断）
 * Sheet 级读到 38 条规则、范围却全是「（未读到范围）」。诊断确认 AppliesTo
 * 是真 Range 对象，`Address`/`AddressLocal` 均为**函数**（无参调用抛错），
 * 而 `Row/Column/Rows.Count/Columns.Count` 全是可读 number。
 *
 * 读取顺序：Areas 联合拼接（多区域唯一完整解）→ readRangeAddress
 * （Address 属性/函数 → AddressLocal → 行列拼装）。每条路独立 try，
 * 某条抛错不连坐后面的路。
 *
 * ## 诊断日志只打第 1 条
 * 38 条逐条打会把控制台刷爆，而第 1 条的宿主行为代表整批。修好后这里应恢复静默。
 */
function readAppliesToAddress(fc: WpsFormatCondition, index: number): string {
  let appliesTo: WpsRange | undefined
  try {
    appliesTo = fc.AppliesTo
  } catch (error: unknown) {
    logAppliesToDiagnosis(index, `AppliesTo 读取抛错: ${(error as Error).message}`)
    return ''
  }
  if (appliesTo === undefined) {
    logAppliesToDiagnosis(index, 'AppliesTo 为 undefined（该 WPS 版本不暴露规则范围）')
    return ''
  }

  // 先 Areas：多区域联合选区只有它能给出完整范围（"A1:C38,D1:D38"）；
  // 单区域时它与直接拼装等价。readRangeAddress 内部每条路独立 try
  // （Address() 无参调用会抛错），某条路失败不连坐后面的路。
  const areas = readAreasAddress(appliesTo)
  if (areas !== '') return areas

  const direct = readRangeAddress(appliesTo)
  if (direct !== '') return direct

  logAppliesToDiagnosis(
    index,
    `AppliesTo 形态 ${describeHostValue(appliesTo)} | ${describeRangeForDiagnosis(appliesTo)}`,
  )
  return ''
}

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
export function getForeignCondition(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
): WpsFormatCondition | null {
  const formatConditions = worksheet?.FormatConditions ?? worksheet?.UsedRange?.FormatConditions
  if (typeof formatConditions?.Item !== 'function') return null
  try {
    // 宿主可能对越界下标返回 undefined 而非抛错，这里统一收敛成 null
    return formatConditions.Item(index) ?? null
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[conditionalFormatApply] 取第 ${String(index)} 条规则失败: ${(error as Error).message}`,
    )
    return null
  }
}

/**
 * 删除工作表上第 index 条既有规则
 *
 * WPS 对 FormatCondition.Delete 的支持随版本/只读代理而变，故用可选调用 +
 * try 包裹：失败返回错误文案（页面提示），绝不静默返回成功。
 */
export function deleteForeignRule(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
): { ok: true } | { ok: false; error: string } {
  const fc = getForeignCondition(worksheet, index)
  if (!fc) return { ok: false, error: '定位不到该规则（可能已被删除）' }
  if (typeof fc.Delete !== 'function') {
    return { ok: false, error: '当前 WPS 版本不支持删除单条规则，请用「清空后应用」' }
  }
  try {
    fc.Delete()
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 设置「如果为真则停止」
 *
 * 同理：写不进去就明说，不假装成功（用户会以为设置生效了）。
 */
export function setForeignStopIfTrue(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
  isStopIfTrue: boolean,
): { ok: true } | { ok: false; error: string } {
  const fc = getForeignCondition(worksheet, index)
  if (!fc) return { ok: false, error: '定位不到该规则（可能已被删除）' }
  try {
    fc.StopIfTrue = isStopIfTrue
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 改第 index 条既有规则的应用范围
 *
 * 走 FormatCondition.ModifyAppliesToRange（WPS 文档方法），**写后回读比对**：
 * 宿主接受调用却不生效时（只读代理 / 老版本），不回读就会提示「已改为 X」
 * 而表上没变——正是用户反馈的「修改后无法应用到工作表」。
 * 写不进去就明说（宿主版本不支持 / 范围字符串非法），由页面还原输入。
 */
export function setForeignAppliesTo(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
  range: string,
): { ok: true } | { ok: false; error: string } {
  const fc = getForeignCondition(worksheet, index)
  if (!fc) return { ok: false, error: '定位不到该规则（可能已被删除）' }
  if (typeof fc.ModifyAppliesToRange !== 'function') {
    return { ok: false, error: '当前 WPS 版本不支持修改应用范围' }
  }
  try {
    fc.ModifyAppliesToRange(range)
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message }
  }
  const actual = readAppliesToAddress(fc, index)
  if (actual !== '' && normalizeRangeForCompare(actual) !== normalizeRangeForCompare(range)) {
    return { ok: false, error: `范围未写入（宿主回读为「${actual}」）` }
  }
  return { ok: true }
}

/**
 * 改第 index 条既有规则的公式（Formula1 赋值）
 *
 * 与 setForeignStopIfTrue 同款：VBA 口径 Formula1 可写，JS 侧属性赋值；
 * 宿主只读时抛错，返回错误文案由页面提示并还原输入框。
 * 同样**写后回读**——赋值不抛错不代表生效。
 */
export function setForeignFormula(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
  formula: string,
): { ok: true } | { ok: false; error: string } {
  const fc = getForeignCondition(worksheet, index)
  if (!fc) return { ok: false, error: '定位不到该规则（可能已被删除）' }
  try {
    fc.Formula1 = formula
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message }
  }
  const actual = readFormulaSafe(fc)
  if (actual !== '' && normalizeFormulaForCompare(actual) !== normalizeFormulaForCompare(formula)) {
    return { ok: false, error: `公式未写入（宿主回读为「${actual}」）` }
  }
  return { ok: true }
}

/**
 * 编辑一条既有规则时可改的字段（未提供的字段不动）
 *
 * 范围走 `ModifyAppliesToRange`、公式走 `Formula1` 赋值、颜色走 `With`——
 * 与新建规则用的同一套宿主能力，避免「编辑器里改得了、应用时改不了」的两套口径。
 */
export interface ForeignRulePatch {
  range?: string
  formula?: string
  interior?: string
  fontColor?: string
  fontBold?: boolean
}

/** 编辑既有规则的结果：`warnings` 是「写进去了但回读不一致」的软告警 */
export type ForeignRuleUpdateResult =
  | { ok: true; changed: string[]; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

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
export function updateForeignRule(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
  patch: ForeignRulePatch,
): ForeignRuleUpdateResult {
  const fc = getForeignCondition(worksheet, index)
  if (!fc) return { ok: false, error: '定位不到该规则（可能已被删除）', warnings: [] }

  const changed: string[] = []
  const warnings: string[] = []

  if (patch.formula !== undefined) {
    const wanted = patch.formula.trim()
    if (wanted !== '') {
      try {
        fc.Formula1 = wanted
      } catch (error: unknown) {
        return { ok: false, error: `公式写入失败：${(error as Error).message}`, warnings }
      }
      const actual = readFormulaSafe(fc)
      if (
        actual !== '' &&
        normalizeFormulaForCompare(actual) !== normalizeFormulaForCompare(wanted)
      ) {
        return {
          ok: false,
          error: `公式未写入（宿主回读为「${actual}」），请改用「清空后应用」重写整表规则`,
          warnings,
        }
      }
      changed.push('公式')
    }
  }

  if (patch.range !== undefined) {
    const wanted = patch.range.trim()
    if (wanted !== '') {
      if (typeof fc.ModifyAppliesToRange !== 'function') {
        return { ok: false, error: '当前 WPS 版本不支持修改应用范围', warnings }
      }
      try {
        fc.ModifyAppliesToRange(wanted)
      } catch (error: unknown) {
        return { ok: false, error: `范围写入失败：${(error as Error).message}`, warnings }
      }
      const actual = readAppliesToAddress(fc, index)
      if (actual !== '' && normalizeRangeForCompare(actual) !== normalizeRangeForCompare(wanted)) {
        return {
          ok: false,
          error: `范围未写入（宿主回读为「${actual}」），请改用「清空后应用」重写整表规则`,
          warnings,
        }
      }
      changed.push('范围')
    }
  }

  const hasFormatPatch =
    patch.interior !== undefined || patch.fontColor !== undefined || patch.fontBold !== undefined
  if (hasFormatPatch) {
    try {
      fc.With?.({
        ...(patch.interior !== undefined && { Interior: { Color: patch.interior } }),
        ...((patch.fontColor !== undefined || patch.fontBold !== undefined) && {
          Font: {
            ...(patch.fontColor !== undefined && { Color: patch.fontColor }),
            ...(patch.fontBold !== undefined && { Bold: patch.fontBold }),
          },
        }),
      })
    } catch (error: unknown) {
      return { ok: false, error: `格式写入失败：${(error as Error).message}`, warnings }
    }
    if (patch.interior !== undefined) {
      const actualFill = readInteriorColor(fc)
      if (
        actualFill !== undefined &&
        normalizeColorForCompare(actualFill) !== normalizeColorForCompare(patch.interior)
      ) {
        warnings.push(`填充色回读为 ${actualFill}（与设定的 ${patch.interior} 不一致）`)
      }
      changed.push('填充色')
    }
    if (patch.fontColor !== undefined) {
      const actualFont = readFontColor(fc)
      if (
        actualFont !== undefined &&
        normalizeColorForCompare(actualFont) !== normalizeColorForCompare(patch.fontColor)
      ) {
        warnings.push(`字体色回读为 ${actualFont}（与设定的 ${patch.fontColor} 不一致）`)
      }
      changed.push('字体色')
    }
    if (patch.fontBold !== undefined) changed.push(patch.fontBold ? '加粗' : '取消加粗')
  }

  if (changed.length === 0) return { ok: false, error: '没有任何改动', warnings }
  return { ok: true, changed, warnings }
}

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
export function duplicateForeignRule(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
  targetRange?: string,
): { ok: true; range: string } | { ok: false; error: string } {
  const fc = getForeignCondition(worksheet, index)
  if (!fc) return { ok: false, error: '定位不到该规则（可能已被删除）' }
  const formula = readFormulaSafe(fc)
  if (formula === '') {
    return { ok: false, error: '这条规则没有可读到的公式（数据条 / 色阶 / 图标集等类型无法复制）' }
  }
  const sourceRange = readAppliesToAddress(fc, index)
  const range = (targetRange ?? '').trim() === '' ? sourceRange : (targetRange ?? '').trim()
  if (range === '') {
    return { ok: false, error: '读不到这条规则的应用范围，请先手动填写目标范围' }
  }
  const collection = resolveFormatConditions(worksheet)
  if (typeof collection?.Add !== 'function') {
    return { ok: false, error: '当前 WPS 版本不支持添加条件格式' }
  }
  const countBefore = typeof collection.Count === 'number' ? collection.Count : -1
  const fill = readInteriorColor(fc)
  const fontColor = readFontColor(fc)
  try {
    const target = worksheet?.Range(range)
    const created = target?.FormatConditions?.Add?.({ Type: XL_EXPRESSION, Formula1: formula })
    if (!created) return { ok: false, error: '添加副本失败（宿主未返回规则对象）' }
    created.With?.({
      ...(fill !== undefined && { Interior: { Color: fill } }),
      ...(fontColor !== undefined && { Font: { Color: fontColor } }),
    })
  } catch (error: unknown) {
    return { ok: false, error: `添加副本失败：${(error as Error).message}` }
  }
  const countAfter = typeof collection.Count === 'number' ? collection.Count : -1
  if (countBefore >= 0 && countAfter >= 0 && countAfter <= countBefore) {
    return { ok: false, error: '复制未生效（工作表上的规则条数没有增加）' }
  }
  return { ok: true, range }
}

/**
 * 读规则的 Priority（非数字 / 抛错统一收敛成 null）
 *
 * Priority 是「优先级名次」：1 = 最高。读不到时调用方给明确错误，
 * 不猜一个值继续写（写错优先级 = 规则静默换序，比失败更难发现）。
 */
function readPriority(fc: WpsFormatCondition): number | null {
  try {
    const value = fc.Priority
    return typeof value === 'number' ? value : null
  } catch {
    return null
  }
}

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
export function moveForeignRule(
  worksheet: WpsWorksheet | null | undefined,
  index: number,
  direction: -1 | 1,
): { ok: true } | { ok: false; error: string } {
  const fc = getForeignCondition(worksheet, index)
  if (!fc) return { ok: false, error: '定位不到该规则（可能已被删除）' }
  const neighbor = getForeignCondition(worksheet, index + direction)
  if (!neighbor) {
    return {
      ok: false,
      error: direction === -1 ? '已经是优先级最高的规则' : '已经是优先级最低的规则',
    }
  }
  const ownPriority = readPriority(fc)
  const neighborPriority = readPriority(neighbor)
  if (ownPriority === null || neighborPriority === null) {
    return { ok: false, error: '当前 WPS 版本读不到规则优先级，无法调整顺序' }
  }
  try {
    // 两条都写：不依赖宿主是否在首次写入后自动重排（自动重排的宿主第二次
    // 写的是同值，无害；不重排的宿主靠这两行完成互换）
    fc.Priority = neighborPriority
    neighbor.Priority = ownPriority
  } catch (error: unknown) {
    return { ok: false, error: `调整失败：${(error as Error).message}` }
  }
  // 回读校验：写入被静默忽略时值不会变
  if (readPriority(fc) !== neighborPriority || readPriority(neighbor) !== ownPriority) {
    return { ok: false, error: '当前 WPS 版本不支持逐格调整优先级（写入未生效）' }
  }
  return { ok: true }
}

/**
 * 读工作表既有条件格式规则快照
 *
 * 走 worksheet.FormatConditions（**全表**规则，各自带 AppliesTo）—— 对标 WPS 原生
 * 规则管理器的全表口径。先前用 UsedRange.FormatConditions：只收与 UsedRange 相交的
 * 规则，且相交规则的 AppliesTo 在部分 WPS 版本读不到 → 「应用于」列显示「（未读到范围）」。
 * 兜底：个别 WPS 版本 Sheet 无 FormatConditions 时回退 UsedRange（不完整但不空）。
 * Count 提到循环外单次读取（com-in-loop 铁律：循环条件里不读 COM 属性）。
 */
export function readForeignRules(
  worksheet: WpsWorksheet | null | undefined,
): ForeignRuleSnapshot[] {
  const formatConditions = worksheet?.FormatConditions ?? worksheet?.UsedRange?.FormatConditions
  if (!formatConditions?.Count || !formatConditions.Item) return []

  const count = formatConditions.Count
  const snapshots: ForeignRuleSnapshot[] = []
  for (let index = 1; index <= count; index += 1) {
    try {
      const fc = formatConditions.Item(index)
      // 越界下标下宿主可能返回 undefined：把该下标读成空快照跳过，
      // 而不是把整批读成空（项目禁用 continue，故用条件包裹而非提前跳）
      if (fc) {
        const interior = readInteriorColor(fc)
        const fontColor = readFontColor(fc)
        const stopIfTrue = readStopIfTrue(fc)
        // 范围走多路尝试 + 诊断（属性/函数两副面孔、Areas 联合拼接）；
        // 全失败才为空串，渲染层有「（未读到范围）」占位兜底
        const range = readAppliesToAddress(fc, index)
        snapshots.push({
          range,
          formula: typeof fc.Formula1 === 'string' ? fc.Formula1 : '',
          kind: fc.Type === XL_EXPRESSION ? 'expression' : 'other',
          ...(typeof fc.Type === 'number' && { type: fc.Type }),
          ...(interior !== undefined && { interior }),
          ...(fontColor !== undefined && { fontColor }),
          ...(stopIfTrue !== undefined && { stopIfTrue }),
        })
      }
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[conditionalFormatApply] 读取第 ${String(index)} 条规则失败: ${(error as Error).message}`,
      )
    }
  }
  return snapshots
}

/** 给单条规则上格式（With 对象形式；字体三属性全空时不上 Font） */
function applyEntryFormat(fc: WpsFormatCondition, entry: ConditionalFormatApplyEntry): void {
  const withFormat = fc.With
  if (withFormat === undefined) return
  const { rule } = entry
  withFormat({
    Interior: { Color: rule.interior },
    ...((rule.fontColor !== undefined || rule.fontBold !== undefined) && {
      Font: {
        ...(rule.fontColor !== undefined && { Color: rule.fontColor }),
        ...(rule.fontBold !== undefined && { Bold: rule.fontBold }),
      },
    }),
  })
}

/**
 * 清空一个 FormatConditions 集合（`Delete()` 优先，没有就逐条反序删）
 *
 * 逐条删的意义：个别 WPS 版本的 `FormatConditions.Delete` 只清「与该区域相交」的规则
 * （UsedRange 级尤其如此），整列规则会残留下来，随后 Add 又叠一层 ——
 * 用户看到的就是「越点应用，规则越多」。
 */
function clearConditions(collection: WpsFormatConditions): void {
  try {
    if (typeof collection.Delete === 'function') {
      collection.Delete()
      return
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[conditionalFormatApply] 清空旧规则失败: ${(error as Error).message}`)
  }
  const count = typeof collection.Count === 'number' ? collection.Count : 0
  for (let index = count; index >= 1; index -= 1) {
    try {
      collection.Item?.(index)?.Delete?.()
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[conditionalFormatApply] 逐条删除第 ${String(index)} 条失败: ${(error as Error).message}`,
      )
    }
  }
}

/**
 * 扫一遍整表规则，建两个索引（同一键只取第一条）
 *
 * - `byFingerprint`：范围 + 公式，**主判据**；
 * - `byFormula`：只按公式，**降级判据**（宿主读不到 `AppliesTo` 时快照 range 恒空，
 *   完整指纹一条都对不上 → 刷新与回读校验会全部落空，表现为「规则应用不上去」
 *   或每次应用都重复 Add）。
 *
 * 删除只用主判据：删错人比不删严重（不删最多留一条旧规则，删错就是数据丢失）。
 *
 * 一次扫描供删除 / 刷新 / 回读共用（删除按下标**倒序**进行，低下标始终有效）。
 */
interface LocatedConditions {
  byFingerprint: Map<string, number>
  byFormula: Map<string, number>
  /** 实际读到的规则条数（同名规则会被 Map 去重，计数必须单独记） */
  count: number
}

function locateConditions(worksheet: WpsWorksheet | null | undefined): LocatedConditions {
  const collection = resolveFormatConditions(worksheet)
  const located: LocatedConditions = {
    byFingerprint: new Map(),
    byFormula: new Map(),
    count: 0,
  }
  if (!collection?.Count || typeof collection.Item !== 'function') return located
  const count = collection.Count
  for (let index = 1; index <= count; index += 1) {
    try {
      const fc = collection.Item(index)
      if (fc) {
        located.count += 1
        const formula = readFormulaSafe(fc)
        const fingerprint = ruleFingerprint({ range: readAppliesToAddress(fc, index), formula })
        if (!located.byFingerprint.has(fingerprint)) located.byFingerprint.set(fingerprint, index)
        const formulaKey = ruleFormulaKey(formula)
        if (!located.byFormula.has(formulaKey)) located.byFormula.set(formulaKey, index)
      }
    } catch {
      // 单条读不到不影响其余（与 readForeignRules 同口径）
    }
  }
  return located
}

/** 按主判据定位（删除用；找不到 = 不动，绝不猜） */
function indexOfFingerprint(
  located: LocatedConditions,
  record: { range: string; formula: string },
): number | undefined {
  return located.byFingerprint.get(ruleFingerprint(record))
}

/** 空索引（跳过定位那一轮时用，避免再判一次 null） */
const EMPTY_LOCATED: LocatedConditions = {
  byFingerprint: new Map(),
  byFormula: new Map(),
  count: 0,
}

/** 按主判据定位，落空时退到只比公式（刷新 / 回读校验用） */
function indexOfRule(located: LocatedConditions, rule: ConditionalFormatRule): number | undefined {
  return (
    located.byFingerprint.get(ruleFingerprintOfRule(rule)) ??
    located.byFormula.get(ruleFormulaKey(rule.formula))
  )
}

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
export function applyConditionalFormatPlan(
  worksheet: WpsWorksheet | null | undefined,
  plan: ConditionalFormatApplyPlan,
): ConditionalFormatApplyResult {
  const sheetConditions = resolveFormatConditions(worksheet)
  if (!worksheet || typeof sheetConditions?.Add !== 'function') {
    return {
      added: 0,
      refreshed: 0,
      deleted: 0,
      failed: plan.entries.length,
      verified: -1,
      missing: plan.entries.map((entry) => entry.rule.name),
    }
  }

  // 1. 仅显式「清空整表」才清空——默认路径一条别人的规则都不碰
  if (plan.clearAll) clearConditions(sheetConditions)

  // 2. 定位一次：删除与刷新共用同一份索引（无需删除/刷新时省掉这一整轮 COM 读）
  const hasLocateTargets = plan.deletions.length > 0 || plan.refreshes.length > 0
  const located = hasLocateTargets ? locateConditions(worksheet) : EMPTY_LOCATED

  // 3. 移除「上一轮自己写的、规则库里已没有的」：**倒序**删，低下标才不失效
  let deleted = 0
  const deletionTargets = plan.deletions
    .map((record) => indexOfFingerprint(located, record))
    .filter((index): index is number => index !== undefined)
    .sort((left, right) => right - left)
  for (const index of deletionTargets) {
    try {
      sheetConditions.Item?.(index)?.Delete?.()
      deleted += 1
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[conditionalFormatApply] 移除旧规则失败（第 ${String(index)} 条）: ${(error as Error).message}`,
      )
    }
  }

  // 4. 表上已有同指纹的规则：不重复 Add，只把颜色刷成规则库里的设定
  let refreshed = 0
  for (const rule of plan.refreshes) {
    const index = indexOfRule(located, rule)
    const fc = index === undefined ? null : getForeignCondition(worksheet, index)
    if (fc) {
      try {
        applyEntryFormat(fc, { rule })
        refreshed += 1
      } catch (error: unknown) {
        bgmLog(
          LOG_LEVELS.WARN,
          `[conditionalFormatApply] 刷新规则格式失败（${rule.name}）: ${(error as Error).message}`,
        )
      }
    }
  }

  // 5. 逐条新增
  let added = 0
  let failed = 0
  const created: WpsFormatCondition[] = []
  for (const entry of plan.entries) {
    const { rule } = entry
    try {
      const target = worksheet.Range(rule.appliesTo)
      const fc = target.FormatConditions?.Add?.({
        Type: XL_EXPRESSION,
        Formula1: rule.formula,
      })
      if (fc) {
        applyEntryFormat(fc, entry)
        created.push(fc)
        added += 1
      } else {
        failed += 1
        bgmLog(
          LOG_LEVELS.WARN,
          `[conditionalFormatApply] 新增规则失败（${rule.name} · ${rule.appliesTo}）：宿主未返回规则对象`,
        )
      }
    } catch (error: unknown) {
      failed += 1
      bgmLog(
        LOG_LEVELS.WARN,
        `[conditionalFormatApply] 新增规则失败（${rule.name} · ${rule.appliesTo}）: ${(error as Error).message}`,
      )
    }
  }

  // 6. 优先级：entries[0] 最高 → 反序逐个置顶（只影响新加的，既有规则相对序不变）
  for (let index = created.length - 1; index >= 0; index -= 1) {
    try {
      created[index]?.SetFirstPriority?.()
    } catch {
      // 优先级微调失败不致命（多数宿主按添加序即可满足）
    }
  }

  // 7. 回读：整表条数 + 逐条指纹（`Add` 返回对象不代表这一条真的生效了）
  const after = locateConditions(worksheet)
  const expected: ConditionalFormatRule[] = [
    ...plan.refreshes,
    ...plan.entries.map((entry) => entry.rule),
  ]
  const missing = expected
    .filter((rule) => indexOfRule(after, rule) === undefined)
    .map((rule) => rule.name)
  const verified = after.count
  if (missing.length > 0) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[conditionalFormatApply] ${String(missing.length)} 条规则写后回读不到: ${missing.join(' / ')}`,
    )
  }

  return { added, refreshed, deleted, failed, verified, missing }
}
