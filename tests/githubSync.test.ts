import { describe, it, expect } from 'vitest'

// 从纯函数模块导入，避开 index.ts → handlers.ts 的 document 副作用链。
// githubSyncDiff.ts 为零项目依赖纯模块，可在 Node 测试环境中直接运行。
import {
  computeDiff,
  parseJsonl,
  isGithubRemoteEntry,
  SYNC_STRATEGY_LABELS,
  type GithubRemoteEntry,
  type LocalRowEntry,
  type SyncStrategy,
} from '../ts/sync/githubSyncDiff.js'

describe('computeDiff', () => {
  it('远程有本地无 → 标记为 add', () => {
    const remote: GithubRemoteEntry[] = [{ sid: '111', name: '条目A', type: 3, score: 8 }]
    const local = new Map<string, LocalRowEntry>()
    const diffs = computeDiff(remote, local)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.kind).toBe('add')
    expect(diffs[0]?.sid).toBe('111')
    expect(diffs[0]?.changedFields).toEqual(['*'])
  })

  it('远程与本地完全一致 → 无差异', () => {
    const remote: GithubRemoteEntry[] = [{ sid: '222', name: '相同名称', type: 3, score: 7 }]
    const local = new Map<string, LocalRowEntry>([
      [
        '222',
        {
          row: 2,
          sid: '222',
          fields: {
            名称: '相同名称',
            是否看完: '看过',
            打分: '7',
          },
        },
      ],
    ])
    const diffs = computeDiff(remote, local)
    expect(diffs).toHaveLength(0)
  })

  it('名称变更 → 标记为 update，仅含名称字段', () => {
    const remote: GithubRemoteEntry[] = [{ sid: '333', name: '新名称', type: 3, score: 7 }]
    const local = new Map<string, LocalRowEntry>([
      [
        '333',
        {
          row: 3,
          sid: '333',
          fields: {
            名称: '旧名称',
            是否看完: '看过',
            打分: '7',
          },
        },
      ],
    ])
    const diffs = computeDiff(remote, local)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.kind).toBe('update')
    expect(diffs[0]?.changedFields).toEqual(['名称'])
    expect(diffs[0]?.localRow).toBe(3)
  })

  it('多个字段变更 → 全部列入 changedFields', () => {
    const remote: GithubRemoteEntry[] = [
      { sid: '444', name: '新名', type: 2, score: 9, tags: ['Tag1', 'Tag2'], comment: '新评论' },
    ]
    const local = new Map<string, LocalRowEntry>([
      [
        '444',
        {
          row: 4,
          sid: '444',
          fields: {
            名称: '旧名',
            是否看完: '看过',
            打分: '7',
            '标签/分级': 'OldTag',
            '剧透/感言': '旧评论',
          },
        },
      ],
    ])
    const diffs = computeDiff(remote, local)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.changedFields).toEqual(
      expect.arrayContaining(['名称', '是否看完', '打分', '标签/分级', '剧透/感言']),
    )
  })

  it('远程字段为空 → 不视为差异（保留本地）', () => {
    const remote: GithubRemoteEntry[] = [
      { sid: '555', name: undefined, type: undefined, score: undefined },
    ]
    const local = new Map<string, LocalRowEntry>([
      [
        '555',
        {
          row: 5,
          sid: '555',
          fields: {
            名称: '本地名称',
            是否看完: '在看',
            打分: '5',
          },
        },
      ],
    ])
    const diffs = computeDiff(remote, local)
    expect(diffs).toHaveLength(0)
  })

  it('type 映射为观看状态文本后比对', () => {
    const remote: GithubRemoteEntry[] = [{ sid: '666', type: 2 }]
    const local = new Map<string, LocalRowEntry>([
      [
        '666',
        {
          row: 6,
          sid: '666',
          fields: {
            是否看完: '在看', // type=2 → '在看'
          },
        },
      ],
    ])
    const diffs = computeDiff(remote, local)
    expect(diffs).toHaveLength(0)
  })
})

// ========== 同步策略测试 ==========

