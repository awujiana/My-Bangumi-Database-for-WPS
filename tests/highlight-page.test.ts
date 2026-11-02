// @vitest-environment jsdom
/// <reference types="vite/client" />
/**
 * @fileoverview `ts/panel/highlight-page.ts` 单测（高亮页装配与首屏状态）
 *
 * 这个模块此前**零覆盖**（1300+ 行、唯一入口是两个 `ComPhase`），而它是高亮页的
 * 全部接线：恢复配置 → 枚举工作表 → 渲染三组选择器 → 绑定按钮。这里不追求把
 * 每个交互都点一遍（预览 / 应用 / 清除各有 100% 覆盖的兄弟模块承担计算），
 * 只钉住「装配错了就整页不可用」的那几条：
 *
 *  1. **分片顺序**：`highlight-bootstrap` 按 `phases[0..3]` 取片，顺序错了会拿
 *     事件接线当配置阶段跑，页面看着正常但下拉全空。
 *  2. **首屏文案要跟语言走**：预览计数是动态文案，没挂 `data-i18n`，而首屏按设计
 *     不读数据（见 bootstrap 三条硬约束）—— 不在配置阶段写一次，英文界面会一直
 *     停在 HTML 里的「命中 0 行」。
 *  3. **锁定时不静默跳表**：选中键失效就自动跳活动表，对写操作来说代价太高。
 *
 * 页面 DOM 直接取 `ui/highlight.html` 的真实结构：手写一份迷你 DOM 会与页面
 * 悄悄脱节（改 id 后测试仍绿），而这里要验的正是「页面上的元素能不能被接上」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 语言就绪开关 + 变更监听器（`vi.mock` 工厂被提升，状态必须一起 hoisted） */
const i18nState = vi.hoisted(() => ({
  isReady: false,
  listeners: [] as (() => void)[],
}))

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  showToast: vi.fn(),
  markHighlightPaneLoaded: vi.fn(),
  initializeTheme: vi.fn(),
  startThemeSync: vi.fn(),
  initializeI18n: vi.fn(),
  initializeShellNav: vi.fn(),
  notifyModulesReady: vi.fn(),
  mountDataContextNotice: vi.fn(),
  registerTargetSheetApplier: vi.fn(),
  saveDataContext: vi.fn(),
  registerSheetChangeAutoRefresh: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  collectSheets: vi.fn(),
  activeWorksheet: vi.fn(),
  findHeaderRow: vi.fn(),
  getColumnMap: vi.fn(),
  getLastRow: vi.fn(),
  readRangeValues: vi.fn(),
  getApp: vi.fn(),
}))

vi.mock('../ts/ui/dialog.js', () => ({ showToast: mocks.showToast }))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mocks.bgmLog,
  findHeaderRow: mocks.findHeaderRow,
  getApp: mocks.getApp,
  getColumnMap: mocks.getColumnMap,
  getLastRow: mocks.getLastRow,
  markHighlightPaneLoaded: mocks.markHighlightPaneLoaded,
  readRangeValues: mocks.readRangeValues,
}))

vi.mock('../ts/tools/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/tools/config.js')>()
  return { ...actual, getConfig: mocks.getConfig, setConfig: mocks.setConfig }
})

vi.mock('../ts/tools/theme.js', () => ({
  initializeTheme: mocks.initializeTheme,
  startThemeSync: mocks.startThemeSync,
}))

// t 回显 key（带参数时一并回显）：断言「用了哪个 key、传了什么」比断言中文原文更能防回归。
// `canApplyI18n` / `onLocaleChange` 也是 mock：生产里 `initializeI18n()` 是**异步**加载
// 语言包的，配置阶段剩下的代码在同一个 tick 里跑完 —— 真实时序没法在单测里复现，
// 所以把「语言是否就绪」做成开关，「语言变更通知」做成手动触发。
vi.mock('../ts/i18n/index.js', () => ({
  canApplyI18n: () => i18nState.isReady,
  initializeI18n: mocks.initializeI18n,
  // 退订函数在生产里给组件卸载用；页面生命周期与窗格一致，测试不需要，故不返回
  onLocaleChange: (listener: () => void) => {
    i18nState.listeners.push(listener)
  },
  t: (key: string, parameters?: Record<string, unknown>) =>
    parameters === undefined ? `[${key}]` : `[${key}]${JSON.stringify(parameters)}`,
}))

vi.mock('../ts/panel/shell-nav.js', () => ({ initializeShellNav: mocks.initializeShellNav }))
vi.mock('../ts/panel/action-buttons-gate.js', () => ({
  notifyModulesReady: mocks.notifyModulesReady,
}))
vi.mock('../ts/panel/sync-panel-auto-refresh.js', () => ({
  registerSheetChangeAutoRefresh: mocks.registerSheetChangeAutoRefresh,
}))
vi.mock('../ts/tools/data-context.js', () => ({
  mountDataContextNotice: mocks.mountDataContextNotice,
  registerTargetSheetApplier: mocks.registerTargetSheetApplier,
  saveDataContext: mocks.saveDataContext,
  snapshotFromWorksheet: vi.fn(() => ({})),
}))
vi.mock('../ts/tools/sheet-list.js', () => ({
  activeWorksheet: mocks.activeWorksheet,
  collectSheets: mocks.collectSheets,
}))

