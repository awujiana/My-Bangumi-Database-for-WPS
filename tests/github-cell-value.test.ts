/**
 * GitHub 同步单单元格取值规则单测（P1-G 抽取配套 P1-H 安全网）
 *
 * 被测模块 github-cell-value.ts 依赖链全部为零依赖纯模块
 * （github-sync-diff.ts / github-time-format.ts / tools/string-utilities-pure.ts），
 * 故本测试**不 mock 任何模块**，全部走真实实现，覆盖「新增取值」与
 * 「更新取值（名称/标签合并策略、别名列映射、强制覆盖）」两套核心业务规则。
 */

import { describe, expect, it } from 'vitest'

import { resolveNewRowCellValue, resolveUpdateCellValue } from '../ts/sync/github-cell-value.js'
import type { GithubRemoteEntry } from '../ts/sync/github-sync-diff.js'

function makeRemote(overrides: Partial<GithubRemoteEntry> = {}): GithubRemoteEntry {
  return { sid: '12345', ...overrides }
}

describe('resolveNewRowCellValue', () => {
  it('Bangumi_URL 列由 sid 构造完整 URL', () => {
    expect(resolveNewRowCellValue({ name: 'Bangumi_URL' }, { remote: makeRemote() })).toBe(
      'https://bgm.tv/subject/12345',
    )
  })

  it('名称列取远端名称，缺省返回 null', () => {
    expect(
      resolveNewRowCellValue({ name: '名称' }, { remote: makeRemote({ name: '孤独摇滚' }) }),
    ).toBe('孤独摇滚')
    expect(resolveNewRowCellValue({ name: '名称' }, { remote: makeRemote() })).toBeNull()
  })

  it('标签/分级列用 | 连接 meta_tags，空数组返回 null', () => {
    const entry = { remote: makeRemote({ meta_tags: ['科幻', '恋爱'] }) }
    expect(resolveNewRowCellValue({ name: '标签/分级' }, entry)).toBe('科幻|恋爱')
    expect(resolveNewRowCellValue({ name: '标签/分级' }, { remote: makeRemote() })).toBeNull()
  })

  it('集数列取「话数」字段，缺省返回 null', () => {
    expect(resolveNewRowCellValue({ name: '集数' }, { remote: makeRemote({ 话数: '12' }) })).toBe(
      '12',
    )
    expect(resolveNewRowCellValue({ name: '集数' }, { remote: makeRemote() })).toBeNull()
  })

  it('日期列经 formatDateToLocal 本地化，失败回落原值', () => {
    expect(
      resolveNewRowCellValue({ name: '开播日期' }, { remote: makeRemote({ date: '2024-01-05' }) }),
    ).toBe('2024年01月05日')
    expect(
      resolveNewRowCellValue(
        { name: '完播日' },
        { remote: makeRemote({ 播放结束: '2024-03-29' }) },
      ),
    ).toBe('2024年03月29日')
    expect(
      resolveNewRowCellValue({ name: '开播日期' }, { remote: makeRemote({ date: '未知' }) }),
    ).toBe('未知')
  })

  it('扩展字段经别名映射取值（含「制作公司」别名）', () => {
    const remote = makeRemote({ 动画制作公司: 'CloverWorks', 片长: '24' })
    expect(resolveNewRowCellValue({ name: '制作公司' }, { remote })).toBe('CloverWorks')
    expect(resolveNewRowCellValue({ name: '动画制作公司' }, { remote })).toBe('CloverWorks')
    expect(resolveNewRowCellValue({ name: '时长' }, { remote })).toBe('24')
  })

  it('扩展字段为数字时统一转字符串', () => {
    // 越界输入：GithubRemoteEntry 的扩展字段声明为 string，此处刻意注入数字
    // 以覆盖 typeof === 'number' 分支（该分支用于兜底远程 JSON 字段类型漂移）
    const remote = { sid: '1', date: 2024 } as unknown as GithubRemoteEntry
    expect(resolveNewRowCellValue({ name: '开播日期' }, { remote })).toBe('2024')
  })

  it('未知列名返回 null', () => {
    expect(resolveNewRowCellValue({ name: '不存在的列' }, { remote: makeRemote() })).toBeNull()
  })
})

