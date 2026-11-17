// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  UNMAPPED_REMOTE_FIELDS,
  applyColumnOverrides,
  buildSyncMappingRows,
  excludedColumnClosure,
  excludedJsonlFields,
  findOverrideConflicts,
  remapColumnIndices,
  resolveSyncMappingConfig,
  withoutColumns,
} from '../ts/sync/sync-mapping.js'
import type { SyncMappingRow } from '../ts/sync/sync-mapping.js'
import type { LocalRowEntry } from '../ts/sync/github-sync-diff.js'

/** 构造单行（可逐项覆盖 UI 状态） */
function makeRow(overrides: Partial<SyncMappingRow>): SyncMappingRow {
  return {
    id: '导演',
    remoteField: '导演',
    group: 'meta',
    defaultColumn: '导演',
    aliasColumns: [],
    hasLocalColumn: true,
    selected: true,
    targetColumn: '导演',
    ...overrides,
  }
}

/** 构造本地列集合（模拟 columnMap 的键） */
function localColumns(...names: string[]): string[] {
  return names
}

describe('buildSyncMappingRows', () => {
  it('应从 CORE + EXTENDED + 派生字段派生全部可同步字段，且无重复行', () => {
    const rows = buildSyncMappingRows(localColumns('名称', '开播日期', '评分'))
    const ids = rows.map((row) => row.id)
    // 无重复
    expect(new Set(ids).size).toBe(ids.length)
    // 关键字段都在
    expect(ids).toContain('Bangumi_URL')
    expect(ids).toContain('名称')
    expect(ids).toContain('标签/分级')
    expect(ids).toContain('集数')
    expect(ids).toContain('开播日期')
    expect(ids).toContain('导演')
    expect(ids).toContain('评分')
    expect(ids).toContain('排名')
    expect(ids).toContain('关联条目ID')
    expect(ids).toContain('关联的动漫ID')
    expect(ids).toContain('别名')
  })

  it('应按分组固定顺序排列（basic → meta → stats → relations → alias）', () => {
    const rows = buildSyncMappingRows(localColumns('别名', '评分', '导演', '名称'))
    const groups = [...new Set(rows.map((row) => row.group))]
    expect(groups).toEqual(['basic', 'meta', 'stats', 'relations', 'alias'])
  })

  it('hasLocalColumn 与 selected 默认值应由本地列集合决定', () => {
    const rows = buildSyncMappingRows(localColumns('名称', '评分'))
    const name = rows.find((row) => row.id === '名称')
    const director = rows.find((row) => row.id === '导演')
    expect(name?.hasLocalColumn).toBe(true)
    expect(name?.selected).toBe(true)
    expect(director?.hasLocalColumn).toBe(false)
    // 缺列默认不选（避免勾了却写不进去）
    expect(director?.selected).toBe(false)
  })

  it('动画制作公司行应带别名列（制作公司 ↔ 动画制作公司双写）', () => {
    const rows = buildSyncMappingRows(localColumns('制作公司'))
    const company = rows.find((row) => row.id === '制作公司')
    expect(company?.remoteField).toBe('动画制作公司')
    expect(company?.aliasColumns).toContain('动画制作公司')
  })
})

describe('resolveSyncMappingConfig', () => {
  it('未勾选的行应进 excludedColumns', () => {
    const config = resolveSyncMappingConfig([makeRow({ selected: false })])
    expect(config.excludedColumns).toEqual(['导演'])
    expect(config.columnOverrides).toEqual({})
  })

  it('改了目标列应产生 override', () => {
    const config = resolveSyncMappingConfig([makeRow({ targetColumn: '监督' })])
    expect(config.excludedColumns).toEqual([])
    expect(config.columnOverrides).toEqual({ 导演: '监督' })
  })

  it('目标列改回默认列不应产生 override', () => {
    const config = resolveSyncMappingConfig([makeRow({ targetColumn: ' 导演 ' })])
    expect(config.columnOverrides).toEqual({})
  })

  it('勾选但缺列的行不产生配置（补列在确认前已落盘）', () => {
    const config = resolveSyncMappingConfig([makeRow({ hasLocalColumn: false })])
    expect(config.excludedColumns).toEqual([])
    expect(config.columnOverrides).toEqual({})
  })
})

describe('findOverrideConflicts', () => {
  it('两个字段 override 到同一列时，后占位者应报冲突', () => {
    // 语义：先占位者保留（视为有效选择），后抢同一列的记为冲突行
    const conflicts = findOverrideConflicts([
      makeRow({ id: '导演', defaultColumn: '导演', targetColumn: '制作' }),
      makeRow({ id: '音乐', remoteField: '音乐', defaultColumn: '音乐', targetColumn: '制作' }),
    ])
    expect(conflicts).toEqual(['音乐'])
  })

  it('override 指向另一个字段的默认列应报冲突', () => {
    const conflicts = findOverrideConflicts([
      makeRow({ id: '导演', defaultColumn: '导演', targetColumn: '音乐' }),
      makeRow({ id: '音乐', remoteField: '音乐', defaultColumn: '音乐', targetColumn: '音乐' }),
    ])
    expect(conflicts).toContain('导演')
  })

  it('override 指向别名列也应报冲突（别名列同样会被写）', () => {
    const conflicts = findOverrideConflicts([
      makeRow({
        id: '制作公司',
        remoteField: '动画制作公司',
        defaultColumn: '制作公司',
        aliasColumns: ['动画制作公司'],
      }),
      makeRow({ id: '导演', defaultColumn: '导演', targetColumn: '动画制作公司' }),
    ])
    expect(conflicts).toContain('导演')
  })

  it('未勾选的行不参与占位，不应误报', () => {
    const conflicts = findOverrideConflicts([
      makeRow({ id: '导演', defaultColumn: '导演', selected: false }),
      makeRow({ id: '音乐', remoteField: '音乐', defaultColumn: '音乐', targetColumn: '导演' }),
    ])
    expect(conflicts).toEqual([])
  })
})

