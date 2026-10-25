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
  // 默认导出位置（save-file 流程用；测试不关心位置，返回空 = 用对话框默认目录）
  getExportPath: vi.fn<() => string>(),
  setExportPath: vi.fn<(path: string) => boolean>(),
  // tools/save-file.js（选位置 + 写文件；测试环境无 WPS COM，统一 mock）
  saveTextFileWithDialog:
    vi.fn<(options: unknown) => { path: string; via: 'fso' | 'download' } | null>(),
  directoryNameOf: vi.fn<(path: string) => string>(),
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
  getExportPath: m.getExportPath,
  setExportPath: m.setExportPath,
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
      return Array.isArray(parsed) ? parsed.map((entry) => (entry as { id?: string }).id ?? '') : []
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

  it('读到快照后渲染表格行；右键菜单含导入/归组/停止，边界禁用', async () => {
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

    // 下拉渲染成明确空态，而不是空白
    const workbookSelect = document.querySelector<HTMLSelectElement>('#conditionalFormatWorkbook')
    expect(workbookSelect?.options[0]?.textContent).toContain('无已打开的工作簿')

    // 关键断言：change 绑定仍生效（修复前这一段根本没执行）
    const sheetSelect = document.querySelector<HTMLSelectElement>('#conditionalFormatSheet')
    sheetSelect?.dispatchEvent(new Event('change', { bubbles: true }))
    expect(m.setConfig.mock.calls.some(([key]) => key === 'conditionalFormat.sheet.v1')).toBe(true)

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
