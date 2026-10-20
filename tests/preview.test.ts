// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/preview.ts` 单元测试。
 *
 * 这个文件的依赖收敛在「一个 barrel + 四个叶子模块」上（`../index.js`、
 * `core/ui-bridge`、`sync/sync-record`、`tools/sanitize`、`tools/utility`），
 * 因此不需要拆文件：mock 掉 barrel 一层就能驱动全部真实实现，断言的是真实
 * DOM 输出、真实进度弹窗调用顺序、真实统计数字，而不是 mock 自身的行为。
 *
 * 三个刻意的选择：
 *  1. `core/constants.js` **不 mock** —— 模块顶层用真实 `WATCH_STATUS_MAP`
 *     构造 `VALID_STATUSES`，mock 掉会让状态筛选器恒空、断言失去意义。
 *  2. 假工作表用「行:列 → 值」的字典 + 两个 mock 读取器（`getCellValue` /
 *     `getCell`），而不是伪造整个 COM Range；颜色标记只需要 `Interior.Color`。
 *  3. `sanitizeHtml` mock 成恒等函数：真实实现在 jsdom 下走降级路径，
 *     断言的是被测代码拼出来的 HTML 结构，不是清洗器的行为（清洗器另有测试）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 模块求值期的注册次数：`vi.clearAllMocks()` 会清掉 mock.calls，
 * 而这个注册发生在 import 阶段（早于任何 beforeEach），因此用独立计数器记录。
 */
const registered = vi.hoisted(() => ({ count: 0 }))

/** 状态机的可变部分单独持有：用于驱动「读取 isRunning 时抛错」这类场景 */
const syncState = vi.hoisted(() => ({ running: false, throwOnIsRunningRead: false }))

/**
 * `Interior` 属性读取次数：WPS 的 Range 是跨进程 COM 代理，每次属性读都是一次
 * 进程间往返。预览对每条数据行都要读一次序列号格的 Interior.Color 判「已上传」，
 * 这个计数器守住「每行只读一次 Interior」——旧写法判空后又把 Interior 读了一遍。
 */
