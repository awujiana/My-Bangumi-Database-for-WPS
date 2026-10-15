/**
 * GitHub 同步日期 / 时长格式化纯函数单测（P1-G 抽取配套 P1-H 安全网）
 *
 * 被测模块 github-time-format.ts 为零运行时依赖纯模块（仅依赖
 * tools/string-utilities-pure.ts 与 type-only 的 github-sync-diff.ts），
 * 故本测试**不 mock 任何模块**，全部走真实实现，node 环境确定性可测。
 */

import { describe, expect, it } from 'vitest'

import {
  DATE_COLUMNS,
  appendValueWithSeparator,
  formatDateToLocal,
  formatDuration,
  formatEta,
  formatTimeFilterLabel,
} from '../ts/sync/github-time-format.js'

describe('DATE_COLUMNS', () => {
  it('仅包含需要本地化的两个日期列', () => {
    expect(DATE_COLUMNS.has('开播日期')).toBe(true)
    expect(DATE_COLUMNS.has('完播日')).toBe(true)
    expect(DATE_COLUMNS.has('名称')).toBe(false)
    expect(DATE_COLUMNS.size).toBe(2)
  })
})

describe('formatDateToLocal', () => {
  it('空字符串返回 null', () => {
    expect(formatDateToLocal('')).toBeNull()
  })

  it('解析 YYYY-MM-DD 并补零为「年月日」', () => {
    expect(formatDateToLocal('2024-01-05')).toBe('2024年01月05日')
  })

  it('支持 YYYY/MM/DD 与 YYYY.MM.DD 分隔符', () => {
    expect(formatDateToLocal('2024/1/5')).toBe('2024年01月05日')
    expect(formatDateToLocal('2024.12.15')).toBe('2024年12月15日')
  })

  it('忽略日期后的时间部分', () => {
    expect(formatDateToLocal('2024-01-05T12:30:00Z')).toBe('2024年01月05日')
  })

  it('非法格式返回 null', () => {
    expect(formatDateToLocal('not-a-date')).toBeNull()
    expect(formatDateToLocal('2024-01')).toBeNull()
    expect(formatDateToLocal('2024年01月05日')).toBeNull()
  })
})

describe('appendValueWithSeparator', () => {
  it('本地为空直接返回远程值', () => {
    expect(appendValueWithSeparator('', '远程')).toBe('远程')
    expect(appendValueWithSeparator(' '.repeat(3), '远程')).toBe('远程')
  })

  it('远程为空（或仅空白）保留本地值', () => {
    expect(appendValueWithSeparator('本地', '')).toBe('本地')
    expect(appendValueWithSeparator('本地', ' '.repeat(2))).toBe('本地')
  })

  it('本地已包含远程值时去重不追加', () => {
    expect(appendValueWithSeparator('科幻 | 恋爱', '科幻')).toBe('科幻 | 恋爱')
    expect(appendValueWithSeparator('abc', 'bc')).toBe('abc')
  })

  it('两侧都有新值时以 ` | ` 追加', () => {
    expect(appendValueWithSeparator('科幻', '恋爱')).toBe('科幻 | 恋爱')
  })

  it('合并前对两侧做 trim', () => {
    expect(appendValueWithSeparator('  科幻  ', '  恋爱  ')).toBe('科幻 | 恋爱')
  })
})

describe('formatDuration', () => {
  it('不足 1 秒按秒显示两位小数', () => {
    expect(formatDuration(0)).toBe('0.00秒')
    expect(formatDuration(500)).toBe('0.50秒')
    // 截断语义：999ms 不得四舍五入成 1.00秒（会与 1000ms 的「1秒」跨档混淆）
    expect(formatDuration(999)).toBe('0.99秒')
  })

  it('负数按 0 处理（Math.max 兜底）', () => {
    expect(formatDuration(-100)).toBe('0.00秒')
  })

  it('不足 1 分钟显示整秒', () => {
    expect(formatDuration(1000)).toBe('1秒')
    expect(formatDuration(59_000)).toBe('59秒')
  })

  it('超过 1 分钟显示「分」或「分 + 补零秒」', () => {
    // 整分不补 00秒（统一到 progress 版语义）
    expect(formatDuration(60_000)).toBe('1分')
    expect(formatDuration(61_000)).toBe('1分01秒')
    expect(formatDuration(125_000)).toBe('2分05秒')
  })
})

describe('formatEta', () => {
  it('非正数返回「计算中」占位', () => {
    expect(formatEta(0)).toBe('剩余: 计算中...')
    expect(formatEta(-5)).toBe('剩余: 计算中...')
  })

  it('正数复用 formatDuration 并加前缀', () => {
    expect(formatEta(1000)).toBe('预计剩余: 1秒')
    expect(formatEta(60_000)).toBe('预计剩余: 1分')
  })
})

describe('formatTimeFilterLabel', () => {
  it('year 范围仅显示年份', () => {
    expect(formatTimeFilterLabel({ enabled: true, year: 2024, range: 'year' })).toBe('2024年')
  })

  it('quarter 范围显示「年 + 季度月 + 新番」', () => {
    expect(formatTimeFilterLabel({ enabled: true, year: 2024, range: 'quarter', quarter: 4 })).toBe(
      '2024年4月新番',
    )
  })

  it('month 范围显示「年 + 月」', () => {
    expect(formatTimeFilterLabel({ enabled: true, year: 2024, range: 'month', month: 7 })).toBe(
      '2024年7月',
    )
  })

  it('all / future 范围走 month 分支（与原有三元逻辑一致）', () => {
    expect(formatTimeFilterLabel({ enabled: true, year: 2024, range: 'all' })).toBe('2024年月')
    expect(formatTimeFilterLabel({ enabled: true, year: 2024, range: 'month', month: 10 })).toBe(
      '2024年10月',
    )
  })
})
