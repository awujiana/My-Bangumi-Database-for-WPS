// @vitest-environment node
/**
 * @fileoverview 高亮页筛选与 GitHub 同步筛选的口径一致性测试（momo：和同步的筛选一样）
 *
 * 两边各有一份实现（本页吃本地行、同步吃远程条目），但**四季划分与跨年规则必须
 * 一致**，否则用户在两个页面用同一个「2026 年 10 月」会得到不同结果。
 * 这里用同一组日期喂给两边，断言命中集合相同（year 模式除外——那是本页刻意
 * 改成按季归属年，见 SeasonFilter 注释）。
 */

import { describe, expect, it } from 'vitest'

import { filterByTime } from '../ts/sync/github-sync-diff.js'
import type { GithubRemoteEntry, SyncTimeFilter } from '../ts/sync/github-sync-diff.js'
import { isSeasonFilterMatch } from '../ts/panel/highlight-season.js'
import type { SeasonFilter } from '../ts/panel/highlight-season.js'

/** 覆盖四季与跨年边界的日期（ISO 形态，两边都能吃） */
// 上年 12 月 → 26 年 1 月季
const DATE_DECEMBER_LAST_YEAR = '2025-12-01'
// 1 月季
const DATE_JAN = '2026-01-15'
// 1 月季
const DATE_FEB = '2026-02-20'
// 4 月季
const DATE_MAR = '2026-03-01'
// 4 月季
const DATE_MAY = '2026-05-31'
// 7 月季
const DATE_JUN = '2026-06-10'
// 7 月季
const DATE_AUG = '2026-08-25'
// 10 月季
const DATE_SEPTEMBER = '2026-09-05'
// 10 月季
const DATE_NOV = '2026-11-30'
// 次年 1 月季
const DATE_DEC = '2026-12-24'
// 次年 1 月季
const DATE_NEXT_JAN = '2027-01-08'
// 无日期 → 仅 future 命中
const DATE_EMPTY = ''

const DATES: readonly string[] = [
  DATE_DECEMBER_LAST_YEAR,
  DATE_JAN,
  DATE_FEB,
  DATE_MAR,
  DATE_MAY,
  DATE_JUN,
  DATE_AUG,
  DATE_SEPTEMBER,
  DATE_NOV,
  DATE_DEC,
  DATE_NEXT_JAN,
  DATE_EMPTY,
]

/** 造同步侧条目（只要 date 字段参与 filterByTime） */
function remoteEntries(): GithubRemoteEntry[] {
  return DATES.map((date) => ({ date }) as unknown as GithubRemoteEntry)
}

/** 集合排序用（项目禁默认字符串排序） */
function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** quarter 模式下：两边的命中集合必须一致 */
describe('quarter 口径一致（高亮页 ↔ GitHub 同步）', () => {
  const cases: readonly { year: number; quarter: 1 | 4 | 7 | 10 }[] = [
    { year: 2026, quarter: 1 },
    { year: 2026, quarter: 4 },
    { year: 2026, quarter: 7 },
    { year: 2026, quarter: 10 },
    { year: 2027, quarter: 1 },
  ]

  for (const { year, quarter } of cases) {
    it(`${String(year)} 年 ${String(quarter)} 月季`, () => {
      const syncFilter: SyncTimeFilter = { enabled: true, year, range: 'quarter', quarter }
      const highlightFilter: SeasonFilter = { enabled: true, year, range: 'quarter', quarter }

      const syncHits = filterByTime(remoteEntries(), syncFilter)
        .map((entry) => entry.date)
        .filter((date): date is string => typeof date === 'string')
        .sort(compareText)
      const highlightHits = DATES.filter((date) => isSeasonFilterMatch(date, highlightFilter)).sort(
        compareText,
      )

      expect(highlightHits).toEqual(syncHits)
    })
  }
})

/** month 模式下：两边都按原始年月精确匹配 */
describe('month 口径一致', () => {
  it('2026 年 11 月', () => {
    const syncHits = filterByTime(remoteEntries(), {
      enabled: true,
      year: 2026,
      range: 'month',
      month: 11,
    }).map((entry) => entry.date)
    const highlightHits = DATES.filter((date) =>
      isSeasonFilterMatch(date, { enabled: true, year: 2026, range: 'month', month: 11 }),
    )
    expect(highlightHits).toEqual(syncHits)
    expect(highlightHits).toEqual(['2026-11-30'])
  })
})

/** future 模式：无日期行命中 */
describe('future 口径一致', () => {
  it('只有无日期的条目命中', () => {
    const syncHits = filterByTime(remoteEntries(), { enabled: true, year: 2026, range: 'future' })
    const highlightHits = DATES.filter((date) =>
      isSeasonFilterMatch(date, { enabled: true, year: 2026, range: 'future' }),
    )
    expect(syncHits.map((entry) => entry.date)).toEqual([''])
    expect(highlightHits).toEqual([''])
  })
})

/** year 模式：本页刻意按季归属年，与同步侧的自然年不同（文档化差异） */
describe('year 模式：本页按季归属年', () => {
  it('2026 年度新番含 25 年 12 月（次年 1 月季），不含 26 年 12 月', () => {
    const hits = DATES.filter((date) =>
      isSeasonFilterMatch(date, { enabled: true, year: 2026, range: 'year' }),
    )
    expect(hits).toContain('2025-12-01')
    expect(hits).toContain('2026-11-30')
    expect(hits).not.toContain('2026-12-24')
    expect(hits).not.toContain('2027-01-08')
  })
})

/** 关闭 / all：恒放行 */
describe('未启用筛选', () => {
  it('enabled=false 或 range=all 时全部命中', () => {
    expect(
      DATES.every((date) =>
        isSeasonFilterMatch(date, { enabled: false, year: 2026, range: 'quarter', quarter: 1 }),
      ),
    ).toBe(true)
    expect(
      DATES.every((date) => isSeasonFilterMatch(date, { enabled: true, year: 2026, range: 'all' })),
    ).toBe(true)
  })

  it('null 日期源仅 future 命中', () => {
    expect(isSeasonFilterMatch(null, { enabled: true, year: 2026, range: 'future' })).toBe(true)
    expect(
      isSeasonFilterMatch(null, { enabled: true, year: 2026, range: 'quarter', quarter: 1 }),
    ).toBe(false)
    expect(isSeasonFilterMatch(null, { enabled: false, year: 2026, range: 'all' })).toBe(true)
  })
})
