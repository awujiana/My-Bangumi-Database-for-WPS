// @vitest-environment jsdom
/**
 * @fileoverview `ts/services/ribbon-service.ts`（Ribbon 入口服务）单元测试。
 *
 * 依赖策略：ribbon-service 的**编排逻辑**是本文件的被测对象，而它大量依赖
 * 「真实读取器」（`readRangeValues` / `getCellValue` / `getCell`）与真实纯函数
 * （`trim` / `extractSubjectId` / `mapWatchStatus` / `calcFingerprint`）。
 * 因此这里做**部分 mock**：只替换宿主与对话框（`getApp` / `bgmLog` / `BGM` /
 * `wpsMessageBox` / 工作表定位 / AutoFilter 探测器），其余保持真实现 —— 这样断言
 * 打到的是「真读取器 + 真纯函数」的行为，不是 mock 的行为。
 *
 * ⚠️ **不能 mock `../ts/index.js` 本身**：`ts/index.ts` 第 525 行会把
 * `ribbon-service.ts` 再 re-export 回去，形成 `index.ts ↔ ribbon-service.ts` 循环。
 * 一旦在 barrel 上 `vi.mock(async (importOriginal) => ...)`，工厂内 `importOriginal()`
 * 会加载真 barrel → 真 barrel 又去加载 ribbon-service → ribbon-service 回头 import barrel
 * （此刻 mock 工厂尚未 resolve）→ 循环死锁，vitest 只能回退到**真实现**：表现就是
 * `getApp` / `wpsMessageBox` 的 mock 调用次数恒为 0、`fetchAllUserCollections` 走真实网络
 * 把用例拖到 5s 超时。改用**逐层 mock 叶子模块**（`tools/util/index` / `tools/wps` /
 * `sync/exceltobangumi` / `sync/scraping` / `sync/github-config`）即可绕开循环，
 * 且 barrel 保持真实、与 import 语句顺序无关。
 *
 * `getSyncPreview` 用**假工作表**（`FakeSheet`）提供 `Range(address).Value2`，
 * 于是范围批量读、单格读、序列号底色判定三条真实路径都能被驱动。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubRemoteEntry, LocalRowEntry, WpsWorksheet } from '../ts/index.js'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  handleError: vi.fn(),
  notifyTokenUpdated: vi.fn(),
  setUserId: vi.fn(),
  enterRunningState: vi.fn(),
  exitRunningState: vi.fn(),
  wpsMessageBox: vi.fn(),
  loadBgToken: vi.fn(),
  storeBgToken: vi.fn(),
  getDataSheet: vi.fn(),
  findHeaderRow: vi.fn(),
  getLastRow: vi.fn(),
  getColumnMap: vi.fn(),
  getFilterStatus: vi.fn(),
  syncToBangumiAsync: vi.fn(),
  getBgmUserId: vi.fn(),
  setBgmUserId: vi.fn(),
  setBgmUsername: vi.fn(),
  testTokenValidityForRibbon: vi.fn(),
  fetchBgmMe: vi.fn(),
  fetchAllUserCollections: vi.fn(),
  isGithubConfigComplete: vi.fn(),
  showBangumiPanel: vi.fn(),
  getApp: vi.fn((): unknown => null),
}))

const syncState = vi.hoisted(() => ({ isRunning: false }))

// ---- 宿主层：`ts/tools/util/index.ts`（getApp / bgmLog / BGM / Token / 工作表定位）----
vi.mock('../ts/tools/util/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/tools/util/index.js')>()
  return {
    ...actual,
    getApp: m.getApp,
    bgmLog: m.bgmLog,
    BGM: {
      ...(actual.BGM as unknown as Record<string, unknown>),
      handleError: m.handleError,
      notifyTokenUpdated: m.notifyTokenUpdated,
      setUserId: m.setUserId,
      sync: {
        get isRunning() {
          return syncState.isRunning
        },
        enterRunningState: m.enterRunningState,
        exitRunningState: m.exitRunningState,
      },
    },
    loadBgToken: m.loadBgToken,
    fetchBgmMe: m.fetchBgmMe,
    storeBgToken: m.storeBgToken,
    getDataSheet: m.getDataSheet,
    findHeaderRow: m.findHeaderRow,
    getLastRow: m.getLastRow,
    getColumnMap: m.getColumnMap,
    _getBgmUserId: m.getBgmUserId,
    _setBgmUserId: m.setBgmUserId,
    _setBgmUsername: m.setBgmUsername,
    showBangumiPanel: m.showBangumiPanel,
  }
})

// ---- 对话框层 ----
vi.mock('../ts/tools/wps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/tools/wps.js')>()
  return { ...actual, wpsMessageBox: m.wpsMessageBox }
})

// ---- 同步引擎层：AutoFilter 探测器是宿主对象，假工作表无法提供 → 用可控桩替代 ----
vi.mock('../ts/sync/exceltobangumi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/sync/exceltobangumi.js')>()
  return {
    ...actual,
    getFilterStatus: m.getFilterStatus,
    SyncToBangumiAsync: m.syncToBangumiAsync,
    testTokenValidityForRibbon: m.testTokenValidityForRibbon,
  }
})

// ---- 收藏快照抓取（真实实现会发网络请求）----
vi.mock('../ts/sync/scraping.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/sync/scraping.js')>()
  return { ...actual, fetchAllUserCollections: m.fetchAllUserCollections }
})

// ---- GitHub 配置探测 ----
vi.mock('../ts/sync/github-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/sync/github-config.js')>()
  return { ...actual, isGithubConfigComplete: m.isGithubConfigComplete }
})

vi.mock('../ts/sync/undo-stack.js', () => ({
  undoLastSync: vi.fn(),
  getLastSessionDescription: vi.fn(() => null),
}))

import { BGM_COLOR, calcFingerprint } from '../ts/index.js'
import {
  copyTokenForRibbon,
  detectConflicts,
  detectGithubConflicts,
  executeUndoLastSync,
  getSyncPreview,
  openCollectionForRibbon,
  setTokenForRibbon,
  setUserIdForRibbon,
  syncFromGithubForRibbon,
  syncWithConfirmation,
  testTokenForRibbon,
  undoLastSyncForRibbon,
} from '../ts/services/ribbon-service.js'
import { getLastSessionDescription, undoLastSync } from '../ts/sync/undo-stack.js'

// ========== 假工作表 ==========

/**
 * 假工作表：支持被测代码真正用到的读取面
 * —— 范围读（`A2:I10` → 二维 `Value2`）、单格读、单格底色（已上传判定）。
 * 地址解析自己做，才能让「真实 readRangeValues」跑在可控数据上。
 */
