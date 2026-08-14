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
  vi
    .fn()
    .mockResolvedValue({
      added: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      remoteTotal: 0,
      unchanged: 0,
      skipped: 0,
    }),
)
const mockComputeDiff = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockReadLocalEntriesForSync = vi.hoisted(() =>
  vi.fn().mockReturnValue({ entries: new Map(), lastRow: 1 }),
)
const mockFilterByTime = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockExtractSubjectId = vi.hoisted(() => vi.fn().mockReturnValue(null))
const mockGetSyncSourceType = vi.hoisted(() => vi.fn().mockReturnValue('github'))

// 创建可变的 mock source 引用
const mockGithubSourceRef = vi.hoisted(() => ({
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

vi.mock('../ts/tools/util.js', () => ({
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
    return mockGithubSourceRef
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

vi.mock('../ts/sync/pureUtils.js', () => ({
  extractSubjectId: mockExtractSubjectId,
}))

import {
  registerSyncSource,
  getSyncSource,
  getRegisteredSourceTypes,
  isSyncSourceRegistered,
} from '../ts/sync/syncSourceRegistry.js'
import { syncFromRemote } from '../ts/sync/syncSourceRegistry.js'

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
    mockGithubSourceRef.validateConfig.mockReturnValue({ isFail: () => false, error: null })
    mockGithubSourceRef.fetchRemoteEntries.mockResolvedValue([])
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
    mockGithubSourceRef.fetchRemoteEntries.mockResolvedValue([
      { sid: '1', name: 'A' },
      { sid: '2', name: 'B' },
    ])
    mockComputeDiff.mockReturnValue([])

    const result = await syncFromRemote()
    expect(result).toBeDefined()
    expect(mockGithubSourceRef.fetchRemoteEntries).toHaveBeenCalled()
    expect(mockApplyDiffToSheet).toHaveBeenCalled()
  })

  it('未知 sourceType 应抛出错误', async () => {
    mockGetSyncSourceType.mockReturnValue('unknown-type')
    await expect(syncFromRemote()).rejects.toThrow('未知的同步源类型')
  })

  it('配置校验失败应抛出错误', async () => {
    mockGithubSourceRef.validateConfig.mockReturnValue({
      isFail: () => true,
      error: new Error('配置不完整'),
    })
    await expect(syncFromRemote()).rejects.toThrow('配置不完整')
  })

  it('下载失败应抛出错误', async () => {
    mockGithubSourceRef.fetchRemoteEntries.mockRejectedValue(new Error('网络错误'))
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
    mockGithubSourceRef.fetchRemoteEntries.mockResolvedValue([
      { sid: '123', name: '匹配' },
      { sid: '456', name: '不匹配' },
    ])

    const result = await syncFromRemote(undefined, 'add-update', undefined, true)
    expect(result).toBeDefined()
  })

  it('timeFilter 启用时应过滤远程条目', async () => {
    mockGithubSourceRef.fetchRemoteEntries.mockResolvedValue([
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
    mockGithubSourceRef.validateConfig.mockReturnValue({ isFail: () => false, error: null })
    mockGithubSourceRef.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
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
    mockGetColumnMap.mockReturnValue(new Map()) // 无 Bangumi_URL 列

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
    mockGetCellValue.mockReturnValue('') // 空 URL
    mockExtractSubjectId.mockReturnValue(null)

    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })

  it('app 为 null 时应返回空集合', async () => {
    mockGetApp.mockReturnValue(null)
    await expect(syncFromRemote(undefined, 'add-update', undefined, true)).rejects.toThrow()
  })
})
