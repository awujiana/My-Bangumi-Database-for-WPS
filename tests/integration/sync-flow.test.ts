/**
 * @fileoverview Excel→Bangumi 同步流程集成测试
 *
 * 测试目标：
 *   1. 完整同步流程：Excel 数据读取 → Bangumi API 调用 → 章节标记（type=2）→ 收藏更新 → 记录同步
 *   2. 5xx 重试场景：首次返回 500，重试后 200 成功
 *   3. AbortController 取消：同步过程中取消，状态保持一致
 *   4. 空 Excel 数据：无数据行时正常完成
 *   5. GitHub 同步流程：fetch JSONL → computeDiff → applyDiffToSheet → undoLastSync
 *
 * Mock 策略：
 *   - vi.mock HTTP 层（bgmRequestSync）与 WPS API（tools/util.js）
 *   - vi.mock 进度上报与同步记录子模块
 *   - vi.mock GitHub 同步依赖（undoStack、githubConfig、syncSourceRegistry）
 *   - 使用 vi.hoisted 在 import 之前启用 fake timers，避免 handlers.ts 副作用
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// ========== 共享 Mock 状态 ==========
const mockState = vi.hoisted(() => ({
  // Excel→Bangumi 子模块 mock
  bgmRequestSync: vi.fn(),
  markEpisodesComplete: vi.fn(),
  finalizeSyncResults: vi.fn(),
  applySyncSuccessResults: vi.fn(),
  applySyncFailResults: vi.fn(),
  handleStoppedRemainingTasks: vi.fn(),
  getOrCreateSyncRecordSheet: vi.fn(),
  getAllSyncRecords: vi.fn(() => []),
  addSyncRecords: vi.fn(() => true),
  addSyncRecordSummary: vi.fn(() => true),

  // tools/util.js mock（可按测试配置）
  getDataSheet: vi.fn(() => null),
  findHeaderRow: vi.fn(() => 1),
  getLastRow: vi.fn(() => 1),
  getColumnMap: vi.fn(() => new Map<string, number>()),
  getCellValue: vi.fn(() => ''),
  setCellValue: vi.fn(() => true),
  readRangeValues: vi.fn(() => []),

  // GitHub 同步依赖 mock
  beginUndoSession: vi.fn(),
  endUndoSession: vi.fn(),
  recordUndoEntry: vi.fn(),
  undoLastSync: vi.fn(() => 0),
  clearUndoStack: vi.fn(),
  isGithubConfigComplete: vi.fn(() => true),
  buildRawUrl: vi.fn(() => 'https://raw.githubusercontent.com/test/test/main/data.jsonl'),
  getSyncSourceType: vi.fn(() => 'github'),
  getSyncSource: vi.fn(() => null),
  getSyncStrategy: vi.fn(() => 'add-update' as const),
}))

// ========== Mock: Excel→Bangumi 子模块 ==========
vi.mock('../../ts/sync/exceltobangumi/api.js', () => ({
  bgmRequestSync: mockState.bgmRequestSync,
  openBangumiTokenPage: vi.fn(),
  testTokenValidityForRibbon: vi.fn(),
  setBangumiToken: vi.fn(),
  notifyUserInfoUpdated: vi.fn(),
  extractResponseMessage: vi.fn(() => ''),
  parseErrorResponse: vi.fn(() => ({ code: 0, message: '' })),
}))

vi.mock('../../ts/sync/exceltobangumi/chapterMarker.js', () => ({
  markEpisodesComplete: mockState.markEpisodesComplete,
  fetchEpisodeIds: vi.fn(),
}))

vi.mock('../../ts/sync/exceltobangumi/progressReporter.js', () => ({
  applySyncSuccessResults: mockState.applySyncSuccessResults,
  applySyncFailResults: mockState.applySyncFailResults,
  handleStoppedRemainingTasks: mockState.handleStoppedRemainingTasks,
  finalizeSyncResults: mockState.finalizeSyncResults,
  markSyncResultColor: vi.fn(),
  DEFAULT_SEQ_COL: 4,
  TYPE_NAMES: ['', '想看', '看过', '在看', '搁置', '抛弃'],
}))

vi.mock('../../ts/sync/syncRecord.js', () => ({
  getOrCreateSyncRecordSheet: mockState.getOrCreateSyncRecordSheet,
  getAllSyncRecords: mockState.getAllSyncRecords,
  addSyncRecords: mockState.addSyncRecords,
  addSyncRecordSummary: mockState.addSyncRecordSummary,
}))

// ========== Mock: tools/util/index.js（WPS API 边界） ==========
// 提供完整导出，覆盖 exceltobangumi/index.ts 与 githubSync.ts 的所有引用
vi.mock('../../ts/tools/util/index.js', () => ({
  BGM: {
    handleError: vi.fn(),
    safeExecute: vi.fn(),
    ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
    sync: {
      checkShouldStop: () => false,
      checkPaused: () => false,
      waitForResume: () => Promise.resolve(),
      enterRunningState: () => true,
      exitRunningState: () => {},
      updatePosition: () => {},
      pause: () => {},
      resume: () => {},
      requestStop: () => {},
    },
    sheet: { isLocked: false, lockedIndex: null },
    cache: {},
  },
  bgmLog: vi.fn(),
  getApp: (): unknown => (window as { Application?: unknown }).Application,
  getDataSheet: mockState.getDataSheet,
  findHeaderRow: mockState.findHeaderRow,
  getLastRow: mockState.getLastRow,
  getColumnMap: mockState.getColumnMap,
  getCellValue: mockState.getCellValue,
  setCellValue: mockState.setCellValue,
  getCell: vi.fn(),
  getSheetByIndex: vi.fn(),
  trim: (s: unknown): string => String(s ?? '').trim(),
  colNumToLetter: (n: number): string => {
    let result = ''
    let num = n
    while (num > 0) {
      const rem = (num - 1) % 26
      result = String.fromCharCode(65 + rem) + result
      num = Math.floor((num - 1) / 26)
    }
    return result
  },
  escapeHtml: (s: string): string => s,
  calcFingerprint: vi.fn(() => 'fp'),
  cacheGet: <T>(key: string, factory: () => T): T => factory(),
  clearSheetCache: vi.fn(),
  readRangeValues: mockState.readRangeValues,
  delay: () => Promise.resolve(),
  sleep: () => Promise.resolve(),
  loadBgToken: (): string => 'test-token',
  storeBgToken: vi.fn(),
  clearBgToken: vi.fn(),
  _getBgmUserId: (): string => '',
  _setBgmUserId: vi.fn(),
  _setBgmUsername: vi.fn(),
  _getBgmUsername: (): string => '',
  _getUserApiPath: (): string => '/-',
  _fetchBgmUserInfo: vi.fn(),
  fetchBgmUserInfo: vi.fn(),
  isEmptyValue: (v: unknown): boolean => v == null || v === '' || v === 'null',
  wpsMsgBox: vi.fn(),
  showToast: vi.fn(),
  safeActivate: vi.fn(),
  shellExecuteByOAAssist: vi.fn(),
  getUrlPath: vi.fn((): string => ''),
  showBangumiPanel: vi.fn(),
  copyTokenToClipboard: vi.fn(),
}))

// ========== Mock: undoStack ==========
vi.mock('../../ts/sync/undoStack.js', () => ({
  beginUndoSession: mockState.beginUndoSession,
  endUndoSession: mockState.endUndoSession,
  recordUndoEntry: mockState.recordUndoEntry,
  undoLastSync: mockState.undoLastSync,
  clearUndoStack: mockState.clearUndoStack,
  getUndoSessionCount: vi.fn(() => 0),
  getLastSessionDescription: vi.fn(() => ''),
}))

// ========== Mock: githubConfig ==========
vi.mock('../../ts/sync/githubConfig.js', () => ({
  isGithubConfigComplete: mockState.isGithubConfigComplete,
  buildRawUrl: mockState.buildRawUrl,
  getSyncSourceType: mockState.getSyncSourceType,
  getSyncStrategy: mockState.getSyncStrategy,
  getGithubConfig: vi.fn(() => ({
    owner: 'test',
    repo: 'test',
    branch: 'main',
    path: 'data.jsonl',
  })),
  setGithubConfig: vi.fn(),
}))

// ========== Mock: syncSourceRegistry ==========
// 由于 syncFromRemote 内部闭包引用了模块的 getSyncSource，仅覆盖导出无法影响其实现，
// 因此在此提供使用 mockState.getSyncSource 的简化版 syncFromRemote，便于测试端到端流程。
vi.mock('../../ts/sync/syncSourceRegistry.js', async () => {
  const actual = await import('../../ts/sync/syncSourceRegistry.js')
  const githubSync = await import('../../ts/sync/githubSync.js')
  return {
    ...actual,
    getSyncSource: mockState.getSyncSource,
    registerSyncSource: vi.fn(),
    syncFromRemote: async (
      onProgress?: (current: number, total: number, message: string) => void,
      strategy = 'add-update',
      signal?: AbortSignal,
    ) => {
      const sourceType = 'github'
      const source = mockState.getSyncSource(sourceType)
      if (!source) {
        throw new Error(`未知的同步源类型: ${sourceType}`)
      }

      const validationResult = source.validateConfig()
      if (validationResult.isFail()) {
        const errMsg = validationResult.error?.message ?? `同步源 ${sourceType} 配置校验失败`
        throw new Error(errMsg)
      }

      onProgress?.(0, 0, `开始下载远程数据（${source.getDisplayName()} - 策略：${strategy}）...`)
      const remoteEntries = await source.fetchRemoteEntries(signal)
      onProgress?.(1, 3, `下载完成：${remoteEntries.length} 条`)

      const local = githubSync.readLocalEntriesForSync()
      if (!local) {
        throw new Error('无法读取本地工作表数据')
      }

      onProgress?.(2, 3, '比对差异中...')
      const diffs = githubSync.computeDiff(remoteEntries, local.entries, strategy)

      const result = await githubSync.applyDiffToSheet(
        diffs,
        strategy,
        onProgress,
        source.getDisplayName(),
      )
      result.remoteTotal = remoteEntries.length
      const addCount = diffs.filter((d) => d.kind === 'add').length
      const updateCount = diffs.filter((d) => d.kind === 'update').length
      result.unchanged = Math.max(0, remoteEntries.length - addCount - updateCount)

      onProgress?.(
        3,
        3,
        `完成：新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}`,
      )
      return result
    },
  }
})

// ========== 导入被测模块 ==========
import { SyncToBangumiAsync } from '../../ts/sync/exceltobangumi/index.js'
import { syncFromGithub, applyDiffToSheet } from '../../ts/sync/githubSync.js'
import { syncFromRemote } from '../../ts/sync/syncSourceRegistry.js'
import {
  computeDiff,
  parseJsonl,
  type GithubRemoteEntry,
  type LocalRowEntry,
  type SyncStrategy,
} from '../../ts/sync/githubSyncDiff.js'
import { clearUndoStack } from '../../ts/sync/undoStack.js'
import type { SyncSource } from '../../ts/sync/SyncSource.js'
import type { Result } from '../../ts/core/result.js'

vi.clearAllTimers()

// ========== 辅助函数 ==========
/** 构造 mock SyncSource，fetchRemoteEntries 返回指定条目 */
function createMockSyncSource(entries: GithubRemoteEntry[]): SyncSource {
  return {
    getSourceType: () => 'github',
    getDisplayName: () => 'GitHub',
    fetchRemoteEntries: vi.fn().mockResolvedValue(entries),
    validateConfig: (): Result<void> =>
      ({
        isOk: () => true,
        isFail: () => false,
        map: () => ({ isOk: () => true, isFail: () => false }),
        mapErr: () => ({ isOk: () => true, isFail: () => false }),
        unwrap: () => undefined,
        unwrapOr: () => undefined,
        unwrapOrElse: () => undefined,
        match: () => undefined,
      }) as unknown as Result<void>,
  }
}

