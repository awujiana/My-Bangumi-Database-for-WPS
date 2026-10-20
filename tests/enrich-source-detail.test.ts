// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/enrich-source-detail.ts`（源数据完整表格弹窗）单元测试。
 *
 * 依赖形状：3 个叶子（`tools/util/index` barrel、`tools/sanitize`、`tools/string-utilities`）
 * + 2 个同目录兄弟（`enrich-preview-cell`、`enrich-page-state` 的纯常量）+ **真实**
 * `enrich-page-context`（`state` 是被断言的对象，`safeGetElement` 走真实 `getElementById`）。
 *
 * `renderSourceDetailTable` 是**私有函数**，只能经 `showSourceDetail()` 渲染到
 * `sourceDetailBody` 后对 innerHTML 断言 —— 因此每组用例都先建好 modal + body 两个容器。
 *
 * `sanitizeHtml` mock 成恒等（DOMPurify 会重排属性顺序，逐字断言模板会变脆；
 * 净化本身由 `tests/xss.test.ts` 覆盖），但 `escapeHtml` 保持**真实** ——
 * 本文件要断言的正是「用户数据进模板前被转义」。
 *
 * ## 一处刻意不追的不可达分支
 *
 * 第 74 行的 `|| \`第${column}列\`` 兜底**不可达**：进入该表达式的前提是
 * `header || field` 为真，而 header 为空时 `field` 必来自 `fieldByCol`，
 * 其取值只可能是 `COLUMN_MAPPING_FIELDS` 的 key 或 `'platformCol'`，
 * 两者都在 `labelByField` 里 → `?? ''` 永远不会落到最后的 `||`。
 * 造人工输入去点亮它等于给生产代码加一条假前提，故不追。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnrichColumnMapping } from '../ts/sync/enrich-layout.js'

// ========== 依赖替身 ==========

const previewCellMock = vi.hoisted(() => ({
  renderPreviewCell: vi.fn<(key: string, value: string) => string>(),
}))

const sanitizeMock = vi.hoisted(() => ({
  sanitizeHtml: vi.fn<(html: string) => string>(),
}))

vi.mock('../ts/tools/util/index.js', async () => {
  const helpers = await import('./helpers/utility-mock.js')
  return helpers.utilityMock
})
vi.mock('../ts/tools/sanitize.js', () => ({ sanitizeHtml: sanitizeMock.sanitizeHtml }))
vi.mock('../ts/panel/enrich-preview-cell.js', () => ({
  renderPreviewCell: previewCellMock.renderPreviewCell,
}))

import { state } from '../ts/panel/enrich-page-context.js'
import { hideSourceDetail, showSourceDetail } from '../ts/panel/enrich-source-detail.js'
import { clearDom, mountElement } from './helpers/dom.js'
import { resetEnrichState } from './helpers/enrich-context.js'
import { resetUtilityMock, utilityMock } from './helpers/utility-mock.js'

// ========== 工作表替身 ==========

/** `行:列` → 单元格文本 */
let cells = new Map<string, string>()

function setCell(row: number, column: number, value: string): void {
  cells.set(`${String(row)}:${String(column)}`, value)
}

/** 让 `getCellValue` 按地址表取值；未设置的地址返回空串（真实 COM 的空白单元格语义） */
function stubCellReading(): void {
  utilityMock.getCellValue.mockImplementation(
    (_sheet, row, column) => cells.get(`${String(row)}:${String(column)}`) ?? '',
  )
}

function makeMapping(overrides: Partial<EnrichColumnMapping> = {}): EnrichColumnMapping {
  return { nameCol: 0, ...overrides }
}

/** 建好弹窗骨架 */
function mountModal(): { modal: HTMLElement; body: HTMLElement } {
  return {
    modal: mountElement('sourceDetailModal'),
    body: mountElement('sourceDetailBody'),
  }
}

/** 铺一张只有表头的源表（1..50 列都有表头，便于验证截断） */
function fillHeaderRow(headerRow: number, count: number): void {
  for (let column = 1; column <= count; column += 1) {
    setCell(headerRow, column, `H${String(column)}`)
  }
}

beforeEach(() => {
  resetUtilityMock()
  previewCellMock.renderPreviewCell.mockReset()
  previewCellMock.renderPreviewCell.mockImplementation(
    (key, value) => `<td class="preview-cell" data-field="${key}">${value}</td>`,
  )
  sanitizeMock.sanitizeHtml.mockReset()
  sanitizeMock.sanitizeHtml.mockImplementation((html) => html)

  cells = new Map()
  stubCellReading()

  clearDom()
  resetEnrichState()
})

