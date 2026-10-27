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
  duplicateForeignRule,
  getForeignCondition,
  moveForeignRule,
  updateForeignRule,
} from '../ts/panel/conditional-format-apply.js'
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

/** 可写工作表：Add 会真的往集合里加一条（Count 可观测；`swallowAdd` 模拟静默丢弃） */
function makeAddableWorksheet(
  initial: unknown[],
  options: { swallowAdd?: boolean } = {},
): { worksheet: WpsWorksheet; rules: unknown[] } {
  const rules = [...initial]
  const add = (condition: { Formula1?: string }): Record<string, unknown> => {
    const created = { Formula1: condition.Formula1, With: vi.fn() }
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
    const created = { Formula1: condition.Formula1, With: vi.fn() }
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
 */
function makeEditableRule(initial: EditableRuleState): {
  rule: Record<string, unknown>
  state: EditableRuleState
} {
  const state = { ...initial }
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
    get Interior(): { Color: number } {
      return { Color: state.fill }
    },
    get Font(): { Color: number } {
      return { Color: state.font }
    },
    With: vi.fn((options: { Interior?: { Color?: string | number } }) => {
      const color = options.Interior?.Color
      if (typeof color === 'number') state.fill = color
    }),
  }
  return { rule, state }
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

describe('applyConditionalFormatPlan：应用链路', () => {
  it('只有 Sheet 级集合也能写入，并回读实际条数', () => {
    const { worksheet, rules } = makeSheetLevelWorksheet()
    const result = applyConditionalFormatPlan(worksheet, {
      entries: [
        {
          source: 'plugin',
          rule: {
            id: 'r1',
            name: '测试',
            group: '高亮',
            appliesTo: 'B3:B100',
            formula: '=$R3=""',
            interior: '#00B050',
          },
        },
      ],
      discarded: [],
      warnings: [],
    })

    expect(result.added).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.verified).toBe(1)
    expect(rules).toHaveLength(1)
  })

  it('宿主不支持 Add → added 0、verified -1（页面据此报「写不进去」而不是「已写入 0 条」）', () => {
    const result = applyConditionalFormatPlan({} as unknown as WpsWorksheet, {
      entries: [],
      discarded: [],
      warnings: [],
    })
    expect(result).toEqual({ added: 0, failed: 0, verified: -1 })
  })
})
