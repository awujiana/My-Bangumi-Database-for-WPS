// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WpsRange, WpsWorksheet } from '../ts/tools/wps.js'

const mockBgmLog = vi.hoisted(() => vi.fn<(level: unknown, message: string) => void>())
const mockHandleError = vi.hoisted(() => vi.fn())
const mockGetApp = vi.hoisted(() => vi.fn())
const mockGetCell = vi.hoisted(() => vi.fn())
const mockGetCellValue = vi.hoisted(() => vi.fn())
const mockReadRangeValues = vi.hoisted(() => vi.fn<() => string[][]>())
const mockFindHeaderRow = vi.hoisted(() => vi.fn<() => number>())
const mockGetColumnMap = vi.hoisted(() => vi.fn<() => Map<string, number>>())
const mockLoadBgToken = vi.hoisted(() => vi.fn<() => string>())
const mockClearSheetCache = vi.hoisted(() => vi.fn())
const mockGetUserApiPath = vi.hoisted(() => vi.fn<() => string>())
const mockCalcFingerprint = vi.hoisted(() => vi.fn<() => string>())

/** 宿主页行为开关：让「可选成员缺失 / 调用抛错」分支可达 */
const { flags } = vi.hoisted(() => ({
  flags: {
    isWps: true,
    confirmResult: true,
    isRunning: false,
    enterRunning: false,
  },
}))

const mockWpsMessageBox = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())
const mockConfirm = vi.hoisted(() => vi.fn())
const mockProgressHide = vi.hoisted(() => vi.fn())
const mockFinalize = vi.hoisted(() => vi.fn())
const mockMarkEpisodes = vi.hoisted(() => vi.fn())
const mockGetAllSyncRecords = vi.hoisted(() => vi.fn<() => unknown[]>())

const { bgmStub } = vi.hoisted(() => ({
  bgmStub: {
    handleError: mockHandleError,
    ErrorLevel: { WARN: 'WARN', ERROR: 'ERROR', INFO: 'INFO' },
    sync: {
      get isRunning(): boolean {
        return flags.isRunning
      },
      enterRunningState: () => flags.enterRunning,
      // 状态机其余成员：批量同步入口会登记当前位置，供暂停时定位
      updatePosition: vi.fn(),
      resetPosition: vi.fn(),
      resetRunningState: vi.fn(),
      setShouldStop: vi.fn(),
      shouldStop: false,
    },
    Color: {},
  },
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mockBgmLog,
  getApp: mockGetApp,
  getCell: mockGetCell,
  getCellValue: mockGetCellValue,
  readRangeValues: mockReadRangeValues,
  findHeaderRow: mockFindHeaderRow,
  getColumnMap: mockGetColumnMap,
  loadBgToken: mockLoadBgToken,
  clearSheetCache: mockClearSheetCache,
  colNumberToLetter: (col: number) => String.fromCodePoint(64 + col),
  trim: (value: string) => value.trim(),
  delay: vi.fn(),
  calcFingerprint: mockCalcFingerprint,
  BGM: bgmStub,
  _getUserApiPath: mockGetUserApiPath,
}))

vi.mock('../ts/tools/wps.js', () => ({
  wpsMessageBox: mockWpsMessageBox,
  isWpsWorksheet: () => flags.isWps,
}))

vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => ({
    toast: mockToast,
    confirm: (message: string, callback: (isConfirmed: boolean) => void) => {
      callback(flags.confirmResult)
    },
    alert: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    input: vi.fn(),
  }),
  getSyncProgressApi: () => ({
    show: vi.fn(),
    update: vi.fn(),
    complete: vi.fn(),
    hide: mockProgressHide,
  }),
  registerNotifyApi: vi.fn(),
  registerSyncProgressApi: vi.fn(),
}))

vi.mock('../ts/sync/exceltobangumi/api.js', () => ({
  bgmRequestSync: vi.fn(),
}))

