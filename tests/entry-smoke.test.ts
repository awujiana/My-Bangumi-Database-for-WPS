/**
 * @fileoverview `ts/entry/**` 装配冒烟测试（jsdom）
 *
 * ## 为什么需要这个文件
 *
 * `ts/entry/**` 在 `vitest.config.ts` 的 `coverage.exclude` 里，理由是「依赖 WPS 宿主，
 * 无法在 Node 测试环境执行」—— 于是这三个生产入口**至今零测试**。但它们的风险不在「能不能跑」，
 * 而在**装配契约**：
 *
 *  1. **装配顺序 / 遗漏**：`startPanel()` 里 5 个调用谁先谁后、少一个都没别的东西会发现。
 *  2. **自动启动守卫**：`window.location.pathname.includes('panel.html')` 这类判断写错，
 *     会导致「在 settings.html 上跑面板初始化」或「该启动时不启动」。
 *  3. **`bgm:modulesReady` 必须异步派发** —— `settings-entry.ts` 里有一大段注释解释：
 *     同步派发时 `settingsBootstrap` 的监听器还没挂上，按钮会一直禁用直到 5s 兜底超时。
 *     **这是最值得锁死的一条契约**，本文件用一个「同步调用后仍未派发」的断言把它钉住。
 *
 * 手法：把入口的全部依赖 mock 成「往共享数组里记一笔」，再通过
 * `window.history.pushState` 切换页面上下文 + `vi.resetModules()` 重新求值模块体，
 * 从而同时覆盖「自动启动」与「不自动启动」两条分支。
 *
 * 注意：**不断言这些 mock 的返回值**，只断言「调了谁、按什么顺序、有没有异步」——
 * 这正是装配层的唯一职责。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 装配调用流水（`vi.hoisted` 保证 mock 工厂能引用到；`vi.resetModules()` 不会清它） */
const calls = vi.hoisted(() => [] as string[])

vi.mock('../ts/panel/panel-page.js', () => ({
  initializePanel: (): void => {
    calls.push('initializePanel')
  },
}))

vi.mock('../ts/tools/theme.js', () => ({
  initializeTheme: (): void => {
    calls.push('initializeTheme')
  },
  startThemeSync: (): void => {
    calls.push('startThemeSync')
  },
}))

vi.mock('../ts/tools/nav-mode.js', () => ({
  startNavModeSync: (): void => {
    calls.push('startNavModeSync')
  },
}))

vi.mock('../ts/tools/nav-order.js', () => ({
  startNavOrderSync: (page: string): void => {
    calls.push(`startNavOrderSync:${page}`)
  },
}))

vi.mock('../ts/tools/module-state.js', () => ({
  startModuleStateSync: (page: string): void => {
    calls.push(`startModuleStateSync:${page}`)
  },
}))

vi.mock('../ts/panel/shell-nav.js', () => ({
  initializeShellNav: (): void => {
    calls.push('initializeShellNav')
  },
}))

vi.mock('../ts/ui/handlers/index.js', () => ({
  initializeHandlers: (): void => {
    calls.push('initializeHandlers')
  },
}))

vi.mock('../ts/tools/util/index.js', () => ({
  markSettingsPaneLoaded: (): void => {
    calls.push('markSettingsPaneLoaded')
  },
}))

vi.mock('../ts/ribbon.js', () => ({
  initializeRibbon: (): void => {
    calls.push('initializeRibbon')
  },
}))

vi.mock('../ts/ui/handlers/token.js', () => ({
  updateTokenStatus: (): void => {
    calls.push('updateTokenStatus')
  },
  updateUserIdStatus: (): void => {
    calls.push('updateUserIdStatus')
  },
}))

vi.mock('../ts/tools/config.js', () => ({
  isIncrementalSyncEnabled: (): boolean => true,
  isSkipConflictsEnabled: (): boolean => false,
  isSyncRecordEnabled: (): boolean => true,
  areNavIconsOnly: (): boolean => false,
  applyLogLevel: (): void => {
    calls.push('applyLogLevel')
  },
  getLogLevel: (): number => 2,
}))

