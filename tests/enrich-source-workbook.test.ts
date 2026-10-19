/**
 * @fileoverview enrich-source-workbook 单测：源工作簿的打开 / 回收
 *
 * 这里锁的是**最容易出事、也最难在真机复现**的一条规则：
 * 只回收「本插件自己打开的那一个」源工作簿，用户已打开的文件绝不能关。
 * 另外 `closeSourceWorkbookOnly` 必须保留已识别的表头/列映射（重开时复用），
 * 而 `closeOpenedSourceWorkbook` 要连匹配结果一起清掉。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../ts/tools/util/index.js', () => ({
  getApp: vi.fn(),
  bgmLog: vi.fn(),
}))
vi.mock('../ts/tools/locked-sheet.js', () => ({
  getOpenWorkbooks: vi.fn(() => []),
}))
vi.mock('../ts/core/constants.js', () => ({
  // 数值与真实模块逐项对齐（DEBUG 是最低级别，不是最高）
  LOG_LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}))
// preview-tab 只被 closeOpenedSourceWorkbook 用来清空匹配结果，真实模块会带整条引擎依赖
vi.mock('../ts/sync/enrich-matching.js', () => ({
  isBangumiSheetEmpty: vi.fn(() => false),
}))

import { getApp, bgmLog } from '../ts/tools/util/index.js'
import { getOpenWorkbooks } from '../ts/tools/locked-sheet.js'
import { state } from '../ts/panel/enrich-page-context.js'
import {
  openSourceWorkbook,
  closeWorkbook,
  closeOpenedSourceWorkbook,
  closeSourceWorkbookOnly,
  ensureSourceSheet,
} from '../ts/panel/enrich-source-workbook.js'
import type { WpsWorkbook, WpsWorksheet } from '../ts/tools/wps.js'

function makeWorkbook(name: string): WpsWorkbook & { Close: ReturnType<typeof vi.fn> } {
  return {
    Name: name,
    FullName: `D:/data/${name}`,
    Close: vi.fn(),
  } as unknown as WpsWorkbook & { Close: ReturnType<typeof vi.fn> }
}

function makeWorksheet(): WpsWorksheet {
  return { Name: 'Sheet1' } as unknown as WpsWorksheet
}

/** 造一个带 Worksheets.Item(1) 的工作簿 */
function makeWorkbookWithSheet(name: string, ws: WpsWorksheet | null): WpsWorkbook {
  return {
    Name: name,
    FullName: `D:/data/${name}`,
    Close: vi.fn(),
    Worksheets: { Item: () => ws },
  } as unknown as WpsWorkbook
}

beforeEach(() => {
  vi.clearAllMocks()
  state.sourceWorkbook = null
  state.isSourceWorkbookOpenedByUs = false
  state.animeSourceSheet = null
  state.columnMapping = null
  state.headerRow = 0
  state.dataStartRow = 0
  state.hasSourcePreview = false
  state.introContext = null
  state.filePath = ''
  state.matches = []
  ;(getOpenWorkbooks as ReturnType<typeof vi.fn>).mockReturnValue([])
})

describe('openSourceWorkbook', () => {
  it('WPS 应用不可用时返回 null', () => {
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue(null)
    expect(openSourceWorkbook('D:/data/a.xlsx')).toBeNull()
  })

  it('已打开（按 FullName 命中）时复用，标记 isOpenedByUs=false', () => {
    const existing = makeWorkbook('a.xlsx')
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({ Workbooks: {} })
    ;(getOpenWorkbooks as ReturnType<typeof vi.fn>).mockReturnValue([existing])

    expect(openSourceWorkbook('D:/data/a.xlsx')).toEqual({ wb: existing, isOpenedByUs: false })
  })

  it('未打开时调用 Workbooks.Open 并标记 isOpenedByUs=true', () => {
    const wb = makeWorkbook('b.xlsx')
    const open = vi.fn(() => wb)
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({ Workbooks: { Open: open } })

    expect(openSourceWorkbook('D:/data/b.xlsx')).toEqual({ wb, isOpenedByUs: true })
    expect(open).toHaveBeenCalledWith('D:/data/b.xlsx')
  })

  it('Workbooks.Open 不存在时返回 null（不抛错）', () => {
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({ Workbooks: {} })
    expect(openSourceWorkbook('D:/data/c.xlsx')).toBeNull()
  })
})

describe('closeWorkbook', () => {
  it('以 shouldSaveChanges=false 关闭', () => {
    const wb = makeWorkbook('a.xlsx')
    closeWorkbook(wb)
    expect(wb.Close).toHaveBeenCalledWith(false)
  })

  it('关闭抛错时降级为 WARN 日志，不向上抛', () => {
    const wb = makeWorkbook('a.xlsx')
    wb.Close.mockImplementation(() => {
      throw new Error('busy')
    })
    expect(() => closeWorkbook(wb)).not.toThrow()
    expect(bgmLog).toHaveBeenCalled()
  })

  it('无 Close 方法时静默跳过', () => {
    expect(() => closeWorkbook({} as unknown as WpsWorkbook)).not.toThrow()
  })
})

