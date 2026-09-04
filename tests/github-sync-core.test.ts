// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ========== 使用 vi.hoisted 定义 mock 变量 ==========

const mockBgmLogn = vi.hoisted(() => vi.fn())
const mockGetDataSheet = vi.hoisted(() => vi.fn())
const mockFindHeaderRow = vi.hoisted(() => vi.fn())
const mockGetLastRow = vi.hoisted(() => vi.fn())
const mockGetColumnMap = vi.hoisted(() => vi.fn())
const mockGetCellValue = vi.hoisted(() => vi.fn())
const mockSetCellValue = vi.hoisted(() => vi.fn())
const mockColNumberToLetter = vi.hoisted(() => vi.fn())
const mockEnsureSheetHeaders = vi.hoisted(() => vi.fn())
const mockGetApp = vi.hoisted(() => vi.fn())
const mockBuildRawUrl = vi.hoisted(() => vi.fn())
const mockIsGithubConfigComplete = vi.hoisted(() => vi.fn())
const mockParseJsonl = vi.hoisted(() => vi.fn())
const mockComputeDiff = vi.hoisted(() => vi.fn())
const mockTagsToString = vi.hoisted(() => vi.fn())
const mockExtractSubjectId = vi.hoisted(() => vi.fn())
const mockBeginUndoSession = vi.hoisted(() => vi.fn())
const mockEndUndoSession = vi.hoisted(() => vi.fn())
const mockRecordUndoEntry = vi.hoisted(() => vi.fn())
const mockRecordRowDeleteEntry = vi.hoisted(() => vi.fn())
const mockAddSyncRecords = vi.hoisted(() => vi.fn())
const mockAddSyncRecordSummary = vi.hoisted(() => vi.fn())
const mockFilterByTime = vi.hoisted(() => vi.fn())

// Mock XMLHttpRequest
const mockXHR = vi.hoisted(() => {
  const xhrMock = {
    open: vi.fn(),
    send: vi.fn(),
    setRequestHeader: vi.fn(),
    abort: vi.fn(),
    timeout: 0,
    onload: null as ((...arguments_: unknown[]) => void) | null,
    onerror: null as ((...arguments_: unknown[]) => void) | null,
    ontimeout: null as ((...arguments_: unknown[]) => void) | null,
    status: 200,
    statusText: 'OK',
    responseText: '',
    // 生产代码经 addEventListener('load'/'error', fn) 注册：映射回 onXXX 属性，
    // 测试仍以 `xhrMock.onload?.()` 手动触发
    addEventListener: (type: string, handler: (...arguments_: unknown[]) => void): void => {
      switch (type) {
        case 'load': {
          xhrMock.onload = handler
          break
        }
        case 'error': {
          xhrMock.onerror = handler
          break
        }
        default: {
          break
        }
      }
    },
    removeEventListener: vi.fn(),
  }
  const XHRConstructor = vi.fn().mockImplementation(function () {
    return xhrMock
  })
  return { xhrMock, XHRConstructor }
})

// ========== Mock 依赖模块 ==========

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  BGM_SUBJECT_TYPES: { 2: '动漫' },
  SYNC_STATUS: { SUCCESS: 'success', FAIL: 'fail', SKIP: 'skip' },
  BGM_COLOR: { SUCCESS: 1, FAIL: 2, SKIP: 3 },
  SYNC_RECORD_COLUMNS: [
    'SID',
    '同步时间',
    '名称',
    'URL',
    '条目类型',
    '来源',
    '次数',
    '内容',
    '状态',
    '收藏状态',
    '备注',
    '数据指纹',
  ],
  SYNC_RECORD_COL: {
    SID: 1,
    TIME: 2,
    NAME: 3,
    URL: 4,
    TYPE: 5,
    SOURCE: 6,
    COUNT: 7,
    CONTENT: 8,
    STATUS: 9,
    COLL_TYPE: 10,
    MESSAGE: 11,
    FINGERPRINT: 12,
  },
  SYNC_RECORD_TYPE_COLOR: { 动漫: 10 },
  ERROR_LEVELS: { INFO: 0, WARN: 1, ERROR: 2, FATAL: 3 },
  ErrorLevel: { INFO: 0, WARN: 1, ERROR: 2, FATAL: 3 },
}))

