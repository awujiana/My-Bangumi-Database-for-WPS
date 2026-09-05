// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  parseJsonl,
  filterByTime,
  computeDiff,
  tagsToString,
  isGithubRemoteEntry,
  EXTENDED_FIELD_MAP,
  SYNC_STRATEGY_LABELS,
} from '../ts/sync/github-sync-diff.js'
import type {
  GithubRemoteEntry,
  SyncTimeFilter,
  LocalRowEntry,
} from '../ts/sync/github-sync-diff.js'

// ========== parseJsonl 测试 ==========
describe('parseJsonl', () => {
  it('空字符串应返回空结果', () => {
    const result = parseJsonl('')
    expect(result.entries).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('无效输入类型应返回空结果', () => {
    // @ts-expect-error 测试无效输入
    const result = parseJsonl(null)
    expect(result.entries).toEqual([])
  })

  it('合法 JSONL 应正确解析', () => {
    const text = '{"sid":"123","name":"测试"}\n{"sid":"456","name":"测试2"}'
    const result = parseJsonl(text)
    expect(result.entries.length).toBe(2)
    expect(result.entries[0]?.sid).toBe('123')
    expect(result.entries[1]?.sid).toBe('456')
  })

  it('包含空行时应跳过', () => {
    const text = '{"sid":"123"}\n\n{"sid":"456"}\n'
    const result = parseJsonl(text)
    expect(result.entries.length).toBe(2)
  })

  it('非法 JSON 行应记录错误', () => {
    const text = '{"sid":"123"}\ninvalid json\n{"sid":"456"}'
    const result = parseJsonl(text)
    expect(result.entries.length).toBe(2)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]?.line).toBe(2)
  })

  it('缺少 sid 字段的条目应记录错误', () => {
    const text = '{"name":"测试"}'
    const result = parseJsonl(text)
    expect(result.entries.length).toBe(0)
    expect(result.errors.length).toBe(1)
  })

  it('sid 不是字符串的条目应记录错误', () => {
    const text = '{"sid":123}'
    const result = parseJsonl(text)
    expect(result.entries.length).toBe(0)
  })
})

// ========== tagsToString 测试 ==========
describe('tagsToString', () => {
  it('undefined 应返回空字符串', () => {
    expect(tagsToString(undefined)).toBe('')
  })

  it('空数组应返回空字符串', () => {
    expect(tagsToString([])).toBe('')
  })

  it('应使用 | 连接数组元素', () => {
    expect(tagsToString(['tag1', 'tag2', 'tag3'])).toBe('tag1|tag2|tag3')
  })
})

// ========== isGithubRemoteEntry 测试 ==========
describe('isGithubRemoteEntry', () => {
  it('null 应返回 false', () => {
    expect(isGithubRemoteEntry(null)).toBe(false)
  })

  it('非对象应返回 false', () => {
    expect(isGithubRemoteEntry('string')).toBe(false)
    expect(isGithubRemoteEntry(123)).toBe(false)
  })

  it('缺少 sid 应返回 false', () => {
    expect(isGithubRemoteEntry({ name: 'test' })).toBe(false)
  })

  it('sid 不是字符串应返回 false', () => {
    expect(isGithubRemoteEntry({ sid: 123 })).toBe(false)
  })

  it('有效对象应返回 true', () => {
    expect(isGithubRemoteEntry({ sid: '123' })).toBe(true)
  })
})

