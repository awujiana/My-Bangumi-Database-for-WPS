// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/clean-page.ts`（通用清理页 UI 控制器）单元测试。
 *
 * 依赖形状：13 个 import **全部来自叶子模块**（`tools/util`、`ui/dialog`、`clean-engine`、
 * `stat-cards`、`operation-log`、`sanitize`、`shell-nav`、`theme`、`progress` …），
 * **不回引 `ts/index.js` barrel** → 不存在 barrel 循环死锁，逐模块 `vi.mock` 即可接管，
 * 与 import 顺序无关。`clean-rules` 用**真实模块**（纯数据配置），断言不脱离配置。
 *
 * 模块内含 5 处模块级状态（`sheetCandidates` / `scanResult` / `isRunning` /
 * `cleanProgress` / `collapsedWorkbooks`），故每个用例 `vi.resetModules()` 后动态 import，
 * 拿到干净实例 —— 否则上一条用例残留的候选表 / 扫描结果会让早退断言静默失效。
 *
 * `sanitizeHtml` 刻意 mock 成恒等：DOMPurify 会重排属性顺序，逐字断言模板会变脆；
 * 净化本身由 `tests/xss.test.ts` 覆盖。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ========== 依赖替身 ==========

interface ProgressHostOptions {
  mode: string
  hostId: string
  title: string
  icon: string
  enableLogs: boolean
  showHeader: boolean
}

interface FakeProgressController {
  hide: () => void
  update: (current: number, total: number, message?: string, eta?: string) => void
  log: (line: string) => void
  complete: (options: unknown) => void
}

const m = vi.hoisted(() => ({
  // tools/util/index.js
  getApp: vi.fn<() => unknown>(),
  bgmLog: vi.fn<(level: number, message?: string) => void>(),
  markCleanPaneLoaded: vi.fn<() => void>(),
  dialogAlert: vi.fn<(title: string, message: string) => void>(),
  dialogConfirm: vi.fn<(message: string, onConfirm: (isConfirmed: boolean) => void) => void>(),
  // ui/dialog.js
  showToast: vi.fn<(message: string, type?: string) => void>(),
  // panel/clean-engine.js
  inspectWorksheet: vi.fn<(worksheet: unknown) => unknown>(),
  scanCleanRules: vi.fn<(ruleIds: string[], options: unknown) => unknown>(),
  runCleanPlans:
    vi.fn<
      (
        scanResult: unknown,
        onProgress: (done: number, total: number, message: string) => void,
      ) => Promise<unknown>
    >(),
  formatBytes: vi.fn<(bytes: number) => string>(),
  // panel/clean-engine.js（isWorkbookAllowed：与引擎同一函数，页面不再有本地副本）
  isWorkbookAllowed: vi.fn<(path: string) => boolean>(),
  // ui/stat-cards.js
  renderStatCards: vi.fn<(container: unknown, cards: unknown) => void>(),
  // tools/operation-log.js
  appendOperationLog: vi.fn<(scope: string, message: string, level?: string) => void>(),
  clearOperationLogs: vi.fn<(scope: string) => void>(),
  // tools/sanitize.js
  sanitizeHtml: vi.fn<(html: string) => string>(),
  sanitizeTableRows: vi.fn<(rows: string) => string>(),
  // panel/shell-nav.js
  initShellNav: vi.fn<() => void>(),
  // tools/theme.js
  initTheme: vi.fn<() => void>(),
  startThemeSync: vi.fn<() => void>(),
  // ui/components/progress.js
  createProgress: vi.fn<(options: ProgressHostOptions) => FakeProgressController>(),
  progressHide: vi.fn<() => void>(),
  progressUpdate: vi.fn<(current: number, total: number, message?: string) => void>(),
  progressLog: vi.fn<(line: string) => void>(),
  progressComplete: vi.fn<(options: unknown) => void>(),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  getApp: m.getApp,
  bgmLog: m.bgmLog,
  markCleanPaneLoaded: m.markCleanPaneLoaded,
  BGM: {
    Dialog: { alert: m.dialogAlert, confirm: m.dialogConfirm },
  },
}))

vi.mock('../ts/ui/dialog.js', () => ({ showToast: m.showToast }))

vi.mock('../ts/panel/clean-engine.js', () => ({
  inspectWorksheet: m.inspectWorksheet,
  scanCleanRules: m.scanCleanRules,
  runCleanPlans: m.runCleanPlans,
  formatBytes: m.formatBytes,
  isWorkbookAllowed: m.isWorkbookAllowed,
}))

vi.mock('../ts/ui/stat-cards.js', () => ({ renderStatCards: m.renderStatCards }))

vi.mock('../ts/tools/operation-log.js', () => ({
  CLEAN_LOG_SCOPE: 'clean',
  appendOperationLog: m.appendOperationLog,
  clearOperationLogs: m.clearOperationLogs,
}))

vi.mock('../ts/tools/sanitize.js', () => ({
  sanitizeHtml: m.sanitizeHtml,
  sanitizeTableRows: m.sanitizeTableRows,
}))

vi.mock('../ts/panel/shell-nav.js', () => ({ initShellNav: m.initShellNav }))

vi.mock('../ts/tools/theme.js', () => ({
  initTheme: m.initTheme,
  startThemeSync: m.startThemeSync,
}))

vi.mock('../ts/ui/components/progress.js', () => ({ createProgress: m.createProgress }))

import { CLEAN_EXCLUDES, CLEAN_RULES, CLEAN_TARGETS } from '../ts/panel/clean-rules.js'

type CleanPageModule = typeof import('../ts/panel/clean-page.js')

// ========== 测试工具 ==========

const DEFAULT_INSPECTION = {
  eligible: true,
  reason: '',
  isXinFan: false,
  headers: ['名称', 'Bangumi_URL'],
  dataRows: 12,
}

let page: CleanPageModule
let storage: Map<string, string>

/** 插件存储替身（按 key 读写纯字符串，与真实 PluginStorage 语义一致） */
function makeStorageApi(): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
} {
  return {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value)
    },
  }
}

/** 一次性把 getApp() 锚定到「已连接 + 有工作簿」的宿主 */
function installApp(workbooks: unknown): void {
  m.getApp.mockReturnValue({ PluginStorage: makeStorageApi(), Workbooks: workbooks })
}

/** 已连接但未打开任何工作簿 */
function installAppWithoutWorkbooks(): void {
  m.getApp.mockReturnValue({ PluginStorage: makeStorageApi(), Workbooks: undefined })
}

