/**
 * @fileoverview Excel→Bangumi 同步「进度上报与结果应用」单元测试
 *
 * 测试目标：
 *   - applySyncSuccessResults / applySyncFailResults：标记颜色 + 写同步记录 + 累加计数
 *   - finalizeSyncResults：协调成功/失败/跳过三个分支并汇总
 *
 * 重点锁定 P1-B 性能回归（文档/TS_AUDIT_2026_09_10.md）：
 *   逐条调用 `addSyncRecord` 会在每次写入前触发一次全表去重扫描（`deduplicateSyncRecords`
 *   遍历所有行的 SID 列），批量同步 N 行即 N×N 次 COM 调用 → 任务窗格实质不可用。
 *   因此本模块必须走「循环内累积 + 循环外单次 addSyncRecords」。
 *
 * mock 策略：
 *   - vi.mock('../ts/sync/sync-record.js')：用 spy 捕获写入调用次数与实参
 *   - vi.mock('../ts/tools/util/index.js')：隔离 WPS 宿主（getCell）与日志/全局对象
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockState = vi.hoisted(() => ({
  addSyncRecords: vi.fn<(records: unknown[]) => boolean>(() => true),
  getCell: vi.fn<(worksheet: unknown, row: number, col: number) => { Interior: { Color: number } } | null>(
    () => ({ Interior: { Color: 0 } }),
  ),
  handleError: vi.fn(),
  setSyncComplete: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../ts/sync/sync-record.js', () => ({
  addSyncRecords: mockState.addSyncRecords,
}))

// 桥接口：P1-E 要求「批量写入失败必须让用户看见」，此处用 spy 断言提示确实发出
vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => ({ toast: mockState.toast }),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: vi.fn(),
  getCell: mockState.getCell,
  BGM: {
    handleError: mockState.handleError,
    ErrorLevel: { ERROR: 'ERROR', WARN: 'WARN' },
    setSyncComplete: mockState.setSyncComplete,
  },
}))

import {
  applySyncFailResults,
  applySyncSuccessResults,
  finalizeSyncResults,
  handleStoppedRemainingTasks,
  markSyncResultColor,
  TYPE_NAMES,
} from '../ts/sync/exceltobangumi/progress-reporter.js'
import type {
  SyncResultStats,
  SyncTask,
} from '../ts/sync/exceltobangumi/progress-reporter.js'
import { BGM_COLOR, SYNC_STATUS } from '../ts/core/constants.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'

/**
 * 最小工作表桩：本模块只把它透传给被 mock 的 `getCell`，自身不访问任何成员，
 * 故形状不完整这一点收敛到此处一次类型逃逸。
 */
const createStubWorksheet = (): WpsWorksheet => ({}) as unknown as WpsWorksheet

const createStats = (): SyncResultStats => ({ success: 0, fail: 0, skip: 0, stopped: false })

const createTask = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  rowNum: 2,
  sid: '100',
  bgmUrl: 'https://bgm.tv/subject/100',
  name: '测试条目',
  jsonBody: '{"type":2}',
  type: 2,
  ...overrides,
})

/** 取出唯一一次批量写入的实参 */
const getWrittenRecords = (): Record<string, unknown>[] => {
  const records = mockState.addSyncRecords.mock.calls[0]?.[0]
  return records as Record<string, unknown>[]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.getCell.mockReturnValue({ Interior: { Color: 0 } })
})

