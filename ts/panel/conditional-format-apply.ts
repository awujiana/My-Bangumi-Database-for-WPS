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
import { XL_EXPRESSION } from './conditional-format-rules.js'
import type {
  ConditionalFormatApplyEntry,
  ConditionalFormatApplyPlan,
  ForeignRuleSnapshot,
} from './conditional-format-rules.js'
import type { WpsFormatCondition, WpsWorksheet } from '../tools/wps.js'

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
export function isFormatConditionsSupported(ws: WpsWorksheet | null | undefined): boolean {
  if (!ws?.UsedRange) return false
  return typeof ws.UsedRange.FormatConditions?.Add === 'function'
}

/**
 * 检查能否枚举既有规则
 *
 * @returns 能枚举返回 null；否则返回**原因**（页面据此区分「这张表没有规则」和
 *   「根本读不到规则」——后者曾被静默当成前者，用户看到的是误导性的空列表）
 */
export function checkFormatConditionsReadable(ws: WpsWorksheet | null | undefined): string | null {
  if (!isFormatConditionsSupported(ws)) return '当前 WPS 版本不支持条件格式 API'
  const formatConditions = ws?.UsedRange?.FormatConditions
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

/**
 * 读工作表既有条件格式规则快照
 *
 * 走 UsedRange.FormatConditions（规则各自带 AppliesTo，收集全表规则；
 * 完全在 UsedRange 之外的规则本就不生效，收不到也可接受）。
 * Count 提到循环外单次读取（com-in-loop 铁律：循环条件里不读 COM 属性）。
 */
export function readForeignRules(ws: WpsWorksheet | null | undefined): ForeignRuleSnapshot[] {
  const formatConditions = ws?.UsedRange?.FormatConditions
  if (!formatConditions?.Count || !formatConditions.Item) return []

  const count = formatConditions.Count
  const snapshots: ForeignRuleSnapshot[] = []
  for (let index = 1; index <= count; index += 1) {
    try {
      const fc = formatConditions.Item(index)
      const interior = readInteriorColor(fc)
      const fontColor = readFontColor(fc)
      snapshots.push({
        range: fc.AppliesTo?.Address ?? '',
        formula: typeof fc.Formula1 === 'string' ? fc.Formula1 : '',
        kind: fc.Type === XL_EXPRESSION ? 'expression' : 'other',
        ...(typeof fc.Type === 'number' && { type: fc.Type }),
        ...(interior !== undefined && { interior }),
        ...(fontColor !== undefined && { fontColor }),
      })
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
  ws: WpsWorksheet | null | undefined,
  plan: ConditionalFormatApplyPlan,
): ConditionalFormatApplyResult {
  const sheetConditions = ws?.UsedRange?.FormatConditions
  if (!ws || !sheetConditions?.Add) return { added: 0, failed: plan.entries.length }

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
      const target = ws.Range(entryRange(entry))
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
