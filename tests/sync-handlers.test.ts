// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/sync.ts`（面板同步 / 从 BGM 收藏同步 UI 处理器）单元测试。
 *
 * 依赖形状：与 `action-handlers.test.ts` 同构 —— 30 个符号走 `../../index.js` 这一个
 * barrel，另有 4 个兄弟模块（`services/ribbon-service`、`tools/util/index`、
 * `ui/handlers/token`、`ui/handlers/_constants`）。因此 mock 一个 barrel + 三个兄弟模块
 * 即可驱动机内真实实现，不需要拆文件（对应 MEMORY §8 的「依赖收敛单一 barrel → 就地测」）。
 *
 * ⚠️ barrel 必须用**全量 mock**（工厂不调 `importOriginal`）：`ts/index.ts` 会经
 * `ui/handlers.js` 把本模块再 re-export 回去，形成 `index.ts ↔ handlers/sync.ts` 循环；
 * 若在工厂里 `await importOriginal()`，加载真 barrel 时本模块回头 import barrel（工厂尚未
 * resolve）会死锁 → vitest 回退真实现 → mock 调用次数恒为 0、真实网络请求把用例拖到超时。
 * 同款坑已在 `ribbon-service.test.ts` 踩过（见该文件注释）。
 *
 * 三个「函数是否已加载」的门禁分支（`typeof X !== 'function'`）用 **getter 动态返回**
 * 来实现：mock 对象上写 `get findHeaderRow()` 读取 hoisted 开关，用例把开关置 false 即可
 * 覆盖早退分支 —— 否则 `vi.fn()` 恒为函数，那条分支永远测不到。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 假单元格：`row:column` → `{ Value, Interior? }` */
const cells = vi.hoisted(() => new Map<string, unknown>())

/** BGM.sync / BGM.sheet 的运行态（getter 暴露给被测代码） */
const runtime = vi.hoisted(() => {
  const state: { isRunning: boolean; lockedIndex: number | undefined } = {
    isRunning: false,
    lockedIndex: 1,
  }
  return state
})

/** showConfirm 的用户回答队列（按调用顺序消费，耗尽后取 fallback） */
const answers = vi.hoisted(() => ({
  queue: [] as boolean[],
  cursor: 0,
  fallback: true,
}))

const m = vi.hoisted(() => ({
  // ---- barrel: 宿主与读取器 ----
  bgmLog: vi.fn(),
  handleError: vi.fn(),
  getApp: vi.fn((): unknown => null),
  getCell: vi.fn(
    (_ws: unknown, row: number, column: number): unknown =>
      cells.get(`${String(row)}:${String(column)}`) ?? null,
  ),
  loadBgToken: vi.fn((): string | null => null),
  getDataSheet: vi.fn((): unknown => null),
  findHeaderRow: vi.fn((): number => 1),
  getColumnMap: vi.fn((): Map<string, number> => new Map()),
  getLastRow: vi.fn((): number => 1),
  setCellValue: vi.fn((_ws: unknown, _row: number, _col: number, _value: unknown): boolean => true),
  clearSheetCache: vi.fn(),
  _setBgmUserId: vi.fn(),

  // ---- barrel: 对话框 ----
  showAlert: vi.fn(),
  showConfirm: vi.fn(),
  // Promise 版：走同一个 showConfirm 替身，从而共用 answers 队列
  confirmAsync: vi.fn<(message: string, title?: string) => Promise<boolean>>(),
  showToast: vi.fn(),
  setStatus: vi.fn(),
  showSyncProgressDialog: vi.fn(),
  updateSyncProgressDialog: vi.fn(),
  completeSyncProgressDialog: vi.fn(),
  hideSyncProgressDialog: vi.fn(),
  buildSyncConfig: vi.fn(() => '配置摘要'),
  formatDuration: vi.fn(() => '1.0s'),

  // ---- barrel: 同步 / 抓取 / 配置 ----
  verifyToken: vi.fn(),
  fetchAllUserCollections: vi.fn(),
  SyncToBangumiAsync: vi.fn(),
  getOrCreateSyncRecordSheet: vi.fn((): unknown => null),
  getAllSyncRecords: vi.fn((): unknown[] => []),
  addSyncRecords: vi.fn((_records: Record<string, unknown>[]): boolean => true),
  isIncrementalSyncEnabled: vi.fn(() => false),
  getListType: vi.fn(() => 'collect'),

  // ---- barrel: BGM.sync 状态机 ----
  enterRunningState: vi.fn(),
  exitRunningState: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  requestStop: vi.fn(),
  checkShouldStop: vi.fn(() => false),
  checkPaused: vi.fn(() => false),
  waitForResume: vi.fn(),
  updatePosition: vi.fn(),

  // ---- 兄弟模块 ----
  getSyncPreview: vi.fn(),
  detectConflicts: vi.fn(),
  ensureSheetHeaders: vi.fn(() => true),
  showTokenDialog: vi.fn(),

  // ---- 「函数是否已加载」开关（配合 getter 覆盖 typeof 早退分支）----
  helpersLoaded: true,
  recordsLoaded: true,
}))

vi.mock('../ts/index.js', async () => {
  const constants = await import('../ts/core/constants.js')
  const strings = await import('../ts/tools/string-utilities.js')
  const pure = await import('../ts/sync/pure-utilities-core.js')
  return {
    ...constants,
    // 纯函数保持真实现，断言打到真实行为
    trim: strings.trim,
    extractSubjectId: pure.extractSubjectId,
    ...m,
    BGM: {
      handleError: m.handleError,
      ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
      sync: {
        get isRunning() {
          return runtime.isRunning
        },
        enterRunningState: m.enterRunningState,
        exitRunningState: m.exitRunningState,
        pause: m.pause,
        resume: m.resume,
        requestStop: m.requestStop,
        checkShouldStop: m.checkShouldStop,
        checkPaused: m.checkPaused,
        waitForResume: m.waitForResume,
        updatePosition: m.updatePosition,
      },
      sheet: {
        get lockedIndex() {
          return runtime.lockedIndex
        },
      },
    },
    // getter 必须放在 `...m` 之后，否则会被展开的 vi.fn 覆盖掉
    get findHeaderRow() {
      return m.helpersLoaded ? m.findHeaderRow : undefined
    },
    get getColumnMap() {
      return m.helpersLoaded ? m.getColumnMap : undefined
    },
    get getLastRow() {
      return m.helpersLoaded ? m.getLastRow : undefined
    },
    get getOrCreateSyncRecordSheet() {
      return m.recordsLoaded ? m.getOrCreateSyncRecordSheet : undefined
    },
    get getAllSyncRecords() {
      return m.recordsLoaded ? m.getAllSyncRecords : undefined
    },
    get addSyncRecords() {
      return m.recordsLoaded ? m.addSyncRecords : undefined
    },
  }
})