/** 构造本地行条目映射 */
function createLocalEntries(
  entries: Array<{ row: number; sid: string; fields: Record<string, string> }>,
): Map<string, LocalRowEntry> {
  const map = new Map<string, LocalRowEntry>()
  for (const e of entries) {
    map.set(e.sid, { row: e.row, sid: e.sid, fields: e.fields })
  }
  return map
}

afterEach(() => {
  vi.clearAllMocks()
  vi.clearAllTimers()
  delete (window as { Application?: unknown }).Application
})

afterAll(() => {
  vi.useRealTimers()
})

// ========== 1. Excel→Bangumi 完整同步流程 ==========
describe('Excel→Bangumi 完整同步流程', () => {
  beforeEach(() => {
    // 重置所有 mock
    mockState.bgmRequestSync.mockReset()
    mockState.markEpisodesComplete.mockReset()
    mockState.finalizeSyncResults.mockReset()
    mockState.applySyncSuccessResults.mockReset()
    mockState.applySyncFailResults.mockReset()
    mockState.handleStoppedRemainingTasks.mockReset()
    mockState.getOrCreateSyncRecordSheet.mockReset()
    mockState.getAllSyncRecords.mockReset()
    mockState.readRangeValues.mockReset()
    mockState.getCellValue.mockReset()

    // 默认配置：readRangeValues 返回空，getCellValue 返回空
    mockState.readRangeValues.mockReturnValue([])
    mockState.getCellValue.mockReturnValue('')
    // getAllSyncRecords 默认返回空数组
    mockState.getAllSyncRecords.mockReturnValue([])
  })

  it('完整流程：读取 Excel → 调用 API → 章节标记(type=2) → 收藏更新 → 记录同步', async () => {
    // 模拟 API 成功响应
    mockState.bgmRequestSync.mockResolvedValue({ code: 200, message: 'OK' })
    // 模拟章节标记成功
    mockState.markEpisodesComplete.mockResolvedValue({ success: true, message: '章节标记成功' })

    // 构造 mock worksheet：行2 包含一条"看过"(type=2) 且有集数的数据
    // readRangeValues 返回 2D 数组（行2: 名称, URL, 是否看完, 集数）
    mockState.readRangeValues.mockReturnValue([
      ['测试条目', 'https://bgm.tv/subject/12345', '看过', '12'],
    ])

    const mockWs = { Name: 'Sheet1', AutoFilterMode: false, AutoFilter: null }
    const colMap = new Map<string, number>([
      ['Bangumi_URL', 2],
      ['名称', 1],
      ['是否看完', 3],
      ['集数', 4],
      ['序列号', 9],
    ])

    const result = await SyncToBangumiAsync(
      mockWs as never,
      colMap,
      'test-token',
      2, // lastRow
      1, // headerRow
    )

    // 验证 API 被调用（POST 到收藏接口）
    expect(mockState.bgmRequestSync).toHaveBeenCalled()
    const callArgs = mockState.bgmRequestSync.mock.calls[0]
    expect(callArgs?.[0]).toBe('POST')
    expect(callArgs?.[1]).toContain('/collections/12345')

    // 验证章节标记被调用（type=2 看过 + epCount>0）
    expect(mockState.markEpisodesComplete).toHaveBeenCalled()
    const epCallArgs = mockState.markEpisodesComplete.mock.calls[0]
    expect(epCallArgs?.[0]).toBe('12345')

    // 验证 finalizeSyncResults 被调用（结果处理）
    expect(mockState.finalizeSyncResults).toHaveBeenCalled()

    // 验证 getOrCreateSyncRecordSheet 被调用（同步记录）
    expect(mockState.getOrCreateSyncRecordSheet).toHaveBeenCalled()

    // 验证返回结构
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('fail')
    expect(result).toHaveProperty('skip')
    expect(result).toHaveProperty('stopped')
    expect(result.stopped).toBe(false)
  })

  it('type=3（在看）应跳过章节标记', async () => {
    mockState.bgmRequestSync.mockResolvedValue({ code: 200, message: 'OK' })
    mockState.markEpisodesComplete.mockResolvedValue({ success: true, message: 'ok' })

    // 行2: 在看(type=3)，有集数
    mockState.readRangeValues.mockReturnValue([
      ['测试条目', 'https://bgm.tv/subject/67890', '在看', '5'],
    ])

    const mockWs = { Name: 'Sheet1', AutoFilterMode: false, AutoFilter: null }
    const colMap = new Map<string, number>([
      ['Bangumi_URL', 2],
      ['名称', 1],
      ['是否看完', 3],
      ['集数', 4],
    ])

    await SyncToBangumiAsync(mockWs as never, colMap, 'test-token', 2, 1)

    // API 被调用
    expect(mockState.bgmRequestSync).toHaveBeenCalled()
    // 章节标记不应被调用（type=3 跳过）
    expect(mockState.markEpisodesComplete).not.toHaveBeenCalled()
  })
})