interface WorkbookOptions {
  name: string
  fullName?: string
  throwFullName?: boolean
  sheets: unknown[]
}

/** 单个工作表替身；`throwName` 用于驱动「读表名失败」的防御分支 */
function makeSheet(name: string, isNameUnreadable = false): unknown {
  if (isNameUnreadable) {
    return {
      get Name(): string {
        throw new Error('表名不可读')
      },
    }
  }
  return { Name: name }
}

/** 工作簿替身（FullName 可选可抛错；Worksheets 可缺失） */
function makeWorkbook(options: WorkbookOptions & { noWorksheets?: boolean }): unknown {
  const workbook: Record<string, unknown> = {
    Name: options.name,
    get Worksheets(): unknown {
      if (options.noWorksheets === true) return undefined
      return { Count: options.sheets.length, Item: (index: number) => options.sheets[index - 1] }
    },
  }
  if (options.throwFullName === true) {
    Object.defineProperty(workbook, 'FullName', {
      get() {
        throw new Error('路径不可读')
      },
    })
  } else if (options.fullName !== undefined) {
    workbook.FullName = options.fullName
  }
  return workbook
}

/** 工作簿集合替身 */
function makeWorkbooks(list: unknown[]): unknown {
  return { Count: list.length, Item: (index: number) => list[index - 1] }
}

/** 勾选某工作簿的部分工作表（写真实持久化键） */
function selectSheets(workbookKey: string, names: string[]): void {
  storage.set(`bgm_clean_sheets:${workbookKey}`, JSON.stringify(names))
}

/** 清出页面所需的全部锚点 */
function mountCleanDom(): void {
  document.body.innerHTML = `
    <button id="cleanLoadSheetsBtn">加载</button>
    <button id="cleanSelectAllSheetsBtn">全选表</button>
    <button id="cleanSelectNoneSheetsBtn">清空表</button>
    <span id="cleanSheetSummary"></span>
    <div id="cleanSheetList"></div>
    <button id="cleanSelectAllBtn">全选规则</button>
    <button id="cleanSelectNoneBtn">清空规则</button>
    <div id="cleanItemList"></div>
    <button id="cleanScanBtn">扫描</button>
    <button id="cleanRunBtn" disabled>执行</button>
    <button id="cleanClearLogBtn">清日志</button>
    <div id="cleanPreviewSummary"></div>
    <div id="cleanPreviewDetail"></div>
    <div id="cleanProgressHost"></div>
    <div id="cleanLog"></div>
  `
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`缺少 #${id}`)
  return element
}

function inputById(id: string): HTMLInputElement {
  return byId(id) as HTMLInputElement
}

function buttonById(id: string): HTMLButtonElement {
  return byId(id) as HTMLButtonElement
}

function clickById(id: string): void {
  byId(id).click()
}

/** 触发 change（原生 setter + 冒泡，避免只改属性不触发委托） */
function toggleCheckbox(elementId: string, isChecked: boolean): void {
  const box = inputById(elementId)
  box.checked = isChecked
  box.dispatchEvent(new Event('change'))
}

/** 追加到日志存储的消息序列 */
function loggedMessages(): string[] {
  return m.appendOperationLog.mock.calls.map((call) => call[1])
}

/** 构造一份「无命中」扫描结果 */
function emptyScanResult(): unknown {
  return {
    targets: [],
    plans: [],
    fileCount: 0,
    targetCount: 0,
    itemCount: 0,
    estimatedBytes: 0,
    notes: [],
  }
}

/** 构造一份「有命中」扫描结果（1 个工作簿 / 1 张表 / 1 条规则） */
function hitScanResult(): unknown {
  return {
    targets: [{ key: 'A.xlsx::动画', label: 'A / 动画' }],
    plans: [
      {
        ruleId: 'dup-name',
        ruleName: '重复名称行',
        targetKey: 'A.xlsx::动画',
        targetLabel: 'A / 动画',
        deleteRows: [7, 9],
        changes: [{ row: 5, column: 3, columnName: '标签/分级', oldValue: 'a', nextValue: 'b' }],
        estimatedBytes: 4096,
      },
    ],
    fileCount: 1,
    targetCount: 1,
    itemCount: 3,
    estimatedBytes: 4096,
    notes: ['已跳过 1 张非数据表'],
  }
}

/** 让出微任务队列，等 `executeClean()` 的 await 链跑完 */
async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  // 扫描让出的是宏任务（setTimeout 0，生产环境为真重绘），微任务冲不干净
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  storage = new Map()
  // clearAllMocks 不清实现，默认值必须在每轮重新锚定，否则上一条用例的覆写会泄漏
  m.getApp.mockReturnValue(null)
  m.sanitizeHtml.mockImplementation((html: string) => html)
  m.sanitizeTableRows.mockImplementation((rows: string) => rows)
  m.formatBytes.mockImplementation((bytes: number) => `${String(bytes)} B`)
  m.createProgress.mockReturnValue({
    hide: m.progressHide,
    update: m.progressUpdate,
    log: m.progressLog,
    complete: m.progressComplete,
  })
  m.inspectWorksheet.mockReturnValue(DEFAULT_INSPECTION)
  // isWorkbookAllowed 默认实现与 clean-engine.ts 逐字同构（排除优先于包含），桩忠实于真实引擎
  m.isWorkbookAllowed.mockImplementation((path: string) => {
    const lower = path.toLowerCase()
    const hasKeyword = (keywords: readonly string[]): boolean =>
      keywords.some((keyword) => keyword !== '' && lower.includes(keyword.toLowerCase()))
    if (hasKeyword(CLEAN_TARGETS.excludeWorkbookPath)) return false
    if (CLEAN_TARGETS.includeWorkbookPath.length === 0) return true
    return hasKeyword(CLEAN_TARGETS.includeWorkbookPath)
  })
  m.scanCleanRules.mockReturnValue(emptyScanResult())
  m.runCleanPlans.mockResolvedValue({
    targets: [],
    deletedRows: 0,
    changedCells: 0,
    fileCount: 0,
    elapsedMs: 12,
  })
  mountCleanDom()
})