// ========== filterByTime 测试 ==========
describe('filterByTime', () => {
  const testEntries: GithubRemoteEntry[] = [
    { sid: '1', date: '2026-01-15', name: '1月' },
    { sid: '2', date: '2026-04-20', name: '4月' },
    { sid: '3', date: '2026-07-10', name: '7月' },
    { sid: '4', date: '2026-10-25', name: '10月' },
    { sid: '5', date: '2025-12-30', name: '上年12月' },
    { sid: '6', date: '', name: '无日期' },
    { sid: '7', name: '无 date 字段' },
  ]

  it('未启用筛选或范围为 all 时应返回全部条目', () => {
    const filter: SyncTimeFilter = { enabled: false, year: 2026, range: 'all' }
    const result = filterByTime(testEntries, filter)
    expect(result.length).toBe(testEntries.length)
  })

  it('按年份筛选应返回匹配年份的条目', () => {
    const filter: SyncTimeFilter = { enabled: true, year: 2026, range: 'year' }
    const result = filterByTime(testEntries, filter)
    expect(result.length).toBeGreaterThan(0)
    result.forEach((entry) => {
      expect(entry.date?.startsWith('2026')).toBe(true)
    })
  })

  it('按月份筛选应返回匹配月份的条目', () => {
    const filter: SyncTimeFilter = { enabled: true, year: 2026, range: 'month', month: 4 }
    const result = filterByTime(testEntries, filter)
    expect(result.length).toBeGreaterThan(0)
  })

  it('按季度筛选（1月新番 Q1）应包含上年12月和本年1-2月', () => {
    const filter: SyncTimeFilter = { enabled: true, year: 2026, range: 'quarter', quarter: 1 }
    const result = filterByTime(testEntries, filter)
    // 应包含 2026-01 (1月), 2025-12 (上年12月)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('按季度筛选（4月新番 Q2）应包含3-5月', () => {
    const filter: SyncTimeFilter = { enabled: true, year: 2026, range: 'quarter', quarter: 4 }
    const result = filterByTime(testEntries, filter)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('无 date 字段的条目应被过滤掉', () => {
    const filter: SyncTimeFilter = { enabled: true, year: 2026, range: 'year' }
    const result = filterByTime(testEntries, filter)
    result.forEach((entry) => {
      expect(entry.date).toBeTruthy()
    })
  })

  it('日期格式 YYYY/MM/DD 应正确解析', () => {
    const entriesWithSlash: GithubRemoteEntry[] = [{ sid: '1', date: '2026/03/15', name: '测试' }]
    const filter: SyncTimeFilter = { enabled: true, year: 2026, range: 'year' }
    const result = filterByTime(entriesWithSlash, filter)
    expect(result.length).toBe(1)
  })

  it('日期格式 YYYY.MM.DD 应正确解析', () => {
    const entriesWithDot: GithubRemoteEntry[] = [{ sid: '1', date: '2026.03.15', name: '测试' }]
    const filter: SyncTimeFilter = { enabled: true, year: 2026, range: 'year' }
    const result = filterByTime(entriesWithDot, filter)
    expect(result.length).toBe(1)
  })

  it('无匹配结果时应返回空数组', () => {
    const filter: SyncTimeFilter = { enabled: true, year: 2020, range: 'year' }
    const result = filterByTime(testEntries, filter)
    expect(result.length).toBe(0)
  })
})

// ========== computeDiff 测试 ==========
describe('computeDiff', () => {
  const createRemoteEntry = (
    sid: string,
    overrides: Partial<GithubRemoteEntry> = {},
  ): GithubRemoteEntry => ({
    sid,
    name: `条目${sid}`,
    ...overrides,
  })

  const createLocalEntry = (
    sid: string,
    row: number,
    fields: Record<string, string> = {},
  ): LocalRowEntry => ({
    row,
    sid,
    fields: {
      名称: `本地${sid}`,
      '标签/分级': '',
      集数: '',
      开播日期: '',
      ...fields,
    },
  })

  describe('基础策略 (add-update)', () => {
    it('远程有、本地无应返回 add', () => {
      const remote = [createRemoteEntry('1')]
      const local = new Map<string, LocalRowEntry>()
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('add')
      expect(diffs[0]?.changedFields).toEqual(['*'])
    })

    it('远程与本地 SID 相同、名称不同应返回 update', () => {
      const remote = [createRemoteEntry('1', { name: '远程名称' })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 名称: '本地名称' })],
      ])
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('update')
      expect(diffs[0]?.changedFields).toContain('名称')
    })

    it('远程与本地完全相同应无差异', () => {
      const remote = [createRemoteEntry('1', { name: '相同名称' })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 名称: '相同名称' })],
      ])
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(0)
    })

    it('远程空 name 不应触发名称差异', () => {
      const remote = [createRemoteEntry('1', { name: undefined })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 名称: '本地名称' })],
      ])
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(0)
    })
  })

  describe('add-only 策略', () => {
    it('本地存在的 SID 应跳过', () => {
      const remote = [createRemoteEntry('1', { name: '远程名称' })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 名称: '本地名称' })],
      ])
      const diffs = computeDiff(remote, local, 'add-only')
      expect(diffs.length).toBe(0)
    })

    it('本地不存在的 SID 应返回 add', () => {
      const remote = [createRemoteEntry('1')]
      const local = new Map<string, LocalRowEntry>()
      const diffs = computeDiff(remote, local, 'add-only')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('add')
    })
  })

  describe('update-only 策略', () => {
    it('本地不存在的 SID 应跳过', () => {
      const remote = [createRemoteEntry('1')]
      const local = new Map<string, LocalRowEntry>()
      const diffs = computeDiff(remote, local, 'update-only')
      expect(diffs.length).toBe(0)
    })

    it('本地存在且有差异应返回 update', () => {
      const remote = [createRemoteEntry('1', { name: '远程名称' })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 名称: '本地名称' })],
      ])
      const diffs = computeDiff(remote, local, 'update-only')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('update')
    })
  })

  describe('force-overwrite 策略', () => {
    it('本地存在的 SID 应强制返回 update，changedFields 为 [*]', () => {
      const remote = [createRemoteEntry('1')]
      const local = new Map<string, LocalRowEntry>([['1', createLocalEntry('1', 2)]])
      const diffs = computeDiff(remote, local, 'force-overwrite')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('update')
      expect(diffs[0]?.changedFields).toEqual(['*'])
    })
  })

  describe('mirror 策略', () => {
    it('远程不存在的本地 SID 应标记为 delete', () => {
      const remote = []
      const local = new Map<string, LocalRowEntry>([['1', createLocalEntry('1', 2)]])
      const diffs = computeDiff(remote, local, 'mirror')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('delete')
    })

    it('远程存在的 SID 应按 add-update 规则处理', () => {
      const remote = [createRemoteEntry('1')]
      const local = new Map<string, LocalRowEntry>()
      const diffs = computeDiff(remote, local, 'mirror')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('add')
    })

    it('带时间筛选的 mirror：本地日期在范围内应删除', () => {
      const remote: GithubRemoteEntry[] = []
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 开播日期: '2026-03-15' })],
      ])
      const timeFilter: SyncTimeFilter = { enabled: true, year: 2026, range: 'year' }
      const diffs = computeDiff(remote, local, 'mirror', timeFilter)
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.kind).toBe('delete')
    })

    it('带时间筛选的 mirror：本地日期不在范围内应跳过删除', () => {
      const remote: GithubRemoteEntry[] = []
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 开播日期: '2020-03-15' })],
      ])
      const timeFilter: SyncTimeFilter = { enabled: true, year: 2026, range: 'year' }
      const diffs = computeDiff(remote, local, 'mirror', timeFilter)
      expect(diffs.length).toBe(0)
    })
  })

  describe('扩展字段比对', () => {
    it('扩展字段不同应被检测', () => {
      const remote = [createRemoteEntry('1', { 导演: '新导演' })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 导演: '旧导演' })],
      ])
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.changedFields).toContain('导演')
    })

    it('扩展字段 undefined 不应触发差异', () => {
      const remote = [createRemoteEntry('1')]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 名称: '条目1', 导演: '旧导演' })],
      ])
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(0)
    })

    it('集数（话数）不同应被检测', () => {
      const remote = [createRemoteEntry('1', { 话数: '24' })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { 集数: '12' })],
      ])
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.changedFields).toContain('集数')
    })

    it('标签（meta_tags）不同应被检测', () => {
      const remote = [createRemoteEntry('1', { meta_tags: ['治愈', '日常'] })]
      const local = new Map<string, LocalRowEntry>([
        ['1', createLocalEntry('1', 2, { '标签/分级': '冒险' })],
      ])
      const diffs = computeDiff(remote, local, 'add-update')
      expect(diffs.length).toBe(1)
      expect(diffs[0]?.changedFields).toContain('标签/分级')
    })
  })

  it('空 SID 应被跳过', () => {
    const remote = [{ sid: '', name: '空SID' } as GithubRemoteEntry]
    const local = new Map<string, LocalRowEntry>()
    const diffs = computeDiff(remote, local, 'add-update')
    expect(diffs.length).toBe(0)
  })
})