class FakeSheet {
  /** key: `${row}:${column}` */
  private readonly cells = new Map<string, string>()

  /** 行号 → 序列号列底色（用于「已上传」判定） */
  private readonly rowColors = new Map<number, number>()

  set(row: number, column: number, value: string): this {
    this.cells.set(`${String(row)}:${String(column)}`, value)
    return this
  }

  markUploaded(row: number, color: number = BGM_COLOR.SUCCESS): this {
    this.rowColors.set(row, color)
    return this
  }

  Range(address: string): { Value2?: unknown; Interior?: { Color: number } } {
    const rangeMatch = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address)
    if (rangeMatch) {
      const startColumn = columnToNumber(rangeMatch[1] ?? 'A')
      const startRow = Number(rangeMatch[2])
      const endColumn = columnToNumber(rangeMatch[3] ?? 'A')
      const endRow = Number(rangeMatch[4])
      const matrix: string[][] = []
      for (let row = startRow; row <= endRow; row += 1) {
        const rowValues: string[] = []
        for (let column = startColumn; column <= endColumn; column += 1) {
          rowValues.push(this.cells.get(`${String(row)}:${String(column)}`) ?? '')
        }
        matrix.push(rowValues)
      }
      return { Value2: matrix }
    }

    const cellMatch = /^([A-Z]+)(\d+)$/.exec(address)
    if (!cellMatch) return {}
    const column = columnToNumber(cellMatch[1] ?? 'A')
    const row = Number(cellMatch[2])
    const color = this.rowColors.get(row)
    return {
      Value2: this.cells.get(`${String(row)}:${String(column)}`) ?? '',
      ...(color !== undefined && { Interior: { Color: color } }),
    }
  }
}

function columnToNumber(letters: string): number {
  let result = 0
  for (const char of letters) {
    result = result * 26 + ((char.codePointAt(0) ?? 64) - 64)
  }
  return result
}

const asSheet = (sheet: FakeSheet): WpsWorksheet => sheet as unknown as WpsWorksheet

// ========== 常用列映射 ==========

const COLUMN_NAME = 2
const COLUMN_STATUS = 3
const COLUMN_RATE = 4
const COLUMN_TAGS = 5
const COLUMN_EPISODES = 6
const COLUMN_SEQ = 7

function buildColumnMap(): Map<string, number> {
  return new Map([
    ['Bangumi_URL', 1],
    ['名称', COLUMN_NAME],
    ['是否看完', COLUMN_STATUS],
    ['打分', COLUMN_RATE],
    ['标签/分级', COLUMN_TAGS],
    ['集数', COLUMN_EPISODES],
    ['序列号', COLUMN_SEQ],
  ])
}

const HEADER_ROW = 1

/** 造一行完整数据（URL / 名称 / 状态 / 打分） */
function fillRow(
  sheet: FakeSheet,
  row: number,
  values: { url?: string; name?: string; status?: string; rate?: string },
): void {
  if (values.url !== undefined) sheet.set(row, 1, values.url)
  if (values.name !== undefined) sheet.set(row, COLUMN_NAME, values.name)
  if (values.status !== undefined) sheet.set(row, COLUMN_STATUS, values.status)
  if (values.rate !== undefined) sheet.set(row, COLUMN_RATE, values.rate)
}

/** 单个已上传行的标准指纹（与实现相同的字段拼装顺序） */
function fingerprintOf(name: string, type: number, rate: string): string {
  return calcFingerprint([name, String(type), rate, '', '', '', '', ''])
}

