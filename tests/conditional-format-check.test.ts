/**
 * @fileoverview `ts/panel/conditional-format-check.ts` 单测（纯函数）
 *
 * 守的是「导入 / 应用前这道闸门」本身。起因：一条 `导入 B2:B50001` 报
 * 「没写进工作表」，而当时没有任何前置检查 —— 规则带着非法范围进了库，
 * 直到 COM 层才炸，用户只看到一句 toast。以下每条断言对应一类**真能让宿主拒收**的脏值。
 */

import { describe, expect, it } from 'vitest'

import {
  fixRule,
  hasBlockingIssue,
  inspectRule,
  inspectRules,
  stripSheetPrefix,
} from '../ts/panel/conditional-format-check.js'

/** 造一条健康规则（各用例只改自己要测的那个字段） */
function rule(overrides: Partial<{ appliesTo: string; formula: string; interior?: string }> = {}) {
  return {
    appliesTo: 'I2:I50001',
    formula: '=$I2="拼多多驿站"',
    interior: '#00B050',
    ...overrides,
  }
}

describe('范围体检', () => {
  it('带工作表名前缀 = 阻断，自动剥掉前缀（宿主 Range() 会直接抛错）', () => {
    const issues = inspectRule(rule({ appliesTo: 'Sheet1!B2:B50001' }))

    expect(hasBlockingIssue(issues)).toBe(true)
    expect(issues[0]?.fixed).toBe('B2:B50001')
  })

  it('带引号的工作表名也能剥（含空格的表名常见）', () => {
    expect(stripSheetPrefix("'动画 2026'!B2:B10")).toBe('B2:B10')
    expect(stripSheetPrefix('B2:B10')).toBe('B2:B10')
  })

  it('越界范围夹回工作表内', () => {
    const issues = inspectRule(rule({ appliesTo: 'B2:B99999999' }))

    expect(hasBlockingIssue(issues)).toBe(true)
    expect(issues[0]?.fixed).toBe('B2:B1048576')
  })

  it('范围为空 = 阻断且不给自动修（猜不出来，必须用户填）', () => {
    const issues = inspectRule(rule({ appliesTo: ' '.repeat(3) }))

    const empty = issues.find((issue) => issue.code === 'range-empty')
    expect(empty?.blocking).toBe(true)
    expect(empty?.fixed).toBeUndefined()
  })

  it('不是地址（"abc"）= 阻断', () => {
    expect(hasBlockingIssue(inspectRule(rule({ appliesTo: 'abc' })))).toBe(true)
  })
})

describe('公式体检', () => {
  it('公式为空 = 阻断', () => {
    expect(hasBlockingIssue(inspectRule(rule({ formula: '' })))).toBe(true)
  })

  it('开头多余等号自动去掉一个', () => {
    const issues = inspectRule(rule({ formula: '==$I2="x"' }))

    expect(issues[0]?.fixed).toBe('=$I2="x"')
  })

  it('引号不配对自动补一个（奇数个 " 宿主判语法错）', () => {
    const issues = inspectRule(rule({ formula: '=$I2="拼多多驿站' }))

    expect(hasBlockingIssue(issues)).toBe(true)
    expect(issues.find((issue) => issue.code === 'formula-quote-unbalanced')?.fixed).toBe(
      '=$I2="拼多多驿站"',
    )
  })

  it('引用别的工作表只提示、不拦（可能合法）', () => {
    const issues = inspectRule(rule({ formula: '=Sheet2!$I2="x"' }))

    const other = issues.find((issue) => issue.code === 'formula-other-sheet')
    expect(other?.blocking).toBe(false)
  })
})

describe('范围与公式的列是否对得上', () => {
  it('范围在 B 列、公式判 I 列 = 提示（写进去但看着没生效）', () => {
    const issues = inspectRule(rule({ appliesTo: 'B2:B50001', formula: '=$I2="x"' }))

    const mismatch = issues.find((issue) => issue.code === 'range-formula-column-mismatch')
    expect(mismatch?.blocking).toBe(false)
    expect(mismatch?.message).toContain('没生效')
  })

  it('同列不报（正常规则不该被噪音淹没）', () => {
    expect(inspectRule(rule()).length).toBe(0)
  })
})

describe('颜色体检', () => {
  it('非法填充色给兜底值（不是留着让宿主拒）', () => {
    const issues = inspectRule(rule({ interior: 'red' }))

    expect(hasBlockingIssue(issues)).toBe(true)
    expect(issues.find((issue) => issue.field === 'interior')?.fixed).toBe('#CCCCCC')
  })
})

describe('自动修复', () => {
  it('一次修掉多个字段的问题，且不改入参', () => {
    const dirty = { appliesTo: 'Sheet1!B2:B99999999', formula: '==$I2="x', interior: 'red' }
    const { rule: fixed, applied } = fixRule(dirty)

    expect(fixed.appliesTo).toBe('B2:B1048576')
    expect(fixed.formula).toBe('=$I2="x"')
    expect(fixed.interior).toBe('#CCCCCC')
    expect(applied.length).toBeGreaterThan(0)
    // 入参不变（页面拿它做「改了什么」的对比）
    expect(dirty.appliesTo).toBe('Sheet1!B2:B99999999')
  })

  it('修完不再有阻断项', () => {
    const { rule: fixed } = fixRule({
      appliesTo: 'Sheet1!B2:B99999999',
      formula: '==$I2="x',
      interior: 'red',
    })
    expect(hasBlockingIssue(inspectRule(fixed))).toBe(false)
  })
})

describe('批量体检', () => {
  it('只返回有问题的条目，健康的整条滤掉', () => {
    const flagged = inspectRules([
      rule(),
      rule({ appliesTo: 'Sheet1!B2:B10' }),
      rule({ formula: '' }),
    ])

    expect(flagged.length).toBe(2)
    expect(flagged[0]?.index).toBe(1)
    expect(flagged[1]?.index).toBe(2)
  })

  it('名字回调用来在弹窗里显示（不传则回落到 #序号）', () => {
    const flagged = inspectRules([rule({ formula: '' })], (item) => item.appliesTo)

    expect(flagged[0]?.name).toBe('I2:I50001')
  })
})
