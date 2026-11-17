/**
 * 分片数据源：清单解析、按表头选片、按行拼接
 *
 * 数据仓库已从「单片 data/bangumi.jsonlines.gz」改为「6 个字段分片 + 一份清单」，
 * 本文件守住三件事：
 *   1. 清单解析对畸形输入一律返回 null，绝不抛异常（调用方要靠它决定是否回退旧单片）；
 *   2. 选片结果**必须含 base**（sid/updatedAt/name 都在里面，缺了拼不出记录）；
 *   3. 拼接时各片行数不一致要报错而不是静默产出错行记录。
 */

import { describe, expect, it } from 'vitest'

import {
  buildFieldIndex,
  isManifestPath,
  joinShardRows,
  neededFieldsForColumns,
  parseShardManifest,
  parseShardText,
  resolveSiblingPath,
  selectShards,
} from '../ts/sync/shard-manifest.js'
import type { ShardData, ShardManifest } from '../ts/sync/shard-manifest.js'

/** 与真实数据仓库一致的 6 片清单 */
function makeManifest(): ShardManifest {
  return {
    formatVersion: 1,
    subjectType: 2,
    typeLabel: 'anime',
    updatedAt: '2026-09-08',
    recordCount: 2,
    shards: [
      {
        name: 'base',
        file: 'anime.base.jsonlines.gz',
        fields: ['sid', 'name', 'name_original', 'updatedAt', 'date', 'meta_tags', 'nsfw'],
      },
      { name: 'meta', file: 'anime.meta.jsonlines.gz', fields: ['sid', '话数', '导演', '别名'] },
      { name: 'relations', file: 'anime.relations.jsonlines.gz', fields: ['sid', '关联的动漫ID'] },
      {
        name: 'stats',
        file: 'anime.stats.jsonlines.gz',
        fields: ['sid', 'platform', 'series', 'score', 'rank', 'tags'],
      },
      { name: 'summary', file: 'anime.summary.jsonlines.gz', fields: ['sid', 'summary'] },
      { name: 'infobox', file: 'anime.infobox.jsonlines.gz', fields: ['sid', 'infobox'] },
    ],
  }
}

describe('parseShardManifest', () => {
  it('解析出完整结构', () => {
    const manifest = parseShardManifest(JSON.stringify(makeManifest()))

    expect(manifest).not.toBeNull()
    expect(manifest?.typeLabel).toBe('anime')
    expect(manifest?.recordCount).toBe(2)
    expect(manifest?.shards.map((s) => s.name)).toEqual([
      'base',
      'meta',
      'relations',
      'stats',
      'summary',
      'infobox',
    ])
  })

  it('保留 bytes 与 sha256（用于日志与完整性校验）', () => {
    const raw = JSON.stringify({
      formatVersion: 1,
      subjectType: 2,
      typeLabel: 'anime',
      updatedAt: '2026-09-08',
      recordCount: 1,
      shards: [
        {
          name: 'base',
          file: 'anime.base.jsonlines.gz',
          fields: ['sid'],
          bytes: 123,
          sha256: 'ab',
        },
      ],
    })

    const shard = parseShardManifest(raw)?.shards.at(0)

    expect(shard?.bytes).toBe(123)
    expect(shard?.sha256).toBe('ab')
  })

  it.each([
    ['空字符串', ''],
    ['非法 JSON', '{not json'],
    ['顶层不是对象', '[]'],
    ['没有 shards', JSON.stringify({ formatVersion: 1, recordCount: 1 })],
    ['shards 为空数组', JSON.stringify({ formatVersion: 1, recordCount: 1, shards: [] })],
    [
      'shards 项缺 file',
      JSON.stringify({
        formatVersion: 1,
        recordCount: 1,
        shards: [{ name: 'a', fields: ['sid'] }],
      }),
    ],
    [
      'shards 项 fields 为空',
      JSON.stringify({
        formatVersion: 1,
        recordCount: 1,
        shards: [{ name: 'a', file: 'f', fields: [] }],
      }),
    ],
    [
      'fields 含非字符串',
      JSON.stringify({
        formatVersion: 1,
        recordCount: 1,
        shards: [{ name: 'a', file: 'f', fields: [1] }],
      }),
    ],
    [
      'recordCount 非法',
      JSON.stringify({
        formatVersion: 1,
        recordCount: -1,
        shards: [{ name: 'a', file: 'f', fields: ['sid'] }],
      }),
    ],
    [
      '缺少 formatVersion',
      JSON.stringify({ recordCount: 1, shards: [{ name: 'a', file: 'f', fields: ['sid'] }] }),
    ],
  ])('畸形输入返回 null：%s', (_label, text) => {
    expect(parseShardManifest(text)).toBeNull()
  })

  it('格式版本高于支持范围时返回 null（避免误读未来格式）', () => {
    const raw = JSON.stringify({
      formatVersion: 99,
      recordCount: 1,
      shards: [{ name: 'a', file: 'f', fields: ['sid'] }],
    })

    expect(parseShardManifest(raw)).toBeNull()
  })

  it('可选字段缺失时补安全默认值而不是 null', () => {
    const raw = JSON.stringify({
      formatVersion: 1,
      recordCount: 1,
      shards: [{ name: 'a', file: 'f', fields: ['sid'] }],
    })

    const manifest = parseShardManifest(raw)

    expect(manifest?.subjectType).toBe(0)
    expect(manifest?.typeLabel).toBe('')
    expect(manifest?.updatedAt).toBe('')
  })
})

