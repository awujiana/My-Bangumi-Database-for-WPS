// @vitest-environment jsdom
/**
 * @fileoverview `ts/sync/workbook-auto-detect.ts` 的 COM / 事件路径测试（第 17 批 P2-2）。
 *
 * 与既有 `workbook-auto-detect.test.ts` 的分工：
 *   - 既有文件覆盖纯函数（文件名预筛 / 路径解析 / 候选合并）与「扫描边界」，
 *     它依赖**真实**的 `tools/util`、`tools/locked-sheet`、`sync/enrich-engine`；
 *   - 本文件把这三者全部 mock，专门驱动「工作表布局校验 → 持久化 → 事件注册 → 事件回调」
 *     这些既有文件覆盖不到的 COM 分支。
 *
 * 必须独立成文件的两个原因：
 *   1. mock 图不同（此处 mock 掉 locked-sheet / enrich-engine，与既有文件互斥）；
 *   2. 模块级 `isEventsRegistered` 是一次性开关，同一模块实例内 `initWorkbookAutoDetection`
 *      只会在首次调用时注册事件，因此每个用例都要 `vi.resetModules()` 后重新 import，
 *      拿一个全新的模块实例。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkbookDetector } from '../ts/sync/workbook-auto-detect.js'
import type { WpsWorkbook, WpsWorksheet } from '../ts/tools/wps.js'

// ========== mock ==========

const m = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  getCellValue: vi.fn(),
  detectAnimeSourceLayout: vi.fn(),
  findBangumiTargetSheetInWorkbook: vi.fn(),
  getOpenWorkbooks: vi.fn(),
  TARGET_SHEET_NAME_KEYWORDS: ['bangumi', 'bgm', '追踪', '剧集', '动画'],
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  // 真实 getApp 读 window.Application；mock 后统一读 globalThis，方便用例装配
  getApp: (): unknown => Reflect.get(globalThis, 'Application') ?? null,
  getCellValue: m.getCellValue,
}))

vi.mock('../ts/tools/locked-sheet.js', () => ({
  findBangumiTargetSheetInWorkbook: m.findBangumiTargetSheetInWorkbook,
  getOpenWorkbooks: m.getOpenWorkbooks,
  TARGET_SHEET_NAME_KEYWORDS: m.TARGET_SHEET_NAME_KEYWORDS,
  // 忠实复刻 locked-sheet.ts countDataRowsAfter：表头行后前 10 行中
  // 「前 MAX_SCAN_COLUMNS(60) 列任一有值」的行数，由本文件的 getCellValue 桩驱动
  countDataRowsAfter: (ws: WpsWorksheet, headerRow: number): number => {
    /** 该行前 MAX_SCAN_COLUMNS(60) 列是否有值 */
    const hasCellValue = (row: number): boolean => {
      for (let col = 1; col <= 60; col += 1) {
        if (String(m.getCellValue(ws, row, col) ?? '').trim()) {
          return true
        }
      }
      return false
    }
    let count = 0
    for (let row = headerRow + 1; row <= headerRow + 10; row += 1) {
      if (hasCellValue(row)) {
        count += 1
      }
    }
    return count
  },
}))

vi.mock('../ts/sync/enrich-engine.js', () => ({
  detectAnimeSourceLayout: m.detectAnimeSourceLayout,
}))

// ========== 装配辅助 ==========

/** 每次重新 import，拿到未注册过事件的干净模块实例 */
async function loadModule(): Promise<typeof import('../ts/sync/workbook-auto-detect.js')> {
  vi.resetModules()
  return import('../ts/sync/workbook-auto-detect.js')
}

interface MockSheets {
  Count: number
  Item(index: number): WpsWorksheet
  Add(): WpsWorksheet
}

function makeSheets(sheetNames: string[]): MockSheets {
  const sheets: WpsWorksheet[] = sheetNames.map((Name) => ({ Name }) as WpsWorksheet)
  return {
    Count: sheets.length,
    Item: (index: number): WpsWorksheet => {
      const sheet = sheets[index - 1]
      if (!sheet) throw new RangeError('下标越界')
      return sheet
    },
    Add: (): WpsWorksheet => {
      throw new Error('mock 未实现 Add')
    },
  }
}

