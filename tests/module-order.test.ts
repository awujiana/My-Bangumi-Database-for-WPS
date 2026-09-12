// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initModuleOrderEditor,
  renderModuleOrderEditor,
  startModuleOrderSync,
} from '../ts/ui/handlers/module-order.js'
import { getNavOrder, setNavOrder } from '../ts/tools/nav-order.js'
import { getHiddenModules } from '../ts/tools/module-state.js'
import { CONFIG_KEYS } from '../ts/tools/config.js'

/**
 * mock 的配置存储与 UI 副作用收集。
 * `vi.mock` 工厂会被提升到 import 之前，工厂内不能引用模块级变量 —— 用 `vi.hoisted` 一并提升。
 * 这里不用 `vi.fn()`（hoisted 回调里引用 vi 不稳），改用普通数组记录调用。
 */
const { configStore, mockGetConfig, mockSetConfig, toastCalls, logCalls } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const toasts: [string, string][] = []
  const logs: [string, string][] = []
  return {
    configStore: store,
    toastCalls: toasts,
    logCalls: logs,
    mockGetConfig: (key: string, fallback = ''): string => store.get(key) ?? fallback,
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

// ui/handlers/module-order 只从 barrel 取这三个符号；mock 掉避免拉起整条 UI 依赖链
vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  bgmLog: (level: string, message: string) => {
    logCalls.push([level, message])
  },
  showToast: (message: string, type: string) => {
    toastCalls.push([message, type])
  },
}))

/** 读所有 toast 的消息（便于断言「有没有提示」） */
function toastMessages(): string[] {
  return toastCalls.map((entry) => entry[0])
}

/** 直接写入 mock 的存储，模拟「被隐藏」的既有配置 */
function setHiddenInStore(page: string, ids: readonly string[]): void {
  configStore.set(CONFIG_KEYS.MODULE_HIDDEN, JSON.stringify({ [page]: [...ids] }))
}

/** 建设置页的最小宿主结构 */
function buildHost(): HTMLElement {
  document.body.innerHTML = '<div id="moduleOrderGroups"></div>'
  document.body.dataset.page = 'settings'
  return hostElement()
}

/** 取当前宿主容器（不清空 DOM） */
function hostElement(): HTMLElement {
  const host = document.getElementById('moduleOrderGroups')
  if (host === null) throw new Error('测试 DOM 缺少 #moduleOrderGroups')
  return host
}

/** 取某个页面分组里的所有条目 */
function itemsOf(page: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.module-order-item')].filter(
    (element) => element.dataset.page === page,
  )
}

/** 取某个页面分组里第 index 个条目的指定按钮 */
function buttonOf(page: string, index: number, selector: string): HTMLElement {
  const button = itemsOf(page)[index]?.querySelector<HTMLElement>(selector)
  if (!button) throw new Error(`缺少按钮 ${page}[${String(index)}] ${selector}`)
  return button
}

/** 按 data-module 找条目的下标 */
function indexOfModule(page: string, moduleId: string): number {
  return itemsOf(page).findIndex((item) => item.dataset.module === moduleId)
}