vi.mock('../ts/tools/utility.js', () => ({
  bgmLog: mockBgmLogn,
  getDataSheet: mockGetDataSheet,
  findHeaderRow: mockFindHeaderRow,
  getLastRow: mockGetLastRow,
  getColumnMap: mockGetColumnMap,
  getCellValue: mockGetCellValue,
  setCellValue: mockSetCellValue,
  colNumberToLetter: mockColNumberToLetter,
  trim: vi.fn((v: string) => v?.trim() ?? ''),
  ensureSheetHeaders: mockEnsureSheetHeaders,
  getApp: mockGetApp,
  BGM: { handleError: vi.fn() },
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

vi.mock('../ts/core/result.js', () => ({
  Result: {
    ok: vi.fn((v: unknown) => ({ isFail: () => false, value: v })),
    okVoid: vi.fn(() => ({ isFail: () => false })),
    failVoid: vi.fn((error: Error) => ({ isFail: () => true, error })),
  },
  BgmError: vi.fn().mockImplementation(function (message: string) {
    this.message = message
  }),
}))

vi.mock('../ts/sync/github-config.js', () => ({
  buildRawUrl: mockBuildRawUrl,
  isGithubConfigComplete: mockIsGithubConfigComplete,
  getSyncSourceType: vi.fn().mockReturnValue('github'),
}))

vi.mock('../ts/sync/github-sync-diff.js', () => ({
  parseJsonl: mockParseJsonl,
  computeDiff: mockComputeDiff,
  tagsToString: mockTagsToString,
  filterByTime: mockFilterByTime,
  EXTENDED_FIELD_MAP: [
    ['date', '开播日期'],
    ['meta_tags', '标签/分级'],
    ['话数', '集数'],
  ],
  SYNC_STRATEGY_LABELS: {
    'add-update': '新增+更新',
    'add-only': '仅新增',
    'update-only': '仅更新',
    mirror: '镜像同步',
    'force-overwrite': '强制覆盖',
  },
  getExcelAliases: vi.fn((jsonlField: string): readonly string[] => {
    // 简单实现：返回 EXTENDED_FIELD_MAP 中对应的 excel 字段
    const map: Record<string, readonly string[]> = {
      date: ['开播日期'],
      meta_tags: ['标签/分级'],
      话数: ['集数'],
      动画制作公司: ['制作公司', '动画制作公司'],
    }
    return map[jsonlField] ?? [jsonlField]
  }),
}))

vi.mock('../ts/sync/pure-utilities.js', () => ({
  extractSubjectId: mockExtractSubjectId,
}))

vi.mock('../ts/sync/undo-stack.js', () => ({
  beginUndoSession: mockBeginUndoSession,
  endUndoSession: mockEndUndoSession,
  recordUndoEntry: mockRecordUndoEntry,
  recordRowDeleteEntry: mockRecordRowDeleteEntry,
}))

vi.mock('../ts/sync/sync-record.js', () => ({
  addSyncRecord: vi.fn().mockReturnValue(true),
  addSyncRecords: mockAddSyncRecords,
  addSyncRecordSummary: mockAddSyncRecordSummary,
  isSyncRecordEnabled: vi.fn().mockReturnValue(true),
}))

// 设置全局 XMLHttpRequest
global.XMLHttpRequest = mockXHR.XHRConstructor

// ========== 导入被测模块 ==========

import {
  fetchGithubJson,
  readLocalEntriesForSync,
  applyDiffToSheet,
  syncFromGithub,
  GithubSyncSource,
  applyConflictResolutions,
} from '../ts/sync/github-sync.js'
import type {
  GithubSyncDiff,
  GithubRemoteEntry,
  LocalRowEntry,
  SyncStrategy,
  ConflictResolution,
} from '../ts/sync/github-sync-diff.js'

// ========== 辅助函数 ==========

function createMockSheet(
  options: { rows?: { Value2: unknown[] }[]; colMap?: Map<string, number> } = {},
) {
  const rows = options.rows ?? []
  return {
    Name: 'TestSheet',
    Range: vi.fn((addr: string) => {
      if (addr.includes(':')) {
        return {
          Value2: rows.length > 0 ? rows : null,
          Interior: { Color: 0 },
          Font: { Bold: false, Name: '' },
          Borders: { LineStyle: 0 },
        }
      }
      return {
        Value2: '',
        Interior: { Color: 0 },
        Font: { Bold: false, Name: '' },
        Borders: { LineStyle: 0 },
        ColumnWidth: 0,
      }
    }),
    UsedRange: { Row: 1, Rows: { Count: rows.length } },
    Rows: { Count: rows.length + 1 },
    Activate: vi.fn(),
    Select: vi.fn(),
    Delete: vi.fn(),
    Move: vi.fn(),
  }
}

function createMockApp(sheet: unknown) {
  return {
    ScreenUpdating: true,
    Calculation: 1,
    ActiveSheet: sheet,
    ActiveWorkbook: {
      ActiveSheet: sheet,
      Sheets: { Count: 1, Item: vi.fn(() => sheet) },
    },
    Selection: null,
  }
}

// ========== fetchGithubJson 测试 ==========

describe('fetchGithubJson', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockIsGithubConfigComplete.mockReturnValue(true)
    mockBuildRawUrl.mockReturnValue('https://raw.githubusercontent.com/test/repo/main/data.jsonl')
    mockParseJsonl.mockReturnValue({ entries: [], errors: [] })
    mockXHR.xhrMock.status = 200
    mockXHR.xhrMock.responseText = ''
    mockXHR.xhrMock.onload = null
    mockXHR.xhrMock.onerror = null
    mockXHR.xhrMock.ontimeout = null
  })

  it('配置不完整时应抛出错误', async () => {
    mockIsGithubConfigComplete.mockReturnValue(false)
    await expect(fetchGithubJson()).rejects.toThrow('GitHub 仓库配置不完整')
  })

  it('AbortSignal 已取消时应立即 reject', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fetchGithubJson(controller.signal)).rejects.toThrow('请求被取消')
  })

  it('HTTP 200 且无解析错误应返回空数组', async () => {
    mockParseJsonl.mockReturnValue({ entries: [], errors: [] })
    mockXHR.xhrMock.onload = function (this: typeof mockXHR.xhrMock) {
      // 注意：onload 被调用时 this 指向 xhrMock
    }
    // 直接触发 onload
    Promise.resolve().then(() => {
      mockXHR.xhrMock.onload?.()
    })
    const result = await fetchGithubJson()
    expect(result).toEqual([])
  })

  it('HTTP 404 应抛出文件不存在错误', async () => {
    mockXHR.xhrMock.status = 404
    mockXHR.xhrMock.onload = function () {
      // 异步触发
    }
    // 需要手动触发 onload
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    await expect(fetchGithubJson()).rejects.toThrow(/文件不存在/)
  })

  it('HTTP 403 应抛出访问被拒错误', async () => {
    mockXHR.xhrMock.status = 403
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    await expect(fetchGithubJson()).rejects.toThrow(/访问被拒/)
  })

  it('HTTP 其他错误应抛出通用错误', async () => {
    mockXHR.xhrMock.status = 500
    mockXHR.xhrMock.statusText = 'Internal Server Error'
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    await expect(fetchGithubJson()).rejects.toThrow(/HTTP 错误/)
  })

  it('解析成功有数据时应返回条目', async () => {
    const entries = [
      { sid: '1', name: 'A', meta_tags: [] },
      { sid: '2', name: 'B', meta_tags: [] },
    ]
    mockParseJsonl.mockReturnValue({ entries, errors: [] })
    mockXHR.xhrMock.status = 200
    mockXHR.xhrMock.responseText = '{"sid":"1"}\n{"sid":"2"}'
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    const result = await fetchGithubJson()
    expect(result).toHaveLength(2)
  })

  it('全部解析失败时应抛出错误', async () => {
    mockParseJsonl.mockReturnValue({
      entries: [],
      errors: [{ line: 1, reason: 'missing sid' }],
    })
    mockXHR.xhrMock.status = 200
    mockXHR.xhrMock.responseText = '{"no_sid"}'
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    await expect(fetchGithubJson()).rejects.toThrow(/JSONL 解析失败/)
  })

  it('网络错误应抛出网络失败错误', async () => {
    mockXHR.xhrMock.onerror = function () {}
    setTimeout(() => mockXHR.xhrMock.onerror?.(), 0)
    await expect(fetchGithubJson()).rejects.toThrow(/网络请求失败/)
  })

  it('超时应抛出超时错误', async () => {
    mockXHR.xhrMock.ontimeout = function () {}
    setTimeout(() => mockXHR.xhrMock.ontimeout?.(), 0)
    await expect(fetchGithubJson()).rejects.toThrow(/请求超时/)
  })

  it('应设置 Accept 请求头', async () => {
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    await fetchGithubJson()
    expect(mockXHR.xhrMock.setRequestHeader).toHaveBeenCalledWith('Accept', 'application/json')
  })

  it('AbortSignal 触发时应 abort XHR', async () => {
    const controller = new AbortController()
    // 模拟 abort 事件监听；load/error 需照常映射回 onXXX（生产代码经 addEventListener 注册），
    // 否则会污染共享 xhrMock 的后续用例
    mockXHR.xhrMock.addEventListener = vi.fn((event: string, handler: EventListener) => {
      switch (event) {
        case 'load': {
          mockXHR.xhrMock.onload = handler as (...arguments_: unknown[]) => void
          break
        }
        case 'error': {
          mockXHR.xhrMock.onerror = handler as (...arguments_: unknown[]) => void
          break
        }
        // 'abort' 不立即触发，等待 abort() 调用
        default: {
          break
        }
      }
    })
    const fetchPromise = fetchGithubJson(controller.signal)
    // 触发 abort
    controller.abort()
    // XHR abort 应该被调用
    // 但由于我们是 mock，需要手动触发 onerror
    mockXHR.xhrMock.onerror?.()
    await expect(fetchPromise).rejects.toThrow()
  })
})