function makeWorkbook(
  name: string,
  options: { fullName?: string; sheetNames?: string[]; worksheets?: MockSheets } = {},
): WpsWorkbook {
  const sheets = options.worksheets ?? makeSheets(options.sheetNames ?? ['Sheet1'])
  return {
    Name: name,
    FullName: options.fullName ?? `C:\\${name}`,
    Worksheets: sheets,
    Sheets: sheets,
    ActiveSheet: ({} as WpsWorksheet),
  }
}

/** 读 Name 抛错的工作簿（覆盖 scanMatchingWorkbooks 的 name 兜底分支） */
function makeThrowingNameWorkbook(): WpsWorkbook {
  const wb = makeWorkbook('placeholder')
  Object.defineProperty(wb, 'Name', {
    get(): string {
      throw new Error('Name 读取失败')
    },
    configurable: true,
  })
  return wb
}

interface MockStorage {
  map: Map<string, string>
  api: { getItem(key: string): string; setItem(key: string, value: string): void }
}

function makeStorage(): MockStorage {
  const map = new Map<string, string>()
  return {
    map,
    api: {
      getItem: (key: string): string => map.get(key) ?? '',
      setItem: (key: string, value: string): void => {
        map.set(key, value)
      },
    },
  }
}

/** 构造 mock Application（Workbooks / Windows / ActiveWorkbook / PluginStorage） */
function makeApp(storage: MockStorage, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Workbooks: { Count: 0 },
    Windows: { Count: 0 },
    ActiveWorkbook: null,
    PluginStorage: storage.api,
    ...overrides,
  }
}

function setApp(app: unknown): void {
  Reflect.set(globalThis, 'Application', app)
}

function clearApp(): void {
  Reflect.deleteProperty(globalThis, 'Application')
}

/** 取事件回调（initWorkbookAutoDetection 注册后由模块写回 app 上） */
function handlerOf(app: Record<string, unknown>, key: string): (argument: unknown) => void {
  const handler = app[key]
  if (typeof handler !== 'function') throw new Error(`${key} 未被注册为函数`)
  return handler as (argument: unknown) => void
}

/** 一个「任意工作簿都命中」的测试用检测器（不读单元格） */
const ANY_SHEET_DETECTOR: WorkbookDetector = {
  key: 'test_any',
  label: '任意工作表',
  findFirstMatchingSheet: (wb: WpsWorkbook): WpsWorksheet | null =>
    wb.Worksheets.Count > 0 ? wb.Worksheets.Item(1) : null,
}

/** 名称预筛直接抛错的检测器（覆盖 scanMatchingWorkbooks 的外层 catch） */
const THROWING_NAME_MATCH_DETECTOR: WorkbookDetector = {
  key: 'test_throwing_prefilter',
  label: '预筛抛错',
  isNameMatch: (): boolean => {
    throw new Error('名称预筛失败')
  },
  findFirstMatchingSheet: (): WpsWorksheet | null => null,
}

/** 完整校验直接抛错的检测器（覆盖 findFirstMatchingSheetSafely 的 catch） */
const THROWING_FIND_DETECTOR: WorkbookDetector = {
  key: 'test_throwing_find',
  label: '校验抛错',
  findFirstMatchingSheet: (): WpsWorksheet | null => {
    throw new Error('工作表校验失败')
  },
}

let autoDetect: typeof import('../ts/sync/workbook-auto-detect.js')

/** 装配一个「新番表工作簿可被识别」的环境并初始化事件（事件回调用例共用） */
function setupEvents(storage: MockStorage): {
  app: Record<string, unknown>
  matched: WpsWorkbook
} {
  const app = makeApp(storage)
  setApp(app)
  const matched = makeWorkbook('新番表.xlsx', { fullName: String.raw`C:\新番表.xlsx` })
  m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, dataStartRow: 2, columnMapping: {} })
  m.getCellValue.mockReturnValue('有值')
  autoDetect.initWorkbookAutoDetection()
  return { app, matched }
}

beforeEach(async () => {
  m.bgmLog.mockReset()
  m.getCellValue.mockReset().mockReturnValue('')
  m.detectAnimeSourceLayout.mockReset().mockReturnValue(null)
  m.findBangumiTargetSheetInWorkbook.mockReset().mockReturnValue(null)
  m.getOpenWorkbooks.mockReset().mockReturnValue([])
  clearApp()
  autoDetect = await loadModule()
})

