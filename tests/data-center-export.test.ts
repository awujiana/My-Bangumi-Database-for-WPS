// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  SEARCH_RESULT_HEADERS,
  SEARCH_RESULT_SHEET_NAME,
  resultColumnCount,
  searchResultsToRows,
} from '../ts/services/data-center-export.js'
import type { SearchResult } from '../ts/services/data-center-search.js'

function result(partial: Partial<SearchResult> & { name: string }): SearchResult {
  return {
    sid: partial.sid ?? partial.name,
    name: partial.name,
    kind: partial.kind ?? 'anime',
    year: partial.year ?? '',
    rating: partial.rating ?? '',
    source: partial.source ?? 'local',
    ...(partial.summary !== undefined && { summary: partial.summary }),
  }
}

describe('searchResultsToRows', () => {
  it('第 0 行是表头，列数与 resultColumnCount 一致', () => {
    const rows = searchResultsToRows([result({ name: '某番' })])
    expect(rows[0]).toEqual([...SEARCH_RESULT_HEADERS])
    expect(rows[0]).toHaveLength(resultColumnCount())
    expect(rows).toHaveLength(2)
  })

  it('类型/来源用中文显示名，字段顺序正确', () => {
    const rows = searchResultsToRows([
      result({ name: '电影A', kind: 'movie', source: 'online', year: '2026', rating: '8.5', sid: '42' }),
    ])
    expect(rows[1]).toEqual(['电影A', '42', '电影', '2026', '8.5', 'Bangumi', ''])
  })

  it('简介超长时截断到单元格上限内', () => {
    const rows = searchResultsToRows([result({ name: '长文', summary: '字'.repeat(40_000) })])
    const summary = rows[1]?.[6]
    expect(typeof summary).toBe('string')
    expect((summary as string).length).toBeLessThanOrEqual(32_000)
  })

  it('空结果只有表头', () => {
    expect(searchResultsToRows([])).toEqual([[...SEARCH_RESULT_HEADERS]])
  })

  it('工作表名固定', () => {
    expect(SEARCH_RESULT_SHEET_NAME).toBe('搜索结果')
  })
})
