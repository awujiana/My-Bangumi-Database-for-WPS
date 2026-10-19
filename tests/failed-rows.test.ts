/**
 * @fileoverview `ts/core/failed-rows.ts`（上次同步失败行留档）单元测试。
 *
 * 契约：去重升序、非法值剔除、空则不留档；地址串把连续行合并成块；
 * 超长时返回 null（让调用方提示分批，而不是抛一个 COM 错误）。
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildFailedRowsAddress,
  clearLastFailedRows,
  getLastFailedRows,
  setLastFailedRows,
} from '../ts/core/failed-rows.js'

describe('setLastFailedRows / getLastFailedRows', () => {
  beforeEach(() => {
    clearLastFailedRows()
  })

  it('去重 + 升序 + 记住所属表名', () => {
    setLastFailedRows([9, 3, 9, 5], '动画')
    expect(getLastFailedRows()).toEqual({ rows: [3, 5, 9], sheetName: '动画' })
  })

  it('剔除非法行号（0 / 负数 / NaN）', () => {
    setLastFailedRows([0, -2, NaN, 4], '动画')
    expect(getLastFailedRows()?.rows).toEqual([4])
  })

  it('没有失败行时不留档（返回 null）', () => {
    setLastFailedRows([], '动画')
    expect(getLastFailedRows()).toBeNull()
  })

  it('返回防御性拷贝：调用方改到也不会污染内部状态', () => {
    setLastFailedRows([3, 5], '动画')
    const first = getLastFailedRows()
    first?.rows.push(99)
    expect(getLastFailedRows()?.rows).toEqual([3, 5])
  })

  it('clearLastFailedRows 清空', () => {
    setLastFailedRows([3], '动画')
    clearLastFailedRows()
    expect(getLastFailedRows()).toBeNull()
  })
})

describe('buildFailedRowsAddress', () => {
  it('单行 → 单格地址', () => {
    expect(buildFailedRowsAddress([7])).toBe('A7')
  })

  it('连续行合并成块', () => {
    expect(buildFailedRowsAddress([3, 4, 5])).toBe('A3:A5')
  })

  it('不连续行拆成多块（逗号分隔多区域）', () => {
    expect(buildFailedRowsAddress([3, 7, 8, 12])).toBe('A3,A7:A8,A12')
  })

  it('乱序输入也按升序拼（Range 地址要求升序）', () => {
    expect(buildFailedRowsAddress([12, 3, 8])).toBe('A3,A8,A12')
  })

  it('空 / 全非法 → null', () => {
    expect(buildFailedRowsAddress([])).toBeNull()
    expect(buildFailedRowsAddress([0, -1])).toBeNull()
  })

  it('行号过多导致地址超长 → null（调用方应提示分批，不能硬抛 COM 错误）', () => {
    // 每行约 3 字符（"A12,"），240 上限约能放 60 个不连续行
    const many: number[] = []
    for (let row = 1; row <= 200; row += 2) many.push(row)
    expect(buildFailedRowsAddress(many)).toBeNull()
  })
})
