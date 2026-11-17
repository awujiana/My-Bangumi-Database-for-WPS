/**
 * @fileoverview 同步配置摘要构造（纯函数）单测
 *
 * `buildSyncConfig` 是零依赖纯函数，原先只有 `exceltobangumi.selection.test.ts`
 * 间接带到其中几条分支；这里补齐四类时间筛选文案与各可选字段的「提供 / 缺省」行为。
 */

import { describe, expect, it } from 'vitest'

import { buildSyncConfig } from '../ts/sync/sync-config-summary.js'

describe('buildSyncConfig', () => {
  it('空上下文返回空对象（所有字段都缺省）', () => {
    expect(buildSyncConfig({})).toEqual({})
  })

  it('source / strategy / direction 原样成为对应标签', () => {
    expect(
      buildSyncConfig({ source: '远程仓库', strategy: '增量更新', direction: '远程仓库 → Excel' }),
    ).toEqual({
      sourceLabel: '远程仓库',
      strategyLabel: '增量更新',
      directionLabel: '远程仓库 → Excel',
    })
  })

  it('selectedRowsOnly 为真时写入 true，为假/缺省时不写字段', () => {
    expect(buildSyncConfig({ selectedRowsOnly: true })).toEqual({ selectedRowsOnly: true })
    expect(buildSyncConfig({ selectedRowsOnly: false })).toEqual({})
  })

  it('空字符串的 source / strategy / direction 不写入字段', () => {
    expect(buildSyncConfig({ source: '', strategy: '', direction: '' })).toEqual({})
  })

  it("时间筛选 future → '预告/未来动漫'（不拼年份）", () => {
    expect(buildSyncConfig({ timeFilter: { range: 'future', year: 2026 } })).toEqual({
      timeFilterLabel: '预告/未来动漫',
    })
  })

  it("时间筛选 year → 'YYYY年全年'", () => {
    expect(buildSyncConfig({ timeFilter: { range: 'year', year: 2026 } })).toEqual({
      timeFilterLabel: '2026年全年',
    })
  })

  it("时间筛选 quarter → 'YYYY年Q月新番'", () => {
    expect(buildSyncConfig({ timeFilter: { range: 'quarter', year: 2026, quarter: 10 } })).toEqual({
      timeFilterLabel: '2026年10月新番',
    })
  })

  it("时间筛选 month → 'YYYY年M月'", () => {
    expect(buildSyncConfig({ timeFilter: { range: 'month', year: 2026, month: 4 } })).toEqual({
      timeFilterLabel: '2026年4月',
    })
  })

  it('extra 非空时写入，空数组不写字段', () => {
    const extra = [{ label: '数据文件', value: 'bangumi.jsonlines.gz' }]
    expect(buildSyncConfig({ extra })).toEqual({ extra })
    expect(buildSyncConfig({ extra: [] })).toEqual({})
  })

  it('多字段组合时互不覆盖', () => {
    expect(
      buildSyncConfig({
        source: '本地文件',
        strategy: '全量覆盖',
        direction: '本地文件 → Excel',
        selectedRowsOnly: true,
        timeFilter: { range: 'year', year: 2025 },
        extra: [{ label: '路径', value: 'data/x.jsonlines.gz' }],
      }),
    ).toEqual({
      sourceLabel: '本地文件',
      strategyLabel: '全量覆盖',
      directionLabel: '本地文件 → Excel',
      selectedRowsOnly: true,
      timeFilterLabel: '2025年全年',
      extra: [{ label: '路径', value: 'data/x.jsonlines.gz' }],
    })
  })
})