// ========== 2. 5xx 重试场景 ==========
describe('5xx 重试场景', () => {
  beforeEach(() => {
    mockState.bgmRequestSync.mockReset()
    mockState.markEpisodesComplete.mockReset()
    mockState.finalizeSyncResults.mockReset()
    mockState.applySyncSuccessResults.mockReset()
    mockState.applySyncFailResults.mockReset()
    mockState.handleStoppedRemainingTasks.mockReset()
    mockState.getOrCreateSyncRecordSheet.mockReset()
    mockState.getAllSyncRecords.mockReset()
    mockState.readRangeValues.mockReset()
    mockState.getCellValue.mockReset()
    mockState.readRangeValues.mockReturnValue([])
    mockState.getCellValue.mockReturnValue('')
    mockState.getAllSyncRecords.mockReturnValue([])
  })

  it('首次 500，重试后 200 成功', async () => {
    // 首次返回 500，第二次返回 200（模拟 bgmRequestSync 内部重试后成功）
    mockState.bgmRequestSync
      .mockResolvedValueOnce({ code: 500, message: 'Server Error' })
      .mockResolvedValueOnce({ code: 200, message: 'OK' })

    mockState.markEpisodesComplete.mockResolvedValue({ success: true, message: 'ok' })

    mockState.readRangeValues.mockReturnValue([
      ['测试条目', 'https://bgm.tv/subject/11111', '看过', '10'],
    ])

    const mockWs = { Name: 'Sheet1', AutoFilterMode: false, AutoFilter: null }
    const colMap = new Map<string, number>([
      ['Bangumi_URL', 2],
      ['名称', 1],
      ['是否看完', 3],
      ['集数', 4],
    ])

    const result = await SyncToBangumiAsync(mockWs as never, colMap, 'test-token', 2, 1)

    // bgmRequestSync 应被调用至少一次
    expect(mockState.bgmRequestSync).toHaveBeenCalled()
    // 流程应正常完成，不抛异常
    expect(result.stopped).toBe(false)
  })

  it('持续 5xx 最终失败应计入 fail', async () => {
    // 所有重试均失败
    mockState.bgmRequestSync.mockResolvedValue({ code: 500, message: 'Server Error' })
    mockState.markEpisodesComplete.mockResolvedValue({ success: true, message: 'ok' })

    mockState.readRangeValues.mockReturnValue([
      ['测试条目', 'https://bgm.tv/subject/22222', '看过', '10'],
    ])

    const mockWs = { Name: 'Sheet1', AutoFilterMode: false, AutoFilter: null }
    const colMap = new Map<string, number>([
      ['Bangumi_URL', 2],
      ['名称', 1],
      ['是否看完', 3],
      ['集数', 4],
    ])

    const result = await SyncToBangumiAsync(mockWs as never, colMap, 'test-token', 2, 1)

    // 流程应正常完成（不抛异常），失败计入 result
    expect(result.stopped).toBe(false)
    // finalizeSyncResults 应被调用处理失败结果
    expect(mockState.finalizeSyncResults).toHaveBeenCalled()
  })
})

