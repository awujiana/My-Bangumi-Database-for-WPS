import { describe, it, expect } from 'vitest'
import { getRowRange, getRowRangeSafe } from '../ts/tools/wps.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'

const makeWs = (rangeFunction: unknown): WpsWorksheet =>
  ({
    Name: 'Sheet1',
    Range: rangeFunction,
    Rows: { Item: (row: number) => ({ fallbackRow: row }) },
  }) as unknown as WpsWorksheet

describe('getRowRange / getRowRangeSafe', () => {
  it('getRowRange 用 Range 返回行区间地址', () => {
    const ws = makeWs((addr: string) => ({ address: addr }))
    expect(getRowRange(ws, 3)).toEqual({ address: '3:3' })
  })

  it('getRowRange 非法行号抛错', () => {
    const ws = makeWs((addr: string) => ({ address: addr }))
    expect(() => getRowRange(ws, 0)).toThrow(/positive integer/)
    expect(() => getRowRange(ws, NaN)).toThrow()
  })

  it('getRowRange 缺 Range 抛 TypeError', () => {
    const ws = { Name: 'x' } as unknown as WpsWorksheet
    expect(() => getRowRange(ws, 1)).toThrow(TypeError)
  })

  it('getRowRangeSafe 主路径复用 Range', () => {
    const ws = makeWs((addr: string) => ({ address: addr }))
    expect(getRowRangeSafe(ws, 2)).toEqual({ address: '2:2' })
  })

  it('getRowRangeSafe Range 失败时回退 Rows.Item', () => {
    const ws = makeWs(() => {
      throw new Error('no Range')
    })
    expect(getRowRangeSafe(ws, 5)).toEqual({ fallbackRow: 5 })
  })

  it('getRowRangeSafe 双失败抛错', () => {
    const ws = makeWs(() => {
      throw new Error('no Range')
    })
    ;(ws as { Rows: { Item: (row: number) => unknown } }).Rows.Item = () => {
      throw new Error('no Rows')
    }
    expect(() => getRowRangeSafe(ws, 5)).toThrow(/Failed to access row 5/)
  })
})