afterEach(() => {
  clearApp()
})

// ========== 新番表工作表布局校验 ==========

describe('findAnimeSourceSheetInWorkbook（新番表布局 + 数据行校验）', () => {
  it('跳过布局未命中的工作表，返回首个「布局命中且 ≥2 数据行」的表', () => {
    const sheets = makeSheets(['说明', '新番数据'])
    m.detectAnimeSourceLayout.mockImplementation((ws: WpsWorksheet) =>
      ws.Name === '新番数据' ? { headerRow: 1, dataStartRow: 2, columnMapping: {} } : null,
    )
    m.getCellValue.mockReturnValue('有值')

    const found = autoDetect.findAnimeSourceSheetInWorkbook(
      makeWorkbook('新番表.xlsx', { worksheets: sheets }),
    )

    expect(found?.Name).toBe('新番数据')
  })

  it('布局命中但数据行不足 2 行 → 判为未命中', () => {
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, dataStartRow: 2, columnMapping: {} })
    // 全部列为空 → isRowPopulated 恒为 false
    m.getCellValue.mockReturnValue('')

    const found = autoDetect.findAnimeSourceSheetInWorkbook(
      makeWorkbook('新番表.xlsx', { sheetNames: ['数据'] }),
    )

    expect(found).toBeNull()
  })

  it('Worksheets.Item 抛错时跳过该表，继续检查后续工作表', () => {
    const sheets = makeSheets(['坏表', '好表'])
    const originalItem = sheets.Item.bind(sheets)
    sheets.Item = (index: number): WpsWorksheet => {
      if (index === 1) throw new Error('Item 读取失败')
      return originalItem(index)
    }
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, dataStartRow: 2, columnMapping: {} })
    m.getCellValue.mockReturnValue('有值')

    const found = autoDetect.findAnimeSourceSheetInWorkbook(
      makeWorkbook('新番表.xlsx', { worksheets: sheets }),
    )

    expect(found?.Name).toBe('好表')
  })

  it('全部工作表都不满足时返回 null', () => {
    m.detectAnimeSourceLayout.mockReturnValue(null)

    expect(
      autoDetect.findAnimeSourceSheetInWorkbook(makeWorkbook('新番表.xlsx', { sheetNames: ['a', 'b'] })),
    ).toBeNull()
  })
})

describe('isMatchingWorkbook', () => {
  it('名称预筛未命中时直接判否，不做工作表校验', () => {
    const wb = makeWorkbook('普通工作簿.xlsx')
    expect(autoDetect.isMatchingWorkbook(autoDetect.ANIME_SOURCE_DETECTOR, wb)).toBe(false)
    expect(m.detectAnimeSourceLayout).not.toHaveBeenCalled()
  })

  it('名称命中且存在目标表 → 判为命中', () => {
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, dataStartRow: 2, columnMapping: {} })
    m.getCellValue.mockReturnValue('有值')

    expect(autoDetect.isMatchingWorkbook(autoDetect.ANIME_SOURCE_DETECTOR, makeWorkbook('新番表.xlsx'))).toBe(true)
  })

  it('名称命中但无目标表 → 判为未命中', () => {
    m.detectAnimeSourceLayout.mockReturnValue(null)

    expect(autoDetect.isMatchingWorkbook(autoDetect.ANIME_SOURCE_DETECTOR, makeWorkbook('新番表.xlsx'))).toBe(
      false,
    )
  })

  it('工作表校验抛错时按未命中处理，不向外冒泡', () => {
    expect(autoDetect.isMatchingWorkbook(THROWING_FIND_DETECTOR, makeWorkbook('任意.xlsx'))).toBe(false)
  })
})

// ========== 扫描分支 ==========

