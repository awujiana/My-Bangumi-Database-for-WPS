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
 * 6. 既有规则分组的维护：重命名按**组名**整组换、解散只清映射不动规则，
 *    非法入参一律返回 null（调用方 toast，不静默成功）
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
  dissolveGroupMapping,
  filterRules,
  firstRowOfRange,
  groupRules,
  normalizeHexColor,
  parseExistingGroups,
  parseRules,
  renameGroupMapping,
  serializeExistingGroups,
  snapshotGroupKey,
  autoClusterGroups,
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

describe('normalizeHexColor', () => {
  it('6 位：补 # 并统一大写', () => {
    expect(normalizeHexColor('00b050')).toBe('#00B050')
    expect(normalizeHexColor('#00b050')).toBe('#00B050')
    expect(normalizeHexColor('  #00B050  ')).toBe('#00B050')
  })

  it('3 位简写展开为 6 位', () => {
    expect(normalizeHexColor('0f0')).toBe('#00FF00')
    expect(normalizeHexColor('#abc')).toBe('#AABBCC')
  })

  it('非法输入返回 null（不把脏值写进规则库）', () => {
    expect(normalizeHexColor('')).toBeNull()
    expect(normalizeHexColor('xyz')).toBeNull()
    expect(normalizeHexColor('#12345')).toBeNull()
    expect(normalizeHexColor('#1234567')).toBeNull()
  })
})

const snap = (range: string, formula: string): ForeignRuleSnapshot => ({
  range,
  formula,
  kind: 'expression',
})

describe('snapshotGroupKey / parseExistingGroups', () => {
  it('键只看公式 + 范围内容，与序号无关', () => {
    expect(snapshotGroupKey(snap('J2:J9', '=$J2="饮品"'))).toBe(
      snapshotGroupKey(snap('J2:J9', '=$J2="饮品"')),
    )
    expect(snapshotGroupKey(snap('J2:J9', '=$J2="饮品"'))).not.toBe(
      snapshotGroupKey(snap('J2:J9', '=$J2="大区"')),
    )
  })

  it('公式含空格不串键（NUL 分隔）', () => {
    expect(snapshotGroupKey(snap('A1', '=IF(A1="x", 1, 2)'))).not.toBe(
      snapshotGroupKey(snap('1, 2)', '=IF(A1="x"')),
    )
  })

  it('parseExistingGroups：坏 JSON / 数组 / 空组名都安全收敛', () => {
    expect(parseExistingGroups('')).toEqual({})
    expect(parseExistingGroups('{')).toEqual({})
    expect(parseExistingGroups('[]')).toEqual({})
    expect(parseExistingGroups('{"a":"x","b":"","c":3}')).toEqual({ a: 'x' })
  })

  it('serialize / parse 往返一致', () => {
    const groups = { k1: '饮品', k2: '大区' }
    expect(parseExistingGroups(serializeExistingGroups(groups))).toEqual(groups)
  })
})

describe('autoClusterGroups', () => {
  it('同模式公式聚成同组、不同模式分开', () => {
    const groups = autoClusterGroups([
      { range: 'J2:J9', formula: '=$J2="饮品"', kind: 'expression' },
      { range: 'J2:J9', formula: '=$J2="大区"', kind: 'expression' },
      { range: 'K2:K9', formula: '=$K2<>""', kind: 'expression' },
    ])
    const values = Object.values(groups)
    expect(values).toHaveLength(3)
    expect(values[0]).toBe(values[1])
    expect(values[0]).toBe('=$J2="*"')
    expect(values[2]).toBe('=$K2<>"*"')
  })

  it('数字不归一：行锚与比较值保持原样', () => {
    const groups = autoClusterGroups([
      { range: 'A1', formula: '=$A1>100', kind: 'expression' },
      { range: 'A1', formula: '=$A1>200', kind: 'expression' },
    ])
    const values = Object.values(groups)
    expect(values[0]).not.toBe(values[1])
    expect(values[0]).toBe('=$A1>100')
  })

  it('空公式不聚类', () => {
    expect(autoClusterGroups([{ range: 'A1', formula: '', kind: 'expression' }])).toEqual({})
  })
})

// ========== 既有规则分组的维护（renameGroupMapping / dissolveGroupMapping）==========

describe('renameGroupMapping', () => {
  it('按组名把组内全部规则换成新组名，其它组不动', () => {
    const groups = { k1: '饮品', k2: '饮品', k3: '大区' }
    expect(renameGroupMapping(groups, '饮品', '食品')).toEqual({
      k1: '食品',
      k2: '食品',
      k3: '大区',
    })
  })

  it('不改入参：页面层整体替换 state 再持久化，旧对象必须原样', () => {
    const groups = { k1: '饮品' }
    renameGroupMapping(groups, '饮品', '食品')
    expect(groups).toEqual({ k1: '饮品' })
  })

  it('旧组名不存在 / 新名为空 / 新旧同名都返回 null（不静默成功）', () => {
    const groups = { k1: '饮品' }
    expect(renameGroupMapping(groups, '不存在', 'whatever')).toBeNull()
    expect(renameGroupMapping(groups, '饮品', '')).toBeNull()
    expect(renameGroupMapping(groups, '饮品', '饮品')).toBeNull()
  })
})

describe('dissolveGroupMapping', () => {
  it('删掉该组全部条目、其它组原样', () => {
    const groups = { k1: '饮品', k2: '饮品', k3: '大区' }
    expect(dissolveGroupMapping(groups, '饮品')).toEqual({ k3: '大区' })
  })

  it('组名不存在返回 null（调用方 toast，不假装解散了）', () => {
    expect(dissolveGroupMapping({ k1: '饮品' }, '不存在')).toBeNull()
  })

  it('解散最后一个组得到空映射（回到平铺视图）', () => {
    expect(dissolveGroupMapping({ k1: '饮品' }, '饮品')).toEqual({})
  })
})
