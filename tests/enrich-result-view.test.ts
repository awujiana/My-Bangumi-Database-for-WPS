// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/enrich-result-view.ts` 单元测试。
 *
 * 覆盖四个导出函数：
 *  - maybeAutoCleanAfterEnrich：设置关/无目标表早退、成功提示、异常兜底（BGM.handleError + 日志）
 *  - showEnrichDetailButton / showEnrichDetail / hideEnrichDetail：纯 DOM 显示切换
 *
 * 依赖全部可 mock：enrich-page-state(配置) / enrich-page-context(state+safeGetElement) /
 * sheet-cleaning(清洗) / dialog(showToast) / util(BGM+bgmLog) / enrich-detail-render(渲染)。
 * safeGetElement 用 document.getElementById 真实现，挂元素即可断言真实 DOM 写入。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  state: { bangumiSheet: null as { Name: string } | null, enrichDetailGroups: [] as unknown[] },
  config: { autoCleanDuplicates: true },
  cleanSheetDuplicates: vi.fn(),
  showToast: vi.fn(),
  bgmLog: vi.fn(),
  handleError: vi.fn(),
}))

vi.mock('../ts/panel/enrich-page-state.js', () => ({
  getEnrichPreviewConfig: () => m.config,
}))
vi.mock('../ts/panel/enrich-page-context.js', () => ({
  state: m.state,
  safeGetElement: (id: string) => document.getElementById(id),
}))
vi.mock('../ts/sync/sheet-cleaning.js', () => ({
  cleanSheetDuplicates: m.cleanSheetDuplicates,
}))
vi.mock('../ts/ui/dialog.js', () => ({
  showToast: m.showToast,
}))
vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  BGM: { handleError: m.handleError, ErrorLevel: { WARN: 'WARN' } },
}))
vi.mock('../ts/panel/enrich-detail-render.js', () => ({
  renderEnrichDetailHtml: () => '<div>detail</div>',
}))

import {
  maybeAutoCleanAfterEnrich,
  showEnrichDetailButton,
  showEnrichDetail,
  hideEnrichDetail,
} from '../ts/panel/enrich-result-view.js'

function mount(id: string): HTMLElement {
  const element = document.createElement('div')
  element.id = id
  document.body.append(element)
  return element
}

describe('panel/enrich-result-view · maybeAutoCleanAfterEnrich', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.state.bangumiSheet = null
    m.config.autoCleanDuplicates = true
    m.cleanSheetDuplicates.mockReturnValue({
      performed: true,
      deletedRows: 2,
      mergedTagGroups: 1,
    })
  })
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('autoCleanDuplicates 关闭时直接早退，不调用清洗', () => {
    m.config.autoCleanDuplicates = false
    maybeAutoCleanAfterEnrich()
    expect(m.cleanSheetDuplicates).not.toHaveBeenCalled()
  })

  it('无目标表时直接早退，不调用清洗', () => {
    m.state.bangumiSheet = null
    maybeAutoCleanAfterEnrich()
    expect(m.cleanSheetDuplicates).not.toHaveBeenCalled()
  })

  it('清洗成功时提示删除行数与合并组数', () => {
    m.state.bangumiSheet = { Name: 'Bangumi' }
    maybeAutoCleanAfterEnrich()
    expect(m.showToast).toHaveBeenCalledWith(
      '富化后自动去重完成：删除 2 行重复数据，合并 1 组标签',
      'success',
    )
  })

  it('清洗抛错时走兜底：handleError + 警告日志', () => {
    m.state.bangumiSheet = { Name: 'Bangumi' }
    m.cleanSheetDuplicates.mockImplementation(() => {
      throw new Error('boom')
    })
    maybeAutoCleanAfterEnrich()
    expect(m.handleError).toHaveBeenCalled()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('富化后自动去重失败'),
    )
  })
})

describe('panel/enrich-result-view · 详细结果弹窗显示切换', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('showEnrichDetailButton：元素存在时显示', () => {
    const element = mount('enrichDetailAction')
    showEnrichDetailButton()
    expect(element.style.display).toBe('')
  })

  it('showEnrichDetail：modal+body 存在时渲染并 flex 显示', () => {
    const modal = mount('enrichDetailModal')
    const body = mount('enrichDetailBody')
    showEnrichDetail()
    expect(body.innerHTML).toBe('<div>detail</div>')
    expect(modal.style.display).toBe('flex')
  })

  it('showEnrichDetail：缺 modal 时早退不抛', () => {
    mount('enrichDetailBody')
    expect(() => showEnrichDetail()).not.toThrow()
  })

  it('hideEnrichDetail：元素存在时隐藏', () => {
    const modal = mount('enrichDetailModal')
    hideEnrichDetail()
    expect(modal.style.display).toBe('none')
  })
})