const interiorReads = vi.hoisted(() => ({ value: 0 }))

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: number, message: string) => void>(),
  /** 形状与真实 handleError 一致：返回对象且调用方可改写 message */
  handleError: vi.fn((error: unknown) => {
    let message = ''
    if (error instanceof Error) {
      message = error.message
    } else if (typeof error === 'string') {
      message = error
    }
    return { message }
  }),
  showToast: vi.fn<(message: string, type?: string) => void>(),
  showAlert: vi.fn<(message: string, title?: string) => void>(),
  wpsMessageBox: vi.fn(() => Promise.resolve()),
  getApp: vi.fn((): unknown => null),
  getCellValue: vi.fn((_ws: unknown, _row: number, _col: number): string => ''),
  // 矩形读必须与逐格读来自同一份数据源：矩形读只是逐格读的批量形态，
  // 两者不一致时生产代码走快路径就会读到空表（桩不忠实，改桩不改生产）。
  readRangeValues: vi.fn(
    (_ws: unknown, r1: number, r2: number, c1: number, c2: number): string[][] => {
      const out: string[][] = []
      for (let row = r1; row <= r2; row += 1) {
        const line: string[] = []
        for (let col = c1; col <= c2; col += 1) {
          // 与真实实现一致：单格读取失败按空串处理，不让整块读失败
          try {
            line.push(mocks.getCellValue(_ws, row, col))
          } catch {
            line.push('')
          }
        }
        out.push(line)
      }
      return out
    },
  ),
  trim: vi.fn((value: unknown) => (typeof value === 'string' ? value : '').trim()),
  getCell: vi.fn((_ws: unknown, _row: number, _col: number): unknown => null),
  escapeHtml: vi.fn((text: unknown) => {
    const raw = typeof text === 'string' ? text : ''
    return raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  }),
  findHeaderRow: vi.fn(() => 1),
  getColumnMap: vi.fn(() => new Map<string, number>()),
  detectConflicts: vi.fn(async () => ({ conflictCount: 0 })),
  extractSubjectId: vi.fn((url: string) => /subject\/(\d+)/.exec(url)?.[1] ?? null),
  mapWatchStatus: vi.fn(
    (status: string) => ({ 想看: 1, 看过: 2, 在看: 3, 搁置: 4, 抛弃: 5 })[status.trim()] ?? 0,
  ),
  buildJsonPayload: vi.fn((_getField: (key: string) => string): string => '{"type":2}'),
  bgmRequestSync: vi.fn(async () => ({ code: 200, message: '' })),
  addSyncRecord: vi.fn(() => true),
  addTagsFromString: vi.fn((target: Set<string>, raw: string) => {
    for (const piece of raw.split('|')) {
      const tag = piece.trim()
      if (tag) target.add(tag)
    }
  }),
  syncToBangumi: vi.fn(
    async (
      _ws: unknown,
      _colMap: unknown,
      _token: string,
      _lastRow: number,
      _headerRow: number,
      _options?: {
        onProgress?: (current: number, total: number, message: string) => void
        onItemComplete?: (row: number, isSuccess: boolean, result: unknown) => void
      },
    ) => ({ success: 1, fail: 0, skip: 0, stopped: false }),
  ),
  showSyncProgressDialog:
    vi.fn<
      (
        title: string,
        handlers: { onPause: () => void; onResume: () => void; onStop: () => void },
        config?: unknown,
      ) => void
    >(),
  updateSyncProgressDialog:
    vi.fn<(current: number, total: number, message?: string, logLine?: string) => void>(),
  completeSyncProgressDialog:
    vi.fn<(summary: string, details: string[], isStopped?: boolean) => void>(),
  hideSyncProgressDialog: vi.fn<() => void>(),
  buildSyncConfig: vi.fn((input: unknown) => input),
  getUserApiPath: vi.fn(() => 'me'),
  registerSyncRunner: vi.fn(() => {
    registered.count += 1
  }),
  getAllSyncRecords: vi.fn((): unknown[] => []),
  sanitizeHtml: vi.fn((html: string) => html),
  loadBgToken: vi.fn((): string | null => 'token-abc'),
  sheet: { lockedIndex: null as number | null },
  dataPreview: null as Record<string, unknown> | null,
  sync: {
    get isRunning() {
      if (syncState.throwOnIsRunningRead) throw new Error('状态机坏了')
      return syncState.running
    },
    set isRunning(value: boolean) {
      syncState.running = value
    },
    pause: vi.fn(),
    resume: vi.fn(),
    requestStop: vi.fn(),
    enterRunningState: vi.fn(() => true),
    exitRunningState: vi.fn(),
    updatePosition: vi.fn(),
    checkShouldStop: vi.fn(() => false),
    checkPaused: vi.fn(() => false),
    waitForResume: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('../ts/index.js', () => ({
  getApp: mocks.getApp,
  bgmLog: mocks.bgmLog,
  BGM: {
    sheet: mocks.sheet,
    sync: mocks.sync,
    handleError: mocks.handleError,
    ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
    get dataPreview() {
      return mocks.dataPreview
    },
  },
  getCellValue: mocks.getCellValue,
  readRangeValues: mocks.readRangeValues,
  trim: mocks.trim,
  _getUserApiPath: mocks.getUserApiPath,
  wpsMessageBox: mocks.wpsMessageBox,
  getCell: mocks.getCell,
  escapeHtml: mocks.escapeHtml,
  showAlert: mocks.showAlert,
  showToast: mocks.showToast,
  findHeaderRow: mocks.findHeaderRow,
  getColumnMap: mocks.getColumnMap,
  detectConflicts: mocks.detectConflicts,
  extractSubjectId: mocks.extractSubjectId,
  mapWatchStatus: mocks.mapWatchStatus,
  buildJsonPayload: mocks.buildJsonPayload,
  bgmRequestSync: mocks.bgmRequestSync,
  addSyncRecord: mocks.addSyncRecord,
  addTagsFromString: mocks.addTagsFromString,
  SyncToBangumiAsync: mocks.syncToBangumi,
  showSyncProgressDialog: mocks.showSyncProgressDialog,
  buildSyncConfig: mocks.buildSyncConfig,
  updateSyncProgressDialog: mocks.updateSyncProgressDialog,
  completeSyncProgressDialog: mocks.completeSyncProgressDialog,
  hideSyncProgressDialog: mocks.hideSyncProgressDialog,
}))

vi.mock('../ts/core/ui-bridge.js', () => ({ registerSyncRunner: mocks.registerSyncRunner }))
vi.mock('../ts/sync/sync-record.js', () => ({
  // 用 getter 暴露，便于个别用例临时把该导出置为 undefined，
  // 驱动 `typeof getAllSyncRecords !== 'function'` 的降级分支。
  get getAllSyncRecords(): unknown {
    return mocks.getAllSyncRecords
  },
}))
vi.mock('../ts/tools/sanitize.js', () => ({ sanitizeHtml: mocks.sanitizeHtml }))
vi.mock('../ts/tools/util/index.js', () => ({ loadBgToken: mocks.loadBgToken }))

import { BGM_COLOR } from '../ts/core/constants.js'
import {
  closeDetailModal,
  previewSyncContent,
  showDetailModal,
  syncAllRows,
  uploadSingleRow,
  viewSyncRecordDetail,
} from '../ts/ui/preview.js'

// ========== 假工作表 ==========

/** 单元格内容：键为 `"行:列"`（1-based） */
let cells: Record<string, string> = {}

function makeColMap(): Map<string, number> {
  return new Map([
    ['序列号', 1],
    ['名称', 2],
    ['Bangumi_URL', 3],
    ['是否看完', 4],
    ['打分', 5],
    ['标签/分级', 6],
    ['完播日', 7],
  ])
}

/** 两张有效行（含 URL / SID / 名称）+ 一张无 URL 行 */
function makeRows(): Record<string, string> {
  return {
    '2:1': '1',
    '2:2': '动画A',
    '2:3': 'https://bgm.tv/subject/100',
    '2:4': '看过',
    '2:5': '8',
    '2:6': '标签A|标签B',
    '3:1': '2',
    '3:2': '动画B',
    '3:3': 'https://bgm.tv/subject/200',
    '3:4': '在看',
    '4:1': '3',
  }
}

/** 已上传标记用颜色表达：返回真实 BGM_COLOR.SUCCESS 才算已上传 */
let uploadedRows = new Set<number>()

function setDataPreview(overrides: Record<string, unknown> = {}): void {
  mocks.dataPreview = {
    worksheet: { Name: '动画' },
    visibleRows: [1, 2, 3],
    headerRow: 1,
    dataStartRow: 2,
    ...overrides,
  }
}

function mountDiv(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.id = id
  document.body.append(element)
  return element
}

function mountSelect(id: string, value = ''): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  if (value !== '') {
    const option = document.createElement('option')
    option.value = value
    select.append(option)
  }
  select.value = value
  document.body.append(select)
  return select
}

function mountUploadButton(): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'upload-single-btn'
  button.dataset.row = '2'
  document.body.append(button)
  return button
}

