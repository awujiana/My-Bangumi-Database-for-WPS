// @vitest-environment node
/**
 * @fileoverview `ts/panel/conditional-format-apply.ts` COM 读写层单测（假工作表，Node 直跑）
 *
 * 覆盖重点（2026-10-24 用户实测缺陷的回归钉）：
 * 1. **moveForeignRule 是「相邻交换一格」**：旧实现用 SetFirstPriority /
 *    SetLastPriority（绝对置顶 / 置底）——点「上移」第 20 条瞬移到第 1 条，
 *    分组视图里整组跟着跳，观感就是「点一下变成了新的分组」。本测试钉死
 *    「只与邻居交换、两个 Set* 方法一次都不准调」。
 * 2. **索引空间与读取一致**：readForeignRules 走 Sheet 级 FormatConditions，
 *    getForeignCondition 曾走 UsedRange 级——两个集合条目错位时，表格第 N 行
 *    点「上移」动的是另一条规则。假工作表故意给两个**不同**的集合来钉这一点。
 * 3. **写不进去就明说**：Priority 读不到 / 写入被宿主静默忽略 / 邻居不存在，
 *    都必须返回明确错误文案，不静默成功也不假装成功。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// bgmLog 是 apply 唯一的重依赖（tools/util 会拖一整条 WPS 副作用链），mock 掉
vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: vi.fn(),
}))

import {
  applyConditionalFormatPlan,
  bgrToRgbHex,
  duplicateForeignRule,
  getForeignCondition,
  moveForeignRule,
  rgbHexToBgr,
  shiftRelativeRows,
  updateForeignRule,
} from '../ts/panel/conditional-format-apply.js'
import type {
  ConditionalFormatApplyEntry,
  ConditionalFormatApplyPlan,
} from '../ts/panel/conditional-format-rules.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'

/** 假规则：Priority 可读写，带两个「置顶/置底」间谍（断言它们永不被调） */
function makeRule(priority: number): {
  Priority: number
  SetFirstPriority: ReturnType<typeof vi.fn>
  SetLastPriority: ReturnType<typeof vi.fn>
} {
  return {
    Priority: priority,
    SetFirstPriority: vi.fn(),
    SetLastPriority: vi.fn(),
  }
}

/** 「接受写入但不改值」的假规则：模拟只读代理 / 老宿主静默忽略赋值 */
function makeStubbornRule(priority: number): { Priority: number } {
  return {
    get Priority(): number {
      return priority
    },
    set Priority(_next: number) {
      // 故意空实现：宿主接受赋值但不改值（回读校验要能抓到这种静默失败）
    },
  }
}

/** 「读 Priority 就抛错」的假规则 */
function makeThrowingRule(): Record<string, never> {
  return {
    get Priority(): never {
      throw new Error('宿主未暴露 Priority')
    },
  }
}

/** 把规则数组包成假 FormatConditions 集合（1 基 Item） */
function makeCollection(rules: unknown[]): unknown {
  return {
    Count: rules.length,
    Item: (index: number) => rules[index - 1],
  }
}

/**
 * 假工作表：Sheet 级与 UsedRange 级可以是**两个不同集合**
 * （钉索引空间对齐用；不传 usedRangeRules 时两级同源）
 */
function makeWorksheet(sheetRules: unknown[], usedRangeRules?: unknown[]): WpsWorksheet {
  const worksheet: Record<string, unknown> = { FormatConditions: makeCollection(sheetRules) }
  if (usedRangeRules !== undefined) {
    worksheet.UsedRange = { FormatConditions: makeCollection(usedRangeRules) }
  }
  return worksheet as unknown as WpsWorksheet
}

/**
 * 造一条「真机形态」的规则对象：`Interior` / `Font` 可读写，**没有 `With`**
 *
 * 真机实测（WPS 12.1.0.29158）：`FormatCondition` 只有 `Interior` / `Font`，
 * `fc.With` 是 `undefined`。假体必须照这个形态建——早期假体只给 `With`，
 * 于是「规则加进去了、填充色一次都没写进去」这个真 bug 在单测里全程隐形
 * （30 个用例全绿，真机上一片白底）。
 */
function makeHostCondition(formula: string): {
  Formula1: string
  Interior: { Color: number }
  Font: { Color: number; Bold: boolean }
} {
  return {
    Formula1: formula,
    Interior: { Color: 0 },
    Font: { Color: 0, Bold: false },
  }
}

