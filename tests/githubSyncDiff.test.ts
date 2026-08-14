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
} from '../ts/sync/githubSyncDiff.js'
import type {
  GithubRemoteEntry,
  SyncStrategy,
  SyncTimeFilter,
  GithubSyncDiff,
  LocalRowEntry,
} from '../ts/sync/githubSyncDiff.js'

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
    expect(SYNC_STRATEGY_LABELS['mirror']).toBe('镜像同步（含删除）')
    expect(SYNC_STRATEGY_LABELS['force-overwrite']).toBe('强制覆盖')
  })
})