/** 预览模态框：可分别裁掉 .modal-body / .modal-header 以驱动早退分支 */
function mountPreviewModal(options: { withBody?: boolean; withHeader?: boolean } = {}): {
  modal: HTMLDivElement
  body: HTMLDivElement | null
} {
  const modal = document.createElement('div')
  modal.id = 'syncPreviewModal'
  if (options.withHeader !== false) {
    const header = document.createElement('div')
    header.className = 'modal-header'
    modal.append(header)
  }
  let body: HTMLDivElement | null = null
  if (options.withBody !== false) {
    body = document.createElement('div')
    body.className = 'modal-body'
    // jsdom 不实现 scrollTo：补一个桩，让滚动按钮的点击监听可被驱动
    Reflect.set(body, 'scrollTo', vi.fn())
    modal.append(body)
  }
  document.body.append(modal)
  return { modal, body }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  cells = makeRows()
  uploadedRows = new Set<number>()
  mocks.dataPreview = null
  mocks.sheet.lockedIndex = null
  syncState.throwOnIsRunningRead = false
  mocks.sync.isRunning = false
  mocks.sync.enterRunningState.mockReturnValue(true)
  mocks.sync.checkShouldStop.mockReturnValue(false)
  mocks.sync.checkPaused.mockReturnValue(false)
  mocks.sync.waitForResume.mockResolvedValue(undefined)
  mocks.getApp.mockReturnValue(null)
  mocks.getColumnMap.mockReturnValue(makeColMap())
  mocks.getCellValue.mockImplementation(
    (_ws: unknown, row: number, col: number) => cells[`${String(row)}:${String(col)}`] ?? '',
  )
  interiorReads.value = 0
  mocks.getCell.mockImplementation((_ws: unknown, row: number) => ({
    get Interior() {
      interiorReads.value += 1
      return { Color: uploadedRows.has(row) ? BGM_COLOR.SUCCESS : BGM_COLOR.WHITE }
    },
  }))
  mocks.detectConflicts.mockResolvedValue({ conflictCount: 0 })
  mocks.bgmRequestSync.mockResolvedValue({ code: 200, message: '' })
  mocks.addSyncRecord.mockReturnValue(true)
  mocks.syncToBangumi.mockResolvedValue({ success: 1, fail: 0, skip: 0, stopped: false })
  mocks.loadBgToken.mockReturnValue('token-abc')
  mocks.getAllSyncRecords.mockReturnValue([])
  mocks.buildJsonPayload.mockReturnValue('{"type":2}')
})

afterEach(() => {
  document.body.replaceChildren()
})

// ========== 模块装配 ==========

describe('preview · 模块装配', () => {
  it('模块求值时就向 ui-bridge 注册了同步执行体', () => {
    expect(registered.count).toBe(1)
  })
})

// ========== previewSyncContent ==========