vi.mock('../ts/sync/exceltobangumi/chapter-marker.js', () => ({
  markEpisodesComplete: mockMarkEpisodes,
  fetchEpisodeIds: vi.fn(),
}))

vi.mock('../ts/sync/exceltobangumi/progress-reporter.js', () => ({
  finalizeSyncResults: mockFinalize,
  DEFAULT_SEQ_COL: 4,
}))

vi.mock('../ts/sync/sync-record.js', () => ({
  getAllSyncRecords: mockGetAllSyncRecords,
  getOrCreateSyncRecordSheet: vi.fn(),
}))

vi.mock('../ts/sync/sync-config-summary.js', () => ({
  buildSyncConfig: () => ({}),
}))

import { getFilterStatus, getSequentialRowsBySeqCol, syncSelectedRows, SyncToBangumiAsync } from '../ts/sync/exceltobangumi/index.js'

/** 构造一个区间桩；`rowNumbers` 为该区覆盖的行号 */
function createArea(rowNumbers: number[]): WpsRange {
  return {
    Row: rowNumbers[0] ?? 1,
    Rows: {
      Count: rowNumbers.length,
      Item: (index: number) => ({ Row: rowNumbers[index - 1] ?? 1 }),
    },
    Count: rowNumbers.length,
  } as unknown as WpsRange
}

/** 构造选区桩；`areas` 非空表示非连续多选 */
function createSelection(options: {
  rowNumbers?: number[]
  areas?: number[][]
  address?: string
  throwOnAddress?: boolean
  throwOnRows?: boolean
}): WpsRange {
  const rowNumbers = options.rowNumbers ?? [2, 3, 4]
  const areas = options.areas?.map((rows) => createArea(rows))
  return {
    get Address(): string {
      if (options.throwOnAddress) throw new Error('地址不可用')
      return options.address ?? 'A2:A4'
    },
    Areas: areas
      ? {
          Count: areas.length,
          Item: (index: number) => areas[index - 1] ?? areas[0],
        }
      : undefined,
    Row: rowNumbers[0] ?? 1,
    get Rows(): { Count: number; Item: (index: number) => { Row: number } } {
      if (options.throwOnRows) throw new Error('读取行失败')
      return {
        Count: rowNumbers.length,
        Item: (index: number) => ({ Row: rowNumbers[index - 1] ?? 1 }),
      }
    },
  } as unknown as WpsRange
}

/** 构造工作表桩；筛选相关成员按开关提供 */
function createWorksheet(options: {
  name?: string
  rowCount?: number
  autoFilterMode?: boolean
  hasAutoFilterRange?: boolean
  visibleRowNumbers?: number[]
  throwOnAutoFilterMode?: boolean
  throwOnSpecialCells?: boolean
  throwOnAreas?: boolean
  throwOnRange?: boolean
  visibleCount?: number
} = {}): WpsWorksheet {
  const visibleRowNumbers = options.visibleRowNumbers ?? [1, 2, 3]
  const totalCount = options.visibleCount ?? 100
  return {
    Name: options.name ?? '动画',
    Rows: { Count: options.rowCount ?? 100 },
    get AutoFilterMode(): boolean {
      if (options.throwOnAutoFilterMode) throw new Error('AutoFilterMode 不可用')
      return options.autoFilterMode ?? false
    },
    AutoFilter:
      options.hasAutoFilterRange ?? true
        ? {
            Range: {
              SpecialCells: () => {
                if (options.throwOnSpecialCells) throw new Error('SpecialCells 失败')
                return createVisibleCells(visibleRowNumbers, {
                  throwOnAreas: options.throwOnAreas ?? false,
                })
              },
            },
          }
        : {},
    Range: (_address: string) => {
      if (options.throwOnRange) throw new Error('Range 不可用')
      return {
        Count: totalCount,
        SpecialCells: () => {
          if (options.throwOnSpecialCells) throw new Error('SpecialCells 失败')
          return createVisibleCells(visibleRowNumbers, {
            throwOnAreas: options.throwOnAreas ?? false,
          })
        },
      }
    },
  } as unknown as WpsWorksheet
}