/** 切换「当前页面」（jsdom 下 `pushState` 会同步更新 `location`） */
function gotoPage(path: string): void {
  window.history.pushState({}, '', path)
}

/** 清掉模块注册表后重新求值入口模块体（模块级自动启动逻辑在求值时执行） */
async function loadEntry<T>(specifier: string): Promise<T> {
  vi.resetModules()
  return (await import(/* @vite-ignore */ specifier)) as T
}

/** 建一个复选框并预置初始勾选态（`settings.html` 里真实存在的 ID） */
function mountCheckbox(id: string, isChecked: boolean): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.id = id
  input.checked = isChecked
  document.body.append(input)
  return input
}

/**
 * 建一个带 `<option>` 的 select 并预置初始值。
 * ⚠️ 必须先有匹配的 `<option>`：无 option 时 `select.value = x` 会被**静默丢弃**（值变空串），
 * 那样「回填成功」的断言就变成了假绿。
 */
function mountSelect(id: string, initialValue: string, filledValue: string): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  for (const value of [initialValue, filledValue]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    select.append(option)
  }
  select.value = initialValue
  document.body.append(select)
  return select
}

/** 把 `void (async () => …)()` 里的动态 import 链跑完（微任务 + 一个宏任务） */
async function flushDynamicImports(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

type PanelEntry = typeof import('../ts/entry/panel-entry.js')
type RibbonEntry = typeof import('../ts/entry/ribbon-entry.js')
type SettingsEntry = typeof import('../ts/entry/settings-entry.js')

beforeEach(() => {
  calls.length = 0
  gotoPage('/index.html')
  document.title = ''
  document.body.replaceChildren()
})

describe('entry/panel-entry 装配冒烟', () => {
  it('当前页不是 panel.html 时**不自动启动**（导入即无副作用）', async () => {
    await loadEntry<PanelEntry>('../ts/entry/panel-entry.js')

    expect(calls).toEqual([])
  })

  it('当前页是 panel.html 时自动启动，且装配顺序固定', async () => {
    gotoPage('/panel.html')

    await loadEntry<PanelEntry>('../ts/entry/panel-entry.js')

    // 顺序即契约：主题 → 跨页主题同步 → 跨页导航模式同步 → 面板初始化 → 事件处理注册
    expect(calls).toEqual([
      'initializeTheme',
      'startThemeSync',
      'startNavModeSync',
      'initializePanel',
      'initializeHandlers',
    ])
  })

  it('导出的 startPanel() 可显式调用（非 panel.html 页面手动拉起）', async () => {
    const entry = await loadEntry<PanelEntry>('../ts/entry/panel-entry.js')

    entry.startPanel()

    expect(calls).toEqual([
      'initializeTheme',
      'startThemeSync',
      'startNavModeSync',
      'initializePanel',
      'initializeHandlers',
    ])
  })
})

describe('entry/ribbon-entry 装配冒烟', () => {
  it('浏览器上下文下导入即自动启动（守卫只看 window 是否存在）', async () => {
    await loadEntry<RibbonEntry>('../ts/entry/ribbon-entry.js')

    expect(calls).toEqual(['initializeRibbon'])
  })

  it('导出的 startRibbon() 可显式调用', async () => {
    const entry = await loadEntry<RibbonEntry>('../ts/entry/ribbon-entry.js')
    calls.length = 0

    entry.startRibbon()

    expect(calls).toEqual(['initializeRibbon'])
  })
})

describe('entry/settings-entry 装配冒烟', () => {
  it('当前页不是设置页时**不自动启动**', async () => {
    await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')

    expect(calls).toEqual([])
  })

  it('pathname 含 settings.html 时自动启动', async () => {
    gotoPage('/settings.html')

    await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')

    expect(calls).toContain('initializeHandlers')
  })

  it('pathname 不含 settings.html 但 document.title 含「设置」时同样自动启动', async () => {
    // 覆盖 isSettingsContext() 的第三条判定：WPS Task Pane 的 URL 形态可能不固定，
    // 所以标题也是判据之一
    document.title = 'BGM 设置'

    await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')

    expect(calls).toContain('initializeHandlers')
  })

  it('装配顺序固定，且 markSettingsPaneLoaded 早于 initializeHandlers', async () => {
    gotoPage('/settings.html')

    await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')

    // markSettingsPaneLoaded() 必须早于 initializeHandlers()：showSettingsPanel 靠它判断
    // 缓存的面板 ID 是否有效
    expect(calls).toEqual([
      'initializeTheme',
      'startThemeSync',
      'startNavModeSync',
      'startNavOrderSync:settings',
      'startModuleStateSync:settings',
      'initializeShellNav',
      'markSettingsPaneLoaded',
      'initializeHandlers',
    ])
  })

  it('bgm:modulesReady **必须异步派发**：同步调用 startSettings() 后立刻仍未派发', async () => {
    // 这条契约写在 settings-entry.ts 的注释里：settingsBootstrap 在 import 阶段注册
    // bgm:modulesReady 监听器，若 startSettings() 同步派发，监听器还没挂上，
    // 按钮会一直禁用直到 5s 兜底超时。这里用「同步调用后立即断言未派发」把它钉死。
    const entry = await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')
    const ready: number[] = []
    document.addEventListener('bgm:modulesReady', () => {
      ready.push(1)
    })

    entry.startSettings()

    // 关键断言：startSettings() 是同步函数，若它同步派发，这里就已经是 1
    expect(ready).toHaveLength(0)

    // 让 queueMicrotask 的排队的回调跑完
    await Promise.resolve()
    expect(ready).toHaveLength(1)
  })

  it('pathname 不含 settings.html 但 href 含时同样自动启动（Task Pane 的 URL 形态不固定）', async () => {
    // 只走 isSettingsContext() 的第二条判定：pathname=/index.html，settings.html 只出现在 hash 里
    gotoPage('/index.html#settings.html')

    await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')

    expect(calls).toContain('initializeHandlers')
  })

  it('startSettings() 把已保存配置回填到设置页表单（ID 改名会静默失效，故用真实 DOM 驱动）', async () => {
    const entry = await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')

    // 先反向预置：这样「值变成期望值」才证明代码真的写了，而不是恰好等于默认值
    const chkIncremental = mountCheckbox('chkIncrementalSync', false)
    const chkSkip = mountCheckbox('chkSkipConflicts', true)
    const chkSyncRecord = mountCheckbox('chkEnableSyncRecord', false)
    const chkNavIcons = mountCheckbox('chkNavIconsOnly', true)
    const logLevel = mountSelect('logLevelSelect', '9', '2')

    entry.startSettings()

    // initializeSettingsPage() 内部是 `void (async () => …)()`，回填发生在动态 import 之后
    await vi.waitFor(() => {
      expect(chkIncremental.checked).toBe(true)
    })
    expect(chkSkip.checked).toBe(false)
    expect(chkSyncRecord.checked).toBe(true)
    expect(chkNavIcons.checked).toBe(false)
    expect(logLevel.value).toBe('2')
    expect(calls).toContain('applyLogLevel')
  })

  it('设置页缺少这些表单元素时不抛错（元素可选，且就绪事件照常派发）', async () => {
    const entry = await loadEntry<SettingsEntry>('../ts/entry/settings-entry.js')

    entry.startSettings()
    await flushDynamicImports()

    // 没有元素也不能让初始化中断 —— 中断了就没人派发 bgm:modulesReady，按钮永久禁用
    expect(calls).toContain('initializeHandlers')
  })
})