vi.mock('../ts/services/ribbon-service.js', () => ({
  getSyncPreview: m.getSyncPreview,
  detectConflicts: m.detectConflicts,
}))

vi.mock('../ts/tools/util/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/tools/util/index.js')>()
  return {
    ...actual,
    ensureSheetHeaders: m.ensureSheetHeaders,
  }
})

vi.mock('../ts/ui/handlers/token.js', () => ({
  showTokenDialog: m.showTokenDialog,
}))

import {
  BGM_COLOR,
  BGM_SUBJECT_TYPES,
  COLLECTION_TYPE_NAMES,
  LOG_LEVELS,
} from '../ts/core/constants.js'
import { _T } from '../ts/ui/handlers/_constants.js'
import { syncCollectionFromBgm, syncFromBgmByAPI, syncFromPanel } from '../ts/ui/handlers/sync.js'

// ========== 场景构件 ==========

/** 同步记录工作表假对象 */
function makeSyncSheet(): { Name: string; Activate: ReturnType<typeof vi.fn> } {
  return { Name: '同步记录', Activate: vi.fn() }
}

/**
 * Range(...).Value2 批量写记录（§5.6 A3：收藏填充从逐格写改为矩形写）。
 * getter 恒返回 null：空表填充场景没有旧值基底（readRect 据此返回「读失败」→ 空基底）。
 */
const value2Writes: { address: string; value: unknown }[] = []
/** 置 true 时矩形写抛错，用于验证「批量失败 → 回退逐格 setCellValue」路径 */
let shouldValue2Throw = false

/** 数据工作表假对象 */
function makeDataSheet(): {
  Name: string
  Activate: ReturnType<typeof vi.fn>
  Range: (address: string) => { Value2: unknown }
} {
  return {
    Name: '数据表',
    Activate: vi.fn(),
    Range: (address: string) => ({
      get Value2(): unknown {
        return null
      },
      set Value2(value: unknown) {
        if (shouldValue2Throw) throw new Error('COM 批量写入失败')
        value2Writes.push({ address, value })
      },
    }),
  }
}

/** 用户原工作表假对象 */
function makeOriginalSheet(): { Name: string; Activate: ReturnType<typeof vi.fn> } {
  return { Name: '原表', Activate: vi.fn() }
}

let dataSheet = makeDataSheet()
let originalSheet = makeOriginalSheet()

/** 假 Application 的形状 */
interface FakeApp {
  ActiveWorkbook: { ActiveSheet: unknown; Worksheets: { Item: ReturnType<typeof vi.fn> } }
  StatusBar: string | boolean
}

/** 一个带 ActiveWorkbook / StatusBar 的假 Application */
function makeApp(): FakeApp {
  const app: FakeApp = {
    ActiveWorkbook: {
      ActiveSheet: originalSheet,
      Worksheets: { Item: vi.fn(() => dataSheet) },
    },
    StatusBar: '',
  }
  return app
}

/** 标准列映射 */
function makeColMap(): Map<string, number> {
  return new Map([
    ['Bangumi_URL', 1],
    ['名称', 2],
    ['是否看完', 3],
    ['打分', 4],
    ['标签/分级', 5],
    ['集数', 6],
    ['序列号', 9],
  ])
}

/**
 * 空表场景：首轮 findHeaderRow/getColumnMap/getLastRow 返回「空」，写表头后恢复正常。
 * 调用序见 `_doAPISync`：711→713→714（探测）→ 744→745（写表头后重算）→ 765（填充后重算）。
 */
function setEmptySheet(firstHeaderRow = 0, filledLastRow = 3): void {
  m.findHeaderRow.mockReturnValueOnce(firstHeaderRow).mockReturnValue(1)
  m.getColumnMap.mockReturnValueOnce(new Map()).mockReturnValue(makeColMap())
  m.getLastRow.mockReturnValueOnce(0).mockReturnValue(filledLastRow)
}

/** 覆盖 别名 / 类别 / 打分 / 标签 / 剧透 五个可选列的列映射 */
function richColMap(): Map<string, number> {
  return new Map([
    ['Bangumi_URL', 1],
    ['名称', 2],
    ['是否看完', 3],
    ['打分', 4],
    ['标签/分级', 5],
    ['序列号', 9],
    ['别名', 10],
    ['类别', 11],
    ['剧透/感言', 12],
  ])
}

/** 挂一个 id + 值的 select（jsdom 必须先有 option 才能接受 value） */
function mountSelect(id: string, value: string): void {
  const select = document.createElement('select')
  select.id = id
  const option = document.createElement('option')
  option.value = value
  select.append(option)
  select.value = value
  document.body.append(select)
}

/**
 * 让排队中的异步流程跑完。
 * 一轮宏任务 == 排空当前全部 microtask，但被测流程内部**自己也会排宏任务**
 * （`_fillSheetWithCollections` 每 50 行 `setTimeout(…, 0)` 让出事件循环），
 * 因此需要多轮才能真正推进到流程末尾。
 */