/** 可写工作表：Add 会真的往集合里加一条（Count 可观测；`swallowAdd` 模拟静默丢弃） */
function makeAddableWorksheet(
  initial: unknown[],
  options: { swallowAdd?: boolean } = {},
): { worksheet: WpsWorksheet; rules: unknown[] } {
  const rules = [...initial]
  const add = (condition: { Formula1?: string }): Record<string, unknown> => {
    const created = makeHostCondition(condition.Formula1 ?? '')
    if (options.swallowAdd !== true) rules.push(created)
    return created
  }
  const worksheet = {
    FormatConditions: {
      get Count(): number {
        return rules.length
      },
      Item: (index: number) => rules[index - 1],
      Add: add,
    },
    Range: () => ({ FormatConditions: { Add: add } }),
  } as unknown as WpsWorksheet
  return { worksheet, rules }
}

/**
 * 只有 Sheet 级 FormatConditions 的宿主（没有 UsedRange 级）
 *
 * 回归钉：旧实现只认 `UsedRange.FormatConditions`，这种宿主上读取能列出规则、
 * 点应用却一条也写不进去（added = 0）——用户看到的就是「修改后无法应用到工作表」。
 */
function makeSheetLevelWorksheet(): { worksheet: WpsWorksheet; rules: unknown[] } {
  const rules: unknown[] = []
  const add = (condition: { Formula1?: string }): Record<string, unknown> => {
    const created = makeHostCondition(condition.Formula1 ?? '')
    rules.push(created)
    return created
  }
  const worksheet = {
    FormatConditions: {
      get Count(): number {
        return rules.length
      },
      Item: (index: number) => rules[index - 1],
      Delete: () => {
        rules.length = 0
      },
      Add: add,
    },
    Range: () => ({ FormatConditions: { Add: add } }),
  } as unknown as WpsWorksheet
  return { worksheet, rules }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('moveForeignRule：相邻交换一格', () => {
  it('上移：只与上一个邻居交换 Priority，不动其它规则', () => {
    const first = makeRule(1)
    const second = makeRule(2)
    const third = makeRule(3)
    const worksheet = makeWorksheet([first, second, third])

    const result = moveForeignRule(worksheet, 2, -1)

    expect(result).toEqual({ ok: true })
    expect(first.Priority).toBe(2)
    expect(second.Priority).toBe(1)
    expect(third.Priority).toBe(3)
  })

  it('下移：只与下一个邻居交换 Priority', () => {
    const first = makeRule(1)
    const second = makeRule(2)
    const worksheet = makeWorksheet([first, second])

    expect(moveForeignRule(worksheet, 1, 1)).toEqual({ ok: true })
    expect(first.Priority).toBe(2)
    expect(second.Priority).toBe(1)
  })

  it('回归钉：绝不调 SetFirstPriority / SetLastPriority（那是置顶/置底，不是上移一格）', () => {
    const first = makeRule(1)
    const second = makeRule(2)
    const worksheet = makeWorksheet([first, second])

    moveForeignRule(worksheet, 2, -1)

    expect(first.SetFirstPriority).not.toHaveBeenCalled()
    expect(first.SetLastPriority).not.toHaveBeenCalled()
    expect(second.SetFirstPriority).not.toHaveBeenCalled()
    expect(second.SetLastPriority).not.toHaveBeenCalled()
  })

  it('边界：已在顶 / 已在底返回明确错误（不越界交换）', () => {
    const first = makeRule(1)
    const second = makeRule(2)
    const worksheet = makeWorksheet([first, second])

    expect(moveForeignRule(worksheet, 1, -1)).toEqual({
      ok: false,
      error: '已经是优先级最高的规则',
    })
    expect(moveForeignRule(worksheet, 2, 1)).toEqual({
      ok: false,
      error: '已经是优先级最低的规则',
    })
    // 失败不改动任何优先级
    expect(first.Priority).toBe(1)
    expect(second.Priority).toBe(2)
  })

  it('定位不到规则（越界下标）返回错误，不静默成功', () => {
    const worksheet = makeWorksheet([makeRule(1)])
    expect(moveForeignRule(worksheet, 9, -1)).toEqual({
      ok: false,
      error: '定位不到该规则（可能已被删除）',
    })
  })

  it('索引空间与读取一致：Sheet 级与 UsedRange 级集合不同时，动的是 Sheet 级那条', () => {
    // 表格序号来自 Sheet 级读取（readForeignRules）；UsedRange 级只有 1 条。
    // 旧实现走 UsedRange 级 → 第 2 行点上移会定位不到 / 动错人。
    const sheetFirst = makeRule(1)
    const sheetSecond = makeRule(2)
    const usedRangeFirst = makeRule(1)
    const worksheet = makeWorksheet([sheetFirst, sheetSecond], [usedRangeFirst])

    const result = moveForeignRule(worksheet, 2, -1)

    expect(result).toEqual({ ok: true })
    expect(sheetSecond.Priority).toBe(1)
    expect(sheetFirst.Priority).toBe(2)
    // UsedRange 级那条没被碰
    expect(usedRangeFirst.Priority).toBe(1)
  })
})

describe('moveForeignRule：宿主不支持时的诚实失败', () => {
  it('Priority 读不到 → 明确错误，不猜值硬写', () => {
    const worksheet = makeWorksheet([makeThrowingRule(), makeThrowingRule()])
    expect(moveForeignRule(worksheet, 2, -1)).toEqual({
      ok: false,
      error: '当前 WPS 版本读不到规则优先级，无法调整顺序',
    })
  })

  it('写入被静默忽略（只读代理）→ 回读校验抓到，报「写入未生效」', () => {
    const worksheet = makeWorksheet([makeStubbornRule(1), makeStubbornRule(2)])
    expect(moveForeignRule(worksheet, 2, -1)).toEqual({
      ok: false,
      error: '当前 WPS 版本不支持逐格调整优先级（写入未生效）',
    })
  })

  it('赋值抛错 → 错误文案带上宿主原因', () => {
    const thrower = {
      get Priority(): number {
        return 2
      },
      set Priority(_next: number) {
        throw new Error('对象为只读')
      },
    }
    const worksheet = makeWorksheet([makeRule(1), thrower])
    expect(moveForeignRule(worksheet, 2, -1)).toEqual({
      ok: false,
      error: '调整失败：对象为只读',
    })
  })

  it('worksheet 为 null → 定位不到的错误，不抛异常', () => {
    expect(moveForeignRule(null, 1, -1)).toEqual({
      ok: false,
      error: '定位不到该规则（可能已被删除）',
    })
  })
})

describe('getForeignCondition', () => {
  it('Sheet 级优先，取到的是 Sheet 级集合的第 index 条', () => {
    const sheetSecond = makeRule(2)
    const usedRangeFirst = makeRule(1)
    const worksheet = makeWorksheet([makeRule(1), sheetSecond], [usedRangeFirst])
    expect(getForeignCondition(worksheet, 2)).toBe(sheetSecond)
  })

  it('Sheet 级没有 FormatConditions 时回退 UsedRange 级（老版本 WPS）', () => {
    const usedRangeSecond = makeRule(2)
    const worksheet = {
      UsedRange: {
        FormatConditions: {
          Count: 2,
          Item: (index: number) => (index === 2 ? usedRangeSecond : makeRule(1)),
        },
      },
    } as unknown as WpsWorksheet
    expect(getForeignCondition(worksheet, 2)).toBe(usedRangeSecond)
  })

  it('越界下标宿主返回 undefined → 收敛成 null', () => {
    const worksheet = makeWorksheet([makeRule(1)])
    expect(getForeignCondition(worksheet, 5)).toBeNull()
  })
})

// ===== 编辑 / 复制既有规则（2026-10-27 用户反馈：改了不生效、不能编辑和复制）=====

interface EditableRuleState {
  formula: string
  range: string
  fill: number
  font: number
  /** true = 公式赋值被宿主静默忽略（只读代理） */
  ignoreFormulaWrite?: boolean
  /** true = ModifyAppliesToRange 被静默忽略 */
  ignoreRangeWrite?: boolean
}

/**
 * 假规则：公式 / 范围 / 颜色都可读写，可按需模拟「接受写入但不生效」
 *
 * 颜色用数字（与宿主 Interior.Color 同口径），断言时按 hex 比对。
 *
 * ⚠️ `Interior` / `Font` 必须是**稳定的对象**（`Color` 带 getter/setter 回写 state）：
 * 早先写成 `get Interior() { return { Color: state.fill } }`，每次读都新建一个临时
 * 对象——`interior.Color = x` 改的是那个临时对象，state 一点没变，于是「改了颜色」
 * 的用例看起来通过、其实什么都没写。真机是 COM 代理，赋值确实落到规则上。
 */
function makeEditableRule(initial: EditableRuleState): {
  rule: Record<string, unknown>
  state: EditableRuleState
  withSpy: ReturnType<typeof vi.fn>
} {
  const state = { ...initial }
  const withSpy = vi.fn((options: { Interior?: { Color?: string | number } }) => {
    const color = options.Interior?.Color
    if (typeof color === 'number') state.fill = color
  })
  const interior = {
    get Color(): number {
      return state.fill
    },
    set Color(next: number) {
      state.fill = next
    },
  }
  const font = {
    get Color(): number {
      return state.font
    },
    set Color(next: number) {
      state.font = next
    },
    Bold: false,
  }
  const rule: Record<string, unknown> = {
    get Formula1(): string {
      return state.formula
    },
    set Formula1(next: string) {
      if (state.ignoreFormulaWrite !== true) state.formula = next
    },
    get AppliesTo(): { Address: string } {
      return { Address: state.range }
    },
    ModifyAppliesToRange(next: string): void {
      if (state.ignoreRangeWrite !== true) state.range = next
    },
    Interior: interior,
    Font: font,
    With: withSpy,
  }
  return { rule, state, withSpy }
}

describe('updateForeignRule：编辑既有规则（范围 / 公式 / 颜色）', () => {
  it('改公式：写入成功并回报改了哪项', () => {
    const { rule, state } = makeEditableRule({
      formula: '=$R3="26年10月"',
      range: 'B3:B100',
      fill: 0x00_00_ff,
      font: 0x00_00_00,
    })
    const worksheet = makeWorksheet([rule])

    const result = updateForeignRule(worksheet, 1, { formula: '=$R3="26年7月"' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.changed).toEqual(['公式'])
    expect(state.formula).toBe('=$R3="26年7月"')
  })

  it('宿主静默忽略公式写入 → 回读抓到，明确报错（不报假成功）', () => {
    const { rule } = makeEditableRule({
      formula: '=$R3="26年10月"',
      range: 'B3:B100',
      fill: 0,
      font: 0,
      ignoreFormulaWrite: true,
    })
    const worksheet = makeWorksheet([rule])

    const result = updateForeignRule(worksheet, 1, { formula: '=$R3="26年7月"' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('公式未写入')
  })

  it('改范围：ModifyAppliesToRange 生效后回读一致', () => {
    const { rule, state } = makeEditableRule({
      formula: '=$R3=""',
      range: 'B3:B100',
      fill: 0,
      font: 0,
    })
    const worksheet = makeWorksheet([rule])

    const result = updateForeignRule(worksheet, 1, { range: 'C3:C100' })

    expect(result.ok).toBe(true)
    expect(state.range).toBe('C3:C100')
  })

  it('范围写入被忽略 → 报「范围未写入」并带上宿主回读值', () => {
    const { rule } = makeEditableRule({
      formula: '=$R3=""',
      range: 'B3:B100',
      fill: 0,
      font: 0,
      ignoreRangeWrite: true,
    })
    const worksheet = makeWorksheet([rule])

    const result = updateForeignRule(worksheet, 1, { range: 'C3:C100' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('范围未写入')
      expect(result.error).toContain('B3:B100')
    }
  })

  it('改填充色：走 Interior 直接赋值（WPS 无 With），回读一致', () => {
    const { rule, state, withSpy } = makeEditableRule({
      formula: '=$R3=""',
      range: 'B3:B100',
      fill: 0,
      font: 0,
    })
    const worksheet = makeWorksheet([rule])

    const result = updateForeignRule(worksheet, 1, { interior: '#FF0000' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.changed).toEqual(['填充色'])
    // #FF0000 的 BGR 是 255（红通道在最低字节）
    expect(state.fill).toBe(255)
    expect(withSpy).not.toHaveBeenCalled()
  })

  it('改字体色 + 加粗：同样走 Interior / Font 直接赋值', () => {
    const { rule, state, withSpy } = makeEditableRule({
      formula: '=$R3=""',
      range: 'B3:B100',
      fill: 0,
      font: 0,
    })
    const worksheet = makeWorksheet([rule])

    const result = updateForeignRule(worksheet, 1, { fontColor: '#0000FF', fontBold: true })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.changed).toEqual(['字体色', '加粗'])
    // #0000FF 的 BGR 是 0xFF0000
    expect(state.font).toBe(16_711_680)
    expect((rule.Font as { Bold: boolean }).Bold).toBe(true)
    expect(withSpy).not.toHaveBeenCalled()
  })

  it('没有任何改动时明确失败（不发空写入）', () => {
    const { rule } = makeEditableRule({ formula: '=A1', range: 'A1:A9', fill: 0, font: 0 })
    const worksheet = makeWorksheet([rule])
    const result = updateForeignRule(worksheet, 1, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('没有任何改动')
  })

  it('规则不存在 → 明说定位不到，不抛异常', () => {
    const worksheet = makeWorksheet([])
    const result = updateForeignRule(worksheet, 3, { formula: '=A1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('定位不到')
  })
})

describe('duplicateForeignRule：复制成新规则', () => {
  it('复制到指定范围：条数 +1，公式与格式照搬', () => {
    const { rule } = makeEditableRule({ formula: '=$R3=""', range: 'B3:B100', fill: 0, font: 0 })
    const { worksheet, rules } = makeAddableWorksheet([rule])

    const result = duplicateForeignRule(worksheet, 1, 'C3:C100')

    expect(result).toEqual({ ok: true, range: 'C3:C100' })
    expect(rules).toHaveLength(2)
  })

  it('不传范围时复制到原范围', () => {
    const { rule } = makeEditableRule({ formula: '=$R3=""', range: 'B3:B100', fill: 0, font: 0 })
    const { worksheet } = makeAddableWorksheet([rule])
    const result = duplicateForeignRule(worksheet, 1)
    expect(result).toEqual({ ok: true, range: 'B3:B100' })
  })

  it('Add 返回对象但条数没涨 → 报「复制未生效」', () => {
    const { rule } = makeEditableRule({ formula: '=$R3=""', range: 'B3:B100', fill: 0, font: 0 })
    const { worksheet } = makeAddableWorksheet([rule], { swallowAdd: true })
    const result = duplicateForeignRule(worksheet, 1, 'C3:C100')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('复制未生效')
  })

  it('公式读不到（数据条 / 色阶等）→ 明确拒绝', () => {
    const { worksheet } = makeAddableWorksheet([{ Formula1: '', AppliesTo: { Address: 'A1:A9' } }])
    const result = duplicateForeignRule(worksheet, 1, 'B1:B9')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('无法复制')
  })
})

/**
 * 可清空工作表：集合带 `Delete()`（模拟真实 `FormatConditions.Delete` 清空整表）
 *
 * 与 {@link makeAddableWorksheet} 的区别就在这个 `Delete`：只有它能证明
 * 「merge 路径**没有**调清空」——假集合若没有 `Delete`，`clearConditions` 会走
 * 逐条删除的兜底分支，而假条目也没有 `Delete`，于是「清空了」和「没清空」
 * 在断言上长得一模一样（反向验证时真的骗过了用例，故补这个假体）。
 */
function makeClearableWorksheet(initial: unknown[]): {
  worksheet: WpsWorksheet
  rules: unknown[]
  clearAll: ReturnType<typeof vi.fn>
} {
  const rules = [...initial]
  const clearAll = vi.fn(() => {
    rules.length = 0
  })
  const add = (condition: { Formula1?: string }): Record<string, unknown> => {
    const created = makeHostCondition(condition.Formula1 ?? '')
    rules.push(created)
    return created
  }
  const worksheet = {
    FormatConditions: {
      get Count(): number {
        return rules.length
      },
      Item: (index: number) => rules[index - 1],
      Add: add,
      Delete: clearAll,
    },
    Range: () => ({ FormatConditions: { Add: add } }),
  } as unknown as WpsWorksheet
  return { worksheet, rules, clearAll }
}

/** 造一个最小可用的 plugin 计划项 */
function pluginEntry(
  id: string,
  appliesTo = 'B3:B100',
  formula = '=$R3=""',
): ConditionalFormatApplyEntry {
  return { rule: { id, name: id, group: '高亮', appliesTo, formula, interior: '#00B050' } }
}

/** 空计划（各用例只覆盖自己关心的字段） */
function planOf(overrides: Partial<ConditionalFormatApplyPlan>): ConditionalFormatApplyPlan {
  return {
    entries: [],
    refreshes: [],
    deletions: [],
    clearAll: false,
    discarded: [],
    warnings: [],
    ...overrides,
  }
}

describe('applyConditionalFormatPlan：应用链路', () => {
  it('只有 Sheet 级集合也能写入，并回读实际条数', () => {
    const { worksheet, rules } = makeSheetLevelWorksheet()
    const result = applyConditionalFormatPlan(worksheet, planOf({ entries: [pluginEntry('r1')] }))

    expect(result.added).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.verified).toBe(1)
    expect(result.missing).toEqual([])
    expect(rules).toHaveLength(1)
  })

  it('宿主不支持 Add → added 0、verified -1、全部记为 missing', () => {
    const result = applyConditionalFormatPlan(
      {} as unknown as WpsWorksheet,
      planOf({ entries: [pluginEntry('r1')] }),
    )
    expect(result).toMatchObject({ added: 0, failed: 1, verified: -1, missing: ['r1'] })
  })

  it('**merge 不清除既有规则**：表上已有 3 条别人的规则，应用后仍是 3 + 1 条', () => {
    const others = [
      { Formula1: '=$A1=1', AppliesTo: { Address: 'A1:A9' } },
      { Formula1: '=$B1=1', AppliesTo: { Address: 'B1:B9' } },
      { Formula1: '=$C1=1', AppliesTo: { Address: 'C1:C9' } },
    ]
    const { worksheet, rules, clearAll } = makeClearableWorksheet(others)
    const result = applyConditionalFormatPlan(worksheet, planOf({ entries: [pluginEntry('r1')] }))
    expect(result.added).toBe(1)
    expect(result.deleted).toBe(0)
    // 关键：清空接口一次都没被调（旧实现第一步就无条件调它）
    expect(clearAll).not.toHaveBeenCalled()
    expect(rules).toHaveLength(4)
    // 别人的三条原样还在
    expect(rules.slice(0, 3)).toEqual(others)
  })

  it('表上已有同「范围 + 公式」→ 只刷新格式，不重复 Add', () => {
    const fill = { Color: 0 }
    const withSpy = vi.fn()
    const existing = {
      Formula1: '$R3=""',
      AppliesTo: { Address: 'B3:B100' },
      Interior: fill,
      Font: { Color: 0, Bold: false },
      With: withSpy,
    }
    const { worksheet, rules } = makeAddableWorksheet([existing])
    const result = applyConditionalFormatPlan(
      worksheet,
      planOf({
        refreshes: [
          {
            id: 'r1',
            name: 'r1',
            group: 'G',
            appliesTo: 'B3:B100',
            formula: '=$R3=""',
            interior: '#123456',
          },
        ],
      }),
    )
    expect(result.added).toBe(0)
    expect(result.refreshed).toBe(1)
    expect(rules).toHaveLength(1)
    // 走 Interior 直接赋值，颜色是 BGR 整数（#123456 → 0x563412）
    expect(fill.Color).toBe(5_649_426)
    // 回归钉：宿主同时提供 With 时也**不许**走它（WPS 上 With 根本不存在）
    expect(withSpy).not.toHaveBeenCalled()
  })

  it('deletions 只删账本里指定指纹的那一条，别的规则原样保留', () => {
    const keep = { Formula1: '=$A1=1', AppliesTo: { Address: 'A1:A9' } }
    const drop = { Formula1: '=$R3=9', AppliesTo: { Address: 'C3:C100' }, Delete: vi.fn() }
    const { worksheet } = makeAddableWorksheet([keep, drop])
    const result = applyConditionalFormatPlan(
      worksheet,
      planOf({ deletions: [{ range: 'C3:C100', formula: '=$R3=9' }] }),
    )
    expect(result.deleted).toBe(1)
    expect(drop.Delete).toHaveBeenCalledTimes(1)
  })

  it('clearAll = true 时才清空整表', () => {
    const { worksheet, rules, clearAll } = makeClearableWorksheet([
      { Formula1: '=$A1=1', AppliesTo: { Address: 'A1:A9' } },
    ])
    const result = applyConditionalFormatPlan(
      worksheet,
      planOf({ entries: [pluginEntry('r1')], clearAll: true }),
    )
    expect(result.added).toBe(1)
    expect(result.deleted).toBe(0)
    expect(clearAll).toHaveBeenCalledTimes(1)
    // 清空后只剩新加的那一条
    expect(rules).toHaveLength(1)
  })

  it('写进去但回读不到 → missing 指出具体规则名（「规则应用不上去」的判据）', () => {
    const { worksheet } = makeAddableWorksheet([], { swallowAdd: true })
    const result = applyConditionalFormatPlan(
      worksheet,
      planOf({ entries: [pluginEntry('当前季高亮')] }),
    )
    expect(result.added).toBe(1)
    expect(result.verified).toBe(0)
    expect(result.missing).toEqual(['当前季高亮'])
  })

  it('空计划不炸、不清空', () => {
    const other = { Formula1: '=$A1=1', AppliesTo: { Address: 'A1:A9' } }
    const { worksheet, rules } = makeAddableWorksheet([other])
    const result = applyConditionalFormatPlan(worksheet, planOf({}))
    expect(result).toMatchObject({ added: 0, refreshed: 0, deleted: 0, failed: 0, verified: 1 })
    expect(rules).toHaveLength(1)
  })
})

// ===== 颜色编码：规则库的 '#RRGGBB' ↔ 宿主的 BGR 整数 =====

describe('rgbHexToBgr / bgrToRgbHex：BGR 而不是 RGB', () => {
  it('#FF0000（红）→ 255：红通道落在最低字节（真机实测 直接赋 255 回读 255）', () => {
    expect(rgbHexToBgr('#FF0000')).toBe(255)
  })

  it('#0000FF（蓝）→ 0xFF0000：若按 RGB 直传会变成红，这条钉死排列顺序', () => {
    expect(rgbHexToBgr('#0000FF')).toBe(16_711_680)
  })

  it('项目主色 #00B050 → 0x50B000', () => {
    expect(rgbHexToBgr('#00B050')).toBe(0x50_b0_00)
  })

  it('不带 # / 小写 / 三位简写都收', () => {
    expect(rgbHexToBgr('00B050')).toBe(0x50_b0_00)
    expect(rgbHexToBgr('#00b050')).toBe(0x50_b0_00)
    expect(rgbHexToBgr('#F00')).toBe(255)
  })

  it('非法颜色抛错并带上原值（不静默给个黑）', () => {
    expect(() => rgbHexToBgr('#GGGGGG')).toThrow(/颜色格式不合法/u)
    expect(() => rgbHexToBgr('#GGGGGG')).toThrow(/#GGGGGG/u)
    expect(() => rgbHexToBgr('')).toThrow(/颜色格式不合法/u)
  })

  it('互逆：往返一圈回到原值', () => {
    for (const hex of ['#000000', '#FFFFFF', '#FF0000', '#00B050', '#123456']) {
      expect(bgrToRgbHex(rgbHexToBgr(hex))).toBe(hex)
    }
  })

  it('回读方向：#FF0000 不会被印成 #0000FF（旧实现把 BGR 当 RGB 打印）', () => {
    expect(bgrToRgbHex(255)).toBe('#FF0000')
  })
})

// ===== WPS「相对行 +1」偏移的抵消 =====

describe('shiftRelativeRows：只平移相对行', () => {
  it('相对行跟着 delta 走', () => {
    expect(shiftRelativeRows('=$B2>8', -1)).toBe('=$B1>8')
    expect(shiftRelativeRows('=$B2>8', 3)).toBe('=$B5>8')
  })

  it('绝对行 $B$2 原样不动（真机实测它本来就不偏移）', () => {
    expect(shiftRelativeRows('=$B$2>8', -1)).toBe('=$B$2>8')
  })

  it('绝对列 + 相对行（$C3）：只动行', () => {
    expect(shiftRelativeRows('=$B2>$C3', -1)).toBe('=$B1>$C2')
  })

  it('相对列 + 绝对行（C$3）：行绝对，一行都不动', () => {
    expect(shiftRelativeRows('=$B2>C$3', -1)).toBe('=$B1>C$3')
  })

  it('delta 为 0 时原样返回（连字符串都不重建）', () => {
    const formula = '=$B2>8'
    expect(shiftRelativeRows(formula, 0)).toBe(formula)
  })

  it('字符串字面量里的「字母+数字」不当引用（"B2" 不是单元格）', () => {
    expect(shiftRelativeRows('=$A2="B2"', -1)).toBe('=$A1="B2"')
    expect(shiftRelativeRows('=$A5="R3C4"', -1)).toBe('=$A4="R3C4"')
  })

  it('函数名不当引用（LOG10 不是单元格 LOG10）', () => {
    expect(shiftRelativeRows('=LOG10(A2)>1', -1)).toBe('=LOG10(A1)>1')
  })

  it('平移后行号 < 1 的原样保留（不生成 B0 这种非法引用）', () => {
    expect(shiftRelativeRows('=$B1>0', -1)).toBe('=$B1>0')
    expect(shiftRelativeRows('=$B2>0', -2)).toBe('=$B2>0')
  })

  it('整列引用（无行号）不受影响', () => {
    expect(shiftRelativeRows('=COUNTIF($B:$B,1)>0', -1)).toBe('=COUNTIF($B:$B,1)>0')
  })
})

/**
 * 独立的「宿主行为」实现：把公式里的「字母+数字」一律 +1
 *
 * 故意不复用被测的 `shiftRelativeRows` 来冒充宿主——两边一起错也能对上，等于没测。
 * 足够朴素（连 `$` 都不认），但足以模拟真机 WPS 的 `FormatConditions.Add` 偏移。
 */
function wpsShiftRelativeRows(formula: string): string {
  return formula.replace(
    /([A-Z]+)(\d+)/gu,
    (_match, column: string, row: string) => `${column}${String(Number(row) + 1)}`,
  )
}

/**
 * 真机形态回归（2026-10-24 用户宏实测）
 *
 * 两个 bug 都只有在「假体照真机形态建」时才会暴露：
 * 1. `FormatCondition` 没有 `With` → 填充色一次都没写进去；
 * 2. `FormatConditions.Add({ Formula1 })` 会把相对行 +1 → B3 用 B4 的值判断。
 */
describe('applyConditionalFormatPlan：真机形态回归', () => {
  it('宿主只有 Interior / Font（无 With）→ 填充色与字体都写进去', () => {
    const { worksheet, rules } = makeAddableWorksheet([])
    const result = applyConditionalFormatPlan(
      worksheet,
      planOf({
        entries: [
          {
            rule: {
              id: 'r1',
              name: 'r1',
              group: 'G',
              appliesTo: 'B2:B100',
              formula: '=$B2>8',
              interior: '#00B050',
              fontColor: '#FF0000',
              fontBold: true,
            },
          },
        ],
      }),
    )

    expect(result).toMatchObject({ added: 1, failed: 0, missing: [] })
    const created = rules[0] as {
      Interior: { Color: number }
      Font: { Color: number; Bold: boolean }
    }
    expect(created.Interior.Color).toBe(rgbHexToBgr('#00B050'))
    expect(created.Font.Color).toBe(255)
    expect(created.Font.Bold).toBe(true)
  })

  it('宿主既无 Interior 也无 With → 记进 failures 并带上原因，不静默成功', () => {
    const rules: unknown[] = []
    // 故意造一个「Add 成功、但返回对象没有任何格式入口」的宿主
    const add = (condition: { Formula1?: string }): Record<string, unknown> => {
      const created = { Formula1: condition.Formula1 }
      rules.push(created)
      return created
    }
    const worksheet = {
      FormatConditions: {
        get Count(): number {
          return rules.length
        },
        Item: (index: number) => rules[index - 1],
        Add: add,
      },
      Range: () => ({ FormatConditions: { Add: add } }),
    } as unknown as WpsWorksheet

    const result = applyConditionalFormatPlan(worksheet, planOf({ entries: [pluginEntry('r1')] }))

    expect(result.added).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.reason).toContain('无法设置格式')
  })

  it('WPS 的相对行 +1 被抵消：最终只剩 1 条，公式与规则库一致', () => {
    const rules: Record<string, unknown>[] = []
    const add = (condition: { Formula1?: string }): Record<string, unknown> => {
      const created: Record<string, unknown> = {
        Formula1: wpsShiftRelativeRows(condition.Formula1 ?? ''),
        Interior: { Color: 0 },
        Font: { Color: 0, Bold: false },
        Delete: () => {
          const index = rules.indexOf(created)
          if (index !== -1) rules.splice(index, 1)
        },
      }
      rules.push(created)
      return created
    }
    const worksheet = {
      FormatConditions: {
        get Count(): number {
          return rules.length
        },
        Item: (index: number) => rules[index - 1],
        Add: add,
      },
      Range: () => ({ FormatConditions: { Add: add } }),
    } as unknown as WpsWorksheet

    const result = applyConditionalFormatPlan(
      worksheet,
      planOf({ entries: [pluginEntry('r1', 'B2:B100', '=$B2>8')] }),
    )

    // 只留补偿后的那一条（第一次 Add 的那条被删掉了，不会「越点越多」）
    expect(rules).toHaveLength(1)
    expect(rules[0]?.Formula1).toBe('=$B2>8')
    expect(result).toMatchObject({ added: 1, failed: 0, missing: [] })
  })

  it('宿主不暴露 Formula1（读回空串）→ 不猜偏移，不重复 Add', () => {
    const rules: unknown[] = []
    const add = (): Record<string, unknown> => {
      const created = { Interior: { Color: 0 } }
      rules.push(created)
      return created
    }
    const worksheet = {
      FormatConditions: {
        get Count(): number {
          return rules.length
        },
        Item: (index: number) => rules[index - 1],
        Add: add,
      },
      Range: () => ({ FormatConditions: { Add: add } }),
    } as unknown as WpsWorksheet

    applyConditionalFormatPlan(worksheet, planOf({ entries: [pluginEntry('r1')] }))

    // 读不到公式时硬套 -1 会把本来正确的公式改错，故原样保留
    expect(rules).toHaveLength(1)
  })
})
