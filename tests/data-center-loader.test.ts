// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { loadRecordsWith, rowsToRecords } from '../ts/panel/data-center-loader.js'

const HEADER = ['sid', '名称', '观看状态', '完播日', '标签']

describe('rowsToRecords', () => {
  it('按表头定位列并标准化状态', () => {
    const records = rowsToRecords([
      HEADER,
      ['1', '进击的巨人', '看过', '2026-11-04', '科幻,冒险'],
      ['2', '电锯人', '在看', '2026-10-01', '动作'],
      ['', '无SID', '想看', '', ''],
    ])
    expect(records).toHaveLength(3)
    expect(records[0]).toEqual({
      sid: '1',
      name: '进击的巨人',
      watchStatus: 2,
      date: '2026-11-04',
      tags: '科幻,冒险',
    })
    expect(records[2]?.sid).toBe('无SID')
  })

  it('跳过空名称行与不足两行', () => {
    expect(rowsToRecords([HEADER])).toEqual([])
    expect(rowsToRecords([HEADER, ['1', '', '看过', '', '']])).toEqual([])
  })

  it('找不到名称列返回空', () => {
    expect(rowsToRecords([['编号', '标题'], ['1', '某番']])).toEqual([])
  })
})

describe('loadRecordsWith', () => {
  it('把注入的读取函数结果转换，lastRow<1 直接返回空', () => {
    expect(loadRecordsWith(() => [], 0)).toEqual([])
    const records = loadRecordsWith(
      () => [HEADER, ['1', '某番', '看过', '2026-11-01', '科幻']],
      2,
    )
    expect(records).toHaveLength(1)
    expect(records[0]?.watchStatus).toBe(2)
  })
})