beforeEach(() => {
  vi.clearAllMocks()
  syncState.isRunning = false
  m.loadBgToken.mockReturnValue(null)
  m.getApp.mockReturnValue(null)
  m.getDataSheet.mockReturnValue(null)
  m.findHeaderRow.mockReturnValue(1)
  m.getLastRow.mockReturnValue(1)
  m.getColumnMap.mockReturnValue(buildColumnMap())
  m.getFilterStatus.mockReturnValue({ hasFilter: false, visibleRows: [] })
  m.enterRunningState.mockReturnValue(true)
  m.wpsMessageBox.mockResolvedValue(6)
  m.isGithubConfigComplete.mockReturnValue(true)
  m.fetchAllUserCollections.mockResolvedValue([])
  m.syncToBangumiAsync.mockResolvedValue({ success: 1, fail: 0, skip: 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ========== 用例共用工厂（模块作用域，便于复用且避免函数嵌套告警） ==========

/** 远程条目工厂（`detectGithubConflicts` 用例共用） */
const remoteEntry = (over: Partial<GithubRemoteEntry>): GithubRemoteEntry => ({
  subjectId: '100',
  ...over,
})

/** 本地行条目工厂（`detectGithubConflicts` 用例共用） */
const localEntry = (fields: Record<string, string>, row = 2): LocalRowEntry => ({
  subjectId: '100',
  row,
  fields,
})

/** Bangumi 收藏条目工厂（`detectConflicts` 用例共用） */
const collection = (over: {
  subject_id: number
  type: number
  rate?: number
  tags?: string[]
  comment?: string
  subjectName?: string
}) => ({
  subject_id: over.subject_id,
  type: over.type,
  ...(over.rate !== undefined && { rate: over.rate }),
  tags: over.tags ?? [],
  comment: over.comment ?? '',
  subject: { name: over.subjectName ?? '' },
})

/** 一张「有 URL / 名称 / 状态」的标准工作表（`syncWithConfirmation` 用例共用） */
const goodSheet = (): FakeSheet => {
  const sheet = new FakeSheet()
  fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
  return sheet
}

/** 覆盖 `document.execCommand`（`copyTokenForRibbon` 用例共用） */
const installExecCommand = (result: boolean | (() => never)): void => {
  Reflect.set(document, 'execCommand', typeof result === 'function' ? result : () => result)
}

// ========== detectGithubConflicts（纯函数） ==========

describe('ribbon-service · detectGithubConflicts', () => {
  it('远程无 SID → 跳过该条目', () => {
    const conflicts = detectGithubConflicts(
      [remoteEntry({ subjectId: '', name: '动画A' })],
      new Map([['100', localEntry({ 名称: '动画A' })]]),
    )

    expect(conflicts).toEqual([])
  })

  it('本地无同 SID 行 → 不产生冲突（新增条目交给同步流程）', () => {
    const conflicts = detectGithubConflicts(
      [remoteEntry({ name: '动画A' })],
      new Map([['999', localEntry({ 名称: '动画A' })]]),
    )

    expect(conflicts).toEqual([])
  })

  it('远程字段为空 → 不视为冲突（避免空值覆盖本地）', () => {
    const conflicts = detectGithubConflicts(
      // 远程「话数」缺省（exactOptionalPropertyTypes 下缺键即 undefined，等价语义）
      [remoteEntry({ name: '', meta_tags: [] })],
      new Map([['100', localEntry({ 名称: '本地名称' })]]),
    )

    expect(conflicts).toEqual([])
  })

  it('同一字段取值不同 → 记录行号、字段名与两侧取值', () => {
    const conflicts = detectGithubConflicts(
      [remoteEntry({ name: '远程名称' })],
      new Map([['100', localEntry({ 名称: '本地名称' }, 7)]]),
    )

    expect(conflicts).toEqual([
      {
        subjectId: '100',
        field: '名称',
        localValue: '本地名称',
        remoteValue: '远程名称',
        localRow: 7,
      },
    ])
  })

  it('本地字段缺失时按空串比较（远程非空即冲突）', () => {
    const conflicts = detectGithubConflicts(
      [remoteEntry({ name: '远程名称' })],
      new Map([['100', localEntry({}, 3)]]),
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.localValue).toBe('')
  })

  it('标签数组以 | 拼接后比较', () => {
    const conflicts = detectGithubConflicts(
      [remoteEntry({ meta_tags: ['TV', '原创'] })],
      new Map([['100', localEntry({ '标签/分级': 'TV|漫改' }, 3)]]),
    )

    expect(conflicts).toEqual([
      {
        subjectId: '100',
        field: '标签/分级',
        localValue: 'TV|漫改',
        remoteValue: 'TV|原创',
        localRow: 3,
      },
    ])
  })

  it('meta_tags 不是数组 → 视为无远程值', () => {
    const conflicts = detectGithubConflicts(
      [remoteEntry({ meta_tags: 'TV' as unknown as string[] })],
      new Map([['100', localEntry({ '标签/分级': 'TV' })]]),
    )

    expect(conflicts).toEqual([])
  })

  it('集数一致 → 不冲突；多字段同时冲突 → 按比对表顺序输出', () => {
    const conflicts = detectGithubConflicts(
      [remoteEntry({ name: '远程名称', meta_tags: ['TV'], 话数: '12' })],
      new Map([['100', localEntry({ 名称: '本地名称', '标签/分级': 'TV', 集数: '12' }, 5)]]),
    )

    expect(conflicts.map((c) => c.field)).toEqual(['名称'])
  })
})

// ========== getSyncPreview（真实读取器 + 假工作表） ==========

describe('ribbon-service · getSyncPreview', () => {
  it('空 URL / 无 SID 计入 noUrl，且不计入 valid', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: '', name: '动画A', status: '看过' })
    fillRow(sheet, 3, { url: '不是网址', name: '动画B', status: '看过' })
    m.getLastRow.mockReturnValue(3)

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 3, HEADER_ROW)

    expect(preview).toMatchObject({ total: 2, valid: 0, noUrl: 2 })
  })

  it('有效行且未上传 → 计入 valid 与待同步', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    m.getLastRow.mockReturnValue(2)

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW)

    expect(preview).toMatchObject({ total: 1, valid: 1, plannedSyncCount: 1, noUrl: 0 })
  })

  it('已上传行（序列号底色命中）非增量模式 → 计入已上传并跳过，不再计入待同步', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    sheet.markUploaded(2)
    m.getLastRow.mockReturnValue(2)

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW)

    expect(preview).toMatchObject({
      valid: 1,
      alreadyUploaded: 1,
      plannedSyncCount: 0,
      incrementalSkipped: 0,
    })
  })

  it('序列号底色不在「已上传」色域内 → 仍视为待同步', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    sheet.markUploaded(2, 0x00_00_00)
    m.getLastRow.mockReturnValue(2)

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW)

    expect(preview).toMatchObject({ alreadyUploaded: 0, plannedSyncCount: 1 })
  })

  it('观看状态为空 → 计入 emptyStatus（不待同步也不跳过）', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '' })
    m.getLastRow.mockReturnValue(2)

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW)

    expect(preview).toMatchObject({ valid: 1, emptyStatus: 1, plannedSyncCount: 0 })
  })

  it('状态映射为 0（忽略）→ 计入状态跳过', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '忽略' })
    m.getLastRow.mockReturnValue(2)

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW)

    expect(preview).toMatchObject({ plannedSkipCount: 1, plannedSyncCount: 0 })
  })

  it('增量模式 + 已上传 + 指纹一致 → 计入增量跳过', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, {
      url: 'https://bgm.tv/subject/100',
      name: '动画A',
      status: '看过',
      rate: '8',
    })
    sheet.markUploaded(2)
    m.getLastRow.mockReturnValue(2)
    const fingerprintMap = new Map([['100', fingerprintOf('动画A', 2, '8')]])

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, {
      incremental: true,
      fingerprintMap,
    })

    expect(preview).toMatchObject({
      alreadyUploaded: 1,
      incrementalSkipped: 1,
      plannedSyncCount: 0,
    })
  })

  it('增量模式 + 已上传 + 指纹不一致 → 重新进入待同步', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, {
      url: 'https://bgm.tv/subject/100',
      name: '动画A',
      status: '看过',
      rate: '8',
    })
    sheet.markUploaded(2)
    m.getLastRow.mockReturnValue(2)
    const fingerprintMap = new Map([['100', 'stale']])

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, {
      incremental: true,
      fingerprintMap,
    })

    expect(preview).toMatchObject({
      alreadyUploaded: 1,
      incrementalSkipped: 0,
      plannedSyncCount: 1,
    })
  })

  it('增量模式 + 未上传 + 指纹一致 → 计入增量跳过而非待同步', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, {
      url: 'https://bgm.tv/subject/100',
      name: '动画A',
      status: '看过',
      rate: '8',
    })
    m.getLastRow.mockReturnValue(2)
    const fingerprintMap = new Map([['100', fingerprintOf('动画A', 2, '8')]])

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, {
      incremental: true,
      fingerprintMap,
    })

    expect(preview).toMatchObject({ incrementalSkipped: 1, plannedSyncCount: 0 })
  })

  it('启用筛选 → 只统计可见行，且忽略表头之前与表头行本身', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    fillRow(sheet, 3, { url: 'https://bgm.tv/subject/200', name: '动画B', status: '看过' })
    m.getLastRow.mockReturnValue(3)
    m.getFilterStatus.mockReturnValue({ hasFilter: true, visibleRows: [1, 2] })

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 3, HEADER_ROW)

    expect(preview.total).toBe(1)
    expect(preview.plannedSyncCount).toBe(1)
  })

  it('筛选状态为「有筛选但零可见行」→ 退回全量模式', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    m.getLastRow.mockReturnValue(2)
    m.getFilterStatus.mockReturnValue({ hasFilter: true, visibleRows: [] })

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW)

    expect(preview.total).toBe(1)
  })

  it('列映射缺少「序列号」→ 退回默认列号读取，不抛错', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    m.getLastRow.mockReturnValue(2)
    const columnMap = buildColumnMap()
    columnMap.delete('序列号')

    expect(() => getSyncPreview(asSheet(sheet), columnMap, 2, HEADER_ROW)).not.toThrow()
  })

  it('状态列缺失时按「状态 → 观看状态」链路回退取值', () => {
    const sheet = new FakeSheet()
    sheet.set(2, 1, 'https://bgm.tv/subject/100')
    sheet.set(2, COLUMN_NAME, '动画A')
    sheet.set(2, COLUMN_EPISODES, '12')
    m.getLastRow.mockReturnValue(2)
    const columnMap = buildColumnMap()
    columnMap.delete('是否看完')

    const preview = getSyncPreview(asSheet(sheet), columnMap, 2, HEADER_ROW)

    // 两条备用列都不在映射里 → 取到空串，计入 emptyStatus
    expect(preview).toMatchObject({ valid: 1, emptyStatus: 1 })
  })

  it('可见行超出批量读取范围 → 回退到逐格读取', () => {
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    fillRow(sheet, 3, { url: 'https://bgm.tv/subject/200', name: '动画B', status: '看过' })
    // 批量读取只覆盖到 lastRow=2，但筛出的可见行含第 3 行 → 该行走 getCellValue 兜底
    m.getLastRow.mockReturnValue(2)
    m.getFilterStatus.mockReturnValue({ hasFilter: true, visibleRows: [2, 3] })

    const preview = getSyncPreview(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW)

    expect(preview).toMatchObject({ total: 2, valid: 2, plannedSyncCount: 2 })
  })
})

