// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/shell-nav.ts`（三页面共享外壳导航）单元测试。
 *
 * 该模块**零 import**、只操作真实 DOM 与真实 window 事件，因此不做任何模块 mock：
 * 用「真 DOM 骨架 + 显式布局桩」驱动真实实现 —— jsdom 不做布局
 * （`offsetHeight` / `getBoundingClientRect` / `scrollHeight` 恒 0）且没有 `matchMedia`，
 * 必须逐个打桩，否则 scrollspy 的每条规则都退化成同一条路径。
 *
 * 断言打到**可观察副作用**：哪个导航项被高亮、胶囊是否创建/移动、
 * `--topbar-h` / `--nav-h` 是否写入、注册了哪些 window 监听。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initializeScrollspy,
  initializeShellNav,
  recomputeScrollspy,
  updateStickyOffsets,
} from '../ts/panel/shell-nav.js'

// ========== 布局桩 ==========

// jsdom 实现的是 DOM 树而非排版引擎：下面这些「几何量」全部恒为 0，必须显式打桩。

/** jsdom 不做布局：offsetHeight / getBoundingClientRect / scrollHeight 恒 0，需显式打桩 */
function setHeight(element: Element, height: number): void {
  Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true })
}

function setRect(element: Element, top: number, bottom: number): void {
  element.getBoundingClientRect = () => ({
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  })
}

function setWindowMetric(key: 'innerHeight' | 'scrollY', value: number): void {
  Object.defineProperty(window, key, { value, configurable: true, writable: true })
}

/** 视口带（顶栏 + 窄态侧栏）高度之和决定「标题是否被遮挡」，故标题判定依赖它的真实来源 */
function setScrollHeight(value: number): void {
  Object.defineProperty(document.documentElement, 'scrollHeight', { value, configurable: true })
}

function setHeadingRect(sectionId: string, top: number, bottom: number): void {
  const heading = getElement(`#${sectionId}`).querySelector('h2')
  if (!heading) throw new Error(`区块缺少标题: ${sectionId}`)
  setRect(heading, top, bottom)
}

/** 过渡锁比较的是 **section 自身**的矩形（标题矩形只参与常规 scrollspy 判定），两者要分别打桩 */
function setSectionRect(sectionId: string, top: number, bottom: number): void {
  setRect(getElement(`#${sectionId}`), top, bottom)
}

// ========== 环境桩 ==========

// 窄态判定走 matchMedia；用可变开关让同一用例既能测桌面也能测窄屏。

let isNarrow = false
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: query.includes('880') ? isNarrow : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})

/** 滚动重算被节流到「下一帧」；此处把帧回调排队，由用例显式 flush，使节流可观测 */
let frameQueue: FrameRequestCallback[] = []
const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
  frameQueue.push(callback)
  return frameQueue.length
})
Object.defineProperty(window, 'requestAnimationFrame', {
  writable: true,
  configurable: true,
  value: requestAnimationFrameMock,
})

function flushFrame(): void {
  const queued = frameQueue
  frameQueue = []
  for (const callback of queued) callback(0)
}

// ========== window 监听记录器 ==========

// shell-nav 把监听挂到 window 上且从不移除；不记录并清理的话，前序用例的闭包会在后续用例派发事件时一起跑，污染「本用例注册/执行了几次」的断言。

interface RecordedListener {
  type: string
  listener: EventListenerOrEventListenerObject
  /** 显式含 undefined：exactOptionalPropertyTypes 下不能把 undefined 赋给可选属性 */
  options: AddEventListenerOptions | boolean | undefined
}

const recordedListeners: RecordedListener[] = []
let nativeAddEventListener: typeof window.addEventListener | null = null

function installListenerRecorder(): void {
  nativeAddEventListener = window.addEventListener
  const record = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void => {
    recordedListeners.push({ type, listener, options })
    nativeAddEventListener?.call(window, type, listener, options)
  }
  Reflect.set(window, 'addEventListener', record)
}

