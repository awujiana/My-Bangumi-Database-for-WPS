/**
 * 分片下载编排：清单 → 选片 → 逐片取文本 → 按行拼接
 *
 * 四个同步源（GitHub / GitLab / Gitee / 本地文件）共用本模块，只替换「取文本」回调，
 * 因此这里守住编排层的全部失败面：路径不是清单、清单读不到/格式非法、某一片读不到、
 * 分片表头非法、行数不一致、拼接后没有合法记录。
 *
 * 另覆盖 `collectNeededFieldsFromSheet`：它必须是**只读**的（下载阶段动工作表会闪烁，
 * 且失败会留副作用），所以 utility 的 mock 里刻意不提供 `ensureSheetHeaders` ——
 * 一旦被调用就会直接报「不是函数」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockBgmlog = vi.hoisted(() => vi.fn())
const mockGetDataSheet = vi.hoisted(() => vi.fn())
const mockFindHeaderRow = vi.hoisted(() => vi.fn())
const mockGetColumnMap = vi.hoisted(() =>
  vi.fn<(ws?: unknown, headerRow?: number) => Map<string, number>>(),
)

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

vi.mock('../ts/tools/utility.js', () => ({
  bgmLog: mockBgmlog,
  getDataSheet: mockGetDataSheet,
  findHeaderRow: mockFindHeaderRow,
  getColumnMap: mockGetColumnMap,
}))

import { collectNeededFieldsFromSheet, loadEntriesFromPath } from '../ts/sync/shard-fetch.js'
import type { RelativePathFetcher } from '../ts/sync/shard-fetch.js'

const MANIFEST_PATH = 'data/anime.manifest.json'

/** 与数据仓库一致的 6 片清单 */
const SIX_SHARDS = [
  {
    name: 'base',
    file: 'anime.base.jsonlines.gz',
    fields: ['sid', 'name', 'name_original', 'updatedAt', 'date', 'meta_tags', 'nsfw'],
  },
  { name: 'meta', file: 'anime.meta.jsonlines.gz', fields: ['sid', '话数', '导演'] },
  { name: 'relations', file: 'anime.relations.jsonlines.gz', fields: ['sid', '关联的动漫ID'] },
  {
    name: 'stats',
    file: 'anime.stats.jsonlines.gz',
    fields: ['sid', 'platform', 'series', 'score', 'rank', 'tags'],
  },
  { name: 'summary', file: 'anime.summary.jsonlines.gz', fields: ['sid', 'summary'] },
  { name: 'infobox', file: 'anime.infobox.jsonlines.gz', fields: ['sid', 'infobox'] },
] as const

function manifestText(
  shards: readonly { name: string; file: string; fields: readonly string[] }[] = SIX_SHARDS,
): string {
  return JSON.stringify({
    formatVersion: 1,
    subjectType: 2,
    typeLabel: 'anime',
    updatedAt: '2026-09-08',
    recordCount: 2,
    shards,
  })
}

/** 构造一片的两段式 JSONL：首行表头，其后值数组 */
function shardText(fields: readonly string[], rows: readonly unknown[][]): string {
  return [JSON.stringify(fields), ...rows.map((row) => JSON.stringify(row))].join('\n')
}

const BASE_TEXT = shardText(
  ['sid', 'name', 'name_original', 'updatedAt', 'date', 'meta_tags', 'nsfw'],
  [
    ['1', 'A', 'エー', '2026-09-01', '2026-01-01', ['tag'], false],
    ['2', 'B', 'ビー', '2026-09-02', '2026-01-02', [], true],
  ],
)
const SUMMARY_TEXT = shardText(
  ['sid', 'summary'],
  [
    ['1', '简介 A'],
    ['2', '简介 B'],
  ],
)

