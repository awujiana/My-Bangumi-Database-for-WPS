// @vitest-environment node
/**
 * @fileoverview `ts/panel/conditional-format-rules.ts` 条件格式规则引擎单测（纯函数，Node 直跑）
 *
 * 守住的东西：
 * 1. 默认规则集的形状与顺序（当前季最优先 → 错误标红 → 四季分色）
 * 2. 自维护季节公式（TODAY 驱动、12 月跨年、两位年）——不用插件重跑就随季度演化
 * 3. 双策略应用计划：append-after 保留公式类手工规则前置；含不可重建类型时
 *    **降级清空并在 warnings 说明**（不静默丢数据）
 * 4. Store 存取：坏行跳过不致命；隐藏规则不进应用计划
 * 5. 公式行号平移不误伤字符串字面量（"26年10月" / TEXT "00"）
 */

import { describe, expect, it } from 'vitest'

import {
  CONDITIONAL_FORMAT_GROUP_HIGHLIGHT,
  CONDITIONAL_FORMAT_GROUP_QUALITY,
  COLOR_CURRENT_SEASON,
  COLOR_ERROR_FILL,
  buildCurrentSeasonExpression,
  buildDefaultRules,
  buildErrorFormula,
  buildSeasonFormula,
  filterRules,
  firstRowOfRange,
  groupRules,
  parseRules,
  planApply,
  serializeRules,
  shiftFormulaRows,
} from '../ts/panel/conditional-format-rules.js'
import type {
  ConditionalFormatRule,
  ForeignRuleSnapshot,
} from '../ts/panel/conditional-format-rules.js'

// ========== 公式构建 ==========

describe('buildCurrentSeasonExpression：自维护当前季表达式', () => {
  it('含 LOOKUP 季度表、12 月跨年、两位年输出', () => {
    const expression = buildCurrentSeasonExpression()
    expect(expression).toContain(
      'LOOKUP(MONTH(TODAY()),{1,2,3,4,5,6,7,8,9,10,11,12},{1,1,4,4,4,7,7,7,10,10,10,1})',
    )
    expect(expression).toContain('IF(MONTH(TODAY())=12,1,0)')
    expect(expression).toContain('TEXT(MOD(')
    expect(expression).toContain('"00"')
  })

  it('输出形态为 「YY年M月」（与数据页公式列一致）', () => {
    // 表达式拼出来是 TEXT(...)&"年"&LOOKUP(...)&"月"
    expect(buildCurrentSeasonExpression()).toMatch(/&"年"&/)
    expect(buildCurrentSeasonExpression()).toMatch(/&"月"$/)
  })
})

describe('buildErrorFormula / buildSeasonFormula', () => {
  it('错误公式精确匹配公式列的报错文本', () => {
    expect(buildErrorFormula('R', 3)).toBe('=$R3="日期格式错误"')
  })

  it('季节公式取「年」之后的月令牌比较（10 月/1 月不混淆）', () => {
    const formula = buildSeasonFormula('R', 3, '10月')
    expect(formula).toBe('=IFERROR(MID($R3,FIND("年",$R3)+1,10),"")="10月"')
    expect(buildSeasonFormula('R', 3, '1月')).toContain('="1月"')
  })
})

describe('shiftFormulaRows：公式行号平移', () => {
  it('列字母+行号模式按增量平移（$R3 → $R13）', () => {
    expect(shiftFormulaRows('=$R3="26年10月"', 10)).toBe('=$R13="26年10月"')
  })

  it('不误伤字符串字面量里的数字（"26年10月" / TEXT "00"）', () => {
    const formula = '=$R3=TEXT(MOD(YEAR(TODAY()),100),"00")&"年"&10&"月"'
    expect(shiftFormulaRows(formula, 7)).toBe(
      '=$R10=TEXT(MOD(YEAR(TODAY()),100),"00")&"年"&10&"月"',
    )
  })

  it('delta 为 0 原样返回；平移后行号 <1 时该引用不动', () => {
    expect(shiftFormulaRows('=$R3=1', 0)).toBe('=$R3=1')
    expect(shiftFormulaRows('=$R2=1', -5)).toBe('=$R2=1')
  })
})

// ========== 默认规则集 ==========

