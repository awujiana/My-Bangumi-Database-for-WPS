/**
 * 番剧高亮「实时预览」详情渲染的单元测试
 *
 * 覆盖两件容易悄悄坏掉的事：
 * 1. **转义**：名称与匹配值都来自工作表单元格（用户数据），拼进 HTML 前必须转义 ——
 *    漏一个就是单元格里写 `<img onerror>` 直接执行；
 * 2. **渲染上限**：命中可能上千行，超出部分只能报数、不能静默丢，也不能全量铺进 DOM。
 *
 * @module tests/highlight-preview-render.test
 */
import { describe, expect, it } from 'vitest'

import {
  PREVIEW_DETAIL_LIMIT,
  buildPreviewCardsHtml,
  buildPreviewDetailHtml,
  buildPreviewTableHtml,
  normalizePreviewView,
} from '../ts/panel/highlight-preview-render.js'
import type { PreviewRowDetail } from '../ts/panel/highlight-preview-render.js'

/** 造 n 条命中行（行号从 2 起，模拟表头占第 1 行） */
function makeRows(count: number): PreviewRowDetail[] {
  return Array.from({ length: count }, (_unused, index) => ({
    row: index + 2,
    name: `番剧 ${String(index + 1)}`,
    value: `2026年${String((index % 12) + 1)}月`,
  }))
}

describe('normalizePreviewView', () => {
  it('只认 card，其余一律当表格（坏配置不该把预览渲染成空白）', () => {
    expect(normalizePreviewView('card')).toBe('card')
    expect(normalizePreviewView('table')).toBe('table')
    expect(normalizePreviewView('')).toBe('table')
    expect(normalizePreviewView('CARD')).toBe('table')
    expect(normalizePreviewView('cards')).toBe('table')
  })
})

describe('buildPreviewTableHtml', () => {
  it('三列表头 + 行号 / 名称 / 匹配值', () => {
    const html = buildPreviewTableHtml([{ row: 7, name: '药屋少女', value: '2026年10月' }])

    expect(html).toContain('<th>行</th><th>名称</th><th>匹配值</th>')
    expect(html).toContain('class="highlight-preview-cell-row">7<')
    expect(html).toContain('class="highlight-preview-cell-name" title="药屋少女">药屋少女<')
    expect(html).toContain('class="highlight-preview-cell-value" title="2026年10月">2026年10月<')
  })

  it('名称与匹配值里的 HTML 被转义（title 属性也不能漏）', () => {
    const html = buildPreviewTableHtml([
      { row: 2, name: '<img src=x onerror=alert(1)>', value: '" onmouseover="alert(2)' },
    ])

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // 双引号必须转义，否则 title="…" 会被提前闭合
    expect(html).toContain('title="&quot; onmouseover=&quot;alert(2)"')
    expect(html).not.toContain('onmouseover="alert(2)"')
  })

  it('空名称 / 空匹配值显示占位符，不留空白单元格', () => {
    const html = buildPreviewTableHtml([{ row: 3, name: ' '.repeat(3), value: '' }])

    // 单元格文本各一个占位（title 里也有一份，故按 `>—<` 计数）
    expect(html.match(/>—</gu)).toHaveLength(2)
  })

  it(`超过 ${String(PREVIEW_DETAIL_LIMIT)} 行只渲染前 ${String(PREVIEW_DETAIL_LIMIT)} 行并报总数`, () => {
    const html = buildPreviewTableHtml(makeRows(PREVIEW_DETAIL_LIMIT + 10))

    // 行数 = 上限 + 表头行
    expect(html.match(/<tr>/gu)).toHaveLength(PREVIEW_DETAIL_LIMIT + 1)
    expect(html).toContain(
      `仅显示前 ${String(PREVIEW_DETAIL_LIMIT)} 行，共 ${String(PREVIEW_DETAIL_LIMIT + 10)} 行`,
    )
  })

  it('刚好等于上限时不显示「仅显示前 N 行」', () => {
    const html = buildPreviewTableHtml(makeRows(PREVIEW_DETAIL_LIMIT))

    expect(html).not.toContain('仅显示前')
  })
})

describe('buildPreviewCardsHtml', () => {
  it('一行一张卡，带行号徽标', () => {
    const html = buildPreviewCardsHtml([{ row: 9, name: '芙莉莲', value: '2026年10月' }])

    expect(html.match(/class="highlight-preview-card"/gu)).toHaveLength(1)
    expect(html).toContain('行 9')
    expect(html).toContain('芙莉莲')
  })

  it('同样受渲染上限约束并报总数', () => {
    const html = buildPreviewCardsHtml(makeRows(PREVIEW_DETAIL_LIMIT + 3))

    expect(html.match(/class="highlight-preview-card"/gu)).toHaveLength(PREVIEW_DETAIL_LIMIT)
    expect(html).toContain(`共 ${String(PREVIEW_DETAIL_LIMIT + 3)} 行`)
  })
})

describe('buildPreviewDetailHtml', () => {
  it('无命中返回空串（摘要行已说明「命中 0 行」，不再渲染空表格）', () => {
    expect(buildPreviewDetailHtml([], 'table')).toBe('')
    expect(buildPreviewDetailHtml([], 'card')).toBe('')
  })

  it('按视图分流', () => {
    const rows = makeRows(1)
    expect(buildPreviewDetailHtml(rows, 'table')).toContain('highlight-preview-table')
    expect(buildPreviewDetailHtml(rows, 'card')).toContain('highlight-preview-cards')
  })

  it('视图值非法时按表格渲染', () => {
    const html = buildPreviewDetailHtml(makeRows(1), 'grid' as unknown as 'table')

    expect(html).toContain('highlight-preview-table')
  })
})
