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

import { getForeignCondition, moveForeignRule } from '../ts/panel/conditional-format-apply.js'
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
