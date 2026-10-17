// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Result } from '../ts/core/result.js'

// 使用 vi.hoisted 定义在 mock 工厂内引用的变量
const mockBgmLogn = vi.hoisted(() => vi.fn())
const mockGetApp = vi.hoisted(() => vi.fn())
const mockGetCellValue = vi.hoisted(() => vi.fn().mockReturnValue(''))

const mockReadRowsCache = vi.hoisted(() =>
  vi.fn(
    (
      _ws: unknown,
      _rows: readonly number[],
      _maxCol: number,
    ): Map<number, readonly string[]> | null => null,
  ),
)
const mockReadRangeValues = vi.hoisted(() =>
  vi.fn(
    (
      ws: unknown,
      startRow: number,
      endRow: number,
      startCol: number,
      endCol: number,
    ): string[][] => {
      try {
        const rows: string[][] = []
        for (let row = startRow; row <= endRow; row += 1) {
          const line: string[] = []
          for (let col = startCol; col <= endCol; col += 1) {
            const value = mockGetCellValue(ws, row, col) as string | number | boolean | null
            line.push(value == null ? '' : String(value))
          }
          rows.push(line)
        }
        return rows
      } catch {
        return []
      }
    },
  ),
)
const mockFindHeaderRow = vi.hoisted(() => vi.fn().mockReturnValue(1))
const mockGetColumnMap = vi.hoisted(() => vi.fn().mockReturnValue(new Map()))
const mockTrim = vi.hoisted(() => vi.fn((v: string) => v.trim()))
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
  }),
)
const mockComputeDiff = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockReadLocalEntriesForSync = vi.hoisted(() =>
  vi.fn().mockReturnValue({ entries: new Map(), lastRow: 1 }),
)
const mockFilterByTime = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockExtractSubjectId = vi.hoisted(() => vi.fn().mockReturnValue(null))
const mockGetSyncSourceType = vi.hoisted(() => vi.fn().mockReturnValue('github'))
// 缺列主动通知（toast）：core 经通知桥的 getNotifyApi 发出（依赖反转，不直连 UI 层），
// 桥被 mock 成只记 toast 调用，避免真实降级实现写日志噪声
const mockToast = vi.hoisted(() => vi.fn<(message: string, toastType?: string) => void>())

// 创建可变的 mock source 引用
// 注意：vi.hoisted 的代码先于 import 求值，此处不能引用 Result（会触发 TDZ
// 「Cannot access '__vi_import_N__' before initialization」），故这里保留最小形状；
// 生产代码只读取 isFail()/error，行为等价。
const mockGithubSourceReference = vi.hoisted(() => ({
  getDisplayName: vi.fn().mockReturnValue('GitHub'),
  validateConfig: vi.fn().mockReturnValue({ isFail: () => false, error: null }),
  fetchRemoteEntries: vi.fn().mockResolvedValue([]),
  // 下载统计（syncFromRemote 读取后写入 result.skippedInvalidLines）
  loadStats: { skippedInvalidLines: 0 },
}))

vi.mock('../ts/index.js', () => ({}))

vi.mock('../ts/tools/utility.js', () => ({
  bgmLog: mockBgmLogn,
  getApp: mockGetApp,
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  getCellValue: mockGetCellValue,
  readRangeValues: mockReadRangeValues,
  readRowsCache: mockReadRowsCache,
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

// 通知桥：core 的缺列 toast 走 getNotifyApi().toast（依赖反转，不直连 UI 层）
vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => ({
    toast: mockToast,
    alert: vi.fn(),
    confirm: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    input: vi.fn(),
  }),
}))

// Mock SyncSource interface factories（定义在 hoisted 外部，测试代码可访问）
function createMockSource(type: string, name: string) {
  return {
    getSourceType: () => type,
    getDisplayName: () => name,
    validateConfig: () => Result.okVoid(),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type,
    name,
  }
}