/** 构造可见单元格集合桩 */
function createVisibleCells(
  rowNumbers: number[],
  options: { throwOnAreas?: boolean } = {},
): WpsRange {
  const area = createArea(rowNumbers)
  return {
    get Areas(): unknown {
      if (options.throwOnAreas) throw new Error('Areas 不可用')
      return { Count: 1, Item: () => area }
    },
    Count: rowNumbers.length,
    Row: rowNumbers[0] ?? 1,
    Rows: {
      Count: rowNumbers.length,
      Item: (index: number) => ({ Row: rowNumbers[index - 1] ?? 1 }),
    },
  } as unknown as WpsRange
}

/** 构造 Application 桩 */
function createApp(options: {
  worksheet?: WpsWorksheet
  selection?: WpsRange | null
  hasWorkbook?: boolean
}): unknown {
  return {
    ActiveWorkbook:
      options.hasWorkbook ?? true
        ? { ActiveSheet: options.worksheet ?? createWorksheet(), Name: '工作簿1' }
        : null,
    Selection: options.selection ?? null,
  }
}

/** 取 bgmLog 记录的所有消息文本 */
function loggedMessages(): string[] {
  return mockBgmLog.mock.calls.map((call) => call[1])
}

/** 取 wpsMessageBox 的首次弹窗文案 */
function firstMessageBox(): string {
  return String(mockWpsMessageBox.mock.calls[0]?.[0] ?? '')
}

