// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initializeModuleOrderEditor,
  renderModuleOrderEditor,
  startModuleOrderSync,
} from '../ts/ui/handlers/module-order.js'
import { getNavOrder, PAGE_MODULES, setNavOrder } from '../ts/tools/nav-order.js'
import { getHiddenModules } from '../ts/tools/module-state.js'
import { CONFIG_KEYS } from '../ts/tools/config.js'

/**
 * mock 的配置存储与 UI 副作用收集。
 * `vi.mock` 工厂会被提升到 import 之前，工厂内不能引用模块级变量 —— 用 `vi.hoisted` 一并提升。
 * 这里不用 `vi.fn()`（hoisted 回调里引用 vi 不稳），改用普通数组记录调用。
 */
const { configStore, mockGetConfig, mockSetConfig, toastCalls, logCalls, setWriteShouldFail } =
  vi.hoisted(() => {
    const store = new Map<string, string>()
    const toasts: [string, string][] = []
    const logs: [string, string][] = []
    // 可控写盘失败开关：驱动「写配置失败」的兜底提示分支
    let isWriteShouldFail = false
    return {
      configStore: store,
      toastCalls: toasts,
      logCalls: logs,
      setWriteShouldFail: (shouldFail: boolean): void => {
        isWriteShouldFail = shouldFail
      },
      mockGetConfig: (key: string, fallback = ''): string => store.get(key) ?? fallback,
      mockSetConfig: (key: string, value: string): boolean => {
        if (isWriteShouldFail) return false
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
  setWriteShouldFail(false)
  // 用假定时器：initializeModuleOrderEditor 内部会起一个 2s 轮询，不冻结会留下悬挂定时器
  vi.useFakeTimers()
  buildHost()
  // 点击 / 拖拽的委托监听器由初始化函数绑定 —— 只调 renderModuleOrderEditor 是不会响应交互的
  initializeModuleOrderEditor()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('渲染', () => {
  it('四个页面的分组都渲染出来，条目数等于注册表模块数', () => {
    renderModuleOrderEditor()
    // 数量从注册表推导：往任何一页加模块都不该让这条断言变红
    for (const page of ['panel', 'enrich', 'clean', 'highlight', 'conditional-format', 'settings']) {
      expect(itemsOf(page)).toHaveLength(PAGE_MODULES[page]?.length ?? 0)
    }
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
    expect(
      buttonOf('panel', indexOfModule('panel', 'sec-account'), '[data-mod-hidden]').textContent,
    ).toBe('🚫')
  })

  it('未隐藏的模块显示 👁️', () => {
    renderModuleOrderEditor()
    expect(buttonOf('panel', 0, '[data-mod-hidden]').textContent).toBe('👁️')
  })

  it('设置页的「模块排序」模块不可隐藏（隐藏后就没有入口能恢复任何模块）', () => {
    renderModuleOrderEditor()
    const button = buttonOf(
      'settings',
      indexOfModule('settings', 'sec-modules'),
      '[data-mod-hidden]',
    )
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
    const button = buttonOf(
      'settings',
      indexOfModule('settings', 'sec-modules'),
      '[data-mod-hidden]',
    )
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

/** 派发 pointer 事件序列（sortable 的 Pointer Events 驱动） */
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

/**
 * 推进合帧：本文件全局 fake timers（rAF 也被接管），真实
 * requestAnimationFrame 永远不会触发，必须用 advanceTimersByTime 驱动
 */
function nextFrames(): void {
  vi.advanceTimersByTime(50)
}

/** 布局桩：项垂直排列、每项 40px（sortable 的中点碰撞检测要真实高度） */
function stubItemRects(items: HTMLElement[]): void {
  for (const [index, item] of items.entries()) {
    item.getBoundingClientRect = () =>
      ({
        top: index * 40,
        bottom: index * 40 + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
      }) as DOMRect
  }
}

describe('拖拽排序（sortable 接入）', () => {
  it('DOM 契约：行不带 draggable（Pointer Events 驱动），把手在位', () => {
    renderModuleOrderEditor()
    for (const item of itemsOf('clean')) {
      // 旧实现是 HTML5 DnD（draggable=true）——iframe 里不稳，已换 sortable
      expect(item.draggable).toBe(false)
      expect(item.querySelector('.module-order-handle')).not.toBeNull()
    }
  })

  it('从把手按下、拖到第 3 项中点之下松手 → 顺序落盘', () => {
    // beforeEach 已 initializeModuleOrderEditor（含 sortable 装配），这里只补布局桩
    const items = itemsOf('clean')
    stubItemRects(items)
    const from = items[0]!
    const handle = from.querySelector<HTMLElement>('.module-order-handle')
    if (!handle) throw new Error('缺少拖拽把手')

    pointer(handle, 'pointerdown', 10, 10)
    // 指针落到第 3 项（top 80..120）中点之下 → 插它后面 = index 3
    pointer(window, 'pointermove', 10, 110)
    pointer(window, 'pointermove', 10, 110)
    nextFrames()
    pointer(window, 'pointerup', 10, 110)
    nextFrames()

    expect(getNavOrder('clean')[3]).toBe(from.dataset.module)
    // 摘掉「吞拖拽后 click」的窗口拦截器：fake timers 下不会自动到点，
    // 不推进它会挂着吞掉后续用例的 click
    vi.advanceTimersByTime(400)
  })

  it('不过激活阈值的位移 = 单击：顺序不变', () => {
    initializeModuleOrderEditor()
    const items = itemsOf('clean')
    stubItemRects(items)
    const before = getNavOrder('clean').join(',')
    const handle = items[0]!.querySelector<HTMLElement>('.module-order-handle')
    if (!handle) throw new Error('缺少拖拽把手')

    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 12, 12)
    nextFrames()
    pointer(window, 'pointerup', 12, 12)
    nextFrames()

    expect(getNavOrder('clean').join(',')).toBe(before)
    vi.advanceTimersByTime(400)
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
    initializeModuleOrderEditor()
    initializeModuleOrderEditor()
    renderModuleOrderEditor()
    const first = itemsOf('panel')[0]?.dataset.module ?? ''
    click(buttonOf('panel', 0, '[data-mod-move="down"]'))
    expect(getNavOrder('panel')[1]).toBe(first)
  })

  it('非设置页初始化时静默跳过', () => {
    document.body.replaceChildren()
    expect(() => {
      initializeModuleOrderEditor()
    }).not.toThrow()
  })
})

// ========== 兜底分支：写盘失败 / 拖拽数据 / 卸载清理 ==========

/** 带 dataTransfer 的拖拽事件（jsdom 没有 DragEvent，用 Event 附加属性模拟） */

describe('兜底分支', () => {
  it('恢复默认顺序写盘失败时提示错误（配置保持原样）', () => {
    setNavOrder('panel', ['sec-help', 'sec-account'])
    renderModuleOrderEditor()
    const reset = document.querySelector<HTMLElement>('[data-mod-reset="panel"]')
    if (!reset) throw new Error('缺少恢复默认按钮')

    setWriteShouldFail(true)
    click(reset)
    setWriteShouldFail(false)

    expect(toastMessages()).toContain('恢复默认顺序失败')
    // 写盘失败 → 存储里仍是之前写入的顺序
    expect(getNavOrder('panel')[0]).toBe('sec-help')
  })

  it('beforeunload 时清掉轮询定时器（不再跟随其它窗格的改动）', () => {
    renderModuleOrderEditor()
    const stop = startModuleOrderSync()

    window.dispatchEvent(new Event('beforeunload'))
    setNavOrder('clean', ['sec-log', 'sec-targets'])
    vi.advanceTimersByTime(4000)

    // 定时器已清 → 不会重渲染，clean 首项仍是默认的 sec-targets
    expect(itemsOf('clean')[0]?.dataset.module).toBe('sec-targets')
    stop()
  })
})