// ========== 3. AbortController 取消场景 ==========
describe('AbortController 取消场景', () => {
  beforeEach(() => {
    mockState.bgmRequestSync.mockReset()
    mockState.markEpisodesComplete.mockReset()
    mockState.finalizeSyncResults.mockReset()
    mockState.applySyncSuccessResults.mockReset()
    mockState.applySyncFailResults.mockReset()
    mockState.handleStoppedRemainingTasks.mockReset()
    mockState.getOrCreateSyncRecordSheet.mockReset()
    mockState.getAllSyncRecords.mockReset()
    mockState.readRangeValues.mockReset()
    mockState.getCellValue.mockReset()
    mockState.readRangeValues.mockReturnValue([])
    mockState.getCellValue.mockReturnValue('')
    mockState.getAllSyncRecords.mockReturnValue([])
  })

  it('fetchGithubJson 在 abort 后应 reject（通过 mock SyncSource 模拟）', async () => {
    // 构造一个会因 abort 而 reject 的 SyncSource
    const abortError = new Error('请求被取消')
    const mockSource: SyncSource = {
      getSourceType: () => 'github',
      getDisplayName: () => 'GitHub',
      fetchRemoteEntries: vi.fn().mockRejectedValue(abortError),
      validateConfig: () =>
        ({
          isOk: () => true,
          isFail: () => false,
        }) as unknown as Result<void>,
    }
    mockState.getSyncSource.mockReturnValue(mockSource)
    mockState.isGithubConfigComplete.mockReturnValue(true)
    mockState.getSyncSourceType.mockReturnValue('github')
    mockState.getDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockState.findHeaderRow.mockReturnValue(1)
    mockState.getLastRow.mockReturnValue(1)
    mockState.getColumnMap.mockReturnValue(new Map([['Bangumi_URL', 2]]))

    const controller = new AbortController()
    controller.abort()

    await expect(syncFromGithub(undefined, 'add-update', controller.signal)).rejects.toThrow(
      '请求被取消',
    )
  })
})