describe('scanMatchingWorkbooks 剩余分支', () => {
  it('工作簿 Name 读取失败时跳过该工作簿', () => {
    setApp(makeApp(makeStorage()))
    m.getOpenWorkbooks.mockReturnValue([makeThrowingNameWorkbook()])

    expect(autoDetect.scanMatchingWorkbooks(ANY_SHEET_DETECTOR)).toEqual([])
  })

  it('名称预筛抛错时该工作簿按未命中处理', () => {
    setApp(makeApp(makeStorage()))
    m.getOpenWorkbooks.mockReturnValue([makeWorkbook('a.xlsx')])

    expect(autoDetect.scanMatchingWorkbooks(THROWING_NAME_MATCH_DETECTOR)).toEqual([])
  })

  it('无 Application 时记 WARN 并返回空数组', () => {
    clearApp()

    expect(autoDetect.scanMatchingWorkbooks(ANY_SHEET_DETECTOR)).toEqual([])
    expect(m.bgmLog).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('无法获取'))
  })
})

// ========== 诊断文案剩余分支 ==========

describe('describeOpenWorkbooks 读取失败的兜底', () => {
  it('Workbooks.Count 与 Windows.Count 读取失败时按 0 计入', () => {
    const storage = makeStorage()
    setApp(
      makeApp(storage, {
        Workbooks: {
          get Count(): number {
            throw new Error('Count 读取失败')
          },
        },
        Windows: {
          get Count(): number {
            throw new Error('Count 读取失败')
          },
        },
      }),
    )
    m.getOpenWorkbooks.mockReturnValue([makeWorkbook('a.xlsx')])

    const text = autoDetect.describeOpenWorkbooks()

    expect(text).toContain('Workbooks.Count=0')
    expect(text).toContain('Windows.Count=0')
  })

  it('ActiveWorkbook.Name 读取失败时保留占位', () => {
    setApp(
      makeApp(makeStorage(), {
        ActiveWorkbook: {
          get Name(): string {
            throw new Error('Name 读取失败')
          },
        },
      }),
    )

    expect(autoDetect.describeOpenWorkbooks()).toContain('活动工作簿 (无)')
  })

  it('Workbooks 集合不可用时给出占位说明', () => {
    setApp(makeApp(makeStorage(), { Workbooks: null }))

    expect(autoDetect.describeOpenWorkbooks()).toBe('Workbooks 不可用')
  })
})

// ========== 持久化读取与「是否仍打开」 ==========

describe('loadDetectedPaths / isWorkbookOpen', () => {
  it('持久化内容不是合法 JSON 时返回空数组', () => {
    const storage = makeStorage()
    setApp(makeApp(storage))
    storage.map.set(ANY_SHEET_DETECTOR.key, '{ 不是 JSON')

    expect(autoDetect.loadDetectedPaths(ANY_SHEET_DETECTOR)).toEqual([])
  })

  it('持久化内容不是数组时返回空数组', () => {
    const storage = makeStorage()
    setApp(makeApp(storage))
    storage.map.set(ANY_SHEET_DETECTOR.key, JSON.stringify({ path: 'a.xlsx' }))

    expect(autoDetect.loadDetectedPaths(ANY_SHEET_DETECTOR)).toEqual([])
  })

  it('无 Application 时返回空数组', () => {
    clearApp()
    expect(autoDetect.loadDetectedPaths(ANY_SHEET_DETECTOR)).toEqual([])
  })

  it('完整路径不匹配但文件名匹配时判为仍打开', () => {
    m.getOpenWorkbooks.mockReturnValue([
      makeWorkbook('target.xlsx', { fullName: String.raw`C:\other\target.xlsx` }),
    ])

    expect(autoDetect.isWorkbookOpen(String.raw`D:\文档\target.xlsx`)).toBe(true)
  })

  it('工作簿属性读取失败时跳过该项', () => {
    const wb = makeWorkbook('a.xlsx')
    Object.defineProperty(wb, 'FullName', {
      get(): string {
        throw new Error('FullName 读取失败')
      },
      configurable: true,
    })
    m.getOpenWorkbooks.mockReturnValue([wb])

    expect(autoDetect.isWorkbookOpen(String.raw`C:\a.xlsx`)).toBe(false)
  })
})

// ========== 候选路径汇总 ==========