async function tick(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

/** 一条 Bangumi 收藏条目 */
function collection(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { subject_id: 100, subject_type: 2, type: 2, subject: { name: '动画A' }, ...over }
}

beforeEach(() => {
  // ⚠️ 必须用 resetAllMocks 而不是 clearAllMocks：后者只清「调用记录」，
  // 用例里设置过的 mockReturnValue / mockReturnValueOnce 队列会**泄漏到下一条用例**
  // （曾导致 getCell 被上一条的 mockReturnValue(null) 污染 → 匹配计数恒为 0）。
  vi.resetAllMocks()
  document.body.replaceChildren()
  cells.clear()
  value2Writes.length = 0
  shouldValue2Throw = false
  answers.queue = []
  answers.cursor = 0
  answers.fallback = true
  runtime.isRunning = false
  runtime.lockedIndex = 1
  m.helpersLoaded = true
  m.recordsLoaded = true
  dataSheet = makeDataSheet()
  originalSheet = makeOriginalSheet()

  m.loadBgToken.mockReturnValue('tok-123')
  m.getApp.mockReturnValue(makeApp())
  m.getDataSheet.mockReturnValue(dataSheet)
  m.findHeaderRow.mockReturnValue(1)
  m.getLastRow.mockReturnValue(2)
  m.getColumnMap.mockReturnValue(makeColMap())
  m.setCellValue.mockReturnValue(true)
  m.getOrCreateSyncRecordSheet.mockReturnValue(null)
  m.getAllSyncRecords.mockReturnValue([])
  m.addSyncRecords.mockReturnValue(true)
  m.isIncrementalSyncEnabled.mockReturnValue(false)
  m.getListType.mockReturnValue('collect')
  m.checkShouldStop.mockReturnValue(false)
  m.checkPaused.mockReturnValue(false)
  m.waitForResume.mockResolvedValue(undefined)
  m.ensureSheetHeaders.mockReturnValue(true)
  m.verifyToken.mockResolvedValue({ valid: true, message: 'ok', userId: '100' })
  m.fetchAllUserCollections.mockResolvedValue([])
  m.SyncToBangumiAsync.mockResolvedValue({ success: 1, fail: 0, skip: 0 })
  m.getSyncPreview.mockReturnValue({
    total: 1,
    valid: 1,
    alreadyUploaded: 0,
    plannedSyncCount: 1,
    plannedSkipCount: 0,
    noUrl: 0,
    emptyStatus: 0,
    incrementalSkipped: 0,
  })
  m.detectConflicts.mockResolvedValue({ conflicts: [], conflictCount: 0, bgmCollectionReady: true })

  m.enterRunningState.mockImplementation(() => {
    if (runtime.isRunning) return false
    runtime.isRunning = true
    return true
  })
  m.exitRunningState.mockImplementation(() => {
    runtime.isRunning = false
  })
  m.showConfirm.mockImplementation((_message: string, callback: (isConfirmed: boolean) => void) => {
    const shouldConfirm = answers.queue[answers.cursor] ?? answers.fallback
    answers.cursor += 1
    callback(shouldConfirm)
  })
  // confirmAsync 必须与 showConfirm 共用同一份「用户回答」：真实实现就是它的包装，
  // 分开维护会让「用户点否」的用例在异步链路上跑出相反结果。
  m.confirmAsync.mockImplementation(
    (message: string, title?: string) =>
      new Promise<boolean>((resolve) => {
        m.showConfirm(
          message,
          (isConfirmed: boolean) => {
            resolve(isConfirmed)
          },
          title,
        )
      }),
  )
})

afterEach(() => {
  document.body.replaceChildren()
})

// ========== syncFromPanel：入口防重入与「准备阶段」早退 ==========

describe('sync · syncFromPanel > 准备阶段早退', () => {
  it('已有同步在运行 → 提示稍后再试且不再继续', async () => {
    runtime.isRunning = true

    await syncFromPanel()

    expect(m.showAlert).toHaveBeenCalledWith('同步正在进行中，请稍后再试', '提示')
    expect(m.showConfirm).not.toHaveBeenCalled()
    expect(m.SyncToBangumiAsync).not.toHaveBeenCalled()
  })

  it('必要函数未加载完成 → 提示稍候', async () => {
    m.helpersLoaded = false

    await syncFromPanel()

    expect(m.showAlert).toHaveBeenCalledWith(_T.loadingWait)
    // 已释放运行锁，用户可重试
    expect(runtime.isRunning).toBe(false)
  })

  it('Token 未设置 → 提示设置 Token 并释放运行锁', async () => {
    m.loadBgToken.mockReturnValue(null)

    await syncFromPanel()

    expect(m.showAlert).toHaveBeenCalledWith(_T.pleaseSetBgmToken)
    expect(runtime.isRunning).toBe(false)
  })

  it('拿不到 Application 对象 → 提示后终止', async () => {
    m.getApp.mockReturnValue(null)

    await syncFromPanel()

    expect(m.showAlert).toHaveBeenCalledWith('无法获取 Application 对象！')
    expect(m.getDataSheet).not.toHaveBeenCalled()
  })

  it('未找到数据工作表 → 提示先锁定工作表', async () => {
    m.getDataSheet.mockReturnValue(null)

    await syncFromPanel()

    expect(m.showAlert).toHaveBeenCalledWith('未找到数据工作表，请先锁定工作表。')
  })

  it('缺 Bangumi_URL 列 → 提示后终止', async () => {
    m.getColumnMap.mockReturnValue(new Map([['名称', 2]]))

    await syncFromPanel()

    expect(m.showAlert).toHaveBeenCalledWith('未找到 "Bangumi URL" 列！')
    expect(m.showConfirm).not.toHaveBeenCalled()
  })

  it('同步记录函数未加载 → 跳过记录表但不影响同步', async () => {
    m.recordsLoaded = false

    await syncFromPanel()

    expect(m.getOrCreateSyncRecordSheet).not.toHaveBeenCalled()
    expect(m.SyncToBangumiAsync).toHaveBeenCalled()
  })
})

// ========== syncFromPanel：确认与执行 ==========

describe('sync · syncFromPanel > 确认与执行', () => {
  it('用户在确认框点「否」→ 释放运行锁并恢复原工作表', async () => {
    answers.fallback = false

    await syncFromPanel()

    expect(m.SyncToBangumiAsync).not.toHaveBeenCalled()
    expect(runtime.isRunning).toBe(false)
    expect(originalSheet.Activate).toHaveBeenCalled()
  })

  it('确认后执行同步 → 弹进度框、写状态栏、完成弹窗带统计', async () => {
    const app = makeApp()
    m.getApp.mockReturnValue(app)

    await syncFromPanel()

    expect(m.showSyncProgressDialog).toHaveBeenCalledWith(
      '正在同步 - 同步到 Bangumi',
      expect.any(Object),
      '配置摘要',
    )
    expect(m.SyncToBangumiAsync).toHaveBeenCalledWith(
      dataSheet,
      expect.any(Map),
      'tok-123',
      2,
      1,
      expect.objectContaining({ incremental: false }),
    )
    expect(m.completeSyncProgressDialog).toHaveBeenCalled()
    expect(app.StatusBar).toBe(false)
    expect(runtime.isRunning).toBe(false)
  })

  it('onProgress 回调 → 更新进度弹窗并把进度写进状态栏', async () => {
    const app = makeApp()
    m.getApp.mockReturnValue(app)
    let statusBarDuringCallback: unknown
    m.SyncToBangumiAsync.mockImplementation(
      async (
        _ws: unknown,
        _colMap: unknown,
        _token: unknown,
        _lastRow: unknown,
        _headerRow: unknown,
        options: { onProgress: (c: number, t: number, message: string) => void },
      ) => {
        options.onProgress(1, 2, '上传中')
        statusBarDuringCallback = app.StatusBar
        return { success: 1, fail: 0, skip: 0 }
      },
    )

    await syncFromPanel()

    expect(m.updateSyncProgressDialog).toHaveBeenCalledWith(1, 2, '上传中')
    expect(statusBarDuringCallback).toBe('[1/2] 上传中')
  })

  it('增量同步开启 → 用同步记录构建历史指纹映射并透传', async () => {
    m.isIncrementalSyncEnabled.mockReturnValue(true)
    m.getAllSyncRecords.mockReturnValue([
      { subjectId: '100', fingerprint: 'fp-100' },
      { subjectId: '', fingerprint: 'fp-noise' },
      { subjectId: '200', fingerprint: '' },
    ])

    await syncFromPanel()

    const previewOptions = m.getSyncPreview.mock.calls[0]?.[4] as {
      incremental: boolean
      fingerprintMap: Map<string, string>
    }
    expect(previewOptions.incremental).toBe(true)
    expect(previewOptions.fingerprintMap.size).toBe(1)
    expect(previewOptions.fingerprintMap.get('100')).toBe('fp-100')
  })

  it('冲突检测抛错 → 记录告警但同步照常继续', async () => {
    m.detectConflicts.mockRejectedValue(new Error('网络不可用'))

    await syncFromPanel()

    expect(m.handleError).toHaveBeenCalledWith(expect.any(Error), {
      showAlert: false,
      level: 1,
      context: 'syncFromPanel',
    })
    expect(m.SyncToBangumiAsync).toHaveBeenCalled()
  })

  it('冲突策略=跳过冲突且有冲突 → 把冲突 SID 集合传给同步层', async () => {
    mountSelect('conflictStrategy', 'skip')
    m.detectConflicts.mockResolvedValue({
      conflicts: [{ row: 2, subjectId: '100', name: '动画A', incomingType: 2 }],
      conflictCount: 1,
      bgmCollectionReady: true,
    })

    await syncFromPanel()

    const options = m.SyncToBangumiAsync.mock.calls[0]?.[5] as { skipSubjectIds?: Set<string> }
    expect(options.skipSubjectIds).toEqual(new Set(['100']))
    expect(String(m.showConfirm.mock.calls[0]?.[0])).toContain('已选择【跳过冲突】')
  })

  it('冲突策略=Excel数据覆盖 → 不传 skipSubjectIds 且确认文案标注覆盖', async () => {
    mountSelect('conflictStrategy', 'excel')
    m.detectConflicts.mockResolvedValue({
      conflicts: [{ row: 2, subjectId: '100', name: '动画A', incomingType: 2 }],
      conflictCount: 1,
      bgmCollectionReady: true,
    })

    await syncFromPanel()

    const options = m.SyncToBangumiAsync.mock.calls[0]?.[5] as { skipSubjectIds?: Set<string> }
    expect(options.skipSubjectIds).toBeUndefined()
    expect(String(m.showConfirm.mock.calls[0]?.[0])).toContain('将使用【Excel数据覆盖】')
  })

  it('同步执行抛错 → 关闭进度框、复位状态栏并交 handleError 弹窗', async () => {
    const app = makeApp()
    m.getApp.mockReturnValue(app)
    m.SyncToBangumiAsync.mockRejectedValue(new Error('boom'))

    await syncFromPanel()

    expect(m.hideSyncProgressDialog).toHaveBeenCalled()
    expect(app.StatusBar).toBe(false)
    expect(m.handleError).toHaveBeenCalledWith(expect.any(Error), {
      context: 'syncFromPanel',
      showAlert: true,
    })
    expect(runtime.isRunning).toBe(false)
  })

  it('用户中途停止 → 完成弹窗标注「被用户停止」', async () => {
    m.SyncToBangumiAsync.mockResolvedValue({ success: 1, fail: 0, skip: 2, stopped: true })

    await syncFromPanel()

    const details = m.completeSyncProgressDialog.mock.calls[0]?.[1] as string[]
    expect(details[0]).toContain('同步被用户停止')
    expect(m.completeSyncProgressDialog.mock.calls[0]?.[2]).toBe(true)
  })

  it('原工作表读取失败 / 数据表激活失败 / 记录表激活失败 → 仅告警不中断', async () => {
    const app = makeApp()
    Object.defineProperty(app.ActiveWorkbook, 'ActiveSheet', {
      get() {
        throw new Error('无活动工作表')
      },
    })
    m.getApp.mockReturnValue(app)
    dataSheet.Activate.mockImplementation(() => {
      throw new Error('激活失败')
    })
    const syncSheet = makeSyncSheet()
    syncSheet.Activate.mockImplementation(() => {
      throw new Error('激活失败')
    })
    m.getOrCreateSyncRecordSheet.mockReturnValue(syncSheet)

    await syncFromPanel()

    expect(m.SyncToBangumiAsync).toHaveBeenCalled()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('获取当前工作表失败'),
    )
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('激活数据工作表失败'),
    )
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('激活同步记录工作表失败'),
    )
  })

  it('成功恢复原工作表 → 记录日志', async () => {
    await syncFromPanel()

    expect(originalSheet.Activate).toHaveBeenCalled()
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('已恢复用户之前的工作表'),
    )
  })

  it('恢复原工作表失败 → 仅告警', async () => {
    originalSheet.Activate.mockImplementation(() => {
      throw new Error('恢复失败')
    })

    await syncFromPanel()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('恢复工作表失败'),
    )
  })
})