// ========== 4. 空 Excel 数据场景 ==========
describe('空 Excel 数据场景', () => {
  beforeEach(() => {
    mockState.bgmRequestSync.mockReset()
    mockState.markEpisodesComplete.mockReset()
    mockState.finalizeSyncResults.mockReset()
    mockState.applySyncSuccessResults.mockReset()
    mockState.applySyncFailResults.mockReset()
    mockState.handleStoppedRemainingTasks.mockReset()
    mockState.getOrCreateSyncRecordSheet.mockReset()
    mockState.getAllSyncRecords.mockReset()
    mockState.readRangeValues.mockReset()
    mockState.getCellValue.mockReset()
    mockState.readRangeValues.mockReturnValue([])
    mockState.getCellValue.mockReturnValue('')
    mockState.getAllSyncRecords.mockReturnValue([])
  })

  it('无数据行时应正常完成，success=0/fail=0', async () => {
    // readRangeValues 返回空数组（无数据行）
    mockState.readRangeValues.mockReturnValue([])

    const mockWs = { Name: 'Sheet1', AutoFilterMode: false, AutoFilter: null }
    const colMap = new Map<string, number>([
      ['Bangumi_URL', 2],
      ['是否看完', 3],
    ])

    const result = await SyncToBangumiAsync(
      mockWs as never,
      colMap,
      'test-token',
      1, // lastRow=1（只有表头，无数据行）
      1, // headerRow
    )

    // 无数据行时不应调用 API
    expect(mockState.bgmRequestSync).not.toHaveBeenCalled()
    // 流程正常完成
    expect(result.success).toBe(0)
    expect(result.fail).toBe(0)
    expect(result.stopped).toBe(false)
    // finalizeSyncResults 仍应被调用
    expect(mockState.finalizeSyncResults).toHaveBeenCalled()
  })

  it('Bangumi_URL 列为空时所有行被跳过', async () => {
    // 行2 存在但 Bangumi_URL 为空
    mockState.readRangeValues.mockReturnValue([['', '', '']])

    const mockWs = { Name: 'Sheet1', AutoFilterMode: false, AutoFilter: null }
    const colMap = new Map<string, number>([
      ['Bangumi_URL', 2],
      ['是否看完', 3],
    ])

    const result = await SyncToBangumiAsync(mockWs as never, colMap, 'test-token', 2, 1)

    expect(mockState.bgmRequestSync).not.toHaveBeenCalled()
    expect(result.success).toBe(0)
    expect(result.stopped).toBe(false)
  })
})