function restoreListenerRecorder(): void {
  for (const { type, listener, options } of recordedListeners) {
    window.removeEventListener(type, listener, options)
  }
  recordedListeners.length = 0
  if (nativeAddEventListener) Reflect.set(window, 'addEventListener', nativeAddEventListener)
  nativeAddEventListener = null
}

function recordedTypes(): string[] {
  return recordedListeners.map((entry) => entry.type)
}

// ========== 骨架与查询 ==========

function mountShell(options: { sections?: string[]; extraHrefs?: string[] } = {}): void {
  const ids = options.sections ?? ['sec-a', 'sec-b']
  const topbar = document.createElement('div')
  topbar.className = 'topbar'
  const sidebar = document.createElement('aside')
  sidebar.className = 'sidebar'
  const nav = document.createElement('nav')
  nav.className = 'nav'
  for (const id of ids) {
    const link = document.createElement('a')
    link.setAttribute('href', `#${id}`)
    link.textContent = id
    nav.append(link)
  }
  const { extraHrefs } = options
  if (extraHrefs) {
    for (const href of extraHrefs) {
      const link = document.createElement('a')
      link.setAttribute('href', href)
      link.textContent = href
      nav.append(link)
    }
  }
  sidebar.append(nav)
  const main = document.createElement('main')
  for (const id of ids) {
    const section = document.createElement('section')
    section.id = id
    const heading = document.createElement('h2')
    heading.textContent = `模块 ${id}`
    section.append(heading)
    main.append(section)
  }
  document.body.append(topbar, sidebar, main)
  setHeight(topbar, 48)
  setHeight(sidebar, 60)
}

function getElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`元素未挂载: ${selector}`)
  return element
}

function navLinks(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('.nav a')]
}

function activeHref(): string | null {
  return document.querySelector('.nav a.active')?.getAttribute('href') ?? null
}

function triggerScroll(): void {
  window.dispatchEvent(new Event('scroll'))
  flushFrame()
}

function rootVariable(name: string): string {
  return document.documentElement.style.getPropertyValue(name)
}

/** 临时摘掉全局对象，验证「无 window / 无 document 时安全返回」的守卫分支 */
function withoutGlobal(name: 'window' | 'document', run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Reflect.deleteProperty(globalThis, name)
  try {
    run()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
  // documentElement 跨用例存活，布局桩必须逐轮复位，否则上一条用例的几何量会漏下来
  setScrollHeight(0)
  setWindowMetric('innerHeight', 768)
  setWindowMetric('scrollY', 0)
  isNarrow = false
  frameQueue = []
  installListenerRecorder()
})

afterEach(() => {
  restoreListenerRecorder()
  vi.useRealTimers()
})

// ========== updateStickyOffsets ==========

describe('shell-nav · updateStickyOffsets', () => {
  it('顶栏高度写入 --topbar-h；桌面态 --nav-h 归零', () => {
    mountShell()

    updateStickyOffsets()

    expect(rootVariable('--topbar-h')).toBe('48px')
    expect(rootVariable('--nav-h')).toBe('0px')
  })

  it('窄态（≤880px）把侧栏高度写入 --nav-h（顶栏下方的横向导航也要参与偏移补偿）', () => {
    mountShell()
    isNarrow = true

    updateStickyOffsets()

    expect(rootVariable('--nav-h')).toBe('60px')
  })

  it('缺 .topbar / .sidebar 时按 0 处理，不抛错', () => {
    mountShell()
    isNarrow = true
    getElement('.topbar').remove()
    getElement('.sidebar').remove()

    expect(() => updateStickyOffsets()).not.toThrow()
    expect(rootVariable('--topbar-h')).toBe('0px')
    expect(rootVariable('--nav-h')).toBe('0px')
  })

  it('matchMedia 不可用时视为桌面态（不抛错）', () => {
    mountShell()
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Reflect.deleteProperty(window, 'matchMedia')
    try {
      updateStickyOffsets()
      expect(rootVariable('--nav-h')).toBe('0px')
    } finally {
      if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor)
    }
  })
})