// ========== syncCollectionFromBgm ==========

describe('sync · syncCollectionFromBgm', () => {
  it('Token 未设置 → 提示设置 Token', () => {
    m.loadBgToken.mockReturnValue(null)

    syncCollectionFromBgm()

    expect(m.showAlert).toHaveBeenCalledWith(_T.pleaseSetBgmToken)
    expect(m.showConfirm).not.toHaveBeenCalled()
  })

  it('全部收藏 → 类型标签为「全部」', () => {
    m.getListType.mockReturnValue('all')

    syncCollectionFromBgm()

    expect(String(m.showConfirm.mock.calls[0]?.[0])).toContain('你的全部收藏列表')
  })

  it('锁定索引缺失 → 回退读下拉框的工作表索引', () => {
    runtime.lockedIndex = undefined
    mountSelect('sheetSelect', '3')
    m.getListType.mockReturnValue('wish')

    syncCollectionFromBgm()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('目标工作表索引: 3'),
    )
    expect(String(m.showConfirm.mock.calls[0]?.[0])).toContain('你的想看收藏列表')
  })

  it('锁定索引为 NaN → 回退到 1', () => {
    runtime.lockedIndex = NaN

    syncCollectionFromBgm()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('目标工作表索引: 1'),
    )
  })

  it('弹确认框抛错 → 记录并弹错误提示', () => {
    m.showConfirm.mockImplementation(() => {
      throw new Error('弹窗不可用')
    })

    syncCollectionFromBgm()

    expect(m.handleError).toHaveBeenCalledWith(expect.any(Error), {
      context: 'syncCollectionFromBgm',
      showAlert: true,
    })
  })
})

