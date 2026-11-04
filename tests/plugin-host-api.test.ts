// @vitest-environment jsdom
/**
 * @fileoverview `ts/plugins/host-api.ts` 单测
 *
 * `host` 是插件的全部能力来源，所以最要紧的一条是**按权限构造、而不是存在但抛错**：
 * 没授权的成员在对象上根本不存在，插件用 `typeof` 就能降级。这里逐个权限组合验证
 * 「有 / 没有」，比事后读文档可靠。
 *
 * COM 用 `window.Application` 的桩代替（与真机同一条访问路径，`getApp()` 读的就是它）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  columnLetter,
  createHostApi,
  createPluginStorage,
  matrixToRecords,
  mergeRecords,
  recordsToMatrix,
} from '../ts/plugins/host-api.js'
import type { HostApiDependencies } from '../ts/plugins/host-api.js'
import type { PluginManifest, PluginPermission } from '../ts/plugins/plugin-types.js'

/** 造一份清单 */
function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    id: 'hmoe-new-anime',
    name: 'H萌新番',
    version: '1.0.0',
    apiVersion: '1.0.0',
    minHostVersion: '2.4.0',
    description: '一键下载',
    author: 'awujiana',
    entry: 'plugin.js',
    permissions: [],
    checksum: { 'plugin.js': { sha256: 'a'.repeat(64), size: 1 } },
    ...overrides,
  }
}

/** 宿主依赖桩 */
function dependencies(overrides: Partial<HostApiDependencies> = {}): HostApiDependencies {
  return {
    hostVersion: '2.4.1',
    apiVersion: '1.0.0',
    locale: () => 'zh-CN',
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    openPane: vi.fn(),
    registerCommand: vi.fn(),
    translate: (key, fallback) => `${key}:${fallback}`,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  }
}

/** 造 host（权限用数组传，内部转 Set） */
function createHost(
  permissions: PluginPermission[],
  overrides: {
    manifest?: Partial<PluginManifest>
    dependencies?: Partial<HostApiDependencies>
  } = {},
): Record<string, unknown> {
  return createHostApi(
    manifest(overrides.manifest),
    new Set(permissions),
    dependencies(overrides.dependencies),
  )
}

/** 取一个子对象（不存在直接抛，让断言失败信息更清楚） */
function part(host: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = host[name]
  if (typeof value !== 'object' || value === null) throw new Error(`host.${name} 不存在`)
  return value as Record<string, unknown>
}

/** 装一个假的工作簿（Worksheets.Item 按名字或序号返回） */
function installWorkbook(sheets: Record<string, unknown[][]>): void {
  const names = Object.keys(sheets)
  ;(window as unknown as { Application: unknown }).Application = {
    ActiveWorkbook: {
      Worksheets: {
        Count: names.length,
        Item: (key: number | string) => {
          const name = typeof key === 'number' ? names[key - 1] : key
          if (name === undefined) throw new Error('没有这张表')
          const rows = sheets[name] ?? []
          return {
            Name: name,
            UsedRange: { Value2: rows },
            Range: () => ({ Value2: undefined }),
          }
        },
      },
    },
    ActiveSheet: { Name: names[0] ?? '' },
  }
}

afterEach(() => {
  delete (window as unknown as { Application?: unknown }).Application
  vi.restoreAllMocks()
})

describe('columnLetter', () => {
  it('1 → A / 26 → Z / 27 → AA / 702 → ZZ', () => {
    expect(columnLetter(1)).toBe('A')
    expect(columnLetter(26)).toBe('Z')
    expect(columnLetter(27)).toBe('AA')
    expect(columnLetter(52)).toBe('AZ')
    expect(columnLetter(702)).toBe('ZZ')
  })

  it('小于 1 的输入按 1 处理', () => {
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(-5)).toBe('A')
  })
})

