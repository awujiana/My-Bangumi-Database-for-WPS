// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖：隔离预览配置与噪声过滤，其余走真实实现（escapeHtml 为纯函数，jsdom 下可用）。
vi.mock('../ts/panel/enrich-page-state.js', () => ({
  getEnrichPreviewConfig: vi.fn(),
}))

vi.mock('../ts/sync/enrich-normalize.js', () => ({
  shouldFilterNoise: vi.fn((part: string) => part === '噪声'),
}))

import { getEnrichPreviewConfig } from '../ts/panel/enrich-page-state.js'
import type { EnrichPreviewConfig } from '../ts/panel/enrich-page-state.js'
import { renderPlatformChipsCell, renderPreviewCell } from '../ts/panel/enrich-preview-cell.js'

function setConfig(overrides: Partial<EnrichPreviewConfig> = {}): void {
  vi.mocked(getEnrichPreviewConfig).mockReturnValue({
    epSingle: 1,
    epFull: 12,
    tagsColor: true,
    premiereColor: true,
    platformColor: true,
    autoCleanDuplicates: true,
    ...overrides,
  })
}

describe('panel/enrich-preview-cell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setConfig()
  })

  describe('renderPreviewCell - 通用', () => {
    it('空值/空白值返回空 td', () => {
      expect(renderPreviewCell('nameCol', '')).toBe('<td></td>')
      expect(renderPreviewCell('tagsCol', ' '.repeat(3))).toBe('<td></td>')
    })

    it('名称列加粗渲染', () => {
      expect(renderPreviewCell('nameCol', 'Hi')).toBe(
        '<td class="col-name" title="Hi"><span class="preview-name">Hi</span></td>',
      )
    })

    it('未特殊处理的字段回落为通用 td', () => {
      expect(renderPreviewCell('specialCol', 'X')).toBe('<td title="X">X</td>')
    })

    it('HTML 特殊字符被转义', () => {
      const html = renderPreviewCell('nameCol', '<b>&"')
      expect(html).toContain('&lt;b&gt;')
      expect(html).not.toContain('<b>')
    })
  })

  describe('renderPreviewCell - tagsCol', () => {
    it('tagsColor 开启时每项渲染彩色 tag-chip', () => {
      const html = renderPreviewCell('tagsCol', 'A|B')
      expect(html).toMatch(/^<td class="col-tags">/)
      expect(html).toContain('class="tag-chip"')
      expect(html).toContain('>A</span>')
      expect(html).toContain('>B</span>')
    })

    it('tagsColor 关闭时退化为纯文本 td', () => {
      setConfig({ tagsColor: false })
      expect(renderPreviewCell('tagsCol', 'A|B')).toBe('<td title="A|B">A|B</td>')
    })

    it('噪声项被过滤', () => {
      const html = renderPreviewCell('tagsCol', 'A|噪声')
      expect(html).toContain('>A</span>')
      expect(html).not.toContain('噪声')
    })
  })

  describe('renderPreviewCell - premiereCol', () => {
    it('premiereColor 开启时渲染 premiere-chip', () => {
      const html = renderPreviewCell('premiereCol', '2024-01')
      expect(html).toContain('class="premiere-chip"')
      expect(html).toContain('title="2024-01"')
    })

    it('premiereColor 关闭时退化为纯文本 td', () => {
      setConfig({ premiereColor: false })
      expect(renderPreviewCell('premiereCol', '2024-01')).toBe('<td title="2024-01">2024-01</td>')
    })
  })

  describe('renderPreviewCell - 平台列', () => {
    it('platformCol / exclusiveCol 复用平台徽章', () => {
      expect(renderPreviewCell('platformCol', 'B站')).toContain('class="col-platform"')
      expect(renderPreviewCell('exclusiveCol', 'B站')).toContain('class="col-platform"')
    })

    it('platformColor 关闭时不写内联 style', () => {
      setConfig({ platformColor: false })
      const html = renderPreviewCell('platformCol', 'B站')
      expect(html).toContain('<span class="platform-chip" title="B站">B站</span>')
      expect(html).not.toContain('style=')
    })
  })

  describe('renderPreviewCell - weekdayCol', () => {
    it('合法周几渲染对应修饰类', () => {
      expect(renderPreviewCell('weekdayCol', '周一')).toBe(
        '<td title="周一"><span class="weekday-chip weekday-mon">周一</span></td>',
      )
      expect(renderPreviewCell('weekdayCol', '周天')).toBe(
        '<td title="周天"><span class="weekday-chip weekday-sun">周天</span></td>',
      )
    })

    it('非法周几回落为通用 td', () => {
      expect(renderPreviewCell('weekdayCol', '周八')).toBe('<td title="周八">周八</td>')
    })
  })

  describe('renderPreviewCell - episodesCol', () => {
    it('默认阈值：1=ep-single / 5=ep-short / 12=无 / 13=ep-full', () => {
      expect(renderPreviewCell('episodesCol', '1')).toBe(
        '<td title="1"><span class="ep-chip ep-single">1</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '5')).toBe(
        '<td title="5"><span class="ep-chip ep-short">5</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '12')).toBe(
        '<td title="12"><span class="">12</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '13')).toBe(
        '<td title="13"><span class="ep-chip ep-full">13</span></td>',
      )
    })

    it('无法解析或非正数时无色', () => {
      expect(renderPreviewCell('episodesCol', 'abc')).toBe(
        '<td title="abc"><span class="">abc</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '0')).toBe(
        '<td title="0"><span class="">0</span></td>',
      )
    })

    it('配置错误（single >= full）时走兜底分支', () => {
      setConfig({ epSingle: 5, epFull: 3 })
      expect(renderPreviewCell('episodesCol', '5')).toBe(
        '<td title="5"><span class="ep-chip ep-single">5</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '4')).toBe(
        '<td title="4"><span class="ep-chip ep-full">4</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '2')).toBe(
        '<td title="2"><span class="">2</span></td>',
      )
    })

    it('读取预览配置抛异常时阈值回落出厂默认（1 / 12），不影响单元格渲染', () => {
      // 阈值 getter 各自 try/catch：配置层异常不应让整个预览渲染失败
      vi.mocked(getEnrichPreviewConfig).mockImplementation(() => {
        throw new Error('配置读取失败')
      })

      expect(renderPreviewCell('episodesCol', '1')).toBe(
        '<td title="1"><span class="ep-chip ep-single">1</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '12')).toBe(
        '<td title="12"><span class="">12</span></td>',
      )
      expect(renderPreviewCell('episodesCol', '13')).toBe(
        '<td title="13"><span class="ep-chip ep-full">13</span></td>',
      )
    })
  })

  describe('renderPlatformChipsCell', () => {
    it('platformColor 开启时每个平台独立着色且同文本同色', () => {
      const first = renderPlatformChipsCell(['B站'])
      const second = renderPlatformChipsCell(['B站'])
      expect(first).toBe(second)
      expect(first).toMatch(/^<td class="col-platform">/)
      expect(first).toContain('class="platform-chip"')
      expect(first).toContain('style="background:rgba(')
    })

    it('platformColor 关闭时纯文本徽章', () => {
      setConfig({ platformColor: false })
      expect(renderPlatformChipsCell(['B站', 'A站'])).toBe(
        '<td class="col-platform"><span class="platform-chip" title="B站">B站</span><span class="platform-chip" title="A站">A站</span></td>',
      )
    })
  })
})
