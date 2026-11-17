// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  COMPLETED_STATUS,
  buildPreferenceProfile,
  compareLastTwoMonths,
  countByStatus,
  countCompletedByMonth,
  normalizeWatchStatus
  
} from '../ts/services/data-center-stats.js'
import type {StatisticsRecord} from '../ts/services/data-center-stats.js';

function record(
  partial: Omit<Partial<StatisticsRecord>, 'watchStatus'> & {
    name: string
    watchStatus?: string | number
  },
): StatisticsRecord {
  return {
    sid: partial.sid ?? partial.name,
    name: partial.name,
    watchStatus: normalizeWatchStatus(partial.watchStatus ?? 1),
    date: partial.date ?? '',
    tags: partial.tags ?? '',
  }
}

describe('normalizeWatchStatus', () => {
  it('识别数值 1~5 与中文/英文文本', () => {
    expect(normalizeWatchStatus(2)).toBe(2)
    expect(normalizeWatchStatus('看过')).toBe(2)
    expect(normalizeWatchStatus('completed')).toBe(2)
    expect(normalizeWatchStatus('在看')).toBe(3)
    expect(normalizeWatchStatus('想看')).toBe(1)
  })

  it('无法识别返回 0', () => {
    expect(normalizeWatchStatus('')).toBe(0)
    expect(normalizeWatchStatus('未知')).toBe(0)
    expect(normalizeWatchStatus(9)).toBe(0)
  })
})

describe('countByStatus', () => {
  it('统计各状态且保留 0 计数、顺序固定', () => {
    const counts = countByStatus([
      record({ name: 'A', watchStatus: 2 }),
      record({ name: 'B', watchStatus: '看过' }),
      record({ name: 'C', watchStatus: 3 }),
      record({ name: 'D', watchStatus: '未知' }),
    ])
    expect(counts).toEqual([
      { status: 1, count: 0 },
      { status: 2, count: 2 },
      { status: 3, count: 1 },
      { status: 4, count: 0 },
      { status: 5, count: 0 },
    ])
  })
})

describe('countCompletedByMonth', () => {
  it('只统计 type=2 且日期可解析的条目，按月份升序', () => {
    const months = countCompletedByMonth([
      record({ name: 'A', watchStatus: 2, date: '2026-11-04' }),
      record({ name: 'B', watchStatus: 2, date: '2026/10/31' }),
      record({ name: 'C', watchStatus: 3, date: '2026-11-01' }),
      record({ name: 'D', watchStatus: 2, date: '' }),
    ])
    expect(months).toEqual([
      { month: '2026-10', count: 1 },
      { month: '2026-11', count: 1 },
    ])
  })
})

describe('compareLastTwoMonths', () => {
  it('上期为 0 时当前>0 记 100%', () => {
    expect(compareLastTwoMonths([{ month: '2026-11', count: 3 }])).toEqual({
      current: 3,
      previous: 0,
      changePercent: 100,
    })
  })

  it('正常环比', () => {
    expect(
      compareLastTwoMonths([
        { month: '2026-10', count: 4 },
        { month: '2026-11', count: 5 },
      ]),
    ).toEqual({ current: 5, previous: 4, changePercent: 25 })
  })

  it('空数据不崩', () => {
    expect(compareLastTwoMonths([])).toEqual({ current: 0, previous: 0, changePercent: 0 })
  })
})

describe('buildPreferenceProfile', () => {
  it('只从看过条目取标签权重，降序', () => {
    const profile = buildPreferenceProfile([
      record({ name: 'A', watchStatus: 2, tags: '科幻,冒险' }),
      record({ name: 'B', watchStatus: 2, tags: '科幻、悬疑' }),
      record({ name: 'C', watchStatus: 3, tags: '恋爱' }),
    ])
    expect(profile.sampleSize).toBe(2)
    expect(profile.topTags[0]).toEqual({ tag: '科幻', weight: 2 })
    expect(profile.topTags.find((item) => item.tag === '恋爱')).toBeUndefined()
  })

  it('COMPLETED_STATUS 与看过的数值一致', () => {
    expect(COMPLETED_STATUS).toBe(2)
  })
})