// ========== initializeScrollspy 早退 ==========

describe('shell-nav · initializeScrollspy 早退', () => {
  it('主区没有 sec- 区块 → 静默跳过（不创建胶囊）', () => {
    mountShell()
    getElement('main').replaceChildren()

    initializeScrollspy()

    expect(document.querySelector('.nav-indicator')).toBeNull()
  })

  it('没有侧栏导航链接 → 静默跳过', () => {
    mountShell()
    getElement('.nav').replaceChildren()

    initializeScrollspy()

    expect(document.querySelector('.nav-indicator')).toBeNull()
  })

  it('无 document 环境 → 直接返回（不抛错）', () => {
    mountShell()
    withoutGlobal('document', () => {
      expect(() => initializeScrollspy()).not.toThrow()
    })
  })
})

// ========== 胶囊与点击高亮 ==========

describe('shell-nav · 导航点击', () => {
  it('首次高亮创建滑动胶囊：prepend 进 .nav、aria-hidden 且按导航项几何定位', () => {
    mountShell()
    const [, second] = navLinks()
    if (!second) throw new Error('缺少第二个导航项')
    setHeight(second, 36)
    Object.defineProperties(second, {
      offsetWidth: { value: 120, configurable: true },
      offsetLeft: { value: 8, configurable: true },
      offsetTop: { value: 52, configurable: true },
    })
    initializeScrollspy()

    second.dispatchEvent(new Event('click'))

    const nav = getElement('.nav')
    const indicator = getElement('.nav-indicator')
    expect(nav.firstElementChild).toBe(indicator)
    expect(indicator.getAttribute('aria-hidden')).toBe('true')
    expect(indicator.style.width).toBe('120px')
    expect(indicator.style.height).toBe('36px')
    expect(indicator.style.transform).toBe('translate(8px, 52px)')
    expect(indicator.classList.contains('on')).toBe(true)
  })

  it('点击导航项立即高亮（不等平滑滚动结束，而是靠过渡锁维持）', () => {
    mountShell()
    initializeScrollspy()

    navLinks()[1]?.dispatchEvent(new Event('click'))

    expect(activeHref()).toBe('#sec-b')
    expect(navLinks()[0]?.classList.contains('active')).toBe(false)
  })

  it('点击后进入过渡锁：此后的滚动重算不得把高亮抢回去', () => {
    mountShell()
    initializeScrollspy()
    navLinks()[1]?.dispatchEvent(new Event('click'))

    // 把 sec-b 挪出吸顶带（|top - 48| > 12），并让 sec-a 成为「完整可见」的那个
    setHeadingRect('sec-b', 300, 360)
    setHeadingRect('sec-a', 60, 110)
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    triggerScroll()

    expect(activeHref()).toBe('#sec-b')
  })

  it('目标已在吸顶带内 → 保持高亮 600ms 后释放过渡锁', () => {
    // 只 fake 定时器：默认 toFake 连 requestAnimationFrame 一起替换，会让本文件的帧桩失效
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mountShell()
    initializeScrollspy()
    navLinks()[1]?.dispatchEvent(new Event('click'))

    // 目标顶部与吸顶带顶端对齐（≤12px）→ 进入「等待滚动动画稳定」分支
    setSectionRect('sec-b', 48, 700)
    setHeadingRect('sec-a', 60, 110)
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    triggerScroll()
    expect(activeHref()).toBe('#sec-b')

    // 600ms 后过渡锁自动释放 → 恢复正常 scrollspy，sec-a 完整可见即夺回高亮
    vi.advanceTimersByTime(600)
    triggerScroll()

    expect(activeHref()).toBe('#sec-a')
  })

  it('目标已离开吸顶带 → 取消待释放定时器，继续维持高亮', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mountShell()
    initializeScrollspy()
    navLinks()[1]?.dispatchEvent(new Event('click'))
    setHeadingRect('sec-a', 60, 110)
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)

    // 先在吸顶带内 → 挂上 600ms 待释放定时器
    setSectionRect('sec-b', 48, 700)
    triggerScroll()
    expect(activeHref()).toBe('#sec-b')

    // 再移出吸顶带 → 滚动仍在进行，必须取消该定时器而不是提前解锁
    setSectionRect('sec-b', 300, 900)
    triggerScroll()
    vi.advanceTimersByTime(600)
    triggerScroll()

    expect(activeHref()).toBe('#sec-b')
  })

  it('点击 5s 未完成过渡 → 定时兜底释放锁（锚点滚动被打断也不至于永久锁死）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mountShell()
    initializeScrollspy()
    navLinks()[1]?.dispatchEvent(new Event('click'))

    // 目标已远离吸顶带（|targetTop - bandTop| > 12）→ 直接维持锁、等 5s 兜底定时器释放
    setSectionRect('sec-b', 300, 900)
    setHeadingRect('sec-b', 300, 360)
    setHeadingRect('sec-a', 60, 110)
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    triggerScroll()
    expect(activeHref()).toBe('#sec-b')

    vi.advanceTimersByTime(5000)
    triggerScroll()

    expect(activeHref()).toBe('#sec-a')
  })

  it('点击指向不存在区块的锚点 → 忽略（高亮与胶囊都不产生）', () => {
    mountShell({ extraHrefs: ['#sec-missing'] })
    initializeScrollspy()

    navLinks()[2]?.dispatchEvent(new Event('click'))

    expect(activeHref()).toBeNull()
    expect(document.querySelector('.nav-indicator')).toBeNull()
  })
})