describe('computeDiff 策略修饰', () => {
  // 公共测试数据：远程 3 条（sid=1 新增，sid=2 需更新，sid=3 无变化），本地 3 条（sid=2、3、4，sid=4 远程不存在）
  const remote: GithubRemoteEntry[] = [
    { sid: '1', name: '远程新增', type: 2, score: 8 },
    { sid: '2', name: '远程改名', type: 3, score: 9 }, // 本地 sid=2 名称+是否看完均不同
    { sid: '3', name: '一致', type: 3, score: 7 }, // 本地 sid=3 完全一致（type=3→'看过'）
  ]
  const local = new Map<string, LocalRowEntry>([
    ['2', { row: 10, sid: '2', fields: { 名称: '本地名', 是否看完: '在看', 打分: '9' } }],
    ['3', { row: 11, sid: '3', fields: { 名称: '一致', 是否看完: '看过', 打分: '7' } }],
    ['4', { row: 12, sid: '4', fields: { 名称: '本地多余', 是否看完: '想看', 打分: '6' } }],
  ])

  it('SYNC_STRATEGY_LABELS 应包含 5 种策略', () => {
    const keys = Object.keys(SYNC_STRATEGY_LABELS)
    expect(keys).toHaveLength(5)
    expect(keys).toContain('add-update')
    expect(keys).toContain('add-only')
    expect(keys).toContain('update-only')
    expect(keys).toContain('mirror')
    expect(keys).toContain('force-overwrite')
  })

  it('默认策略 add-update：add + update，无 delete', () => {
    const diffs = computeDiff(remote, local)
    const addCount = diffs.filter((d) => d.kind === 'add').length
    const updateCount = diffs.filter((d) => d.kind === 'update').length
    const deleteCount = diffs.filter((d) => d.kind === 'delete').length
    // sid=1 新增，sid=2 更新（名称+是否看完），sid=3 无变化，sid=4 不处理
    expect(addCount).toBe(1)
    expect(updateCount).toBe(1)
    expect(deleteCount).toBe(0)
  })

  it('策略 add-only：仅 add，已存在 SID 全跳过', () => {
    const diffs = computeDiff(remote, local, 'add-only')
    const adds = diffs.filter((d) => d.kind === 'add')
    const updates = diffs.filter((d) => d.kind === 'update')
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(adds).toHaveLength(1)
    expect(adds[0]?.sid).toBe('1')
    expect(updates).toHaveLength(0)
    expect(deletes).toHaveLength(0)
  })

  it('策略 update-only：仅 update，本地不存在的 SID 全跳过', () => {
    const diffs = computeDiff(remote, local, 'update-only')
    const adds = diffs.filter((d) => d.kind === 'add')
    const updates = diffs.filter((d) => d.kind === 'update')
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // sid=1 远程有但本地无 → 跳过（update-only 不新增）
    // sid=2 需更新 → 1 个 update
    // sid=3 无变化 → 不在 diffs 中
    expect(adds).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.sid).toBe('2')
    expect(deletes).toHaveLength(0)
  })

  it('策略 mirror：add + update + delete 本地多余行', () => {
    const diffs = computeDiff(remote, local, 'mirror')
    const adds = diffs.filter((d) => d.kind === 'add')
    const updates = diffs.filter((d) => d.kind === 'update')
    const deletes = diffs.filter((d) => d.kind === 'delete')
    expect(adds).toHaveLength(1)
    expect(updates).toHaveLength(1)
    // sid=4 本地有远程无 → delete
    expect(deletes).toHaveLength(1)
    expect(deletes[0]?.sid).toBe('4')
    expect(deletes[0]?.localRow).toBe(12)
  })

  it('策略 force-overwrite：所有已存在 SID 强制标记为 update（changedFields=[*]）', () => {
    const diffs = computeDiff(remote, local, 'force-overwrite')
    const adds = diffs.filter((d) => d.kind === 'add')
    const updates = diffs.filter((d) => d.kind === 'update')
    const deletes = diffs.filter((d) => d.kind === 'delete')
    // sid=1 本地无 → add
    // sid=2、sid=3 本地有 → 强制 update（即使 sid=3 字段一致）
    expect(adds).toHaveLength(1)
    expect(updates).toHaveLength(2)
    expect(deletes).toHaveLength(0)
    // 所有 update 的 changedFields 都应是 ['*']
    expect(updates.every((u) => u.changedFields.includes('*'))).toBe(true)
  })

  it('策略 mirror 在远程=本地时无 delete', () => {
    // 远程与本地完全一致（SID 集合相同）
    const r: GithubRemoteEntry[] = [{ sid: '1', name: 'A', type: 2 }]
    const l = new Map<string, LocalRowEntry>([
      ['1', { row: 5, sid: '1', fields: { 名称: 'A', 是否看完: '看过' } }],
    ])
    const diffs = computeDiff(r, l, 'mirror')
    expect(diffs.filter((d) => d.kind === 'delete')).toHaveLength(0)
    expect(diffs.filter((d) => d.kind === 'add')).toHaveLength(0)
    // 是否看完 在远程 type=2 → '在看'，本地 '看过'，故 1 个 update
    expect(diffs.filter((d) => d.kind === 'update')).toHaveLength(1)
  })
})