describe('矩阵 ↔ 记录', () => {
  it('首行当表头，空行被丢掉', () => {
    const records = matrixToRecords([
      ['名称', '集数', ''],
      ['进击的巨人', 87, null],
      [null, null, null],
      ['鬼灭之刃', 26, ''],
    ])
    expect(records).toEqual([
      { 名称: '进击的巨人', 集数: 87 },
      { 名称: '鬼灭之刃', 集数: 26 },
    ])
  })

  it('空矩阵返回空数组', () => {
    expect(matrixToRecords([])).toEqual([])
  })

  it('表头去空格，空表头列被忽略', () => {
    expect(
      matrixToRecords([
        [' 名称 ', ''],
        ['x', 'y'],
      ]),
    ).toEqual([{ 名称: 'x' }])
  })

  it('记录转矩阵时按给定表头顺序，缺列补 null', () => {
    const matrix = recordsToMatrix([{ 名称: 'x' }, { 名称: 'y', 集数: 12 }], ['名称', '集数'])
    expect(matrix).toEqual([
      ['名称', '集数'],
      ['x', null],
      ['y', 12],
    ])
  })

  it('合并：已存在的只覆盖非空字段', () => {
    const merged = mergeRecords(
      [{ id: 'a', 名称: '旧名', 集数: 12 }],
      [{ id: 'a', 名称: '新名', 集数: null }],
      'id',
    )
    expect(merged).toEqual([{ id: 'a', 名称: '新名', 集数: 12 }])
  })

  it('合并：新记录追加在后面', () => {
    const merged = mergeRecords([{ id: 'a' }], [{ id: 'b' }], 'id')
    expect(merged.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('合并：没有标识的记录被丢弃', () => {
    const merged = mergeRecords([{ id: '' }, { 名称: 'x' }], [{ id: 'b' }], 'id')
    expect(merged.map((item) => item.id)).toEqual(['b'])
  })

  it('合并不修改入参对象（避免上游数据被悄悄改写）', () => {
    const existing = [{ id: 'a', 名称: '旧名' }]
    mergeRecords(existing, [{ id: 'a', 名称: '新名' }], 'id')
    expect(existing[0]?.名称).toBe('旧名')
  })
})

describe('createHostApi · 权限裁剪', () => {
  it('无权限时只有元信息与 i18n', () => {
    const host = createHost([])
    expect(host.version).toBe('2.4.1')
    expect(host.apiVersion).toBe('1.0.0')
    expect(host.plugin).toEqual({ id: 'hmoe-new-anime', version: '1.0.0' })
    expect(host.locale).toBe('zh-CN')
    expect(host.sheet).toBeUndefined()
    expect(host.data).toBeUndefined()
    expect(host.net).toBeUndefined()
    expect(host.storage).toBeUndefined()
    expect(host.log).toBeUndefined()
    // registerCommand 不占权限
    expect(part(host, 'ui').registerCommand).toBeTypeOf('function')
    expect(part(host, 'ui').toast).toBeUndefined()
    const i18n = part(host, 'i18n')
    expect(i18n.t).toBeTypeOf('function')
    expect(i18n.locale).toBe('zh-CN')
  })

  it('log 权限注入日志器', () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    expect(createHost(['log'], { dependencies: { log } }).log).toBe(log)
  })

  it('sheet.read 只有读，没有写', () => {
    const sheet = part(createHost(['sheet.read']), 'sheet')
    expect(sheet.list).toBeTypeOf('function')
    expect(sheet.read).toBeTypeOf('function')
    expect(sheet.readRange).toBeTypeOf('function')
    expect(sheet.writeRange).toBeUndefined()
    expect(sheet.add).toBeUndefined()
    expect(sheet.remove).toBeUndefined()
  })

  it('sheet.write 只有写，没有读', () => {
    const sheet = part(createHost(['sheet.write']), 'sheet')
    expect(sheet.writeRange).toBeTypeOf('function')
    expect(sheet.add).toBeTypeOf('function')
    expect(sheet.remove).toBeTypeOf('function')
    expect(sheet.read).toBeUndefined()
  })

  it('data.read 暴露表头与读取', () => {
    const data = part(createHost(['data.read']), 'data')
    expect(data.headers).toBeTypeOf('function')
    expect(data.read).toBeTypeOf('function')
    expect(data.write).toBeUndefined()
  })

  it('data.write 暴露写入', () => {
    const data = part(createHost(['data.write']), 'data')
    expect(data.write).toBeTypeOf('function')
    expect(data.read).toBeUndefined()
  })

  it('ui.toast 才给 toast/confirm/progress', () => {
    const ui = part(createHost(['ui.toast']), 'ui')
    expect(ui.toast).toBeTypeOf('function')
    expect(ui.confirm).toBeTypeOf('function')
    expect(ui.progress).toBeTypeOf('function')
  })

  it('ui.pane 追加 openPane，且不覆盖已有成员', () => {
    const ui = part(createHost(['ui.toast', 'ui.pane']), 'ui')
    expect(ui.openPane).toBeTypeOf('function')
    expect(ui.toast).toBeTypeOf('function')
  })

  it('storage 权限才给私有存储', () => {
    expect(part(createHost(['storage']), 'storage').get).toBeTypeOf('function')
  })
})

describe('createHostApi · 表格读写走 COM', () => {
  it('list / read / active 读的是当前工作簿', () => {
    installWorkbook({ 番组: [['名称'], ['x']], 备用: [] })
    const sheet = part(createHost(['sheet.read']), 'sheet')
    expect((sheet.list as () => string[])()).toEqual(['番组', '备用'])
    expect((sheet.active as () => string)()).toBe('番组')
    expect((sheet.read as (name: string) => unknown[][])('番组')).toEqual([['名称'], ['x']])
  })

  it('读不到工作簿时返回空值而不是抛错', () => {
    const sheet = part(createHost(['sheet.read']), 'sheet')
    expect((sheet.list as () => string[])()).toEqual([])
    expect((sheet.active as () => string)()).toBe('')
    expect((sheet.read as (name: string) => unknown[][])('没有')).toEqual([])
  })

  it('readRange 按行列切片（1 起算）', () => {
    installWorkbook({
      番组: [
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
        ['g', 'h', 'i'],
      ],
    })
    const sheet = part(createHost(['sheet.read']), 'sheet')
    const readRange = sheet.readRange as (
      name: string,
      row: number,
      column: number,
      rowCount: number,
      columnCount: number,
    ) => unknown[][]
    expect(readRange('番组', 2, 2, 2, 2)).toEqual([
      ['e', 'f'],
      ['h', 'i'],
    ])
  })

  it('writeRange 写不到表时返回 false', () => {
    const sheet = part(createHost(['sheet.write']), 'sheet')
    const writeRange = sheet.writeRange as (
      name: string,
      row: number,
      column: number,
      rows: unknown[][],
    ) => boolean
    expect(writeRange('没有这张表', 1, 1, [['x']])).toBe(false)
  })

  it('writeRange 空矩阵返回 false（不发无意义的 COM 调用）', () => {
    installWorkbook({ 番组: [] })
    const sheet = part(createHost(['sheet.write']), 'sheet')
    const writeRange = sheet.writeRange as (
      name: string,
      row: number,
      column: number,
      rows: unknown[][],
    ) => boolean
    expect(writeRange('番组', 1, 1, [])).toBe(false)
  })
})

describe('createHostApi · data.write 三种模式', () => {
  it('replace 覆盖 / merge 按 key 合并 / append 追加', () => {
    installWorkbook({
      番组: [
        ['id', '名称'],
        ['a', '旧名'],
      ],
    })
    const data = part(createHost(['data.write']), 'data')
    const write = data.write as (records: unknown[], options?: unknown) => boolean
    expect(
      write([{ id: 'a', 名称: '新名' }], { sheetName: '番组', mode: 'merge', key: 'id' }),
    ).toBe(true)
    expect(write([{ id: 'b', 名称: '另一个' }], { sheetName: '番组', mode: 'append' })).toBe(true)
    expect(write([{ id: 'c' }], { sheetName: '番组', mode: 'replace' })).toBe(true)
  })
})

describe('createHostApi · net.fetch 白名单', () => {
  it('域名不在白名单内时抛错', async () => {
    const net = part(createHost(['net.fetch'], { manifest: { network: ['example.com'] } }), 'net')
    await expect(
      (net.fetch as (url: string) => Promise<unknown>)('https://evil.com/x'),
    ).rejects.toThrow('域名不在白名单内')
    await expect(
      (net.fetchJson as (url: string) => Promise<unknown>)('https://evil.com/x'),
    ).rejects.toThrow('域名不在白名单内')
    await expect(
      (net.fetchBytes as (url: string) => Promise<unknown>)('https://evil.com/x'),
    ).rejects.toThrow('域名不在白名单内')
  })

  it('白名单内时返回 status / headers / body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'hello',
        json: async () => ({ ok: true }),
        arrayBuffer: async () => new TextEncoder().encode('hi').buffer,
      })),
    )
    const net = part(createHost(['net.fetch'], { manifest: { network: ['example.com'] } }), 'net')
    const response = (await (net.fetch as (url: string) => Promise<Record<string, unknown>>)(
      'https://example.com/a',
    )) as { status: number; headers: Record<string, string>; body: string }
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/plain')
    expect(response.body).toBe('hello')
    expect(
      await (net.fetchJson as (url: string) => Promise<unknown>)('https://example.com/a'),
    ).toEqual({
      ok: true,
    })
    const fetchedBytes = await (net.fetchBytes as (url: string) => Promise<Uint8Array>)(
      'https://example.com/a',
    )
    expect(fetchedBytes.byteLength).toBe(2)
    vi.unstubAllGlobals()
  })
})