describe('isManifestPath', () => {
  it('认 .json 结尾', () => {
    expect(isManifestPath('data/anime.manifest.json')).toBe(true)
    expect(isManifestPath('  data/anime.manifest.JSON ')).toBe(true)
  })

  it('数据文件不算清单（要走旧单片回退路径）', () => {
    expect(isManifestPath('data/bangumi.jsonlines.gz')).toBe(false)
    expect(isManifestPath('data/anime.base.jsonlines.gz')).toBe(false)
    expect(isManifestPath('')).toBe(false)
  })
})

describe('resolveSiblingPath', () => {
  it('拼到清单所在目录', () => {
    expect(resolveSiblingPath('data/anime.manifest.json', 'anime.base.jsonlines.gz')).toBe(
      'data/anime.base.jsonlines.gz',
    )
  })

  it('清单在仓库根目录时不产生多余斜杠', () => {
    expect(resolveSiblingPath('anime.manifest.json', 'anime.base.jsonlines.gz')).toBe(
      'anime.base.jsonlines.gz',
    )
  })

  it('反斜杠路径也归一化', () => {
    expect(
      resolveSiblingPath(String.raw`data\anime.manifest.json`, 'anime.base.jsonlines.gz'),
    ).toBe('data/anime.base.jsonlines.gz')
  })
})

