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
  installCollapseToggles,
  startModuleStateSync,
} from '../ts/tools/module-state.js'
import { CONFIG_KEYS } from '../ts/tools/config.js'

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

/** 建一个最小 panel 结构：侧栏锚点 + 三个模块（其中一个没有 h3） */
function buildPanelDom(): void {
  document.body.innerHTML = `
    <aside><nav class="nav">
      <a href="#sec-command">1</a>
      <a href="#sec-account">2</a>
      <a href="#sec-scope">3</a>
    </nav></aside>
    <main class="main main-grid">
      <section class="command-center" id="sec-command">cmd</section>
      <section class="section" id="sec-account"><h3>账户</h3><div class="body">b</div></section>
      <section class="section" id="sec-scope"><h3>范围</h3><div class="body">b</div></section>
    </main>`
  document.body.dataset.page = 'panel'
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
    installCollapseToggles('panel')
    applyModuleState('panel')
    expect(collapseButton('sec-account').getAttribute('aria-expanded')).toBe('true')
    setCollapsedModules('panel', ['sec-account'])
    applyModuleState('panel')
    expect(collapseButton('sec-account').getAttribute('aria-expanded')).toBe('false')
    expect(collapseButton('sec-account').textContent).toBe('▸')
  })

  it('模块 / 锚点 / 按钮缺失时都安全跳过（页面结构差异不该抛错）', () => {
    document.body.innerHTML = '<main class="main"><section class="section" id="sec-account"><h3>a</h3></section></main>'
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

describe('installCollapseToggles', () => {
  it('给每个带 h3 的模块注入折叠按钮，右上角靠 CSS float', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    expect(collapseButton('sec-account')).toBeTruthy()
    expect(collapseButton('sec-scope')).toBeTruthy()
    // sec-command 没有 h3，不该被注入（它也没有可收起的正文）
    expect(document.querySelector('.mod-collapse-btn[data-mod-collapse="sec-command"]')).toBeNull()
  })

  it('按钮带无障碍属性：aria-controls / aria-expanded / aria-label', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    const button = collapseButton('sec-account')
    expect(button.getAttribute('aria-controls')).toBe('sec-account')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-label')).toContain('账户与凭证')
  })

  it('幂等：重复调用不会叠加按钮', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    installCollapseToggles('panel')
    expect(document.querySelectorAll('.mod-collapse-btn')).toHaveLength(2)
  })

  it('未知页面不注入任何按钮', () => {
    buildPanelDom()
    installCollapseToggles('not-a-page')
    expect(document.querySelectorAll('.mod-collapse-btn')).toHaveLength(0)
  })

  it('无 document 时静默返回', () => {
    vi.stubGlobal('document', undefined)
    expect(() => {
      installCollapseToggles('panel')
    }).not.toThrow()
  })
})

describe('点击折叠按钮', () => {
  it('点击后写入配置并立即套用（本页零延迟）', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    collapseButton('sec-account').click()
    expect(getCollapsedModules('panel')).toEqual(['sec-account'])
    expect(moduleElement('sec-account').classList.contains('is-module-collapsed')).toBe(true)
    expect(collapseButton('sec-account').textContent).toBe('▸')
  })

  it('再点一次展开', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    collapseButton('sec-account').click()
    collapseButton('sec-account').click()
    expect(getCollapsedModules('panel')).toEqual([])
    expect(moduleElement('sec-account').classList.contains('is-module-collapsed')).toBe(false)
  })

  it('点到非按钮元素不触发', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    document.getElementById('sec-account')?.querySelector('.body')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(getCollapsedModules('panel')).toEqual([])
  })

  it('按钮缺 data-mod-collapse 时不触发', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    const orphan = document.createElement('button')
    orphan.className = 'mod-collapse-btn'
    document.body.appendChild(orphan)
    orphan.click()
    expect(getCollapsedModules('panel')).toEqual([])
  })

  it('页面键为空时不触发（不知道该改哪页的配置）', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    delete document.body.dataset.page
    collapseButton('sec-account').click()
    expect(getCollapsedModules('panel')).toEqual([])
  })

  it('所在页面未知时不写入（写入失败就不改 DOM，避免出现「看着折叠了但没存住」）', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    document.body.dataset.page = 'not-a-page'
    collapseButton('sec-account').click()
    expect(getCollapsedModules('not-a-page')).toEqual([])
    expect(moduleElement('sec-account').classList.contains('is-module-collapsed')).toBe(false)
  })

  it('事件目标不是 Element 时忽略', () => {
    buildPanelDom()
    installCollapseToggles('panel')
    document.dispatchEvent(new MouseEvent('click'))
    expect(getCollapsedModules('panel')).toEqual([])
  })
})

describe('startModuleStateSync', () => {
  it('启动即注入按钮并套用一次状态（避免首屏闪回展开）', () => {
    buildPanelDom()
    setCollapsedModules('panel', ['sec-scope'])
    vi.useFakeTimers()
    const stop = startModuleStateSync('panel')
    expect(document.querySelectorAll('.mod-collapse-btn')).toHaveLength(2)
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

  it('无 window 时返回空清理函数且不做任何事', () => {
    buildPanelDom()
    vi.stubGlobal('window', undefined)
    const stop = startModuleStateSync('panel')
    expect(document.querySelectorAll('.mod-collapse-btn')).toHaveLength(0)
    expect(() => {
      stop()
    }).not.toThrow()
  })
})
