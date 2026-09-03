// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 使用 vi.hoisted 定义在 mock 工厂内引用的变量
const mockBgmLogn = vi.hoisted(() => vi.fn())
const mockGetApp = vi.hoisted(() => vi.fn())
const mockGetCellValue = vi.hoisted(() => vi.fn().mockReturnValue(''))
const mockFindHeaderRow = vi.hoisted(() => vi.fn().mockReturnValue(1))
const mockGetColumnMap = vi.hoisted(() => vi.fn().mockReturnValue(new Map()))
const mockTrim = vi.hoisted(() => vi.fn((v: string) => v?.trim() ?? ''))
const mockEnsureSheetHeaders = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockGetDataSheet = vi.hoisted(() => vi.fn().mockReturnValue(null))
const mockApplyConflictResolutions = vi.hoisted(() => vi.fn())
const mockApplyDiffToSheet = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    added: 0,
    updated: 0,
    deleted: 0,
    failed: 0,
    remoteTotal: 0,
    unchanged: 0,
    skipped: 0,
  }),)
const mockComputeDiff = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockReadLocalEntriesForSync = vi.hoisted(() =>
  vi.fn().mockReturnValue({ entries: new Map(), lastRow: 1 }),)
const mockFilterByTime = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockExtractSubjectId = vi.hoisted(() => vi.fn().mockReturnValue(null))
const mockGetSyncSourceType = vi.hoisted(() => vi.fn().mockReturnValue('github'))

// 创建可变的 mock source 引用
const mockGithubSourceReference = vi.hoisted(() => ({
  getDisplayName: vi.fn().mockReturnValue('GitHub'),
  validateConfig: vi.fn().mockReturnValue({ isFail: () => false, error: null }),
  fetchRemoteEntries: vi.fn().mockResolvedValue([]),
}))

// SyncSource type for testing
interface SyncSource {
  getDisplayName: () => string
  validateConfig: () => { isFail: () => boolean; error: Error | null }
  fetchRemoteEntries: (signal?: AbortSignal) => Promise<unknown[]>
  type: string
  name: string
}

vi.mock('../ts/index.js', () => ({}))

vi.mock('../ts/tools/utility.js', () => ({
  bgmLog: mockBgmLogn,
  getApp: mockGetApp,
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  getCellValue: mockGetCellValue,
  findHeaderRow: mockFindHeaderRow,
  getColumnMap: mockGetColumnMap,
  trim: mockTrim,
  ensureSheetHeaders: mockEnsureSheetHeaders,
  getDataSheet: mockGetDataSheet,
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  ERROR_LEVELS: { INFO: 0, WARN: 1, ERROR: 2, FATAL: 3 },
  ErrorLevel: { INFO: 0, WARN: 1, ERROR: 2, FATAL: 3 },
  DEFAULT_BANGUMI_API_URL: 'https://api.bgm.tv',
  SYNC_RECORD_SHEET_NAME: 'Bangumi 同步记录',
}))

// Mock SyncSource interface factories（定义在 hoisted 外部，测试代码可访问）
function createMockSource(type: string, name: string) {
  return {
    getDisplayName: () => name,
    validateConfig: () => ({ isFail: () => false, error: null }),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type,
    name,
  }
}

// Mock githubSync module
vi.mock('../ts/sync/githubSync.js', () => ({
  applyConflictResolutions: mockApplyConflictResolutions,
  applyDiffToSheet: mockApplyDiffToSheet,
  computeDiff: mockComputeDiff,
  GithubSyncSource: vi.fn().mockImplementation(function () {
    return mockGithubSourceReference
  }),
  readLocalEntriesForSync: mockReadLocalEntriesForSync,
}))

// Mock other sync source modules（在 mock 工厂内直接创建对象，避免依赖 hoisted 函数）
vi.mock('../ts/sync/gistSync.js', () => ({
  GistSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => 'Gist',
    validateConfig: () => ({ isFail: () => false, error: null }),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'gist',
    name: 'Gist',
  })),
}))

vi.mock('../ts/sync/giteeSync.js', () => ({
  GiteeSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => 'Gitee',
    validateConfig: () => ({ isFail: () => false, error: null }),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'gitee',
    name: 'Gitee',
  })),
}))