// ========== 滚动判定规则 ==========

describe('shell-nav · 滚动判定规则', () => {
  it('规则 1：滚到底（视口底部贴文档底部）→ 高亮末区块', () => {
    mountShell()
    initializeScrollspy()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 1200)

    triggerScroll()

    expect(activeHref()).toBe('#sec-b')
  })

  it('规则 1 边界：距底部 3px 时不判定为「已滚到底」', () => {
    mountShell()
    initializeScrollspy()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 1197)

    triggerScroll()

    // 落到规则 3/4：标题几何量全 0（被吸顶带遮挡）→ 逐级回退到首区块
    expect(activeHref()).toBe('#sec-a')
  })

  it('规则 2：内容不足一屏（不可滚动）→ 高亮首区块', () => {
    mountShell()
    initializeScrollspy()
    setScrollHeight(600)
    setWindowMetric('innerHeight', 800)

    triggerScroll()

    expect(activeHref()).toBe('#sec-a')
  })

  it('规则 3：跳过被顶栏遮挡的标题，高亮第一个完整可见的标题', () => {
    mountShell()
    initializeScrollspy()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 200)
    setHeadingRect('sec-a', -40, 20)
    setHeadingRect('sec-b', 60, 110)

    triggerScroll()

    expect(activeHref()).toBe('#sec-b')
  })

  it('规则 4：没有完整标题时，取第一个与有效视口相交的区块', () => {
    mountShell({ sections: ['sec-a', 'sec-b', 'sec-c'] })
    initializeScrollspy()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 200)
    setHeadingRect('sec-a', -200, -100)
    setHeadingRect('sec-b', -20, 300)
    setHeadingRect('sec-c', 400, 900)

    triggerScroll()

    expect(activeHref()).toBe('#sec-b')
  })

  it('极端布局：视口内没有任何标题 → 回退首区块', () => {
    mountShell()
    initializeScrollspy()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 200)
    setHeadingRect('sec-a', -200, -100)
    setHeadingRect('sec-b', -150, -60)

    triggerScroll()

    expect(activeHref()).toBe('#sec-a')
  })

  it('窄态把侧栏高度一并计入遮挡带（否则标题会被横向导航压住却仍判为完整可见）', () => {
    mountShell()
    initializeScrollspy()
    isNarrow = true
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 200)
    // 遮挡带 = 顶栏 48 + 侧栏 60 = 108：sec-a 标题顶端 60 < 108 故不算完整可见
    setHeadingRect('sec-a', 60, 110)
    setHeadingRect('sec-b', 120, 180)

    triggerScroll()

    expect(activeHref()).toBe('#sec-b')
  })

  it('resize 也会重算当前区块（布局/字体就绪后无需等滚动）', () => {
    mountShell()
    initializeScrollspy()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 1200)

    window.dispatchEvent(new Event('resize'))

    expect(activeHref()).toBe('#sec-b')
  })

  it('滚动重算按帧节流：同一帧内多次 scroll 只排一次帧，且不立即生效', () => {
    mountShell()
    initializeScrollspy()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 1200)

    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('scroll'))

    // 节流到帧：此刻还没算，高亮仍未产生
    expect(activeHref()).toBeNull()
    flushFrame()
    expect(activeHref()).toBe('#sec-b')
  })

  it('recompute 用当前高亮项重新定位胶囊（缩放后偏移会变）', () => {
    mountShell()
    const [, second] = navLinks()
    if (!second) throw new Error('缺少第二个导航项')
    Object.defineProperties(second, {
      offsetLeft: { value: 10, configurable: true },
      offsetTop: { value: 20, configurable: true },
      offsetWidth: { value: 100, configurable: true },
    })
    setHeight(second, 30)
    initializeScrollspy()
    second.dispatchEvent(new Event('click'))
    expect(getElement('.nav-indicator').style.transform).toBe('translate(10px, 20px)')

    Object.defineProperties(second, {
      offsetLeft: { value: 33, configurable: true },
      offsetTop: { value: 44, configurable: true },
    })
    window.dispatchEvent(new Event('resize'))

    expect(getElement('.nav-indicator').style.transform).toBe('translate(33px, 44px)')
  })
})