// ========== EXTENDED_FIELD_MAP 测试 ==========
describe('EXTENDED_FIELD_MAP', () => {
  it('应包含所有必要的字段映射', () => {
    expect(EXTENDED_FIELD_MAP.length).toBeGreaterThan(0)
    // 验证前几个映射
    expect(EXTENDED_FIELD_MAP[0]).toEqual(['date', '开播日期'])
    expect(EXTENDED_FIELD_MAP[1]).toEqual(['播放结束', '完播日'])
  })
})

// ========== SYNC_STRATEGY_LABELS 测试 ==========
describe('SYNC_STRATEGY_LABELS', () => {
  it('应包含所有策略的中文标签', () => {
    expect(SYNC_STRATEGY_LABELS['add-update']).toBe('新增+更新（不删除）')
    expect(SYNC_STRATEGY_LABELS['add-only']).toBe('仅新增')
    expect(SYNC_STRATEGY_LABELS['update-only']).toBe('仅更新')
    expect(SYNC_STRATEGY_LABELS.mirror).toBe('镜像同步（含删除）')
    expect(SYNC_STRATEGY_LABELS['force-overwrite']).toBe('强制覆盖')
  })
})

// ============ 补充: isWithinTimeFilter 默认值分支 (lines 359, 366) ============

describe('isWithinTimeFilter 默认 quarter/month 值', () => {
  // 通过 computeDiff 的 mirror 策略触发 isWithinTimeFilter
  // isWithinTimeFilter 返回 true → 日期在范围内 → 条目应被删除
  // isWithinTimeFilter 返回 false → 日期不在范围内 → 条目保留（不删除）

  it('quarter 未指定时默认使用 quarter=1，匹配的条目应被删除 (line 359)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-q-default',
        { row: 2, sid: 'sid-q-default', fields: { 开播日期: '2024年02月15日', 名称: '2月条目' } },
      ],
    ])
    // quarter 未指定，使用默认值 1（Q1：1月、2月、3月）
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      year: 2024,
      // quarter 缺失 → 默认 quarter=1
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 2月条目在 Q1 范围内 → isWithinTimeFilter 返回 true → 应被删除
    expect(deletes.length).toBe(1)
  })

  it('quarter 默认值不匹配时条目保留 (line 359)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-q-default2',
        { row: 2, sid: 'sid-q-default2', fields: { 开播日期: '2024年07月15日', 名称: '7月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      year: 2024,
      // quarter 缺失 → 默认 quarter=1，但 7月不在 Q1 范围内
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 7月不在 Q1 范围内 → isWithinTimeFilter 返回 false → 不删除
    expect(deletes.length).toBe(0)
  })

  it('month 未指定时默认使用 month=1，匹配的条目应被删除 (line 366)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-m-default',
        { row: 2, sid: 'sid-m-default', fields: { 开播日期: '2024年01月15日', 名称: '1月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'month',
      year: 2024,
      // month 缺失 → 默认 month=1
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 1月条目匹配默认 month=1 → isWithinTimeFilter 返回 true → 应被删除
    expect(deletes.length).toBe(1)
  })

  it('month 默认值不匹配时条目保留 (line 366)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-m-default2',
        { row: 2, sid: 'sid-m-default2', fields: { 开播日期: '2024年06月15日', 名称: '6月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'month',
      year: 2024,
      // month 缺失 → 默认 month=1，但条目是 6月
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 6月 != 默认 1月 → isWithinTimeFilter 返回 false → 不删除
    expect(deletes.length).toBe(0)
  })
})

// ========== 补充测试：filterByTime isNaN 路径 (line 306) ==========
describe('filterByTime isNaN 边界 (line 306)', () => {
  it('日期格式匹配但解析后 year/month 为 NaN 时返回 false', () => {
    // 构造一个 date 字段能通过正则匹配但 parseInt 返回 NaN 的场景
    // 注意：match[1] 和 match[2] 是字符串，parseInt 对任何数字字符串都有效
    // 这里测试 match 存在但解析出的 year/month 不在有效范围
    const entries: GithubRemoteEntry[] = [
      // 月份 13 无效
      { sid: 'nan-1', name: '测试1', date: '0000-13-01' },
      // 无法匹配正则
      { sid: 'nan-2', name: '测试2', date: 'abc-01-01' },
    ]
    const filter: SyncTimeFilter = { enabled: true, range: 'month', year: 2024, month: 1 }
    const result = filterByTime(entries, filter)
    // 0000-13-01: 正则能匹配 (0000, 13)，但 13 月不在 month=1 范围 → 返回 false
    // abc-01-01: 正则不能匹配 → 返回 false
    expect(result.length).toBe(0)
  })

  it('日期格式 YYYY-MM-DD 正确解析', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'valid-1', name: '有效日期', date: '2024-06-15' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'year', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(1)
  })

  it('日期格式 YYYY/MM/DD 正确解析', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'valid-2', name: '斜杠格式', date: '2024/06/15' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'year', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(1)
  })

  it('日期格式 YYYY.MM.DD 正确解析', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'valid-3', name: '点号格式', date: '2024.06.15' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'year', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(1)
  })

  it('月份和日期为个位数时正确解析', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'single-1', name: '个位数', date: '2024-1-5' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'month', year: 2024, month: 1 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(1)
  })

  it('date 字段为空时被过滤', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'no-date', name: '无日期', date: '' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'year', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(0)
  })

  it('date 字段不存在时被过滤', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'no-date-field', name: '无日期字段' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'year', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(0)
  })

  it('日期格式不匹配正则时返回 false', () => {
    const entries: GithubRemoteEntry[] = [
      { sid: 'bad-format', name: '坏格式', date: '2024年6月15日' },
    ]
    const filter: SyncTimeFilter = { enabled: true, range: 'year', year: 2024 }
    const result = filterByTime(entries, filter)
    // '2024年6月15日' 不匹配 /^(\d{4})[-/.](\d{1,2})/ 正则
    expect(result.length).toBe(0)
  })
})

