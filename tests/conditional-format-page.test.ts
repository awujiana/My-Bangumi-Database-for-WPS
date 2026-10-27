// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/conditional-format-page.ts` 页面级集成测试（jsdom + 真实 HTML 骨架）
 *
 * 为什么值得单独立文件：页面（2400+ 行）此前的验证只到纯函数层（rules/table），
 * 而本会话的全部改动——拖拽排序接入、右键菜单接入、分组重命名/解散、模态框
 * 拖动——都发生在**页面编排层**。组件（sortable/context-menu/modal-drag）有
 * 自己的单测，但「页面把它们接对了没有」只有这里能验：itemSelector 拼写、
 * refresh 时机、菜单 provider 的禁用态、拖拽提交到持久化的链路。
 *
 * 手法（沿用 clean-page.test.ts 的范式）：页面的 import 全是叶子模块 → 逐模块
 * vi.mock 接管；**真实 HTML 骨架**从 ui/conditional-format.html 抽 body 注入
 * jsdom（不执行 script），所有 id 与生产一致——比手搭骨架更防「选择器漂移」。
 * 页面有模块级 state，故每个用例 vi.resetModules() 后动态 import 拿干净实例。
 */

// vite/client 类型：下面用 `?raw` 把生产 HTML 内联成字符串（测试禁 Node 内置
// 模块读不了 fs；?raw 比手搭骨架更防「id 漂移」）
/// <reference types="vite/client" />

import { beforeEach, describe, expect, it, vi } from 'vitest'

// 生产 HTML 骨架内联（?raw）：id 与真实页面一致，防选择器漂移
import pageHtml from '../ui/conditional-format.html?raw'

const m = vi.hoisted(() => ({
  // tools/util/index.js
  bgmLog: vi.fn<(level: number, message?: string) => void>(),
  // 系统剪贴板：默认成功（jsdom 无 execCommand，走真实实现会一路失败）
  copyTextWithResult: vi.fn<(text: string) => { ok: boolean }>(() => ({ ok: true })),
  findHeaderRow: vi.fn<(worksheet: unknown) => number>(),
  getApp: vi.fn<() => unknown>(),
  getColumnMap: vi.fn<(worksheet: unknown) => unknown>(),
  markConditionalFormatPaneLoaded: vi.fn<() => void>(),
  // ui/dialog.js
  showToast: vi.fn<(message: string, type?: string) => void>(),
  showInput: vi.fn<(...arguments_: unknown[]) => void>(),
  // tools/config.js
  getConfig: vi.fn<(key: string, fallback?: string, isGlobal?: boolean) => string>(),
  setConfig: vi.fn<(key: string, value: string, isGlobal?: boolean) => void>(),
  // 默认导出位置（save-file 流程用；测试不关心位置，返回空 = 用对话框默认目录）
  getExportPath: vi.fn<() => string>(),
  setExportPath: vi.fn<(path: string) => boolean>(),
  // 模态框按钮位置（inside = 模态框内；outside = 右上角外置），默认 inside
  getModalButtonsPosition: vi.fn<() => string>(() => 'inside'),
  // tools/save-file.js（选位置 + 写文件；测试环境无 WPS COM，统一 mock）
  saveTextFileWithDialog:
    vi.fn<(options: unknown) => { path: string; via: 'fso' | 'download' } | null>(),
  directoryNameOf: vi.fn<(path: string) => string>(),
  // panel/conditional-format-apply.js（COM 层全家）
  applyConditionalFormatPlan: vi.fn<(worksheet: unknown, plan: unknown) => unknown>(),
  checkFormatConditionsReadable: vi.fn<(worksheet: unknown) => string | null>(),
  deleteForeignRule: vi.fn<(worksheet: unknown, index: number) => unknown>(),
  duplicateForeignRule: vi.fn<(worksheet: unknown, index: number, range?: string) => unknown>(),
  isFormatConditionsSupported: vi.fn<(worksheet: unknown) => boolean>(),
  moveForeignRule: vi.fn<(worksheet: unknown, index: number, direction: number) => unknown>(),
  readForeignRules: vi.fn<(worksheet: unknown) => unknown[]>(),
  setForeignAppliesTo: vi.fn<(worksheet: unknown, index: number, range: string) => unknown>(),
  setForeignFormula: vi.fn<(worksheet: unknown, index: number, formula: string) => unknown>(),
  setForeignStopIfTrue: vi.fn<(worksheet: unknown, index: number, isStop: boolean) => unknown>(),
  updateForeignRule: vi.fn<(worksheet: unknown, index: number, patch: unknown) => unknown>(),
  // panel/shell-nav.js
  initializeShellNav: vi.fn<() => void>(),
  // panel/action-buttons-gate.js
  notifyModulesReady: vi.fn<() => void>(),
  // tools/theme.js
  initializeTheme: vi.fn<() => void>(),
  startThemeSync: vi.fn<() => void>(),
  // tools/sheet-list.js
  activeWorksheet: vi.fn<() => unknown>(),
  collectSheets: vi.fn<() => unknown[]>(),
  // tools/data-context.js
  mountDataContextNotice: vi.fn<() => void>(),
  registerTargetSheetApplier: vi.fn<() => boolean>(),
  // tools/module-state.js
  enterSoloMode: vi.fn<() => void>(),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  copyTextWithResult: m.copyTextWithResult,
  findHeaderRow: m.findHeaderRow,
  getApp: m.getApp,
  getColumnMap: m.getColumnMap,
  markConditionalFormatPaneLoaded: m.markConditionalFormatPaneLoaded,
}))

vi.mock('../ts/ui/dialog.js', () => ({
  showToast: m.showToast,
  showInput: m.showInput,
}))

vi.mock('../ts/tools/config.js', () => ({
  getConfig: m.getConfig,
  setConfig: m.setConfig,
  getExportPath: m.getExportPath,
  setExportPath: m.setExportPath,
  getModalButtonsPosition: m.getModalButtonsPosition,
}))

vi.mock('../ts/tools/save-file.js', () => ({
  saveTextFileWithDialog: m.saveTextFileWithDialog,
  directoryNameOf: m.directoryNameOf,
}))

vi.mock('../ts/panel/conditional-format-apply.js', () => ({
  applyConditionalFormatPlan: m.applyConditionalFormatPlan,
  checkFormatConditionsReadable: m.checkFormatConditionsReadable,
  deleteForeignRule: m.deleteForeignRule,
  isFormatConditionsSupported: m.isFormatConditionsSupported,
  moveForeignRule: m.moveForeignRule,
  readForeignRules: m.readForeignRules,
  setForeignAppliesTo: m.setForeignAppliesTo,
  setForeignFormula: m.setForeignFormula,
  setForeignStopIfTrue: m.setForeignStopIfTrue,
  updateForeignRule: m.updateForeignRule,
  duplicateForeignRule: m.duplicateForeignRule,
}))

vi.mock('../ts/panel/shell-nav.js', () => ({ initializeShellNav: m.initializeShellNav }))
vi.mock('../ts/panel/action-buttons-gate.js', () => ({ notifyModulesReady: m.notifyModulesReady }))
vi.mock('../ts/tools/theme.js', () => ({
  initializeTheme: m.initializeTheme,
  startThemeSync: m.startThemeSync,
}))
vi.mock('../ts/tools/sheet-list.js', () => ({
  activeWorksheet: m.activeWorksheet,
  collectSheets: m.collectSheets,
}))
vi.mock('../ts/tools/data-context.js', () => ({
  mountDataContextNotice: m.mountDataContextNotice,
  registerTargetSheetApplier: m.registerTargetSheetApplier,
}))
vi.mock('../ts/tools/module-state.js', () => ({ enterSoloMode: m.enterSoloMode }))