// ========== hideSourceDetail ==========

describe('hideSourceDetail', () => {
  it('弹窗存在 → 隐藏', () => {
    const { modal } = mountModal()

    hideSourceDetail()

    expect(modal.style.display).toBe('none')
  })

  it('弹窗缺失 → 静默返回', () => {
    expect(() => {
      hideSourceDetail()
    }).not.toThrow()
  })
})

// ========== showSourceDetail 的早退 ==========

describe('showSourceDetail 早退', () => {
  it('弹窗容器缺失 → 不改写内容', () => {
    const body = mountElement('sourceDetailBody')
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping(),
    })
    fillHeaderRow(1, 3)
    setCell(2, 1, '葬送的芙莉莲')

    showSourceDetail()

    expect(body.innerHTML).toBe('')
  })

  it('内容容器缺失 → 不切显示态', () => {
    const modal = mountElement('sourceDetailModal')
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping(),
    })

    showSourceDetail()

    expect(modal.style.display).toBe('')
  })

  it('尚未选源工作表 → 直接返回', () => {
    const { modal, body } = mountModal()
    resetEnrichState({ animeSourceSheet: null })

    showSourceDetail()

    expect(body.innerHTML).toBe('')
    expect(modal.style.display).toBe('')
  })
})

// ========== 列集构成 ==========

describe('列集构成', () => {
  it('弹窗齐备 → 渲染并切到 flex 显示态', () => {
    const { modal, body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    fillHeaderRow(1, 2)
    setCell(2, 1, '葬送的芙莉莲')

    showSourceDetail()

    expect(modal.style.display).toBe('flex')
    expect(body.innerHTML).toContain('<table>')
    expect(body.innerHTML).toContain('H1')
    expect(body.innerHTML).toContain('H2')
  })

  it('列映射为 null → 只按表头取列', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    fillHeaderRow(1, 2)

    showSourceDetail()

    expect(body.innerHTML).toContain('H1')
    expect(body.innerHTML).toContain('H2')
    expect(previewCellMock.renderPreviewCell).not.toHaveBeenCalled()
  })

  it('无表头但被映射命中的列 → 用字段标签兜底', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      // nameCol 指向第 3 列：该列表头为空，只能靠字段标签出现
      columnMapping: makeMapping({ nameCol: 3 }),
    })
    fillHeaderRow(1, 1)
    setCell(2, 3, '葬送的芙莉莲')
    utilityMock.getLastRow.mockReturnValue(2)

    showSourceDetail()

    expect(body.innerHTML).toContain('名称')
    expect(previewCellMock.renderPreviewCell).toHaveBeenCalledWith('nameCol', '葬送的芙莉莲')
  })

  it('一列表头与映射都没有 → 整列不出现', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping(),
    })
    fillHeaderRow(1, 1)

    showSourceDetail()

    expect(body.innerHTML).toContain('H1')
    expect(body.innerHTML).not.toContain('H2')
  })

  it('没有任何可用列 → 输出提示而非空表', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })

    showSourceDetail()

    expect(body.innerHTML).toContain('未找到表头列，无法展示完整表格')
    expect(body.innerHTML).not.toContain('<table>')
  })

  it('platformExtraCols 命中的列按平台列渲染', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping({ nameCol: 1, platformExtraCols: [5] }),
    })
    fillHeaderRow(1, 1)
    setCell(2, 5, 'B站')
    utilityMock.getLastRow.mockReturnValue(2)

    showSourceDetail()

    expect(previewCellMock.renderPreviewCell).toHaveBeenCalledWith('platformCol', 'B站')
    expect(body.innerHTML).toContain('播放平台')
  })

  it('映射列复用预览渲染、未映射列走原生 td', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping({ nameCol: 1 }),
    })
    fillHeaderRow(1, 2)
    setCell(2, 1, '葬送的芙莉莲')
    setCell(2, 2, '未映射值')
    utilityMock.getLastRow.mockReturnValue(2)

    showSourceDetail()

    expect(body.innerHTML).toContain('class="preview-cell" data-field="nameCol"')
    expect(body.innerHTML).toContain('<td title="未映射值">未映射值</td>')
  })
})