/** 装一个含「达标 / 未达标 / 新番 / 有表头」四类特征的两簿场景 */
async function mountTwoWorkbooks(): Promise<void> {
  installApp(
    makeWorkbooks([
      makeWorkbook({
        name: 'A',
        fullName: 'D:/A.xlsx',
        sheets: [makeSheet('动画'), makeSheet('新番表')],
      }),
      makeWorkbook({ name: 'B', fullName: 'D:/B.xlsx', sheets: [makeSheet('归档')] }),
    ]),
  )
  m.inspectWorksheet.mockImplementation((worksheet: unknown) => {
    const name = (worksheet as { Name?: string }).Name ?? ''
    if (name === '动画') {
      return {
        eligible: true,
        reason: '',
        isXinFan: false,
        headers: ['名称', 'Bangumi_URL'],
        dataRows: 100,
      }
    }
    if (name === '归档') {
      return { eligible: true, reason: '', isXinFan: false, headers: [], dataRows: 5 }
    }
    return {
      eligible: false,
      reason: '未找到名称列',
      isXinFan: true,
      headers: ['周更时间'],
      dataRows: 2,
    }
  })
  await loadPage()
  page.initCleanPage()
  clickById('cleanLoadSheetsBtn')
}
/** 装好「已勾选一张表 + 规则默认勾选」的可扫描状态 */
async function mountScannable(): Promise<void> {
  installApp(
    makeWorkbooks([
      makeWorkbook({ name: 'A', fullName: 'D:/A.xlsx', sheets: [makeSheet('动画')] }),
    ]),
  )
  await loadPage()
  page.initCleanPage()
  clickById('cleanLoadSheetsBtn')
}
async function mountRunnable(): Promise<void> {
  installApp(
    makeWorkbooks([
      makeWorkbook({ name: 'A', fullName: 'D:/A.xlsx', sheets: [makeSheet('动画')] }),
    ]),
  )
  await loadPage()
  page.initCleanPage()
  clickById('cleanLoadSheetsBtn')
  m.scanCleanRules.mockReturnValue(hitScanResult())
  clickById('cleanScanBtn')
  await flushAsync()
  m.appendOperationLog.mockClear()
}

async function loadPage(): Promise<void> {
  vi.resetModules()
  page = await import('../ts/panel/clean-page.js')
}

// ========== 初始化 ==========

describe('initCleanPage', () => {
  it('记录页面已加载、初始化主题与侧栏、渲染日志并锁定执行按钮', async () => {
    await loadPage()
    page.initCleanPage()

    expect(m.markCleanPaneLoaded).toHaveBeenCalledTimes(1)
    expect(m.initTheme).toHaveBeenCalledTimes(1)
    expect(m.startThemeSync).toHaveBeenCalledTimes(1)
    expect(m.initShellNav).toHaveBeenCalledTimes(1)
    expect(m.sanitizeHtml).toHaveBeenCalled()
    expect(buttonById('cleanRunBtn').disabled).toBe(true)
    expect(loggedMessages().at(-1)).toContain('清理页已就绪')
    expect(m.bgmLog).toHaveBeenCalled()
  })

  it('未选中任何工作表时列表区显示引导提示', async () => {
    await loadPage()
    page.initCleanPage()

    expect(byId('cleanSheetList').innerHTML).toContain('加载工作表')
    expect(byId('cleanSheetSummary').textContent).toBe('')
  })

  it('document 未定义时直接返回，不做任何装配', async () => {
    await loadPage()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'document')
    try {
      expect(() => {
        page.initCleanPage()
      }).not.toThrow()
      expect(m.markCleanPaneLoaded).not.toHaveBeenCalled()
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'document', descriptor)
    }
  })
})

// ========== 可清理项列表 ==========

describe('renderCleanItems', () => {
  it('按分组渲染全部规则，未持久化时用规则默认值勾选', async () => {
    await loadPage()
    page.initCleanPage()

    const html = byId('cleanItemList').innerHTML
    expect(html).toContain('重复数据')
    expect(html).toContain('单元格清洗')
    for (const rule of CLEAN_RULES) {
      expect(html).toContain(`clean-item-${rule.id}`)
    }
    expect(inputById('clean-item-dup-name').checked).toBe(true)
    expect(inputById('clean-item-empty-name').checked).toBe(false)
  })

  it('持久化为 false 的默认勾选项不勾选，持久化为 true 的默认关闭项勾选', async () => {
    installApp(makeWorkbooks([]))
    storage.set('bgm_clean_on_dup-name', 'false')
    storage.set('bgm_clean_on_empty-name', 'true')
    await loadPage()
    page.initCleanPage()

    expect(inputById('clean-item-dup-name').checked).toBe(false)
    expect(inputById('clean-item-empty-name').checked).toBe(true)
  })

  it('勾选变化即时持久化并使预览失效', async () => {
    await loadPage()
    page.initCleanPage()
    // 先造出有效预览
    installApp(makeWorkbooks([]))
    selectSheets('A.xlsx', ['动画'])
    toggleCheckbox('clean-item-dup-name', true)
    expect(storage.get('bgm_clean_on_dup-name')).toBe('true')

    toggleCheckbox('clean-item-dup-name', false)
    expect(storage.get('bgm_clean_on_dup-name')).toBe('false')
    expect(buttonById('cleanRunBtn').disabled).toBe(true)
    expect(byId('cleanPreviewSummary').innerHTML).toContain('扫描预览')
  })

  it('缺少列表容器时静默跳过渲染', async () => {
    await loadPage()
    byId('cleanItemList').remove()
    expect(() => {
      page.initCleanPage()
    }).not.toThrow()
  })
})

// ========== 选择清理的表格 ==========