// ========== detectConflicts ==========

describe('ribbon-service · detectConflicts', () => {
  it('收藏快照获取失败 → 返回空冲突并把错误交给 handleError', async () => {
    m.fetchAllUserCollections.mockRejectedValue(new Error('网络不可用'))
    const sheet = new FakeSheet()

    const result = await detectConflicts(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, 't0ken')

    expect(result).toEqual({ conflicts: [], conflictCount: 0, bgmCollectionReady: false })
    expect(m.handleError).toHaveBeenCalledWith(expect.anything(), {
      context: 'detectConflicts',
      showAlert: false,
    })
  })

  it('本地状态与 Bangumi 收藏类型不一致 → 记为冲突（含行号与两侧类型）', async () => {
    m.fetchAllUserCollections.mockResolvedValue([
      collection({ subject_id: 100, type: 1, subjectName: '动画A' }),
    ])
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    m.getLastRow.mockReturnValue(2)

    const result = await detectConflicts(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, 't0ken')

    expect(result.bgmCollectionReady).toBe(true)
    expect(result.conflictCount).toBe(1)
    expect(result.conflicts[0]).toEqual({
      row: 2,
      subjectId: '100',
      name: '动画A',
      existingType: 1,
      incomingType: 2,
    })
  })

  it('类型一致 → 不记为冲突', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100, type: 2 })])
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    m.getLastRow.mockReturnValue(2)

    const result = await detectConflicts(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, 't0ken')

    expect(result.conflictCount).toBe(0)
  })

  it('本地状态映射为 0（不上传）→ 不参与冲突', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100, type: 2 })])
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '忽略' })
    m.getLastRow.mockReturnValue(2)

    const result = await detectConflicts(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, 't0ken')

    expect(result.conflictCount).toBe(0)
  })

  it('Bangumi 无对应收藏 → 不记为冲突（属新增）', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 999, type: 1 })])
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    m.getLastRow.mockReturnValue(2)

    const result = await detectConflicts(asSheet(sheet), buildColumnMap(), 2, HEADER_ROW, 't0ken')

    expect(result.conflictCount).toBe(0)
  })

  it('无 URL / 无 SID 的行被跳过', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100, type: 1 })])
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: '', name: '空行', status: '看过' })
    fillRow(sheet, 3, { url: '无编号', name: '坏行', status: '看过' })
    m.getLastRow.mockReturnValue(3)

    const result = await detectConflicts(asSheet(sheet), buildColumnMap(), 3, HEADER_ROW, 't0ken')

    expect(result.conflictCount).toBe(0)
  })

  it('启用筛选 → 只比对可见行', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100, type: 1 })])
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    fillRow(sheet, 3, { url: 'https://bgm.tv/subject/100', name: '动画A', status: '看过' })
    m.getLastRow.mockReturnValue(3)
    m.getFilterStatus.mockReturnValue({ hasFilter: true, visibleRows: [3] })

    const result = await detectConflicts(asSheet(sheet), buildColumnMap(), 3, HEADER_ROW, 't0ken')

    expect(result.conflicts.map((c) => c.row)).toEqual([3])
  })

  it('列映射缺「名称」列 → 冲突条目的名称回退为空串', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100, type: 1 })])
    const sheet = new FakeSheet()
    fillRow(sheet, 2, { url: 'https://bgm.tv/subject/100', status: '看过' })
    m.getLastRow.mockReturnValue(2)
    const columnMap = buildColumnMap()
    columnMap.delete('名称')

    const result = await detectConflicts(asSheet(sheet), columnMap, 2, HEADER_ROW, 't0ken')

    expect(result.conflicts).toEqual([
      { row: 2, subjectId: '100', name: '', existingType: 1, incomingType: 2 },
    ])
  })
})