describe('collectDetectedWorkbookPaths', () => {
  it('实时扫描结果在前，仍打开的持久化记录作为兜底追加', () => {
    const storage = makeStorage()
    setApp(makeApp(storage))
    const live = makeWorkbook('新番表.xlsx', { fullName: String.raw`C:\live.xlsx` })
    const fallback = makeWorkbook('旧新番表.xlsx', { fullName: String.raw`C:\fallback.xlsx` })
    m.getOpenWorkbooks.mockReturnValue([live, fallback])
    storage.map.set(ANY_SHEET_DETECTOR.key, JSON.stringify([fallback.FullName]))

    expect(autoDetect.collectDetectedWorkbookPaths(ANY_SHEET_DETECTOR)).toEqual([
      live.FullName,
      fallback.FullName,
    ])
  })
})

// ========== WPS 启动检查 + 事件注册 / 回调 ==========

describe('initWorkbookAutoDetection', () => {
  it('首次调用：全量刷新持久化并注册三个事件', () => {
    const storage = makeStorage()
    const app = makeApp(storage)
    setApp(app)
    const matched = makeWorkbook('新番表.xlsx', { fullName: String.raw`C:\新番表.xlsx` })
    m.getOpenWorkbooks.mockReturnValue([matched])
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, dataStartRow: 2, columnMapping: {} })
    m.getCellValue.mockReturnValue('有值')

    autoDetect.initWorkbookAutoDetection()

    // 全量刷新（overwriteDetectedPathsInStorage）写入了新番表检测器的记录
    expect(storage.map.get(autoDetect.ANIME_SOURCE_DETECTOR.key)).toBe(JSON.stringify([matched.FullName]))
    expect(typeof app.WorkbookOpen).toBe('function')
    expect(typeof app.WorkbookActivate).toBe('function')
    expect(typeof app.SheetActivate).toBe('function')
  })

  it('重复调用是幂等的，不会重新赋值事件', () => {
    const app = makeApp(makeStorage())
    setApp(app)

    autoDetect.initWorkbookAutoDetection()
    const firstOpenHandler = app.WorkbookOpen
    autoDetect.initWorkbookAutoDetection()

    expect(app.WorkbookOpen).toBe(firstOpenHandler)
  })

  it('无 Application 时只做全量刷新，不注册事件且不抛错', () => {
    clearApp()
    expect(() => {
      autoDetect.initWorkbookAutoDetection()
    }).not.toThrow()
  })

  it('WorkbookOpen 赋值失败时记 WARN，不影响其余事件', () => {
    const app = makeApp(makeStorage())
    Object.defineProperty(app, 'WorkbookOpen', {
      set(): void {
        throw new Error('事件不可用')
      },
      configurable: true,
    })
    setApp(app)

    autoDetect.initWorkbookAutoDetection()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('注册 WorkbookOpen 失败'),
    )
    expect(typeof app.WorkbookActivate).toBe('function')
  })

  it('WorkbookActivate 赋值失败时记 WARN', () => {
    const app = makeApp(makeStorage())
    Object.defineProperty(app, 'WorkbookActivate', {
      set(): void {
        throw new Error('事件不可用')
      },
      configurable: true,
    })
    setApp(app)

    autoDetect.initWorkbookAutoDetection()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('注册 WorkbookActivate 失败'),
    )
  })

  it('SheetActivate 赋值失败时记 WARN', () => {
    const app = makeApp(makeStorage())
    Object.defineProperty(app, 'SheetActivate', {
      set(): void {
        throw new Error('事件不可用')
      },
      configurable: true,
    })
    setApp(app)

    autoDetect.initWorkbookAutoDetection()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('注册 SheetActivate 失败'),
    )
  })
})

