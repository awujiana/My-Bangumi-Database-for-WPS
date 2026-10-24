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
  // panel/conditional-format-apply.js（COM 层全家）
  applyConditionalFormatPlan: vi.fn<(worksheet: unknown, plan: unknown) => unknown>(),
  checkFormatConditionsReadable: vi.fn<(worksheet: unknown) => string | null>(),
  deleteForeignRule: vi.fn<(worksheet: unknown, index: number) => unknown>(),
  isFormatConditionsSupported: vi.fn<(worksheet: unknown) => boolean>(),
  moveForeignRule: vi.fn<(worksheet: unknown, index: number, direction: number) => unknown>(),
  readForeignRules: vi.fn<(worksheet: unknown) => unknown[]>(),
  setForeignAppliesTo: vi.fn<(worksheet: unknown, index: number, range: string) => unknown>(),
  setForeignFormula: vi.fn<(worksheet: unknown, index: number, formula: string) => unknown>(),
  setForeignStopIfTrue: vi.fn<(worksheet: unknown, index: number, isStop: boolean) => unknown>(),
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
  { id: 'r1', name: '当前季', group: '番剧高亮', appliesTo: 'B:B', formula: '=1', interior: '#00B050' },
  { id: 'r2', name: '错误标红', group: '数据质量', appliesTo: 'C:C', formula: '=2', interior: '#FF0000' },
  { id: 'r3', name: '春季', group: '番剧高亮', appliesTo: 'D:D', formula: '=3', interior: '#0000FF' },
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
  m.applyConditionalFormatPlan.mockReturnValue({ added: 0, failed: 0 })
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
      return Array.isArray(parsed)
        ? parsed.map((entry) => (entry as { id?: string }).id ?? '')
        : []
    })
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

describe('规则库拖拽提交链路', () => {
  it('拖行到末尾 → moveItemNear 重排并持久化', async () => {
    mockConfigWithRules()
    await openPage()
    const rows = ruleRows()
    stubRects(rows)

    // 拖到全部项之下 → 落末尾
    pointer(rows[0]!, 'pointerdown', 10, 10)
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
    { range: 'B2:B9', formula: '=$B2="x"', kind: 'expression' as const, type: 2, interior: '#00B050' },
    { range: 'C2:C9', formula: '=$C2="y"', kind: 'expression' as const, type: 2, interior: '#FF0000' },
    { range: 'D2:D9', formula: '=$D2="z"', kind: 'expression' as const, type: 2, interior: '#0000FF' },
  ]

  it('读到快照后渲染表格行；右键菜单含导入/归组/停止，边界禁用', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue(SNAPSHOTS)
    await openPage()

    const rows = [...document.querySelectorAll<HTMLElement>('.conditional-format-row[data-row-index]')]
    expect(rows).toHaveLength(3)
    expect(rows[0]?.getAttribute('title')).toContain('拖拽调整优先级')

    rows[0]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    )
    const items = menuItems()
    expect(items.map((item) => item.dataset.menuItem)).toEqual([
      'import',
      'group',
      'stop',
      'up',
      'down',
      'delete',
    ])
    // 公式类可导入（不禁用）；第一条禁用上移
    expect(items[0]?.getAttribute('aria-disabled')).toBeNull()
    expect(items[3]?.getAttribute('aria-disabled')).toBe('true')
  })

  it('拖行下移两格 → 逐格相邻交换 COM（|Δ| 次 moveForeignRule）', async () => {
    mockConfigWithRules([], SHEET_ENTRY.key)
    m.collectSheets.mockReturnValue([SHEET_ENTRY])
    m.readForeignRules.mockReturnValue(SNAPSHOTS)
    await openPage()

    const rows = [...document.querySelectorAll<HTMLElement>('.conditional-format-row[data-row-index]')]
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
  })
})