describe('selectShards', () => {
  it('必选片永远选中（否则拼不出记录）', () => {
    const picked = selectShards(makeManifest(), [])

    expect(picked.map((s) => s.name)).toEqual(['base'])
  })

  // undefined 与 [] 语义不同：前者是「不知道需要什么」（读不到表头）→ 全量下载；
  // 后者是「确实什么都不需要」→ 只下必选片。混同会导致空表同步缺列。
  it('neededFields 为 undefined 时全量下载', () => {
    const picked = selectShards(makeManifest())

    expect(picked.map((s) => s.name)).toEqual([
      'base',
      'meta',
      'relations',
      'stats',
      'summary',
      'infobox',
    ])
  })

  it('neededFields 为 undefined 时手动指定仍然优先', () => {
    const picked = selectShards(makeManifest(), undefined, ['stats'])

    expect(picked.map((s) => s.name)).toEqual(['base', 'stats'])
  })

  it('按需要的字段带出对应分片', () => {
    const picked = selectShards(makeManifest(), ['summary'])

    expect(picked.map((s) => s.name)).toEqual(['base', 'summary'])
  })

  it('按清单顺序返回，不受传入字段顺序影响', () => {
    const picked = selectShards(makeManifest(), ['infobox', 'summary'])

    expect(picked.map((s) => s.name)).toEqual(['base', 'summary', 'infobox'])
  })

  it('只需要 base 里的字段时不下载长文本片（省掉 77% 体积）', () => {
    const picked = selectShards(makeManifest(), ['sid', 'name', 'updatedAt', 'date'])

    expect(picked.map((s) => s.name)).toEqual(['base'])
  })

  it('手动指定时以手动结果为准', () => {
    const picked = selectShards(makeManifest(), ['summary'], ['stats'])

    expect(picked.map((s) => s.name)).toEqual(['base', 'stats'])
  })

  it('手动取消全部可选片仍保留 base', () => {
    const picked = selectShards(makeManifest(), ['summary', 'infobox'], [])

    // 空数组 = 未手动指定 → 回到按表头自动选
    expect(picked.map((s) => s.name)).toEqual(['base', 'summary', 'infobox'])
  })

  it('手动列表含不存在的分片名时忽略它', () => {
    const picked = selectShards(makeManifest(), [], ['stats', 'not-exist'])

    expect(picked.map((s) => s.name)).toEqual(['base', 'stats'])
  })

  it('清单里没有任何必选字段时至少保住第一片', () => {
    const odd: ShardManifest = {
      ...makeManifest(),
      shards: [{ name: 'only', file: 'f', fields: ['foo'] }],
    }

    expect(selectShards(odd, []).map((s) => s.name)).toEqual(['only'])
  })

  // 连接键陷阱（实际踩过两次，各写一条钉住）：
  // 每片都带 sid（线上键），任何拿 sid 当「需要这个字段 / 这是必选片」判据的写法都会让选片失效。
  it('neededFields 里含 sid 时不得把所有片都选中', () => {
    const picked = selectShards(makeManifest(), ['sid', 'updatedAt', 'name'])

    expect(picked.map((s) => s.name)).toEqual(['base'])
  })

  it('只含连接键字段的清单不会把所有片判成必选', () => {
    // 极端情形：所有片都只有 sid，没有任何锚点字段
    const odd: ShardManifest = {
      ...makeManifest(),
      shards: [
        { name: 'a', file: 'a', fields: ['sid'] },
        { name: 'b', file: 'b', fields: ['sid'] },
      ],
    }

    // 无锚点 → 退回「至少保住第一片」，而不是两片都选
    expect(selectShards(odd, ['sid']).map((s) => s.name)).toEqual(['a'])
  })
})

describe('buildFieldIndex', () => {
  it('给出字段到分片的映射', () => {
    const index = buildFieldIndex(makeManifest())

    expect(index.get('score')).toBe('stats')
    expect(index.get('summary')).toBe('summary')
    expect(index.get('话数')).toBe('meta')
  })

  it('sid 归首次出现的片（清单顺序里的 base）', () => {
    expect(buildFieldIndex(makeManifest()).get('sid')).toBe('base')
  })
})

describe('neededFieldsForColumns', () => {
  it('始终包含 sid / name / updatedAt', () => {
    const needed = neededFieldsForColumns([])

    expect(needed.has('sid')).toBe(true)
    expect(needed.has('name')).toBe(true)
    expect(needed.has('updatedAt')).toBe(true)
  })

  it('表里有「评分」「排名」才需要 score / rank', () => {
    expect(neededFieldsForColumns(['名称']).has('score')).toBe(false)
    expect(neededFieldsForColumns(['评分', '排名']).has('score')).toBe(true)
    expect(neededFieldsForColumns(['评分', '排名']).has('rank')).toBe(true)
  })

  it('按别名匹配（制作公司 / 动画制作公司 都算）', () => {
    expect(neededFieldsForColumns(['制作公司']).has('动画制作公司')).toBe(true)
    expect(neededFieldsForColumns(['动画制作公司']).has('动画制作公司')).toBe(true)
    expect(neededFieldsForColumns(['别的东西']).has('动画制作公司')).toBe(false)
  })

  it('独立处理的列也要带上（集数 / 标签分级）', () => {
    const needed = neededFieldsForColumns(['集数', '标签/分级'])

    expect(needed.has('话数')).toBe(true)
    expect(needed.has('meta_tags')).toBe(true)
  })

  it('列名两侧空白被忽略', () => {
    expect(neededFieldsForColumns([' 评分 ']).has('score')).toBe(true)
  })

  it('极简表（只有名称）不需要任何长文本片', () => {
    const needed = neededFieldsForColumns(['名称'])
    const manifest = makeManifest()
    const picked = selectShards(manifest, needed)

    expect(picked.map((s) => s.name)).toEqual(['base'])
  })

  it('标准 Excel 表会带上 meta / relations / stats 但不带长文本片', () => {
    const needed = neededFieldsForColumns([
      '名称',
      '开播日期',
      '完播日',
      '制作公司',
      '集数',
      '时长',
      '导演',
      '关联的动漫ID',
      '评分',
      '排名',
    ])
    const picked = selectShards(makeManifest(), needed).map((s) => s.name)

    expect(picked).toContain('base')
    expect(picked).toContain('meta')
    expect(picked).toContain('relations')
    expect(picked).toContain('stats')
    expect(picked).not.toContain('summary')
    expect(picked).not.toContain('infobox')
  })
})