/** 触发一次冒泡点击 */
function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  configStore.clear()
  toastCalls.length = 0
  logCalls.length = 0
  // 用假定时器：initModuleOrderEditor 内部会起一个 2s 轮询，不冻结会留下悬挂定时器
  vi.useFakeTimers()
  buildHost()
  // 点击 / 拖拽的委托监听器由初始化函数绑定 —— 只调 renderModuleOrderEditor 是不会响应交互的
  initModuleOrderEditor()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('渲染', () => {
  it('四个页面的分组都渲染出来，条目数等于注册表模块数', () => {
    renderModuleOrderEditor()
    expect(itemsOf('panel')).toHaveLength(8)
    expect(itemsOf('enrich')).toHaveLength(6)
    expect(itemsOf('clean')).toHaveLength(5)
    expect(itemsOf('settings')).toHaveLength(9)
  })

  it('没有宿主容器时不渲染也不抛错（非设置页静默跳过）', () => {
    document.body.replaceChildren()
    expect(() => {
      renderModuleOrderEditor()
    }).not.toThrow()
  })

  it('被隐藏的模块带 is-module-hidden 标记并显示 🚫', () => {
    setHiddenInStore('panel', ['sec-account'])
    renderModuleOrderEditor()
    const hiddenItem = document.querySelector('.module-order-item.is-module-hidden')
    expect(hiddenItem?.querySelector('.module-order-label')?.textContent).toBe('账户与凭证')
    expect(buttonOf('panel', indexOfModule('panel', 'sec-account'), '[data-mod-hidden]').textContent).toBe(
      '🚫',
    )
  })

  it('未隐藏的模块显示 👁️', () => {
    renderModuleOrderEditor()
    expect(buttonOf('panel', 0, '[data-mod-hidden]').textContent).toBe('👁️')
  })

  it('设置页的「模块排序」模块不可隐藏（隐藏后就没有入口能恢复任何模块）', () => {
    renderModuleOrderEditor()
    const button = buttonOf('settings', indexOfModule('settings', 'sec-modules'), '[data-mod-hidden]')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('title')).toContain('不可隐藏')
  })

  it('首尾条目的上移 / 下移按钮禁用', () => {
    renderModuleOrderEditor()
    expect(buttonOf('panel', 0, '[data-mod-move="up"]').hasAttribute('disabled')).toBe(true)
    expect(buttonOf('panel', 0, '[data-mod-move="down"]').hasAttribute('disabled')).toBe(false)
  })
})

describe('排序交互', () => {
  it('点上移写入新顺序', () => {
    renderModuleOrderEditor()
    const second = itemsOf('panel')[1]?.dataset.module ?? ''
    click(buttonOf('panel', 1, '[data-mod-move="up"]'))
    expect(getNavOrder('panel')[0]).toBe(second)
  })

  it('点下移写入新顺序', () => {
    renderModuleOrderEditor()
    const first = itemsOf('panel')[0]?.dataset.module ?? ''
    click(buttonOf('panel', 0, '[data-mod-move="down"]'))
    expect(getNavOrder('panel')[1]).toBe(first)
  })

  it('恢复默认顺序', () => {
    setNavOrder('panel', ['sec-help', 'sec-account'])
    renderModuleOrderEditor()
    const reset = document.querySelector<HTMLElement>('[data-mod-reset="panel"]')
    if (!reset) throw new Error('缺少恢复默认按钮')
    click(reset)
    expect(getNavOrder('panel')[0]).toBe('sec-command')
  })

  it('模块 id 不在注册表里时不动配置并提示失败', () => {
    renderModuleOrderEditor()
    // 处理器读的是按钮上的 data-module（不是 li 的）
    buttonOf('panel', 0, '[data-mod-move="down"]').dataset.module = 'sec-nope'
    click(buttonOf('panel', 0, '[data-mod-move="down"]'))
    expect(toastMessages()).toContain('调整顺序失败')
    expect(getNavOrder('panel')[0]).toBe('sec-command')
  })

  it('点到空白处不触发任何操作', () => {
    renderModuleOrderEditor()
    click(hostElement())
    expect(toastMessages()).toEqual([])
  })
})

describe('显示 / 隐藏 开关', () => {
  it('点 👁️ 写入隐藏配置并提示', () => {
    renderModuleOrderEditor()
    click(buttonOf('clean', 0, '[data-mod-hidden]'))
    expect(getHiddenModules('clean')).toEqual(['sec-targets'])
    expect(toastMessages()).toContain('模块已隐藏，可在设置页恢复')
  })

  it('点 🚫 恢复显示', () => {
    setHiddenInStore('clean', ['sec-targets'])
    renderModuleOrderEditor()
    click(buttonOf('clean', 0, '[data-mod-hidden]'))
    expect(getHiddenModules('clean')).toEqual([])
    expect(toastMessages()).toContain('模块已恢复显示')
  })

  it('切换后会重渲染编辑器（按钮图标立即变化）', () => {
    renderModuleOrderEditor()
    click(buttonOf('clean', 0, '[data-mod-hidden]'))
    expect(buttonOf('clean', 0, '[data-mod-hidden]').textContent).toBe('🚫')
  })

  it('不可隐藏的模块即使绕过 disabled 也不生效', () => {
    renderModuleOrderEditor()
    const button = buttonOf('settings', indexOfModule('settings', 'sec-modules'), '[data-mod-hidden]')
    button.removeAttribute('disabled')
    click(button)
    expect(getHiddenModules('settings')).toEqual([])
    expect(toastMessages()).toContain('切换显示状态失败')
  })

  it('隐藏其它页面的模块不影响本页顺序配置', () => {
    renderModuleOrderEditor()
    click(buttonOf('enrich', 0, '[data-mod-hidden]'))
    expect(getNavOrder('enrich')[0]).toBe('sec-file')
    expect(getHiddenModules('enrich')).toEqual(['sec-file'])
  })
})