describe('buildDefaultRules：六条默认规则', () => {
  const ids = (() => {
    let n = 0
    return () => {
      n += 1
      return `id-${String(n)}`
    }
  })()

  const rules = buildDefaultRules({ seasonColumn: 'R', nameColumn: 'B', firstRow: 3, makeId: ids })

  it('共 6 条：当前季 / 错误 / 四季各一', () => {
    expect(rules).toHaveLength(6)
    expect(rules.map((r) => r.name)).toEqual([
      '当前季高亮',
      '日期格式错误',
      '1月季',
      '4月季',
      '7月季',
      '10月季',
    ])
  })

  it('数组顺序即优先级：当前季压过四季色，错误标红次之', () => {
    expect(rules[0]?.group).toBe(CONDITIONAL_FORMAT_GROUP_HIGHLIGHT)
    expect(rules[1]?.group).toBe(CONDITIONAL_FORMAT_GROUP_QUALITY)
    // 当前季公式用自维护 TODAY 表达式（跨季度无需改规则）
    expect(rules[0]?.formula).toBe(`=$R3=${buildCurrentSeasonExpression()}`)
    expect(rules[0]?.interior).toBe(COLOR_CURRENT_SEASON)
    expect(rules[1]?.interior).toBe(COLOR_ERROR_FILL)
    expect(rules[1]?.fontColor).toBe('#9C0006')
  })

  it('范围锚定名称列、首行即公式锚点行', () => {
    for (const rule of rules) {
      expect(rule.appliesTo).toBe('B3:B1048576')
      expect(rule.formula).toContain('$R3')
    }
  })

  it('四季色互不相同且都是浅填充（# 开头六位）', () => {
    const fills = rules.slice(2).map((r) => r.interior)
    expect(new Set(fills).size).toBe(4)
    for (const fill of fills) expect(fill).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('id 由注入的生成器分配（不依赖运行时）', () => {
    expect(rules.map((r) => r.id)).toEqual(['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6'])
  })
})

// ========== Store 存取 ==========

describe('serializeRules / parseRules', () => {
  const sample: ConditionalFormatRule[] = [
    {
      id: 'a',
      name: '当前季高亮',
      group: '番剧高亮',
      appliesTo: 'B3:B100',
      formula: '=$R3=1',
      interior: '#00B050',
      fontColor: '#000000',
      fontBold: true,
      hidden: false,
    },
    {
      id: 'b',
      name: '错误',
      group: '数据质量',
      appliesTo: 'B3:B100',
      formula: '=$R3="日期格式错误"',
      interior: '#FFC7CE',
    },
  ]

  it(' round-trip 无损（含可选字段与顺序）', () => {
    expect(parseRules(serializeRules(sample))).toEqual({ rules: sample, dropped: 0 })
  })

  it('坏行跳过不致命、计数进 dropped', () => {
    const text = JSON.stringify([...sample, { id: 'x' }, null, 'nope', { ...sample[0], id: 42 }])
    const { rules, dropped } = parseRules(text)
    expect(rules).toEqual(sample)
    expect(dropped).toBe(4)
  })

  it('空文本 / 非数组 / 非法 JSON 都是空规则集', () => {
    expect(parseRules('')).toEqual({ rules: [], dropped: 0 })
    expect(parseRules('{"not":"array"}')).toEqual({ rules: [], dropped: 1 })
    expect(parseRules('{oops')).toEqual({ rules: [], dropped: 1 })
  })
})

// ========== 搜索 / 分组 ==========

describe('filterRules', () => {
  const rules: ConditionalFormatRule[] = [
    {
      id: '1',
      name: '当前季高亮',
      group: '番剧高亮',
      appliesTo: 'B3:B100',
      formula: '=$R3="26年10月"',
      interior: '#00B050',
    },
    {
      id: '2',
      name: '日期格式错误',
      group: '数据质量',
      appliesTo: 'C3:C100',
      formula: '=$R3="日期格式错误"',
      interior: '#FFC7CE',
    },
  ]

  it('空查询返回全部（新数组，不改原序）', () => {
    expect(filterRules(rules, '  ')).toEqual(rules)
  })

  it('命中名称 / 公式 / 范围 / 分组，大小写不敏感', () => {
    expect(filterRules(rules, '当前季').map((r) => r.id)).toEqual(['1'])
    expect(filterRules(rules, '日期格式错误').map((r) => r.id)).toEqual(['2'])
    expect(filterRules(rules, 'c3').map((r) => r.id)).toEqual(['2'])
    expect(filterRules(rules, '数据质量').map((r) => r.id)).toEqual(['2'])
  })

  it('无命中返回空', () => {
    expect(filterRules(rules, '不存在的关键词')).toEqual([])
  })
})

describe('groupRules', () => {
  it('保持组内顺序与组的首现顺序', () => {
    const rules: ConditionalFormatRule[] = [
      { id: '1', name: 'a', group: 'G1', appliesTo: 'B:B', formula: '=1', interior: '#000' },
      { id: '2', name: 'b', group: 'G2', appliesTo: 'B:B', formula: '=1', interior: '#000' },
      { id: '3', name: 'c', group: 'G1', appliesTo: 'B:B', formula: '=1', interior: '#000' },
    ]
    expect(groupRules(rules)).toEqual([
      ['G1', [rules[0], rules[2]]],
      ['G2', [rules[1]]],
    ])
  })
})

// ========== 应用计划（双策略）==========

describe('planApply：双策略', () => {
  const pluginRules: ConditionalFormatRule[] = [
    {
      id: 'p1',
      name: '当前季高亮',
      group: '番剧高亮',
      appliesTo: 'B3:B100',
      formula: '=$R3=1',
      interior: '#00B050',
    },
    {
      id: 'p2',
      name: '隐藏规则',
      group: '番剧高亮',
      appliesTo: 'B3:B100',
      formula: '=$R3=2',
      interior: '#000',
      hidden: true,
    },
    {
      id: 'p3',
      name: '1月季',
      group: '番剧高亮',
      appliesTo: 'B3:B100',
      formula: '=$R3=3',
      interior: '#BDD7EE',
    },
  ]

  const foreign: ForeignRuleSnapshot[] = [
    {
      range: 'B3:B100',
      formula: '=$R3>5',
      kind: 'expression',
      interior: '#123456',
      fontColor: '#ABCDEF',
    },
  ]

  it('clear-all 无手工规则：只写可见插件规则，无警告', () => {
    const plan = planApply(pluginRules, [], 'clear-all')
    expect(
      plan.entries.map((entry) => (entry.source === 'plugin' ? entry.rule.id : 'foreign')),
    ).toEqual(['p1', 'p3'])
    expect(plan.discarded).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it('clear-all 有手工规则：进 discarded 供确认框列出 + 警告报数', () => {
    const plan = planApply(pluginRules, foreign, 'clear-all')
    expect(plan.discarded).toEqual(foreign)
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toContain('1 条手工规则')
    expect(plan.entries).toHaveLength(2)
  })

  it('append-after 公式类手工规则：原样重建在前（保原优先序），插件置后', () => {
    const plan = planApply(pluginRules, foreign, 'append-after')
    expect(plan.discarded).toEqual([])
    expect(plan.warnings).toEqual([])
    expect(plan.entries).toHaveLength(3)
    expect(plan.entries[0]).toEqual({
      source: 'foreign',
      range: 'B3:B100',
      formula: '=$R3>5',
      interior: '#123456',
      fontColor: '#ABCDEF',
    })
    expect(plan.entries[1]).toMatchObject({ source: 'plugin' })
    expect(plan.entries[2]).toMatchObject({ source: 'plugin' })
  })

  it('append-after 含不可重建类型：降级清空，全部进 discarded + 警告说明', () => {
    const mixed: ForeignRuleSnapshot[] = [
      { range: 'B3:B100', formula: '=$R3>5', kind: 'expression' },
      { range: 'C3:C100', formula: '', kind: 'other' },
    ]
    const plan = planApply(pluginRules, mixed, 'append-after')
    expect(plan.discarded).toHaveLength(2)
    expect(plan.entries.every((entry) => entry.source === 'plugin')).toBe(true)
    expect(plan.warnings[0]).toContain('1 条手工规则的类型不支持保留')
  })

  it('隐藏规则两种策略都不进应用计划', () => {
    for (const strategy of ['clear-all', 'append-after'] as const) {
      const plan = planApply(pluginRules, [], strategy)
      expect(
        plan.entries.some((entry) => entry.source === 'plugin' && entry.rule.id === 'p2'),
      ).toBe(false)
    }
  })

  it('多条外来规则按读取顺序重建（priority = 数组序）', () => {
    const many: ForeignRuleSnapshot[] = [
      { range: 'B3:B100', formula: '=1', kind: 'expression' },
      { range: 'C3:C100', formula: '=2', kind: 'expression' },
    ]
    const plan = planApply(pluginRules, many, 'append-after')
    expect(
      plan.entries.slice(0, 2).map((entry) => (entry.source === 'foreign' ? entry.formula : '')),
    ).toEqual(['=1', '=2'])
  })
})

describe('firstRowOfRange：范围首行号', () => {
  it('取首段行号', () => {
    expect(firstRowOfRange('B3:B1048576')).toBe(3)
    expect(firstRowOfRange('C10:C100')).toBe(10)
    expect(firstRowOfRange('AA2:AA99')).toBe(2)
  })

  it('单格与异常输入回 1', () => {
    expect(firstRowOfRange('B5')).toBe(5)
    expect(firstRowOfRange('')).toBe(1)
    expect(firstRowOfRange('abc')).toBe(1)
  })
})