// ========== syncFromBgmByAPI ==========

describe('sync · syncFromBgmByAPI', () => {
  it('Token 未设置 → 提示并打开 Token 对话框', () => {
    m.loadBgToken.mockReturnValue(null)

    syncFromBgmByAPI(2, 'collect')

    expect(m.showAlert).toHaveBeenCalledWith(_T.pleaseSetBgmToken)
    expect(m.showTokenDialog).toHaveBeenCalledWith('')
  })

  it('未指定类型 → 确认文案为「全部」', () => {
    syncFromBgmByAPI(2, null)

    expect(String(m.showConfirm.mock.calls[0]?.[0])).toContain('你的全部收藏列表')
  })

  it('用户在确认框点「否」→ 不发起任何同步', async () => {
    answers.fallback = false

    syncFromBgmByAPI(2, 'collect')
    await tick()

    expect(m.verifyToken).not.toHaveBeenCalled()
    expect(m.setStatus).not.toHaveBeenCalled()
  })
})

// ========== _doAPISync（经 syncFromBgmByAPI 的确认回调驱动）==========

/** 触发「从 BGM 同步」并等所有 microtask 跑完 */
async function runApiSync(): Promise<void> {
  syncFromBgmByAPI(1, 'collect')
  await tick()
}

describe('sync · _doAPISync > 前置校验', () => {
  it('拿不到 Application → 提示并返回', async () => {
    m.getApp.mockReturnValue(null)

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith('无法获取 Application')
  })

  it('Token 校验失败 → 提示失败原因并返回', async () => {
    m.verifyToken.mockResolvedValue({ valid: false, message: 'Token 已过期' })

    await runApiSync()

    expect(m.setStatus).toHaveBeenCalledWith('正在验证 Token...', 'info')
    expect(m.showAlert).toHaveBeenCalledWith('✘ Token 已过期')
    expect(m._setBgmUserId).not.toHaveBeenCalled()
  })

  it('Token 校验通过 → 写入用户 ID', async () => {
    m.verifyToken.mockResolvedValue({ valid: true, message: 'ok', userId: '777' })

    await runApiSync()

    expect(m._setBgmUserId).toHaveBeenCalledWith('777')
    expect(m.setStatus).toHaveBeenCalledWith('正在获取收藏列表...', 'info')
  })

  it('指定类型时把 type 透传给收藏抓取', async () => {
    syncFromBgmByAPI(1, 'wish')
    await tick()

    expect(m.fetchAllUserCollections).toHaveBeenCalledWith(
      'tok-123',
      undefined,
      expect.objectContaining({ type: 'wish' }),
    )
  })

  it('非空表但缺 Bangumi_URL 列 → 提示后返回', async () => {
    m.getColumnMap.mockReturnValue(new Map([['名称', 2]]))

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith('未找到 Bangumi URL 列！')
  })
})