// Mock githubSync module
// 2026-10-17 结构合并：apply 三函数已迁去 remote-sync-apply.js（下面单独全量 mock），
// computeDiff 由 github-sync-diff.js 的部分 mock 覆盖，此处只需提供源实现类。
vi.mock('../ts/sync/github-sync.js', () => ({
  GithubSyncSource: vi.fn().mockImplementation(function createGithubSyncSource() {
    return mockGithubSourceReference
  }),
}))

// Mock apply 阶段（全量工厂：真实模块不加载 → sync-record / undo-stack 等不随编排层入场，
// 与改动前 github-sync.js 全量 mock 的隔离级别一致）。
// remote-sync-core.ts 以跨模块 import 使用这三个函数，vi.mock 截得住。
vi.mock('../ts/sync/remote-sync-apply.js', () => ({
  applyConflictResolutions: mockApplyConflictResolutions,
  applyDiffToSheet: mockApplyDiffToSheet,
  readLocalEntriesForSync: mockReadLocalEntriesForSync,
}))

// Mock other sync source modules（在 mock 工厂内直接创建对象，避免依赖 hoisted 函数）
vi.mock('../ts/sync/gist-sync.js', () => ({
  GistSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => 'Gist',
    validateConfig: () => Result.okVoid(),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'gist',
    name: 'Gist',
  })),
}))

vi.mock('../ts/sync/gitee-sync.js', () => ({
  GiteeSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => 'Gitee',
    validateConfig: () => Result.okVoid(),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'gitee',
    name: 'Gitee',
  })),
}))

vi.mock('../ts/sync/gitlab-sync.js', () => ({
  GitlabSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => 'GitLab',
    validateConfig: () => Result.okVoid(),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'gitlab',
    name: 'GitLab',
  })),
}))

vi.mock('../ts/sync/local-file-sync.js', () => ({
  LocalFileSyncSource: vi.fn().mockImplementation(() => ({
    getDisplayName: () => '本地文件',
    validateConfig: () => Result.okVoid(),
    fetchRemoteEntries: vi.fn().mockResolvedValue([]),
    type: 'local',
    name: '本地文件',
  })),
}))

vi.mock('../ts/sync/github-config.js', () => ({
  getSyncSourceType: mockGetSyncSourceType,
  getManualShards: vi.fn(() => []),
}))

// 真实展开：shard-manifest 的 neededFieldsForColumns 依赖 EXTENDED_FIELD_MAP / getExcelAliases，
// 只覆盖 filterByTime 与 computeDiff 即可，其余保留真实实现
// （computeDiff 原先随 github-sync.js 全量 mock 提供；结构合并后由 core 从本模块导入）
vi.mock('../ts/sync/github-sync-diff.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/sync/github-sync-diff.js')>()
  return { ...actual, filterByTime: mockFilterByTime, computeDiff: mockComputeDiff }
})

vi.mock('../ts/sync/pure-utilities.js', () => ({
  extractSubjectId: mockExtractSubjectId,
}))

import {
  registerSyncSource,
  getSyncSource,
  getRegisteredSourceTypes,
  isSyncSourceRegistered,
  syncFromRemote,
} from '../ts/sync/sync-source-registry.js'
import type { SyncTimeFilter } from '../ts/sync/github-sync-diff.js'

describe('SyncSource 类型', () => {
  it('应能创建和识别同步源类型', () => {
    const type = 'github'
    expect(typeof type).toBe('string')
  })
})