describe('handleLoadSheets', () => {
  it('未连接宿主时弹提示且不写日志', async () => {
    await loadPage()
    page.initCleanPage()
    m.appendOperationLog.mockClear()

    clickById('cleanLoadSheetsBtn')

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', expect.stringContaining('未连接'))
    expect(loggedMessages()).toHaveLength(0)
  })

  it('宿主无 Workbooks 时清空候选并记 warn 日志', async () => {
    installAppWithoutWorkbooks()
    await loadPage()
    page.initCleanPage()
    m.appendOperationLog.mockClear()

    clickById('cleanLoadSheetsBtn')

    const call = m.appendOperationLog.mock.calls.at(-1)
    expect(call?.[1]).toContain('未找到已打开的工作簿')
    expect(call?.[2]).toBe('warn')
    expect(byId('cleanSheetList').innerHTML).toContain('加载工作表')
  })

  it('正常加载：识别达标表、自动勾选达标表并记录统计', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({
          name: 'A',
          fullName: 'D:/数据/A.xlsx',
          sheets: [makeSheet('动画'), makeSheet('同步记录')],
        }),
        makeWorkbook({
          name: 'B',
          fullName: 'D:/数据/B.xlsx',
          sheets: [makeSheet('新番')],
        }),
      ]),
    )
    m.inspectWorksheet.mockImplementation((worksheet: unknown) => {
      const isEligible = (worksheet as { Name?: string }).Name === '动画'
      return {
        eligible: isEligible,
        reason: isEligible ? '' : '未找到名称列',
        isXinFan: !isEligible,
        headers: isEligible ? ['名称'] : [],
        dataRows: 8,
      }
    })
    await loadPage()
    page.initCleanPage()
    m.appendOperationLog.mockClear()

    clickById('cleanLoadSheetsBtn')

    // 「同步记录」被排除 → 只剩 2 张候选
    expect(byId('cleanSheetList').innerHTML).toContain('D:/数据/A.xlsx')
    expect(byId('cleanSheetList').innerHTML).toContain('新番')
    expect(byId('cleanSheetList').innerHTML).not.toContain('同步记录')
    expect(byId('cleanSheetSummary').textContent).toContain('共 2 个工作簿')
    expect(storage.get('bgm_clean_sheets:D:/数据/A.xlsx')).toBe(JSON.stringify(['动画']))
    expect(loggedMessages().at(-1)).toContain('已加载 2 张工作表（识别 1 张，自动勾选 1 张）')
    expect(m.showToast).not.toHaveBeenCalled()
  })

  it('一张都没识别到时追加引导 warn 日志', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({ name: 'A', fullName: 'D:/A.xlsx', sheets: [makeSheet('表1')] }),
      ]),
    )
    m.inspectWorksheet.mockReturnValue({
      eligible: false,
      reason: '未找到名称列',
      isXinFan: true,
      headers: [],
      dataRows: 3,
    })
    await loadPage()
    page.initCleanPage()
    m.appendOperationLog.mockClear()

    clickById('cleanLoadSheetsBtn')

    const levels = m.appendOperationLog.mock.calls.map((call) => call[2])
    expect(levels).toContain('warn')
    expect(loggedMessages().some((message) => message.includes('可手动勾选任意工作表'))).toBe(true)
  })

  it('排除路径命中的工作簿整体跳过', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({ name: 'A', fullName: '~$A.xlsx', sheets: [makeSheet('动画')] }),
        makeWorkbook({ name: 'B', fullName: 'D:/B.xlsx', sheets: [makeSheet('动画')] }),
      ]),
    )
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(loggedMessages().at(-1)).toContain('已加载 1 张工作表')
  })

  it('读取工作簿路径失败时回退工作簿名', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({
          name: '回退名',
          throwFullName: true,
          sheets: [makeSheet('动画')],
        }),
      ]),
    )
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(byId('cleanSheetList').innerHTML).toContain('回退名')
    expect(storage.get('bgm_clean_sheets:回退名')).toBe(JSON.stringify(['动画']))
  })

  it('FullName 缺失时用工作表名回退为工作簿键', async () => {
    installApp(makeWorkbooks([makeWorkbook({ name: '无名', sheets: [makeSheet('动画')] })]))
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(storage.get('bgm_clean_sheets:无名')).toBe(JSON.stringify(['动画']))
  })

  it('读表名抛错的工作表被跳过，不阻塞其余表', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({
          name: 'A',
          fullName: 'D:/A.xlsx',
          sheets: [makeSheet('', true), makeSheet('动画')],
        }),
      ]),
    )
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(loggedMessages().at(-1)).toContain('已加载 1 张工作表')
  })

  it('工作簿缺失 Worksheets 时跳过该簿', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({ name: 'A', fullName: 'D:/A.xlsx', sheets: [], noWorksheets: true }),
        makeWorkbook({ name: 'B', fullName: 'D:/B.xlsx', sheets: [makeSheet('动画')] }),
      ]),
    )
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(loggedMessages().at(-1)).toContain('已加载 1 张工作表')
  })

  it('已有持久化选择的工作簿不被自动勾选覆盖', async () => {
    selectSheets('D:/A.xlsx', [])
    installApp(
      makeWorkbooks([
        makeWorkbook({ name: 'A', fullName: 'D:/A.xlsx', sheets: [makeSheet('动画')] }),
      ]),
    )
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(storage.get('bgm_clean_sheets:D:/A.xlsx')).toBe('[]')
    expect(loggedMessages().at(-1)).toContain('自动勾选 0 张')
  })

  it('持久化数据损坏或非数组时按「未选择」处理', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({ name: 'A', fullName: 'D:/A.xlsx', sheets: [makeSheet('动画')] }),
        makeWorkbook({ name: 'B', fullName: 'D:/B.xlsx', sheets: [makeSheet('动画')] }),
      ]),
    )
    // A：JSON 解析失败；B：解析成功但不是数组 —— 两条都要静默降级为空集
    storage.set('bgm_clean_sheets:D:/A.xlsx', '坏数据')
    storage.set('bgm_clean_sheets:D:/B.xlsx', '{"a":1}')
    await loadPage()
    page.initCleanPage()
    m.appendOperationLog.mockClear()

    clickById('cleanLoadSheetsBtn')

    expect(loggedMessages().at(-1)).toContain('已加载 2 张工作表（识别 2 张，自动勾选 0 张）')
    expect(byId('cleanSheetSummary').textContent).toContain('已选 0 张')
  })

  it('枚举过程中抛错时记 error 日志并弹 toast', async () => {
    installApp({
      Count: 1,
      Item(): unknown {
        throw new Error('COM 枚举失败')
      },
    })
    await loadPage()
    page.initCleanPage()
    m.appendOperationLog.mockClear()

    clickById('cleanLoadSheetsBtn')

    const call = m.appendOperationLog.mock.calls.at(-1)
    expect(call?.[1]).toContain('加载工作表失败：COM 枚举失败')
    expect(call?.[2]).toBe('error')
    expect(m.showToast).toHaveBeenCalledWith('加载工作表失败：COM 枚举失败', 'error')
  })

  it('抛出的非 Error 值也能转成文案', async () => {
    installApp({
      Count: 1,
      Item(): unknown {
        throw '字符串异常'
      },
    })
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(m.showToast).toHaveBeenCalledWith('加载工作表失败：字符串异常', 'error')
  })
})