// ========== syncWithConfirmation ==========

describe('ribbon-service · syncWithConfirmation', () => {
  it('无数据工作表 → 提示并返回', async () => {
    m.getDataSheet.mockReturnValue(null)

    await syncWithConfirmation()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('未找到数据工作表', 0, 64)
    expect(m.syncToBangumiAsync).not.toHaveBeenCalled()
  })

  it('同步已在运行 → 提示稍后再试', async () => {
    syncState.isRunning = true
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))

    await syncWithConfirmation()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('同步正在进行中，请稍后再试', 0, 48)
  })

  it('未设置 Token → 提示先设置', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.loadBgToken.mockReturnValue(null)

    await syncWithConfirmation()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('请先设置 Token', 0, 48)
  })

  it('缺少 Bangumi_URL 列 → 提示并返回', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.loadBgToken.mockReturnValue('t0ken')
    const columnMap = buildColumnMap()
    columnMap.delete('Bangumi_URL')
    m.getColumnMap.mockReturnValue(columnMap)

    await syncWithConfirmation()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('未找到 Bangumi URL 列', 0, 48)
  })

  it('用户在确认框点「否」→ 不执行同步', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    m.getApp.mockReturnValue({ MessageBox: vi.fn(() => 7) })

    await syncWithConfirmation()

    expect(m.syncToBangumiAsync).not.toHaveBeenCalled()
  })

  it('确认后执行同步：预览统计与选项写入确认文案，进度回调更新状态栏', async () => {
    const sheet = goodSheet()
    m.getDataSheet.mockReturnValue(asSheet(sheet))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    const app = {
      MessageBox: vi.fn((_message: string, _type: number) => 6),
      StatusBar: '' as string | boolean,
      PluginStorage: {
        getItem: vi.fn((key: string) => {
          if (key === 'bgm_incremental_sync') return 'true'
          if (key === 'bgm_skip_conflicts') return 'true'
          return null
        }),
      },
    }
    m.getApp.mockReturnValue(app)
    m.fetchAllUserCollections.mockResolvedValue([
      { subject_id: 100, type: 1, tags: [], comment: '' },
    ])
    m.syncToBangumiAsync.mockImplementation(
      (
        _worksheet: unknown,
        _columnMap: unknown,
        _token: unknown,
        _lastRow: unknown,
        _headerRow: unknown,
        options: { onProgress: (c: number, t: number, message: string) => void },
      ) => {
        options.onProgress(1, 3, '上传中')
        return Promise.resolve({ success: 3, fail: 0, skip: 0 })
      },
    )

    await syncWithConfirmation()

    const confirmMessage = String(app.MessageBox.mock.calls[0]?.[0])
    expect(confirmMessage).toContain('待同步：1')
    expect(confirmMessage).toContain('冲突策略：跳过冲突')
    expect(confirmMessage).toContain('增量同步：开启')
    // 冲突策略 skip + 检测到冲突 → 把冲突 SID 传给同步层
    const options = m.syncToBangumiAsync.mock.calls[0]?.[5] as {
      skipSubjectIds?: Set<string>
      incremental: boolean
    }
    expect(options.incremental).toBe(true)
    expect(options.skipSubjectIds).toEqual(new Set(['100']))
    expect(app.StatusBar).toBe(false)
    expect(m.exitRunningState).toHaveBeenCalled()
  })

  it('读取 Ribbon 选项抛错 → 降级为默认策略，不影响同步继续', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    m.getApp.mockReturnValue({
      MessageBox: vi.fn(() => 6),
      PluginStorage: {
        getItem: vi.fn(() => {
          throw new Error('PluginStorage 不可用')
        }),
      },
    })

    await syncWithConfirmation()

    expect(m.handleError).toHaveBeenCalledWith(expect.anything(), {
      context: 'syncWithConfirmation:readRibbonOptions',
      showAlert: false,
    })
    const options = m.syncToBangumiAsync.mock.calls[0]?.[5] as { incremental: boolean }
    expect(options.incremental).toBe(false)
  })

  it('冲突检测失败（网络不通）→ 记录告警但继续同步', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    m.getApp.mockReturnValue({ MessageBox: vi.fn(() => 6) })
    m.fetchAllUserCollections.mockRejectedValue(new Error('网络不可用'))

    await syncWithConfirmation()

    // detectConflicts 内部已 try/catch 收藏快照失败并自报 context，外层 catch 不参与
    expect(m.syncToBangumiAsync).toHaveBeenCalled()
    expect(m.handleError).toHaveBeenCalledWith(expect.anything(), {
      context: 'detectConflicts',
      showAlert: false,
    })
  })

  it('冲突检测阶段抛错 → 外层兜底记录告警并继续同步', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    m.getApp.mockReturnValue({ MessageBox: vi.fn(() => 6) })
    // getSyncPreview 的调用（第 1 次）正常；detectConflicts 的调用（第 2 次）抛错
    m.getFilterStatus
      .mockReturnValueOnce({ hasFilter: false, visibleRows: [] })
      .mockImplementationOnce(() => {
        throw new Error('AutoFilter 探测失败')
      })

    await syncWithConfirmation()

    expect(m.syncToBangumiAsync).toHaveBeenCalled()
    expect(m.handleError).toHaveBeenCalledWith(expect.anything(), {
      context: 'syncWithConfirmation:conflictDetection',
      showAlert: false,
    })
  })

  it('进入运行态失败（并发抢占）→ 提示稍后再试且不执行同步', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    m.getApp.mockReturnValue({ MessageBox: vi.fn(() => 6) })
    m.enterRunningState.mockReturnValue(false)

    await syncWithConfirmation()

    expect(m.syncToBangumiAsync).not.toHaveBeenCalled()
    expect(m.wpsMessageBox).toHaveBeenCalledWith('同步正在进行中，请稍后再试', 0, 48)
  })

  it('同步执行抛错 → 退出运行态、复位状态栏并把错误交给 handleError（弹窗）', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    const app = { MessageBox: vi.fn(() => 6), StatusBar: '' as string | boolean }
    m.getApp.mockReturnValue(app)
    m.syncToBangumiAsync.mockRejectedValue(new Error('同步炸了'))

    await syncWithConfirmation()

    expect(app.StatusBar).toBe(false)
    expect(m.exitRunningState).toHaveBeenCalled()
    expect(m.handleError).toHaveBeenCalledWith(expect.anything(), {
      context: 'Ribbon同步',
      showAlert: true,
    })
  })

  it('无宿主对象（app 为 null）→ 不抛错，仍走完同步（确认框被跳过）', async () => {
    m.getDataSheet.mockReturnValue(asSheet(goodSheet()))
    m.getLastRow.mockReturnValue(2)
    m.loadBgToken.mockReturnValue('t0ken')
    m.getApp.mockReturnValue(null)

    await expect(syncWithConfirmation()).resolves.toBeUndefined()
    // 无 MessageBox 可弹 → confirmResult 为 undefined ≠ 6 → 直接返回
    expect(m.syncToBangumiAsync).not.toHaveBeenCalled()
  })
})