// ========== initializeShellNav / recomputeScrollspy ==========

describe('shell-nav · initializeShellNav', () => {
  it('初始化即写吸顶偏移、装配滚动监听、并主动推一次 scroll（首屏可能已处于恢复位置）', () => {
    mountShell()
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 1200)

    initializeShellNav()

    expect(rootVariable('--topbar-h')).toBe('48px')
    expect(recordedTypes()).toContain('scroll')
    expect(recordedTypes()).toContain('load')
    expect(recordedTypes()).toContain('resize')
    flushFrame()
    expect(activeHref()).toBe('#sec-b')
  })

  it('load 后重测吸顶偏移（字体就绪会改变顶栏高度）', () => {
    mountShell()
    initializeShellNav()
    setHeight(getElement('.topbar'), 72)

    window.dispatchEvent(new Event('load'))

    expect(rootVariable('--topbar-h')).toBe('72px')
  })

  it('resize 后同样重测吸顶偏移', () => {
    mountShell()
    initializeShellNav()
    setHeight(getElement('.topbar'), 64)

    window.dispatchEvent(new Event('resize'))

    expect(rootVariable('--topbar-h')).toBe('64px')
  })

  it('无 window / document 环境 → 直接返回（不抛错）', () => {
    withoutGlobal('window', () => {
      expect(() => initializeShellNav()).not.toThrow()
    })
  })
})

describe('shell-nav · recomputeScrollspy', () => {
  it('派发一次 scroll 事件驱动重算', () => {
    mountShell()
    initializeScrollspy()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    setScrollHeight(2000)
    setWindowMetric('innerHeight', 800)
    setWindowMetric('scrollY', 1200)

    recomputeScrollspy()
    flushFrame()

    const scrollEvents = dispatchSpy.mock.calls.filter(([event]) => event.type === 'scroll')
    expect(scrollEvents).toHaveLength(1)
    expect(activeHref()).toBe('#sec-b')
  })

  it('无 window 环境 → 直接返回（不抛错）', () => {
    withoutGlobal('window', () => {
      expect(() => recomputeScrollspy()).not.toThrow()
    })
  })
})
