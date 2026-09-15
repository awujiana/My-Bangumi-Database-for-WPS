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
    /** 状态机：是否已请求停止（BGM.sync.checkShouldStop） */
    shouldStop: false,
    /** 状态机：是否处于暂停（BGM.sync.checkPaused） */
    paused: false,
    /** 恢复后立刻再收到停止请求（覆盖「暂停期间停止」分支） */
    stopAfterResume: false,
    /** checkShouldStop 调用计数（0 表示不按次数触发） */
    stopCheckCount: 0,
    /** 第 N 次 checkShouldStop 之后开始返回 true（用于「并发窗口内收到停止」） */
    stopAfterChecks: 0,
    /** checkPaused 调用计数（0 表示不按次数触发） */
    pauseCheckCount: 0,
    /** 第 N 次 checkPaused 之后开始返回 true */
    pauseAfterChecks: 0,
  },
}))

const mockWpsMessageBox = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())
const mockConfirm = vi.hoisted(() => vi.fn())
const mockProgressHide = vi.hoisted(() => vi.fn())
const mockProgressShow = vi.hoisted(() => vi.fn())
const mockProgressUpdate = vi.hoisted(() => vi.fn())
const mockProgressComplete = vi.hoisted(() => vi.fn())
const mockFinalize = vi.hoisted(() => vi.fn())
const mockMarkEpisodes = vi.hoisted(() => vi.fn())
const mockBgmRequestSync = vi.hoisted(() => vi.fn())
const mockGetOrCreateSyncRecordSheet = vi.hoisted(() => vi.fn())
const mockGetAllSyncRecords = vi.hoisted(() => vi.fn<() => unknown[]>())
/** 最小请求间隔等待（用于验证节流分支是否被触发） */
const mockDelay = vi.hoisted(() => vi.fn())

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
      checkShouldStop: (): boolean => {
        flags.stopCheckCount += 1
        if (flags.stopAfterChecks > 0 && flags.stopCheckCount > flags.stopAfterChecks) return true
        return flags.shouldStop
      },
      checkPaused: (): boolean => {
        flags.pauseCheckCount += 1
        if (flags.pauseAfterChecks > 0 && flags.pauseCheckCount > flags.pauseAfterChecks) return true
        return flags.paused
      },
      /** 等待恢复：解除暂停；若用例要求「暂停期间停止」则同时置位停止标志 */
      waitForResume: (): Promise<void> => {
        flags.paused = false
        if (flags.stopAfterResume) flags.shouldStop = true
        return Promise.resolve()
      },
      pause: vi.fn(),
      resume: vi.fn(),
      requestStop: vi.fn(),
      exitRunningState: vi.fn(),
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
  delay: mockDelay,
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
    show: mockProgressShow,
    update: mockProgressUpdate,
    complete: mockProgressComplete,
    hide: mockProgressHide,
  }),
  registerNotifyApi: vi.fn(),
  registerSyncProgressApi: vi.fn(),
}))

vi.mock('../ts/sync/exceltobangumi/api.js', () => ({
  bgmRequestSync: mockBgmRequestSync,
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
  getOrCreateSyncRecordSheet: mockGetOrCreateSyncRecordSheet,
}))

vi.mock('../ts/sync/sync-config-summary.js', () => ({
  buildSyncConfig: () => ({}),
}))

import { getFilterStatus, getSequentialRowsBySeqCol, syncSelectedRows, SyncToBangumiAsync } from '../ts/sync/exceltobangumi/index.js'