describe('preview · previewSyncContent', () => {
  it('同步进行中 → 提示并直接返回（不弹进度窗）', async () => {
    mocks.sync.isRunning = true
    setDataPreview()

    await previewSyncContent()

    expect(mocks.showToast).toHaveBeenCalledWith('同步正在进行中，请稍后', 'warn')
    expect(mocks.showSyncProgressDialog).not.toHaveBeenCalled()
  })

  it('未加载预览数据 → 提示先在面板加载', async () => {
    mocks.dataPreview = null

    await previewSyncContent()

    expect(mocks.showToast).toHaveBeenCalledWith('请先在预览面板中加载数据', 'warn')
    expect(mocks.showSyncProgressDialog).not.toHaveBeenCalled()
  })

  it('可见行过滤后为空 → 提示没有可预览的数据行', async () => {
    setDataPreview({ visibleRows: [1] })

    await previewSyncContent()

    expect(mocks.showToast).toHaveBeenCalledWith('没有可预览的数据行', 'info')
    expect(mocks.sync.enterRunningState).not.toHaveBeenCalled()
  })

  it('列映射为空 → 提示无法读取列映射', async () => {
    setDataPreview()
    mocks.getColumnMap.mockReturnValue(new Map<string, number>())

    await previewSyncContent()

    expect(mocks.showToast).toHaveBeenCalledWith('无法读取列映射', 'error')
  })

  it('COM 往返不放大：每条数据行只读一次 Interior（判空后不再重读）', async () => {
    setDataPreview()
    // 第 2 行标记为已上传（绿色）
    uploadedRows = new Set([2])
    mountPreviewModal()

    await previewSyncContent()

    // 夹具的数据行是 [2, 3]（visibleRows [1,2,3] 去掉表头行 1）。
    // 旧写法 `seqCell?.Interior` 判空 + `seqCell.Interior.Color` 取色会把
    // Interior 读两遍 → 2 行应是 4 次；提成局部量后每行固定 1 次。
    // 先证明循环真的跑够了轮数，再证明属性读取没有放大（REF-com-io 范式）。
    expect(mocks.getCell).toHaveBeenCalledTimes(2)
    expect(interiorReads.value).toBe(2)

    // 颜色判定语义不变：第 2 行的卡片仍带 uploaded 类，第 3 行不带
    const row2Card = document.querySelector('.detail-item[data-row="2"]')
    const row3Card = document.querySelector('.detail-item[data-row="3"]')
    expect(row2Card?.classList.contains('uploaded')).toBe(true)
    expect(row3Card?.classList.contains('uploaded')).toBe(false)
  })

  it('拿不到运行状态（enterRunningState 返回 false）→ 不渲染卡片', async () => {
    setDataPreview()
    mountPreviewModal()
    mocks.sync.enterRunningState.mockReturnValue(false)

    await previewSyncContent()

    expect(mocks.sync.exitRunningState).not.toHaveBeenCalled()
    expect(document.getElementById('syncPreviewModal')?.style.display).toBe('')
  })

  it('正常流程：渲染卡片、统计、状态筛选器与完成弹窗', async () => {
    setDataPreview()
    const { modal, body } = mountPreviewModal()
    const syncAllButton = document.createElement('button')
    syncAllButton.id = 'syncAllBtn'
    modal.querySelector('.modal-header')?.append(syncAllButton)
    mountDiv('scrollToTopBtn')
    mountDiv('scrollToBottomBtn')
    // 第 3 行拿不到 Interior（宿主返回裸对象）→ 已上传判定走「无 Interior」早退
    const baseGetCell = mocks.getCell.getMockImplementation()
    mocks.getCell.mockImplementation((worksheet: unknown, row: number, col: number) =>
      row === 3 ? null : baseGetCell?.(worksheet, row, col),
    )

    await previewSyncContent()

    // 进度弹窗按「显示 → 逐行更新 → 完成」顺序驱动
    expect(mocks.showSyncProgressDialog).toHaveBeenCalledWith(
      '正在同步 - 预览同步',
      expect.anything(),
      expect.anything(),
    )
    expect(mocks.updateSyncProgressDialog).toHaveBeenCalledTimes(2)
    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.stringContaining('卡片 2'),
      expect.arrayContaining(['渲染卡片: 2', '跳过行数: 0', '错误行数: 0']),
      false,
    )

    // 卡片真实落到 DOM，统计卡片跟着卡片数走
    expect(body?.innerHTML).toContain('动画A')
    expect(body?.innerHTML).toContain('动画B')
    expect(body?.innerHTML).toContain('stat-grid')
    expect(modal.style.display).toBe('block')

    // 状态下拉：全部 + 卡片里出现过的标准状态（看过 / 在看）
    const select = document.getElementById('statusFilterSelect') as HTMLSelectElement | null
    expect(select).not.toBeNull()
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual([
      'all',
      '在看',
      '看过',
    ])
    expect(select?.value).toBe('all')

    expect(mocks.sync.enterRunningState).toHaveBeenCalledTimes(1)
    expect(mocks.sync.exitRunningState).toHaveBeenCalledTimes(1)
    // 位置更新：一次定位到表头列，一次逐行
    expect(mocks.sync.updatePosition).toHaveBeenCalledWith(expect.anything(), 0, 3)
    expect(mocks.sync.updatePosition).toHaveBeenCalledWith(undefined, 2)

    // 进度弹窗的暂停/恢复/停止回调直接驱动状态机
    const handlers = mocks.showSyncProgressDialog.mock.calls[0]?.[1]
    handlers?.onPause()
    handlers?.onResume()
    handlers?.onStop()
    expect(mocks.sync.pause).toHaveBeenCalledTimes(1)
    expect(mocks.sync.resume).toHaveBeenCalledTimes(1)
    expect(mocks.sync.requestStop).toHaveBeenCalledTimes(1)

    // 「全部同步」按钮的点击回调（内部是异步 IIFE，需让出一轮宏任务）
    mocks.loadBgToken.mockReturnValue(null)
    document.getElementById('syncAllBtn')?.click()
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(mocks.showToast).toHaveBeenCalledWith('请先设置 Bangumi Token', 'warn')
  })

  it('已上传行计入统计，待上传 = 有状态行 − 已上传', async () => {
    setDataPreview()
    mountPreviewModal()
    uploadedRows = new Set([2])

    await previewSyncContent()

    const statsHtml = mocks.sanitizeHtml.mock.calls.at(-1)?.[0] ?? ''
    expect(statsHtml).toContain('stat-card-success')
    // 总行数 2（两张卡片）、已上传 1
    expect(statsHtml).toContain('>2</div>')
  })

  it('无 URL 行与空卡片行被跳过，异常行计入错误', async () => {
    setDataPreview({ visibleRows: [1, 2, 3, 4, 5] })
    mountPreviewModal()
    // 第 4 行：有名称但无 URL → 跳过
    cells['4:2'] = '动画C'
    // 第 5 行：有 URL 但读取时抛错 → 错误
    cells['5:3'] = 'https://bgm.tv/subject/500'
    const original = mocks.getCellValue.getMockImplementation()
    mocks.getCellValue.mockImplementation((worksheet: unknown, row: number, col: number) => {
      if (row === 5) throw new Error('读取越界')
      return original?.(worksheet, row, col) ?? ''
    })

    // 本用例覆盖的是「逐格读抛错 ⇒ 计入错误行」：矩形读可用时整块读成功，
    // 单格不会失败（真实宿主同样如此），故显式让矩形读不可用，走回退路径。
    const originalRect = mocks.readRangeValues.getMockImplementation()
    mocks.readRangeValues.mockReturnValue([])

    await previewSyncContent()

    if (originalRect) mocks.readRangeValues.mockImplementation(originalRect)

    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.stringContaining('错误: 1'),
      expect.arrayContaining(['跳过行数: 1', '错误行数: 1']),
      false,
    )
  })

  it('空卡片行（无名称/状态/标签）被跳过', async () => {
    setDataPreview({ visibleRows: [1, 2, 3] })
    mountPreviewModal()
    // 第 2 行：URL 与 SID 有，但名称/状态/标签全空 → 空卡片
    cells['2:2'] = ''
    cells['2:4'] = ''
    cells['2:6'] = ''

    await previewSyncContent()

    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.stringContaining('卡片 1'),
      expect.arrayContaining(['跳过行数: 1']),
      false,
    )
  })

  it('用户请求停止 → 提前终止并在详情里标注', async () => {
    setDataPreview()
    mountPreviewModal()
    // 第一行之后收到停止请求
    mocks.sync.checkShouldStop
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValue(true)

    await previewSyncContent()

    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['⚠️ 预览被用户停止']),
      true,
    )
  })

  it('暂停后恢复：等待恢复信号再继续', async () => {
    setDataPreview()
    mountPreviewModal()
    mocks.sync.checkPaused.mockReturnValueOnce(true).mockReturnValue(false)

    await previewSyncContent()

    expect(mocks.sync.waitForResume).toHaveBeenCalledTimes(1)
    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.stringContaining('卡片 2'),
      expect.anything(),
      false,
    )
  })

  it('暂停期间收到停止请求 → 终止且不再等待', async () => {
    setDataPreview()
    mountPreviewModal()
    mocks.sync.checkPaused.mockReturnValueOnce(true).mockReturnValue(false)
    // 第一次 checkShouldStop（循环开头）为 false，暂停后那次为 true
    mocks.sync.checkShouldStop
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValue(true)

    await previewSyncContent()

    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['⚠️ 预览被用户停止']),
      true,
    )
  })

  it('模态框缺失 → 在写完完成弹窗后静默返回', async () => {
    setDataPreview()
    document.getElementById('syncPreviewModal')?.remove()

    await previewSyncContent()

    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledTimes(1)
    expect(mocks.sync.exitRunningState).toHaveBeenCalledTimes(1)
  })

  it('modal-body 缺失 → 返回且不创建筛选器', async () => {
    setDataPreview()
    mountPreviewModal({ withBody: false })

    await previewSyncContent()

    expect(document.getElementById('statusFilterSelect')).toBeNull()
    expect(mocks.sync.exitRunningState).toHaveBeenCalledTimes(1)
  })

  it('modal-header 缺失 → 在创建筛选器前返回', async () => {
    setDataPreview()
    mountPreviewModal({ withHeader: false })

    await previewSyncContent()

    expect(document.getElementById('statusFilterSelect')).toBeNull()
  })

  it('没有 syncAllBtn 时筛选器挂到 header 上', async () => {
    setDataPreview()
    const { modal } = mountPreviewModal()

    await previewSyncContent()

    const header = modal.querySelector('.modal-header')
    expect(header?.querySelector('#statusFilterSelect')).not.toBeNull()
  })

  it('切换筛选器按 data-status 隐藏不匹配的卡片', async () => {
    setDataPreview()
    const { body } = mountPreviewModal()

    await previewSyncContent()

    const select = document.getElementById('statusFilterSelect') as HTMLSelectElement
    select.value = '看过'
    select.dispatchEvent(new Event('change'))

    // 第 2 行是「看过」→ 保留；第 3 行是「在看」→ 隐藏
    const items = [...(body?.querySelectorAll<HTMLElement>('.detail-item') ?? [])]
    expect(items).toHaveLength(2)
    expect(items[0]?.dataset.status).toBe('看过')
    expect(items[0]?.style.display).toBe('')
    expect(items[1]?.dataset.status).toBe('在看')
    expect(items[1]?.style.display).toBe('none')
  })

  it('状态下拉按「优先状态在前、非优先（忽略）在后」排序', async () => {
    setDataPreview()
    // ⚠️ 非优先组最多只有「忽略」一个成员：`dataset.status` 恒为 `normalizeStatus()` 的产物，
    //    只可能是 WATCH_STATUS_MAP 反查出的 6 个标准名，其中 5 个已在 priorityStatus 里
    //    → 所以这个下拉的排序**没有比较器可测**（原 `.sort()` 已作为死代码删除，见 preview.ts 该处注释）。
    //    本用例断言的是**可观察的排序结果**：优先组在前、忽略在后。
    // 想看动画 经 normalizeStatus → '想看'（优先组）；忽略 是非优先组唯一成员
    cells['2:4'] = '想看动画'
    cells['3:4'] = '忽略'
    mountPreviewModal()

    await previewSyncContent()

    const select = document.getElementById('statusFilterSelect') as HTMLSelectElement
    const optionValues = [...select.options].map((option) => option.value)
    expect(optionValues[0]).toBe('all')
    expect(optionValues.slice(1)).toEqual(['想看', '忽略'])
  })

  it('滚动按钮按内容是否可滚动切换 hidden 类', async () => {
    setDataPreview()
    const { body } = mountPreviewModal()
    const top = mountDiv('scrollToTopBtn')
    const bottom = mountDiv('scrollToBottomBtn')
    if (body) {
      // 让内容「可滚动」：maxScroll = 300 - 0 > 0
      Object.defineProperties(body, {
        scrollHeight: { value: 300, configurable: true },
        clientHeight: { value: 0, configurable: true },
        scrollTop: { value: 0, configurable: true, writable: true },
      })
    }

    await previewSyncContent()

    // scrollTop = 0 → 顶部按钮隐藏、底部按钮显示
    expect(top.classList.contains('hidden')).toBe(true)
    expect(bottom.classList.contains('hidden')).toBe(false)

    // 点底部按钮 → 调用 scrollTo
    bottom.click()
    const scrollTo = Reflect.get(body ?? {}, 'scrollTo') as ReturnType<typeof vi.fn>
    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' })

    // 滚到底部 → 底部按钮隐藏、顶部按钮显示
    if (body) {
      body.scrollTop = 300
      body.dispatchEvent(new Event('scroll'))
    }
    expect(bottom.classList.contains('hidden')).toBe(true)
    expect(top.classList.contains('hidden')).toBe(false)

    top.click()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('点卡片里的上传按钮触发单条上传', async () => {
    setDataPreview()
    const { body } = mountPreviewModal()

    await previewSyncContent()

    const button = body?.querySelector<HTMLButtonElement>('.upload-single-btn')
    expect(button).not.toBeNull()
    button?.click()

    // 点击是异步派发的 void 调用：等一轮微任务让 uploadSingleRow 推进
    await Promise.resolve()
    expect(mocks.loadBgToken).toHaveBeenCalled()
  })

  it('点击非上传按钮时不做任何事', async () => {
    setDataPreview()
    const { body } = mountPreviewModal()

    await previewSyncContent()

    body?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()

    expect(mocks.loadBgToken).not.toHaveBeenCalled()
  })

  it('「全部同步」按钮内 syncAllRows 抛错时记错误日志（不静默吞掉）', async () => {
    setDataPreview()
    const { modal } = mountPreviewModal()
    const syncAllButton = document.createElement('button')
    syncAllButton.id = 'syncAllBtn'
    modal.querySelector('.modal-header')?.append(syncAllButton)
    await previewSyncContent()

    // 让状态机读取自身状态时抛错：syncAllRows 的入口检查在 try 之外，
    // 异常会冒泡到按钮回调的 catch（beforeEach 会重置该标志）。
    syncState.throwOnIsRunningRead = true
    syncAllButton.click()
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(mocks.bgmLog).toHaveBeenCalledWith(
      3,
      expect.stringContaining('[preview] syncAllRows 异常'),
    )
  })

  it('上传按钮缺 data-row 时被忽略', async () => {
    setDataPreview()
    const { body } = mountPreviewModal()

    await previewSyncContent()

    const button = document.createElement('button')
    button.className = 'upload-single-btn'
    body?.append(button)
    button.click()
    await Promise.resolve()

    expect(mocks.loadBgToken).not.toHaveBeenCalled()
  })

  it('状态归一化：空白状态变空串、未识别状态保持原样', async () => {
    setDataPreview()
    const { body } = mountPreviewModal()
    // 空白（不是空值，所以不会被「空卡片」规则拦下）→ 归一化为空串
    cells['2:4'] = ' '.repeat(3)
    // 不在映射表里的中文状态 → 原样保留
    cells['3:4'] = '追番'

    await previewSyncContent()

    const items = [...(body?.querySelectorAll<HTMLElement>('.detail-item') ?? [])]
    expect(items[0]?.dataset.status).toBe('')
    expect(items[1]?.dataset.status).toBe('追番')
  })

  it('已存在状态筛选器时先移除旧的再重建', async () => {
    setDataPreview()
    mountPreviewModal()
    const stale = document.createElement('select')
    stale.id = 'statusFilterSelect'
    document.body.append(stale)

    await previewSyncContent()

    const rebuilt = document.getElementById('statusFilterSelect')
    expect(rebuilt).not.toBeNull()
    expect(rebuilt).not.toBe(stale)
  })
})

