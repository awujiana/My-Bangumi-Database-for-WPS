// @vitest-environment jsdom
/**
 * @fileoverview `ts/plugins/plugin-store.ts` 单测
 *
 * 索引是插件的唯一事实来源（列表、启停、待重载、签名结论都靠它），所以重点在：
 * 1. **两种后端行为一致**：有 `PluginStorage` 时落宿主存储，没有时退回内存；
 * 2. **坏数据不传染**：一条结构不对的记录只丢自己，整份索引仍可用；
 * 3. **签名结论要持久化**：丢了它，更新链路会误判「信任变差」而反复暂停更新。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PLUGIN_INDEX_KEY,
  findPluginRecord,
  loadPluginIndex,
  parsePluginIndex,
  patchPluginRecord,
  removePluginRecord,
  resetPluginIndexForTest,
  savePluginIndex,
  upsertPluginRecord,
} from '../ts/plugins/plugin-store.js'
import type { InstalledPluginRecord } from '../ts/plugins/plugin-types.js'

/** 造一条最小记录 */
function record(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    id: 'hmoe-new-anime',
    name: 'H萌新番',
    version: '1.0.0',
    author: 'awujiana',
    source: { kind: 'github', value: 'awujiana/MBD-plugin-hmacg' },
    enabled: true,
    installedAt: '2026-11-04T00:00:00.000Z',
    permissions: ['sheet.write'],
    ...overrides,
  }
}

/** 装一个假的宿主 PluginStorage */
function installFakeStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial))
  ;(window as unknown as { Application: unknown }).Application = {
    PluginStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
  }
  return store
}

afterEach(() => {
  resetPluginIndexForTest()
  delete (window as unknown as { Application?: unknown }).Application
  vi.restoreAllMocks()
})

describe('内存回退（无宿主存储）', () => {
  it('空索引起步', () => {
    expect(loadPluginIndex()).toEqual({ schemaVersion: 1, plugins: [] })
  })

  it('upsert 新增后再读能拿到', () => {
    upsertPluginRecord(record())
    expect(findPluginRecord('hmoe-new-anime')?.name).toBe('H萌新番')
  })

  it('upsert 同 id 覆盖而不是追加', () => {
    upsertPluginRecord(record())
    upsertPluginRecord(record({ version: '1.1.0' }))
    const index = loadPluginIndex()
    expect(index.plugins).toHaveLength(1)
    expect(index.plugins[0]?.version).toBe('1.1.0')
  })

  it('patch 局部更新，未提及字段保留', () => {
    upsertPluginRecord(record())
    patchPluginRecord('hmoe-new-anime', { enabled: false })
    const saved = findPluginRecord('hmoe-new-anime')
    expect(saved?.enabled).toBe(false)
    expect(saved?.version).toBe('1.0.0')
  })

  it('patch 不存在的 id 静默忽略', () => {
    upsertPluginRecord(record())
    patchPluginRecord('nobody', { enabled: false })
    expect(loadPluginIndex().plugins).toHaveLength(1)
  })

  it('remove 删掉指定记录，其余保留', () => {
    upsertPluginRecord(record())
    upsertPluginRecord(record({ id: 'yucwiki', name: '长门有C' }))
    removePluginRecord('hmoe-new-anime')
    const index = loadPluginIndex()
    expect(index.plugins.map((item) => item.id)).toEqual(['yucwiki'])
  })

  it('remove 不存在的 id 不写盘', () => {
    upsertPluginRecord(record())
    const before = loadPluginIndex()
    removePluginRecord('nobody')
    expect(loadPluginIndex()).toEqual(before)
  })

  it('savePluginIndex 写入的索引能被读回', () => {
    expect(savePluginIndex({ schemaVersion: 1, plugins: [record()] })).toBe(true)
    expect(loadPluginIndex().plugins).toHaveLength(1)
  })

  it('域名白名单随记录持久化（重载后 net.fetch 才不会被全拦）', () => {
    upsertPluginRecord(record({ network: ['raw.githubusercontent.com'] }))
    expect(findPluginRecord('hmoe-new-anime')?.network).toEqual(['raw.githubusercontent.com'])
  })
})

