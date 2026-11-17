// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { recommendByPreference } from '../ts/services/data-center-recommend.js'
import type { StatisticsRecord } from '../ts/services/data-center-stats.js'

function record(partial: Partial<StatisticsRecord> & { name: string }): StatisticsRecord {
  return {
    sid: partial.sid ?? partial.name,
    name: partial.name,
    watchStatus: partial.watchStatus ?? 1,
    date: partial.date ?? '',
    tags: partial.tags ?? '',
  }
}

describe('recommendByPreference', () => {
  const watched = [
    record({ name: '看过A', watchStatus: 2, tags: '科幻,冒险' }),
    record({ name: '看过B', watchStatus: 2, tags: '科幻' }),
  ]

  it('按命中标签权重推荐未看过的候选', () => {
    const recommendations = recommendByPreference(watched, [
      record({ name: '候选科幻', tags: '科幻' }),
      record({ name: '候选冒险', tags: '冒险' }),
      record({ name: '候选恋爱', tags: '恋爱' }),
    ])
    expect(recommendations.map((item) => item.name)).toEqual(['候选科幻', '候选冒险'])
    expect(recommendations[0]?.score).toBe(2)
  })

  it('排除已看过的 SID 与外部指定 SID', () => {
    const recommendations = recommendByPreference(
      watched,
      [
        record({ sid: '看过A', name: '已看SID', tags: '科幻' }),
        record({ sid: 'excluded', name: '外部排除', tags: '科幻' }),
        record({ sid: 'fresh', name: '新番', tags: '科幻' }),
      ],
      { excludeSids: new Set(['excluded']) },
    )
    expect(recommendations.map((item) => item.sid)).toEqual(['fresh'])
  })

  it('没有画像时返回空数组', () => {
    expect(recommendByPreference([record({ name: '无标签', watchStatus: 2, tags: '' })], [
      record({ name: '候选', tags: '科幻' }),
    ])).toEqual([])
  })

  it('limit 限制返回条数', () => {
    const recommendations = recommendByPreference(
      watched,
      [
        record({ name: '甲', tags: '科幻' }),
        record({ name: '乙', tags: '科幻' }),
        record({ name: '丙', tags: '科幻' }),
      ],
      { limit: 2 },
    )
    expect(recommendations).toHaveLength(2)
  })
})