import { serializeRules } from '../ts/panel/conditional-format-rules.js'
import type { ConditionalFormatRule } from '../ts/panel/conditional-format-rules.js'

type PageModule = typeof import('../ts/panel/conditional-format-page.js')

/** 从生产 HTML 抽 body 注入 jsdom（script 不执行；id 与生产一致） */
function loadPageSkeleton(): void {
  const matched = /<body[^>]*>([\s\S]*)<\/body>/u.exec(pageHtml)
  document.body.innerHTML = matched?.[1] ?? ''
}

/** 三条规则（两个分组），用于验证分组渲染与拖拽 */
const RULES: ConditionalFormatRule[] = [
  {
    id: 'r1',
    name: '当前季',
    group: '番剧高亮',
    appliesTo: 'B:B',
    formula: '=1',
    interior: '#00B050',
  },
  {
    id: 'r2',
    name: '错误标红',
    group: '数据质量',
    appliesTo: 'C:C',
    formula: '=2',
    interior: '#FF0000',
  },
  {
    id: 'r3',
    name: '春季',
    group: '番剧高亮',
    appliesTo: 'D:D',
    formula: '=3',
    interior: '#0000FF',
  },
]

/** 一套工作表条目（selectedSheet 能命中） */
const SHEET_ENTRY = { key: 'wb.xlsx::Sheet1', workbook: 'wb.xlsx', sheet: 'Sheet1', worksheet: {} }

/** 动态 import 干净实例（页面有模块级 state） */
async function loadPage(): Promise<PageModule> {
  vi.resetModules()
  return import('../ts/panel/conditional-format-page.js')
}

/** 跑一遍初始化（mock 都已就位） */
async function openPage(): Promise<PageModule> {
  const page = await loadPage()
  page.initializeConditionalFormatPage()
  return page
}

/** 等两个 rAF（sortable 的位移经合帧后写入） */
async function nextFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

/** 等一个宏任务（页面里 `void asyncFn()` 的收尾：剪贴板写入是 async 的） */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** 给一组元素打上垂直排列的矩形（jsdom 默认全 0，碰撞检测需要真实高度） */
function stubRects(elements: Element[], height = 40): void {
  for (const [index, element] of elements.entries()) {
    ;(element as HTMLElement).getBoundingClientRect = () =>
      ({
        top: index * height,
        bottom: index * height + height,
        left: 0,
        right: 300,
        width: 300,
        height,
      }) as DOMRect
  }
}

function pointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    }),
  )
}

function ruleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.conditional-format-rule[data-rule-id]')]
}

function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.bgm-context-menu-item')]
}

beforeEach(() => {
  vi.clearAllMocks()
  loadPageSkeleton()
  // 默认 mock：空工作表列表 + 空规则库（各用例按需覆盖）
  m.getConfig.mockReturnValue('')
  m.setConfig.mockReturnValue(undefined)
  m.collectSheets.mockReturnValue([])
  m.activeWorksheet.mockReturnValue(null)
  m.checkFormatConditionsReadable.mockReturnValue(null)
  m.readForeignRules.mockReturnValue([])
  m.isFormatConditionsSupported.mockReturnValue(true)
  m.findHeaderRow.mockReturnValue(1)
  m.getColumnMap.mockReturnValue({})
  m.moveForeignRule.mockReturnValue({ ok: true })
  m.deleteForeignRule.mockReturnValue({ ok: true })
  m.setForeignStopIfTrue.mockReturnValue({ ok: true })
  m.setForeignAppliesTo.mockReturnValue({ ok: true })
  m.setForeignFormula.mockReturnValue({ ok: true })
  m.applyConditionalFormatPlan.mockReturnValue({ added: 0, failed: 0, verified: 0 })
  m.updateForeignRule.mockReturnValue({ ok: true, changed: ['公式'], warnings: [] })
  m.duplicateForeignRule.mockReturnValue({ ok: true, range: 'B2:B9' })
})

/** 让 getConfig 按 key 分流返回（规则库 / 目标表 / 其余空） */
function mockConfigWithRules(rules: ConditionalFormatRule[] = RULES, sheetKey = ''): void {
  m.getConfig.mockImplementation((key: string) => {
    if (key === 'conditionalFormat.rules.v1') return serializeRules(rules)
    if (key === 'conditionalFormat.sheet.v1') return sheetKey
    return ''
  })
}

/** 取某次 setConfig 写入的规则序（解析回 id 列表） */
function writtenRuleIds(): string[][] {
  return m.setConfig.mock.calls
    .filter(([key]) => key === 'conditionalFormat.rules.v1')
    .map(([, value]) => {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map((entry) => (entry as { id?: string }).id ?? '') : []
    })
}

/** 打开导入 ▾ 菜单并点某一项 */
function clickImportMenuItem(menuItemId: string): void {
  document.getElementById('conditionalFormatImportMenuBtn')!.click()
  const item = menuItems().find((entry) => entry.dataset.menuItem === menuItemId)
  expect(item).toBeDefined()
  item!.click()
}

/** 规则文件的包装格式（= 项目「导出规则」写进文件的内容） */
function payloadOf(rules: unknown[]): string {
  return JSON.stringify(
    { format: 'bgm-conditional-format-rules', version: 1, exportedAt: '2026-10-27', rules },
    null,
    2,
  )
}

/** 勾选规则库前两条 → 批量条「复制所选」→ 打开粘贴弹窗 */
async function openBatchPaste(): Promise<void> {
  mockConfigWithRules()
  await openPage()
  const boxes = [...document.querySelectorAll<HTMLInputElement>('input[data-action="pick"]')]
  for (const box of boxes.slice(0, 2)) {
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const bar = document.getElementById('conditionalFormatRuleBatchBar')!
  bar.querySelector<HTMLButtonElement>('[data-rule-batch="copy"]')!.click()
  await flushAsync()
  document.getElementById('conditionalFormatPasteBtn')!.click()
}

/** 让工作表有两条既有规则（快照） */
function mockWorksheetRules(): void {
  m.collectSheets.mockReturnValue([SHEET_ENTRY])
  m.getConfig.mockImplementation((key: string) => {
    if (key === 'conditionalFormat.sheet.v1') return SHEET_ENTRY.key
    if (key === 'conditionalFormat.rules.v1') return serializeRules(RULES)
    return ''
  })
  m.readForeignRules.mockReturnValue([
    { range: 'B3:B100', formula: '=$R3=1', kind: 'expression', interior: '#00B050' },
    { range: 'C3:C100', formula: '=$R3=2', kind: 'expression', interior: '#FF0000' },
  ])
}

describe('初始化与渲染', () => {
  it('init 不炸，规则库按分组渲染，行带拖拽提示与 data-rule-id', async () => {
    mockConfigWithRules()
    await openPage()

    const rows = ruleRows()
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.dataset.ruleId)).toEqual(['r1', 'r3', 'r2'])
    // 分组序 = 组内首条规则出现序：番剧高亮（r1,r3）在前，数据质量（r2）在后
    expect(rows[0]?.getAttribute('title')).toContain('拖拽调整优先级')
    const titles = [...document.querySelectorAll<HTMLElement>('.conditional-format-group-title')]
    expect(titles).toHaveLength(2)
    expect(titles[0]?.closest<HTMLElement>('[data-group]')?.dataset.group).toBe('番剧高亮')
    expect(titles[0]?.getAttribute('title')).toContain('拖动调整分组顺序')
  })

  it('roving tabindex：行与组标题都只有第一个是 Tab 停靠点', async () => {
    mockConfigWithRules()
    await openPage()

    const rows = ruleRows()
    expect(rows[0]?.tabIndex).toBe(0)
    expect(rows[1]?.tabIndex).toBe(-1)
    const titles = [...document.querySelectorAll<HTMLElement>('.conditional-format-group-title')]
    expect(titles[0]?.tabIndex).toBe(0)
    expect(titles[1]?.tabIndex).toBe(-1)
    expect(rows[0]?.getAttribute('aria-roledescription')).toBe('可拖拽排序项')
  })
})