import highlightHtml from '../ui/highlight.html?raw'
import { createHighlightPagePhases } from '../ts/panel/highlight-page.js'

/** 把 `ui/highlight.html` 的 body 装进 document（去掉 module 脚本，jsdom 不执行它们） */
function mountPage(): void {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/u.exec(highlightHtml)?.[1] ?? ''
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gu, '')
}

/** 造一个工作表条目（`worksheet` 只做身份标识，不需要真 COM 对象） */
function sheetEntry(sheet: string, workbook = 'BGM.xlsx') {
  const worksheet = { Name: sheet }
  return { key: `${workbook}::${sheet}`, workbook, sheet, worksheet }
}

beforeEach(() => {
  mountPage()
  i18nState.isReady = false
  i18nState.listeners = []
  for (const mock of Object.values(mocks)) mock.mockReset()
  // 默认：没有任何已保存配置，读表相关全给空值
  mocks.getConfig.mockImplementation((_key: string, fallback: string) => fallback)
  mocks.collectSheets.mockReturnValue([])
  mocks.activeWorksheet.mockReturnValue(null)
  mocks.getColumnMap.mockReturnValue(new Map())
  mocks.findHeaderRow.mockReturnValue(1)
  mocks.getLastRow.mockReturnValue(0)
  mocks.readRangeValues.mockReturnValue([])
})

afterEach(() => {
  document.body.replaceChildren()
})

/** 跑「恢复配置」分片（不碰 COM 的部分） */
function runConfigPhase(): void {
  const [configPhase] = createHighlightPagePhases()
  // 缺片直接炸：静默跳过会让整组用例变成「什么都没验」的绿灯
  if (configPhase === undefined) throw new Error('createHighlightPagePhases 未返回配置分片')
  configPhase.run()
}

describe('分片装配', () => {
  it('两片：恢复配置 → 事件接线（bootstrap 按索引取，顺序不能变）', () => {
    const phases = createHighlightPagePhases()
    expect(phases.map((phase) => phase.name)).toEqual(['恢复配置', '事件接线'])
  })

  it('配置阶段先点亮 pane 与主题，再初始化 i18n', () => {
    runConfigPhase()

    expect(mocks.markHighlightPaneLoaded).toHaveBeenCalled()
    expect(mocks.initializeTheme).toHaveBeenCalled()
    expect(mocks.initializeI18n).toHaveBeenCalled()
    expect(mocks.startThemeSync).toHaveBeenCalled()
  })
})

/** 模拟「语言包加载完 / 用户切语言」：触发所有已注册的变更监听器 */
function fireLocaleChange(): void {
  for (const listener of i18nState.listeners) listener()
}

describe('首屏预览文案（异步语言包时序）', () => {
  // 这两个节点没有 `data-i18n`（内容是动态计数 / 状态说明，挂静态 key 会被
  // `applyI18n()` 在切语言时覆盖成「0 行」）。而 `initializeI18n()` 是**异步**加载
  // 语言包的，`highlightPhaseConfig()` 剩下的代码在同一个 tick 里跑完 —— 那一刻
  // `t()` 只能返回 key。2026-11-02 实测：修之前首屏直接显示
  // `highlight.preview.countZero`，语言加载完也不会恢复（没有任何人重绘它）。
  it('语言没就绪 → 一个字都不写（保留 HTML 原文，不露 key）', () => {
    const count = document.getElementById('highlightPreviewCount')
    expect(count?.textContent).toBe('命中 0 行')

    runConfigPhase()

    expect(count?.textContent).toBe('命中 0 行')
    expect(count?.textContent).not.toContain('highlight.preview')
    expect(document.getElementById('highlightPreviewTarget')?.textContent ?? '').not.toContain(
      'highlight.preview',
    )
  })

  it('语言就绪后收到变更通知 → 计数与说明都换成译文', () => {
    runConfigPhase()
    i18nState.isReady = true

    fireLocaleChange()

    expect(document.getElementById('highlightPreviewCount')?.textContent).toBe(
      '[highlight.preview.countZero]',
    )
    expect(document.getElementById('highlightPreviewTarget')?.textContent).toBe(
      '[highlight.preview.emptyDefault]',
    )
  })

  it('已有预览结果时切语言 → 重绘摘要但不重新读表', () => {
    bootPage(sheetEntry('Sheet1'))
    mocks.readRangeValues.mockReturnValue([['第1行', '2026-10']])
    i18nState.isReady = true
    document.getElementById('highlightRefreshBtn')?.click()
    expect(mocks.readRangeValues).toHaveBeenCalledTimes(1)

    fireLocaleChange()

    // 切语言是纯渲染：再读一次表就是几百毫秒的同步 COM，用户只改了个下拉
    expect(mocks.readRangeValues).toHaveBeenCalledTimes(1)
    expect(document.getElementById('highlightPreviewCount')?.textContent).toContain(
      'highlight.preview.count',
    )
  })
})

