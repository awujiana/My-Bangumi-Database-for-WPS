// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

// sanitizeHtml 走恒等实现：消毒行为已由 tests/xss.test.ts 覆盖，这里只测渲染逻辑，
// 避免 DOMPurify 重排属性导致逐字断言变脆。escapeHtml 走真实实现（jsdom 下可用）。
vi.mock('../ts/tools/sanitize.js', () => ({
  sanitizeHtml: (dirty: string) => dirty,
}))

import type { EnrichResultItem, EnrichedField } from '../ts/sync/enrich-engine.js'
import {
  fieldActionLabel,
  matchTypeLabel,
  renderEnrichDetailHtml,
} from '../ts/panel/enrich-detail-render.js'
import type { EnrichDetailGroup } from '../ts/panel/enrich-detail-render.js'

function makeField(overrides: Partial<EnrichedField> = {}): EnrichedField {
  return {
    fieldName: '导演',
    bangumiColumn: 3,
    oldValue: null,
    updatedValue: '新导演',
    action: 'fill',
    ...overrides,
  }
}

function makeItem(overrides: Partial<EnrichResultItem> = {}): EnrichResultItem {
  return {
    kind: 'matched',
    animeRow: 2,
    name: '某番',
    matchType: 'exact',
    enrichedFields: [],
    ...overrides,
  }
}

function makeGroup(overrides: Partial<EnrichDetailGroup> = {}): EnrichDetailGroup {
  return {
    fileName: '新番表.xlsx',
    items: [],
    ...overrides,
  }
}