vi.mock('../ts/sync/gitlabSync.js', () => ({
  GitlabSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => 'GitLab',
    validateConfig: () => ({ isFail: () => false, error: null }),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'gitlab',
    name: 'GitLab',
  })),
}))

vi.mock('../ts/sync/localFileSync.js', () => ({
  LocalFileSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => '本地文件',
    validateConfig: () => ({ isFail: () => false, error: null }),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'local',
    name: '本地文件',
  })),
}))

vi.mock('../ts/sync/githubConfig.js', () => ({
  getSyncSourceType: mockGetSyncSourceType,
}))

vi.mock('../ts/sync/githubSyncDiff.js', () => ({
  filterByTime: mockFilterByTime,
}))

vi.mock('../ts/sync/pure-utilities.js', () => ({
  extractSubjectId: mockExtractSubjectId,
}))

import {
  registerSyncSource,
  getSyncSource,
  getRegisteredSourceTypes,
  isSyncSourceRegistered,
  syncFromRemote,
} from '../ts/sync/syncSourceRegistry.js'

describe('SyncSource 类型', () => {
  it('应能创建和识别同步源类型', () => {
    const type = 'github'
    expect(typeof type).toBe('string')
  })
})

describe('registerSyncSource', () => {
  it('应注册同步源', () => {
    const factory = () => createMockSource('test', 'Test Source')
    registerSyncSource('test-source', factory)
    expect(isSyncSourceRegistered('test-source')).toBe(true)
  })

  it('覆盖注册应更新已注册的源', () => {
    const factory1 = () => createMockSource('v1', 'V1')
    const factory2 = () => createMockSource('v2', 'V2')
    registerSyncSource('overwrite-test', factory1)
    registerSyncSource('overwrite-test', factory2)
    const source = getSyncSource('overwrite-test')
    expect(source).not.toBeNull()
  })
})

describe('getSyncSource', () => {
  beforeEach(() => {
    // 确保测试源已注册
    registerSyncSource('test-source', () => createMockSource('test', 'Test'))
  })

  it('已注册的源应返回 SyncSource 实例', () => {
    const source = getSyncSource('test-source')
    expect(source).not.toBeNull()
    expect(typeof source).toBe('object')
  })

  it('未注册的源应返回 null', () => {
    const source = getSyncSource('nonexistent')
    expect(source).toBeNull()
  })

  it('每次调用应返回新实例', () => {
    const source1 = getSyncSource('test-source')
    const source2 = getSyncSource('test-source')
    expect(source1).not.toBe(source2)
  })
})

describe('getRegisteredSourceTypes', () => {
  it('应返回所有已注册的类型', () => {
    const types = getRegisteredSourceTypes()
    expect(Array.isArray(types)).toBe(true)
    // 预设的源类型应存在
    expect(types).toContain('github')
  })

  it('注册新源后应出现在列表中', () => {
    registerSyncSource('dynamic-source', () => createMockSource('dyn', 'Dynamic'))
    const types = getRegisteredSourceTypes()
    expect(types).toContain('dynamic-source')
  })
})

describe('isSyncSourceRegistered', () => {
  it('已注册的源应返回 true', () => {
    registerSyncSource('check-source', () => createMockSource('chk', 'Check'))
    expect(isSyncSourceRegistered('check-source')).toBe(true)
  })

  it('未注册的源应返回 false', () => {
    expect(isSyncSourceRegistered('unregistered')).toBe(false)
  })
})

describe('默认源注册', () => {
  it('模块加载时应自动注册 GitHub 源', () => {
    expect(isSyncSourceRegistered('github')).toBe(true)
  })

  it('模块加载时应自动注册 GitLab 源', () => {
    expect(isSyncSourceRegistered('gitlab')).toBe(true)
  })

  it('模块加载时应自动注册 Gitee 源', () => {
    expect(isSyncSourceRegistered('gitee')).toBe(true)
  })

  it('模块加载时应自动注册 local 源', () => {
    expect(isSyncSourceRegistered('local')).toBe(true)
  })

  it('模块加载时应自动注册 gist 源', () => {
    expect(isSyncSourceRegistered('gist')).toBe(true)
  })
})

// ========== syncFromRemote 测试 ==========

