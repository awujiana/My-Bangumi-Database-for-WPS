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

import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog } from '../tools/util/index.js'
import { describeRangeForDiagnosis, readRangeAddress } from '../tools/wps-range.js'
import { XL_EXPRESSION } from './conditional-format-rules.js'
import type {
  ConditionalFormatApplyEntry,
  ConditionalFormatApplyPlan,
  ForeignRuleSnapshot,
} from './conditional-format-rules.js'
import type { WpsFormatCondition, WpsRange, WpsWorksheet } from '../tools/wps.js'

/** 应用结果统计（进日志与完成提示） */
export interface ConditionalFormatApplyResult {
  added: number
  failed: number
}

/**
 * 探测宿主是否支持条件格式 API
 *
 * 判据是 UsedRange 上能拿到 FormatConditions 且 Add 是函数——只读属性、
 * 不创建任何规则。部分 WPS 版本 / 只读代理下为 false。
 */
export function isFormatConditionsSupported(worksheet: WpsWorksheet | null | undefined): boolean {
  if (!worksheet?.UsedRange) return false
  return typeof worksheet.UsedRange.FormatConditions?.Add === 'function'
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
  const formatConditions = worksheet?.UsedRange?.FormatConditions
  if (typeof formatConditions?.Item !== 'function') {
    return '宿主未提供 FormatConditions.Item，无法枚举既有规则'
  }
  return null
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
 * 走 FormatCondition.ModifyAppliesToRange（WPS 文档方法）。
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
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 改第 index 条既有规则的公式（Formula1 赋值）
 *
 * 与 setForeignStopIfTrue 同款：VBA 口径 Formula1 可写，JS 侧属性赋值；
 * 宿主只读时抛错，返回错误文案由页面提示并还原输入框。
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
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message }
  }
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

/** 取计划项的公式（插件规则与外来快照都是 Formula1 原样回写） */
function entryFormula(entry: ConditionalFormatApplyEntry): string {
  return entry.source === 'plugin' ? entry.rule.formula : entry.formula
}

/** 取计划项的范围（联合类型两分支字段名不同，收敛到一处） */
function entryRange(entry: ConditionalFormatApplyEntry): string {
  return entry.source === 'plugin' ? entry.rule.appliesTo : entry.range
}

/** 给单条规则上格式（With 对象形式；字体三属性全空时不上 Font） */
function applyEntryFormat(fc: WpsFormatCondition, entry: ConditionalFormatApplyEntry): void {
  const withFormat = fc.With
  if (withFormat === undefined) return
  const interior = entry.source === 'plugin' ? entry.rule.interior : entry.interior
  const fontColor = entry.source === 'plugin' ? entry.rule.fontColor : entry.fontColor
  const fontBold = entry.source === 'plugin' ? entry.rule.fontBold : undefined
  withFormat({
    ...(interior !== undefined && { Interior: { Color: interior } }),
    ...((fontColor !== undefined || fontBold !== undefined) && {
      Font: {
        ...(fontColor !== undefined && { Color: fontColor }),
        ...(fontBold !== undefined && { Bold: fontBold }),
      },
    }),
  })
}

/**
 * 执行应用计划
 *
 * 顺序：UsedRange 上 Delete() 清空 → 逐条 Range(范围).FormatConditions.Add →
 * With 上格式 → **反序 SetFirstPriority**（每调一次都把该规则顶到最高，
 * 反序走完后 entries[0] 即为最高优先级——不依赖 Add 的默认优先序）。
 *
 * @returns 成功 / 失败条数（失败进 WARN 日志，不中断整批）
 */
export function applyConditionalFormatPlan(
  worksheet: WpsWorksheet | null | undefined,
  plan: ConditionalFormatApplyPlan,
): ConditionalFormatApplyResult {
  const sheetConditions = worksheet?.UsedRange?.FormatConditions
  if (!worksheet || !sheetConditions?.Add) return { added: 0, failed: plan.entries.length }

  // 1. 清空（快照已由调用方读过并按策略确认；含插件旧规则，保证幂等）
  try {
    sheetConditions.Delete?.()
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[conditionalFormatApply] 清空旧规则失败: ${(error as Error).message}`)
  }

  // 2. 逐条重建
  let added = 0
  let failed = 0
  const created: WpsFormatCondition[] = []
  for (const entry of plan.entries) {
    const label = entry.source === 'plugin' ? entry.rule.name : entry.range
    try {
      const target = worksheet.Range(entryRange(entry))
      const fc = target.FormatConditions?.Add?.({
        Type: XL_EXPRESSION,
        Formula1: entryFormula(entry),
      })
      if (fc) {
        applyEntryFormat(fc, entry)
        created.push(fc)
        added += 1
      } else {
        failed += 1
      }
    } catch (error: unknown) {
      failed += 1
      bgmLog(
        LOG_LEVELS.WARN,
        `[conditionalFormatApply] 写入规则失败（${label}）: ${(error as Error).message}`,
      )
    }
  }

  // 3. 优先级：entries[0] 最高 → 反序逐个置顶
  for (let index = created.length - 1; index >= 0; index -= 1) {
    try {
      created[index]?.SetFirstPriority?.()
    } catch {
      // 优先级微调失败不致命（多数宿主按添加序即可满足）
    }
  }

  return { added, failed }
}