describe('exceltobangumi 选区与筛选链路', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flags.isWps = true
    flags.confirmResult = true
    flags.isRunning = false
    flags.enterRunning = false
    mockGetApp.mockReturnValue(null)
    mockGetCell.mockReturnValue(null)
    mockGetCellValue.mockReturnValue('')
    mockReadRangeValues.mockReturnValue([])
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockLoadBgToken.mockReturnValue('token-abc')
    mockGetUserApiPath.mockReturnValue('/v0/users/-/collections')
    mockCalcFingerprint.mockReturnValue('fp-1')
    mockGetAllSyncRecords.mockReturnValue([])
  })

  describe('getFilterStatus', () => {
    it('无 Application 时返回无筛选', () => {
      mockGetApp.mockReturnValue(null)

      expect(getFilterStatus(createWorksheet())).toEqual({
        hasFilter: false,
        visibleRows: [],
        hiddenRows: [],
      })
    })

    it('无 ActiveWorkbook 时返回无筛选', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: null })

      expect(getFilterStatus(createWorksheet()).hasFilter).toBe(false)
    })

    it('传入工作表时使用传入的表', () => {
      const ws = createWorksheet({ name: '指定表', autoFilterMode: false })
      mockGetApp.mockReturnValue(createApp({ worksheet: createWorksheet() }))

      getFilterStatus(ws, 10, 1, false)

      expect(loggedMessages().some((m) => m.includes('指定表'))).toBe(true)
    })

    it('传入数字时使用 ActiveSheet（兼容模式）', () => {
      mockGetApp.mockReturnValue(createApp({ worksheet: createWorksheet() }))

      getFilterStatus(10, 1)

      expect(loggedMessages().some((m) => m.includes('兼容模式'))).toBe(true)
    })

    it('无参数时使用 ActiveSheet', () => {
      mockGetApp.mockReturnValue(createApp({ worksheet: createWorksheet() }))

      expect(getFilterStatus().hasFilter).toBe(false)
      expect(loggedMessages().some((m) => m.includes('无参数'))).toBe(true)
    })

    it('工作表不是合法 WPS 表时返回无筛选', () => {
      flags.isWps = false
      mockGetApp.mockReturnValue(createApp({ worksheet: createWorksheet() }))

      expect(getFilterStatus(createWorksheet(), 10, 1, true).hasFilter).toBe(false)
    })

    it('无 AutoFilter 且未开 deepCheck 时走快速路径', () => {
      mockGetApp.mockReturnValue(createApp({ worksheet: createWorksheet() }))

      getFilterStatus(createWorksheet(), 10, 1, false)

      expect(loggedMessages().some((m) => m.includes('快速路径'))).toBe(true)
    })

    it('AutoFilter 模式：收集可见行并排除表头行', () => {
      const ws = createWorksheet({
        autoFilterMode: true,
        visibleRowNumbers: [1, 2, 3, 4],
      })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 10, 1, false)

      expect(result.hasFilter).toBe(true)
      expect(result.visibleRows).toEqual([2, 3, 4])
    })

    it('AutoFilter 模式但 Range 缺失时判为无筛选', () => {
      const ws = createWorksheet({ autoFilterMode: true, hasAutoFilterRange: false })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 10, 1, false)

      expect(result.hasFilter).toBe(false)
      expect(loggedMessages().some((m) => m.includes('无筛选'))).toBe(true)
    })

    it('SpecialCells 抛错时记录错误并判为无筛选', () => {
      const ws = createWorksheet({ autoFilterMode: true, throwOnSpecialCells: true })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 10, 1, false)

      expect(result.hasFilter).toBe(false)
      expect(mockHandleError).toHaveBeenCalled()
    })

    it('AutoFilterMode 读取抛错时记录错误并继续', () => {
      const ws = createWorksheet({ throwOnAutoFilterMode: true })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      expect(() => getFilterStatus(ws, 10, 1, true)).not.toThrow()
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'getFilterStatus' }),
      )
    })

    it('deepCheck 模式：可见行数覆盖全量时判为无筛选', () => {
      const ws = createWorksheet({ visibleCount: 3, visibleRowNumbers: [1, 2, 3] })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 3, 1, true)

      expect(result.hasFilter).toBe(false)
      expect(loggedMessages().some((m) => m.includes('均可见'))).toBe(true)
    })

    it('deepCheck 模式：存在隐藏行时标记筛选并收集可见行', () => {
      const ws = createWorksheet({ visibleCount: 100, visibleRowNumbers: [1, 2, 5] })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 10, 1, true)

      expect(result.hasFilter).toBe(true)
      expect(result.visibleRows).toEqual([2, 5])
    })

    it('Areas 读取抛错时降级为整体可见区间', () => {
      const ws = createWorksheet({
        autoFilterMode: true,
        visibleRowNumbers: [1, 2, 3],
        throwOnAreas: true,
      })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 10, 1, false)

      expect(result.hasFilter).toBe(true)
      expect(result.visibleRows).toEqual([2, 3])
      expect(mockHandleError).toHaveBeenCalled()
    })

    it('可见行超过 10 行时输出省略日志', () => {
      const many = Array.from({ length: 15 }, (_unused, index) => index + 1)
      const ws = createWorksheet({ autoFilterMode: true, visibleRowNumbers: many })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 20, 1, false)

      expect(result.visibleRows.length).toBe(14)
      expect(loggedMessages().some((m) => m.includes('省略'))).toBe(true)
    })

    it('核心逻辑抛错时外层兜底返回无筛选', () => {
      const ws = createWorksheet({ throwOnRange: true })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 10, 1, true)

      expect(result).toEqual({ hasFilter: false, visibleRows: [], hiddenRows: [] })
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'getFilterStatus' }),
      )
    })
  })

  describe('getSequentialRowsBySeqCol 异常分支', () => {
    it('无 Application 时返回空结果', () => {
      mockGetApp.mockReturnValue(null)

      expect(getSequentialRowsBySeqCol(2, 5).validRows).toEqual([])
    })

    it('单行读取抛错时记录错误并继续后续行', () => {
      mockGetApp.mockReturnValue(createApp({ worksheet: createWorksheet() }))
      mockGetCellValue.mockImplementation((_ws: unknown, row: number) => {
        if (row === 3) throw new Error('读取失败')
        return String(row)
      })

      const result = getSequentialRowsBySeqCol(2, 4)

      expect(result.validRows).toEqual([2, 4])
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'getSequentialRowsBySeqCol' }),
      )
    })

    it('外层读取抛错时记录错误并返回已收集结果', () => {
      mockGetApp.mockReturnValue({
        get ActiveWorkbook(): never {
          throw new Error('工作簿不可用')
        },
      })

      const result = getSequentialRowsBySeqCol(2, 4)

      expect(result.validRows).toEqual([])
      expect(mockHandleError).toHaveBeenCalled()
    })
  })

  describe('syncSelectedRows 选中行同步', () => {
    it('同步进行中时提示并直接返回', async () => {
      flags.isRunning = true

      await syncSelectedRows()

      expect(mockToast).toHaveBeenCalledWith('同步正在进行中，请稍后', 'warn')
      expect(mockWpsMessageBox).not.toHaveBeenCalled()
    })

    it('无法获取 Application 时弹窗提示', async () => {
      mockGetApp.mockReturnValue(null)

      await syncSelectedRows()

      expect(firstMessageBox()).toBe('无法获取 Application')
    })

    it('ActiveWorkbook 缺失时弹窗提示', async () => {
      mockGetApp.mockReturnValue(createApp({ hasWorkbook: false }))

      await syncSelectedRows()

      expect(firstMessageBox()).toBe('无法获取 Application')
    })

    it('未选中区域时提示用户先选行', async () => {
      mockGetApp.mockReturnValue(createApp({ worksheet: createWorksheet(), selection: null }))

      await syncSelectedRows()

      expect(firstMessageBox()).toBe('请先在Excel中选中要同步的数据行')
    })

    it('连续选区按起始行与行数收集', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: [2, 3, 4] }) }),
      )
      mockFindHeaderRow.mockReturnValue(0)

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('选中区域: 3 行'))).toBe(true)
    })

    it('非连续选区遍历多个 Area 去重收集', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({
          worksheet: ws,
          selection: createSelection({ areas: [[2, 3], [3, 5]] }),
        }),
      )
      mockFindHeaderRow.mockReturnValue(0)

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('非连续选择，共 2 个区域'))).toBe(true)
      expect(loggedMessages().some((m) => m.includes('选中区域: 3 行'))).toBe(true)
    })

    it('选区地址读取失败时降级仍继续收集', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({
          worksheet: ws,
          selection: createSelection({ rowNumbers: [2, 3], throwOnAddress: true }),
        }),
      )
      mockFindHeaderRow.mockReturnValue(0)

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('(无法获取)'))).toBe(true)
    })

    it('读取选区抛错时弹窗提示并返回', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({
          worksheet: ws,
          selection: createSelection({ throwOnRows: true }),
        }),
      )

      await syncSelectedRows()

      expect(firstMessageBox()).toBe('获取选中区域失败，请检查是否选中了有效区域')
    })

    it('未找到表头行时弹窗提示', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: [2, 3] }) }),
      )
      mockFindHeaderRow.mockReturnValue(0)

      await syncSelectedRows()

      expect(firstMessageBox()).toContain('未在当前工作表中检测到有效表头行')
    })

    it('排除表头后无数据行时提示', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: [1] }) }),
      )
      mockFindHeaderRow.mockReturnValue(1)

      await syncSelectedRows()

      expect(mockToast).toHaveBeenCalledWith('未选中任何数据行', 'warn')
    })

    it('超过 10 行时弹确认框，用户取消则中止', async () => {
      const rows = Array.from({ length: 12 }, (_unused, index) => index + 2)
      flags.confirmResult = false
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: rows }) }),
      )
      mockFindHeaderRow.mockReturnValue(1)

      await syncSelectedRows()

      expect(mockConfirm).not.toHaveBeenCalled()
      expect(firstMessageBox()).toBe('已取消同步')
    })

    it('超过 10 行且用户确认时继续执行', async () => {
      const rows = Array.from({ length: 12 }, (_unused, index) => index + 2)
      flags.confirmResult = true
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: rows }) }),
      )
      mockFindHeaderRow.mockReturnValue(1)
      mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('弹出确认对话框'))).toBe(true)
      expect(mockClearSheetCache).toHaveBeenCalled()
    })

    it('缺少 Bangumi_URL 列时弹窗提示', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: [2, 3] }) }),
      )
      mockFindHeaderRow.mockReturnValue(1)
      mockGetColumnMap.mockReturnValue(new Map([['名称', 1]]))

      await syncSelectedRows()

      expect(firstMessageBox()).toBe('未找到 Bangumi URL 列')
    })

    it('Token 未设置时弹窗提示', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: [2, 3] }) }),
      )
      mockFindHeaderRow.mockReturnValue(1)
      mockLoadBgToken.mockReturnValue('')

      await syncSelectedRows()

      expect(firstMessageBox()).toBe('请先设置 Token')
    })

    it('校验通过后进入执行阶段，状态机拒绝进入则直接返回', async () => {
      flags.enterRunning = false
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: [2, 3] }) }),
      )
      mockFindHeaderRow.mockReturnValue(1)

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('Token 已设置'))).toBe(true)
      expect(mockMarkEpisodes).not.toHaveBeenCalled()
    })

    it('流程抛错时隐藏进度并记录错误', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(
        createApp({ worksheet: ws, selection: createSelection({ rowNumbers: [2, 3] }) }),
      )
      mockFindHeaderRow.mockImplementation(() => {
        throw new Error('表头读取炸了')
      })

      await syncSelectedRows()

      expect(mockProgressHide).toHaveBeenCalled()
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'syncSelectedRows' }),
      )
      expect(firstMessageBox()).toContain('选中行同步异常')
    })
  })

  describe('SyncToBangumiAsync 预处理分支', () => {
    it('无数据行时直接返回全零结果', async () => {
      // 可见行数覆盖全量 → 判为无筛选 → 走全量区间 [startRow, lastRow]（此处为空）
      const ws = createWorksheet({ visibleCount: 3, visibleRowNumbers: [1, 2, 3] })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockReadRangeValues.mockReturnValue([])

      const result = await SyncToBangumiAsync(ws, new Map([['Bangumi_URL', 5]]), 'token', 1, 1)

      expect(result).toEqual({ success: 0, fail: 0, skip: 0, stopped: false })
      expect(loggedMessages().some((m) => m.includes('开始批量同步'))).toBe(true)
    })

    it('筛选模式下只处理可见行', async () => {
      const ws = createWorksheet({ autoFilterMode: true, visibleRowNumbers: [1, 2, 3] })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockReadRangeValues.mockReturnValue([])

      await SyncToBangumiAsync(ws, new Map([['Bangumi_URL', 5]]), 'token', 3, 1)

      expect(loggedMessages().some((m) => m.includes('筛选模式'))).toBe(true)
    })

    it('增量模式加载历史指纹', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockReadRangeValues.mockReturnValue([])
      mockGetAllSyncRecords.mockReturnValue([
        { sid: '1', fingerprint: 'fp-1' },
        { sid: '', fingerprint: 'fp-2' },
        { sid: '3', fingerprint: '' },
      ])

      await SyncToBangumiAsync(ws, new Map([['Bangumi_URL', 5]]), 'token', 1, 1, {
        incremental: true,
      })

      expect(loggedMessages().some((m) => m.includes('已加载 1 条历史指纹'))).toBe(true)
    })

    it('进度回调在阶段六被触发', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockReadRangeValues.mockReturnValue([])
      const onProgress = vi.fn()

      await SyncToBangumiAsync(ws, new Map([['Bangumi_URL', 5]]), 'token', 1, 1, { onProgress })

      expect(mockFinalize).toHaveBeenCalledTimes(1)
    })
  })
})