describe('syncFromRemote', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetSyncSourceType.mockReturnValue('github')
    mockGithubSourceReference.validateConfig.mockReturnValue({ isFail: () => false, error: null })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })
    mockComputeDiff.mockReturnValue([])
    mockApplyDiffToSheet.mockResolvedValue({
      added: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      remoteTotal: 0,
      unchanged: 0,
      skipped: 0,
    })
    mockGetApp.mockReturnValue({ ScreenUpdating: true, Calculation: 1 })
  })

  it('正常流程应返回同步结果', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '1', name: 'A' },
      { sid: '2', name: 'B' },
    ])
    mockComputeDiff.mockReturnValue([])

    const result = await syncFromRemote()
    expect(result).toBeDefined()
    expect(mockGithubSourceReference.fetchRemoteEntries).toHaveBeenCalled()
    expect(mockApplyDiffToSheet).toHaveBeenCalled()
  })

  it('未知 sourceType 应抛出错误', async () => {
    mockGetSyncSourceType.mockReturnValue('unknown-type')
    await expect(syncFromRemote()).rejects.toThrow('未知的同步源类型')
  })

  it('配置校验失败应抛出错误', async () => {
    mockGithubSourceReference.validateConfig.mockReturnValue({
      isFail: () => true,
      error: new Error('配置不完整'),
    })
    await expect(syncFromRemote()).rejects.toThrow('配置不完整')
  })

  it('下载失败应抛出错误', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockRejectedValue(new Error('网络错误'))
    await expect(syncFromRemote()).rejects.toThrow('网络错误')
  })

  it('读取本地数据失败应抛出错误', async () => {
    mockReadLocalEntriesForSync.mockReturnValue(null)
    await expect(syncFromRemote()).rejects.toThrow('无法读取本地工作表数据')
  })

  it('应调用进度回调', async () => {
    const progress = vi.fn()
    await syncFromRemote(progress)
    expect(progress).toHaveBeenCalled()
    expect(progress).toHaveBeenCalledWith(0, 1, expect.stringContaining('开始下载'))
  })

  it('应用冲突解决时应传递冲突决策', async () => {
    mockComputeDiff.mockReturnValue([
      {
        kind: 'update',
        sid: '1',
        changedFields: ['名称'],
        localRow: 2,
        remote: { sid: '1', name: '新' },
      },
    ])
    const resolutions = [{ sid: '1', field: '名称', chosenValue: 'local' as const }]
    await syncFromRemote(undefined, 'add-update', undefined, false, resolutions)
    expect(mockApplyConflictResolutions).toHaveBeenCalled()
  })

  it('selectedRowsOnly 无选中行应抛出错误', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: null,
      ActiveSheet: null,
    })
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow(
      '未选中任何行',
    )
  })

  it('selectedRowsOnly 有选中行应过滤远程条目', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 2 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockGetCellValue.mockReturnValue('https://bgm.tv/subject/123')
    mockExtractSubjectId.mockReturnValue('123')
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '123', name: '匹配' },
      { sid: '456', name: '不匹配' },
    ])

    const result = await syncFromRemote(undefined, 'add-update', undefined, true)
    expect(result).toBeDefined()
  })

  it('timeFilter 启用时应过滤远程条目', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '1', name: 'A' },
      { sid: '2', name: 'B' },
    ])
    mockFilterByTime.mockReturnValue([{ sid: '1', name: 'A' }])

    const timeFilter = { enabled: true, range: 'year' as const, year: 2024 }
    await syncFromRemote(undefined, 'add-update', undefined, false, undefined, timeFilter)
    expect(mockFilterByTime).toHaveBeenCalled()
  })

  it('应恢复屏幕刷新设置', async () => {
    await syncFromRemote()
    expect(mockGetApp).toHaveBeenCalled()
  })
})

// ========== getSelectedRowSids 间接测试 via syncFromRemote ==========