describe('resolveUpdateCellValue', () => {
  it('Bangumi_URL：writeAll 或字段命中时写入，否则跳过', () => {
    expect(
      resolveUpdateCellValue({ name: 'Bangumi_URL' }, makeRemote(), [], true, false, ''),
    ).toEqual({
      value: 'https://bgm.tv/subject/12345',
      shouldWrite: true,
    })
    expect(
      resolveUpdateCellValue(
        { name: 'Bangumi_URL' },
        makeRemote(),
        ['Bangumi_URL'],
        false,
        false,
        '',
      ),
    ).toEqual({ value: 'https://bgm.tv/subject/12345', shouldWrite: true })
    expect(
      resolveUpdateCellValue({ name: 'Bangumi_URL' }, makeRemote(), [], false, false, ''),
    ).toEqual({
      value: null,
      shouldWrite: false,
    })
  })

  it('别名：普通更新时把名称追加到本地别名（去重），无变化则不写', () => {
    expect(
      resolveUpdateCellValue(
        { name: '别名' },
        makeRemote({ name: '新名' }),
        ['名称'],
        false,
        false,
        '旧名',
      ),
    ).toEqual({ value: '旧名 | 新名', shouldWrite: true })
    // 已包含 → 合并结果与旧值相同 → 不写
    expect(
      resolveUpdateCellValue(
        { name: '别名' },
        makeRemote({ name: '旧名' }),
        ['名称'],
        false,
        false,
        '旧名',
      ),
    ).toEqual({ value: null, shouldWrite: false })
    // 远程名称为空 → 不写
    expect(
      resolveUpdateCellValue({ name: '别名' }, makeRemote(), ['名称'], false, false, '旧名'),
    ).toEqual({
      value: null,
      shouldWrite: false,
    })
  })

  it('别名：强制覆盖或 writeAll 时不处理（交由名称列）', () => {
    const remote = makeRemote({ name: '新名' })
    expect(resolveUpdateCellValue({ name: '别名' }, remote, ['名称'], false, true, '旧名')).toEqual(
      {
        value: null,
        shouldWrite: false,
      },
    )
    expect(resolveUpdateCellValue({ name: '别名' }, remote, ['名称'], true, false, '旧名')).toEqual(
      {
        value: null,
        shouldWrite: false,
      },
    )
  })

  it('名称：仅强制覆盖 / writeAll / 字段命中时写入，缺名称回落空串', () => {
    expect(
      resolveUpdateCellValue({ name: '名称' }, makeRemote({ name: 'A' }), [], false, true, ''),
    ).toEqual({ value: 'A', shouldWrite: true })
    expect(resolveUpdateCellValue({ name: '名称' }, makeRemote(), [], true, false, '')).toEqual({
      value: '',
      shouldWrite: true,
    })
    expect(
      resolveUpdateCellValue(
        { name: '名称' },
        makeRemote({ name: 'A' }),
        ['名称'],
        false,
        false,
        '',
      ),
    ).toEqual({ value: 'A', shouldWrite: true })
    expect(
      resolveUpdateCellValue({ name: '名称' }, makeRemote({ name: 'A' }), [], false, false, ''),
    ).toEqual({ value: null, shouldWrite: false })
  })

  it('标签/分级：写入范围内「强制覆盖直接写 / 普通更新合并去重」', () => {
    const remote = makeRemote({ meta_tags: ['恋爱'] })
    // 注意：shouldForceOverwrite 只决定「直接写」还是「合并」，
    // **是否写入**由 isWriteAll / fields 决定 —— 字段未命中且非 writeAll 时即便
    // 强制覆盖也不写（与抽取前 github-sync.ts 的语义一致，勿按直觉改生产代码）。
    expect(
      resolveUpdateCellValue({ name: '标签/分级' }, remote, ['标签/分级'], false, true, '科幻'),
    ).toEqual({ value: '恋爱', shouldWrite: true })
    expect(
      resolveUpdateCellValue({ name: '标签/分级' }, remote, ['标签/分级'], false, false, '科幻'),
    ).toEqual({ value: '科幻 | 恋爱', shouldWrite: true })
    // 合并后无变化 → 不写
    expect(
      resolveUpdateCellValue({ name: '标签/分级' }, remote, ['标签/分级'], false, false, '恋爱'),
    ).toEqual({ value: null, shouldWrite: false })
    expect(resolveUpdateCellValue({ name: '标签/分级' }, remote, [], false, true, '科幻')).toEqual({
      value: null,
      shouldWrite: false,
    })
  })

  it('标签/分级：远程无标签或字段未命中则不写', () => {
    expect(
      resolveUpdateCellValue({ name: '标签/分级' }, makeRemote(), [], false, true, '旧'),
    ).toEqual({
      value: null,
      shouldWrite: false,
    })
    expect(
      resolveUpdateCellValue(
        { name: '标签/分级' },
        makeRemote({ meta_tags: ['x'] }),
        [],
        false,
        false,
        '旧',
      ),
    ).toEqual({ value: null, shouldWrite: false })
  })

  it('集数：字段命中时写入「话数」，缺省回落空串', () => {
    expect(
      resolveUpdateCellValue(
        { name: '集数' },
        makeRemote({ 话数: '12' }),
        ['集数'],
        false,
        false,
        '',
      ),
    ).toEqual({ value: '12', shouldWrite: true })
    expect(
      resolveUpdateCellValue({ name: '集数' }, makeRemote(), ['集数'], false, false, ''),
    ).toEqual({
      value: '',
      shouldWrite: true,
    })
    expect(
      resolveUpdateCellValue({ name: '集数' }, makeRemote({ 话数: '12' }), [], false, false, ''),
    ).toEqual({
      value: null,
      shouldWrite: false,
    })
  })

  it('扩展字段：writeAll 写入并本地化日期，别名命中亦可', () => {
    const remote = makeRemote({ date: '2024-01-05', 动画制作公司: 'MAPPA' })
    expect(resolveUpdateCellValue({ name: '开播日期' }, remote, [], true, false, '')).toEqual({
      value: '2024年01月05日',
      shouldWrite: true,
    })
    expect(
      resolveUpdateCellValue({ name: '制作公司' }, remote, ['动画制作公司'], false, false, ''),
    ).toEqual({ value: 'MAPPA', shouldWrite: true })
  })

  it('扩展字段：字段未命中返回不写', () => {
    const remote = makeRemote({ 动画制作公司: 'MAPPA' })
    expect(resolveUpdateCellValue({ name: '制作公司' }, remote, [], false, false, '')).toEqual({
      value: null,
      shouldWrite: false,
    })
  })

  it('未知列名返回不写', () => {
    expect(resolveUpdateCellValue({ name: '无此列' }, makeRemote(), [], true, true, '')).toEqual({
      value: null,
      shouldWrite: false,
    })
  })
})