describe('markSyncResultColor', () => {
  it('成功时写入成功色', () => {
    markSyncResultColor(createStubWorksheet(), 5, true, 9)
    expect(mockState.getCell).toHaveBeenCalledWith(expect.anything(), 5, 9)
    expect((mockState.getCell.mock.results[0]?.value as { Interior: { Color: number } }).Interior.Color).toBe(
      BGM_COLOR.SUCCESS,
    )
  })

  it('失败时写入失败色', () => {
    markSyncResultColor(createStubWorksheet(), 6, false, 9)
    expect(
      (mockState.getCell.mock.results[0]?.value as { Interior: { Color: number } }).Interior.Color,
    ).toBe(BGM_COLOR.FAIL)
  })

  it('省略序列号列时使用默认列 4', () => {
    markSyncResultColor(createStubWorksheet(), 7, true)
    expect(mockState.getCell).toHaveBeenCalledWith(expect.anything(), 7, 4)
  })

  it('单元格无 Interior 时静默跳过（不抛错）', () => {
    mockState.getCell.mockReturnValue(null)
    expect(() => {
      markSyncResultColor(createStubWorksheet(), 8, true, 9)
    }).not.toThrow()
  })
})

describe('applySyncSuccessResults', () => {
  it('批量写入：N 个任务只调用一次 addSyncRecords（P1-B 回归锁）', () => {
    const tasks = Array.from({ length: 50 }, (_, index) =>
      createTask({ rowNum: index + 2, sid: String(1000 + index) }),
    )
    const result = createStats()

    applySyncSuccessResults(createStubWorksheet(), 9, tasks, result)

    // 逐条写入会是 50 次，每次触发全表去重 → O(n²)；这里必须是 1 次
    expect(mockState.addSyncRecords).toHaveBeenCalledTimes(1)
    expect(getWrittenRecords()).toHaveLength(50)
    expect(result.success).toBe(50)
  })

  it('记录内容包含状态、类型名、URL 与消息', () => {
    applySyncSuccessResults(createStubWorksheet(), 9, [createTask()], createStats())

    expect(getWrittenRecords()).toHaveLength(1)
    expect(getWrittenRecords()[0]).toMatchObject({
      name: '测试条目',
      url: 'https://bgm.tv/subject/100',
      sid: '100',
      type: TYPE_NAMES[2],
      content: '{"type":2}',
      status: SYNC_STATUS.SUCCESS,
      message: '批量同步成功',
      count: 1,
    })
  })

  it('名称为空时回退为 SID 文案', () => {
    applySyncSuccessResults(createStubWorksheet(), 9, [createTask({ name: '' })], createStats())
    expect(getWrittenRecords()[0]?.name).toBe('SID:100')
  })

  it('未知观看状态回退为「类型N」文案', () => {
    applySyncSuccessResults(createStubWorksheet(), 9, [createTask({ type: 99 })], createStats())
    expect(getWrittenRecords()[0]?.type).toBe('类型99')
  })

  it('fingerprint 仅在定义时透传', () => {
    applySyncSuccessResults(
      createStubWorksheet(),
      9,
      [createTask({ sid: '1', fingerprint: 'fp-1' }), createTask({ sid: '2' })],
      createStats(),
    )
    const records = getWrittenRecords()
    expect(records[0]?.fingerprint).toBe('fp-1')
    expect(records[1]).not.toHaveProperty('fingerprint')
  })

  it('每个任务都标记颜色', () => {
    applySyncSuccessResults(
      createStubWorksheet(),
      9,
      [createTask({ rowNum: 2 }), createTask({ rowNum: 3, sid: '101' })],
      createStats(),
    )
    expect(mockState.getCell).toHaveBeenCalledTimes(2)
  })

  it('空任务列表仍只调用一次且传空数组', () => {
    const result = createStats()
    applySyncSuccessResults(createStubWorksheet(), 9, [], result)
    expect(mockState.addSyncRecords).toHaveBeenCalledTimes(1)
    expect(getWrittenRecords()).toHaveLength(0)
    expect(result.success).toBe(0)
  })
})

