// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/enrich-record-view.ts`（富化记录视图）单元测试。
 *
 * 依赖形状：`sync/enrich-record`（3 个具名）、`tools/sanitize`、`tools/string-utilities`、
 * `tools/util/index`（barrel）四个叶子 + **真实** `enrich-page-context`（`safeGetElement`
 * 走真实 `document.getElementById`，所以「容器缺失 → 早退」是真删 DOM 驱动的）。
 *
 * `sanitizeHtml` 刻意 mock 成恒等：DOMPurify 会重排属性顺序，逐字断言模板会变脆；
 * 净化本身由 `tests/xss.test.ts` 覆盖。**但 `escapeHtml` 用真实实现** —— 本文件要断言
 * 的正是「用户数据进模板前被转义」，把它一起 mock 掉就等于把被测行为也 mock 掉了。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnrichRecord } from '../ts/sync/enrich-record.js'

// ========== 依赖替身 ==========

const recordMock = vi.hoisted(() => ({
  getAllEnrichRecords: vi.fn<() => unknown[]>(),
  getOrCreateEnrichRecordSheet: vi.fn<() => unknown>(),
  clearEnrichRecords: vi.fn<() => void>(),
}))

const sanitizeMock = vi.hoisted(() => ({
  sanitizeHtml: vi.fn<(html: string) => string>(),
}))

vi.mock('../ts/tools/util/index.js', async () => {
  const helpers = await import('./helpers/utility-mock.js')
  return helpers.utilityMock
})
vi.mock('../ts/sync/enrich-record.js', () => ({
  getAllEnrichRecords: recordMock.getAllEnrichRecords,
  getOrCreateEnrichRecordSheet: recordMock.getOrCreateEnrichRecordSheet,
  clearEnrichRecords: recordMock.clearEnrichRecords,
}))
vi.mock('../ts/tools/sanitize.js', () => ({ sanitizeHtml: sanitizeMock.sanitizeHtml }))

import {
  clearRecords,
  loadRecentRecords,
  openEnrichRecordSheet,
} from '../ts/panel/enrich-record-view.js'
import { ErrorLevel } from '../ts/core/constants.js'
import { clearDom, mountElement } from './helpers/dom.js'
import { hasLogMessage, resetUtilityMock, utilityMock } from './helpers/utility-mock.js'

/** 构造一条富化记录 */
function makeRecord(overrides: Partial<EnrichRecord> = {}): EnrichRecord {
  return {
    timestamp: '2026-09-15T10:00:00.000Z',
    matchType: '精确',
    name: '葬送的芙莉莲',
    row: 3,
    enrichedField: '脚本',
    oldValue: '',
    updatedValue: '新编剧',
    action: 'fill',
    ...overrides,
  }
}

/** 建好记录视图的计数与列表容器 */
function mountRecordView(): {
  total: HTMLElement
  success: HTMLElement
  skip: HTMLElement
  error: HTMLElement
  list: HTMLElement
} {
  return {
    total: mountElement('totalRecordCount'),
    success: mountElement('successRecordCount'),
    skip: mountElement('skipRecordCount'),
    error: mountElement('errorRecordCount'),
    list: mountElement('recentRecords'),
  }
}

/** 让 `Dialog.confirm` 自动按给定结果回调（驱动「用户点确认 / 取消」两条路） */
function stubConfirm(isConfirmed: boolean): void {
  utilityMock.BGM.Dialog.confirm.mockImplementation((_message, callback) => {
    callback(isConfirmed)
  })
}

beforeEach(() => {
  resetUtilityMock()
  recordMock.getAllEnrichRecords.mockReset()
  recordMock.getOrCreateEnrichRecordSheet.mockReset()
  recordMock.clearEnrichRecords.mockReset()
  sanitizeMock.sanitizeHtml.mockReset()
  // 恒等净化：本文件断言模板与转义，不测净化
  sanitizeMock.sanitizeHtml.mockImplementation((html) => html)
  clearDom()
})

// ========== openEnrichRecordSheet ==========

