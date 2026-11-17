// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderStatCards, clearStatCards } from '../ts/ui/stat-cards.js'

/** 建一个干净的容器挂到 body 上 */
function makeContainer(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('renderStatCards 基础渲染', () => {
  it('按传入顺序渲染卡片，值与标签都落地', () => {
    const container = makeContainer()
    renderStatCards(container, [
      { label: '涉及文件', value: 3 },
      { label: '待清理条目', value: 128 },
    ])
    const values = [...container.querySelectorAll(':scope .stat-value')].map(
      (element) => element.textContent,
    )
    const labels = [...container.querySelectorAll(':scope .stat-label')].map(
      (element) => element.textContent,
    )
    expect(values).toEqual(['3', '128'])
    expect(labels).toEqual(['涉及文件', '待清理条目'])
  })

  it('外层包一层 stat-grid（共用栅格样式）', () => {
    const container = makeContainer()
    renderStatCards(container, [{ label: 'a', value: 1 }])
    expect(container.querySelector(':scope .stat-grid')).not.toBeNull()
    expect(container.querySelectorAll(':scope .stat-grid > .stat-card')).toHaveLength(1)
  })

  it('value 支持字符串（已格式化好的值直接展示）', () => {
    const container = makeContainer()
    renderStatCards(container, [{ label: '预计释放', value: '1.2 MB' }])
    expect(container.querySelector('.stat-value')?.textContent).toBe('1.2 MB')
  })
})

describe('renderStatCards 色调', () => {
  it('默认无额外色调类', () => {
    const container = makeContainer()
    renderStatCards(container, [{ label: 'a', value: 1 }])
    expect(container.querySelector('.stat-card')?.className).toBe('stat-card')
  })

  it('指定 tone 时加上对应类名', () => {
    const container = makeContainer()
    renderStatCards(container, [
      { label: 'a', value: 1, tone: 'success' },
      { label: 'b', value: 2, tone: 'error' },
      { label: 'c', value: 3, tone: 'accent' },
    ])
    const classes = [...container.querySelectorAll(':scope .stat-card')].map(
      (element) => element.className,
    )
    expect(classes).toEqual([
      'stat-card stat-card-success',
      'stat-card stat-card-error',
      'stat-card stat-card-accent',
    ])
  })
})

describe('renderStatCards 安全与健壮性', () => {
  it('标签与值会被转义，注入的标签不产生真实元素', () => {
    const container = makeContainer()
    renderStatCards(container, [
      { label: '<img src=x onerror=alert(1)>', value: '<script>alert(2)</script>' },
    ])
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('容器为 null 时静默返回（不抛错）', () => {
    expect(() => renderStatCards(null, [{ label: 'a', value: 1 }])).not.toThrow()
  })

  it('空数组清空容器（预览作废后不留旧统计）', () => {
    const container = makeContainer()
    renderStatCards(container, [{ label: 'a', value: 1 }])
    expect(container.children).toHaveLength(1)
    renderStatCards(container, [])
    expect(container.children).toHaveLength(0)
  })
})

describe('clearStatCards', () => {
  it('清空容器内容', () => {
    const container = makeContainer()
    renderStatCards(container, [{ label: 'a', value: 1 }])
    clearStatCards(container)
    expect(container.children).toHaveLength(0)
  })

  it('容器为 null 时静默返回', () => {
    expect(() => clearStatCards(null)).not.toThrow()
  })
})