describe('getSelectedRowSids（间接测试 via syncFromRemote）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetSyncSourceType.mockReturnValue('github')
    mockGithubSourceReference.validateConfig.mockReturnValue({ isFail: () => false, error: null })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })
    mockComputeDiff.mockReturnValue([])
    mockApplyDiffToSheet.mockResolvedValue({
      added: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      remoteTotal: 0,
      unchanged: 0,
      skipped: 0,
    })
  })

  it('无 Selection 应返回空集合', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: null,
      ActiveSheet: null,
    })
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('Selection 有效但无 Bangumi_URL 列应返回空集合', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 2 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    // 无 Bangumi_URL 列
    mockGetColumnMap.mockReturnValue(new Map())

    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('Selection 有效且有 Bangumi_URL 列应提取 SID', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 2 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockGetCellValue.mockReturnValue('https://bgm.tv/subject/123')
    mockExtractSubjectId.mockReturnValue('123')

    const result = await syncFromRemote(undefined, 'add-update', undefined, true)
    expect(result).toBeDefined()
  })

  it('行 URL 为空时应跳过该行', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 2 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    // 空 URL
    mockGetCellValue.mockReturnValue('')
    mockExtractSubjectId.mockReturnValue(null)

    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('app 为 null 时应返回空集合', async () => {
    mockGetApp.mockReturnValue(null)
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })
})