describe('openEnrichRecordSheet', () => {
  it('打开记录表并记 INFO 日志', () => {
    const sheet = { Name: '富化记录', Activate: vi.fn<() => void>() }
    recordMock.getOrCreateEnrichRecordSheet.mockReturnValue(sheet)
    utilityMock.getApp.mockReturnValue({ ActiveWorkbook: {} })

    openEnrichRecordSheet()

    expect(sheet.Activate).toHaveBeenCalledTimes(1)
    expect(hasLogMessage('[enrich] 已打开富化记录工作表: 富化记录')).toBe(true)
    expect(utilityMock.BGM.handleError).not.toHaveBeenCalled()
  })

  it('没有活动工作簿 → 不激活，也不记日志', () => {
    const sheet = { Name: '富化记录', Activate: vi.fn<() => void>() }
    recordMock.getOrCreateEnrichRecordSheet.mockReturnValue(sheet)
    utilityMock.getApp.mockReturnValue({})

    openEnrichRecordSheet()

    expect(sheet.Activate).not.toHaveBeenCalled()
    expect(utilityMock.bgmLog).not.toHaveBeenCalled()
  })

  it('宿主不可用（getApp 返回 null）→ 不激活', () => {
    const sheet = { Name: '富化记录', Activate: vi.fn<() => void>() }
    recordMock.getOrCreateEnrichRecordSheet.mockReturnValue(sheet)

    openEnrichRecordSheet()

    expect(sheet.Activate).not.toHaveBeenCalled()
  })

  it('建表失败 → 走统一错误处理并弹窗', () => {
    recordMock.getOrCreateEnrichRecordSheet.mockImplementation(() => {
      throw new Error('工作簿不可用')
    })

    openEnrichRecordSheet()

    expect(utilityMock.BGM.handleError).toHaveBeenCalledTimes(1)
    expect(utilityMock.BGM.handleError.mock.calls[0]?.[1]).toEqual({
      showAlert: false,
      level: ErrorLevel.ERROR,
      context: 'openEnrichRecordSheet',
    })
    expect(utilityMock.BGM.Dialog.error).toHaveBeenCalledWith('错误', '无法打开富化记录工作表')
  })
})

// ========== clearRecords ==========

describe('clearRecords', () => {
  it('确认框未回调（用户没点）→ 不清除', () => {
    clearRecords()

    expect(utilityMock.BGM.Dialog.confirm).toHaveBeenCalledWith(
      '确定要清除所有富化记录吗？此操作不可撤销。',
      expect.any(Function),
    )
    expect(recordMock.clearEnrichRecords).not.toHaveBeenCalled()
  })

  it('用户取消 → 不清除也不刷新列表', () => {
    stubConfirm(false)

    clearRecords()

    expect(recordMock.clearEnrichRecords).not.toHaveBeenCalled()
    expect(recordMock.getAllEnrichRecords).not.toHaveBeenCalled()
  })

  it('用户确认 → 清除、刷新列表并记日志', () => {
    stubConfirm(true)
    mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([])

    clearRecords()

    expect(recordMock.clearEnrichRecords).toHaveBeenCalledTimes(1)
    expect(recordMock.getAllEnrichRecords).toHaveBeenCalledTimes(1)
    expect(hasLogMessage('[enrich] 富化记录已清除')).toBe(true)
  })

  it('清除过程抛错 → 走统一错误处理', () => {
    stubConfirm(true)
    recordMock.clearEnrichRecords.mockImplementation(() => {
      throw new Error('删除失败')
    })

    clearRecords()

    expect(utilityMock.BGM.handleError.mock.calls[0]?.[1]).toEqual({
      showAlert: false,
      level: ErrorLevel.ERROR,
      context: 'clearRecords',
    })
  })
})

// ========== loadRecentRecords ==========