describe('宿主存储后端', () => {
  it('写入的键名固定为 bgm_plugins_index', () => {
    const store = installFakeStorage()
    upsertPluginRecord(record())
    expect(store.has(PLUGIN_INDEX_KEY)).toBe(true)
  })

  it('读到宿主里已有的索引', () => {
    installFakeStorage({ [PLUGIN_INDEX_KEY]: JSON.stringify({ plugins: [record()] }) })
    expect(findPluginRecord('hmoe-new-anime')?.version).toBe('1.0.0')
  })

  it('读宿主存储抛错时退化成空索引并记日志', () => {
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: () => {
          throw new Error('COM 挂了')
        },
        setItem: () => {},
      },
    }
    expect(loadPluginIndex()).toEqual({ schemaVersion: 1, plugins: [] })
  })

  it('写宿主存储抛错时 savePluginIndex 返回 false', () => {
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('只读')
        },
      },
    }
    expect(savePluginIndex({ schemaVersion: 1, plugins: [] })).toBe(false)
  })

  it('宿主存储缺 setItem 时退回内存（不算宿主后端）', () => {
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: { getItem: () => null },
    }
    expect(savePluginIndex({ schemaVersion: 1, plugins: [record()] })).toBe(true)
    expect(findPluginRecord('hmoe-new-anime')).not.toBeNull()
  })
})

describe('parsePluginIndex · 坏数据隔离', () => {
  it('null / 空串 / 非法 JSON / 非对象 都是空索引', () => {
    for (const text of [null, '', ' '.repeat(3), '{', '[]', 'null', '"text"']) {
      expect(parsePluginIndex(text)).toEqual({ schemaVersion: 1, plugins: [] })
    }
  })

  it('plugins 不是数组时是空索引', () => {
    expect(parsePluginIndex('{"plugins":"x"}')).toEqual({ schemaVersion: 1, plugins: [] })
  })

  it('结构不对的记录被丢掉，好的仍保留', () => {
    const parsed = parsePluginIndex(
      JSON.stringify({
        plugins: [
          record(),
          { id: 'no-name' },
          { ...record({ id: 'bad-source' }), source: { kind: 'ftp', value: 'x' } },
          null,
          'text',
        ],
      }),
    )
    expect(parsed.plugins.map((item) => item.id)).toEqual(['hmoe-new-anime'])
  })

  it('enabled 只有显式 false 才算禁用', () => {
    const parsed = parsePluginIndex(
      JSON.stringify({ plugins: [{ ...record(), enabled: undefined }] }),
    )
    expect(parsed.plugins[0]?.enabled).toBe(true)
  })

  it('permissions 里的非字符串被过滤', () => {
    const parsed = parsePluginIndex(
      JSON.stringify({ plugins: [{ ...record(), permissions: ['sheet.read', 42, null] }] }),
    )
    expect(parsed.plugins[0]?.permissions).toEqual(['sheet.read'])
  })

  it('签名结论与待授权权限能往返（更新链路靠它判信任是否变差）', () => {
    const parsed = parsePluginIndex(
      JSON.stringify({
        plugins: [
          {
            ...record(),
            signatureStatus: 'unsigned',
            pendingPermissions: ['data.write'],
            pendingReload: true,
            lastCheckedAt: '2026-11-04T01:00:00.000Z',
          },
        ],
      }),
    )
    const saved = parsed.plugins[0]
    expect(saved?.signatureStatus).toBe('unsigned')
    expect(saved?.pendingPermissions).toEqual(['data.write'])
    expect(saved?.pendingReload).toBe(true)
    expect(saved?.lastCheckedAt).toBe('2026-11-04T01:00:00.000Z')
  })

  it('未知的签名结论被丢弃（不猜成 verified）', () => {
    const parsed = parsePluginIndex(
      JSON.stringify({ plugins: [{ ...record(), signatureStatus: 'trust-me' }] }),
    )
    expect(parsed.plugins[0]?.signatureStatus).toBeUndefined()
  })

  it('三项版本信息能往返（市场页重载后靠索引显示，不认远程清单）', () => {
    const parsed = parsePluginIndex(
      JSON.stringify({
        plugins: [
          record({ minHostVersion: '2.5.0', dataSourceVersion: '2026H2-2026-11-04' }),
        ],
      }),
    )
    const saved = parsed.plugins[0]
    expect(saved?.version).toBe('1.0.0')
    expect(saved?.minHostVersion).toBe('2.5.0')
    expect(saved?.dataSourceVersion).toBe('2026H2-2026-11-04')
  })

  it('旧索引没有新增字段时不臆造版本信息', () => {
    const parsed = parsePluginIndex(JSON.stringify({ plugins: [record()] }))
    expect(parsed.plugins[0]?.minHostVersion).toBeUndefined()
    expect(parsed.plugins[0]?.dataSourceVersion).toBeUndefined()
  })

  it('版本字段不是字符串时被丢掉', () => {
    const parsed = parsePluginIndex(
      JSON.stringify({
        plugins: [{ ...record(), minHostVersion: 7, dataSourceVersion: null }],
      }),
    )
    expect(parsed.plugins[0]?.minHostVersion).toBeUndefined()
    expect(parsed.plugins[0]?.dataSourceVersion).toBeUndefined()
  })
})