// ========== JSONL 解析测试 ==========

describe('parseJsonl', () => {
  it('空字符串返回空数组无错误', () => {
    const { entries, errors } = parseJsonl('')
    expect(entries).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  it('单行合法 JSON → 1 条记录', () => {
    const text = '{"sid":"123","name":"测试","type":2,"score":8}'
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.sid).toBe('123')
    expect(entries[0]?.name).toBe('测试')
    expect(errors).toHaveLength(0)
  })

  it('多行 JSONL → 全部解析', () => {
    const text = [
      '{"sid":"1","name":"A"}',
      '{"sid":"2","name":"B"}',
      '{"sid":"3","name":"C"}',
    ].join('\n')
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.sid)).toEqual(['1', '2', '3'])
    expect(errors).toHaveLength(0)
  })

  it('CRLF 换行也能正确解析', () => {
    const text = '{"sid":"1"}\r\n{"sid":"2"}\r\n{"sid":"3"}'
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(3)
    expect(errors).toHaveLength(0)
  })

  it('空行被跳过不视为错误', () => {
    const text = '{"sid":"1"}\n\n  \n{"sid":"2"}\n'
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(2)
    expect(errors).toHaveLength(0)
  })

  it('非法 JSON 行不中断整体解析，记录到 errors', () => {
    const text = [
      '{"sid":"1","name":"A"}',
      '{this is invalid',
      '{"sid":"2","name":"B"}',
      'not json at all',
    ].join('\n')
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.sid).toBe('1')
    expect(entries[1]?.sid).toBe('2')
    expect(errors).toHaveLength(2)
    expect(errors[0]?.line).toBe(2)
    expect(errors[1]?.line).toBe(4)
  })

  it('对象缺少 sid 字段 → 视为错误', () => {
    const text = '{"name":"无sid"}\n{"sid":"1","name":"有sid"}'
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.sid).toBe('1')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.line).toBe(1)
  })

  it('sid 非字符串（数字）→ 视为错误', () => {
    const text = '{"sid":12345,"name":"数字sid"}'
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it('首尾空白行被 trim 后跳过', () => {
    const text = '   {"sid":"1"}   \n   {"sid":"2"}   '
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(2)
    expect(errors).toHaveLength(0)
  })

  it('带全部字段的完整记录正确解析', () => {
    const text =
      '{"sid":"12345","url":"https://bgm.tv/subject/12345","name":"测试","type":2,"score":8,"tags":["标签1","标签2"],"comment":"评论","episode":12,"updatedAt":"2026-07-21"}'
    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(1)
    expect(errors).toHaveLength(0)
    const entry = entries[0]!
    expect(entry.sid).toBe('12345')
    expect(entry.url).toBe('https://bgm.tv/subject/12345')
    expect(entry.name).toBe('测试')
    expect(entry.type).toBe(2)
    expect(entry.score).toBe(8)
    expect(entry.tags).toEqual(['标签1', '标签2'])
    expect(entry.comment).toBe('评论')
    expect(entry.episode).toBe(12)
    expect(entry.updatedAt).toBe('2026-07-21')
  })
})

describe('isGithubRemoteEntry', () => {
  it('有字符串 sid 的对象 → true', () => {
    expect(isGithubRemoteEntry({ sid: '1', name: 'A' })).toBe(true)
  })

  it('无 sid 字段 → false', () => {
    expect(isGithubRemoteEntry({ name: 'A' })).toBe(false)
  })

  it('sid 为数字 → false', () => {
    expect(isGithubRemoteEntry({ sid: 123 })).toBe(false)
  })

  it('null → false', () => {
    expect(isGithubRemoteEntry(null)).toBe(false)
  })

  it('字符串 → false', () => {
    expect(isGithubRemoteEntry('not an object')).toBe(false)
  })
})