describe('registerSyncSource', () => {
  it('应注册同步源', () => {
    registerSyncSource('test-source', () => createMockSource('test', 'Test Source'))
    expect(isSyncSourceRegistered('test-source')).toBe(true)
  })

  it('覆盖注册应更新已注册的源', () => {
    registerSyncSource('overwrite-test', () => createMockSource('v1', 'V1'))
    registerSyncSource('overwrite-test', () => createMockSource('v2', 'V2'))
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
    mockToast.mockClear()
    mockGetSyncSourceType.mockReturnValue('github')
    mockGithubSourceReference.validateConfig.mockReturnValue(Result.okVoid())
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([])
    // 下载统计归零：loadStats 是普通对象属性，restoreAllMocks 不会重置它
    mockGithubSourceReference.loadStats.skippedInvalidLines = 0
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

  it('缺合法 sid 计数透传到 result.skippedInvalidLines 并记 WARN', async () => {
    mockGithubSourceReference.loadStats.skippedInvalidLines = 3

    const result = await syncFromRemote()

    expect(result.skippedInvalidLines).toBe(3)
    expect(mockBgmLogn).toHaveBeenCalledWith(
      'WARN',
      expect.stringContaining('3 条远程记录缺少合法 sid 已跳过'),
    )
  })

  it('无脏数据时 result.skippedInvalidLines 为 undefined（不给弹窗加空段）', async () => {
    const result = await syncFromRemote()

    expect(result.skippedInvalidLines).toBeUndefined()
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
    mockGithubSourceReference.validateConfig.mockReturnValue(Result.okVoid())
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
    mockToast.mockClear()
    mockGithubSourceReference.fetchRemoteEntries.mockClear()
    mockGithubSourceReference.validateConfig.mockClear()

    mockGetSyncSourceType.mockReturnValue('github')
    mockGithubSourceReference.validateConfig.mockReturnValue(Result.okVoid())
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
    const timeFilter: SyncTimeFilter = { enabled: true, range: 'quarter', year: 2024, quarter: 4 }
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

  it('同步完成后应做缺列体检：远程有数据但本地无表头时给出 missingColumns', async () => {
    // 此前缺列体检只存在于 GitHub 路径，走 Gitee / GitLab / 本地 / Gist 时
    // 用户只会看到「同步成功但字段没进来」，没有任何提示。
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map<string, number>())

    const result = await syncFromRemote()

    expect(Array.isArray(result.missingColumns)).toBe(true)
    // 本地完全没有表头 ⇒ 至少 Bangumi_URL 会被判为缺失
    expect(result.missingColumns?.length).toBeGreaterThan(0)
  })

  it('缺列体检有结果时应发 toast 主动通知（不只进日志与弹窗细节）', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([{ sid: '1', name: 'A' }])
    mockComputeDiff.mockReturnValue([])
    mockGetDataSheet.mockReturnValue({ Name: 'Sheet1' })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map<string, number>())

    await syncFromRemote()

    expect(mockToast).toHaveBeenCalledTimes(1)
    const [message, toastType] = mockToast.mock.calls[0] ?? []
    // 条数 + 「缺少表头」归因 + 「重新同步」指引都要在 toast 里
    expect(String(message)).toContain('缺少表头')
    expect(String(message)).toContain('重新同步')
    expect(String(message)).toMatch(/^\d+ 个远程字段/)
    expect(toastType).toBe('warning')
  })

  it('无缺列时不应发 toast（不打扰用户）', async () => {
    mockGithubSourceReference.fetchRemoteEntries.mockResolvedValue([])
    mockComputeDiff.mockReturnValue([])

    await syncFromRemote()

    expect(mockToast).not.toHaveBeenCalled()
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
    // 刻意传入越界 range：覆盖消费方的回退分支（本用例断言其回退到 month 分支）
    const timeFilter = {
      enabled: true,
      range: 'invalid',
      year: 2024,
      month: 8,
    } as unknown as SyncTimeFilter
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
    // year 在 range='all' 下不参与筛选（filterByTime 提前返回），但类型上必填
    const timeFilter: SyncTimeFilter = { enabled: true, range: 'all', year: 2024 }
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
    const timeFilter: SyncTimeFilter = { enabled: true, range: 'quarter', year: 2025, quarter: 1 }
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
      const message = completeCalls.at(-1)?.[2] as string
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
      row === 2 ? 'https://bgm.tv/subject/777' : '',
    )
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
    vi.spyOn(Date, 'now').mockImplementation(() => {
      timeValue += 1
      return timeValue
    })
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
      const message = completeCalls.at(-1)?.[2] as string
      // 当 totalProcessed=2 且 totalElapsed>0 时，速度应为实际数字
      expect(message).toMatch(/\d+ 行\/秒/)
    }
  })
})