describe('sync · _doAPISync > 空表自动填充', () => {
  it('空表且账号无收藏 → 提示无法填充', async () => {
    m.findHeaderRow.mockReturnValue(0)
    m.getLastRow.mockReturnValue(0)
    m.fetchAllUserCollections.mockResolvedValue([])

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith(
      '当前工作表为空，且 Bangumi 账号暂无收藏数据，无法填充。',
    )
  })

  it('空表且用户取消填充 → 不写表头', async () => {
    m.findHeaderRow.mockReturnValue(0)
    m.getLastRow.mockReturnValue(0)
    m.fetchAllUserCollections.mockResolvedValue([collection()])
    // 第 1 次：开始同步；第 2 次：取消空表填充
    answers.queue.push(true, false)

    await runApiSync()

    expect(m.ensureSheetHeaders).not.toHaveBeenCalled()
    expect(m.setStatus).not.toHaveBeenCalledWith('正在填充收藏数据到 Excel...', 'info')
  })

  it('空表 + 无法写入标准表头 → 提示检查工作表状态', async () => {
    m.findHeaderRow.mockReturnValue(0)
    m.getLastRow.mockReturnValue(0)
    m.fetchAllUserCollections.mockResolvedValue([collection()])
    m.ensureSheetHeaders.mockReturnValue(false)

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith('工作表为空且无法写入标准表头，请检查工作表状态。')
  })

  it('写表头后仍缺 Bangumi_URL 列 → 提示检查模板', async () => {
    m.findHeaderRow.mockReturnValueOnce(0).mockReturnValue(1)
    m.getColumnMap.mockReturnValue(new Map())
    m.getLastRow.mockReturnValue(0)
    m.fetchAllUserCollections.mockResolvedValue([collection()])

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith('写入标准表头后仍未找到 Bangumi URL 列，请检查模板。')
  })

  it('一条都没写进去 → 提示检查工作表是否可编辑', async () => {
    setEmptySheet()
    m.fetchAllUserCollections.mockResolvedValue([collection()])
    // 矩形写抛错 → 回退逐格 setCellValue；逐格也全失败 → written=0
    shouldValue2Throw = true
    m.setCellValue.mockReturnValue(false)

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith('未能写入任何收藏数据，请检查工作表是否可编辑。')
  })

  it('填充后没有可处理数据行 → 提示', async () => {
    setEmptySheet(0, 1)
    m.fetchAllUserCollections.mockResolvedValue([collection()])

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith('没有需要处理的数据行！')
  })

  it('填充成功 → 批量矩形写入单元格并进入同步流程', async () => {
    setEmptySheet()
    m.fetchAllUserCollections.mockResolvedValue([
      collection({ subject_id: 100, subject: { name_cn: '动画A', name: 'AnimeA' } }),
    ])

    await runApiSync()

    expect(m.ensureSheetHeaders).toHaveBeenCalled()
    expect(m.clearSheetCache).toHaveBeenCalled()
    // §5.6 A3：一条收藏 = 一次矩形写（旧实现是 ~5 次逐格 setCellValue）
    expect(value2Writes).toHaveLength(1)
    expect(value2Writes[0]?.address).toBe('A2:I2')
    expect(value2Writes[0]?.value).toEqual([
      ['https://bgm.tv/subject/100', '动画A', '是', null, null, null, null, null, 1],
    ])
    expect(m.showSyncProgressDialog).toHaveBeenCalledWith(
      '正在收藏下载',
      expect.any(Object),
      '配置摘要',
    )
    expect(m.completeSyncProgressDialog).toHaveBeenCalled()
  })

  it('批量写：连续行合并为一次矩形写，空值列写回旧值基底（§5.6 A3）', async () => {
    setEmptySheet()
    m.fetchAllUserCollections.mockResolvedValue([
      collection({ subject_id: 100, subject: { name_cn: '动画A', name: 'AnimeA' } }),
      collection({ subject_id: 200, subject: { name_cn: '动画B', name: 'AnimeB' } }),
    ])

    await runApiSync()

    // 2 条收藏 → 1 次矩形写（列跨度 1..序列号列 9）
    expect(value2Writes).toHaveLength(1)
    expect(value2Writes[0]?.address).toBe('A2:I3')
    expect(value2Writes[0]?.value).toEqual([
      ['https://bgm.tv/subject/100', '动画A', '是', null, null, null, null, null, 1],
      ['https://bgm.tv/subject/200', '动画B', '是', null, null, null, null, null, 2],
    ])
    // 批量路径不再逐格写
    expect(m.setCellValue).not.toHaveBeenCalled()
  })

  it('矩形写抛错 → 回退逐格 setCellValue（保留逐格失败口径）', async () => {
    setEmptySheet()
    m.fetchAllUserCollections.mockResolvedValue([
      collection({ subject_id: 100, subject: { name_cn: '动画A', name: 'AnimeA' } }),
      collection({ subject_id: 200, subject: { name_cn: '动画B', name: 'AnimeB' } }),
    ])
    shouldValue2Throw = true

    await runApiSync()

    // 每行 4 个待写列（Bangumi_URL / 名称 / 是否看完 / 序列号）
    expect(m.setCellValue).toHaveBeenCalledTimes(8)
    expect(m.setCellValue).toHaveBeenCalledWith(
      expect.anything(),
      2,
      1,
      'https://bgm.tv/subject/100',
    )
    expect(m.setCellValue).toHaveBeenCalledWith(expect.anything(), 3, 9, 2)
    expect(m.setStatus).toHaveBeenCalledWith('收藏数据填充完成：2/2', 'info')
  })

  it('无 subject_id 的条目不写，且断开矩形区间', async () => {
    setEmptySheet()
    m.fetchAllUserCollections.mockResolvedValue([
      collection({ subject_id: 100 }),
      collection({ subject_id: 0 }),
      collection({ subject_id: 300 }),
    ])

    await runApiSync()

    // 第 2 条无 subject_id：行 3 不写 → 行 2 与行 4 各自一次矩形写
    expect(value2Writes.map((write) => write.address)).toEqual(['A2:I2', 'A4:I4'])
    // 序列号仍按条目下标（第 3 条 → 3）
    expect((value2Writes[1]?.value as unknown[][] | undefined)?.[0]?.[8]).toBe(3)
    expect(m.setStatus).toHaveBeenCalledWith('收藏数据填充完成：2/3', 'info')
  })

  it('每 50 条让出一次事件循环并刷新状态', async () => {
    setEmptySheet()
    m.fetchAllUserCollections.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => collection({ subject_id: index + 1 })),
    )

    await runApiSync()

    expect(m.setStatus).toHaveBeenCalledWith('正在填充收藏数据：50/50', 'info')
    expect(m.setStatus).toHaveBeenCalledWith(
      expect.stringContaining('收藏数据填充完成：50/50'),
      'info',
    )
  })
})

