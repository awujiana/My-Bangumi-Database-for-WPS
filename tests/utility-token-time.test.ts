import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getTokenRemainingTime } from '../ts/tools/util/index.js'

describe('getTokenRemainingTime', () => {
  // 固定基准秒（对应某时刻），用于让过期计算可预测
  const BASE = 1_700_000_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(BASE * 1000))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('未来 ≥7 天：normal，label 为「X天Y小时后过期」', () => {
    const r = getTokenRemainingTime(BASE + 10 * 86_400)
    expect(r).toMatchObject({ days: 10, hours: 0, status: 'normal', totalSeconds: 10 * 86_400 })
    expect(r.label).toBe('10天0小时后过期')
  })

  it('剩余 <1 天：danger，label 仅小时', () => {
    const r = getTokenRemainingTime(BASE + 12 * 3600)
    expect(r).toMatchObject({ days: 0, hours: 12, status: 'danger' })
    expect(r.label).toBe('12小时后过期')
  })

  it('剩余 1~3 天：danger，label 为「X天Y小时后过期」', () => {
    const r = getTokenRemainingTime(BASE + 2 * 86_400 + 3 * 3600)
    expect(r).toMatchObject({ days: 2, hours: 3, status: 'danger' })
    expect(r.label).toBe('2天3小时后过期')
  })

  it('剩余 3~7 天：warning，label 仅天', () => {
    const r = getTokenRemainingTime(BASE + 5 * 86_400)
    expect(r).toMatchObject({ days: 5, hours: 0, status: 'warning' })
    expect(r.label).toBe('5天后过期')
  })

  it('已过期 ≥1 天：expired，label 显示天数', () => {
    const r = getTokenRemainingTime(BASE - 86_400)
    expect(r).toMatchObject({ days: 1, hours: 0, status: 'expired', totalSeconds: 86_400 })
    expect(r.label).toBe('已过期 1天')
  })

  it('已过期 <1 天：expired，label 显示小时', () => {
    const r = getTokenRemainingTime(BASE - 3600)
    expect(r).toMatchObject({ days: 0, hours: 1, status: 'expired', totalSeconds: 3600 })
    expect(r.label).toBe('已过期 1小时')
  })
})
