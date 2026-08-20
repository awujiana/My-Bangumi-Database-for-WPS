/**
 * @fileoverview dialog.ts 模块单元测试
 * 测试 buildSyncConfig 工厂函数的各种场景
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

import { buildSyncConfig, renderConfigSummary } from '../ts/ui/dialog.js'

describe('buildSyncConfig', () => {
  beforeEach(() => {
    vi.clearAllTimers()
  })

  describe('基础字段构造', () => {
    it('应正确构造 source 字段', () => {
      const cfg = buildSyncConfig({ source: '远程仓库' })
      expect(cfg.sourceLabel).toBe('远程仓库')
      expect(cfg.strategyLabel).toBeUndefined()
      expect(cfg.directionLabel).toBeUndefined()
    })

    it('应正确构造 strategy 字段', () => {
      const cfg = buildSyncConfig({ strategy: '镜像同步' })
      expect(cfg.strategyLabel).toBe('镜像同步')
      expect(cfg.sourceLabel).toBeUndefined()
    })

    it('应正确构造 direction 字段', () => {
      const cfg = buildSyncConfig({ direction: 'Excel → Bangumi' })
      expect(cfg.directionLabel).toBe('Excel → Bangumi')
    })

    it('应正确构造 selectedRowsOnly 字段', () => {
      const cfg = buildSyncConfig({ selectedRowsOnly: true })
      expect(cfg.selectedRowsOnly).toBe(true)
    })

    it('selectedRowsOnly 为 false 时不应设置', () => {
      const cfg = buildSyncConfig({ selectedRowsOnly: false })
      expect(cfg.selectedRowsOnly).toBeUndefined()
    })
  })

  describe('时间筛选构造', () => {
    it('year 模式应生成正确标签', () => {
      const cfg = buildSyncConfig({
        timeFilter: { range: 'year', year: 2026 },
      })
      expect(cfg.timeFilterLabel).toBe('2026年全年')
    })

    it('quarter 模式应生成正确标签', () => {
      const cfg = buildSyncConfig({
        timeFilter: { range: 'quarter', year: 2026, quarter: 7 },
      })
      expect(cfg.timeFilterLabel).toBe('2026年7月新番')
    })

    it('month 模式应生成正确标签', () => {
      const cfg = buildSyncConfig({
        timeFilter: { range: 'month', year: 2026, month: 5 },
      })
      expect(cfg.timeFilterLabel).toBe('2026年5月')
    })

    it('缺少 quarter 时不应崩溃', () => {
      const cfg = buildSyncConfig({
        timeFilter: { range: 'quarter', year: 2026 },
      })
      expect(cfg.timeFilterLabel).toBe('2026年undefined月新番')
    })

    it('缺少 month 时不应崩溃', () => {
      const cfg = buildSyncConfig({
        timeFilter: { range: 'month', year: 2026 },
      })
      expect(cfg.timeFilterLabel).toBe('2026年undefined月')
    })
  })

  describe('额外字段构造', () => {
    it('应正确构造 extra 数组', () => {
      const cfg = buildSyncConfig({
        extra: [
          { label: '数据范围', value: '第2~100行' },
          { label: '增量', value: '开启' },
        ],
      })
      expect(cfg.extra).toEqual([
        { label: '数据范围', value: '第2~100行' },
        { label: '增量', value: '开启' },
      ])
    })

    it('空 extra 数组不应设置', () => {
      const cfg = buildSyncConfig({ extra: [] })
      expect(cfg.extra).toBeUndefined()
    })
  })

  describe('综合场景', () => {
    it('数据同步完整配置', () => {
      const cfg = buildSyncConfig({
        source: '远程仓库',
        strategy: '镜像同步',
        direction: '远程仓库 → Excel',
        selectedRowsOnly: true,
        timeFilter: { range: 'month', year: 2026, month: 8 },
        extra: [{ label: '版本', value: 'v2' }],
      })
      expect(cfg.sourceLabel).toBe('远程仓库')
      expect(cfg.strategyLabel).toBe('镜像同步')
      expect(cfg.directionLabel).toBe('远程仓库 → Excel')
      expect(cfg.selectedRowsOnly).toBe(true)
      expect(cfg.timeFilterLabel).toBe('2026年8月')
      expect(cfg.extra).toEqual([{ label: '版本', value: 'v2' }])
    })

    it('空配置应返回空对象', () => {
      const cfg = buildSyncConfig({})
      expect(cfg.sourceLabel).toBeUndefined()
      expect(cfg.strategyLabel).toBeUndefined()
      expect(cfg.directionLabel).toBeUndefined()
      expect(cfg.selectedRowsOnly).toBeUndefined()
      expect(cfg.timeFilterLabel).toBeUndefined()
      expect(cfg.extra).toBeUndefined()
    })
  })
})

describe('renderConfigSummary', () => {
  beforeEach(() => {
    vi.clearAllTimers()
  })

  it('空配置应返回空字符串', () => {
    const html = renderConfigSummary({})
    expect(html).toBe('')
  })

  it('单项配置应正确渲染', () => {
    const html = renderConfigSummary({ sourceLabel: '远程仓库' })
    expect(html).toContain('📁 远程仓库')
    expect(html).toContain('cfg-summary')
    expect(html).toContain('cfg-item')
  })

  it('完整配置应正确渲染所有字段', () => {
    const html = renderConfigSummary({
      sourceLabel: '远程仓库',
      strategyLabel: '镜像同步',
      directionLabel: '远程仓库 → Excel',
      timeFilterLabel: '2026年8月',
      selectedRowsOnly: true,
      extra: [{ label: '版本', value: 'v2' }],
    })
    expect(html).toContain('📁 远程仓库')
    expect(html).toContain('🔧 镜像同步')
    expect(html).toContain('📡 远程仓库 → Excel')
    expect(html).toContain('📅 2026年8月')
    expect(html).toContain('⚠️ 仅选中行')
    expect(html).toContain('版本: v2')
  })

  it('selectedRowsOnly 应添加 warn 样式类', () => {
    const html = renderConfigSummary({ selectedRowsOnly: true })
    expect(html).toContain('cfg-item warn')
  })

  it('不应包含未设置的字段', () => {
    const html = renderConfigSummary({ sourceLabel: '测试' })
    expect(html).not.toContain('🔧')
    expect(html).not.toContain('📅')
    expect(html).not.toContain('⚠️')
  })
})