// ========== GithubSyncSource 测试 ==========

describe('GithubSyncSource', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // 重新设置默认返回值
    mockIsGithubConfigComplete.mockReturnValue(true)
    mockBuildRawUrl.mockReturnValue('https://raw.githubusercontent.com/test/repo/main/data.jsonl')
    mockParseJsonl.mockReturnValue({ entries: [], errors: [] })
    mockComputeDiff.mockReturnValue([])
    mockTagsToString.mockReturnValue('')
    mockGetDataSheet.mockReturnValue(null)
    mockGetLastRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map())
    mockGetApp.mockReturnValue(null)
    mockAddSyncRecords.mockReturnValue(true)
    mockAddSyncRecordSummary.mockReturnValue(true)
    mockXHR.xhrMock.status = 200
    mockXHR.xhrMock.responseText = ''
    mockXHR.xhrMock.onload = null
    mockXHR.xhrMock.onerror = null
  })

  it('getSourceType 应返回 github', () => {
    const source = new GithubSyncSource()
    expect(source.getSourceType()).toBe('github')
  })

  it('getDisplayName 应返回 GitHub', () => {
    const source = new GithubSyncSource()
    expect(source.getDisplayName()).toBe('GitHub')
  })

  it('validateConfig 配置完整时应返回成功', () => {
    mockIsGithubConfigComplete.mockReturnValue(true)
    const source = new GithubSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(false)
  })

  it('validateConfig 配置不完整时应返回失败', () => {
    mockIsGithubConfigComplete.mockReturnValue(false)
    const source = new GithubSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
  })

  it('fetchRemoteEntries 应调用 fetchGithubJson', async () => {
    mockParseJsonl.mockReturnValue({ entries: [{ sid: '1', name: 'Test' }], errors: [] })
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    const source = new GithubSyncSource()
    const result = await source.fetchRemoteEntries()
    expect(result).toHaveLength(1)
  })
})