// ========== setTokenForRibbon ==========

describe('ribbon-service · setTokenForRibbon', () => {
  it('用户提交 Token 并保存成功 → 通知面板刷新并触发验证', () => {
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => 'new-t0ken') })
    m.loadBgToken.mockReturnValue('old-token')
    m.storeBgToken.mockReturnValue(true)

    expect(setTokenForRibbon()).toBe(true)

    expect(m.storeBgToken).toHaveBeenCalledWith('new-t0ken')
    expect(m.notifyTokenUpdated).toHaveBeenCalled()
    expect(m.testTokenValidityForRibbon).toHaveBeenCalledWith('new-t0ken')
  })

  it('输入框预填当前 Token', () => {
    const inputBox = vi.fn(() => null)
    m.getApp.mockReturnValue({ InputBox: inputBox })
    m.loadBgToken.mockReturnValue('existing')

    setTokenForRibbon()

    expect(inputBox).toHaveBeenCalledWith('请输入 Access Token', '设置 Token', 'existing', 2)
  })

  it('用户取消（返回 null）→ 返回 false 且不写存储', () => {
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => null) })

    expect(setTokenForRibbon()).toBe(false)
    expect(m.storeBgToken).not.toHaveBeenCalled()
  })

  it('返回非字符串 → 忽略', () => {
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => 42) })

    expect(setTokenForRibbon()).toBe(false)
  })

  it('保存失败 → 弹窗提示权限问题并返回 false', () => {
    const messageBox = vi.fn()
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => 't0ken'), MessageBox: messageBox })
    m.storeBgToken.mockReturnValue(false)

    expect(setTokenForRibbon()).toBe(false)
    expect(messageBox).toHaveBeenCalledWith('Token 保存失败，请检查插件存储权限', 0, 16)
  })

  it('无宿主 InputBox → 返回 false', () => {
    m.getApp.mockReturnValue({})

    expect(setTokenForRibbon()).toBe(false)
  })

  it('通知面板抛错 → 记录并降级，不影响保存成功', () => {
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => 't0ken') })
    m.storeBgToken.mockReturnValue(true)
    // setTokenForRibbon 先直接调一次 BGM.notifyTokenUpdated()（无 try/catch），
    // 再由 notifyPanelTokenUpdated() 内层 try/catch 保护第二次调用 → 让第二次抛错
    m.notifyTokenUpdated.mockReturnValueOnce(undefined).mockImplementationOnce(() => {
      throw new Error('事件总线不可用')
    })

    expect(setTokenForRibbon()).toBe(true)
    expect(m.handleError).toHaveBeenCalledWith(expect.any(Error), { showAlert: false })
  })
})

// ========== testTokenForRibbon ==========

