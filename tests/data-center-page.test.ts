// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/data-center-page.ts` 页面编排单测
 *
 * 断言落在用户可见行为：首屏自动渲染统计、刷新按钮重读表、空搜索表单被拦截、
 * 在线搜索结果能渲染到列表。DOM 用内联骨架（id 与 ui/data-center.html 一致）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  tOr: vi.fn<(key: string, fallback: string, parameters?: Record<string, string>) => string>(),
  bgmLog: vi.fn(),
  getApp: vi.fn(),
  readRangeValues: vi.fn(),
  getLastRow: vi.fn(),
  httpRequest: vi.fn(),
  showToast: vi.fn(),
  searchResultsToRows: vi.fn(),
  writeRowsToResultSheet: vi.fn(),
}))

vi.mock('../ts/i18n/locale-store.js', () => ({ tOr: m.tOr }))
vi.mock('../ts/tools/util/index.js', () => ({ bgmLog: m.bgmLog, getApp: m.getApp }))
vi.mock('../ts/tools/util/sheet.js', () => ({
  readRangeValues: m.readRangeValues,
  getLastRow: m.getLastRow,
}))
vi.mock('../ts/tools/http.js', () => ({ httpRequest: m.httpRequest }))
vi.mock('../ts/ui/dialog.js', () => ({ showToast: m.showToast }))
vi.mock('../ts/services/data-center-export.js', () => ({ searchResultsToRows: m.searchResultsToRows }))
vi.mock('../ts/panel/data-center-sheet-writer.js', () => ({ writeRowsToResultSheet: m.writeRowsToResultSheet }))

const BODY = `
  <button id="dcRefreshButton"></button>
  <button id="dcCheckUpdateButton"></button>
  <button id="dcExportButton"></button>
  <button id="dcSearchButton"></button>
  <button id="dcWriteSheetButton"></button>
  <button id="dcLogClearButton"></button>
  <p id="dcUpdateStatus"></p>
  <div id="dcUpdateDiff"></div>
  <div id="dcStatusPie"></div>
  <div id="dcMonthlyBars"></div>
  <div id="dcComparison"></div>
  <span id="dcRecommendCount"></span>
  <div id="dcRecommendList"></div>
  <input id="dcSearchKeyword" />
  <select id="dcSearchKind"><option value="all"></option><option value="anime"></option></select>
  <input id="dcSearchYear" />
  <input id="dcSearchRating" />
  <select id="dcSearchScope"><option value="both"></option><option value="local"></option><option value="online"></option></select>
  <div id="dcSearchMessage"></div>
  <div id="dcSearchResults"></div>
  <pre id="dcLog"></pre>
`

const HEADER = ['sid', '名称', '观看状态', '完播日', '标签']
const ROWS = [
  HEADER,
  ['1', '科幻番A', '看过', '2026-10-04', '科幻'],
  ['2', '科幻番B', '看过', '2026-11-04', '科幻,冒险'],
  ['3', '在追番C', '在看', '2026-11-01', '冒险'],
]

function click(id: string): void {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`missing #${id}`)
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('data-center-page', () => {
  beforeEach(() => {
    document.body.innerHTML = BODY
    m.tOr.mockImplementation((_key, fallback, parameters) => {
      let text = fallback
      if (parameters !== undefined) {
        for (const [name, value] of Object.entries(parameters)) {
          text = text.replace(`{${name}}`, () => value)
        }
      }
      return text
    })
    m.getApp.mockReturnValue({ ActiveWorkbook: { ActiveSheet: {} } })
    m.readRangeValues.mockReturnValue(ROWS)
    m.getLastRow.mockReturnValue(ROWS.length)
    m.httpRequest.mockResolvedValue({ isFail: () => false, isOk: () => true, data: null })
    m.searchResultsToRows.mockReturnValue([['名称'], ['某番']])
    m.writeRowsToResultSheet.mockReturnValue({ ok: true, written: 1, error: '' })
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('首屏自动读表并渲染统计与推荐', async () => {
    const { initializeDataCenterPage } = await import('../ts/panel/data-center-page.js')
    initializeDataCenterPage()
    expect(document.querySelector('#dcStatusPie svg')).not.toBeNull()
    expect(document.querySelector('#dcMonthlyBars .dc-bar-col')).not.toBeNull()
    expect(document.querySelector('#dcRecommendList .dc-recommend-item')).not.toBeNull()
  })

  it('空搜索表单被拦截，给出提示', async () => {
    const { initializeDataCenterPage } = await import('../ts/panel/data-center-page.js')
    initializeDataCenterPage()
    click('dcSearchButton')
    await vi.waitFor(() => {
      expect(document.getElementById('dcSearchMessage')?.textContent).toContain('至少填写一项')
    })
  })

  it('点击刷新会重新读表', async () => {
    const { initializeDataCenterPage } = await import('../ts/panel/data-center-page.js')
    initializeDataCenterPage()
    const beforeCalls = m.readRangeValues.mock.calls.length
    click('dcRefreshButton')
    expect(m.readRangeValues.mock.calls.length).toBe(beforeCalls + 1)
  })

  it('没有搜索结果时点写入按钮，提示先搜索', async () => {
    const { initializeDataCenterPage } = await import('../ts/panel/data-center-page.js')
    initializeDataCenterPage()
    click('dcWriteSheetButton')
    expect(m.writeRowsToResultSheet).not.toHaveBeenCalled()
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('请先搜索'), 'warn')
  })

  it('搜索出结果后点写入按钮，调用写表并提示条数', async () => {
    const { initializeDataCenterPage } = await import('../ts/panel/data-center-page.js')
    initializeDataCenterPage()
    ;(document.getElementById('dcSearchKeyword') as HTMLInputElement).value = '科幻'
    ;(document.getElementById('dcSearchScope') as HTMLSelectElement).value = 'local'
    click('dcSearchButton')
    await vi.waitFor(() => {
      expect(document.querySelector('#dcSearchResults .dc-result-item')).not.toBeNull()
    })
    click('dcWriteSheetButton')
    expect(m.searchResultsToRows).toHaveBeenCalledTimes(1)
    expect(m.writeRowsToResultSheet).toHaveBeenCalledTimes(1)
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('1 条'), 'success')
  })

  it('无活动工作表时记录日志且不崩', async () => {
    m.getApp.mockReturnValue(null)
    const { initializeDataCenterPage } = await import('../ts/panel/data-center-page.js')
    initializeDataCenterPage()
    expect(document.getElementById('dcLog')?.textContent).toContain('未找到活动工作表')
  })
})