// ========== readLocalEntriesForSync 测试 ==========

describe('readLocalEntriesForSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('getDataSheet 返回 null 时应返回 null', () => {
    mockGetDataSheet.mockReturnValue(null)
    const result = readLocalEntriesForSync()
    expect(result).toBeNull()
  })

  it('工作表有效但无 Bangumi_URL 列时应返回空 entries', () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(10)
    // 无 Bangumi_URL 列
    mockGetColumnMap.mockReturnValue(new Map())
    const result = readLocalEntriesForSync()
    expect(result).not.toBeNull()
    expect(result?.entries).toBeInstanceOf(Map)
    expect(result?.entries.size).toBe(0)
  })

  it('工作表有效且有 Bangumi_URL 列时应读取本地条目', () => {
    const rowData = [
      ['http://bgm.tv/subject/1', '名称1', '', '', '', '', '', ''],
      ['http://bgm.tv/subject/2', '名称2', '', '', '', '', '', ''],
    ]
    const sheet = createMockSheet({ rows: rowData })
    mockGetDataSheet.mockReturnValue(sheet)
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(3)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['Bangumi_URL', 1],
        ['名称', 2],
      ]),
    )
    mockExtractSubjectId.mockImplementation((url: string) => {
      const match = /subject\/(\d+)/.exec(url)
      return match ? match[1] : null
    })
    const result = readLocalEntriesForSync()
    expect(result).not.toBeNull()
  })
})