describe('规则库右键菜单', () => {
  it('行右键开菜单，边界行禁用上移/下移', async () => {
    mockConfigWithRules()
    await openPage()
    const rows = ruleRows()

    rows[0]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    )
    const items = menuItems()
    expect(items.map((item) => item.dataset.menuItem)).toEqual([
      'edit',
      'copy',
      'up',
      'down',
      'hide',
      'delete',
    ])
    // 第一行（DOM 序）禁用上移
    expect(items[2]?.getAttribute('aria-disabled')).toBe('true')
    expect(items[3]?.getAttribute('aria-disabled')).toBeNull()
  })
})

describe('系统剪贴板（行内 ⧉ 复制）', () => {
  it('⧉ 把规则 JSON 写进系统剪贴板，并提示已复制', async () => {
    mockConfigWithRules()
    await openPage()

    ruleRows()[0]!.querySelector<HTMLButtonElement>('button[data-action="copy"]')!.click()
    await flushAsync()

    // 只写内部剪贴板时用户按 Ctrl+V 拿不到东西 → 必须真写系统剪贴板
    expect(m.copyTextWithResult).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(m.copyTextWithResult.mock.calls[0]![0]) as {
      format?: string
      version?: number
      rules?: { id?: string }[]
    }
    expect(payload.format).toBe('bgm-conditional-format-rules')
    expect(payload.version).toBe(1)
    expect(payload.rules?.map((rule) => rule.id)).toEqual(['r1'])
    expect(m.showToast).toHaveBeenCalledWith(
      expect.stringContaining('已复制 1 条规则到系统剪贴板'),
      'success',
    )
  })

  it('系统剪贴板不可用 → 明说没写进去，但「粘贴」仍能出副本', async () => {
    mockConfigWithRules()
    await openPage()
    m.copyTextWithResult.mockReturnValue({ ok: false })
    // 两条路径都断掉：execCommand 返回失败 + Clipboard API 拒绝
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    })

    ruleRows()[0]!.querySelector<HTMLButtonElement>('button[data-action="copy"]')!.click()
    await flushAsync()

    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('系统剪贴板不可用'), 'warn')
    // 内部剪贴板不受影响：粘贴弹窗照样打开并预填源范围
    document.getElementById('conditionalFormatPasteBtn')!.click()
    expect(document.getElementById('conditionalFormatPasteMask')!.style.display).toBe('flex')
    expect(document.getElementById('conditionalFormatPasteHint')?.textContent).toContain(
      '将粘贴 1 条规则',
    )

    Reflect.deleteProperty(navigator, 'clipboard')
  })
})

describe('「改动未写进工作表」提示', () => {
  it('改规则库后 toast 提醒去点「应用条件格式」', async () => {
    mockConfigWithRules()
    await openPage()
    m.showToast.mockClear()

    // 取消勾选 = 隐藏（规则库改动的典型入口）
    const toggle = ruleRows()[0]!.querySelector<HTMLInputElement>('input[data-action="toggle"]')!
    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('应用条件格式'), 'info')
  })

  it('2 秒内连续改动只提示一次（拖拽调序不该刷屏）', async () => {
    mockConfigWithRules()
    await openPage()
    m.showToast.mockClear()

    // 每次改完都会重渲染，故逐次重新取行（拿旧引用会脱树、事件冒不上去）
    for (const index of [0, 1]) {
      const toggle = ruleRows()[index]!.querySelector<HTMLInputElement>(
        'input[data-action="toggle"]',
      )!
      toggle.checked = false
      toggle.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const notices = m.showToast.mock.calls.filter(([, type]) => type === 'info')
    expect(notices).toHaveLength(1)
  })
})

describe('导入通道（工作表规则 / 文件 / 文本）', () => {
  /** 一条与库里 r1 完全不同的新规则 */
  const NEW_RULE = {
    id: 'x1',
    name: '从文件来的规则',
    group: '导入',
    appliesTo: 'E:E',
    formula: '=$R3="x"',
    interior: '#123456',
  }

  it('▾ 菜单列出三个来源（工作表规则 / 文件 / 文本）', async () => {
    mockConfigWithRules()
    await openPage()
    document.getElementById('conditionalFormatImportMenuBtn')!.click()
    const labels = menuItems().map((item) => item.textContent.trim())
    expect(labels).toHaveLength(3)
    expect(labels[0]).toContain('导入工作表规则')
    expect(labels[1]).toContain('从文件导入')
    expect(labels[2]).toContain('从文本导入')
  })

  it('从文本导入：包装格式解析成功 → 追加到库，完全相同的条目跳过', async () => {
    mockConfigWithRules()
    await openPage()

    clickImportMenuItem('import-text')
    const textarea = document.getElementById(
      'conditionalFormatTextImportInput',
    ) as HTMLTextAreaElement
    expect(document.getElementById('conditionalFormatTextImportMask')!.style.display).toBe('flex')
    // 一条新的 + 一条与库里 r1 完全相同的（后者应被跳过）
    textarea.value = payloadOf([NEW_RULE, { ...RULES[0] }])
    document.getElementById('conditionalFormatTextImportOk')!.click()

    const ids = writtenRuleIds().at(-1) ?? []
    expect(ids).toHaveLength(4)
    expect(ids).toContain('r1')
    expect(ids.filter((id) => id !== 'r1' && id !== 'r2' && id !== 'r3')).toHaveLength(1)
    expect(m.showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入 1 条到「我的规则」'),
      'success',
    )
    // 弹窗关掉
    expect(document.getElementById('conditionalFormatTextImportMask')!.style.display).toBe('none')
  })

  it('从文本导入：空文本 / 不是规则 JSON 都给出可操作提示', async () => {
    mockConfigWithRules()
    await openPage()

    clickImportMenuItem('import-text')
    document.getElementById('conditionalFormatTextImportOk')!.click()
    expect(m.showToast).toHaveBeenCalledWith(
      expect.stringContaining('先把规则 JSON 粘进来'),
      'warn',
    )

    const textarea = document.getElementById(
      'conditionalFormatTextImportInput',
    ) as HTMLTextAreaElement
    textarea.value = '这不是 JSON'
    document.getElementById('conditionalFormatTextImportOk')!.click()
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('没有可识别的规则'), 'warn')
  })

  it('从文件导入：FileReader 读出的包装格式照样进库', async () => {
    mockConfigWithRules()
    await openPage()

    const input = document.getElementById('conditionalFormatImportFile') as HTMLInputElement
    const file = new File([payloadOf([NEW_RULE])], 'bgm-rules.json', {
      type: 'application/json',
    })
    // input.files 是只读的（jsdom 也一样）→ 只能重定义属性
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // FileReader 是异步的：等它 load
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })

    const ids = writtenRuleIds().at(-1) ?? []
    expect(ids).toHaveLength(4)
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('bgm-rules.json'), 'success')
  })
})