describe('事件回调', () => {
  it('WorkbookOpen：命中检测器的工作簿被记入持久化（含日志）', () => {
    const storage = makeStorage()
    const { app, matched } = setupEvents(storage)

    handlerOf(app, 'WorkbookOpen')(matched)

    expect(autoDetect.loadDetectedPaths(autoDetect.ANIME_SOURCE_DETECTOR)).toContain(matched.FullName)
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('已记录工作簿: 新番表.xlsx'),
    )
  })

  it('WorkbookOpen：未命中的工作簿被静默跳过', () => {
    const storage = makeStorage()
    const { app } = setupEvents(storage)
    storage.map.clear()
    m.detectAnimeSourceLayout.mockReturnValue(null)

    handlerOf(app, 'WorkbookOpen')(makeWorkbook('普通.xlsx'))

    expect(storage.map.has(autoDetect.ANIME_SOURCE_DETECTOR.key)).toBe(false)
  })

  it('WorkbookOpen：已在持久化记录中的工作簿不重复写入', () => {
    const storage = makeStorage()
    const { app, matched } = setupEvents(storage)
    // 预置成「已记录」状态，再触发回调应无写入、无「已记录」日志
    storage.map.set(autoDetect.ANIME_SOURCE_DETECTOR.key, JSON.stringify([matched.FullName]))
    m.bgmLog.mockClear()

    handlerOf(app, 'WorkbookOpen')(matched)

    expect(storage.map.get(autoDetect.ANIME_SOURCE_DETECTOR.key)).toBe(
      JSON.stringify([matched.FullName]),
    )
    expect(m.bgmLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('已记录工作簿'),
    )
  })

  it('WorkbookOpen：校验抛错时记 WARN 并兜住异常', () => {
    const storage = makeStorage()
    const { app } = setupEvents(storage)
    // Worksheets.Count 读取抛错 → 新番表校验抛错被内部 catch；
    // 随后 Bangumi 预筛同样抛错 → 冒泡到 WorkbookOpen 回调的 catch
    const broken = makeWorkbook('新番表.xlsx')
    Object.defineProperty(broken, 'Worksheets', {
      get(): unknown {
        throw new Error('Worksheets 读取失败')
      },
      configurable: true,
    })

    expect(() => {
      handlerOf(app, 'WorkbookOpen')(broken)
    }).not.toThrow()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('校验失败: Worksheets 读取失败'),
    )
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('WorkbookOpen 处理失败: Worksheets 读取失败'),
    )
  })

  it('WorkbookActivate：命中工作簿被记录', () => {
    const storage = makeStorage()
    const { app, matched } = setupEvents(storage)

    handlerOf(app, 'WorkbookActivate')(matched)

    expect(autoDetect.loadDetectedPaths(autoDetect.ANIME_SOURCE_DETECTOR)).toContain(matched.FullName)
  })

  it('WorkbookActivate：处理抛错时记 WARN', () => {
    const storage = makeStorage()
    const { app } = setupEvents(storage)
    const broken = makeWorkbook('新番表.xlsx')
    Object.defineProperty(broken, 'Worksheets', {
      get(): unknown {
        throw new Error('Worksheets 读取失败')
      },
      configurable: true,
    })

    handlerOf(app, 'WorkbookActivate')(broken)

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('WorkbookActivate 处理失败'),
    )
  })

  it('SheetActivate：以当前活动工作簿为目标记录', () => {
    const storage = makeStorage()
    const app = makeApp(storage)
    const matched = makeWorkbook('新番表.xlsx', { fullName: String.raw`C:\新番表.xlsx` })
    app.ActiveWorkbook = matched
    setApp(app)
    m.detectAnimeSourceLayout.mockReturnValue({ headerRow: 1, dataStartRow: 2, columnMapping: {} })
    m.getCellValue.mockReturnValue('有值')
    autoDetect.initWorkbookAutoDetection()

    handlerOf(app, 'SheetActivate')(undefined)

    expect(autoDetect.loadDetectedPaths(autoDetect.ANIME_SOURCE_DETECTOR)).toContain(matched.FullName)
  })

  it('SheetActivate：无活动工作簿时静默返回', () => {
    const storage = makeStorage()
    const { app } = setupEvents(storage)
    storage.map.clear()

    handlerOf(app, 'SheetActivate')(undefined)

    expect(storage.map.has(autoDetect.ANIME_SOURCE_DETECTOR.key)).toBe(false)
  })

  it('SheetActivate：读取活动工作簿抛错时记 WARN', () => {
    const storage = makeStorage()
    const app = makeApp(storage)
    Object.defineProperty(app, 'ActiveWorkbook', {
      get(): unknown {
        throw new Error('ActiveWorkbook 读取失败')
      },
      configurable: true,
    })
    setApp(app)
    autoDetect.initWorkbookAutoDetection()

    handlerOf(app, 'SheetActivate')(undefined)

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('SheetActivate 处理失败'),
    )
  })
})
