// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  canHideModule,
  getCollapsedModules,
  getHiddenModules,
  setCollapsedModules,
  setHiddenModules,
  toggleModuleCollapsed,
  toggleModuleHidden,
  applyModuleState,
  bindCollapseToggles,
  startModuleStateSync,
  enterSoloMode,
  exitSoloMode,
  stepSoloMode,
  isSoloMode,
  currentSoloModule,
} from '../ts/tools/module-state.js'
import { CONFIG_KEYS } from '../ts/tools/config.js'
import { PAGE_MODULES } from '../ts/tools/nav-order.js'
import type { NavModule } from '../ts/tools/nav-order.js'
import { registerNotifyApi } from '../ts/core/ui-bridge.js'

/**
 * `bgmLog` 与 `showSettingsPanel` 都来自 `tools/util` 这个巨型 barrel：
 * 前者只是日志，后者要用断言验「点占位块里的按钮真的去开设置页」，故整体替换为 spy。
 */
const { utilityMock } = vi.hoisted(() => ({
  utilityMock: { bgmLog: vi.fn(), showSettingsPanel: vi.fn() },
}))
vi.mock('../ts/tools/util/index.js', () => utilityMock)

/** 全隐藏提示的 toast（其余方法只需满足接口形状） */
const toastSpy = vi.fn()

/**
 * mock 的配置存储。
 * `vi.mock` 工厂会被提升到 import 之前，工厂内不能引用模块级变量 —— 用 `vi.hoisted`。
 * `throwState` 用于让下一次读取抛错，覆盖轮询里的 try/catch。
 */
const { configStore, mockGetConfig, mockSetConfig, throwState } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const state = { next: false }
  return {
    configStore: store,
    throwState: state,
    mockGetConfig: (key: string, fallback = ''): string => {
      if (state.next) {
        state.next = false
        throw new Error('PluginStorage 读取失败')
      }
      return store.get(key) ?? fallback
    },
    mockSetConfig: (key: string, value: string): boolean => {
      store.set(key, value)
      return true
    },
  }
})

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: {
    NAV_ORDER: 'bgm_nav_order',
    MODULE_COLLAPSED: 'bgm_module_collapsed',
    MODULE_HIDDEN: 'bgm_module_hidden',
    LOG_LEVEL: 'bgm_log_level',
  },
  getConfig: mockGetConfig,
  setConfig: mockSetConfig,
}))

/** 生成与生产 HTML 同形的原生折叠按钮（生产里手写在模块 `<h3>` 内，见 ui/*.html） */
function nativeButton(id: string, label: string): string {
  return (
    `<button type="button" class="mod-collapse-btn" data-mod-collapse="${id}" ` +
    `aria-expanded="true" aria-label="折叠 / 展开「${label}」">▾</button>`
  )
}

/** 与 HTML 一致：唯一没有 h3 的模块（panel 的跨栏操作区，门禁白名单里显式登记） */
const NO_TOGGLE_ID = 'sec-command'

/** 某页注册表的全部模块 id（用于「全页隐藏」，避免写死清单随注册表变动而失真） */
function allModuleIds(page: string): string[] {
  return (PAGE_MODULES[page] ?? []).map((module) => module.id)
}

/**
 * 建一个与 `PAGE_MODULES` **同构**的页面 DOM。
 * 模块集合取自注册表而不是写死 —— 否则注册表加一个模块，测试里的「全隐藏」就悄悄失效了
 * （曾经踩过：只隐藏 DOM 里那 3 个，注册表里另外 5 个仍算「可见」）。
 */
function buildPageDom(page: string): void {
  const modules = PAGE_MODULES[page] ?? []
  const anchors = modules.map((module) => `<a href="#${module.id}">${module.label}</a>`).join('')
  const sections = modules
    .map((module) =>
      module.id === NO_TOGGLE_ID
        ? `<section class="command-center" id="${module.id}">cmd</section>`
        : `<section class="section" id="${module.id}"><h3>${module.label}${nativeButton(module.id, module.label)}</h3><div class="body">b</div></section>`,
    )
    .join('')
  document.body.innerHTML = `<aside><nav class="nav">${anchors}</nav></aside><main class="main main-grid">${sections}</main>`
  document.body.dataset.page = page
}