describe('loadRecentRecords', () => {
  it('无记录 → 计数归零并显示空态', () => {
    const view = mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([])

    loadRecentRecords()

    expect(view.total.textContent).toBe('0')
    expect(view.success.textContent).toBe('0')
    expect(view.skip.textContent).toBe('0')
    expect(view.error.textContent).toBe('0')
    expect(view.list.innerHTML).toContain('暂无记录')
  })

  it('按 action 分档统计（fill/append 计入成功，skip 与 error 各计）', () => {
    const view = mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([
      makeRecord({ action: 'fill' }),
      makeRecord({ action: 'append' }),
      makeRecord({ action: 'skip' }),
      makeRecord({ action: 'error' }),
      makeRecord({ action: 'fill' }),
    ])

    loadRecentRecords()

    expect(view.total.textContent).toBe('5')
    expect(view.success.textContent).toBe('3')
    expect(view.skip.textContent).toBe('1')
    expect(view.error.textContent).toBe('1')
  })

  it('四档 action 渲染为对应中文标签', () => {
    const view = mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([
      makeRecord({ action: 'fill' }),
      makeRecord({ action: 'append' }),
      makeRecord({ action: 'skip' }),
      makeRecord({ action: 'error' }),
    ])

    loadRecentRecords()

    expect(view.list.innerHTML).toContain('>填充<')
    expect(view.list.innerHTML).toContain('>追加<')
    expect(view.list.innerHTML).toContain('>跳过<')
    expect(view.list.innerHTML).toContain('>错误<')
  })

  it('渲染字段与动作 class', () => {
    const view = mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([
      makeRecord({ action: 'append', enrichedField: '导演', updatedValue: '山田尚子' }),
    ])

    loadRecentRecords()

    expect(view.list.innerHTML).toContain('record-action-append')
    expect(view.list.innerHTML).toContain('葬送的芙莉莲')
    expect(view.list.innerHTML).toContain('导演')
    expect(view.list.innerHTML).toContain('山田尚子')
  })

  it('超过 10 条时只保留最近 10 条且倒序展示', () => {
    const view = mountRecordView()
    const records = Array.from({ length: 11 }, (_item, index) =>
      makeRecord({ name: `第${String(index + 1)}号` }),
    )
    recordMock.getAllEnrichRecords.mockReturnValue(records)

    loadRecentRecords()

    expect(view.list.innerHTML).toContain('第11号')
    expect(view.list.innerHTML).not.toContain('第1号')
    expect(view.list.innerHTML.indexOf('第11号')).toBeLessThan(
      view.list.innerHTML.indexOf('第2号'),
    )
  })

  it('用户数据进模板前被 HTML 转义', () => {
    const view = mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([
      makeRecord({ name: 'A<B', enrichedField: 'C<D', updatedValue: 'E<F' }),
    ])

    loadRecentRecords()

    expect(view.list.innerHTML).not.toContain('<B')
    expect(view.list.innerHTML).not.toContain('<D')
    expect(view.list.innerHTML).not.toContain('<F')
  })

  it('时间戳为空 → 时间位渲染空串', () => {
    const view = mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([makeRecord({ timestamp: '' })])

    loadRecentRecords()

    expect(view.list.innerHTML).toContain('<div class="record-time"></div>')
  })

  it('有时间戳 → 时间位渲染本地化时间', () => {
    const view = mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([
      makeRecord({ timestamp: '2026-09-15T10:00:00.000Z' }),
    ])

    loadRecentRecords()

    // 不写死本地化格式（依赖运行环境时区），只断言时间位不再是空的
    expect(view.list.innerHTML).not.toContain('<div class="record-time"></div>')
    expect(view.list.innerHTML).toMatch(/<div class="record-time">2026/)
  })

  it('列表容器缺失 → 跳过渲染但仍更新计数', () => {
    const total = mountElement('totalRecordCount')
    recordMock.getAllEnrichRecords.mockReturnValue([makeRecord()])

    loadRecentRecords()

    expect(total.textContent).toBe('1')
    // 日志在 `return` 之后，故容器缺失时连日志都不该出现
    expect(hasLogMessage('[enrich] 最近记录已加载')).toBe(false)
  })

  it('计数元素缺失 → 不影响整体流程', () => {
    const list = mountElement('recentRecords')
    recordMock.getAllEnrichRecords.mockReturnValue([makeRecord()])

    expect(() => {
      loadRecentRecords()
    }).not.toThrow()
    expect(list.innerHTML).toContain('葬送的芙莉莲')
  })

  it('全部元素齐备 → 记 INFO 日志（条数为总记录数）', () => {
    mountRecordView()
    recordMock.getAllEnrichRecords.mockReturnValue([makeRecord(), makeRecord()])

    loadRecentRecords()

    expect(hasLogMessage('[enrich] 最近记录已加载: 2 条')).toBe(true)
  })

  it('读取记录抛错 → 走 INFO 级统一错误处理（不打断页面）', () => {
    mountRecordView()
    recordMock.getAllEnrichRecords.mockImplementation(() => {
      throw new Error('COM 调用失败')
    })

    expect(() => {
      loadRecentRecords()
    }).not.toThrow()
    expect(utilityMock.BGM.handleError.mock.calls[0]?.[1]).toEqual({
      showAlert: false,
      level: ErrorLevel.INFO,
      context: 'loadRecentRecords',
    })
  })
})