describe('sync · _doAPISync > 两阶段同步流程', () => {
  it('已有同步在运行 → 拒绝重入', async () => {
    runtime.isRunning = true

    await runApiSync()

    expect(m.showAlert).toHaveBeenCalledWith('同步正在进行中，请稍后再试', '提示')
    expect(m.showSyncProgressDialog).not.toHaveBeenCalled()
  })

  it('匹配到收藏 → 按同步记录条数分别涂 1/2/3 种底色', async () => {
    m.getLastRow.mockReturnValue(3)
    m.fetchAllUserCollections.mockResolvedValue([
      collection({ subject_id: 100 }),
      collection({ subject_id: 200 }),
    ])
    // 第 1 次（计数初始化）为空，第 2 次（重读）给出 2 条 100 + 3 条 200
    m.getAllSyncRecords
      .mockReturnValueOnce([])
      .mockReturnValue([
        { subjectId: '100' },
        { subjectId: '100' },
        { subjectId: '200' },
        { subjectId: '200' },
        { subjectId: '200' },
      ])
    cells.set('2:1', { Value: 'https://bgm.tv/subject/100' })
    cells.set('3:1', { Value: 'https://bgm.tv/subject/200' })
    cells.set('2:9', { Value: '', Interior: { Color: 0 } })
    cells.set('3:9', { Value: '', Interior: { Color: 0 } })

    await runApiSync()

    expect((cells.get('2:9') as { Interior: { Color: number } }).Interior.Color).toBe(
      BGM_COLOR.LIGHT_GREEN,
    )
    expect((cells.get('3:9') as { Interior: { Color: number } }).Interior.Color).toBe(
      BGM_COLOR.DARK_GREEN,
    )
    expect(m.updatePosition).toHaveBeenCalled()
    expect(m.completeSyncProgressDialog).toHaveBeenCalled()
  })

  it('同步记录恰好 1 条 → 涂 BGM_SYNC 底色', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])
    m.getAllSyncRecords.mockReturnValueOnce([]).mockReturnValue([{ subjectId: '100' }])
    cells.set('2:1', { Value: 'https://bgm.tv/subject/100' })
    cells.set('2:9', { Value: '', Interior: { Color: 0 } })

    await runApiSync()

    expect((cells.get('2:9') as { Interior: { Color: number } }).Interior.Color).toBe(
      BGM_COLOR.BGM_SYNC,
    )
    const stage2 = m.updateSyncProgressDialog.mock.calls.at(-1) as string[]
    expect(String(stage2[3])).toContain('匹配 SID=100')
  })

  it('序列号单元格没有 Interior → 只计数不涂色', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])
    m.getAllSyncRecords.mockReturnValueOnce([]).mockReturnValue([{ subjectId: '100' }])
    cells.set('2:1', { Value: 'https://bgm.tv/subject/100' })
    cells.set('2:9', { Value: '' })

    await runApiSync()

    const summary = String(m.completeSyncProgressDialog.mock.calls[0]?.[0])
    expect(summary).toContain('匹配标记: 1')
  })

  it('URL 为空 → 该行不匹配，进度文案标记「未匹配」', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])
    cells.set('2:1', { Value: '' })

    await runApiSync()

    const last = m.updateSyncProgressDialog.mock.calls.at(-1) as string[]
    expect(String(last[3])).toContain('未匹配')
    expect(String(m.completeSyncProgressDialog.mock.calls[0]?.[0])).toContain('匹配标记: 0')
  })

  it('取不到 URL 单元格 → 该行视为未匹配', async () => {
    m.getCell.mockReturnValue(null)
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    expect(String(m.completeSyncProgressDialog.mock.calls[0]?.[0])).toContain('匹配标记: 0')
  })

  it('同步记录写入失败 → toast 提示未登记条数', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])
    m.addSyncRecords.mockReturnValue(false)

    await runApiSync()

    expect(m.showToast).toHaveBeenCalledWith(
      expect.stringContaining('同步记录写入失败：1 条收藏未登记'),
      'error',
    )
    // 失败也必须继续走阶段 2
    expect(m.completeSyncProgressDialog).toHaveBeenCalled()
  })

  it('阶段1 记录写入内容的字段映射正确', async () => {
    m.fetchAllUserCollections.mockResolvedValue([
      collection({ subject_id: 100, subject_type: 2, type: 2, subject: {} }),
    ])

    await runApiSync()

    const records = m.addSyncRecords.mock.calls[0]?.[0]
    expect(records?.[0]).toMatchObject({
      name: '(无名称)',
      url: 'https://bgm.tv/subject/100',
      subjectId: '100',
      type: BGM_SUBJECT_TYPES[2],
      content: '标记同步',
      status: '成功',
      count: 1,
      collType: COLLECTION_TYPE_NAMES[2],
    })
  })

  it('检测到停止请求 → 两阶段都提前中断，完成弹窗标注停止', async () => {
    m.checkShouldStop.mockReturnValue(true)
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    const details = m.completeSyncProgressDialog.mock.calls[0]?.[1] as string[]
    expect(details[0]).toContain('同步被用户停止')
    expect(m.completeSyncProgressDialog.mock.calls[0]?.[2]).toBe(true)
  })

  it('暂停后恢复 → 两个阶段都会等待恢复', async () => {
    m.checkPaused.mockReturnValue(true)
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    expect(m.waitForResume).toHaveBeenCalledTimes(2)
  })

  it('同步记录工作表激活失败 / 切回数据表失败 → 仅告警', async () => {
    const syncSheet = makeSyncSheet()
    syncSheet.Activate.mockImplementation(() => {
      throw new Error('激活失败')
    })
    m.getOrCreateSyncRecordSheet.mockReturnValue(syncSheet)
    dataSheet.Activate.mockImplementation(() => {
      throw new Error('切回失败')
    })
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('激活同步记录工作表失败'),
    )
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('切回数据工作表失败'),
    )
  })

  it('流程内抛错 → 关进度框、交 handleError、弹错误并置状态栏为失败', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])
    m.addSyncRecords.mockImplementation(() => {
      throw new Error('写盘失败')
    })

    await runApiSync()

    expect(m.hideSyncProgressDialog).toHaveBeenCalled()
    expect(m.handleError).toHaveBeenCalledWith(expect.any(Error), {
      showAlert: false,
      level: 1,
      context: '_doAPISync',
    })
    expect(m.showAlert).toHaveBeenCalledWith(`${_T.syncFailed}写盘失败`, _T.syncFailed)
    expect(m.setStatus).toHaveBeenCalledWith(_T.syncFailed, 'error')
    expect(runtime.isRunning).toBe(false)
  })

  it('恢复原工作表失败 → 仅告警，不冒泡', async () => {
    originalSheet.Activate.mockImplementation(() => {
      throw new Error('恢复失败')
    })
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('恢复原始工作表失败'),
    )
  })

  it('成功结束 → 日志给出同步统计四行', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    expect(m.bgmLog).toHaveBeenCalledWith(
      LOG_LEVELS.INFO,
      '[_doAPISync] ========== 同步统计 ==========',
    )
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('BGM 收藏总数: 1'),
    )
  })
})