describe('parseShardText', () => {
  it('解析表头与值数组', () => {
    const text = ['["sid","name"]', '["1","A"]', '["2","B"]'].join('\n')

    const data = parseShardText('base', text)

    expect(data?.fields).toEqual(['sid', 'name'])
    expect(data?.rows).toEqual([
      ['1', 'A'],
      ['2', 'B'],
    ])
  })

  it('忽略空行与首尾空白', () => {
    const text = '\n["sid"]\n\n["1"]\n  \n'

    expect(parseShardText('base', text)?.rows).toEqual([['1']])
  })

  it('首行不是纯字符串数组时返回 null', () => {
    expect(parseShardText('base', '{"sid":1}')).toBeNull()
    expect(parseShardText('base', '[1,2]')).toBeNull()
    expect(parseShardText('base', '')).toBeNull()
    expect(parseShardText('base', '{not json')).toBeNull()
  })

  it('跳过长度不符或非法 JSON 的行（与 parseJsonl 的容错一致）', () => {
    const text = ['["sid","name"]', '["1","A"]', '{bad', '["2"]', '["3","C"]'].join('\n')

    expect(parseShardText('base', text)?.rows).toEqual([
      ['1', 'A'],
      ['3', 'C'],
    ])
  })
})

describe('joinShardRows', () => {
  const base: ShardData = {
    name: 'base',
    fields: ['sid', 'name'],
    rows: [
      ['1', 'A'],
      ['2', 'B'],
    ],
  }
  const stats: ShardData = {
    name: 'stats',
    fields: ['sid', 'score'],
    rows: [
      ['1', 8.3],
      ['2', 7.1],
    ],
  }

  it('按行号拼成完整记录', () => {
    const result = joinShardRows([base, stats])

    expect('entries' in result && result.entries).toEqual([
      { sid: '1', name: 'A', score: 8.3 },
      { sid: '2', name: 'B', score: 7.1 },
    ])
  })

  it('单片也能拼（不依赖别的片）', () => {
    const result = joinShardRows([base])

    expect('entries' in result && result.entries.length > 0).toBe(true)
  })

  it('行数不一致时报错而不是静默截断', () => {
    const short: ShardData = { name: 'stats', fields: ['sid', 'score'], rows: [['1', 8.3]] }

    const result = joinShardRows([base, short])

    expect('errors' in result && result.errors[0]).toContain('行数不一致')
  })

  it('非 sid 字段跨片重复时报错（清单与实际数据不符）', () => {
    const dup: ShardData = {
      name: 'dup',
      fields: ['sid', 'name'],
      rows: [
        ['1', 'X'],
        ['2', 'Y'],
      ],
    }

    const result = joinShardRows([base, dup])

    expect('errors' in result && result.errors[0]).toContain('name 同时出现在')
  })

  it('sid 跨片重复是正常的（唯一连接键）', () => {
    const result = joinShardRows([base, stats])

    expect('entries' in result).toBe(true)
  })

  it('没有分片时报错', () => {
    const result = joinShardRows([])

    expect('errors' in result).toBe(true)
  })

  it('某行长度与表头不符时报错', () => {
    const broken: ShardData = { name: 'stats', fields: ['sid', 'score'], rows: [['1'], ['2', 7.1]] }

    const result = joinShardRows([base, broken])

    expect('errors' in result && result.errors[0]).toContain('长度')
  })

  it('空数据集（0 行）拼出空数组而不是报错', () => {
    const empty: ShardData = { name: 'base', fields: ['sid'], rows: [] }

    const result = joinShardRows([empty])

    expect('entries' in result && result.entries).toEqual([])
  })
})