describe('panel/enrich-detail-render', () => {
  describe('matchTypeLabel', () => {
    it('四种匹配方式映射为对应中文标记与 badge 类', () => {
      expect(matchTypeLabel('exact')).toEqual({ text: '精确命中', badge: 'exact' })
      expect(matchTypeLabel('alias')).toEqual({ text: '别名匹配', badge: 'alias' })
      expect(matchTypeLabel('error')).toEqual({ text: '错误', badge: 'error' })
    })

    it('unmatched 与未知枚举回落为「新增/未匹配」', () => {
      expect(matchTypeLabel('unmatched')).toEqual({ text: '新增/未匹配', badge: 'unmatched' })
    })
  })

  describe('fieldActionLabel', () => {
    it('fill/append 映射为填充/追加，其余回落为跳过', () => {
      expect(fieldActionLabel('fill')).toEqual({ text: '填充', cls: 'fill' })
      expect(fieldActionLabel('append')).toEqual({ text: '追加', cls: 'append' })
      expect(fieldActionLabel('skip')).toEqual({ text: '跳过', cls: 'skip' })
    })
  })

  describe('renderEnrichDetailHtml - 空数据与统计', () => {
    it('无分组时返回提示文案', () => {
      expect(renderEnrichDetailHtml([])).toBe('暂无富化数据，请先执行富化')
    })

    it('统计已匹配/未匹配/错误条目数与「非跳过」字段数', () => {
      const groups: EnrichDetailGroup[] = [
        makeGroup({
          items: [
            makeItem({
              name: 'A',
              kind: 'matched',
              enrichedFields: [
                makeField({ action: 'fill' }),
                makeField({ action: 'append' }),
                makeField({ action: 'skip' }),
              ],
            }),
            makeItem({ name: 'B', kind: 'unmatched', matchType: 'unmatched' }),
            makeItem({ name: 'C', kind: 'error', matchType: 'error', errorMessage: 'boom' }),
          ],
        }),
      ]

      const html = renderEnrichDetailHtml(groups)
      // 已匹配 1 / 未匹配 1 / 错误 1 / 字段更新 2（skip 不计）
      expect(html).toContain('<div class="enrich-detail-stat-num">1</div>')
      expect(html).toContain('<div class="enrich-detail-stat-num">2</div>')
      expect(html).toContain('已匹配')
      expect(html).toContain('未匹配')
      expect(html).toContain('错误')
      expect(html).toContain('字段更新')
    })

    it('跨分组累计统计', () => {
      const groups: EnrichDetailGroup[] = [
        makeGroup({ fileName: 'f1', items: [makeItem({ name: 'A' })] }),
        makeGroup({ fileName: 'f2', items: [makeItem({ name: 'B' }), makeItem({ name: 'C' })] }),
      ]
      const html = renderEnrichDetailHtml(groups)
      expect(html).toContain('<div class="enrich-detail-stat-num">3</div>')
    })
  })

  describe('renderEnrichDetailHtml - 分组渲染', () => {
    it('空分组的 items 渲染「无条目」占位', () => {
      const html = renderEnrichDetailHtml([makeGroup({ fileName: '空表.xlsx' })])
      expect(html).toContain('class="enrich-detail-group empty"')
      expect(html).toContain('空表.xlsx：无条目')
    })

    it('非空分组带文件名标题', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({ fileName: '新番表.xlsx', items: [makeItem({ name: 'A' })] }),
      ])
      expect(html).toContain('enrich-detail-group-title')
      expect(html).toContain('新番表.xlsx')
    })

    it('文件名中的 HTML 被转义', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({ fileName: '<img src=x onerror=alert(1)>', items: [makeItem({ name: 'A' })] }),
      ])
      expect(html).not.toContain('<img src=x')
      expect(html).toContain('&lt;img')
    })
  })

  describe('renderEnrichDetailHtml - 条目渲染', () => {
    it('error 条目渲染错误徽章与错误信息', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({
          items: [
            makeItem({ kind: 'error', matchType: 'error', name: '坏番', errorMessage: '网络超时' }),
          ],
        }),
      ])
      expect(html).toContain('class="enrich-detail-entry-badge error"')
      expect(html).toContain('错误')
      expect(html).toContain('class="enrich-detail-entry-error"')
      expect(html).toContain('网络超时')
    })

    it('error 条目缺 errorMessage 时回落「未知错误」', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({ items: [makeItem({ kind: 'error', matchType: 'error' })] }),
      ])
      expect(html).toContain('未知错误')
    })

    it('error 条目缺 matchType 时回落 error 徽章', () => {
      const item = makeItem({ kind: 'error', name: '坏番', errorMessage: 'x' })
      delete (item as { matchType?: unknown }).matchType
      const html = renderEnrichDetailHtml([makeGroup({ items: [item] })])
      expect(html).toContain('class="enrich-detail-entry-badge error"')
    })

    it('unmatched 条目只渲染头部、不含字段表', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({
          items: [makeItem({ kind: 'unmatched', matchType: 'unmatched', name: '未匹配番' })],
        }),
      ])
      expect(html).toContain('enrich-detail-entry-badge unmatched')
      expect(html).toContain('新增/未匹配')
      expect(html).not.toContain('enrich-detail-fields')
    })

    it('unmatched 条目缺 matchType 时回落 unmatched 徽章', () => {
      const item = makeItem({ kind: 'unmatched', name: '未匹配番' })
      delete (item as { matchType?: unknown }).matchType
      const html = renderEnrichDetailHtml([makeGroup({ items: [item] })])
      expect(html).toContain('enrich-detail-entry-badge unmatched')
    })

    it('matched 条目带字段时渲染字段表，缺 matchType 回落 exact 徽章', () => {
      const item = makeItem({ name: '命中番', enrichedFields: [makeField()] })
      delete (item as { matchType?: unknown }).matchType
      const html = renderEnrichDetailHtml([makeGroup({ items: [item] })])
      expect(html).toContain('class="enrich-detail-entry-badge exact"')
      expect(html).toContain('精确命中')
      expect(html).toContain('class="enrich-detail-fields"')
    })

    it('matched 条目无字段时渲染「该条目无字段变更」', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({ items: [makeItem({ name: '命中番', enrichedFields: [] })] }),
      ])
      expect(html).toContain('该条目无字段变更')
      expect(html).not.toContain('<table class="enrich-detail-fields">')
    })

    it('条目名中的 HTML 被转义', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({ items: [makeItem({ name: '<script>alert(1)</script>' })] }),
      ])
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })

  describe('renderEnrichDetailHtml - 字段渲染', () => {
    it('字段行渲染原值/新值/操作标记', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({
          items: [
            makeItem({
              enrichedFields: [
                makeField({
                  fieldName: '导演',
                  oldValue: '旧导演',
                  updatedValue: '新导演',
                  action: 'append',
                }),
              ],
            }),
          ],
        }),
      ])
      expect(html).toContain('<td class="field-name">导演</td>')
      expect(html).toContain('<td class="field-old">旧导演</td>')
      expect(html).toContain('<td class="field-new">新导演</td>')
      expect(html).toContain('<td class="field-action append">追加</td>')
    })

    it('空原值与空新值显示「（空）」', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({
          items: [makeItem({ enrichedFields: [makeField({ oldValue: null, updatedValue: '' })] })],
        }),
      ])
      expect(html).toContain('<td class="field-old">（空）</td>')
      expect(html).toContain('<td class="field-new">（空）</td>')
    })

    it('字段名与新值中的 HTML 被转义', () => {
      const html = renderEnrichDetailHtml([
        makeGroup({
          items: [
            makeItem({
              enrichedFields: [makeField({ fieldName: '<b>x</b>', updatedValue: '<i>y</i>' })],
            }),
          ],
        }),
      ])
      expect(html).not.toContain('<b>x</b>')
      expect(html).not.toContain('<i>y</i>')
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    })
  })
})
