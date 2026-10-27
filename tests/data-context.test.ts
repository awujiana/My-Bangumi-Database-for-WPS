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
  registerTargetSheetApplier,
  hasTargetSheetApplier,
  applyDataContextToPage,
  resetTargetSheetAppliers,
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
  it('工作簿名走 Parent.Name，工作表名走 Name（两处曾都填 Name，显示成「动画/动画」）', () => {
    const snap = snapshotFromWorksheet(
      { Name: 'Sheet1', Parent: { Name: 'wb1.xlsx' } } as never,
      1,
      'enrich',
    )
    expect(snap).toMatchObject({
      workbook: 'wb1.xlsx',
      sheet: 'Sheet1',
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
    expect(snap.sheet).toBe('')
  })

  it('Parent 取不到时退到 ActiveWorkbook.Name', () => {
    ;(globalThis as { Application?: unknown }).Application = {
      ActiveWorkbook: { Name: 'active.xlsx' },
    }
    const snap = snapshotFromWorksheet({ Name: 'Sheet1' } as never, 1, 'panel')
    expect(snap.workbook).toBe('active.xlsx')
    expect(snap.sheet).toBe('Sheet1')
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

describe('一键套用（registerTargetSheetApplier / applyDataContextToPage）', () => {
  beforeEach(() => {
    resetTargetSheetAppliers()
    document.body.innerHTML = '<main class="main"></main>'
    setStorage({})
  })

  const snapshot = {
    workbook: 'wb1.xlsx',
    sheet: 'Sheet1',
    columns: [],
    rowCount: 0,
    fromPage: 'enrich' as const,
  }

  it('未注册 applier 的页：通知条不显示按钮，applyDataContextToPage 返回 false', () => {
    saveDataContext(snapshot)
    mountDataContextNotice('settings')

    const applyButton = document.querySelector<HTMLButtonElement>(
      '#bgmDataContextNotice button.bgm-btn',
    )
    expect(applyButton).toBeNull()
    expect(applyDataContextToPage('settings')).toBe(false)
  })

  it('注册后通知条出现按钮，点击执行 applier 并把按钮置为「已套用」', () => {
    const received: string[] = []
    registerTargetSheetApplier('highlight', (snap) => {
      received.push(`${snap.workbook}::${snap.sheet}`)
      return true
    })

    saveDataContext(snapshot)
    mountDataContextNotice('highlight')

    const applyButton = document.querySelector<HTMLButtonElement>(
      '#bgmDataContextNotice button.bgm-btn',
    )
    expect(applyButton).not.toBeNull()
    expect(applyButton?.textContent).toBe('↧ 套用到本页')

    applyButton?.click()
    expect(received).toEqual(['wb1.xlsx::Sheet1'])
    expect(applyButton?.textContent).toBe('✓ 已套用')
    expect(applyButton?.disabled).toBe(true)
  })

  it('applier 返回 false 时按钮显示「套用失败」并提示原表不可用', () => {
    registerTargetSheetApplier('highlight', () => false)
    saveDataContext(snapshot)
    mountDataContextNotice('highlight')

    const applyButton = document.querySelector<HTMLButtonElement>(
      '#bgmDataContextNotice button.bgm-btn',
    )
    applyButton?.click()

    expect(applyButton?.textContent).toBe('✗ 套用失败')
    expect(document.getElementById('bgmDataContextNotice')?.textContent).toContain('当前不可用')
  })

  it('applier 抛错不外溢：按钮显示失败，不抛到调用方', () => {
    registerTargetSheetApplier('panel', () => {
      throw new Error('host gone')
    })
    saveDataContext(snapshot)
    mountDataContextNotice('panel')

    const applyButton = document.querySelector<HTMLButtonElement>(
      '#bgmDataContextNotice button.bgm-btn',
    )
    expect(() => applyButton?.click()).not.toThrow()
    expect(applyButton?.textContent).toBe('✗ 套用失败')
  })

  it('同一页重复注册以最后一次为准；resetTargetSheetAppliers 清空后不再支持', () => {
    registerTargetSheetApplier('panel', () => true)
    registerTargetSheetApplier('panel', () => false)
    expect(applyDataContextToPage('panel')).toBe(false)

    resetTargetSheetAppliers()
    expect(hasTargetSheetApplier('panel')).toBe(false)
  })
})
