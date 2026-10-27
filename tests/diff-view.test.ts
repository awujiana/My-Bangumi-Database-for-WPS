// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/diff-view.ts`（diff2html 风格 diff 渲染模块）单元测试。
 *
 * 覆盖三条关键路径：
 *  1. 纯函数 `splitInlineDiff` 的公共前后缀裁剪边界；
 *  2. 渲染结构（区块头 / 表头 / 行标记 / context 跨列 / 行内高亮 span）；
 *  3. 安全（escapeHtml + sanitizeHtml 双路径，真实 DOMPurify 严格白名单）
 *    与分页（首页行数 / 「显示更多」按批追加 / 按钮收尾 / 行片段走
 *     sanitizeTableRows 保住 tr 结构）。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  appendDiffPage,
  renderDiffRow,
  renderDiffSections,
  splitInlineDiff,
} from '../ts/ui/diff-view.js'
import type { DiffSection } from '../ts/ui/diff-view.js'

/** 建一个挂到 body 上的干净容器 */
function makeContainer(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

beforeEach(() => {
  document.body.replaceChildren()
})
/** 造一个 N 行的区块 */
function makeSection(rowCount: number, id = 'paged'): DiffSection {
  return {
    id,
    title: '待删除行',
    columns: ['名称'],
    rows: Array.from({ length: rowCount }, (_, index) => ({
      kind: 'delete' as const,
      rowNumber: index + 2,
      cells: [`条目${String(index)}`],
    })),
  }
}


// ========== splitInlineDiff ==========

describe('splitInlineDiff · 公共前后缀裁剪', () => {
  it('完全相同 → 全前缀、中段为空', () => {
    expect(splitInlineDiff('标签X', '标签X')).toEqual({
      prefix: '标签X',
      oldMid: '',
      nextMid: '',
      suffix: '',
    })
  })

  it('仅尾部追加 → 前缀即旧值，新中段为追加部分', () => {
    expect(splitInlineDiff('标签X', '标签X | 标签Y')).toEqual({
      prefix: '标签X',
      oldMid: '',
      nextMid: ' | 标签Y',
      suffix: '',
    })
  })

  it('首尾相同、中段不同 → 中段被隔离', () => {
    expect(splitInlineDiff('a[X]b', 'a[Y]b')).toEqual({
      prefix: 'a[',
      oldMid: 'X',
      nextMid: 'Y',
      suffix: ']b',
    })
  })

  it('完全不同 → 前缀为空、旧值整体为中段', () => {
    expect(splitInlineDiff('abc', 'xyz')).toEqual({
      prefix: '',
      oldMid: 'abc',
      nextMid: 'xyz',
      suffix: '',
    })
  })

  it('旧值为空 → 整体为新值', () => {
    expect(splitInlineDiff('', '新值')).toEqual({
      prefix: '',
      oldMid: '',
      nextMid: '新值',
      suffix: '',
    })
  })
})

// ========== 渲染结构 ==========

describe('renderDiffSections · 基础渲染', () => {
  const section: DiffSection = {
    id: 'wb::动画::duplicateNameRows::rows',
    title: '删除名称重复行 · 待删除行',
    subtitle: '工作簿 / 动画 · 删 2 行 · 1 组',
    columns: ['名称', 'Bangumi_URL', '说明'],
    rows: [
      { kind: 'context', cells: ['第 1 组 · 名称「动画A」'] },
      { kind: 'keep', rowNumber: 12, cells: ['动画A', 'https://bgm.tv/x'], note: '保留' },
      { kind: 'delete', rowNumber: 45, cells: ['动画A', ''], note: '无 URL' },
    ],
  }

  it('区块头 / 表头 / 行全部落地', () => {
    const container = makeContainer()
    renderDiffSections(container, [section])
    expect(container.querySelector(':scope .diff-section-title')?.textContent).toBe(
      '删除名称重复行 · 待删除行',
    )
    expect(container.querySelector(':scope .diff-section-subtitle')?.textContent).toBe(
      '工作簿 / 动画 · 删 2 行 · 1 组',
    )
    const headers = [...container.querySelectorAll(':scope .diff-table th')].map(
      (element) => element.textContent,
    )
    expect(headers).toEqual(['', '行号', '名称', 'Bangumi_URL', '说明'])
    const rows = container.querySelectorAll(':scope .diff-table tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.className).toContain('diff-row-context')
    expect(rows[1]?.className).toContain('diff-row-keep')
    expect(rows[2]?.className).toContain('diff-row-delete')
  })

  it('行号与单元格文本正确，行尾说明进最后一个单元格', () => {
    const container = makeContainer()
    renderDiffSections(container, [section])
    const keepRow = container.querySelectorAll(':scope .diff-table tbody tr')[1]
    expect(keepRow?.querySelector(':scope .diff-row-num')?.textContent).toBe('12')
    const keepCells = [...keepRow?.querySelectorAll(':scope .diff-cell') ?? []].map(
      (element) => element.textContent,
    )
    expect(keepCells).toEqual(['动画A', 'https://bgm.tv/x 保留'])
    const removedRow = container.querySelectorAll(':scope .diff-table tbody tr')[2]
    const removedCells = [...removedRow?.querySelectorAll(':scope .diff-cell') ?? []].map(
      (element) => element.textContent,
    )
    expect(removedCells).toEqual(['动画A', ' 无 URL'])
  })

  it('context 行跨列（标记 + 行号 + 数据列）', () => {
    const container = makeContainer()
    renderDiffSections(container, [section])
    const contextCell = container.querySelector(':scope .diff-context')
    // 3 数据列 + 标记列 + 行号列
expect(contextCell?.getAttribute('colspan')).toBe('5')
    expect(contextCell?.textContent).toBe('第 1 组 · 名称「动画A」')
  })

  it('行内 diff：delete 行高亮旧中段、insert 行高亮新中段', () => {
    const container = makeContainer()
    renderDiffSections(container, [
      {
        id: 'cells',
        title: '标签格式标准化 · 单元格变更',
        columns: ['列', '值'],
        rows: [
          {
            kind: 'delete',
            rowNumber: 23,
            cells: ['标签/分级', '动画A[旧]'],
            inlineDiff: { oldValue: '动画A[旧]', nextValue: '动画A[新]' },
          },
          {
            kind: 'insert',
            rowNumber: 23,
            cells: ['标签/分级', '动画A[新]'],
            inlineDiff: { oldValue: '动画A[旧]', nextValue: '动画A[新]' },
          },
        ],
      },
    ])
    const rows = container.querySelectorAll(':scope .diff-table tbody tr')
    const removedCell = rows[0]?.querySelectorAll(':scope .diff-cell')[1]
    expect(removedCell?.textContent).toBe('动画A[旧]')
    expect(removedCell?.querySelector(':scope .diff-del')?.textContent).toBe('旧')
    const insertCell = rows[1]?.querySelectorAll(':scope .diff-cell')[1]
    expect(insertCell?.textContent).toBe('动画A[新]')
    expect(insertCell?.querySelector(':scope .diff-ins')?.textContent).toBe('新')
  })

  it('行内 diff：纯尾部追加时 delete 行只展示旧值、不渲染空高亮', () => {
    const container = makeContainer()
    renderDiffSections(container, [
      {
        id: 'cells-append',
        title: '标签合并',
        columns: ['列', '值'],
        rows: [
          {
            kind: 'delete',
            rowNumber: 2,
            cells: ['标签/分级', '标签X'],
            inlineDiff: { oldValue: '标签X', nextValue: '标签X | 标签Y' },
          },
          {
            kind: 'insert',
            rowNumber: 2,
            cells: ['标签/分级', '标签X | 标签Y'],
            inlineDiff: { oldValue: '标签X', nextValue: '标签X | 标签Y' },
          },
        ],
      },
    ])
    const rows = container.querySelectorAll(':scope .diff-table tbody tr')
    const removedCell = rows[0]?.querySelectorAll(':scope .diff-cell')[1]
    expect(removedCell?.textContent).toBe('标签X')
    expect(removedCell?.querySelector(':scope .diff-del')).toBeNull()
    const insertCell = rows[1]?.querySelectorAll(':scope .diff-cell')[1]
    expect(insertCell?.querySelector(':scope .diff-ins')?.textContent).toBe(' | 标签Y')
  })

  it('renderDiffRow 纯函数：标记与 class 按行类型映射', () => {
    expect(renderDiffRow({ kind: 'delete', cells: ['x'] }, 1)).toContain('diff-row-delete')
    expect(renderDiffRow({ kind: 'delete', cells: ['x'] }, 1)).toContain('>-</td>')
    expect(renderDiffRow({ kind: 'insert', cells: ['x'] }, 1)).toContain('>+</td>')
    expect(renderDiffRow({ kind: 'keep', cells: ['x'] }, 1)).toContain('diff-row-keep')
  })
})

// ========== 安全 ==========

describe('renderDiffSections · 安全（escapeHtml + sanitizeHtml）', () => {
  it('单元格内的注入 payload 被转义，不产生 img 元素', () => {
    const container = makeContainer()
    renderDiffSections(container, [
      {
        id: 'xss',
        title: '<img src=x onerror="alert(1)">',
        subtitle: '<script>alert(2)</script>',
        columns: ['<b>列</b>'],
        rows: [
          {
            kind: 'delete',
            rowNumber: 1,
            cells: ['<img src=x onerror="alert(3)">', '<a href="javascript:alert(4)">x</a>'],
          },
        ],
      },
    ])
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(3)">')
    expect(container.querySelector(':scope .diff-section-title')?.textContent).toBe(
      '<img src=x onerror="alert(1)">',
    )
  })
})

// ========== 分页 ==========

describe('renderDiffSections · 分页', () => {
    it('首页只渲染 pageSize 行，其余进「显示更多」', () => {
    const container = makeContainer()
    renderDiffSections(container, [makeSection(5)], { pageSize: 2 })
    expect(container.querySelectorAll(':scope .diff-table tbody tr')).toHaveLength(2)
    const button = container.querySelector<HTMLButtonElement>('[data-diff-more]')
    expect(button?.textContent).toBe('显示更多（剩余 3 行）')
  })

  it('appendDiffPage 按批追加，行片段保住 tr 结构（sanitizeTableRows）', () => {
    const container = makeContainer()
    renderDiffSections(container, [makeSection(5)], { pageSize: 2 })
    const remaining = appendDiffPage(container, 'paged')
    expect(remaining).toBe(1)
    expect(container.querySelectorAll(':scope .diff-table tbody tr')).toHaveLength(4)
    expect(container.querySelectorAll(':scope .diff-table tbody tr')[2]?.textContent).toContain('条目2')
    expect(container.querySelector('[data-diff-more]')?.textContent).toBe('显示更多（剩余 1 行）')
  })

  it('追加完最后一批后按钮移除', () => {
    const container = makeContainer()
    renderDiffSections(container, [makeSection(5)], { pageSize: 2 })
    appendDiffPage(container, 'paged')
    appendDiffPage(container, 'paged')
    expect(container.querySelectorAll(':scope .diff-table tbody tr')).toHaveLength(5)
    expect(container.querySelector('[data-diff-more]')).toBeNull()
  })

  it('点击「显示更多」触发追加（容器点击委托）', () => {
    const container = makeContainer()
    renderDiffSections(container, [makeSection(5)], { pageSize: 2 })
    container.querySelector<HTMLButtonElement>('[data-diff-more]')?.click()
    expect(container.querySelectorAll(':scope .diff-table tbody tr')).toHaveLength(4)
  })

  it('重新渲染重置分页进度', () => {
    const container = makeContainer()
    renderDiffSections(container, [makeSection(5)], { pageSize: 2 })
    appendDiffPage(container, 'paged')
    renderDiffSections(container, [makeSection(5)], { pageSize: 2 })
    expect(container.querySelectorAll(':scope .diff-table tbody tr')).toHaveLength(2)
  })

  it('appendDiffPage 对未知 section id 静默返回 0', () => {
    const container = makeContainer()
    renderDiffSections(container, [makeSection(5)], { pageSize: 2 })
    expect(appendDiffPage(container, '不存在')).toBe(0)
  })
})

// ========== 边界 ==========

describe('renderDiffSections · 边界', () => {
  it('空区块列表 → 清空容器', () => {
    const container = makeContainer()
    container.innerHTML = '<p>旧内容</p>'
    renderDiffSections(container, [])
    expect(container.innerHTML).toBe('')
  })

  it('容器为 null → 静默返回', () => {
    expect(() => {
      renderDiffSections(null, [
        { id: 'a', title: 't', columns: ['c'], rows: [{ kind: 'delete', cells: ['v'] }] },
      ])
    }).not.toThrow()
  })

  it('多区块按序渲染且互不串扰', () => {
    const container = makeContainer()
    renderDiffSections(
      container,
      [
        { id: 'a', title: '区块A', columns: ['列'], rows: [{ kind: 'delete', cells: ['a1'] }] },
        { id: 'b', title: '区块B', columns: ['列'], rows: [{ kind: 'delete', cells: ['b1'] }] },
      ],
      { pageSize: 1 },
    )
    const titles = [...container.querySelectorAll(':scope .diff-section-title')].map(
      (element) => element.textContent,
    )
    expect(titles).toEqual(['区块A', '区块B'])
    expect(container.querySelectorAll(':scope .diff-section')).toHaveLength(2)
  })
})