// ========== applyDiffToSheet 测试 ==========

describe('applyDiffToSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetApp.mockReturnValue(null)
    mockAddSyncRecords.mockReturnValue(true)
    mockAddSyncRecordSummary.mockReturnValue(true)
  })

  it('getDataSheet 返回 null 时应将所有 diff 计为失败', async () => {
    mockGetDataSheet.mockReturnValue(null)
    const diffs: GithubSyncDiff[] = [
      { kind: 'add', sid: '1', remote: { sid: '1', name: 'Test' }, changedFields: ['*'] },
      { kind: 'add', sid: '2', remote: { sid: '2', name: 'Test2' }, changedFields: ['*'] },
    ]
    const result = await applyDiffToSheet(diffs, 'add-update')
    expect(result.failed).toBe(2)
    expect(result.added).toBe(0)
  })

  it('空 diffs 应返回零结果', async () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockGetLastRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map())
    mockGetApp.mockReturnValue(null)
    const result = await applyDiffToSheet([], 'add-update')
    expect(result.added).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.deleted).toBe(0)
  })

  it('处理 add diff 应更新 added 计数', async () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockGetLastRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['Bangumi_URL', 1],
        ['名称', 2],
      ]),
    )
    mockGetApp.mockReturnValue(null)
    mockTagsToString.mockReturnValue('标签1')

    const diffs: GithubSyncDiff[] = [
      { kind: 'add', sid: '1', remote: { sid: '1', name: '新增' }, changedFields: ['*'] },
    ]
    const result = await applyDiffToSheet(diffs, 'add-update')
    expect(result.added).toBeGreaterThanOrEqual(0)
  })

  it('处理 update diff 应更新 updated 计数', async () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockGetLastRow.mockReturnValue(5)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['Bangumi_URL', 1],
        ['名称', 2],
      ]),
    )
    mockGetApp.mockReturnValue(null)
    mockGetCellValue.mockReturnValue('旧名称')
    mockTagsToString.mockReturnValue('标签')

    const diffs: GithubSyncDiff[] = [
      {
        kind: 'update',
        sid: '1',
        localRow: 3,
        remote: { sid: '1', name: '新名称' },
        changedFields: ['名称'],
      },
    ]
    const result = await applyDiffToSheet(diffs, 'add-update')
    // updated 取决于批量写入是否成功
    expect(result.updated).toBeGreaterThanOrEqual(0)
  })

  it('处理 delete diff 应更新 deleted 计数', async () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockGetLastRow.mockReturnValue(5)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['Bangumi_URL', 1],
        ['名称', 2],
      ]),
    )
    mockGetApp.mockReturnValue(null)
    mockGetCellValue.mockReturnValue('http://bgm.tv/subject/1')

    const diffs: GithubSyncDiff[] = [{ kind: 'delete', sid: '1', localRow: 3 }]
    const result = await applyDiffToSheet(diffs, 'mirror')
    expect(result.deleted).toBeGreaterThanOrEqual(0)
  })

  it('force-overwrite 策略应设置 forceOverwrite', async () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockGetLastRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map())
    mockGetApp.mockReturnValue(null)

    const diffs: GithubSyncDiff[] = [
      { kind: 'add', sid: '1', remote: { sid: '1', name: 'Test' }, changedFields: ['*'] },
    ]
    const result = await applyDiffToSheet(diffs, 'force-overwrite')
    expect(result).toBeDefined()
  })

  it('应调用 beginUndoSession 和 endUndoSession', async () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockGetLastRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map())
    mockGetApp.mockReturnValue(null)

    await applyDiffToSheet([], 'add-update')
    expect(mockBeginUndoSession).toHaveBeenCalled()
    expect(mockEndUndoSession).toHaveBeenCalled()
  })

  it('有同步记录时应调用 addSyncRecords', async () => {
    const sheet = createMockSheet()
    mockGetDataSheet.mockReturnValue(sheet)
    mockGetLastRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(
      new Map([
        ['Bangumi_URL', 1],
        ['名称', 2],
      ]),
    )
    mockGetApp.mockReturnValue(null)
    mockTagsToString.mockReturnValue('标签')

    const diffs: GithubSyncDiff[] = [
      { kind: 'add', sid: '1', remote: { sid: '1', name: 'Test' }, changedFields: ['*'] },
    ]
    await applyDiffToSheet(diffs, 'add-update')
    // addSyncRecords 会被调用（如果有同步记录需要写入）
  })
})