describe('renderSheetList 交互', () => {
  it('渲染达标 / 未识别标签、行数、表头与新番标识', async () => {
    await mountTwoWorkbooks()

    const html = byId('cleanSheetList').innerHTML
    expect(html).toContain('100 行数据')
    expect(html).toContain('表头：名称 / Bangumi_URL')
    expect(html).toContain('clean-sheet-tag-warn')
    expect(html).toContain('未找到名称列')
    expect(html).toContain('🗓️ 新番表')
    expect(html).toContain('本簿全选')
  })

  it('点击勾选框写入持久化并刷新顶部统计', async () => {
    await mountTwoWorkbooks()
    toggleCheckbox('clean-sheet-D:/B.xlsx-归档', true)

    expect(storage.get('bgm_clean_sheets:D:/B.xlsx')).toBe(JSON.stringify(['归档']))
    expect(byId('cleanSheetSummary').textContent).toContain('已选')
  })

  it('取消勾选同样写回持久化', async () => {
    await mountTwoWorkbooks()
    expect(inputById('clean-sheet-D:/A.xlsx-动画').checked).toBe(true)

    toggleCheckbox('clean-sheet-D:/A.xlsx-动画', false)

    expect(storage.get('bgm_clean_sheets:D:/A.xlsx')).toBe('[]')
  })

  it('勾选框缺少 dataset 时不做任何写入', async () => {
    await mountTwoWorkbooks()
    delete inputById('clean-sheet-D:/A.xlsx-动画').dataset.workbookKey
    const before = storage.get('bgm_clean_sheets:D:/A.xlsx')

    toggleCheckbox('clean-sheet-D:/A.xlsx-动画', false)

    expect(storage.get('bgm_clean_sheets:D:/A.xlsx')).toBe(before)
  })

  it('折叠按钮切换展开状态并重绘整组', async () => {
    await mountTwoWorkbooks()
    const toggle = byId('cleanSheetList').querySelector<HTMLButtonElement>(
      '[data-group-toggle="D:/A.xlsx"]',
    )
    expect(toggle).not.toBeNull()

    toggle?.click()
    // 折叠后该簿的勾选框不再渲染
    expect(document.getElementById('clean-sheet-D:/A.xlsx-动画')).toBeNull()
    expect(byId('cleanSheetList').innerHTML).toContain('▸')

    const reopen = byId('cleanSheetList').querySelector<HTMLButtonElement>(
      '[data-group-toggle="D:/A.xlsx"]',
    )
    reopen?.click()
    expect(document.getElementById('clean-sheet-D:/A.xlsx-动画')).not.toBeNull()
    expect(byId('cleanSheetList').innerHTML).toContain('▾')
  })

  it('折叠按钮缺少键时直接返回', async () => {
    await mountTwoWorkbooks()
    const toggle = byId('cleanSheetList').querySelector<HTMLButtonElement>(
      '[data-group-toggle="D:/A.xlsx"]',
    )
    delete toggle?.dataset.groupToggle

    expect(() => {
      toggle?.click()
    }).not.toThrow()
    expect(document.getElementById('clean-sheet-D:/A.xlsx-动画')).not.toBeNull()
  })

  it('本簿全选选中该簿全部工作表，本簿清空取消全部', async () => {
    await mountTwoWorkbooks()
    byId('cleanSheetList')
      .querySelector<HTMLButtonElement>('[data-group-none="D:/A.xlsx"]')
      ?.click()
    expect(storage.get('bgm_clean_sheets:D:/A.xlsx')).toBe('[]')

    byId('cleanSheetList').querySelector<HTMLButtonElement>('[data-group-all="D:/A.xlsx"]')?.click()
    expect(JSON.parse(storage.get('bgm_clean_sheets:D:/A.xlsx') ?? '[]')).toEqual([
      '动画',
      '新番表',
    ])
    expect(buttonById('cleanRunBtn').disabled).toBe(true)
  })

  it('本簿按钮缺少键时直接返回', async () => {
    await mountTwoWorkbooks()
    const button = byId('cleanSheetList').querySelector<HTMLButtonElement>(
      '[data-group-all="D:/A.xlsx"]',
    )
    delete button?.dataset.groupAll

    expect(() => {
      button?.click()
    }).not.toThrow()
  })

  it('全选 / 全不选工作表按钮作用于全部工作簿', async () => {
    await mountTwoWorkbooks()

    clickById('cleanSelectNoneSheetsBtn')
    expect(JSON.parse(storage.get('bgm_clean_sheets:D:/A.xlsx') ?? 'null')).toEqual([])
    expect(JSON.parse(storage.get('bgm_clean_sheets:D:/B.xlsx') ?? 'null')).toEqual([])

    clickById('cleanSelectAllSheetsBtn')
    expect(JSON.parse(storage.get('bgm_clean_sheets:D:/A.xlsx') ?? '[]')).toEqual([
      '动画',
      '新番表',
    ])
    expect(JSON.parse(storage.get('bgm_clean_sheets:D:/B.xlsx') ?? '[]')).toEqual(['归档'])
    expect(byId('cleanSheetSummary').textContent).toContain('已选 3 张')
  })

  it('顶部统计元素缺失时刷新统计静默跳过', async () => {
    await mountTwoWorkbooks()
    byId('cleanSheetSummary').remove()

    expect(() => {
      toggleCheckbox('clean-sheet-D:/A.xlsx-动画', false)
    }).not.toThrow()
  })

  it('列表容器缺失时加载不抛错', async () => {
    await mountTwoWorkbooks()
    byId('cleanSheetList').remove()

    expect(() => {
      clickById('cleanLoadSheetsBtn')
    }).not.toThrow()
  })
})

// ========== 扫描预览 ==========