/** 最小 panel 结构 */
function buildPanelDom(): void {
  buildPageDom('panel')
}

/** 最小 settings 结构（含不可隐藏的排序编辑器） */
function buildSettingsDom(): void {
  buildPageDom('settings')
}

/** 全隐藏时插入的常驻占位块（未插入时返回 null） */
function emptyHint(): HTMLElement | null {
  return document.getElementById('module-empty-hint')
}

function moduleElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`测试 DOM 缺少 #${id}`)
  return element
}

function anchorOf(id: string): HTMLElement {
  const anchor = [...document.querySelectorAll<HTMLElement>('.nav a[href^="#"]')].find(
    (element) => element.getAttribute('href') === `#${id}`,
  )
  if (anchor === undefined) throw new Error(`测试 DOM 缺少锚点 #${id}`)
  return anchor
}

function collapseButton(id: string): HTMLElement {
  const button = [...document.querySelectorAll<HTMLElement>('.mod-collapse-btn')].find(
    (element) => element.dataset.modCollapse === id,
  )
  if (button === undefined) throw new Error(`测试 DOM 缺少折叠按钮 ${id}`)
  return button
}

beforeEach(() => {
  configStore.clear()
  throwState.next = false
  document.body.replaceChildren()
  document.body.dataset.page = 'panel'
  registerNotifyApi({
    alert: vi.fn(),
    confirm: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    toast: toastSpy,
    input: vi.fn(),
  })
  // 复位「本页已提示过全隐藏」的内部标记：此时无模块被隐藏，套用一次即清除该页记录
  applyModuleState('panel')
  toastSpy.mockClear()
  utilityMock.showSettingsPanel.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('canHideModule', () => {
  it('普通模块允许隐藏', () => {
    expect(canHideModule('panel', 'sec-account')).toBe(true)
  })

  it('设置页的排序编辑器模块不可隐藏（否则没有入口能恢复）', () => {
    expect(canHideModule('settings', 'sec-modules')).toBe(false)
  })

  it('设置页的其它模块仍可隐藏', () => {
    expect(canHideModule('settings', 'sec-about')).toBe(true)
  })
})

describe('读取：自愈与容错', () => {
  it('无配置时返回空数组', () => {
    expect(getCollapsedModules('panel')).toEqual([])
    expect(getHiddenModules('panel')).toEqual([])
  })

  it('未知页面返回空数组', () => {
    configStore.set(CONFIG_KEYS.MODULE_COLLAPSED, '{"panel":["sec-account"]}')
    expect(getCollapsedModules('not-a-page')).toEqual([])
    expect(getHiddenModules('not-a-page')).toEqual([])
  })

  it('该页配置不是数组时返回空数组', () => {
    configStore.set(CONFIG_KEYS.MODULE_HIDDEN, '{"panel":{"a":1}}')
    expect(getHiddenModules('panel')).toEqual([])
  })

  it('过滤掉非字符串与已下线的模块 id', () => {
    configStore.set(
      CONFIG_KEYS.MODULE_COLLAPSED,
      '{"panel":["sec-account", 42, "sec-removed", null]}',
    )
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
  })

  it('去重（重复 id 不会让模块被算两次）', () => {
    configStore.set(CONFIG_KEYS.MODULE_HIDDEN, '{"panel":["sec-scope","sec-scope"]}')
    expect(getHiddenModules('panel')).toEqual(['sec-scope'])
  })

  it('保持存储中的先后顺序', () => {
    configStore.set(CONFIG_KEYS.MODULE_COLLAPSED, '{"panel":["sec-scope","sec-account"]}')
    expect(getCollapsedModules('panel')).toEqual(['sec-scope', 'sec-account'])
  })

  it('配置为 null / 数字 / 数组时不崩溃，按「无配置」处理', () => {
    for (const raw of ['null', '123', '[]', '"str"', 'true']) {
      configStore.set(CONFIG_KEYS.MODULE_COLLAPSED, raw)
      expect(getCollapsedModules('panel')).toEqual([])
    }
  })

  it('JSON 解析失败时回落到空配置而不是抛错', () => {
    configStore.set(CONFIG_KEYS.MODULE_HIDDEN, '{ 不是 json')
    expect(getHiddenModules('panel')).toEqual([])
  })
})

describe('写入', () => {
  it('写入后可读回', () => {
    expect(setCollapsedModules('panel', ['sec-account'])).toBe(true)
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
    expect(setHiddenModules('panel', ['sec-scope'])).toBe(true)
    expect(getHiddenModules('panel')).toEqual(['sec-scope'])
  })

  it('未知页面写入失败', () => {
    expect(setCollapsedModules('not-a-page', ['sec-account'])).toBe(false)
    expect(setHiddenModules('not-a-page', ['sec-account'])).toBe(false)
  })

  it('过滤未知 id 与重复项', () => {
    setCollapsedModules('panel', ['sec-account', 'sec-nope', 'sec-account'])
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
  })

  it('写入空数组时删掉该页的记录，配置里不留空数组', () => {
    setCollapsedModules('panel', ['sec-account'])
    setHiddenModules('clean', ['sec-log'])
    setCollapsedModules('panel', [])
    // 该页条目被移除；另一个页面的记录不受影响
    expect(configStore.get(CONFIG_KEYS.MODULE_COLLAPSED)).toBe('{}')
    expect(getCollapsedModules('panel')).toEqual([])
    expect(getHiddenModules('clean')).toEqual(['sec-log'])
  })

  it('折叠与隐藏互不干扰', () => {
    setCollapsedModules('panel', ['sec-account'])
    setHiddenModules('panel', ['sec-scope'])
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
    expect(getHiddenModules('panel')).toEqual(['sec-scope'])
  })
})

describe('toggle', () => {
  it('未折叠 → 折叠；再点 → 取消', () => {
    toggleModuleCollapsed('panel', 'sec-account')
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
    toggleModuleCollapsed('panel', 'sec-account')
    expect(getCollapsedModules('panel')).toEqual([])
  })

  it('未隐藏 → 隐藏；再点 → 恢复', () => {
    toggleModuleHidden('panel', 'sec-scope')
    expect(getHiddenModules('panel')).toEqual(['sec-scope'])
    toggleModuleHidden('panel', 'sec-scope')
    expect(getHiddenModules('panel')).toEqual([])
  })

  it('未知页面切换不写入任何状态', () => {
    toggleModuleCollapsed('not-a-page', 'sec-account')
    toggleModuleHidden('not-a-page', 'sec-account')
    expect(getCollapsedModules('not-a-page')).toEqual([])
    expect(getHiddenModules('not-a-page')).toEqual([])
  })

  it('不可隐藏的模块在数据层就被拒绝（UI 置灰只是提示，不能当防线）', () => {
    toggleModuleHidden('settings', 'sec-modules')
    expect(getHiddenModules('settings')).toEqual([])
  })

  it('按页面分别记录：折叠 panel 的不影响 clean 的同名模块', () => {
    toggleModuleCollapsed('panel', 'sec-preview')
    expect(getCollapsedModules('panel')).toContain('sec-preview')
    expect(getCollapsedModules('clean')).not.toContain('sec-preview')
  })
})

/**
 * 设置页「模块排序」是唯一能恢复隐藏模块的入口，所以它自己必须永远可见。
 * 隐藏它 = 永久锁死恢复能力，属于不可违反的不变量。
 */
describe('受保护模块：设置页「模块排序」永远可见', () => {
  it('写入侧剔除：绕过 toggle 直接 setHiddenModules 也存不进去', () => {
    setHiddenModules('settings', ['sec-modules', 'sec-about'])
    expect(getHiddenModules('settings')).toEqual(['sec-about'])
  })

  it('读取侧兜底：配置从别处来（导入 / 旧版本 / 手改存储）也不算隐藏', () => {
    // 直接改存储，模拟任何不经过 setHiddenModules 的来源
    configStore.set(CONFIG_KEYS.MODULE_HIDDEN, JSON.stringify({ settings: ['sec-modules'] }))
    expect(getHiddenModules('settings')).toEqual([])
  })

  it('读取侧兜底同样覆盖套用：编辑页不会被自己藏空', () => {
    document.body.innerHTML =
      '<main class="main"><section class="section" id="sec-modules"><h3>模块排序</h3></section></main>'
    configStore.set(CONFIG_KEYS.MODULE_HIDDEN, JSON.stringify({ settings: ['sec-modules'] }))
    applyModuleState('settings')
    expect(moduleElement('sec-modules').hidden).toBe(false)
  })
})

describe('applyModuleState', () => {
  it('隐藏：模块与侧栏锚点一起消失（只隐藏一处会出现「点了跳到空区块」）', () => {
    buildPanelDom()
    setHiddenModules('panel', ['sec-account'])
    applyModuleState('panel')
    expect(moduleElement('sec-account').hidden).toBe(true)
    expect(anchorOf('sec-account').hidden).toBe(true)
    expect(moduleElement('sec-scope').hidden).toBe(false)
    expect(anchorOf('sec-scope').hidden).toBe(false)
  })

  it('折叠：加 is-module-collapsed 类，模块本身不隐藏', () => {
    buildPanelDom()
    setCollapsedModules('panel', ['sec-scope'])
    applyModuleState('panel')
    expect(moduleElement('sec-scope').classList.contains('is-module-collapsed')).toBe(true)
    expect(moduleElement('sec-scope').hidden).toBe(false)
    expect(moduleElement('sec-account').classList.contains('is-module-collapsed')).toBe(false)
  })

  it('同步折叠按钮的 aria-expanded 与图标', () => {
    buildPanelDom()
    bindCollapseToggles()
    applyModuleState('panel')
    expect(collapseButton('sec-account').getAttribute('aria-expanded')).toBe('true')
    setCollapsedModules('panel', ['sec-account'])
    applyModuleState('panel')
    expect(collapseButton('sec-account').getAttribute('aria-expanded')).toBe('false')
    expect(collapseButton('sec-account').textContent).toBe('▸')
  })

  it('模块 / 锚点 / 按钮缺失时都安全跳过（页面结构差异不该抛错）', () => {
    document.body.innerHTML =
      '<main class="main"><section class="section" id="sec-account"><h3>a</h3></section></main>'
    setHiddenModules('panel', ['sec-account'])
    setCollapsedModules('panel', ['sec-account'])
    expect(() => {
      applyModuleState('panel')
    }).not.toThrow()
    expect(moduleElement('sec-account').hidden).toBe(true)
  })

  it('缺省页面键时取 body[data-page]', () => {
    buildPanelDom()
    setHiddenModules('panel', ['sec-scope'])
    applyModuleState()
    expect(moduleElement('sec-scope').hidden).toBe(true)
  })

  it('页面键为空时不做任何事（不抛错、不乱改 DOM）', () => {
    buildPanelDom()
    delete document.body.dataset.page
    applyModuleState()
    expect(moduleElement('sec-scope').hidden).toBe(false)
  })

  it('未知页面直接返回', () => {
    buildPanelDom()
    applyModuleState('not-a-page')
    expect(moduleElement('sec-scope').hidden).toBe(false)
  })

  it('无 document 时（Node 上下文）静默返回', () => {
    vi.stubGlobal('document', undefined)
    expect(() => {
      applyModuleState('panel')
    }).not.toThrow()
  })
})

describe('bindCollapseToggles：按钮由 HTML 原生提供', () => {
  it('按钮来自 HTML（本模块不再创建按钮），无 h3 的模块没有按钮', () => {
    buildPanelDom()
    expect(document.querySelectorAll('.mod-collapse-btn')).toHaveLength(
      allModuleIds('panel').length - 1,
    )
    bindCollapseToggles()
    expect(document.querySelectorAll('.mod-collapse-btn')).toHaveLength(
      allModuleIds('panel').length - 1,
    )
    // sec-command 没有 h3，生产 HTML 里也没给它按钮（门禁白名单里显式登记）
    expect(document.querySelector('.mod-collapse-btn[data-mod-collapse="sec-command"]')).toBeNull()
  })

  it('aria-controls 由套用状态时补齐（HTML 里不重复写同一个 id）', () => {
    buildPanelDom()
    expect(collapseButton('sec-account').getAttribute('aria-controls')).toBeNull()
    applyModuleState('panel')
    expect(collapseButton('sec-account').getAttribute('aria-controls')).toBe('sec-account')
    expect(collapseButton('sec-account').getAttribute('aria-label')).toContain('账户与凭证')
  })

  it('幂等：重复绑定不会让一次点击切换两次（切换两次等于没反应）', () => {
    buildPanelDom()
    bindCollapseToggles()
    bindCollapseToggles()
    bindCollapseToggles()
    collapseButton('sec-account').click()
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
  })

  it('无 document 时静默返回', () => {
    vi.stubGlobal('document', undefined)
    expect(() => {
      bindCollapseToggles()
    }).not.toThrow()
  })
})

describe('点击折叠按钮', () => {
  it('点击后写入配置并立即套用（本页零延迟）', () => {
    buildPanelDom()
    bindCollapseToggles()
    collapseButton('sec-account').click()
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
    expect(moduleElement('sec-account').classList.contains('is-module-collapsed')).toBe(true)
    expect(collapseButton('sec-account').textContent).toBe('▸')
  })

  it('再点一次展开', () => {
    buildPanelDom()
    bindCollapseToggles()
    collapseButton('sec-account').click()
    collapseButton('sec-account').click()
    expect(getCollapsedModules('panel')).toEqual([])
    expect(moduleElement('sec-account').classList.contains('is-module-collapsed')).toBe(false)
  })

  it('点到非按钮元素不触发', () => {
    buildPanelDom()
    bindCollapseToggles()
    document
      .getElementById('sec-account')
      ?.querySelector('.body')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(getCollapsedModules('panel')).toEqual([])
  })

  it('按钮缺 data-mod-collapse 时不触发', () => {
    buildPanelDom()
    bindCollapseToggles()
    const orphan = document.createElement('button')
    orphan.className = 'mod-collapse-btn'
    document.body.appendChild(orphan)
    orphan.click()
    expect(getCollapsedModules('panel')).toEqual([])
  })

  it('页面键为空时不触发（不知道该改哪页的配置）', () => {
    buildPanelDom()
    bindCollapseToggles()
    delete document.body.dataset.page
    collapseButton('sec-account').click()
    expect(getCollapsedModules('panel')).toEqual([])
  })

  it('所在页面未知时不写入（写入失败就不改 DOM，避免出现「看着折叠了但没存住」）', () => {
    buildPanelDom()
    bindCollapseToggles()
    document.body.dataset.page = 'not-a-page'
    collapseButton('sec-account').click()
    expect(getCollapsedModules('not-a-page')).toEqual([])
    expect(moduleElement('sec-account').classList.contains('is-module-collapsed')).toBe(false)
  })

  it('事件目标不是 Element 时忽略', () => {
    buildPanelDom()
    bindCollapseToggles()
    document.dispatchEvent(new MouseEvent('click'))
    expect(getCollapsedModules('panel')).toEqual([])
  })
})

describe('startModuleStateSync', () => {
  it('启动即套用一次状态（避免首屏闪回展开）', () => {
    buildPanelDom()
    setCollapsedModules('panel', ['sec-scope'])
    vi.useFakeTimers()
    const stop = startModuleStateSync('panel')
    expect(document.querySelectorAll('.mod-collapse-btn')).toHaveLength(
      allModuleIds('panel').length - 1,
    )
    expect(moduleElement('sec-scope').classList.contains('is-module-collapsed')).toBe(true)
    stop()
  })

  it('其它页改了配置后，轮询把变化同步到本页', () => {
    buildPanelDom()
    vi.useFakeTimers()
    const stop = startModuleStateSync('panel')
    // 模拟「设置页在另一个任务窗格隐藏了模块」
    setHiddenModules('panel', ['sec-account'])
    vi.advanceTimersByTime(2000)
    expect(moduleElement('sec-account').hidden).toBe(true)
    stop()
  })

  it('命中变化后切换到加密轮询（300ms 内再次检查），连续调整才跟手', () => {
    buildPanelDom()
    vi.useFakeTimers()
    const stop = startModuleStateSync('panel')
    setCollapsedModules('panel', ['sec-account'])
    vi.advanceTimersByTime(2000)
    expect(collapseButton('sec-account').getAttribute('aria-expanded')).toBe('false')

    setCollapsedModules('panel', ['sec-scope'])
    vi.advanceTimersByTime(300)
    expect(collapseButton('sec-scope').getAttribute('aria-expanded')).toBe('false')
    stop()
  })

  it('读取抛异常时轮询继续，不会中断同步', () => {
    buildPanelDom()
    vi.useFakeTimers()
    const stop = startModuleStateSync('panel')
    throwState.next = true
    expect(() => {
      vi.advanceTimersByTime(2000)
    }).not.toThrow()
    setHiddenModules('panel', ['sec-scope'])
    vi.advanceTimersByTime(2000)
    expect(moduleElement('sec-scope').hidden).toBe(true)
    stop()
  })

  it('返回的清理函数能停掉定时器', () => {
    buildPanelDom()
    vi.useFakeTimers()
    const stop = startModuleStateSync('panel')
    stop()
    setHiddenModules('panel', ['sec-account'])
    vi.advanceTimersByTime(6000)
    expect(moduleElement('sec-account').hidden).toBe(false)
  })

  it('无 window 时返回空清理函数且不套用状态', () => {
    buildPanelDom()
    setCollapsedModules('panel', ['sec-scope'])
    vi.stubGlobal('window', undefined)
    const stop = startModuleStateSync('panel')
    expect(moduleElement('sec-scope').classList.contains('is-module-collapsed')).toBe(false)
    expect(() => {
      stop()
    }).not.toThrow()
  })
})

/**
 * 全隐藏兜底：不禁止用户把某页藏空（可能就是想清屏），
 * 但必须留一条明确的回路 —— 常驻占位块 + 一次 toast + 设置页入口。
 */
describe('全隐藏兜底', () => {
  it('本页模块全被隐藏时插入常驻占位块并提示一次', () => {
    buildPanelDom()
    setHiddenModules('panel', allModuleIds('panel'))
    applyModuleState('panel')
    expect(emptyHint()).not.toBeNull()
    expect(toastSpy).toHaveBeenCalledTimes(1)
  })

  it('重复套用（轮询每次命中都会跑）不会重复提示', () => {
    buildPanelDom()
    setHiddenModules('panel', allModuleIds('panel'))
    applyModuleState('panel')
    applyModuleState('panel')
    applyModuleState('panel')
    expect(document.querySelectorAll('[id="module-empty-hint"]')).toHaveLength(1)
    expect(toastSpy).toHaveBeenCalledTimes(1)
  })

  it('恢复任一模块可见后占位块移除，再次全隐藏会重新提示', () => {
    buildPanelDom()
    setHiddenModules('panel', allModuleIds('panel'))
    applyModuleState('panel')
    expect(emptyHint()).not.toBeNull()

    setHiddenModules('panel', ['sec-account'])
    applyModuleState('panel')
    expect(emptyHint()).toBeNull()

    setHiddenModules('panel', allModuleIds('panel'))
    applyModuleState('panel')
    expect(toastSpy).toHaveBeenCalledTimes(2)
  })

  it('占位块里的「打开设置」按钮打开设置页（唯一的恢复入口）', () => {
    buildPanelDom()
    setHiddenModules('panel', allModuleIds('panel'))
    applyModuleState('panel')
    const button = emptyHint()?.querySelector<HTMLElement>('.module-empty-hint-btn')
    expect(button).not.toBeNull()
    button?.click()
    expect(utilityMock.showSettingsPanel).toHaveBeenCalledTimes(1)
  })

  it('设置页不会触发兜底：排序编辑器永远可见（它不可隐藏）', () => {
    buildSettingsDom()
    setHiddenModules('settings', allModuleIds('settings'))
    applyModuleState('settings')
    expect(emptyHint()).toBeNull()
    expect(toastSpy).not.toHaveBeenCalled()
  })

  it('页面没有 main 容器时只提示、不抛错', () => {
    document.body.innerHTML = '<div>no main</div>'
    setHiddenModules('panel', allModuleIds('panel'))
    expect(() => {
      applyModuleState('panel')
    }).not.toThrow()
    expect(emptyHint()).toBeNull()
    expect(toastSpy).toHaveBeenCalledTimes(1)
  })
})

// ========== 专注模式（只显示单个模块，可上下切换） ==========

/** panel 页注册表（`PAGE_MODULES.panel` 的类型是可选索引，直接下标会报 TS18048） */
function panelModules(): readonly NavModule[] {
  return PAGE_MODULES.panel ?? []
}

/** 取专注控制条（未进入时为 null） */
function soloBar(): HTMLElement | null {
  return document.getElementById('solo-mode-bar')
}

/** 取某模块标题里的专注按钮（注入式，需先跑过 startModuleStateSync） */
function soloButtonOf(id: string): HTMLButtonElement {
  const heading = moduleElement(id).querySelector('h3')
  const button = heading?.querySelector<HTMLButtonElement>('.mod-solo-btn')
  if (!button) throw new Error(`模块 ${id} 没有注入专注按钮`)
  return button
}

describe('专注模式', () => {
  beforeEach(() => {
    // 每个用例都从「未进入专注」开始：soloMode 是模块级状态，跨用例不会自己复位
    exitSoloMode()
    buildPanelDom()
  })

  it('进入后只放行目标模块，其余模块与侧栏锚点全部隐藏', () => {
    const first = panelModules()[1]
    if (!first) throw new Error('panel 注册表为空')
    enterSoloMode('panel', first.id)

    expect(isSoloMode()).toBe(true)
    expect(currentSoloModule()).toBe(first.id)
    expect(moduleElement(first.id).hidden).toBe(false)
    // 目标模块自身必须可见，其余一律藏（含侧栏锚点）
    const others = panelModules().filter((module) => module.id !== first.id)
    for (const module of others) {
      expect(moduleElement(module.id).hidden).toBe(true)
      expect(anchorOf(module.id).hidden).toBe(true)
    }
    // 控制条出现，且有「退出专注」出口（不再显示当前组件名）
    expect(soloBar()).not.toBeNull()
    expect(soloBar()?.textContent).toContain('退出专注')
  })

  it('目标模块即使原本是收起状态，也被强制展开（否则只看到一条标题栏）', () => {
    const target = panelModules()[1]
    if (!target) throw new Error('panel 注册表为空')
    setCollapsedModules('panel', [target.id])

    enterSoloMode('panel', target.id)

    expect(moduleElement(target.id).classList.contains('is-module-collapsed')).toBe(false)
  })

  it('退出后恢复各模块本来的隐藏 / 折叠状态', () => {
    const target = panelModules()[1]
    if (!target) throw new Error('panel 注册表为空')
    // 先造一个「本来就隐藏了某模块」的基线
    const other = panelModules()[2]
    if (!other) throw new Error('panel 注册表模块不足')
    setHiddenModules('panel', [other.id])
    applyModuleState('panel')

    enterSoloMode('panel', target.id)
    expect(moduleElement(other.id).hidden).toBe(true)

    exitSoloMode()

    expect(isSoloMode()).toBe(false)
    expect(currentSoloModule()).toBeNull()
    expect(soloBar()).toBeNull()
    // 目标模块回到默认可见；用户原本隐藏的仍然藏着（没被专注模式吃掉）
    expect(moduleElement(target.id).hidden).toBe(false)
    expect(moduleElement(other.id).hidden).toBe(true)
  })

  it('未注册的模块 id 被拒绝进入（不会把页面搞成只剩一个未知模块）', () => {
    enterSoloMode('panel', 'sec-does-not-exist')
    expect(isSoloMode()).toBe(false)
    expect(soloBar()).toBeNull()
  })

  it('stepSoloMode 按注册顺序循环切换，越界回绕', () => {
    // 口径与 stepSoloMode 内部一致：**全部** DOM 里存在的模块（含没有 h3 的跨栏
    // 操作区）。↑/↓ 是「把每块都看一遍」的导航，不该因为某块没有标题按钮就跳过它 ——
    // 跳过的结果是用户永远翻不到它，反而是缺陷。
    const modules = panelModules().filter((module) => document.getElementById(module.id) !== null)
    if (modules.length < 3) throw new Error('panel 可切换模块不足 3 个')
    const [first, second, third, fourth] = modules
    if (!first || !second || !third || !fourth) throw new Error('解构失败')

    enterSoloMode('panel', first.id)
    stepSoloMode(1)
    expect(currentSoloModule()).toBe(second.id)

    stepSoloMode(1)
    expect(currentSoloModule()).toBe(third.id)

    // 正向走到末尾再一步 → 回绕到第一个
    const last = modules.at(-1)
    if (!last) throw new Error('注册表为空')
    enterSoloMode('panel', last.id)
    stepSoloMode(1)
    expect(currentSoloModule()).toBe(first.id)

    // 在第一个上再反向一步 → 回绕到最后一个
    stepSoloMode(-1)
    expect(currentSoloModule()).toBe(last.id)
    // 确认 fourth 确实参与了轮转（不是被 filter 掉的空引用）
    expect(modules).toContainEqual(fourth)
  })

  it('未进入专注模式时 stepSoloMode 是空操作，不抛错', () => {
    expect(() => {
      stepSoloMode(1)
    }).not.toThrow()
    expect(isSoloMode()).toBe(false)
  })

  it('专注模式下不弹「全部隐藏」兜底提示（那是用户主动选的，不是误藏空）', () => {
    const target = panelModules()[1]
    if (!target) throw new Error('panel 注册表为空')
    enterSoloMode('panel', target.id)

    expect(emptyHint()).toBeNull()
    expect(toastSpy).not.toHaveBeenCalled()
  })

  it('startModuleStateSync 给每个模块标题注入专注按钮（幂等，不重复注入）', () => {
    startModuleStateSync('panel')
    const before = document.querySelectorAll('.mod-solo-btn').length

    startModuleStateSync('panel')
    const after = document.querySelectorAll('.mod-solo-btn').length

    // 只给有 h3 的模块注入：panel 的跨栏操作区没有 h3，故比注册表少一个
    expect(before).toBe(panelModules().length - 1)
    expect(after).toBe(before)
  })

  it('点模块标题里的专注按钮进入专注；再点一次退出', () => {
    startModuleStateSync('panel')
    const target = panelModules()[1]
    if (!target) throw new Error('panel 注册表为空')
    const button = soloButtonOf(target.id)

    button.click()
    expect(isSoloMode()).toBe(true)
    expect(currentSoloModule()).toBe(target.id)
    // 当前目标高亮，用户一眼看出「现在只剩它」
    expect(button.classList.contains('is-active')).toBe(true)

    button.click()
    expect(isSoloMode()).toBe(false)
  })

  it('专注目标切换时，高亮跟着走', () => {
    startModuleStateSync('panel')
    const modules = panelModules().filter(
      (module) => module.id !== NO_TOGGLE_ID && canHideModule('panel', module.id),
    )
    const first = modules[0]
    const second = modules[1]
    if (!first || !second) throw new Error('panel 可专注模块不足 2 个')

    enterSoloMode('panel', first.id)
    expect(soloButtonOf(first.id).classList.contains('is-active')).toBe(true)
    expect(soloButtonOf(second.id).classList.contains('is-active')).toBe(false)

    stepSoloMode(1)
    expect(soloButtonOf(first.id).classList.contains('is-active')).toBe(false)
    expect(soloButtonOf(second.id).classList.contains('is-active')).toBe(true)
  })

  it('控制条上的「退出专注」按钮真的退出', () => {
    const target = panelModules()[1]
    if (!target) throw new Error('panel 注册表为空')
    enterSoloMode('panel', target.id)

    const exit = soloBar()?.querySelector<HTMLButtonElement>('.solo-mode-bar-btn--exit')
    if (!exit) throw new Error('控制条缺少退出按钮')
    exit.click()

    expect(isSoloMode()).toBe(false)
    expect(soloBar()).toBeNull()
  })

  it('控制条上的 ↑ / ↓ 与 stepSoloMode 同一行为', () => {
    const modules = panelModules().filter(
      (module) => module.id !== NO_TOGGLE_ID && canHideModule('panel', module.id),
    )
    const first = modules[0]
    const second = modules[1]
    if (!first || !second) throw new Error('panel 可专注模块不足 2 个')
    enterSoloMode('panel', first.id)

    const buttons = [
      ...(soloBar()?.querySelectorAll<HTMLButtonElement>('.solo-mode-bar-btn') ?? []),
    ]
    const down = buttons.find((button) => button.textContent === '↓')
    const up = buttons.find((button) => button.textContent === '↑')
    if (!down || !up) throw new Error('控制条缺少 ↑ / ↓')

    down.click()
    expect(currentSoloModule()).toBe(second.id)

    up.click()
    expect(currentSoloModule()).toBe(first.id)
  })
})