describe('粘贴一批规则（表格视图 + 批量范围）', () => {
  it('多条 → 表格列出每条的名称/公式/色块/范围，单条输入框隐藏', async () => {
    await openBatchPaste()

    // hidden 属性与内联 display 都要放开：只改一个的话表格依旧看不见
    const batch = document.getElementById('conditionalFormatPasteBatch')!
    expect(batch.hidden).toBe(false)
    expect(batch.style.display).not.toBe('none')
    expect(document.getElementById('conditionalFormatPasteRange')!.style.display).toBe('none')
    const rows = [...document.querySelectorAll<HTMLElement>('[data-paste-row]')]
    expect(rows).toHaveLength(2)
    // 第一条是 r1（B:B），第二条是 r3（D:D）——按规则库顺序
    const inputs = rows.map((row) => row.querySelector<HTMLInputElement>('[data-paste-range]')!)
    expect(inputs.map((input) => input.value)).toEqual(['B:B', 'D:D'])
    expect(rows[0]?.textContent).toContain('当前季')
    expect(rows[0]?.querySelector('.conditional-format-paste-formula')?.textContent).toBe('=1')
  })

  it('「应用到全部」把统一范围写进每一行', async () => {
    await openBatchPaste()

    const uniform = document.getElementById(
      'conditionalFormatPasteUniformRange',
    ) as HTMLInputElement
    uniform.value = 'Z:Z'
    document.getElementById('conditionalFormatPasteApplyRange')!.click()

    const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-paste-range]')]
    expect(inputs.map((input) => input.value)).toEqual(['Z:Z', 'Z:Z'])
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('统一为 Z:Z'), 'success')
  })

  it('表格里逐条改范围 → 确定后各按自己的范围生成副本', async () => {
    await openBatchPaste()

    const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-paste-range]')]
    inputs[0]!.value = 'B:B'
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }))
    inputs[1]!.value = 'F:F'
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('conditionalFormatPasteOk')!.click()

    const written = JSON.parse(
      m.setConfig.mock.calls.filter(([key]) => key === 'conditionalFormat.rules.v1').at(-1)![1],
    ) as { appliesTo: string; name: string }[]
    const copies = written.filter((rule) => rule.name.endsWith('副本'))
    expect(copies.map((rule) => rule.appliesTo)).toEqual(['B:B', 'F:F'])
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('已粘贴 2 条'), 'success')
  })

  it('批量修改（待粘贴）：统一填充色 + 公式', async () => {
    await openBatchPaste()

    document.getElementById('conditionalFormatPasteBatchEdit')!.click()
    expect(document.getElementById('conditionalFormatBatchMask')!.style.display).toBe('flex')
    // 标题带目标名
    expect(document.getElementById('conditionalFormatBatchLabel')?.textContent).toContain(
      '待粘贴的规则',
    )
    // 填充色下拉里应有两条现有色
    const fillPick = document.getElementById('conditionalFormatBatchFillPick') as HTMLSelectElement
    const fillOptions = [...fillPick.options].map((option) => option.value)
    expect(fillOptions[0]).toBe('keep')
    expect(fillOptions).toContain('value:#00B050')
    expect(fillOptions.at(-1)).toBe('custom')

    fillPick.value = 'value:#00B050'
    const formulaPick = document.getElementById(
      'conditionalFormatBatchFormulaPick',
    ) as HTMLSelectElement
    formulaPick.value = 'custom'
    const formulaInput = document.getElementById(
      'conditionalFormatBatchFormula',
    ) as HTMLInputElement
    formulaInput.value = '=$R3="批量"'
    document.getElementById('conditionalFormatBatchOk')!.click()

    // 表格里的公式列已更新（颜色不可见，断言公式）
    const formulas = [...document.querySelectorAll('.conditional-format-paste-formula')]
    expect(formulas.map((node) => node.textContent)).toEqual(['=$R3="批量"', '=$R3="批量"'])
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('待粘贴的 2 条'), 'success')
  })
})

describe('批量修改（工作表规则 / 我的规则）', () => {
  it('工作表规则：勾选两条 → 批量统一范围，逐条走 updateForeignRule', async () => {
    mockWorksheetRules()
    await openPage()

    // 每勾一条都会重渲染表格 → 拿旧引用会脱树，故逐次重新取
    for (const index of [0, 1]) {
      const box = document.querySelectorAll<HTMLInputElement>(
        '#conditionalFormatExistingList [data-action="select"]',
      )[index]!
      box.checked = true
      box.dispatchEvent(new Event('change', { bubbles: true }))
    }
    document
      .getElementById('conditionalFormatExistingBatchBar')!
      .querySelector<HTMLButtonElement>('[data-batch-action="edit"]')!
      .click()

    expect(document.getElementById('conditionalFormatBatchMask')!.style.display).toBe('flex')
    const rangePick = document.getElementById(
      'conditionalFormatBatchRangePick',
    ) as HTMLSelectElement
    expect([...rangePick.options].map((option) => option.value)).toEqual([
      'keep',
      'value:B3:B100',
      'value:C3:C100',
      'custom',
    ])
    rangePick.value = 'custom'
    ;(document.getElementById('conditionalFormatBatchRange') as HTMLInputElement).value = 'E:E'
    document.getElementById('conditionalFormatBatchOk')!.click()

    expect(m.updateForeignRule).toHaveBeenCalledTimes(2)
    expect(m.updateForeignRule).toHaveBeenCalledWith(expect.anything(), 1, { range: 'E:E' })
    expect(m.updateForeignRule).toHaveBeenCalledWith(expect.anything(), 2, { range: 'E:E' })
    expect(m.showToast).toHaveBeenCalledWith(
      expect.stringContaining('已批量修改 2 条工作表规则'),
      'success',
    )
  })

  it('我的规则：批量统一填充色 → 只改本地库并提示要再应用', async () => {
    mockConfigWithRules()
    await openPage()

    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[data-action="pick"]')]
    for (const box of boxes) {
      box.checked = true
      box.dispatchEvent(new Event('change', { bubbles: true }))
    }
    document
      .getElementById('conditionalFormatRuleBatchBar')!
      .querySelector<HTMLButtonElement>('[data-rule-batch="edit"]')!
      .click()

    const fillPick = document.getElementById('conditionalFormatBatchFillPick') as HTMLSelectElement
    fillPick.value = 'value:#FF0000'
    document.getElementById('conditionalFormatBatchOk')!.click()

    const written = JSON.parse(
      m.setConfig.mock.calls.filter(([key]) => key === 'conditionalFormat.rules.v1').at(-1)![1],
    ) as { interior: string }[]
    expect(written.map((rule) => rule.interior)).toEqual(['#FF0000', '#FF0000', '#FF0000'])
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('应用条件格式'), 'success')
  })

  it('三项都「保持不变」→ 不落盘，只提示', async () => {
    mockConfigWithRules()
    await openPage()

    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[data-action="pick"]')]
    boxes[0]!.checked = true
    boxes[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    document
      .getElementById('conditionalFormatRuleBatchBar')!
      .querySelector<HTMLButtonElement>('[data-rule-batch="edit"]')!
      .click()

    m.setConfig.mockClear()
    document.getElementById('conditionalFormatBatchOk')!.click()
    expect(m.setConfig).not.toHaveBeenCalled()
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('保持不变'), 'warn')
  })
})