describe('handleScan', () => {
  it('未连接宿主时先弹提示并中止（宿主检查位于函数入口）', async () => {
    // 回归：宿主检查原先排在依赖 getApp()?.PluginStorage 的工作表校验之后，该提示永远不可达
    await mountScannable()
    m.getApp.mockReturnValue(null)
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')

    expect(m.dialogAlert).toHaveBeenCalledWith('提示', '未连接到 Excel / WPS，请打开工作簿后重试')
    expect(m.scanCleanRules).not.toHaveBeenCalled()
    expect(loggedMessages()).toEqual([])
  })

  it('未勾选任何清理项时提示并中止', async () => {
    await mountScannable()
    for (const rule of CLEAN_RULES) {
      toggleCheckbox(`clean-item-${rule.id}`, false)
    }

    clickById('cleanScanBtn')

    expect(m.showToast).toHaveBeenCalledWith('请至少勾选一个清理项', 'warn')
    expect(m.scanCleanRules).not.toHaveBeenCalled()
  })

  it('未勾选任何工作表时提示并中止', async () => {
    await mountScannable()
    clickById('cleanSelectNoneSheetsBtn')

    clickById('cleanScanBtn')

    expect(m.showToast).toHaveBeenCalledWith(
      '请先在「🎯 选择清理的表格」中加载并勾选至少一张工作表',
      'warn',
    )
    expect(m.scanCleanRules).not.toHaveBeenCalled()
  })

  it('命中数据时传入勾选规则与工作表，渲染预览并放开执行按钮', async () => {
    await mountScannable()
    m.scanCleanRules.mockReturnValue(hitScanResult())
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')
    await flushAsync()

    const call = m.scanCleanRules.mock.calls[0]
    const ruleIds = call?.[0] ?? []
    expect(ruleIds).toContain('dup-name')
    expect(ruleIds).not.toContain('empty-name')
    const options = call?.[1] as {
      selectedSheets: { workbookKey: string; sheetName: string }[]
    }
    expect(options.selectedSheets).toEqual([{ workbookKey: 'D:/A.xlsx', sheetName: '动画' }])

    const detail = byId('cleanPreviewDetail').innerHTML
    expect(detail).toContain('重复名称行')
    expect(detail).toContain('A / 动画')
    expect(m.renderStatCards).toHaveBeenCalled()
    expect(loggedMessages().some((message) => message.includes('已跳过 1 张非数据表'))).toBe(true)
    expect(loggedMessages().at(-1)).toContain('扫描完成：涉及 1 个文件')
    expect(buttonById('cleanRunBtn').disabled).toBe(false)
    const statsCall = m.renderStatCards.mock.calls[0]
    expect(statsCall?.[0]).toBe(byId('cleanPreviewSummary'))
    const labels = (statsCall?.[1] as { label: string }[]).map((card) => card.label)
    expect(labels).toContain('删除行')
    expect(labels).toContain('预计释放')
  })

  it('无命中时提示用户且保持执行按钮禁用', async () => {
    await mountScannable()
    m.scanCleanRules.mockReturnValue(emptyScanResult())
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')
    await flushAsync()

    expect(byId('cleanPreviewDetail').innerHTML).toContain('未发现需要清理的数据')
    expect(loggedMessages().at(-1)).toContain('扫描完成：未发现需要清理的数据')
    expect(m.showToast).toHaveBeenCalledWith('未发现需要清理的数据', 'info')
    expect(buttonById('cleanRunBtn').disabled).toBe(true)
  })

  it('重复组计划渲染「保留行 vs 待删除行」diff 对比', async () => {
    await mountScannable()
    m.scanCleanRules.mockReturnValue({
      targets: [{ key: 'A.xlsx::动画', label: 'A / 动画' }],
      plans: [
        {
          ruleId: 'dup-name',
          ruleName: '重复名称行',
          targetKey: 'A.xlsx::动画',
          targetLabel: 'A / 动画',
          deleteRows: [9],
          changes: [],
          estimatedBytes: 2048,
          rowPreviews: [{ row: 9, name: '动画A', url: '' }],
          groupPreviews: [
            {
              keepRow: 7,
              keepName: '动画A',
              keepUrl: 'https://bgm.tv/subject/1',
              victims: [{ row: 9, name: '动画A', url: '' }],
            },
          ],
        },
      ],
      fileCount: 1,
      targetCount: 1,
      itemCount: 1,
      estimatedBytes: 2048,
      notes: [],
    })
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')
    await flushAsync()

    const detail = byId('cleanPreviewDetail')
    expect(detail.querySelector('.diff-row-context')?.textContent).toContain(
      '第 1 组 · 名称「动画A」',
    )
    const keepRow = detail.querySelector('.diff-row-keep')
    expect(keepRow?.querySelector('.diff-row-num')?.textContent).toBe('7')
    expect(keepRow?.textContent).toContain('保留')
    const removedRow = detail.querySelector('.diff-row-delete')
    expect(removedRow?.querySelector('.diff-row-num')?.textContent).toBe('9')
    expect(removedRow?.textContent).toContain('无 URL')
  })

  it('单元格变更渲染「- 旧值 / + 新值」行对', async () => {
    await mountScannable()
    m.scanCleanRules.mockReturnValue(hitScanResult())
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')
    await flushAsync()

    const rows = [...byId('cleanPreviewDetail').querySelectorAll('.diff-row')]
    const markers = rows.map((row) => row.querySelector('.diff-marker')?.textContent)
    expect(markers).toContain('-')
    expect(markers).toContain('+')
    const insertRow = rows.find((row) => row.className.includes('diff-row-insert'))
    expect(insertRow?.querySelector('.diff-row-num')?.textContent).toBe('5')
    expect(insertRow?.textContent).toContain('b')
  })

  it('无分组的待删行平铺展示，空白行有占位文案', async () => {
    await mountScannable()
    m.scanCleanRules.mockReturnValue({
      targets: [{ key: 'A.xlsx::动画', label: 'A / 动画' }],
      plans: [
        {
          ruleId: 'empty-name',
          ruleName: '空白数据行',
          targetKey: 'A.xlsx::动画',
          targetLabel: 'A / 动画',
          deleteRows: [12, 30],
          changes: [],
          estimatedBytes: 512,
          rowPreviews: [
            { row: 12, name: '', url: '' },
            { row: 30, name: '', url: '' },
          ],
        },
      ],
      fileCount: 1,
      targetCount: 1,
      itemCount: 2,
      estimatedBytes: 512,
      notes: [],
    })
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')
    await flushAsync()

    const detail = byId('cleanPreviewDetail')
    expect(detail.querySelector('.diff-row-context')).toBeNull()
    const removedRows = detail.querySelectorAll(':scope .diff-row-delete')
    expect(removedRows).toHaveLength(2)
    expect(removedRows[0]?.textContent).toContain('（空白行）')
    expect(detail.textContent).toContain('空白数据行 · 待删除行')
  })

  it('超过每页行数的区块分页渲染，「显示更多」按批追加', async () => {
    await mountScannable()
    const manyRows = Array.from({ length: 60 }, (_, index) => index + 2)
    m.scanCleanRules.mockReturnValue({
      targets: [{ key: 'A.xlsx::动画', label: 'A / 动画' }],
      plans: [
        {
          ruleId: 'empty-name',
          ruleName: '空白数据行',
          targetKey: 'A.xlsx::动画',
          targetLabel: 'A / 动画',
          deleteRows: manyRows,
          changes: [],
          estimatedBytes: 512,
          rowPreviews: manyRows.map((row) => ({ row, name: '', url: '' })),
        },
      ],
      fileCount: 1,
      targetCount: 1,
      itemCount: 60,
      estimatedBytes: 512,
      notes: [],
    })
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')
    await flushAsync()

    const detail = byId('cleanPreviewDetail')
    expect(detail.querySelectorAll(':scope .diff-table tbody tr')).toHaveLength(50)
    const moreButton = detail.querySelector<HTMLButtonElement>('[data-diff-more]')
    expect(moreButton?.textContent).toBe('显示更多（剩余 10 行）')

    moreButton?.click()
    expect(detail.querySelectorAll(':scope .diff-table tbody tr')).toHaveLength(60)
    expect(detail.querySelector('[data-diff-more]')).toBeNull()
  })

  it('扫描抛错时记 error 日志并弹 toast', async () => {
    await mountScannable()
    m.scanCleanRules.mockImplementation(() => {
      throw new Error('工作表被保护')
    })
    m.appendOperationLog.mockClear()

    clickById('cleanScanBtn')

    const call = m.appendOperationLog.mock.calls.at(-1)
    expect(call?.[1]).toBe('扫描失败：工作表被保护')
    expect(call?.[2]).toBe('error')
    expect(m.showToast).toHaveBeenCalledWith('扫描失败：工作表被保护', 'error')
  })

  it('抛出的非 Error 值也能转成文案', async () => {
    await mountScannable()
    m.scanCleanRules.mockImplementation(() => {
      throw '扫描炸了'
    })

    clickById('cleanScanBtn')

    expect(m.showToast).toHaveBeenCalledWith('扫描失败：扫描炸了', 'error')
  })
})