describe('closeOpenedSourceWorkbook', () => {
  it('仅回收本插件打开的：用户已打开的不关闭，但仍断开引用', () => {
    const wb = makeWorkbook('a.xlsx')
    state.sourceWorkbook = wb
    state.isSourceWorkbookOpenedByUs = false

    closeOpenedSourceWorkbook()
    expect(wb.Close).not.toHaveBeenCalled()
    expect(state.sourceWorkbook).toBeNull()
  })

  it('本插件打开的：关闭 + 清空源表状态 + 清空匹配结果', () => {
    const wb = makeWorkbook('a.xlsx')
    state.sourceWorkbook = wb
    state.isSourceWorkbookOpenedByUs = true
    state.animeSourceSheet = makeWorksheet()
    state.columnMapping = { nameCol: 3 }
    state.headerRow = 2
    state.dataStartRow = 3
    state.hasSourcePreview = true

    closeOpenedSourceWorkbook()
    expect(wb.Close).toHaveBeenCalledWith(false)
    expect(state.animeSourceSheet).toBeNull()
    expect(state.columnMapping).toBeNull()
    expect(state.headerRow).toBe(0)
    expect(state.hasSourcePreview).toBe(false)
    expect(state.sourceWorkbook).toBeNull()
    expect(state.isSourceWorkbookOpenedByUs).toBe(false)
  })

  it('无源工作簿时直接返回（不误关任何东西）', () => {
    expect(() => closeOpenedSourceWorkbook()).not.toThrow()
    expect(state.sourceWorkbook).toBeNull()
  })
})

describe('closeSourceWorkbookOnly', () => {
  it('关闭工作簿但保留已识别的表头/列映射（供重开复用）', () => {
    const wb = makeWorkbook('a.xlsx')
    state.sourceWorkbook = wb
    state.isSourceWorkbookOpenedByUs = true
    state.animeSourceSheet = makeWorksheet()
    state.columnMapping = { nameCol: 3 }
    state.headerRow = 2
    state.dataStartRow = 3

    closeSourceWorkbookOnly()
    expect(wb.Close).toHaveBeenCalledWith(false)
    expect(state.animeSourceSheet).toBeNull()
    // 关键：这四个字段必须保留
    expect(state.columnMapping).toEqual({ nameCol: 3 })
    expect(state.headerRow).toBe(2)
    expect(state.dataStartRow).toBe(3)
  })

  it('用户已打开的不关闭，但仍断开引用', () => {
    const wb = makeWorkbook('a.xlsx')
    state.sourceWorkbook = wb
    state.isSourceWorkbookOpenedByUs = false
    closeSourceWorkbookOnly()
    expect(wb.Close).not.toHaveBeenCalled()
    expect(state.sourceWorkbook).toBeNull()
  })
})

describe('ensureSourceSheet', () => {
  it('已持有活动源表时直接返回（不重开）', () => {
    const ws = makeWorksheet()
    state.animeSourceSheet = ws
    expect(ensureSourceSheet()).toBe(ws)
    expect(getApp).not.toHaveBeenCalled()
  })

  it('缺少 filePath / 表头 / 列映射时返回 null（无从恢复）', () => {
    state.filePath = 'D:/data/a.xlsx'
    state.headerRow = 0
    expect(ensureSourceSheet()).toBeNull()
  })

  it('closeSourceAfterDetect 模式下重开文件并恢复源表引用', () => {
    const ws = makeWorksheet()
    const wb = makeWorkbookWithSheet('a.xlsx', ws)
    state.filePath = 'D:/data/a.xlsx'
    state.headerRow = 2
    state.columnMapping = { nameCol: 3 }
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({
      Workbooks: { Open: vi.fn(() => wb) },
    })

    expect(ensureSourceSheet()).toBe(ws)
    expect(state.animeSourceSheet).toBe(ws)
    expect(state.sourceWorkbook).toBe(wb)
    expect(state.isSourceWorkbookOpenedByUs).toBe(true)
  })

  it('重开失败（Open 返回 null）时返回 null 并记录 ERROR', () => {
    state.filePath = 'D:/data/a.xlsx'
    state.headerRow = 2
    state.columnMapping = { nameCol: 3 }
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({
      Workbooks: { Open: vi.fn(() => null) },
    })

    expect(ensureSourceSheet()).toBeNull()
    expect(state.animeSourceSheet).toBeNull()
  })

  it('重开后文件里没有工作表：回收刚打开的工作簿并返回 null', () => {
    const wb = makeWorkbookWithSheet('a.xlsx', null)
    state.filePath = 'D:/data/a.xlsx'
    state.headerRow = 2
    state.columnMapping = { nameCol: 3 }
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({
      Workbooks: { Open: vi.fn(() => wb) },
    })

    expect(ensureSourceSheet()).toBeNull()
    expect((wb as unknown as { Close: ReturnType<typeof vi.fn> }).Close).toHaveBeenCalledWith(false)
  })
})
