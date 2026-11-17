// @vitest-environment jsdom
/**
 * @fileoverview `ts/tools/sheet-list.ts` 工作簿枚举的 COM 防护单测
 *
 * 钉 2026-10-24 真机缺陷的根因：`collectSheets` 此前对 `Workbooks.Count/Item`
 * 零防护——JSAPI 桥未就绪（宿主初始化窗口 / JsApiDevTool 调速器限速）时同步
 * COM 抛错会顺着调用链把整页初始化炸掉，条件格式页的下拉因此「不能点击不能
 * 选中」（绑定段根本没跑到）。现在整段兜底：抛错返回已枚举的部分 + 记 WARN。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: number, message?: string) => void>(),
  getApp: vi.fn<() => unknown>(),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  getApp: m.getApp,
}))

import { activeWorksheet, collectSheets } from '../ts/tools/sheet-list.js'

/** 造一个工作簿集合；`throwAt` 可让第 N 次 Item 调用抛错（模拟桥中途挂掉） */
function makeWorkbooks(specs: { name: string; sheets: string[] }[]): unknown {
  return {
    Count: specs.length,
    Item: (index: number) => {
      const spec = specs[index - 1]
      if (!spec) throw new Error(`工作簿 ${String(index)} 不存在`)
      return {
        Name: spec.name,
        Worksheets: {
          Count: spec.sheets.length,
          Item: (sheetIndex: number) => ({ Name: spec.sheets[sheetIndex - 1] ?? '' }),
        },
      }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('collectSheets', () => {
  it('正常枚举：键 = 工作簿::工作表', () => {
    m.getApp.mockReturnValue({ Workbooks: makeWorkbooks([{ name: '工作簿1', sheets: ['Sheet1', 'Sheet2'] }]) })
    const entries = collectSheets()
    expect(entries.map((entry) => entry.key)).toEqual(['工作簿1::Sheet1', '工作簿1::Sheet2'])
    expect(entries[0]?.workbook).toBe('工作簿1')
    expect(entries[0]?.sheet).toBe('Sheet1')
  })

  it('Workbooks.Count 抛错（桥未就绪）：不抛，返回空数组并记 WARN', () => {
    m.getApp.mockReturnValue({
      get Workbooks(): never {
        throw new Error('JSAPI 桥未就绪')
      },
    })
    expect(() => collectSheets()).not.toThrow()
    expect(collectSheets()).toEqual([])
    expect(m.bgmLog).toHaveBeenCalled()
  })

  it('中途抛错：返回已枚举到的部分（不是全丢）', () => {
    const workbooks = {
      Count: 2,
      Item: (index: number) => {
        if (index === 2) throw new Error('第二个工作簿读取失败')
        return { Name: '工作簿1', Worksheets: { Count: 1, Item: () => ({ Name: 'Sheet1' }) } }
      },
    }
    m.getApp.mockReturnValue({ Workbooks: workbooks })
    const entries = collectSheets()
    expect(entries.map((entry) => entry.key)).toEqual(['工作簿1::Sheet1'])
  })

  it('没有 Application（非 WPS 环境）：空数组', () => {
    m.getApp.mockReturnValue(null)
    expect(collectSheets()).toEqual([])
  })
})

describe('activeWorksheet', () => {
  it('ActiveSheet 抛错时返回 null（不抛）', () => {
    m.getApp.mockReturnValue({
      get ActiveSheet(): never {
        throw new Error('桥未就绪')
      },
    })
    expect(activeWorksheet()).toBeNull()
  })
})