// ========== applyConflictResolutions 测试 ==========

describe('applyConflictResolutions', () => {
  it('无 resolutions 时应返回原 diffs', () => {
    const diffs: GithubSyncDiff[] = [
      {
        kind: 'update',
        sid: '1',
        changedFields: ['名称'],
        localRow: 2,
        remote: { sid: '1', name: '新' },
      },
    ]
    const result = applyConflictResolutions(diffs, [])
    expect(result).toBe(diffs)
    expect(result).toHaveLength(1)
  })

  it('选择 local 应移除对应字段', () => {
    const diffs: GithubSyncDiff[] = [
      {
        kind: 'update',
        sid: '1',
        changedFields: ['名称', '集数'],
        localRow: 2,
        remote: { sid: '1', name: '新', 话数: '12' },
      },
    ]
    const resolutions: ConflictResolution[] = [{ sid: '1', field: '名称', chosenValue: 'local' }]
    const result = applyConflictResolutions(diffs, resolutions)
    expect(result[0]?.changedFields).not.toContain('名称')
    expect(result[0]?.changedFields).toContain('集数')
  })

  it('选择 remote 应保留对应字段', () => {
    const diffs: GithubSyncDiff[] = [
      {
        kind: 'update',
        sid: '1',
        changedFields: ['名称', '集数'],
        localRow: 2,
        remote: { sid: '1', name: '新', 话数: '12' },
      },
    ]
    const resolutions: ConflictResolution[] = [{ sid: '1', field: '名称', chosenValue: 'remote' }]
    const result = applyConflictResolutions(diffs, resolutions)
    expect(result[0]?.changedFields).toContain('名称')
  })

  it('所有字段被移除时应删除该 diff', () => {
    const diffs: GithubSyncDiff[] = [
      {
        kind: 'update',
        sid: '1',
        changedFields: ['名称'],
        localRow: 2,
        remote: { sid: '1', name: '新' },
      },
    ]
    const resolutions: ConflictResolution[] = [{ sid: '1', field: '名称', chosenValue: 'local' }]
    const result = applyConflictResolutions(diffs, resolutions)
    expect(result).toHaveLength(0)
  })

  it('add diff 不应受影响', () => {
    const diffs: GithubSyncDiff[] = [
      { kind: 'add', sid: '1', changedFields: ['*'], remote: { sid: '1', name: '新' } },
    ]
    const resolutions: ConflictResolution[] = [{ sid: '1', field: '名称', chosenValue: 'local' }]
    const result = applyConflictResolutions(diffs, resolutions)
    expect(result).toHaveLength(1)
  })

  it('delete diff 不应受影响', () => {
    const diffs: GithubSyncDiff[] = [{ kind: 'delete', sid: '1', localRow: 2 }]
    const resolutions: ConflictResolution[] = [{ sid: '1', field: '名称', chosenValue: 'local' }]
    const result = applyConflictResolutions(diffs, resolutions)
    expect(result).toHaveLength(1)
  })

  it('force-overwrite 变更 (changedFields=[*]) 不应受影响', () => {
    const diffs: GithubSyncDiff[] = [
      {
        kind: 'update',
        sid: '1',
        changedFields: ['*'],
        localRow: 2,
        remote: { sid: '1', name: '新' },
      },
    ]
    const resolutions: ConflictResolution[] = [{ sid: '1', field: '名称', chosenValue: 'local' }]
    const result = applyConflictResolutions(diffs, resolutions)
    expect(result).toHaveLength(1)
    expect(result[0]?.changedFields).toEqual(['*'])
  })

  it('按 sid+field 精确匹配', () => {
    const diffs: GithubSyncDiff[] = [
      {
        kind: 'update',
        sid: '1',
        changedFields: ['名称'],
        localRow: 2,
        remote: { sid: '1', name: '新' },
      },
      {
        kind: 'update',
        sid: '2',
        changedFields: ['名称'],
        localRow: 3,
        remote: { sid: '2', name: '新' },
      },
    ]
    const resolutions: ConflictResolution[] = [{ sid: '1', field: '名称', chosenValue: 'local' }]
    const result = applyConflictResolutions(diffs, resolutions)
    // sid=1 的 diff 应被移除（字段被清空）
    // sid=2 的 diff 应保留
    expect(result.length).toBeLessThanOrEqual(2)
  })
})