// ========== uploadSingleRow ==========

describe('preview · uploadSingleRow', () => {
  beforeEach(() => {
    // #sheetSelect 存在是常规路径（生产代码已判空，缺失会回退到工作表 1，
    // 缺失路径单独有用例覆盖）。这里统一先挂上，让各用例只关注上传分支。
    mountSelect('sheetSelect', '1')
  })

  it('没有 Token → 走对话框提示（存在 bgmDialogContainer 时用 showAlert）', async () => {
    mountDiv('bgmDialogContainer')
    mocks.loadBgToken.mockReturnValue(null)

    await uploadSingleRow(2)

    expect(mocks.showAlert).toHaveBeenCalledWith('请先设置 Bangumi Token！', undefined)
    expect(mocks.wpsMessageBox).not.toHaveBeenCalled()
  })

  it('没有 Token 且无对话框容器 → 退回 wpsMessageBox', async () => {
    mocks.loadBgToken.mockReturnValue(null)

    await uploadSingleRow(2)

    expect(mocks.wpsMessageBox).toHaveBeenCalledWith('请先设置 Bangumi Token！', 0, 64)
  })

  it('上传成功 → 标记颜色、按钮转「重新上传」、补 uploaded 徽标并写记录', async () => {
    const button = mountUploadButton()
    const item = document.createElement('div')
    item.className = 'detail-item pending'
    const header = document.createElement('div')
    header.className = 'detail-item-header'
    item.append(header)
    item.append(button)
    document.body.append(item)
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: { Worksheets: { Item: () => ({ Name: '动画' }) } },
    })
    const seenFields: Record<string, string> = {}
    mocks.buildJsonPayload.mockImplementation((getField: (key: string) => string) => {
      seenFields.Bangumi_URL = getField('Bangumi_URL')
      seenFields.缺失列 = getField('缺失列')
      return '{"type":2}'
    })

    await uploadSingleRow(2, button)

    // 取值回调：命中列返回单元格内容，未命中列返回空串
    expect(seenFields).toEqual({
      Bangumi_URL: 'https://bgm.tv/subject/100',
      缺失列: '',
    })
    expect(mocks.bgmRequestSync).toHaveBeenCalledWith(
      'POST',
      '/v0/users/me/collections/100',
      '{"type":2}',
      'token-abc',
    )
    expect(item.classList.contains('uploaded')).toBe(true)
    expect(item.classList.contains('pending')).toBe(false)
    expect(header.querySelector('.uploaded-badge')?.textContent).toBe('✓ 已上传')
    expect(button.textContent).toBe('重新上传')
    expect(button.disabled).toBe(false)
    expect(button.classList.contains('uploading')).toBe(false)
    expect(mocks.addSyncRecord).toHaveBeenCalledWith(
      expect.objectContaining({ sid: '100', status: '成功', count: 1 }),
    )
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('记录写盘失败 → 明确提示用户本条未登记', async () => {
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: { Worksheets: { Item: () => ({ Name: '动画' }) } },
    })
    mocks.addSyncRecord.mockReturnValue(false)

    await uploadSingleRow(2)

    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('同步记录写入失败'),
      'error',
    )
  })

  it('上传失败（非 2xx）→ 标红、按钮转「失败」并提示', async () => {
    const button = mountUploadButton()
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: { Worksheets: { Item: () => ({ Name: '动画' }) } },
    })
    mocks.bgmRequestSync.mockResolvedValue({ code: 500, message: '服务器错误' })

    await uploadSingleRow(2, button)

    expect(button.textContent).toBe('✗ 失败')
    expect(button.classList.contains('error')).toBe(true)
    expect(mocks.addSyncRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: '失败', message: '服务器错误' }),
    )
    expect(mocks.showToast).toHaveBeenCalledWith('上传失败: 服务器错误', 'error')
    expect(mocks.handleError).toHaveBeenCalled()
  })

  it('上传失败且无 message → 用 HTTP 状态码兜底', async () => {
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: { Worksheets: { Item: () => ({ Name: '动画' }) } },
    })
    mocks.bgmRequestSync.mockResolvedValue({ code: 0, message: '' })

    await uploadSingleRow(2)

    expect(mocks.addSyncRecord).toHaveBeenCalledWith(expect.objectContaining({ message: 'HTTP 0' }))
    expect(mocks.showToast).toHaveBeenCalledWith('上传失败: 未知错误', 'error')
  })

  it('拿不到 Application → 提示上传出错并复位按钮', async () => {
    const button = mountUploadButton()
    mocks.getApp.mockReturnValue(null)

    await uploadSingleRow(2, button)

    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'UploadSingleRow', showAlert: true }),
    )
    expect(button.textContent).toBe('✗ 错误')
    expect(button.disabled).toBe(false)
    expect(mocks.showToast).toHaveBeenCalledWith('上传出错: 无法获取 Application', 'error')
  })

  it('缺少 Bangumi URL 列 → 提示未找到列', async () => {
    mocks.getApp.mockReturnValue({ ActiveWorkbook: { Worksheets: { Item: () => ({}) } } })
    mocks.getColumnMap.mockReturnValue(new Map([['名称', 2]]))

    await uploadSingleRow(2)

    expect(mocks.showToast).toHaveBeenCalledWith('上传出错: 未找到 Bangumi URL 列', 'error')
  })

  it('URL 里提不出 SID → 提示无法提取 Subject ID', async () => {
    mocks.getApp.mockReturnValue({ ActiveWorkbook: { Worksheets: { Item: () => ({}) } } })
    cells['2:3'] = 'https://bgm.tv/unknown'

    await uploadSingleRow(2)

    expect(mocks.showToast).toHaveBeenCalledWith('上传出错: 无法提取 Subject ID', 'error')
  })

  it('请求体构建失败 → 提示无法构建请求体', async () => {
    mocks.getApp.mockReturnValue({ ActiveWorkbook: { Worksheets: { Item: () => ({}) } } })
    mocks.buildJsonPayload.mockReturnValue('')

    await uploadSingleRow(2)

    expect(mocks.showToast).toHaveBeenCalledWith('上传出错: 无法构建请求体', 'error')
  })

  it('没有按钮元素时静默完成（不触碰 DOM）', async () => {
    mocks.getApp.mockReturnValue({
      ActiveWorkbook: { Worksheets: { Item: () => ({ Name: '动画' }) } },
    })

    await expect(uploadSingleRow(2)).resolves.toBeUndefined()

    expect(mocks.addSyncRecord).toHaveBeenCalledWith(expect.objectContaining({ status: '成功' }))
  })

  it('已锁定工作表时按锁定索引定位，且下拉框有值也不冲突', async () => {
    mocks.getApp.mockReturnValue({ ActiveWorkbook: { Worksheets: { Item: () => ({}) } } })
    mocks.sheet.lockedIndex = 7

    await uploadSingleRow(2)

    expect(mocks.findHeaderRow).toHaveBeenCalledTimes(1)
    expect(mocks.bgmRequestSync).toHaveBeenCalledTimes(1)
  })

  it('#sheetSelect 缺失 → 回退到工作表 1 并告警（不再抛 TypeError 掩盖真实失败）', async () => {
    document.getElementById('sheetSelect')?.remove()
    expect(document.getElementById('sheetSelect')).toBeNull()
    const item = vi.fn(() => ({ Name: '动画' }))
    mocks.getApp.mockReturnValue({ ActiveWorkbook: { Worksheets: { Item: item } } })

    await uploadSingleRow(2)

    expect(item).toHaveBeenCalledWith(1)
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('未找到 #sheetSelect'),
    )
    // 关键：没有走进「上传出错: Cannot read properties of null」分支
    expect(mocks.addSyncRecord).toHaveBeenCalledWith(expect.objectContaining({ status: '成功' }))
    expect(mocks.showToast).not.toHaveBeenCalled()
  })
})