describe('ribbon-service · testTokenForRibbon', () => {
  it('未设置 Token → 提示先设置，不发起请求', async () => {
    m.loadBgToken.mockReturnValue(null)

    await testTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('请先设置 Token！', 0, 48)
    expect(m.fetchBgmMe).not.toHaveBeenCalled()
  })

  it('200 + 合法响应 → 写入用户信息并在 Ribbon 弹窗展示', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({
      kind: 'ok',
      user: { id: '100', username: 'momo' },
      status: 200,
    })

    await testTokenForRibbon()

    expect(m.fetchBgmMe).toHaveBeenCalledTimes(1)
    expect(m.setBgmUserId).toHaveBeenCalledWith('100')
    expect(m.setBgmUsername).toHaveBeenCalledWith('momo')
    expect(m.wpsMessageBox).toHaveBeenCalledWith('Token 有效！\n用户: momo\nID: 100', 0, 64)
  })

  it('用户名为空 → 回退到「未知用户」', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({ kind: 'ok', user: { id: '7', username: '' }, status: 200 })

    await testTokenForRibbon()

    expect(m.setBgmUsername).toHaveBeenCalledWith('未知用户')
  })

  it('kind=parse → 提示解析失败', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({ kind: 'parse' })

    await testTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('解析响应失败，请重试', 0, 16)
  })

  it('HTTP 401 → 提示 Token 无效', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({ kind: 'http', status: 401 })

    await testTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('Token 无效或已过期，请重新设置', 0, 48)
  })

  it('其它状态码 → 提示带状态码的失败', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({ kind: 'http', status: 500 })

    await testTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('Token 验证失败 (HTTP 500)', 0, 16)
  })

  it('网络错误 → 提示被墙或断网', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({ kind: 'network' })

    await testTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith(
      '网络错误，无法连接到 Bangumi API\n可能原因：网络被墙或断网',
      0,
      16,
    )
  })

  it('超时 → 提示重试（与网络错误文案区分）', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({ kind: 'timeout' })

    await testTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('网络超时，请重试', 0, 48)
  })

  it('弹窗通道自身抛错 → 外层兜底记日志，不向外抛', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    m.fetchBgmMe.mockResolvedValue({ kind: 'http', status: 401 })
    m.wpsMessageBox.mockRejectedValue(new Error('弹窗通道异常'))

    // 不 reject 即为「不向外抛」（旧契约：Ribbon 按钮处理器不因弹窗失败而崩）
    await expect(testTokenForRibbon()).resolves.toBeUndefined()

    const messages = m.bgmLog.mock.calls.map((call) => String(call[1]))
    expect(messages.some((message) => message.includes('处理响应异常: 弹窗通道异常'))).toBe(true)
  })
})

// ========== copyTokenForRibbon ==========

describe('ribbon-service · copyTokenForRibbon', () => {
  it('未设置 Token → 提示先设置', async () => {
    m.loadBgToken.mockReturnValue(null)

    await copyTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('未设置 Token，请先设置！', 0, 48)
  })

  it('execCommand 成功 → 提示已复制，且临时 textarea 被清理', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    installExecCommand(true)
    const before = document.body.children.length

    await copyTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('Token 已复制到剪贴板', 0, 64)
    expect(document.body.children.length).toBe(before)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('execCommand 返回 false → 提示浏览器不支持', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    installExecCommand(false)

    await copyTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('复制失败，浏览器不支持剪贴板操作', 0, 48)
  })

  it('execCommand 抛错 → 提示失败原因', async () => {
    m.loadBgToken.mockReturnValue('t0ken')
    installExecCommand(() => {
      throw new Error('剪贴板被拒绝')
    })

    await copyTokenForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('复制失败: 剪贴板被拒绝', 0, 16)
  })
})

// ========== setUserIdForRibbon ==========

describe('ribbon-service · setUserIdForRibbon', () => {
  it('提交带空白的 ID → 去空白后保存并提示', () => {
    const messageBox = vi.fn()
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => '  momo  '), MessageBox: messageBox })

    setUserIdForRibbon()

    expect(m.setUserId).toHaveBeenCalledWith('momo')
    expect(messageBox).toHaveBeenCalledWith('用户 ID 已保存', 0, 64)
  })

  it('取消（返回 null）→ 不保存、不提示', () => {
    const messageBox = vi.fn()
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => null), MessageBox: messageBox })

    setUserIdForRibbon()

    expect(m.setUserId).not.toHaveBeenCalled()
    expect(messageBox).not.toHaveBeenCalled()
  })

  it('返回非字符串 → 忽略', () => {
    m.getApp.mockReturnValue({ InputBox: vi.fn(() => 123) })

    setUserIdForRibbon()

    expect(m.setUserId).not.toHaveBeenCalled()
  })
})

// ========== openCollectionForRibbon ==========

