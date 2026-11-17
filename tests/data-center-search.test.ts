// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildBangumiSearchUrl,
  filterResults,
  hasAnyCriterion,
  kindFromBangumiType,
  kindFromPlatform,
  mergeResults,
  normalizeOnlineEntry,
} from '../ts/services/data-center-search.js'
import type {SearchResult} from '../ts/services/data-center-search.js';

describe('hasAnyCriterion', () => {
  it('全空表单返回 false', () => {
    expect(hasAnyCriterion({ keyword: ' '.repeat(3), kind: 'all' })).toBe(false)
  })

  it('任一项有值返回 true', () => {
    expect(hasAnyCriterion({ keyword: '进击' })).toBe(true)
    expect(hasAnyCriterion({ year: 2026 })).toBe(true)
    expect(hasAnyCriterion({ kind: 'movie' })).toBe(true)
  })
})

describe('buildBangumiSearchUrl', () => {
  it('编码关键词并按类型附加 type', () => {
    expect(buildBangumiSearchUrl('进击的巨人', 'anime')).toContain('type=2')
    expect(buildBangumiSearchUrl('a b', 'all')).toContain('a%20b')
    expect(buildBangumiSearchUrl('x', 'all')).not.toContain('type=')
    expect(buildBangumiSearchUrl('x', 'movie')).toContain('type=6')
    expect(buildBangumiSearchUrl('x', 'tv')).toContain('type=4')
    expect(buildBangumiSearchUrl('x', 'all')).toContain('responseGroup=large')
  })
})

describe('kindFromBangumiType', () => {
  it('按 Bangumi type 码判定类型', () => {
    expect(kindFromBangumiType(2)).toBe('anime')
    expect(kindFromBangumiType(4)).toBe('tv')
    expect(kindFromBangumiType(6)).toBe('movie')
    expect(kindFromBangumiType(undefined)).toBe('anime')
  })
})

describe('kindFromPlatform', () => {
  it('按平台文本判定类型', () => {
    expect(kindFromPlatform('电影')).toBe('movie')
    expect(kindFromPlatform('TV')).toBe('tv')
    expect(kindFromPlatform(undefined)).toBe('anime')
  })
})

describe('normalizeOnlineEntry', () => {
  it('id 转字符串，字段归一', () => {
    const result = normalizeOnlineEntry({ id: 123, name: '测试', airDate: '2026-05-01', rating: 8.5 })
    expect(result.sid).toBe('123')
    expect(result.year).toBe('2026')
    expect(result.source).toBe('online')
    expect(result.rating).toBe('8.5')
  })
})

describe('filterResults', () => {
  const results: SearchResult[] = [
    { sid: '1', name: '科幻A', kind: 'anime', year: '2026', rating: '9', source: 'local' },
    { sid: '2', name: '爱情B', kind: 'tv', year: '2025', rating: '7', source: 'online' },
  ]

  it('按关键词 / 类型 / 年份 / 最低评分过滤', () => {
    expect(filterResults(results, { keyword: '科幻' })).toHaveLength(1)
    expect(filterResults(results, { kind: 'tv' })).toHaveLength(1)
    expect(filterResults(results, { year: 2026 })).toHaveLength(1)
    expect(filterResults(results, { minRating: 8 })).toHaveLength(1)
  })
})

describe('mergeResults', () => {
  it('本地优先按名称去重', () => {
    const local: SearchResult[] = [
      { sid: '1', name: '同名', kind: 'anime', year: '2026', rating: '', source: 'local' },
    ]
    const online: SearchResult[] = [
      { sid: '2', name: '同名', kind: 'anime', year: '2026', rating: '9', source: 'online' },
      { sid: '3', name: '另一个', kind: 'anime', year: '', rating: '', source: 'online' },
    ]
    const merged = mergeResults(local, online)
    expect(merged).toHaveLength(2)
    expect(merged[0]?.source).toBe('local')
  })
})