// ========== 截断与空行 ==========

describe('截断与空行', () => {
  it('列数上限 50：第 51 列不进表', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    fillHeaderRow(1, 51)
    utilityMock.getLastRow.mockReturnValue(1)

    showSourceDetail()

    expect(body.innerHTML).toContain('H50')
    expect(body.innerHTML).not.toContain('H51')
  })

  it('行数上限 100：从 dataStartRow 起最多 100 行', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    fillHeaderRow(1, 1)
    for (let row = 2; row <= 200; row += 1) setCell(row, 1, `v${String(row)}`)
    utilityMock.getLastRow.mockReturnValue(1000)

    showSourceDetail()

    expect(body.innerHTML).toContain('data-row="101"')
    expect(body.innerHTML).not.toContain('data-row="102"')
  })

  it('整行全空 → 不产生数据行', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    fillHeaderRow(1, 1)
    setCell(3, 1, '有值')
    utilityMock.getLastRow.mockReturnValue(3)

    showSourceDetail()

    expect(body.innerHTML).not.toContain('data-row="2"')
    expect(body.innerHTML).toContain('data-row="3"')
  })

  it('源表无数据行 → 表体为空但表头仍在', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    fillHeaderRow(1, 1)
    utilityMock.getLastRow.mockReturnValue(1)

    showSourceDetail()

    expect(body.innerHTML).toContain('<thead>')
    expect(body.innerHTML).toContain('<tbody></tbody>')
  })
})

// ========== 单元格渲染 ==========

describe('单元格渲染', () => {
  it('数据行带行号列', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 4,
      columnMapping: null,
    })
    fillHeaderRow(1, 1)
    setCell(4, 1, '葬送的芙莉莲')
    utilityMock.getLastRow.mockReturnValue(4)

    showSourceDetail()

    expect(body.innerHTML).toContain('<td class="row-num">4</td>')
  })

  // 注意：不能靠 `innerHTML` 里找 '&lt;' 来断言属性转义 —— HTML 序列化会把属性值
  // 里的实体还原成字面量（`title="A&lt;B"` 解析后再序列化就是 `title="A<B"`），
  // 断言会假失败。改为直接取证「值有没有逃出属性上下文」。
  it('未映射列的值含引号 → 不会多出注入属性', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping(),
    })
    fillHeaderRow(1, 1)
    const injected = '" onmouseover="alert(1)'
    setCell(2, 1, injected)
    utilityMock.getLastRow.mockReturnValue(2)

    showSourceDetail()

    const cell = body.querySelector('td[title]')
    expect(cell?.getAttributeNames()).toEqual(['title'])
    expect(cell?.getAttribute('title')).toBe(injected)
    expect(body.innerHTML).not.toContain('onmouseover="alert(1)"')
  })

  it('未映射列的值含标签 → 只作为文本，不生成元素', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: makeMapping(),
    })
    fillHeaderRow(1, 1)
    setCell(2, 1, '<img src=x onerror=1>')
    utilityMock.getLastRow.mockReturnValue(2)

    showSourceDetail()

    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('td[title]')?.getAttribute('title')).toBe('<img src=x onerror=1>')
  })

  it('表头文本同样被转义', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    setCell(1, 1, '标题<script>')
    utilityMock.getLastRow.mockReturnValue(1)

    showSourceDetail()

    expect(body.innerHTML).not.toContain('<script>')
  })

  it('表头两端空白被裁掉（否则空表头会误判为有表头）', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: {} as never,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    setCell(1, 1, ' '.repeat(3))
    utilityMock.getLastRow.mockReturnValue(1)

    showSourceDetail()

    expect(body.innerHTML).toContain('未找到表头列，无法展示完整表格')
  })

  it('先选源表再展示（state 每次 show 都重读）', () => {
    const { body } = mountModal()
    resetEnrichState({
      animeSourceSheet: null,
      headerRow: 1,
      dataStartRow: 2,
      columnMapping: null,
    })
    fillHeaderRow(1, 1)
    setCell(2, 1, '葬送的芙莉莲')
    utilityMock.getLastRow.mockReturnValue(2)

    showSourceDetail()
    expect(body.innerHTML).toBe('')

    state.animeSourceSheet = {} as never
    showSourceDetail()

    expect(body.innerHTML).toContain('葬送的芙莉莲')
  })
})