describe('ribbon-service · openCollectionForRibbon', () => {
  it('无宿主对象 → 记录错误并返回', () => {
    m.getApp.mockReturnValue(null)
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    openCollectionForRibbon()

    expect(openSpy).not.toHaveBeenCalled()
    expect(m.bgmLog).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('无法获取'))
  })

  it('未设置用户 ID → 弹窗提示，不打开新标签页', () => {
    const messageBox = vi.fn()
    m.getApp.mockReturnValue({ MessageBox: messageBox })
    m.getBgmUserId.mockReturnValue(null)
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    openCollectionForRibbon()

    expect(messageBox).toHaveBeenCalledWith('请先设置用户ID！', 0, 48)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('已设置用户 ID → 按 ID 拼装收藏页 URL 并新开标签页', () => {
    m.getApp.mockReturnValue({})
    m.getBgmUserId.mockReturnValue('momo')
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    openCollectionForRibbon()

    expect(openSpy).toHaveBeenCalledWith('https://bgm.tv/user/momo/collection', '_blank')
  })
})

// ========== syncFromGithubForRibbon ==========

describe('ribbon-service · syncFromGithubForRibbon', () => {
  it('GitHub 配置不完整 → 提示并返回 null', async () => {
    m.isGithubConfigComplete.mockReturnValue(false)

    await expect(syncFromGithubForRibbon()).resolves.toBeNull()

    expect(m.wpsMessageBox).toHaveBeenCalledWith(
      'GitHub 仓库配置不完整，请先在面板中设置 owner/repo/path',
      0,
      48,
    )
  })

  it('配置完整 + PluginStorage 可用 → 写入同步请求信号', async () => {
    const setItem = vi.fn()
    m.getApp.mockReturnValue({ PluginStorage: { getItem: vi.fn(() => 'panel-1'), setItem } })

    await expect(syncFromGithubForRibbon()).resolves.toBeNull()

    expect(setItem).toHaveBeenCalledWith('bgm_request_github_sync', expect.any(String))
  })

  it('面板尚未创建 → 走 showBangumiPanel 创建（异步触发）', async () => {
    m.getApp.mockReturnValue({ PluginStorage: { getItem: vi.fn(() => null), setItem: vi.fn() } })

    await syncFromGithubForRibbon()

    // ensurePanelVisible 里是 `void (async () => { await import('../index.js') ... })()`，
    // 动态导入需要多等几个 microtask 才可观察
    await vi.waitFor(() => {
      expect(m.showBangumiPanel).toHaveBeenCalled()
    })
  })

  it('面板已存在但不可见 → 设为可见并记录时间戳', async () => {
    const setItem = vi.fn()
    m.getApp.mockReturnValue({
      PluginStorage: { getItem: vi.fn(() => 'panel-1'), setItem },
      GetTaskPane: vi.fn(() => ({ Visible: false })),
    })

    await syncFromGithubForRibbon()

    expect(setItem).toHaveBeenCalledWith('bgm_panel_shown_at', expect.any(String))
  })

  it('面板已可见 → 不重复写入展示时间戳', async () => {
    const setItem = vi.fn()
    m.getApp.mockReturnValue({
      PluginStorage: { getItem: vi.fn(() => 'panel-1'), setItem },
      GetTaskPane: vi.fn(() => ({ Visible: true })),
    })

    await syncFromGithubForRibbon()

    const shownAtCalls = setItem.mock.calls.filter(([key]) => key === 'bgm_panel_shown_at')
    expect(shownAtCalls).toHaveLength(0)
  })

  it('PluginStorage 不可用 → 提示需手动在面板同步', async () => {
    m.getApp.mockReturnValue({})

    await syncFromGithubForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith(
      '无法通知任务面板执行同步，请手动在面板中点击「立即同步」',
      0,
      48,
    )
  })

  it('写入信号抛错 → 记录错误且不冒泡', async () => {
    m.getApp.mockReturnValue({
      PluginStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {
          throw new Error('存储写入失败')
        }),
      },
    })

    await expect(syncFromGithubForRibbon()).resolves.toBeNull()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('写入信号失败'),
    )
  })

  it('宿主读取配置抛错 → 记录告警且不冒泡', async () => {
    m.getApp.mockReturnValue({
      PluginStorage: {
        getItem: vi.fn(() => {
          throw new Error('存储不可读')
        }),
      },
    })

    await expect(syncFromGithubForRibbon()).resolves.toBeNull()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ensurePanelVisible] 失败'),
    )
  })

  it('无宿主对象 → 直接跳过面板可见性处理并提示手动同步', async () => {
    m.getApp.mockReturnValue(null)

    await expect(syncFromGithubForRibbon()).resolves.toBeNull()

    expect(m.wpsMessageBox).toHaveBeenCalledWith(
      '无法通知任务面板执行同步，请手动在面板中点击「立即同步」',
      0,
      48,
    )
  })
})

// ========== undoLastSyncForRibbon ==========

describe('ribbon-service · undoLastSyncForRibbon', () => {
  it('PluginStorage 不可用 → 提示无法连接面板', async () => {
    m.getApp.mockReturnValue({})

    await undoLastSyncForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('无法连接到任务面板，请稍后重试', 0, 48)
  })

  it('可用 → 写入撤销请求信号并提示到面板确认', async () => {
    const setItem = vi.fn()
    m.getApp.mockReturnValue({ PluginStorage: { getItem: vi.fn(), setItem } })

    await undoLastSyncForRibbon()

    expect(setItem).toHaveBeenCalledWith('bgm_request_undo_sync', expect.any(String))
    expect(m.wpsMessageBox).toHaveBeenCalledWith('已发送撤销请求，请在任务面板中确认操作', 0, 64)
  })

  it('写入抛错 → 提示发送失败', async () => {
    m.getApp.mockReturnValue({
      PluginStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(() => {
          throw new Error('写入失败')
        }),
      },
    })

    await undoLastSyncForRibbon()

    expect(m.wpsMessageBox).toHaveBeenCalledWith('发送撤销请求失败，请稍后重试', 0, 16)
  })
})

// ========== executeUndoLastSync ==========

describe('ribbon-service · executeUndoLastSync', () => {
  it('没有可撤销会话 → 提示并返回 0', async () => {
    vi.mocked(getLastSessionDescription).mockReturnValue(null)

    await expect(executeUndoLastSync()).resolves.toBe(0)

    expect(m.wpsMessageBox).toHaveBeenCalledWith('没有可撤销的同步操作', 0, 48)
  })

  it('用户在确认框点「否」→ 返回 0 且不执行撤销', async () => {
    vi.mocked(getLastSessionDescription).mockReturnValue('将恢复 3 个单元格')
    m.wpsMessageBox.mockResolvedValue(7)

    await expect(executeUndoLastSync()).resolves.toBe(0)

    expect(vi.mocked(undoLastSync)).not.toHaveBeenCalled()
  })

  it('确认后执行撤销 → 提示恢复条数并返回该条数', async () => {
    vi.mocked(getLastSessionDescription).mockReturnValue('将恢复 3 个单元格')
    vi.mocked(undoLastSync).mockReturnValue(3)
    m.wpsMessageBox.mockResolvedValue(6)

    await expect(executeUndoLastSync()).resolves.toBe(3)

    expect(m.wpsMessageBox).toHaveBeenCalledWith('已撤销 3 项变更', 0, 64)
  })

  it('撤销过程抛错 → 提示失败原因并返回 0', async () => {
    vi.mocked(getLastSessionDescription).mockReturnValue('将恢复 3 个单元格')
    vi.mocked(undoLastSync).mockImplementation(() => {
      throw new Error('工作表已关闭')
    })
    m.wpsMessageBox.mockResolvedValue(6)

    await expect(executeUndoLastSync()).resolves.toBe(0)

    expect(m.wpsMessageBox).toHaveBeenCalledWith('撤销失败：工作表已关闭', 0, 16)
  })
})