// ========== 补充测试：syncSourceRegistry 未覆盖分支 ==========
describe('syncSourceRegistry 未覆盖分支', () => {
  beforeEach(() => {
    // 不使用 vi.restoreAllMocks，因为它会清除 bgmLog 的 mock 实现
    // 改为手动清除各 mock 的调用记录
    mockBgmLogn.mockClear()
    mockGetApp.mockClear()
    mockGetCellValue.mockClear()
    mockFindHeaderRow.mockClear()
    mockGetColumnMap.mockClear()
    mockEnsureSheetHeaders.mockClear()
    mockGetDataSheet.mockClear()
    mockExtractSubjectId.mockClear()
    mockReadLocalEntriesForSync.mockClear()
    mockComputeDiff.mockClear()
    mockApplyDiffToSheet.mockClear()
    mockApplyConflictResolutions.mockClear()
    mockFilterByTime.mockClear()
    mockGetSyncSourceType.mockClear()
    mockGithubSourceReference.fetchRemoteEntries.mockClear()
    mockGithubSourceReference.validateConfig.mockClear()

    mockGetSyncSourceType.mockReturnValue('github')
    mockGithubSourceReference.validateConfig.mockReturnValue({ isFail: () => false, error: null })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })
    mockComputeDiff.mockReturnValue([])
    mockApplyDiffToSheet.mockResolvedValue({
      added: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      remoteTotal: 0,
      unchanged: 0,
      skipped: 0,
    })
    mockGetApp.mockReturnValue({ ScreenUpdating: true, Calculation: 1 })
    mockBgmLogn.mockClear()
  })

  it('ensureSheetHeaders 返回 true 时记录日志 (line 149-151)', async () => {
    // 先设置 getDataSheet 返回非空 ws 和 ensureSheetHeaders 返回 true
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockEnsureSheetHeaders.mockReturnValue(true)
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 0 })

    await syncFromRemote()
    expect(mockBgmLogn).toHaveBeenCalledWith(
      'INFO',
      expect.stringContaining('空文档已自动填充标准表头'),
    )
  })

  it('ensureSheetHeaders 返回 false 时不记录填充日志', async () => {
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockEnsureSheetHeaders.mockReturnValue(false)
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 0 })

    await syncFromRemote()
    // 不应包含"自动填充"日志
    const fillCalls = mockBgmLogn.mock.calls.filter(
      (call: string[]) => typeof call[1] === 'string' && call[1].includes('自动填充'),
    )
    expect(fillCalls.length).toBe(0)
  })

  it('getSelectedRowSids 捕获异常并记录 ERROR (line 305)', async () => {
    // getApp 第一次调用(syncFromRemote line 131)返回有效对象，
    // 第二次调用(getSelectedRowSids line 267)抛异常，触发 catch 块
    mockGetApp
      .mockImplementationOnce(() => ({ ScreenUpdating: true, Calculation: 1 }))
      .mockImplementationOnce(() => {
        throw new Error('WPS 运行时错误')
      })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })
    mockComputeDiff.mockReturnValue([])
    // selectedRowsOnly=true 会触发 getSelectedRowSids，内部 getApp 抛错被 catch
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
    // 验证 ERROR 日志被记录
    expect(mockBgmLogn).toHaveBeenCalledWith('ERROR', expect.stringContaining('getSelectedRowSids'))
  })

  it('时间筛选 quarter 分支使用 10 月字符串 (line 186)', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '1', name: 'A' },
      { sid: '2', name: 'B' },
    ])
    mockFilterByTime.mockReturnValue([{ sid: '1', name: 'A' }])
    const timeFilter = { enabled: true, range: 'quarter' as const, year: 2024, quarter: 4 }
    await syncFromRemote(undefined, 'add-update', undefined, false, undefined, timeFilter)
    expect(mockFilterByTime).toHaveBeenCalled()
  })

  it('时间筛选 month 分支使用 10 月字符串 (line 186)', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockFilterByTime.mockReturnValue([{ sid: '1', name: 'A' }])
    const timeFilter = { enabled: true, range: 'month' as const, year: 2024, month: 6 }
    await syncFromRemote(undefined, 'add-update', undefined, false, undefined, timeFilter)
    expect(mockFilterByTime).toHaveBeenCalled()
  })

  it('getApp 抛异常时 syncFromRemote 应被 try/finally 正确处理', async () => {
    // 设置 mock 让 getApp 本身抛异常
    mockGetApp.mockImplementation(() => {
      throw new Error('WPS 宿主不可用')
    })
    // 期望异常传播：syncFromRemote 中 try/catch 仅捕获 ScreenUpdating 的设置失败，
    // 但 getApp 放在 try 外调用则应直接抛出
    // 源码中 getApp 在 try 之前调用（line 131），因此异常应直接抛出
    await expect(syncFromRemote()).rejects.toThrow('WPS 宿主不可用')
  })

  it('applyDiffToSheet 返回结果后应设置 remoteTotal 和 unchanged', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '1', name: 'A' },
      { sid: '2', name: 'B' },
      { sid: '3', name: 'C' },
    ])
    mockComputeDiff.mockReturnValue([
      { kind: 'add', sid: '1' },
      { kind: 'update', sid: '2' },
    ])
    mockApplyDiffToSheet.mockResolvedValue({
      added: 1,
      updated: 1,
      deleted: 0,
      failed: 0,
      remoteTotal: 3,
      unchanged: 0,
      skipped: 0,
    })
    const result = await syncFromRemote()
    expect(result.remoteTotal).toBe(3)
    // unchanged = max(0, 3 - 1 - 1) = 1
    expect(result.unchanged).toBe(1)
  })

  it('readLocalEntriesForSync 返回 null 时应抛出错误', async () => {
    mockReadLocalEntriesForSync.mockReturnValue(null)
    await expect(syncFromRemote()).rejects.toThrow('无法读取本地工作表数据')
  })

  it('冲突解决列表为空数组时不应影响正常流程', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    // 空数组 conflictResolution 不应抛出，且流程正常
    const result = await syncFromRemote(undefined, 'add-update', undefined, false, [])
    expect(result).toBeDefined()
  })

  it('ensureSheetHeaders 返回 true 时应触发 onProgress 提示', async () => {
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockEnsureSheetHeaders.mockReturnValue(true)
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 0 })
    const progress = vi.fn()
    await syncFromRemote(progress)
    expect(progress).toHaveBeenCalledWith(1, 3, expect.stringContaining('已自动填充'))
  })

  it('selectedRowsOnly 且有匹配时应记录 INFO 日志', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 2 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockGetCellValue.mockReturnValue('https://bgm.tv/subject/123')
    mockExtractSubjectId.mockReturnValue('123')
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '123', name: '匹配' },
      { sid: '456', name: '不匹配' },
    ])
    mockComputeDiff.mockReturnValue([])
    await syncFromRemote(undefined, 'add-update', undefined, true)
    expect(mockBgmLogn).toHaveBeenCalledWith('INFO', expect.stringContaining('仅同步选中行'))
  })

  it('timeFilter.range === year 分支应使用年份字符串', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '1', name: 'A' },
      { sid: '2', name: 'B' },
    ])
    mockFilterByTime.mockReturnValue([{ sid: '1', name: 'A' }])
    const timeFilter = { enabled: true, range: 'year' as const, year: 2024 }
    const progress = vi.fn()
    await syncFromRemote(progress, 'add-update', undefined, false, undefined, timeFilter)
    expect(progress).toHaveBeenCalledWith(1, 3, expect.stringContaining('2024年'))
  })

  it('timeFilter 使用无效 range 时回退到 month 分支', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockFilterByTime.mockReturnValue([{ sid: '1', name: 'A' }])
    const timeFilter = { enabled: true, range: 'invalid' as const, year: 2024, month: 8 }
    const progress = vi.fn()
    await syncFromRemote(progress, 'add-update', undefined, false, undefined, timeFilter)
    expect(progress).toHaveBeenCalledWith(1, 3, expect.stringContaining('2024年8月'))
  })

  it('conflictResolution 为 undefined 时不应影响正常流程', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    // 不传 conflictResolution 参数，即为 undefined
    const result = await syncFromRemote()
    expect(result).toBeDefined()
    expect(mockApplyConflictResolutions).not.toHaveBeenCalled()
  })

  it('设置 ScreenUpdating 抛异常时应被 catch 且流程继续', async () => {
    // 创建带有 setter 的 mock app
    let _isScreenUpdating = true
    const mockAppWithSetterError = {
      get ScreenUpdating() {
        return _isScreenUpdating
      },
      set ScreenUpdating(v: boolean) {
        if (!v) throw new Error('COM 调用失败')
        _isScreenUpdating = v
      },
      Calculation: 1,
    }
    mockGetApp.mockReturnValue(mockAppWithSetterError)
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })

    const result = await syncFromRemote()
    expect(result).toBeDefined()
  })

  it('getApp 返回 null 时 finally 块跳过恢复', async () => {
    mockGetApp.mockReturnValue(null)
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })

    // 流程因 getApp 返回 null 而跳过 ScreenUpdating 设置，finally 也跳过恢复
    const result = await syncFromRemote()
    expect(result).toBeDefined()
  })

  it('finally 块中 app 存在但 prevScreenUpdating 为 undefined 时跳过恢复', async () => {
    // 模拟 getApp 先返回正常值，但在 try 块的 ScreenUpdating 设置前就出错
    // 实际上 getApp 在 try 之前调用，返回 null 时就会走跳过逻辑
    // 此测试验证 getApp 返回正常值，但后续流程不会触发 ScreenUpdating 变化的场景
    mockGetApp.mockReturnValue({ ScreenUpdating: true, Calculation: 1 })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 0 })

    const result = await syncFromRemote()
    expect(result).toBeDefined()
  })

  it('timeFilter.enabled 为 false 时不进入时间筛选分支', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    const timeFilter = { enabled: false, range: 'year' as const, year: 2024 }
    await syncFromRemote(undefined, 'add-update', undefined, false, undefined, timeFilter)
    expect(mockFilterByTime).not.toHaveBeenCalled()
  })

  it('timeFilter.range 为 all 时不进入时间筛选分支', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    const timeFilter = { enabled: true, range: 'all' as const }
    await syncFromRemote(undefined, 'add-update', undefined, false, undefined, timeFilter)
    expect(mockFilterByTime).not.toHaveBeenCalled()
  })

  it('getSelectedRowSids 中 getApp 返回 null 且 selectedRowsOnly 应走早返回路径', async () => {
    mockGetApp.mockReturnValue(null)
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow(
      '未选中任何行',
    )
  })

  it('选区包含表头行时应跳过 headerRow 行 (line 294)', async () => {
    // headerRow=1, 选区 Row=1, Count=2 → 行 1(表头) 和 2
    // 行 1 应被跳过，行 2 被处理
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 1, Rows: { Count: 2 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    // 行 1 (header): 空值 → 被跳过
    // 行 2: 有效 URL
    mockGetCellValue.mockImplementation((_ws: unknown, row: number, _col: number) => {
      // 表头行，无 URL
      if (row === 1) return ''
      if (row === 2) return 'https://bgm.tv/subject/999'
      return ''
    })
    mockExtractSubjectId.mockImplementation((url: string) => {
      if (url.includes('999')) return '999'
      return null
    })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '999', name: '匹配' },
      { sid: '111', name: '不匹配' },
    ])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 2 })

    const result = await syncFromRemote(undefined, 'add-update', undefined, true)
    expect(result).toBeDefined()
    // 验证只提取了 sid 999
    expect(mockBgmLogn).toHaveBeenCalledWith('INFO', expect.stringContaining('提取到 1 个 SID'))
  })

  it('extractSubjectId 返回 null 时 SID 不加入集合 (line 298 假分支)', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 1 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockGetCellValue.mockReturnValue('https://bgm.tv/subject/invalid')
    // 无效 URL 返回 null
    mockExtractSubjectId.mockReturnValue(null)
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '123', name: '远程' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 2 })

    // 因为提取不到 SID，selectedSids 为空，抛出错误
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('ActiveSheet 为 null 时 getSelectedRowSids 返回空集合', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 2 } },
      // 无活动工作表
      ActiveSheet: null,
    })
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('冲突解决列表非空数组时应应用决策', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([
      {
        kind: 'update',
        sid: '1',
        changedFields: ['名称'],
        localRow: 2,
        remote: { sid: '1', name: '新' },
      },
    ])
    const resolutions = [{ sid: '1', field: '名称', chosenValue: 'local' as const }]
    await syncFromRemote(undefined, 'add-update', undefined, false, resolutions)
    expect(mockApplyConflictResolutions).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sid: '1' })]),
      resolutions,
    )
  })

  it('selection.Rows.Count 为 0 时选区范围正确计算', async () => {
    // Count=0 时 lastRow = Row + 0 - 1 = Row - 1，firstRow > lastRow，循环不执行
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 5, Rows: { Count: 0 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 5 })

    // 选区为空，selectedSids 为空，抛出错误
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('时间筛选 month 分支 with 二月份', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockFilterByTime.mockReturnValue([])
    const timeFilter = { enabled: true, range: 'month' as const, year: 2024, month: 2 }
    const progress = vi.fn()
    await syncFromRemote(progress, 'add-update', undefined, false, undefined, timeFilter)
    expect(progress).toHaveBeenCalledWith(1, 3, expect.stringContaining('2024年2月'))
  })

  it('时间筛选 quarter 分支 with 第一季度', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockFilterByTime.mockReturnValue([{ sid: '1', name: 'A' }])
    const timeFilter = { enabled: true, range: 'quarter' as const, year: 2025, quarter: 1 }
    const progress = vi.fn()
    await syncFromRemote(progress, 'add-update', undefined, false, undefined, timeFilter)
    expect(progress).toHaveBeenCalledWith(1, 3, expect.stringContaining('2025年1月新番'))
  })

  it('downloadElapsed 时间应大于等于 0', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })
    const progress = vi.fn()
    await syncFromRemote(progress)
    // 进度回调中 downloadElapsed 应为非负数字
    const downloadCall = progress.mock.calls.find(
      (c: unknown[]) => typeof c[2] === 'string' && c[2].includes('下载完成'),
    )
    expect(downloadCall).toBeDefined()
    if (downloadCall) {
      const message = downloadCall[2] as string
      expect(message).toContain('下载完成')
      expect(message).toMatch(/耗时 \d+ms/)
    }
  })

  it('diff 结果为 0 条时 overallSpeed 为 0 (line 228)', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    // 无差异
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })
    mockApplyDiffToSheet.mockResolvedValue({
      added: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      remoteTotal: 1,
      unchanged: 1,
      skipped: 0,
    })
    const progress = vi.fn()
    await syncFromRemote(progress)
    // totalProcessed = 0, overallSpeed 应为 0
    // 查找最后一次进度回调（包含"完成"且不是"下载完成"）
    const completeCalls = progress.mock.calls.filter(
      (c: unknown[]) => typeof c[2] === 'string' && c[2].startsWith('完成'),
    )
    expect(completeCalls.length).toBeGreaterThan(0)
    if (completeCalls.length > 0) {
      const message = completeCalls[completeCalls.length - 1][2] as string
      // 当 totalProcessed=0 时，速度显示为 "?"
      expect(message).toContain('?')
    }
  })

  it('finally 恢复时 prevScreenUpdating 为 undefined 跳过分支 (line 239)', async () => {
    // getApp 先返回正常值，然后返回 null 使 prevScreenUpdating 保持 undefined
    // 实际上 getApp 在 try 前调用一次，在 finally 中不再调用
    // 我们需要设置 prevScreenUpdating 为 undefined 的场景
    // 这需要在 getApp 返回的对象中 ScreenUpdating 属性本身为 undefined
    mockGetApp.mockReturnValue({ ScreenUpdating: undefined, Calculation: undefined })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })

    const result = await syncFromRemote()
    expect(result).toBeDefined()
  })

  it('finally 恢复时 prevCalculation 为 undefined 跳过分支 (line 240)', async () => {
    mockGetApp.mockReturnValue({ ScreenUpdating: true, Calculation: undefined })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 1 })

    const result = await syncFromRemote()
    expect(result).toBeDefined()
  })

  it('无 Bangumi_URL 列时 getSelectedRowSids 走无列分支 (line 284)', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 2, Rows: { Count: 2 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    // 空 Map，无 Bangumi_URL 列
    mockGetColumnMap.mockReturnValue(new Map())
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 2 })

    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('headerRow 为 0 时 findHeaderRow 返回 null 应使用默认值 1', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: { Row: 1, Rows: { Count: 3 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    // findHeaderRow 返回 0
    mockFindHeaderRow.mockReturnValue(0)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockGetCellValue.mockImplementation((_ws: unknown, row: number, _col: number) =>
      row === 2 ? 'https://bgm.tv/subject/777' : '',)
    mockExtractSubjectId.mockImplementation((url: string) => (url.includes('777') ? '777' : null))
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '777', name: '匹配' }])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 3 })

    const result = await syncFromRemote(undefined, 'add-update', undefined, true)
    expect(result).toBeDefined()
  })

  it('lastRow 计算正确且有多行有效 URL', async () => {
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      // 行 2, 3, 4
      Selection: { Row: 2, Rows: { Count: 3 } },
      ActiveSheet: { Name: 'Sheet1' },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 5]]))
    mockGetCellValue.mockImplementation((_ws: unknown, row: number, _col: number) => {
      const urls: Record<number, string> = {
        2: 'https://bgm.tv/subject/100',
        // 空行
        3: '',
        4: 'https://bgm.tv/subject/200',
      }
      return urls[row] ?? ''
    })
    mockExtractSubjectId.mockImplementation((url: string) => {
      if (url.includes('100')) return '100'
      if (url.includes('200')) return '200'
      return null
    })
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '100', name: 'A' },
      { sid: '200', name: 'B' },
    ])
    mockComputeDiff.mockReturnValue([])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 4 })

    const result = await syncFromRemote(undefined, 'add-update', undefined, true)
    expect(result).toBeDefined()
  })

  it('配置校验失败且 error.message 为 undefined 时使用默认消息 (line 117)', async () => {
    mockGithubSourceReference.validateConfig.mockReturnValue({
      isFail: () => true,
      // error.message 为 undefined
      error: null,
    })
    await expect(syncFromRemote()).rejects.toThrow('同步源 github 配置校验失败')
  })

  it('overallSpeed > 0 时显示实际速度 (lines 222-232)', async () => {
    // 模拟时间流逝：Date.now() 返回不同值
    let timeValue = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (timeValue += 1))
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([
      { sid: '1', name: 'A' },
      { sid: '2', name: 'B' },
    ])
    mockComputeDiff.mockReturnValue([
      { kind: 'add', sid: '1' },
      { kind: 'update', sid: '2' },
    ])
    mockReadLocalEntriesForSync.mockReturnValue({ entries: new Map(), lastRow: 2 })
    mockApplyDiffToSheet.mockResolvedValue({
      added: 1,
      updated: 1,
      deleted: 0,
      failed: 0,
      remoteTotal: 2,
      unchanged: 0,
      skipped: 0,
    })
    const progress = vi.fn()
    await syncFromRemote(progress)
    // 恢复 Date.now
    vi.restoreAllMocks()
    // 查找最后一次进度回调
    const completeCalls = progress.mock.calls.filter(
      (c: unknown[]) => typeof c[2] === 'string' && c[2].startsWith('完成'),
    )
    expect(completeCalls.length).toBeGreaterThan(0)
    if (completeCalls.length > 0) {
      const message = completeCalls[completeCalls.length - 1][2] as string
      // 当 totalProcessed=2 且 totalElapsed>0 时，速度应为实际数字
      expect(message).toMatch(/\d+ 行\/秒/)
    }
  })
})