// ========== 详情模态框 ==========

describe('preview · showDetailModal / closeDetailModal', () => {
  it('显示与隐藏 detailModal', () => {
    const modal = mountDiv('detailModal')

    showDetailModal()
    expect(modal.style.display).toBe('flex')

    closeDetailModal()
    expect(modal.style.display).toBe('none')
  })

  it('元素缺失时静默', () => {
    expect(() => {
      showDetailModal()
      closeDetailModal()
    }).not.toThrow()
  })
})

// ========== viewSyncRecordDetail ==========

describe('preview · viewSyncRecordDetail', () => {
  it('找不到记录 → 提示未找到', () => {
    mountDiv('bgmDialogContainer')
    mocks.getAllSyncRecords.mockReturnValue([{ sid: 999 }])

    viewSyncRecordDetail('100')

    expect(mocks.showAlert).toHaveBeenCalledWith('未找到该同步记录', undefined)
  })

  it('找到记录且内容为合法 JSON → 格式化后弹出详情', () => {
    mountDiv('bgmDialogContainer')
    mocks.getAllSyncRecords.mockReturnValue([
      {
        sid: 100,
        name: '动画A',
        url: 'https://bgm.tv/subject/100',
        time: '2026-09-14',
        status: '成功',
        count: 2,
        message: '备注',
        content: '{"type":2}',
      },
    ])

    viewSyncRecordDetail('100')

    const detail = mocks.showAlert.mock.calls[0]?.[0] ?? ''
    const title = mocks.showAlert.mock.calls[0]?.[1]
    expect(title).toBe('同步记录详情')
    expect(detail).toContain('名称: 动画A')
    expect(detail).toContain('同步次数: 2')
    // JSON.stringify(JSON.parse(...), null, 2) → 带缩进
    expect(detail).toContain('{\n  "type": 2\n}')
    expect(mocks.handleError).not.toHaveBeenCalled()
  })

  it('内容不是合法 JSON → 记日志后按原文展示', () => {
    mountDiv('bgmDialogContainer')
    mocks.getAllSyncRecords.mockReturnValue([{ sid: 100, content: '不是 JSON' }])

    viewSyncRecordDetail('100')

    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'ViewSyncRecordDetail' }),
    )
    expect(mocks.showAlert.mock.calls[0]?.[0] ?? '').toContain('不是 JSON')
  })

  it('同步记录模块未提供 getAllSyncRecords → 提示功能不可用并早退', () => {
    mountDiv('bgmDialogContainer')
    // 模拟宿主未注入该导出（降级环境）：把 mock 导出临时置为 undefined，
    // preview.ts 的 `typeof getAllSyncRecords !== 'function'` 守卫即被驱动。
    Reflect.set(mocks, 'getAllSyncRecords', undefined)
    try {
      expect(() => {
        viewSyncRecordDetail('100')
      }).not.toThrow()

      expect(mocks.showAlert).toHaveBeenCalledWith('同步记录功能不可用！', undefined)
    } finally {
      Reflect.set(
        mocks,
        'getAllSyncRecords',
        vi.fn((): unknown[] => []),
      )
    }
  })
})