describe('规则库拖拽提交链路', () => {
  it('拖行到末尾 → moveItemNear 重排并持久化', async () => {
    mockConfigWithRules()
    await openPage()
    const rows = ruleRows()
    stubRects(rows)

    // 从行内 ⋮⋮ 把手起拖（把手启动：整行按下不再启动拖拽，防误触）
    const handle = rows[0]!.querySelector<HTMLElement>('.conditional-format-rule-handle')!
    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 10, 200)
    await nextFrames()
    pointer(window, 'pointerup', 10, 200)

    const written = writtenRuleIds()
    // 拖到最后一项（r2）之下 = 插到 r2 之后（dnd-kit 语义：落点即邻居，
    // 不是「数组末尾」——要移末尾得把指针拖到 r2 中点的更下方且 r2 是唯一
    // 邻居时 placeAfter 才等价于末尾）
    expect(written.at(-1)).toEqual(['r2', 'r1', 'r3'])
  })

  it('拖组标题到另一组之后 → 整组调序并持久化', async () => {
    mockConfigWithRules()
    await openPage()
    const titles = [...document.querySelectorAll<HTMLElement>('.conditional-format-group-title')]
    stubRects(titles)

    // 拖到第二组标题中点之下
    pointer(titles[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 10, 90)
    await nextFrames()
    pointer(window, 'pointerup', 10, 90)

    const written = writtenRuleIds()
    // 数据质量（r2）整组到前，番剧高亮（r1,r3）组内序不变
    expect(written.at(-1)).toEqual(['r2', 'r1', 'r3'])
  })
})

describe('既有规则表格', () => {
  const SNAPSHOTS = [
    {
      range: 'B2:B9',
      formula: '=$B2="x"',
      kind: 'expression' as const,
      type: 2,
      interior: '#00B050',
    },
    {
      range: 'C2:C9',
      formula: '=$C2="y"',
      kind: 'expression' as const,
      type: 2,
      interior: '#FF0000',
    },
    {
      range: 'D2:D9',
      formula: '=$D2="z"',
      kind: 'expression' as const,
      type: 2,
      interior: '#0000FF',
    },
  ]

  it('读到快照后渲染表格行；右键菜单含导入/编辑/复制/归组/停止，边界禁用', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue(SNAPSHOTS)
    await openPage()

    const rows = [
      ...document.querySelectorAll<HTMLElement>('.conditional-format-row[data-row-index]'),
    ]
    expect(rows).toHaveLength(3)
    expect(rows[0]?.getAttribute('title')).toContain('拖拽调整优先级')

    rows[0]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    )
    const items = menuItems()
    expect(items.map((item) => item.dataset.menuItem)).toEqual([
      'import',
      'edit',
      'duplicate',
      'group',
      'stop',
      'up',
      'down',
      'delete',
    ])
    // 公式类可导入（不禁用）；第一条禁用上移
    expect(items[0]?.getAttribute('aria-disabled')).toBeNull()
    expect(items[5]?.getAttribute('aria-disabled')).toBe('true')
  })

  it('行内 ✎ 打开编辑器：隐藏名称 / 分组，预填范围与公式，保存走 updateForeignRule', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue(SNAPSHOTS)
    await openPage()
    // 先关掉上一个用例可能留下的右键菜单：它的「点外面关闭」是 document 捕获阶段监听，
    // 会吃掉这一次点击（不关就会看到「点了没反应」）
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    const firstRow = document.querySelector<HTMLElement>('.conditional-format-row[data-row-index]')
    firstRow?.querySelector<HTMLButtonElement>('[data-action="edit"]')?.click()

    const mask = document.getElementById('conditionalFormatEditorMask')
    expect(mask?.style.display).toBe('flex')
    // 工作表规则没有「名称 / 分组」这两个概念，整块隐藏
    const libraryFields = document.getElementById('conditionalFormatEditLibraryFields')
    expect(libraryFields?.hidden).toBe(true)
    expect(document.getElementById('conditionalFormatEditRange')?.getAttribute('value')).toBeNull()
    expect((document.getElementById('conditionalFormatEditRange') as HTMLInputElement).value).toBe(
      'B2:B9',
    )
    expect(
      (document.getElementById('conditionalFormatEditFormula') as HTMLTextAreaElement).value,
    ).toBe('=$B2="x"')
    expect(document.getElementById('conditionalFormatEditorLabel')?.textContent).toContain(
      '工作表规则 #1',
    )

    // 改公式后保存 → 写回 COM（不走规则库）
    const formulaInput = document.getElementById(
      'conditionalFormatEditFormula',
    ) as HTMLTextAreaElement
    formulaInput.value = '=$B2="改过"'
    document.getElementById('conditionalFormatEditorSave')?.click()

    expect(m.updateForeignRule).toHaveBeenCalledTimes(1)
    const [, index, patch] = m.updateForeignRule.mock.calls[0] ?? []
    expect(index).toBe(1)
    expect(patch).toEqual({ formula: '=$B2="改过"' })
    expect(mask?.style.display).toBe('none')
  })

  it('行内 ⧉ 打开复制弹窗：标题与提示是「复制」，确定后按填写的范围 Add 副本', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue(SNAPSHOTS)
    await openPage()
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    const firstRow = document.querySelector<HTMLElement>('.conditional-format-row[data-row-index]')
    firstRow?.querySelector<HTMLButtonElement>('[data-action="duplicate"]')?.click()

    expect(document.getElementById('conditionalFormatPasteMask')?.style.display).toBe('flex')
    expect(document.getElementById('conditionalFormatPasteLabel')?.textContent).toContain(
      '复制规则',
    )
    expect(document.getElementById('conditionalFormatPasteHint')?.textContent).toContain('第 1 条')
    const rangeInput = document.getElementById('conditionalFormatPasteRange') as HTMLInputElement
    expect(rangeInput.value).toBe('B2:B9')

    rangeInput.value = 'F2:F9'
    document.getElementById('conditionalFormatPasteOk')?.click()

    expect(m.duplicateForeignRule).toHaveBeenCalledWith(expect.anything(), 1, 'F2:F9')
    expect(document.getElementById('conditionalFormatPasteMask')?.style.display).toBe('none')
  })

  it('拖行下移两格 → 逐格相邻交换 COM（|Δ| 次 moveForeignRule）', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue(SNAPSHOTS)
    await openPage()

    const rows = [
      ...document.querySelectorAll<HTMLElement>('.conditional-format-row[data-row-index]'),
    ]
    stubRects(rows)
    const readCallsBefore = m.readForeignRules.mock.calls.length

    // 拖到第 3 行之下 → 目标位 3
    pointer(rows[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 10, 200)
    await nextFrames()
    pointer(window, 'pointerup', 10, 200)

    // 从第 1 格到第 3 格：两次相邻交换（1→2、2→3）
    expect(m.moveForeignRule.mock.calls).toEqual([
      [SHEET_ENTRY.worksheet, 1, 1],
      [SHEET_ENTRY.worksheet, 2, 1],
    ])
    expect(m.showToast).toHaveBeenCalledWith('已移动 2 格', 'success')
    // 提交后重读整表（loadExistingRules）
    expect(m.readForeignRules.mock.calls.length).toBeGreaterThan(readCallsBefore)

    // 消费掉拖拽后装的一次性 click 拦截器（suppressPostDragClick：吞一次 +
    // 300ms 真实超时自摘）。不主动消费的话它会泄漏进下一个用例，把那边的
    // 首次点击（开弹框之类）吞掉——排查过一轮「按钮全无反应」就是它。
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
})