/** 触发一个可冒泡 / 可取消的原生事件（拖拽相关） */
function fire(type: string, target: Element): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

describe('拖拽', () => {
  it('拖到同页另一个模块上会重排', () => {
    renderModuleOrderEditor()
    const from = itemsOf('clean')[0]!
    const to = itemsOf('clean')[2]!
    fire('dragstart', from)
    fire('dragover', to)
    fire('drop', to)
    fire('dragend', to)
    expect(getNavOrder('clean')[2]).toBe(from.dataset.module)
  })

  it('拖到自己身上不变', () => {
    renderModuleOrderEditor()
    const item = itemsOf('clean')[0]!
    fire('dragstart', item)
    fire('drop', item)
    expect(getNavOrder('clean')[0]).toBe(item.dataset.module)
  })

  it('跨页拖放被忽略（不同页面的顺序互不影响）', () => {
    renderModuleOrderEditor()
    const from = itemsOf('clean')[0]!
    const to = itemsOf('panel')[2]!
    fire('dragstart', from)
    fire('dragover', to)
    fire('drop', to)
    expect(getNavOrder('clean')[0]).toBe(from.dataset.module)
  })

  it('拖拽结束后清掉视觉标记', () => {
    renderModuleOrderEditor()
    const from = itemsOf('clean')[0]!
    const to = itemsOf('clean')[1]!
    fire('dragstart', from)
    fire('dragover', to)
    expect(document.querySelectorAll('.is-drop-target')).toHaveLength(1)
    fire('dragend', to)
    expect(document.querySelectorAll('.is-drop-target, .is-dragging')).toHaveLength(0)
  })

  it('从非条目元素开始拖拽时不记录来源', () => {
    renderModuleOrderEditor()
    fire('dragstart', hostElement())
    fire('drop', itemsOf('clean')[1]!)
    expect(getNavOrder('clean')[0]).toBe('sec-targets')
  })
})

describe('跨页同步与初始化', () => {
  it('其它页改了顺序后，轮询会重渲染编辑器', () => {
    renderModuleOrderEditor()
    vi.useFakeTimers()
    const stop = startModuleOrderSync()
    setNavOrder('clean', ['sec-log', 'sec-targets'])
    vi.advanceTimersByTime(2000)
    expect(itemsOf('clean')[0]?.dataset.module).toBe('sec-log')
    stop()
  })

  it('没有宿主容器时同步器不做任何事', () => {
    document.body.replaceChildren()
    vi.useFakeTimers()
    const stop = startModuleOrderSync()
    expect(() => {
      vi.advanceTimersByTime(2000)
      stop()
    }).not.toThrow()
  })

  it('初始化只绑定一次（重复调用不叠加监听器，否则一次点击移两位）', () => {
    vi.useFakeTimers()
    initModuleOrderEditor()
    initModuleOrderEditor()
    renderModuleOrderEditor()
    const first = itemsOf('panel')[0]?.dataset.module ?? ''
    click(buttonOf('panel', 0, '[data-mod-move="down"]'))
    expect(getNavOrder('panel')[1]).toBe(first)
  })

  it('非设置页初始化时静默跳过', () => {
    document.body.replaceChildren()
    expect(() => {
      initModuleOrderEditor()
    }).not.toThrow()
  })
})