// ========== 执行清理 ==========

describe('handleRun / executeClean', () => {
  it('未扫描就执行时提示先扫描', async () => {
    installApp(makeWorkbooks([]))
    await loadPage()
    page.initCleanPage()
    // 初始态执行按钮本就是禁用的，这里强行放开以直接命中「无扫描结果」防呆分支
    buttonById('cleanRunBtn').disabled = false

    clickById('cleanRunBtn')

    expect(m.showToast).toHaveBeenCalledWith('请先执行扫描预览', 'warn')
    expect(m.dialogConfirm).not.toHaveBeenCalled()
  })

  it('用户取消确认时只记一条 warn 日志', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(false)
    })

    clickById('cleanRunBtn')

    expect(m.runCleanPlans).not.toHaveBeenCalled()
    const call = m.appendOperationLog.mock.calls.at(-1)
    expect(call?.[1]).toBe('已取消执行')
    expect(call?.[2]).toBe('warn')
  })

  it('确认后执行：驱动机内进度、写逐目标与汇总日志、弹成功 toast 并复位按钮', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(true)
    })
    m.runCleanPlans.mockImplementation(async (_result, onProgress) => {
      onProgress(1, 2, '清理中')
      return {
        targets: [
          { targetKey: 'k1', targetLabel: 'A / 动画', deletedRows: 2, changedCells: 1 },
          {
            targetKey: 'k2',
            targetLabel: 'A / 新番',
            deletedRows: 0,
            changedCells: 0,
            error: '被保护',
          },
        ],
        deletedRows: 2,
        changedCells: 1,
        fileCount: 1,
        elapsedMs: 250,
      }
    })

    clickById('cleanRunBtn')
    await flushAsync()

    const progressOptions = m.createProgress.mock.calls[0]?.[0]
    expect(progressOptions?.mode).toBe('inline')
    expect(progressOptions?.hostId).toBe('cleanProgressHost')
    expect(m.progressUpdate).toHaveBeenCalledWith(1, 2, '清理中（1/2）')
    expect(m.progressLog).toHaveBeenCalledWith('清理中（1/2）')

    const messages = loggedMessages()
    expect(messages).toContain('A / 动画：删除 2 行，更新 1 个单元格')
    expect(messages).toContain('A / 新番：清理失败 - 被保护')
    expect(messages.at(-1)).toContain('清理完成：共删除 2 行')
    expect(m.progressComplete).toHaveBeenCalledTimes(1)
    const completeArguments = m.progressComplete.mock.calls[0]?.[0] as {
      summary: string
      details: string[]
    }
    expect(completeArguments.summary).toContain('清理完成')
    expect(completeArguments.details).toHaveLength(2)
    expect(m.showToast).toHaveBeenCalledWith('清理完成：删除 2 行，更新 1 个单元格', 'success')

    // finally：执行后预览失效，按钮回到禁用
    expect(buttonById('cleanRunBtn').disabled).toBe(true)
    expect(buttonById('cleanScanBtn').disabled).toBe(false)
  })

  it('失败目标的日志级别为 error，成功目标为 ok', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(true)
    })
    m.runCleanPlans.mockResolvedValue({
      targets: [
        { targetKey: 'k1', targetLabel: 'A / 动画', deletedRows: 1, changedCells: 0 },
        {
          targetKey: 'k2',
          targetLabel: 'A / 新番',
          deletedRows: 0,
          changedCells: 0,
          error: '锁表',
        },
      ],
      deletedRows: 1,
      changedCells: 0,
      fileCount: 1,
      elapsedMs: 30,
    })

    clickById('cleanRunBtn')
    await flushAsync()

    const levels = m.appendOperationLog.mock.calls.map((call) => call[2])
    expect(levels).toContain('error')
    expect(levels).toContain('ok')
  })

  it('执行抛错时记 error 日志、把进度切到失败态并弹 toast', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(true)
    })
    m.runCleanPlans.mockRejectedValue(new Error('磁盘只读'))

    clickById('cleanRunBtn')
    await flushAsync()

    const failureCall = m.appendOperationLog.mock.calls.at(-1)
    expect(failureCall?.[1]).toBe('执行失败：磁盘只读')
    expect(failureCall?.[2]).toBe('error')
    const completeArguments = m.progressComplete.mock.calls[0]?.[0] as {
      summary: string
      ok: boolean
      icon: string
    }
    expect(completeArguments.ok).toBe(false)
    expect(completeArguments.icon).toBe('❌')
    expect(completeArguments.summary).toBe('执行失败：磁盘只读')
    expect(m.showToast).toHaveBeenCalledWith('执行失败：磁盘只读', 'error')
    expect(buttonById('cleanScanBtn').disabled).toBe(false)
  })

  it('执行中的非 Error 异常也能转成文案', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(true)
    })
    m.runCleanPlans.mockRejectedValue('未知故障')

    clickById('cleanRunBtn')
    await flushAsync()

    expect(m.showToast).toHaveBeenCalledWith('执行失败：未知故障', 'error')
  })

  it('执行期间再次点击执行按钮被防重入拦下', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(true)
    })
    let release: (() => void) | undefined
    m.runCleanPlans.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          release = () => {
            resolve({
              targets: [],
              deletedRows: 0,
              changedCells: 0,
              fileCount: 0,
              elapsedMs: 1,
            })
          }
        }),
    )

    clickById('cleanRunBtn')
    await flushAsync()
    clickById('cleanRunBtn')

    expect(m.dialogConfirm).toHaveBeenCalledTimes(1)
    expect(m.runCleanPlans).toHaveBeenCalledTimes(1)
    expect(buttonById('cleanScanBtn').disabled).toBe(true)

    release?.()
    await flushAsync()
    expect(buttonById('cleanScanBtn').disabled).toBe(false)
  })

  it('第二轮执行会先隐藏上一轮的进度组件', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(true)
    })

    clickById('cleanRunBtn')
    await flushAsync()
    clickById('cleanScanBtn')
    await flushAsync()
    clickById('cleanRunBtn')
    await flushAsync()

    expect(m.progressHide).toHaveBeenCalledTimes(1)
    expect(m.createProgress).toHaveBeenCalledTimes(2)
  })

  it('扫描结果已失效时执行无副作用', async () => {
    await mountRunnable()
    m.dialogConfirm.mockImplementation((_message, onConfirm) => {
      onConfirm(true)
    })
    // 勾选变动会让预览失效
    toggleCheckbox('clean-item-dup-name', false)
    // 预览失效会禁用按钮，放开后才能直接命中 scanResult 为空的分支
    buttonById('cleanRunBtn').disabled = false

    clickById('cleanRunBtn')

    expect(m.runCleanPlans).not.toHaveBeenCalled()
    expect(m.progressComplete).not.toHaveBeenCalled()
  })
})