// ========== 导入弹窗分组（momo：要按照分组导入 / 组内全选） ==========

/** 组 key = 公式 \0 范围（与 snapshotGroupKey 同式），测试里手拼 */
const importGroupKey = (formula: string, range: string): string => `${formula}\u{0}${range}`

/** 开页 + 点导入按钮打开弹框（openImportModal 默认全选可导入项） */
async function openImportModalForTest(): Promise<HTMLElement> {
  await openPage()
  document.querySelector<HTMLButtonElement>('#conditionalFormatImportBtn')?.click()
  const list = document.querySelector<HTMLElement>('#conditionalFormatImportList')
  expect(list).not.toBeNull()
  return list!
}

describe('导入弹窗分组', () => {
  /** 三条规则：甲组两条（含一条不可导入）、乙组一条 */
  const SNAPSHOTS = [
    {
      range: 'B2:B9',
      formula: '=$B2="x"',
      kind: 'expression' as const,
      type: 2,
      interior: '#00B050',
    },
    {
      range: 'D2:D9',
      formula: '',
      kind: 'other' as const,
      type: 3,
    },
    {
      range: 'C2:C9',
      formula: '=$C2="y"',
      kind: 'expression' as const,
      type: 2,
      interior: '#FF0000',
    },
  ]

  /** 甲组的映射（第一条 + 第二条），乙组（第三条）不映射 → 未分组 */
  function mockGroups(): void {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.getConfig.mockImplementation((key: string) => {
      if (key === 'conditionalFormat.sheet.v1') return SHEET_ENTRY.key
      if (key === 'conditionalFormat.existingGroups.v1') {
        return JSON.stringify({
          [importGroupKey('=$B2="x"', 'B2:B9')]: '甲组',
          [importGroupKey('', 'D2:D9')]: '甲组',
        })
      }
      return ''
    })
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue(SNAPSHOTS)
  }

  it('弹框按组渲染：组标题 + 计数 + 组内行，「未分组」排最后', async () => {
    mockGroups()
    const list = await openImportModalForTest()

    // 只取组容器（组标题里的按钮也带 data-import-group，得排除）
    const groups = [
      ...list.querySelectorAll<HTMLElement>('.conditional-format-group[data-import-group]'),
    ]
    expect(groups.map((group) => group.dataset.importGroup)).toEqual(['甲组', '未分组'])
    // 甲组 2 条（含不可导入的也显示，标注类型不支持）
    expect(groups[0]?.querySelectorAll('.conditional-format-import-row')).toHaveLength(2)
    expect(groups[0]?.querySelector('.conditional-format-group-count')?.textContent).toBe('2')
    expect(groups[0]?.querySelector('.conditional-format-tag-warn')).not.toBeNull()
    expect(groups[1]?.querySelectorAll('.conditional-format-import-row')).toHaveLength(1)
  })

  it('组内全选 ☑ 是切换语义：已全选 → 取消本组；再点 → 补全本组', async () => {
    mockGroups()
    const list = await openImportModalForTest()
    const confirm = document.querySelector<HTMLButtonElement>('#conditionalFormatImportConfirm')!

    // 打开时默认全选可导入项（2 条公式类）
    expect(confirm.textContent).toContain('2')

    // 点甲组的 ☑：本组可导入项只有第 1 条 → 取消后只剩未分组的第 3 条
    // （每次重新查询：组内全选会 syncImportSelectionViews 重渲染列表，
    // 旧按钮引用已脱离 DOM，再点不会冒泡到委托监听器）
    const pickInGroup = (): HTMLButtonElement =>
      list.querySelector<HTMLButtonElement>(
        ':scope [data-import-group="甲组"] [data-action="pick-import-group"]',
      )!
    pickInGroup().click()
    expect(confirm.textContent).toContain('1')

    // 再点一次：补回，回到 2 条
    pickInGroup().click()
    expect(confirm.textContent).toContain('2')
  })

  it('组内全选只勾可导入项：类型不支持的禁用行不混进选中集', async () => {
    mockGroups()
    const list = await openImportModalForTest()

    // 先全不选，再点甲组 ☑：甲组里只有第 1 条可导入 → 只勾它
    document.querySelector<HTMLButtonElement>('#conditionalFormatImportNone')?.click()
    list
      .querySelector<HTMLButtonElement>(
        ':scope [data-import-group="甲组"] [data-action="pick-import-group"]',
      )
      ?.click()

    const checked = [...list.querySelectorAll<HTMLInputElement>('[data-import-check]:checked')].map(
      (input) => input.dataset.importCheck,
    )
    expect(checked).toEqual(['1'])
  })

  it('▾ 收起分组：行隐藏（is-collapsed）、标题与计数仍在', async () => {
    mockGroups()
    const list = await openImportModalForTest()

    const group = list.querySelector<HTMLElement>('[data-import-group="甲组"]')!
    group.querySelector<HTMLButtonElement>('[data-action="toggle-import-group"]')!.click()
    const collapsedAgain = list.querySelector<HTMLElement>('[data-import-group="甲组"]') ?? group
    expect(collapsedAgain.classList.contains('is-collapsed')).toBe(true)
    // 计数仍在（收起只藏行）
    expect(collapsedAgain.querySelector('.conditional-format-group-count')?.textContent).toBe('2')
  })

  it('组内全选与既有规则表格联动：弹框里点 ☑，表格勾选同步亮起', async () => {
    mockGroups()
    const list = await openImportModalForTest()
    document.querySelector<HTMLButtonElement>('#conditionalFormatImportNone')?.click()

    list
      .querySelector<HTMLButtonElement>(
        ':scope [data-import-group="甲组"] [data-action="pick-import-group"]',
      )
      ?.click()

    // 表格共用 existingSelection：第 1 条应亮起
    const tableChecks = [
      ...document.querySelectorAll<HTMLInputElement>(
        '#conditionalFormatExistingList [data-action="select"]',
      ),
    ].map((input) => input.checked)
    expect(tableChecks).toEqual([true, false, false])
  })
})

describe('宿主读取失败时的韧性（2026-10-24 真机缺陷）', () => {
  it('collectSheets 抛错：init 不炸、下拉绑定仍生效、给出重试提示', async () => {
    // 真机场景：JSAPI 桥未就绪 / 被调速器限速，同步 COM 抛错。
    // 修复前：异常在绑定段之前抛出 → 后面所有 addEventListener 都没跑到 →
    // 下拉「不能点击不能选中」。修复后：绑定先装、宿主读取在末尾兜底。
    m.collectSheets.mockImplementation(() => {
      throw new Error('JSAPI 桥未就绪')
    })

    const page = await loadPage()
    expect(() => {
      page.initializeConditionalFormatPage()
    }).not.toThrow()

    // 明确报错 + 可恢复（刷新列表按钮是绑好的）
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('刷新列表'), 'error')

    // 选择器渲染成明确空态，而不是空白
    const workbookPicker = document.querySelector('#conditionalFormatWorkbookPicker')
    expect(workbookPicker?.textContent).toContain('无已打开的工作簿')

    // 工作表选择器容器已就位（宿主读取失败时后续可重新渲染）
    expect(document.querySelector('#conditionalFormatSheetPicker')).not.toBeNull()

    // 刷新按钮也已绑定：点它不会抛（会再次尝试枚举并再次兜底）
    const reloadButton = document.querySelector<HTMLButtonElement>(
      '#conditionalFormatReloadSheetsBtn',
    )
    expect(() => {
      reloadButton?.click()
    }).not.toThrow()
  })
})