// ========== 补充分支 ==========

describe('sync · 补充分支', () => {
  it('空表填充会把别名/类别/打分/标签/剧透五个可选列一并写入', async () => {
    m.findHeaderRow.mockReturnValueOnce(0).mockReturnValue(1)
    m.getColumnMap.mockReturnValueOnce(new Map()).mockReturnValue(richColMap())
    m.getLastRow.mockReturnValueOnce(0).mockReturnValue(3)
    m.fetchAllUserCollections.mockResolvedValue([
      collection({
        subject_id: 100,
        subject_type: 4,
        type: 2,
        rate: 8,
        tags: ['TV', '原创'],
        comment: '很好看',
        subject: { name_cn: '动画A', name: 'AnimeA' },
      }),
    ])

    await runApiSync()

    // §5.6 A3：改为矩形写——从批量矩阵按列下标（column-1）断言五个可选列
    expect(value2Writes).toHaveLength(1)
    expect(value2Writes[0]?.address).toBe('A2:L2')
    const matrix = value2Writes[0]?.value as unknown[][] | undefined
    const line = matrix?.[0]
    expect(line?.[9]).toBe('AnimeA')
    expect(line?.[10]).toBe(BGM_SUBJECT_TYPES[4])
    expect(line?.[3]).toBe(8)
    expect(line?.[4]).toBe('TV, 原创')
    expect(line?.[11]).toBe('很好看')
    expect(line?.[2]).toBe('是')
  })

  it('syncFromPanel 进度框的暂停/恢复/停止回调接到 BGM.sync', async () => {
    await syncFromPanel()

    const handlers = m.showSyncProgressDialog.mock.calls[0]?.[1] as {
      onPause: () => void
      onResume: () => void
      onStop: () => void
    }
    handlers.onPause()
    handlers.onResume()
    handlers.onStop()

    expect(m.pause).toHaveBeenCalled()
    expect(m.resume).toHaveBeenCalled()
    expect(m.requestStop).toHaveBeenCalled()
  })

  it('收藏下载进度框的暂停/恢复/停止回调同样接到 BGM.sync', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    const call = m.showSyncProgressDialog.mock.calls.find((entry) => entry[0] === '正在收藏下载')
    const handlers = call?.[1] as {
      onPause: () => void
      onResume: () => void
      onStop: () => void
    }
    handlers.onPause()
    handlers.onResume()
    handlers.onStop()

    expect(m.pause).toHaveBeenCalled()
    expect(m.resume).toHaveBeenCalled()
    expect(m.requestStop).toHaveBeenCalled()
  })

  it('_doAPISync 取原始工作表失败 → 仅告警并继续', async () => {
    const app = makeApp()
    Object.defineProperty(app.ActiveWorkbook, 'ActiveSheet', {
      get() {
        throw new Error('无活动工作表')
      },
    })
    m.getApp.mockReturnValue(app)
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('获取原始工作表失败'),
    )
    expect(m.completeSyncProgressDialog).toHaveBeenCalled()
  })

  it('进入流程前已有同步记录 → 计数映射在初始化阶段就统计条数', async () => {
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])
    // 首次 getAllSyncRecords（初始化计数）即返回 1 条 → 命中 for 循环体
    m.getAllSyncRecords.mockReturnValue([{ subjectId: '100' }])
    cells.set('2:1', { Value: 'https://bgm.tv/subject/100' })
    cells.set('2:9', { Value: '', Interior: { Color: 0 } })

    await runApiSync()

    expect((cells.get('2:9') as { Interior: { Color: number } }).Interior.Color).toBe(
      BGM_COLOR.BGM_SYNC,
    )
  })

  it('阶段1 恢复后再次看到停止请求 → 立即跳出', async () => {
    m.checkPaused.mockReturnValue(true)
    // 第 1 次：阶段1 循环头；第 2 次：恢复后复查 → break
    m.checkShouldStop.mockReturnValueOnce(false).mockReturnValueOnce(true)
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    // 恢复后复查命中停止 → 收藏条目一条都没进批次
    expect(m.waitForResume).toHaveBeenCalled()
    expect(m.addSyncRecords).toHaveBeenCalledWith([])
  })

  it('阶段2 恢复后再次看到停止请求 → 立即跳出并标注停止', async () => {
    // 阶段1 不暂停；阶段2 暂停一次，恢复后复查命中停止
    m.checkPaused.mockReturnValueOnce(false).mockReturnValue(true)
    // 调用序：阶段1 循环头 → 阶段1 恢复后复查 → 阶段2 循环头 → 阶段2 恢复后复查（break）
    m.checkShouldStop
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    m.fetchAllUserCollections.mockResolvedValue([collection({ subject_id: 100 })])

    await runApiSync()

    expect(m.waitForResume).toHaveBeenCalledTimes(1)
    // 恢复后复查命中停止 → 直接 break，阶段2 循环体（getCell/涂色）一次都没执行
    expect(m.getCell).not.toHaveBeenCalled()
    expect(m.completeSyncProgressDialog).toHaveBeenCalled()
  })
})