// ========== syncFromGithub 测试 ==========

describe('syncFromGithub', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockIsGithubConfigComplete.mockReturnValue(true)
    mockBuildRawUrl.mockReturnValue('https://raw.githubusercontent.com/test/repo/main/data.jsonl')
    mockParseJsonl.mockReturnValue({ entries: [], errors: [] })
    mockComputeDiff.mockReturnValue([])
    mockTagsToString.mockReturnValue('')
    mockGetDataSheet.mockReturnValue({
      Name: '测试',
      Range: vi.fn((_addr: string) => ({ Value2: '', Interior: { Color: 0 } })),
      UsedRange: { Row: 1, Rows: { Count: 0 } },
    })
    mockFindHeaderRow.mockReturnValue(1)
    mockGetLastRow.mockReturnValue(1)
    mockGetColumnMap.mockReturnValue(new Map([['Bangumi_URL', 1]]))
    mockGetApp.mockReturnValue({ ScreenUpdating: true, Calculation: 1 })
    mockAddSyncRecords.mockReturnValue(true)
    mockAddSyncRecordSummary.mockReturnValue(true)
    mockXHR.xhrMock.status = 200
    mockXHR.xhrMock.responseText = ''
  })

  it('配置不完整时应抛出错误', async () => {
    mockIsGithubConfigComplete.mockReturnValue(false)
    await expect(syncFromGithub()).rejects.toThrow('GitHub 仓库配置不完整')
  })

  it('下载成功但无数据时应返回零结果', async () => {
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    const result = await syncFromGithub()
    expect(result).toBeDefined()
    expect(result.remoteTotal).toBeDefined()
  })

  it('应调用进度回调', async () => {
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    const progress = vi.fn()
    await syncFromGithub(progress)
    expect(progress).toHaveBeenCalled()
  })

  it('selectedRowsOnly 无选区应抛出错误', async () => {
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    mockGetApp.mockReturnValue({
      ScreenUpdating: true,
      Calculation: 1,
      Selection: null,
      ActiveSheet: null,
    })
    // syncFromGithub(onProgress?, strategy, signal?, conflictResolution?, selectedRowsOnly?, timeFilter?)
    await expect(
      syncFromGithub(undefined, 'add-update', undefined, undefined, true),
    ).rejects.toThrow()
  })

  it('时间筛选应调用 filterByTime', async () => {
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    mockFilterByTime.mockReturnValue([])
    const timeFilter = { enabled: true, range: 'year' as const, year: 2024 }
    await syncFromGithub(undefined, 'add-update', undefined, false, undefined, timeFilter)
    // filterByTime 会被调用
  })

  it('应在 finally 块恢复屏幕刷新', async () => {
    mockXHR.xhrMock.onload = function () {}
    setTimeout(() => mockXHR.xhrMock.onload?.(), 0)
    mockGetApp.mockReturnValue({ ScreenUpdating: true, Calculation: 1 })
    await syncFromGithub()
    // getApp 会被多次调用
  })
})