/** 构造一个区间桩；`rowNumbers` 为该区覆盖的行号 */
function createArea(rowNumbers: number[], onRowsCountRead?: () => void): WpsRange {
  return {
    Row: rowNumbers[0] ?? 1,
    Rows: {
      // `Count` 走 getter 以便统计读取次数：WPS 是跨进程 COM，读一次就是一次往返。
      // 传入回调后，「按可见行扫描」的往返次数就变成可断言的了（用 spy 记次，与
      // `tests/enrich-lock.test.ts` 里 `expect(itemSpy).toHaveBeenCalledTimes(1)` 同款手法）。
      get Count(): number {
        onRowsCountRead?.()
        return rowNumbers.length
      },
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
  /** 可见区域不提供 Areas 成员（覆盖「整体作为单一区间」分支） */
  missingAreas?: boolean
  throwOnRange?: boolean
  visibleCount?: number
  /** 传入后统计「按可见行扫描」时 `Rows.Count` 的读取次数（COM 往返次数回归断言用） */
  onRowsCountRead?: () => void
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
                return createVisibleCells(visibleRowNumbers, options)
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
          return createVisibleCells(visibleRowNumbers, options)
        },
      }
    },
  } as unknown as WpsWorksheet
}

/** 构造可见单元格集合桩；`missingAreas` 表示宿主未提供 Areas 成员 */
function createVisibleCells(
  rowNumbers: number[],
  options: {
    throwOnAreas?: boolean
    missingAreas?: boolean
    /** 透传给 createArea：统计 `Rows.Count` 读取次数 */
    onRowsCountRead?: () => void
  } = {},
): WpsRange {
  const area = createArea(rowNumbers, options.onRowsCountRead)
  return {
    get Areas(): unknown {
      if (options.throwOnAreas) throw new Error('Areas 不可用')
      if (options.missingAreas) return undefined
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

/**
 * 装配一个能走到 `executeSelectedSync` 执行阶段的环境。
 *
 * `syncSelectedRows` 的校验链（选区 → 表头 → 列 → Token → 状态机）已由既有用例覆盖，
 * 这里统一把 `enterRunningState` 放行，让用例专注在真正的写入循环上。
 */
function setupExecution(
  options: {
    rows?: number[]
    colMap?: Map<string, number>
    cellValue?: (row: number, col: number) => string
  } = {},
): void {
  const ws = createWorksheet()
  mockGetApp.mockReturnValue(
    createApp({ worksheet: ws, selection: createSelection({ rowNumbers: options.rows ?? [2] }) }),
  )
  mockFindHeaderRow.mockReturnValue(1)
  mockGetColumnMap.mockReturnValue(options.colMap ?? new Map([['Bangumi_URL', 5]]))
  const { cellValue } = options
  if (cellValue) {
    mockGetCellValue.mockImplementation((_ws: unknown, row: number, col: number) =>
      cellValue(row, col),
    )
  }
  flags.enterRunning = true
}

/** 取进度弹窗 show() 时传入的 handlers（暂停/恢复/停止回调） */
function progressHandlers(): { onPause: () => void; onResume: () => void; onStop: () => void } {
  return mockProgressShow.mock.calls[0]?.[1] as {
    onPause: () => void
    onResume: () => void
    onStop: () => void
  }
}

/** 选区同步用例的标准取值：URL / 名称 / 状态 / 集数，其余为空 */
function fullCellValue(options: { status?: string; ep?: string; url?: string } = {}) {
  const { status = '2', ep = '12', url = 'https://bgm.tv/subject/12345' } = options
  return (row: number, col: number): string => {
    if (col === 5) return url
    if (col === 2) return `条目${String(row)}`
    if (col === 3) return status
    if (col === 7) return ep
    return ''
  }
}

/** 批量同步用例的标准取值：URL 固定为 subject/1，只关心状态与集数 */
function batchCellValue(options: { status?: string; ep?: string } = {}) {
  const { status = '2', ep = '12' } = options
  return (_ws: unknown, _row: number, col: number): string => {
    if (col === 5) return 'https://bgm.tv/subject/1'
    if (col === 3) return status
    if (col === 7) return ep
    return ''
  }
}

describe('exceltobangumi 选区与筛选链路', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flags.isWps = true
    flags.confirmResult = true
    flags.isRunning = false
    flags.enterRunning = false
    flags.shouldStop = false
    flags.paused = false
    flags.stopAfterResume = false
    flags.stopCheckCount = 0
    flags.stopAfterChecks = 0
    flags.pauseCheckCount = 0
    flags.pauseAfterChecks = 0
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
    mockBgmRequestSync.mockResolvedValue({ code: 200, message: '' })
    mockMarkEpisodes.mockResolvedValue({ success: true, message: '已标记' })
    mockGetOrCreateSyncRecordSheet.mockImplementation(() => {})
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

    it('按可见行扫描时 Rows.Count 只读 1 次（写进循环条件会放大成 N+1 次 COM 往返）', () => {
      // WPS 的 Range 是**跨进程 COM 代理**：`for (…; r <= rows.Count; …)` 每轮都会重新求值，
      // 7 个可见行就是 8 次往返。这条断言把「集合/属性提到循环外单次读取」锁成效率契约
      // （静态侧由 `scripts/check-com-in-loop.mjs` 门禁兜底，这里是运行时证据）。
      const countSpy = vi.fn()
      const ws = createWorksheet({
        visibleRowNumbers: [2, 3, 4, 5, 6, 7, 8],
        autoFilterMode: true,
        onRowsCountRead: countSpy,
      })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const status = getFilterStatus(ws, 10, 1, false)

      expect(status.hasFilter).toBe(true)
      // 先证明循环确实跑了 7 轮 —— 否则「只读 1 次」可能只是因为压根没进循环
      expect(status.visibleRows).toEqual([2, 3, 4, 5, 6, 7, 8])
      expect(countSpy).toHaveBeenCalledTimes(1)
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

    it('可见区域未提供 Areas 成员时整体作为单一区间处理', () => {
      const ws = createWorksheet({
        visibleCount: 100,
        visibleRowNumbers: [1, 2, 5],
        missingAreas: true,
      })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))

      const result = getFilterStatus(ws, 10, 1, true)

      expect(result.hasFilter).toBe(true)
      expect(result.visibleRows).toEqual([2, 5])
      expect(mockHandleError).not.toHaveBeenCalled()
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

  // ========== 第 17 批（P2-1）：executeSelectedSync 执行链路 ==========

  describe('executeSelectedSync 执行链路', () => {
    /** 标准列映射：URL + 名称 + 观看状态 + 集数 */
    const FULL_COL_MAP = new Map<string, number>([
      ['Bangumi_URL', 5],
      ['名称', 2],
      ['是否看完', 3],
      ['集数', 7],
    ])

    /** 标准取值：URL / 名称 / 状态 / 集数，其余为空（实现见模块作用域 fullCellValue） */

    it('成功同步一条：POST 请求体、进度更新、按 type=2 标记章节并输出汇总', async () => {
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue() })

      await syncSelectedRows()

      expect(mockBgmRequestSync).toHaveBeenCalledWith(
        'POST',
        expect.stringContaining('12345'),
        expect.stringContaining('"type":2'),
        'token-abc',
      )
      expect(mockMarkEpisodes).toHaveBeenCalledWith('12345', 12, 'token-abc')
      expect(mockProgressUpdate).toHaveBeenCalled()
      expect(loggedMessages().some((m) => m.includes('========== 汇总 =========='))).toBe(true)
      expect(mockProgressComplete).toHaveBeenCalledWith(
        expect.stringContaining('📊 选中 1 行'),
        expect.any(Array),
        false,
      )
    })

    it('进度弹窗的暂停/恢复/停止回调直通状态机', async () => {
      setupExecution()
      await syncSelectedRows()

      const handlers = progressHandlers()
      handlers.onPause()
      handlers.onResume()
      handlers.onStop()

      expect(bgmStub.sync.pause).toHaveBeenCalled()
      expect(bgmStub.sync.resume).toHaveBeenCalled()
      expect(bgmStub.sync.requestStop).toHaveBeenCalled()
    })

    it('循环开始前已请求停止 → 不处理任何行并如实标记 stopped', async () => {
      setupExecution({ rows: [2, 3], cellValue: () => 'https://bgm.tv/subject/1' })
      flags.shouldStop = true

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('检测到停止请求，终止循环'))).toBe(true)
      expect(mockBgmRequestSync).not.toHaveBeenCalled()
      expect(mockProgressComplete).toHaveBeenCalledWith(expect.any(String), expect.any(Array), true)
    })

    it('循环中暂停 → 等待恢复后继续处理', async () => {
      setupExecution({ cellValue: fullCellValue() })
      flags.paused = true

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('同步已恢复，继续处理'))).toBe(true)
      expect(mockBgmRequestSync).toHaveBeenCalled()
    })

    it('暂停期间收到停止请求 → 终止循环', async () => {
      setupExecution({ rows: [2, 3], cellValue: fullCellValue() })
      flags.paused = true
      flags.stopAfterResume = true

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('暂停期间收到停止请求，终止循环'))).toBe(true)
      expect(mockBgmRequestSync).not.toHaveBeenCalled()
    })

    it('请求体为空（状态无法识别）→ 提示并计入跳过', async () => {
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue({ status: '???' }) })

      await syncSelectedRows()

      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('请求体为空'), 'warn')
      expect(loggedMessages().some((m) => m.includes('跳过: 请求体为空'))).toBe(true)
      expect(mockBgmRequestSync).not.toHaveBeenCalled()
    })

    it('服务端非 2xx → 计入失败并记录状态码', async () => {
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue() })
      mockBgmRequestSync.mockResolvedValue({ code: 400, message: 'Bad Request' })

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('同步失败！HTTP: 400'))).toBe(true)
      expect(mockMarkEpisodes).not.toHaveBeenCalled()
    })

    it('观看状态非「看过/在看」但有集数 → 跳过章节标记', async () => {
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue({ status: '1' }) })

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('跳过章节标记'))).toBe(true)
      expect(mockMarkEpisodes).not.toHaveBeenCalled()
    })

    it('章节标记失败 → 仅记录结果，不影响主流程', async () => {
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue() })
      mockMarkEpisodes.mockResolvedValue({ success: false, message: '章节接口 500' })

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('章节标记结果: 章节接口 500'))).toBe(true)
    })

    it('URL 非 Bangumi 链接 → 提示并跳过', async () => {
      setupExecution({
        colMap: FULL_COL_MAP,
        cellValue: fullCellValue({ url: 'https://example.com/anime' }),
      })

      await syncSelectedRows()

      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('非BGM链接'), 'warn')
      expect(mockBgmRequestSync).not.toHaveBeenCalled()
    })

    it('URL 为空 → 提示并跳过', async () => {
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue({ url: '' }) })

      await syncSelectedRows()

      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('URL为空'), 'warn')
    })

    it('单行处理抛错 → 计入失败并写进度，不中断后续行', async () => {
      setupExecution({ rows: [2, 3], colMap: FULL_COL_MAP, cellValue: fullCellValue() })
      mockGetCellValue.mockImplementation(() => {
        throw new Error('读取单元格失败')
      })

      await syncSelectedRows()

      expect(loggedMessages().some((m) => m.includes('处理异常: 读取单元格失败'))).toBe(true)
      expect(mockProgressUpdate).toHaveBeenCalled()
    })

    it('执行阶段整体抛错 → 隐藏进度、上报错误并弹窗', async () => {
      setupExecution()
      mockGetUserApiPath.mockImplementation(() => {
        throw new Error('用户路径不可用')
      })

      await syncSelectedRows()

      expect(mockProgressHide).toHaveBeenCalled()
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'syncSelectedRows' }),
      )
      expect(firstMessageBox()).toContain('用户路径不可用')
      // entered=true → finally 必须归还运行状态
      expect(bgmStub.sync.exitRunningState).toHaveBeenCalled()
    })

    it('请求体 JSON 解析失败 → 记 WARN 且不标记章节', async () => {
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue() })
      // buildJsonPayload 产出的始终是合法 JSON，故直接让解析器抛错以覆盖防御分支
      const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
        throw new SyntaxError('请求体损坏')
      })
      try {
        await syncSelectedRows()
      } finally {
        parseSpy.mockRestore()
      }

      expect(loggedMessages().some((m) => m.includes('jsonBody 解析失败: 请求体损坏'))).toBe(true)
      expect(mockMarkEpisodes).not.toHaveBeenCalled()
      // watchType 回落为 0 → 走「非看过/在看」跳过章节标记分支
      expect(loggedMessages().some((m) => m.includes('状态非"看过/在看"(type=0)'))).toBe(true)
    })

    it('形似 Bangumi 但 ID 超长 → 提示无法提取 Subject ID 并跳过', async () => {
      // 纯数字被 isBangumiUrl 接受，但 9 位超出 extractSubjectId 的 1-8 位校验
      setupExecution({ colMap: FULL_COL_MAP, cellValue: fullCellValue({ url: '123456789' }) })

      await syncSelectedRows()

      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('无法提取 Subject ID'), 'warn')
      expect(loggedMessages().some((m) => m.includes('跳过: 无效ID'))).toBe(true)
      expect(mockBgmRequestSync).not.toHaveBeenCalled()
    })
  })

  // ========== 第 17 批（P2-1）：批量链路补测 ==========

  describe('批量链路补测', () => {
    const FULL_COL_MAP = new Map<string, number>([
      ['Bangumi_URL', 5],
      ['是否看完', 3],
      ['集数', 7],
    ])

    /** 批量取值实现见模块作用域 batchCellValue */

    it('非增量模式下已标记成功的行按颜色跳过', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      mockGetCell.mockReturnValue({ Interior: { Color: 0xccffcc } })

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(loggedMessages().some((m) => m.includes('2 条跳过'))).toBe(true)
      expect(mockBgmRequestSync).not.toHaveBeenCalled()
    })

    it('未标记的行正常同步（颜色不匹配）', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      mockGetCell.mockReturnValue({ Interior: { Color: 0 } })

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(mockBgmRequestSync).toHaveBeenCalledTimes(2)
    })

    it('颜色属性读取抛错时按未标记处理', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      mockGetCell.mockReturnValue({
        get Interior(): unknown {
          throw new Error('Interior 读取失败')
        },
      })

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(mockBgmRequestSync).toHaveBeenCalledTimes(2)
    })

    it('单行预处理抛错 → 计入失败并调用 BGM.handleError', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      const skipSids = {
        size: 1,
        has: (): boolean => {
          throw new Error('冲突集读取失败')
        },
      } as unknown as Set<string>

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1, { skipSids })

      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'SyncToBangumiAsync:preprocess' }),
      )
      expect(loggedMessages().some((m) => m.includes('失败2条'))).toBe(true)
    })

    it('章节标记抛错 → 记 WARN 不影响批量结果', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      mockMarkEpisodes.mockRejectedValue(new Error('章节接口不可用'))

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(loggedMessages().some((m) => m.includes('章节标记异常: 章节接口不可用'))).toBe(true)
    })

    it('状态非「看过/在看」但有集数 → 记日志跳过章节标记', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue({ status: '1' }))

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(loggedMessages().some((m) => m.includes('跳过章节标记'))).toBe(true)
      expect(mockMarkEpisodes).not.toHaveBeenCalled()
    })

    it('创建同步记录表抛错 → 记 WARN 后继续批量同步', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      mockGetOrCreateSyncRecordSheet.mockImplementation(() => {
        throw new Error('记录表创建失败')
      })

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'SyncToBangumiAsync:createSheet' }),
      )
      expect(mockBgmRequestSync).toHaveBeenCalled()
    })

    it('阶段六的 reportProgress 会转调 options.onProgress', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      const onProgress = vi.fn()

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1, { onProgress })

      // finalizeSyncResults 被 mock，用例手动取出其 reportProgress 参数并调用
      const reportProgress = mockFinalize.mock.calls[0]?.[8] as (c: number, m: string) => void
      reportProgress(1, '收尾中')

      expect(onProgress).toHaveBeenCalledWith(1, 2, '收尾中')
    })

    it('onProgress 回调抛错 → 记 WARN 不影响其余任务', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      const onProgress = vi.fn(() => {
        throw new Error('进度回调炸了')
      })

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1, { onProgress })

      expect(loggedMessages().some((m) => m.includes('onProgress 回调异常: 进度回调炸了'))).toBe(true)
      expect(mockBgmRequestSync).toHaveBeenCalledTimes(2)
    })

    it('并发窗口内收到停止请求 → 等待在途任务后停止', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      // 第一个请求立即完成，第二个在宏任务后完成 → 让第二轮循环仍持有在途任务
      let requestCount = 0
      mockBgmRequestSync.mockImplementation(
        () =>
          new Promise((resolve) => {
            requestCount += 1
            if (requestCount === 1) {
              resolve({ code: 200, message: '' })
              return
            }
            setTimeout(() => {
              resolve({ code: 200, message: '' })
            }, 0)
          }),
      )
      // 第一次检查放行，之后立即报告停止
      flags.stopAfterChecks = 1

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(loggedMessages().some((m) => m.includes('检测到停止请求，正在停止'))).toBe(true)
    })

    it('并发窗口内暂停且恢复后立即停止 → 等待在途任务后停止', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      let requestCount = 0
      mockBgmRequestSync.mockImplementation(
        () =>
          new Promise((resolve) => {
            requestCount += 1
            if (requestCount === 1) {
              resolve({ code: 200, message: '' })
              return
            }
            setTimeout(() => {
              resolve({ code: 200, message: '' })
            }, 0)
          }),
      )
      flags.pauseAfterChecks = 1
      flags.stopAfterResume = true

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(loggedMessages().some((m) => m.includes('暂停期间收到停止请求，正在停止'))).toBe(true)
    })

    it('暂停后恢复继续处理 → 记恢复日志', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      flags.paused = true

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1)

      expect(loggedMessages().some((m) => m.includes('同步已恢复，继续处理'))).toBe(true)
      expect(mockBgmRequestSync).toHaveBeenCalledTimes(2)
    })

    it('批量缓存命中时直接取用行数据，不走逐格回退', async () => {
      const ws = createWorksheet({ visibleRowNumbers: [1, 2] })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      // 行 2 在批量缓存中的下标为 0；数组下标 i 对应第 i+1 列
      mockReadRangeValues.mockReturnValue([
        ['', '条目2', '2', '', 'https://bgm.tv/subject/1', '', '12'],
      ])
      // 逐格回退一律返回空值 → 只有命中缓存才可能产生同步任务
      mockGetCellValue.mockReturnValue('')

      await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 2, 1)

      expect(mockBgmRequestSync).toHaveBeenCalledWith(
        'POST',
        expect.stringContaining('/collections/1'),
        expect.stringContaining('"type":2'),
        'token',
      )
      expect(mockGetCellValue).not.toHaveBeenCalled()
    })

    it('增量模式下指纹未变化 → 整批跳过且不发请求', async () => {
      const ws = createWorksheet()
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      mockGetAllSyncRecords.mockReturnValue([{ sid: '1', fingerprint: 'fp-1' }])
      mockCalcFingerprint.mockReturnValue('fp-1')

      const result = await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 3, 1, {
        incremental: true,
      })

      expect(mockBgmRequestSync).not.toHaveBeenCalled()
      expect(result.skip).toBe(2)
      expect(loggedMessages().some((m) => m.includes('2 条跳过'))).toBe(true)
    })

    it('两批任务间隔不足最小请求间隔时执行节流等待', async () => {
      // 7 个可见行（去掉表头后 6 行）→ 并发窗口 5 + 1，第二批必然落在同一毫秒
      const ws = createWorksheet({ visibleRowNumbers: [1, 2, 3, 4, 5, 6, 7] })
      mockGetApp.mockReturnValue(createApp({ worksheet: ws }))
      mockGetCellValue.mockImplementation(batchCellValue())
      // 固定 Date.now：首批 lastRequestTime=0 不等待，第二批 elapsed=0 必然等待
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
      try {
        await SyncToBangumiAsync(ws, FULL_COL_MAP, 'token', 7, 1)
      } finally {
        nowSpy.mockRestore()
      }

      expect(mockBgmRequestSync).toHaveBeenCalledTimes(6)
      expect(mockDelay).toHaveBeenCalledTimes(1)
      expect(mockDelay).toHaveBeenCalledWith(100)
    })
  })
})