// ========== syncAllRows ==========

describe('preview · syncAllRows', () => {
  it('同步进行中 → 返回全 0 并提示', async () => {
    mocks.sync.isRunning = true

    await expect(syncAllRows()).resolves.toEqual({ success: 0, fail: 0, skip: 0 })
    expect(mocks.showToast).toHaveBeenCalledWith('同步正在进行中，请稍后', 'warn')
  })

  it('未加载预览数据 → 返回全 0 并提示', async () => {
    mocks.dataPreview = null

    await expect(syncAllRows()).resolves.toEqual({ success: 0, fail: 0, skip: 0 })
    expect(mocks.showToast).toHaveBeenCalledWith('请先在预览面板中加载数据', 'warn')
  })

  it('缺少 Token → 弹进度窗说明并返回全 0', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue(null)

    await expect(syncAllRows()).resolves.toEqual({ success: 0, fail: 0, skip: 0 })

    expect(mocks.showSyncProgressDialog).toHaveBeenCalledWith(
      'Bangumi Token 未设置',
      expect.anything(),
    )
    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.stringContaining('无法同步：缺少 Bangumi Token'),
      expect.arrayContaining([expect.stringContaining('设置 Token')]),
      false,
    )
    expect(mocks.showToast).toHaveBeenCalledWith('请先设置 Bangumi Token', 'warn')
    expect(mocks.sync.enterRunningState).not.toHaveBeenCalled()
  })

  it('没有可同步的数据行 → 提示并返回全 0', async () => {
    setDataPreview({ visibleRows: [1] })
    mocks.loadBgToken.mockReturnValue('token-abc')

    await expect(syncAllRows()).resolves.toEqual({ success: 0, fail: 0, skip: 0 })
    expect(mocks.showToast).toHaveBeenCalledWith('没有可同步的数据行', 'info')
  })

  it('列映射为空 → 提示并返回全 0', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.getColumnMap.mockReturnValue(new Map<string, number>())

    await expect(syncAllRows()).resolves.toEqual({ success: 0, fail: 0, skip: 0 })
    expect(mocks.showToast).toHaveBeenCalledWith('无法读取列映射', 'error')
  })

  it('正常同步：检测冲突、读增量设置、驱动进度弹窗并返回结果', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.detectConflicts.mockResolvedValue({ conflictCount: 2 })
    mocks.getApp.mockReturnValue({ PluginStorage: { getItem: () => 'true' } })
    mocks.syncToBangumi.mockResolvedValue({ success: 2, fail: 1, skip: 0, stopped: false })

    // 返回值收敛为声明中的三个字段（stopped 只用于本函数内的进度弹窗文案）
    await expect(syncAllRows()).resolves.toEqual({ success: 2, fail: 1, skip: 0 })

    expect(mocks.detectConflicts).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      3,
      1,
      'token-abc',
    )
    // 有冲突 → 策略改为「Excel覆盖冲突」
    expect(mocks.buildSyncConfig).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'Excel覆盖冲突' }),
    )
    // 增量同步开启 → 传给 SyncToBangumiAsync
    expect(mocks.syncToBangumi).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'token-abc',
      3,
      1,
      expect.objectContaining({ incremental: true }),
    )
    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.stringContaining('成功: 2'),
      expect.arrayContaining(['成功 2 条', '失败 1 条', '跳过 0 条']),
      false,
    )
    expect(mocks.sync.enterRunningState).toHaveBeenCalledTimes(1)
    expect(mocks.sync.exitRunningState).toHaveBeenCalledTimes(1)

    // 进度弹窗三回调 + 逐条完成回调
    const handlers = mocks.showSyncProgressDialog.mock.calls[0]?.[1]
    handlers?.onPause()
    handlers?.onResume()
    handlers?.onStop()
    expect(mocks.sync.pause).toHaveBeenCalledTimes(1)
    expect(mocks.sync.resume).toHaveBeenCalledTimes(1)
    expect(mocks.sync.requestStop).toHaveBeenCalledTimes(1)

    const syncOptions = mocks.syncToBangumi.mock.calls[0]?.[5]
    expect(() => {
      syncOptions?.onItemComplete?.(2, true, {})
    }).not.toThrow()
  })

  it('onProgress 回调直接驱动进度弹窗', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.syncToBangumi.mockImplementation(
      async (
        _ws: unknown,
        _colMap: unknown,
        _token: string,
        _lastRow: number,
        _headerRow: number,
        options?: {
          onProgress?: (current: number, total: number, message: string) => void
          onItemComplete?: (row: number, isSuccess: boolean, result: unknown) => void
        },
      ) => {
        options?.onProgress?.(1, 2, '正在同步')
        return { success: 1, fail: 0, skip: 0, stopped: false }
      },
    )

    await syncAllRows()

    expect(mocks.updateSyncProgressDialog).toHaveBeenCalledWith(1, 2, '正在同步')
  })

  it('被用户停止 → 完成弹窗的详情标注停止', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.syncToBangumi.mockResolvedValue({ success: 1, fail: 0, skip: 0, stopped: true })

    await syncAllRows()

    expect(mocks.completeSyncProgressDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['⚠️ 同步被用户停止']),
      true,
    )
  })

  it('冲突检测抛错 → 改写错误信息但不中断同步', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.detectConflicts.mockRejectedValue(new Error('网络异常'))

    await syncAllRows()

    // 冲突检测失败 → 策略回落到「标准同步」
    expect(mocks.buildSyncConfig).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: '标准同步' }),
    )
    expect(mocks.syncToBangumi).toHaveBeenCalled()
  })

  it('读取增量同步设置抛错 → 记日志并按关闭处理', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.getApp.mockReturnValue({
      PluginStorage: {
        getItem: () => {
          throw new Error('宿主不支持 PluginStorage')
        },
      },
    })

    await syncAllRows()

    expect(mocks.bgmLog).toHaveBeenCalledWith(2, expect.stringContaining('读取增量同步设置失败'))
    expect(mocks.syncToBangumi).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ incremental: false }),
    )
  })

  it('enterRunningState 返回 false → 拒绝重入并返回全 0', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.sync.enterRunningState.mockReturnValue(false)

    await expect(syncAllRows()).resolves.toEqual({ success: 0, fail: 0, skip: 0 })
    expect(mocks.syncToBangumi).not.toHaveBeenCalled()
  })

  it('同步过程抛错 → 隐藏弹窗、上报错误并返回全 0', async () => {
    setDataPreview()
    mocks.loadBgToken.mockReturnValue('token-abc')
    mocks.syncToBangumi.mockRejectedValue(new Error('同步崩了'))

    await expect(syncAllRows()).resolves.toEqual({ success: 0, fail: 0, skip: 0 })

    expect(mocks.hideSyncProgressDialog).toHaveBeenCalledTimes(1)
    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ showAlert: true }),
    )
    // finally 分支仍要退出运行状态
    expect(mocks.sync.exitRunningState).toHaveBeenCalledTimes(1)
  })
})