/** 记录每次取文本请求的路径，并按路径给出响应 */
function makeFetcher(responses: Record<string, string | Error>): {
  fetchText: RelativePathFetcher
  calls: string[]
} {
  const calls: string[] = []
  const fetchText: RelativePathFetcher = (relativePath) => {
    calls.push(relativePath)
    const response = responses[relativePath]
    if (response === undefined) {
      return Promise.reject(new Error(`未预置响应的路径：${relativePath}`))
    }
    if (response instanceof Error) return Promise.reject(response)
    return Promise.resolve(response)
  }
  return { fetchText, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadEntriesFromPath 前置校验', () => {
  it('路径不是清单（旧单片）时给出明确报错', async () => {
    const { fetchText } = makeFetcher({})

    await expect(
      loadEntriesFromPath({
        path: 'data/bangumi.jsonlines.gz',
        fetchText,
        logTag: 'test',
      }),
    ).rejects.toThrow(/必须是分片清单/)
  })

  it('前置校验失败时不发起任何请求', async () => {
    const { fetchText, calls } = makeFetcher({})

    await expect(
      loadEntriesFromPath({ path: 'data/anime.jsonlines', fetchText, logTag: 'test' }),
    ).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('清单读取失败时报出路径与原始原因', async () => {
    const { fetchText } = makeFetcher({ [MANIFEST_PATH]: new Error('404 文件不存在') })

    await expect(
      loadEntriesFromPath({ path: MANIFEST_PATH, fetchText, logTag: 'test' }),
    ).rejects.toThrow(/分片清单读取失败（data\/anime.manifest.json）：404 文件不存在/)
  })

  it('清单格式非法时报错', async () => {
    const { fetchText } = makeFetcher({ [MANIFEST_PATH]: '{"formatVersion":9}' })

    await expect(
      loadEntriesFromPath({ path: MANIFEST_PATH, fetchText, logTag: 'test' }),
    ).rejects.toThrow(/分片清单格式非法/)
  })
})

describe('loadEntriesFromPath 选片', () => {
  const responses = {
    [MANIFEST_PATH]: manifestText(),
    'data/anime.base.jsonlines.gz': BASE_TEXT,
    'data/anime.summary.jsonlines.gz': SUMMARY_TEXT,
    'data/anime.meta.jsonlines.gz': shardText(
      ['sid', '话数', '导演'],
      [
        ['1', 12, 'X'],
        ['2', 24, 'Y'],
      ],
    ),
    'data/anime.relations.jsonlines.gz': shardText(
      ['sid', '关联的动漫ID'],
      [
        ['1', '9'],
        ['2', ''],
      ],
    ),
    'data/anime.stats.jsonlines.gz': shardText(
      ['sid', 'platform', 'series', 'score', 'rank', 'tags'],
      [
        ['1', 'TV', '', 8.1, 100, []],
        ['2', 'OVA', '', 7.2, 200, []],
      ],
    ),
    'data/anime.infobox.jsonlines.gz': shardText(
      ['sid', 'infobox'],
      [
        ['1', 'ib1'],
        ['2', 'ib2'],
      ],
    ),
  }

  it('只请求清单 + base + 命中字段的片', async () => {
    const { fetchText, calls } = makeFetcher(responses)

    await loadEntriesFromPath({
      path: MANIFEST_PATH,
      fetchText,
      neededFields: new Set(['sid', 'name', 'summary']),
      logTag: 'test',
    })

    expect(calls).toEqual([
      MANIFEST_PATH,
      'data/anime.base.jsonlines.gz',
      'data/anime.summary.jsonlines.gz',
    ])
  })

  it('neededFields 为 undefined 时全量下载（读不到表头的保守兜底）', async () => {
    const { fetchText, calls } = makeFetcher(responses)

    await loadEntriesFromPath({ path: MANIFEST_PATH, fetchText, logTag: 'test' })

    expect(calls).toHaveLength(7)
    expect(calls).toContain('data/anime.infobox.jsonlines.gz')
  })

  it('manualShards 指定时只下 base + 指定片（可多选/取消）', async () => {
    const { fetchText, calls } = makeFetcher(responses)

    await loadEntriesFromPath({
      path: MANIFEST_PATH,
      fetchText,
      neededFields: new Set(['sid', 'name']),
      manualShards: ['stats', 'infobox'],
      logTag: 'test',
    })

    expect(calls).toEqual([
      MANIFEST_PATH,
      'data/anime.base.jsonlines.gz',
      'data/anime.stats.jsonlines.gz',
      'data/anime.infobox.jsonlines.gz',
    ])
  })

  it('空集合表示确实什么都不需要，只下必选片', async () => {
    const { fetchText, calls } = makeFetcher(responses)

    await loadEntriesFromPath({
      path: MANIFEST_PATH,
      fetchText,
      neededFields: new Set<string>(),
      logTag: 'test',
    })

    expect(calls).toEqual([MANIFEST_PATH, 'data/anime.base.jsonlines.gz'])
  })

  it('清单在子目录时分片取同目录路径', async () => {
    const nestedManifest = 'mirror/data/anime.manifest.json'
    const { fetchText, calls } = makeFetcher({
      [nestedManifest]: manifestText([SIX_SHARDS[0], SIX_SHARDS[4]]),
      'mirror/data/anime.base.jsonlines.gz': BASE_TEXT,
      'mirror/data/anime.summary.jsonlines.gz': SUMMARY_TEXT,
    })

    await loadEntriesFromPath({
      path: nestedManifest,
      fetchText,
      neededFields: new Set(['sid', 'name', 'summary']),
      logTag: 'test',
    })

    expect(calls).toContain('mirror/data/anime.summary.jsonlines.gz')
  })

  it('把 signal 透传给每一次取文本', async () => {
    const controller = new AbortController()
    const { fetchText } = makeFetcher(responses)
    const spy = vi.fn(fetchText)

    await loadEntriesFromPath({
      path: MANIFEST_PATH,
      fetchText: spy,
      neededFields: new Set(['sid', 'name']),
      signal: controller.signal,
      logTag: 'test',
    })

    for (const call of spy.mock.calls) {
      expect(call[1]).toBe(controller.signal)
    }
  })
})

describe('loadEntriesFromPath 拼接与校验', () => {
  it('某一片读取失败时报出该片路径', async () => {
    const { fetchText } = makeFetcher({
      [MANIFEST_PATH]: manifestText(),
      'data/anime.base.jsonlines.gz': new Error('网络中断'),
    })

    await expect(
      loadEntriesFromPath({
        path: MANIFEST_PATH,
        fetchText,
        neededFields: new Set(['sid', 'name']),
        logTag: 'test',
      }),
    ).rejects.toThrow(/分片读取失败（data\/anime.base.jsonlines.gz）：网络中断/)
  })

  it('分片首行不是表头时报错', async () => {
    const { fetchText } = makeFetcher({
      [MANIFEST_PATH]: manifestText(),
      'data/anime.base.jsonlines.gz': '{"not":"an array"}',
    })

    await expect(
      loadEntriesFromPath({
        path: MANIFEST_PATH,
        fetchText,
        neededFields: new Set(['sid', 'name']),
        logTag: 'test',
      }),
    ).rejects.toThrow(/分片表头非法/)
  })

  it('各片行数不一致时报错而不是产出错行记录', async () => {
    const { fetchText } = makeFetcher({
      [MANIFEST_PATH]: manifestText([SIX_SHARDS[0], SIX_SHARDS[4]]),
      'data/anime.base.jsonlines.gz': BASE_TEXT,
      'data/anime.summary.jsonlines.gz': shardText(['sid', 'summary'], [['1', '只有一行']]),
    })

    await expect(
      loadEntriesFromPath({
        path: MANIFEST_PATH,
        fetchText,
        neededFields: new Set(['sid', 'name', 'summary']),
        logTag: 'test',
      }),
    ).rejects.toThrow(/分片拼接失败：.*行数不一致/)
  })

  it('拼接后全部缺 sid 时报错', async () => {
    const { fetchText } = makeFetcher({
      [MANIFEST_PATH]: manifestText([SIX_SHARDS[0]]),
      'data/anime.base.jsonlines.gz': shardText(
        ['sid', 'name', 'name_original', 'updatedAt', 'date', 'meta_tags', 'nsfw'],
        [[1, 'A', '', '', '', [], false]],
      ),
    })

    await expect(
      loadEntriesFromPath({
        path: MANIFEST_PATH,
        fetchText,
        neededFields: new Set(['sid', 'name']),
        logTag: 'test',
      }),
    ).rejects.toThrow(/分片拼接后没有可用记录/)
  })

  it('部分记录缺 sid 时跳过并记 WARN', async () => {
    const { fetchText } = makeFetcher({
      [MANIFEST_PATH]: manifestText([SIX_SHARDS[0]]),
      'data/anime.base.jsonlines.gz': shardText(
        ['sid', 'name', 'name_original', 'updatedAt', 'date', 'meta_tags', 'nsfw'],
        [
          ['1', 'A', '', '', '', [], false],
          [null, 'B', '', '', '', [], false],
        ],
      ),
    })

    const result = await loadEntriesFromPath({
      path: MANIFEST_PATH,
      fetchText,
      neededFields: new Set(['sid', 'name']),
      logTag: 'test',
    })

    expect(result.entries).toHaveLength(1)
    expect(result.skippedInvalidRecords).toBe(1)
    expect(mockBgmlog).toHaveBeenCalledWith('WARN', expect.stringContaining('1 条缺少合法 sid'))
  })

  it('成功时按行拼接出完整记录并回报分片与期次', async () => {
    const { fetchText } = makeFetcher({
      [MANIFEST_PATH]: manifestText([SIX_SHARDS[0], SIX_SHARDS[4]]),
      'data/anime.base.jsonlines.gz': BASE_TEXT,
      'data/anime.summary.jsonlines.gz': SUMMARY_TEXT,
    })

    const result = await loadEntriesFromPath({
      path: MANIFEST_PATH,
      fetchText,
      neededFields: new Set(['sid', 'name', 'summary']),
      logTag: 'test',
    })

    expect(result.updatedAt).toBe('2026-09-08')
    expect(result.shards).toEqual(['base', 'summary'])
    expect(result.skippedInvalidRecords).toBe(0)
    expect(result.entries).toEqual([
      {
        sid: '1',
        name: 'A',
        name_original: 'エー',
        updatedAt: '2026-09-01',
        date: '2026-01-01',
        meta_tags: ['tag'],
        nsfw: false,
        summary: '简介 A',
      },
      {
        sid: '2',
        name: 'B',
        name_original: 'ビー',
        updatedAt: '2026-09-02',
        date: '2026-01-02',
        meta_tags: [],
        nsfw: true,
        summary: '简介 B',
      },
    ])
  })

  it('日志里带数据源前缀与本次下载的分片名', async () => {
    const { fetchText } = makeFetcher({
      [MANIFEST_PATH]: manifestText([SIX_SHARDS[0], SIX_SHARDS[4]]),
      'data/anime.base.jsonlines.gz': BASE_TEXT,
      'data/anime.summary.jsonlines.gz': SUMMARY_TEXT,
    })

    await loadEntriesFromPath({
      path: MANIFEST_PATH,
      fetchText,
      neededFields: new Set(['sid', 'name', 'summary']),
      logTag: 'giteeSync',
    })

    expect(mockBgmlog).toHaveBeenCalledWith(
      'INFO',
      expect.stringContaining('[giteeSync] 清单 data/anime.manifest.json'),
    )
  })
})

describe('collectNeededFieldsFromSheet', () => {
  it('读不到工作表时返回 undefined（调用方按全量下载处理）', () => {
    mockGetDataSheet.mockReturnValue(null)

    expect(collectNeededFieldsFromSheet()).toBeUndefined()
  })

  it('表头一行都没有时返回 undefined', () => {
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map())

    expect(collectNeededFieldsFromSheet()).toBeUndefined()
  })

  it('findHeaderRow 返回 null 时回退到第 1 行', () => {
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(null)
    mockGetColumnMap.mockReturnValue(new Map([['名称', 2]]))

    collectNeededFieldsFromSheet()

    expect(mockGetColumnMap).toHaveBeenCalledWith(expect.anything(), 1)
  })

  it('按列名推导字段，且始终含必选字段', () => {
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['名称', 2],
        ['导演', 3],
        ['评分', 4],
        ['排名', 5],
      ]),
    )

    const needed = collectNeededFieldsFromSheet()

    expect(needed).toBeInstanceOf(Set)
    expect(needed?.has('sid')).toBe(true)
    expect(needed?.has('name')).toBe(true)
    expect(needed?.has('updatedAt')).toBe(true)
    expect(needed?.has('导演')).toBe(true)
    expect(needed?.has('score')).toBe(true)
    expect(needed?.has('rank')).toBe(true)
  })

  it('「集数」「标签/分级」走独立映射（不在 EXTENDED_FIELD_MAP 里）', () => {
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['集数', 2],
        ['标签/分级', 3],
      ]),
    )

    const needed = collectNeededFieldsFromSheet()

    expect(needed?.has('话数')).toBe(true)
    expect(needed?.has('meta_tags')).toBe(true)
  })

  it('summary 不对应任何 Excel 列，只能靠手动选片拿到', () => {
    // 「简介」是富化功能用的独立工作表列，与 JSONL 的 summary 字段无关，
    // 因此按表头推导时永远不会命中 summary 片
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['名称', 2],
        ['简介', 3],
      ]),
    )

    expect(collectNeededFieldsFromSheet()?.has('summary')).toBe(false)
  })

  it('是只读的：不调用 ensureSheetHeaders（该 mock 未提供，调用即报错）', () => {
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['名称', 2]]))

    expect(() => collectNeededFieldsFromSheet()).not.toThrow()
  })
})