describe('applyColumnOverrides', () => {
  it('应把 override 列的值复制到默认列名键下（消费方零改动）', () => {
    const entries = new Map<string, LocalRowEntry>([
      ['1', { row: 2, subjectId: '1', fields: { 监督: 'XXX', 名称: 'A' } }],
    ])
    applyColumnOverrides(entries, { 导演: '监督' })
    expect(entries.get('1')?.fields['导演']).toBe('XXX')
    // 原键保留，不影响本地读取
    expect(entries.get('1')?.fields['监督']).toBe('XXX')
  })

  it('override 列不存在时应落空串（diff 视为空本地值，随后写入走 remap）', () => {
    const entries = new Map<string, LocalRowEntry>([
      ['1', { row: 2, subjectId: '1', fields: { 名称: 'A' } }],
    ])
    applyColumnOverrides(entries, { 导演: '监督' })
    expect(entries.get('1')?.fields['导演']).toBe('')
  })

  it('空 overrides 或 from === to 时应为无操作', () => {
    const entries = new Map<string, LocalRowEntry>([
      ['1', { row: 2, subjectId: '1', fields: { 导演: 'X' } }],
    ])
    applyColumnOverrides(entries, {})
    applyColumnOverrides(entries, { 导演: '导演' })
    expect(entries.get('1')?.fields['导演']).toBe('X')
  })
})

describe('excludedJsonlFields', () => {
  it('应把列名反查为远程字段键', () => {
    const excluded = excludedJsonlFields(['开播日期', '评分', '名称'])
    expect(excluded.has('date')).toBe(true)
    expect(excluded.has('score')).toBe(true)
    expect(excluded.has('name')).toBe(true)
  })

  it('Bangumi_URL 与未知列不应产生剔除项（subjectId 恒随 base 片下载）', () => {
    const excluded = excludedJsonlFields(['Bangumi_URL', '不存在的列'])
    expect(excluded.size).toBe(0)
  })
})

describe('UNMAPPED_REMOTE_FIELDS', () => {
  it('应覆盖下载了但不落盘的字段（确认框脚注用）', () => {
    const fields = UNMAPPED_REMOTE_FIELDS.map(([field]) => field)
    expect(fields).toContain('summary')
    expect(fields).toContain('infobox')
    expect(fields).toContain('tags')
    expect(fields).toContain('nsfw')
  })
})

describe('excludedColumnClosure', () => {
  it('排除主列时应把别名列一并纳入（双列写入字段防漏）', () => {
    const closure = excludedColumnClosure(['制作公司'])
    expect(closure.has('制作公司')).toBe(true)
    expect(closure.has('动画制作公司')).toBe(true)
  })

  it('无别名的列闭包应只含自身', () => {
    const closure = excludedColumnClosure(['导演'])
    expect([...closure]).toEqual(['导演'])
  })
})

describe('withoutColumns', () => {
  it('应返回不含排除列的新 Map，且不动原 Map', () => {
    const original = new Map([
      ['导演', 3],
      ['音乐', 4],
    ])
    const kept = withoutColumns(original, new Set(['导演']))
    expect([...kept]).toEqual([['音乐', 4]])
    expect(original.has('导演')).toBe(true)
  })
})

describe('remapColumnIndices', () => {
  it('应把默认列的列号替换为目标列的列号（其余列不动）', () => {
    const columnMap = new Map([
      ['导演', 3],
      ['监督', 9],
      ['音乐', 4],
    ])
    const remapped = remapColumnIndices(columnMap, new Map([['导演', 9]]))
    expect(remapped.get('导演')).toBe(9)
    expect(remapped.get('监督')).toBe(9)
    expect(remapped.get('音乐')).toBe(4)
    // 原 Map 不动
    expect(columnMap.get('导演')).toBe(3)
  })
})

describe('buildSyncMappingRows · 本地列名别名（动画制作公司）', () => {
  it('本地只有「动画制作公司」列 → 制作公司行已匹配、目标列指向它（不再误报缺列）', () => {
    const rows = buildSyncMappingRows(['名称', '动画制作公司'])
    const studio = rows.find((row) => row.id === '制作公司')
    expect(studio).toBeDefined()
    expect(studio?.remoteField).toBe('动画制作公司')
    expect(studio?.hasLocalColumn).toBe(true)
    expect(studio?.targetColumn).toBe('动画制作公司')
    // 有列就该默认勾上（makeRow 的 selected 跟随 hasLocalColumn）
    expect(studio?.selected).toBe(true)
  })

  it('本地有标准列「制作公司」→ 目标列仍用标准列（别名不抢默认）', () => {
    const rows = buildSyncMappingRows(['名称', '制作公司'])
    const studio = rows.find((row) => row.id === '制作公司')
    expect(studio?.targetColumn).toBe('制作公司')
    expect(studio?.hasLocalColumn).toBe(true)
  })

  it('两个列名都没有 → 仍报本地缺列且不勾选（补列流程不变）', () => {
    const rows = buildSyncMappingRows(['名称'])
    const studio = rows.find((row) => row.id === '制作公司')
    expect(studio?.hasLocalColumn).toBe(false)
    expect(studio?.selected).toBe(false)
    expect(studio?.targetColumn).toBe('制作公司')
  })

  it('标准列与别名列同时存在 → 优先标准列', () => {
    const rows = buildSyncMappingRows(['制作公司', '动画制作公司'])
    const studio = rows.find((row) => row.id === '制作公司')
    expect(studio?.targetColumn).toBe('制作公司')
  })
})