describe('applySyncFailResults', () => {
  it('批量写入：多任务只调用一次 addSyncRecords（P1-B 回归锁）', () => {
    const tasks = Array.from({ length: 20 }, (_, index) =>
      createTask({ rowNum: index + 2, sid: String(2000 + index) }),
    )
    const result = createStats()

    applySyncFailResults(createStubWorksheet(), 9, tasks, result)

    expect(mockState.addSyncRecords).toHaveBeenCalledTimes(1)
    expect(getWrittenRecords()).toHaveLength(20)
    expect(result.fail).toBe(20)
  })

  it('记录状态为失败且消息为批量同步失败', () => {
    applySyncFailResults(createStubWorksheet(), 9, [createTask()], createStats())
    expect(getWrittenRecords()[0]).toMatchObject({
      status: SYNC_STATUS.FAIL,
      message: '批量同步失败',
    })
  })

  it('标记失败颜色', () => {
    applySyncFailResults(createStubWorksheet(), 9, [createTask({ rowNum: 4 })], createStats())
    expect(
      (mockState.getCell.mock.results[0]?.value as { Interior: { Color: number } }).Interior.Color,
    ).toBe(BGM_COLOR.FAIL)
  })
})

describe('写入失败必须让用户看见（P1-E）', () => {
  it('成功结果批量写入失败时提示用户', () => {
    mockState.addSyncRecords.mockReturnValueOnce(false)
    applySyncSuccessResults(createStubWorksheet(), 9, [createTask()], createStats())

    expect(mockState.toast).toHaveBeenCalledTimes(1)
    expect(mockState.toast.mock.calls[0]?.[0]).toContain('同步记录写入失败')
    expect(mockState.toast.mock.calls[0]?.[1]).toBe('error')
  })

  it('失败结果批量写入失败时提示用户', () => {
    mockState.addSyncRecords.mockReturnValueOnce(false)
    applySyncFailResults(createStubWorksheet(), 9, [createTask()], createStats())

    expect(mockState.toast).toHaveBeenCalledTimes(1)
    expect(mockState.toast.mock.calls[0]?.[0]).toContain('同步记录写入失败')
  })

  it('写入成功时不得打扰用户', () => {
    applySyncSuccessResults(createStubWorksheet(), 9, [createTask()], createStats())
    expect(mockState.toast).not.toHaveBeenCalled()
  })
})

describe('handleStoppedRemainingTasks', () => {
  it('停止时把未执行任务计入 skip 并置 stopped', () => {
    const result = createStats()
    const executed = createTask({ sid: '1' })
    const all = [executed, createTask({ sid: '2' }), createTask({ sid: '3' })]
    handleStoppedRemainingTasks(all, [executed], [], result)

    expect(result.skip).toBe(2)
    expect(result.stopped).toBe(true)
  })
})

describe('finalizeSyncResults', () => {
  it('协调成功/失败分支并汇总，不重复写入', () => {
    const result = createStats()
    const success = [createTask({ sid: '1' }), createTask({ sid: '2', rowNum: 3 })]
    const fail = [createTask({ sid: '3', rowNum: 4 })]
    const reportProgress = vi.fn()

    finalizeSyncResults(
      createStubWorksheet(),
      9,
      success,
      fail,
      [...success, ...fail],
      false,
      result,
      0,
      reportProgress,
    )

    // 成功 1 次 + 失败 1 次 = 2 次批量写入（而非 3 次逐条写入）
    expect(mockState.addSyncRecords).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(2)
    expect(result.fail).toBe(1)
    expect(result.skip).toBe(0)
    expect(result.stopped).toBe(false)
    expect(mockState.setSyncComplete).toHaveBeenCalledWith(result)
    expect(reportProgress).toHaveBeenCalledWith(3, '同步完成')
  })

  it('被停止时统计剩余任务为跳过', () => {
    const result = createStats()
    const executed = createTask({ sid: '1' })
    const all = [executed, createTask({ sid: '2' }), createTask({ sid: '3' })]
    const reportProgress = vi.fn()

    finalizeSyncResults(createStubWorksheet(), 9, [executed], [], all, true, result, 0, reportProgress)

    expect(result.skip).toBe(2)
    expect(result.stopped).toBe(true)
    expect(reportProgress).toHaveBeenCalledWith(3, '同步已停止')
  })
})