// ========== 规则库批量操作（momo：全选 / 删除所选 / 导出所选） ==========

describe('规则库批量操作', () => {
  it('行带「勾选」复选框，与可见性 checkbox 是两个输入', async () => {
    mockConfigWithRules()
    await openPage()

    const row = ruleRows()[0]!
    const pick = row.querySelector<HTMLInputElement>('input[data-action="pick"]')
    const vis = row.querySelector<HTMLInputElement>('input[data-action="toggle"]')
    expect(pick).not.toBeNull()
    expect(vis).not.toBeNull()
    // 初始都没勾（ruleSelection 空）；可见性默认应用中（勾着）
    expect(pick?.checked).toBe(false)
    expect(vis?.checked).toBe(true)
  })

  it('勾选行 → 批量条出现「已选 N 条」；删除所选后规则减少', async () => {
    mockConfigWithRules()
    await openPage()

    // 勾前两条（r1 / r3，同组）
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[data-action="pick"]')]
    boxes[0]!.checked = true
    boxes[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    boxes[1]!.checked = true
    boxes[1]!.dispatchEvent(new Event('change', { bubbles: true }))

    const bar = document.getElementById('conditionalFormatRuleBatchBar')!
    expect(bar.classList.contains('is-visible')).toBe(true)
    expect(bar.textContent).toContain('已选 2 条')

    // 删除所选 → 只剩 r2
    const batchDeleteButton = bar.querySelector<HTMLButtonElement>('[data-rule-batch="delete"]')!
    batchDeleteButton.click()
    expect(ruleRows()).toHaveLength(1)
    expect(ruleRows()[0]?.dataset.ruleId).toBe('r2')
    // 删除后批量条收起
    expect(bar.classList.contains('is-visible')).toBe(false)
  })

  it('全选按钮：勾全部可见 → 再点取消', async () => {
    mockConfigWithRules()
    await openPage()

    const pickAll = document.getElementById('conditionalFormatPickAllBtn')!
    pickAll.click()
    const bar = document.getElementById('conditionalFormatRuleBatchBar')!
    expect(bar.textContent).toContain('已选 3 条')

    pickAll.click()
    expect(bar.classList.contains('is-visible')).toBe(false)
  })

  it('组标题三件套：组内全选 / 删除整组 / 导出整组', async () => {
    mockConfigWithRules()
    await openPage()

    const groupTitle = [
      ...document.querySelectorAll<HTMLElement>('.conditional-format-group-title'),
    ][0]!
    expect(groupTitle.querySelector('[data-action="pick-group"]')).not.toBeNull()
    expect(groupTitle.querySelector('[data-action="delete-group"]')).not.toBeNull()
    expect(groupTitle.querySelector('[data-action="export-group"]')).not.toBeNull()

    // 组内全选（第一组 = 番剧高亮，2 条）
    groupTitle.querySelector<HTMLButtonElement>('[data-action="pick-group"]')!.click()
    const bar = document.getElementById('conditionalFormatRuleBatchBar')!
    expect(bar.textContent).toContain('已选 2 条')
  })

  it('导出所选 → 走 saveTextFileWithDialog（选位置流程）', async () => {
    mockConfigWithRules()
    m.getExportPath.mockReturnValue('D:/默认导出')
    m.saveTextFileWithDialog.mockReturnValue({ path: 'D:/备份/rules.json', via: 'fso' })
    m.directoryNameOf.mockReturnValue('D:/备份')
    await openPage()

    const pickAll = document.getElementById('conditionalFormatPickAllBtn')!
    pickAll.click()
    const exportButton = document
      .getElementById('conditionalFormatRuleBatchBar')!
      .querySelector<HTMLButtonElement>('[data-rule-batch="export"]')!
    exportButton.click()

    expect(m.saveTextFileWithDialog).toHaveBeenCalledTimes(1)
    const firstCall = m.saveTextFileWithDialog.mock.calls[0]?.[0] as {
      title?: string
      defaultDir?: string
      content?: string
    }
    expect(firstCall.title).toContain('导出所选规则')
    // 默认目录来自设置页的「默认导出位置」（getExportPath）
    expect(firstCall.defaultDir).toBe('D:/默认导出')
    // 规则序列化进 content（JSON 载荷）
    const payload = JSON.parse(firstCall.content ?? '{}') as { rules?: unknown[] }
    expect(payload.rules).toHaveLength(3)
  })
})

/** 先复制一条规则进剪贴板，再打开粘贴弹窗 */
async function openPasteModalForTest(): Promise<void> {
  mockConfigWithRules()
  await openPage()
  // 行内 ⧉ 复制（第一条规则 r1）
  const copyButton = ruleRows()[0]!.querySelector<HTMLButtonElement>('button[data-action="copy"]')!
  copyButton.click()
  document.getElementById('conditionalFormatPasteBtn')!.click()
}

// ========== 粘贴规则弹窗（可拖动 + 可收起 + 按钮小） ==========

describe('粘贴规则弹窗', () => {
  it('点「粘贴」打开自有模态框（不再走通用 showInput），预填原范围', async () => {
    await openPasteModalForTest()

    const mask = document.getElementById('conditionalFormatPasteMask')!
    expect(mask.style.display).toBe('flex')
    expect(document.getElementById('conditionalFormatPasteTitle')?.textContent).toContain(
      '粘贴规则',
    )
    expect(document.getElementById('conditionalFormatPasteHint')?.textContent).toContain(
      '将粘贴 1 条规则',
    )
    // 预填源规则的范围（RULES[0].appliesTo = 'B:B'）
    const rangeInput = document.getElementById(
      'conditionalFormatPasteRange',
    ) as HTMLInputElement | null
    expect(rangeInput?.value).toBe('B:B')
  })

  it('标题栏是拖动把手（bindModalDrag 目标之一）', async () => {
    await openPasteModalForTest()

    const title = document.getElementById('conditionalFormatPasteTitle')!
    expect(title.classList.contains('conditional-format-modal-grip')).toBe(true)
  })

  it('收起按钮：点一次只留标题栏，再点恢复', async () => {
    await openPasteModalForTest()

    const modal = document.querySelector<HTMLElement>(
      '#conditionalFormatPasteMask .conditional-format-modal',
    )!
    const collapse = document.getElementById('conditionalFormatPasteCollapse')!
    expect(modal.classList.contains('is-collapsed')).toBe(false)

    collapse.click()
    expect(modal.classList.contains('is-collapsed')).toBe(true)
    expect(collapse.textContent).toBe('▸')
    expect(collapse.getAttribute('aria-expanded')).toBe('false')

    collapse.click()
    expect(modal.classList.contains('is-collapsed')).toBe(false)
    expect(collapse.textContent).toBe('▾')
  })

  it('确认粘贴：改目标范围 → 生成副本（公式行号平移）', async () => {
    await openPasteModalForTest()

    const rangeInput = document.getElementById('conditionalFormatPasteRange') as HTMLInputElement
    rangeInput.value = 'D:D'
    document.getElementById('conditionalFormatPasteOk')!.click()

    // 弹窗关闭 + 多了一条副本
    expect(document.getElementById('conditionalFormatPasteMask')!.style.display).toBe('none')
    expect(ruleRows()).toHaveLength(4)
    // 分组渲染：副本跟着源规则留在「番剧高亮」组里（第 3 行）
    const names = ruleRows().map(
      (row) => row.querySelector('.conditional-format-rule-name')?.textContent,
    )
    expect(names).toContain('当前季 副本')
  })

  it('取消：关弹窗不产生副本', async () => {
    await openPasteModalForTest()

    document.getElementById('conditionalFormatPasteCancel')!.click()
    expect(document.getElementById('conditionalFormatPasteMask')!.style.display).toBe('none')
    expect(ruleRows()).toHaveLength(3)
  })
})

// ========== 表格列宽 / 行高（四张表共用 ts/ui/components/table-resize.ts） ==========

/** 表头的把手统计：格子数 = 子元素数 - 行高把手数（行高把手也是表头的子元素） */
function headStats(head: HTMLElement): { cells: number; columns: number; rows: number } {
  const rows = head.querySelectorAll(':scope > .table-resize-row-handle').length
  return {
    cells: head.children.length - rows,
    columns: head.querySelectorAll('.table-resize-handle').length,
    rows,
  }
}

/** 取某张表的表头行（没有就让用例直接失败，而不是后续断言拿到 undefined） */
function headOf(containerId: string): HTMLElement {
  const head = document.querySelector<HTMLElement>(`#${containerId} > .table-resize-head`)
  expect(head).not.toBeNull()
  return head!
}

describe('表格列宽 / 行高', () => {
  it('我的规则：表头 6 格 → 5 个列宽把手 + 1 个行高把手', async () => {
    mockConfigWithRules()
    await openPage()

    const stats = headStats(headOf('conditionalFormatRuleList'))
    expect(stats.cells).toBe(6)
    // 最后一列右边没有下一列，不插列宽把手
    expect(stats.columns).toBe(5)
    expect(stats.rows).toBe(1)
    // 表头是标签不是数据：不该混进规则行集合（否则批量勾选/拖拽排序会多出一条）
    expect(ruleRows()).toHaveLength(3)
    // 行子元素数 == 列数：少一格 → 最后一格会掉到隐式的下一行，看起来像「串行」
    expect(ruleRows()[0]!.children).toHaveLength(stats.cells)
  })

  it('工作表规则：表头 8 格 → 7 个列宽把手', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue([
      { range: 'B2:B9', formula: '=$B2="x"', kind: 'expression', type: 2, interior: '#00B050' },
    ])
    await openPage()

    const stats = headStats(headOf('conditionalFormatExistingList'))
    expect(stats.cells).toBe(8)
    expect(stats.columns).toBe(7)
    expect(stats.rows).toBe(1)
    const row = document.querySelector<HTMLElement>('.conditional-format-row[data-row-index]')!
    expect(row.children).toHaveLength(stats.cells)
  })

  it('导入弹框：表头 5 格 → 4 个列宽把手（打开弹框后才补）', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue([
      { range: 'B2:B9', formula: '=$B2="x"', kind: 'expression', type: 2, interior: '#00B050' },
    ])
    const list = await openImportModalForTest()

    const stats = headStats(list.querySelector<HTMLElement>(':scope > .table-resize-head')!)
    expect(stats.cells).toBe(5)
    expect(stats.columns).toBe(4)
    expect(stats.rows).toBe(1)
    // 可导入的行是 4 格（第 5 列是「类型不支持」标记位，空着），不可导入的是 5 格
    const row = list.querySelector<HTMLElement>(
      '.conditional-format-import-row[data-import-index]',
    )!
    expect(row.children.length).toBeLessThanOrEqual(stats.cells)
  })

  it('粘贴表格：表头 5 格 → 4 个列宽把手（多条才有表格）', async () => {
    await openBatchPaste()

    const stats = headStats(headOf('conditionalFormatPasteTable'))
    expect(stats.cells).toBe(5)
    expect(stats.columns).toBe(4)
    expect(stats.rows).toBe(1)
    const row = document.querySelector<HTMLElement>('[data-paste-row="1"]')!
    expect(row.children).toHaveLength(stats.cells)
  })

  it('拖一列 → 宽度写进 PluginStorage（conditionalFormat.tableSizes.v1）', async () => {
    mockConfigWithRules()
    await openPage()

    const handle = document.querySelector<HTMLElement>(
      '#conditionalFormatRuleList .table-resize-handle[data-col="0"]',
    )!
    const cell = handle.parentElement!
    cell.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 }) as DOMRect

    pointer(handle, 'pointerdown', 100, 10)
    pointer(window, 'pointermove', 140, 10)
    pointer(window, 'pointerup', 140, 10)

    // 只有被拖的那一列被钉成固定 px，其余仍走 CSS 默认模板
    const list = document.getElementById('conditionalFormatRuleList')!
    expect(list.style.getPropertyValue('--table-col-0')).toBe('140px')
    expect(list.style.getPropertyValue('--table-col-1')).toBe('')

    const written = m.setConfig.mock.calls.filter(
      ([key]) => key === 'conditionalFormat.tableSizes.v1',
    )
    expect(written).toHaveLength(1)
    const payload = JSON.parse(written[0]?.[1] ?? '') as {
      library?: { cols?: (number | null)[] }
    }
    expect(payload.library?.cols?.[0]).toBe(140)
  })

  it('重开页面：读回上次的列宽（渲染前就带上变量，不闪一下再变）', async () => {
    m.getConfig.mockImplementation((key: string) => {
      if (key === 'conditionalFormat.rules.v1') return serializeRules(RULES)
      if (key === 'conditionalFormat.tableSizes.v1') {
        return JSON.stringify({ library: { cols: [140], rowHeight: 40 } })
      }
      return ''
    })
    await openPage()

    const list = document.getElementById('conditionalFormatRuleList')!
    expect(list.style.getPropertyValue('--table-col-0')).toBe('140px')
    expect(list.style.getPropertyValue('--table-row-h')).toBe('40px')
  })

  it('存储里是坏 JSON → 退化为全自动，页面照常初始化', async () => {
    m.getConfig.mockImplementation((key: string) => {
      if (key === 'conditionalFormat.rules.v1') return serializeRules(RULES)
      if (key === 'conditionalFormat.tableSizes.v1') return '{不是 JSON'
      return ''
    })
    await openPage()

    const list = document.getElementById('conditionalFormatRuleList')!
    expect(list.style.getPropertyValue('--table-col-0')).toBe('')
    expect(list.style.getPropertyValue('--table-row-h')).toBe('auto')
  })
})

// ========== 浮动窗口工具条（拖出「我的规则」时的标题栏内容） ==========

describe('浮动窗口工具条', () => {
  it('「我的规则」区块声明了 data-detachable-toolbar，且指向真实存在的元素', () => {
    const section = document.getElementById('sec-rules')
    expect(section).not.toBeNull()
    const toolbarId = section!.dataset.detachableToolbar
    // 漏写这个属性**不会报错**：工具条永远带着 hidden 留在页面里，
    // 拖出浮动窗口后标题栏是空的，「显示其格式规则 / ↑↓ / 删除」全点不到。
    // （2026-10-27 实测踩到过，且连带 check:guards-reverse 的变异锚点一起失效。）
    expect(toolbarId).toBe('conditionalFormatFloatToolbar')
    expect(document.getElementById(toolbarId!)).not.toBeNull()
  })

  it('工具条里的三个操作按钮都在（组件搬进标题栏后靠 id 绑定，改 id 会静默失效）', () => {
    for (const id of [
      'conditionalFormatFloatScope',
      'conditionalFormatFloatUp',
      'conditionalFormatFloatDown',
      'conditionalFormatFloatDelete',
    ]) {
      expect(document.getElementById(id)).not.toBeNull()
    }
  })
})