describe('恢复目标表', () => {
  it('上次选中的表还在 → 沿用它', () => {
    const first = sheetEntry('Sheet1')
    const second = sheetEntry('Sheet2')
    mocks.collectSheets.mockReturnValue([first, second])
    mocks.getConfig.mockImplementation((key: string, fallback: string) =>
      key === 'highlight.sheet' ? second.key : fallback,
    )

    runConfigPhase()

    // 选中的表名会被写进标题区（`#highlightSheetName`）
    expect(document.getElementById('highlightSheetName')?.textContent).toBe('Sheet2')
  })

  it('上次的表已关掉且未锁定 → 回落到第一张表', () => {
    mocks.collectSheets.mockReturnValue([sheetEntry('Sheet1'), sheetEntry('Sheet2')])
    mocks.getConfig.mockImplementation((key: string, fallback: string) =>
      key === 'highlight.sheet' ? 'BGM.xlsx::已关闭' : fallback,
    )

    runConfigPhase()

    expect(document.getElementById('highlightSheetName')?.textContent).toBe('Sheet1')
  })

  it('锁定时选中键失效 → 不静默跳走，提示重选', () => {
    mocks.collectSheets.mockReturnValue([sheetEntry('Sheet1')])
    mocks.getConfig.mockImplementation((key: string, fallback: string) => {
      if (key === 'highlight.sheet') return 'BGM.xlsx::已关闭'
      if (key === 'highlight.sheetLock') return '1'
      return fallback
    })

    runConfigPhase()

    const notice = document.getElementById('highlightSheetNotice')
    // 锁定的语义是「别替我换表」：要么留空、要么明确提示，绝不能显示别的表
    expect(document.getElementById('highlightSheetName')?.textContent).not.toBe('Sheet1')
    expect(notice?.hidden).toBe(false)
  })
})

/** 把「配置 + 事件接线」都跑完，页面进入可交互状态（预览按钮此时才有反应） */
function bootPage(entry: ReturnType<typeof sheetEntry>): void {
  // 真实时序：用户点「加载并预览」时语言包早已加载完，`t()` 返回的是译文
  i18nState.isReady = true
  mocks.collectSheets.mockReturnValue([entry])
  mocks.getConfig.mockImplementation((key: string, fallback: string) =>
    key === 'highlight.sheet' ? entry.key : fallback,
  )
  mocks.getColumnMap.mockReturnValue(
    new Map([
      ['名称', 2],
      ['开播季度', 3],
    ]),
  )
  mocks.findHeaderRow.mockReturnValue(1)
  mocks.getLastRow.mockReturnValue(2)
  for (const phase of createHighlightPagePhases()) phase.run()
}

describe('加载并预览', () => {
  it('点「加载并预览」→ 一次矩形读，并把命中数写进计数', () => {
    bootPage(sheetEntry('Sheet1'))
    mocks.readRangeValues.mockReturnValue([['第1行', '2026-10']])

    document.getElementById('highlightRefreshBtn')?.click()

    // 只读一次：预览频繁重算，每次读表都是几百毫秒
    expect(mocks.readRangeValues).toHaveBeenCalledTimes(1)
    // 命中 1 行 → 计数用 `highlight.preview.count` 那条 key（带 {count}）
    expect(document.getElementById('highlightPreviewCount')?.textContent).toContain(
      'highlight.preview.count',
    )
  })

  it('没有可识别的日期列 → 提示换列，而不是静默空白', () => {
    bootPage(sheetEntry('Sheet1'))
    mocks.getColumnMap.mockReturnValue(new Map([['名称', 2]]))

    document.getElementById('highlightRefreshBtn')?.click()

    expect(mocks.readRangeValues).not.toHaveBeenCalled()
    expect(document.getElementById('highlightPreviewTarget')?.textContent).toBe(
      '[highlight.preview.emptyNoDateColumn]',
    )
  })

  it('表里只有表头（没有数据行）→ 给「没有数据」的空态', () => {
    bootPage(sheetEntry('Sheet1'))
    mocks.getLastRow.mockReturnValue(1)

    document.getElementById('highlightRefreshBtn')?.click()

    expect(mocks.readRangeValues).not.toHaveBeenCalled()
    expect(document.getElementById('highlightPreviewTarget')?.textContent).toBe(
      '[highlight.preview.emptyNoRows]',
    )
  })
})