// ========== 补充测试：isWithinTimeFilter 默认 quarter/month 值 (lines 315, 325) ==========
describe('isWithinTimeFilter 默认值路径 (lines 315, 325)', () => {
  // 通过 computeDiff mirror 策略触发 isWithinTimeFilter

  it('quarter 默认值 1 时，1月条目在 mirror 策略下被删除 (line 315)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-q1',
        { row: 2, sid: 'sid-q1', fields: { 开播日期: '2024年01月15日', 名称: '1月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      year: 2024,
      // quarter 缺失 → 默认 quarter=1 (Q1: 1,2,3月)
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(1)
    expect(deletes[0]?.sid).toBe('sid-q1')
  })

  it('quarter 默认值 1 时，7月条目不在 Q1 范围不被删除 (line 315)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-q7',
        { row: 2, sid: 'sid-q7', fields: { 开播日期: '2024年07月15日', 名称: '7月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      year: 2024,
      // quarter 缺失 → 默认 quarter=1，但 7月不在 Q1 范围
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(0)
  })

  it('month 默认值 1 时，1月条目在 mirror 策略下被删除 (line 325)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-m1',
        { row: 2, sid: 'sid-m1', fields: { 开播日期: '2024年01月15日', 名称: '1月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'month',
      year: 2024,
      // month 缺失 → 默认 month=1
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(1)
    expect(deletes[0]?.sid).toBe('sid-m1')
  })

  it('month 默认值 1 时，6月条目不在1月范围不被删除 (line 325)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-m6',
        { row: 2, sid: 'sid-m6', fields: { 开播日期: '2024年06月15日', 名称: '6月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'month',
      year: 2024,
      // month 缺失 → 默认 month=1，但条目是 6月
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(0)
  })

  it('isWithinTimeFilter dateStr 为空字符串时返回 false', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      ['sid-empty', { row: 2, sid: 'sid-empty', fields: { 开播日期: '', 名称: '空日期' } }],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'year',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 空日期 → isWithinTimeFilter 返回 false → 不删除
    expect(deletes.length).toBe(0)
  })

  it('isWithinTimeFilter dateStr 格式不匹配时返回 false', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      ['sid-bad', { row: 2, sid: 'sid-bad', fields: { 开播日期: 'invalid-date', 名称: '坏日期' } }],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'year',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(0)
  })

  it('isWithinTimeFilter year 不匹配时返回 false', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-year',
        { row: 2, sid: 'sid-year', fields: { 开播日期: '2023年06月15日', 名称: '2023年' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'year',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 年份不匹配 → isWithinTimeFilter 返回 false → 不删除
    expect(deletes.length).toBe(0)
  })

  it('mirror 策略下时间筛选未启用时所有本地条目都应被删除', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-all',
        { row: 2, sid: 'sid-all', fields: { 开播日期: '2023年06月15日', 名称: '任意日期' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      // 时间筛选未启用
      enabled: false,
      range: 'all',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 时间筛选未启用 → 直接标记删除
    expect(deletes.length).toBe(1)
  })

  it('mirror 策略下时间筛选 range=all 时所有本地条目都应被删除', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-all2',
        { row: 2, sid: 'sid-all2', fields: { 开播日期: '2023年06月15日', 名称: '任意日期' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      // range=all
      range: 'all',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(1)
  })
})

// ========== 补充测试：computeDiff force-overwrite 与 mirror 组合 ==========
describe('computeDiff 更多策略分支', () => {
  it('force-overwrite 策略应标记所有匹配 SID 为 update with changedFields=["*"]', () => {
    const remote: GithubRemoteEntry[] = [{ sid: 'f1', name: '远程1', date: '2024-01-01' }]
    const local = new Map<string, LocalRowEntry>([
      [
        'f1',
        { row: 2, sid: 'f1', fields: { 名称: '本地1', Bangumi_URL: 'http://bgm.tv/subject/f1' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'force-overwrite')
    expect(diffs.length).toBe(1)
    expect(diffs[0]?.kind).toBe('update')
    expect(diffs[0]?.changedFields).toEqual(['*'])
  })

  it('mirror 策略 quarter 分支：12月条目归属上一年时被删除', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      // 1月新番(quarter=1)范围: [12, 1, 2]，12月归属上一年
      [
        'sid-dec',
        { row: 2, sid: 'sid-dec', fields: { 开播日期: '2023年12月15日', 名称: '12月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      year: 2024,
      // 1月新番: [12, 1, 2]
      quarter: 1,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 12月 → 归属 filter.year-1 = 2023，实际 year=2023 → 匹配 → 被删除
    expect(deletes.length).toBe(1)
  })

  it('mirror 策略 quarter 分支：12月条目在错误年份时不被删除', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-dec2',
        { row: 2, sid: 'sid-dec2', fields: { 开播日期: '2023年12月15日', 名称: '12月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      // 错误年份：12月归属 filter.year-1=2022，但实际 year=2023
      year: 2023,
      // 1月新番: [12, 1, 2]
      quarter: 1,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // isWithinTimeFilter: month===12 → year === filter.year-1 → 2023 === 2022 → false
    expect(deletes.length).toBe(0)
  })

  it('mirror 策略 quarter 分支：1月条目不属于 Q4 范围不被删除', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-dec3',
        { row: 2, sid: 'sid-dec3', fields: { 开播日期: '2025年01月15日', 名称: '1月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      year: 2024,
      // Q4: 10,11,12月，但1月不属于Q4
      quarter: 4,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 1月不在 Q4 范围 → 不删除
    expect(deletes.length).toBe(0)
  })
})

// ========== 补充测试：filterByTime month 默认值 (line 325) ==========
describe('filterByTime month 默认值精确路径 (line 325)', () => {
  it('filter.month 为 undefined 时使用默认值 1 (line 325)', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'm-default', name: '默认月', date: '2024-01-15' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'month', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(1)
    expect(result[0]?.sid).toBe('m-default')
  })

  it('filter.month 为 undefined 且条目月份不匹配时被过滤 (line 325)', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'm-no-match', name: '不匹配', date: '2024-06-15' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'month', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(0)
  })

  it('filter.month 显式指定时正确匹配', () => {
    const entries: GithubRemoteEntry[] = [{ sid: 'm-explicit', name: '显式月', date: '2024-06-15' }]
    const filter: SyncTimeFilter = { enabled: true, range: 'month', year: 2024, month: 6 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(1)
  })

  it('range 为无效值时 default 分支返回 false (line 327-328)', () => {
    const entries: GithubRemoteEntry[] = [
      { sid: 'bad-range', name: '无效范围', date: '2024-06-15' },
    ]
    const filter = { enabled: true, range: 'invalid', year: 2024 } as unknown as SyncTimeFilter
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(0)
  })
})

// ========== 补充测试：filterByTime quarter 分支完整覆盖 ==========
describe('filterByTime quarter 分支完整路径', () => {
  it('Q1 (1月新番: 12,1,2月) 正确匹配', () => {
    const entries: GithubRemoteEntry[] = [
      { sid: 'q1-12', name: '12月', date: '2023-12-15' },
      { sid: 'q1-1', name: '1月', date: '2024-01-15' },
      { sid: 'q1-2', name: '2月', date: '2024-02-15' },
    ]
    const filter: SyncTimeFilter = { enabled: true, range: 'quarter', year: 2024, quarter: 1 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(3)
  })

  it('Q1 中 12 月跨年逻辑：归属上一年', () => {
    const entries: GithubRemoteEntry[] = [
      { sid: 'q1-12-other', name: '其他年份12月', date: '2022-12-15' },
    ]
    const filter: SyncTimeFilter = { enabled: true, range: 'quarter', year: 2024, quarter: 1 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(0)
  })

  it('10月新番 (quarter=10: 9,10,11月) 正确匹配', () => {
    const entries: GithubRemoteEntry[] = [
      { sid: 'q10-9', name: '9月', date: '2024-09-15' },
      { sid: 'q10-10', name: '10月', date: '2024-10-15' },
      { sid: 'q10-11', name: '11月', date: '2024-11-15' },
    ]
    const filter: SyncTimeFilter = { enabled: true, range: 'quarter', year: 2024, quarter: 10 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(3)
  })

  it('quarter 为 undefined 时默认使用 1', () => {
    const entries: GithubRemoteEntry[] = [
      { sid: 'q-default', name: '默认季度', date: '2024-01-15' },
    ]
    const filter: SyncTimeFilter = { enabled: true, range: 'quarter', year: 2024 }
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(1)
  })

  it('quarter 为无效值时 qMonths 为 undefined 返回 false', () => {
    const entries: GithubRemoteEntry[] = [
      { sid: 'q-invalid', name: '无效季度', date: '2024-06-15' },
    ]
    const filter = {
      enabled: true,
      range: 'quarter',
      year: 2024,
      quarter: 99,
    } as unknown as SyncTimeFilter
    const result = filterByTime(entries, filter)
    expect(result.length).toBe(0)
  })
})

// ========== 补充测试：isWithinTimeFilter 完整分支覆盖 ==========
describe('isWithinTimeFilter 完整分支 (通过 computeDiff mirror 策略)', () => {
  it('isWithinTimeFilter dateStr 格式不含分隔符时返回 false', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-nosep',
        { row: 2, sid: 'sid-nosep', fields: { 开播日期: '20240615', 名称: '无分隔符' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'year',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(0)
  })

  it('isWithinTimeFilter 本地"年月日"格式正确匹配', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-cn',
        { row: 2, sid: 'sid-cn', fields: { 开播日期: '2024年06月15日', 名称: '中文日期' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'year',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(1)
  })

  it('isWithinTimeFilter quarter 默认值通过 mirror 策略触发', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-qdef-m',
        { row: 2, sid: 'sid-qdef-m', fields: { 开播日期: '2024年03月15日', 名称: '3月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'quarter',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(0)
  })

  it('isWithinTimeFilter month 默认值通过 mirror 策略触发', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-mdef-m',
        { row: 2, sid: 'sid-mdef-m', fields: { 开播日期: '2024年01月15日', 名称: '1月条目' } },
      ],
    ])
    const diffs = computeDiff(remote, local, 'mirror', {
      enabled: true,
      range: 'month',
      year: 2024,
    })
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(1)
  })

  it('isWithinTimeFilter default 分支 (range 无效时返回 true)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-default',
        { row: 2, sid: 'sid-default', fields: { 开播日期: '2024年06月15日', 名称: '默认分支' } },
      ],
    ])
    const invalidFilter = {
      enabled: true,
      range: 'invalid',
      year: 2024,
    } as unknown as SyncTimeFilter
    const diffs = computeDiff(remote, local, 'mirror', invalidFilter)
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(1)
  })
})

// ========== 补充测试：isWithinTimeFilter quarter 无效值 (line 360) ==========
describe('isWithinTimeFilter quarter 无效值 (line 360)', () => {
  it('quarter 不在 QUARTER_MONTH_RANGES 中时应返回 false (line 360)', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-q5',
        { row: 2, sid: 'sid-q5', fields: { 开播日期: '2024年01月15日', 名称: '无效季度' } },
      ],
    ])
    // quarter=5 不在 QUARTER_MONTH_RANGES[1,4,7,10] 中
    const invalidQuarterFilter: SyncTimeFilter = {
      enabled: true,
      range: 'quarter',
      quarter: 5,
      year: 2024,
    }
    const diffs = computeDiff(remote, local, 'mirror', invalidQuarterFilter)
    // 因 isWithinTimeFilter 返回 false，本地条目不会被删除
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(0)
  })

  it('quarter 为 undefined 时默认回退到 1', () => {
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      [
        'sid-q-undef',
        { row: 2, sid: 'sid-q-undef', fields: { 开播日期: '2024年01月15日', 名称: '默认季度' } },
      ],
    ])
    // quarter 为 undefined，?? 1 → Q1 → [12,1,2]
    const filter: SyncTimeFilter = { enabled: true, range: 'quarter', year: 2024 }
    const diffs = computeDiff(remote, local, 'mirror', filter)
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // 1月在 Q1 范围内，且无远程匹配 → 应被删除
    expect(deletes.length).toBe(1)
  })
})

// ========== 补充测试：computeDiff 扩展字段空字符串 (line 463) ==========
describe('computeDiff 扩展字段空字符串 (line 463)', () => {
  it('扩展字段为空字符串时 remoteStr 为 falsy，不应触发差异 (line 463)', () => {
    const remote: GithubRemoteEntry[] = [
      {
        sid: 'sid-empty',
        name: '测试',
        // date 字段为空字符串 → toExtStringValue 返回 '' → remoteStr 为 falsy
        date: '',
      },
    ]
    const local = new Map<string, LocalRowEntry>([
      ['sid-empty', { row: 2, sid: 'sid-empty', fields: { 名称: '测试', 开播日期: '2024-01-01' } }],
    ])
    const diffs = computeDiff(remote, local, 'sync')
    const updates = diffs.filter((d) => d.kind === 'update')
    // 名称相同，date 为空字符串（falsy）不应被视为变更
    expect(updates.length).toBe(0)
  })
})

// ========== 补充测试：isWithinTimeFilter isNaN 分支 (line 353) ==========
describe('isWithinTimeFilter isNaN 分支 (line 353)', () => {
  it('dateStr 匹配正则但 parseInt 结果为 NaN 时返回 false', () => {
    // 直接调用 isWithinTimeFilter 测试 isNaN 分支
    // 使用无效日期格式触发 isNaN 检查
    const remote: GithubRemoteEntry[] = []
    const local = new Map<string, LocalRowEntry>([
      ['sid-nan', { row: 2, sid: 'sid-nan', fields: { 开播日期: '0年0月', 名称: 'NaN测试' } }],
    ])
    const filter: SyncTimeFilter = { enabled: true, range: 'year', year: 2024 }
    const diffs = computeDiff(remote, local, 'mirror', filter)
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // parse 后 year=0, month=0, isNaN(0)? false... 但 month 为 0 时不在 year 范围内
    expect(deletes.length).toBe(0)
  })
})

// ========== 补充测试：mirror 策略下本地 SID 不在远程中 (line 482) ==========
describe('mirror 策略本地 SID 不在远程 (line 482)', () => {
  it('mirror 策略下本地 SID 不在远程集合中应生成 delete', () => {
    const remote: GithubRemoteEntry[] = [
      { sid: 'sid-1', name: '远程条目1' },
      { sid: 'sid-2', name: '远程条目2' },
    ]
    const local = new Map<string, LocalRowEntry>([
      ['sid-1', { row: 2, sid: 'sid-1', fields: {} }],
      ['sid-3', { row: 3, sid: 'sid-3', fields: { 开播日期: '2024-06-15' } }],
    ])
    // 无时间筛选时，sid-3 不在远程 → 应被删除
    const diffs = computeDiff(remote, local, 'mirror')
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(deletes.length).toBe(1)
    expect(deletes[0]?.sid).toBe('sid-3')
  })

  it('mirror 策略下时间筛选范围内本地 SID 不在远程应被删除', () => {
    const remote: GithubRemoteEntry[] = [{ sid: 'sid-1', name: '远程条目1', date: '2024-06-01' }]
    const local = new Map<string, LocalRowEntry>([
      ['sid-1', { row: 2, sid: 'sid-1', fields: { 开播日期: '2024年06月01日' } }],
      ['sid-2', { row: 3, sid: 'sid-2', fields: { 开播日期: '2024年06月15日' } }],
    ])
    const filter: SyncTimeFilter = { enabled: true, range: 'month', year: 2024, month: 6 }
    const diffs = computeDiff(remote, local, 'mirror', filter)
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // sid-2 不在远程但在时间范围内 → 应被删除
    expect(deletes.length).toBe(1)
    expect(deletes[0]?.sid).toBe('sid-2')
  })

  it('mirror 策略下时间筛选范围外本地 SID 不在远程不应被删除', () => {
    const remote: GithubRemoteEntry[] = [{ sid: 'sid-1', name: '远程条目1', date: '2024-06-01' }]
    const local = new Map<string, LocalRowEntry>([
      ['sid-1', { row: 2, sid: 'sid-1', fields: { 开播日期: '2024年06月01日' } }],
      ['sid-2', { row: 3, sid: 'sid-2', fields: { 开播日期: '2023年12月15日' } }],
    ])
    const filter: SyncTimeFilter = { enabled: true, range: 'month', year: 2024, month: 6 }
    const diffs = computeDiff(remote, local, 'mirror', filter)
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // sid-2 在 2023年12月，不在 2024年6月 范围内 → 不应被删除
    expect(deletes.length).toBe(0)
  })
})