// ========== 其余按钮与日志 ==========

describe('按钮绑定与日志', () => {
  it('全选 / 清空清理项按钮同步勾选框与持久化', async () => {
    installApp(makeWorkbooks([]))
    await loadPage()
    page.initCleanPage()

    clickById('cleanSelectNoneBtn')
    for (const rule of CLEAN_RULES) {
      expect(inputById(`clean-item-${rule.id}`).checked).toBe(false)
      expect(storage.get(`bgm_clean_on_${rule.id}`)).toBe('false')
    }

    clickById('cleanSelectAllBtn')
    for (const rule of CLEAN_RULES) {
      expect(inputById(`clean-item-${rule.id}`).checked).toBe(true)
      expect(storage.get(`bgm_clean_on_${rule.id}`)).toBe('true')
    }
  })

  it('清理页面按钮缺少元素时不抛错', async () => {
    await loadPage()
    for (const id of [
      'cleanScanBtn',
      'cleanRunBtn',
      'cleanClearLogBtn',
      'cleanLoadSheetsBtn',
      'cleanSelectAllSheetsBtn',
      'cleanSelectNoneSheetsBtn',
      'cleanSelectAllBtn',
      'cleanSelectNoneBtn',
    ]) {
      document.getElementById(id)?.remove()
    }

    expect(() => {
      page.initCleanPage()
    }).not.toThrow()
  })

  it('清空日志同时清 DOM 与可导出存储', async () => {
    await loadPage()
    page.initCleanPage()
    expect(byId('cleanLog').children.length).toBeGreaterThan(0)

    clickById('cleanClearLogBtn')

    expect(m.clearOperationLogs).toHaveBeenCalledWith('clean')
    expect(byId('cleanLog').children).toHaveLength(0)
  })

  it('日志容器缺失时仍写入存储，清空时也只清存储', async () => {
    installAppWithoutWorkbooks()
    await loadPage()
    page.initCleanPage()
    byId('cleanLog').remove()
    m.appendOperationLog.mockClear()

    clickById('cleanLoadSheetsBtn')
    expect(m.appendOperationLog).toHaveBeenCalled()

    expect(() => {
      clickById('cleanClearLogBtn')
    }).not.toThrow()
    expect(m.clearOperationLogs).toHaveBeenCalledWith('clean')
  })

  it('预览区元素缺失时失效处理静默跳过', async () => {
    await loadPage()
    page.initCleanPage()
    byId('cleanPreviewSummary').remove()
    byId('cleanPreviewDetail').remove()

    expect(() => {
      clickById('cleanSelectAllBtn')
    }).not.toThrow()
  })

  it('预览详情元素缺失时仍按命中数放开执行按钮', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({ name: 'A', fullName: 'D:/A.xlsx', sheets: [makeSheet('动画')] }),
      ]),
    )
    await loadPage()
    page.initCleanPage()
    clickById('cleanLoadSheetsBtn')
    byId('cleanPreviewDetail').remove()
    m.scanCleanRules.mockReturnValue(hitScanResult())

    clickById('cleanScanBtn')
    await flushAsync()

    expect(buttonById('cleanRunBtn').disabled).toBe(false)
  })
})

// ========== 配置驱动的渲染一致性 ==========

describe('配置驱动', () => {
  it('清理项列表完全由 CLEAN_RULES 驱动（含风险标签与图标）', async () => {
    await loadPage()
    page.initCleanPage()

    const list = byId('cleanItemList')
    const html = list.innerHTML
    // 转义实体在 innerHTML 赋值→回读时被解码回原文，中文文案断言必须走 textContent
    const text = list.textContent
    for (const rule of CLEAN_RULES) {
      expect(html).toContain(`clean-item-${rule.id}`)
      expect(text).toContain(rule.name)
      expect(text).toContain(rule.desc)
    }
    expect(html).toContain('高风险')
    expect(html).toContain('低风险')
    expect(m.sanitizeHtml).toHaveBeenCalled()
  })

  it('排除配置对工作表名生效（同步记录 / 日志不进入候选）', async () => {
    installApp(
      makeWorkbooks([
        makeWorkbook({
          name: 'A',
          fullName: 'D:/A.xlsx',
          sheets: [
            makeSheet(CLEAN_EXCLUDES.sheetName[0] ?? '同步记录'),
            makeSheet(CLEAN_EXCLUDES.sheetName[1] ?? '富化记录'),
            makeSheet('动画'),
          ],
        }),
      ]),
    )
    await loadPage()
    page.initCleanPage()

    clickById('cleanLoadSheetsBtn')

    expect(loggedMessages().at(-1)).toContain('已加载 1 张工作表')
  })
})
