// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderComparison, renderMonthlyBars, renderStatusPie } from '../ts/ui/data-center-charts.js'

describe('renderStatusPie', () => {
  it('按计数画扇形与图例，总数居中', () => {
    const html = renderStatusPie(
      [
        { status: 1, count: 1 },
        { status: 2, count: 3 },
        { status: 3, count: 0 },
        { status: 4, count: 0 },
        { status: 5, count: 0 },
      ],
      ['想看', '看过', '在看', '搁置', '抛弃'],
    )
    expect(html).toContain('<path')
    expect(html).toContain('看过')
    expect(html).toContain('<strong>4</strong>')
  })

  it('全 0 时画空环不崩', () => {
    const html = renderStatusPie([
      { status: 1, count: 0 },
      { status: 2, count: 0 },
      { status: 3, count: 0 },
      { status: 4, count: 0 },
      { status: 5, count: 0 },
    ])
    expect(html).toContain('<circle')
    expect(html).not.toContain('<path')
  })

  it('图例标签被转义', () => {
    const html = renderStatusPie(
      [
        { status: 1, count: 1 },
        { status: 2, count: 0 },
        { status: 3, count: 0 },
        { status: 4, count: 0 },
        { status: 5, count: 0 },
      ],
      ['<img src=x>', '', '', '', ''],
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})

describe('renderMonthlyBars', () => {
  it('有数据显示柱与月份，无数据显示空文案', () => {
    expect(renderMonthlyBars([{ month: '2026-11', count: 3 }], '暂无')).toContain('2026-11')
    expect(renderMonthlyBars([], '暂无数据')).toContain('暂无数据')
  })
})

describe('renderComparison', () => {
  it('上升用加号与向上箭头', () => {
    const html = renderComparison(
      { current: 5, previous: 4, changePercent: 25 },
      { up: '上升', down: '下降', flat: '持平' },
    )
    expect(html).toContain('+25%')
    expect(html).toContain('▲')
    expect(html).toContain('上升')
  })

  it('下降用向下箭头', () => {
    const html = renderComparison(
      { current: 2, previous: 4, changePercent: -50 },
      { up: '上升', down: '下降', flat: '持平' },
    )
    expect(html).toContain('-50%')
    expect(html).toContain('▼')
  })
})