describe('createHostApi · ui.toast 的进度器', () => {
  it('update 不抛错，done 可重复调用', () => {
    const ui = part(createHost(['ui.toast']), 'ui')
    const progress = (
      ui.progress as (options: { title?: string; total?: number }) => {
        update: (step: number, message?: string) => void
        done: () => void
      }
    )({ title: '下载中', total: 3 })
    expect(() => {
      progress.update(1, '第一步')
      progress.update(2)
      progress.done()
      progress.done()
    }).not.toThrow()
  })
})

describe('createPluginStorage', () => {
  it('内存回退：set / get / keys / remove / clear', async () => {
    const storage = createPluginStorage('hmoe-new-anime')
    expect(await storage.set('last', { at: 1 })).toBe(true)
    expect(await storage.get('last')).toEqual({ at: 1 })
    expect(await storage.keys()).toEqual(['last'])
    expect(await storage.remove('last')).toBe(true)
    expect(await storage.keys()).toEqual([])
    expect(await storage.get('last')).toBeNull()
  })

  it('clear 清掉全部键（含登记表）', async () => {
    const storage = createPluginStorage('hmoe-new-anime')
    await storage.set('a', 1)
    await storage.set('b', 2)
    expect(await storage.clear()).toBe(true)
    expect(await storage.keys()).toEqual([])
    expect(await storage.get('a')).toBeNull()
  })

  it('重复 set 同一个键不会在登记表里重复', async () => {
    const storage = createPluginStorage('hmoe-new-anime')
    await storage.set('a', 1)
    await storage.set('a', 2)
    expect(await storage.keys()).toEqual(['a'])
  })

  it('宿主存储：键带 plugin:<id>: 前缀', async () => {
    const raw = new Map<string, string>()
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: (key: string) => raw.get(key) ?? null,
        setItem: (key: string, value: string) => {
          raw.set(key, value)
        },
        removeItem: (key: string) => {
          raw.delete(key)
        },
      },
    }
    const storage = createPluginStorage('hmoe-new-anime')
    await storage.set('last', 42)
    expect(raw.get('plugin:hmoe-new-anime:last')).toBe('42')
    expect(raw.get('plugin:hmoe-new-anime:#keys')).toBe('["last"]')
    expect(await storage.get('last')).toBe(42)
    await storage.remove('last')
    expect(raw.has('plugin:hmoe-new-anime:last')).toBe(false)
  })

  it('值是坏 JSON 时 get 返回 null（不让插件因脏数据崩掉）', async () => {
    const raw = new Map<string, string>([['plugin:hmoe-new-anime:bad', '{']])
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: (key: string) => raw.get(key) ?? null,
        setItem: (key: string, value: string) => {
          raw.set(key, value)
        },
        removeItem: (key: string) => {
          raw.delete(key)
        },
      },
    }
    expect(await createPluginStorage('hmoe-new-anime').get('bad')).toBeNull()
  })

  it('宿主存储抛错时退回内存（不影响插件运行）', async () => {
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: () => {
          throw new Error('COM 挂了')
        },
        setItem: () => {
          throw new Error('COM 挂了')
        },
      },
    }
    const storage = createPluginStorage('hmoe-new-anime')
    expect(await storage.set('a', 1)).toBe(false)
    expect(await storage.get('a')).toBeNull()
  })
})

describe('createPluginStorage · 登记表坏数据', () => {
  it('登记表不是数组时当空表（keys 返回空，set 仍能重建）', async () => {
    const raw = new Map<string, string>([['plugin:hmoe-new-anime:#keys', '{"a":1}']])
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: (key: string) => raw.get(key) ?? null,
        setItem: (key: string, value: string) => {
          raw.set(key, value)
        },
        removeItem: (key: string) => {
          raw.delete(key)
        },
      },
    }
    const storage = createPluginStorage('hmoe-new-anime')
    expect(await storage.keys()).toEqual([])
    await storage.set('a', 1)
    expect(await storage.keys()).toEqual(['a'])
  })
})

describe('beforeEach 兜底', () => {
  beforeEach(() => {
    // 上面的用例各自装桩；这里只确保环境干净
    delete (window as unknown as { Application?: unknown }).Application
  })

  it('没有 Application 时所有读取都安全降级', () => {
    const sheet = part(createHost(['sheet.read']), 'sheet')
    expect((sheet.list as () => string[])()).toEqual([])
  })
})