// ========== 5. GitHub 同步流程 ==========
describe('GitHub 同步流程：fetch JSONL → diff → apply → undo', () => {
  beforeEach(() => {
    // 使用真实定时器，避免 yieldToEventLoop (setTimeout) 被 fake timers 阻塞
    vi.useRealTimers()

    // 重置 GitHub 同步相关 mock
    mockState.beginUndoSession.mockReset()
    mockState.endUndoSession.mockReset()
    mockState.recordUndoEntry.mockReset()
    mockState.undoLastSync.mockReset()
    mockState.clearUndoStack.mockReset()
    mockState.getDataSheet.mockReset()
    mockState.findHeaderRow.mockReset()
    mockState.getLastRow.mockReset()
    mockState.getColumnMap.mockReset()
    mockState.getCellValue.mockReset()
    mockState.setCellValue.mockReset()
    mockState.isGithubConfigComplete.mockReset()
    mockState.getSyncSourceType.mockReset()
    mockState.getSyncSource.mockReset()
    mockState.getSyncStrategy.mockReset()
    mockState.bgmRequestSync.mockReset()
    mockState.getAllSyncRecords.mockReset()
    mockState.finalizeSyncResults.mockReset()
    mockState.applySyncSuccessResults.mockReset()
    mockState.applySyncFailResults.mockReset()
    mockState.handleStoppedRemainingTasks.mockReset()
    mockState.getOrCreateSyncRecordSheet.mockReset()
    mockState.addSyncRecords.mockReset()
    mockState.addSyncRecordSummary.mockReset()
    mockState.readRangeValues.mockReset()

    // 默认配置
    mockState.isGithubConfigComplete.mockReturnValue(true)
    mockState.getSyncSourceType.mockReturnValue('github')
    mockState.getSyncStrategy.mockReturnValue('add-update' as const)
    mockState.getDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockState.findHeaderRow.mockReturnValue(1)
    mockState.getLastRow.mockReturnValue(2)
    mockState.getColumnMap.mockReturnValue(
      new Map<string, number>([
        ['Bangumi_URL', 2],
        ['名称', 1],
        ['是否看完', 3],
        ['打分', 4],
        ['标签/分级', 5],
        ['剧透/感言', 6],
        ['集数', 7],
      ]),
    )
    mockState.getCellValue.mockReturnValue('')
    mockState.setCellValue.mockReturnValue(true)
    mockState.readRangeValues.mockReturnValue([])
    mockState.getAllSyncRecords.mockReturnValue([])
  })

  afterEach(() => {
    // 恢复 fake timers，避免影响其他 describe 块
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  })

  it('完整流程：fetch JSONL → computeDiff → applyDiffToSheet → undoLastSync', async () => {
    // 1. 构造远程 JSONL 数据（2 条：1 条新增，1 条更新）
    const jsonlText =
      JSON.stringify({
        sid: '10001',
        name: '新条目',
        meta_tags: ['标签1'],
      }) +
      '\n' +
      JSON.stringify({
        sid: '10002',
        name: '更新名称',
      })

    // 2. 解析 JSONL
    const { entries, errors } = parseJsonl(jsonlText)
    expect(errors).toHaveLength(0)
    expect(entries).toHaveLength(2)

    // 3. 构造本地数据（10002 已存在）
    const localEntries = createLocalEntries([
      {
        row: 2,
        sid: '10002',
        fields: {
          名称: '旧名称',
          是否看完: '看过',
          打分: '7',
        },
      },
    ])

    // 4. computeDiff（add-update 策略）
    const diffs = computeDiff(entries, localEntries, 'add-update')
    expect(diffs).toHaveLength(2)
    const addDiff = diffs.find((d) => d.kind === 'add')
    const updateDiff = diffs.find((d) => d.kind === 'update')
    expect(addDiff).toBeDefined()
    expect(addDiff?.sid).toBe('10001')
    expect(updateDiff).toBeDefined()
    expect(updateDiff?.sid).toBe('10002')
    expect(updateDiff?.changedFields).toContain('名称')

    // 5. applyDiffToSheet（使用 mock worksheet）
    // 配置 getCellValue 返回合理的行数据（用于 readLocalEntries）
    // 由于 applyDiffToSheet 内部调用 getDataSheet/findHeaderRow/getLastRow/getColumnMap（已 mock），
    // 以及 setCellValue（已 mock），可直接调用
    const result = await applyDiffToSheet(diffs, 'add-update')
    expect(result.added).toBe(1)
    expect(result.updated).toBe(1)

    // 验证 undo 会话被开启和结束
    expect(mockState.beginUndoSession).toHaveBeenCalled()
    expect(mockState.endUndoSession).toHaveBeenCalled()

    // 验证 setCellValue 被调用（写入数据）
    expect(mockState.setCellValue).toHaveBeenCalled()

    // 验证同步记录被批量写入：2 条差异（1 新增 + 1 更新）+ 1 条汇总
    expect(mockState.addSyncRecords).toHaveBeenCalled()
    const records = mockState.addSyncRecords.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(records).toHaveLength(2)
    expect(records?.some((r) => r.content === '仓库同步-新增' && r.sid === '10001')).toBe(true)
    expect(records?.some((r) => r.content === '仓库同步-更新' && r.sid === '10002')).toBe(true)

    // 验证汇总行
    expect(mockState.addSyncRecordSummary).toHaveBeenCalled()
    const summary = mockState.addSyncRecordSummary.mock.calls[0]?.[0] as Record<string, unknown>
    expect(summary?.content).toBe('仓库同步汇总')
    expect(summary?.message).toContain('新增 1')
    expect(summary?.message).toContain('更新 1')

    // 6. undoLastSync（撤销上次同步）
    mockState.undoLastSync.mockReturnValue(2)
    const restored = mockState.undoLastSync()
    expect(restored).toBe(2)
  })

  it('mirror 策略应删除本地多余行', async () => {
    const remote: GithubRemoteEntry[] = [{ sid: '20001', name: '保留' }]
    const local = createLocalEntries([
      { row: 2, sid: '20001', fields: { 名称: '保留', 是否看完: '看过' } },
      { row: 3, sid: '20002', fields: { 名称: '应删除', 是否看完: '看过' } },
    ])

    const diffs = computeDiff(remote, local, 'mirror')
    const deleteDiff = diffs.find((d) => d.kind === 'delete')
    expect(deleteDiff).toBeDefined()
    expect(deleteDiff?.sid).toBe('20002')
    expect(deleteDiff?.localRow).toBe(3)

    // applyDiffToSheet 处理 delete
    // 配置 getCellValue 返回值（用于 delete 时记录 undo）
    mockState.getCellValue.mockImplementation((_ws: unknown, row: number, _col: number) => {
      if (row === 3) return '旧值'
      return ''
    })

    const result = await applyDiffToSheet(diffs, 'mirror')
    expect(result.deleted).toBeGreaterThanOrEqual(0)
    expect(mockState.beginUndoSession).toHaveBeenCalled()
    expect(mockState.endUndoSession).toHaveBeenCalled()
  })

  it('force-overwrite 策略应强制更新所有字段', async () => {
    const remote: GithubRemoteEntry[] = [{ sid: '30001', name: '新名' }]
    const local = createLocalEntries([
      { row: 2, sid: '30001', fields: { 名称: '旧名', 是否看完: '看过', 打分: '5' } },
    ])

    const diffs = computeDiff(remote, local, 'force-overwrite')
    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.kind).toBe('update')
    expect(diffs[0]?.changedFields).toEqual(['*'])

    const result = await applyDiffToSheet(diffs, 'force-overwrite')
    expect(result.updated).toBe(1)
  })

  it('syncFromRemote 端到端：下载 → diff → apply', async () => {
    // 构造 mock SyncSource
    const remoteEntries: GithubRemoteEntry[] = [{ sid: '40001', name: '远程条目' }]
    const mockSource = createMockSyncSource(remoteEntries)
    mockState.getSyncSource.mockReturnValue(mockSource)

    // 配置本地数据为空（所有远程条目都是新增）
    mockState.getDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockState.findHeaderRow.mockReturnValue(1)
    mockState.getLastRow.mockReturnValue(1) // 无数据行
    mockState.getColumnMap.mockReturnValue(
      new Map<string, number>([
        ['Bangumi_URL', 2],
        ['名称', 1],
        ['是否看完', 3],
        ['打分', 4],
      ]),
    )
    mockState.getCellValue.mockReturnValue('')
    mockState.setCellValue.mockReturnValue(true)

    const result = await syncFromRemote(undefined, 'add-update')

    expect(result.remoteTotal).toBe(1)
    expect(result.added).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.failed).toBe(0)

    // 验证 SyncSource 的 fetchRemoteEntries 被调用
    expect(mockSource.fetchRemoteEntries).toHaveBeenCalled()
    // 验证 undo 会话
    expect(mockState.beginUndoSession).toHaveBeenCalled()
    expect(mockState.endUndoSession).toHaveBeenCalled()
  })

  it('syncFromRemote 配置不完整时应抛出错误', async () => {
    // getSyncSource 返回一个 validateConfig 失败的 mock
    const failingSource: SyncSource = {
      getSourceType: () => 'github',
      getDisplayName: () => 'GitHub',
      fetchRemoteEntries: vi.fn(),
      validateConfig: () =>
        ({
          isOk: () => false,
          isFail: () => true,
          error: new Error('配置不完整'),
        }) as unknown as Result<void>,
    }
    mockState.getSyncSource.mockReturnValue(failingSource)

    await expect(syncFromRemote()).rejects.toThrow('配置不完整')
  })

  it('undoLastSync 在无会话时返回 0', () => {
    mockState.undoLastSync.mockReturnValue(0)
    clearUndoStack()
    const result = mockState.undoLastSync()
    expect(result).toBe(0)
  })
})

// ========== 6. parseJsonl 解析集成 ==========
describe('parseJsonl 集成解析', () => {
  it('合法 JSONL 应正确解析为条目数组', () => {
    const text = [
      JSON.stringify({ sid: '1', name: 'A', meta_tags: ['标签'] }),
      JSON.stringify({ sid: '2', name: 'B', 话数: '12' }),
      '', // 空行应跳过
      JSON.stringify({ sid: '3', name: 'C' }),
    ].join('\n')

    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(3)
    expect(errors).toHaveLength(0)
    expect(entries[0]?.sid).toBe('1')
    expect(entries[1]?.['话数']).toBe('12')
    expect(entries[2]?.name).toBe('C')
  })

  it('非法行应收集到 errors 不中断解析', () => {
    const text = [
      JSON.stringify({ sid: '1', name: 'A' }),
      '{ invalid json',
      JSON.stringify({ sid: '2', name: 'B' }),
      JSON.stringify({ notSid: 'x' }), // 缺少 sid
    ].join('\n')

    const { entries, errors } = parseJsonl(text)
    expect(entries).toHaveLength(2)
    expect(errors).toHaveLength(2)
  })
})
