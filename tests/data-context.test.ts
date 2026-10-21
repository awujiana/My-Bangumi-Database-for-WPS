// @vitest-environment jsdom
/**
 * @fileoverview 跨页数据上下文共享单测
 *
 * 覆盖 tools/data-context.ts：
 *   - saveDataContext / readDataContext 往返
 *   - 快照缺字段 / 非法 JSON 的容错
 *   - snapshotFromWorksheet 的列/行提取
 *   - mountDataContextNotice：其它页的快照重放为通知条；本页自己的不重放；不重复挂载
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBgmLog = vi.hoisted(() => vi.fn())

vi.mock('../ts/tools/util/index.js', () => ({
  getApp: (): unknown => Reflect.get(globalThis, 'Application') ?? null,
  bgmLog: mockBgmLog,
  getColumnMap: vi.fn(
    () =>
      new Map([
        ['名称', 1],
        ['开播日期', 2],
      ]),
  ),
  getLastRow: vi.fn(() => 12),
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}))

import {
  saveDataContext,
  readDataContext,
  snapshotFromWorksheet,
  mountDataContextNotice,
} from '../ts/tools/data-context.js'

function setStorage(store: Record<string, string> | null): void {
  const global = globalThis as { Application?: unknown }
  if (store === null) {
    global.Application = null
    return
  }
  const s = { ...store }
  global.Application = {
    PluginStorage: {
      getItem: (k: string) => (Object.hasOwn(s, k) ? (s[k] ?? null) : null),
      setItem: (k: string, v: string) => {
        s[k] = v
      },
    },
  }
}

const KEY = 'bgm_data_context'

describe('saveDataContext / readDataContext', () => {
  beforeEach(() => {
    setStorage({})
  })

  it('写入后可原样读回', () => {
    saveDataContext({
      workbook: 'wb1.xlsx',
      sheet: 'Sheet1',
      columns: ['名称', '开播日期'],
      rowCount: 11,
      fromPage: 'enrich',
    })

    expect(readDataContext()).toMatchObject({
      workbook: 'wb1.xlsx',
      sheet: 'Sheet1',
      columns: ['名称', '开播日期'],
      rowCount: 11,
      fromPage: 'enrich',
    })
    expect(readDataContext()?.savedAt).toBeGreaterThan(0)
  })

  it('无存储 / 空存储 / 非法 JSON 时返回 null', () => {
    setStorage(null)
    expect(readDataContext()).toBeNull()

    setStorage({})
    expect(readDataContext()).toBeNull()

    setStorage({ [KEY]: 'not-json{{{' })
    expect(readDataContext()).toBeNull()
  })

  it('快照缺字段时按默认值补齐，不抛错', () => {
    setStorage({ [KEY]: JSON.stringify({ workbook: 'wb1' }) })
    expect(readDataContext()).toMatchObject({
      workbook: 'wb1',
      sheet: '',
      columns: [],
      rowCount: 0,
    })
  })
})

describe('snapshotFromWorksheet', () => {
  it('提取工作簿名 / 列名 / 行数（lastRow - headerRow）', () => {
    const snap = snapshotFromWorksheet({ Name: 'wb1.xlsx' } as never, 1, 'enrich')
    expect(snap).toMatchObject({
      workbook: 'wb1.xlsx',
      sheet: 'wb1.xlsx',
      columns: ['名称', '开播日期'],
      rowCount: 11,
      fromPage: 'enrich',
    })
  })

  it('Name 抛错时降级为空串，不抛错', () => {
    const snap = snapshotFromWorksheet(
      {
        get Name(): string {
          throw new Error('host gone')
        },
      } as never,
      1,
      'highlight',
    )
    expect(snap.workbook).toBe('')
  })
})

describe('mountDataContextNotice', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main class="main"></main>'
    setStorage({})
  })

  it('其它页的快照重放为通知条', () => {
    saveDataContext({
      workbook: 'wb1.xlsx',
      sheet: 'Sheet1',
      columns: ['名称'],
      rowCount: 5,
      fromPage: 'enrich',
    })

    mountDataContextNotice('highlight')

    const bar = document.getElementById('bgmDataContextNotice')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('富化')
    expect(bar?.textContent).toContain('wb1.xlsx')
    expect(bar?.textContent).toContain('Sheet1')
  })

  it('本页自己写的快照不重放', () => {
    saveDataContext({
      workbook: 'wb1.xlsx',
      sheet: 'Sheet1',
      columns: [],
      rowCount: 0,
      fromPage: 'highlight',
    })

    mountDataContextNotice('highlight')
    expect(document.getElementById('bgmDataContextNotice')).toBeNull()
  })

  it('没有快照时不挂载；重复调用不重复挂载', () => {
    mountDataContextNotice('highlight')
    expect(document.getElementById('bgmDataContextNotice')).toBeNull()

    saveDataContext({
      workbook: 'wb1.xlsx',
      sheet: 'Sheet1',
      columns: [],
      rowCount: 0,
      fromPage: 'enrich',
    })
    mountDataContextNotice('highlight')
    mountDataContextNotice('highlight')
    expect(document.getElementById('bgmDataContextNotice')).not.toBeNull()
  })
})
